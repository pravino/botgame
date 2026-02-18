import { useLocation, Link } from "wouter";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { LayoutDashboard, Coins, TrendingUp, CircleDot, Trophy, Wallet, Crown } from "lucide-react";
import type { User } from "@shared/schema";
import { formatNumber } from "@/lib/game-utils";

const navItems = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Tap to Earn", url: "/tap", icon: Coins },
  { title: "Predict", url: "/predict", icon: TrendingUp },
  { title: "Lucky Wheel", url: "/wheel", icon: CircleDot },
  { title: "Wallet", url: "/wallet", icon: Wallet },
  { title: "Subscription", url: "/subscription", icon: Crown },
  { title: "Leaderboard", url: "/leaderboard", icon: Trophy },
];

export function AppSidebar({ user }: { user?: User }) {
  const [location] = useLocation();

  return (
    <Sidebar>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>
            <div className="flex items-center gap-2">
              <Coins className="h-4 w-4 text-primary" />
              <span>Crypto Games</span>
            </div>
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={location === item.url}
                  >
                    <Link href={item.url} data-testid={`nav-${item.title.toLowerCase().replace(/\s/g, "-")}`}>
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      {user && (
        <SidebarFooter>
          <div className="flex items-center gap-3 p-2">
            <Avatar className="h-8 w-8">
              <AvatarFallback className="bg-primary/10 text-primary text-xs">
                {user.username.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{user.username}</p>
              <p className="text-xs text-muted-foreground">{formatNumber(user.totalCoins)} coins</p>
            </div>
          </div>
        </SidebarFooter>
      )}
    </Sidebar>
  );
}
