import { useState, useCallback, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Zap, Clock, BatteryCharging, Lock, DollarSign, TrendingUp, Flame, Rocket, Crown, Trophy, ChevronRight, Gauge, Settings, Fuel, Wrench, AlertTriangle } from "lucide-react";
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
import potDieselBg from "@assets/pot-diesel.png";
import potLngBg from "@assets/pot-lng.png";
import potFusionBg from "@assets/pot-fusion.png";
import bgAtmosphere from "@assets/bg-atmosphere.png";
import cardUpgradesBg from "@assets/card-upgrades.png";
import cardEarningsBg from "@assets/card-earnings.png";
import cardLeaderboardBg from "@assets/card-leaderboard.png";

interface UserWithTierConfig extends User {
  tierConfig?: TierConfig;
}

interface FloatingWatt {
  id: number;
  x: number;
  y: number;
  amount?: number;
  isCombo?: boolean;
}

const SOLAR_THRESHOLD = 1_000_000;
const FRICTION = 0.985;
const STOP_THRESHOLD = 0.15;
const NO_ENERGY_FRICTION = 0.9;
const WHEEL_SIZE = 220;
const SPOKE_COUNT = 8;
const ORB_SIZE = 220;
const BOLT_COUNT = 12;
const STRESS_INCREASE_RATE = 0.0012;
const STRESS_DECAY_RATE = 0.006;
const OVERHEAT_COOLDOWN_MS = 6000;
const MAX_VELOCITY = 22;
const RESISTANCE_FACTOR = 0.004;

const DIESEL_RPM_DECAY = 0.985;
const DIESEL_THROTTLE_FORCE = 0.8;
const DIESEL_HEAT_RATE = 0.0008;
const DIESEL_HEAT_DECAY = 0.004;
const DIESEL_GREEN_MIN = 70;
const DIESEL_GREEN_MAX = 90;
const DIESEL_DANGER_THRESHOLD = 95;
const DIESEL_ENGINE_SIZE = 240;
const DIESEL_FAULT_INTERVAL_MIN = 20000;
const DIESEL_FAULT_INTERVAL_MAX = 40000;
const DIESEL_FAULT_DURATION = 5000;

interface FaultEvent {
  id: number;
  type: "oil_leak" | "loose_bolt" | "steam_pipe" | "fuel_injector";
  label: string;
  x: number;
  y: number;
  spawnedAt: number;
}

const FAULT_TYPES: { type: FaultEvent["type"]; label: string }[] = [
  { type: "oil_leak", label: "OIL LEAK" },
  { type: "loose_bolt", label: "LOOSE BOLT" },
  { type: "steam_pipe", label: "STEAM PIPE" },
  { type: "fuel_injector", label: "FUEL INJECT" },
];

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

function StressMeter({ stress, isOverheated }: { stress: number; isOverheated: boolean }) {
  const pct = Math.min(100, stress * 100);
  const barColor = isOverheated
    ? "bg-red-500"
    : pct > 75
    ? "bg-orange-500"
    : pct > 40
    ? "bg-yellow-500"
    : "bg-cyan-500/60";

  return (
    <div className="w-full max-w-[180px] space-y-0.5" data-testid="stress-meter">
      <div className="flex items-center justify-between">
        <span className="text-[9px] uppercase tracking-wider text-white/40 font-medium">Engine Temperature</span>
        <span className={`text-[9px] font-mono ${isOverheated ? "text-red-400 animate-pulse" : "text-white/40"}`}>
          {Math.round(pct)}%
        </span>
      </div>
      <div className="h-1.5 w-full rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
        <div
          className={`h-full rounded-full transition-all duration-200 ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {isOverheated && (
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-center mt-1"
        >
          <span className="text-[10px] font-black text-red-400 uppercase tracking-widest animate-pulse">
            ENGINE OVERHEATED
          </span>
        </motion.div>
      )}
    </div>
  );
}

function MilestoneProgress({ totalWatts }: { totalWatts: number }) {
  const watts = totalWatts ?? 0;
  const pct = Math.min(100, (watts / SOLAR_THRESHOLD) * 100);
  const remaining = Math.max(0, SOLAR_THRESHOLD - watts);

  if (watts >= SOLAR_THRESHOLD) return null;

  return (
    <div className="w-full max-w-[220px] space-y-1" data-testid="milestone-progress">
      <div className="flex items-center justify-between">
        <span className="text-[9px] uppercase tracking-wider text-amber-400/70 font-medium">Next Milestone</span>
        <span className="text-[9px] font-mono text-amber-400/60">{formatNumber(watts)} / 1M W</span>
      </div>
      <div className="h-2 w-full rounded-full overflow-hidden" style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.2)" }}>
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${Math.max(1, pct)}%`,
            background: "linear-gradient(90deg, #f59e0b, #fbbf24)",
          }}
        />
      </div>
      <div className="text-center">
        <span className="text-[9px] text-amber-400/50">
          {formatNumber(remaining)} W to Solar License
        </span>
      </div>
    </div>
  );
}

