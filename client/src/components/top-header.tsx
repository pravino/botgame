import { Zap, Menu, ChevronDown } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import type { User } from "@shared/schema";

const TIER_COLORS: Record<string, string> = {
  FREE: "text-amber-400",
  BRONZE: "text-orange-400",
  SILVER: "text-yellow-400",
  GOLD: "text-purple-400",
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
  const rank = leaderboard?.findIndex((u) => Number(u.id) === Number(user.id));
  const rankDisplay = rank !== undefined && rank >= 0 ? `#${rank + 1}` : "—";
  const initials = (user.telegramFirstName || user.username || "U").slice(0, 1).toUpperCase();

  return (
    <div className="w-full border-b border-border/40" data-testid="top-header">
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <div className="flex items-center gap-1.5" data-testid="header-branding">
          <Zap className="h-5 w-5 text-amber-400 fill-amber-400" />
          <span className="font-black text-lg tracking-tight">
            <span className="text-amber-400">VOLT</span>
            <span className="text-foreground">60</span>
          </span>
        </div>

        <div className="flex items-center gap-2">
          <div
            className="flex items-center gap-1.5 bg-emerald-900/40 border border-emerald-700/50 rounded-full px-3 py-1"
            data-testid="header-balance"
          >
            <div className="w-4 h-4 rounded-full bg-emerald-500 flex items-center justify-center">
              <span className="text-[9px] font-bold text-white">$</span>
            </div>
            <span className="text-sm font-semibold text-emerald-400">
              {user.walletBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <span className="text-[10px] text-emerald-500/80 font-medium">USDT</span>
            <ChevronDown className="h-3 w-3 text-emerald-500/60" />
          </div>

          <Avatar className="h-8 w-8 border border-amber-500/30" data-testid="header-avatar">
            <AvatarImage src={user.telegramPhotoUrl || undefined} alt={user.username} />
            <AvatarFallback className="bg-amber-900/30 text-amber-400 text-xs font-semibold">
              {initials}
            </AvatarFallback>
          </Avatar>

          {onMenuClick && (
            <Button
              size="icon"
              variant="ghost"
              onClick={onMenuClick}
              data-testid="button-header-menu"
            >
              <Menu className="h-5 w-5" />
            </Button>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 px-3 pb-2">
        <div className="flex items-center gap-1.5 min-w-0 flex-wrap" data-testid="header-owner-info">
          <Zap className={`h-3.5 w-3.5 ${tierColor} flex-shrink-0`} />
          <span className="text-xs text-muted-foreground truncate">
            {user.tier} Tier:
          </span>
          <span className="text-xs font-medium text-foreground truncate">
            {user.telegramFirstName || user.username}
          </span>
        </div>

        <Badge
          variant="secondary"
          className="text-[10px] font-semibold gap-1 no-default-active-elevate flex-shrink-0"
          data-testid="header-rank"
        >
          Rank
          <span className="text-amber-400">{rankDisplay}</span>
        </Badge>
      </div>
    </div>
  );
}
