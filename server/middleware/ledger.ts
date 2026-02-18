import { createHash } from "crypto";
import { db, storage } from "../storage";
import { userLedger } from "@shared/schema";
import { eq, desc, asc } from "drizzle-orm";

export type LedgerEntryType =
  | "tap_earn"
  | "predict_win"
  | "predict_loss"
  | "predict_reward"
  | "wheel_win"
  | "subscription_payment"
  | "spin_ticket_grant"
  | "spin_ticket_expire"
  | "drip_release"
  | "withdrawal_request"
  | "withdrawal_fee"
  | "withdrawal_net"
  | "withdrawal_completed"
  | "withdrawal_rejected"
  | "deposit"
  | "deposit_confirmed"
  | "admin_recapture"
  | "energy_refill"
  | "bonus"
  | "referral_bonus"
  | "tier_upgrade"
  | "tier_downgrade"
  | "refund"
  | "leaderboard_reward";

export type LedgerDirection = "credit" | "debit";
export type LedgerCurrency = "COINS" | "USDT" | "TICKETS";

interface LedgerInput {
  userId: string;
  entryType: LedgerEntryType;
  direction: LedgerDirection;
  amount: number;
  currency?: LedgerCurrency;
  balanceBefore: number;
  balanceAfter: number;
  game?: string;
  refId?: string;
  note?: string;
}

function computeEntryHash(data: {
  id: string;
  userId: string;
  entryType: string;
  direction: string;
  amount: string;
  balanceBefore: string;
  balanceAfter: string;
  prevHash: string | null;
}): string {
  const payload = [
    data.id,
    data.userId,
    data.entryType,
    data.direction,
    data.amount,
    data.balanceBefore,
    data.balanceAfter,
    data.prevHash || "GENESIS",
  ].join("|");

  return createHash("sha256").update(payload).digest("hex");
}

async function getLastLedgerEntry(userId: string) {
  const [last] = await db
    .select()
    .from(userLedger)
    .where(eq(userLedger.userId, userId))
    .orderBy(desc(userLedger.createdAt), desc(userLedger.id))
    .limit(1);
  return last || null;
}

export async function recordLedgerEntry(input: LedgerInput): Promise<void> {
  const user = await storage.getUser(input.userId);
  const tierAtTime = user?.tier || "FREE";
  const currency = input.currency || "COINS";

  const lastEntry = await getLastLedgerEntry(input.userId);
  const prevHash = lastEntry?.entryHash || null;

  const [inserted] = await db.insert(userLedger).values({
    userId: input.userId,
    entryType: input.entryType,
    direction: input.direction,
    amount: input.amount.toFixed(4),
    currency,
    balanceBefore: input.balanceBefore.toFixed(4),
    balanceAfter: input.balanceAfter.toFixed(4),
    game: input.game || null,
    refId: input.refId || null,
    tierAtTime,
    note: input.note || null,
    prevHash,
    entryHash: "PENDING",
  }).returning();

  const entryHash = computeEntryHash({
    id: inserted.id,
    userId: input.userId,
    entryType: input.entryType,
    direction: input.direction,
    amount: input.amount.toFixed(4),
    balanceBefore: input.balanceBefore.toFixed(4),
    balanceAfter: input.balanceAfter.toFixed(4),
    prevHash,
  });

  await db
    .update(userLedger)
    .set({ entryHash })
    .where(eq(userLedger.id, inserted.id));
}

export async function getUserLedger(userId: string, limit = 50) {
  return db
    .select()
    .from(userLedger)
    .where(eq(userLedger.userId, userId))
    .orderBy(desc(userLedger.createdAt), desc(userLedger.id))
    .limit(limit);
}

export async function verifyLedgerIntegrity(userId: string): Promise<{ valid: boolean; brokenAt?: string; totalEntries: number }> {
  const entries = await db
    .select()
    .from(userLedger)
    .where(eq(userLedger.userId, userId))
    .orderBy(asc(userLedger.createdAt), asc(userLedger.id));

  let prevHash: string | null = null;

  for (const entry of entries) {
    if (entry.prevHash !== prevHash) {
      return { valid: false, brokenAt: entry.id, totalEntries: entries.length };
    }

    const expectedHash = computeEntryHash({
      id: entry.id,
      userId: entry.userId,
      entryType: entry.entryType,
      direction: entry.direction,
      amount: entry.amount,
      balanceBefore: entry.balanceBefore,
      balanceAfter: entry.balanceAfter,
      prevHash: entry.prevHash,
    });

    if (entry.entryHash !== expectedHash) {
      return { valid: false, brokenAt: entry.id, totalEntries: entries.length };
    }

    prevHash = entry.entryHash;
  }

  return { valid: true, totalEntries: entries.length };
}
