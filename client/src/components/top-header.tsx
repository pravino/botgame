import { Zap, Menu, ChevronDown, Crown, Copy } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import type { User } from "@shared/schema";

const TIER_COLORS: Record<string, string> = {
  FREE: "text-cyan-400",
  BRONZE: "text-orange-400",
  SILVER: "text-yellow-400",
  GOLD: "text-purple-400",
};

const TIER_BORDER: Record<string, string> = {
  FREE: "border-cyan-500/40",
  BRONZE: "border-orange-500/40",
  SILVER: "border-yellow-500/40",
  GOLD: "border-purple-500/40",
};

interface TopHeaderProps {
  user: User;
  onMenuClick?: () => void;
}

export function TopHeader({ user, onMenuClick }: TopHeaderProps) {
  const { data: leaderboard } = useQuery<Array<{ id: number }>>({
    queryKey: ["/api/leaderboard", "coins"],
  });

  const tierColor = TIER_COLORS[user.tier] || TIER_COLORS.FREE;
  const tierBorder = TIER_BORDER[user.tier] || TIER_BORDER.FREE;
  const rank = leaderboard?.findIndex((u) => Number(u.id) === Number(user.id));
  const rankDisplay = rank !== undefined && rank >= 0 ? `#${rank + 1}` : "—";
  const initials = (user.telegramFirstName || user.username || "U").slice(0, 1).toUpperCase();

  return (
    <div className="w-full" style={{ background: "linear-gradient(180deg, rgba(0,0,0,0.4), transparent)" }} data-testid="top-header">
      <div className="flex items-center justify-between gap-2 px-3 py-2.5">
        <div className="flex items-center gap-1.5" data-testid="header-branding">
          <Zap className="h-5 w-5 text-amber-400 fill-amber-400" />
          <span className="font-black text-xl tracking-tight italic">
            <span className="text-amber-400">VOLT</span>
            <span className="text-white">60</span>
          </span>
        </div>

        <div className="flex items-center gap-2.5">
          <div
            className="flex items-center gap-1.5 bg-emerald-900/40 border border-emerald-700/40 rounded-full px-3 py-1.5"
            data-testid="header-balance"
          >
            <div className="w-4 h-4 rounded-full bg-emerald-500 flex items-center justify-center">
              <span className="text-[8px] font-black text-white">$</span>
            </div>
            <span className="text-sm font-bold text-emerald-400">
              {user.walletBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <span className="text-[9px] text-emerald-500/70 font-semibold">USDT</span>
            <ChevronDown className="h-3 w-3 text-emerald-500/50" />
          </div>

          <Avatar className={`h-9 w-9 border-2 ${tierBorder}`} data-testid="header-avatar">
            <AvatarImage src={user.telegramPhotoUrl || undefined} alt={user.username} />
            <AvatarFallback className="bg-white/10 text-white text-xs font-bold">
              {initials}
            </AvatarFallback>
          </Avatar>

          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 text-white/50 hover:text-white"
            data-testid="button-header-copy"
          >
            <Copy className="h-4 w-4" />
          </Button>

          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 text-white/50 hover:text-white"
            onClick={onMenuClick}
            data-testid="button-header-menu"
          >
            <Menu className="h-5 w-5" />
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 px-3 pb-2.5">
        <div className="flex items-center gap-1.5 min-w-0" data-testid="header-owner-info">
          <Crown className={`h-4 w-4 ${tierColor} flex-shrink-0`} />
          <span className="text-xs text-white/70">Grid Owner:</span>
          <span className="text-xs font-bold text-white truncate">
            {user.telegramFirstName || user.username}
          </span>
          <span className="text-white/20 mx-0.5">•</span>
        </div>

        <Badge
          variant="outline"
          className="text-[10px] font-bold gap-1 no-default-active-elevate flex-shrink-0 border-white/20 bg-white/5 text-white/70"
          data-testid="header-rank"
        >
          Rank
          <span className="text-amber-400 font-black">{rankDisplay}</span>
        </Badge>
      </div>

      <div className="h-px w-full" style={{ background: "linear-gradient(90deg, transparent, rgba(245,158,11,0.3), transparent)" }} />
    </div>
  );
}
