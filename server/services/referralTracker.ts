import { storage } from "../storage";
import { recordLedgerEntry, ledgerEntryExists } from "../middleware/ledger";
import { log } from "../index";

export async function checkAndAwardMilestones(referrerId: string, newPaidReferralId?: string, paymentRefId?: string): Promise<{
  milestonesReached: string[];
  totalBonusAwarded: number;
  wheelUnlocked: boolean;
}> {
  const user = await storage.getUser(referrerId);
  if (!user) return { milestonesReached: [], totalBonusAwarded: 0, wheelUnlocked: false };

  const paidCount = await storage.getPaidReferralCount(referrerId);
  const milestones = await storage.getAllMilestones();
  const config = await storage.getGlobalConfig();

  const milestonesReached: string[] = [];
  let totalBonusAwarded = 0;
  let wheelShouldUnlock = false;

  if (newPaidReferralId && paymentRefId) {
    const perFriendRefId = `referral_pay_${newPaidReferralId}_${paymentRefId}`;
    const alreadyCredited = await ledgerEntryExists(referrerId, perFriendRefId);

    if (!alreadyCredited) {
      const perFriendReward = milestones.length > 0 ? milestones[0].usdtPerFriend : 1;
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

  for (const milestone of milestones) {
    if (paidCount >= milestone.friendsRequired) {
      const milestoneRefId = `milestone_${milestone.id}`;
      const alreadyAwarded = await ledgerEntryExists(referrerId, milestoneRefId);

      if (milestone.unlocksWheel && !user.wheelUnlocked) {
        wheelShouldUnlock = true;
        if (!alreadyAwarded) {
          milestonesReached.push(milestone.label);
          log(`[Referral] User ${referrerId} reached "${milestone.label}" — wheel unlocked!`);
        }
      }

      if (milestone.bonusUsdt > 0 && !alreadyAwarded) {
        const freshUser = (await storage.getUser(referrerId))!;
        const walletBefore = freshUser.walletBalance;
        const walletAfter = parseFloat((walletBefore + milestone.bonusUsdt).toFixed(4));

        await storage.updateUser(referrerId, {
          walletBalance: walletAfter,
          totalReferralEarnings: freshUser.totalReferralEarnings + milestone.bonusUsdt,
        });

        await recordLedgerEntry({
          userId: referrerId,
          entryType: "referral_milestone_bonus",
          direction: "credit",
          amount: milestone.bonusUsdt,
          currency: "USDT",
          balanceBefore: walletBefore,
          balanceAfter: walletAfter,
          game: undefined,
          refId: milestoneRefId,
          note: `${milestone.label} milestone bonus: +$${milestone.bonusUsdt} USDT (${paidCount} paid referrals)`,
        });

        totalBonusAwarded += milestone.bonusUsdt;
        milestonesReached.push(milestone.label);
        log(`[Referral] User ${referrerId} reached "${milestone.label}" — bonus $${milestone.bonusUsdt} awarded`);
      }
    }
  }

  if (wheelShouldUnlock && !user.wheelUnlocked) {
    await storage.updateUser(referrerId, { wheelUnlocked: true });
  }

  const tierKey = `wheel_unlock_${user.tier.toLowerCase()}`;
  const unlockRequirement = config[tierKey] ?? 5;
  if (!user.wheelUnlocked && (unlockRequirement === 0 || paidCount >= unlockRequirement)) {
    await storage.updateUser(referrerId, { wheelUnlocked: true });
    wheelShouldUnlock = true;
    log(`[Referral] User ${referrerId} met tier-based unlock (${user.tier}: ${unlockRequirement} required, has ${paidCount})`);
  }

  return {
    milestonesReached,
    totalBonusAwarded,
    wheelUnlocked: wheelShouldUnlock || user.wheelUnlocked,
  };
}

export async function getWheelAccessStatus(userId: string): Promise<{
  locked: boolean;
  referralCount: number;
  requiredCount: number;
  message: string;
}> {
  const user = await storage.getUser(userId);
  if (!user) return { locked: true, referralCount: 0, requiredCount: 5, message: "User not found" };

  if (user.wheelUnlocked) {
    return { locked: false, referralCount: 0, requiredCount: 0, message: "Wheel is unlocked!" };
  }

  const isFree = user.tier === "FREE" || !user.subscriptionExpiry || new Date(user.subscriptionExpiry) <= new Date();
  if (isFree) {
    return { locked: false, referralCount: 0, requiredCount: 0, message: "Free tier — limited prizes available" };
  }

  const config = await storage.getGlobalConfig();
  const tierKey = `wheel_unlock_${user.tier.toLowerCase()}`;
  const requiredCount = config[tierKey] ?? 5;

  if (requiredCount === 0) {
    await storage.updateUser(userId, { wheelUnlocked: true });
    return { locked: false, referralCount: 0, requiredCount: 0, message: "Instant access — wheel unlocked!" };
  }

  const referralCount = await storage.getPaidReferralCount(userId);

  if (referralCount >= requiredCount) {
    await storage.updateUser(userId, { wheelUnlocked: true });
    return { locked: false, referralCount, requiredCount, message: "Wheel unlocked!" };
  }

  const needed = requiredCount - referralCount;
  return {
    locked: true,
    referralCount,
    requiredCount,
    message: `Refer ${needed} more paid friend${needed > 1 ? "s" : ""} to unlock the Lucky Wheel!`,
  };
}
