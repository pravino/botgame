import { useState, useCallback, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Zap, Clock, BatteryCharging, Lock, DollarSign, TrendingUp, Flame, Rocket, Crown, Trophy, ChevronRight } from "lucide-react";
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
import { Link } from "wouter";

interface UserWithTierConfig extends User {
  tierConfig?: TierConfig;
}

interface FloatingWatt {
  id: number;
  x: number;
  y: number;
}

const SOLAR_THRESHOLD = 1_000_000;
const FRICTION = 0.975;
const STOP_THRESHOLD = 0.3;
const NO_ENERGY_FRICTION = 0.9;
const ORB_SIZE = 220;

function getGeneratorName(user: UserWithTierConfig | undefined): string {
  if (!user) return "Hand-Crank Dynamo";
  const tier = user.tier || "FREE";
  if (tier === "FREE") {
    return (user.totalCoins || 0) >= SOLAR_THRESHOLD ? "Solar Array" : "Hand-Crank Dynamo";
  }
  if (tier === "BRONZE") return "Diesel V8";
  if (tier === "SILVER") return "LNG Turbine";
  if (tier === "GOLD") return "Fusion Reactor";
  return "Hand-Crank Dynamo";
}

function getTierLabel(user: UserWithTierConfig | undefined): string {
  if (!user) return "FREE TIER";
  const tier = user.tier || "FREE";
  return `${tier} TIER`;
}

const TIER_ORB_COLORS: Record<string, { primary: string; secondary: string; glow: string }> = {
  FREE: { primary: "from-cyan-500 via-blue-500 to-cyan-400", secondary: "rgba(6, 182, 212, 0.4)", glow: "rgba(6, 182, 212, 0.3)" },
  BRONZE: { primary: "from-orange-500 via-amber-500 to-orange-400", secondary: "rgba(245, 158, 11, 0.4)", glow: "rgba(245, 158, 11, 0.3)" },
  SILVER: { primary: "from-yellow-400 via-amber-300 to-yellow-500", secondary: "rgba(250, 204, 21, 0.4)", glow: "rgba(250, 204, 21, 0.3)" },
  GOLD: { primary: "from-purple-500 via-violet-500 to-fuchsia-500", secondary: "rgba(139, 92, 246, 0.4)", glow: "rgba(139, 92, 246, 0.3)" },
};

