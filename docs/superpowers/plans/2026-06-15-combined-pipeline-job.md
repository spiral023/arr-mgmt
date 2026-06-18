# Combined Pipeline Job Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Run pipeline" action (Analyse → Search → Grab) that works on the full library or selected items, with a Resume button for quota-blocked jobs.

**Architecture:** A new `enqueueCombinedJob` function creates a single `Job` with `kind: "combined"` whose `run` callback calls the three phase functions directly (no nested job enqueuing — that would deadlock the single-threaded queue). A new `PipelineSection` component replaces `AnalysisSection` in both views. `App.tsx` wires the new callbacks and passes quota state. `JobsView` gains a Resume button for blocked combined jobs.

**Tech Stack:** TypeScript, React, Electron IPC (ipcMain/ipcRenderer), Tailwind CSS, lucide-react, Drizzle ORM (SQLite).

---

## File Map

| File | Change |
|---|---|
| `src/shared/ipc-contracts.ts` | Add `"jobs:runCombined"`, `"jobs:resume"` to `IpcChannel`; add `RunCombinedInput`, `ResumeJobInput` types |
| `src/main/ipc.ts` | Add `runCombinedWorkflow`, `enqueueCombinedJob`, `assertRunCombinedInput`; add two `ipcMain.handle` calls |
| `src/renderer/state/ipc-client.ts` | Add `runCombined()`, `resumeJob()`; add browser fallbacks |
| `src/renderer/views/SonarrSeriesView.tsx` | Replace `AnalysisSection` export with `PipelineSection`; add `onRunPipeline`/`quota` props; add bulk "Run pipeline" action |
| `src/renderer/views/RadarrMoviesView.tsx` | Import `PipelineSection` instead of `AnalysisSection`; add matching props and bulk action |
| `src/renderer/App.tsx` | Add `quota` state; add `runSonarrPipeline`/`runRadarrPipeline`; wire new props to both views |
| `src/renderer/views/JobsView.tsx` | Import `resumeJob`, `RotateCcw`; add `resumeSelectedJob`; add Resume button in actions column |

---

## Task 1: Add IPC channel types

**Files:**
- Modify: `src/shared/ipc-contracts.ts`

- [ ] **Step 1: Add two channels to `IpcChannel`**

In `src/shared/ipc-contracts.ts`, the `IpcChannel` union currently ends with `"onboarding:complete"`. Change:

```ts
  | "onboarding:complete";
```
→
```ts
  | "onboarding:complete"
  | "jobs:runCombined"
  | "jobs:resume";
```

- [ ] **Step 2: Add new input types at the end of the file**

Append after the last type in the file (after `ActivityRowView`):

```ts
export type RunCombinedInput = {
  target: "sonarr" | "radarr" | "all" | "selected";
  seriesIds?: number[];
  movieIds?: number[];
};

export type ResumeJobInput = { jobId: string };
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npm run lint
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/shared/ipc-contracts.ts
git commit -m "feat: add jobs:runCombined and jobs:resume IPC channel types"
```

---

## Task 2: Add combined job backend

**Files:**
- Modify: `src/main/ipc.ts`

- [ ] **Step 1: Add `RunCombinedInput` to the import from `ipc-contracts`**

Locate the `import type { ... } from "../shared/ipc-contracts"` block (lines 19-39). Add `RunCombinedInput` to the list:

```ts
import type {
  ActivityRowView,
  AppSettingsInput,
  InstanceConfigInput,
  InstanceKind,
  InstanceTestResult,
  JobEventView,
  JobView,
  LibrarySummary,
  ManualGrabInput,
  MediaItemDetailsInput,
  QuotaSummary,
  RadarrActionResult,
  RadarrMovieActionInput,
  RunCombinedInput,
  ScheduleDeleteInput,
  ScheduleInput,
  ScheduleView,
  SettingsViewModel,
  SonarrActionResult,
  SonarrSeriesActionInput,
} from "../shared/ipc-contracts";
```

- [ ] **Step 2: Add `runCombinedWorkflow` after `enqueueRadarrGrab` (line ~336)**

Insert this function after the closing `}` of `enqueueRadarrGrab`:

