import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, Copy, Check, Gift, Lock, Unlock, DollarSign, Trophy, Star, Zap, ArrowRight, Share2 } from "lucide-react";
import { SiTelegram } from "react-icons/si";
import { useToast } from "@/hooks/use-toast";
import { formatUSD } from "@/lib/game-utils";

const BOT_USERNAME = "Vault60Bot";

type MilestoneData = {
  id: number;
  friendsRequired: number;
  label: string;
  usdtPerFriend: number;
  bonusUsdt: number;
  unlocksWheel: boolean;
  reached: boolean;
};

type SquadMember = {
  username: string;
  tier: string;
  isPaid: boolean;
  joinedAt: string | null;
};

type ReferralStatus = {
  referralCode: string;
  paidReferralCount: number;
  totalReferrals: number;
  totalReferralEarnings: number;
  wheelUnlocked: boolean;
  perFriendReward: number;
  wheelStatus: {
    locked: boolean;
    referralCount: number;
    requiredCount: number;
    message: string;
  };
  milestones: MilestoneData[];
  reachedCount: number;
  nextMilestone: {
    label: string;
    friendsRequired: number;
    remaining: number;
    bonusUsdt: number;
    unlocksWheel: boolean;
  } | null;
  squad: SquadMember[];
};

const TIER_COLORS: Record<string, string> = {
  FREE: "text-muted-foreground",
  BRONZE: "text-amber-600 dark:text-amber-500",
  SILVER: "text-slate-400",
  GOLD: "text-yellow-500",
};

