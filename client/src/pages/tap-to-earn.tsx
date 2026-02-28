import { useState, useCallback, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Zap, Clock, BatteryCharging, Lock, DollarSign, TrendingUp, Flame, Rocket, Crown, Trophy, ChevronRight, Gauge, Settings } from "lucide-react";
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
const WHEEL_SIZE = 200;
const SPOKE_COUNT = 8;
const ORB_SIZE = 260;

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
  const names: Record<string, string> = { FREE: "FREE TIER", BRONZE: "DIESEL TIER", SILVER: "LNG TIER", GOLD: "FUSION TIER" };
  return names[tier] || "FREE TIER";
}

const TIER_COLORS: Record<string, { label: string; accent: string; glow: string; glowRgba: string; border: string }> = {
  FREE: { label: "text-cyan-400", accent: "from-cyan-500 via-blue-500 to-cyan-400", glow: "rgba(6,182,212,0.4)", glowRgba: "6,182,212", border: "border-cyan-500/40" },
  BRONZE: { label: "text-orange-400", accent: "from-orange-500 via-amber-500 to-orange-400", glow: "rgba(245,158,11,0.4)", glowRgba: "245,158,11", border: "border-orange-500/40" },
  SILVER: { label: "text-yellow-400", accent: "from-yellow-400 via-amber-300 to-yellow-500", glow: "rgba(250,204,21,0.4)", glowRgba: "250,204,21", border: "border-yellow-500/40" },
  GOLD: { label: "text-purple-400", accent: "from-purple-500 via-violet-500 to-fuchsia-500", glow: "rgba(139,92,246,0.4)", glowRgba: "139,92,246", border: "border-purple-500/40" },
};

