import { useState, useRef, useEffect, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Coins, TrendingUp, CircleDot, Sparkles, Mail, ArrowLeft, ShieldCheck } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export default function Welcome({ onLogin }: { onLogin: () => void }) {
  const [step, setStep] = useState<"email" | "otp">("email");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [referralCode, setReferralCode] = useState("");
  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const { toast } = useToast();

  const sendOtpMutation = useMutation({
    mutationFn: async (emailAddr: string) => {
      const res = await apiRequest("POST", "/api/send-otp", { email: emailAddr });
      return res.json();
    },
    onSuccess: () => {
      setStep("otp");
      toast({
        title: "Code sent",
        description: "Check your email for the 6-digit code.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to send code",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const verifyOtpMutation = useMutation({
    mutationFn: async (data: { email: string; code: string; username: string; referralCode?: string }) => {
      const res = await apiRequest("POST", "/api/verify-otp", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      onLogin();
    },
    onError: (error: Error) => {
      toast({
        title: "Verification failed",
        description: error.message,
        variant: "destructive",
      });
      setOtp(["", "", "", "", "", ""]);
      inputRefs.current[0]?.focus();
    },
  });

  const handleEmailSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;
    sendOtpMutation.mutate(trimmed);
  };

  const handleOtpChange = (index: number, value: string) => {
    if (value.length > 1) {
      const digits = value.replace(/\D/g, "").slice(0, 6).split("");
      setOtp(prev => {
        const newOtp = [...prev];
        digits.forEach((d, i) => {
          if (index + i < 6) newOtp[index + i] = d;
        });
        return newOtp;
      });
      const nextIndex = Math.min(index + digits.length, 5);
      inputRefs.current[nextIndex]?.focus();
      return;
    }

    if (!/^\d*$/.test(value)) return;
    setOtp(prev => {
      const newOtp = [...prev];
      newOtp[index] = value;
      return newOtp;
    });

    if (value && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !otp[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const submitOtpRef = useRef(false);

  useEffect(() => {
    const code = otp.join("");
    if (code.length === 6 && !submitOtpRef.current) {
      submitOtpRef.current = true;
      verifyOtpMutation.mutate(
        { email: email.trim().toLowerCase(), code, username: username.trim(), referralCode: referralCode.trim().toUpperCase() || undefined },
        { onSettled: () => { submitOtpRef.current = false; } }
      );
    }
  }, [otp]);

  useEffect(() => {
    if (step === "otp") {
      inputRefs.current[0]?.focus();
    }
  }, [step]);

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

        {step === "email" ? (
          <Card>
            <CardContent className="p-5">
              <form onSubmit={handleEmailSubmit} className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Your email address</label>
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    data-testid="input-email"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Choose a display name</label>
                  <Input
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Optional nickname"
                    maxLength={20}
                    data-testid="input-username"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Referral code <span className="text-muted-foreground font-normal">(optional)</span></label>
                  <Input
                    value={referralCode}
                    onChange={(e) => setReferralCode(e.target.value.toUpperCase())}
                    placeholder="e.g. REF12ABC"
                    maxLength={20}
                    data-testid="input-referral-code"
                  />
                </div>
                <Button
                  type="submit"
                  className="w-full"
                  disabled={!email.trim() || sendOtpMutation.isPending}
                  data-testid="button-send-otp"
                >
                  <Mail className="h-4 w-4 mr-2" />
                  {sendOtpMutation.isPending ? "Sending code..." : "Send Login Code"}
                </Button>
              </form>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-5 space-y-5">
              <div className="space-y-1">
                <button
                  type="button"
                  onClick={() => { setStep("email"); setOtp(["", "", "", "", "", ""]); }}
                  className="flex items-center gap-1 text-sm text-muted-foreground hover-elevate rounded-md px-1"
                  data-testid="button-back-to-email"
                >
                  <ArrowLeft className="h-3 w-3" />
                  Back
                </button>
              </div>
              <div className="text-center space-y-1">
                <ShieldCheck className="h-8 w-8 mx-auto text-amber-500" />
                <p className="text-sm font-medium">Enter verification code</p>
                <p className="text-xs text-muted-foreground">
                  Sent to {email.trim().toLowerCase()}
                </p>
              </div>

              <div className="flex justify-center gap-2" data-testid="otp-inputs">
                {otp.map((digit, i) => (
                  <Input
                    key={i}
                    ref={(el) => { inputRefs.current[i] = el; }}
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={digit}
                    onChange={(e) => handleOtpChange(i, e.target.value)}
                    onKeyDown={(e) => handleOtpKeyDown(i, e)}
                    className="w-11 h-12 text-center text-lg font-bold"
                    data-testid={`input-otp-${i}`}
                    disabled={verifyOtpMutation.isPending}
                  />
                ))}
              </div>

              {verifyOtpMutation.isPending && (
                <p className="text-center text-sm text-muted-foreground">Verifying...</p>
              )}

              <div className="text-center">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => sendOtpMutation.mutate(email.trim())}
                  disabled={sendOtpMutation.isPending}
                  data-testid="button-resend-otp"
                >
                  {sendOtpMutation.isPending ? "Sending..." : "Resend code"}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <p className="text-center text-xs text-muted-foreground">
          We'll send a one-time code to verify your email.
        </p>
      </div>
    </div>
  );
}
