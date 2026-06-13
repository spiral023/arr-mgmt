import { useEffect, useState } from "react";
import { AppFrame } from "./components/AppFrame";
import type { AppTabId } from "./components/TabNav";
import { analyzeSonarr, getSonarrRows } from "./state/ipc-client";
import { DashboardView } from "./views/DashboardView";
import { JobsView } from "./views/JobsView";
import { QuotaView } from "./views/QuotaView";
import { RadarrMoviesView } from "./views/RadarrMoviesView";
import { SettingsView } from "./views/SettingsView";
import { SonarrSeriesView } from "./views/SonarrSeriesView";
import type { SonarrSeriesTableRow } from "../shared/ipc-contracts";

export function App() {
  const [activeTab, setActiveTab] = useState<AppTabId>("dashboard");
  const [schedulerPaused, setSchedulerPaused] = useState(false);
  const [sonarrRows, setSonarrRows] = useState<SonarrSeriesTableRow[]>([]);
  const [sonarrStatus, setSonarrStatus] = useState("Ready");
  const [sonarrAnalyzing, setSonarrAnalyzing] = useState(false);

  useEffect(() => {
    void refreshSonarrRows();
  }, []);

  async function refreshSonarrRows() {
    const rows = await getSonarrRows();
    setSonarrRows(rows);
  }

  async function runSonarrAnalyze() {
    setActiveTab("sonarr");
    setSonarrAnalyzing(true);
    setSonarrStatus("Analyzing Sonarr...");
    try {
      await analyzeSonarr();
      const rows = await getSonarrRows();
      setSonarrRows(rows);
      setSonarrStatus(`Analysis complete: ${rows.length} series`);
    } catch (error) {
      setSonarrStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setSonarrAnalyzing(false);
    }
  }

  return (
    <AppFrame
      activeTab={activeTab}
      onAnalyze={() => void runSonarrAnalyze()}
      onGrab={() => setActiveTab("jobs")}
      onPauseScheduler={() => setSchedulerPaused((paused) => !paused)}
      onSearch={() => setActiveTab("jobs")}
      onTabChange={setActiveTab}
      schedulerPaused={schedulerPaused}
    >
      {activeTab === "dashboard" ? <DashboardView /> : null}
      {activeTab === "sonarr" ? (
        <SonarrSeriesView
          analyzing={sonarrAnalyzing}
          onAnalyze={() => void runSonarrAnalyze()}
          rows={sonarrRows}
          statusMessage={sonarrStatus}
        />
      ) : null}
      {activeTab === "radarr" ? <RadarrMoviesView /> : null}
      {activeTab === "jobs" ? <JobsView /> : null}
      {activeTab === "quotas" ? <QuotaView /> : null}
      {activeTab === "settings" ? <SettingsView /> : null}
    </AppFrame>
  );
}