```ts
async function runCombinedWorkflow(
  state: IpcState,
  context: JobContext,
  targets: ReadonlyArray<"sonarr" | "radarr">,
  ids?: { seriesIds?: number[]; movieIds?: number[] },
): Promise<void> {
  const isSelected = Boolean(ids);

  // Phase 1: Analysis
  for (const t of targets) {
    context.addEvent("info", `Phase 1/3 — Analyse (${t})`);
    if (t === "sonarr") {
      await analyzeSonarrLibrary(state, context, ids?.seriesIds);
    } else {
      await analyzeRadarrLibrary(state, context, ids?.movieIds);
    }
    context.throwIfCancelled();
  }

  // Phase 2: Search
  for (const t of targets) {
    if (t === "sonarr") {
      const seriesIds = isSelected
        ? (ids?.seriesIds ?? [])
        : state.repositories.mediaItems.listSonarrRows().filter((r) => r.nonFunFiles > 0).map((r) => r.arrId);
      if (seriesIds.length > 0) {
        context.addEvent("info", `Phase 2/3 — Search (sonarr, ${seriesIds.length} series)`);
        await searchSonarrCandidates(state, { seriesIds }, context);
      } else {
        context.addEvent("info", "Phase 2/3 — Search (sonarr): no series with non-FuN files, skipping");
      }
    } else {
      const movieIds = isSelected
        ? (ids?.movieIds ?? [])
        : state.repositories.mediaItems.listRadarrRows().filter((r) => r.nonFunFiles > 0).map((r) => r.arrId);
      if (movieIds.length > 0) {
        context.addEvent("info", `Phase 2/3 — Search (radarr, ${movieIds.length} movies)`);
        await searchRadarrCandidates(state, { movieIds }, context);
      } else {
        context.addEvent("info", "Phase 2/3 — Search (radarr): no movies with non-FuN files, skipping");
      }
    }
    context.throwIfCancelled();
  }

  // Phase 3: Grab
  for (const t of targets) {
    if (t === "sonarr") {
      const seriesIds = isSelected
        ? (ids?.seriesIds ?? [])
        : state.repositories.mediaItems.listSonarrRows().filter((r) => r.pendingFunCandidates > 0).map((r) => r.arrId);
      if (seriesIds.length > 0) {
        context.addEvent("info", `Phase 3/3 — Grab (sonarr, ${seriesIds.length} series)`);
        await grabSonarrCandidates(state, { seriesIds }, context);
      } else {
        context.addEvent("info", "Phase 3/3 — Grab (sonarr): no series with pending candidates, skipping");
      }
    } else {
      const movieIds = isSelected
        ? (ids?.movieIds ?? [])
        : state.repositories.mediaItems.listRadarrRows().filter((r) => r.pendingFunCandidates > 0).map((r) => r.arrId);
      if (movieIds.length > 0) {
        context.addEvent("info", `Phase 3/3 — Grab (radarr, ${movieIds.length} movies)`);
        await grabRadarrCandidates(state, { movieIds }, context);
      } else {
        context.addEvent("info", "Phase 3/3 — Grab (radarr): no movies with pending candidates, skipping");
      }
    }
  }
}
```

- [ ] **Step 3: Add `enqueueCombinedJob` immediately after `runCombinedWorkflow`**

```ts
function enqueueCombinedJob(
  state: IpcState,
  jobTarget: "sonarr" | "radarr" | "all" | "selected",
  ids?: { seriesIds?: number[]; movieIds?: number[] },
) {
  const targets: ReadonlyArray<"sonarr" | "radarr"> =
    jobTarget === "all"
      ? ["sonarr", "radarr"]
      : jobTarget === "selected"
      ? [
          ...(ids?.seriesIds && ids.seriesIds.length > 0 ? (["sonarr"] as const) : []),
          ...(ids?.movieIds && ids.movieIds.length > 0 ? (["radarr"] as const) : []),
        ]
      : [jobTarget];

  return state.jobRunner.enqueue({
    name: jobTarget === "selected" ? "Run pipeline (selected)" : `Run pipeline (${jobTarget})`,
    kind: "combined",
    target: jobTarget,
    run: (context) => runCombinedWorkflow(state, context, targets, ids),
  });
}
```

- [ ] **Step 4: Add `assertRunCombinedInput` at the bottom of the file (after `assertScheduleDeleteInput`)**

