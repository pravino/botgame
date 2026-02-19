import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Puzzle, Check, Coins, Clock, HelpCircle, Sparkles } from "lucide-react";
import { formatNumber } from "@/lib/game-utils";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface ComboInfo {
  date: string;
  hint: string;
  rewardCoins: number;
  codeLength: number;
  solved: boolean;
  attempts: number;
  secondsRemaining: number;
}

function CountdownTimer({ initialSeconds }: { initialSeconds: number }) {
  const [seconds, setSeconds] = useState(initialSeconds);

  useEffect(() => {
    setSeconds(initialSeconds);
  }, [initialSeconds]);

  useEffect(() => {
    if (seconds <= 0) return;
    const timer = setInterval(() => {
      setSeconds(prev => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [seconds]);

  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  return (
    <span className="font-mono text-sm" data-testid="text-combo-countdown">
      {hours.toString().padStart(2, "0")}:{mins.toString().padStart(2, "0")}:{secs.toString().padStart(2, "0")}
    </span>
  );
}

export default function DailyCombo() {
  const { toast } = useToast();
  const [guessWords, setGuessWords] = useState<string[]>(["", "", ""]);
  const [lastResult, setLastResult] = useState<string | null>(null);

  const { data: combo, isLoading, error } = useQuery<ComboInfo>({
    queryKey: ["/api/daily-combo"],
  });

  const solveMutation = useMutation({
    mutationFn: async (code: string) => {
      const res = await apiRequest("POST", "/api/daily-combo/solve", { code });
      return res.json();
    },
    onSuccess: (data) => {
      if (data.correct) {
        setLastResult("correct");
        toast({
          title: "Combo Cracked!",
          description: `+${formatNumber(data.coinsAwarded)} coins earned!`,
        });
        queryClient.invalidateQueries({ queryKey: ["/api/daily-combo"] });
        queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      } else {
        setLastResult("wrong");
        toast({
          title: "Wrong Code",
          description: "Try again! Check the hint for clues.",
          variant: "destructive",
        });
        queryClient.invalidateQueries({ queryKey: ["/api/daily-combo"] });
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleSubmit = () => {
    const code = guessWords.map(w => w.trim().toUpperCase()).join("-");
    if (guessWords.some(w => !w.trim())) {
      toast({ title: "Fill all words", description: "Enter all three words to solve the combo.", variant: "destructive" });
      return;
    }
    solveMutation.mutate(code);
  };

  if (isLoading) {
    return (
      <div className="p-4 md:p-6 space-y-4 max-w-lg mx-auto">
        <Skeleton className="h-8 w-48 mx-auto" />
        <Skeleton className="h-48" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 md:p-6 max-w-lg mx-auto">
        <Card>
          <CardContent className="p-6 text-center space-y-2">
            <p className="text-sm text-destructive font-medium">Failed to load daily combo</p>
            <p className="text-xs text-muted-foreground">{error.message}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-lg mx-auto">
      <div className="text-center space-y-1">
        <div className="flex items-center justify-center gap-2">
          <Puzzle className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-combo-title">Daily Combo</h1>
        </div>
        <p className="text-muted-foreground text-sm">Crack today's secret code for a massive coin boost</p>
      </div>

      <Card>
        <CardContent className="p-5 space-y-4">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">Reward</span>
            </div>
            <Badge variant="secondary" data-testid="text-combo-reward">
              <Coins className="h-3 w-3 mr-1" />
              {formatNumber(combo?.rewardCoins || 0)} coins
            </Badge>
          </div>

          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Resets in</span>
            </div>
            <CountdownTimer initialSeconds={combo?.secondsRemaining || 0} />
          </div>

          {combo?.hint && (
            <div className="flex items-start gap-2 p-3 rounded-md bg-muted/50">
              <HelpCircle className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
              <p className="text-xs text-muted-foreground" data-testid="text-combo-hint">{combo.hint}</p>
            </div>
          )}

          {combo?.solved ? (
            <div className="text-center py-6 space-y-2">
              <div className="h-14 w-14 rounded-full bg-green-500/10 flex items-center justify-center mx-auto">
                <Check className="h-7 w-7 text-green-500" />
              </div>
              <p className="text-lg font-bold text-green-500" data-testid="text-combo-solved">Solved!</p>
              <p className="text-sm text-muted-foreground">
                You cracked today's combo. Come back tomorrow for a new one!
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground text-center">
                Enter {combo?.codeLength || 3} crypto words separated by dashes
                {combo?.attempts ? ` (${combo.attempts} attempt${combo.attempts > 1 ? "s" : ""})` : ""}
              </p>
              <div className="flex items-center gap-2">
                {guessWords.map((word, idx) => (
                  <div key={idx} className="flex-1 flex items-center gap-1">
                    <Input
                      placeholder={`Word ${idx + 1}`}
                      value={word}
                      onChange={(e) => {
                        const updated = [...guessWords];
                        updated[idx] = e.target.value.toUpperCase();
                        setGuessWords(updated);
                        setLastResult(null);
                      }}
                      className={`text-center text-sm font-mono uppercase ${lastResult === "wrong" ? "border-destructive" : ""}`}
                      data-testid={`input-combo-word-${idx}`}
                    />
                    {idx < guessWords.length - 1 && <span className="text-muted-foreground font-bold">-</span>}
                  </div>
                ))}
              </div>
              <Button
                className="w-full"
                onClick={handleSubmit}
                disabled={solveMutation.isPending}
                data-testid="button-combo-submit"
              >
                {solveMutation.isPending ? "Checking..." : "Crack the Code"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
