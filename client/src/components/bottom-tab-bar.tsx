import { useLocation, Link } from "wouter";
import { Zap, BarChart3, Shield, DoorOpen } from "lucide-react";

const tabs = [
  { label: "Grid", path: "/tap", icon: Zap },
  { label: "Dashboard", path: "/", icon: BarChart3 },
  { label: "Tiers", path: "/leagues", icon: Shield },
  { label: "Portal", path: "/wallet", icon: DoorOpen },
];

export function BottomTabBar() {
  const [location] = useLocation();

  return (
    <nav
      className="sticky bottom-0 z-50 flex items-center justify-around border-t bg-card/95 backdrop-blur-md"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      data-testid="bottom-tab-bar"
    >
      {tabs.map((tab) => {
        const isActive = location === tab.path;
        return (
          <Link
            key={tab.path}
            href={tab.path}
            data-testid={`tab-${tab.label.toLowerCase()}`}
            className={`flex flex-1 flex-col items-center gap-1 py-2 text-xs font-medium transition-colors ${
              isActive
                ? "text-primary"
                : "text-muted-foreground"
            }`}
          >
            <tab.icon className={`h-5 w-5 ${isActive ? "drop-shadow-[0_0_6px_hsl(var(--primary)/0.5)]" : ""}`} />
            <span>{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
