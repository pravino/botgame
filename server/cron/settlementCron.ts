import { storage, db } from "../storage";
import { log } from "../index";
import { recordLedgerEntry } from "../middleware/ledger";
import { getValidatedBTCPriceWithRetry, clearPriceCache, setPriceFrozen } from "../services/priceService";
import { users } from "@shared/schema";
import { eq, and, gt, lte, sql } from "drizzle-orm";

const TAP_POT_SHARE = 0.50;

export async function midnightPulse(): Promise<void> {
  try {
    const now = new Date();
    const yesterdayDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const dateKey = `${yesterdayDate.getUTCFullYear()}-${String(yesterdayDate.getUTCMonth() + 1).padStart(2, "0")}-${String(yesterdayDate.getUTCDate()).padStart(2, "0")}`;

    log(`[Midnight Pulse] Starting daily settlement for ${dateKey}`);

    const allTiers = await storage.getAllTiers();
    const tierDailyUnits: Record<string, number> = {};
    for (const t of allTiers) {
      tierDailyUnits[t.name] = parseFloat(t.dailyUnit);
    }

    const tierNames = ["BRONZE", "SILVER", "GOLD"];
    let totalDistributed = 0;

    for (const tierName of tierNames) {
      const subscribers = await storage.getActiveSubscribersByTier(tierName);
      if (subscribers.length === 0) continue;

      const dailyUnit = tierDailyUnits[tierName] || 0;

      const startOfSettlementDay = new Date(yesterdayDate);
      startOfSettlementDay.setUTCHours(0, 0, 0, 0);

      let dailyPool = 0;
      const endOfSettlementDay = new Date(startOfSettlementDay);
      endOfSettlementDay.setUTCHours(23, 59, 59, 999);

      for (const sub of subscribers) {
        if (sub.subscriptionStartedAt) {
          const joinedAt = new Date(sub.subscriptionStartedAt);
          if (joinedAt > endOfSettlementDay) {
            continue;
          }
          if (joinedAt >= startOfSettlementDay && joinedAt <= endOfSettlementDay) {
            const minutesActive = Math.max(0, (endOfSettlementDay.getTime() - joinedAt.getTime()) / (1000 * 60));
            const proRatedUnit = (minutesActive / 1440) * dailyUnit;
            dailyPool += parseFloat(proRatedUnit.toFixed(4));
            continue;
          }
        }
        dailyPool += dailyUnit;
      }

      const tapPotAmount = dailyPool * TAP_POT_SHARE;

      if (tapPotAmount <= 0) continue;

      const dailyTapEntries = await storage.getDailyTapsForDate(dateKey);
      const tierTapEntries = dailyTapEntries.filter(dt =>
        dt.tierAtTime === tierName && subscribers.some(s => s.id === dt.userId)
      );

      const totalTaps = tierTapEntries.reduce((sum, dt) => sum + dt.tapsToday, 0);
      if (totalTaps === 0) {
        log(`[Midnight Pulse] ${tierName}: No taps recorded for ${dateKey}, skipping distribution`);
        continue;
      }

      let tierDistributed = 0;

      for (const entry of tierTapEntries) {
        const user = await storage.getUser(entry.userId);
        if (!user) continue;

        const share = entry.tapsToday / totalTaps;
        const payout = parseFloat((tapPotAmount * share).toFixed(4));
        if (payout <= 0) continue;

        const walletBefore = user.walletBalance;
        const walletAfter = parseFloat((walletBefore + payout).toFixed(4));

        await storage.updateUser(user.id, { walletBalance: walletAfter });

        await recordLedgerEntry({
          userId: user.id,
          entryType: "daily_tap_payout",
          direction: "credit",
          amount: payout,
          currency: "USDT",
          balanceBefore: walletBefore,
          balanceAfter: walletAfter,
          game: "tapPot",
          note: `Daily tap payout: $${payout} USDT (${entry.tapsToday}/${totalTaps} taps = ${(share * 100).toFixed(1)}% of $${tapPotAmount.toFixed(2)} ${tierName} pot) for ${dateKey}`,
        });

        tierDistributed += payout;
      }

      log(`[Midnight Pulse] ${tierName}: Distributed $${tierDistributed.toFixed(4)} to ${tierTapEntries.length} users from ${dateKey}`);
      totalDistributed += tierDistributed;
    }

    await storage.truncateDailyTaps(dateKey);
    log(`[Midnight Pulse] Cleared daily_taps for ${dateKey}`);

    await storage.resetAllUserEnergy();
    log(`[Midnight Pulse] Reset energy for all users`);

    clearPriceCache();
    try {
      const validated = await getValidatedBTCPriceWithRetry(5, 300_000);
      setPriceFrozen(false);
      log(`[Midnight Pulse] Locked BTC price at $${validated.price} via ${validated.sources.join(", ")}${validated.median ? " [median]" : ""}`);
    } catch (e: any) {
      setPriceFrozen(true);
      log(`[Midnight Pulse] CRITICAL: BTC price freeze failed after retries. Prediction payouts frozen until price is verified. Error: ${e.message}`);
    }

    log(`[Midnight Pulse] Settlement complete. Total distributed: $${totalDistributed.toFixed(4)}`);
  } catch (error: any) {
    log(`[Midnight Pulse] Error: ${error.message}`);
  }
}

