CREATE TABLE "daily_taps" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"taps_today" integer DEFAULT 0 NOT NULL,
	"coins_earned" integer DEFAULT 0 NOT NULL,
	"tier_at_time" text DEFAULT 'FREE' NOT NULL,
	"date" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deposits" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"amount" real NOT NULL,
	"network" text NOT NULL,
	"tx_hash" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"confirmed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "jackpot_vault" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tier_name" text NOT NULL,
	"total_balance" numeric(10, 2) DEFAULT '0' NOT NULL,
	"month_key" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "otp_codes" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"code" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_invoices" (
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
);
--> statement-breakpoint
CREATE TABLE "pool_allocations" (
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
);
--> statement-breakpoint
CREATE TABLE "predictions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"prediction" text NOT NULL,
	"btc_price_at_prediction" real NOT NULL,
	"resolved_price" real,
	"resolved" boolean DEFAULT false NOT NULL,
	"correct" boolean,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "subscription_alerts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"alert_type" text NOT NULL,
	"telegram_sent" boolean DEFAULT false NOT NULL,
	"action_taken" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tap_sessions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"taps" integer NOT NULL,
	"coins_earned" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tiers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"price" numeric(10, 2) DEFAULT '0' NOT NULL,
	"daily_unit" numeric(10, 2) DEFAULT '0' NOT NULL,
	"tap_multiplier" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
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
);
--> statement-breakpoint
CREATE TABLE "unclaimed_funds" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"allocation_id" varchar NOT NULL,
	"tier_name" text NOT NULL,
	"game" text NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"destination" text DEFAULT 'admin' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_ledger" (
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
);
--> statement-breakpoint
CREATE TABLE "users" (
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
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_telegram_id_unique" UNIQUE("telegram_id")
);
--> statement-breakpoint
CREATE TABLE "wheel_spins" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"reward" real NOT NULL,
	"slice_label" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "withdrawal_batches" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"total_withdrawals" integer DEFAULT 0 NOT NULL,
	"total_gross" numeric(12, 4) DEFAULT '0' NOT NULL,
	"total_fees" numeric(12, 4) DEFAULT '0' NOT NULL,
	"total_net" numeric(12, 4) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"withdrawal_ids" text DEFAULT '[]' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"processed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "withdrawals" (
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
);
--> statement-breakpoint
ALTER TABLE "daily_taps" ADD CONSTRAINT "daily_taps_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_invoices" ADD CONSTRAINT "payment_invoices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pool_allocations" ADD CONSTRAINT "pool_allocations_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "predictions" ADD CONSTRAINT "predictions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_alerts" ADD CONSTRAINT "subscription_alerts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tap_sessions" ADD CONSTRAINT "tap_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unclaimed_funds" ADD CONSTRAINT "unclaimed_funds_allocation_id_pool_allocations_id_fk" FOREIGN KEY ("allocation_id") REFERENCES "public"."pool_allocations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_ledger" ADD CONSTRAINT "user_ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wheel_spins" ADD CONSTRAINT "wheel_spins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;