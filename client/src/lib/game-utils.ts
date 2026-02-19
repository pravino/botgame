export function formatNumber(num: number): string {
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + "M";
  if (num >= 1_000) return (num / 1_000).toFixed(1) + "K";
  return num.toLocaleString();
}

export function formatUSD(amount: number): string {
  return "$" + amount.toFixed(2);
}

export function getEnergyPercentage(energy: number, maxEnergy: number): number {
  return Math.max(0, Math.min(100, (energy / maxEnergy) * 100));
}

export interface TierConfig {
  energyRefillRateMs: number;
  refillCooldownMs: number | null;
  tapMultiplier?: number;
}

const DEFAULT_TIER_CONFIG: TierConfig = { energyRefillRateMs: 2000, refillCooldownMs: null, tapMultiplier: 1 };

export function calculateCurrentEnergy(
  storedEnergy: number,
  maxEnergy: number,
  lastEnergyRefill: string | Date,
  tierConfig: TierConfig = DEFAULT_TIER_CONFIG
): number {
  const refillRateMs = tierConfig.energyRefillRateMs;
  const lastRefill = new Date(lastEnergyRefill).getTime();
  const elapsedMs = Date.now() - lastRefill;
  const regenAmount = Math.floor(elapsedMs / refillRateMs);
  return Math.min(maxEnergy, storedEnergy + regenAmount);
}

export function getTimeUntilFullEnergy(
  currentEnergy: number,
  maxEnergy: number,
  tierConfig: TierConfig = DEFAULT_TIER_CONFIG
): string {
  if (currentEnergy >= maxEnergy) return "Full!";

  const refillRateMs = tierConfig.energyRefillRateMs;
  const remaining = maxEnergy - currentEnergy;
  const totalSeconds = remaining * (refillRateMs / 1000);

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

export function getRefillCooldownRemaining(
  lastFreeRefill: string | Date | null,
  tierConfig: TierConfig = DEFAULT_TIER_CONFIG
): { canRefill: boolean; remainingMs: number; totalMs: number; progress: number } {
  const cooldownMs = tierConfig.refillCooldownMs;
  if (cooldownMs === null || cooldownMs <= 0) {
    return { canRefill: false, remainingMs: 0, totalMs: 0, progress: 0 };
  }

  if (!lastFreeRefill) {
    return { canRefill: true, remainingMs: 0, totalMs: cooldownMs, progress: 1 };
  }

  const lastRefill = new Date(lastFreeRefill).getTime();
  const elapsed = Date.now() - lastRefill;
  if (elapsed >= cooldownMs) {
    return { canRefill: true, remainingMs: 0, totalMs: cooldownMs, progress: 1 };
  }

  const remaining = cooldownMs - elapsed;
  const progress = elapsed / cooldownMs;
  return { canRefill: false, remainingMs: remaining, totalMs: cooldownMs, progress };
}

export function formatCooldownTime(remainingMs: number): string {
  if (remainingMs <= 0) return "Ready!";
  const hours = Math.floor(remainingMs / (1000 * 60 * 60));
  const minutes = Math.floor((remainingMs % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((remainingMs % (1000 * 60)) / 1000);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export const WHEEL_SLICES = [
  { label: "0.10 USDT", value: 0.10, color: "#3b82f6", probability: 0.35 },
  { label: "0.25 USDT", value: 0.25, color: "#8b5cf6", probability: 0.25 },
  { label: "0.50 USDT", value: 0.50, color: "#06b6d4", probability: 0.18 },
  { label: "1.00 USDT", value: 1.00, color: "#10b981", probability: 0.12 },
  { label: "5.00 USDT", value: 5.00, color: "#f59e0b", probability: 0.07 },
  { label: "JACKPOT!", value: 100.00, color: "#ef4444", probability: 0.01 },
  { label: "0.10 USDT", value: 0.10, color: "#6366f1", probability: 0.02 },
  { label: "0.50 USDT", value: 0.50, color: "#ec4899", probability: 0 },
] as const;
