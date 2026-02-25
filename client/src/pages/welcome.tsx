import { useState, useEffect, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Coins, ShieldAlert } from "lucide-react";
import { SiTelegram } from "react-icons/si";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData: string;
        initDataUnsafe: {
          user?: {
            id: number;
            first_name?: string;
            last_name?: string;
            username?: string;
            photo_url?: string;
          };
          start_param?: string;
        };
        ready: () => void;
        expand: () => void;
        close: () => void;
      };
    };
    onTelegramAuth?: (user: any) => void;
  }
}

export default function Welcome({ onLogin }: { onLogin: () => void }) {
  const [isMiniApp, setIsMiniApp] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [autoAuthAttempted, setAutoAuthAttempted] = useState(false);
  const { toast } = useToast();

  const telegramAuthMutation = useMutation({
    mutationFn: async (data: { initData?: string; widgetData?: any; referralCode?: string }) => {
      const res = await apiRequest("POST", "/api/auth/telegram", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      onLogin();
    },
    onError: (error: Error) => {
      setAuthError(error.message);
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
    const tg = window.Telegram?.WebApp;
    if (tg && tg.initData) {
      setIsMiniApp(true);
      tg.ready();
      tg.expand();

      const startParam = tg.initDataUnsafe?.start_param;

      if (!autoAuthAttempted) {
        setAutoAuthAttempted(true);
        telegramAuthMutation.mutate({
          initData: tg.initData,
          referralCode: startParam || undefined,
        });
      }
    }
  }, [autoAuthAttempted]);

  useEffect(() => {
    window.onTelegramAuth = handleTelegramWidgetAuth;
    return () => { delete window.onTelegramAuth; };
  }, [handleTelegramWidgetAuth]);

  const openTelegramLogin = useCallback(() => {
    const botUsername = "Vault60Bot";
    const origin = window.location.origin;
    const authUrl = `https://oauth.telegram.org/auth?bot_id=&scope=write&public_key=&nonce=&return_to=${encodeURIComponent(origin)}`;

    const width = 550;
    const height = 470;
    const left = Math.max(0, (window.screen.width - width) / 2);
    const top = Math.max(0, (window.screen.height - height) / 2);

    const container = document.getElementById("telegram-login-container");
    if (!container) return;
    container.innerHTML = "";

    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.setAttribute("data-telegram-login", botUsername);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-radius", "8");
    script.setAttribute("data-onauth", "onTelegramAuth(user)");
    script.setAttribute("data-request-access", "write");
    script.setAttribute("data-auth-url", origin);
    script.async = true;
    container.appendChild(script);

    script.onload = () => {
      setTimeout(() => {
        const iframe = container.querySelector("iframe");
        if (iframe) {
          iframe.style.width = "100%";
          iframe.style.height = "44px";
          iframe.style.border = "none";
          iframe.style.overflow = "hidden";
          iframe.style.colorScheme = "auto";
        }
      }, 500);
    };
  }, []);

  if (isMiniApp) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-background">
        <div className="text-center space-y-4">
          <div className="mx-auto w-20 h-20 rounded-full bg-gradient-to-br from-amber-400 via-yellow-500 to-orange-500 flex items-center justify-center animate-pulse"
            style={{ boxShadow: "0 0 40px rgba(245, 158, 11, 0.3)" }}
          >
            <Coins className="h-10 w-10 text-amber-900/70" />
          </div>
          {authError ? (
            <div className="space-y-3">
              <ShieldAlert className="h-8 w-8 mx-auto text-destructive" />
              <p className="text-sm text-destructive font-medium">{authError}</p>
              <Button
                onClick={() => {
                  setAuthError(null);
                  setAutoAuthAttempted(false);
                }}
                data-testid="button-retry-auth"
              >
                Try Again
              </Button>
            </div>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">Connecting to Vault60...</p>
              {telegramAuthMutation.isPending && (
                <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto" />
              )}
            </>
          )}
        </div>
      </div>
    );
  }

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
            Vault60
          </h1>
          <p className="text-muted-foreground text-sm">
            Tap to earn. Rewards every day.
          </p>
        </div>

        <div className="flex justify-center">
          <Card>
            <CardContent className="p-3 text-center space-y-1 px-8">
              <Coins className="h-5 w-5 mx-auto text-amber-500" />
              <p className="text-xs text-muted-foreground">Tap & Earn</p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardContent className="p-5 space-y-4">
            <div id="telegram-login-container" className="flex justify-center [&:empty]:hidden" data-testid="telegram-login-widget" />

            <Button
              className="w-full"
              onClick={openTelegramLogin}
              variant="outline"
              data-testid="button-load-telegram-login"
            >
              <SiTelegram className="h-4 w-4 mr-2" />
              Sign in with Telegram
            </Button>

            {authError && (
              <p className="text-xs text-destructive text-center">{authError}</p>
            )}

            {telegramAuthMutation.isPending && (
              <p className="text-center text-sm text-muted-foreground">Authenticating...</p>
            )}
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          Sign in securely with your Telegram account.
        </p>
      </div>
    </div>
  );
}
