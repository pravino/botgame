import { useLocation, Link } from "wouter";
import { Zap, BarChart3, Shield, DoorOpen } from "lucide-react";

const tabs = [
  { label: "GRID", path: "/tap", icon: Zap },
  { label: "DASHBOARD", path: "/", icon: BarChart3 },
  { label: "TIERS", path: "/leagues", icon: Shield },
  { label: "PORTAL", path: "/wallet", icon: DoorOpen },
];

export function BottomTabBar() {
  const [location] = useLocation();

  return (
    <nav
      className="sticky bottom-0 z-50"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      data-testid="bottom-tab-bar"
    >
      <div className="h-px w-full" style={{ background: "linear-gradient(90deg, transparent, rgba(245,158,11,0.3), transparent)" }} />
      <div className="flex items-center justify-around" style={{ background: "rgba(8,8,12,0.95)", backdropFilter: "blur(12px)" }}>
        {tabs.map((tab) => {
          const isActive = location === tab.path;
          return (
            <Link
              key={tab.path}
              href={tab.path}
              data-testid={`tab-${tab.label.toLowerCase()}`}
              className={`flex flex-1 flex-col items-center gap-1 py-3 text-[10px] font-bold tracking-wider transition-colors ${
                isActive
                  ? "text-amber-400"
                  : "text-white/35 hover:text-white/50"
              }`}
            >
              <tab.icon className={`h-6 w-6 ${isActive ? "drop-shadow-[0_0_8px_rgba(245,158,11,0.5)]" : ""}`} />
              <span>{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
