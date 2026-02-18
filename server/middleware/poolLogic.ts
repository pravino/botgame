import { storage } from "../storage";
import { log } from "../index";

const TIER_DAILY_UNITS: Record<string, number> = {
  FREE: 0,
  BRONZE: 0.10,
  SILVER: 0.30,
  GOLD: 1.00,
};

const MINIMUM_POOL_SEED = 1.00;

export interface TierPoolStatus {
  tierName: string;
  activeSubscribers: number;
  dailyUnit: number;
  dailyTotalPool: number;
  activeTreasuryPools: {
    tapPot: number;
    predictPot: number;
    wheelVault: number;
    total: number;
  };
  seeded: boolean;
}

export async function getActivePools(tierName: string): Promise<TierPoolStatus> {
  const normalizedTier = tierName.toUpperCase();
  const dailyUnit = TIER_DAILY_UNITS[normalizedTier] || 0;

  const activeSubscribers = await storage.getSubscriberCountByTier(normalizedTier);

  const dailyTotalPool = Math.max(activeSubscribers * dailyUnit, MINIMUM_POOL_SEED);
  const seeded = activeSubscribers * dailyUnit < MINIMUM_POOL_SEED;

  const { tapPot, predictPot, wheelVault } = await storage.getActivePoolTotalByTier(normalizedTier);

  return {
    tierName: normalizedTier,
    activeSubscribers,
    dailyUnit,
    dailyTotalPool,
    activeTreasuryPools: {
      tapPot,
      predictPot,
      wheelVault,
      total: tapPot + predictPot + wheelVault,
    },
    seeded,
  };
}

export async function getAllTierPools(): Promise<TierPoolStatus[]> {
  const tierNames = ["BRONZE", "SILVER", "GOLD"];
  return Promise.all(tierNames.map(getActivePools));
}

export async function expireStaleAllocations(): Promise<void> {
  try {
    await storage.expireOldAllocations();
    log("Pool allocations cleanup: expired stale 30-day allocations");
  } catch (error: any) {
    log(`Pool allocations cleanup error: ${error.message}`);
  }
}
