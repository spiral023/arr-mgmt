import { useEffect, useState } from "react";
import { AppFrame } from "./components/AppFrame";
import type { KpiItem } from "./components/KpiBar";
import type { AppTabId } from "./components/TabNav";
import {
  analyzeSonarr,
  analyzeSonarrSample,
  analyzeRadarr,
  analyzeRadarrSample,
  completeOnboarding,
  getSettings,
  getLibrarySummary,
  getQuotaSummary,
  getRadarrRows,
  getSonarrRows,
  grabRadarrMovies,
  grabSonarrSeries,
  listJobs,
  openRadarrMovie,
  openSonarrSeries,
  saveInstance,
  searchRadarrMovies,
  searchSonarrSeries,
  subscribeToJobEvents,
} from "./state/ipc-client";
import { shouldRefreshRadarrRows, shouldRefreshSonarrRows } from "./state/refresh-policy";
import { createRefreshScheduler } from "./state/refresh-scheduler";
import { DashboardView } from "./views/DashboardView";
import { JobsView } from "./views/JobsView";
import { QuotaView } from "./views/QuotaView";
import { RadarrMoviesView } from "./views/RadarrMoviesView";
import { SettingsView } from "./views/SettingsView";
import { SonarrSeriesView } from "./views/SonarrSeriesView";
import { StatsView } from "./views/StatsView";
import { OnboardingView } from "./views/OnboardingView";
import type { RadarrMovieTableRow, SonarrSeriesTableRow } from "../shared/ipc-contracts";

