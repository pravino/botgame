import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { storage } from "./storage";
import { sendOtpEmail } from "./email";
import { log } from "./index";
import { processSubscriptionPayment } from "./middleware/transactionSplit";
import { getActivePools, getAllTierPools, expireStaleAllocations, processDailyDrip } from "./middleware/poolLogic";
import { recordLedgerEntry, getUserLedger, verifyLedgerIntegrity } from "./middleware/ledger";
import { runGuardianChecks, updateCoinsSinceChallenge, resolveChallenge, checkWalletUnique, detectBotPattern } from "./middleware/guardian";
import { midnightPulse, batchWithdrawalSettlement, subscriberRetentionCheck } from "./cron/settlementCron";
import { getValidatedBTCPrice, isPriceFrozen } from "./services/priceService";
import { createInvoice, verifySignature, processWebhookPayment, sandboxConfirmInvoice, getPaymentConfig, requireSecretConfigured } from "./services/paymentService";

const WHEEL_SLICES = [
  { label: "0.10 USDT", value: 0.10, probability: 0.35 },
  { label: "0.25 USDT", value: 0.25, probability: 0.25 },
  { label: "0.50 USDT", value: 0.50, probability: 0.18 },
  { label: "1.00 USDT", value: 1.00, probability: 0.12 },
  { label: "5.00 USDT", value: 5.00, probability: 0.07 },
  { label: "JACKPOT!", value: 100.00, probability: 0.01 },
  { label: "0.10 USDT", value: 0.10, probability: 0.02 },
  { label: "0.50 USDT", value: 0.50, probability: 0.00 },
];

function pickWheelSlice(): { sliceIndex: number; label: string; value: number } {
  const rand = Math.random();
  let cumulative = 0;
  for (let i = 0; i < WHEEL_SLICES.length; i++) {
    cumulative += WHEEL_SLICES[i].probability;
    if (rand < cumulative) {
      return { sliceIndex: i, label: WHEEL_SLICES[i].label, value: WHEEL_SLICES[i].value };
    }
  }
  return { sliceIndex: 0, label: WHEEL_SLICES[0].label, value: WHEEL_SLICES[0].value };
}

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

