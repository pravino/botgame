import { storage } from "../storage";
import { recordLedgerEntry, ledgerEntryExists } from "../middleware/ledger";
import { log } from "../index";

export async function checkAndAwardMilestones(referrerId: string, newPaidReferralId?: string, paymentRefId?: string): Promise<{
  milestonesReached: string[];
  totalBonusAwarded: number;
}> {
  const user = await storage.getUser(referrerId);
  if (!user) return { milestonesReached: [], totalBonusAwarded: 0 };

  const config = await storage.getGlobalConfig();

  let totalBonusAwarded = 0;
  const milestonesReached: string[] = [];

  if (newPaidReferralId && paymentRefId) {
    const perFriendRefId = `referral_pay_${newPaidReferralId}_${paymentRefId}`;
    const alreadyCredited = await ledgerEntryExists(referrerId, perFriendRefId);

    if (!alreadyCredited) {
      const configReward = config.referral_reward_amount ?? 1;
      const treasurySplit = config.treasury_split ?? 0.60;
      const allTiers = await storage.getAllTiers();
      const paidUserData = await storage.getUser(newPaidReferralId);
      const tierName = paidUserData?.tier || "BRONZE";
      const tierInfo = allTiers.find(t => t.name === tierName);
      const tierPrice = tierInfo ? parseFloat(String(tierInfo.price)) : 5;
      const grossTreasury = tierPrice * treasurySplit;
      const perFriendReward = Math.min(configReward, grossTreasury);
      const freshUser = (await storage.getUser(referrerId))!;
      const walletBefore = freshUser.walletBalance;
      const walletAfter = parseFloat((walletBefore + perFriendReward).toFixed(4));

      await storage.updateUser(referrerId, {
        walletBalance: walletAfter,
        totalReferralEarnings: (freshUser.totalReferralEarnings || 0) + perFriendReward,
      });

      await recordLedgerEntry({
        userId: referrerId,
        entryType: "referral_reward",
        direction: "credit",
        amount: perFriendReward,
        currency: "USDT",
        balanceBefore: walletBefore,
        balanceAfter: walletAfter,
        game: undefined,
        refId: perFriendRefId,
        note: `Referral reward: +$${perFriendReward} USDT for friend ${newPaidReferralId} (payment: ${paymentRefId})`,
      });

      totalBonusAwarded += perFriendReward;
      log(`[Referral] User ${referrerId} earned $${perFriendReward} for referral payment by ${newPaidReferralId} (tx: ${paymentRefId})`);
    }
  }

  return {
    milestonesReached,
    totalBonusAwarded,
  };
}
