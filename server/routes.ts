import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { storage, db } from "./storage";
import { users, predictions } from "@shared/schema";
import { eq, and, gte, sql } from "drizzle-orm";
import crypto from "crypto";
import { log } from "./index";
import { processSubscriptionPayment } from "./middleware/transactionSplit";
import { getActivePools, getAllTierPools, expireStaleAllocations, processDailyDrip } from "./middleware/poolLogic";
import { recordLedgerEntry, getUserLedger, verifyLedgerIntegrity } from "./middleware/ledger";
import { runGuardianChecks, updateCoinsSinceChallenge, resolveChallenge, checkWalletUnique, detectBotPattern } from "./middleware/guardian";
import { midnightPulse, batchWithdrawalSettlement, subscriberRetentionCheck } from "./cron/settlementCron";
import { getValidatedBTCPrice, isPriceFrozen } from "./services/priceService";
import { checkAndAwardMilestones } from "./services/referralTracker";
import { settleAllTiers } from "./services/oracleService";
import { createInvoice, verifySignature, processWebhookPayment, sandboxConfirmInvoice, getPaymentConfig, requireSecretConfigured } from "./services/paymentService";

import { spinWheel } from "./services/wheelService";
import { initTelegramBot, detectChatIds, getBotInfo, sendToNewsChannel, sendToLobby, sendToApex, sendDirectMessage, announceLeaderboard, announceNewSubscriber, announceMorningAlpha, announceOracleWarning, announceTierGap, announceFomoCountdown, announceMathWarrior, announceLastCall, generateApexInviteLink, kickFromApex, checkTelegramMembership } from "./services/telegramBot";

async function getBtcPrice(): Promise<{ price: number; change24h: number }> {
  try {
    const validated = await getValidatedBTCPrice();
    return { price: validated.price, change24h: validated.change24h };
  } catch (error) {
    log(`[BTC Price] Oracle fallback triggered: ${(error as Error).message}`);
    const fallbackPrice = 95000 + Math.random() * 5000;
    return { price: fallbackPrice, change24h: 1.5 };
  }
}

function validateTelegramWebAppData(initData: string, botToken: string): { valid: boolean; user?: any } {
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get("hash");
    if (!hash) return { valid: false };

    params.delete("hash");
    const entries = Array.from(params.entries());
    entries.sort((a, b) => a[0].localeCompare(b[0]));
    const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join("\n");

    const secretKey = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
    const computedHash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

    if (computedHash !== hash) return { valid: false };

    const authDate = parseInt(params.get("auth_date") || "0", 10);
    const now = Math.floor(Date.now() / 1000);
    if (now - authDate > 86400) return { valid: false };

    const userStr = params.get("user");
    if (!userStr) return { valid: false };
    return { valid: true, user: JSON.parse(userStr) };
  } catch {
    return { valid: false };
  }
}

const WIDGET_FIELDS = new Set(["id", "first_name", "last_name", "username", "photo_url", "auth_date"]);

function validateTelegramLoginWidget(data: Record<string, string>, botToken: string): boolean {
  try {
    const { hash } = data;
    if (!hash) return false;

    const filtered: Record<string, string> = {};
    for (const key of Object.keys(data)) {
      if (WIDGET_FIELDS.has(key)) filtered[key] = data[key];
    }

    const entries = Object.entries(filtered);
    entries.sort((a, b) => a[0].localeCompare(b[0]));
    const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join("\n");

    const secretKey = crypto.createHash("sha256").update(botToken).digest();
    const computedHash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

    if (computedHash !== hash) return false;

    const authDate = parseInt(filtered.auth_date || "0", 10);
    const now = Math.floor(Date.now() / 1000);
    if (now - authDate > 86400) return false;

    return true;
  } catch {
    return false;
  }
}

declare module "express-session" {
  interface SessionData {
    userId: string;
  }
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  const dbUrl = process.env.PRODUCTION_DATABASE_URL || process.env.DATABASE_URL;
  const isProduction = process.env.NODE_ENV === "production";
  const PgStore = connectPgSimple(session);

  const sessionPool = new (await import("pg")).default.Pool({ connectionString: dbUrl });
  await sessionPool.query(`
    CREATE TABLE IF NOT EXISTS "session" (
      "sid" varchar NOT NULL COLLATE "default",
      "sess" json NOT NULL,
      "expire" timestamp(6) NOT NULL,
      CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
    ) WITH (OIDS=FALSE);
    CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");
  `);

  app.set("trust proxy", 1);
  app.use(
    session({
      store: new PgStore({
        pool: sessionPool,
        createTableIfMissing: false,
      }),
      secret: process.env.SESSION_SECRET || "crypto-games-secret-key",
      resave: false,
      saveUninitialized: false,
      cookie: {
        maxAge: 30 * 24 * 60 * 60 * 1000,
        secure: isProduction,
        sameSite: isProduction ? "none" : "lax",
      },
    })
  );

  const TIER_MAX_UPGRADE: Record<string, number> = {
    FREE: 1,
    BRONZE: 2,
    SILVER: 3,
    GOLD: 10,
  };

  const TIER_NEXT: Record<string, string | null> = {
    FREE: "BRONZE",
    BRONZE: "SILVER",
    SILVER: "GOLD",
    GOLD: null,
  };

  const { LEAGUE_THRESHOLDS, computeLeague, getLeagueMultiplier } = await import("./constants/leagues");

  function isTierSufficient(userTier: string, requiredTier: string): boolean {
    const tierOrder = ["FREE", "BRONZE", "SILVER", "GOLD"];
    return tierOrder.indexOf(userTier) >= tierOrder.indexOf(requiredTier);
  }

  interface CachedTierConfig {
    energyRefillRateMs: number;
    freeRefillsPerDay: number;
    refillCooldownMs: number | null;
    tapMultiplier: number;
  }

  let tierConfigCache: Record<string, CachedTierConfig> = {};
  let tierConfigLoadedAt = 0;
  const TIER_CACHE_TTL_MS = 60 * 1000;

  async function loadTierConfig(): Promise<void> {
    const allTiers = await storage.getAllTiers();
    const cache: typeof tierConfigCache = {};
    for (const t of allTiers) {
      cache[t.name] = {
        energyRefillRateMs: t.energyRefillRateMs ?? 2000,
        freeRefillsPerDay: t.freeRefillsPerDay ?? 0,
        refillCooldownMs: t.refillCooldownMs ?? null,
        tapMultiplier: t.tapMultiplier ?? 1,
      };
    }
    tierConfigCache = cache;
    tierConfigLoadedAt = Date.now();
  }

  async function getTierConfig(tierName: string): Promise<CachedTierConfig> {
    if (Date.now() - tierConfigLoadedAt > TIER_CACHE_TTL_MS || Object.keys(tierConfigCache).length === 0) {
      await loadTierConfig();
    }
    return tierConfigCache[tierName] || { energyRefillRateMs: 2000, freeRefillsPerDay: 0, refillCooldownMs: null, tapMultiplier: 1 };
  }

  function getRefillRateForTierSync(tierName: string): number {
    return tierConfigCache[tierName]?.energyRefillRateMs || 2000;
  }

  function calculatePassiveEnergyRegen(user: any): { newEnergy: number; advancedRefillTime: Date } {
    const refillRateMs = getRefillRateForTierSync(user.tier);
    const now = Date.now();
    const lastRefill = new Date(user.lastEnergyRefill).getTime();
    const elapsedMs = now - lastRefill;
    const regenAmount = Math.floor(elapsedMs / refillRateMs);
    const newEnergy = Math.min(user.maxEnergy, user.energy + regenAmount);
    const consumedMs = regenAmount * refillRateMs;
    const advancedRefillTime = new Date(lastRefill + consumedMs);
    return { newEnergy, advancedRefillTime };
  }

  async function applyPassiveRegen(userId: string, user: any): Promise<any> {
    await getTierConfig(user.tier);
    const { newEnergy, advancedRefillTime } = calculatePassiveEnergyRegen(user);
    if (newEnergy > user.energy) {
      const updated = await storage.updateUser(userId, {
        energy: newEnergy,
        lastEnergyRefill: advancedRefillTime,
      });
      return updated || { ...user, energy: newEnergy, lastEnergyRefill: advancedRefillTime };
    }
    return user;
  }

  function isDifferentDay(date1: Date, date2: Date): boolean {
    return date1.getUTCFullYear() !== date2.getUTCFullYear() ||
      date1.getUTCMonth() !== date2.getUTCMonth() ||
      date1.getUTCDate() !== date2.getUTCDate();
  }

  async function refillUserResources(user: any) {
    const now = new Date();
    const updates: any = {};

    const { newEnergy, advancedRefillTime } = calculatePassiveEnergyRegen(user);
    if (newEnergy > user.energy) {
      updates.energy = newEnergy;
      updates.lastEnergyRefill = advancedRefillTime;
    }

    const isFreeUser = user.tier === "FREE" || !user.subscriptionExpiry || new Date(user.subscriptionExpiry) <= now;
    if (isFreeUser && user.spinsRemaining <= 0) {
      const lastRefill = user.lastSpinRefill ? new Date(user.lastSpinRefill) : null;
      const shouldRefill = !lastRefill ||
        (now.getMonth() !== lastRefill.getMonth() || now.getFullYear() !== lastRefill.getFullYear());
      if (shouldRefill) {
        updates.spinsRemaining = 1;
        updates.lastSpinRefill = now;
      }
    }

    if (Object.keys(updates).length > 0) {
      const updated = await storage.updateUser(user.id, updates);
      return updated || user;
    }

    return user;
  }

  function requireAuth(req: Request, res: Response, next: Function) {
    if (!req.session.userId) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    next();
  }

