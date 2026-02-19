import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CircleDot, Gift, History } from "lucide-react";
import { formatUSD, WHEEL_SLICES } from "@/lib/game-utils";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { WheelSpin, User } from "@shared/schema";

const SLICE_COUNT = WHEEL_SLICES.length;
const SLICE_ANGLE = 360 / SLICE_COUNT;

export default function LuckyWheel() {
  const { toast } = useToast();
  const [spinning, setSpinning] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [lastWin, setLastWin] = useState<{ label: string; value: number } | null>(null);
  const wheelRef = useRef<HTMLDivElement>(null);

  const { data: user } = useQuery<User>({
    queryKey: ["/api/user"],
  });

  const { data: history, isLoading: historyLoading } = useQuery<WheelSpin[]>({
    queryKey: ["/api/wheel-history"],
  });

  const spinMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/spin");
      return res.json();
    },
    onSuccess: (data: { reward: number; coinsAwarded: number; energyAwarded: number; sliceLabel: string; sliceIndex: number; prizeTier: string }) => {
      const targetSlice = data.sliceIndex;
      const sliceCenter = targetSlice * SLICE_ANGLE + SLICE_ANGLE / 2;
      const fullSpins = 5 + Math.floor(Math.random() * 3);
      const targetRotation = fullSpins * 360 + (360 - sliceCenter);

      setRotation((prev) => prev + targetRotation);
      setSpinning(true);

      setTimeout(() => {
        setSpinning(false);
        setLastWin({ label: data.sliceLabel, value: data.reward });
        queryClient.invalidateQueries({ queryKey: ["/api/user"] });
        queryClient.invalidateQueries({ queryKey: ["/api/wheel-history"] });

        let description = "";
        if (data.reward > 0) {
          description = `${formatUSD(data.reward)} USDT has been added to your wallet!`;
        } else if (data.coinsAwarded > 0) {
          description = `${data.coinsAwarded.toLocaleString()} coins have been added!`;
        } else if (data.energyAwarded > 0) {
          description = `+${data.energyAwarded} energy boost applied!`;
        }

        toast({
          title: data.prizeTier === "jackpot" ? `JACKPOT! ${data.sliceLabel}` : `You won ${data.sliceLabel}!`,
          description,
        });
      }, 4000);
    },
    onError: (error: Error) => {
      toast({
        title: "Spin failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const isPaidTier = user && user.tier !== "FREE" && user.subscriptionExpiry && new Date(user.subscriptionExpiry) > new Date();
  const availableSpins = isPaidTier ? (user?.spinTickets ?? 0) : (user?.spinsRemaining ?? 0);

  const handleSpin = () => {
    if (spinning || availableSpins <= 0) return;
    setLastWin(null);
    spinMutation.mutate();
  };

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-lg mx-auto">
      <div className="text-center space-y-1">
        <h1 className="text-2xl font-bold tracking-tight" data-testid="text-wheel-title">
          Lucky Wheel
        </h1>
        <p className="text-muted-foreground text-sm">
          Spin for a chance to win USDT, coins, and energy
        </p>
      </div>

      <Card>
        <CardContent className="p-4 flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Gift className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">Spins Remaining</span>
          </div>
          <Badge variant="default" data-testid="text-spins-remaining">
            {availableSpins}
          </Badge>
        </CardContent>
      </Card>

      <div className="flex justify-center">
        <div className="relative">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-2 z-10">
            <div className="w-0 h-0 border-l-[12px] border-r-[12px] border-t-[20px] border-l-transparent border-r-transparent border-t-primary" />
          </div>

          <div
            ref={wheelRef}
            className="w-72 h-72 md:w-80 md:h-80 rounded-full relative overflow-hidden border-4 border-primary/30"
            style={{
              transform: `rotate(${rotation}deg)`,
              transition: spinning ? "transform 4s cubic-bezier(0.17, 0.67, 0.12, 0.99)" : "none",
            }}
            data-testid="wheel-container"
          >
            <svg viewBox="0 0 300 300" className="w-full h-full">
              {WHEEL_SLICES.map((slice, i) => {
                const startAngle = i * SLICE_ANGLE;
                const endAngle = startAngle + SLICE_ANGLE;
                const startRad = (startAngle * Math.PI) / 180;
                const endRad = (endAngle * Math.PI) / 180;
                const midRad = ((startAngle + SLICE_ANGLE / 2) * Math.PI) / 180;

                const x1 = 150 + 150 * Math.cos(startRad);
                const y1 = 150 + 150 * Math.sin(startRad);
                const x2 = 150 + 150 * Math.cos(endRad);
                const y2 = 150 + 150 * Math.sin(endRad);
                const largeArc = SLICE_ANGLE > 180 ? 1 : 0;

                const textX = 150 + 95 * Math.cos(midRad);
                const textY = 150 + 95 * Math.sin(midRad);
                const textAngle = startAngle + SLICE_ANGLE / 2;

                return (
                  <g key={i}>
                    <path
                      d={`M 150 150 L ${x1} ${y1} A 150 150 0 ${largeArc} 1 ${x2} ${y2} Z`}
                      fill={slice.color}
                      stroke="rgba(255,255,255,0.15)"
                      strokeWidth="1"
                    />
                    <text
                      x={textX}
                      y={textY}
                      fill="white"
                      fontSize="11"
                      fontWeight="bold"
                      textAnchor="middle"
                      dominantBaseline="middle"
                      transform={`rotate(${textAngle}, ${textX}, ${textY})`}
                    >
                      {slice.label}
                    </text>
                  </g>
                );
              })}
              <circle cx="150" cy="150" r="22" fill="hsl(var(--card))" stroke="hsl(var(--border))" strokeWidth="2" />
              <circle cx="150" cy="150" r="8" fill="hsl(var(--primary))" />
            </svg>
          </div>
        </div>
      </div>

      <div className="flex justify-center">
        <Button
          onClick={handleSpin}
          disabled={spinning || availableSpins <= 0}
          className="px-8"
          data-testid="button-spin"
        >
          {spinning ? (
            <span className="flex items-center gap-2">
              <CircleDot className="h-4 w-4 animate-spin" />
              Spinning...
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <CircleDot className="h-4 w-4" />
              {availableSpins <= 0 ? "No Spins Left" : "Spin the Wheel"}
            </span>
          )}
        </Button>
      </div>

      {lastWin && (
        <Card>
          <CardContent className="p-4 text-center space-y-1">
            <p className="text-sm text-muted-foreground">You won</p>
            <p className="text-2xl font-bold text-primary" data-testid="text-last-win">
              {lastWin.label}
            </p>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-muted-foreground" />
          <h2 className="font-semibold">Spin History</h2>
        </div>

        {historyLoading ? (
          <Skeleton className="h-32" />
        ) : !history || history.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-center">
              <p className="text-muted-foreground text-sm">No spins yet. Try your luck!</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {history.slice(0, 10).map((spin) => (
              <Card key={spin.id}>
                <CardContent className="p-3 flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Gift className="h-4 w-4 text-primary" />
                    <span className="text-sm font-medium">{spin.sliceLabel}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {new Date(spin.createdAt).toLocaleDateString()}
                  </span>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Card>
        <CardContent className="p-4 space-y-2">
          <p className="text-sm font-medium">Prize Distribution</p>
          <div className="grid grid-cols-2 gap-2">
            {WHEEL_SLICES.filter((s, i, arr) => arr.findIndex(a => a.label === s.label) === i).map((slice) => (
              <div key={slice.label} className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: slice.color }} />
                <span className="text-xs text-muted-foreground">{slice.label}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