```ts
function assertRunCombinedInput(payload: unknown): RunCombinedInput {
  if (typeof payload !== "object" || payload === null) {
    throw new Error("Invalid runCombined payload");
  }
  const value = payload as Partial<RunCombinedInput>;
  if (value.target !== "sonarr" && value.target !== "radarr" && value.target !== "all" && value.target !== "selected") {
    throw new Error("Invalid target for runCombined — must be sonarr, radarr, all, or selected");
  }
  return {
    target: value.target,
    seriesIds: Array.isArray(value.seriesIds)
      ? value.seriesIds.filter((id): id is number => Number.isInteger(id) && id > 0)
      : undefined,
    movieIds: Array.isArray(value.movieIds)
      ? value.movieIds.filter((id): id is number => Number.isInteger(id) && id > 0)
      : undefined,
  };
}
```

- [ ] **Step 5: Add two new `ipcMain.handle` calls inside `registerIpcHandlers`**

After the `ipcMain.handle("jobs:cancel", ...)` block (line ~96) and before `ipcMain.handle("jobs:enqueue", ...)`, insert:

```ts
  ipcMain.handle("jobs:runCombined", (_event, payload: unknown): ArrActionResult => {
    const input = assertRunCombinedInput(payload);
    const job = enqueueCombinedJob(state, input.target, { seriesIds: input.seriesIds, movieIds: input.movieIds });
    return { ok: true, jobId: job.id, message: `Pipeline queued for ${input.target}` };
  });
  ipcMain.handle("jobs:resume", (_event, payload: unknown): ArrActionResult => {
    const jobId =
      typeof payload === "object" && payload !== null && "jobId" in payload && typeof payload.jobId === "string"
        ? payload.jobId
        : undefined;
    if (!jobId) throw new Error("jobId is required");
    const job = state.jobRunner.listJobs().find((j) => j.id === jobId);
    if (!job) return { ok: false, message: "Job not found" };
    if (job.kind !== "combined") return { ok: false, message: "Only combined jobs can be resumed" };
    if (job.status !== "blocked_by_budget") return { ok: false, message: "Job is not blocked by budget" };
    if (job.target === "selected") return { ok: false, message: "Re-select items and start pipeline again" };
    const resumeTarget = job.target as "sonarr" | "radarr" | "all";
    const newJob = enqueueCombinedJob(state, resumeTarget);
    return { ok: true, jobId: newJob.id, message: `Pipeline resumed for ${resumeTarget}` };
  });
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
npm run lint
```
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/main/ipc.ts
git commit -m "feat: add enqueueCombinedJob and jobs:runCombined / jobs:resume IPC handlers"
```

---

## Task 3: Add frontend IPC client functions

**Files:**
- Modify: `src/renderer/state/ipc-client.ts`

- [ ] **Step 1: Add `RunCombinedInput` and `ResumeJobInput` to the import block**

Locate the `import type { ... } from "../../shared/ipc-contracts"` block at the top of the file. Add both new types:

```ts
import type {
  ActivityRowView,
  AppSettingsInput,
  InstanceConfigInput,
  InstanceConfigView,
  InstanceTestResult,
  IpcChannel,
  JobEventView,
  JobView,
  LibrarySummary,
  ManualGrabInput,
  MediaItemDetails,
  MediaItemDetailsInput,
  QuotaSummary,
  RadarrActionResult,
  RadarrMovieActionInput,
  RadarrMovieTableRow,
  ResumeJobInput,
  RunCombinedInput,
  ScheduleDeleteInput,
  ScheduleInput,
  ScheduleView,
  SonarrActionResult,
  SonarrSeriesTableRow,
  SonarrSeriesActionInput,
  SettingsViewModel,
} from "../../shared/ipc-contracts";
```

- [ ] **Step 2: Add `runCombined` and `resumeJob` functions after `grabRadarrMovies`**

```ts
export function runCombined(input: RunCombinedInput): Promise<ArrActionResult> {
  return invokeIpc<ArrActionResult>("jobs:runCombined", input);
}

export function resumeJob(jobId: string): Promise<ArrActionResult> {
  return invokeIpc<ArrActionResult>("jobs:resume", { jobId } satisfies ResumeJobInput);
}
```

- [ ] **Step 3: Add browser fallbacks in `getBrowserFallback`**

Inside `getBrowserFallback`, after the `if (channel === "quota:manualGrab")` block and before the final `return {} as T`:

```ts
  if (channel === "jobs:runCombined") {
    return { ok: true, message: "Pipeline queued (browser preview)" } as T;
  }
  if (channel === "jobs:resume") {
    return { ok: true, message: "Pipeline resumed (browser preview)" } as T;
  }
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npm run lint
```
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/state/ipc-client.ts
git commit -m "feat: add runCombined and resumeJob IPC client functions"
```

---

## Task 4: Replace AnalysisSection with PipelineSection in SonarrSeriesView

