import { useState, useEffect, useRef, useCallback } from "react";
import { Switch, Route } from "wouter";
import { queryClient, getQueryFn } from "./lib/queryClient";
import { QueryClientProvider, useQuery, useMutation } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { Zap, ShieldAlert, LogIn } from "lucide-react";
import { SiTelegram } from "react-icons/si";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/dashboard";
import TapToEarn from "@/pages/tap-to-earn";
import Leaderboard from "@/pages/leaderboard";
import WalletPage from "@/pages/wallet";
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

function GuestLanding({ onLogin }: { onLogin: () => void }) {
  const [showLogin, setShowLogin] = useState(false);
  const { toast } = useToast();

  const telegramAuthMutation = useMutation({
    mutationFn: async (data: { widgetData: Record<string, string> }) => {
      const res = apiRequest("POST", "/api/auth/telegram", data);
      return (await res).json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      onLogin();
    },
    onError: (error: Error) => {
      toast({
        title: "Authentication failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleTelegramWidgetAuth = useCallback((user: any) => {
    const widgetData: Record<string, string> = {};
    for (const key of Object.keys(user)) {
      widgetData[key] = String(user[key]);
    }
    telegramAuthMutation.mutate({ widgetData });
  }, []);

  useEffect(() => {
    (window as any).onTelegramAuth = handleTelegramWidgetAuth;
    return () => { delete (window as any).onTelegramAuth; };
  }, [handleTelegramWidgetAuth]);

  const openTelegramLogin = useCallback(() => {
    setShowLogin(true);
    setTimeout(() => {
      const container = document.getElementById("guest-telegram-login");
      if (!container) return;
      container.innerHTML = "";
      const script = document.createElement("script");
      script.src = "https://telegram.org/js/telegram-widget.js?22";
      script.setAttribute("data-telegram-login", "Vault60Bot");
      script.setAttribute("data-size", "large");
      script.setAttribute("data-radius", "8");
      script.setAttribute("data-onauth", "onTelegramAuth(user)");
      script.setAttribute("data-request-access", "write");
      script.setAttribute("data-auth-url", window.location.origin);
      script.async = true;
      container.appendChild(script);
    }, 50);
  }, []);

  return (
    <div className="relative min-h-screen bg-background">
      <div className="absolute top-3 right-3 z-50">
        <Button
          size="sm"
          variant="outline"
          className="gap-2"
          onClick={openTelegramLogin}
          data-testid="button-guest-login"
        >
          <SiTelegram className="h-4 w-4" />
          <span className="hidden sm:inline">Sign in</span>
          <LogIn className="h-4 w-4 sm:hidden" />
        </Button>
      </div>

      {showLogin && (
        <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setShowLogin(false)}>
          <div className="bg-card border rounded-lg p-6 space-y-4 max-w-sm w-full shadow-lg" onClick={(e) => e.stopPropagation()}>
            <div className="text-center space-y-1">
              <h2 className="text-lg font-semibold">Sign in to Volt60</h2>
              <p className="text-sm text-muted-foreground">Save your progress and earn real rewards</p>
            </div>
            <div id="guest-telegram-login" className="flex justify-center min-h-[44px]" data-testid="telegram-login-widget" />
            {telegramAuthMutation.isPending && (
              <p className="text-center text-sm text-muted-foreground">Authenticating...</p>
            )}
            <Button variant="ghost" className="w-full" onClick={() => setShowLogin(false)} data-testid="button-close-login">
              Continue as guest
            </Button>
          </div>
        </div>
      )}

      <TapToEarn guest />
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
    return <LoadingScreen message="Connecting to Volt60..." />;
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
    return <GuestLanding onLogin={() => setLoggedIn(true)} />;
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
