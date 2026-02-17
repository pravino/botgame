import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Trophy, Coins, TrendingUp, CircleDot } from "lucide-react";
import { formatNumber, formatUSD } from "@/lib/game-utils";

interface LeaderboardEntry {
  id: string;
  username: string;
  totalCoins: number;
  correctPredictions: number;
  totalPredictions: number;
  totalWheelWinnings: number;
  rank: number;
}

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) return <div className="w-7 h-7 rounded-full bg-amber-500 flex items-center justify-center text-xs font-bold text-white">1</div>;
  if (rank === 2) return <div className="w-7 h-7 rounded-full bg-gray-400 flex items-center justify-center text-xs font-bold text-white">2</div>;
  if (rank === 3) return <div className="w-7 h-7 rounded-full bg-amber-700 flex items-center justify-center text-xs font-bold text-white">3</div>;
  return <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center text-xs font-medium text-muted-foreground">{rank}</div>;
}

function LeaderboardList({
  data,
  valueKey,
  formatFn,
  icon: Icon,
}: {
  data?: LeaderboardEntry[];
  valueKey: "totalCoins" | "correctPredictions" | "totalWheelWinnings";
  formatFn: (val: number) => string;
  icon: React.ElementType;
}) {
  if (!data || data.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-center">
          <p className="text-muted-foreground text-sm">No players yet. Be the first!</p>
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
              <p className="text-sm font-medium truncate" data-testid={`text-username-${entry.id}`}>
                {entry.username}
              </p>
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

export default function Leaderboard() {
  const { data: coinLeaders, isLoading: coinsLoading } = useQuery<LeaderboardEntry[]>({
    queryKey: ["/api/leaderboard", "coins"],
  });

  const { data: predictionLeaders, isLoading: predsLoading } = useQuery<LeaderboardEntry[]>({
    queryKey: ["/api/leaderboard", "predictions"],
  });

  const { data: wheelLeaders, isLoading: wheelLoading } = useQuery<LeaderboardEntry[]>({
    queryKey: ["/api/leaderboard", "wheel"],
  });

  const isLoading = coinsLoading || predsLoading || wheelLoading;

  if (isLoading) {
    return (
      <div className="p-4 md:p-6 space-y-6 max-w-lg mx-auto">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-10 w-full" />
        {[1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-16" />
        ))}
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-lg mx-auto">
      <div className="text-center space-y-1">
        <div className="flex items-center justify-center gap-2">
          <Trophy className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-leaderboard-title">
            Leaderboard
          </h1>
        </div>
        <p className="text-muted-foreground text-sm">Top players across all games</p>
      </div>

      <Tabs defaultValue="coins" className="w-full">
        <TabsList className="w-full grid grid-cols-3" data-testid="tabs-leaderboard">
          <TabsTrigger value="coins" data-testid="tab-coins">
            <Coins className="h-3.5 w-3.5 mr-1" />
            Coins
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
          <LeaderboardList
            data={coinLeaders}
            valueKey="totalCoins"
            formatFn={formatNumber}
            icon={Coins}
          />
        </TabsContent>

        <TabsContent value="predictions" className="mt-4">
          <LeaderboardList
            data={predictionLeaders}
            valueKey="correctPredictions"
            formatFn={(v) => `${v} correct`}
            icon={TrendingUp}
          />
        </TabsContent>

        <TabsContent value="wheel" className="mt-4">
          <LeaderboardList
            data={wheelLeaders}
            valueKey="totalWheelWinnings"
            formatFn={formatUSD}
            icon={CircleDot}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