**Files:**
- Modify: `src/renderer/views/SonarrSeriesView.tsx`

- [ ] **Step 1: Update lucide-react import — add `Play`**

Change:
```ts
import { ExternalLink, Eye, Radar, Search, Zap } from "lucide-react";
```
→
```ts
import { ExternalLink, Eye, Play, Radar, Search, Zap } from "lucide-react";
```

- [ ] **Step 2: Add `QuotaSummary` to the ipc-contracts import**

Change:
```ts
import type { MediaItemDetails, SonarrSeriesTableRow } from "../../shared/ipc-contracts";
```
→
```ts
import type { MediaItemDetails, QuotaSummary, SonarrSeriesTableRow } from "../../shared/ipc-contracts";
```

- [ ] **Step 3: Add `onRunPipeline` and `quota` to `SonarrSeriesView` props**

Change the function signature:
```ts
export function SonarrSeriesView({
  analyzing = false,
  onAnalyze,
  onGrab,
  onLoadDetails,
  onOpenInSonarr,
  onSearch,
  rows: liveRows,
  statusMessage = "Ready",
}: {
  analyzing?: boolean;
  onAnalyze?: (seriesIds?: number[]) => void;
  onGrab?: (seriesIds: number[]) => void;
  onLoadDetails?: (kind: "series" | "movie", arrId: number) => Promise<MediaItemDetails>;
  onOpenInSonarr?: (seriesId: number, titleSlug?: string) => void;
  onSearch?: (seriesIds: number[]) => void;
  rows?: SonarrSeriesTableRow[];
  statusMessage?: string;
})
```
→
```ts
export function SonarrSeriesView({
  analyzing = false,
  onAnalyze,
  onGrab,
  onLoadDetails,
  onOpenInSonarr,
  onRunPipeline,
  onSearch,
  quota,
  rows: liveRows,
  statusMessage = "Ready",
}: {
  analyzing?: boolean;
  onAnalyze?: (seriesIds?: number[]) => void;
  onGrab?: (seriesIds: number[]) => void;
  onLoadDetails?: (kind: "series" | "movie", arrId: number) => Promise<MediaItemDetails>;
  onOpenInSonarr?: (seriesId: number, titleSlug?: string) => void;
  onRunPipeline?: (seriesIds?: number[]) => void;
  onSearch?: (seriesIds: number[]) => void;
  quota?: QuotaSummary;
  rows?: SonarrSeriesTableRow[];
  statusMessage?: string;
})
```

- [ ] **Step 4: Replace `AnalysisSection` usage with `PipelineSection` in the JSX**

Change:
```tsx
      <AnalysisSection analyzing={analyzing} onAnalyze={() => onAnalyze?.()} statusMessage={statusMessage} title="Sonarr Analysis" />
```
→
```tsx
      <PipelineSection
        analyzing={analyzing}
        onAnalyze={() => onAnalyze?.()}
        onRunPipeline={() => onRunPipeline?.()}
        quota={quota}
        statusMessage={statusMessage}
        title="Sonarr Pipeline"
      />
```

- [ ] **Step 5: Add "Run pipeline" bulk action button (4th button)**

In the `bulkActions` prop of `DataTable`, after the `Grab selected` `IconButton` and before the closing `</>`:

```tsx
            <span aria-hidden="true" className="mx-0.5 h-5 w-px bg-white/[0.08]" />
            <IconButton
              icon={Play}
              label="Run full pipeline for selected series"
              onClick={() => onRunPipeline?.(selectedRows.map((row) => row.original.arrId))}
              tone="primary"
            >
              Run pipeline
            </IconButton>
```

- [ ] **Step 6: Replace `AnalysisSection` component definition with `PipelineSection`**

Delete the entire `export function AnalysisSection(...)` component (lines ~269-299) and replace it with:

