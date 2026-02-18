import {
  type User,
  type InsertUser,
  type Prediction,
  type WheelSpin,
  type TapSession,
  type OtpCode,
  type Deposit,
  type Tier,
  type Transaction,
  type PoolAllocation,
  type JackpotVault,
  type UnclaimedFund,
  type Withdrawal,
  type DailyTap,
  type WithdrawalBatch,
  type SubscriptionAlert,
  type PaymentInvoice,
  users,
  tapSessions,
  predictions,
  wheelSpins,
  otpCodes,
  deposits,
  tiers,
  transactions,
  poolAllocations,
  jackpotVault,
  unclaimedFunds,
  withdrawals,
  dailyTaps,
  withdrawalBatches,
  subscriptionAlerts,
  paymentInvoices,
} from "@shared/schema";
import { eq, desc, sql, and, gt, lte, lt, or, inArray, sum } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

const pool = new pg.Pool({
  connectionString: process.env.PRODUCTION_DATABASE_URL || process.env.DATABASE_URL,
});

export const db = drizzle(pool);

export class DatabaseStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  async updateUser(id: string, data: Partial<User>): Promise<User | undefined> {
    const [user] = await db.update(users).set(data).where(eq(users.id, id)).returning();
    return user;
  }

  async atomicTap(id: string, coinsEarned: number, energyCost: number, lastEnergyRefill: Date): Promise<User | undefined> {
    const [user] = await db.update(users).set({
      totalCoins: sql`${users.totalCoins} + ${coinsEarned}`,
      energy: sql`GREATEST(0, ${users.energy} - ${energyCost})`,
      lastEnergyRefill,
    }).where(eq(users.id, id)).returning();
    return user;
  }

  async getTopUsersByCoins(limit = 20, tier?: string): Promise<User[]> {
    const conditions = tier ? [eq(users.tier, tier.toUpperCase())] : [];
    if (conditions.length > 0) {
      return db.select().from(users).where(and(...conditions)).orderBy(desc(users.totalCoins)).limit(limit);
    }
    return db.select().from(users).orderBy(desc(users.totalCoins)).limit(limit);
  }

  async getTopUsersByPredictions(limit = 20, tier?: string): Promise<User[]> {
    const conditions = tier ? [eq(users.tier, tier.toUpperCase())] : [];
    if (conditions.length > 0) {
      return db.select().from(users).where(and(...conditions)).orderBy(desc(users.correctPredictions)).limit(limit);
    }
    return db.select().from(users).orderBy(desc(users.correctPredictions)).limit(limit);
  }

  async getTopUsersByWheelWinnings(limit = 20, tier?: string): Promise<User[]> {
    const conditions = tier ? [eq(users.tier, tier.toUpperCase())] : [];
    if (conditions.length > 0) {
      return db.select().from(users).where(and(...conditions)).orderBy(desc(users.totalWheelWinnings)).limit(limit);
    }
    return db.select().from(users).orderBy(desc(users.totalWheelWinnings)).limit(limit);
  }

  async getActiveSubscribersByTier(tierName: string): Promise<User[]> {
    return db
      .select()
      .from(users)
      .where(
        and(
          eq(users.tier, tierName.toUpperCase()),
          gt(users.subscriptionExpiry, new Date())
        )
      );
  }

  async getSubscriberCountByTier(tierName: string): Promise<number> {
    const result = await this.getActiveSubscribersByTier(tierName);
    return result.length;
  }

  async createTapSession(data: { userId: string; taps: number; coinsEarned: number }): Promise<TapSession> {
    const [session] = await db.insert(tapSessions).values(data).returning();
    return session;
  }

  async createPrediction(data: { userId: string; prediction: string; btcPriceAtPrediction: number }): Promise<Prediction> {
    const [pred] = await db.insert(predictions).values(data).returning();
    return pred;
  }

  async getActivePrediction(userId: string): Promise<Prediction | undefined> {
    const [pred] = await db
      .select()
      .from(predictions)
      .where(and(eq(predictions.userId, userId), eq(predictions.resolved, false)));
    return pred;
  }

  async getUserPredictions(userId: string): Promise<Prediction[]> {
    return db
      .select()
      .from(predictions)
      .where(eq(predictions.userId, userId))
      .orderBy(desc(predictions.createdAt));
  }

  async getUnresolvedPredictions(): Promise<Prediction[]> {
    return db
      .select()
      .from(predictions)
      .where(eq(predictions.resolved, false));
  }

  async resolvePrediction(id: string, resolvedPrice: number, correct: boolean): Promise<void> {
    await db
      .update(predictions)
      .set({ resolved: true, correct, resolvedPrice, resolvedAt: new Date() })
      .where(eq(predictions.id, id));
  }

  async createWheelSpin(data: { userId: string; reward: number; sliceLabel: string }): Promise<WheelSpin> {
    const [spin] = await db.insert(wheelSpins).values(data).returning();
    return spin;
  }

  async getUserWheelHistory(userId: string): Promise<WheelSpin[]> {
    return db
      .select()
      .from(wheelSpins)
      .where(eq(wheelSpins.userId, userId))
      .orderBy(desc(wheelSpins.createdAt));
  }

  async createOtpCode(email: string, code: string, expiresAt: Date): Promise<OtpCode> {
    const [otp] = await db.insert(otpCodes).values({ email, code, expiresAt }).returning();
    return otp;
  }

  async getValidOtp(email: string, code: string): Promise<OtpCode | undefined> {
    const [otp] = await db
      .select()
      .from(otpCodes)
      .where(
        and(
          eq(otpCodes.email, email),
          eq(otpCodes.code, code),
          eq(otpCodes.used, false),
          gt(otpCodes.expiresAt, new Date())
        )
      );
    return otp;
  }

  async markOtpUsed(id: string): Promise<void> {
    await db.update(otpCodes).set({ used: true }).where(eq(otpCodes.id, id));
  }

  async createDeposit(data: { userId: string; amount: number; network: string; txHash?: string }): Promise<Deposit> {
    const [deposit] = await db.insert(deposits).values(data).returning();
    return deposit;
  }

  async getUserDeposits(userId: string): Promise<Deposit[]> {
    return db
      .select()
      .from(deposits)
      .where(eq(deposits.userId, userId))
      .orderBy(desc(deposits.createdAt));
  }

  async getDepositById(id: string): Promise<Deposit | undefined> {
    const [deposit] = await db.select().from(deposits).where(eq(deposits.id, id));
    return deposit;
  }

  async updateDeposit(id: string, data: Partial<Deposit>): Promise<Deposit | undefined> {
    const [deposit] = await db.update(deposits).set(data).where(eq(deposits.id, id)).returning();
    return deposit;
  }

  async getTier(name: string): Promise<Tier | undefined> {
    const [tier] = await db.select().from(tiers).where(eq(tiers.name, name));
    return tier;
  }

  async getAllTiers(): Promise<Tier[]> {
    return db.select().from(tiers);
  }

  async createTier(data: { name: string; price: string; dailyUnit: string; tapMultiplier: number }): Promise<Tier> {
    const [tier] = await db.insert(tiers).values(data).returning();
    return tier;
  }

  async createTransaction(data: {
    userId: string;
    txHash: string;
    tierName: string;
    totalAmount: string;
    adminAmount: string;
    treasuryAmount: string;
    adminWallet: string;
    treasuryWallet: string;
  }): Promise<Transaction> {
    const [tx] = await db.insert(transactions).values(data).returning();
    return tx;
  }

  async getTransactionByTxHash(txHash: string): Promise<Transaction | undefined> {
    const [tx] = await db.select().from(transactions).where(eq(transactions.txHash, txHash));
    return tx;
  }

  async getUserTransactions(userId: string): Promise<Transaction[]> {
    return db
      .select()
      .from(transactions)
      .where(eq(transactions.userId, userId))
      .orderBy(desc(transactions.createdAt));
  }

  async createPoolAllocation(data: {
    transactionId: string;
    tierName: string;
    game: string;
    totalAmount: string;
    dailyAmount: string;
    totalDays: number;
    dripType: string;
    depositDate: Date;
    expiryDate: Date;
  }): Promise<PoolAllocation> {
    const initialReleased = data.dripType === "instant" ? data.totalAmount : "0";
    const initialDays = data.dripType === "instant" ? data.totalDays : 0;
    const [alloc] = await db.insert(poolAllocations).values({
      ...data,
      amountReleased: initialReleased,
      daysReleased: initialDays,
    }).returning();
    return alloc;
  }

  async getActiveDripAllocations(): Promise<PoolAllocation[]> {
    const now = new Date();
    return db
      .select()
      .from(poolAllocations)
      .where(
        and(
          eq(poolAllocations.active, true),
          eq(poolAllocations.dripType, "daily"),
          gt(poolAllocations.expiryDate, now),
          lt(poolAllocations.daysReleased, poolAllocations.totalDays)
        )
      );
  }

  async updatePoolAllocation(id: string, data: Partial<PoolAllocation>): Promise<PoolAllocation | undefined> {
    const [alloc] = await db.update(poolAllocations).set(data).where(eq(poolAllocations.id, id)).returning();
    return alloc;
  }

  async getActivePoolAllocations(tierName: string, game: string): Promise<PoolAllocation[]> {
    const now = new Date();
    return db
      .select()
      .from(poolAllocations)
      .where(
        and(
          eq(poolAllocations.tierName, tierName.toUpperCase()),
          eq(poolAllocations.game, game),
          eq(poolAllocations.active, true),
          gt(poolAllocations.expiryDate, now)
        )
      );
  }

  async getReleasedPoolTotalByTierAndGame(tierName: string, game: string): Promise<number> {
    const allocations = await this.getActivePoolAllocations(tierName, game);
    return allocations.reduce((sum, a) => sum + parseFloat(a.amountReleased), 0);
  }

  async getReleasedPoolTotalByTier(tierName: string): Promise<{ tapPot: number; predictPot: number }> {
    const [tapPot, predictPot] = await Promise.all([
      this.getReleasedPoolTotalByTierAndGame(tierName, "tapPot"),
      this.getReleasedPoolTotalByTierAndGame(tierName, "predictPot"),
    ]);
    return { tapPot, predictPot };
  }

  async getExpiredActiveAllocations(): Promise<PoolAllocation[]> {
    const now = new Date();
    return db
      .select()
      .from(poolAllocations)
      .where(
        and(
          eq(poolAllocations.active, true),
          lte(poolAllocations.expiryDate, now)
        )
      );
  }

  async deactivateAllocation(id: string): Promise<void> {
    await db
      .update(poolAllocations)
      .set({ active: false })
      .where(eq(poolAllocations.id, id));
  }

  async getOrCreateJackpotVault(tierName: string): Promise<JackpotVault> {
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    const [existing] = await db
      .select()
      .from(jackpotVault)
      .where(
        and(
          eq(jackpotVault.tierName, tierName.toUpperCase()),
          eq(jackpotVault.monthKey, monthKey)
        )
      );

    if (existing) return existing;

    const [vault] = await db
      .insert(jackpotVault)
      .values({ tierName: tierName.toUpperCase(), totalBalance: "0", monthKey })
      .returning();
    return vault;
  }

  async addToJackpotVault(tierName: string, amount: number): Promise<JackpotVault> {
    const vault = await this.getOrCreateJackpotVault(tierName);
    const newBalance = parseFloat(vault.totalBalance) + amount;
    const [updated] = await db
      .update(jackpotVault)
      .set({ totalBalance: newBalance.toFixed(2), updatedAt: new Date() })
      .where(eq(jackpotVault.id, vault.id))
      .returning();
    return updated;
  }

  async getJackpotVaultBalance(tierName: string): Promise<number> {
    const vault = await this.getOrCreateJackpotVault(tierName);
    return parseFloat(vault.totalBalance);
  }

  async getAllJackpotVaults(): Promise<JackpotVault[]> {
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    return db
      .select()
      .from(jackpotVault)
      .where(eq(jackpotVault.monthKey, monthKey));
  }

  async createUnclaimedFund(data: {
    allocationId: string;
    tierName: string;
    game: string;
    amount: string;
    destination: string;
  }): Promise<UnclaimedFund> {
    const [fund] = await db.insert(unclaimedFunds).values(data).returning();
    return fund;
  }
  async createWithdrawal(data: {
    userId: string;
    grossAmount: string;
    feeAmount: string;
    netAmount: string;
    feePercent: string;
    toWallet: string;
    network?: string;
    tierAtTime?: string;
  }): Promise<Withdrawal> {
    const [withdrawal] = await db.insert(withdrawals).values(data).returning();
    return withdrawal;
  }

  async getWithdrawal(id: string): Promise<Withdrawal | undefined> {
    const [w] = await db.select().from(withdrawals).where(eq(withdrawals.id, id));
    return w;
  }

  async getUserWithdrawals(userId: string): Promise<Withdrawal[]> {
    return db
      .select()
      .from(withdrawals)
      .where(eq(withdrawals.userId, userId))
      .orderBy(desc(withdrawals.createdAt));
  }

  async updateWithdrawalStatus(id: string, status: string, txHash?: string): Promise<Withdrawal | undefined> {
    const updates: any = { status, processedAt: new Date() };
    if (txHash) updates.txHash = txHash;
    const [w] = await db.update(withdrawals).set(updates).where(eq(withdrawals.id, id)).returning();
    return w;
  }

  async getPendingWithdrawals(): Promise<Withdrawal[]> {
    return db
      .select()
      .from(withdrawals)
      .where(
        or(
          eq(withdrawals.status, "pending_audit"),
          eq(withdrawals.status, "flagged")
        )
      )
      .orderBy(desc(withdrawals.createdAt));
  }

  async getAdminPulse(): Promise<{
    totalRevenue: number;
    profitSwept: number;
    activeLiability: number;
    pendingWithdrawals: number;
    flaggedWithdrawals: number;
    totalUsers: number;
    activeSubscriptions: number;
  }> {
    const [revenueResult] = await db
      .select({ total: sql<string>`COALESCE(SUM(CAST(amount AS DECIMAL)), 0)` })
      .from(transactions)
      .where(eq(transactions.status, "confirmed"));
    const totalRevenue = parseFloat(revenueResult?.total || "0");

    const [adminResult] = await db
      .select({ total: sql<string>`COALESCE(SUM(CAST(admin_amount AS DECIMAL)), 0)` })
      .from(transactions)
      .where(eq(transactions.status, "confirmed"));
    const profitSwept = parseFloat(adminResult?.total || "0");

    const [liabilityResult] = await db
      .select({ total: sql<string>`COALESCE(SUM(wallet_balance), 0)` })
      .from(users);
    const activeLiability = parseFloat(liabilityResult?.total || "0");

    const pendingList = await db
      .select()
      .from(withdrawals)
      .where(eq(withdrawals.status, "pending_audit"));

    const flaggedList = await db
      .select()
      .from(withdrawals)
      .where(eq(withdrawals.status, "flagged"));

    const [userCount] = await db
      .select({ count: sql<string>`COUNT(*)` })
      .from(users);

    const [subCount] = await db
      .select({ count: sql<string>`COUNT(*)` })
      .from(users)
      .where(
        and(
          sql`${users.tier} != 'FREE'`,
          gt(users.subscriptionExpiry!, new Date())
        )
      );

    return {
      totalRevenue,
      profitSwept,
      activeLiability,
      pendingWithdrawals: pendingList.length,
      flaggedWithdrawals: flaggedList.length,
      totalUsers: parseInt(userCount?.count || "0"),
      activeSubscriptions: parseInt(subCount?.count || "0"),
    };
  }

  async upsertDailyTap(userId: string, taps: number, coins: number, tier: string): Promise<DailyTap> {
    const now = new Date();
    const dateKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}`;

    const [existing] = await db
      .select()
      .from(dailyTaps)
      .where(and(eq(dailyTaps.userId, userId), eq(dailyTaps.date, dateKey)));

    if (existing) {
      const [updated] = await db
        .update(dailyTaps)
        .set({
          tapsToday: existing.tapsToday + taps,
          coinsEarned: existing.coinsEarned + coins,
          tierAtTime: tier,
          updatedAt: now,
        })
        .where(eq(dailyTaps.id, existing.id))
        .returning();
      return updated;
    }

    const [created] = await db
      .insert(dailyTaps)
      .values({ userId, tapsToday: taps, coinsEarned: coins, tierAtTime: tier, date: dateKey })
      .returning();
    return created;
  }

  async getDailyTapsForDate(dateKey: string): Promise<DailyTap[]> {
    return db.select().from(dailyTaps).where(eq(dailyTaps.date, dateKey));
  }

  async getTotalDailyTaps(dateKey: string): Promise<number> {
    const [result] = await db
      .select({ total: sql<string>`COALESCE(SUM(taps_today), 0)` })
      .from(dailyTaps)
      .where(eq(dailyTaps.date, dateKey));
    return parseInt(result?.total || "0");
  }

  async truncateDailyTaps(dateKey: string): Promise<void> {
    await db.delete(dailyTaps).where(eq(dailyTaps.date, dateKey));
  }

  async getAllActiveSubscribers(): Promise<User[]> {
    return db
      .select()
      .from(users)
      .where(
        and(
          sql`${users.tier} != 'FREE'`,
          gt(users.subscriptionExpiry!, new Date())
        )
      );
  }

  async resetAllUserEnergy(): Promise<void> {
    await db
      .update(users)
      .set({ energy: users.maxEnergy, lastEnergyRefill: new Date() });
  }

  async getReadyWithdrawals(): Promise<Withdrawal[]> {
    return db
      .select()
      .from(withdrawals)
      .where(eq(withdrawals.status, "ready"))
      .orderBy(desc(withdrawals.createdAt));
  }

  async createWithdrawalBatch(data: {
    totalWithdrawals: number;
    totalGross: string;
    totalFees: string;
    totalNet: string;
    withdrawalIds: string;
  }): Promise<WithdrawalBatch> {
    const [batch] = await db.insert(withdrawalBatches).values(data).returning();
    return batch;
  }

  async createSubscriptionAlert(data: {
    userId: string;
    alertType: string;
  }): Promise<SubscriptionAlert> {
    const [alert] = await db.insert(subscriptionAlerts).values(data).returning();
    return alert;
  }

  async getExistingAlert(userId: string, alertType: string): Promise<SubscriptionAlert | undefined> {
    const [alert] = await db
      .select()
      .from(subscriptionAlerts)
      .where(
        and(
          eq(subscriptionAlerts.userId, userId),
          eq(subscriptionAlerts.alertType, alertType)
        )
      );
    return alert;
  }

  async getExpiringSubscriptions(hoursAhead: number): Promise<User[]> {
    const now = new Date();
    const futureDate = new Date(now.getTime() + hoursAhead * 60 * 60 * 1000);
    return db
      .select()
      .from(users)
      .where(
        and(
          sql`${users.tier} != 'FREE'`,
          gt(users.subscriptionExpiry!, now),
          lte(users.subscriptionExpiry!, futureDate)
        )
      );
  }

  async getExpiredSubscriptions(): Promise<User[]> {
    const now = new Date();
    return db
      .select()
      .from(users)
      .where(
        and(
          sql`${users.tier} != 'FREE'`,
          lte(users.subscriptionExpiry!, now)
        )
      );
  }

  async createPaymentInvoice(data: {
    invoiceId: string;
    userId: string;
    tierName: string;
    amount: string;
    currency?: string;
    paymentLink: string;
    network?: string;
    sandbox: boolean;
    splits: string;
    metadata?: string;
    expiresAt: Date;
  }): Promise<PaymentInvoice> {
    const [invoice] = await db.insert(paymentInvoices).values(data).returning();
    return invoice;
  }

  async getPaymentInvoiceById(id: string): Promise<PaymentInvoice | undefined> {
    const [invoice] = await db.select().from(paymentInvoices).where(eq(paymentInvoices.id, id));
    return invoice;
  }

  async getPaymentInvoiceByInvoiceId(invoiceId: string): Promise<PaymentInvoice | undefined> {
    const [invoice] = await db.select().from(paymentInvoices).where(eq(paymentInvoices.invoiceId, invoiceId));
    return invoice;
  }

  async updatePaymentInvoiceStatus(invoiceId: string, status: string, txHash?: string): Promise<PaymentInvoice | undefined> {
    const updates: any = { status };
    if (status === "paid") updates.paidAt = new Date();
    if (txHash) updates.txHash = txHash;
    const [invoice] = await db
      .update(paymentInvoices)
      .set(updates)
      .where(eq(paymentInvoices.invoiceId, invoiceId))
      .returning();
    return invoice;
  }

  async getUserPaymentInvoices(userId: string): Promise<PaymentInvoice[]> {
    return db
      .select()
      .from(paymentInvoices)
      .where(eq(paymentInvoices.userId, userId))
      .orderBy(desc(paymentInvoices.createdAt));
  }
}

export const storage = new DatabaseStorage();