function generateOtp(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
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

    const lastSpinRefill = new Date(user.lastEnergyRefill);
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const lastRefillDay = new Date(lastSpinRefill.getFullYear(), lastSpinRefill.getMonth(), lastSpinRefill.getDate());

    if (today.getTime() > lastRefillDay.getTime() && user.spinsRemaining < 1) {
      updates.spinsRemaining = 1;
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

  async function requireAdmin(req: Request, res: Response, next: Function) {
    if (!req.session.userId) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    const user = await storage.getUser(req.session.userId);
    if (!user || !ADMIN_EMAILS.includes(user.email.toLowerCase())) {
      return res.status(403).json({ message: "Admin access required" });
    }
    next();
  }

  app.post("/api/send-otp", async (req: Request, res: Response) => {
    try {
      const { email } = req.body;
      if (!email || typeof email !== "string") {
        return res.status(400).json({ message: "Email is required" });
      }

      const trimmedEmail = email.trim().toLowerCase();
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(trimmedEmail)) {
        return res.status(400).json({ message: "Invalid email address" });
      }

      const code = "123456";
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

      await storage.createOtpCode(trimmedEmail, code, expiresAt);

      res.json({ message: "OTP sent successfully" });
    } catch (error: any) {
      log(`Send OTP error: ${error.message}`);
      res.status(500).json({ message: "Failed to send OTP" });
    }
  });

  app.post("/api/verify-otp", async (req: Request, res: Response) => {
    try {
      const { email, code, username } = req.body;
      if (!email || !code) {
        return res.status(400).json({ message: "Email and code are required" });
      }

      const trimmedEmail = email.trim().toLowerCase();
      const trimmedCode = code.trim();

      const otp = await storage.getValidOtp(trimmedEmail, trimmedCode);
      if (!otp) {
        return res.status(400).json({ message: "Invalid or expired code. Please try again." });
      }

      await storage.markOtpUsed(otp.id);

      let user = await storage.getUserByEmail(trimmedEmail);

      if (!user) {
        const displayName = username?.trim().slice(0, 20) || trimmedEmail.split("@")[0];
        user = await storage.createUser({ username: displayName, email: trimmedEmail });
      }

      user = await refillUserResources(user);

      req.session.userId = user!.id;
      res.json(user);
    } catch (error: any) {
      log(`Verify OTP error: ${error.message}`);
      res.status(500).json({ message: "Failed to verify OTP" });
    }
  });

  app.get("/api/user", requireAuth, async (req: Request, res: Response) => {
    try {
      let user = await storage.getUser(req.session.userId!);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      user = await refillUserResources(user);
      const tc = await getTierConfig(user.tier);

      res.json({
        ...user,
        tierConfig: {
          energyRefillRateMs: tc.energyRefillRateMs,
          refillCooldownMs: tc.refillCooldownMs,
          tapMultiplier: tc.tapMultiplier,
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
      const multiplier = tierConfig.tapMultiplier;
      const coinsEarned = actualTaps * multiplier;

      const session = await storage.createTapSession({
        userId: user.id,
        taps: actualTaps,
        coinsEarned,
      });

      const updated = await storage.atomicTap(user.id, coinsEarned, actualTaps, new Date());

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
        note: `${coinsEarned} game coins from ${actualTaps} taps (${multiplier}x ${user.tier} multiplier)`,
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

      if (user.tier === "FREE") {
        return res.json({
          myCoinsToday: 0,
          totalTierCoins: 0,
          mySharePct: 0,
          estimatedUsdt: 0,
          tapPotSize: 0,
          tierName: "FREE",
          tapMultiplier: 1,
        });
      }

      const tierConfig = await getTierConfig(user.tier);
      const allTiers = await storage.getAllTiers();
      const tierData = allTiers.find(t => t.name === user.tier);
      const dailyUnit = tierData ? parseFloat(tierData.dailyUnit) : 0;

      const subscribers = await storage.getActiveSubscribersByTier(user.tier);
      const dailyPool = subscribers.length * dailyUnit;
      const tapPotSize = dailyPool * 0.50;

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
        tapMultiplier: tierConfig.tapMultiplier,
      });
    } catch (error: any) {
      res.status(500).json({ message: "Failed to get estimated earnings" });
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
      const user = await storage.getUser(req.session.userId!);
      if (!user) return res.status(404).json({ message: "User not found" });

      const isPaidTier = user.tier !== "FREE" && user.subscriptionExpiry && new Date(user.subscriptionExpiry) > new Date();
      let canSpin = false;

      if (isPaidTier) {
        const ticketsExpired = user.spinTicketsExpiry && new Date(user.spinTicketsExpiry) <= new Date();
        if (ticketsExpired || user.spinTickets <= 0) {
          return res.status(400).json({ message: "No spin tickets remaining. Renew your subscription!" });
        }
        canSpin = true;
      } else {
        if (user.spinsRemaining <= 0) {
          return res.status(400).json({ message: "No spins remaining. Come back tomorrow!" });
        }
        canSpin = true;
      }

      if (!canSpin) {
        return res.status(400).json({ message: "No spins available" });
      }

      const result = pickWheelSlice();

      const spin = await storage.createWheelSpin({
        userId: user.id,
        reward: result.value,
        sliceLabel: result.label,
      });

      const walletBefore = user.walletBalance;
      const walletAfter = parseFloat((walletBefore + result.value).toFixed(4));

      const updates: any = {
        totalSpins: user.totalSpins + 1,
        totalWheelWinnings: user.totalWheelWinnings + result.value,
        walletBalance: walletAfter,
      };

      if (isPaidTier) {
        updates.spinTickets = user.spinTickets - 1;
      } else {
        updates.spinsRemaining = user.spinsRemaining - 1;
      }

      await storage.updateUser(user.id, updates);

      await recordLedgerEntry({
        userId: user.id,
        entryType: "wheel_win",
        direction: "credit",
        amount: result.value,
        currency: "USDT",
        balanceBefore: walletBefore,
        balanceAfter: walletAfter,
        game: "wheelVault",
        refId: spin?.id,
        note: `Wheel spin win: ${result.label} — $${result.value} credited to wallet`,
      });

      if (isPaidTier) {
        await recordLedgerEntry({
          userId: user.id,
          entryType: "wheel_win",
          direction: "debit",
          amount: 1,
          currency: "TICKETS",
          balanceBefore: user.spinTickets,
          balanceAfter: user.spinTickets - 1,
          game: "wheelVault",
          refId: spin?.id,
          note: "Used 1 spin ticket",
        });
      }

      res.json({
        reward: result.value,
        sliceLabel: result.label,
        sliceIndex: result.sliceIndex,
        spinTicketsRemaining: isPaidTier ? user.spinTickets - 1 : undefined,
        spinsRemaining: !isPaidTier ? user.spinsRemaining - 1 : undefined,
      });
    } catch (error: any) {
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

  async function resolvePredictions() {
    try {
      const unresolved = await storage.getUnresolvedPredictions();
      const now = new Date();

      for (const pred of unresolved) {
        const createdAt = new Date(pred.createdAt);
        const hoursSince = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60);

        if (hoursSince >= 12) {
          const btcData = await getBtcPrice();
          const currentPrice = btcData.price;
          const correct =
            (pred.prediction === "higher" && currentPrice > pred.btcPriceAtPrediction) ||
            (pred.prediction === "lower" && currentPrice < pred.btcPriceAtPrediction);

          await storage.resolvePrediction(pred.id, currentPrice, correct);

          const user = await storage.getUser(pred.userId);
          if (user) {
            const PREDICT_REWARD = 0.10;

            if (correct) {
              const walletBefore = user.walletBalance;
              const walletAfter = parseFloat((walletBefore + PREDICT_REWARD).toFixed(4));

              await storage.updateUser(user.id, {
                correctPredictions: user.correctPredictions + 1,
                walletBalance: walletAfter,
              });

              await recordLedgerEntry({
                userId: user.id,
                entryType: "predict_win",
                direction: "credit",
                amount: 1,
                currency: "COINS",
                balanceBefore: user.correctPredictions,
                balanceAfter: user.correctPredictions + 1,
                game: "predictPot",
                refId: pred.id,
                note: `Correct prediction: BTC ${pred.prediction} from $${pred.btcPriceAtPrediction} → $${currentPrice}`,
              });

              await recordLedgerEntry({
                userId: user.id,
                entryType: "predict_reward",
                direction: "credit",
                amount: PREDICT_REWARD,
                currency: "USDT",
                balanceBefore: walletBefore,
                balanceAfter: walletAfter,
                game: "predictPot",
                refId: pred.id,
                note: `Prediction reward: $${PREDICT_REWARD} USDT credited for correct BTC prediction`,
              });
            } else {
              await recordLedgerEntry({
                userId: user.id,
                entryType: "predict_loss",
                direction: "debit",
                amount: 0,
                currency: "COINS",
                balanceBefore: user.correctPredictions,
                balanceAfter: user.correctPredictions,
                game: "predictPot",
                refId: pred.id,
                note: `Wrong prediction: BTC ${pred.prediction} from $${pred.btcPriceAtPrediction} → $${currentPrice}`,
              });
            }
          }

          log(`Resolved prediction ${pred.id}: ${correct ? "correct" : "wrong"}`);
        }
      }
    } catch (error: any) {
      log(`Error resolving predictions: ${error.message}`);
    }
  }

  setInterval(resolvePredictions, 5 * 60 * 1000);
  setTimeout(resolvePredictions, 10000);

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

      res.json(result);
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

      const invoice = await createInvoice(req.session.userId!, String(tierName).toUpperCase());
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
      res.json(result);
    } catch (error: any) {
      log(`Sandbox confirm error: ${error.message}`);
      res.status(400).json({ message: error.message || "Failed to confirm sandbox payment" });
    }
  });

  app.get("/api/payments/config", async (_req: Request, res: Response) => {
    try {
      const config = getPaymentConfig();
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

  async function seedData() {
    try {
      await seedTiers();

      const existingUsers = await storage.getTopUsersByCoins(1);
      if (existingUsers.length > 0) return;

      const seedUsers = [
        { username: "CryptoKing", email: "cryptoking@demo.local", totalCoins: 15420, correctPredictions: 18, totalPredictions: 25, totalWheelWinnings: 12.50, totalSpins: 8 },
        { username: "MoonShot", email: "moonshot@demo.local", totalCoins: 12800, correctPredictions: 14, totalPredictions: 20, totalWheelWinnings: 8.30, totalSpins: 6 },
        { username: "DiamondHands", email: "diamondhands@demo.local", totalCoins: 9500, correctPredictions: 22, totalPredictions: 30, totalWheelWinnings: 105.10, totalSpins: 12 },
        { username: "SatoshiFan", email: "satoshifan@demo.local", totalCoins: 7200, correctPredictions: 11, totalPredictions: 18, totalWheelWinnings: 3.60, totalSpins: 5 },
        { username: "BlockRunner", email: "blockrunner@demo.local", totalCoins: 5800, correctPredictions: 9, totalPredictions: 15, totalWheelWinnings: 6.20, totalSpins: 7 },
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
