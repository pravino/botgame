import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Coins } from "lucide-react";

const CHALLENGE_DURATION_MS = 6000;
const REQUIRED_HITS = 3;
const MOVE_INTERVAL_MS = 900;
const COIN_SIZE = 64;
const ARENA_WIDTH = 280;
const ARENA_HEIGHT = 320;

function getRandomPosition() {
  return {
    x: Math.random() * (ARENA_WIDTH - COIN_SIZE),
    y: Math.random() * (ARENA_HEIGHT - COIN_SIZE),
  };
}

interface ChallengeOverlayProps {
  onResolved: (passed: boolean) => void;
}

export function ChallengeOverlay({ onResolved }: ChallengeOverlayProps) {
  const [hits, setHits] = useState(0);
  const [position, setPosition] = useState(getRandomPosition);
  const [timeLeft, setTimeLeft] = useState(CHALLENGE_DURATION_MS);
  const [resultMessage, setResultMessage] = useState("");
  const [showResult, setShowResult] = useState(false);
  const startTimeRef = useRef(Date.now());
  const resolvedRef = useRef(false);
  const { toast } = useToast();

  useEffect(() => {
    const interval = setInterval(() => {
      if (!resolvedRef.current) {
        setPosition(getRandomPosition());
      }
    }, MOVE_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      if (resolvedRef.current) {
        clearInterval(timer);
        return;
      }
      const elapsed = Date.now() - startTimeRef.current;
      const remaining = Math.max(0, CHALLENGE_DURATION_MS - elapsed);
      setTimeLeft(remaining);

      if (remaining <= 0) {
        clearInterval(timer);
        doResolve(false);
      }
    }, 100);
    return () => clearInterval(timer);
  }, []);

  const doResolve = useCallback(async (passed: boolean) => {
    if (resolvedRef.current) return;
    resolvedRef.current = true;
    setShowResult(true);

    try {
      const res = await apiRequest("POST", "/api/challenge/resolve", { passed });
      const data = await res.json();

      if (passed) {
        setResultMessage(data.energyBonus
          ? `Challenge passed! +${data.energyBonus} bonus energy!`
          : "Challenge passed! Keep tapping!");
        toast({ title: "Bonus Round Complete!", description: data.message });
      } else {
        setResultMessage("Time's up! Tapping paused for 1 hour.");
        toast({ title: "Challenge Failed", description: data.message, variant: "destructive" });
      }

      queryClient.invalidateQueries({ queryKey: ["/api/user"] });

      setTimeout(() => {
        onResolved(passed);
      }, 1800);
    } catch {
      resolvedRef.current = false;
      setShowResult(false);
    }
  }, [onResolved, toast]);

  const handleCoinTap = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation();
    if (resolvedRef.current) return;

    setHits(prev => {
      const newHits = prev + 1;
      if (newHits >= REQUIRED_HITS) {
        doResolve(true);
      }
      return newHits;
    });
    setPosition(getRandomPosition());
  }, [doResolve]);

  const timeLeftSec = (timeLeft / 1000).toFixed(1);
  const progressPct = (hits / REQUIRED_HITS) * 100;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/85"
        data-testid="challenge-overlay"
      >
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 300, damping: 25 }}
          className="flex flex-col items-center gap-4 p-6 max-w-sm w-full"
        >
          <div className="text-center space-y-1">
            <h2 className="text-xl font-bold text-amber-400" data-testid="text-challenge-title">
              Catch the Golden Coin!
            </h2>
            <p className="text-sm text-gray-400">
              Prove you're human to continue earning.
            </p>
          </div>

          <div className="flex items-center justify-between gap-4 w-full px-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-gray-300" data-testid="text-challenge-hits">
                {hits} / {REQUIRED_HITS}
              </span>
              <div className="w-20 h-2 rounded-full bg-gray-700 overflow-hidden">
                <motion.div
                  className="h-full bg-amber-500 rounded-full"
                  animate={{ width: `${progressPct}%` }}
                  transition={{ duration: 0.2 }}
                />
              </div>
            </div>
            <span
              className={`text-sm font-mono font-medium ${timeLeft < 2000 ? "text-red-400" : "text-gray-300"}`}
              data-testid="text-challenge-timer"
            >
              {timeLeftSec}s
            </span>
          </div>

          <div
            className="relative rounded-md border border-gray-700/50 bg-gray-900/50"
            style={{ width: ARENA_WIDTH, height: ARENA_HEIGHT }}
            data-testid="challenge-arena"
          >
            {!showResult && (
              <motion.div
                animate={{ x: position.x, y: position.y }}
                transition={{ type: "spring", stiffness: 200, damping: 18, mass: 0.8 }}
                onMouseDown={handleCoinTap}
                onTouchStart={handleCoinTap}
                className="absolute cursor-pointer select-none touch-none"
                style={{ width: COIN_SIZE, height: COIN_SIZE }}
                data-testid="button-challenge-coin"
              >
                <div
                  className="w-full h-full rounded-full flex items-center justify-center bg-gradient-to-br from-yellow-300 via-amber-400 to-orange-500 border-2 border-yellow-200/60"
                  style={{
                    boxShadow: "0 0 20px rgba(245, 158, 11, 0.5), inset 0 2px 6px rgba(255,255,255,0.4), inset 0 -2px 6px rgba(0,0,0,0.2)",
                  }}
                >
                  <Coins className="w-7 h-7 text-amber-900/70" />
                </div>
              </motion.div>
            )}

            {showResult && (
              <motion.div
                initial={{ opacity: 0, scale: 0.5 }}
                animate={{ opacity: 1, scale: 1 }}
                className="absolute inset-0 flex items-center justify-center"
              >
                <p
                  className={`text-center text-sm font-medium px-4 ${hits >= REQUIRED_HITS ? "text-green-400" : "text-red-400"}`}
                  data-testid="text-challenge-result"
                >
                  {resultMessage}
                </p>
              </motion.div>
            )}
          </div>

          <p className="text-xs text-gray-500 text-center">
            Tap the bouncing coin {REQUIRED_HITS} times before the timer runs out
          </p>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
