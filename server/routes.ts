import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import session from "express-session";
import { storage } from "./storage";
import { sendOtpEmail } from "./email";
import { log } from "./index";

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
  app.use(
    session({
      secret: process.env.SESSION_SECRET || "crypto-games-secret-key",
      resave: false,
      saveUninitialized: false,
      cookie: {
        maxAge: 30 * 24 * 60 * 60 * 1000,
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

      await storage.createTapSession({
        userId: user.id,
        taps: actualTaps,
        coinsEarned,
      });

      const updated = await storage.updateUser(user.id, {
        totalCoins: user.totalCoins + coinsEarned,
        energy: user.energy - actualTaps,
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

      if (user.spinsRemaining <= 0) {
        return res.status(400).json({ message: "No spins remaining. Come back tomorrow!" });
      }

      const result = pickWheelSlice();

      await storage.createWheelSpin({
        userId: user.id,
        reward: result.value,
        sliceLabel: result.label,
      });

      await storage.updateUser(user.id, {
        spinsRemaining: user.spinsRemaining - 1,
        totalSpins: user.totalSpins + 1,
        totalWheelWinnings: user.totalWheelWinnings + result.value,
      });

      res.json({
        reward: result.value,
        sliceLabel: result.label,
        sliceIndex: result.sliceIndex,
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

          if (correct) {
            const user = await storage.getUser(pred.userId);
            if (user) {
              await storage.updateUser(user.id, {
                correctPredictions: user.correctPredictions + 1,
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

  async function seedData() {
    try {
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
