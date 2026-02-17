import {
  type User,
  type InsertUser,
  type Prediction,
  type WheelSpin,
  type TapSession,
  type OtpCode,
  users,
  tapSessions,
  predictions,
  wheelSpins,
  otpCodes,
} from "@shared/schema";
import { eq, desc, sql, and, gt } from "drizzle-orm";
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
}

export const storage = new DatabaseStorage();
