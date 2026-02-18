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
  releasedPools: {
    tapPot: number;
    predictPot: number;
    total: number;
  };
  jackpotVault: number;
  seeded: boolean;
}

export async function getActivePools(tierName: string): Promise<TierPoolStatus> {
  const normalizedTier = tierName.toUpperCase();
  const dailyUnit = TIER_DAILY_UNITS[normalizedTier] || 0;

  const activeSubscribers = await storage.getSubscriberCountByTier(normalizedTier);

  const dailyTotalPool = Math.max(activeSubscribers * dailyUnit, MINIMUM_POOL_SEED);
  const seeded = activeSubscribers * dailyUnit < MINIMUM_POOL_SEED;

  const { tapPot, predictPot } = await storage.getReleasedPoolTotalByTier(normalizedTier);
  const jackpotBalance = await storage.getJackpotVaultBalance(normalizedTier);

  return {
    tierName: normalizedTier,
    activeSubscribers,
    dailyUnit,
    dailyTotalPool,
    releasedPools: {
      tapPot,
      predictPot,
      total: tapPot + predictPot,
    },
    jackpotVault: jackpotBalance,
    seeded,
  };
}

export async function getAllTierPools(): Promise<TierPoolStatus[]> {
  const tierNames = ["BRONZE", "SILVER", "GOLD"];
  return Promise.all(tierNames.map(getActivePools));
}

export async function processDailyDrip(): Promise<void> {
  try {
    const dripAllocations = await storage.getActiveDripAllocations();
    const now = new Date();
    const todayKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
    let totalDripped = 0;

    for (const alloc of dripAllocations) {
      if (alloc.daysReleased >= alloc.totalDays) continue;

      const lastDrip = alloc.lastDripDate;
      if (lastDrip) {
        const lastDripKey = `${lastDrip.getFullYear()}-${lastDrip.getMonth()}-${lastDrip.getDate()}`;
        if (lastDripKey === todayKey) continue;
      }

      const depositDate = new Date(alloc.depositDate);
      const daysSinceDeposit = Math.floor((now.getTime() - depositDate.getTime()) / (24 * 60 * 60 * 1000));
      const daysToRelease = Math.min(daysSinceDeposit + 1, alloc.totalDays) - alloc.daysReleased;

      if (daysToRelease <= 0) continue;

      const dailyAmt = parseFloat(alloc.dailyAmount);
      const dripAmount = parseFloat((dailyAmt * daysToRelease).toFixed(2));
      const newAmountReleased = parseFloat((parseFloat(alloc.amountReleased) + dripAmount).toFixed(2));
      const totalAmount = parseFloat(alloc.totalAmount);
      const cappedReleased = Math.min(newAmountReleased, totalAmount);

      await storage.updatePoolAllocation(alloc.id, {
        daysReleased: alloc.daysReleased + daysToRelease,
        amountReleased: cappedReleased.toFixed(2),
        lastDripDate: now,
      });

      totalDripped += dripAmount;
    }

    if (totalDripped > 0) {
      log(`Daily Drip: Released $${totalDripped.toFixed(2)} across ${dripAllocations.length} allocations`);
    }
  } catch (error: any) {
    log(`Daily Drip error: ${error.message}`);
  }
}

export async function processExpiredAllocations(): Promise<void> {
  try {
    const expired = await storage.getExpiredActiveAllocations();
    let totalRecaptured = 0;

    for (const alloc of expired) {
      const totalAmount = parseFloat(alloc.totalAmount);
      const amountReleased = parseFloat(alloc.amountReleased);
      const unclaimed = parseFloat((totalAmount - amountReleased).toFixed(2));

      if (unclaimed > 0 && alloc.dripType === "daily") {
        await storage.createUnclaimedFund({
          allocationId: alloc.id,
          tierName: alloc.tierName,
          game: alloc.game,
          amount: unclaimed.toFixed(2),
          destination: "admin",
        });
        totalRecaptured += unclaimed;
        log(`Recaptured $${unclaimed} from expired ${alloc.game} drip allocation (${alloc.tierName})`);
      }

      if (alloc.dripType === "instant" && alloc.game === "wheelVault") {
        log(`WheelVault allocation ${alloc.id} expired — $${totalAmount} stays in Jackpot Vault (${alloc.tierName})`);
      }

      await storage.deactivateAllocation(alloc.id);
    }

    if (totalRecaptured > 0) {
      log(`Expiry cleanup: Recaptured $${totalRecaptured.toFixed(2)} in unclaimed drip funds`);
    }
  } catch (error: any) {
    log(`Expiry cleanup error: ${error.message}`);
  }
}

export async function processExpiredSpinTickets(): Promise<void> {
  try {
    const { eq, and, lte, gt } = await import("drizzle-orm");
    const { users } = await import("@shared/schema");
    const { db } = await import("../storage");

    const now = new Date();
    const expiredTicketUsers = await db
      .select()
      .from(users)
      .where(
        and(
          gt(users.spinTickets, 0),
          lte(users.spinTicketsExpiry, now)
        )
      );

    for (const user of expiredTicketUsers) {
      log(`User ${user.id}: ${user.spinTickets} unused spin tickets expired (${user.tier}). Tickets forfeited, funds stay in Jackpot Vault.`);
      await db
        .update(users)
        .set({ spinTickets: 0 })
        .where(eq(users.id, user.id));
    }

    if (expiredTicketUsers.length > 0) {
      log(`Spin ticket cleanup: ${expiredTicketUsers.length} users had unused tickets expired`);
    }
  } catch (error: any) {
    log(`Spin ticket cleanup error: ${error.message}`);
  }
}

export async function expireStaleAllocations(): Promise<void> {
  await processExpiredAllocations();
  await processExpiredSpinTickets();
}
