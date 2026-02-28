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
      <div className="h-[2px] w-full" style={{ background: "linear-gradient(90deg, transparent 5%, rgba(245,158,11,0.4) 30%, rgba(245,158,11,0.6) 50%, rgba(245,158,11,0.4) 70%, transparent 95%)" }} />
      <div
        className="flex items-center justify-around"
        style={{
          background: "linear-gradient(180deg, rgba(18,16,22,0.98) 0%, rgba(8,8,12,1) 100%)",
          borderTop: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        {tabs.map((tab) => {
          const isActive = location === tab.path;
          return (
            <Link
              key={tab.path}
              href={tab.path}
              data-testid={`tab-${tab.label.toLowerCase()}`}
              className={`flex flex-1 flex-col items-center gap-1.5 py-3.5 text-[10px] font-extrabold tracking-[0.1em] transition-all ${
                isActive
                  ? "text-amber-400"
                  : "text-white/30 hover:text-white/50"
              }`}
            >
              <div className="relative">
                <tab.icon
                  className={`h-6 w-6 ${isActive ? "" : ""}`}
                  style={isActive ? {
                    filter: "drop-shadow(0 0 8px rgba(245,158,11,0.6)) drop-shadow(0 0 16px rgba(245,158,11,0.3))",
                  } : undefined}
                />
                {isActive && (
                  <div
                    className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-amber-400"
                    style={{ boxShadow: "0 0 6px rgba(245,158,11,0.8)" }}
                  />
                )}
              </div>
              <span>{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