export async function batchWithdrawalSettlement(): Promise<void> {
  try {
    log(`[Batch Settlement] Starting withdrawal batch processing`);

    const pendingAudit = await storage.getPendingWithdrawals();
    const now = Date.now();
    const auditPeriodMs = 24 * 60 * 60 * 1000;
    let promoted = 0;

    for (const w of pendingAudit) {
      if (w.status !== "pending_audit") continue;

      const createdAt = new Date(w.createdAt).getTime();
      if (now >= createdAt + auditPeriodMs) {
        await storage.updateWithdrawalStatus(w.id, "ready");

        const user = await storage.getUser(w.userId);
        await recordLedgerEntry({
          userId: w.userId,
          entryType: "withdrawal_promoted",
          direction: "debit",
          amount: parseFloat(w.netAmount),
          currency: "USDT",
          balanceBefore: user?.walletBalance || 0,
          balanceAfter: user?.walletBalance || 0,
          refId: w.id,
          note: `Withdrawal passed 24hr audit. Status: pending_audit -> ready. Net: $${w.netAmount} queued for batch payout.`,
        });

        promoted++;
      }
    }

    if (promoted > 0) {
      log(`[Batch Settlement] Promoted ${promoted} withdrawals from pending_audit to ready`);
    }

    const readyWithdrawals = await storage.getReadyWithdrawals();
    if (readyWithdrawals.length === 0) {
      log(`[Batch Settlement] No ready withdrawals to batch`);
      return;
    }

    let totalGross = 0;
    let totalFees = 0;
    let totalNet = 0;
    const withdrawalIds: string[] = [];

    for (const w of readyWithdrawals) {
      totalGross += parseFloat(w.grossAmount);
      totalFees += parseFloat(w.feeAmount);
      totalNet += parseFloat(w.netAmount);
      withdrawalIds.push(w.id);

      await storage.updateWithdrawalStatus(w.id, "batched");
    }

    const batch = await storage.createWithdrawalBatch({
      totalWithdrawals: readyWithdrawals.length,
      totalGross: totalGross.toFixed(4),
      totalFees: totalFees.toFixed(4),
      totalNet: totalNet.toFixed(4),
      withdrawalIds: JSON.stringify(withdrawalIds),
    });

    for (const w of readyWithdrawals) {
      const user = await storage.getUser(w.userId);
      await recordLedgerEntry({
        userId: w.userId,
        entryType: "withdrawal_batch",
        direction: "debit",
        amount: parseFloat(w.netAmount),
        currency: "USDT",
        balanceBefore: user?.walletBalance || 0,
        balanceAfter: user?.walletBalance || 0,
        refId: batch.id,
        note: `Withdrawal batched: $${w.netAmount} USDT included in batch ${batch.id} (${readyWithdrawals.length} total). Awaiting TON payout.`,
      });
    }

    log(`[Batch Settlement] Created batch ${batch.id}: ${readyWithdrawals.length} withdrawals, $${totalNet.toFixed(4)} net, $${totalFees.toFixed(4)} fees collected`);
  } catch (error: any) {
    log(`[Batch Settlement] Error: ${error.message}`);
  }
}

