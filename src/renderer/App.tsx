import { useState } from "react";
import { AppFrame } from "./components/AppFrame";
import type { AppTabId } from "./components/TabNav";
import { DashboardView } from "./views/DashboardView";
import { JobsView } from "./views/JobsView";
import { QuotaView } from "./views/QuotaView";
import { RadarrMoviesView } from "./views/RadarrMoviesView";
import { SettingsView } from "./views/SettingsView";
import { SonarrSeriesView } from "./views/SonarrSeriesView";

export function App() {
  const [activeTab, setActiveTab] = useState<AppTabId>("dashboard");
  const [schedulerPaused, setSchedulerPaused] = useState(false);

  return (
    <AppFrame
      activeTab={activeTab}
      onAnalyze={() => setActiveTab("jobs")}
      onGrab={() => setActiveTab("jobs")}
      onPauseScheduler={() => setSchedulerPaused((paused) => !paused)}
      onSearch={() => setActiveTab("jobs")}
      onTabChange={setActiveTab}
      schedulerPaused={schedulerPaused}
    >
      {activeTab === "dashboard" ? <DashboardView /> : null}
      {activeTab === "sonarr" ? <SonarrSeriesView /> : null}
      {activeTab === "radarr" ? <RadarrMoviesView /> : null}
      {activeTab === "jobs" ? <JobsView /> : null}
      {activeTab === "quotas" ? <QuotaView /> : null}
      {activeTab === "settings" ? <SettingsView /> : null}
    </AppFrame>
  );
}
