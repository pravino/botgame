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

export const ENERGY_REFILL_RATE_MS = 2000;

export function calculateCurrentEnergy(
  storedEnergy: number,
  maxEnergy: number,
  lastEnergyRefill: string | Date
): number {
  const lastRefill = new Date(lastEnergyRefill).getTime();
  const elapsedMs = Date.now() - lastRefill;
  const regenAmount = Math.floor(elapsedMs / ENERGY_REFILL_RATE_MS);
  return Math.min(maxEnergy, storedEnergy + regenAmount);
}

export function getTimeUntilFullEnergy(
  currentEnergy: number,
  maxEnergy: number
): string {
  if (currentEnergy >= maxEnergy) return "Full!";

  const remaining = maxEnergy - currentEnergy;
  const totalSeconds = remaining * (ENERGY_REFILL_RATE_MS / 1000);

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

export function canUseFreeRefill(lastFreeRefill: string | Date | null): boolean {
  if (!lastFreeRefill) return true;
  const last = new Date(lastFreeRefill).getTime();
  return Date.now() - last >= 24 * 60 * 60 * 1000;
}

export function getTimeUntilFreeRefill(lastFreeRefill: string | Date | null): string {
  if (!lastFreeRefill) return "Available now!";
  const last = new Date(lastFreeRefill).getTime();
  const nextAvailable = last + 24 * 60 * 60 * 1000;
  const diff = nextAvailable - Date.now();

  if (diff <= 0) return "Available now!";

  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  return `${hours}h ${minutes}m`;
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
