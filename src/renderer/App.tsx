import { useEffect, useState } from "react";
import { AppFrame } from "./components/AppFrame";
import type { KpiItem } from "./components/KpiBar";
import type { AppTabId } from "./components/TabNav";
import {
  analyzeSonarr,
  getLibrarySummary,
  getQuotaSummary,
  getSonarrRows,
  grabSonarrSeries,
  listJobs,
  openSonarrSeries,
  searchSonarrSeries,
  subscribeToJobEvents,
} from "./state/ipc-client";
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
  const [kpis, setKpis] = useState<KpiItem[]>([]);

  useEffect(() => {
    void refreshSonarrRows();
    void refreshKpis();
    const interval = window.setInterval(() => {
      void refreshSonarrRows();
      void refreshKpis();
    }, 5_000);
    const unsubscribe = subscribeToJobEvents(() => {
      void refreshSonarrRows();
      void refreshKpis();
    });
    return () => {
      window.clearInterval(interval);
      unsubscribe();
    };
  }, []);

  async function refreshSonarrRows() {
    const rows = await getSonarrRows();
    setSonarrRows(rows);
  }

  async function refreshKpis() {
    const [summary, quota, jobs] = await Promise.all([getLibrarySummary(), getQuotaSummary(), listJobs()]);
    const activeJobs = jobs.filter((job) => job.status === "running").length;
    const queuedJobs = jobs.filter((job) => job.status === "queued").length;
    const lastAnalysis = jobs.find((job) => job.kind === "analysis" && job.finishedAt)?.finishedAt;
    setKpis([
      { label: "Series", value: String(summary.totalSeries), detail: "Sonarr library", tone: summary.totalSeries > 0 ? "good" : "default" },
      { label: "Files", value: String(summary.totalFiles), detail: formatBytes(summary.totalSizeBytes), tone: "default" },
      { label: "FuN* files", value: String(summary.funFiles), detail: `${Math.round(summary.funShare * 100)}% coverage`, tone: "good" },
      { label: "Search Budget", value: `${quota.search.remaining} / ${quota.search.limit}`, detail: `${quota.search.used} used`, tone: "active" },
      { label: "Grab Budget", value: `${quota.grab.remaining} / ${quota.grab.limit}`, detail: `${quota.grab.used} used`, tone: quota.grab.remaining < 50 ? "warning" : "default" },
      { label: "Jobs", value: `${activeJobs} / ${queuedJobs}`, detail: "running / queued", tone: activeJobs > 0 ? "active" : "default" },
      { label: "Last Analysis", value: lastAnalysis ? formatTime(lastAnalysis) : "-", detail: "completed", tone: "default" },
    ]);
  }

  async function runSonarrAnalyze() {
    setActiveTab("sonarr");
    setSonarrAnalyzing(true);
    setSonarrStatus("Queueing Sonarr analysis...");
    try {
      const job = await analyzeSonarr();
      setSonarrStatus(typeof job === "object" && job !== null && "id" in job ? `Analysis queued: ${String(job.id)}` : "Analysis queued");
      void refreshKpis();
    } catch (error) {
      setSonarrStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setSonarrAnalyzing(false);
    }
  }

  async function runSonarrSearch(seriesIds: number[]) {
    setSonarrStatus(`Searching ${seriesIds.length} Sonarr series...`);
    try {
      const result = await searchSonarrSeries(seriesIds);
      setSonarrStatus(result.message);
      setActiveTab("jobs");
      void refreshKpis();
    } catch (error) {
      setSonarrStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function runSonarrGrab(seriesIds: number[]) {
    setSonarrStatus(`Grabbing FuN* candidates for ${seriesIds.length} Sonarr series...`);
    try {
      const result = await grabSonarrSeries(seriesIds);
      setSonarrStatus(result.message);
      setActiveTab("jobs");
      void refreshKpis();
    } catch (error) {
      setSonarrStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function runOpenSonarrSeries(seriesId: number) {
    try {
      await openSonarrSeries(seriesId);
    } catch (error) {
      setSonarrStatus(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <AppFrame
      activeTab={activeTab}
      onAnalyze={() => void runSonarrAnalyze()}
      onGrab={() => setActiveTab("jobs")}
      kpis={kpis}
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
          onGrab={(seriesIds) => void runSonarrGrab(seriesIds)}
          onOpenInSonarr={(seriesId) => void runOpenSonarrSeries(seriesId)}
          onSearch={(seriesIds) => void runSonarrSearch(seriesIds)}
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

function formatBytes(value: number) {
  if (value === 0) return "0 GB";
  if (value >= 1_000_000_000_000) return `${(value / 1_000_000_000_000).toFixed(1)} TB`;
  return `${(value / 1_000_000_000).toFixed(1)} GB`;
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
