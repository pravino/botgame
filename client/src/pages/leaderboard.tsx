import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Trophy, Zap, TrendingUp, CircleDot, Crown, Shield, Star, Users } from "lucide-react";
import { formatNumber, formatUSD } from "@/lib/game-utils";
import type { User } from "@shared/schema";

const TIERS = [
  { value: "all", label: "All", icon: Users },
  { value: "FREE", label: "Free", icon: Shield },
  { value: "BRONZE", label: "Bronze", icon: Star },
  { value: "SILVER", label: "Silver", icon: Crown },
  { value: "GOLD", label: "Gold", icon: Crown },
] as const;

const TIER_COLORS: Record<string, string> = {
  FREE: "text-muted-foreground",
  BRONZE: "text-amber-600",
  SILVER: "text-gray-400",
  GOLD: "text-yellow-500",
};

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) return <div className="w-7 h-7 rounded-full bg-amber-500 flex items-center justify-center text-xs font-bold text-white" data-testid={`badge-rank-${rank}`}>1</div>;
  if (rank === 2) return <div className="w-7 h-7 rounded-full bg-gray-400 flex items-center justify-center text-xs font-bold text-white" data-testid={`badge-rank-${rank}`}>2</div>;
  if (rank === 3) return <div className="w-7 h-7 rounded-full bg-amber-700 flex items-center justify-center text-xs font-bold text-white" data-testid={`badge-rank-${rank}`}>3</div>;
  return <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center text-xs font-medium text-muted-foreground" data-testid={`badge-rank-${rank}`}>{rank}</div>;
}

function TierBadge({ tier }: { tier: string }) {
  return (
    <Badge variant="outline" className={TIER_COLORS[tier] || ""}>
      {tier}
    </Badge>
  );
}

function LeaderboardList({
  data,
  isLoading,
  valueKey,
  formatFn,
  icon: Icon,
  showTierBadge,
}: {
  data?: User[];
  isLoading: boolean;
  valueKey: "totalCoins" | "correctPredictions" | "totalWheelWinnings";
  formatFn: (val: number) => string;
  icon: React.ElementType;
  showTierBadge: boolean;
}) {
  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-14" />
        ))}
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-center">
          <p className="text-muted-foreground text-sm">No players in this tier yet.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      {data.map((entry, idx) => (
        <Card key={entry.id}>
          <CardContent className="p-3 flex items-center gap-3">
            <RankBadge rank={idx + 1} />
            <Avatar className="h-8 w-8">
              <AvatarFallback className="text-xs bg-primary/10 text-primary">
                {entry.username.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <p className="text-sm font-medium truncate" data-testid={`text-username-${entry.id}`}>
                  {entry.username}
                </p>
                {showTierBadge && <TierBadge tier={entry.tier} />}
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Icon className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-sm font-mono font-medium" data-testid={`text-score-${entry.id}`}>
                {formatFn(entry[valueKey])}
              </span>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function GameLeaderboard({ game, selectedTier }: { game: string; selectedTier: string }) {
  const url = selectedTier === "all"
    ? `/api/leaderboard/${game}`
    : `/api/leaderboard/${game}?tier=${selectedTier}`;

  const { data, isLoading } = useQuery<User[]>({
    queryKey: [url],
  });

  const config: Record<string, { valueKey: "totalCoins" | "correctPredictions" | "totalWheelWinnings"; formatFn: (v: number) => string; icon: React.ElementType }> = {
    coins: { valueKey: "totalCoins", formatFn: (v: number) => `${formatNumber(v)} W`, icon: Zap },
    predictions: { valueKey: "correctPredictions", formatFn: (v) => `${v} correct`, icon: TrendingUp },
    wheel: { valueKey: "totalWheelWinnings", formatFn: formatUSD, icon: CircleDot },
  };

  const c = config[game];

  return (
    <LeaderboardList
      data={data}
      isLoading={isLoading}
      valueKey={c.valueKey}
      formatFn={c.formatFn}
      icon={c.icon}
      showTierBadge={selectedTier === "all"}
    />
  );
}

export default function Leaderboard() {
  const [selectedTier, setSelectedTier] = useState("all");

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-lg mx-auto">
      <div className="text-center space-y-1">
        <div className="flex items-center justify-center gap-2">
          <Trophy className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-leaderboard-title">
            Leaderboard
          </h1>
        </div>
        <p className="text-muted-foreground text-sm">Top players across all games</p>
      </div>

      <div className="flex items-center justify-center gap-1.5 flex-wrap" data-testid="tier-filter">
        {TIERS.map((tier) => {
          const TierIcon = tier.icon;
          const isSelected = selectedTier === tier.value;
          return (
            <Button
              key={tier.value}
              size="sm"
              variant={isSelected ? "default" : "ghost"}
              className={`toggle-elevate ${isSelected ? "toggle-elevated" : ""}`}
              onClick={() => setSelectedTier(tier.value)}
              data-testid={`button-tier-${tier.value}`}
            >
              <TierIcon className="h-3.5 w-3.5 mr-1" />
              {tier.label}
            </Button>
          );
        })}
      </div>

      <Tabs defaultValue="coins" className="w-full">
        <TabsList className="w-full grid grid-cols-3" data-testid="tabs-leaderboard">
          <TabsTrigger value="coins" data-testid="tab-coins">
            <Zap className="h-3.5 w-3.5 mr-1" />
            Watts
          </TabsTrigger>
          <TabsTrigger value="predictions" data-testid="tab-predictions">
            <TrendingUp className="h-3.5 w-3.5 mr-1" />
            Predict
          </TabsTrigger>
          <TabsTrigger value="wheel" data-testid="tab-wheel">
            <CircleDot className="h-3.5 w-3.5 mr-1" />
            Wheel
          </TabsTrigger>
        </TabsList>

        <TabsContent value="coins" className="mt-4">
          <GameLeaderboard game="coins" selectedTier={selectedTier} />
        </TabsContent>

        <TabsContent value="predictions" className="mt-4">
          <GameLeaderboard game="predictions" selectedTier={selectedTier} />
        </TabsContent>

        <TabsContent value="wheel" className="mt-4">
          <GameLeaderboard game="wheel" selectedTier={selectedTier} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
