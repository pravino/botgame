import { useState, useEffect, useRef } from "react";
import { Switch, Route } from "wouter";
import { queryClient, getQueryFn } from "./lib/queryClient";
import { QueryClientProvider, useQuery, useMutation } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { Zap, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/dashboard";
import TapToEarn from "@/pages/tap-to-earn";
import Leaderboard from "@/pages/leaderboard";
import WalletPage from "@/pages/wallet";
import Welcome from "@/pages/welcome";
import SubscriptionPage from "@/pages/subscription";
import Tasks from "@/pages/tasks";
import DailyCombo from "@/pages/daily-combo";
import Leagues from "@/pages/leagues";
import Referrals from "@/pages/referrals";
import type { User } from "@shared/schema";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/tap" component={TapToEarn} />
      <Route path="/tasks" component={Tasks} />
      <Route path="/combo" component={DailyCombo} />
      <Route path="/leagues" component={Leagues} />
      <Route path="/wallet" component={WalletPage} />
      <Route path="/subscription" component={SubscriptionPage} />
      <Route path="/leaderboard" component={Leaderboard} />
      <Route path="/referrals" component={Referrals} />
      <Route component={NotFound} />
    </Switch>
  );
}

function LoadingScreen({ message }: { message?: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center space-y-3">
        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 mx-auto animate-pulse flex items-center justify-center"
          style={{ boxShadow: "0 0 30px rgba(16, 185, 129, 0.3)" }}
        >
          <Zap className="h-6 w-6 text-white" />
        </div>
        <p className="text-sm text-muted-foreground">{message || "Loading..."}</p>
      </div>
    </div>
  );
}

function AuthenticatedApp() {
  const { data: user, isLoading } = useQuery<User | null>({
    queryKey: ["/api/user"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  const [loggedIn, setLoggedIn] = useState(false);
  const [miniAppAuthFailed, setMiniAppAuthFailed] = useState(false);
  const autoAuthRef = useRef(false);

  const tg = window.Telegram?.WebApp;
  const isMiniApp = !!(tg && tg.initData);

  const miniAppAuthMutation = useMutation({
    mutationFn: async (data: { initData: string; referralCode?: string }) => {
      const res = await apiRequest("POST", "/api/auth/telegram", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      setLoggedIn(true);
    },
    onError: () => {
      setMiniAppAuthFailed(true);
    },
  });

  useEffect(() => {
    if (user) setLoggedIn(true);
  }, [user]);

  useEffect(() => {
    if (isMiniApp && !isLoading && !user && !autoAuthRef.current) {
      autoAuthRef.current = true;
      tg!.ready();
      tg!.expand();
      const startParam = tg!.initDataUnsafe?.start_param;
      miniAppAuthMutation.mutate({
        initData: tg!.initData,
        referralCode: startParam || undefined,
      });
    }
  }, [isMiniApp, isLoading, user]);

  if (isLoading) {
    return <LoadingScreen />;
  }

  if (isMiniApp && !loggedIn && !miniAppAuthFailed) {
    return <LoadingScreen message="Connecting to Vault60..." />;
  }

  if (isMiniApp && miniAppAuthFailed) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-background">
        <div className="text-center space-y-4">
          <ShieldAlert className="h-10 w-10 mx-auto text-destructive" />
          <p className="text-sm text-destructive font-medium">Authentication failed</p>
          <p className="text-xs text-muted-foreground">Could not verify your Telegram identity.</p>
          <Button
            onClick={() => {
              setMiniAppAuthFailed(false);
              autoAuthRef.current = false;
            }}
            data-testid="button-retry-auth"
          >
            Try Again
          </Button>
        </div>
      </div>
    );
  }

  if (!loggedIn || !user) {
    return <Welcome onLogin={() => setLoggedIn(true)} />;
  }

  const style = {
    "--sidebar-width": "15rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <div className="flex h-screen w-full">
        <AppSidebar user={user} />
        <div className="flex flex-col flex-1 min-w-0">
          <header className="flex items-center justify-between gap-2 p-2 border-b sticky top-0 z-50 bg-background">
            <SidebarTrigger data-testid="button-sidebar-toggle" />
            <ThemeToggle />
          </header>
          <main className="flex-1 overflow-auto">
            <Router />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <AuthenticatedApp />
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