```tsx
export function PipelineSection({
  analyzing = false,
  onAnalyze,
  onRunPipeline,
  quota,
  statusMessage = "Ready",
  title,
}: {
  analyzing?: boolean;
  onAnalyze?: () => void;
  onRunPipeline?: () => void;
  quota?: QuotaSummary;
  statusMessage?: string;
  title: string;
}) {
  const searchLow = quota !== undefined && quota.search.limit > 0 && quota.search.remaining / quota.search.limit <= 0.1;
  const grabLow = quota !== undefined && quota.grab.limit > 0 && quota.grab.remaining / quota.grab.limit <= 0.1;

  return (
    <section className="flex flex-col gap-3 rounded-xl bg-ink-925 p-4 shadow-card sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-signal-cyan/[0.10] text-signal-cyan">
          <Radar aria-hidden="true" className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[15px] font-semibold text-white">{title}</h2>
            <StatusPill tone={analyzing ? "running" : "idle"}>{analyzing ? "running" : "idle"}</StatusPill>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <PipelinePhaseChip label="Analyse" />
            <span aria-hidden="true" className="text-[11px] text-ink-600">›</span>
            <PipelinePhaseChip label="Search" />
            <span aria-hidden="true" className="text-[11px] text-ink-600">›</span>
            <PipelinePhaseChip label="Grab" />
            {quota !== undefined ? (
              <>
                <span aria-hidden="true" className="mx-0.5 h-3 w-px bg-white/[0.08]" />
                <span className={clsx("font-mono text-[11.5px] tabular-nums", searchLow ? "text-signal-amber" : "text-ink-500")}>
                  Search {quota.search.remaining}/{quota.search.limit}
                </span>
                <span aria-hidden="true" className="px-0.5 text-[11px] text-ink-600">·</span>
                <span className={clsx("font-mono text-[11.5px] tabular-nums", grabLow ? "text-signal-amber" : "text-ink-500")}>
                  Grab {quota.grab.remaining}/{quota.grab.limit}
                </span>
              </>
            ) : null}
          </div>
          <p className="mt-0.5 truncate text-[13px] text-ink-500">{statusMessage}</p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          className="h-9 rounded-md border border-white/10 bg-white/[0.02] px-3 text-[13px] font-medium text-ink-400 shadow-surface transition-[background-color,border-color,color,box-shadow,scale] duration-150 ease-out active:scale-[0.96] hover:bg-white/[0.07] hover:text-white hover:shadow-surface-hover disabled:cursor-not-allowed disabled:opacity-40"
          disabled={analyzing}
          onClick={onAnalyze}
          title="Run analyse only — no search or grab"
          type="button"
        >
          Analyse only
        </button>
        <IconButton
          disabled={analyzing}
          icon={Play}
          label={`Run full pipeline for ${title}`}
          onClick={onRunPipeline}
          tone="primary"
        >
          {analyzing ? "Running…" : "Run pipeline"}
        </IconButton>
      </div>
    </section>
  );
}

function PipelinePhaseChip({ label }: { label: string }) {
  return (
    <span className="inline-flex h-5 items-center rounded px-1.5 text-[11px] font-medium text-ink-500 ring-1 ring-inset ring-white/[0.07]">
      {label}
    </span>
  );
}
```

- [ ] **Step 7: Verify TypeScript compiles**

