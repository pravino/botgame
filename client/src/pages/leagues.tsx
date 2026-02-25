import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Trophy, Zap, ChevronRight } from "lucide-react";
import { formatNumber } from "@/lib/game-utils";

interface LeagueThreshold {
  name: string;
  minCoins: number;
  payoutMultiplier: number;
}

interface LeagueInfo {
  leagues: LeagueThreshold[];
  currentLeague: string;
  currentMultiplier: number;
  totalCoins: number;
  nextLeague: { name: string; minCoins: number; multiplier: number } | null;
  progress: number;
  coinsToNext: number;
}

const LEAGUE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  BRONZE: { bg: "bg-amber-900/20", text: "text-amber-600", border: "border-amber-700/30" },
  SILVER: { bg: "bg-gray-400/10", text: "text-gray-400", border: "border-gray-500/30" },
  GOLD: { bg: "bg-yellow-500/10", text: "text-yellow-500", border: "border-yellow-500/30" },
  PLATINUM: { bg: "bg-cyan-400/10", text: "text-cyan-400", border: "border-cyan-500/30" },
  DIAMOND: { bg: "bg-violet-400/10", text: "text-violet-400", border: "border-violet-500/30" },
};

function LeagueTierCard({ league, isCurrent, totalCoins }: { league: LeagueThreshold; isCurrent: boolean; totalCoins: number }) {
  const colors = LEAGUE_COLORS[league.name] || LEAGUE_COLORS.BRONZE;
  const isUnlocked = totalCoins >= league.minCoins;

  return (
    <Card className={`${isCurrent ? `border ${colors.border}` : ""}`} data-testid={`card-league-${league.name.toLowerCase()}`}>
      <CardContent className="p-4 flex items-center gap-3 flex-wrap">
        <div className={`h-10 w-10 rounded-md ${colors.bg} flex items-center justify-center shrink-0`}>
          <Trophy className={`h-5 w-5 ${colors.text}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className={`text-sm font-semibold ${isCurrent ? colors.text : ""}`}>{league.name}</p>
            {isCurrent && <Badge variant="default" className="text-xs">Current</Badge>}
            {!isUnlocked && <Badge variant="outline" className="text-xs">Locked</Badge>}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {league.minCoins === 0 ? "Starting league" : `${formatNumber(league.minCoins)}+ watts`}
          </p>
        </div>
        <div className="text-right shrink-0">
          <div className="flex items-center gap-1">
            <Zap className={`h-3.5 w-3.5 ${colors.text}`} />
            <span className={`text-sm font-bold ${colors.text}`} data-testid={`text-league-multiplier-${league.name.toLowerCase()}`}>
              {league.payoutMultiplier}x
            </span>
          </div>
          <p className="text-xs text-muted-foreground">payout</p>
        </div>
      </CardContent>
    </Card>
  );
}

export default function Leagues() {
  const { data: leagueInfo, isLoading, error } = useQuery<LeagueInfo>({
    queryKey: ["/api/leagues"],
  });

  if (isLoading) {
    return (
      <div className="p-4 md:p-6 space-y-4 max-w-lg mx-auto">
        <Skeleton className="h-8 w-48 mx-auto" />
        <Skeleton className="h-32" />
        {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-16" />)}
      </div>
    );
  }

  if (error || !leagueInfo) {
    return (
      <div className="p-4 md:p-6 max-w-lg mx-auto">
        <Card>
          <CardContent className="p-6 text-center space-y-2">
            <p className="text-sm text-destructive font-medium">Failed to load leagues</p>
            <p className="text-xs text-muted-foreground">{error?.message || "No data available"}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const currentColors = LEAGUE_COLORS[leagueInfo.currentLeague] || LEAGUE_COLORS.BRONZE;

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-lg mx-auto">
      <div className="text-center space-y-1">
        <div className="flex items-center justify-center gap-2">
          <Trophy className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-leagues-title">Leagues</h1>
        </div>
        <p className="text-muted-foreground text-sm">Climb the ranks for bigger daily payouts</p>
      </div>

      <Card>
        <CardContent className="p-5 space-y-4">
          <div className="text-center">
            <div className={`h-16 w-16 rounded-full ${currentColors.bg} flex items-center justify-center mx-auto`}>
              <Trophy className={`h-8 w-8 ${currentColors.text}`} />
            </div>
            <p className={`text-lg font-bold mt-2 ${currentColors.text}`} data-testid="text-current-league">
              {leagueInfo.currentLeague} League
            </p>
            <p className="text-sm text-muted-foreground">
              {leagueInfo.currentMultiplier}x payout multiplier
            </p>
          </div>

          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground flex-wrap">
            <span data-testid="text-total-coins">{formatNumber(leagueInfo.totalCoins)} W</span>
            {leagueInfo.nextLeague && (
              <span>{formatNumber(leagueInfo.coinsToNext)} W to {leagueInfo.nextLeague.name}</span>
            )}
          </div>

          <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${currentColors.bg.replace("/10", "/60").replace("/20", "/60")}`}
              style={{ width: `${leagueInfo.progress}%`, backgroundColor: "hsl(var(--primary))" }}
              data-testid="progress-league"
            />
          </div>

          {leagueInfo.nextLeague && (
            <div className="flex items-center justify-center gap-1 text-xs text-muted-foreground">
              <span>{leagueInfo.currentLeague}</span>
              <ChevronRight className="h-3 w-3" />
              <span className="font-medium">{leagueInfo.nextLeague.name}</span>
              <span>({leagueInfo.nextLeague.multiplier}x)</span>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground px-1">All Leagues</h2>
        {leagueInfo.leagues.map(league => (
          <LeagueTierCard
            key={league.name}
            league={league}
            isCurrent={league.name === leagueInfo.currentLeague}
            totalCoins={leagueInfo.totalCoins}
          />
        ))}
      </div>

      <Card>
        <CardContent className="p-4">
          <h3 className="text-sm font-medium mb-2">How Leagues Work</h3>
          <ul className="space-y-1.5 text-xs text-muted-foreground">
            <li className="flex items-start gap-2">
              <Zap className="h-3 w-3 mt-0.5 shrink-0 text-primary" />
              <span>Your league is determined by your lifetime watts generated</span>
            </li>
            <li className="flex items-start gap-2">
              <Zap className="h-3 w-3 mt-0.5 shrink-0 text-primary" />
              <span>Higher leagues get a bigger share of the daily USDT payout pot</span>
            </li>
            <li className="flex items-start gap-2">
              <Trophy className="h-3 w-3 mt-0.5 shrink-0 text-primary" />
              <span>Diamond League players get 1.5x their normal payout share</span>
            </li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
