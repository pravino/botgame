import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { Zap, Trophy, ArrowRight, Medal, ClipboardList, Puzzle } from "lucide-react";
import { formatNumber } from "@/lib/game-utils";
import type { User } from "@shared/schema";

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  color,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  sub?: string;
  color: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="text-2xl font-bold tracking-tight">{value}</p>
            {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
          </div>
          <div className={`p-2 rounded-md ${color}`}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function GameCard({
  title,
  description,
  icon: Icon,
  href,
  gradient,
  badge,
}: {
  title: string;
  description: string;
  icon: React.ElementType;
  href: string;
  gradient: string;
  badge?: string;
}) {
  return (
    <Link href={href}>
      <Card className="hover-elevate active-elevate-2 cursor-pointer transition-transform duration-200 overflow-visible">
        <CardContent className="p-0">
          <div className={`${gradient} p-6 rounded-t-md flex items-center justify-between`}>
            <Icon className="h-10 w-10 text-white" />
            {badge && <Badge variant="secondary">{badge}</Badge>}
          </div>
          <div className="p-4 space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h3 className="font-semibold text-lg">{title}</h3>
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

export default function Dashboard() {
  const { data: user, isLoading } = useQuery<User>({
    queryKey: ["/api/user"],
  });

  if (isLoading) {
    return (
      <div className="p-4 md:p-6 space-y-6 max-w-4xl mx-auto">
        <div className="space-y-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-64" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-56" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-4xl mx-auto">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight" data-testid="text-welcome">
          Welcome back, {user?.username || "Player"}
        </h1>
        <p className="text-muted-foreground text-sm">
          Your gaming dashboard at a glance
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <StatCard
          icon={Zap}
          label="Total Watts"
          value={formatNumber(user?.totalCoins || 0)}
          sub="Generated"
          color="bg-primary/10 text-primary"
        />
        <StatCard
          icon={Zap}
          label="Energy"
          value={`${user?.energy || 0}`}
          sub={`/ ${user?.maxEnergy || 1000}`}
          color="bg-chart-2/10 text-chart-2"
        />
      </div>

      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Games</h2>
        <div className="grid gap-4 md:grid-cols-3">
          <GameCard
            title="Power Plant"
            description="Crank your generator to produce watts. Your energy refills every 24 hours."
            icon={Zap}
            href="/tap"
            gradient="bg-gradient-to-br from-emerald-500 to-teal-600"
            badge="Daily"
          />
        </div>
      </div>

      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Earn More</h2>
        <div className="grid gap-3 md:grid-cols-3">
          <Link href="/tasks" data-testid="link-tasks">
            <Card className="hover-elevate active-elevate-2 cursor-pointer overflow-visible">
              <CardContent className="p-4 flex items-center gap-3 flex-wrap">
                <div className="p-2 rounded-md bg-chart-1/10 text-chart-1 shrink-0">
                  <ClipboardList className="h-5 w-5" />
                </div>
                <div>
                  <p className="font-semibold text-sm">Tasks</p>
                  <p className="text-xs text-muted-foreground">Social & daily tasks</p>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground ml-auto shrink-0" />
              </CardContent>
            </Card>
          </Link>
          <Link href="/combo" data-testid="link-daily-combo">
            <Card className="hover-elevate active-elevate-2 cursor-pointer overflow-visible">
              <CardContent className="p-4 flex items-center gap-3 flex-wrap">
                <div className="p-2 rounded-md bg-chart-2/10 text-chart-2 shrink-0">
                  <Puzzle className="h-5 w-5" />
                </div>
                <div>
                  <p className="font-semibold text-sm">Daily Combo</p>
                  <p className="text-xs text-muted-foreground">Crack today's code</p>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground ml-auto shrink-0" />
              </CardContent>
            </Card>
          </Link>
          <Link href="/leagues" data-testid="link-leagues">
            <Card className="hover-elevate active-elevate-2 cursor-pointer overflow-visible">
              <CardContent className="p-4 flex items-center gap-3 flex-wrap">
                <div className="p-2 rounded-md bg-chart-3/10 text-chart-3 shrink-0">
                  <Medal className="h-5 w-5" />
                </div>
                <div>
                  <p className="font-semibold text-sm">Leagues</p>
                  <p className="text-xs text-muted-foreground">
                    {(user as any)?.league || "BRONZE"} League
                  </p>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground ml-auto shrink-0" />
              </CardContent>
            </Card>
          </Link>
        </div>
      </div>

      <Card>
        <CardContent className="p-4">
          <Link href="/leaderboard" className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-md bg-primary/10 text-primary">
                <Trophy className="h-5 w-5" />
              </div>
              <div>
                <p className="font-semibold">Leaderboard</p>
                <p className="text-sm text-muted-foreground">See how you rank against other players</p>
              </div>
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
