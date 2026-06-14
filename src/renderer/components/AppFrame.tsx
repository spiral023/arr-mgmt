import type { ReactNode } from "react";
import { Database } from "lucide-react";
import { clsx } from "clsx";
import { CommandBar } from "./CommandBar";
import type { KpiItem } from "./KpiBar";
import { KpiBar } from "./KpiBar";
import type { AppTabId } from "./TabNav";
import { TabNav } from "./TabNav";

export interface AppFrameProps {
  activeTab: AppTabId;
  children: ReactNode;
  kpis?: KpiItem[];
  schedulerPaused?: boolean;
  onAnalyzeRadarr?: () => void;
  onAnalyzeSonarr?: () => void;
  onGrabRadarr?: () => void;
  onGrabSonarr?: () => void;
  onPauseScheduler?: () => void;
  onQuickSample?: () => void;
  onSearchRadarr?: () => void;
  onSearchSonarr?: () => void;
  onTabChange: (tab: AppTabId) => void;
}

export function AppFrame({
  activeTab,
  children,
  kpis,
  schedulerPaused,
  onAnalyzeRadarr,
  onAnalyzeSonarr,
  onGrabRadarr,
  onGrabSonarr,
  onPauseScheduler,
  onQuickSample,
  onSearchRadarr,
  onSearchSonarr,
  onTabChange,
}: AppFrameProps) {
  return (
    <main className="min-h-screen text-ink-200 antialiased">
      <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-ink-950/85 shadow-[0_18px_40px_-28px_rgba(0,0,0,0.9)] backdrop-blur-xl">
        <div className="mx-auto max-w-[1680px] px-5">
          {/* Band 1 — brand + live status */}
          <div className="flex items-center justify-between gap-4 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-signal-cyan/[0.10] text-signal-cyan shadow-[inset_0_0_0_1px_rgba(86,184,207,0.22)]">
                <Database aria-hidden="true" className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h1 className="truncate text-[18px] font-semibold leading-tight text-white">ARR Ops</h1>
                <p className="truncate text-xs text-ink-500">Library coverage, quota control &amp; scheduled release operations</p>
              </div>
            </div>
            <LiveBadge paused={schedulerPaused} />
          </div>

          {/* Band 2 — KPI metric bar */}
          <div className="pb-3">
            <KpiBar items={kpis} />
          </div>

          {/* Band 3 — navigation (left) + global command actions (right) */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.06] py-2">
            <TabNav activeTab={activeTab} onTabChange={onTabChange} />
            <CommandBar
              onAnalyzeRadarr={onAnalyzeRadarr}
              onAnalyzeSonarr={onAnalyzeSonarr}
              onGrabRadarr={onGrabRadarr}
              onGrabSonarr={onGrabSonarr}
              onPauseScheduler={onPauseScheduler}
              onQuickSample={onQuickSample}
              onSearchRadarr={onSearchRadarr}
              onSearchSonarr={onSearchSonarr}
              schedulerPaused={schedulerPaused}
            />
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1680px] px-5 py-5">
        <div className="flex flex-col gap-4">{children}</div>
      </div>
    </main>
  );
}

function LiveBadge({ paused }: { paused?: boolean }) {
  return (
    <span
      className={clsx(
        "hidden h-8 shrink-0 items-center gap-2 rounded-full border px-3 text-[11px] font-semibold uppercase tracking-[0.08em] md:inline-flex",
        paused ? "border-signal-amber/25 bg-signal-amber/[0.08] text-signal-amber" : "border-signal-green/25 bg-signal-green/[0.08] text-signal-green",
      )}
      title={paused ? "Scheduler paused" : "Scheduler running"}
    >
      <span aria-hidden="true" className={clsx("h-1.5 w-1.5 rounded-full", paused ? "bg-signal-amber" : "bg-signal-green animate-pulse-dot")} />
      {paused ? "Paused" : "Live"}
    </span>
  );
}
