import { storage, db } from "../storage";
import { log } from "../index";
import { users, jackpotVault, wheelSpins } from "@shared/schema";
import { eq, sql, and } from "drizzle-orm";
import { recordLedgerEntry } from "../middleware/ledger";
import { announceWheelWinner } from "./telegramBot";

interface WheelPrize {
  tier: "jackpot" | "big_win" | "common" | "no_cash";
  label: string;
  usdtValue: number;
  coinsValue: number;
  energyValue: number;
}

const TIER_JACKPOT_VALUES: Record<string, number> = {
  BRONZE: 100,
  SILVER: 200,
  GOLD: 500,
};

const RNG_RANGE = 10001;
const JACKPOT_TRIGGER = 7777;
const BIG_WIN_CEILING = 50;

const TIER_COMMON_CEILINGS: Record<string, number> = {
  BRONZE: BIG_WIN_CEILING + 2300,
  SILVER: BIG_WIN_CEILING + 2100,
  GOLD: BIG_WIN_CEILING + 1500,
};

const NO_CASH_PRIZES: Array<{ label: string; coins: number; energy: number; weight: number }> = [
  { label: "1,000 Coins", coins: 1000, energy: 0, weight: 30 },
  { label: "2,500 Coins", coins: 2500, energy: 0, weight: 25 },
  { label: "5,000 Coins", coins: 5000, energy: 0, weight: 15 },
  { label: "Energy Boost", coins: 0, energy: 500, weight: 15 },
  { label: "500 Coins", coins: 500, energy: 0, weight: 15 },
];

function pickNoCashPrize(): { label: string; coins: number; energy: number } {
  const totalWeight = NO_CASH_PRIZES.reduce((sum, p) => sum + p.weight, 0);
  let rand = Math.random() * totalWeight;
  for (const prize of NO_CASH_PRIZES) {
    rand -= prize.weight;
    if (rand <= 0) return { label: prize.label, coins: prize.coins, energy: prize.energy };
  }
  return { label: NO_CASH_PRIZES[0].label, coins: NO_CASH_PRIZES[0].coins, energy: NO_CASH_PRIZES[0].energy };
}

function getVisualSliceIndex(tier: "jackpot" | "big_win" | "common" | "no_cash"): number {
  switch (tier) {
    case "jackpot": return 5;
    case "big_win": return 4;
    case "common": return 2;
    case "no_cash":
      const noCashSlices = [0, 1, 3, 6, 7];
      return noCashSlices[Math.floor(Math.random() * noCashSlices.length)];
  }
}

