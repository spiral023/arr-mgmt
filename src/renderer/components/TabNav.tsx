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
    <nav aria-label="Primary" className="flex min-w-0 items-center gap-0.5 overflow-x-auto">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = tab.id === activeTab;

        return (
          <button
            aria-current={isActive ? "page" : undefined}
            className={clsx(
              "group relative inline-flex h-9 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium outline-none",
              "transition-[background-color,color] duration-150 ease-out active:scale-[0.97]",
              "focus-visible:ring-2 focus-visible:ring-signal-cyan/40",
              isActive ? "text-white" : "text-ink-400 hover:bg-white/[0.04] hover:text-ink-200",
            )}
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            type="button"
          >
            <Icon
              aria-hidden="true"
              className={clsx("h-4 w-4 shrink-0 transition-colors duration-150", isActive ? "text-signal-cyan" : "text-ink-500 group-hover:text-ink-300")}
            />
            {tab.label}
            <span
              aria-hidden="true"
              className={clsx(
                "pointer-events-none absolute inset-x-2.5 -bottom-[7px] h-0.5 rounded-full bg-signal-cyan transition-opacity duration-150",
                isActive ? "opacity-100" : "opacity-0",
              )}
            />
          </button>
        );
      })}
    </nav>
  );
}
