import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Crown, Zap, Star, Shield, Check, Clock, Loader2, ExternalLink, Sparkles } from "lucide-react";
import { formatUSD } from "@/lib/game-utils";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface SubscriptionInfo {
  tier: string;
  isActive: boolean;
  subscriptionExpiry: string | null;
  subscriptionStartedAt: string | null;
  isFounder: boolean;
  isProRated: boolean;
  proRateNote: string;
  spinTickets: number;
  spinTicketsExpiry: string | null;
}

interface PaymentConfig {
  mode: string;
  sandbox: boolean;
  tiers: Record<string, number>;
}

interface Invoice {
  id: number;
  invoiceId: string;
  tierName: string;
  amount: string;
  status: string;
  payUrl: string;
  createdAt: string;
}

const TIER_META: Record<string, {
  label: string;
  icon: React.ElementType;
  gradient: string;
  multiplier: number;
  dailyUnit: number;
  extraFeatures: string[];
}> = {
  FREE: {
    label: "Free",
    icon: Shield,
    gradient: "from-slate-400 to-slate-500",
    multiplier: 1,
    dailyUnit: 0,
    extraFeatures: ["Basic game access", "Standard energy refill"],
  },
  BRONZE: {
    label: "Bronze",
    icon: Zap,
    gradient: "from-amber-600 to-amber-700",
    multiplier: 1,
    dailyUnit: 0.10,
    extraFeatures: ["4 spin tickets on signup", "Founder badge (early)"],
  },
  SILVER: {
    label: "Silver",
    icon: Star,
    gradient: "from-slate-300 to-slate-400",
    multiplier: 3,
    dailyUnit: 0.30,
    extraFeatures: ["4 spin tickets on signup", "Priority predictions", "Founder badge (early)"],
  },
  GOLD: {
    label: "Gold",
    icon: Crown,
    gradient: "from-yellow-400 to-amber-500",
    multiplier: 10,
    dailyUnit: 1.00,
    extraFeatures: ["4 spin tickets on signup", "Priority predictions", "Exclusive rewards", "Founder badge (early)"],
  },
};

function buildTierDetails(tiers: Record<string, number>) {
  const tierOrder = ["FREE", "BRONZE", "SILVER", "GOLD"];
  return tierOrder.map((name) => {
    const meta = TIER_META[name];
    const price = tiers[name] ?? (name === "FREE" ? 0 : 0);
    const features: string[] = [];
    features.push(`${meta.multiplier}x tap multiplier`);
    if (meta.dailyUnit > 0) {
      features.push(`${formatUSD(meta.dailyUnit)} daily pot share`);
    }
    features.push(...meta.extraFeatures);
    return { name, price, ...meta, features };
  });
}

