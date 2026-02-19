import { useState, useCallback, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Coins, Zap, Clock, BatteryCharging, Lock, DollarSign, TrendingUp } from "lucide-react";
import {
  formatNumber,
  getEnergyPercentage,
  calculateCurrentEnergy,
  getTimeUntilFullEnergy,
  getRefillCooldownRemaining,
  formatCooldownTime,
  type TierConfig,
} from "@/lib/game-utils";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { User } from "@shared/schema";
import { motion, AnimatePresence } from "framer-motion";
import { useToast } from "@/hooks/use-toast";
import { ChallengeOverlay } from "@/components/challenge-overlay";

interface UserWithTierConfig extends User {
  tierConfig?: TierConfig;
}

interface FloatingCoin {
  id: number;
  x: number;
  y: number;
}

function CooldownRing({
  progress,
  size = 40,
  strokeWidth = 3,
  showLabel = false,
  label = "",
}: {
  progress: number;
  size?: number;
  strokeWidth?: number;
  showLabel?: boolean;
  label?: string;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - Math.min(1, Math.max(0, progress)));

  const pct = Math.round(progress * 100);

  return (
    <div className="relative" style={{ width: size, height: size }} data-testid="status-refill-progress">
      <svg
        width={size}
        height={size}
        className="-rotate-90"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Refill cooldown ${pct}% complete`}
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          className="stroke-muted"
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          className="stroke-primary"
          style={{ strokeDasharray: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 0.8, ease: "easeOut" }}
        />
      </svg>
      {showLabel && (
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{ fontSize: size * 0.18 }}
        >
          <span className="font-medium text-muted-foreground leading-none" data-testid="text-refill-time">{label}</span>
        </div>
      )}
      {!showLabel && (
        <div className="absolute inset-0 flex items-center justify-center">
          <BatteryCharging
            className="text-primary"
            style={{ width: size * 0.4, height: size * 0.4 }}
          />
        </div>
      )}
    </div>
  );
}

export default function TapToEarn() {
  const [floatingCoins, setFloatingCoins] = useState<FloatingCoin[]>([]);
  const [tapScale, setTapScale] = useState(1);
  const [liveEnergy, setLiveEnergy] = useState<number | null>(null);
  const [cooldownLabel, setCooldownLabel] = useState("");
  const [canRefill, setCanRefill] = useState(false);
  const [cooldownProgress, setCooldownProgress] = useState(0);
  const [showChallenge, setShowChallenge] = useState(false);
  const coinIdRef = useRef(0);
  const pendingTapsRef = useRef(0);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { toast } = useToast();

  const { data: user, isLoading } = useQuery<UserWithTierConfig>({
    queryKey: ["/api/user"],
  });

  interface EstimatedEarnings {
    myCoinsToday: number;
    totalTierCoins: number;
    mySharePct: number;
    estimatedUsdt: number;
    tapPotSize: number;
    tierName: string;
    tapMultiplier: number;
    tapMultiplierLevel: number;
    tierBaseMultiplier: number;
    upgradeCost: number | null;
    maxUpgradeLevel: number;
    isMaxed: boolean;
    nextTier: string | null;
  }

  const { data: earnings } = useQuery<EstimatedEarnings>({
    queryKey: ["/api/tap/estimated-earnings"],
    refetchInterval: 30000,
  });

  const upgradeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/games/upgrade-multiplier");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tap/estimated-earnings"] });
      toast({
        title: "Multiplier Upgraded!",
        description: `Level ${data.newMultiplierLevel} unlocked! You now earn ${data.effectiveMultiplier}x coins per tap.`,
      });
    },
    onError: (error: any) => {
      const msg = error.message || "Failed to upgrade";
      const jsonPart = msg.includes(": ") ? msg.substring(msg.indexOf(": ") + 2) : msg;
      try {
        const parsed = JSON.parse(jsonPart);
        toast({ title: "Upgrade Failed", description: parsed.message, variant: "destructive" });
      } catch {
        toast({ title: "Upgrade Failed", description: msg, variant: "destructive" });
      }
    },
  });

  const tc: TierConfig = user?.tierConfig ?? { energyRefillRateMs: 2000, refillCooldownMs: null, tapMultiplier: 1 };

  useEffect(() => {
    if (!user) return;

    const tick = () => {
      const current = calculateCurrentEnergy(
        user.energy,
        user.maxEnergy,
        user.lastEnergyRefill,
        tc
      );
      setLiveEnergy(current);

      const cooldown = getRefillCooldownRemaining(user.lastFreeRefill, tc);
      setCanRefill(cooldown.canRefill);
      setCooldownLabel(cooldown.remainingMs > 0 ? formatCooldownTime(cooldown.remainingMs) : "");
      setCooldownProgress(cooldown.progress);
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [user, tc.energyRefillRateMs, tc.refillCooldownMs]);

  const tapMutation = useMutation({
    mutationFn: async (taps: number) => {
      const res = await apiRequest("POST", "/api/tap", { taps });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tap/estimated-earnings"] });
    },
    onError: (error: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      const msg = error.message || "";
      const jsonPart = msg.includes(": ") ? msg.substring(msg.indexOf(": ") + 2) : msg;
      try {
        const parsed = JSON.parse(jsonPart);
        if (parsed.challengeRequired) {
          setShowChallenge(true);
          return;
        }
      } catch {}
      if (msg.includes("challengeRequired") || msg.includes("challenge")) {
        setShowChallenge(true);
      }
    },
  });

  const refillMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/energy/refill", {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      toast({ title: "Full Tank!", description: "Energy fully restored. Go tap!" });
    },
    onError: (error: any) => {
      const msg = error.message || "Refill not available right now";
      toast({ title: "Refill Unavailable", description: msg, variant: "destructive" });
    },
  });

  const flushTaps = useCallback(() => {
    if (pendingTapsRef.current > 0) {
      const taps = pendingTapsRef.current;
      pendingTapsRef.current = 0;
      tapMutation.mutate(taps);
    }
  }, [tapMutation]);

  const handleTap = useCallback(
    (e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => {
      const currentEnergy = liveEnergy ?? user?.energy ?? 0;
      if (!user || currentEnergy <= 0) return;

      let clientX: number, clientY: number;
      if ("touches" in e) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
      } else {
        clientX = e.clientX;
        clientY = e.clientY;
      }

      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;

      const id = ++coinIdRef.current;
      setFloatingCoins((prev) => [...prev, { id, x, y }]);
      setTimeout(() => {
        setFloatingCoins((prev) => prev.filter((c) => c.id !== id));
      }, 800);

      setTapScale(0.92);
      setTimeout(() => setTapScale(1), 100);

      pendingTapsRef.current += 1;

      setLiveEnergy((prev) => Math.max(0, (prev ?? currentEnergy) - 1));

      const mult = tc.tapMultiplier ?? 1;
      queryClient.setQueryData<UserWithTierConfig>(["/api/user"], (old) =>
        old
          ? {
              ...old,
              energy: Math.max(0, old.energy - 1),
              totalCoins: old.totalCoins + mult,
            }
          : old
      );

      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
      if (pendingTapsRef.current >= 50) {
        flushTaps();
      } else {
        flushTimerRef.current = setTimeout(flushTaps, 2000);
      }
    },
    [user, liveEnergy, flushTaps]
  );

  if (isLoading) {
    return (
      <div className="p-4 md:p-6 space-y-6 max-w-md mx-auto">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-80 rounded-md" />
        <Skeleton className="h-20" />
      </div>
    );
  }

  const currentEnergy = liveEnergy ?? user?.energy ?? 0;
  const maxEnergy = user?.maxEnergy ?? 1000;
  const energyPct = getEnergyPercentage(currentEnergy, maxEnergy);
  const timeUntilFull = getTimeUntilFullEnergy(currentEnergy, maxEnergy, tc);
  const hasRefillFeature = tc.refillCooldownMs !== null && tc.refillCooldownMs > 0;
  const refillRateLabel = tc.energyRefillRateMs <= 1000 ? "1/sec" : "1/2sec";

  const handleChallengeResolved = useCallback((passed: boolean) => {
    setShowChallenge(false);
    queryClient.invalidateQueries({ queryKey: ["/api/user"] });
  }, []);

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-md mx-auto">
      {showChallenge && (
        <ChallengeOverlay onResolved={handleChallengeResolved} />
      )}
      <div className="text-center space-y-1">
        <h1 className="text-2xl font-bold tracking-tight" data-testid="text-tap-title">
          Tap to Earn
        </h1>
        <p className="text-muted-foreground text-sm">Tap the coin to mine Group Coins</p>
      </div>

      <Card>
        <CardContent className="p-6 text-center space-y-2">
          <div className="flex items-center justify-center gap-2">
            <Coins className="h-5 w-5 text-primary" />
            <span className="text-3xl font-bold" data-testid="text-total-coins">
              {formatNumber(user?.totalCoins || 0)}
            </span>
          </div>
          <div className="flex items-center justify-center gap-2 flex-wrap">
            <p className="text-sm text-muted-foreground">Group Coins</p>
            {(tc.tapMultiplier ?? 1) > 1 && (
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-primary/10 text-primary" data-testid="text-tap-multiplier">
                {tc.tapMultiplier}x per tap
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {earnings && user?.tier !== "FREE" && (
        <Card>
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-green-500" />
              <span className="font-medium text-sm">Estimated Daily Earnings</span>
            </div>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="space-y-0.5">
                <p className="text-lg font-bold text-green-500" data-testid="text-estimated-usdt">
                  ${earnings.estimatedUsdt.toFixed(4)} USDT
                </p>
                <p className="text-xs text-muted-foreground" data-testid="text-pool-share">
                  {earnings.mySharePct}% of ${earnings.tapPotSize.toFixed(2)} pot
                </p>
              </div>
              <div className="text-right space-y-0.5">
                <div className="flex items-center gap-1 justify-end">
                  <TrendingUp className="h-3 w-3 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground" data-testid="text-coins-today">
                    {formatNumber(earnings.myCoinsToday)} coins today
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  of {formatNumber(earnings.totalTierCoins)} total
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {user?.tier === "FREE" && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Upgrade to Bronze or higher to earn USDT from your daily taps
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {earnings && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-primary" />
                <span className="font-medium text-sm">Tap Power</span>
              </div>
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-primary/10 text-primary" data-testid="text-effective-multiplier">
                Level {earnings.tapMultiplierLevel}/{earnings.maxUpgradeLevel} ({earnings.tapMultiplier}x)
              </span>
            </div>
            {earnings.tierBaseMultiplier > 1 && (
              <p className="text-xs text-muted-foreground">
                Tier bonus: {earnings.tierBaseMultiplier}x
              </p>
            )}
            {user?.tier === "FREE" ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <p className="text-xs text-muted-foreground">
                    Upgrades locked on Free tier
                  </p>
                  <Button
                    size="sm"
                    onClick={() => window.location.href = "/subscription"}
                    data-testid="button-unlock-upgrades"
                  >
                    Unlock Upgrades
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground text-center">
                  Subscribe to Bronze or higher to start upgrading your multiplier!
                </p>
              </div>
            ) : earnings.isMaxed ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <Badge variant="secondary" data-testid="badge-max-level">
                    {user?.tier} Peak Reached
                  </Badge>
                  {earnings.nextTier && (
                    <Button
                      size="sm"
                      onClick={() => window.location.href = "/subscription"}
                      data-testid="button-unlock-tier"
                    >
                      Unlock {earnings.nextTier} Power
                    </Button>
                  )}
                </div>
                {earnings.nextTier && (
                  <p className="text-xs text-muted-foreground text-center">
                    You've maxed out at {earnings.tapMultiplier}x. Upgrade to {earnings.nextTier} to unlock even higher multipliers!
                  </p>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <p className="text-xs text-muted-foreground">
                    Next level: {formatNumber(earnings.upgradeCost!)} coins
                  </p>
                  <Button
                    size="sm"
                    onClick={() => upgradeMutation.mutate()}
                    disabled={upgradeMutation.isPending || (user?.totalCoins ?? 0) < (earnings.upgradeCost ?? Infinity)}
                    data-testid="button-upgrade-multiplier"
                  >
                    {upgradeMutation.isPending ? "Upgrading..." : "Upgrade"}
                  </Button>
                </div>
                {(user?.totalCoins ?? 0) < (earnings.upgradeCost ?? 0) && (
                  <p className="text-xs text-muted-foreground text-center">
                    Need {formatNumber((earnings.upgradeCost ?? 0) - (user?.totalCoins ?? 0))} more coins
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="flex justify-center">
        <div
          className="relative select-none touch-none cursor-pointer"
          onMouseDown={handleTap}
          onTouchStart={handleTap}
          data-testid="button-tap-coin"
        >
          <motion.div
            animate={{ scale: tapScale }}
            transition={{ type: "spring", stiffness: 500, damping: 20 }}
            className={`w-44 h-44 rounded-full flex items-center justify-center
              bg-gradient-to-br from-amber-400 via-yellow-500 to-orange-500
              ${currentEnergy > 0 ? "" : "opacity-50"}
            `}
            style={{
              boxShadow: currentEnergy > 0
                ? "0 0 30px rgba(245, 158, 11, 0.3), inset 0 -4px 12px rgba(0,0,0,0.15)"
                : "inset 0 -4px 12px rgba(0,0,0,0.15)",
            }}
          >
            <div className="w-36 h-36 rounded-full bg-gradient-to-br from-yellow-300 via-amber-400 to-yellow-600 flex items-center justify-center"
              style={{ boxShadow: "inset 0 2px 8px rgba(255,255,255,0.4), inset 0 -2px 8px rgba(0,0,0,0.2)" }}
            >
              <Coins className="w-16 h-16 text-amber-900/70" />
            </div>
          </motion.div>

          <AnimatePresence>
            {floatingCoins.map((coin) => (
              <motion.div
                key={coin.id}
                initial={{ x: coin.x - 20, y: coin.y - 20, opacity: 1, scale: 1 }}
                animate={{ y: coin.y - 80, opacity: 0, scale: 0.5 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.7, ease: "easeOut" }}
                className="absolute top-0 left-0 pointer-events-none text-primary font-bold text-lg"
              >
                +{tc.tapMultiplier ?? 1}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>

      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-chart-2" />
              <span className="font-medium text-sm">Energy</span>
              <span className="text-xs text-muted-foreground">({refillRateLabel})</span>
            </div>
            <span className="text-sm font-mono text-muted-foreground" data-testid="text-energy">
              {currentEnergy} / {maxEnergy}
            </span>
          </div>
          <Progress
            value={energyPct}
            className="h-3"
            data-testid="progress-energy"
          />
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              <span>{currentEnergy >= maxEnergy ? "Tank full!" : `Full in: ${timeUntilFull}`}</span>
            </div>
            {hasRefillFeature ? (
              canRefill ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => refillMutation.mutate()}
                  disabled={refillMutation.isPending || currentEnergy >= maxEnergy}
                  data-testid="button-full-tank"
                >
                  <BatteryCharging className="h-3.5 w-3.5 mr-1" />
                  {refillMutation.isPending ? "Filling..." : "Full Tank"}
                </Button>
              ) : (
                <div className="flex items-center gap-2" data-testid="text-refill-cooldown">
                  <CooldownRing progress={cooldownProgress} size={32} strokeWidth={3} />
                  <span className="text-xs text-muted-foreground">{cooldownLabel}</span>
                </div>
              )
            ) : (
              <span className="text-xs text-muted-foreground flex items-center gap-1" data-testid="text-refill-locked">
                <Lock className="h-3 w-3" />
                Upgrade to unlock Full Tank
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {currentEnergy <= 0 && (
        <Card>
          <CardContent className="p-4 text-center space-y-2">
            <p className="text-sm text-muted-foreground">
              Energy depleted. It refills at {refillRateLabel} — come back in a few minutes!
            </p>
            {hasRefillFeature && canRefill && (
              <Button
                variant="default"
                onClick={() => refillMutation.mutate()}
                disabled={refillMutation.isPending}
                data-testid="button-full-tank-cta"
              >
                <BatteryCharging className="h-4 w-4 mr-1" />
                {refillMutation.isPending ? "Filling..." : "Use Full Tank Now"}
              </Button>
            )}
            {hasRefillFeature && !canRefill && (
              <div className="flex flex-col items-center gap-2">
                <CooldownRing progress={cooldownProgress} size={56} strokeWidth={4} showLabel label={cooldownLabel} />
                <p className="text-xs text-muted-foreground">Full Tank recharging</p>
              </div>
            )}
            {!hasRefillFeature && (
              <p className="text-xs text-muted-foreground">
                Upgrade to Bronze or higher to unlock Full Tank refills!
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
