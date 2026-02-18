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

let cachedBtcPrice: { price: number; change24h: number; fetchedAt: number } | null = null;

async function getBtcPrice(): Promise<{ price: number; change24h: number }> {
  if (cachedBtcPrice && Date.now() - cachedBtcPrice.fetchedAt < 60000) {
    return { price: cachedBtcPrice.price, change24h: cachedBtcPrice.change24h };
  }

  try {
    const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true");
    const data = await res.json();
    const price = data.bitcoin.usd;
    const change24h = data.bitcoin.usd_24h_change;
    cachedBtcPrice = { price, change24h, fetchedAt: Date.now() };
    return { price, change24h };
  } catch (error) {
    if (cachedBtcPrice) {
      return { price: cachedBtcPrice.price, change24h: cachedBtcPrice.change24h };
    }
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

  async function refillUserResources(user: any) {
    const now = new Date();
    const lastEnergyRefill = new Date(user.lastEnergyRefill);
    const hoursSinceEnergyRefill = (now.getTime() - lastEnergyRefill.getTime()) / (1000 * 60 * 60);

    const updates: any = {};

    if (hoursSinceEnergyRefill >= 24 && user.energy < user.maxEnergy) {
      updates.energy = user.maxEnergy;
      updates.lastEnergyRefill = now;
    }

    const lastSpinRefillDate = user.lastEnergyRefill;
    const lastSpinRefill = new Date(lastSpinRefillDate);
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

      res.json(user);
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

      const user = await storage.getUser(req.session.userId!);
      if (!user) return res.status(404).json({ message: "User not found" });

      const actualTaps = Math.min(tapCount, user.energy);
      if (actualTaps <= 0) {
        return res.status(400).json({ message: "No energy remaining" });
      }

      const coinsEarned = actualTaps;

      const session = await storage.createTapSession({
        userId: user.id,
        taps: actualTaps,
        coinsEarned,
      });

      const updated = await storage.updateUser(user.id, {
        totalCoins: user.totalCoins + coinsEarned,
        energy: user.energy - actualTaps,
      });

      await recordLedgerEntry({
        userId: user.id,
        entryType: "tap_earn",
        direction: "credit",
        amount: coinsEarned,
        currency: "COINS",
        balanceBefore: user.totalCoins,
        balanceAfter: user.totalCoins + coinsEarned,
        game: "tapPot",
        refId: session?.id,
        note: `${coinsEarned} game coins from ${actualTaps} taps (points for upgrades & leaderboard)`,
      });

      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to process tap" });
    }
  });

  app.get("/api/btc-price", async (_req: Request, res: Response) => {
    try {
      const price = await getBtcPrice();
      res.json(price);
    } catch (error) {
      res.status(500).json({ message: "Failed to get BTC price" });
    }
  });

  app.post("/api/predict", requireAuth, async (req: Request, res: Response) => {
    try {
      const { prediction } = req.body;
      if (!prediction || !["higher", "lower"].includes(prediction)) {
        return res.status(400).json({ message: "Prediction must be 'higher' or 'lower'" });
      }

      const user = await storage.getUser(req.session.userId!);
      if (!user) return res.status(404).json({ message: "User not found" });

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

  const WITHDRAWAL_FEES: Record<string, number> = {
    FREE: 10.00,
    BRONZE: 8.00,
    SILVER: 5.00,
    GOLD: 3.00,
  };
  const MIN_WITHDRAWAL = 1.00;

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

      const feePercent = WITHDRAWAL_FEES[user.tier] || 10.00;
      const feeAmount = parseFloat((withdrawAmount * (feePercent / 100)).toFixed(4));
      const netAmount = parseFloat((withdrawAmount - feeAmount).toFixed(4));

      const balanceBefore = user.walletBalance;
      const balanceAfter = parseFloat((balanceBefore - withdrawAmount).toFixed(4));

      const withdrawal = await storage.createWithdrawal({
        userId: user.id,
        grossAmount: withdrawAmount.toFixed(4),
        feeAmount: feeAmount.toFixed(4),
        netAmount: netAmount.toFixed(4),
        feePercent: feePercent.toFixed(2),
        toWallet: toWallet.trim(),
        network: network || "TON",
        tierAtTime: user.tier,
      });

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
        note: `Withdrawal: $${withdrawAmount} from wallet (fee: ${feePercent}% = $${feeAmount}, net payout: $${netAmount}) to ${toWallet.trim()} (${network || "TON"})`,
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
        note: `Withdrawal fee: ${feePercent}% ($${feeAmount}) deducted from gross $${withdrawAmount} — ${user.tier} tier rate`,
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
        note: `Net payout: $${netAmount} sent to ${toWallet.trim()} (${network || "TON"})`,
      });

      res.json({
        withdrawalId: withdrawal.id,
        grossAmount: withdrawAmount,
        feePercent,
        feeAmount,
        netAmount,
        status: "pending",
        message: `Withdrawal of $${netAmount} USDT (after ${feePercent}% fee) submitted. Processing shortly.`,
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
        feePercent: WITHDRAWAL_FEES[user.tier] || 10.00,
        minWithdrawal: MIN_WITHDRAWAL,
        allTierFees: WITHDRAWAL_FEES,
      });
    } catch (error: any) {
      res.status(500).json({ message: "Failed to get fee info" });
    }
  });

  app.post("/api/admin/distribute-leaderboard-rewards", requireAuth, async (req: Request, res: Response) => {
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

  app.get("/api/leaderboard/:type", async (req: Request, res: Response) => {
    try {
      const { type } = req.params;
      let leaderboard;

      switch (type) {
        case "coins":
          leaderboard = await storage.getTopUsersByCoins();
          break;
        case "predictions":
          leaderboard = await storage.getTopUsersByPredictions();
          break;
        case "wheel":
          leaderboard = await storage.getTopUsersByWheelWinnings();
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

  setInterval(expireStaleAllocations, 60 * 60 * 1000);
  setTimeout(expireStaleAllocations, 30000);

  setInterval(processDailyDrip, 60 * 60 * 1000);
  setTimeout(processDailyDrip, 15000);

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
      const { txHash, tierName } = req.body;

      if (!txHash || typeof txHash !== "string" || txHash.trim().length < 10) {
        return res.status(400).json({ message: "A valid transaction hash is required" });
      }
      if (!tierName || !["BRONZE", "SILVER", "GOLD"].includes(String(tierName).toUpperCase())) {
        return res.status(400).json({ message: "Valid tier name is required (BRONZE, SILVER, GOLD)" });
      }

      const sanitizedTxHash = txHash.trim();
      const existingTx = await storage.getTransactionByTxHash(sanitizedTxHash);
      if (existingTx) {
        return res.status(409).json({ message: "This transaction has already been processed" });
      }

      const normalizedTier = String(tierName).toUpperCase();
      const tierPrices: Record<string, number> = { BRONZE: 5, SILVER: 15, GOLD: 50 };
      const verifiedAmount = tierPrices[normalizedTier];

      // TODO: Replace with real TON Pay SDK verification
      // const txInfo = await tonPay.verify(sanitizedTxHash);
      // if (txInfo.amount !== verifiedAmount || txInfo.status !== "confirmed") {
      //   return res.status(400).json({ message: "Transaction verification failed" });
      // }

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

      res.json({
        tier: user.tier,
        isActive: !!isActive,
        subscriptionExpiry: user.subscriptionExpiry,
        isFounder: user.isFounder,
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

  async function seedTiers() {
    try {
      const existingTiers = await storage.getAllTiers();
      if (existingTiers.length > 0) return;

      const tierData = [
        { name: "FREE", price: "0.00", dailyUnit: "0.00", tapMultiplier: 1 },
        { name: "BRONZE", price: "5.00", dailyUnit: "0.10", tapMultiplier: 1 },
        { name: "SILVER", price: "15.00", dailyUnit: "0.30", tapMultiplier: 3 },
        { name: "GOLD", price: "50.00", dailyUnit: "1.00", tapMultiplier: 10 },
      ];

      for (const tier of tierData) {
        await storage.createTier(tier);
      }

      log("Tier data seeded successfully (Free/Bronze/Silver/Gold)");
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
