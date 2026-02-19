import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, boolean, timestamp, real, serial, decimal } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const tiers = pgTable("tiers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  price: decimal("price", { precision: 10, scale: 2 }).notNull().default("0"),
  dailyUnit: decimal("daily_unit", { precision: 10, scale: 2 }).notNull().default("0"),
  tapMultiplier: integer("tap_multiplier").notNull().default(1),
  energyRefillRateMs: integer("energy_refill_rate_ms").notNull().default(2000),
  freeRefillsPerDay: integer("free_refills_per_day").notNull().default(0),
  refillCooldownMs: integer("refill_cooldown_ms"),
});

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull(),
  email: text("email").notNull().unique(),
  totalCoins: integer("total_coins").notNull().default(0),
  energy: integer("energy").notNull().default(1000),
  maxEnergy: integer("max_energy").notNull().default(1000),
  lastEnergyRefill: timestamp("last_energy_refill").notNull().default(sql`now()`),
  spinsRemaining: integer("spins_remaining").notNull().default(1),
  spinTickets: integer("spin_tickets").notNull().default(0),
  spinTicketsExpiry: timestamp("spin_tickets_expiry"),
  totalSpins: integer("total_spins").notNull().default(0),
  correctPredictions: integer("correct_predictions").notNull().default(0),
  totalPredictions: integer("total_predictions").notNull().default(0),
  totalWheelWinnings: real("total_wheel_winnings").notNull().default(0),
  walletBalance: real("wallet_balance").notNull().default(0),
  tier: text("tier").notNull().default("FREE"),
  subscriptionExpiry: timestamp("subscription_expiry"),
  subscriptionStartedAt: timestamp("subscription_started_at"),
  isFounder: boolean("is_founder").notNull().default(false),
  tonWalletAddress: text("ton_wallet_address"),
  telegramId: text("telegram_id").unique(),
  telegramUsername: text("telegram_username"),
  telegramFirstName: text("telegram_first_name"),
  telegramPhotoUrl: text("telegram_photo_url"),
  cooldownUntil: timestamp("cooldown_until"),
  challengePending: boolean("challenge_pending").notNull().default(false),
  challengePausedUntil: timestamp("challenge_paused_until"),
  coinsSinceLastChallenge: integer("coins_since_last_challenge").notNull().default(0),
  lastFreeRefill: timestamp("last_free_refill"),
  dailyRefillsUsed: integer("daily_refills_used").notNull().default(0),
  tapMultiplier: integer("tap_multiplier").notNull().default(1),
});

export const otpCodes = pgTable("otp_codes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull(),
  code: text("code").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  used: boolean("used").notNull().default(false),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
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
  prediction: text("prediction").notNull(),
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

export const deposits = pgTable("deposits", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  amount: real("amount").notNull(),
  network: text("network").notNull(),
  txHash: text("tx_hash"),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  confirmedAt: timestamp("confirmed_at"),
});

