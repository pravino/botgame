export interface LeagueDefinition {
  name: string;
  minCoins: number;
  payoutMultiplier: number;
}

export const LEAGUE_THRESHOLDS: LeagueDefinition[] = [
  { name: "BRONZE", minCoins: 0, payoutMultiplier: 1.0 },
  { name: "SILVER", minCoins: 50000, payoutMultiplier: 1.1 },
  { name: "GOLD", minCoins: 250000, payoutMultiplier: 1.2 },
  { name: "PLATINUM", minCoins: 1000000, payoutMultiplier: 1.3 },
  { name: "DIAMOND", minCoins: 5000000, payoutMultiplier: 1.5 },
];

export function computeLeague(totalCoins: number): string {
  let league = "BRONZE";
  for (const l of LEAGUE_THRESHOLDS) {
    if (totalCoins >= l.minCoins) league = l.name;
  }
  return league;
}

export function getLeagueMultiplier(league: string): number {
  return LEAGUE_THRESHOLDS.find(l => l.name === league)?.payoutMultiplier || 1.0;
}
