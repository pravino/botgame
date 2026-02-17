import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, TrendingDown, Clock, CheckCircle2, XCircle, ArrowUpCircle, ArrowDownCircle } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Prediction, User } from "@shared/schema";

interface BtcPrice {
  price: number;
  change24h: number;
}

export default function PricePrediction() {
  const { toast } = useToast();

  const { data: user } = useQuery<User>({
    queryKey: ["/api/user"],
  });

  const { data: btcPrice, isLoading: priceLoading } = useQuery<BtcPrice>({
    queryKey: ["/api/btc-price"],
    refetchInterval: 30000,
  });

  const { data: predictions, isLoading: predictionsLoading } = useQuery<Prediction[]>({
    queryKey: ["/api/predictions"],
  });

  const { data: activePrediction } = useQuery<Prediction | null>({
    queryKey: ["/api/predictions", "active"],
  });

  const predictMutation = useMutation({
    mutationFn: async (prediction: string) => {
      const res = await apiRequest("POST", "/api/predict", { prediction });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/predictions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      toast({
        title: "Prediction placed!",
        description: "Your prediction has been recorded. Check back in 12 hours to see if you were right.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Prediction failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const isLoading = priceLoading || predictionsLoading;

  if (isLoading) {
    return (
      <div className="p-4 md:p-6 space-y-6 max-w-lg mx-auto">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-40" />
        <Skeleton className="h-32" />
        <Skeleton className="h-48" />
      </div>
    );
  }

  const priceChangePositive = (btcPrice?.change24h || 0) >= 0;

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-lg mx-auto">
      <div className="text-center space-y-1">
        <h1 className="text-2xl font-bold tracking-tight" data-testid="text-predict-title">
          Price Prediction
        </h1>
        <p className="text-muted-foreground text-sm">
          Will BTC be higher or lower in 12 hours?
        </p>
      </div>

      <Card>
        <CardContent className="p-6 text-center space-y-3">
          <p className="text-sm text-muted-foreground uppercase tracking-wider">Bitcoin Price</p>
          <p className="text-4xl font-bold font-mono tracking-tight" data-testid="text-btc-price">
            ${btcPrice?.price?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || "---"}
          </p>
          <div className="flex items-center justify-center gap-1">
            {priceChangePositive ? (
              <TrendingUp className="h-4 w-4 text-chart-2" />
            ) : (
              <TrendingDown className="h-4 w-4 text-destructive" />
            )}
            <span className={`text-sm font-medium ${priceChangePositive ? "text-chart-2" : "text-destructive"}`}>
              {priceChangePositive ? "+" : ""}
              {btcPrice?.change24h?.toFixed(2) || "0.00"}% (24h)
            </span>
          </div>
        </CardContent>
      </Card>

      {activePrediction && !activePrediction.resolved ? (
        <Card>
          <CardContent className="p-5 space-y-3">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-primary" />
              <span className="font-semibold">Active Prediction</span>
            </div>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">You predicted</p>
                <Badge variant={activePrediction.prediction === "higher" ? "default" : "secondary"}>
                  {activePrediction.prediction === "higher" ? (
                    <span className="flex items-center gap-1"><ArrowUpCircle className="h-3 w-3" /> Higher</span>
                  ) : (
                    <span className="flex items-center gap-1"><ArrowDownCircle className="h-3 w-3" /> Lower</span>
                  )}
                </Badge>
              </div>
              <div className="text-right space-y-1">
                <p className="text-sm text-muted-foreground">Price at prediction</p>
                <p className="font-mono font-medium">
                  ${activePrediction.btcPriceAtPrediction?.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" />
              Resolves in ~12 hours from prediction time
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-5 space-y-4">
            <p className="font-semibold text-center">Make Your Prediction</p>
            <p className="text-sm text-muted-foreground text-center">
              Will BTC be higher or lower than ${btcPrice?.price?.toLocaleString() || "---"} in 12 hours?
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Button
                onClick={() => predictMutation.mutate("higher")}
                disabled={predictMutation.isPending}
                className="bg-chart-2 text-white border-chart-2"
                data-testid="button-predict-higher"
              >
                <ArrowUpCircle className="h-4 w-4 mr-2" />
                Higher
              </Button>
              <Button
                variant="destructive"
                onClick={() => predictMutation.mutate("lower")}
                disabled={predictMutation.isPending}
                data-testid="button-predict-lower"
              >
                <ArrowDownCircle className="h-4 w-4 mr-2" />
                Lower
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h2 className="font-semibold">History</h2>
          <p className="text-sm text-muted-foreground">
            {user?.correctPredictions || 0}/{user?.totalPredictions || 0} correct
          </p>
        </div>

        {(!predictions || predictions.length === 0) ? (
          <Card>
            <CardContent className="p-6 text-center">
              <p className="text-muted-foreground text-sm">No predictions yet. Make your first one above!</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {predictions.slice(0, 10).map((pred) => (
              <Card key={pred.id}>
                <CardContent className="p-3 flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    {pred.resolved ? (
                      pred.correct ? (
                        <CheckCircle2 className="h-4 w-4 text-chart-2" />
                      ) : (
                        <XCircle className="h-4 w-4 text-destructive" />
                      )
                    ) : (
                      <Clock className="h-4 w-4 text-muted-foreground" />
                    )}
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium capitalize">{pred.prediction}</span>
                        {pred.resolved && (
                          <Badge variant={pred.correct ? "default" : "secondary"} className="text-xs">
                            {pred.correct ? "Correct" : "Wrong"}
                          </Badge>
                        )}
                        {!pred.resolved && (
                          <Badge variant="outline" className="text-xs">Pending</Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Entry: ${pred.btcPriceAtPrediction?.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        {pred.resolvedPrice && ` → $${pred.resolvedPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
                      </p>
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {new Date(pred.createdAt).toLocaleDateString()}
                  </span>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
