import { storage, db } from "../storage";
import { log } from "../index";
import { recordLedgerEntry } from "../middleware/ledger";
import { getValidatedBTCPriceWithRetry, setPriceFrozen } from "./priceService";
import { announceMegaPot, announcePredictionResults } from "./telegramBot";
import { users } from "@shared/schema";
import { eq, sql } from "drizzle-orm";

export async function settleAllTiers(): Promise<{
  settled: boolean;
  btcResult: "HIGHER" | "LOWER" | "FLAT";
  tiers: Array<{
    tierName: string;
    activeUsers: number;
    dailyAllocation: number;
    rollover: number;
    totalPot: number;
    winnersCount: number;
    sharePerWinner: number;
    newRollover: number;
  }>;
  totalDistributed: number;
}> {
  let btcPrice: number;
  try {
    const validated = await getValidatedBTCPriceWithRetry(5, 300_000);
    btcPrice = validated.price;
    setPriceFrozen(false);
    log(`[Oracle] Locked BTC price at $${btcPrice} via ${validated.sources.join(", ")}${validated.median ? " [median]" : ""}`);
  } catch (e: any) {
    setPriceFrozen(true);
    log(`[Oracle] CRITICAL: BTC price freeze failed. Settlement aborted. Error: ${e.message}`);
    throw new Error("Oracle settlement aborted: BTC price unavailable");
  }

  const allTiers = await storage.getAllTiers();

  const now = new Date();

  const unresolved = await storage.getUnresolvedPredictions();

  let resolvedHigher = 0;
  let resolvedLower = 0;
  let resolvedCount = 0;

  for (const pred of unresolved) {
    const createdAt = new Date(pred.createdAt);
    const hoursSince = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60);

    if (hoursSince >= 12) {
      const correct =
        (pred.prediction === "higher" && btcPrice > pred.btcPriceAtPrediction) ||
        (pred.prediction === "lower" && btcPrice < pred.btcPriceAtPrediction);

      await storage.resolvePrediction(pred.id, btcPrice, correct);
      resolvedCount++;

      const user = await storage.getUser(pred.userId);
      if (user) {
        if (correct) {
          await storage.updateUser(user.id, {
            correctPredictions: user.correctPredictions + 1,
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
            note: `Correct prediction: BTC ${pred.prediction} from $${pred.btcPriceAtPrediction} → $${btcPrice}`,
          });

          if (pred.prediction === "higher") resolvedHigher++;
          else resolvedLower++;
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
            note: `Wrong prediction: BTC ${pred.prediction} from $${pred.btcPriceAtPrediction} → $${btcPrice}`,
          });
        }
      }

      log(`[Oracle] Resolved prediction ${pred.id}: ${correct ? "correct" : "wrong"}`);
    }
  }

  const btcResult: "HIGHER" | "LOWER" | "FLAT" = resolvedHigher > resolvedLower ? "HIGHER" : resolvedLower > resolvedHigher ? "LOWER" : "FLAT";

  log(`[Oracle] BTC result determined: ${btcResult} (${resolvedHigher} higher, ${resolvedLower} lower correct predictions)`);

  if (resolvedCount === 0) {
    log(`[Oracle] No predictions resolved — skipping tier payout processing`);
    return {
      settled: false,
      btcResult,
      tiers: [],
      totalDistributed: 0,
    };
  }

  const tierResults: Array<{
    tierName: string;
    activeUsers: number;
    dailyAllocation: number;
    rollover: number;
    totalPot: number;
    winnersCount: number;
    sharePerWinner: number;
    newRollover: number;
  }> = [];
  let totalDistributed = 0;

  for (const tier of allTiers) {
    if (tier.name === "FREE") continue;

    const tierName = tier.name;

    const subscribers = await storage.getActiveSubscribersByTier(tierName);
    const activeUsers = subscribers.length;

    const predictAllocations = await storage.getActivePoolAllocations(tierName, "predictPot");
    const dailyAllocation = parseFloat(
      predictAllocations.reduce((sum, a) => sum + parseFloat(a.dailyAmount), 0).toFixed(4)
    );

    const rollover = await storage.getTierRollover(tierName);
    const totalPot = parseFloat((dailyAllocation + rollover).toFixed(4));

    if (totalPot <= 0) {
      log(`[Oracle] ${tierName}: No pot to distribute (0 active users or 0 daily unit)`);
      tierResults.push({
        tierName, activeUsers, dailyAllocation, rollover,
        totalPot: 0, winnersCount: 0, sharePerWinner: 0, newRollover: 0,
      });
      continue;
    }

    if (subscribers.length === 0) {
      await storage.setTierRollover(tierName, totalPot);
      log(`[Oracle] ${tierName}: No subscribers, $${totalPot.toFixed(4)} rolled over`);
      await announceMegaPot(tierName, totalPot);
      tierResults.push({
        tierName, activeUsers, dailyAllocation, rollover,
        totalPot, winnersCount: 0, sharePerWinner: 0, newRollover: totalPot,
      });
      continue;
    }

    const subscriberIds = new Set(subscribers.map(s => s.id));

    const recentlyResolved = await storage.getRecentlyResolvedCorrectPredictions(tierName);
    const winners = recentlyResolved.filter(w => subscriberIds.has(w.userId));

    if (winners.length > 0) {
      const sharePerWinner = parseFloat((totalPot / winners.length).toFixed(4));

      for (const winner of winners) {
        const user = await storage.getUser(winner.userId);
        if (!user) continue;

        const walletBefore = user.walletBalance;
        const walletAfter = parseFloat((walletBefore + sharePerWinner).toFixed(4));

        await db.transaction(async (tx) => {
          await tx.update(users)
            .set({ walletBalance: walletAfter })
            .where(eq(users.id, user.id));

          await recordLedgerEntry({
            userId: user.id,
            entryType: "predict_reward",
            direction: "credit",
            amount: sharePerWinner,
            currency: "USDT",
            balanceBefore: walletBefore,
            balanceAfter: walletAfter,
            game: "predictPot",
            refId: winner.predictionId,
            note: `Oracle payout: $${sharePerWinner} USDT (1/${winners.length} share of $${totalPot.toFixed(4)} ${tierName} pot)`,
          }, tx);
        });
      }

      await storage.setTierRollover(tierName, 0);

      log(`[Oracle] ${tierName}: $${totalPot.toFixed(4)} distributed to ${winners.length} winners ($${sharePerWinner}/each). Rollover reset to $0.`);
      totalDistributed += sharePerWinner * winners.length;

      const topWinnerData: Array<{ username: string; payout: number }> = [];
      for (const w of winners.slice(0, 3)) {
        const winUser = await storage.getUser(w.userId);
        topWinnerData.push({
          username: winUser?.username || "Anonymous",
          payout: sharePerWinner,
        });
      }
      await announcePredictionResults(tierName, winners.length, totalPot, topWinnerData);

      tierResults.push({
        tierName, activeUsers, dailyAllocation, rollover,
        totalPot, winnersCount: winners.length, sharePerWinner, newRollover: 0,
      });
    } else {
      await storage.setTierRollover(tierName, totalPot);

      log(`[Oracle] ${tierName}: No winners. $${totalPot.toFixed(4)} rolled over to next settlement.`);
      await announceMegaPot(tierName, totalPot);

      tierResults.push({
        tierName, activeUsers, dailyAllocation, rollover,
        totalPot, winnersCount: 0, sharePerWinner: 0, newRollover: totalPot,
      });
    }
  }

  log(`[Oracle] Settlement complete. Total distributed: $${totalDistributed.toFixed(4)}`);

  return {
    settled: true,
    btcResult,
    tiers: tierResults,
    totalDistributed,
  };
}
