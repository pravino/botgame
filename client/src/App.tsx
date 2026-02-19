import { useState, useEffect } from "react";
import { Switch, Route } from "wouter";
import { queryClient, getQueryFn } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/dashboard";
import TapToEarn from "@/pages/tap-to-earn";
import PricePrediction from "@/pages/price-prediction";
import LuckyWheel from "@/pages/lucky-wheel";
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
      <Route path="/predict" component={PricePrediction} />
      <Route path="/wheel" component={LuckyWheel} />
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

function AuthenticatedApp() {
  const { data: user, isLoading } = useQuery<User | null>({
    queryKey: ["/api/user"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  const [loggedIn, setLoggedIn] = useState(false);

  useEffect(() => {
    if (user) setLoggedIn(true);
  }, [user]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-3">
          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 mx-auto animate-pulse" />
          <p className="text-sm text-muted-foreground">Loading...</p>
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