function CrankWheel({
  angularVelocity,
  wheelAngle,
  hasEnergy,
  isDragging,
  floatingWatts,
  multiplier,
  wheelRef,
  stress,
  isOverheated,
  totalWatts,
}: {
  angularVelocity: number;
  wheelAngle: number;
  hasEnergy: boolean;
  isDragging: boolean;
  floatingWatts: FloatingWatt[];
  multiplier: number;
  wheelRef: React.RefObject<HTMLDivElement>;
  stress: number;
  isOverheated: boolean;
  totalWatts: number;
}) {
  const speed = Math.abs(angularVelocity);
  const glowIntensity = Math.min(1, speed / 12);
  const rpm = Math.round(speed * 10);
  const half = WHEEL_SIZE / 2;
  const spokeLen = half - 28;
  const handleRadius = half - 18;
  const handleAngleRad = (wheelAngle * Math.PI) / 180;
  const handleX = half + Math.cos(handleAngleRad) * handleRadius;
  const handleY = half + Math.sin(handleAngleRad) * handleRadius;

  const speedTier = speed < 3 ? "low" : speed < 8 ? "medium" : "high";

  const sparkCount = speedTier === "low" ? 3 : speedTier === "medium" ? 6 : 10;
  const sparks = Array.from({ length: sparkCount }).map((_, i) => {
    const sparkAngle = (wheelAngle + i * (360 / sparkCount) + i * 37) * (Math.PI / 180);
    const dist = half - 8 + Math.sin(Date.now() / 200 + i) * 4;
    return {
      x: half + Math.cos(sparkAngle) * dist,
      y: half + Math.sin(sparkAngle) * dist,
      opacity: 0.3 + glowIntensity * 0.7,
      size: speedTier === "high" ? 3 : 2,
    };
  });

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
        className={`relative select-none ${isOverheated ? "cursor-not-allowed" : "cursor-grab active:cursor-grabbing"}`}
        style={{ width: WHEEL_SIZE, height: WHEEL_SIZE, touchAction: "none" }}
        data-testid="crank-wheel"
      >
        <div
          className={`w-full h-full rounded-full ${hasEnergy && !isOverheated ? "" : "opacity-50"}`}
          style={{
            background: `radial-gradient(circle at 40% 40%, rgba(120,80,30,0.15), rgba(40,25,10,0.3) 60%, transparent 80%)`,
            boxShadow: hasEnergy && !isOverheated
              ? `0 0 ${15 + glowIntensity * 50}px rgba(6,182,212,${0.1 + glowIntensity * 0.5}), inset 0 0 ${8 + glowIntensity * 25}px rgba(6,182,212,${0.05 + glowIntensity * 0.25}), 0 4px 20px rgba(0,0,0,0.6)`
              : "inset 0 -4px 12px rgba(0,0,0,0.3), 0 4px 20px rgba(0,0,0,0.6)",
            transition: "box-shadow 0.15s ease-out",
          }}
        >
          <svg width={WHEEL_SIZE} height={WHEEL_SIZE} className="absolute inset-0">
            <defs>
              <radialGradient id="rustCenter" cx="45%" cy="45%">
                <stop offset="0%" stopColor="rgba(80,60,30,0.9)" />
                <stop offset="100%" stopColor="rgba(30,20,10,0.95)" />
              </radialGradient>
              <radialGradient id="brassHub">
                <stop offset="0%" stopColor="rgba(200,170,80,0.8)" />
                <stop offset="60%" stopColor="rgba(140,110,40,0.6)" />
                <stop offset="100%" stopColor="rgba(80,60,20,0.4)" />
              </radialGradient>
              <filter id="metalNoise">
                <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="4" result="noise" />
                <feComposite in="SourceGraphic" in2="noise" operator="in" />
              </filter>
            </defs>

            <circle cx={half} cy={half} r={half - 3} fill="none" stroke="rgba(100,75,40,0.5)" strokeWidth="5" />
            <circle cx={half} cy={half} r={half - 6} fill="none" stroke="rgba(60,45,20,0.6)" strokeWidth="2" />
            <circle cx={half} cy={half} r={half - 10} fill="none" stroke="rgba(80,60,30,0.3)" strokeWidth="1" strokeDasharray="3 6" />

            {Array.from({ length: BOLT_COUNT }).map((_, i) => {
              const boltAngle = ((i * 360) / BOLT_COUNT) * (Math.PI / 180);
              const boltR = half - 8;
              const bx = half + Math.cos(boltAngle) * boltR;
              const by = half + Math.sin(boltAngle) * boltR;
              return (
                <g key={`bolt-${i}`}>
                  <circle cx={bx} cy={by} r={4} fill="rgba(160,130,60,0.7)" stroke="rgba(100,80,30,0.8)" strokeWidth="1" />
                  <circle cx={bx - 0.5} cy={by - 0.5} r={1.5} fill="rgba(200,170,80,0.5)" />
                  <line x1={bx - 2} y1={by} x2={bx + 2} y2={by} stroke="rgba(60,40,15,0.6)" strokeWidth="1" />
                </g>
              );
            })}

            <circle cx={half} cy={half} r={26} fill="url(#brassHub)" stroke="rgba(160,130,60,0.6)" strokeWidth="2.5" />
            <circle cx={half} cy={half} r={14} fill="rgba(20,15,8,0.9)" stroke="rgba(100,80,30,0.5)" strokeWidth="1.5" />
            <circle cx={half} cy={half} r={7} fill={`rgba(6,182,212,${0.3 + glowIntensity * 0.7})`} />
            {glowIntensity > 0.3 && (
              <circle cx={half} cy={half} r={10} fill="none" stroke={`rgba(6,182,212,${glowIntensity * 0.4})`} strokeWidth="1" />
            )}

            {Array.from({ length: SPOKE_COUNT }).map((_, i) => {
              const angle = (wheelAngle + (i * 360) / SPOKE_COUNT) * (Math.PI / 180);
              const x1 = half + Math.cos(angle) * 28;
              const y1 = half + Math.sin(angle) * 28;
              const x2 = half + Math.cos(angle) * spokeLen;
              const y2 = half + Math.sin(angle) * spokeLen;
              const spokeGlow = speedTier !== "low" ? glowIntensity * 0.6 : 0;
              return (
                <g key={i}>
                  <line x1={x1} y1={y1} x2={x2} y2={y2}
                    stroke="rgba(90,70,35,0.8)"
                    strokeWidth="4" strokeLinecap="round"
                  />
                  <line x1={x1} y1={y1} x2={x2} y2={y2}
                    stroke={`rgba(140,110,50,0.5)`}
                    strokeWidth="2" strokeLinecap="round"
                  />
                  {spokeGlow > 0 && (
                    <line x1={x1} y1={y1} x2={x2} y2={y2}
                      stroke={`rgba(6,182,212,${spokeGlow})`}
                      strokeWidth="1.5" strokeLinecap="round"
                    />
                  )}
                </g>
              );
            })}

            {speed > STOP_THRESHOLD && sparks.map((spark, i) => (
              <circle
                key={`spark-${i}`}
                cx={spark.x}
                cy={spark.y}
                r={spark.size}
                fill={speedTier === "high" ? `rgba(6,182,212,${spark.opacity})` : `rgba(200,180,100,${spark.opacity * 0.8})`}
              >
                {speedTier !== "low" && (
                  <animate attributeName="opacity" values={`${spark.opacity};0.1;${spark.opacity}`} dur="0.3s" repeatCount="indefinite" />
                )}
              </circle>
            ))}

            {speedTier === "high" && (
              <>
                <path
                  d={`M ${half - 30} ${half - half + 20} Q ${half - 10} ${half - half + 40} ${half + 5} ${half - half + 15} Q ${half + 20} ${half - half + 5} ${half + 35} ${half - half + 25}`}
                  fill="none" stroke={`rgba(6,182,212,${0.4 + glowIntensity * 0.5})`}
                  strokeWidth="1.5" strokeLinecap="round"
                >
                  <animate attributeName="opacity" values="0.8;0.2;0.8" dur="0.4s" repeatCount="indefinite" />
                </path>
                <path
                  d={`M ${half + 20} ${half + half - 30} Q ${half + 5} ${half + half - 45} ${half - 15} ${half + half - 25} Q ${half - 30} ${half + half - 15} ${half - 40} ${half + half - 35}`}
                  fill="none" stroke={`rgba(100,200,255,${0.3 + glowIntensity * 0.4})`}
                  strokeWidth="1" strokeLinecap="round"
                >
                  <animate attributeName="opacity" values="0.6;0.15;0.6" dur="0.35s" repeatCount="indefinite" />
                </path>
              </>
            )}

            <circle
              cx={handleX} cy={handleY} r={14}
              fill={isDragging ? "rgba(160,130,60,0.95)" : "rgba(120,95,40,0.8)"}
              stroke="rgba(200,170,80,0.6)" strokeWidth="2.5"
            />
            <circle
              cx={handleX} cy={handleY} r={8}
              fill={isDragging ? "rgba(200,170,80,0.9)" : "rgba(160,130,60,0.6)"}
            />
            <circle cx={handleX - 1} cy={handleY - 1} r={3} fill="rgba(255,230,150,0.4)" />
            {isDragging && (
              <circle cx={handleX} cy={handleY} r={18} fill="none"
                stroke={`rgba(6,182,212,${0.3 + glowIntensity * 0.4})`} strokeWidth="1.5"
              />
            )}
          </svg>
        </div>

        {isOverheated && (
          <div className="absolute inset-0 rounded-full pointer-events-none"
            style={{
              background: "radial-gradient(circle, rgba(255,60,20,0.15) 0%, rgba(255,100,30,0.08) 50%, transparent 70%)",
              animation: "pulse 1s ease-in-out infinite",
            }}
          />
        )}

        <AnimatePresence>
          {floatingWatts.map((watt) => (
            <motion.div
              key={watt.id}
              initial={{ x: watt.x - 30, y: watt.y - 15, opacity: 1, scale: 1 }}
              animate={{ y: watt.y - 90, opacity: 0, scale: 0.6 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.9, ease: "easeOut" }}
              className={`absolute top-0 left-0 pointer-events-none font-black ${watt.isCombo ? "text-amber-400 text-base" : "text-cyan-400 text-sm"}`}
            >
              +{watt.amount ?? multiplier} W{watt.isCombo ? " COMBO" : ""}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      <StressMeter stress={stress} isOverheated={isOverheated} />

      <p className="text-[10px] text-muted-foreground">
        {isOverheated ? "Cooling engine..." : isDragging ? "Cranking..." : speed > STOP_THRESHOLD ? "Spinning..." : hasEnergy ? "Drag in a circle to crank" : "No fuel"}
      </p>

      <MilestoneProgress totalWatts={totalWatts} />
    </div>
  );
}

function DieselEngineControl({
  rpmPercent,
  throttlePosition,
  hasEnergy,
  isThrottling,
  floatingWatts,
  multiplier,
  engineRef,
  stress,
  isOverheated,
  totalWatts,
  faults,
  onFaultTap,
  inGreenZone,
}: {
  rpmPercent: number;
  throttlePosition: number;
  hasEnergy: boolean;
  isThrottling: boolean;
  floatingWatts: FloatingWatt[];
  multiplier: number;
  engineRef: React.RefObject<HTMLDivElement>;
  stress: number;
  isOverheated: boolean;
  totalWatts: number;
  faults: FaultEvent[];
  onFaultTap: (id: number) => void;
  inGreenZone: boolean;
}) {
  const rpm = Math.round(rpmPercent * 100);
  const SIZE = DIESEL_ENGINE_SIZE;
  const half = SIZE / 2;
  const vibrationX = rpmPercent > 0.1 ? (Math.random() - 0.5) * rpmPercent * 3 : 0;
  const vibrationY = rpmPercent > 0.1 ? (Math.random() - 0.5) * rpmPercent * 3 : 0;

  const zoneLabel = isOverheated ? "OVERHEATED" : rpmPercent >= 0.95 ? "DANGER" : inGreenZone ? "GREEN ZONE" : rpmPercent > 0.5 ? "RUNNING" : rpmPercent > 0.1 ? "LOW POWER" : "IDLE";
  const zoneColor = isOverheated ? "text-red-400" : rpmPercent >= 0.95 ? "text-red-400" : inGreenZone ? "text-emerald-400" : rpmPercent > 0.5 ? "text-orange-400" : "text-white/40";

  const gaugeRadius = 70;
  const gaugeStartAngle = Math.PI * 0.8;
  const gaugeEndAngle = Math.PI * 0.2;
  const gaugeSweep = gaugeStartAngle + (2 * Math.PI - gaugeStartAngle + gaugeEndAngle);
  const needleAngle = gaugeStartAngle + gaugeSweep * rpmPercent;
  const gaugeCx = half;
  const gaugeCy = half * 0.45;

  const makeArcPath = (startFraction: number, endFraction: number, r: number) => {
    const a1 = gaugeStartAngle + gaugeSweep * startFraction;
    const a2 = gaugeStartAngle + gaugeSweep * endFraction;
    const x1 = gaugeCx + Math.cos(a1) * r;
    const y1 = gaugeCy + Math.sin(a1) * r;
    const x2 = gaugeCx + Math.cos(a2) * r;
    const y2 = gaugeCy + Math.sin(a2) * r;
    const largeArc = (a2 - a1) > Math.PI ? 1 : 0;
    return `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`;
  };

  const needleX = gaugeCx + Math.cos(needleAngle) * (gaugeRadius - 8);
  const needleY = gaugeCy + Math.sin(needleAngle) * (gaugeRadius - 8);

  const smokeParticles = Array.from({ length: Math.floor(rpmPercent * 8) }).map((_, i) => ({
    x: SIZE * 0.15 + Math.random() * 20 - 10,
    y: half * 0.85 - i * 8 - Math.random() * 15,
    opacity: 0.15 + Math.random() * 0.25,
    size: 4 + Math.random() * 6,
  }));

  const pistonOffset1 = Math.sin(Date.now() / (200 / Math.max(0.3, rpmPercent))) * 8 * rpmPercent;
  const pistonOffset2 = Math.sin(Date.now() / (200 / Math.max(0.3, rpmPercent)) + Math.PI) * 8 * rpmPercent;

  const throttleTrackHeight = SIZE * 0.55;
  const throttleY = throttleTrackHeight * (1 - throttlePosition);
  const throttleTrackX = SIZE - 28;

  const hasFault = faults.length > 0;
  const effectiveGlow = inGreenZone ? "rgba(245,158,11,0.5)" : isOverheated || rpmPercent >= 0.95 ? "rgba(239,68,68,0.5)" : "rgba(100,100,100,0.2)";

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex items-center gap-2">
        <Gauge className="h-3.5 w-3.5 text-orange-400/70" />
        <span className={`text-xs font-mono ${zoneColor}`} data-testid="text-diesel-zone">
          {zoneLabel}
        </span>
        {hasFault && (
          <span className="text-xs text-red-400 animate-pulse font-bold" data-testid="text-fault-warning">
            FAULT
          </span>
        )}
      </div>

      <div
        ref={engineRef}
        className={`relative select-none ${isOverheated ? "cursor-not-allowed" : "cursor-pointer"}`}
        style={{ width: SIZE, height: SIZE, touchAction: "none" }}
        data-testid="diesel-engine"
      >
        <div
          style={{
            transform: `translate(${vibrationX}px, ${vibrationY}px)`,
            transition: "transform 0.05s",
          }}
        >
          <svg width={SIZE} height={SIZE} className="absolute inset-0">
            <path
              d={makeArcPath(0, 1, gaugeRadius)}
              fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="10" strokeLinecap="round"
            />
            <path
              d={makeArcPath(0, 0.5, gaugeRadius)}
              fill="none" stroke="rgba(100,100,100,0.3)" strokeWidth="10" strokeLinecap="round"
            />
            <path
              d={makeArcPath(0.5, 0.7, gaugeRadius)}
              fill="none" stroke="rgba(245,158,11,0.3)" strokeWidth="10" strokeLinecap="round"
            />
            <path
              d={makeArcPath(0.7, 0.9, gaugeRadius)}
              fill="none" stroke="rgba(16,185,129,0.5)" strokeWidth="10" strokeLinecap="round"
            />
            <path
              d={makeArcPath(0.9, 1, gaugeRadius)}
              fill="none" stroke="rgba(239,68,68,0.5)" strokeWidth="10" strokeLinecap="round"
            />

            <line
              x1={gaugeCx} y1={gaugeCy}
              x2={needleX} y2={needleY}
              stroke={rpmPercent >= 0.95 ? "#ef4444" : inGreenZone ? "#10b981" : "#f59e0b"}
              strokeWidth="2.5" strokeLinecap="round"
            />
            <circle cx={gaugeCx} cy={gaugeCy} r={5} fill="rgba(200,170,80,0.8)" />

            <text x={gaugeCx} y={gaugeCy + 18} textAnchor="middle" fill="white" fontSize="11" fontWeight="bold" fontFamily="monospace">
              {rpm}%
            </text>

            <rect
              x={half - 55} y={half * 0.75}
              width={110} height={SIZE * 0.45}
              rx={8} ry={8}
              fill="rgba(40,30,15,0.9)"
              stroke={inGreenZone ? "rgba(245,158,11,0.6)" : isOverheated ? "rgba(239,68,68,0.5)" : "rgba(100,80,30,0.5)"}
              strokeWidth="2"
            />

            <rect x={half - 45} y={half * 0.75 + 8} width={38} height={SIZE * 0.35} rx={3}
              fill="rgba(60,45,20,0.8)" stroke="rgba(100,80,30,0.4)" strokeWidth="1"
            />
            <rect x={half - 40} y={half * 0.75 + 15 + pistonOffset1} width={28} height={20} rx={2}
              fill="rgba(160,130,60,0.7)" stroke="rgba(200,170,80,0.5)" strokeWidth="1"
            />
            <line x1={half - 26} y1={half * 0.75 + 15 + pistonOffset1} x2={half - 26} y2={half * 0.75 + 8}
              stroke="rgba(140,110,50,0.6)" strokeWidth="3" strokeLinecap="round"
            />

            <rect x={half + 7} y={half * 0.75 + 8} width={38} height={SIZE * 0.35} rx={3}
              fill="rgba(60,45,20,0.8)" stroke="rgba(100,80,30,0.4)" strokeWidth="1"
            />
            <rect x={half + 12} y={half * 0.75 + 15 + pistonOffset2} width={28} height={20} rx={2}
              fill="rgba(160,130,60,0.7)" stroke="rgba(200,170,80,0.5)" strokeWidth="1"
            />
            <line x1={half + 26} y1={half * 0.75 + 15 + pistonOffset2} x2={half + 26} y2={half * 0.75 + 8}
              stroke="rgba(140,110,50,0.6)" strokeWidth="3" strokeLinecap="round"
            />

            <rect x={half - 60} y={half * 0.78} width={8} height={30} rx={2}
              fill="rgba(80,60,30,0.8)" stroke="rgba(100,80,30,0.5)" strokeWidth="1"
            />
            {smokeParticles.map((p, i) => (
              <circle key={`smoke-${i}`} cx={p.x} cy={p.y} r={p.size} fill={`rgba(180,180,180,${p.opacity})`}>
                <animate attributeName="cy" values={`${p.y};${p.y - 20}`} dur="1.5s" repeatCount="indefinite" />
                <animate attributeName="opacity" values={`${p.opacity};0`} dur="1.5s" repeatCount="indefinite" />
              </circle>
            ))}

            {[0.25, 0.5, 0.75].map((mark, i) => {
              const a = gaugeStartAngle + gaugeSweep * mark;
              const tx = gaugeCx + Math.cos(a) * (gaugeRadius + 14);
              const ty = gaugeCy + Math.sin(a) * (gaugeRadius + 14);
              return (
                <text key={`mark-${i}`} x={tx} y={ty} textAnchor="middle" fill="rgba(255,255,255,0.3)" fontSize="8" fontFamily="monospace">
                  {Math.round(mark * 100)}
                </text>
              );
            })}

            <rect
              x={throttleTrackX} y={half * 0.6}
              width={16} height={throttleTrackHeight}
              rx={8} fill="rgba(255,255,255,0.06)"
              stroke="rgba(255,255,255,0.1)" strokeWidth="1"
            />
            <rect
              x={throttleTrackX - 4} y={half * 0.6 + throttleY - 10}
              width={24} height={20}
              rx={4}
              fill={isThrottling ? "rgba(245,158,11,0.9)" : "rgba(160,130,60,0.7)"}
              stroke="rgba(200,170,80,0.6)" strokeWidth="1.5"
            />
            <line
              x1={throttleTrackX + 4} y1={half * 0.6 + throttleY - 3}
              x2={throttleTrackX + 12} y2={half * 0.6 + throttleY - 3}
              stroke="rgba(0,0,0,0.3)" strokeWidth="1.5" strokeLinecap="round"
            />
            <line
              x1={throttleTrackX + 4} y1={half * 0.6 + throttleY + 3}
              x2={throttleTrackX + 12} y2={half * 0.6 + throttleY + 3}
              stroke="rgba(0,0,0,0.3)" strokeWidth="1.5" strokeLinecap="round"
            />

            {inGreenZone && (
              <rect
                x={half - 58} y={half * 0.73}
                width={116} height={SIZE * 0.49}
                rx={10} fill="none"
                stroke="rgba(245,158,11,0.3)" strokeWidth="2"
              >
                <animate attributeName="opacity" values="0.3;0.7;0.3" dur="1.5s" repeatCount="indefinite" />
              </rect>
            )}

            {isOverheated && (
              <rect
                x={half - 58} y={half * 0.73}
                width={116} height={SIZE * 0.49}
                rx={10} fill="rgba(239,68,68,0.1)"
                stroke="rgba(239,68,68,0.5)" strokeWidth="2"
              >
                <animate attributeName="opacity" values="0.3;0.8;0.3" dur="0.8s" repeatCount="indefinite" />
              </rect>
            )}
          </svg>
        </div>

        {faults.map((fault) => (
          <div
            key={fault.id}
            className="absolute z-20 cursor-pointer"
            style={{
              left: fault.x - 24,
              top: fault.y - 24,
              animation: "pulse 0.5s ease-in-out infinite",
            }}
            onClick={() => onFaultTap(fault.id)}
            onTouchEnd={(e) => { e.preventDefault(); onFaultTap(fault.id); }}
            data-testid={`fault-${fault.type}-${fault.id}`}
          >
            <div className="flex flex-col items-center">
              <div className="w-12 h-12 rounded-full flex items-center justify-center"
                style={{ background: "rgba(239,68,68,0.3)", border: "2px solid rgba(239,68,68,0.7)" }}
              >
                <Wrench className="h-5 w-5 text-red-400" />
              </div>
              <span className="text-[8px] font-bold text-red-400 mt-0.5 whitespace-nowrap">
                {fault.label}
              </span>
            </div>
          </div>
        ))}

        <AnimatePresence>
          {floatingWatts.map((watt) => (
            <motion.div
              key={watt.id}
              initial={{ x: watt.x - 30, y: watt.y - 15, opacity: 1, scale: 1 }}
              animate={{ y: watt.y - 90, opacity: 0, scale: 0.6 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.9, ease: "easeOut" }}
              className={`absolute top-0 left-0 pointer-events-none font-black ${watt.isCombo ? "text-amber-400 text-base" : "text-orange-400 text-sm"}`}
            >
              +{watt.amount ?? multiplier} W{watt.isCombo ? " EFFICIENT" : ""}
            </motion.div>
          ))}
        </AnimatePresence>

        <div
          className="absolute inset-0 rounded-lg pointer-events-none"
          style={{
            boxShadow: `0 0 ${20 + rpmPercent * 40}px ${effectiveGlow}, inset 0 0 ${10 + rpmPercent * 20}px ${effectiveGlow}`,
            opacity: rpmPercent > 0.1 ? 0.6 : 0,
            transition: "box-shadow 0.2s, opacity 0.2s",
          }}
        />
      </div>

      <StressMeter stress={stress} isOverheated={isOverheated} />

      <p className="text-[10px] text-muted-foreground" data-testid="text-diesel-status">
        {isOverheated ? "Cooling engine..." : !hasEnergy ? "No fuel" : isThrottling ? (inGreenZone ? "Optimal efficiency!" : rpmPercent > 0.9 ? "Careful - overheating risk!" : "Hold to rev up") : rpmPercent > 0.1 ? "Engine running..." : "Touch to throttle"}
      </p>

      <MilestoneProgress totalWatts={totalWatts} />
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
  bgImage,
  borderColor,
  labelColor,
}: {
  label: string;
  amount: number;
  bgImage: string;
  borderColor: string;
  labelColor: string;
}) {
  return (
    <div
      className={`flex-1 rounded-xl overflow-hidden border ${borderColor} relative`}
      data-testid={`pot-card-${label.toLowerCase()}`}
    >
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: `url(${bgImage})` }}
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/50 to-black/30" />
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
  const showChallengeRef = useRef(false);
  const [guestWatts, setGuestWatts] = useState(0);

  const [wheelAngle, setWheelAngle] = useState(0);
  const [angularVelocity, setAngularVelocity] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [stress, setStress] = useState(0);
  const [isOverheated, setIsOverheated] = useState(false);

  const wattIdRef = useRef(0);
  const stressRef = useRef(0);
  const isOverheatedRef = useRef(false);
  const overheatTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const comboCountRef = useRef(0);
  const lastTapTimeRef = useRef(0);
  const pendingTapsRef = useRef(0);
  const registerCrankTapRef = useRef<() => void>(() => {});
  const flushTapsRef = useRef<() => void>(() => {});
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

  const [dieselRpmPercent, setDieselRpmPercent] = useState(0);
  const [dieselThrottlePos, setDieselThrottlePos] = useState(0);
  const [isThrottling, setIsThrottling] = useState(false);
  const [dieselFaults, setDieselFaults] = useState<FaultEvent[]>([]);
  const [dieselInGreenZone, setDieselInGreenZone] = useState(false);
  const dieselRpmRef = useRef(0);
  const dieselThrottleRef = useRef(0);
  const isThrottlingRef = useRef(false);
  const dieselAccumulatedRef = useRef(0);
  const dieselFaultsRef = useRef<FaultEvent[]>([]);
  const faultEfficiencyRef = useRef(1);
  const faultIdRef = useRef(0);
  const faultTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const faultRemovalTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const dieselEngineRef = useRef<HTMLDivElement>(null);

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
        if (parsed.challengeRequired) { showChallengeRef.current = true; pendingTapsRef.current = 0; setShowChallenge(true); return; }
      } catch {}
      if (msg.includes("challengeRequired") || msg.includes("challenge")) { showChallengeRef.current = true; pendingTapsRef.current = 0; setShowChallenge(true); }
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
    if (showChallengeRef.current) return;
    if (pendingTapsRef.current > 0) {
      const taps = pendingTapsRef.current;
      pendingTapsRef.current = 0;
      tapMutation.mutate(taps);
    }
  }, [tapMutation]);

  const registerCrankTap = useCallback(() => {
    if (isOverheatedRef.current) return;
    if (showChallengeRef.current) return;

    const now = Date.now();
    const timeSinceLast = now - lastTapTimeRef.current;
    lastTapTimeRef.current = now;

    const currentTierCheck = guest ? "FREE" : (user?.tier || "FREE");
    const speed = currentTierCheck === "BRONZE"
      ? dieselRpmRef.current * 15
      : Math.abs(angularVelocityRef.current);
    const isCombo = currentTierCheck === "BRONZE"
      ? (timeSinceLast < 600 && dieselRpmRef.current >= DIESEL_GREEN_MIN / 100)
      : (timeSinceLast < 400 && speed > 5);
    if (isCombo) {
      comboCountRef.current += 1;
    } else {
      comboCountRef.current = 0;
    }

    const speedBonus = Math.floor(speed * 8);
    const comboBonus = isCombo ? comboCountRef.current * 15 : 0;
    const displayAmount = Math.max(1, speedBonus + comboBonus);
    const showCombo = comboCountRef.current >= 3;

    const currentTierForSpawn = guest ? "FREE" : (user?.tier || "FREE");
    const spawnSize = currentTierForSpawn === "BRONZE" ? DIESEL_ENGINE_SIZE : WHEEL_SIZE;
    const half = spawnSize / 2;
    const angle = currentTierForSpawn === "BRONZE"
      ? Math.random() * Math.PI * 2
      : wheelAngleRef.current * (Math.PI / 180);
    const offsetAngle = angle + (Math.random() - 0.5) * 0.8;
    const dist = half * (0.3 + Math.random() * 0.3);
    const spawnX = half + Math.cos(offsetAngle) * dist;
    const spawnY = half + Math.sin(offsetAngle) * dist;

    if (guest) {
      setGuestWatts((prev) => prev + 1);
      const id = ++wattIdRef.current;
      setFloatingWatts((prev) => [...prev, { id, x: spawnX, y: spawnY, amount: displayAmount, isCombo: showCombo }]);
      setTimeout(() => setFloatingWatts((prev) => prev.filter((c) => c.id !== id)), 1000);
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

    const id = ++wattIdRef.current;
    setFloatingWatts((prev) => [...prev, { id, x: spawnX, y: spawnY, amount: displayAmount, isCombo: showCombo }]);
    setTimeout(() => setFloatingWatts((prev) => prev.filter((c) => c.id !== id)), 1000);

    if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    if (pendingTapsRef.current >= 50) {
      flushTaps();
    } else {
      flushTimerRef.current = setTimeout(flushTaps, 2000);
    }
  }, [guest, tc.tapMultiplier, flushTaps]);

  useEffect(() => {
    registerCrankTapRef.current = registerCrankTap;
  }, [registerCrankTap]);

  useEffect(() => {
    flushTapsRef.current = flushTaps;
  }, [flushTaps]);

  useEffect(() => {
    const tier = guest ? "FREE" : (user?.tier || "FREE");
    const needsLoop = tier === "FREE" || tier === "BRONZE";
    if (!needsLoop) return;
    const isBronze = tier === "BRONZE";

    let lastTime = performance.now();
    let stressUpdateCounter = 0;
    let dieselRenderCounter = 0;

    const animate = (now: number) => {
      const dt = Math.min((now - lastTime) / 16.667, 3);
      lastTime = now;

      if (isBronze) {
        let rpm = dieselRpmRef.current;
        const throttle = dieselThrottleRef.current;

        if (isOverheatedRef.current) {
          rpm *= Math.pow(0.92, dt);
          if (rpm < 0.01) rpm = 0;
        } else {
          const currentEnergy = liveEnergyRef.current ?? 0;
          if (currentEnergy <= 0) {
            rpm *= Math.pow(0.95, dt);
            if (rpm < 0.01) rpm = 0;
          } else if (isThrottlingRef.current) {
            const target = throttle;
            const diff = target - rpm;
            rpm += diff * DIESEL_THROTTLE_FORCE * dt * 0.06;
          } else {
            rpm *= Math.pow(DIESEL_RPM_DECAY, dt);
            if (rpm < 0.01) rpm = 0;
          }
        }

        const hasFaultActive = dieselFaultsRef.current.length > 0;
        if (hasFaultActive) {
          rpm += (Math.random() - 0.5) * 0.02 * dt;
          faultEfficiencyRef.current = 0.5;
        } else {
          faultEfficiencyRef.current = 1;
        }

        rpm = Math.max(0, Math.min(1, rpm));
        dieselRpmRef.current = rpm;

        if (!isOverheatedRef.current) {
          if (rpm > DIESEL_DANGER_THRESHOLD / 100) {
            stressRef.current = Math.min(1, stressRef.current + DIESEL_HEAT_RATE * (rpm * 2) * dt);
          } else if (rpm > 0.5) {
            stressRef.current = Math.min(1, stressRef.current + DIESEL_HEAT_RATE * rpm * 0.3 * dt);
          } else {
            stressRef.current = Math.max(0, stressRef.current - DIESEL_HEAT_DECAY * dt);
          }

          if (stressRef.current >= 1) {
            isOverheatedRef.current = true;
            setIsOverheated(true);
            dieselRpmRef.current = 0;
            rpm = 0;
            isThrottlingRef.current = false;
            setIsThrottling(false);
            dieselThrottleRef.current = 0;
            setDieselThrottlePos(0);

            if (overheatTimerRef.current) clearTimeout(overheatTimerRef.current);
            overheatTimerRef.current = setTimeout(() => {
              isOverheatedRef.current = false;
              stressRef.current = 0.3;
              setIsOverheated(false);
              setStress(0.3);
            }, OVERHEAT_COOLDOWN_MS);
          }
        }

        const inGreen = rpm >= DIESEL_GREEN_MIN / 100 && rpm <= DIESEL_GREEN_MAX / 100;
        const efficiency = inGreen ? 1.5 : rpm < 0.5 ? 0.5 : 1.0;
        const canGenerate = !isOverheatedRef.current && (liveEnergyRef.current ?? 0) > 0 && rpm > 0.05;

        if (canGenerate) {
          const wattsPerFrame = rpm * 0.15 * efficiency * faultEfficiencyRef.current * dt;
          dieselAccumulatedRef.current += wattsPerFrame;
          while (dieselAccumulatedRef.current >= 1) {
            dieselAccumulatedRef.current -= 1;
            registerCrankTapRef.current();
          }
        }

        dieselRenderCounter += dt;
        if (dieselRenderCounter >= 2) {
          dieselRenderCounter = 0;
          setStress(stressRef.current);
          setDieselRpmPercent(rpm);
          setDieselThrottlePos(dieselThrottleRef.current);
          setDieselInGreenZone(inGreen);
        }

      } else {
        let vel = angularVelocityRef.current;

        if (isOverheatedRef.current) {
          vel *= Math.pow(0.9, dt);
          if (Math.abs(vel) < STOP_THRESHOLD) vel = 0;
        } else if (guest) {
          if (!isDraggingRef.current) {
            vel *= Math.pow(FRICTION, dt);
            if (Math.abs(vel) < STOP_THRESHOLD) vel = 0;
          }
          const absVel = Math.abs(vel);
          if (absVel > 12) {
            const drag = Math.min(0.95, (absVel - 12) * RESISTANCE_FACTOR * dt);
            vel *= (1 - drag);
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
          const absVel = Math.abs(vel);
          if (absVel > 12) {
            const drag = Math.min(0.95, (absVel - 12) * RESISTANCE_FACTOR * dt);
            vel *= (1 - drag);
          }
        }

        vel = Math.max(-MAX_VELOCITY, Math.min(MAX_VELOCITY, vel));
        angularVelocityRef.current = vel;

        const speed = Math.abs(vel);
        if (!isOverheatedRef.current) {
          if (speed > 3) {
            stressRef.current = Math.min(1, stressRef.current + STRESS_INCREASE_RATE * (speed / 10) * dt);
          } else {
            stressRef.current = Math.max(0, stressRef.current - STRESS_DECAY_RATE * dt);
          }

          if (stressRef.current >= 1 && !isOverheatedRef.current) {
            isOverheatedRef.current = true;
            setIsOverheated(true);
            angularVelocityRef.current = 0;
            vel = 0;
            isDraggingRef.current = false;
            setIsDragging(false);

            if (overheatTimerRef.current) clearTimeout(overheatTimerRef.current);
            overheatTimerRef.current = setTimeout(() => {
              isOverheatedRef.current = false;
              stressRef.current = 0.3;
              setIsOverheated(false);
              setStress(0.3);
            }, OVERHEAT_COOLDOWN_MS);
          }
        }

        stressUpdateCounter += dt;
        if (stressUpdateCounter >= 3) {
          stressUpdateCounter = 0;
          setStress(stressRef.current);
        }

        const angleDelta = vel * dt;
        wheelAngleRef.current = (wheelAngleRef.current + angleDelta) % 360;

        const canGenerate = !isOverheatedRef.current && (guest || (liveEnergyRef.current ?? 0) > 0);
        if (Math.abs(angleDelta) > 0.01 && canGenerate) {
          accumulatedRotationRef.current += Math.abs(angleDelta);
          while (accumulatedRotationRef.current >= 360) {
            accumulatedRotationRef.current -= 360;
            registerCrankTapRef.current();
          }
        }

        setWheelAngle(wheelAngleRef.current);
        setAngularVelocity(vel);
      }

      animFrameRef.current = requestAnimationFrame(animate);
    };

    animFrameRef.current = requestAnimationFrame(animate);
    return () => {
      cancelAnimationFrame(animFrameRef.current);
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTapsRef.current();
      }
      if (overheatTimerRef.current) {
        clearTimeout(overheatTimerRef.current);
      }
    };
  }, [guest, user?.tier]);

  const guestRef = useRef(guest);
  guestRef.current = guest;

  const getAngle = useCallback((clientX: number, clientY: number): number | null => {
    const el = wheelRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    return Math.atan2(clientY - cy, clientX - cx);
  }, []);

  const startDrag = useCallback((clientX: number, clientY: number) => {
    if (isOverheatedRef.current) return;
    const angle = getAngle(clientX, clientY);
    if (angle === null) return;
    lastAngleRef.current = angle;
    isDraggingRef.current = true;
    setIsDragging(true);
  }, [getAngle]);

  const moveDrag = useCallback((clientX: number, clientY: number) => {
    if (isOverheatedRef.current) return;
    if (!isDraggingRef.current || lastAngleRef.current === null) return;
    if (!guestRef.current) {
      const currentEnergy = liveEnergyRef.current ?? 0;
      if (currentEnergy <= 0) return;
    }
    const angle = getAngle(clientX, clientY);
    if (angle === null) return;
    let delta = (angle - lastAngleRef.current) * (180 / Math.PI);
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    angularVelocityRef.current = delta * 0.85;
    angularVelocityRef.current = Math.max(-MAX_VELOCITY, Math.min(MAX_VELOCITY, angularVelocityRef.current));
    lastAngleRef.current = angle;
  }, [getAngle]);

  const endDrag = useCallback(() => {
    isDraggingRef.current = false;
    lastAngleRef.current = null;
    setIsDragging(false);
  }, []);

  useEffect(() => {
    const el = wheelRef.current;
    if (!el) return;

    const onTouchStart = (e: TouchEvent) => {
      e.preventDefault();
      const t = e.touches[0];
      if (t) startDrag(t.clientX, t.clientY);
    };
    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      const t = e.touches[0];
      if (t) moveDrag(t.clientX, t.clientY);
    };
    const onTouchEnd = (e: TouchEvent) => {
      e.preventDefault();
      endDrag();
    };
    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      e.preventDefault();
      try { el.setPointerCapture(e.pointerId); } catch (_) {}
      startDrag(e.clientX, e.clientY);
    };
    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      moveDrag(e.clientX, e.clientY);
    };
    const onPointerUp = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      endDrag();
    };

    el.addEventListener("touchstart", onTouchStart, { passive: false });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: false });
    el.addEventListener("touchcancel", onTouchEnd);
    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("pointerleave", onPointerUp);
    el.addEventListener("pointercancel", onPointerUp);

    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("pointerleave", onPointerUp);
      el.removeEventListener("pointercancel", onPointerUp);
    };
  }, [startDrag, moveDrag, endDrag]);

  useEffect(() => {
    const tier = guest ? "FREE" : (user?.tier || "FREE");
    if (tier !== "BRONZE") return;
    const el = dieselEngineRef.current;
    if (!el) return;

    const getThrottleFromY = (clientY: number) => {
      const rect = el.getBoundingClientRect();
      const relY = clientY - rect.top;
      const pct = 1 - Math.max(0, Math.min(1, relY / rect.height));
      return pct;
    };

    const onTouchStart = (e: TouchEvent) => {
      e.preventDefault();
      if (isOverheatedRef.current || showChallengeRef.current) return;
      const t = e.touches[0];
      if (!t) return;
      isThrottlingRef.current = true;
      setIsThrottling(true);
      dieselThrottleRef.current = getThrottleFromY(t.clientY);
    };
    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      if (!isThrottlingRef.current || isOverheatedRef.current || showChallengeRef.current) return;
      const t = e.touches[0];
      if (!t) return;
      dieselThrottleRef.current = getThrottleFromY(t.clientY);
    };
    const onTouchEnd = (e: TouchEvent) => {
      e.preventDefault();
      isThrottlingRef.current = false;
      setIsThrottling(false);
      dieselThrottleRef.current = 0;
    };
    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      if (isOverheatedRef.current || showChallengeRef.current) return;
      e.preventDefault();
      try { el.setPointerCapture(e.pointerId); } catch (_) {}
      isThrottlingRef.current = true;
      setIsThrottling(true);
      dieselThrottleRef.current = getThrottleFromY(e.clientY);
    };
    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      if (!isThrottlingRef.current) return;
      dieselThrottleRef.current = getThrottleFromY(e.clientY);
    };
    const onPointerUp = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      isThrottlingRef.current = false;
      setIsThrottling(false);
      dieselThrottleRef.current = 0;
    };

    el.addEventListener("touchstart", onTouchStart, { passive: false });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: false });
    el.addEventListener("touchcancel", onTouchEnd);
    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("pointerleave", onPointerUp);
    el.addEventListener("pointercancel", onPointerUp);

    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("pointerleave", onPointerUp);
      el.removeEventListener("pointercancel", onPointerUp);
    };
  }, [guest, user?.tier]);

  useEffect(() => {
    const tier = guest ? "FREE" : (user?.tier || "FREE");
    if (tier !== "BRONZE") return;

    const scheduleFault = () => {
      const delay = DIESEL_FAULT_INTERVAL_MIN + Math.random() * (DIESEL_FAULT_INTERVAL_MAX - DIESEL_FAULT_INTERVAL_MIN);
      faultTimerRef.current = setTimeout(() => {
        if (isOverheatedRef.current || dieselRpmRef.current < 0.1) {
          scheduleFault();
          return;
        }
        const faultType = FAULT_TYPES[Math.floor(Math.random() * FAULT_TYPES.length)];
        const SIZE = DIESEL_ENGINE_SIZE;
        const fault: FaultEvent = {
          id: ++faultIdRef.current,
          type: faultType.type,
          label: faultType.label,
          x: SIZE * 0.3 + Math.random() * SIZE * 0.4,
          y: SIZE * 0.35 + Math.random() * SIZE * 0.3,
          spawnedAt: Date.now(),
        };
        dieselFaultsRef.current = [...dieselFaultsRef.current, fault];
        setDieselFaults([...dieselFaultsRef.current]);

        const removalTimer = setTimeout(() => {
          dieselFaultsRef.current = dieselFaultsRef.current.filter(f => f.id !== fault.id);
          setDieselFaults([...dieselFaultsRef.current]);
          faultRemovalTimersRef.current = faultRemovalTimersRef.current.filter(t => t !== removalTimer);
        }, DIESEL_FAULT_DURATION);
        faultRemovalTimersRef.current.push(removalTimer);

        scheduleFault();
      }, delay);
    };

    scheduleFault();
    return () => {
      if (faultTimerRef.current) clearTimeout(faultTimerRef.current);
      faultRemovalTimersRef.current.forEach(t => clearTimeout(t));
      faultRemovalTimersRef.current = [];
    };
  }, [guest, user?.tier]);

  const handleFaultTap = useCallback((faultId: number) => {
    dieselFaultsRef.current = dieselFaultsRef.current.filter(f => f.id !== faultId);
    setDieselFaults([...dieselFaultsRef.current]);
    faultEfficiencyRef.current = 1;

    registerCrankTapRef.current();
    registerCrankTapRef.current();
    registerCrankTapRef.current();

    const SIZE = DIESEL_ENGINE_SIZE;
    const id = ++wattIdRef.current;
    setFloatingWatts(prev => [...prev, { id, x: SIZE / 2, y: SIZE * 0.4, amount: 3, isCombo: true }]);
    setTimeout(() => setFloatingWatts(prev => prev.filter(w => w.id !== id)), 1000);
  }, []);

  const handleTap = useCallback(
    (e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => {
      if (showChallengeRef.current) return;
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
  const usesCrankWheel = isFreeUser;
  const usesDieselEngine = currentTier === "BRONZE";
  const tierLabel = getTierLabel(user);
  const tierColors = TIER_COLORS[currentTier] || TIER_COLORS.FREE;
  const walletBalance = user?.walletBalance ?? 0;

  const handleChallengeResolved = useCallback((passed: boolean) => {
    showChallengeRef.current = false;
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
        <div className="atmospheric-bg" style={{ backgroundImage: `url(${bgAtmosphere})` }} />

        <div className="flex items-center justify-center gap-2 z-10">
          <Zap className="h-4 w-4 text-cyan-400 fill-cyan-400" />
          <span className="text-xs font-black uppercase tracking-[0.15em] text-cyan-400" data-testid="text-tier-label">
            FREE TIER
          </span>
        </div>

        <div className="w-full relative flex items-center justify-center z-10">
          <div className="absolute left-4 z-20">
            <div className="flex flex-col items-center gap-1 rounded-xl border border-white/10 px-2 py-2"
              style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(8px)" }}
            >
              <span className="text-[8px] text-white/50 uppercase tracking-wider">Streak</span>
              <div className="flex items-center gap-0.5">
                <Flame className="h-3.5 w-3.5 text-orange-400" />
                <span className="text-base font-black text-white">0</span>
              </div>
              <span className="text-[8px] text-white/40">Days</span>
            </div>
          </div>

          <div className="flex flex-col items-center mx-auto">
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
              wheelRef={wheelRef as React.RefObject<HTMLDivElement>}
              stress={stress}
              isOverheated={isOverheated}
              totalWatts={guestWatts}
            />
          </div>

          <div className="absolute right-4 z-20">
            <div className="flex flex-col items-center gap-1 rounded-xl border border-white/10 px-2 py-2"
              style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(8px)" }}
            >
              <span className="text-[8px] text-white/50 uppercase tracking-wider">Boost</span>
              <div className="flex items-center gap-0.5">
                <Rocket className="h-3.5 w-3.5 text-violet-400" />
                <span className="text-base font-black text-white">0</span>
              </div>
              <span className="text-[8px] text-white/40">Active</span>
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
              bgImage={potDieselBg}
              borderColor="border-orange-500/50"
              labelColor="text-orange-400"
            />
            <PotCard
              label="LNG"
              amount={41221}
              bgImage={potLngBg}
              borderColor="border-yellow-500/50"
              labelColor="text-yellow-400"
            />
            <PotCard
              label="FUSION"
              amount={129880}
              bgImage={potFusionBg}
              borderColor="border-purple-500/50"
              labelColor="text-purple-400"
            />
          </div>
        </div>

        <div className="w-full z-10 rounded-xl p-3 relative overflow-hidden">
          <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(${cardLeaderboardBg})` }} />
          <div className="absolute inset-0 bg-black/60" />
          <div className="relative z-10 flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-bold text-white">Live Leaderboard</span>
              <span className="text-sm text-white/40">(Today)</span>
            </div>
            <span className="text-[11px] text-white/50 flex items-center gap-0.5">
              View All <ChevronRight className="h-3 w-3" />
            </span>
          </div>
          <div className="relative z-10 grid grid-cols-3 gap-2">
            {placeholderLeaderboard.map((entry, idx) => {
              const tc2 = TIER_COLORS[entry.tier]?.label || "text-cyan-400";
              const name = entry.telegramFirstName || entry.username;
              return (
                <div
                  key={entry.id}
                  className="flex flex-col items-center rounded-xl border border-white/10 px-2 py-3 overflow-hidden"
                  style={{ background: "rgba(255,255,255,0.05)" }}
                  data-testid={`leaderboard-entry-${idx}`}
                >
                  <div className="relative mb-1.5">
                    <div className="flex items-center justify-center w-10 h-10 rounded-full border-2 border-white/20 text-sm font-bold text-white"
                      style={{ background: "rgba(255,255,255,0.1)" }}
                    >
                      {(name.slice(0, 1)).toUpperCase()}
                    </div>
                    {idx === 0 && <Crown className="absolute -top-2 left-1/2 -translate-x-1/2 h-3.5 w-3.5 text-amber-400" />}
                    <Trophy className={`absolute -bottom-1 -right-1 h-3.5 w-3.5 ${tc2}`} />
                  </div>
                  <span className="text-amber-400 text-[10px] font-black">#{idx + 1}</span>
                  <span className="text-xs font-semibold text-white text-center leading-tight mt-0.5 w-full truncate px-1">
                    {name}
                  </span>
                  <span className="text-[11px] text-emerald-400 font-bold mt-0.5">
                    {formatNumber(entry.totalCoins)} W
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="w-full grid grid-cols-2 gap-2.5 z-10">
          <div
            className="rounded-xl border border-amber-500/30 p-3.5 relative overflow-hidden"
          >
            <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(${cardUpgradesBg})` }} />
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/60 to-black/40" />
            <div className="relative z-10">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: "rgba(245,158,11,0.2)" }}>
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
          </div>

          <div
            className="rounded-xl border border-emerald-500/40 p-3.5 relative overflow-hidden"
          >
            <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(${cardEarningsBg})` }} />
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/60 to-black/40" />
            <div className="relative z-10">
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
      </div>
    );
  }

  return (
    <div className="relative flex flex-col items-center px-4 pb-8 pt-2 max-w-md mx-auto space-y-4 min-h-full">
      {!usesDieselEngine && (
        <div className="atmospheric-bg" style={{ backgroundImage: `url(${bgAtmosphere})` }} />
      )}

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

      <div className="w-full relative flex items-center justify-center z-10">
        <div className="absolute left-4 z-20">
          <div className="flex flex-col items-center gap-1 rounded-xl border border-white/10 px-2 py-2"
            style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(8px)" }}
            data-testid="info-daily-streak"
          >
            <span className="text-[8px] text-white/50 uppercase tracking-wider">Streak</span>
            <div className="flex items-center gap-0.5">
              <Flame className="h-3.5 w-3.5 text-orange-400" />
              <span className="text-base font-black text-white">0</span>
            </div>
            <span className="text-[8px] text-white/40">Days</span>
          </div>
        </div>

        <div className="flex flex-col items-center mx-auto">
          {usesCrankWheel ? (
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
                wheelRef={wheelRef as React.RefObject<HTMLDivElement>}
                stress={stress}
                isOverheated={isOverheated}
                totalWatts={totalWatts}
              />
            </>
          ) : usesDieselEngine ? (
            <>
              <div className="text-center mb-2">
                <p className="text-[10px] text-white/50 uppercase tracking-[0.2em]">Throttle to Generate</p>
                <div className="flex items-baseline justify-center gap-1">
                  <span className="text-3xl font-black tracking-tight text-white" data-testid="text-total-coins">
                    {formatNumber(totalWatts)}
                  </span>
                  <span className="text-lg font-bold text-white/60">W</span>
                </div>
                {(tc.tapMultiplier ?? 1) > 1 && (
                  <span className="text-xs text-emerald-400 font-semibold">
                    +{tc.tapMultiplier} W/rev
                  </span>
                )}
              </div>
              <DieselEngineControl
                rpmPercent={dieselRpmPercent}
                throttlePosition={dieselThrottlePos}
                hasEnergy={currentEnergy > 0}
                isThrottling={isThrottling}
                floatingWatts={floatingWatts}
                multiplier={tc.tapMultiplier ?? 1}
                engineRef={dieselEngineRef as React.RefObject<HTMLDivElement>}
                stress={stress}
                isOverheated={isOverheated}
                totalWatts={totalWatts}
                faults={dieselFaults}
                onFaultTap={handleFaultTap}
                inGreenZone={dieselInGreenZone}
              />
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

        <div className="absolute right-4 z-20">
          <div className="flex flex-col items-center gap-1 rounded-xl border border-white/10 px-2 py-2"
            style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(8px)" }}
            data-testid="info-boosters"
          >
            <span className="text-[8px] text-white/50 uppercase tracking-wider">Boost</span>
            <div className="flex items-center gap-0.5">
              <Rocket className="h-3.5 w-3.5 text-violet-400" />
              <span className="text-base font-black text-white">{earnings?.tapMultiplierLevel ?? 1}</span>
            </div>
            <span className="text-[8px] text-white/40">Active</span>
          </div>
        </div>
      </div>

      <div className="w-full space-y-1.5 z-10">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-1.5">
            <Fuel className="h-3.5 w-3.5 text-emerald-400" />
            <span className="text-white/50">Diesel Fuel</span>
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
            bgImage={potDieselBg}
            borderColor="border-orange-500/50"
            labelColor="text-orange-400"
          />
          <PotCard
            label="LNG"
            amount={(earnings?.tapPotSize ?? 12402) * 3.3}
            bgImage={potLngBg}
            borderColor="border-yellow-500/50"
            labelColor="text-yellow-400"
          />
          <PotCard
            label="FUSION"
            amount={(earnings?.tapPotSize ?? 12402) * 10.5}
            bgImage={potFusionBg}
            borderColor="border-purple-500/50"
            labelColor="text-purple-400"
          />
        </div>
      </div>

      {topThree.length > 0 && (
        <div className="w-full z-10 rounded-xl p-3 relative overflow-hidden">
          <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(${cardLeaderboardBg})` }} />
          <div className="absolute inset-0 bg-black/60" />
          <div className="relative z-10 flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-bold text-white">Live Leaderboard</span>
              <span className="text-sm text-white/40">(Today)</span>
            </div>
            <Link href="/leaderboard" className="text-[11px] text-white/50 flex items-center gap-0.5 hover:text-white/70" data-testid="link-view-leaderboard">
              View All <ChevronRight className="h-3 w-3" />
            </Link>
          </div>
          <div className="relative z-10 grid grid-cols-3 gap-2">
            {topThree.map((entry, idx) => {
              const tierColor = TIER_COLORS[entry.tier]?.label || "text-cyan-400";
              const name = entry.telegramFirstName || entry.username;
              return (
                <div
                  key={entry.id}
                  className="flex flex-col items-center rounded-xl border border-white/10 px-2 py-3 overflow-hidden"
                  style={{ background: "rgba(255,255,255,0.05)" }}
                  data-testid={`leaderboard-entry-${idx}`}
                >
                  <div className="relative mb-1.5">
                    <div className="flex items-center justify-center w-10 h-10 rounded-full border-2 border-white/20 text-sm font-bold text-white overflow-hidden"
                      style={{ background: "rgba(255,255,255,0.1)" }}
                    >
                      {entry.telegramPhotoUrl ? (
                        <img src={entry.telegramPhotoUrl} alt="" className="w-full h-full rounded-full object-cover" />
                      ) : (
                        (name.slice(0, 1)).toUpperCase()
                      )}
                    </div>
                    {idx === 0 && <Crown className="absolute -top-2 left-1/2 -translate-x-1/2 h-3.5 w-3.5 text-amber-400" />}
                    <Trophy className={`absolute -bottom-1 -right-1 h-3.5 w-3.5 ${tierColor}`} />
                  </div>
                  <span className="text-amber-400 text-[10px] font-black">#{idx + 1}</span>
                  <span className="text-xs font-semibold text-white text-center leading-tight mt-0.5 w-full truncate px-1">
                    {name}
                  </span>
                  <span className="text-[11px] text-emerald-400 font-bold mt-0.5">
                    {formatNumber(entry.totalCoins)} W
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="w-full grid grid-cols-2 gap-2.5 z-10">
        <div
          className="rounded-xl border border-amber-500/30 p-3.5 relative overflow-hidden"
          data-testid="card-upgrades"
        >
          <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(${cardUpgradesBg})` }} />
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/60 to-black/40" />
          <div className="relative z-10">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: "rgba(245,158,11,0.2)" }}>
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
        </div>

        <div
          className="rounded-xl border border-emerald-500/40 p-3.5 relative overflow-hidden"
          data-testid="card-earnings"
        >
          <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(${cardEarningsBg})` }} />
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/60 to-black/40" />
          <div className="relative z-10">
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