export const transactions = pgTable("transactions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  txHash: text("tx_hash").notNull().unique(),
  tierName: text("tier_name").notNull(),
  totalAmount: decimal("total_amount", { precision: 10, scale: 2 }).notNull(),
  adminAmount: decimal("admin_amount", { precision: 10, scale: 2 }).notNull(),
  treasuryAmount: decimal("treasury_amount", { precision: 10, scale: 2 }).notNull(),
  adminWallet: text("admin_wallet").notNull(),
  treasuryWallet: text("treasury_wallet").notNull(),
  status: text("status").notNull().default("confirmed"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export const poolAllocations = pgTable("pool_allocations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  transactionId: varchar("transaction_id").notNull().references(() => transactions.id),
  tierName: text("tier_name").notNull(),
  game: text("game").notNull(),
  totalAmount: decimal("total_amount", { precision: 10, scale: 2 }).notNull(),
  dailyAmount: decimal("daily_amount", { precision: 10, scale: 4 }).notNull().default("0"),
  totalDays: integer("total_days").notNull().default(30),
  daysReleased: integer("days_released").notNull().default(0),
  amountReleased: decimal("amount_released", { precision: 10, scale: 2 }).notNull().default("0"),
  dripType: text("drip_type").notNull().default("daily"),
  lastDripDate: timestamp("last_drip_date"),
  depositDate: timestamp("deposit_date").notNull().default(sql`now()`),
  expiryDate: timestamp("expiry_date").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export const jackpotVault = pgTable("jackpot_vault", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tierName: text("tier_name").notNull(),
  totalBalance: decimal("total_balance", { precision: 10, scale: 2 }).notNull().default("0"),
  monthKey: text("month_key").notNull(),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
});

export const unclaimedFunds = pgTable("unclaimed_funds", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  allocationId: varchar("allocation_id").notNull().references(() => poolAllocations.id),
  tierName: text("tier_name").notNull(),
  game: text("game").notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  destination: text("destination").notNull().default("admin"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export const withdrawals = pgTable("withdrawals", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  grossAmount: decimal("gross_amount", { precision: 12, scale: 4 }).notNull(),
  feeAmount: decimal("fee_amount", { precision: 12, scale: 4 }).notNull(),
  netAmount: decimal("net_amount", { precision: 12, scale: 4 }).notNull(),
  feePercent: decimal("fee_percent", { precision: 5, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("USDT"),
  toWallet: text("to_wallet").notNull(),
  network: text("network").notNull().default("TON"),
  txHash: text("tx_hash"),
  status: text("status").notNull().default("pending"),
  tierAtTime: text("tier_at_time"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  processedAt: timestamp("processed_at"),
});

export const userLedger = pgTable("user_ledger", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  entryType: text("entry_type").notNull(),
  direction: text("direction").notNull(),
  amount: decimal("amount", { precision: 12, scale: 4 }).notNull(),
  currency: text("currency").notNull().default("COINS"),
  balanceBefore: decimal("balance_before", { precision: 12, scale: 4 }).notNull(),
  balanceAfter: decimal("balance_after", { precision: 12, scale: 4 }).notNull(),
  game: text("game"),
  refId: text("ref_id"),
  tierAtTime: text("tier_at_time"),
  note: text("note"),
  prevHash: text("prev_hash"),
  entryHash: text("entry_hash").notNull(),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export const dailyTaps = pgTable("daily_taps", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  tapsToday: integer("taps_today").notNull().default(0),
  coinsEarned: integer("coins_earned").notNull().default(0),
  tierAtTime: text("tier_at_time").notNull().default("FREE"),
  date: text("date").notNull(),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
});

export const withdrawalBatches = pgTable("withdrawal_batches", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  totalWithdrawals: integer("total_withdrawals").notNull().default(0),
  totalGross: decimal("total_gross", { precision: 12, scale: 4 }).notNull().default("0"),
  totalFees: decimal("total_fees", { precision: 12, scale: 4 }).notNull().default("0"),
  totalNet: decimal("total_net", { precision: 12, scale: 4 }).notNull().default("0"),
  status: text("status").notNull().default("pending"),
  withdrawalIds: text("withdrawal_ids").notNull().default("[]"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  processedAt: timestamp("processed_at"),
});

export const subscriptionAlerts = pgTable("subscription_alerts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  alertType: text("alert_type").notNull(),
  telegramSent: boolean("telegram_sent").notNull().default(false),
  actionTaken: boolean("action_taken").notNull().default(false),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export const paymentInvoices = pgTable("payment_invoices", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  invoiceId: text("invoice_id").notNull().unique(),
  userId: varchar("user_id").notNull().references(() => users.id),
  tierName: text("tier_name").notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("USDT"),
  status: text("status").notNull().default("pending"),
  paymentLink: text("payment_link").notNull(),
  txHash: text("tx_hash"),
  network: text("network").notNull().default("TON"),
  sandbox: boolean("sandbox").notNull().default(false),
  splits: text("splits").notNull().default("[]"),
  metadata: text("metadata"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  paidAt: timestamp("paid_at"),
  expiresAt: timestamp("expires_at").notNull(),
});

export const insertPaymentInvoiceSchema = createInsertSchema(paymentInvoices).omit({
  id: true,
  createdAt: true,
});

export type PaymentInvoice = typeof paymentInvoices.$inferSelect;
export type InsertPaymentInvoice = z.infer<typeof insertPaymentInvoiceSchema>;

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  email: true,
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
export type OtpCode = typeof otpCodes.$inferSelect;
export type TapSession = typeof tapSessions.$inferSelect;
export type Prediction = typeof predictions.$inferSelect;
export type WheelSpin = typeof wheelSpins.$inferSelect;
export type Deposit = typeof deposits.$inferSelect;
export type Tier = typeof tiers.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type PoolAllocation = typeof poolAllocations.$inferSelect;
export type JackpotVault = typeof jackpotVault.$inferSelect;
export type UnclaimedFund = typeof unclaimedFunds.$inferSelect;
export type UserLedgerEntry = typeof userLedger.$inferSelect;
export type Withdrawal = typeof withdrawals.$inferSelect;
export type DailyTap = typeof dailyTaps.$inferSelect;
export type WithdrawalBatch = typeof withdrawalBatches.$inferSelect;
export type SubscriptionAlert = typeof subscriptionAlerts.$inferSelect;
