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

export function getTimeUntilRefill(lastRefill: string | Date): string {
  const last = new Date(lastRefill);
  const next = new Date(last.getTime() + 24 * 60 * 60 * 1000);
  const now = new Date();
  const diff = next.getTime() - now.getTime();

  if (diff <= 0) return "Ready!";

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