function TierCard({
  tier,
  allTiers,
  currentTier,
  isActive,
  isSandbox,
  onSubscribe,
  isPending,
  pendingTier,
}: {
  tier: ReturnType<typeof buildTierDetails>[number];
  allTiers: ReturnType<typeof buildTierDetails>;
  currentTier: string;
  isActive: boolean;
  isSandbox: boolean;
  onSubscribe: (tierName: string) => void;
  isPending: boolean;
  pendingTier: string | null;
}) {
  const isCurrent = currentTier === tier.name && (tier.name === "FREE" || isActive);
  const isUpgrade = tier.price > (allTiers.find((t) => t.name === currentTier)?.price || 0);
  const TierIcon = tier.icon;
  const isLoading = isPending && pendingTier === tier.name;

  return (
    <Card
      className={`relative overflow-visible transition-all duration-200 ${
        isCurrent ? "ring-2 ring-primary" : ""
      }`}
    >
      {isCurrent && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-10">
          <Badge variant="default" className="text-xs">Current Plan</Badge>
        </div>
      )}
      <CardContent className="p-0">
        <div className={`bg-gradient-to-br ${tier.gradient} p-5 rounded-t-md text-white`}>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <TierIcon className="h-6 w-6" />
              <h3 className="text-lg font-bold">{tier.label}</h3>
            </div>
            {tier.price > 0 && isSandbox && (
              <Badge variant="secondary" className="bg-white/20 text-white border-0 text-xs">
                Sandbox
              </Badge>
            )}
          </div>
          <div className="mt-3">
            {tier.price > 0 ? (
              <div className="flex items-baseline gap-1">
                <span className="text-3xl font-bold">{formatUSD(tier.price)}</span>
                <span className="text-sm opacity-80">/ month</span>
              </div>
            ) : (
              <span className="text-3xl font-bold">Free</span>
            )}
          </div>
        </div>
        <div className="p-5 space-y-4">
          <ul className="space-y-2.5">
            {tier.features.map((feature, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                <span>{feature}</span>
              </li>
            ))}
          </ul>
          {tier.name !== "FREE" && (
            <Button
              className="w-full"
              variant={isCurrent ? "outline" : "default"}
              disabled={isCurrent || isLoading || (isPending && pendingTier !== tier.name)}
              onClick={() => onSubscribe(tier.name)}
              data-testid={`button-subscribe-${tier.name.toLowerCase()}`}
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Processing...
                </>
              ) : isCurrent ? (
                "Active"
              ) : isUpgrade ? (
                "Upgrade"
              ) : (
                "Subscribe"
              )}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function SubscriptionPage() {
  const [pendingTier, setPendingTier] = useState<string | null>(null);
  const { toast } = useToast();

  const { data: subscription, isLoading: subLoading } = useQuery<SubscriptionInfo>({
    queryKey: ["/api/my-subscription"],
  });

  const { data: config, isLoading: configLoading } = useQuery<PaymentConfig>({
    queryKey: ["/api/payments/config"],
  });

  const { data: invoices } = useQuery<Invoice[]>({
    queryKey: ["/api/payments/invoices"],
  });

  const createInvoiceMutation = useMutation({
    mutationFn: async (tierName: string) => {
      const res = await apiRequest("POST", "/api/payments/invoice", { tierName });
      return await res.json();
    },
    onSuccess: (data) => {
      if (config?.sandbox) {
        sandboxConfirmMutation.mutate(data.invoiceId);
      } else if (data.payUrl) {
        window.open(data.payUrl, "_blank");
        toast({
          title: "Payment link opened",
          description: "Complete the payment in the new tab. Your subscription will activate automatically.",
        });
      }
      setPendingTier(null);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to create invoice", description: error.message, variant: "destructive" });
      setPendingTier(null);
    },
  });

  const sandboxConfirmMutation = useMutation({
    mutationFn: async (invoiceId: string) => {
      const res = await apiRequest("POST", "/api/payments/sandbox-confirm", { invoiceId });
      return await res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Subscription activated!",
        description: data.message,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/my-subscription"] });
      queryClient.invalidateQueries({ queryKey: ["/api/payments/invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
    },
    onError: (error: Error) => {
      toast({ title: "Payment failed", description: error.message, variant: "destructive" });
    },
  });

  const handleSubscribe = (tierName: string) => {
    setPendingTier(tierName);
    createInvoiceMutation.mutate(tierName);
  };

  const isPending = createInvoiceMutation.isPending || sandboxConfirmMutation.isPending;

  if (subLoading || configLoading) {
    return (
      <div className="p-4 md:p-6 space-y-6 max-w-5xl mx-auto">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-64" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-80" />
          ))}
        </div>
      </div>
    );
  }

  const currentTier = subscription?.tier || "FREE";
  const isActive = subscription?.isActive || false;
  const isSandbox = config?.sandbox || false;
  const tierDetails = buildTierDetails({ FREE: 0, ...config?.tiers });

  const daysRemaining = subscription?.subscriptionExpiry
    ? Math.max(0, Math.ceil((new Date(subscription.subscriptionExpiry).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : 0;

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-5xl mx-auto">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight" data-testid="text-subscription-title">
          Subscription
        </h1>
        <p className="text-muted-foreground text-sm">
          Upgrade your plan to earn more rewards and unlock premium features
        </p>
      </div>

      {isActive && currentTier !== "FREE" && (
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-md bg-primary/10 text-primary">
                  {currentTier === "GOLD" ? (
                    <Crown className="h-5 w-5" />
                  ) : currentTier === "SILVER" ? (
                    <Star className="h-5 w-5" />
                  ) : (
                    <Zap className="h-5 w-5" />
                  )}
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold" data-testid="text-current-tier">
                      {currentTier.charAt(0) + currentTier.slice(1).toLowerCase()} Plan
                    </p>
                    {subscription?.isFounder && (
                      <Badge variant="secondary" className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border-0 text-xs">
                        <Sparkles className="h-3 w-3 mr-1" />
                        Founder
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {daysRemaining > 0 ? `${daysRemaining} days remaining` : "Expires today"}
                  </p>
                </div>
              </div>
              <div className="text-right">
                {subscription?.spinTickets !== undefined && subscription.spinTickets > 0 && (
                  <p className="text-sm text-muted-foreground">
                    {subscription.spinTickets} spin tickets
                  </p>
                )}
              </div>
            </div>
            {subscription?.isProRated && subscription?.proRateNote && (
              <div className="mt-3 bg-amber-500/10 border border-amber-500/20 rounded-md p-3">
                <p className="text-xs text-amber-700 dark:text-amber-300">{subscription.proRateNote}</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {isSandbox && (
        <div className="bg-sky-500/10 border border-sky-500/20 rounded-md p-3">
          <p className="text-xs text-sky-700 dark:text-sky-300">
            Sandbox mode is active. Payments are simulated for testing purposes and no real funds are required.
          </p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {tierDetails.map((tier) => (
          <TierCard
            key={tier.name}
            tier={tier}
            allTiers={tierDetails}
            currentTier={currentTier}
            isActive={isActive}
            isSandbox={isSandbox}
            onSubscribe={handleSubscribe}
            isPending={isPending}
            pendingTier={pendingTier}
          />
        ))}
      </div>

      {invoices && invoices.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">Payment History</h2>
          <div className="space-y-2" data-testid="payment-history">
            {invoices.map((inv) => (
              <Card key={inv.id}>
                <CardContent className="p-3">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-3">
                      {inv.status === "paid" ? (
                        <Check className="h-4 w-4 text-green-500" />
                      ) : inv.status === "pending" ? (
                        <Clock className="h-4 w-4 text-amber-500" />
                      ) : inv.status === "expired" ? (
                        <Clock className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ExternalLink className="h-4 w-4 text-destructive" />
                      )}
                      <div>
                        <p className="text-sm font-medium">
                          {inv.tierName.charAt(0) + inv.tierName.slice(1).toLowerCase()} — {formatUSD(parseFloat(inv.amount))}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(inv.createdAt).toLocaleDateString()} · {inv.invoiceId.slice(0, 16)}...
                        </p>
                      </div>
                    </div>
                    <Badge
                      variant="secondary"
                      className={`border-0 text-xs ${
                        inv.status === "paid"
                          ? "bg-green-500/10 text-green-600 dark:text-green-400"
                          : inv.status === "pending"
                          ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                          : inv.status === "expired"
                          ? "bg-muted text-muted-foreground"
                          : "bg-red-500/10 text-red-600 dark:text-red-400"
                      }`}
                    >
                      {inv.status.charAt(0).toUpperCase() + inv.status.slice(1)}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
