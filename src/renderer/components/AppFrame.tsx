import type { ReactNode } from "react";
import { Database, RadioTower } from "lucide-react";
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
    <main className="min-h-screen bg-ink-950 text-ink-200 antialiased">
      <div className="sticky top-0 z-40 bg-ink-950/96 shadow-[0_1px_0_rgba(255,255,255,0.08),0_18px_48px_rgba(0,0,0,0.38)] backdrop-blur">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-signal-green/10 text-signal-green shadow-[0_0_0_1px_rgba(85,217,121,0.24),0_10px_24px_rgba(0,0,0,0.26)]">
              <Database aria-hidden="true" className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-balance text-base font-semibold text-white">ARR Ops</h1>
              <p className="truncate text-pretty text-xs text-ink-400">Library coverage, quota control, and scheduled release operations</p>
            </div>
          </div>
          <div className="hidden min-h-10 items-center gap-2 rounded-lg bg-ink-900/75 px-3 py-2 text-xs text-ink-400 shadow-[0_0_0_1px_rgba(255,255,255,0.08)] md:flex">
            <RadioTower aria-hidden="true" className="h-4 w-4 text-signal-cyan" />
            <span className="tabular-nums">Live renderer shell</span>
          </div>
        </div>
        <KpiBar
          items={kpis}
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
        <TabNav activeTab={activeTab} onTabChange={onTabChange} />
      </div>

      <div className="px-4 py-4">
        <div className="mx-auto flex max-w-[1680px] flex-col gap-4">{children}</div>
      </div>
    </main>
  );
}
