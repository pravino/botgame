ALTER TABLE "tiers" ADD COLUMN "energy_refill_rate_ms" integer DEFAULT 2000 NOT NULL;--> statement-breakpoint
ALTER TABLE "tiers" ADD COLUMN "free_refills_per_day" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tiers" ADD COLUMN "refill_cooldown_ms" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_free_refill" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "daily_refills_used" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "tap_multiplier" integer DEFAULT 1 NOT NULL;