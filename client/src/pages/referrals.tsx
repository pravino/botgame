import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, Copy, Check, Gift, Lock, Unlock, DollarSign, Trophy } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatUSD } from "@/lib/game-utils";

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

export default function Referrals() {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  const { data, isLoading } = useQuery<ReferralStatus>({
    queryKey: ["/api/referral-status"],
  });

  const handleCopy = async () => {
    if (!data?.referralCode) return;
    try {
      await navigator.clipboard.writeText(data.referralCode);
      setCopied(true);
      toast({ title: "Copied!", description: "Referral code copied to clipboard" });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: "Copy failed", description: "Please copy manually", variant: "destructive" });
    }
  };

  if (isLoading) {
    return (
      <div className="p-4 md:p-6 space-y-4 max-w-lg mx-auto">
        <Skeleton className="h-8 w-48 mx-auto" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-lg mx-auto">
      <div className="text-center space-y-1">
        <h1 className="text-2xl font-bold tracking-tight" data-testid="text-referrals-title">
          Invite Friends
        </h1>
        <p className="text-muted-foreground text-sm">
          Refer friends, earn USDT, and unlock the Lucky Wheel
        </p>
      </div>

      <Card>
        <CardContent className="p-5 space-y-3">
          <div className="flex items-center gap-2 mb-2">
            <Users className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">Your Referral Code</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex-1 bg-muted rounded-md px-4 py-2.5 font-mono text-center text-lg tracking-wider" data-testid="text-referral-code">
              {data?.referralCode || "—"}
            </div>
            <Button
              size="icon"
              variant="outline"
              onClick={handleCopy}
              data-testid="button-copy-code"
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-3 text-center">
            <p className="text-2xl font-bold text-primary" data-testid="text-total-referrals">{data?.totalReferrals ?? 0}</p>
            <p className="text-xs text-muted-foreground">Total</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <p className="text-2xl font-bold text-primary" data-testid="text-paid-referrals">{data?.paidReferralCount ?? 0}</p>
            <p className="text-xs text-muted-foreground">Paid</p>
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
            <div className="flex items-center gap-2">
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
            <div className="flex items-center gap-2">
              <Trophy className="h-4 w-4 text-primary" />
              <span className="font-medium text-sm">Milestones</span>
              <Badge variant="secondary" className="ml-auto">{data.reachedCount}/{data.milestones.length}</Badge>
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
                      {m.bonusUsdt > 0 && ` · +$${m.bonusUsdt} bonus`}
                      {m.unlocksWheel && " · Unlocks Wheel"}
                    </p>
                  </div>
                  {m.reached && (
                    <Badge variant="default" className="shrink-0">
                      <Check className="h-3 w-3" />
                    </Badge>
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
            <div className="flex items-center gap-2">
              <Gift className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">Next Milestone</span>
            </div>
            <p className="text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">{data.nextMilestone.label}</span>
              {" — "}
              {data.nextMilestone.remaining} more paid friend{data.nextMilestone.remaining > 1 ? "s" : ""} needed
              {data.nextMilestone.bonusUsdt > 0 && `. Bonus: +$${data.nextMilestone.bonusUsdt} USDT`}
              {data.nextMilestone.unlocksWheel && ". Unlocks Lucky Wheel!"}
            </p>
          </CardContent>
        </Card>
      )}

      {data?.squad && data.squad.length > 0 && (
        <Card>
          <CardContent className="p-5 space-y-3">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" />
              <span className="font-medium text-sm">Your Squad</span>
              <Badge variant="secondary" className="ml-auto">{data.squad.length}</Badge>
            </div>
            <div className="space-y-2">
              {data.squad.map((member, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 p-2 rounded-md"
                  data-testid={`squad-member-${i}`}
                >
                  <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center shrink-0">
                    <span className="text-xs font-bold">{member.username.charAt(0).toUpperCase()}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{member.username}</p>
                    <p className="text-xs text-muted-foreground">{member.tier}</p>
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
          </CardContent>
        </Card>
      )}

      {(!data?.squad || data.squad.length === 0) && (
        <Card>
          <CardContent className="p-8 text-center space-y-2">
            <Users className="h-10 w-10 text-muted-foreground mx-auto" />
            <p className="text-sm text-muted-foreground">
              Share your code with friends to start earning USDT rewards
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
