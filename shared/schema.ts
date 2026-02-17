import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, boolean, timestamp, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  totalCoins: integer("total_coins").notNull().default(0),
  energy: integer("energy").notNull().default(1000),
  maxEnergy: integer("max_energy").notNull().default(1000),
  lastEnergyRefill: timestamp("last_energy_refill").notNull().default(sql`now()`),
  spinsRemaining: integer("spins_remaining").notNull().default(1),
  totalSpins: integer("total_spins").notNull().default(0),
  correctPredictions: integer("correct_predictions").notNull().default(0),
  totalPredictions: integer("total_predictions").notNull().default(0),
  totalWheelWinnings: real("total_wheel_winnings").notNull().default(0),
});

export const tapSessions = pgTable("tap_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  taps: integer("taps").notNull(),
  coinsEarned: integer("coins_earned").notNull(),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export const predictions = pgTable("predictions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  prediction: text("prediction").notNull(), // 'higher' or 'lower'
  btcPriceAtPrediction: real("btc_price_at_prediction").notNull(),
  resolvedPrice: real("resolved_price"),
  resolved: boolean("resolved").notNull().default(false),
  correct: boolean("correct"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  resolvedAt: timestamp("resolved_at"),
});

export const wheelSpins = pgTable("wheel_spins", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  reward: real("reward").notNull(),
  sliceLabel: text("slice_label").notNull(),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
});

export const insertTapSessionSchema = createInsertSchema(tapSessions).pick({
  userId: true,
  taps: true,
  coinsEarned: true,
});

export const insertPredictionSchema = createInsertSchema(predictions).pick({
  userId: true,
  prediction: true,
  btcPriceAtPrediction: true,
});

export const insertWheelSpinSchema = createInsertSchema(wheelSpins).pick({
  userId: true,
  reward: true,
  sliceLabel: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type TapSession = typeof tapSessions.$inferSelect;
export type Prediction = typeof predictions.$inferSelect;
export type WheelSpin = typeof wheelSpins.$inferSelect;
