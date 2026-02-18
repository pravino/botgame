import { storage } from "../storage";
import { log } from "../index";
import { recordLedgerEntry } from "./ledger";

const ADMIN_SPLIT = 0.40;
const TREASURY_SPLIT = 0.60;

const POOL_SPLIT = {
  tapPot: 0.50,
  predictPot: 0.30,
  wheelVault: 0.20,
} as const;

const DRIP_DAYS = 30;
const SPIN_TICKETS_PER_SUBSCRIPTION = 4;

const ADMIN_PROFITS_WALLET = process.env.ADMIN_PROFITS_WALLET || "UQAdminWalletPlaceholder";
const GAME_TREASURY_WALLET = process.env.GAME_TREASURY_WALLET || "UQTreasuryWalletPlaceholder";

const TIER_PRICES: Record<string, number> = {
  BRONZE: 5.00,
  SILVER: 15.00,
  GOLD: 50.00,
};

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
  message: string;
}

export async function processSubscriptionPayment(
  userId: string,
  txHash: string,
  tierName: string,
  verifiedAmount: number
): Promise<SplitResult> {
  const normalizedTier = tierName.toUpperCase();

  const expectedPrice = TIER_PRICES[normalizedTier];
  if (!expectedPrice) {
    throw new Error(`Invalid tier: ${tierName}. Must be BRONZE, SILVER, or GOLD.`);
  }

  if (Math.abs(verifiedAmount - expectedPrice) > 0.01) {
    throw new Error(
      `Payment amount ${verifiedAmount} does not match ${normalizedTier} tier price of ${expectedPrice} USDT`
    );
  }

  const adminAmount = parseFloat((verifiedAmount * ADMIN_SPLIT).toFixed(2));
  const treasuryAmount = parseFloat((verifiedAmount * TREASURY_SPLIT).toFixed(2));

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

  log(`Transaction ${tx.id}: ${verifiedAmount} USDT -> Admin: $${adminAmount} (${ADMIN_PROFITS_WALLET}), Treasury: $${treasuryAmount} (${GAME_TREASURY_WALLET})`);

  const now = new Date();
  const expiryDate = new Date(now.getTime() + DRIP_DAYS * 24 * 60 * 60 * 1000);

  const tapPotTotal = parseFloat((treasuryAmount * POOL_SPLIT.tapPot).toFixed(2));
  const predictPotTotal = parseFloat((treasuryAmount * POOL_SPLIT.predictPot).toFixed(2));
  const wheelVaultTotal = parseFloat((treasuryAmount * POOL_SPLIT.wheelVault).toFixed(2));

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

  const subscriptionExpiry = new Date(now.getTime() + DRIP_DAYS * 24 * 60 * 60 * 1000);
  await storage.updateUser(userId, {
    tier: normalizedTier,
    subscriptionExpiry,
    isFounder: isFounder || undefined,
    spinTickets: SPIN_TICKETS_PER_SUBSCRIPTION,
    spinTicketsExpiry: expiryDate,
  });

  log(`User ${userId}: ${normalizedTier} tier activated (Founder: ${isFounder}), ${SPIN_TICKETS_PER_SUBSCRIPTION} spin tickets granted, expires ${subscriptionExpiry.toISOString()}`);

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
    amount: SPIN_TICKETS_PER_SUBSCRIPTION,
    currency: "TICKETS",
    balanceBefore: 0,
    balanceAfter: SPIN_TICKETS_PER_SUBSCRIPTION,
    game: "wheelVault",
    refId: tx.id,
    note: `${SPIN_TICKETS_PER_SUBSCRIPTION} spin tickets granted with ${normalizedTier} subscription`,
  });

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
    spinTickets: SPIN_TICKETS_PER_SUBSCRIPTION,
    isFounder,
    message: `${normalizedTier} Tier Activated! $${adminAmount} -> Admin Wallet, $${treasuryAmount} -> Game Treasury. TapPot drips $${tapPotDaily}/day, PredictPot drips $${predictPotDaily}/day, WheelVault $${wheelVaultTotal} instant to Jackpot. ${SPIN_TICKETS_PER_SUBSCRIPTION} spin tickets granted (1/week).`,
  };
}
