import { Activity, Clapperboard, Pause, Play, Radar, Search, Tv, Zap } from "lucide-react";
import { ActionMenu } from "./ActionMenu";
import { IconButton } from "./IconButton";

export interface KpiItem {
  label: string;
  value: string;
  detail?: string;
  tone?: "default" | "good" | "warning" | "danger" | "active";
}

export interface KpiBarProps {
  items?: KpiItem[];
  schedulerPaused?: boolean;
  onAnalyzeRadarr?: () => void;
  onAnalyzeSonarr?: () => void;
  onGrabRadarr?: () => void;
  onGrabSonarr?: () => void;
  onPauseScheduler?: () => void;
  onQuickSample?: () => void;
  onSearchRadarr?: () => void;
  onSearchSonarr?: () => void;
}

const defaultItems: KpiItem[] = [
  { label: "Instances", value: "2", detail: "connected", tone: "good" },
  { label: "Search Budget", value: "417 / 2000", detail: "rolling 24h", tone: "active" },
  { label: "Grab Budget", value: "61 / 400", detail: "rolling 24h", tone: "warning" },
  { label: "Active Jobs", value: "1", detail: "running", tone: "active" },
  { label: "Queued Jobs", value: "3", detail: "waiting", tone: "default" },
  { label: "Last Analysis", value: "22:01", detail: "today", tone: "default" },
];

const toneClasses: Record<NonNullable<KpiItem["tone"]>, string> = {
  active: "text-signal-cyan",
  danger: "text-signal-red",
  default: "text-ink-200",
  good: "text-signal-green",
  warning: "text-signal-amber",
};

export function KpiBar({
  items = defaultItems,
  schedulerPaused = false,
  onAnalyzeRadarr,
  onAnalyzeSonarr,
  onGrabRadarr,
  onGrabSonarr,
  onPauseScheduler,
  onQuickSample,
  onSearchRadarr,
  onSearchSonarr,
}: KpiBarProps) {
  return (
    <div className="flex flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
      <div className="grid min-w-0 flex-1 grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
        {items.map((item) => (
          <div className="rounded-md bg-ink-900/70 px-3 py-2 shadow-surface" key={item.label}>
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-400">{item.label}</div>
            <div className={`mt-1 text-lg font-semibold tabular-nums ${toneClasses[item.tone ?? "default"]}`}>
              {item.value}
            </div>
            {item.detail ? <div className="mt-0.5 truncate text-xs text-ink-400">{item.detail}</div> : null}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <ActionMenu
          icon={Radar}
          items={[
            { icon: Tv, label: "Analyze Sonarr", description: "Full library scan; can take a while", onClick: onAnalyzeSonarr, tone: "success" },
            { icon: Clapperboard, label: "Analyze Radarr", description: "Full movie scan; can take a while", onClick: onAnalyzeRadarr, tone: "success" },
            { icon: Activity, label: "Quick sample", description: "One Sonarr and one Radarr item", onClick: onQuickSample },
          ]}
          label="Analyze libraries"
          tone="success"
        />
        <ActionMenu
          icon={Search}
          items={[
            { icon: Tv, label: "Search Sonarr", description: "Use selected rows in Sonarr view", onClick: onSearchSonarr },
            { icon: Clapperboard, label: "Search Radarr", description: "Use selected rows in Radarr view", onClick: onSearchRadarr },
          ]}
          label="Search non-FuN items"
        />
        <ActionMenu
          icon={Zap}
          items={[
            { icon: Tv, label: "Grab Sonarr", description: "Grab pending Sonarr FuN* candidates", onClick: onGrabSonarr, tone: "warning" },
            { icon: Clapperboard, label: "Grab Radarr", description: "Grab pending Radarr FuN* candidates", onClick: onGrabRadarr, tone: "warning" },
          ]}
          label="Grab available FuN releases"
          tone="warning"
        />
        <IconButton
          icon={schedulerPaused ? Play : Pause}
          label={schedulerPaused ? "Resume scheduler" : "Pause scheduler"}
          onClick={onPauseScheduler}
        >
          {schedulerPaused ? "Resume" : "Pause"}
        </IconButton>
        <Activity aria-hidden="true" className="h-5 w-5 text-signal-cyan" />
      </div>
    </div>
  );
}
