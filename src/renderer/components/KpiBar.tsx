import { Activity, Pause, Play, Radar, Search, Zap } from "lucide-react";
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
  onAnalyze?: () => void;
  onGrab?: () => void;
  onPauseScheduler?: () => void;
  onSearch?: () => void;
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
  onAnalyze,
  onGrab,
  onPauseScheduler,
  onSearch,
}: KpiBarProps) {
  return (
    <div className="flex flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
      <div className="grid min-w-0 flex-1 grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        {items.map((item) => (
          <div className="rounded-md border border-white/10 bg-ink-900/70 px-3 py-2 shadow-surface" key={item.label}>
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-400">{item.label}</div>
            <div className={`mt-1 text-lg font-semibold tabular-nums ${toneClasses[item.tone ?? "default"]}`}>
              {item.value}
            </div>
            {item.detail ? <div className="mt-0.5 truncate text-xs text-ink-400">{item.detail}</div> : null}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <IconButton icon={Radar} label="Analyze libraries" onClick={onAnalyze} tone="success">
          Analyze
        </IconButton>
        <IconButton icon={Search} label="Search non-FuN items" onClick={onSearch}>
          Search
        </IconButton>
        <IconButton icon={Zap} label="Grab available FuN releases" onClick={onGrab} tone="warning">
          Grab
        </IconButton>
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