```bash
npm run lint
```
Expected: one error — `RadarrMoviesView.tsx` still imports `AnalysisSection` which no longer exists. This is expected; it will be fixed in Task 5.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/views/SonarrSeriesView.tsx
git commit -m "feat: replace AnalysisSection with PipelineSection in SonarrSeriesView"
```

---

## Task 5: Update RadarrMoviesView

**Files:**
- Modify: `src/renderer/views/RadarrMoviesView.tsx`

- [ ] **Step 1: Update the import from `SonarrSeriesView` — replace `AnalysisSection` with `PipelineSection`**

Change:
```ts
import {
  AnalysisSection,
  BooleanCell,
  CountChip,
  DateCell,
  FilterChip,
  FilterSelect,
  NumberCell,
  ShareCell,
  TitleCell,
} from "./SonarrSeriesView";
```
→
```ts
import {
  BooleanCell,
  CountChip,
  DateCell,
  FilterChip,
  FilterSelect,
  NumberCell,
  PipelineSection,
  ShareCell,
  TitleCell,
} from "./SonarrSeriesView";
```

- [ ] **Step 2: Add `Play` to the lucide-react import**

Change:
```ts
import { ExternalLink, Eye, Radar, Search, Zap } from "lucide-react";
```
→
```ts
import { ExternalLink, Eye, Play, Radar, Search, Zap } from "lucide-react";
```

- [ ] **Step 3: Add `QuotaSummary` to the ipc-contracts import**

Change:
```ts
import type { MediaItemDetails, RadarrMovieTableRow } from "../../shared/ipc-contracts";
```
→
```ts
import type { MediaItemDetails, QuotaSummary, RadarrMovieTableRow } from "../../shared/ipc-contracts";
```

- [ ] **Step 4: Add `onRunPipeline` and `quota` to `RadarrMoviesView` props**

Change the function signature:
```ts
export function RadarrMoviesView({
  analyzing = false,
  onAnalyze,
  onGrab,
  onLoadDetails,
  onOpenInRadarr,
  onSearch,
  rows: liveRows,
  statusMessage = "Ready",
}: {
  analyzing?: boolean;
  onAnalyze?: (movieIds?: number[]) => void;
  onGrab?: (movieIds: number[]) => void;
  onLoadDetails?: (kind: "series" | "movie", arrId: number) => Promise<MediaItemDetails>;
  onOpenInRadarr?: (movieId: number) => void;
  onSearch?: (movieIds: number[]) => void;
  rows?: RadarrMovieTableRow[];
  statusMessage?: string;
})
```
→
```ts
export function RadarrMoviesView({
  analyzing = false,
  onAnalyze,
  onGrab,
  onLoadDetails,
  onOpenInRadarr,
  onRunPipeline,
  onSearch,
  quota,
  rows: liveRows,
  statusMessage = "Ready",
}: {
  analyzing?: boolean;
  onAnalyze?: (movieIds?: number[]) => void;
  onGrab?: (movieIds: number[]) => void;
  onLoadDetails?: (kind: "series" | "movie", arrId: number) => Promise<MediaItemDetails>;
  onOpenInRadarr?: (movieId: number) => void;
  onRunPipeline?: (movieIds?: number[]) => void;
  onSearch?: (movieIds: number[]) => void;
  quota?: QuotaSummary;
  rows?: RadarrMovieTableRow[];
  statusMessage?: string;
})
```

- [ ] **Step 5: Replace `AnalysisSection` with `PipelineSection` in the JSX**

Change:
```tsx
      <AnalysisSection analyzing={analyzing} onAnalyze={() => onAnalyze?.()} statusMessage={statusMessage} title="Radarr Analysis" />
```
→
```tsx
      <PipelineSection
        analyzing={analyzing}
        onAnalyze={() => onAnalyze?.()}
        onRunPipeline={() => onRunPipeline?.()}
        quota={quota}
        statusMessage={statusMessage}
        title="Radarr Pipeline"
      />
```

- [ ] **Step 6: Add "Run pipeline" bulk action button (4th button)**

In the `bulkActions` prop of `DataTable`, after the `Grab selected` `IconButton` and before the closing `</>`:

```tsx
            <span aria-hidden="true" className="mx-0.5 h-5 w-px bg-white/[0.08]" />
            <IconButton
              icon={Play}
              label="Run full pipeline for selected Radarr movies"
              onClick={() => onRunPipeline?.(selectedRows.map((row) => row.original.arrId))}
              tone="primary"
            >
              Run pipeline
            </IconButton>
```

- [ ] **Step 7: Verify TypeScript compiles clean**

```bash
npm run lint
```
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/views/RadarrMoviesView.tsx
git commit -m "feat: use PipelineSection and add Run pipeline bulk action in RadarrMoviesView"
```

---

## Task 6: Wire up App.tsx

**Files:**
- Modify: `src/renderer/App.tsx`

- [ ] **Step 1: Add new imports**

