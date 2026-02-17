import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Coins, TrendingUp, CircleDot, Sparkles } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export default function Welcome({ onLogin }: { onLogin: () => void }) {
  const [username, setUsername] = useState("");
  const { toast } = useToast();

  const loginMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await apiRequest("POST", "/api/login", { username: name });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      onLogin();
    },
    onError: (error: Error) => {
      toast({
        title: "Login failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = username.trim();
    if (!trimmed) return;
    loginMutation.mutate(trimmed);
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center space-y-3">
          <div className="mx-auto w-20 h-20 rounded-full bg-gradient-to-br from-amber-400 via-yellow-500 to-orange-500 flex items-center justify-center animate-coin-float"
            style={{ boxShadow: "0 0 40px rgba(245, 158, 11, 0.3)" }}
          >
            <Coins className="h-10 w-10 text-amber-900/70" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">
            Crypto Games
          </h1>
          <p className="text-muted-foreground text-sm">
            Tap, predict, spin. Earn rewards every day.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Card>
            <CardContent className="p-3 text-center space-y-1">
              <Coins className="h-5 w-5 mx-auto text-amber-500" />
              <p className="text-xs text-muted-foreground">Tap & Earn</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 text-center space-y-1">
              <TrendingUp className="h-5 w-5 mx-auto text-blue-500" />
              <p className="text-xs text-muted-foreground">Predict</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 text-center space-y-1">
              <CircleDot className="h-5 w-5 mx-auto text-purple-500" />
              <p className="text-xs text-muted-foreground">Spin</p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardContent className="p-5">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Choose your username</label>
                <Input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Enter a username..."
                  maxLength={20}
                  data-testid="input-username"
                />
              </div>
              <Button
                type="submit"
                className="w-full"
                disabled={!username.trim() || loginMutation.isPending}
                data-testid="button-start-playing"
              >
                <Sparkles className="h-4 w-4 mr-2" />
                {loginMutation.isPending ? "Joining..." : "Start Playing"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          No password needed. Pick a name and jump in.
        </p>
      </div>
    </div>
  );
}