export async function subscriberRetentionCheck(): Promise<void> {
  try {
    log(`[Retention] Checking subscription expirations`);

    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const TELEGRAM_GROUP_ID = process.env.TELEGRAM_GROUP_ID;

    const expiringUsers = await storage.getExpiringSubscriptions(48);
    let warningsSent = 0;

    for (const user of expiringUsers) {
      const existingAlert = await storage.getExistingAlert(user.id, "expiry_warning_48h");
      if (existingAlert) continue;

      await storage.createSubscriptionAlert({
        userId: user.id,
        alertType: "expiry_warning_48h",
      });

      await recordLedgerEntry({
        userId: user.id,
        entryType: "subscription_expiry_warning",
        direction: "debit",
        amount: 0,
        currency: "COINS",
        balanceBefore: user.totalCoins,
        balanceAfter: user.totalCoins,
        note: `Subscription expiry warning: ${user.tier} expires in <48 hours. Renewal reminder sent.`,
      });

      if (TELEGRAM_BOT_TOKEN && TELEGRAM_GROUP_ID && user.telegramId) {
        try {
          await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: user.telegramId,
              text: `REMINDER: Your ${user.tier} subscription expires in less than 48 hours.\n\nRenew now to keep your ${user.totalCoins.toLocaleString()} coins and continue earning.\n\nDon't lose your spot!`,
              parse_mode: "HTML",
            }),
          });
          log(`[Retention] Sent 48hr warning to user ${user.id} (${user.username})`);
        } catch (e: any) {
          log(`[Retention] Failed to send Telegram message to ${user.id}: ${e.message}`);
        }
      } else {
        log(`[Retention] 48hr warning flagged for user ${user.id} (${user.username}) — Telegram not configured`);
      }

      warningsSent++;
    }

    const expiredUsers = await storage.getExpiredSubscriptions();
    let kicksProcessed = 0;

    for (const user of expiredUsers) {
      const existingAlert = await storage.getExistingAlert(user.id, "expired_kick");
      if (existingAlert) continue;

      await storage.updateUser(user.id, { tier: "FREE" });

      await storage.createSubscriptionAlert({
        userId: user.id,
        alertType: "expired_kick",
      });

      await recordLedgerEntry({
        userId: user.id,
        entryType: "subscription_expired_kick",
        direction: "debit",
        amount: 0,
        currency: "COINS",
        balanceBefore: user.totalCoins,
        balanceAfter: user.totalCoins,
        note: `Subscription expired: ${user.tier} → FREE. User downgraded.`,
      });

      if (TELEGRAM_BOT_TOKEN && TELEGRAM_GROUP_ID && user.telegramId) {
        try {
          await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/banChatMember`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: TELEGRAM_GROUP_ID,
              user_id: parseInt(user.telegramId),
            }),
          });
          log(`[Retention] Kicked user ${user.id} (${user.username}) from Telegram group — subscription expired`);
        } catch (e: any) {
          log(`[Retention] Failed to kick ${user.id} from Telegram: ${e.message}`);
        }
      } else {
        log(`[Retention] Expired kick flagged for user ${user.id} (${user.username}) — Telegram not configured`);
      }

      kicksProcessed++;
    }

    log(`[Retention] Complete: ${warningsSent} warnings, ${kicksProcessed} expirations processed`);
  } catch (error: any) {
    log(`[Retention] Error: ${error.message}`);
  }
}