export function App() {
  const [activeTab, setActiveTab] = useState<AppTabId>("dashboard");
  const [schedulerPaused, setSchedulerPaused] = useState(false);
  const [sonarrRows, setSonarrRows] = useState<SonarrSeriesTableRow[]>([]);
  const [radarrRows, setRadarrRows] = useState<RadarrMovieTableRow[]>([]);
  const [sonarrStatus, setSonarrStatus] = useState("Ready");
  const [radarrStatus, setRadarrStatus] = useState("Ready");
  const [sonarrAnalyzing, setSonarrAnalyzing] = useState(false);
  const [radarrAnalyzing, setRadarrAnalyzing] = useState(false);
  const [kpis, setKpis] = useState<KpiItem[]>([]);
  const [onboardingOpen, setOnboardingOpen] = useState(false);

  useEffect(() => {
    void getSettings().then((settings) => setOnboardingOpen(!settings.onboardingCompleted));
    void refreshKpis();
    const scheduler = createRefreshScheduler(refreshKpis, { minimumDelayMs: 1_500 });
    const interval = window.setInterval(() => {
      scheduler.trigger();
    }, 5_000);
    const unsubscribe = subscribeToJobEvents(() => scheduler.trigger());
    return () => {
      window.clearInterval(interval);
      unsubscribe();
      scheduler.dispose();
    };
  }, []);

  useEffect(() => {
    if (!shouldRefreshSonarrRows(activeTab)) {
      return;
    }

    void refreshSonarrRows();
    const scheduler = createRefreshScheduler(refreshSonarrRows, { minimumDelayMs: 2_000 });
    const interval = window.setInterval(() => {
      scheduler.trigger();
    }, 5_000);
    const unsubscribe = subscribeToJobEvents(() => scheduler.trigger());
    return () => {
      window.clearInterval(interval);
      unsubscribe();
      scheduler.dispose();
    };
  }, [activeTab]);

  useEffect(() => {
    if (!shouldRefreshRadarrRows(activeTab)) {
      return;
    }

    void refreshRadarrRows();
    const scheduler = createRefreshScheduler(refreshRadarrRows, { minimumDelayMs: 2_000 });
    const interval = window.setInterval(() => {
      scheduler.trigger();
    }, 5_000);
    const unsubscribe = subscribeToJobEvents(() => scheduler.trigger());
    return () => {
      window.clearInterval(interval);
      unsubscribe();
      scheduler.dispose();
    };
  }, [activeTab]);

  async function refreshSonarrRows() {
    const rows = await getSonarrRows();
    setSonarrRows(rows);
  }

  async function refreshRadarrRows() {
    const rows = await getRadarrRows();
    setRadarrRows(rows);
  }

  async function refreshKpis() {
    const [summary, quota, jobs] = await Promise.all([getLibrarySummary(), getQuotaSummary(), listJobs()]);
    const activeJobs = jobs.filter((job) => job.status === "running").length;
    const queuedJobs = jobs.filter((job) => job.status === "queued").length;
    const lastAnalysis = jobs.find((job) => job.kind === "analysis" && job.finishedAt)?.finishedAt;
    setKpis([
      { label: "Series", value: String(summary.totalSeries), detail: "Sonarr library", tone: summary.totalSeries > 0 ? "good" : "default" },
      { label: "Movies", value: String(summary.totalMovies), detail: "Radarr library", tone: summary.totalMovies > 0 ? "good" : "default" },
      { label: "Sonarr FuN*", value: `${Math.round(summary.sonarrFunShare * 100)}%`, detail: `${summary.sonarrPendingFunCandidates} pending`, tone: "active" },
      { label: "Radarr FuN*", value: `${Math.round(summary.radarrFunShare * 100)}%`, detail: `${summary.radarrPendingFunCandidates} pending`, tone: "active" },
      { label: "FuN* files", value: String(summary.funFiles), detail: `${Math.round(summary.funShare * 100)}% total`, tone: "good" },
      { label: "Grabbed", value: String(summary.successfulGrabs), detail: "successful grabs", tone: "good" },
      { label: "Search Budget", value: `${quota.search.remaining} / ${quota.search.limit}`, detail: `${quota.search.used} used`, tone: "active" },
      { label: "Grab Budget", value: `${quota.grab.remaining} / ${quota.grab.limit}`, detail: `${quota.grab.used} used`, tone: quota.grab.remaining < 50 ? "warning" : "default" },
      { label: "Jobs", value: `${activeJobs} / ${queuedJobs}`, detail: "running / queued", tone: activeJobs > 0 ? "active" : "default" },
    ]);
  }

  async function runSonarrAnalyze(seriesIds?: number[]) {
    setActiveTab("sonarr");
    setSonarrAnalyzing(true);
    setSonarrStatus(seriesIds && seriesIds.length > 0 ? `Queueing analysis for ${seriesIds.length} selected Sonarr series...` : "Queueing full Sonarr analysis...");
    try {
      const job = await analyzeSonarr(seriesIds);
      setSonarrStatus(typeof job === "object" && job !== null && "id" in job ? `Analysis queued: ${String(job.id)}` : "Analysis queued");
      void refreshKpis();
    } catch (error) {
      setSonarrStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setSonarrAnalyzing(false);
    }
  }

  async function runRadarrAnalyze(movieIds?: number[]) {
    setActiveTab("radarr");
    setRadarrAnalyzing(true);
    setRadarrStatus(movieIds && movieIds.length > 0 ? `Queueing analysis for ${movieIds.length} selected Radarr movies...` : "Queueing full Radarr analysis...");
    try {
      const job = await analyzeRadarr(movieIds);
      setRadarrStatus(typeof job === "object" && job !== null && "id" in job ? `Analysis queued: ${String(job.id)}` : "Analysis queued");
      void refreshKpis();
    } catch (error) {
      setRadarrStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setRadarrAnalyzing(false);
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

  async function runRadarrSearch(movieIds: number[]) {
    setRadarrStatus(`Searching ${movieIds.length} Radarr movies...`);
    try {
      const result = await searchRadarrMovies(movieIds);
      setRadarrStatus(result.message);
      setActiveTab("jobs");
      void refreshKpis();
    } catch (error) {
      setRadarrStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function runRadarrGrab(movieIds: number[]) {
    setRadarrStatus(`Grabbing FuN* candidates for ${movieIds.length} Radarr movies...`);
    try {
      const result = await grabRadarrMovies(movieIds);
      setRadarrStatus(result.message);
      setActiveTab("jobs");
      void refreshKpis();
    } catch (error) {
      setRadarrStatus(error instanceof Error ? error.message : String(error));
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

  async function runOpenSonarrSeries(seriesId: number, titleSlug?: string) {
    try {
      await openSonarrSeries(seriesId, titleSlug);
    } catch (error) {
      setSonarrStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function runOpenRadarrMovie(movieId: number) {
    try {
      await openRadarrMovie(movieId);
    } catch (error) {
      setRadarrStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function finishOnboarding() {
    await completeOnboarding();
    setOnboardingOpen(false);
    void refreshKpis();
  }

  async function runQuickSample() {
    setActiveTab("jobs");
    setSonarrStatus("Queueing one Sonarr sample. This may still take a while.");
    setRadarrStatus("Queueing one Radarr sample. This may still take a while.");
    await Promise.all([analyzeSonarrSample(), analyzeRadarrSample()]);
    void refreshKpis();
  }

  return (
    <AppFrame
      activeTab={activeTab}
      onAnalyzeRadarr={() => void runRadarrAnalyze()}
      onAnalyzeSonarr={() => void runSonarrAnalyze()}
      onGrabRadarr={() => setActiveTab("radarr")}
      onGrabSonarr={() => setActiveTab("sonarr")}
      kpis={kpis}
      onPauseScheduler={() => setSchedulerPaused((paused) => !paused)}
      onQuickSample={() => void runQuickSample()}
      onSearchRadarr={() => setActiveTab("radarr")}
      onSearchSonarr={() => setActiveTab("sonarr")}
      onTabChange={setActiveTab}
      schedulerPaused={schedulerPaused}
    >
      {activeTab === "dashboard" ? <DashboardView /> : null}
      {activeTab === "sonarr" ? (
        <SonarrSeriesView
          analyzing={sonarrAnalyzing}
          onAnalyze={(seriesIds) => void runSonarrAnalyze(seriesIds)}
          onGrab={(seriesIds) => void runSonarrGrab(seriesIds)}
          onOpenInSonarr={(seriesId, titleSlug) => void runOpenSonarrSeries(seriesId, titleSlug)}
          onSearch={(seriesIds) => void runSonarrSearch(seriesIds)}
          rows={sonarrRows}
          statusMessage={sonarrStatus}
        />
      ) : null}
      {activeTab === "radarr" ? (
        <RadarrMoviesView
          analyzing={radarrAnalyzing}
          onAnalyze={(movieIds) => void runRadarrAnalyze(movieIds)}
          onGrab={(movieIds) => void runRadarrGrab(movieIds)}
          onOpenInRadarr={(movieId) => void runOpenRadarrMovie(movieId)}
          onSearch={(movieIds) => void runRadarrSearch(movieIds)}
          rows={radarrRows}
          statusMessage={radarrStatus}
        />
      ) : null}
      {activeTab === "stats" ? <StatsView /> : null}
      {activeTab === "jobs" ? <JobsView /> : null}
      {activeTab === "quotas" ? <QuotaView /> : null}
      {activeTab === "settings" ? <SettingsView /> : null}
      {onboardingOpen ? (
        <OnboardingView
          onAnalyzeAll={() => {
            void runSonarrAnalyze();
            void runRadarrAnalyze();
          }}
          onComplete={() => void finishOnboarding()}
          onQuickSample={() => void runQuickSample()}
          onSaveInstance={saveInstance}
        />
      ) : null}
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
