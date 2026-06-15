# Combined Pipeline Job — Design Spec
**Date:** 2026-06-15  
**Status:** Approved

## Overview

Add a one-click "Run pipeline" action that chains Analyse → Search → Grab in a single job, for both the full library and selected items. When the quota is exhausted mid-run, the job enters `blocked_by_budget` status and can be resumed the next day via a "Resume" button — already-processed items are skipped automatically.

---

## 1. PipelineSection (UI Component)

### Replaces `AnalysisSection` in both `SonarrSeriesView` and `RadarrMoviesView`

**Layout:**
```
┌─────────────────────────────────────────────────────────────────┐
│  ⟳  Sonarr Pipeline                 [Analyse only]  [▶ Run pipeline] │
│     [Analyse] › [Search] › [Grab]   ● idle                      │
│     Search 120/2000 · Grab 30/400                               │
└─────────────────────────────────────────────────────────────────┘
```

**Elements:**
- **Title**: "Sonarr Pipeline" / "Radarr Pipeline"
- **Phase chips**: Three read-only chips `[Analyse] › [Search] › [Grab]` connected by `›` arrows — purely visual, no click targets
- **Status pill**: `idle` / `running` (same as existing `AnalysisSection`)
- **Quota line**: `Search X/N · Grab X/N` in `font-mono text-[12px] text-ink-500 tabular-nums` — amber color when remaining ≤ 10% of limit
- **"Run pipeline" button**: Primary, `PlayCircle` icon — triggers full Analyse → Search → Grab for entire library
- **"Analyse only" button**: Secondary/muted — preserves existing behavior

**Props (identical to existing `AnalysisSection` plus quota and pipeline action):**
```ts
{
  analyzing?: boolean;
  onAnalyze?: () => void;
  onRunPipeline?: () => void;
  quota?: QuotaSummary;          // new — shown inline
  statusMessage?: string;
  title: string;
}
```

**Make-interfaces-feel-better:**
- `active:scale-[0.96]` on both buttons (already in `IconButton`)
- `tabular-nums` on quota numbers
- Concentric border radius: phase chips `rounded-md` inside card `rounded-xl`
- Quota numbers turn `text-signal-amber` when remaining ≤ 10%

---

## 2. Bulk Actions

**Before:** `[Analyze selected]  [Search selected]  [Grab selected]`

**After:**
```
[Analyze selected]  [Search selected]  [Grab selected]  |  [▶ Run pipeline]
```

- **Separator**: `<span aria-hidden className="h-5 w-px bg-white/[0.08]" />` — identical to filter separators
- **"Run pipeline" button**: `PlayCircle` icon, `tone="primary"` (Cyan) — triggers full Analyse → Search → Grab for selected rows
- Available in both `SonarrSeriesView` and `RadarrMoviesView`

---

## 3. JobsView — Resume Button

For jobs matching `status === "blocked_by_budget"` AND `kind === "combined"`:

**Actions column (was):** `[⌄ Events]  [✕ Cancel (disabled)]`

**Actions column (new):** `[⌄ Events]  [↺ Resume]  [✕ Cancel (disabled)]`

| Condition | Resume button state |
|---|---|
| `target !== "selected"` | Enabled — re-enqueues same pipeline for same scope |
| `target === "selected"` | Disabled + tooltip: "Re-select items and start pipeline again" |

**Icon:** `RotateCcw` from lucide-react, `tone="default"`  
**Tooltip:** "Re-run pipeline — already processed items are skipped automatically"  
**Make-interfaces-feel-better:** CSS `group-hover:rotate-[-30deg]` on icon for subtle spin hint on hover

---

## 4. Backend

### 4.1 New IPC channels (`ipc-contracts.ts`)

```ts
// Add to IpcChannel union:
| "jobs:runCombined"
| "jobs:resume"

// New input types:
export type RunCombinedInput = {
  target: "sonarr" | "radarr" | "all" | "selected";
  seriesIds?: number[];   // only when target === "selected"
  movieIds?: number[];    // only when target === "selected"
};

export type ResumeJobInput = { jobId: string };
```

### 4.2 Refactor `ipc.ts`

Extract the combined workflow logic from `runScheduledWorkflow` into a single reusable function:

```
enqueueCombinedJob(state, target, ids?)
  ├── enqueueAnalysis   (sonarr / radarr / both)
  ├── enqueueSearch     (items with nonFunFiles > 0)
  └── enqueueGrab       (items with pendingFunCandidates > 0)
```

This function is called by:
1. `jobs:runCombined` handler (new, manual trigger)
2. `jobs:resume` handler (new, re-runs blocked combined job)
3. `registerSchedule` callback (refactored, replaces `runScheduledWorkflow`)

The combined job runs as a single `Job` with `kind: "combined"` in the `JobRunner`. The three phase functions (`analyzeSonarrLibrary`, `searchSonarrCandidates`, `grabSonarrCandidates`) are called **directly** inside the `run` callback and share the same `JobContext` — they do NOT use nested `enqueue`/`waitFor` (that would deadlock since the running job holds the queue). Progress resets between phases via `context.setProgressTotal()`; the job log events make phase transitions visible. If any phase throws `JobBlockedByBudgetError`, the combined job transitions to `blocked_by_budget` and stops.

### 4.3 `jobs:resume` handler

1. Look up job by `jobId` in `jobRunner.listJobs()`
2. Validate: `kind === "combined"` and `status === "blocked_by_budget"`
3. If `target === "selected"`: return `{ ok: false, message: "Re-select items to resume" }`
4. Otherwise: call `enqueueCombinedJob(state, job.target)` → return new job id

### 4.4 New `ipc-client.ts` functions

```ts
export function runCombined(input: RunCombinedInput): Promise<ArrActionResult>
export function resumeJob(jobId: string): Promise<ArrActionResult>
```

---

## 5. Resume Mechanics

A resume enqueues a fresh combined job. Already-processed items are skipped automatically:

| Phase | Skip mechanism |
|---|---|
| Analyse | `analyzedArrIds` set — items already in DB are skipped |
| Search | Cooldown check — recently searched episodes/movies skip themselves |
| Grab | Stored candidates deleted after successful grab — only remaining ones are attempted |

If the quota is still exhausted when Resume is clicked, the new job blocks immediately again — the user sees the status right away and knows to wait longer.

---

## 6. Data Flow Summary

```
User clicks "Run pipeline" (PipelineSection or Bulk Action)
  └──► invokeIpc("jobs:runCombined", { target, seriesIds?, movieIds? })
         └──► enqueueCombinedJob(state, target, ids?)
                ├──► enqueueAnalysis  → JobRunner queue
                ├──► enqueueSearch    → JobRunner queue (after analysis)
                └──► enqueueGrab      → JobRunner queue (after search)
                       └── hits quota limit
                             └──► job.status = "blocked_by_budget"

User clicks "Resume" (JobsView)
  └──► invokeIpc("jobs:resume", { jobId })
         └──► enqueueCombinedJob(state, job.target)
                └── (same flow, already-processed items skipped)
```

---

## 7. Out of Scope

- Storing selected IDs for resume of `target === "selected"` jobs
- Automatic retry on quota reset (no timer/cron-based auto-resume)
- Per-phase progress within the combined job (progress reflects current active phase)
