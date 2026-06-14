import type { LucideIcon } from "lucide-react";
import { Activity, BriefcaseBusiness, Clapperboard, Clock3, Database, Gauge, Pause, Play, Radar, Search, Tv, WalletCards, Zap } from "lucide-react";
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

const valueClasses: Record<NonNullable<KpiItem["tone"]>, string> = {
  active: "text-signal-cyan shadow-[inset_0_-2px_0_rgba(94,200,216,0.75)]",
  danger: "text-signal-red shadow-[inset_0_-2px_0_rgba(244,107,107,0.75)]",
  default: "text-ink-200 shadow-[inset_0_-2px_0_rgba(255,255,255,0.18)]",
  good: "text-signal-green shadow-[inset_0_-2px_0_rgba(85,217,121,0.75)]",
  warning: "text-signal-amber shadow-[inset_0_-2px_0_rgba(244,189,80,0.75)]",
};

const iconClasses: Record<NonNullable<KpiItem["tone"]>, string> = {
  active: "bg-signal-cyan/10 text-signal-cyan shadow-[0_0_0_1px_rgba(94,200,216,0.24)]",
  danger: "bg-signal-red/10 text-signal-red shadow-[0_0_0_1px_rgba(244,107,107,0.24)]",
  default: "bg-white/[0.04] text-ink-400 shadow-[0_0_0_1px_rgba(255,255,255,0.08)]",
  good: "bg-signal-green/10 text-signal-green shadow-[0_0_0_1px_rgba(85,217,121,0.24)]",
  warning: "bg-signal-amber/10 text-signal-amber shadow-[0_0_0_1px_rgba(244,189,80,0.24)]",
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
    <div className="grid gap-3 px-4 py-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-stretch">
      <div className="grid min-w-0 grid-cols-2 gap-2 md:grid-cols-4 2xl:grid-cols-8">
        {items.map((item) => (
          <KpiTile item={item} key={item.label} />
        ))}
      </div>

      <div className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg bg-ink-900/70 p-2 shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_12px_30px_rgba(0,0,0,0.22)] xl:justify-end">
        <div className="mr-1 hidden min-w-0 px-2 xl:block">
          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-400">Command</div>
          <div className="text-xs text-ink-200">Library operations</div>
        </div>
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
        <IconButton icon={schedulerPaused ? Play : Pause} label={schedulerPaused ? "Resume scheduler" : "Pause scheduler"} onClick={onPauseScheduler}>
          {schedulerPaused ? "Resume" : "Pause"}
        </IconButton>
      </div>
    </div>
  );
}

function KpiTile({ item }: { item: KpiItem }) {
  const tone = item.tone ?? "default";
  const Icon = iconForKpi(item.label);
  const meter = meterForValue(item.value);

  return (
    <div className="group min-w-0 rounded-lg bg-ink-900/72 p-2 shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_10px_22px_rgba(0,0,0,0.18)] transition-[background-color,box-shadow,transform] duration-150 ease-out hover:bg-ink-850/85 hover:shadow-[0_0_0_1px_rgba(255,255,255,0.13),0_14px_30px_rgba(0,0,0,0.24)]">
      <div className="flex min-w-0 items-center gap-2">
        <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${iconClasses[tone]}`}>
          <Icon aria-hidden="true" className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-400">{item.label}</div>
          <div className={`mt-0.5 truncate px-0.5 pb-1 text-base font-semibold tabular-nums ${valueClasses[tone]}`}>{item.value}</div>
        </div>
      </div>
      <div className="mt-2 flex min-h-4 items-center justify-between gap-2">
        {item.detail ? <div className="truncate text-xs text-ink-400">{item.detail}</div> : <span />}
        {meter ? (
          <div className="h-1 w-16 overflow-hidden rounded-full bg-white/[0.07]">
            <div className={meterClass(tone)} style={{ width: `${meter}%` }} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function iconForKpi(label: string): LucideIcon {
  const lower = label.toLowerCase();
  if (lower.includes("series")) return Tv;
  if (lower.includes("movie")) return Clapperboard;
  if (lower.includes("budget")) return WalletCards;
  if (lower.includes("job")) return BriefcaseBusiness;
  if (lower.includes("analysis")) return Clock3;
  if (lower.includes("fun")) return Gauge;
  return Database;
}

function meterForValue(value: string): number | undefined {
  const match = value.match(/(\d+)\s*\/\s*(\d+)/);
  if (!match) return undefined;
  const current = Number(match[1]);
  const total = Number(match[2]);
  if (!Number.isFinite(current) || !Number.isFinite(total) || total <= 0) return undefined;
  return Math.max(0, Math.min(100, Math.round((current / total) * 100)));
}

function meterClass(tone: NonNullable<KpiItem["tone"]>) {
  if (tone === "good") return "h-full rounded-full bg-signal-green";
  if (tone === "warning") return "h-full rounded-full bg-signal-amber";
  if (tone === "danger") return "h-full rounded-full bg-signal-red";
  if (tone === "active") return "h-full rounded-full bg-signal-cyan";
  return "h-full rounded-full bg-ink-400";
}
