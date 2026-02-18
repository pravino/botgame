import { storage } from "../storage";
import { db } from "../storage";
import { tapSessions, users } from "@shared/schema";
import { eq, and, gte, desc, sql } from "drizzle-orm";

const RATE_LIMIT_TAPS_PER_SECOND = 15;
const COOLDOWN_DURATION_MS = 60 * 1000;
const CHALLENGE_COIN_THRESHOLD = 5000;
const CHALLENGE_PAUSE_DURATION_MS = 60 * 60 * 1000;

const tapTimestamps: Map<string, number[]> = new Map();

export function checkRateLimit(userId: string, tapCount: number): { allowed: boolean; reason?: string } {
  const now = Date.now();
  const windowMs = 1000;

  if (!tapTimestamps.has(userId)) {
    tapTimestamps.set(userId, []);
  }

  const timestamps = tapTimestamps.get(userId)!;
  const recentTaps = timestamps.filter(t => now - t < windowMs);
  const totalTapsInWindow = recentTaps.length + tapCount;

  if (totalTapsInWindow > RATE_LIMIT_TAPS_PER_SECOND) {
    return { allowed: false, reason: "Rate limit exceeded: too many taps per second" };
  }

  recentTaps.push(...Array(tapCount).fill(now));
  tapTimestamps.set(userId, recentTaps.slice(-100));

  return { allowed: true };
}

export async function checkCooldown(userId: string): Promise<{ coolingDown: boolean; cooldownEnds?: Date }> {
  const user = await storage.getUser(userId);
  if (!user) return { coolingDown: false };

  if (user.cooldownUntil && new Date(user.cooldownUntil) > new Date()) {
    return { coolingDown: true, cooldownEnds: new Date(user.cooldownUntil) };
  }

  return { coolingDown: false };
}

export async function triggerCooldown(userId: string): Promise<void> {
  const cooldownUntil = new Date(Date.now() + COOLDOWN_DURATION_MS);
  await storage.updateUser(userId, { cooldownUntil });
}

export async function checkChallenge(userId: string): Promise<{ challengeRequired: boolean }> {
  const user = await storage.getUser(userId);
  if (!user) return { challengeRequired: false };

  if (user.challengePausedUntil && new Date(user.challengePausedUntil) > new Date()) {
    return { challengeRequired: false };
  }

  if (user.challengePending) {
    return { challengeRequired: true };
  }

  if (user.coinsSinceLastChallenge >= CHALLENGE_COIN_THRESHOLD) {
    await storage.updateUser(userId, { challengePending: true });
    return { challengeRequired: true };
  }

  return { challengeRequired: false };
}

export async function resolveChallenge(userId: string, passed: boolean): Promise<{ success: boolean; pausedUntil?: Date }> {
  if (passed) {
    await storage.updateUser(userId, {
      challengePending: false,
      coinsSinceLastChallenge: 0,
    });
    return { success: true };
  }

  const pausedUntil = new Date(Date.now() + CHALLENGE_PAUSE_DURATION_MS);
  await storage.updateUser(userId, {
    challengePending: false,
    challengePausedUntil: pausedUntil,
    coinsSinceLastChallenge: 0,
  });
  return { success: false, pausedUntil };
}

export async function updateCoinsSinceChallenge(userId: string, coinsEarned: number): Promise<void> {
  const user = await storage.getUser(userId);
  if (!user) return;
  await storage.updateUser(userId, {
    coinsSinceLastChallenge: user.coinsSinceLastChallenge + coinsEarned,
  });
}

export async function checkWalletUnique(tonWalletAddress: string, currentUserId: string): Promise<{ unique: boolean; reason?: string }> {
  if (!tonWalletAddress || tonWalletAddress.trim().length === 0) {
    return { unique: false, reason: "TON wallet address is required" };
  }

  const [existing] = await db
    .select()
    .from(users)
    .where(
      and(
        eq(users.tonWalletAddress, tonWalletAddress.trim()),
        sql`${users.id} != ${currentUserId}`
      )
    )
    .limit(1);

  if (existing) {
    return { unique: false, reason: "This TON wallet address is already linked to another account" };
  }

  return { unique: true };
}

export async function runGuardianChecks(userId: string, tapCount: number): Promise<{
  allowed: boolean;
  reason?: string;
  challengeRequired?: boolean;
  coolingDown?: boolean;
  cooldownEnds?: Date;
}> {
  const cooldown = await checkCooldown(userId);
  if (cooldown.coolingDown) {
    return {
      allowed: false,
      coolingDown: true,
      cooldownEnds: cooldown.cooldownEnds,
      reason: `Cooling down until ${cooldown.cooldownEnds?.toISOString()}`,
    };
  }

  const rateCheck = checkRateLimit(userId, tapCount);
  if (!rateCheck.allowed) {
    await triggerCooldown(userId);
    return {
      allowed: false,
      coolingDown: true,
      reason: rateCheck.reason,
    };
  }

  const challenge = await checkChallenge(userId);
  if (challenge.challengeRequired) {
    return {
      allowed: false,
      challengeRequired: true,
      reason: "Proof of humanity challenge required before continuing",
    };
  }

  return { allowed: true };
}

export async function detectBotPattern(userId: string): Promise<{ suspicious: boolean; score: number; reasons: string[] }> {
  const reasons: string[] = [];
  let score = 0;

  const recentSessions = await db
    .select()
    .from(tapSessions)
    .where(
      and(
        eq(tapSessions.userId, userId),
        gte(tapSessions.createdAt, new Date(Date.now() - 24 * 60 * 60 * 1000))
      )
    )
    .orderBy(desc(tapSessions.createdAt))
    .limit(100);

  if (recentSessions.length === 0) {
    return { suspicious: false, score: 0, reasons: [] };
  }

  if (recentSessions.length > 50) {
    score += 30;
    reasons.push(`High session count in 24h: ${recentSessions.length}`);
  }

  const tapCounts = recentSessions.map(s => s.taps);
  const allSame = tapCounts.every(t => t === tapCounts[0]);
  if (allSame && recentSessions.length > 10) {
    score += 40;
    reasons.push(`All ${recentSessions.length} sessions have identical tap count: ${tapCounts[0]}`);
  }

  if (recentSessions.length >= 3) {
    const intervals: number[] = [];
    for (let i = 1; i < Math.min(recentSessions.length, 20); i++) {
      const diff = new Date(recentSessions[i - 1].createdAt).getTime() -
                   new Date(recentSessions[i].createdAt).getTime();
      intervals.push(diff);
    }

    if (intervals.length > 2) {
      const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const variance = intervals.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / intervals.length;
      const stdDev = Math.sqrt(variance);

      if (stdDev < 500 && avg < 5000) {
        score += 30;
        reasons.push(`Suspiciously regular intervals: avg=${Math.round(avg)}ms, stdDev=${Math.round(stdDev)}ms`);
      }
    }
  }

  return {
    suspicious: score >= 50,
    score,
    reasons,
  };
}
