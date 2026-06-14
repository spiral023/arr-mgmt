import type { LucideIcon } from "lucide-react";
import { BarChart3, BriefcaseBusiness, Clapperboard, Gauge, LineChart, Settings, Tv } from "lucide-react";
import { clsx } from "clsx";

export type AppTabId = "dashboard" | "sonarr" | "radarr" | "stats" | "jobs" | "quotas" | "settings";

export interface AppTab {
  id: AppTabId;
  label: string;
  icon: LucideIcon;
}

const APP_TABS: AppTab[] = [
  { id: "dashboard", label: "Dashboard", icon: Gauge },
  { id: "sonarr", label: "Sonarr", icon: Tv },
  { id: "radarr", label: "Radarr", icon: Clapperboard },
  { id: "stats", label: "Stats", icon: LineChart },
  { id: "jobs", label: "Jobs", icon: BriefcaseBusiness },
  { id: "quotas", label: "Quotas", icon: BarChart3 },
  { id: "settings", label: "Settings", icon: Settings },
];

export interface TabNavProps {
  activeTab: AppTabId;
  onTabChange: (tab: AppTabId) => void;
  tabs?: AppTab[];
}

export function TabNav({ activeTab, onTabChange, tabs = APP_TABS }: TabNavProps) {
  return (
    <nav aria-label="Primary" className="flex gap-1 overflow-x-auto px-3 pb-3">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = tab.id === activeTab;

        return (
          <button
            aria-current={isActive ? "page" : undefined}
            className={clsx(
              "inline-flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm font-semibold outline-none",
              "transition-[background-color,color,box-shadow,transform] duration-150 ease-out active:scale-[0.96]",
              "focus-visible:border-signal-cyan focus-visible:ring-2 focus-visible:ring-signal-cyan/30",
              isActive
                ? "bg-signal-cyan/[0.12] text-white shadow-[0_0_0_1px_rgba(94,200,216,0.30),inset_0_-2px_0_rgba(94,200,216,0.72)]"
                : "text-ink-400 hover:bg-white/[0.05] hover:text-ink-200 hover:shadow-[0_0_0_1px_rgba(255,255,255,0.08)]",
            )}
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            type="button"
          >
            <Icon aria-hidden="true" className="h-4 w-4" />
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}