function EnergyOrb({
  hasEnergy,
  tier,
  onTap,
  floatingWatts,
  multiplier,
  tapScale,
  orbRef,
}: {
  hasEnergy: boolean;
  tier: string;
  onTap: (e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => void;
  floatingWatts: FloatingWatt[];
  multiplier: number;
  tapScale: number;
  orbRef: React.RefObject<HTMLDivElement>;
}) {
  const colors = TIER_ORB_COLORS[tier] || TIER_ORB_COLORS.FREE;

  return (
    <div className="relative flex items-center justify-center" ref={orbRef}>
      <div
        className="absolute animate-orb-rotate"
        style={{ width: ORB_SIZE + 40, height: ORB_SIZE + 40 }}
      >
        <svg width={ORB_SIZE + 40} height={ORB_SIZE + 40} className="opacity-30">
          <circle
            cx={(ORB_SIZE + 40) / 2}
            cy={(ORB_SIZE + 40) / 2}
            r={(ORB_SIZE + 40) / 2 - 4}
            fill="none"
            stroke={colors.secondary}
            strokeWidth="1"
            strokeDasharray="8 12"
          />
        </svg>
      </div>

      <motion.div
        animate={{ scale: tapScale }}
        transition={{ type: "spring", stiffness: 500, damping: 20 }}
        className={`relative select-none touch-none cursor-pointer rounded-full ${hasEnergy ? "" : "opacity-40"}`}
        style={{ width: ORB_SIZE, height: ORB_SIZE }}
        onMouseDown={onTap}
        onTouchStart={onTap}
        data-testid="energy-orb"
      >
        <div
          className={`w-full h-full rounded-full bg-gradient-to-br ${colors.primary} animate-orb-pulse`}
          style={{
            boxShadow: hasEnergy
              ? `0 0 60px ${colors.glow}, 0 0 120px ${colors.glow}, inset 0 0 60px rgba(255,255,255,0.1)`
              : "none",
          }}
        >
          <div
            className="absolute inset-0 rounded-full opacity-50"
            style={{
              background: `radial-gradient(circle at 35% 35%, rgba(255,255,255,0.3), transparent 60%)`,
            }}
          />

          <div className="absolute inset-0 rounded-full overflow-hidden">
            <div
              className="absolute inset-[-50%] animate-orb-rotate"
              style={{
                background: `conic-gradient(from 0deg, transparent, ${colors.secondary}, transparent, ${colors.secondary}, transparent)`,
                opacity: hasEnergy ? 0.3 : 0.1,
              }}
            />
          </div>

          <svg
            className="absolute inset-0 animate-electric-arc"
            width={ORB_SIZE}
            height={ORB_SIZE}
            viewBox={`0 0 ${ORB_SIZE} ${ORB_SIZE}`}
          >
            <path
              d={`M ${ORB_SIZE * 0.3} ${ORB_SIZE * 0.2} Q ${ORB_SIZE * 0.5} ${ORB_SIZE * 0.35} ${ORB_SIZE * 0.7} ${ORB_SIZE * 0.25}`}
              fill="none"
              stroke="rgba(255,255,255,0.6)"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
            <path
              d={`M ${ORB_SIZE * 0.25} ${ORB_SIZE * 0.6} Q ${ORB_SIZE * 0.45} ${ORB_SIZE * 0.7} ${ORB_SIZE * 0.65} ${ORB_SIZE * 0.55}`}
              fill="none"
              stroke="rgba(255,255,255,0.4)"
              strokeWidth="1"
              strokeLinecap="round"
            />
          </svg>
        </div>
      </motion.div>

      <AnimatePresence>
        {floatingWatts.map((watt) => (
          <motion.div
            key={watt.id}
            initial={{ x: watt.x - ORB_SIZE / 2, y: watt.y - ORB_SIZE / 2, opacity: 1, scale: 1 }}
            animate={{ y: watt.y - ORB_SIZE / 2 - 80, opacity: 0, scale: 0.5 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.7, ease: "easeOut" }}
            className="absolute pointer-events-none text-primary font-bold text-lg"
          >
            +{multiplier} W
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

interface LeaderboardEntry {
  id: number;
  username: string;
  telegramFirstName: string | null;
  telegramPhotoUrl: string | null;
  totalCoins: number;
  tier: string;
}

function PotCard({
  label,
  amount,
  colorClass,
  borderColor,
}: {
  label: string;
  amount: number;
  colorClass: string;
  borderColor: string;
}) {
  return (
    <div
      className={`flex-1 rounded-xl p-3 text-center border ${borderColor}`}
      style={{ background: "rgba(0,0,0,0.3)" }}
      data-testid={`pot-card-${label.toLowerCase()}`}
    >
      <div className={`text-[10px] font-bold uppercase tracking-wider ${colorClass} mb-1`}>
        {label}
      </div>
      <div className="text-base font-bold text-foreground">
        ${formatNumber(amount)}
      </div>
      <div className="text-[10px] text-muted-foreground">
        <span className="uppercase">USDT</span>
      </div>
    </div>
  );
}

export default function TapToEarn({ guest = false }: { guest?: boolean } = {}) {
  const [floatingWatts, setFloatingWatts] = useState<FloatingWatt[]>([]);
  const [tapScale, setTapScale] = useState(1);
  const [liveEnergy, setLiveEnergy] = useState<number | null>(null);
  const [cooldownLabel, setCooldownLabel] = useState("");
  const [canRefill, setCanRefill] = useState(false);
  const [cooldownProgress, setCooldownProgress] = useState(0);
  const [showChallenge, setShowChallenge] = useState(false);
  const [guestWatts, setGuestWatts] = useState(0);

  const wattIdRef = useRef(0);
  const pendingTapsRef = useRef(0);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const orbRef = useRef<HTMLDivElement>(null);
  const liveEnergyRef = useRef<number | null>(null);

  const { toast } = useToast();

  const { data: user, isLoading } = useQuery<UserWithTierConfig>({
    queryKey: ["/api/user"],
    enabled: !guest,
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
    enabled: !guest,
  });

  const { data: leaderboard } = useQuery<LeaderboardEntry[]>({
    queryKey: ["/api/leaderboard", "coins"],
    enabled: !guest,
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
        description: `Level ${data.newMultiplierLevel} unlocked! You now earn ${data.effectiveMultiplier}x W per tap.`,
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
      const current = calculateCurrentEnergy(user.energy, user.maxEnergy, user.lastEnergyRefill, tc);
      setLiveEnergy(current);
      liveEnergyRef.current = current;
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
        if (parsed.challengeRequired) { setShowChallenge(true); return; }
      } catch {}
      if (msg.includes("challengeRequired") || msg.includes("challenge")) { setShowChallenge(true); }
    },
  });

  const refillMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/energy/refill", {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      toast({ title: "Full Tank!", description: "Energy fully restored. Keep tapping!" });
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
      if (guest) {
        setGuestWatts((prev) => prev + 1);
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        let clientX: number, clientY: number;
        if ("touches" in e) {
          clientX = e.touches[0].clientX;
          clientY = e.touches[0].clientY;
        } else {
          clientX = e.clientX;
          clientY = e.clientY;
        }
        const x = clientX - rect.left;
        const y = clientY - rect.top;
        const id = ++wattIdRef.current;
        setFloatingWatts((prev) => [...prev, { id, x, y }]);
        setTimeout(() => setFloatingWatts((prev) => prev.filter((c) => c.id !== id)), 800);
        setTapScale(0.92);
        setTimeout(() => setTapScale(1), 100);
        return;
      }

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

      const id = ++wattIdRef.current;
      setFloatingWatts((prev) => [...prev, { id, x, y }]);
      setTimeout(() => setFloatingWatts((prev) => prev.filter((c) => c.id !== id)), 800);

      setTapScale(0.92);
      setTimeout(() => setTapScale(1), 100);

      pendingTapsRef.current += 1;
      setLiveEnergy((prev) => Math.max(0, (prev ?? currentEnergy) - 1));

      const mult = tc.tapMultiplier ?? 1;
      queryClient.setQueryData<UserWithTierConfig>(["/api/user"], (old) =>
        old ? { ...old, energy: Math.max(0, old.energy - 1), totalCoins: old.totalCoins + mult } : old
      );

      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
      if (pendingTapsRef.current >= 50) {
        flushTaps();
      } else {
        flushTimerRef.current = setTimeout(flushTaps, 2000);
      }
    },
    [guest, user, liveEnergy, flushTaps, tc.tapMultiplier]
  );

  useEffect(() => {
    return () => {
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTaps();
      }
    };
  }, [flushTaps]);

  if (!guest && isLoading) {
    return (
      <div className="p-4 space-y-4 max-w-md mx-auto">
        <Skeleton className="h-8 w-40 mx-auto" />
        <Skeleton className="h-56 w-56 rounded-full mx-auto" />
        <Skeleton className="h-20" />
      </div>
    );
  }

  const currentEnergy = liveEnergy ?? user?.energy ?? 0;
  const maxEnergy = user?.maxEnergy ?? 1000;
  const energyPct = getEnergyPercentage(currentEnergy, maxEnergy);
  const hasRefillFeature = tc.refillCooldownMs !== null && tc.refillCooldownMs > 0;

  const totalWatts = guest ? guestWatts : (user?.totalCoins || 0);
  const currentTier = guest ? "FREE" : (user?.tier || "FREE");
  const tierLabel = getTierLabel(user);
  const generatorName = getGeneratorName(user);
  const walletBalance = user?.walletBalance ?? 0;

  const handleChallengeResolved = useCallback((passed: boolean) => {
    setShowChallenge(false);
    queryClient.invalidateQueries({ queryKey: ["/api/user"] });
  }, []);

  const topThree = (leaderboard || []).slice(0, 3);

  if (guest) {
    return (
      <div className="flex flex-col items-center px-4 pb-6 pt-2 max-w-md mx-auto space-y-5">
        <div className="text-center space-y-1">
          <div className="flex items-center justify-center gap-2">
            <Zap className="h-4 w-4 text-amber-400 fill-amber-400" />
            <span className="text-xs font-bold uppercase tracking-widest text-amber-400" data-testid="text-tier-label">
              FREE TIER
            </span>
          </div>
          <p className="text-xs text-muted-foreground">{generatorName}</p>
        </div>

        <div className="text-center">
          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Tap to Generate</p>
          <div className="flex items-baseline justify-center gap-1">
            <span className="text-4xl font-black tracking-tight" data-testid="text-total-coins">
              {formatNumber(guestWatts)}
            </span>
            <span className="text-lg font-semibold text-muted-foreground">W</span>
          </div>
        </div>

        <EnergyOrb
          hasEnergy={true}
          tier="FREE"
          onTap={handleTap}
          floatingWatts={floatingWatts}
          multiplier={1}
          tapScale={tapScale}
          orbRef={orbRef as React.RefObject<HTMLDivElement>}
        />

        <div
          className="w-full rounded-xl border border-border/50 p-4 text-center"
          style={{ background: "rgba(0,0,0,0.2)" }}
        >
          <p className="text-sm text-muted-foreground">
            Sign in to save your progress and earn real rewards
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center px-4 pb-6 pt-2 max-w-md mx-auto space-y-4">
      {showChallenge && (
        <ChallengeOverlay onResolved={handleChallengeResolved} />
      )}

      <div className="text-center space-y-0.5">
        <div className="flex items-center justify-center gap-2">
          <Zap className="h-4 w-4 text-amber-400 fill-amber-400" />
          <span className="text-xs font-bold uppercase tracking-widest text-amber-400" data-testid="text-tier-label">
            {tierLabel}: {generatorName}
          </span>
          {currentTier !== "FREE" && (
            <Crown className="h-3.5 w-3.5 text-amber-400" />
          )}
        </div>
      </div>

      <div className="relative w-full flex items-center justify-center">
        <div className="absolute left-0 top-1/2 -translate-y-1/2">
          <div className="flex flex-col items-center gap-1 rounded-lg border border-border/30 px-2.5 py-2"
            style={{ background: "rgba(0,0,0,0.3)" }}
            data-testid="info-daily-streak"
          >
            <Flame className="h-4 w-4 text-orange-400" />
            <span className="text-sm font-bold">0</span>
            <span className="text-[9px] text-muted-foreground">Days</span>
          </div>
        </div>

        <div className="flex flex-col items-center gap-2">
          <div className="text-center">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Tap to Generate</p>
            <div className="flex items-baseline justify-center gap-1">
              <span className="text-4xl font-black tracking-tight" data-testid="text-total-coins">
                {formatNumber(totalWatts)}
              </span>
              <span className="text-lg font-semibold text-muted-foreground">W</span>
            </div>
            {(tc.tapMultiplier ?? 1) > 1 && (
              <span className="text-xs text-emerald-400 font-medium" data-testid="text-wps">
                +{tc.tapMultiplier} W/tap
              </span>
            )}
          </div>

          <EnergyOrb
            hasEnergy={currentEnergy > 0}
            tier={currentTier}
            onTap={handleTap}
            floatingWatts={floatingWatts}
            multiplier={tc.tapMultiplier ?? 1}
            tapScale={tapScale}
            orbRef={orbRef as React.RefObject<HTMLDivElement>}
          />
        </div>

        <div className="absolute right-0 top-1/2 -translate-y-1/2">
          <div className="flex flex-col items-center gap-1 rounded-lg border border-border/30 px-2.5 py-2"
            style={{ background: "rgba(0,0,0,0.3)" }}
            data-testid="info-boosters"
          >
            <Rocket className="h-4 w-4 text-violet-400" />
            <span className="text-sm font-bold">{earnings?.tapMultiplierLevel ?? 1}</span>
            <span className="text-[9px] text-muted-foreground">Boost</span>
          </div>
        </div>
      </div>

      <div className="w-full space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-1.5">
            <Zap className="h-3.5 w-3.5 text-emerald-400" />
            <span className="text-muted-foreground">Energy</span>
          </div>
          <span className="font-mono text-muted-foreground" data-testid="text-energy">
            {currentEnergy}/{maxEnergy}
          </span>
        </div>
        <div className="h-2 w-full rounded-full bg-muted/50 overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-300"
            style={{
              width: `${energyPct}%`,
              background: energyPct > 50 ? "linear-gradient(90deg, #10b981, #34d399)" :
                energyPct > 20 ? "linear-gradient(90deg, #f59e0b, #fbbf24)" :
                "linear-gradient(90deg, #ef4444, #f87171)",
            }}
            data-testid="progress-energy"
          />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {currentEnergy >= maxEnergy ? "Full!" : getTimeUntilFullEnergy(currentEnergy, maxEnergy, tc)}
          </span>
          {hasRefillFeature && canRefill && (
            <Button
              size="sm"
              variant="outline"
              className="h-6 text-[10px] px-2"
              onClick={() => refillMutation.mutate()}
              disabled={refillMutation.isPending || currentEnergy >= maxEnergy}
              data-testid="button-full-tank"
            >
              <BatteryCharging className="h-3 w-3 mr-1" />
              {refillMutation.isPending ? "Filling..." : "Refill"}
            </Button>
          )}
          {hasRefillFeature && !canRefill && (
            <span className="text-[10px] text-muted-foreground" data-testid="text-refill-cooldown">
              Refill in {cooldownLabel}
            </span>
          )}
          {!hasRefillFeature && (
            <span className="text-[10px] text-muted-foreground flex items-center gap-1" data-testid="text-refill-locked">
              <Lock className="h-3 w-3" />
              Upgrade for refills
            </span>
          )}
        </div>
      </div>

      <div className="w-full">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Daily Pot Distribution</span>
        </div>
        <div className="flex gap-2">
          <PotCard
            label="Diesel"
            amount={earnings?.tapPotSize ?? 0}
            colorClass="text-orange-400"
            borderColor="border-orange-500/30"
          />
          <PotCard
            label="LNG"
            amount={(earnings?.tapPotSize ?? 0) * 3.3}
            colorClass="text-yellow-400"
            borderColor="border-yellow-500/30"
          />
          <PotCard
            label="Fusion"
            amount={(earnings?.tapPotSize ?? 0) * 10.5}
            colorClass="text-purple-400"
            borderColor="border-purple-500/30"
          />
        </div>
      </div>

      {topThree.length > 0 && (
        <div className="w-full">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Live Leaderboard (Today)</span>
            <Link href="/leaderboard" className="text-[10px] text-primary flex items-center gap-0.5" data-testid="link-view-leaderboard">
              View All <ChevronRight className="h-3 w-3" />
            </Link>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {topThree.map((entry, idx) => (
              <div
                key={entry.id}
                className="flex items-center gap-2 rounded-xl border border-border/30 px-3 py-2 min-w-[120px]"
                style={{ background: "rgba(0,0,0,0.3)" }}
                data-testid={`leaderboard-entry-${idx}`}
              >
                <div className="flex items-center justify-center w-7 h-7 rounded-full bg-muted text-xs font-bold">
                  {entry.telegramFirstName?.slice(0, 1) || entry.username.slice(0, 1)}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1">
                    <span className="text-amber-400 text-xs font-bold">#{idx + 1}</span>
                    <span className="text-xs font-medium truncate">
                      {entry.telegramFirstName || entry.username}
                    </span>
                  </div>
                  <span className="text-[10px] text-emerald-400 font-semibold">
                    {formatNumber(entry.totalCoins)} W
                  </span>
                </div>
                {idx === 0 && <Trophy className="h-4 w-4 text-amber-400 ml-auto flex-shrink-0" />}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="w-full grid grid-cols-2 gap-2">
        <div
          className="rounded-xl border border-border/30 p-3"
          style={{ background: "rgba(0,0,0,0.3)" }}
          data-testid="card-upgrades"
        >
          <div className="flex items-center gap-1.5 mb-2">
            <TrendingUp className="h-3.5 w-3.5 text-amber-400" />
            <span className="text-xs font-semibold">Upgrades</span>
          </div>
          <p className="text-[10px] text-muted-foreground mb-1">
            Generator Lv.{earnings?.tapMultiplierLevel ?? 1}
          </p>
          {user?.tier === "FREE" ? (
            <Link href="/subscription">
              <Button size="sm" className="w-full h-7 text-[10px] bg-amber-500 hover:bg-amber-600 text-black" data-testid="button-unlock-upgrades">
                Unlock
              </Button>
            </Link>
          ) : earnings?.isMaxed ? (
            earnings?.nextTier ? (
              <Link href="/subscription">
                <Button size="sm" variant="outline" className="w-full h-7 text-[10px]" data-testid="button-unlock-tier">
                  Next Tier
                </Button>
              </Link>
            ) : (
              <span className="text-[10px] text-emerald-400 font-semibold">Maxed!</span>
            )
          ) : (
            <Button
              size="sm"
              className="w-full h-7 text-[10px] bg-amber-500 hover:bg-amber-600 text-black"
              onClick={() => upgradeMutation.mutate()}
              disabled={upgradeMutation.isPending || (user?.totalCoins ?? 0) < (earnings?.upgradeCost ?? Infinity)}
              data-testid="button-upgrade-multiplier"
            >
              {upgradeMutation.isPending ? "..." : `Upgrade (${formatNumber(earnings?.upgradeCost ?? 0)} W)`}
            </Button>
          )}
        </div>

        <div
          className="rounded-xl border border-emerald-500/30 p-3"
          style={{ background: "rgba(0,0,0,0.3)" }}
          data-testid="card-earnings"
        >
          <div className="flex items-center gap-1.5 mb-2">
            <DollarSign className="h-3.5 w-3.5 text-emerald-400" />
            <span className="text-xs font-semibold">My Earnings</span>
          </div>
          <p className="text-lg font-black text-emerald-400" data-testid="text-wallet-balance">
            ${typeof walletBalance === 'number' ? walletBalance.toFixed(2) : '0.00'}
          </p>
          <Link href="/wallet">
            <Button
              size="sm"
              className="w-full h-7 text-[10px] mt-1 bg-emerald-500 hover:bg-emerald-600 text-black font-bold"
              data-testid="button-withdraw"
            >
              Withdraw
            </Button>
          </Link>
        </div>
      </div>

      {currentEnergy <= 0 && (
        <div
          className="w-full rounded-xl border border-destructive/30 p-4 text-center space-y-2"
          style={{ background: "rgba(0,0,0,0.3)" }}
        >
          <p className="text-sm text-muted-foreground">
            Energy depleted. Recharging...
          </p>
          {hasRefillFeature && canRefill && (
            <Button
              variant="default"
              size="sm"
              onClick={() => refillMutation.mutate()}
              disabled={refillMutation.isPending}
              data-testid="button-full-tank-cta"
            >
              <BatteryCharging className="h-4 w-4 mr-1" />
              {refillMutation.isPending ? "Filling..." : "Use Full Tank Now"}
            </Button>
          )}
          {hasRefillFeature && !canRefill && (
            <p className="text-xs text-muted-foreground">
              Full Tank recharging: {cooldownLabel}
            </p>
          )}
          {!hasRefillFeature && (
            <p className="text-xs text-muted-foreground">
              Upgrade to unlock Full Tank refills!
            </p>
          )}
        </div>
      )}
    </div>
  );
}