export async function spinWheel(userId: string): Promise<{
  reward: number;
  coinsAwarded: number;
  energyAwarded: number;
  label: string;
  sliceIndex: number;
  tier: string;
  lockedPrize?: boolean;
}> {
  const user = await storage.getUser(userId);
  if (!user) throw new Error("User not found");

  const isFree = user.tier === "FREE" || !user.subscriptionExpiry || new Date(user.subscriptionExpiry) <= new Date();
  const isPaidTier = !isFree;

  if (isPaidTier) {
    const ticketsExpired = user.spinTicketsExpiry && new Date(user.spinTicketsExpiry) <= new Date();
    if (ticketsExpired || user.spinTickets <= 0) {
      throw new Error("No spin tickets remaining. Renew your subscription!");
    }
  } else {
    if (user.spinsRemaining <= 0) {
      throw new Error("No spins remaining this month. Upgrade to get more spins!");
    }
  }

  const rng = Math.floor(Math.random() * RNG_RANGE);
  const jackpotValue = TIER_JACKPOT_VALUES[user.tier] || 100;

  log(`[Wheel] User ${userId} (${user.tier}) spun: RNG=${rng}`);

  const walletBefore = user.walletBalance;
  let prize: WheelPrize;
  let lockedPrize = false;

  const result = await db.transaction(async (tx) => {
    let lockedVaultBalance = 0;
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    const vaultResult = await tx.execute(sql`
      SELECT id, total_balance FROM jackpot_vault
      WHERE tier_name = ${user.tier.toUpperCase()}
        AND month_key = ${monthKey}
      FOR UPDATE
    `);
    const vaultRows = (vaultResult as any)?.rows ?? vaultResult;
    const lockedVault = Array.isArray(vaultRows) && vaultRows.length > 0 ? vaultRows[0] : null;

    if (lockedVault) {
      lockedVaultBalance = parseFloat(lockedVault.total_balance);
    }

    const commonCeiling = TIER_COMMON_CEILINGS[user.tier.toUpperCase()] || (BIG_WIN_CEILING + 2300);

    if (isFree) {
      let lockedTier: "jackpot" | "big_win" | "common" | null = null;
      if (rng === JACKPOT_TRIGGER) {
        lockedTier = "jackpot";
      } else if (rng < BIG_WIN_CEILING) {
        lockedTier = "big_win";
      } else if (rng < commonCeiling) {
        lockedTier = "common";
      }
      if (lockedTier) {
        lockedPrize = true;
        prize = { tier: lockedTier, label: "Locked $100 USDT", usdtValue: 0, coinsValue: 5000, energyValue: 0 };
        log(`[Wheel] Free user ${userId} hit ${lockedTier} USDT slice (RNG=${rng}) — locked, awarded 5,000 coins instead`);
      } else {
        const noCash = pickNoCashPrize();
        prize = { tier: "no_cash", label: noCash.label, usdtValue: 0, coinsValue: noCash.coins, energyValue: noCash.energy };
      }
    } else if (rng === JACKPOT_TRIGGER && lockedVaultBalance >= jackpotValue) {
      prize = { tier: "jackpot", label: `GRAND JACKPOT $${jackpotValue}!`, usdtValue: jackpotValue, coinsValue: 0, energyValue: 0 };
    } else if (rng < BIG_WIN_CEILING && lockedVaultBalance >= 5) {
      prize = { tier: "big_win", label: "Big Win $5!", usdtValue: 5.00, coinsValue: 0, energyValue: 0 };
    } else if (rng < commonCeiling && lockedVaultBalance >= 0.50) {
      prize = { tier: "common", label: "0.50 USDT", usdtValue: 0.50, coinsValue: 0, energyValue: 0 };
    } else {
      const noCash = pickNoCashPrize();
      prize = { tier: "no_cash", label: noCash.label, usdtValue: 0, coinsValue: noCash.coins, energyValue: noCash.energy };
    }

    const walletAfter = parseFloat((walletBefore + prize.usdtValue).toFixed(4));

    const userUpdates: any = {
      totalSpins: user.totalSpins + 1,
    };

    if (prize.usdtValue > 0) {
      userUpdates.walletBalance = walletAfter;
      userUpdates.totalWheelWinnings = user.totalWheelWinnings + prize.usdtValue;
    }

    if (prize.coinsValue > 0) {
      userUpdates.totalCoins = sql`${users.totalCoins} + ${prize.coinsValue}`;
    }

    if (prize.energyValue > 0) {
      userUpdates.energy = sql`LEAST(${users.energy} + ${prize.energyValue}, ${users.maxEnergy})`;
    }

    if (isPaidTier) {
      userUpdates.spinTickets = user.spinTickets - 1;
    } else {
      userUpdates.spinsRemaining = user.spinsRemaining - 1;
    }

    await tx.update(users).set(userUpdates).where(eq(users.id, userId));

    if (prize.usdtValue > 0 && lockedVault) {
      const newVaultBalance = Math.max(0, lockedVaultBalance - prize.usdtValue);
      await tx.execute(sql`
        UPDATE jackpot_vault SET total_balance = ${newVaultBalance.toFixed(2)}, updated_at = now()
        WHERE id = ${lockedVault.id}
      `);
    }

    await tx.insert(wheelSpins).values({
      userId,
      reward: prize.usdtValue,
      sliceLabel: prize.label,
    });

    if (prize.usdtValue > 0) {
      await recordLedgerEntry({
        userId,
        entryType: "wheel_win",
        direction: "credit",
        amount: prize.usdtValue,
        currency: "USDT",
        balanceBefore: walletBefore,
        balanceAfter: walletAfter,
        game: "wheelVault",
        note: `Wheel spin: ${prize.label} — $${prize.usdtValue} USDT credited. Vault deducted.`,
      }, tx);
    } else {
      await recordLedgerEntry({
        userId,
        entryType: "wheel_win",
        direction: "credit",
        amount: prize.coinsValue || prize.energyValue,
        currency: prize.coinsValue > 0 ? "COINS" : "ENERGY",
        balanceBefore: prize.coinsValue > 0 ? user.totalCoins : user.energy,
        balanceAfter: prize.coinsValue > 0 ? user.totalCoins + prize.coinsValue : Math.min(user.energy + prize.energyValue, user.maxEnergy),
        game: "wheelVault",
        note: `Wheel spin: ${prize.label} — no USDT payout`,
      }, tx);
    }

    if (isPaidTier) {
      await recordLedgerEntry({
        userId,
        entryType: "wheel_win",
        direction: "debit",
        amount: 1,
        currency: "TICKETS",
        balanceBefore: user.spinTickets,
        balanceAfter: user.spinTickets - 1,
        game: "wheelVault",
        note: "Used 1 spin ticket",
      }, tx);
    }

    return { walletAfter };
  });

  if (prize!.tier === "jackpot" || prize!.usdtValue >= 5) {
    announceWheelWinner(user.username || user.email, prize!.usdtValue, user.tier, jackpotValue);
  }

  log(`[Wheel] Result: ${prize!.tier} — ${prize!.label} (RNG=${rng}, vault locked inside tx)`);

  const sliceIndex = getVisualSliceIndex(prize!.tier);

  return {
    reward: prize!.usdtValue,
    coinsAwarded: prize!.coinsValue,
    energyAwarded: prize!.energyValue,
    label: prize!.label,
    sliceIndex,
    tier: prize!.tier,
    lockedPrize,
  };
}

