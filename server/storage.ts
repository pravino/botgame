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
  users,
  tapSessions,
  predictions,
  wheelSpins,
  otpCodes,
  deposits,
  tiers,
  transactions,
  poolAllocations,
} from "@shared/schema";
import { eq, desc, sql, and, gt, lte } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

const pool = new pg.Pool({
  connectionString: process.env.PRODUCTION_DATABASE_URL || process.env.DATABASE_URL,
});

export const db = drizzle(pool);

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: string, data: Partial<User>): Promise<User | undefined>;
  getTopUsersByCoins(limit?: number): Promise<User[]>;
  getTopUsersByPredictions(limit?: number): Promise<User[]>;
  getTopUsersByWheelWinnings(limit?: number): Promise<User[]>;
  getActiveSubscribersByTier(tierName: string): Promise<User[]>;
  getSubscriberCountByTier(tierName: string): Promise<number>;
  createTapSession(data: { userId: string; taps: number; coinsEarned: number }): Promise<TapSession>;
  createPrediction(data: { userId: string; prediction: string; btcPriceAtPrediction: number }): Promise<Prediction>;
  getActivePrediction(userId: string): Promise<Prediction | undefined>;
  getUserPredictions(userId: string): Promise<Prediction[]>;
  getUnresolvedPredictions(): Promise<Prediction[]>;
  resolvePrediction(id: string, resolvedPrice: number, correct: boolean): Promise<void>;
  createWheelSpin(data: { userId: string; reward: number; sliceLabel: string }): Promise<WheelSpin>;
  getUserWheelHistory(userId: string): Promise<WheelSpin[]>;
  createOtpCode(email: string, code: string, expiresAt: Date): Promise<OtpCode>;
  getValidOtp(email: string, code: string): Promise<OtpCode | undefined>;
  markOtpUsed(id: string): Promise<void>;
  createDeposit(data: { userId: string; amount: number; network: string; txHash?: string }): Promise<Deposit>;
  getUserDeposits(userId: string): Promise<Deposit[]>;
  getDepositById(id: string): Promise<Deposit | undefined>;
  updateDeposit(id: string, data: Partial<Deposit>): Promise<Deposit | undefined>;
  getTier(name: string): Promise<Tier | undefined>;
  getAllTiers(): Promise<Tier[]>;
  createTier(data: { name: string; price: string; dailyUnit: string; tapMultiplier: number }): Promise<Tier>;
  getTransactionByTxHash(txHash: string): Promise<Transaction | undefined>;
  createTransaction(data: {
    userId: string;
    txHash: string;
    tierName: string;
    totalAmount: string;
    adminAmount: string;
    treasuryAmount: string;
    adminWallet: string;
    treasuryWallet: string;
  }): Promise<Transaction>;
  getUserTransactions(userId: string): Promise<Transaction[]>;
  createPoolAllocation(data: {
    transactionId: string;
    tierName: string;
    game: string;
    amount: string;
    depositDate: Date;
    expiryDate: Date;
  }): Promise<PoolAllocation>;
  getActivePoolAllocations(tierName: string, game: string): Promise<PoolAllocation[]>;
  getActivePoolTotalByTierAndGame(tierName: string, game: string): Promise<number>;
  getActivePoolTotalByTier(tierName: string): Promise<{ tapPot: number; predictPot: number; wheelVault: number }>;
  expireOldAllocations(): Promise<void>;
}

export class DatabaseStorage implements IStorage {
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

  async getTopUsersByCoins(limit = 20): Promise<User[]> {
    return db.select().from(users).orderBy(desc(users.totalCoins)).limit(limit);
  }

  async getTopUsersByPredictions(limit = 20): Promise<User[]> {
    return db.select().from(users).orderBy(desc(users.correctPredictions)).limit(limit);
  }

  async getTopUsersByWheelWinnings(limit = 20): Promise<User[]> {
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
    amount: string;
    depositDate: Date;
    expiryDate: Date;
  }): Promise<PoolAllocation> {
    const [alloc] = await db.insert(poolAllocations).values(data).returning();
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

  async getActivePoolTotalByTierAndGame(tierName: string, game: string): Promise<number> {
    const allocations = await this.getActivePoolAllocations(tierName, game);
    return allocations.reduce((sum, a) => sum + parseFloat(a.amount), 0);
  }

  async getActivePoolTotalByTier(tierName: string): Promise<{ tapPot: number; predictPot: number; wheelVault: number }> {
    const [tapPot, predictPot, wheelVault] = await Promise.all([
      this.getActivePoolTotalByTierAndGame(tierName, "tapPot"),
      this.getActivePoolTotalByTierAndGame(tierName, "predictPot"),
      this.getActivePoolTotalByTierAndGame(tierName, "wheelVault"),
    ]);
    return { tapPot, predictPot, wheelVault };
  }

  async expireOldAllocations(): Promise<void> {
    const now = new Date();
    await db
      .update(poolAllocations)
      .set({ active: false })
      .where(
        and(
          eq(poolAllocations.active, true),
          lte(poolAllocations.expiryDate, now)
        )
      );
  }
}

export const storage = new DatabaseStorage();