  const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "").split(",").map(e => e.trim().toLowerCase()).filter(Boolean);
  const ADMIN_TELEGRAM_IDS = (process.env.ADMIN_TELEGRAM_IDS || "").split(",").map(t => t.trim()).filter(Boolean);

  async function requireAdmin(req: Request, res: Response, next: Function) {
    if (!req.session.userId) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    const user = await storage.getUser(req.session.userId);
    if (!user) {
      return res.status(403).json({ message: "Admin access required" });
    }
    const isAdmin = ADMIN_EMAILS.includes(user.email.toLowerCase()) ||
      (user.telegramId && ADMIN_TELEGRAM_IDS.includes(user.telegramId));
    if (!isAdmin) {
      return res.status(403).json({ message: "Admin access required" });
    }
    next();
  }

  app.post("/api/auth/telegram", async (req: Request, res: Response) => {
    try {
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      if (!botToken) {
        return res.status(500).json({ message: "Telegram bot not configured" });
      }

      const { initData, widgetData, referralCode } = req.body;
      let telegramUser: { id: number; first_name?: string; last_name?: string; username?: string; photo_url?: string } | null = null;

      if (initData) {
        const result = validateTelegramWebAppData(initData, botToken);
        if (!result.valid || !result.user) {
          return res.status(401).json({ message: "Invalid Telegram authentication" });
        }
        telegramUser = result.user;
      } else if (widgetData) {
        const valid = validateTelegramLoginWidget(widgetData, botToken);
        if (!valid) {
          return res.status(401).json({ message: "Invalid Telegram authentication" });
        }
        telegramUser = {
          id: parseInt(widgetData.id, 10),
          first_name: widgetData.first_name,
          last_name: widgetData.last_name,
          username: widgetData.username,
          photo_url: widgetData.photo_url,
        };
      } else {
        return res.status(400).json({ message: "Missing authentication data" });
      }

      if (!telegramUser || !telegramUser.id) {
        return res.status(400).json({ message: "Invalid user data" });
      }

      const tgId = telegramUser.id.toString();

      let user = await storage.getUserByTelegramId(tgId);

      if (!user) {
        const displayName = telegramUser.username || telegramUser.first_name || `User${tgId.slice(-4)}`;
        const placeholderEmail = `tg_${tgId}@vault60.app`;

        user = await storage.createUser({
          username: displayName,
          email: placeholderEmail,
          telegramId: tgId,
          telegramUsername: telegramUser.username || null,
          telegramFirstName: telegramUser.first_name || null,
          telegramPhotoUrl: telegramUser.photo_url || null,
        } as any);
        await storage.generateReferralCode(user.id);

        if (referralCode && typeof referralCode === "string") {
          const referrer = await storage.getUserByReferralCode(referralCode.trim().toUpperCase());
          if (referrer && referrer.id !== user.id) {
            await storage.updateUser(user.id, { referredBy: referrer.id });
            log(`[Referral] New user ${user.id} referred by ${referrer.id} (code: ${referralCode})`);
          }
        }

        log(`[Auth] New Telegram user: ${displayName} (${tgId})`);
      } else {
        await storage.updateUser(user.id, {
          telegramUsername: telegramUser.username || user.telegramUsername,
          telegramFirstName: telegramUser.first_name || user.telegramFirstName,
          telegramPhotoUrl: telegramUser.photo_url || user.telegramPhotoUrl,
        });
      }

      user = await refillUserResources(user);

      req.session.userId = user!.id;
      res.json(user);
    } catch (error: any) {
      log(`Telegram auth error: ${error.message}`);
      res.status(500).json({ message: "Authentication failed" });
    }
  });

  app.get("/api/auth/telegram/bot-info", (_req: Request, res: Response) => {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      return res.status(500).json({ message: "Bot not configured" });
    }
    const botUsername = "Vault60Bot";
    res.json({ botUsername });
  });

  app.get("/api/user", requireAuth, async (req: Request, res: Response) => {
    try {
      let user = await storage.getUser(req.session.userId!);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      user = await refillUserResources(user);
      const tc = await getTierConfig(user.tier);

      const userLevel = user.tapMultiplier ?? 1;
      const effectiveMultiplier = userLevel * (tc.tapMultiplier ?? 1);
      const maxUpgradeLevel = TIER_MAX_UPGRADE[user.tier] ?? 1;
      const currentLeague = computeLeague(user.totalCoins);
      if (currentLeague !== user.league) {
        await storage.updateUser(user.id, { league: currentLeague });
        user = { ...user, league: currentLeague };
      }
      const leagueIdx = LEAGUE_THRESHOLDS.findIndex(l => l.name === currentLeague);
      const nextLeagueInfo = leagueIdx < LEAGUE_THRESHOLDS.length - 1 ? LEAGUE_THRESHOLDS[leagueIdx + 1] : null;
      res.json({
        ...user,
        tierConfig: {
          energyRefillRateMs: tc.energyRefillRateMs,
          refillCooldownMs: tc.refillCooldownMs,
          tapMultiplier: effectiveMultiplier,
        },
        tapMultiplierLevel: userLevel,
        tierBaseMultiplier: tc.tapMultiplier ?? 1,
        maxUpgradeLevel,
        isMaxedUpgrade: userLevel >= maxUpgradeLevel,
        nextTier: TIER_NEXT[user.tier] ?? null,
        leagueInfo: {
          league: currentLeague,
          multiplier: getLeagueMultiplier(currentLeague),
          nextLeague: nextLeagueInfo ? { name: nextLeagueInfo.name, minCoins: nextLeagueInfo.minCoins, multiplier: nextLeagueInfo.payoutMultiplier } : null,
        },
      });
    } catch (error: any) {
      res.status(500).json({ message: "Failed to get user" });
    }
  });

  app.post("/api/logout", (req: Request, res: Response) => {
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ message: "Failed to logout" });
      }
      res.json({ message: "Logged out" });
    });
  });

  app.post("/api/tap", requireAuth, async (req: Request, res: Response) => {
    try {
      const { taps } = req.body;
      const tapCount = Math.min(Math.max(1, Number(taps) || 1), 50);

      const rawUser = await storage.getUser(req.session.userId!);
      if (!rawUser) return res.status(404).json({ message: "User not found" });

      const user = await applyPassiveRegen(rawUser.id, rawUser);

      const guardianResult = await runGuardianChecks(user.id, tapCount);
      if (!guardianResult.allowed) {
        return res.status(429).json({
          message: guardianResult.reason,
          challengeRequired: guardianResult.challengeRequired || false,
          coolingDown: guardianResult.coolingDown || false,
          cooldownEnds: guardianResult.cooldownEnds,
        });
      }

      const actualTaps = Math.min(tapCount, user.energy);
      if (actualTaps <= 0) {
        return res.status(400).json({ message: "No energy remaining" });
      }

      const tierConfig = await getTierConfig(user.tier);
      const multiplier = (user.tapMultiplier ?? 1) * (tierConfig.tapMultiplier ?? 1);
      const coinsEarned = actualTaps * multiplier;

      const session = await storage.createTapSession({
        userId: user.id,
        taps: actualTaps,
        coinsEarned,
      });

      const updated = await storage.atomicTap(user.id, coinsEarned, actualTaps, new Date());

      if (updated) {
        const newLeague = computeLeague(updated.totalCoins);
        if (newLeague !== updated.league) {
          await storage.updateUser(user.id, { league: newLeague });
        }
      }

      await storage.upsertDailyTap(user.id, actualTaps, coinsEarned, user.tier);
      await updateCoinsSinceChallenge(user.id, coinsEarned);

      await recordLedgerEntry({
        userId: user.id,
        entryType: "tap_earn",
        direction: "credit",
        amount: coinsEarned,
        currency: "COINS",
        balanceBefore: updated ? updated.totalCoins - coinsEarned : user.totalCoins,
        balanceAfter: updated?.totalCoins ?? user.totalCoins + coinsEarned,
        game: "tapPot",
        refId: session?.id,
        note: `${coinsEarned} watts from ${actualTaps} cranks (${multiplier}x ${user.tier} multiplier)`,
      });

      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to process tap" });
    }
  });

  app.get("/api/tap/estimated-earnings", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user) return res.status(404).json({ message: "User not found" });

      const now = new Date();
      const dateKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}`;

      const tierConfig = await getTierConfig(user.tier);
      const userLevel = user.tapMultiplier ?? 1;
      const effectiveMultiplier = userLevel * (tierConfig.tapMultiplier ?? 1);
      const maxLevel = TIER_MAX_UPGRADE[user.tier] ?? 1;
      const isMaxed = userLevel >= maxLevel;
      const upgradeCost = isMaxed ? null : userLevel * 25000;
      const nextTier = TIER_NEXT[user.tier] ?? null;

      if (user.tier === "FREE") {
        return res.json({
          myCoinsToday: 0,
          totalTierCoins: 0,
          mySharePct: 0,
          estimatedUsdt: 0,
          tapPotSize: 0,
          tierName: "FREE",
          tapMultiplier: effectiveMultiplier,
          tapMultiplierLevel: userLevel,
          tierBaseMultiplier: tierConfig.tapMultiplier ?? 1,
          upgradeCost,
          maxUpgradeLevel: maxLevel,
          isMaxed,
          nextTier,
        });
      }

      const allTiers = await storage.getAllTiers();
      const tierData = allTiers.find(t => t.name === user.tier);
      const dailyUnit = tierData ? parseFloat(tierData.dailyUnit) : 0;

      const subscribers = await storage.getActiveSubscribersByTier(user.tier);
      const dailyPool = subscribers.length * dailyUnit;

      const config = await storage.getGlobalConfig();
      const treasurySplit = config.treasury_split ?? 0.60;
      const tapShare = config.tap_share ?? 0.50;
      const tapPotSize = dailyPool * treasurySplit * tapShare;

      const myCoinsToday = await storage.getUserDailyCoins(dateKey, user.id);
      const totalTierCoins = await storage.getTotalDailyCoinsByTier(dateKey, user.tier);

      const mySharePct = totalTierCoins > 0 ? (myCoinsToday / totalTierCoins) * 100 : 0;
      const estimatedUsdt = totalTierCoins > 0
        ? parseFloat(((myCoinsToday / totalTierCoins) * tapPotSize).toFixed(4))
        : 0;

      res.json({
        myCoinsToday,
        totalTierCoins,
        mySharePct: parseFloat(mySharePct.toFixed(1)),
        estimatedUsdt,
        tapPotSize: parseFloat(tapPotSize.toFixed(4)),
        tierName: user.tier,
        tapMultiplier: effectiveMultiplier,
        tapMultiplierLevel: userLevel,
        tierBaseMultiplier: tierConfig.tapMultiplier ?? 1,
        upgradeCost,
        maxUpgradeLevel: maxLevel,
        isMaxed,
        nextTier,
      });
    } catch (error: any) {
      res.status(500).json({ message: "Failed to get estimated earnings" });
    }
  });

  app.post("/api/games/upgrade-multiplier", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user) return res.status(404).json({ message: "User not found" });

      const currentLevel = user.tapMultiplier ?? 1;
      const maxLevel = TIER_MAX_UPGRADE[user.tier] ?? 1;
      const nextTier = TIER_NEXT[user.tier] ?? null;

      if (currentLevel >= maxLevel) {
        return res.status(403).json({
          message: nextTier
            ? `You've reached the ${user.tier} peak (Level ${maxLevel}). Upgrade to ${nextTier} to unlock higher multipliers!`
            : `You're at the maximum upgrade level (${maxLevel}).`,
          isMaxed: true,
          maxLevel,
          nextTier,
        });
      }

      const upgradeCost = currentLevel * 25000;

      if (user.totalCoins < upgradeCost) {
        return res.status(400).json({
          message: `Not enough watts! You need ${upgradeCost.toLocaleString()} W to upgrade.`,
          required: upgradeCost,
          current: user.totalCoins,
        });
      }

      const newMultiplier = currentLevel + 1;

      const [updated] = await db
        .update(users)
        .set({
          tapMultiplier: newMultiplier,
          totalCoins: sql`total_coins - ${upgradeCost}`,
        })
        .where(
          and(
            eq(users.id, user.id),
            eq(users.tapMultiplier, currentLevel),
            gte(users.totalCoins, upgradeCost)
          )
        )
        .returning();

      if (!updated) {
        return res.status(409).json({ message: "Upgrade failed. Please try again." });
      }

      await recordLedgerEntry({
        userId: user.id,
        entryType: "multiplier_upgrade",
        direction: "debit",
        amount: upgradeCost,
        currency: "COINS",
        balanceBefore: user.totalCoins,
        balanceAfter: updated.totalCoins,
        game: "tapPot",
        note: `Multiplier upgrade: Level ${currentLevel} -> Level ${newMultiplier} (spent ${upgradeCost.toLocaleString()} W)`,
      });

      const tierConfig = await getTierConfig(user.tier);
      const effectiveMultiplier = newMultiplier * (tierConfig.tapMultiplier ?? 1);

      res.json({
        newMultiplierLevel: newMultiplier,
        effectiveMultiplier,
        coinsSpent: upgradeCost,
        remainingCoins: updated.totalCoins,
        nextUpgradeCost: newMultiplier < maxLevel ? newMultiplier * 25000 : null,
        isMaxed: newMultiplier >= maxLevel,
        maxLevel,
      });
    } catch (error: any) {
      res.status(500).json({ message: "Failed to upgrade multiplier" });
    }
  });

  app.post("/api/energy/refill", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user) return res.status(404).json({ message: "User not found" });

      const tierConfig = await getTierConfig(user.tier);
      const cooldownMs = tierConfig.refillCooldownMs;

      if (cooldownMs === null || cooldownMs <= 0) {
        return res.status(403).json({
          message: "Full Tank refills are not available for your tier. Upgrade to Bronze or higher!",
        });
      }

      const now = new Date();
      const lastFreeRefill = user.lastFreeRefill ? new Date(user.lastFreeRefill) : null;

      if (lastFreeRefill) {
        const elapsed = now.getTime() - lastFreeRefill.getTime();
        if (elapsed < cooldownMs) {
          const remainingMs = cooldownMs - elapsed;
          const remainingHours = Math.floor(remainingMs / (1000 * 60 * 60));
          const remainingMinutes = Math.floor((remainingMs % (1000 * 60 * 60)) / (1000 * 60));
          return res.status(400).json({
            message: `Next Full Tank available in ${remainingHours}h ${remainingMinutes}m`,
            cooldownRemainingMs: remainingMs,
            nextRefillAt: new Date(lastFreeRefill.getTime() + cooldownMs).toISOString(),
          });
        }
      }

      const balanceBefore = user.energy;
      const updated = await storage.updateUser(user.id, {
        energy: user.maxEnergy,
        lastEnergyRefill: now,
        lastFreeRefill: now,
      });

      await recordLedgerEntry({
        userId: user.id,
        entryType: "energy_refill",
        direction: "credit",
        amount: user.maxEnergy - balanceBefore,
        currency: "COINS",
        balanceBefore,
        balanceAfter: user.maxEnergy,
        note: `Full Tank refill: ${balanceBefore} → ${user.maxEnergy} (${user.tier}, cooldown ${cooldownMs / 3600000}h)`,
      });

      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to refill energy" });
    }
  });

  app.post("/api/challenge/resolve", requireAuth, async (req: Request, res: Response) => {
    try {
      const { passed } = req.body;
      if (typeof passed !== "boolean") {
        return res.status(400).json({ message: "Challenge result (passed: true/false) is required" });
      }

      const result = await resolveChallenge(req.session.userId!, passed);
      if (result.success) {
        const user = await storage.getUser(req.session.userId!);
        let energyBonus = 0;

        if (user && user.tier !== "FREE" && user.isFounder) {
          energyBonus = 50;
          const newEnergy = Math.min(user.energy + energyBonus, user.maxEnergy);
          await storage.updateUser(user.id, { energy: newEnergy });
        }

        res.json({
          message: energyBonus > 0
            ? `Challenge passed! +${energyBonus} bonus energy!`
            : "Challenge passed! You can continue tapping.",
          energyBonus,
        });
      } else {
        res.json({
          message: "Challenge failed. Tapping paused for 1 hour.",
          pausedUntil: result.pausedUntil,
        });
      }
    } catch (error: any) {
      res.status(500).json({ message: "Failed to resolve challenge" });
    }
  });

  app.get("/api/btc-price", async (_req: Request, res: Response) => {
    try {
      const validated = await getValidatedBTCPrice();
      res.json({
        price: validated.price,
        change24h: validated.change24h,
        sources: validated.sources,
        median: validated.median,
      });
    } catch (error) {
      const fallbackPrice = 95000 + Math.random() * 5000;
      res.json({ price: fallbackPrice, change24h: 1.5, sources: ["fallback"], median: false });
    }
  });

  app.post("/api/predict", requireAuth, async (req: Request, res: Response) => {
    try {
      if (isPriceFrozen()) {
        return res.status(503).json({
          message: "BTC Price Settlement Delayed due to API Latency. Predictions are paused until the price is verified.",
        });
      }

      const nowUtc = new Date();
      const currentHourUtc = nowUtc.getUTCHours();
      if (currentHourUtc >= 12) {
        const hoursUntilReset = 24 - currentHourUtc;
        return res.status(400).json({
          message: `Predictions are locked after 12:00 UTC to prevent last-minute sniping. Submissions reopen in ${hoursUntilReset} hour${hoursUntilReset !== 1 ? "s" : ""}.`,
          lockedUntil: "00:00 UTC",
        });
      }

      const { prediction } = req.body;
      if (!prediction || !["higher", "lower"].includes(prediction)) {
        return res.status(400).json({ message: "Prediction must be 'higher' or 'lower'" });
      }

      const user = await storage.getUser(req.session.userId!);
      if (!user) return res.status(404).json({ message: "User not found" });

      if (user.tier !== "FREE" && user.subscriptionStartedAt) {
        const hoursSinceSubscription = (Date.now() - new Date(user.subscriptionStartedAt).getTime()) / (1000 * 60 * 60);
        if (hoursSinceSubscription < 4) {
          const hoursLeft = Math.ceil(4 - hoursSinceSubscription);
          return res.status(400).json({
            message: `New subscribers must wait at least 4 hours before making predictions. You can predict in about ${hoursLeft} hour${hoursLeft !== 1 ? "s" : ""}.`,
          });
        }
      }

      const active = await storage.getActivePrediction(user.id);
      if (active) {
        return res.status(400).json({ message: "You already have an active prediction. Wait for it to resolve." });
      }

      const btcData = await getBtcPrice();

      const pred = await storage.createPrediction({
        userId: user.id,
        prediction,
        btcPriceAtPrediction: btcData.price,
      });

      await storage.updateUser(user.id, {
        totalPredictions: user.totalPredictions + 1,
      });

      res.json(pred);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to create prediction" });
    }
  });

  app.get("/api/predictions/active", requireAuth, async (req: Request, res: Response) => {
    try {
      const pred = await storage.getActivePrediction(req.session.userId!);
      res.json(pred || null);
    } catch (error) {
      res.status(500).json({ message: "Failed to get active prediction" });
    }
  });

  app.get("/api/predictions", requireAuth, async (req: Request, res: Response) => {
    try {
      const preds = await storage.getUserPredictions(req.session.userId!);
      res.json(preds);
    } catch (error) {
      res.status(500).json({ message: "Failed to get predictions" });
    }
  });

  app.post("/api/spin", requireAuth, async (req: Request, res: Response) => {
    try {
      const result = await spinWheel(req.session.userId!);

      const user = await storage.getUser(req.session.userId!);
      const isPaidTier = user && user.tier !== "FREE" && user.subscriptionExpiry && new Date(user.subscriptionExpiry) > new Date();

      res.json({
        reward: result.reward,
        coinsAwarded: result.coinsAwarded,
        energyAwarded: result.energyAwarded,
        sliceLabel: result.label,
        sliceIndex: result.sliceIndex,
        prizeTier: result.tier,
        lockedPrize: result.lockedPrize || false,
        spinTicketsRemaining: isPaidTier ? user!.spinTickets : undefined,
        spinsRemaining: !isPaidTier ? user?.spinsRemaining : undefined,
      });
    } catch (error: any) {
      if (error.message.includes("No spin") || error.message.includes("User not found")) {
        return res.status(400).json({ message: error.message });
      }
      res.status(500).json({ message: "Failed to spin wheel" });
    }
  });

  app.get("/api/wheel-history", requireAuth, async (req: Request, res: Response) => {
    try {
      const history = await storage.getUserWheelHistory(req.session.userId!);
      res.json(history);
    } catch (error) {
      res.status(500).json({ message: "Failed to get wheel history" });
    }
  });

  app.get("/api/wheel-status", requireAuth, async (_req: Request, res: Response) => {
    res.json({ locked: false, referralCount: 0, requiredCount: 0, message: "Wheel feature is disabled" });
  });

  app.get("/api/referral-status", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user) return res.status(404).json({ message: "User not found" });

      if (!user.referralCode) {
        await storage.generateReferralCode(user.id);
      }
      const updatedUser = await storage.getUser(user.id);

      const paidCount = await storage.getPaidReferralCount(user.id);
      const referred = await storage.getReferredUsers(user.id);
      const config = await storage.getGlobalConfig();

      res.json({
        referralCode: updatedUser?.referralCode || "",
        paidReferralCount: paidCount,
        totalReferrals: referred.length,
        totalReferralEarnings: updatedUser?.totalReferralEarnings || 0,
        perFriendReward: config.referral_reward_amount ?? 1,
        squad: referred.slice(0, 20).map(r => ({
          username: r.username,
          tier: r.tier,
          isPaid: r.subscriptionExpiry ? new Date(r.subscriptionExpiry) > new Date() : false,
          joinedAt: r.subscriptionStartedAt,
        })),
      });
    } catch (error: any) {
      log(`Referral status error: ${error.message}`);
      res.status(500).json({ message: "Failed to get referral status" });
    }
  });

  app.get("/api/leaderboard/referrals", requireAuth, async (req: Request, res: Response) => {
    try {
      const topReferrers = await storage.getTopReferrers(20);
      res.json(topReferrers);
    } catch (error) {
      res.status(500).json({ message: "Failed to get referral leaderboard" });
    }
  });

  const DEPOSIT_ADDRESSES: Record<string, string> = {
    ton: "UQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAJKZ",
    trc20: "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb",
  };

  app.get("/api/wallet", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user) return res.status(404).json({ message: "User not found" });

      res.json({
        balance: user.walletBalance,
        addresses: DEPOSIT_ADDRESSES,
      });
    } catch (error: any) {
      res.status(500).json({ message: "Failed to get wallet info" });
    }
  });

  app.get("/api/deposits", requireAuth, async (req: Request, res: Response) => {
    try {
      const deposits = await storage.getUserDeposits(req.session.userId!);
      res.json(deposits);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to get deposits" });
    }
  });

  const FLAT_WITHDRAWAL_FEE = 0.50;
  const MIN_WITHDRAWAL = 5.00;

  app.post("/api/withdraw", requireAuth, async (req: Request, res: Response) => {
    try {
      const { amount, toWallet, network } = req.body;

      const user = await storage.getUser(req.session.userId!);
      if (!user) return res.status(404).json({ message: "User not found" });

      const withdrawAmount = parseFloat(amount);
      if (isNaN(withdrawAmount) || withdrawAmount < MIN_WITHDRAWAL) {
        return res.status(400).json({ message: `Minimum withdrawal is $${MIN_WITHDRAWAL} USDT` });
      }

      if (!toWallet || typeof toWallet !== "string" || toWallet.trim().length < 10) {
        return res.status(400).json({ message: "A valid wallet address is required" });
      }

      if (withdrawAmount > user.walletBalance) {
        return res.status(400).json({ message: "Insufficient wallet balance" });
      }

      const feeAmount = FLAT_WITHDRAWAL_FEE;
      const netAmount = parseFloat((withdrawAmount - feeAmount).toFixed(4));

      if (netAmount <= 0) {
        return res.status(400).json({ message: "Withdrawal amount too small after fee deduction" });
      }

      const balanceBefore = user.walletBalance;
      const balanceAfter = parseFloat((balanceBefore - withdrawAmount).toFixed(4));

      const botCheck = await detectBotPattern(user.id);
      const initialStatus = botCheck.suspicious ? "flagged" : "pending_audit";

      const withdrawal = await storage.createWithdrawal({
        userId: user.id,
        grossAmount: withdrawAmount.toFixed(4),
        feeAmount: feeAmount.toFixed(4),
        netAmount: netAmount.toFixed(4),
        feePercent: "0.00",
        toWallet: toWallet.trim(),
        network: network || "TON",
        tierAtTime: user.tier,
      });

      if (botCheck.suspicious) {
        await storage.updateWithdrawalStatus(withdrawal.id, "flagged");
      } else {
        await storage.updateWithdrawalStatus(withdrawal.id, "pending_audit");
      }

      await storage.updateUser(user.id, {
        walletBalance: balanceAfter,
      });

      await recordLedgerEntry({
        userId: user.id,
        entryType: "withdrawal_request",
        direction: "debit",
        amount: withdrawAmount,
        currency: "USDT",
        balanceBefore,
        balanceAfter,
        refId: withdrawal.id,
        note: `Withdrawal: $${withdrawAmount} from wallet (flat fee: $${feeAmount}, net payout: $${netAmount}) to ${toWallet.trim()} (${network || "TON"}) — status: ${initialStatus}`,
      });

      await recordLedgerEntry({
        userId: user.id,
        entryType: "withdrawal_fee",
        direction: "debit",
        amount: feeAmount,
        currency: "USDT",
        balanceBefore: balanceAfter,
        balanceAfter: balanceAfter,
        refId: withdrawal.id,
        note: `Flat withdrawal fee: $${feeAmount} USDT deducted from gross $${withdrawAmount}`,
      });

      await recordLedgerEntry({
        userId: user.id,
        entryType: "withdrawal_net",
        direction: "debit",
        amount: netAmount,
        currency: "USDT",
        balanceBefore: balanceAfter,
        balanceAfter: balanceAfter,
        refId: withdrawal.id,
        note: `Net payout: $${netAmount} queued for ${toWallet.trim()} (${network || "TON"}) — 24hr audit period`,
      });

      const statusMessage = botCheck.suspicious
        ? `Withdrawal flagged for manual review. An admin will review your request.`
        : `Withdrawal of $${netAmount} USDT (after $${feeAmount} fee) submitted. 24-hour audit period before processing.`;

      res.json({
        withdrawalId: withdrawal.id,
        grossAmount: withdrawAmount,
        feeAmount,
        netAmount,
        status: initialStatus,
        auditExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        message: statusMessage,
      });
    } catch (error: any) {
      log(`Withdrawal error: ${error.message}`);
      res.status(500).json({ message: "Failed to process withdrawal" });
    }
  });

  app.get("/api/withdrawals", requireAuth, async (req: Request, res: Response) => {
    try {
      const history = await storage.getUserWithdrawals(req.session.userId!);
      res.json(history);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to get withdrawal history" });
    }
  });

  app.get("/api/withdrawal-fees", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user) return res.status(404).json({ message: "User not found" });

      res.json({
        currentTier: user.tier,
        flatFee: FLAT_WITHDRAWAL_FEE,
        minWithdrawal: MIN_WITHDRAWAL,
        auditPeriodHours: 24,
      });
    } catch (error: any) {
      res.status(500).json({ message: "Failed to get fee info" });
    }
  });

  app.post("/api/admin/distribute-leaderboard-rewards", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { leaderboardType, rewards } = req.body;

      if (!leaderboardType || !["coins", "predictions", "wheel"].includes(leaderboardType)) {
        return res.status(400).json({ message: "Invalid leaderboard type" });
      }
      if (!rewards || !Array.isArray(rewards) || rewards.length === 0) {
        return res.status(400).json({ message: "Rewards array is required" });
      }

      const gameMap: Record<string, string> = { coins: "tapPot", predictions: "predictPot", wheel: "wheelVault" };
      const results = [];

      for (const reward of rewards) {
        const { userId, amount } = reward;
        if (!userId || !amount || parseFloat(amount) <= 0) continue;

        const rewardAmount = parseFloat(amount);
        const user = await storage.getUser(userId);
        if (!user) continue;

        const walletBefore = user.walletBalance;
        const walletAfter = parseFloat((walletBefore + rewardAmount).toFixed(4));

        await storage.updateUser(userId, { walletBalance: walletAfter });

        await recordLedgerEntry({
          userId,
          entryType: "leaderboard_reward",
          direction: "credit",
          amount: rewardAmount,
          currency: "USDT",
          balanceBefore: walletBefore,
          balanceAfter: walletAfter,
          game: gameMap[leaderboardType],
          note: `Leaderboard reward: $${rewardAmount} USDT for ${leaderboardType} ranking`,
        });

        results.push({ userId, username: user.username, amount: rewardAmount });
      }

      res.json({ distributed: results.length, rewards: results });
    } catch (error: any) {
      log(`Leaderboard reward error: ${error.message}`);
      res.status(500).json({ message: "Failed to distribute rewards" });
    }
  });

  app.post("/api/admin/approve-withdrawal", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { withdrawalId, action } = req.body;
      if (!withdrawalId || !["approve", "reject"].includes(action)) {
        return res.status(400).json({ message: "withdrawalId and action (approve/reject) are required" });
      }

      const withdrawal = await storage.getWithdrawal(withdrawalId);
      if (!withdrawal) {
        return res.status(404).json({ message: "Withdrawal not found" });
      }

      if (!["flagged", "pending_audit"].includes(withdrawal.status)) {
        return res.status(400).json({ message: `Cannot ${action} a withdrawal with status: ${withdrawal.status}` });
      }

      const createdAt = new Date(withdrawal.createdAt).getTime();
      const auditPeriodMs = 24 * 60 * 60 * 1000;
      const auditExpired = Date.now() >= createdAt + auditPeriodMs;

      if (action === "approve" && withdrawal.status === "pending_audit" && !auditExpired) {
        const hoursLeft = ((createdAt + auditPeriodMs - Date.now()) / (1000 * 60 * 60)).toFixed(1);
        return res.status(400).json({
          message: `24-hour audit period not yet complete. ${hoursLeft} hours remaining. Use 'reject' to cancel early, or wait.`,
        });
      }

      const user = await storage.getUser(withdrawal.userId);

      if (action === "approve") {
        await storage.updateWithdrawalStatus(withdrawalId, "approved");

        await recordLedgerEntry({
          userId: withdrawal.userId,
          entryType: "withdrawal_completed",
          direction: "debit",
          amount: parseFloat(withdrawal.netAmount),
          currency: "USDT",
          balanceBefore: user?.walletBalance || 0,
          balanceAfter: user?.walletBalance || 0,
          refId: withdrawalId,
          note: `Withdrawal approved: $${withdrawal.netAmount} USDT released to ${withdrawal.toWallet} (fee: $${withdrawal.feeAmount})`,
        });

        res.json({ message: "Withdrawal approved", withdrawalId, status: "approved" });
      } else {
        if (user) {
          const refundAmount = parseFloat(withdrawal.grossAmount);
          const balanceBefore = user.walletBalance;
          const balanceAfter = parseFloat((balanceBefore + refundAmount).toFixed(4));

          await storage.updateUser(withdrawal.userId, {
            walletBalance: balanceAfter,
          });

          await recordLedgerEntry({
            userId: withdrawal.userId,
            entryType: "withdrawal_rejected",
            direction: "credit",
            amount: refundAmount,
            currency: "USDT",
            balanceBefore,
            balanceAfter,
            refId: withdrawalId,
            note: `Withdrawal rejected: $${withdrawal.grossAmount} USDT (gross) refunded to wallet. Original fee ($${withdrawal.feeAmount}) and net ($${withdrawal.netAmount}) entries reversed.`,
          });
        }

        await storage.updateWithdrawalStatus(withdrawalId, "rejected");
        res.json({ message: "Withdrawal rejected and refunded", withdrawalId, status: "rejected" });
      }
    } catch (error: any) {
      log(`Admin withdrawal error: ${error.message}`);
      res.status(500).json({ message: "Failed to process withdrawal action" });
    }
  });

  app.get("/api/admin/pending-withdrawals", requireAdmin, async (req: Request, res: Response) => {
    try {
      const pending = await storage.getPendingWithdrawals();
      res.json(pending);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to get pending withdrawals" });
    }
  });

  app.get("/api/admin/pulse", requireAdmin, async (req: Request, res: Response) => {
    try {
      const pulse = await storage.getAdminPulse();
      res.json(pulse);
    } catch (error: any) {
      log(`Admin pulse error: ${error.message}`);
      res.status(500).json({ message: "Failed to get admin pulse" });
    }
  });

  app.get("/api/admin/global-config", requireAdmin, async (req: Request, res: Response) => {
    try {
      const config = await storage.getAllGlobalConfig();
      const rollovers = await storage.getAllTierRollovers();
      res.json({ config, rollovers });
    } catch (error: any) {
      log(`Global config fetch error: ${error.message}`);
      res.status(500).json({ message: "Failed to get global config" });
    }
  });

  app.post("/api/admin/global-config", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { key, value, description } = req.body;
      if (!key || value === undefined || value === null) {
        return res.status(400).json({ message: "key and value are required" });
      }
      const numValue = parseFloat(value);
      const shareKeys = ["prediction_share", "tap_share", "wheel_share", "admin_split", "treasury_split"];
      const spinKeys = ["spins_free", "spins_bronze", "spins_silver", "spins_gold"];
      const hourKeys = ["audit_delay_hours", "expiry_warning_hours"];
      const allowedKeys = [...shareKeys, ...spinKeys, ...hourKeys];
      if (!allowedKeys.includes(key)) {
        return res.status(400).json({ message: `key must be one of: ${allowedKeys.join(", ")}` });
      }
      if (shareKeys.includes(key) && (isNaN(numValue) || numValue < 0 || numValue > 1)) {
        return res.status(400).json({ message: "Share values must be between 0 and 1" });
      }
      if (spinKeys.includes(key) && (isNaN(numValue) || numValue < 0 || numValue > 100 || !Number.isInteger(numValue))) {
        return res.status(400).json({ message: "Spin allocations must be whole numbers between 0 and 100" });
      }
      if (hourKeys.includes(key) && (isNaN(numValue) || numValue < 0 || numValue > 720)) {
        return res.status(400).json({ message: "Hour values must be between 0 and 720" });
      }
      const updated = await storage.setGlobalConfigValue(key, numValue, description);
      log(`[Admin] Global config updated: ${key} = ${numValue}`);
      res.json(updated);
    } catch (error: any) {
      log(`Global config update error: ${error.message}`);
      res.status(500).json({ message: "Failed to update global config" });
    }
  });

  app.post("/api/admin/trigger-oracle-settlement", requireAdmin, async (req: Request, res: Response) => {
    try {
      const result = await settleAllTiers();
      res.json(result);
    } catch (error: any) {
      log(`Manual oracle settlement error: ${error.message}`);
      res.status(500).json({ message: `Oracle settlement failed: ${error.message}` });
    }
  });

  app.post("/api/admin/trigger-tap-settlement", requireAdmin, async (req: Request, res: Response) => {
    try {
      await midnightPulse();
      res.json({ message: "Tap settlement (midnight pulse) triggered successfully" });
    } catch (error: any) {
      log(`Manual tap settlement error: ${error.message}`);
      res.status(500).json({ message: `Tap settlement failed: ${error.message}` });
    }
  });

  app.post("/api/admin/seed-vault", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { tier, amount } = req.body;
      if (!tier || !amount) {
        return res.status(400).json({ message: "tier and amount are required" });
      }
      const validTiers = ["BRONZE", "SILVER", "GOLD"];
      const normalizedTier = tier.toUpperCase();
      if (!validTiers.includes(normalizedTier)) {
        return res.status(400).json({ message: `tier must be one of: ${validTiers.join(", ")}` });
      }
      const seedAmount = parseFloat(amount);
      if (isNaN(seedAmount) || seedAmount <= 0 || seedAmount > 1000) {
        return res.status(400).json({ message: "amount must be between 0.01 and 1000" });
      }
      const vault = await storage.addToJackpotVault(normalizedTier, seedAmount);
      log(`[Admin] Vault seeded: ${normalizedTier} +$${seedAmount} (new balance: $${vault.totalBalance})`);
      res.json({
        message: `${normalizedTier} vault seeded with $${seedAmount.toFixed(2)}`,
        newBalance: vault.totalBalance,
        tier: normalizedTier,
      });
    } catch (error: any) {
      log(`Admin vault seed error: ${error.message}`);
      res.status(500).json({ message: "Failed to seed vault" });
    }
  });

  app.get("/api/admin/telegram/status", requireAdmin, async (req: Request, res: Response) => {
    try {
      const botInfo = await getBotInfo();
      const newsRow = await storage.getGlobalConfigRow("telegram_news_channel_id");
      const lobbyRow = await storage.getGlobalConfigRow("telegram_lobby_group_id");
      const apexRow = await storage.getGlobalConfigRow("telegram_apex_group_id");
      res.json({
        connected: !!botInfo,
        bot: botInfo ? { username: botInfo.username, name: botInfo.first_name } : null,
        channels: {
          news: newsRow?.description || null,
          lobby: lobbyRow?.description || null,
          apex: apexRow?.description || null,
        },
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/telegram/detect-chats", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { detected } = await detectChatIds();
      res.json({ detected, message: `Found ${detected.length} chat(s). Use /api/admin/telegram/set-chat to assign them.` });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/telegram/set-chat", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { role, chatId } = req.body;
      const validRoles: Record<string, string> = {
        news: "telegram_news_channel_id",
        lobby: "telegram_lobby_group_id",
        apex: "telegram_apex_group_id",
      };
      if (!validRoles[role]) {
        return res.status(400).json({ message: "role must be 'news', 'lobby', or 'apex'" });
      }
      if (!chatId) {
        return res.status(400).json({ message: "chatId is required" });
      }
      await storage.setGlobalConfigValue(validRoles[role], 0, String(chatId));
      log(`[Admin] Telegram ${role} chat ID set to ${chatId}`);
      res.json({ message: `${role} chat ID set to ${chatId}` });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/telegram/send", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { target, message } = req.body;
      if (!target || !message) {
        return res.status(400).json({ message: "target (news/lobby/apex) and message are required" });
      }
      let sent = false;
      if (target === "news") sent = await sendToNewsChannel(message);
      else if (target === "lobby") sent = await sendToLobby(message);
      else if (target === "apex") sent = await sendToApex(message);
      else return res.status(400).json({ message: "target must be 'news', 'lobby', or 'apex'" });

      res.json({ sent, message: sent ? "Message sent" : "Failed to send — check bot config" });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/telegram/announce-leaderboard", requireAdmin, async (req: Request, res: Response) => {
    try {
      const topCoins = await storage.getTopUsersByCoins(5);
      const topPredictions = await storage.getTopUsersByPredictions(5);

      await announceLeaderboard("Watts", topCoins.map(u => ({ username: u.username, value: u.totalCoins })));
      await announceLeaderboard("Predictions", topPredictions.map(u => ({ username: u.username, value: u.correctPredictions })), "count");

      res.json({ message: "Leaderboard announcements sent" });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/leaderboard/:type", async (req: Request, res: Response) => {
    try {
      const { type } = req.params;
      const tier = req.query.tier as string | undefined;
      const validTiers = ["FREE", "BRONZE", "SILVER", "GOLD"];
      const tierFilter = tier && validTiers.includes(tier.toUpperCase()) ? tier.toUpperCase() : undefined;
      let leaderboard;

      switch (type) {
        case "coins":
          leaderboard = await storage.getTopUsersByCoins(50, tierFilter);
          break;
        case "predictions":
          leaderboard = await storage.getTopUsersByPredictions(50, tierFilter);
          break;
        case "wheel":
          leaderboard = await storage.getTopUsersByWheelWinnings(50, tierFilter);
          break;
        default:
          return res.status(400).json({ message: "Invalid leaderboard type" });
      }

      res.json(leaderboard);
    } catch (error) {
      res.status(500).json({ message: "Failed to get leaderboard" });
    }
  });

  let lastOracleSettlementAt = 0;
  const ORACLE_COOLDOWN_MS = 10 * 60 * 1000;

  async function runOracleSettlement() {
    try {
      const now = Date.now();
      if (now - lastOracleSettlementAt < ORACLE_COOLDOWN_MS) {
        return;
      }

      const unresolved = await storage.getUnresolvedPredictions();
      const ripe = unresolved.filter(p => {
        const age = (now - new Date(p.createdAt).getTime()) / (1000 * 60 * 60);
        return age >= 12;
      });

      if (ripe.length === 0 && unresolved.length === 0) {
        return;
      }

      if (ripe.length === 0) {
        return;
      }

      const result = await settleAllTiers();
      lastOracleSettlementAt = Date.now();
      log(`[Oracle] Settlement run complete: ${result.btcResult}, $${result.totalDistributed.toFixed(4)} distributed across ${result.tiers.length} tiers`);
    } catch (error: any) {
      log(`[Oracle] Settlement error: ${error.message}`);
    }
  }

  setInterval(runOracleSettlement, 5 * 60 * 1000);
  setTimeout(runOracleSettlement, 10000);

  setInterval(expireStaleAllocations, 24 * 60 * 60 * 1000);
  setTimeout(expireStaleAllocations, 30000);

  setInterval(processDailyDrip, 24 * 60 * 60 * 1000);
  setTimeout(processDailyDrip, 15000);

  setInterval(midnightPulse, 24 * 60 * 60 * 1000);
  setTimeout(midnightPulse, 20000);

  setInterval(batchWithdrawalSettlement, 24 * 60 * 60 * 1000);
  setTimeout(batchWithdrawalSettlement, 25000);

  setInterval(subscriberRetentionCheck, 24 * 60 * 60 * 1000);
  setTimeout(subscriberRetentionCheck, 35000);

  function scheduleAtUTC(hourUTC: number, minuteUTC: number, label: string, fn: () => Promise<void>) {
    const now = new Date();
    let next = new Date(now);
    next.setUTCHours(hourUTC, minuteUTC, 0, 0);
    if (next <= now) {
      next.setUTCDate(next.getUTCDate() + 1);
    }
    const ms = next.getTime() - now.getTime();
    log(`[Promo] ${label} scheduled for ${next.toUTCString()} (${Math.round(ms / 60000)} min from now)`);

    const run = async () => {
      try {
        await fn();
        log(`[Promo] ${label} sent successfully`);
      } catch (err: any) {
        log(`[Promo] ${label} error: ${err.message}`);
      }
      scheduleAtUTC(hourUTC, minuteUTC, label, fn);
    };
    setTimeout(run, ms);
  }

  const miniAppUrl = process.env.REPLIT_DEV_DOMAIN
    ? `https://${process.env.REPLIT_DEV_DOMAIN}`
    : (process.env.REPL_SLUG ? `https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co` : "https://vault60.app");

  async function gatherTapPotData(): Promise<{ tierName: string; potSize: number }[]> {
    const allTiers = await storage.getAllTiers();
    const results: { tierName: string; potSize: number }[] = [];

    for (const tier of allTiers) {
      if (tier.name === "FREE") continue;
      const tapAllocations = await storage.getActivePoolAllocations(tier.name, "tapPot");
      const pot = parseFloat(
        tapAllocations.reduce((sum, a) => sum + parseFloat(a.dailyAmount), 0).toFixed(4)
      );
      if (pot > 0) results.push({ tierName: tier.name, potSize: pot });
    }
    return results;
  }

  async function gatherInactiveAndTopData(): Promise<{ inactivePct: number; topEarnerEstimate: number }> {
    const { getLeagueMultiplier } = await import("./constants/leagues");
    const now = new Date();
    const dateKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}`;
    const allTiers = await storage.getAllTiers();

    let totalPaidSubs = 0;
    const activeUserIds = new Set<string>();
    let bestEstimate = 0;

    for (const tier of allTiers) {
      if (tier.name === "FREE") continue;
      const subs = await storage.getActiveSubscribersByTier(tier.name);
      totalPaidSubs += subs.length;
      if (subs.length === 0) continue;

      const tapAllocations = await storage.getActivePoolAllocations(tier.name, "tapPot");
      const tapPot = parseFloat(
        tapAllocations.reduce((sum, a) => sum + parseFloat(a.dailyAmount), 0).toFixed(4)
      );

      const dailyTaps = await storage.getDailyTapsForDate(dateKey);
      const tierTaps = dailyTaps.filter(dt => dt.tierAtTime === tier.name && subs.some(s => s.id === dt.userId));

      const uniqueTierTappers = new Set(tierTaps.map(dt => dt.userId));
      uniqueTierTappers.forEach(id => activeUserIds.add(id));

      let weightedTotalCoins = 0;
      const entriesWithWeight: Array<{ coins: number; weight: number }> = [];
      for (const entry of tierTaps) {
        const user = await storage.getUser(entry.userId);
        if (!user) continue;
        const leagueMultiplier = getLeagueMultiplier(user.league);
        const weight = entry.coinsEarned * leagueMultiplier;
        weightedTotalCoins += weight;
        entriesWithWeight.push({ coins: entry.coinsEarned, weight });
      }

      if (weightedTotalCoins > 0 && entriesWithWeight.length > 0) {
        const topWeight = Math.max(...entriesWithWeight.map(e => e.weight));
        const topShare = topWeight / weightedTotalCoins;
        const topPayout = tapPot * topShare;
        if (topPayout > bestEstimate) bestEstimate = topPayout;
      }
    }

    const inactivePct = totalPaidSubs > 0 ? Math.round(((totalPaidSubs - activeUserIds.size) / totalPaidSubs) * 100) : 0;
    return { inactivePct: Math.max(0, inactivePct), topEarnerEstimate: bestEstimate };
  }

  async function gatherPredictionPotData(): Promise<{ pots: { tierName: string; potSize: number }[]; higherPct: number; lowerPct: number; totalVotes: number }> {
    const allTiers = await storage.getAllTiers();
    const pots: { tierName: string; potSize: number }[] = [];
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setUTCHours(0, 0, 0, 0);

    for (const tier of allTiers) {
      if (tier.name === "FREE") continue;
      const predictAllocations = await storage.getActivePoolAllocations(tier.name, "predictPot");
      const pot = parseFloat(
        predictAllocations.reduce((sum, a) => sum + parseFloat(a.dailyAmount), 0).toFixed(4)
      );
      if (pot > 0) pots.push({ tierName: tier.name, potSize: pot });
    }

    const recentPredictions = await db.select().from(predictions).where(gte(predictions.createdAt, todayStart));
    const totalVotes = recentPredictions.length;
    const higherCount = recentPredictions.filter(p => p.prediction === "higher").length;
    const lowerCount = totalVotes - higherCount;
    const higherPct = totalVotes > 0 ? Math.round((higherCount / totalVotes) * 100) : 0;
    const lowerPct = totalVotes > 0 ? 100 - higherPct : 0;

    return { pots, higherPct, lowerPct, totalVotes };
  }

  async function gatherTierMultipliers(): Promise<{ tierName: string; maxMultiplier: number }[]> {
    const allTiers = await storage.getAllTiers();
    const results: { tierName: string; maxMultiplier: number }[] = [];
    for (const tier of allTiers) {
      if (tier.name === "FREE") continue;
      const maxUpgrade = TIER_MAX_UPGRADE[tier.name] ?? 1;
      const tierBaseMultiplier = tier.tapMultiplier ?? 1;
      const maxEffective = maxUpgrade * tierBaseMultiplier;
      results.push({ tierName: tier.name, maxMultiplier: maxEffective });
    }
    return results;
  }

  scheduleAtUTC(8, 0, "Morning Alpha (8AM UTC)", async () => {
    try {
      const priceData = await getBtcPrice();
      await announceMorningAlpha(priceData.price, priceData.change24h, miniAppUrl);
    } catch (err: any) {
      log(`[Promo] Morning Alpha failed to fetch BTC price: ${err.message}`);
    }
  });

  scheduleAtUTC(10, 0, "Oracle Warning (10AM UTC)", async () => {
    const { pots, higherPct, lowerPct, totalVotes } = await gatherPredictionPotData();
    await announceOracleWarning(pots, higherPct, lowerPct, totalVotes, miniAppUrl);
  });

  scheduleAtUTC(14, 0, "Tier Gap Push (2PM UTC)", async () => {
    const tierMultipliers = await gatherTierMultipliers();
    await announceTierGap(tierMultipliers, miniAppUrl);
  });

  scheduleAtUTC(20, 0, "FOMO Countdown (8PM UTC)", async () => {
    const potData = await gatherTapPotData();
    await announceFomoCountdown(potData, miniAppUrl);
  });

  scheduleAtUTC(22, 0, "Math-Warrior Hype (10PM UTC)", async () => {
    const { inactivePct, topEarnerEstimate } = await gatherInactiveAndTopData();
    await announceMathWarrior(inactivePct, topEarnerEstimate, miniAppUrl);
  });

  scheduleAtUTC(23, 30, "Last Call (11:30PM UTC)", async () => {
    await announceLastCall(miniAppUrl);
  });

  app.get("/api/tiers", async (_req: Request, res: Response) => {
    try {
      const allTiers = await storage.getAllTiers();
      res.json(allTiers);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to get tiers" });
    }
  });

  app.post("/api/subscribe", requireAuth, async (req: Request, res: Response) => {
    try {
      const { txHash, tierName, senderAddress } = req.body;

      if (!txHash || typeof txHash !== "string" || txHash.trim().length < 10) {
        return res.status(400).json({ message: "A valid transaction hash is required" });
      }
      if (!tierName || !["BRONZE", "SILVER", "GOLD"].includes(String(tierName).toUpperCase())) {
        return res.status(400).json({ message: "Valid tier name is required (BRONZE, SILVER, GOLD)" });
      }

      if (senderAddress && typeof senderAddress === "string") {
        const walletCheck = await checkWalletUnique(senderAddress.trim(), req.session.userId!);
        if (!walletCheck.unique) {
          return res.status(409).json({ message: walletCheck.reason });
        }
        await storage.updateUser(req.session.userId!, { tonWalletAddress: senderAddress.trim() });
      }

      const sanitizedTxHash = txHash.trim();
      const existingTx = await storage.getTransactionByTxHash(sanitizedTxHash);
      if (existingTx) {
        return res.status(409).json({ message: "This transaction has already been processed" });
      }

      const normalizedTier = String(tierName).toUpperCase();
      const tierPrices: Record<string, number> = { BRONZE: 5, SILVER: 15, GOLD: 50 };
      const verifiedAmount = tierPrices[normalizedTier];

      const result = await processSubscriptionPayment(
        req.session.userId!,
        sanitizedTxHash,
        normalizedTier,
        verifiedAmount
      );

      const paidUser = await storage.getUser(req.session.userId!);
      if (paidUser?.referredBy) {
        try {
          await checkAndAwardMilestones(paidUser.referredBy, paidUser.id, sanitizedTxHash);
        } catch (err: any) {
          log(`Referral milestone check error after subscription: ${err.message}`);
        }
      }

      let apexInviteLink: string | null = null;
      if (paidUser) {
        try {
          apexInviteLink = await generateApexInviteLink();
          if (apexInviteLink) {
            log(`[Apex] Generated invite link for ${paidUser.username} (${normalizedTier})`);
            await announceNewSubscriber(paidUser.username || paidUser.email, normalizedTier);
          }
          if (paidUser.telegramId && apexInviteLink) {
            await sendDirectMessage(
              paidUser.telegramId,
              `Welcome to <b>Vault60 Apex</b>!\n\nYour ${normalizedTier} subscription is active. Join the private group:\n${apexInviteLink}\n\nThis link is single-use — don't share it.`
            );
          }
        } catch (err: any) {
          log(`[Apex] Invite generation error: ${err.message}`);
        }
      }

      res.json({ ...result, apexInviteLink });
    } catch (error: any) {
      log(`Subscription error: ${error.message}`);
      res.status(500).json({ message: error.message || "Failed to process subscription" });
    }
  });

  app.get("/api/pools", async (_req: Request, res: Response) => {
    try {
      const pools = await getAllTierPools();
      res.json(pools);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to get pool data" });
    }
  });

  app.get("/api/pools/:tier", async (req: Request, res: Response) => {
    try {
      const tier = req.params.tier as string;
      const validTiers = ["BRONZE", "SILVER", "GOLD"];
      if (!validTiers.includes(tier.toUpperCase())) {
        return res.status(400).json({ message: "Invalid tier. Must be BRONZE, SILVER, or GOLD" });
      }
      const pool = await getActivePools(tier);
      res.json(pool);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to get pool data" });
    }
  });

  app.get("/api/jackpot", async (_req: Request, res: Response) => {
    try {
      const vaults = await storage.getAllJackpotVaults();
      res.json(vaults);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to get jackpot data" });
    }
  });

  app.get("/api/my-subscription", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user) return res.status(404).json({ message: "User not found" });

      const isActive = user.subscriptionExpiry && new Date(user.subscriptionExpiry) > new Date();

      const ticketsExpired = user.spinTicketsExpiry && new Date(user.spinTicketsExpiry) <= new Date();

      let isProRated = false;
      let proRateNote = "";
      if (isActive && user.subscriptionStartedAt) {
        const startedAt = new Date(user.subscriptionStartedAt);
        const startOfToday = new Date();
        startOfToday.setUTCHours(0, 0, 0, 0);
        const endOfToday = new Date(startOfToday);
        endOfToday.setUTCHours(23, 59, 59, 999);
        if (startedAt >= startOfToday && startedAt <= endOfToday) {
          isProRated = true;
          const minutesLeft = Math.max(0, (endOfToday.getTime() - startedAt.getTime()) / (1000 * 60));
          const hoursLeft = Math.round(minutesLeft / 60);
          if (hoursLeft < 24) {
            proRateNote = `Since you joined mid-day, your rewards for the next ${hoursLeft} hours are pro-rated. Full 24-hour pools unlock at Midnight UTC.`;
          }
        }
      }

      res.json({
        tier: user.tier,
        isActive: !!isActive,
        subscriptionExpiry: user.subscriptionExpiry,
        subscriptionStartedAt: user.subscriptionStartedAt,
        isFounder: user.isFounder,
        isProRated,
        proRateNote,
        spinTickets: ticketsExpired ? 0 : user.spinTickets,
        spinTicketsExpiry: user.spinTicketsExpiry,
      });
    } catch (error: any) {
      res.status(500).json({ message: "Failed to get subscription info" });
    }
  });

  app.get("/api/my-ledger", requireAuth, async (req: Request, res: Response) => {
    try {
      const limit = Math.min(Math.max(1, Number(req.query.limit) || 50), 200);
      const entries = await getUserLedger(req.session.userId!, limit);
      res.json(entries);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to get ledger" });
    }
  });

  app.get("/api/my-ledger/verify", requireAuth, async (req: Request, res: Response) => {
    try {
      const result = await verifyLedgerIntegrity(req.session.userId!);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to verify ledger" });
    }
  });

  app.get("/api/my-transactions", requireAuth, async (req: Request, res: Response) => {
    try {
      const txs = await storage.getUserTransactions(req.session.userId!);
      res.json(txs);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to get transactions" });
    }
  });

  app.post("/api/payments/invoice", requireAuth, async (req: Request, res: Response) => {
    try {
      const { tierName } = req.body;
      if (!tierName || !["BRONZE", "SILVER", "GOLD"].includes(String(tierName).toUpperCase())) {
        return res.status(400).json({ message: "Valid tier name is required (BRONZE, SILVER, GOLD)" });
      }

      const normalizedTier = String(tierName).toUpperCase();
      if (normalizedTier === "SILVER" || normalizedTier === "GOLD") {
        return res.status(400).json({ message: "This tier is not available yet" });
      }

      const invoice = await createInvoice(req.session.userId!, normalizedTier);
      res.json(invoice);
    } catch (error: any) {
      log(`Payment invoice error: ${error.message}`);
      res.status(500).json({ message: error.message || "Failed to create payment invoice" });
    }
  });

  app.post("/api/payments/webhook", async (req: Request, res: Response) => {
    try {
      requireSecretConfigured();

      const signature = req.headers["x-ton-signature"] as string;
      if (!signature) {
        return res.status(401).json({ message: "Missing signature header" });
      }

      const rawBody = (req as any).rawBody || JSON.stringify(req.body);
      if (!verifySignature(signature, rawBody)) {
        log(`[TON Pay Webhook] Invalid signature rejected`);
        return res.status(401).json({ message: "Invalid signature" });
      }

      const { event, data } = req.body;
      if (event !== "invoice.paid") {
        log(`[TON Pay Webhook] Ignoring event: ${event}`);
        return res.sendStatus(200);
      }

      const { invoiceId, txHash } = data;
      if (!invoiceId || !txHash) {
        return res.status(400).json({ message: "Missing invoiceId or txHash in webhook payload" });
      }

      const result = await processWebhookPayment(invoiceId, txHash);
      log(`[TON Pay Webhook] Processed: ${JSON.stringify(result)}`);
      res.sendStatus(200);
    } catch (error: any) {
      log(`[TON Pay Webhook] Error: ${error.message}`);
      res.status(400).json({ message: error.message });
    }
  });

  app.post("/api/payments/sandbox-confirm", requireAuth, async (req: Request, res: Response) => {
    try {
      const { invoiceId } = req.body;
      if (!invoiceId || typeof invoiceId !== "string") {
        return res.status(400).json({ message: "Invoice ID is required" });
      }

      const result = await sandboxConfirmInvoice(invoiceId, req.session.userId!);

      let apexInviteLink: string | null = null;
      const sandboxUser = await storage.getUser(req.session.userId!);
      if (sandboxUser && sandboxUser.tier !== "FREE") {
        try {
          apexInviteLink = await generateApexInviteLink();
          if (apexInviteLink) {
            log(`[Apex] Generated invite link for ${sandboxUser.username} (${sandboxUser.tier}) via sandbox`);
            await announceNewSubscriber(sandboxUser.username || sandboxUser.email, sandboxUser.tier);
          }
          if (sandboxUser.telegramId && apexInviteLink) {
            await sendDirectMessage(
              sandboxUser.telegramId,
              `Welcome to <b>Vault60 Apex</b>!\n\nYour ${sandboxUser.tier} subscription is active. Join the private group:\n${apexInviteLink}\n\nThis link is single-use — don't share it.`
            );
          }
        } catch (err: any) {
          log(`[Apex] Sandbox invite error: ${err.message}`);
        }
      }

      res.json({ ...result, apexInviteLink });
    } catch (error: any) {
      log(`Sandbox confirm error: ${error.message}`);
      res.status(400).json({ message: error.message || "Failed to confirm sandbox payment" });
    }
  });

  app.get("/api/payments/config", async (_req: Request, res: Response) => {
    try {
      const config = await getPaymentConfig();
      res.json(config);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to get payment config" });
    }
  });

  app.get("/api/payments/invoices", requireAuth, async (req: Request, res: Response) => {
    try {
      const invoices = await storage.getUserPaymentInvoices(req.session.userId!);
      res.json(invoices);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to get payment invoices" });
    }
  });

  app.get("/api/tasks", requireAuth, async (req: Request, res: Response) => {
    try {
      const allTasks = await storage.getAllActiveTasks();
      const userCompletions = await storage.getUserTaskCompletions(req.session.userId!);
      const todayDate = new Date().toISOString().split("T")[0];
      const user = await storage.getUser(req.session.userId!);

      const tasksWithStatus = allTasks.map(task => {
        let completed = false;
        if (task.taskType === "one_time") {
          completed = userCompletions.some(uc => uc.taskId === task.id);
        } else if (task.taskType === "daily") {
          completed = userCompletions.some(uc => uc.taskId === task.id && uc.date === todayDate);
        }
        const tierLocked = task.requiredTier ? !isTierSufficient(user?.tier || "FREE", task.requiredTier) : false;
        return { ...task, completed, tierLocked };
      });

      res.json(tasksWithStatus);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to fetch tasks" });
    }
  });

  const TELEGRAM_TASK_CHAT_MAP: Record<string, string> = {
    "join-telegram": "telegram_news_channel_id",
    "join-lobby": "telegram_lobby_group_id",
  };

  app.post("/api/tasks/:taskId/claim", requireAuth, async (req: Request, res: Response) => {
    try {
      const { taskId } = req.params;
      const userId = req.session.userId!;
      const user = await storage.getUser(userId);
      if (!user) return res.status(404).json({ message: "User not found" });

      const task = await storage.getTaskById(taskId);
      if (!task || !task.active) return res.status(404).json({ message: "Task not found" });

      if (task.requiredTier && !isTierSufficient(user.tier, task.requiredTier)) {
        return res.status(403).json({ message: `Requires ${task.requiredTier} tier or higher` });
      }

      const todayDate = new Date().toISOString().split("T")[0];
      const dateCheck = task.taskType === "daily" ? todayDate : undefined;
      const alreadyDone = await storage.hasUserCompletedTask(userId, taskId, dateCheck);
      if (alreadyDone) {
        return res.status(400).json({ message: "Task already completed" });
      }

      const telegramChatKey = TELEGRAM_TASK_CHAT_MAP[task.slug];
      if (telegramChatKey) {
        if (!user.telegramId) {
          return res.status(400).json({ message: "Link your Telegram account first to verify membership" });
        }
        const { isMember, status } = await checkTelegramMembership(user.telegramId, telegramChatKey);
        if (status === "chat_not_configured") {
          log(`[Tasks] Skipping verification for "${task.slug}" — chat ID not configured`);
        } else if (!isMember) {
          const chatName = task.slug === "join-telegram" ? "the News channel" : "the Lobby group";
          return res.status(400).json({
            message: `You must join ${chatName} first. Please join via the link, then try claiming again.`,
            verificationFailed: true,
          });
        }
      }

      await storage.completeTask(userId, taskId, dateCheck);

      const newCoins = user.totalCoins + task.rewardCoins;
      const newLeague = computeLeague(newCoins);
      await storage.updateUser(userId, { totalCoins: newCoins, league: newLeague });

      await recordLedgerEntry({
        userId,
        entryType: "task_reward",
        direction: "credit",
        amount: task.rewardCoins,
        currency: "COINS",
        balanceBefore: user.totalCoins,
        balanceAfter: newCoins,
        game: "tasks",
        note: `Task completed: ${task.title} (+${task.rewardCoins} W)`,
      });

      res.json({ success: true, coinsAwarded: task.rewardCoins, newTotal: newCoins, league: newLeague });
    } catch (error: any) {
      log(`Task claim error: ${error.message}`);
      res.status(500).json({ message: "Failed to claim task reward" });
    }
  });

  app.get("/api/daily-combo", requireAuth, async (req: Request, res: Response) => {
    try {
      const todayDate = new Date().toISOString().split("T")[0];
      let combo = await storage.getDailyComboForDate(todayDate);

      if (!combo) {
        const words = ["BITCOIN", "HODL", "MOON", "STAKE", "DEFI", "NFT", "WHALE", "LAMBO", "PUMP", "BULL",
          "CHAIN", "BLOCK", "HASH", "NODE", "MINE", "TOKEN", "YIELD", "SWAP", "LAYER", "GAS"];
        const shuffled = words.sort(() => Math.random() - 0.5);
        const code = shuffled.slice(0, 3).join("-");
        const hints = [
          `First word starts with "${code.split("-")[0][0]}"`,
          `Three crypto words separated by dashes`,
          `${code.length} characters total`,
        ];
        combo = await storage.createDailyCombo({
          date: todayDate,
          code,
          rewardCoins: 1000000,
          hint: hints[Math.floor(Math.random() * hints.length)],
        });
      }

      const userId = req.session.userId!;
      const attempt = await storage.getUserComboAttempt(userId, combo.id);

      const now = new Date();
      const endOfDay = new Date(now);
      endOfDay.setUTCHours(23, 59, 59, 999);
      const secondsRemaining = Math.max(0, Math.floor((endOfDay.getTime() - now.getTime()) / 1000));

      res.json({
        date: combo.date,
        hint: combo.hint,
        rewardCoins: combo.rewardCoins,
        codeLength: combo.code.split("-").length,
        solved: attempt?.solved || false,
        attempts: attempt?.attempts || 0,
        secondsRemaining,
      });
    } catch (error: any) {
      res.status(500).json({ message: "Failed to fetch daily combo" });
    }
  });

  app.post("/api/daily-combo/solve", requireAuth, async (req: Request, res: Response) => {
    try {
      const { code } = req.body;
      if (!code || typeof code !== "string") {
        return res.status(400).json({ message: "Code is required" });
      }

      const userId = req.session.userId!;
      const user = await storage.getUser(userId);
      if (!user) return res.status(404).json({ message: "User not found" });

      const todayDate = new Date().toISOString().split("T")[0];
      const combo = await storage.getDailyComboForDate(todayDate);
      if (!combo) return res.status(404).json({ message: "No combo available today" });

      const existingAttempt = await storage.getUserComboAttempt(userId, combo.id);
      if (existingAttempt?.solved) {
        return res.status(400).json({ message: "Already solved today's combo" });
      }

      const isCorrect = code.toUpperCase().trim() === combo.code.toUpperCase();
      await storage.createOrUpdateComboAttempt(userId, combo.id, isCorrect);

      if (isCorrect) {
        const newCoins = user.totalCoins + combo.rewardCoins;
        const newLeague = computeLeague(newCoins);
        await storage.updateUser(userId, { totalCoins: newCoins, league: newLeague });

        await recordLedgerEntry({
          userId,
          entryType: "daily_combo",
          direction: "credit",
          amount: combo.rewardCoins,
          currency: "COINS",
          balanceBefore: user.totalCoins,
          balanceAfter: newCoins,
          game: "combo",
          note: `Daily combo solved! (+${combo.rewardCoins} W)`,
        });

        return res.json({ correct: true, coinsAwarded: combo.rewardCoins, newTotal: newCoins, league: newLeague });
      }

      res.json({ correct: false, message: "Incorrect code. Try again!" });
    } catch (error: any) {
      log(`Daily combo error: ${error.message}`);
      res.status(500).json({ message: "Failed to solve combo" });
    }
  });

  app.get("/api/leagues", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user) return res.status(404).json({ message: "User not found" });

      const currentLeague = computeLeague(user.totalCoins);
      if (currentLeague !== user.league) {
        await storage.updateUser(user.id, { league: currentLeague });
      }

      const currentIdx = LEAGUE_THRESHOLDS.findIndex(l => l.name === currentLeague);
      const nextLeague = currentIdx < LEAGUE_THRESHOLDS.length - 1 ? LEAGUE_THRESHOLDS[currentIdx + 1] : null;
      const progress = nextLeague
        ? Math.min(100, ((user.totalCoins - LEAGUE_THRESHOLDS[currentIdx].minCoins) / (nextLeague.minCoins - LEAGUE_THRESHOLDS[currentIdx].minCoins)) * 100)
        : 100;

      res.json({
        leagues: LEAGUE_THRESHOLDS,
        currentLeague,
        currentMultiplier: getLeagueMultiplier(currentLeague),
        totalCoins: user.totalCoins,
        nextLeague: nextLeague ? { name: nextLeague.name, minCoins: nextLeague.minCoins, multiplier: nextLeague.payoutMultiplier } : null,
        progress: Math.round(progress * 10) / 10,
        coinsToNext: nextLeague ? Math.max(0, nextLeague.minCoins - user.totalCoins) : 0,
      });
    } catch (error: any) {
      res.status(500).json({ message: "Failed to fetch league info" });
    }
  });

  async function seedTasks() {
    const taskDefinitions = [
      { slug: "join-telegram", title: "Join Vault60 News", description: "Join our announcement channel for daily BTC predictions, leaderboard legends, and lucky wheel winners", category: "social", taskType: "one_time", rewardCoins: 5000, requiredTier: null, link: "https://t.me/Vault60News", icon: "Megaphone", sortOrder: 1 },
      { slug: "join-lobby", title: "Join Vault60 Lobby", description: "Join our public community group to chat, ask questions, and share referral milestones", category: "social", taskType: "one_time", rewardCoins: 7500, requiredTier: null, link: "https://t.me/Vault60Lobby", icon: "MessageCircle", sortOrder: 2 },
      { slug: "follow-x", title: "Follow on X", description: "Follow our official X (Twitter) account", category: "social", taskType: "one_time", rewardCoins: 10000, requiredTier: null, link: "https://x.com/cryptogames", icon: "Twitter", sortOrder: 3 },
      { slug: "subscribe-youtube", title: "Subscribe on YouTube", description: "Subscribe to our YouTube channel for tutorials and updates", category: "social", taskType: "one_time", rewardCoins: 15000, requiredTier: null, link: "https://youtube.com/@cryptogames", icon: "Youtube", sortOrder: 4 },
      { slug: "verify-bronze", title: "Verify Bronze Status", description: "Subscribe to Bronze tier to unlock this exclusive bonus", category: "pro", taskType: "one_time", rewardCoins: 100000, requiredTier: "BRONZE", link: null, icon: "Shield", sortOrder: 5 },
      { slug: "verify-silver", title: "Verify Silver Status", description: "Subscribe to Silver tier for a massive watts bonus", category: "pro", taskType: "one_time", rewardCoins: 250000, requiredTier: "SILVER", link: null, icon: "Crown", sortOrder: 6 },
      { slug: "verify-gold", title: "Verify Gold Status", description: "Subscribe to Gold tier for the ultimate watts bonus", category: "pro", taskType: "one_time", rewardCoins: 500000, requiredTier: "GOLD", link: null, icon: "Star", sortOrder: 7 },
      { slug: "daily-share", title: "Share Daily Winnings", description: "Share your daily winning screenshot on X", category: "daily", taskType: "daily", rewardCoins: 20000, requiredTier: null, link: null, icon: "Share2", sortOrder: 8 },
      { slug: "daily-invite", title: "Invite 3 Friends", description: "Invite 3 friends to join today", category: "daily", taskType: "daily", rewardCoins: 50000, requiredTier: null, link: null, icon: "Users", sortOrder: 9 },
      { slug: "daily-tap-1000", title: "Crank 1,000 Times", description: "Generate at least 1,000 watts from cranking today", category: "daily", taskType: "daily", rewardCoins: 5000, requiredTier: null, link: null, icon: "Zap", sortOrder: 10 },
      { slug: "daily-prediction", title: "Make a Prediction", description: "Submit a BTC price prediction today", category: "daily", taskType: "daily", rewardCoins: 3000, requiredTier: null, link: null, icon: "TrendingUp", sortOrder: 11 },
    ];

    for (const t of taskDefinitions) {
      await storage.upsertTask(t as any);
    }
    log("Task definitions seeded/updated");
  }

  async function seedTiers() {
    try {
      const tierData = [
        { name: "FREE", price: "0.00", dailyUnit: "0.00", tapMultiplier: 1, energyRefillRateMs: 2000, freeRefillsPerDay: 0, refillCooldownMs: null as number | null },
        { name: "BRONZE", price: "5.00", dailyUnit: "0.10", tapMultiplier: 1, energyRefillRateMs: 2000, freeRefillsPerDay: 1, refillCooldownMs: 86400000 as number | null },
        { name: "SILVER", price: "15.00", dailyUnit: "0.30", tapMultiplier: 3, energyRefillRateMs: 1000, freeRefillsPerDay: 2, refillCooldownMs: 43200000 as number | null },
        { name: "GOLD", price: "50.00", dailyUnit: "1.00", tapMultiplier: 10, energyRefillRateMs: 1000, freeRefillsPerDay: 5, refillCooldownMs: 17280000 as number | null },
      ];

      const existingTiers = await storage.getAllTiers();

      if (existingTiers.length === 0) {
        for (const tier of tierData) {
          await storage.createTier(tier);
        }
        log("Tier data seeded successfully (Free/Bronze/Silver/Gold)");
      } else {
        let updated = 0;
        for (const tier of tierData) {
          const existing = existingTiers.find((t) => t.name === tier.name);
          if (existing) {
            const needsUpdate =
              existing.energyRefillRateMs !== tier.energyRefillRateMs ||
              existing.refillCooldownMs !== tier.refillCooldownMs;
            if (needsUpdate) {
              await storage.updateTier(tier.name, {
                energyRefillRateMs: tier.energyRefillRateMs,
                refillCooldownMs: tier.refillCooldownMs,
              });
              updated++;
            }
          }
        }
        if (updated > 0) {
          log(`Tier config updated for ${updated} tier(s)`);
        }
      }
    } catch (error: any) {
      log(`Tier seed error: ${error.message}`);
    }
  }

  async function seedGlobalConfig() {
    try {
      const existing = await storage.getGlobalConfig();
      if (!existing.prediction_share) {
        await storage.setGlobalConfigValue("prediction_share", 0, "Percentage of daily unit allocated to prediction pot (disabled)");
      }
      if (!existing.tap_share) {
        await storage.setGlobalConfigValue("tap_share", 1.0, "Percentage of daily unit allocated to tap pot");
      }
      if (!existing.wheel_share) {
        await storage.setGlobalConfigValue("wheel_share", 0, "Percentage of daily unit allocated to wheel vault (disabled)");
      }
      if (!existing.admin_split) {
        await storage.setGlobalConfigValue("admin_split", 0.40, "Admin profit share of subscription payments (0-1)");
      }
      if (!existing.treasury_split) {
        await storage.setGlobalConfigValue("treasury_split", 0.60, "Game treasury share of subscription payments (0-1)");
      }
      if (!existing.audit_delay_hours) {
        await storage.setGlobalConfigValue("audit_delay_hours", 24, "Hours to hold withdrawals in audit before promoting to ready");
      }
      if (!existing.expiry_warning_hours) {
        await storage.setGlobalConfigValue("expiry_warning_hours", 48, "Hours before subscription expiry to send warning notification");
      }
      if (!existing.spins_free) {
        await storage.setGlobalConfigValue("spins_free", 0, "Monthly spin allocation for Free tier users (wheel disabled)");
      }
      if (!existing.spins_bronze) {
        await storage.setGlobalConfigValue("spins_bronze", 0, "Monthly spin allocation for Bronze tier subscribers (wheel disabled)");
      }
      if (!existing.spins_silver) {
        await storage.setGlobalConfigValue("spins_silver", 0, "Monthly spin allocation for Silver tier subscribers (wheel disabled)");
      }
      if (!existing.spins_gold) {
        await storage.setGlobalConfigValue("spins_gold", 0, "Monthly spin allocation for Gold tier subscribers (wheel disabled)");
      }
      if (!existing.wheel_unlock_bronze) {
        await storage.setGlobalConfigValue("wheel_unlock_bronze", 0, "Paid referrals required for Bronze to unlock wheel (wheel disabled)");
      }
      if (!existing.wheel_unlock_silver) {
        await storage.setGlobalConfigValue("wheel_unlock_silver", 0, "Paid referrals required for Silver to unlock wheel (wheel disabled)");
      }
      if (!existing.wheel_unlock_gold) {
        await storage.setGlobalConfigValue("wheel_unlock_gold", 0, "Paid referrals required for Gold to unlock wheel (wheel disabled)");
      }
      if (!existing.referral_reward_amount) {
        await storage.setGlobalConfigValue("referral_reward_amount", 1, "USDT reward per referral subscription payment (deducted from treasury share)");
      }

      const allTiers = await storage.getAllTiers();
      for (const tier of allTiers) {
        if (tier.name === "FREE") continue;
        const rollover = await storage.getTierRollover(tier.name);
        if (rollover === 0) {
          await storage.setTierRollover(tier.name, 0);
        }
      }

      log("Global config and tier rollovers seeded");
    } catch (error: any) {
      log(`Global config seed error: ${error.message}`);
    }
  }

  async function seedReferralMilestones() {
    try {
      log("Referral milestones: skipped (milestone bonuses disabled)");
    } catch (error: any) {
      log(`Referral milestones seed error: ${error.message}`);
    }
  }

  async function seedData() {
    try {
      await seedTiers();
      await seedTasks();
      await seedGlobalConfig();
      await seedReferralMilestones();
      await initTelegramBot();

      const existingUsers = await storage.getTopUsersByCoins(1);
      if (existingUsers.length > 0) return;

      const seedUsers = [
        { username: "CryptoKing", email: "cryptoking@demo.local", totalCoins: 15420, correctPredictions: 0, totalPredictions: 0, totalWheelWinnings: 0, totalSpins: 0 },
        { username: "MoonShot", email: "moonshot@demo.local", totalCoins: 12800, correctPredictions: 0, totalPredictions: 0, totalWheelWinnings: 0, totalSpins: 0 },
        { username: "DiamondHands", email: "diamondhands@demo.local", totalCoins: 9500, correctPredictions: 0, totalPredictions: 0, totalWheelWinnings: 0, totalSpins: 0 },
        { username: "SatoshiFan", email: "satoshifan@demo.local", totalCoins: 7200, correctPredictions: 0, totalPredictions: 0, totalWheelWinnings: 0, totalSpins: 0 },
        { username: "BlockRunner", email: "blockrunner@demo.local", totalCoins: 5800, correctPredictions: 0, totalPredictions: 0, totalWheelWinnings: 0, totalSpins: 0 },
      ];

      for (const userData of seedUsers) {
        const user = await storage.createUser({ username: userData.username, email: userData.email });
        await storage.updateUser(user.id, {
          totalCoins: userData.totalCoins,
          correctPredictions: userData.correctPredictions,
          totalPredictions: userData.totalPredictions,
          totalWheelWinnings: userData.totalWheelWinnings,
          totalSpins: userData.totalSpins,
          energy: 1000,
          spinsRemaining: 0,
        });
      }

      log("Seed data created successfully");
    } catch (error: any) {
      log(`Seed data error: ${error.message}`);
    }
  }

  seedData();

  return httpServer;
}
