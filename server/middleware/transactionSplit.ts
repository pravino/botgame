import { storage } from "../storage";
import { log } from "../index";
import { recordLedgerEntry } from "./ledger";

const DEFAULT_ADMIN_SPLIT = 0.40;
const DEFAULT_TREASURY_SPLIT = 0.60;

async function getAdminTreasurySplit(): Promise<{ adminSplit: number; treasurySplit: number }> {
  try {
    const config = await storage.getGlobalConfig();
    return {
      adminSplit: config.admin_split ?? DEFAULT_ADMIN_SPLIT,
      treasurySplit: config.treasury_split ?? DEFAULT_TREASURY_SPLIT,
    };
  } catch {
    return { adminSplit: DEFAULT_ADMIN_SPLIT, treasurySplit: DEFAULT_TREASURY_SPLIT };
  }
}

const DEFAULT_POOL_SPLIT = {
  tapPot: 0.50,
  predictPot: 0.30,
  wheelVault: 0.20,
};

async function getPoolSplit(): Promise<{ tapPot: number; predictPot: number; wheelVault: number }> {
  try {
    const config = await storage.getGlobalConfig();
    return {
      tapPot: config.tap_share ?? DEFAULT_POOL_SPLIT.tapPot,
      predictPot: config.prediction_share ?? DEFAULT_POOL_SPLIT.predictPot,
      wheelVault: config.wheel_share ?? DEFAULT_POOL_SPLIT.wheelVault,
    };
  } catch {
    return DEFAULT_POOL_SPLIT;
  }
}

const DRIP_DAYS = 30;

const DEFAULT_SPIN_ALLOCATIONS: Record<string, number> = {
  FREE: 1,
  BRONZE: 4,
  SILVER: 12,
  GOLD: 40,
};

async function getSpinAllocation(tierName: string): Promise<number> {
  try {
    const config = await storage.getGlobalConfig();
    const key = `spins_${tierName.toLowerCase()}`;
    return config[key] ?? DEFAULT_SPIN_ALLOCATIONS[tierName.toUpperCase()] ?? 4;
  } catch {
    return DEFAULT_SPIN_ALLOCATIONS[tierName.toUpperCase()] ?? 4;
  }
}

const ADMIN_PROFITS_WALLET = process.env.ADMIN_PROFITS_WALLET || "UQAdminWalletPlaceholder";
const GAME_TREASURY_WALLET = process.env.GAME_TREASURY_WALLET || "UQTreasuryWalletPlaceholder";

const FALLBACK_TIER_PRICES: Record<string, number> = { BRONZE: 5.00, SILVER: 15.00, GOLD: 50.00 };

async function getTierPrice(tierName: string): Promise<number | undefined> {
  try {
    const allTiers = await storage.getAllTiers();
    const tier = allTiers.find(t => t.name === tierName.toUpperCase());
    return tier ? parseFloat(String(tier.price)) : FALLBACK_TIER_PRICES[tierName.toUpperCase()];
  } catch {
    return FALLBACK_TIER_PRICES[tierName.toUpperCase()];
  }
}

const FOUNDER_LIMITS: Record<string, number> = {
  BRONZE: 100,
  SILVER: 100,
  GOLD: 100,
};

export interface SplitResult {
  success: boolean;
  tierName: string;
  totalAmount: number;
  adminAmount: number;
  treasuryAmount: number;
  adminWallet: string;
  treasuryWallet: string;
  poolAllocations: {
    tapPot: { total: number; dailyDrip: number };
    predictPot: { total: number; dailyDrip: number };
    wheelVault: { total: number; instantCredit: boolean };
  };
  spinTickets: number;
  isFounder: boolean;
  isProRated: boolean;
  proRateNote: string;
  message: string;
}

