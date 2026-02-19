import { storage, db } from "../storage";
import { log } from "../index";
import { users, jackpotVault, wheelSpins } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { recordLedgerEntry } from "../middleware/ledger";

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
}> {
  const user = await storage.getUser(userId);
  if (!user) throw new Error("User not found");

  const isPaidTier = user.tier !== "FREE" && user.subscriptionExpiry && new Date(user.subscriptionExpiry) > new Date();

  if (isPaidTier) {
    const ticketsExpired = user.spinTicketsExpiry && new Date(user.spinTicketsExpiry) <= new Date();
    if (ticketsExpired || user.spinTickets <= 0) {
      throw new Error("No spin tickets remaining. Renew your subscription!");
    }
  } else {
    if (user.spinsRemaining <= 0) {
      throw new Error("No spins remaining. Come back tomorrow!");
    }
  }

  const vaultBalance = await storage.getJackpotVaultBalance(user.tier);

  const jackpotValue = TIER_JACKPOT_VALUES[user.tier] || 100;
  const rng = Math.floor(Math.random() * 1000);

  let prize: WheelPrize;

  if (rng === 777 && vaultBalance >= jackpotValue) {
    prize = { tier: "jackpot", label: `GRAND JACKPOT $${jackpotValue}!`, usdtValue: jackpotValue, coinsValue: 0, energyValue: 0 };
  } else if (rng < 10 && vaultBalance >= 5) {
    prize = { tier: "big_win", label: "Big Win $5!", usdtValue: 5.00, coinsValue: 0, energyValue: 0 };
  } else if (rng < 110 && vaultBalance >= 0.50) {
    prize = { tier: "common", label: "0.50 USDT", usdtValue: 0.50, coinsValue: 0, energyValue: 0 };
  } else {
    const noCash = pickNoCashPrize();
    prize = { tier: "no_cash", label: noCash.label, usdtValue: 0, coinsValue: noCash.coins, energyValue: noCash.energy };
  }

  const walletBefore = user.walletBalance;
  const walletAfter = parseFloat((walletBefore + prize.usdtValue).toFixed(4));

  await db.transaction(async (tx) => {
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

    if (prize.usdtValue > 0) {
      const vault = await storage.getOrCreateJackpotVault(user.tier);
      const newVaultBalance = Math.max(0, parseFloat(vault.totalBalance) - prize.usdtValue);
      await tx.update(jackpotVault)
        .set({ totalBalance: newVaultBalance.toFixed(2), updatedAt: new Date() })
        .where(eq(jackpotVault.id, vault.id));
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
  });

  if (prize.tier === "jackpot") {
    announceJackpotWin(user.username || user.email, prize.usdtValue, user.tier);
  }

  const sliceIndex = getVisualSliceIndex(prize.tier);

  return {
    reward: prize.usdtValue,
    coinsAwarded: prize.coinsValue,
    energyAwarded: prize.energyValue,
    label: prize.label,
    sliceIndex,
    tier: prize.tier,
  };
}

async function announceJackpotWin(username: string, amount: number, tier: string): Promise<void> {
  const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const TELEGRAM_GROUP_ID = process.env.TELEGRAM_GROUP_ID;
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_GROUP_ID) {
    log(`[Wheel] Jackpot announcement skipped — Telegram not configured. ${username} won $${amount} (${tier})`);
    return;
  }

  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TELEGRAM_GROUP_ID,
        text: `JACKPOT WINNER!\n\n${username} just hit the $${amount} USDT GRAND JACKPOT on the ${tier} Lucky Wheel!\n\nWho's next? Spin now!`,
        parse_mode: "HTML",
      }),
    });
    log(`[Wheel] Jackpot announcement sent: ${username} won $${amount} (${tier})`);
  } catch (e: any) {
    log(`[Wheel] Failed to send jackpot announcement: ${e.message}`);
  }
}