export default function Referrals() {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  const { data, isLoading } = useQuery<ReferralStatus>({
    queryKey: ["/api/referral-status"],
  });

  const referralLink = data?.referralCode ? `https://t.me/${BOT_USERNAME}?start=${data.referralCode}` : "";

  const handleCopy = async () => {
    if (!referralLink) return;
    try {
      await navigator.clipboard.writeText(referralLink);
      setCopied(true);
      toast({ title: "Copied!", description: "Referral link copied to clipboard" });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: "Copy failed", description: "Please copy manually", variant: "destructive" });
    }
  };

  const handleShare = () => {
    if (!referralLink) return;
    const shareText = `Join me on Vault60! Tap, predict & spin to earn crypto rewards.\n${referralLink}`;
    const tgShareUrl = `https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${encodeURIComponent("Join me on Vault60! Tap, predict & spin to earn crypto rewards.")}`;
    if (window.Telegram?.WebApp) {
      window.open(tgShareUrl, "_blank");
    } else if (navigator.share) {
      navigator.share({ title: "Join Vault60", text: shareText }).catch(() => {});
    } else {
      window.open(tgShareUrl, "_blank");
    }
  };

  if (isLoading) {
    return (
      <div className="p-4 md:p-6 space-y-4 max-w-lg mx-auto">
        <Skeleton className="h-8 w-48 mx-auto" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  const perFriendReward = data?.perFriendReward ?? 1;

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-lg mx-auto">
      <div className="text-center space-y-1">
        <h1 className="text-2xl font-bold tracking-tight" data-testid="text-referrals-title">
          Invite Friends
        </h1>
        <p className="text-muted-foreground text-sm">
          Earn real USDT every time a friend subscribes
        </p>
      </div>

      <Card className="border-primary/30">
        <CardContent className="p-5 space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            <DollarSign className="h-5 w-5 text-primary" />
            <span className="font-semibold" data-testid="text-rewards-title">What You Earn</span>
          </div>
          <div className="space-y-3">
            <div className="flex items-start gap-3 p-3 rounded-md bg-primary/5 border border-primary/10">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                <Zap className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="text-sm font-medium" data-testid="text-per-friend-reward">{formatUSD(perFriendReward)} per subscription</p>
                <p className="text-xs text-muted-foreground">
                  Every time a friend subscribes or renews, you earn {formatUSD(perFriendReward)} USDT instantly
                </p>
              </div>
            </div>
            {data?.milestones && data.milestones.length > 0 && (
              <div className="flex items-start gap-3 p-3 rounded-md bg-muted/50 border border-border">
                <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center shrink-0 mt-0.5">
                  <Trophy className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-medium" data-testid="text-milestone-max-bonus">Milestone bonuses up to {formatUSD(data.milestones.reduce((max, m) => Math.max(max, m.bonusUsdt), 0))}</p>
                  <p className="text-xs text-muted-foreground">
                    Hit referral milestones for bonus USDT drops and Lucky Wheel access
                  </p>
                </div>
              </div>
            )}
            <div className="flex items-start gap-3 p-3 rounded-md bg-muted/50 border border-border">
              <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center shrink-0 mt-0.5">
                <Star className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="text-sm font-medium">Recurring rewards</p>
                <p className="text-xs text-muted-foreground">
                  Earn again every time your friend renews their subscription — not just the first time
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-5 space-y-3">
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <SiTelegram className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">Your Referral Link</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex-1 bg-muted rounded-md px-3 py-2.5 text-sm truncate" data-testid="text-referral-link">
              {referralLink || "—"}
            </div>
            <Button
              size="icon"
              variant="outline"
              onClick={handleCopy}
              data-testid="button-copy-link"
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
          <Button
            className="w-full"
            onClick={handleShare}
            data-testid="button-share-referral"
          >
            <Share2 className="h-4 w-4 mr-2" />
            Share with Friends
          </Button>
          <p className="text-xs text-muted-foreground text-center">
            Friends click the link to open the bot and start playing with your referral
          </p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-3 text-center">
            <p className="text-2xl font-bold text-primary" data-testid="text-total-referrals">{data?.totalReferrals ?? 0}</p>
            <p className="text-xs text-muted-foreground">Friends</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <p className="text-2xl font-bold text-primary" data-testid="text-paid-referrals">{data?.paidReferralCount ?? 0}</p>
            <p className="text-xs text-muted-foreground">Subscribed</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <p className="text-2xl font-bold text-primary" data-testid="text-referral-earnings">{formatUSD(data?.totalReferralEarnings ?? 0)}</p>
            <p className="text-xs text-muted-foreground">Earned</p>
          </CardContent>
        </Card>
      </div>

      {data?.wheelStatus && !data.wheelUnlocked && data.wheelStatus.locked && (
        <Card className="border-primary/50">
          <CardContent className="p-5 space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <Lock className="h-5 w-5 text-primary" />
              <span className="font-medium">Wheel Unlock Progress</span>
            </div>
            <p className="text-sm text-muted-foreground">{data.wheelStatus.message}</p>
            <div className="w-full bg-muted rounded-full h-2.5 overflow-hidden">
              <div
                className="bg-primary h-full rounded-full transition-all"
                style={{ width: `${Math.min(100, (data.wheelStatus.referralCount / data.wheelStatus.requiredCount) * 100)}%` }}
              />
            </div>
            <div className="flex items-center justify-between gap-2 flex-wrap text-sm">
              <span className="text-muted-foreground">{data.wheelStatus.referralCount} / {data.wheelStatus.requiredCount} paid friends</span>
              <Badge variant="secondary">{data.wheelStatus.requiredCount - data.wheelStatus.referralCount} more needed</Badge>
            </div>
          </CardContent>
        </Card>
      )}

      {data?.wheelUnlocked && (
        <Card>
          <CardContent className="p-4 flex items-center gap-3 flex-wrap">
            <Unlock className="h-5 w-5 text-green-500" />
            <span className="text-sm font-medium">Lucky Wheel Unlocked</span>
            <Badge variant="default" className="ml-auto">Active</Badge>
          </CardContent>
        </Card>
      )}

      {data?.milestones && data.milestones.length > 0 && (
        <Card>
          <CardContent className="p-5 space-y-4">
            <div className="flex items-center gap-2 flex-wrap">
              <Trophy className="h-4 w-4 text-primary" />
              <span className="font-medium text-sm">Milestones</span>
              <Badge variant="secondary" className="ml-auto" data-testid="text-milestones-count">{data.reachedCount}/{data.milestones.length}</Badge>
            </div>
            <div className="space-y-3">
              {data.milestones.map((m) => (
                <div
                  key={m.id}
                  className={`flex items-center gap-3 p-3 rounded-md border ${m.reached ? "border-primary/30 bg-primary/5" : "border-border"}`}
                  data-testid={`milestone-${m.id}`}
                >
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${m.reached ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                    {m.reached ? <Check className="h-4 w-4" /> : <span className="text-xs font-bold">{m.friendsRequired}</span>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{m.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {m.friendsRequired} paid friend{m.friendsRequired > 1 ? "s" : ""}
                      {m.bonusUsdt > 0 && ` · +${formatUSD(m.bonusUsdt)} bonus`}
                      {m.unlocksWheel && " · Unlocks Wheel"}
                    </p>
                  </div>
                  {m.reached ? (
                    <Badge variant="default" className="shrink-0">
                      <Check className="h-3 w-3" />
                    </Badge>
                  ) : (
                    <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {data?.nextMilestone && (
        <Card>
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Gift className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">Next Milestone</span>
            </div>
            <p className="text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">{data.nextMilestone.label}</span>
              {" — "}
              {data.nextMilestone.remaining} more paid friend{data.nextMilestone.remaining > 1 ? "s" : ""} needed
              {data.nextMilestone.bonusUsdt > 0 && `. Bonus: +${formatUSD(data.nextMilestone.bonusUsdt)} USDT`}
              {data.nextMilestone.unlocksWheel && ". Unlocks Lucky Wheel!"}
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-5 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <Users className="h-4 w-4 text-primary" />
            <span className="font-medium text-sm">Your Friends</span>
            <Badge variant="secondary" className="ml-auto" data-testid="text-friends-count">{data?.squad?.length ?? 0}</Badge>
          </div>
          {data?.squad && data.squad.length > 0 ? (
            <div className="space-y-2">
              {data.squad.map((member, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 p-2.5 rounded-md border border-border"
                  data-testid={`squad-member-${i}`}
                >
                  <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center shrink-0">
                    <span className="text-xs font-bold">{member.username.charAt(0).toUpperCase()}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{member.username}</p>
                    <p className={`text-xs font-medium ${TIER_COLORS[member.tier] || "text-muted-foreground"}`}>{member.tier}</p>
                  </div>
                  {member.isPaid ? (
                    <Badge variant="default" className="shrink-0">
                      <DollarSign className="h-3 w-3 mr-0.5" />
                      Paid
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="shrink-0">Free</Badge>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="py-6 text-center space-y-2" data-testid="text-empty-friends">
              <Users className="h-8 w-8 text-muted-foreground mx-auto" />
              <p className="text-sm text-muted-foreground">
                No friends yet — share your link to start earning
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
