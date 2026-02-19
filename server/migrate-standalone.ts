import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import path from "path";
async function runStandaloneMigration() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL environment variable is required");
    process.exit(1);
  }

  console.log("Connecting to database...");
  const pool = new pg.Pool({
    connectionString,
    ssl: connectionString.includes("railway.app") || connectionString.includes("neon.tech")
      ? { rejectUnauthorized: false }
      : undefined,
  });

  try {
    await pool.query("SELECT 1");
    console.log("Database connection successful");
  } catch (err) {
    console.error("Failed to connect to database:", err);
    process.exit(1);
  }

  const migrationsPath = path.resolve(process.cwd(), "migrations");

  console.log("Running baseline sync...");
  await baselineSync(pool);

  console.log("Marking baseline migrations as applied...");
  await markBaselineMigrationApplied(pool, migrationsPath);

  console.log("Running Drizzle migrations...");
  const db = drizzle(pool);
  await migrate(db, { migrationsFolder: migrationsPath });

  console.log("All migrations completed successfully!");
  await pool.end();
  process.exit(0);
}

async function markBaselineMigrationApplied(pool: pg.Pool, migrationsPath: string) {
  await pool.query(`CREATE SCHEMA IF NOT EXISTS "drizzle"`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `);

  const fs = await import("fs");
  const journalPath = path.join(migrationsPath, "meta", "_journal.json");
  const journal = JSON.parse(fs.readFileSync(journalPath, "utf-8"));

  for (const entry of journal.entries) {
    const exists = await pool.query(
      `SELECT 1 FROM "drizzle"."__drizzle_migrations" WHERE hash = $1`,
      [entry.tag]
    );
    if (exists.rows.length === 0) {
      await pool.query(
        `INSERT INTO "drizzle"."__drizzle_migrations" (hash, created_at) VALUES ($1, $2)`,
        [entry.tag, entry.when ?? Date.now()]
      );
      console.log(`  Marked migration "${entry.tag}" as applied`);
    }
  }
}

async function baselineSync(pool: pg.Pool) {
  const statements = [
    `CREATE TABLE IF NOT EXISTS "tiers" (
      "id" serial PRIMARY KEY NOT NULL,
      "name" text NOT NULL,
      "price" numeric(10, 2) DEFAULT '0' NOT NULL,
      "daily_unit" numeric(10, 2) DEFAULT '0' NOT NULL,
      "tap_multiplier" integer DEFAULT 1 NOT NULL,
      "energy_refill_rate_ms" integer DEFAULT 2000 NOT NULL,
      "free_refills_per_day" integer DEFAULT 0 NOT NULL,
      "refill_cooldown_ms" integer
    )`,
    `CREATE TABLE IF NOT EXISTS "users" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "username" text NOT NULL,
      "email" text NOT NULL,
      "total_coins" integer DEFAULT 0 NOT NULL,
      "energy" integer DEFAULT 1000 NOT NULL,
      "max_energy" integer DEFAULT 1000 NOT NULL,
      "last_energy_refill" timestamp DEFAULT now() NOT NULL,
      "spins_remaining" integer DEFAULT 1 NOT NULL,
      "spin_tickets" integer DEFAULT 0 NOT NULL,
      "spin_tickets_expiry" timestamp,
      "total_spins" integer DEFAULT 0 NOT NULL,
      "correct_predictions" integer DEFAULT 0 NOT NULL,
      "total_predictions" integer DEFAULT 0 NOT NULL,
      "total_wheel_winnings" real DEFAULT 0 NOT NULL,
      "wallet_balance" real DEFAULT 0 NOT NULL,
      "tier" text DEFAULT 'FREE' NOT NULL,
      "subscription_expiry" timestamp,
      "subscription_started_at" timestamp,
      "is_founder" boolean DEFAULT false NOT NULL,
      "ton_wallet_address" text,
      "telegram_id" text,
      "telegram_username" text,
      "telegram_first_name" text,
      "telegram_photo_url" text,
      "cooldown_until" timestamp,
      "challenge_pending" boolean DEFAULT false NOT NULL,
      "challenge_paused_until" timestamp,
      "coins_since_last_challenge" integer DEFAULT 0 NOT NULL,
      "last_free_refill" timestamp,
      "daily_refills_used" integer DEFAULT 0 NOT NULL,
      "tap_multiplier" integer DEFAULT 1 NOT NULL,
      "league" text DEFAULT 'BRONZE' NOT NULL,
      CONSTRAINT "users_email_unique" UNIQUE("email"),
      CONSTRAINT "users_telegram_id_unique" UNIQUE("telegram_id")
    )`,
    `CREATE TABLE IF NOT EXISTS "otp_codes" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "email" text NOT NULL,
      "code" text NOT NULL,
      "expires_at" timestamp NOT NULL,
      "used" boolean DEFAULT false NOT NULL,
      "created_at" timestamp DEFAULT now() NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS "tap_sessions" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "user_id" varchar NOT NULL,
      "taps" integer NOT NULL,
      "coins_earned" integer NOT NULL,
      "created_at" timestamp DEFAULT now() NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS "predictions" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "user_id" varchar NOT NULL,
      "prediction" text NOT NULL,
      "btc_price_at_prediction" real NOT NULL,
      "resolved_price" real,
      "resolved" boolean DEFAULT false NOT NULL,
      "correct" boolean,
      "created_at" timestamp DEFAULT now() NOT NULL,
      "resolved_at" timestamp
    )`,
    `CREATE TABLE IF NOT EXISTS "wheel_spins" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "user_id" varchar NOT NULL,
      "reward" real NOT NULL,
      "slice_label" text NOT NULL,
      "created_at" timestamp DEFAULT now() NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS "deposits" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "user_id" varchar NOT NULL,
      "amount" real NOT NULL,
      "network" text NOT NULL,
      "tx_hash" text,
      "status" text DEFAULT 'pending' NOT NULL,
      "created_at" timestamp DEFAULT now() NOT NULL,
      "confirmed_at" timestamp
    )`,
    `CREATE TABLE IF NOT EXISTS "session" (
      "sid" varchar NOT NULL PRIMARY KEY,
      "sess" json NOT NULL,
      "expire" timestamp(6) NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS "transactions" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "user_id" varchar NOT NULL,
      "tx_hash" text NOT NULL,
      "tier_name" text NOT NULL,
      "total_amount" numeric(10, 2) NOT NULL,
      "admin_amount" numeric(10, 2) NOT NULL,
      "treasury_amount" numeric(10, 2) NOT NULL,
      "admin_wallet" text NOT NULL,
      "treasury_wallet" text NOT NULL,
      "status" text DEFAULT 'confirmed' NOT NULL,
      "created_at" timestamp DEFAULT now() NOT NULL,
      CONSTRAINT "transactions_tx_hash_unique" UNIQUE("tx_hash")
    )`,
    `CREATE TABLE IF NOT EXISTS "pool_allocations" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "transaction_id" varchar NOT NULL,
      "tier_name" text NOT NULL,
      "game" text NOT NULL,
      "total_amount" numeric(10, 2) NOT NULL,
      "daily_amount" numeric(10, 4) DEFAULT '0' NOT NULL,
      "total_days" integer DEFAULT 30 NOT NULL,
      "days_released" integer DEFAULT 0 NOT NULL,
      "amount_released" numeric(10, 2) DEFAULT '0' NOT NULL,
      "drip_type" text DEFAULT 'daily' NOT NULL,
      "last_drip_date" timestamp,
      "deposit_date" timestamp DEFAULT now() NOT NULL,
      "expiry_date" timestamp NOT NULL,
      "active" boolean DEFAULT true NOT NULL,
      "created_at" timestamp DEFAULT now() NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS "jackpot_vault" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "tier_name" text NOT NULL,
      "total_balance" numeric(10, 2) DEFAULT '0' NOT NULL,
      "month_key" text NOT NULL,
      "created_at" timestamp DEFAULT now() NOT NULL,
      "updated_at" timestamp DEFAULT now() NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS "unclaimed_funds" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "allocation_id" varchar NOT NULL,
      "tier_name" text NOT NULL,
      "game" text NOT NULL,
      "amount" numeric(10, 2) NOT NULL,
      "destination" text DEFAULT 'admin' NOT NULL,
      "created_at" timestamp DEFAULT now() NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS "withdrawals" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "user_id" varchar NOT NULL,
      "gross_amount" numeric(12, 4) NOT NULL,
      "fee_amount" numeric(12, 4) NOT NULL,
      "net_amount" numeric(12, 4) NOT NULL,
      "fee_percent" numeric(5, 2) NOT NULL,
      "currency" text DEFAULT 'USDT' NOT NULL,
      "to_wallet" text NOT NULL,
      "network" text DEFAULT 'TON' NOT NULL,
      "tx_hash" text,
      "status" text DEFAULT 'pending' NOT NULL,
      "tier_at_time" text,
      "created_at" timestamp DEFAULT now() NOT NULL,
      "processed_at" timestamp
    )`,
    `CREATE TABLE IF NOT EXISTS "user_ledger" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "user_id" varchar NOT NULL,
      "entry_type" text NOT NULL,
      "direction" text NOT NULL,
      "amount" numeric(12, 4) NOT NULL,
      "currency" text DEFAULT 'COINS' NOT NULL,
      "balance_before" numeric(12, 4) NOT NULL,
      "balance_after" numeric(12, 4) NOT NULL,
      "game" text,
      "ref_id" text,
      "tier_at_time" text,
      "note" text,
      "prev_hash" text,
      "entry_hash" text NOT NULL,
      "created_at" timestamp DEFAULT now() NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS "daily_taps" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "user_id" varchar NOT NULL,
      "taps_today" integer DEFAULT 0 NOT NULL,
      "coins_earned" integer DEFAULT 0 NOT NULL,
      "tier_at_time" text DEFAULT 'FREE' NOT NULL,
      "date" text NOT NULL,
      "created_at" timestamp DEFAULT now() NOT NULL,
      "updated_at" timestamp DEFAULT now() NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS "withdrawal_batches" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "total_withdrawals" integer DEFAULT 0 NOT NULL,
      "total_gross" numeric(12, 4) DEFAULT '0' NOT NULL,
      "total_fees" numeric(12, 4) DEFAULT '0' NOT NULL,
      "total_net" numeric(12, 4) DEFAULT '0' NOT NULL,
      "status" text DEFAULT 'pending' NOT NULL,
      "withdrawal_ids" text DEFAULT '[]' NOT NULL,
      "created_at" timestamp DEFAULT now() NOT NULL,
      "processed_at" timestamp
    )`,
    `CREATE TABLE IF NOT EXISTS "subscription_alerts" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "user_id" varchar NOT NULL,
      "alert_type" text NOT NULL,
      "telegram_sent" boolean DEFAULT false NOT NULL,
      "action_taken" boolean DEFAULT false NOT NULL,
      "created_at" timestamp DEFAULT now() NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS "payment_invoices" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "invoice_id" text NOT NULL,
      "user_id" varchar NOT NULL,
      "tier_name" text NOT NULL,
      "amount" numeric(10, 2) NOT NULL,
      "currency" text DEFAULT 'USDT' NOT NULL,
      "status" text DEFAULT 'pending' NOT NULL,
      "payment_link" text NOT NULL,
      "tx_hash" text,
      "network" text DEFAULT 'TON' NOT NULL,
      "sandbox" boolean DEFAULT false NOT NULL,
      "splits" text DEFAULT '[]' NOT NULL,
      "metadata" text,
      "created_at" timestamp DEFAULT now() NOT NULL,
      "paid_at" timestamp,
      "expires_at" timestamp NOT NULL,
      CONSTRAINT "payment_invoices_invoice_id_unique" UNIQUE("invoice_id")
    )`,
    `CREATE TABLE IF NOT EXISTS "tasks" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "slug" text NOT NULL,
      "title" text NOT NULL,
      "description" text NOT NULL,
      "category" text NOT NULL,
      "task_type" text NOT NULL,
      "reward_coins" integer NOT NULL,
      "required_tier" text,
      "link" text,
      "icon" text,
      "sort_order" integer DEFAULT 0 NOT NULL,
      "active" boolean DEFAULT true NOT NULL,
      "created_at" timestamp DEFAULT now() NOT NULL,
      CONSTRAINT "tasks_slug_unique" UNIQUE("slug")
    )`,
    `CREATE TABLE IF NOT EXISTS "user_tasks" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "user_id" varchar NOT NULL,
      "task_id" varchar NOT NULL,
      "completed_at" timestamp DEFAULT now() NOT NULL,
      "date" text
    )`,
    `CREATE TABLE IF NOT EXISTS "daily_combos" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "date" text NOT NULL,
      "code" text NOT NULL,
      "reward_coins" integer DEFAULT 1000000 NOT NULL,
      "hint" text,
      "created_at" timestamp DEFAULT now() NOT NULL,
      CONSTRAINT "daily_combos_date_unique" UNIQUE("date")
    )`,
    `CREATE TABLE IF NOT EXISTS "referral_milestones" (
      "id" serial PRIMARY KEY NOT NULL,
      "friends_required" integer NOT NULL,
      "label" text NOT NULL,
      "usdt_per_friend" real DEFAULT 1 NOT NULL,
      "bonus_usdt" real DEFAULT 0 NOT NULL,
      "unlocks_wheel" boolean DEFAULT false NOT NULL,
      "sort_order" integer DEFAULT 0 NOT NULL,
      "active" boolean DEFAULT true NOT NULL,
      "created_at" timestamp DEFAULT now() NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS "daily_combo_attempts" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "user_id" varchar NOT NULL,
      "combo_id" varchar NOT NULL,
      "solved" boolean DEFAULT false NOT NULL,
      "attempts" integer DEFAULT 0 NOT NULL,
      "solved_at" timestamp,
      "created_at" timestamp DEFAULT now() NOT NULL
    )`,
  ];

  const addColumnStatements = [
    `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "spin_tickets" integer DEFAULT 0 NOT NULL`,
    `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "spin_tickets_expiry" timestamp`,
    `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "tier" text DEFAULT 'FREE' NOT NULL`,
    `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "subscription_expiry" timestamp`,
    `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "subscription_started_at" timestamp`,
    `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "is_founder" boolean DEFAULT false NOT NULL`,
    `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "ton_wallet_address" text`,
    `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "telegram_id" text`,
    `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "telegram_username" text`,
    `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "telegram_first_name" text`,
    `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "telegram_photo_url" text`,
    `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "cooldown_until" timestamp`,
    `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "challenge_pending" boolean DEFAULT false NOT NULL`,
    `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "challenge_paused_until" timestamp`,
    `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "coins_since_last_challenge" integer DEFAULT 0 NOT NULL`,
    `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_free_refill" timestamp`,
    `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_spin_refill" timestamp`,
    `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "daily_refills_used" integer DEFAULT 0 NOT NULL`,
    `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "tap_multiplier" integer DEFAULT 1 NOT NULL`,
    `ALTER TABLE "tiers" ADD COLUMN IF NOT EXISTS "energy_refill_rate_ms" integer DEFAULT 2000 NOT NULL`,
    `ALTER TABLE "tiers" ADD COLUMN IF NOT EXISTS "free_refills_per_day" integer DEFAULT 0 NOT NULL`,
    `ALTER TABLE "tiers" ADD COLUMN IF NOT EXISTS "refill_cooldown_ms" integer`,
    `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "league" text DEFAULT 'BRONZE' NOT NULL`,
    `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "referral_code" text`,
    `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "referred_by" varchar`,
    `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "wheel_unlocked" boolean DEFAULT false NOT NULL`,
    `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "total_referral_earnings" real DEFAULT 0 NOT NULL`,
  ];

  for (const sql of statements) {
    await pool.query(sql);
  }
  console.log("  Baseline: all tables ensured");

  for (const sql of addColumnStatements) {
    try {
      await pool.query(sql);
    } catch (err: any) {
      if (err?.code === "42701") continue;
      throw err;
    }
  }
  console.log("  Baseline: all columns ensured");
}

runStandaloneMigration().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
