import { storage } from "../storage";
import { log } from "../index";

const ADMIN_SPLIT = 0.40;
const TREASURY_SPLIT = 0.60;

const POOL_SPLIT = {
  tapPot: 0.50,
  predictPot: 0.30,
  wheelVault: 0.20,
} as const;

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
    tapPot: number;
    predictPot: number;
    wheelVault: number;
  };
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

  log(`Transaction ${tx.id}: ${verifiedAmount} USDT split -> Admin: ${adminAmount} (${ADMIN_PROFITS_WALLET}), Treasury: ${treasuryAmount} (${GAME_TREASURY_WALLET})`);

  const now = new Date();
  const expiryDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const tapPotAmount = parseFloat((treasuryAmount * POOL_SPLIT.tapPot).toFixed(2));
  const predictPotAmount = parseFloat((treasuryAmount * POOL_SPLIT.predictPot).toFixed(2));
  const wheelVaultAmount = parseFloat((treasuryAmount * POOL_SPLIT.wheelVault).toFixed(2));

  await Promise.all([
    storage.createPoolAllocation({
      transactionId: tx.id,
      tierName: normalizedTier,
      game: "tapPot",
      amount: tapPotAmount.toFixed(2),
      depositDate: now,
      expiryDate,
    }),
    storage.createPoolAllocation({
      transactionId: tx.id,
      tierName: normalizedTier,
      game: "predictPot",
      amount: predictPotAmount.toFixed(2),
      depositDate: now,
      expiryDate,
    }),
    storage.createPoolAllocation({
      transactionId: tx.id,
      tierName: normalizedTier,
      game: "wheelVault",
      amount: wheelVaultAmount.toFixed(2),
      depositDate: now,
      expiryDate,
    }),
  ]);

  log(`Smart Ledger: Treasury ${treasuryAmount} USDT -> TapPot: ${tapPotAmount}, PredictPot: ${predictPotAmount}, WheelVault: ${wheelVaultAmount} (30-day window until ${expiryDate.toISOString()})`);

  const subscriberCount = await storage.getSubscriberCountByTier(normalizedTier);
  const founderLimit = FOUNDER_LIMITS[normalizedTier] || 100;
  const isFounder = subscriberCount <= founderLimit;

  const subscriptionExpiry = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  await storage.updateUser(userId, {
    tier: normalizedTier,
    subscriptionExpiry,
    isFounder: isFounder || undefined,
  });

  log(`User ${userId} activated ${normalizedTier} tier (Founder: ${isFounder}), expires ${subscriptionExpiry.toISOString()}`);

  return {
    success: true,
    tierName: normalizedTier,
    totalAmount: verifiedAmount,
    adminAmount,
    treasuryAmount,
    adminWallet: ADMIN_PROFITS_WALLET,
    treasuryWallet: GAME_TREASURY_WALLET,
    poolAllocations: {
      tapPot: tapPotAmount,
      predictPot: predictPotAmount,
      wheelVault: wheelVaultAmount,
    },
    isFounder,
    message: `${normalizedTier} Tier Activated! 40% ($${adminAmount}) -> Admin Wallet, 60% ($${treasuryAmount}) -> Game Treasury (50/30/20 split across pools, valid 30 days)`,
  };
}