Update the `import { ... } from "./state/ipc-client"` block to add `getItemDetails`, `runCombined`, `resumeJob` (note: `resumeJob` is not needed in App.tsx — it's used in JobsView directly. Only `runCombined` and `getItemDetails` are needed here):

```ts
import {
  analyzeSonarr,
  analyzeSonarrSample,
  analyzeRadarr,
  analyzeRadarrSample,
  completeOnboarding,
  getItemDetails,
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
  runCombined,
  saveInstance,
  searchRadarrMovies,
  searchSonarrSeries,
  subscribeToJobEvents,
} from "./state/ipc-client";
```

- [ ] **Step 2: Add `QuotaSummary` to the shared import**

Change:
```ts
import type { RadarrMovieTableRow, SonarrSeriesTableRow } from "../shared/ipc-contracts";
```
→
```ts
import type { QuotaSummary, RadarrMovieTableRow, SonarrSeriesTableRow } from "../shared/ipc-contracts";
```

- [ ] **Step 3: Add `quota` state**

After `const [onboardingOpen, setOnboardingOpen] = useState(false);`, add:

```ts
  const [quota, setQuota] = useState<QuotaSummary | undefined>(undefined);
```

- [ ] **Step 4: Expose quota from `refreshKpis`**

In `refreshKpis`, the existing destructuring is:
```ts
    const [summary, quota, jobs] = await Promise.all([getLibrarySummary(), getQuotaSummary(), listJobs()]);
```

This destructures `quota` as a local variable already. After the `setKpis([...])` call, add:

```ts
    setQuota(quota);
```

- [ ] **Step 5: Add `runSonarrPipeline` function**

After `runSonarrGrab`, add:

```ts
  async function runSonarrPipeline(seriesIds?: number[]) {
    setSonarrStatus(
      seriesIds && seriesIds.length > 0
        ? `Queueing pipeline for ${seriesIds.length} selected Sonarr series…`
        : "Queueing full Sonarr pipeline…",
    );
    try {
      const result = await runCombined({ target: seriesIds && seriesIds.length > 0 ? "selected" : "sonarr", seriesIds });
      setSonarrStatus(result.message);
      setActiveTab("jobs");
      void refreshKpis();
    } catch (error) {
      setSonarrStatus(error instanceof Error ? error.message : String(error));
    }
  }
```

- [ ] **Step 6: Add `runRadarrPipeline` function**

After `runSonarrPipeline`, add:

```ts
  async function runRadarrPipeline(movieIds?: number[]) {
    setRadarrStatus(
      movieIds && movieIds.length > 0
        ? `Queueing pipeline for ${movieIds.length} selected Radarr movies…`
        : "Queueing full Radarr pipeline…",
    );
    try {
      const result = await runCombined({ target: movieIds && movieIds.length > 0 ? "selected" : "radarr", movieIds });
      setRadarrStatus(result.message);
      setActiveTab("jobs");
      void refreshKpis();
    } catch (error) {
      setRadarrStatus(error instanceof Error ? error.message : String(error));
    }
  }
```

- [ ] **Step 7: Pass new props to `SonarrSeriesView`**

Change:
```tsx
        <SonarrSeriesView
          analyzing={sonarrAnalyzing}
          onAnalyze={(seriesIds) => void runSonarrAnalyze(seriesIds)}
          onGrab={(seriesIds) => void runSonarrGrab(seriesIds)}
          onOpenInSonarr={(seriesId, titleSlug) => void runOpenSonarrSeries(seriesId, titleSlug)}
          onSearch={(seriesIds) => void runSonarrSearch(seriesIds)}
          rows={sonarrRows}
          statusMessage={sonarrStatus}
        />
```
→
```tsx
        <SonarrSeriesView
          analyzing={sonarrAnalyzing}
          onAnalyze={(seriesIds) => void runSonarrAnalyze(seriesIds)}
          onGrab={(seriesIds) => void runSonarrGrab(seriesIds)}
          onLoadDetails={getItemDetails}
          onOpenInSonarr={(seriesId, titleSlug) => void runOpenSonarrSeries(seriesId, titleSlug)}
          onRunPipeline={(seriesIds) => void runSonarrPipeline(seriesIds)}
          onSearch={(seriesIds) => void runSonarrSearch(seriesIds)}
          quota={quota}
          rows={sonarrRows}
          statusMessage={sonarrStatus}
        />
```

- [ ] **Step 8: Pass new props to `RadarrMoviesView`**

Change:
```tsx
        <RadarrMoviesView
          analyzing={radarrAnalyzing}
          onAnalyze={(movieIds) => void runRadarrAnalyze(movieIds)}
          onGrab={(movieIds) => void runRadarrGrab(movieIds)}
          onOpenInRadarr={(movieId) => void runOpenRadarrMovie(movieId)}
          onSearch={(movieIds) => void runRadarrSearch(movieIds)}
          rows={radarrRows}
          statusMessage={radarrStatus}
        />
```
→
```tsx
        <RadarrMoviesView
          analyzing={radarrAnalyzing}
          onAnalyze={(movieIds) => void runRadarrAnalyze(movieIds)}
          onGrab={(movieIds) => void runRadarrGrab(movieIds)}
          onLoadDetails={getItemDetails}
          onOpenInRadarr={(movieId) => void runOpenRadarrMovie(movieId)}
          onRunPipeline={(movieIds) => void runRadarrPipeline(movieIds)}
          onSearch={(movieIds) => void runRadarrSearch(movieIds)}
          quota={quota}
          rows={radarrRows}
          statusMessage={radarrStatus}
        />
```

- [ ] **Step 9: Verify TypeScript compiles**

```bash
npm run lint
```
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add src/renderer/App.tsx
git commit -m "feat: wire runSonarrPipeline, runRadarrPipeline and quota into App"
```

---

## Task 7: Add Resume button to JobsView

**Files:**
- Modify: `src/renderer/views/JobsView.tsx`

- [ ] **Step 1: Add `RotateCcw` to the lucide-react import**

Change:
```ts
import { Ban, Check, ChevronDown, Copy } from "lucide-react";
```
→
```ts
import { Ban, Check, ChevronDown, Copy, RotateCcw } from "lucide-react";
```

- [ ] **Step 2: Add `resumeJob` to the ipc-client import**

Change:
```ts
import { cancelJob, listJobEvents, listJobs, subscribeToJobEvents } from "../state/ipc-client";
```
→
```ts
import { cancelJob, listJobEvents, listJobs, resumeJob, subscribeToJobEvents } from "../state/ipc-client";
```

- [ ] **Step 3: Add `resumeSelectedJob` callback alongside `cancelSelectedJob`**

After the `cancelSelectedJob` `useCallback`, add:

```ts
  const resumeSelectedJob = useCallback(
    async (jobId: string) => {
      await resumeJob(jobId);
      await refreshJobs();
    },
    [refreshJobs],
  );
```

- [ ] **Step 4: Add Resume button to the actions cell in columns**

The current actions cell is:
```tsx
        cell: ({ row }) => (
          <div className="flex gap-2">
            <IconButton className="px-0" icon={ChevronDown} label={`Show events for ${row.original.job}`} onClick={() => selectJob(row.original.id)} />
            <IconButton
              className="px-0"
              disabled={isFinished(row.original.status)}
              icon={Ban}
              label={`Cancel ${row.original.job}`}
              onClick={() => void cancelSelectedJob(row.original.id)}
              tone="danger"
            />
          </div>
        ),
```

Replace with:
```tsx
        cell: ({ row }) => (
          <div className="flex gap-2">
            <IconButton className="px-0" icon={ChevronDown} label={`Show events for ${row.original.job}`} onClick={() => selectJob(row.original.id)} />
            {row.original.status === "blocked_by_budget" && row.original.actions === "combined" ? (
              <IconButton
                className="px-0"
                disabled={row.original.target === "selected"}
                icon={RotateCcw}
                label={
                  row.original.target === "selected"
                    ? "Re-select items and start pipeline again"
                    : "Resume pipeline — already processed items are skipped automatically"
                }
                onClick={() => void resumeSelectedJob(row.original.id)}
                tone="default"
              />
            ) : null}
            <IconButton
              className="px-0"
              disabled={isFinished(row.original.status)}
              icon={Ban}
              label={`Cancel ${row.original.job}`}
              onClick={() => void cancelSelectedJob(row.original.id)}
              tone="danger"
            />
          </div>
        ),
```

- [ ] **Step 5: Add `resumeSelectedJob` to columns dependencies**

Change:
```ts
    [cancelSelectedJob, selectJob],
```
→
```ts
    [cancelSelectedJob, resumeSelectedJob, selectJob],
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
npm run lint
```
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/views/JobsView.tsx
git commit -m "feat: add Resume button for blocked_by_budget combined jobs in JobsView"
```

---

## Spec Coverage Check

| Spec section | Covered by |
|---|---|
| PipelineSection with 3-phase chips | Task 4, Step 6 |
| Quota display in PipelineSection | Task 4, Step 6 (`quota` prop with amber coloring) |
| "Run pipeline" full-library button | Task 4 (Sonarr) + Task 5 (Radarr), `onRunPipeline` with no IDs |
| "Analyse only" secondary button | Task 4, Step 6 (plain `<button>`) |
| "Run pipeline" bulk action (selected) | Task 4, Step 5 + Task 5, Step 6 |
| `jobs:runCombined` IPC handler | Task 2, Step 5 |
| `jobs:resume` IPC handler | Task 2, Step 5 |
| `RunCombinedInput` + `ResumeJobInput` types | Task 1 |
| Phase 1/2/3 sequential execution | Task 2, Steps 2-3 (`runCombinedWorkflow`) |
| Resume skips processed items naturally | Architecture (cooldown + candidate deletion) — no extra code needed |
| Resume button for `blocked_by_budget` combined jobs | Task 7 |
| Resume disabled for `target === "selected"` | Task 7, Step 4 |
| `runCombined` + `resumeJob` in ipc-client | Task 3 |
| App.tsx wiring + quota state | Task 6 |
