import type { LucideIcon } from "lucide-react";
import { BriefcaseBusiness, Clapperboard, Clock3, Database, Gauge, Tv, WalletCards, Zap } from "lucide-react";
import { clsx } from "clsx";

export interface KpiItem {
  label: string;
  value: string;
  detail?: string;
  tone?: "default" | "good" | "warning" | "danger" | "active";
}

export interface KpiBarProps {
  items?: KpiItem[];
}

const defaultItems: KpiItem[] = [
  { label: "Instances", value: "2", detail: "connected", tone: "good" },
  { label: "Search Budget", value: "417 / 2000", detail: "rolling 24h", tone: "active" },
  { label: "Grab Budget", value: "61 / 400", detail: "rolling 24h", tone: "warning" },
  { label: "Active Jobs", value: "1", detail: "running", tone: "active" },
  { label: "Queued Jobs", value: "3", detail: "waiting", tone: "default" },
  { label: "Last Analysis", value: "22:01", detail: "today", tone: "default" },
];

type Tone = NonNullable<KpiItem["tone"]>;

const accentText: Record<Tone, string> = {
  active: "text-signal-cyan",
  good: "text-signal-green",
  warning: "text-signal-amber",
  danger: "text-signal-red",
  default: "text-ink-500",
};

const accentChip: Record<Tone, string> = {
  active: "bg-signal-cyan/[0.10] text-signal-cyan",
  good: "bg-signal-green/[0.10] text-signal-green",
  warning: "bg-signal-amber/[0.10] text-signal-amber",
  danger: "bg-signal-red/[0.10] text-signal-red",
  default: "bg-white/[0.04] text-ink-500",
};

const meterBar: Record<Tone, string> = {
  active: "bg-signal-cyan",
  good: "bg-signal-green",
  warning: "bg-signal-amber",
  danger: "bg-signal-red",
  default: "bg-ink-600",
};

export function KpiBar({ items = defaultItems }: KpiBarProps) {
  return (
    <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5 2xl:grid-cols-9">
      {items.map((item) => (
        <KpiTile item={item} key={item.label} />
      ))}
    </div>
  );
}

function KpiTile({ item }: { item: KpiItem }) {
  const tone = item.tone ?? "default";
  const Icon = iconForKpi(item.label);
  const meter = meterForValue(item.value);

  return (
    <div className="group flex min-h-[78px] min-w-0 flex-col justify-between gap-2 rounded-lg bg-ink-900/80 p-2.5 shadow-surface transition-[background-color,box-shadow] duration-150 ease-out hover:bg-ink-850 hover:shadow-surface-hover">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-500">{item.label}</span>
        <span className={clsx("grid h-6 w-6 shrink-0 place-items-center rounded-md", accentChip[tone])}>
          <Icon aria-hidden="true" className="h-3.5 w-3.5" />
        </span>
      </div>
      <div className="truncate text-lg font-semibold leading-none tabular-nums text-white">{item.value}</div>
      <div className="flex min-h-[12px] items-center justify-between gap-2">
        {item.detail ? <span className="truncate text-[11px] text-ink-500">{item.detail}</span> : <span />}
        {meter !== undefined ? (
          <span className="h-1 w-12 shrink-0 overflow-hidden rounded-full bg-white/[0.06]">
            <span className={clsx("block h-full rounded-full", meterBar[tone])} style={{ width: `${meter}%` }} />
          </span>
        ) : (
          <span aria-hidden="true" className={clsx("h-1.5 w-1.5 shrink-0 rounded-full", accentText[tone], "bg-current opacity-70")} />
        )}
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
  if (lower.includes("grab")) return Zap;
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
