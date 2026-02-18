import { useState, useCallback, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Coins, Zap, Clock, BatteryCharging } from "lucide-react";
import {
  formatNumber,
  getEnergyPercentage,
  calculateCurrentEnergy,
  getTimeUntilFullEnergy,
  canUseFreeRefill,
  getTimeUntilFreeRefill,
} from "@/lib/game-utils";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { User } from "@shared/schema";
import { motion, AnimatePresence } from "framer-motion";
import { useToast } from "@/hooks/use-toast";

interface FloatingCoin {
  id: number;
  x: number;
  y: number;
}

export default function TapToEarn() {
  const [floatingCoins, setFloatingCoins] = useState<FloatingCoin[]>([]);
  const [tapScale, setTapScale] = useState(1);
  const [liveEnergy, setLiveEnergy] = useState<number | null>(null);
  const coinIdRef = useRef(0);
  const pendingTapsRef = useRef(0);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { toast } = useToast();

  const { data: user, isLoading } = useQuery<User>({
    queryKey: ["/api/user"],
  });

  useEffect(() => {
    if (!user) return;

    const tick = () => {
      const current = calculateCurrentEnergy(
        user.energy,
        user.maxEnergy,
        user.lastEnergyRefill
      );
      setLiveEnergy(current);
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [user]);

  const tapMutation = useMutation({
    mutationFn: async (taps: number) => {
      const res = await apiRequest("POST", "/api/tap", { taps });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
    },
  });

  const refillMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/energy/refill", {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      toast({ title: "Energy Refilled!", description: "Your tank is full. Time for a tapping spree!" });
    },
    onError: (error: any) => {
      const msg = error.message?.includes("Free refill already used")
        ? "You already used your free refill today. Try again later!"
        : error.message || "Refill not available right now";
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

      const id = ++coinIdRef.current;
      setFloatingCoins((prev) => [...prev, { id, x, y }]);
      setTimeout(() => {
        setFloatingCoins((prev) => prev.filter((c) => c.id !== id));
      }, 800);

      setTapScale(0.92);
      setTimeout(() => setTapScale(1), 100);

      pendingTapsRef.current += 1;

      setLiveEnergy((prev) => Math.max(0, (prev ?? currentEnergy) - 1));

      queryClient.setQueryData<User>(["/api/user"], (old) =>
        old
          ? {
              ...old,
              energy: Math.max(0, old.energy - 1),
              totalCoins: old.totalCoins + 1,
            }
          : old
      );

      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
      if (pendingTapsRef.current >= 40) {
        flushTaps();
      } else {
        flushTimerRef.current = setTimeout(flushTaps, 500);
      }
    },
    [user, liveEnergy, flushTaps]
  );

  if (isLoading) {
    return (
      <div className="p-4 md:p-6 space-y-6 max-w-md mx-auto">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-80 rounded-md" />
        <Skeleton className="h-20" />
      </div>
    );
  }

  const currentEnergy = liveEnergy ?? user?.energy ?? 0;
  const maxEnergy = user?.maxEnergy ?? 1000;
  const energyPct = getEnergyPercentage(currentEnergy, maxEnergy);
  const timeUntilFull = getTimeUntilFullEnergy(currentEnergy, maxEnergy);
  const freeRefillAvailable = canUseFreeRefill(user?.lastFreeRefill ?? null);
  const freeRefillTimer = getTimeUntilFreeRefill(user?.lastFreeRefill ?? null);

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-md mx-auto">
      <div className="text-center space-y-1">
        <h1 className="text-2xl font-bold tracking-tight" data-testid="text-tap-title">
          Tap to Earn
        </h1>
        <p className="text-muted-foreground text-sm">Tap the coin to mine Group Coins</p>
      </div>

      <Card>
        <CardContent className="p-6 text-center space-y-2">
          <div className="flex items-center justify-center gap-2">
            <Coins className="h-5 w-5 text-primary" />
            <span className="text-3xl font-bold animate-number-pop" data-testid="text-total-coins">
              {formatNumber(user?.totalCoins || 0)}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">Group Coins</p>
        </CardContent>
      </Card>

      <div className="flex justify-center">
        <div
          className="relative select-none touch-none cursor-pointer"
          onMouseDown={handleTap}
          onTouchStart={handleTap}
          data-testid="button-tap-coin"
        >
          <motion.div
            animate={{ scale: tapScale }}
            transition={{ type: "spring", stiffness: 500, damping: 20 }}
            className={`w-44 h-44 rounded-full flex items-center justify-center
              bg-gradient-to-br from-amber-400 via-yellow-500 to-orange-500
              ${currentEnergy > 0 ? "animate-pulse-glow" : "opacity-50"}
            `}
            style={{
              boxShadow: currentEnergy > 0
                ? "0 0 30px rgba(245, 158, 11, 0.3), inset 0 -4px 12px rgba(0,0,0,0.15)"
                : "inset 0 -4px 12px rgba(0,0,0,0.15)",
            }}
          >
            <div className="w-36 h-36 rounded-full bg-gradient-to-br from-yellow-300 via-amber-400 to-yellow-600 flex items-center justify-center"
              style={{ boxShadow: "inset 0 2px 8px rgba(255,255,255,0.4), inset 0 -2px 8px rgba(0,0,0,0.2)" }}
            >
              <Coins className="w-16 h-16 text-amber-900/70" />
            </div>
          </motion.div>

          <AnimatePresence>
            {floatingCoins.map((coin) => (
              <motion.div
                key={coin.id}
                initial={{ x: coin.x - 20, y: coin.y - 20, opacity: 1, scale: 1 }}
                animate={{ y: coin.y - 80, opacity: 0, scale: 0.5 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.7, ease: "easeOut" }}
                className="absolute top-0 left-0 pointer-events-none text-primary font-bold text-lg"
              >
                +1
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>

      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-chart-2" />
              <span className="font-medium text-sm">Energy</span>
            </div>
            <span className="text-sm font-mono text-muted-foreground" data-testid="text-energy">
              {currentEnergy} / {maxEnergy}
            </span>
          </div>
          <Progress
            value={energyPct}
            className="h-3"
            data-testid="progress-energy"
          />
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              <span>{currentEnergy >= maxEnergy ? "Tank full!" : `Full in: ${timeUntilFull}`}</span>
            </div>
            {freeRefillAvailable ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => refillMutation.mutate()}
                disabled={refillMutation.isPending || currentEnergy >= maxEnergy}
                data-testid="button-free-refill"
              >
                <BatteryCharging className="h-3.5 w-3.5 mr-1" />
                {refillMutation.isPending ? "Refilling..." : "Free Refill"}
              </Button>
            ) : (
              <span className="text-xs text-muted-foreground" data-testid="text-refill-timer">
                Next refill: {freeRefillTimer}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {currentEnergy <= 0 && (
        <Card>
          <CardContent className="p-4 text-center space-y-2">
            <p className="text-sm text-muted-foreground">
              Energy depleted. It refills at 1 per 2 seconds — come back in a few minutes!
            </p>
            {freeRefillAvailable && (
              <Button
                variant="default"
                onClick={() => refillMutation.mutate()}
                disabled={refillMutation.isPending}
                data-testid="button-free-refill-cta"
              >
                <BatteryCharging className="h-4 w-4 mr-1" />
                {refillMutation.isPending ? "Refilling..." : "Use Free Refill"}
              </Button>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