export async function processSubscriptionPayment(
  userId: string,
  txHash: string,
  tierName: string,
  verifiedAmount: number
): Promise<SplitResult> {
  const normalizedTier = tierName.toUpperCase();

  const expectedPrice = await getTierPrice(normalizedTier);
  if (!expectedPrice) {
    throw new Error(`Invalid tier: ${tierName}. Must be BRONZE, SILVER, or GOLD.`);
  }

  if (Math.abs(verifiedAmount - expectedPrice) > 0.01) {
    throw new Error(
      `Payment amount ${verifiedAmount} does not match ${normalizedTier} tier price of ${expectedPrice} USDT`
    );
  }

  const { adminSplit, treasurySplit } = await getAdminTreasurySplit();
  const adminAmount = parseFloat((verifiedAmount * adminSplit).toFixed(2));
  const grossTreasury = parseFloat((verifiedAmount * treasurySplit).toFixed(2));

  const payer = await storage.getUser(userId);
  const config = await storage.getGlobalConfig();
  const referralRewardAmount = config.referral_reward_amount ?? 1;
  const hasReferrer = !!(payer?.referredBy);
  const referralDeduction = hasReferrer ? Math.min(referralRewardAmount, grossTreasury) : 0;
  const treasuryAmount = parseFloat((grossTreasury - referralDeduction).toFixed(2));

  const tx = await storage.createTransaction({
    userId,
    txHash,
    tierName: normalizedTier,
    totalAmount: verifiedAmount.toFixed(2),
    adminAmount: adminAmount.toFixed(2),
    treasuryAmount: treasuryAmount.toFixed(2),
    adminWallet: ADMIN_PROFITS_WALLET,
    treasuryWallet: GAME_TREASURY_WALLET,
  });

  log(`Transaction ${tx.id}: ${verifiedAmount} USDT -> Admin: $${adminAmount}, Referral: $${referralDeduction}, Treasury (net): $${treasuryAmount}`);

  if (referralDeduction > 0 && payer?.referredBy) {
    await recordLedgerEntry({
      userId: payer.referredBy,
      entryType: "referral_treasury_deduction",
      direction: "credit",
      amount: referralDeduction,
      currency: "USDT",
      balanceBefore: 0,
      balanceAfter: 0,
      game: undefined,
      refId: `treasury_deduct_${txHash}`,
      note: `$${referralDeduction} deducted from treasury for referral reward (payer: ${userId}, tx: ${txHash})`,
    });
  }

  const now = new Date();
  const expiryDate = new Date(now.getTime() + DRIP_DAYS * 24 * 60 * 60 * 1000);

  const poolSplit = await getPoolSplit();
  const tapPotTotal = parseFloat((treasuryAmount * poolSplit.tapPot).toFixed(2));
  const predictPotTotal = parseFloat((treasuryAmount * poolSplit.predictPot).toFixed(2));
  const wheelVaultTotal = parseFloat((treasuryAmount * poolSplit.wheelVault).toFixed(2));

  const tapPotDaily = parseFloat((tapPotTotal / DRIP_DAYS).toFixed(4));
  const predictPotDaily = parseFloat((predictPotTotal / DRIP_DAYS).toFixed(4));

  await Promise.all([
    storage.createPoolAllocation({
      transactionId: tx.id,
      tierName: normalizedTier,
      game: "tapPot",
      totalAmount: tapPotTotal.toFixed(2),
      dailyAmount: tapPotDaily.toFixed(4),
      totalDays: DRIP_DAYS,
      dripType: "daily",
      depositDate: now,
      expiryDate,
    }),
    storage.createPoolAllocation({
      transactionId: tx.id,
      tierName: normalizedTier,
      game: "predictPot",
      totalAmount: predictPotTotal.toFixed(2),
      dailyAmount: predictPotDaily.toFixed(4),
      totalDays: DRIP_DAYS,
      dripType: "daily",
      depositDate: now,
      expiryDate,
    }),
    storage.createPoolAllocation({
      transactionId: tx.id,
      tierName: normalizedTier,
      game: "wheelVault",
      totalAmount: wheelVaultTotal.toFixed(2),
      dailyAmount: "0",
      totalDays: DRIP_DAYS,
      dripType: "instant",
      depositDate: now,
      expiryDate,
    }),
  ]);

  await storage.addToJackpotVault(normalizedTier, wheelVaultTotal);

  log(`Smart Ledger: Treasury $${treasuryAmount} -> TapPot: $${tapPotTotal} (drip $${tapPotDaily}/day), PredictPot: $${predictPotTotal} (drip $${predictPotDaily}/day), WheelVault: $${wheelVaultTotal} (instant to jackpot)`);

  const subscriberCount = await storage.getSubscriberCountByTier(normalizedTier);
  const founderLimit = FOUNDER_LIMITS[normalizedTier] || 100;
  const isFounder = subscriberCount <= founderLimit;

  const spinTicketsForTier = await getSpinAllocation(normalizedTier);

  const subscriptionExpiry = new Date(now.getTime() + DRIP_DAYS * 24 * 60 * 60 * 1000);
  const wheelUnlockConfig: Record<string, boolean> = {};
  if (normalizedTier === "GOLD") {
    wheelUnlockConfig.wheelUnlocked = true;
  }

  await storage.updateUser(userId, {
    tier: normalizedTier,
    subscriptionExpiry,
    subscriptionStartedAt: now,
    isFounder: isFounder || undefined,
    spinTickets: spinTicketsForTier,
    spinTicketsExpiry: expiryDate,
    ...wheelUnlockConfig,
  });

  log(`User ${userId}: ${normalizedTier} tier activated (Founder: ${isFounder}), ${spinTicketsForTier} spin tickets granted, expires ${subscriptionExpiry.toISOString()}`);

  const user = await storage.getUser(userId);
  const walletBefore = user ? user.walletBalance : 0;

  await recordLedgerEntry({
    userId,
    entryType: "subscription_payment",
    direction: "debit",
    amount: verifiedAmount,
    currency: "USDT",
    balanceBefore: walletBefore,
    balanceAfter: walletBefore,
    game: undefined,
    refId: tx.id,
    note: `${normalizedTier} tier subscription: $${verifiedAmount} (Admin: $${adminAmount}, Treasury: $${treasuryAmount})`,
  });

  await recordLedgerEntry({
    userId,
    entryType: "spin_ticket_grant",
    direction: "credit",
    amount: spinTicketsForTier,
    currency: "TICKETS",
    balanceBefore: 0,
    balanceAfter: spinTicketsForTier,
    game: "wheelVault",
    refId: tx.id,
    note: `${spinTicketsForTier} spin tickets granted with ${normalizedTier} subscription`,
  });

  const minutesLeftInDay = ((23 - now.getUTCHours()) * 60) + (60 - now.getUTCMinutes());
  const isProRated = minutesLeftInDay < 1440;
  const hoursLeft = Math.round(minutesLeftInDay / 60);
  const proRateNote = isProRated && hoursLeft < 24
    ? `Since you joined mid-day, your rewards for the next ${hoursLeft} hours are pro-rated. Full 24-hour pools unlock at Midnight UTC.`
    : "";

  return {
    success: true,
    tierName: normalizedTier,
    totalAmount: verifiedAmount,
    adminAmount,
    treasuryAmount,
    adminWallet: ADMIN_PROFITS_WALLET,
    treasuryWallet: GAME_TREASURY_WALLET,
    poolAllocations: {
      tapPot: { total: tapPotTotal, dailyDrip: tapPotDaily },
      predictPot: { total: predictPotTotal, dailyDrip: predictPotDaily },
      wheelVault: { total: wheelVaultTotal, instantCredit: true },
    },
    spinTickets: spinTicketsForTier,
    isFounder,
    isProRated,
    proRateNote,
    message: `${normalizedTier} Tier Activated! ${spinTicketsForTier} spin tickets granted.${proRateNote}`,
  };
}
