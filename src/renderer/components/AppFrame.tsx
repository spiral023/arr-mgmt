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
  onAnalyze?: () => void;
  onGrab?: () => void;
  onPauseScheduler?: () => void;
  onSearch?: () => void;
  onTabChange: (tab: AppTabId) => void;
}

export function AppFrame({
  activeTab,
  children,
  kpis,
  schedulerPaused,
  onAnalyze,
  onGrab,
  onPauseScheduler,
  onSearch,
  onTabChange,
}: AppFrameProps) {
  return (
    <main className="min-h-screen bg-ink-950 text-ink-200 antialiased">
      <div className="sticky top-0 z-40 border-b border-white/10 bg-ink-950/95 shadow-[0_18px_48px_rgba(0,0,0,0.38)] backdrop-blur">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-md border border-signal-green/30 bg-signal-green/10 text-signal-green shadow-surface">
              <Database aria-hidden="true" className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold text-white">ARR Ops</h1>
              <p className="truncate text-xs text-ink-400">Library coverage, quota control, and scheduled release operations</p>
            </div>
          </div>
          <div className="hidden items-center gap-2 rounded-md border border-white/10 bg-ink-900/75 px-3 py-2 text-xs text-ink-400 shadow-surface md:flex">
            <RadioTower aria-hidden="true" className="h-4 w-4 text-signal-cyan" />
            <span className="tabular-nums">Live renderer shell</span>
          </div>
        </div>
        <KpiBar
          items={kpis}
          onAnalyze={onAnalyze}
          onGrab={onGrab}
          onPauseScheduler={onPauseScheduler}
          onSearch={onSearch}
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