function CrankWheel({
  angularVelocity,
  wheelAngle,
  hasEnergy,
  isDragging,
  floatingWatts,
  multiplier,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  wheelRef,
}: {
  angularVelocity: number;
  wheelAngle: number;
  hasEnergy: boolean;
  isDragging: boolean;
  floatingWatts: FloatingWatt[];
  multiplier: number;
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  wheelRef: React.RefObject<HTMLDivElement>;
}) {
  const speed = Math.abs(angularVelocity);
  const glowIntensity = Math.min(1, speed / 15);
  const rpm = Math.round(speed * 10);
  const half = WHEEL_SIZE / 2;
  const spokeLen = half - 20;
  const handleRadius = half - 14;
  const handleAngleRad = (wheelAngle * Math.PI) / 180;
  const handleX = half + Math.cos(handleAngleRad) * handleRadius;
  const handleY = half + Math.sin(handleAngleRad) * handleRadius;

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex items-center gap-2">
        <Gauge className="h-3.5 w-3.5 text-cyan-400/70" />
        <span className="text-xs font-mono text-cyan-400/70" data-testid="text-rpm">
          {rpm} RPM
        </span>
      </div>
      <div
        ref={wheelRef}
        className="relative select-none touch-none cursor-grab active:cursor-grabbing"
        style={{ width: WHEEL_SIZE, height: WHEEL_SIZE }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onPointerCancel={onPointerUp}
        data-testid="crank-wheel"
      >
        <div
          className={`w-full h-full rounded-full ${hasEnergy ? "" : "opacity-40"}`}
          style={{
            background: `radial-gradient(circle at 40% 40%, rgba(6,182,212,0.15), transparent 70%)`,
            boxShadow: hasEnergy
              ? `0 0 ${20 + glowIntensity * 40}px rgba(6,182,212,${0.15 + glowIntensity * 0.4}), inset 0 0 ${10 + glowIntensity * 20}px rgba(6,182,212,${0.1 + glowIntensity * 0.2})`
              : "inset 0 -4px 12px rgba(0,0,0,0.15)",
            transition: "box-shadow 0.15s ease-out",
          }}
        >
          <svg width={WHEEL_SIZE} height={WHEEL_SIZE} className="absolute inset-0">
            <circle cx={half} cy={half} r={half - 4} fill="none" stroke="rgba(6,182,212,0.3)" strokeWidth="3" />
            <circle cx={half} cy={half} r={half - 12} fill="none" stroke="rgba(6,182,212,0.15)" strokeWidth="1.5" strokeDasharray="4 4" />
            <circle cx={half} cy={half} r={20} fill="rgba(15,23,42,0.8)" stroke="rgba(6,182,212,0.3)" strokeWidth="2" />
            <circle cx={half} cy={half} r={8} fill={`rgba(6,182,212,${0.4 + glowIntensity * 0.6})`} />
            {Array.from({ length: SPOKE_COUNT }).map((_, i) => {
              const angle = (wheelAngle + (i * 360) / SPOKE_COUNT) * (Math.PI / 180);
              const x1 = half + Math.cos(angle) * 22;
              const y1 = half + Math.sin(angle) * 22;
              const x2 = half + Math.cos(angle) * spokeLen;
              const y2 = half + Math.sin(angle) * spokeLen;
              return (
                <line
                  key={i} x1={x1} y1={y1} x2={x2} y2={y2}
                  stroke={`rgba(6,182,212,${0.3 + glowIntensity * 0.5})`}
                  strokeWidth="2.5" strokeLinecap="round"
                />
              );
            })}
            <circle
              cx={handleX} cy={handleY} r={12}
              fill={isDragging ? "rgba(6,182,212,0.9)" : "rgba(6,182,212,0.6)"}
              stroke="rgba(255,255,255,0.5)" strokeWidth="2"
            />
            <circle cx={handleX} cy={handleY} r={5} fill="rgba(255,255,255,0.7)" />
          </svg>
        </div>

        <AnimatePresence>
          {floatingWatts.map((watt) => (
            <motion.div
              key={watt.id}
              initial={{ x: watt.x - 20, y: watt.y - 20, opacity: 1, scale: 1 }}
              animate={{ y: watt.y - 80, opacity: 0, scale: 0.5 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.7, ease: "easeOut" }}
              className="absolute top-0 left-0 pointer-events-none text-cyan-400 font-bold text-lg"
            >
              +{multiplier} W
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
      <p className="text-[10px] text-muted-foreground">
        {isDragging ? "Cranking..." : speed > STOP_THRESHOLD ? "Spinning..." : hasEnergy ? "Drag in a circle to crank" : "No energy"}
      </p>
    </div>
  );
}

function EnergyOrb({
  hasEnergy,
  tier,
  onTap,
  floatingWatts,
  multiplier,
  tapScale,
  orbRef,
  totalWatts,
  wps,
}: {
  hasEnergy: boolean;
  tier: string;
  onTap: (e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => void;
  floatingWatts: FloatingWatt[];
  multiplier: number;
  tapScale: number;
  orbRef: React.RefObject<HTMLDivElement>;
  totalWatts: number;
  wps: number;
}) {
  const colors = TIER_COLORS[tier] || TIER_COLORS.FREE;

  return (
    <div className="relative flex flex-col items-center" ref={orbRef}>
      <div className="relative">
        <div
          className="absolute animate-orb-rotate"
          style={{ width: ORB_SIZE + 50, height: ORB_SIZE + 50, left: -25, top: -25 }}
        >
          <svg width={ORB_SIZE + 50} height={ORB_SIZE + 50} className="opacity-20">
            <circle
              cx={(ORB_SIZE + 50) / 2}
              cy={(ORB_SIZE + 50) / 2}
              r={(ORB_SIZE + 50) / 2 - 4}
              fill="none"
              stroke={colors.glow}
              strokeWidth="1.5"
              strokeDasharray="6 10"
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
            className={`w-full h-full rounded-full bg-gradient-to-br ${colors.accent} animate-orb-pulse`}
            style={{
              boxShadow: hasEnergy
                ? `0 0 60px ${colors.glow}, 0 0 120px rgba(${colors.glowRgba},0.2), inset 0 0 60px rgba(255,255,255,0.1)`
                : "none",
            }}
          >
            <div
              className="absolute inset-0 rounded-full opacity-40"
              style={{
                background: `radial-gradient(circle at 35% 35%, rgba(255,255,255,0.4), transparent 60%)`,
              }}
            />

            <div className="absolute inset-0 rounded-full overflow-hidden">
              <div
                className="absolute inset-[-50%] animate-orb-rotate"
                style={{
                  background: `conic-gradient(from 0deg, transparent, rgba(${colors.glowRgba},0.3), transparent, rgba(${colors.glowRgba},0.3), transparent)`,
                  opacity: hasEnergy ? 0.4 : 0.1,
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
                d={`M ${ORB_SIZE * 0.2} ${ORB_SIZE * 0.15} Q ${ORB_SIZE * 0.35} ${ORB_SIZE * 0.3} ${ORB_SIZE * 0.5} ${ORB_SIZE * 0.12} Q ${ORB_SIZE * 0.65} ${ORB_SIZE * 0.05} ${ORB_SIZE * 0.8} ${ORB_SIZE * 0.2}`}
                fill="none"
                stroke="rgba(255,255,255,0.5)"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
              <path
                d={`M ${ORB_SIZE * 0.15} ${ORB_SIZE * 0.7} Q ${ORB_SIZE * 0.3} ${ORB_SIZE * 0.6} ${ORB_SIZE * 0.5} ${ORB_SIZE * 0.75} Q ${ORB_SIZE * 0.7} ${ORB_SIZE * 0.85} ${ORB_SIZE * 0.85} ${ORB_SIZE * 0.7}`}
                fill="none"
                stroke="rgba(255,255,255,0.35)"
                strokeWidth="1"
                strokeLinecap="round"
              />
              <path
                d={`M ${ORB_SIZE * 0.1} ${ORB_SIZE * 0.4} Q ${ORB_SIZE * 0.25} ${ORB_SIZE * 0.5} ${ORB_SIZE * 0.15} ${ORB_SIZE * 0.6}`}
                fill="none"
                stroke="rgba(255,255,255,0.3)"
                strokeWidth="1"
                strokeLinecap="round"
              />
              <path
                d={`M ${ORB_SIZE * 0.85} ${ORB_SIZE * 0.35} Q ${ORB_SIZE * 0.75} ${ORB_SIZE * 0.45} ${ORB_SIZE * 0.9} ${ORB_SIZE * 0.55}`}
                fill="none"
                stroke="rgba(255,255,255,0.3)"
                strokeWidth="1"
                strokeLinecap="round"
              />
            </svg>

            <div className="absolute inset-0 flex flex-col items-center justify-center z-10 pointer-events-none">
              <span className="text-[10px] uppercase tracking-[0.2em] text-white/70 font-medium">Tap to Generate</span>
              <span className="text-3xl font-black text-white tracking-tight leading-none mt-1" data-testid="text-total-coins-orb">
                {formatNumber(totalWatts)}
              </span>
              <span className="text-lg font-bold text-white/80 -mt-0.5">W</span>
              {wps > 1 && (
                <span className="text-xs text-emerald-400 font-semibold mt-0.5" data-testid="text-wps-orb">
                  +{formatNumber(wps)} W/tap
                </span>
              )}
            </div>
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
              className="absolute pointer-events-none font-bold text-lg"
              style={{ color: TIER_COLORS[tier]?.glow || "rgba(6,182,212,0.8)" }}
            >
              +{multiplier} W
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      <div className="sci-fi-platform mt-[-10px]" />
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

function PotCard({
  label,
  amount,
  gradientClass,
  borderColor,
  labelColor,
}: {
  label: string;
  amount: number;
  gradientClass: string;
  borderColor: string;
  labelColor: string;
}) {
  return (
    <div
      className={`flex-1 rounded-xl overflow-hidden border ${borderColor} relative`}
      data-testid={`pot-card-${label.toLowerCase()}`}
    >
      <div className={`absolute inset-0 ${gradientClass}`} />
      <div className="absolute inset-0 bg-black/40" />
      <div className="relative z-10 p-3 text-center">
        <div className={`text-[10px] font-black uppercase tracking-widest ${labelColor} mb-1`}>
          {label}
        </div>
        <div className="text-base font-black text-white leading-tight">
          ${formatNumber(amount)}
        </div>
        <div className="text-[9px] text-white/60 font-medium">USDT</div>
        <div className="text-[9px] text-white/40 mt-0.5">Daily Pot</div>
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

  const [wheelAngle, setWheelAngle] = useState(0);
  const [angularVelocity, setAngularVelocity] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  const wattIdRef = useRef(0);
  const pendingTapsRef = useRef(0);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wheelRef = useRef<HTMLDivElement>(null);
  const orbRef = useRef<HTMLDivElement>(null);
  const lastAngleRef = useRef<number | null>(null);
  const accumulatedRotationRef = useRef(0);
  const angularVelocityRef = useRef(0);
  const wheelAngleRef = useRef(0);
  const animFrameRef = useRef<number>(0);
  const isDraggingRef = useRef(false);
  const liveEnergyRef = useRef<number | null>(null);

  const { toast } = useToast();

  const { data: user, isLoading } = useQuery<UserWithTierConfig>({
    queryKey: ["/api/user"],
    enabled: !guest,
  });

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
      toast({ title: "Full Tank!", description: "Energy fully restored. Keep generating!" });
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

  const registerCrankTap = useCallback(() => {
    if (guest) {
      setGuestWatts((prev) => prev + 1);
      const half = WHEEL_SIZE / 2;
      const angle = wheelAngleRef.current * (Math.PI / 180);
      const spawnX = half + Math.cos(angle) * (half * 0.6);
      const spawnY = half + Math.sin(angle) * (half * 0.6);
      const id = ++wattIdRef.current;
      setFloatingWatts((prev) => [...prev, { id, x: spawnX, y: spawnY }]);
      setTimeout(() => setFloatingWatts((prev) => prev.filter((c) => c.id !== id)), 800);
      return;
    }

    const currentEnergy = liveEnergyRef.current ?? 0;
    if (currentEnergy <= 0) return;

    pendingTapsRef.current += 1;
    setLiveEnergy((prev) => Math.max(0, (prev ?? currentEnergy) - 1));
    liveEnergyRef.current = Math.max(0, currentEnergy - 1);

    const mult = tc.tapMultiplier ?? 1;
    queryClient.setQueryData<UserWithTierConfig>(["/api/user"], (old) =>
      old ? { ...old, energy: Math.max(0, old.energy - 1), totalCoins: old.totalCoins + mult } : old
    );

    const half = WHEEL_SIZE / 2;
    const angle = wheelAngleRef.current * (Math.PI / 180);
    const spawnX = half + Math.cos(angle) * (half * 0.6);
    const spawnY = half + Math.sin(angle) * (half * 0.6);
    const id = ++wattIdRef.current;
    setFloatingWatts((prev) => [...prev, { id, x: spawnX, y: spawnY }]);
    setTimeout(() => setFloatingWatts((prev) => prev.filter((c) => c.id !== id)), 800);

    if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    if (pendingTapsRef.current >= 50) {
      flushTaps();
    } else {
      flushTimerRef.current = setTimeout(flushTaps, 2000);
    }
  }, [guest, tc.tapMultiplier, flushTaps]);

  useEffect(() => {
    const isFree = guest || (user?.tier || "FREE") === "FREE";
    if (!isFree) return;

    let lastTime = performance.now();

    const animate = (now: number) => {
      const dt = Math.min((now - lastTime) / 16.667, 3);
      lastTime = now;

      let vel = angularVelocityRef.current;

      if (guest) {
        if (!isDraggingRef.current) {
          vel *= Math.pow(FRICTION, dt);
          if (Math.abs(vel) < STOP_THRESHOLD) vel = 0;
        }
      } else {
        const currentEnergy = liveEnergyRef.current ?? 0;
        if (currentEnergy <= 0) {
          vel *= Math.pow(NO_ENERGY_FRICTION, dt);
          if (Math.abs(vel) < STOP_THRESHOLD) vel = 0;
        } else if (!isDraggingRef.current) {
          vel *= Math.pow(FRICTION, dt);
          if (Math.abs(vel) < STOP_THRESHOLD) vel = 0;
        }
      }

      angularVelocityRef.current = vel;
      const angleDelta = vel * dt;
      wheelAngleRef.current = (wheelAngleRef.current + angleDelta) % 360;

      const canGenerate = guest || (liveEnergyRef.current ?? 0) > 0;
      if (Math.abs(angleDelta) > 0.01 && canGenerate) {
        accumulatedRotationRef.current += Math.abs(angleDelta);
        while (accumulatedRotationRef.current >= 360) {
          accumulatedRotationRef.current -= 360;
          registerCrankTap();
        }
      }

      setWheelAngle(wheelAngleRef.current);
      setAngularVelocity(vel);

      animFrameRef.current = requestAnimationFrame(animate);
    };

    animFrameRef.current = requestAnimationFrame(animate);
    return () => {
      cancelAnimationFrame(animFrameRef.current);
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTaps();
      }
    };
  }, [guest, user?.tier, registerCrankTap, flushTaps]);

  const getAngleFromPointer = useCallback((clientX: number, clientY: number): number | null => {
    const el = wheelRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    return Math.atan2(clientY - cy, clientX - cx);
  }, []);

  const handleCrankDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const angle = getAngleFromPointer(e.clientX, e.clientY);
    if (angle === null) return;
    lastAngleRef.current = angle;
    isDraggingRef.current = true;
    setIsDragging(true);
  }, [getAngleFromPointer]);

  const handleCrankMove = useCallback((e: React.PointerEvent) => {
    if (!isDraggingRef.current || lastAngleRef.current === null) return;
    if (!guest) {
      const currentEnergy = liveEnergyRef.current ?? 0;
      if (currentEnergy <= 0) return;
    }

    const angle = getAngleFromPointer(e.clientX, e.clientY);
    if (angle === null) return;

    let delta = (angle - lastAngleRef.current) * (180 / Math.PI);
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;

    angularVelocityRef.current += delta * 0.4;
    const maxVel = 25;
    angularVelocityRef.current = Math.max(-maxVel, Math.min(maxVel, angularVelocityRef.current));

    lastAngleRef.current = angle;
  }, [getAngleFromPointer, guest]);

  const handleCrankUp = useCallback(() => {
    isDraggingRef.current = false;
    lastAngleRef.current = null;
    setIsDragging(false);
  }, []);

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
    [user, liveEnergy, flushTaps, tc.tapMultiplier]
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
  const isFreeUser = guest || currentTier === "FREE";
  const tierLabel = getTierLabel(user);
  const tierColors = TIER_COLORS[currentTier] || TIER_COLORS.FREE;
  const walletBalance = user?.walletBalance ?? 0;

  const handleChallengeResolved = useCallback((passed: boolean) => {
    setShowChallenge(false);
    queryClient.invalidateQueries({ queryKey: ["/api/user"] });
  }, []);

  const topThree = (leaderboard || []).slice(0, 3);

  const placeholderLeaderboard: LeaderboardEntry[] = guest && topThree.length === 0 ? [
    { id: 1, username: "Sarah", telegramFirstName: "Sarah", telegramPhotoUrl: null, totalCoins: 3200000, tier: "GOLD" },
    { id: 2, username: "Max", telegramFirstName: "Max", telegramPhotoUrl: null, totalCoins: 2900000, tier: "SILVER" },
    { id: 3, username: "John", telegramFirstName: "John", telegramPhotoUrl: null, totalCoins: 2700000, tier: "BRONZE" },
  ] : topThree;

  if (guest) {
    return (
      <div className="relative flex flex-col items-center px-4 pb-8 pt-2 max-w-md mx-auto space-y-4 min-h-full">
        <div className="atmospheric-bg" />

        <div className="flex items-center justify-center gap-2 z-10">
          <Zap className="h-4 w-4 text-cyan-400 fill-cyan-400" />
          <span className="text-xs font-black uppercase tracking-[0.15em] text-cyan-400" data-testid="text-tier-label">
            FREE TIER
          </span>
        </div>

        <div className="relative w-full flex items-center justify-center z-10">
          <div className="absolute left-0 top-1/2 -translate-y-1/2">
            <div className="flex flex-col items-center gap-1 rounded-xl border border-white/10 px-3 py-2.5"
              style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(8px)" }}
            >
              <span className="text-[9px] text-white/50 uppercase tracking-wider">Daily Streak</span>
              <div className="flex items-center gap-1">
                <Flame className="h-4 w-4 text-orange-400" />
                <span className="text-lg font-black text-white">0</span>
              </div>
              <span className="text-[9px] text-white/40">Days</span>
            </div>
          </div>

          <div className="flex flex-col items-center">
            <div className="text-center mb-2">
              <p className="text-[10px] text-white/50 uppercase tracking-[0.2em]">Spin to Generate</p>
              <div className="flex items-baseline justify-center gap-1">
                <span className="text-3xl font-black tracking-tight text-white" data-testid="text-total-coins">
                  {formatNumber(guestWatts)}
                </span>
                <span className="text-lg font-bold text-white/60">W</span>
              </div>
            </div>
            <CrankWheel
              angularVelocity={angularVelocity}
              wheelAngle={wheelAngle}
              hasEnergy={true}
              isDragging={isDragging}
              floatingWatts={floatingWatts}
              multiplier={1}
              onPointerDown={handleCrankDown}
              onPointerMove={handleCrankMove}
              onPointerUp={handleCrankUp}
              wheelRef={wheelRef as React.RefObject<HTMLDivElement>}
            />
            <div className="sci-fi-platform mt-[-6px]" />
          </div>

          <div className="absolute right-0 top-1/2 -translate-y-1/2">
            <div className="flex flex-col items-center gap-1 rounded-xl border border-white/10 px-3 py-2.5"
              style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(8px)" }}
            >
              <span className="text-[9px] text-white/50 uppercase tracking-wider">Boosters</span>
              <div className="flex items-center gap-1">
                <Rocket className="h-4 w-4 text-violet-400" />
                <span className="text-lg font-black text-white">0</span>
              </div>
              <span className="text-[9px] text-white/40">Active</span>
            </div>
          </div>
        </div>

        <div
          className="w-full rounded-xl border border-amber-500/30 p-3 text-center z-10"
          style={{ background: "rgba(0,0,0,0.4)" }}
        >
          <p className="text-xs text-amber-400 font-semibold">
            Sign in to save your progress and earn real rewards
          </p>
        </div>

        <div className="w-full z-10">
          <div className="flex gap-2">
            <PotCard
              label="DIESEL"
              amount={12402}
              gradientClass="pot-bg-diesel"
              borderColor="border-orange-500/50"
              labelColor="text-orange-400"
            />
            <PotCard
              label="LNG"
              amount={41221}
              gradientClass="pot-bg-lng"
              borderColor="border-yellow-500/50"
              labelColor="text-yellow-400"
            />
            <PotCard
              label="FUSION"
              amount={129880}
              gradientClass="pot-bg-fusion"
              borderColor="border-purple-500/50"
              labelColor="text-purple-400"
            />
          </div>
        </div>

        <div className="w-full z-10">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-bold text-white">Live Leaderboard</span>
              <span className="text-sm text-white/40">(Today)</span>
            </div>
            <span className="text-[11px] text-white/50 flex items-center gap-0.5">
              View All <ChevronRight className="h-3 w-3" />
            </span>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {placeholderLeaderboard.map((entry, idx) => {
              const tc2 = TIER_COLORS[entry.tier]?.label || "text-cyan-400";
              return (
                <div
                  key={entry.id}
                  className="flex items-center gap-2.5 rounded-xl border border-white/10 px-3 py-2.5 min-w-[140px]"
                  style={{ background: "rgba(0,0,0,0.4)" }}
                  data-testid={`leaderboard-entry-${idx}`}
                >
                  <div className="relative">
                    <div className="flex items-center justify-center w-9 h-9 rounded-full border-2 border-white/20 text-sm font-bold text-white"
                      style={{ background: "rgba(255,255,255,0.1)" }}
                    >
                      {(entry.telegramFirstName?.slice(0, 1) || entry.username.slice(0, 1)).toUpperCase()}
                    </div>
                    {idx === 0 && <Crown className="absolute -top-2 -right-1 h-3.5 w-3.5 text-amber-400" />}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1">
                      <span className="text-amber-400 text-xs font-black">#{idx + 1}</span>
                      <span className="text-xs font-semibold text-white truncate">
                        {entry.telegramFirstName || entry.username}
                      </span>
                    </div>
                    <span className="text-[11px] text-emerald-400 font-bold">
                      {formatNumber(entry.totalCoins)} W
                    </span>
                  </div>
                  <Trophy className={`h-4 w-4 ${tc2} ml-auto flex-shrink-0`} />
                </div>
              );
            })}
          </div>
        </div>

        <div className="w-full grid grid-cols-2 gap-2.5 z-10">
          <div
            className="rounded-xl border border-amber-500/30 p-3.5 relative overflow-hidden"
            style={{ background: "linear-gradient(135deg, rgba(0,0,0,0.6), rgba(30,20,0,0.4))" }}
          >
            <div className="flex items-center gap-2 mb-2">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: "rgba(245,158,11,0.15)" }}>
                <Settings className="h-6 w-6 text-amber-400" />
              </div>
              <div>
                <span className="text-sm font-bold text-white block">Upgrades</span>
                <span className="text-[10px] text-white/50">Generator Lv.1</span>
              </div>
            </div>
            <Button size="sm" className="w-full h-8 text-xs bg-amber-500 hover:bg-amber-600 text-black font-bold" data-testid="button-guest-upgrade">
              Unlock
            </Button>
          </div>

          <div
            className="rounded-xl border border-emerald-500/40 p-3.5 relative overflow-hidden"
            style={{ background: "linear-gradient(135deg, rgba(0,0,0,0.6), rgba(0,30,15,0.4))" }}
          >
            <div className="flex items-center gap-1.5 mb-1">
              <DollarSign className="h-4 w-4 text-emerald-400" />
              <span className="text-sm font-bold text-white">My Earnings</span>
            </div>
            <p className="text-2xl font-black text-emerald-400 leading-tight">
              $0.00
            </p>
            <p className="text-[10px] text-white/40 mb-2">This Month</p>
            <Button
              size="sm"
              className="w-full h-8 text-xs bg-emerald-500 hover:bg-emerald-600 text-black font-bold"
              data-testid="button-guest-withdraw"
            >
              Withdraw
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex flex-col items-center px-4 pb-8 pt-2 max-w-md mx-auto space-y-4 min-h-full">
      <div className="atmospheric-bg" />

      {showChallenge && (
        <ChallengeOverlay onResolved={handleChallengeResolved} />
      )}

      <div className="flex items-center justify-center gap-2 z-10">
        <Zap className={`h-4 w-4 ${tierColors.label} fill-current`} />
        <span className={`text-xs font-black uppercase tracking-[0.15em] ${tierColors.label}`} data-testid="text-tier-label">
          {tierLabel}
        </span>
        {currentTier !== "FREE" && (
          <Crown className={`h-3.5 w-3.5 ${tierColors.label}`} />
        )}
      </div>

      <div className="relative w-full flex items-center justify-center z-10">
        <div className="absolute left-0 top-1/2 -translate-y-1/2">
          <div className="flex flex-col items-center gap-1 rounded-xl border border-white/10 px-3 py-2.5"
            style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(8px)" }}
            data-testid="info-daily-streak"
          >
            <span className="text-[9px] text-white/50 uppercase tracking-wider">Daily Streak</span>
            <div className="flex items-center gap-1">
              <Flame className="h-4 w-4 text-orange-400" />
              <span className="text-lg font-black text-white">0</span>
            </div>
            <span className="text-[9px] text-white/40">Days</span>
          </div>
        </div>

        <div className="flex flex-col items-center">
          {isFreeUser ? (
            <>
              <div className="text-center mb-2">
                <p className="text-[10px] text-white/50 uppercase tracking-[0.2em]">Spin to Generate</p>
                <div className="flex items-baseline justify-center gap-1">
                  <span className="text-3xl font-black tracking-tight text-white" data-testid="text-total-coins">
                    {formatNumber(totalWatts)}
                  </span>
                  <span className="text-lg font-bold text-white/60">W</span>
                </div>
                {(tc.tapMultiplier ?? 1) > 1 && (
                  <span className="text-xs text-emerald-400 font-semibold">
                    +{tc.tapMultiplier} W/spin
                  </span>
                )}
              </div>
              <CrankWheel
                angularVelocity={angularVelocity}
                wheelAngle={wheelAngle}
                hasEnergy={currentEnergy > 0}
                isDragging={isDragging}
                floatingWatts={floatingWatts}
                multiplier={tc.tapMultiplier ?? 1}
                onPointerDown={handleCrankDown}
                onPointerMove={handleCrankMove}
                onPointerUp={handleCrankUp}
                wheelRef={wheelRef as React.RefObject<HTMLDivElement>}
              />
              <div className="sci-fi-platform mt-[-6px]" />
            </>
          ) : (
            <EnergyOrb
              hasEnergy={currentEnergy > 0}
              tier={currentTier}
              onTap={handleTap}
              floatingWatts={floatingWatts}
              multiplier={tc.tapMultiplier ?? 1}
              tapScale={tapScale}
              orbRef={orbRef as React.RefObject<HTMLDivElement>}
              totalWatts={totalWatts}
              wps={tc.tapMultiplier ?? 1}
            />
          )}
        </div>

        <div className="absolute right-0 top-1/2 -translate-y-1/2">
          <div className="flex flex-col items-center gap-1 rounded-xl border border-white/10 px-3 py-2.5"
            style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(8px)" }}
            data-testid="info-boosters"
          >
            <span className="text-[9px] text-white/50 uppercase tracking-wider">Boosters</span>
            <div className="flex items-center gap-1">
              <Rocket className="h-4 w-4 text-violet-400" />
              <span className="text-lg font-black text-white">{earnings?.tapMultiplierLevel ?? 1}</span>
            </div>
            <span className="text-[9px] text-white/40">Active</span>
          </div>
        </div>
      </div>

      <div className="w-full space-y-1.5 z-10">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-1.5">
            <Zap className="h-3.5 w-3.5 text-emerald-400" />
            <span className="text-white/50">Energy</span>
          </div>
          <span className="font-mono text-white/50" data-testid="text-energy">
            {currentEnergy}/{maxEnergy}
          </span>
        </div>
        <div className="h-2.5 w-full rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
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
          <span className="text-[10px] text-white/40 flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {currentEnergy >= maxEnergy ? "Full!" : getTimeUntilFullEnergy(currentEnergy, maxEnergy, tc)}
          </span>
          {hasRefillFeature && canRefill && (
            <Button
              size="sm"
              variant="outline"
              className="h-6 text-[10px] px-2 border-white/20"
              onClick={() => refillMutation.mutate()}
              disabled={refillMutation.isPending || currentEnergy >= maxEnergy}
              data-testid="button-full-tank"
            >
              <BatteryCharging className="h-3 w-3 mr-1" />
              {refillMutation.isPending ? "Filling..." : "Refill"}
            </Button>
          )}
          {hasRefillFeature && !canRefill && (
            <span className="text-[10px] text-white/40" data-testid="text-refill-cooldown">
              Refill in {cooldownLabel}
            </span>
          )}
          {!hasRefillFeature && (
            <span className="text-[10px] text-white/40 flex items-center gap-1" data-testid="text-refill-locked">
              <Lock className="h-3 w-3" />
              Upgrade for refills
            </span>
          )}
        </div>
      </div>

      <div className="w-full z-10">
        <div className="flex gap-2">
          <PotCard
            label="DIESEL"
            amount={earnings?.tapPotSize ?? 12402}
            gradientClass="pot-bg-diesel"
            borderColor="border-orange-500/50"
            labelColor="text-orange-400"
          />
          <PotCard
            label="LNG"
            amount={(earnings?.tapPotSize ?? 12402) * 3.3}
            gradientClass="pot-bg-lng"
            borderColor="border-yellow-500/50"
            labelColor="text-yellow-400"
          />
          <PotCard
            label="FUSION"
            amount={(earnings?.tapPotSize ?? 12402) * 10.5}
            gradientClass="pot-bg-fusion"
            borderColor="border-purple-500/50"
            labelColor="text-purple-400"
          />
        </div>
      </div>

      {topThree.length > 0 && (
        <div className="w-full z-10">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-bold text-white">Live Leaderboard</span>
              <span className="text-sm text-white/40">(Today)</span>
            </div>
            <Link href="/leaderboard" className="text-[11px] text-white/50 flex items-center gap-0.5 hover:text-white/70" data-testid="link-view-leaderboard">
              View All <ChevronRight className="h-3 w-3" />
            </Link>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {topThree.map((entry, idx) => {
              const tierColor = TIER_COLORS[entry.tier]?.label || "text-cyan-400";
              return (
                <div
                  key={entry.id}
                  className="flex items-center gap-2.5 rounded-xl border border-white/10 px-3 py-2.5 min-w-[140px]"
                  style={{ background: "rgba(0,0,0,0.4)" }}
                  data-testid={`leaderboard-entry-${idx}`}
                >
                  <div className="relative">
                    <div className="flex items-center justify-center w-9 h-9 rounded-full border-2 border-white/20 text-sm font-bold text-white"
                      style={{ background: "rgba(255,255,255,0.1)" }}
                    >
                      {entry.telegramPhotoUrl ? (
                        <img src={entry.telegramPhotoUrl} alt="" className="w-full h-full rounded-full object-cover" />
                      ) : (
                        (entry.telegramFirstName?.slice(0, 1) || entry.username.slice(0, 1)).toUpperCase()
                      )}
                    </div>
                    {idx === 0 && <Crown className="absolute -top-2 -right-1 h-3.5 w-3.5 text-amber-400" />}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1">
                      <span className="text-amber-400 text-xs font-black">#{idx + 1}</span>
                      <span className="text-xs font-semibold text-white truncate">
                        {entry.telegramFirstName || entry.username}
                      </span>
                    </div>
                    <span className="text-[11px] text-emerald-400 font-bold">
                      {formatNumber(entry.totalCoins)} W
                    </span>
                  </div>
                  {idx < 3 && <Trophy className={`h-4 w-4 ${tierColor} ml-auto flex-shrink-0`} />}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="w-full grid grid-cols-2 gap-2.5 z-10">
        <div
          className="rounded-xl border border-amber-500/30 p-3.5 relative overflow-hidden"
          style={{ background: "linear-gradient(135deg, rgba(0,0,0,0.6), rgba(30,20,0,0.4))" }}
          data-testid="card-upgrades"
        >
          <div className="flex items-center gap-2 mb-2">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: "rgba(245,158,11,0.15)" }}>
              <Settings className="h-6 w-6 text-amber-400" />
            </div>
            <div>
              <span className="text-sm font-bold text-white block">Upgrades</span>
              <span className="text-[10px] text-white/50">Generator Lv.{earnings?.tapMultiplierLevel ?? 1}</span>
            </div>
          </div>
          {user?.tier === "FREE" ? (
            <Link href="/subscription">
              <Button size="sm" className="w-full h-8 text-xs bg-amber-500 hover:bg-amber-600 text-black font-bold" data-testid="button-unlock-upgrades">
                Unlock
              </Button>
            </Link>
          ) : earnings?.isMaxed ? (
            earnings?.nextTier ? (
              <Link href="/subscription">
                <Button size="sm" variant="outline" className="w-full h-8 text-xs border-amber-500/30" data-testid="button-unlock-tier">
                  Next Tier
                </Button>
              </Link>
            ) : (
              <span className="text-xs text-emerald-400 font-bold">Maxed!</span>
            )
          ) : (
            <Button
              size="sm"
              className="w-full h-8 text-xs bg-amber-500 hover:bg-amber-600 text-black font-bold"
              onClick={() => upgradeMutation.mutate()}
              disabled={upgradeMutation.isPending || (user?.totalCoins ?? 0) < (earnings?.upgradeCost ?? Infinity)}
              data-testid="button-upgrade-multiplier"
            >
              {upgradeMutation.isPending ? "..." : `Upgrade`}
            </Button>
          )}
        </div>

        <div
          className="rounded-xl border border-emerald-500/40 p-3.5 relative overflow-hidden"
          style={{ background: "linear-gradient(135deg, rgba(0,0,0,0.6), rgba(0,30,15,0.4))" }}
          data-testid="card-earnings"
        >
          <div className="flex items-center gap-1.5 mb-1">
            <DollarSign className="h-4 w-4 text-emerald-400" />
            <span className="text-sm font-bold text-white">My Earnings</span>
          </div>
          <p className="text-2xl font-black text-emerald-400 leading-tight" data-testid="text-wallet-balance">
            ${typeof walletBalance === 'number' ? walletBalance.toFixed(2) : '0.00'}
          </p>
          <p className="text-[10px] text-white/40 mb-2">This Month</p>
          <Link href="/wallet">
            <Button
              size="sm"
              className="w-full h-8 text-xs bg-emerald-500 hover:bg-emerald-600 text-black font-bold"
              data-testid="button-withdraw"
            >
              Withdraw
            </Button>
          </Link>
        </div>
      </div>

      {currentEnergy <= 0 && (
        <div
          className="w-full rounded-xl border border-red-500/30 p-4 text-center space-y-2 z-10"
          style={{ background: "rgba(0,0,0,0.5)" }}
        >
          <p className="text-sm text-white/60">
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
            <p className="text-xs text-white/40">
              Full Tank recharging: {cooldownLabel}
            </p>
          )}
          {!hasRefillFeature && (
            <p className="text-xs text-white/40">
              Upgrade to unlock Full Tank refills!
            </p>
          )}
        </div>
      )}
    </div>
  );
}
