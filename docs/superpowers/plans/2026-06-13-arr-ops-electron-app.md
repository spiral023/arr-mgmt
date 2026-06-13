# ARR Ops Electron App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Windows-focused Electron app that analyzes Sonarr and Radarr libraries for FuN* release coverage, schedules analysis/search/grab jobs, enforces a shared rolling 24h quota, stores all activity locally, and provides a polished dark-mode operations UI with tray and notifications.

**Architecture:** Electron main process owns ARR API clients, SQLite, encrypted secrets, job scheduling, quota enforcement, tray, and notifications. React renderer owns the UI only and communicates through typed IPC. Shared TypeScript modules define domain types, FuN normalization, quota rules, and job status contracts.

**Tech Stack:** Electron, Vite, React, TypeScript, Tailwind CSS, TanStack Table, SQLite, Drizzle ORM, Vitest, Playwright, Electron safeStorage, Electron Notification, Electron Tray.

---

## Verified API Context

Sonarr was verified on 2026-06-13:

- Base URL: `http://192.168.0.170:8989`
- API base: `/api/v3`
- Status endpoint: `GET /api/v3/system/status`
- Result: HTTP `200`
- Version: `4.0.17.2952`
- `urlBase`: empty
- Search commands from official Sonarr source:
  - `EpisodeSearch` with `episodeIds`
  - `SeasonSearch` with `seriesId` and `seasonNumber`
  - `SeriesSearch` with `seriesId`

Radarr was verified on 2026-06-13:

- Base URL: `http://192.168.0.170:7878`
- API base: `/api/v3`
- Status endpoint: `GET /api/v3/system/status`
- Result: HTTP `200`
- Version: `6.2.1.10461`
- `urlBase`: empty
- Example UI URL: `http://192.168.0.170:7878/movie/11397`
- API lookup result: Radarr API movie `id=8222`, `tmdbId=11397`, title `Nicht noch ein Teenie-Film`, current file release group `TSCC`
- Search command from official Radarr source:
  - `MoviesSearch` with `movieIds`

OpenAPI sources:

- Sonarr: `https://sonarr.tv/docs/api/#v3`
- Sonarr OpenAPI: `https://raw.githubusercontent.com/Sonarr/Sonarr/develop/src/Sonarr.Api.V3/openapi.json`
- Radarr: `https://radarr.video/docs/api/`
- Radarr OpenAPI: `https://raw.githubusercontent.com/Radarr/Radarr/develop/src/Radarr.Api.V3/openapi.json`

## Product Scope

The app supports three independent operation levels for both Sonarr and Radarr:

1. Analysis: read libraries, files, release groups, sizes, and compute FuN* coverage.
2. Search: query indexers through ARR APIs for non-FuN items and record discovered FuN* candidates.
3. Grab: grab selected FuN* releases while respecting the shared rolling 24h grab budget.

Each level can be run manually, in bulk from tables, or by scheduled jobs. A scheduled job can run analysis only, analysis plus search, or analysis plus search plus grab.

## FuN* Rule

Use a configurable release-group rule with this default:

```ts
export function isFunReleaseGroup(value: string | null | undefined): boolean {
  return value?.trim().toLowerCase().startsWith("fun") ?? false;
}
```

The settings UI exposes the display name `FuN*` and the prefix list, defaulting to `["fun"]`.

## Quota Rules

Budgets are shared across Sonarr and Radarr.

- Default rolling 24h search budget: `2000`
- Default rolling 24h grab budget: `400`
- Both numbers are configurable in Settings.
- Analysis API reads do not count.
- Indexer searches count against the search budget:
  - Sonarr `GET /release?episodeId=...`
  - Sonarr `POST /command` with `EpisodeSearch`, `SeasonSearch`, or `SeriesSearch`
  - Radarr `GET /release?movieId=...`
  - Radarr `POST /command` with `MoviesSearch`
- Grabs count against the grab budget:
  - Sonarr `POST /release`
  - Radarr `POST /release`

Quota enforcement uses local database rows with UTC timestamps. The app computes usage with `createdAt >= now - 24h`.

## File Structure

Create this project structure:

```text
package.json
tsconfig.json
vite.config.ts
electron.vite.config.ts
tailwind.config.ts
postcss.config.cjs
src/
  main/
    index.ts
    app-shell.ts
    tray.ts
    notifications.ts
    ipc.ts
    scheduler/
      scheduler.ts
      job-runner.ts
      quota-service.ts
    db/
      client.ts
      schema.ts
      migrations.ts
      repositories.ts
    secrets/
      secret-store.ts
    arr/
      arr-types.ts
      arr-api-client.ts
      sonarr-client.ts
      radarr-client.ts
      analysis-service.ts
      search-service.ts
      grab-service.ts
  renderer/
    main.tsx
    App.tsx
    styles.css
    components/
      AppFrame.tsx
      KpiBar.tsx
      TabNav.tsx
      DataTable.tsx
      StatusPill.tsx
      IconButton.tsx
      JobProgress.tsx
      ReleaseGroupBadge.tsx
    views/
      DashboardView.tsx
      SonarrSeriesView.tsx
      RadarrMoviesView.tsx
      JobsView.tsx
      QuotaView.tsx
      SettingsView.tsx
    state/
      ipc-client.ts
      queries.ts
      table-state.ts
  shared/
    domain.ts
    fun.ts
    quota.ts
    ipc-contracts.ts
    schedule.ts
tests/
  unit/
    fun.test.ts
    quota.test.ts
    schedule.test.ts
    analysis.test.ts
  e2e/
    app.spec.ts
```

## Database Model

Use SQLite with Drizzle. Store API keys encrypted via Electron `safeStorage`; the DB never stores plaintext API keys.

Tables:

- `instances`
  - `id`
  - `kind`: `sonarr` or `radarr`
  - `name`
  - `baseUrl`
  - `apiKeyEncrypted`
  - `enabled`
  - `lastStatus`
  - `lastStatusAt`
  - `createdAt`
  - `updatedAt`
- `media_items`
  - `id`
  - `instanceId`
  - `kind`: `series` or `movie`
  - `arrId`
  - `title`
  - `sortTitle`
  - `year`
  - `monitored`
  - `hasFile`
  - `totalChildren`
  - `childrenWithFile`
  - `funChildren`
  - `totalSizeBytes`
  - `funShare`
  - `lastAnalyzedAt`
  - unique key: `instanceId`, `kind`, `arrId`
- `media_files`
  - `id`
  - `mediaItemId`
  - `arrFileId`
  - `childArrId`
  - `seasonNumber`
  - `episodeNumber`
  - `path`
  - `relativePath`
  - `releaseGroup`
  - `isFun`
  - `qualityName`
  - `sizeBytes`
  - `dateAdded`
- `release_candidates`
  - `id`
  - `instanceId`
  - `mediaItemId`
  - `childArrId`
  - `arrReleaseGuid`
  - `title`
  - `releaseGroup`
  - `isFun`
  - `qualityName`
  - `sizeBytes`
  - `indexer`
  - `approved`
  - `downloadAllowed`
  - `rejected`
  - `rejectionsJson`
  - `rawJson`
  - `foundAt`
- `jobs`
  - `id`
  - `name`
  - `kind`: `analysis`, `search`, `grab`, `combined`
  - `targetScope`: `all`, `sonarr`, `radarr`, `selected`
  - `status`: `queued`, `running`, `blocked_by_budget`, `completed`, `failed`, `cancelled`
  - `progressCurrent`
  - `progressTotal`
  - `successCount`
  - `failureCount`
  - `createdAt`
  - `startedAt`
  - `finishedAt`
- `job_events`
  - `id`
  - `jobId`
  - `level`: `info`, `warning`, `error`
  - `message`
  - `payloadJson`
  - `createdAt`
- `activity_log`
  - `id`
  - `instanceId`
  - `mediaItemId`
  - `childArrId`
  - `action`: `analysis`, `search`, `grab`, `manual_grab_entry`, `notification`
  - `quotaType`: `none`, `search`, `grab`
  - `status`: `started`, `success`, `failed`, `skipped`, `blocked_by_budget`
  - `message`
  - `payloadJson`
  - `createdAt`
- `schedules`
  - `id`
  - `name`
  - `enabled`
  - `actionsJson`: array containing `analysis`, `search`, `grab`
  - `targetScope`
  - `intervalKind`: `minutes`, `hours`, `days`, `daily_time`
  - `intervalValue`
  - `timeOfDay`
  - `nextRunAt`
  - `lastRunAt`
  - `createdAt`
  - `updatedAt`
- `settings`
  - `key`
  - `valueJson`

## UI Design

Use a consistent dark operations interface:

- Background: near-black neutral, not purple/blue dominated.
- Accent: restrained green for FuN/success, amber for budget warnings, red for failed, cyan for active/running.
- Typography: compact, readable, no hero typography inside tables.
- Numbers: `font-variant-numeric: tabular-nums`.
- Buttons: icons from `lucide-react`, minimum 40x40 hit area, `active:scale(0.96)`.
- Containers: 8px radius or less for cards and table panels.
- Sticky top area: KPI/menu bar remains visible in every tab.
- Sticky table header: column headers remain visible while scrolling.
- Tables: virtualized rows for large Sonarr/Radarr libraries.

Top sticky KPI bar contains:

- Connected instances count
- Search budget used: `used / limit`
- Grab budget used: `used / limit`
- Active jobs count
- Queued jobs count
- Last analysis timestamp
- Global action buttons: Analyze, Search, Grab, Pause Scheduler

Tabs:

- Dashboard
- Sonarr
- Radarr
- Jobs
- Quotas
- Settings

## Screen Requirements

### Dashboard

Shows combined library KPIs:

- Total series
- Total movies
- Total files
- FuN* files
- FuN* share across all files
- Total size
- FuN* size share
- Search success rate
- Grab success rate
- Budget remaining

Includes compact recent activity and active jobs panels.

### Sonarr Tab

Main table: one row per series.

Columns:

- Title
- Monitored
- Episodes
- Files
- Total size
- FuN* files
- FuN* share
- Non-FuN files
- Last analyzed
- Last searched
- Last grabbed
- Status
- Actions

Filters:

- Search by title
- Has FuN*
- Missing FuN*
- Monitored only
- Has files
- Searchable now
- Blocked by cooldown
- Failed last search

Actions:

- Analyze selected
- Search non-FuN selected
- Grab available FuN* selected
- Open details drawer
- Open in Sonarr

Details drawer:

- Per-episode file list
- Release group
- Quality
- Size
- Last search time
- Last grab attempt
- Candidate FuN* releases
- Per-episode Search and Grab controls

### Radarr Tab

Main table: one row per movie.

Columns:

- Title
- Year
- Monitored
- Has file
- Size
- Release group
- FuN*
- Last analyzed
- Last searched
- Last grabbed
- Status
- Actions

Filters:

- Search by title
- Is FuN*
- Not FuN*
- Monitored only
- Has file
- Searchable now
- Candidate found

Actions:

- Analyze selected
- Search selected
- Grab available FuN* selected
- Open details drawer
- Open in Radarr

### Jobs Tab

Shows running, queued, completed, failed, and budget-blocked jobs.

Columns:

- Job
- Actions
- Target
- Status
- Progress
- Success
- Failure
- Started
- Finished
- Duration

Each job row expands to show `job_events`.

### Quotas Tab

Shows rolling 24h usage:

- Search usage timeline
- Grab usage timeline
- Remaining budget
- Manual grab entry form
- Recent quota-consuming actions

Manual grab entry form fields:

- Count
- App source: `sonarr`, `radarr`, or `external`
- Note

Manual entries create `activity_log` rows with `action=manual_grab_entry` and `quotaType=grab`.

### Settings Tab

Sections:

- Sonarr instances
- Radarr instances
- API key storage
- FuN* matching prefixes
- Quota limits
- Cooldown rules
- Schedules
- Notifications
- Tray and startup behavior

Instance form fields:

- Enabled
- Name
- Type
- Base URL
- API key
- Test connection button

API keys are stored from the interface and encrypted before persistence.

## Job Behavior

The job runner processes one quota-consuming item at a time. Analysis can run concurrently with UI reads, but search and grab actions must pass through `QuotaService`.

Cooldown defaults:

- Do not search the same Sonarr episode again within `24h`.
- Do not search the same Radarr movie again within `24h`.
- Do not grab the same ARR release GUID twice.

Cooldowns are configurable in Settings.

For combined jobs:

1. Analyze targets.
2. Build search candidate list from non-FuN items.
3. Skip items blocked by cooldown.
4. Stop or pause when search budget is exhausted.
5. Store FuN* release candidates.
6. If the job includes grabs, grab candidates until grab budget is exhausted.
7. Emit notification with summary.

## API Flows

### Sonarr Analysis

1. `GET /api/v3/series`
2. For each series: `GET /api/v3/episode?seriesId=<id>&includeEpisodeFile=true`
3. Compute:
   - total episodes
   - episodes with file
   - FuN* episode files
   - total file size from `episodeFile.size`
   - FuN* share
4. Upsert `media_items` and `media_files`.

### Sonarr Search

Controlled search:

1. Select non-FuN episodes.
2. Skip if `activity_log` has successful or failed search within cooldown.
3. Check search quota.
4. `GET /api/v3/release?episodeId=<episodeId>`
5. Store release candidates.
6. Mark whether a FuN* candidate exists.

Command search:

```json
{
  "name": "EpisodeSearch",
  "episodeIds": [12345]
}
```

Use command search only when the user explicitly chooses broad Sonarr-controlled searching.

### Sonarr Grab

1. Select stored FuN* candidates where `downloadAllowed=true` and `rejected=false`.
2. Check grab quota.
3. `POST /api/v3/release` with the selected release resource.
4. Record success or failure in `activity_log`.

### Radarr Analysis

1. `GET /api/v3/movie`
2. For each movie, use embedded `movieFile` when present.
3. Compute:
   - total movies
   - movies with file
   - FuN* movie files
   - total size from `movieFile.size`
   - FuN* share
4. Upsert `media_items` and `media_files`.

### Radarr Search

Controlled search:

1. Select non-FuN movies.
2. Skip if `activity_log` has search within cooldown.
3. Check search quota.
4. `GET /api/v3/release?movieId=<movieId>`
5. Store release candidates.

Command search:

```json
{
  "name": "MoviesSearch",
  "movieIds": [8222]
}
```

Use command search only when the user explicitly chooses broad Radarr-controlled searching.

### Radarr Grab

1. Select stored FuN* candidates where `downloadAllowed=true` and `rejected=false`.
2. Check grab quota.
3. `POST /api/v3/release` with the selected release resource.
4. Record success or failure in `activity_log`.

## Implementation Tasks

### Task 1: Project Scaffold

**Files:**

- Create: `package.json`
- Create: `tsconfig.json`
- Create: `electron.vite.config.ts`
- Create: `vite.config.ts`
- Create: `tailwind.config.ts`
- Create: `postcss.config.cjs`
- Create: `src/main/index.ts`
- Create: `src/renderer/main.tsx`
- Create: `src/renderer/App.tsx`
- Create: `src/renderer/styles.css`

- [ ] Create the Electron + Vite + React + TypeScript scaffold.
- [ ] Add scripts:
  - `dev`
  - `build`
  - `lint`
  - `test`
  - `test:e2e`
- [ ] Install dependencies:
  - `electron`
  - `electron-vite`
  - `react`
  - `react-dom`
  - `typescript`
  - `vite`
  - `tailwindcss`
  - `postcss`
  - `autoprefixer`
  - `lucide-react`
  - `@tanstack/react-table`
  - `@tanstack/react-virtual`
  - `drizzle-orm`
  - `better-sqlite3`
  - `vitest`
  - `playwright`
- [ ] Verify with `npm run build`.

### Task 2: Shared Domain Types

**Files:**

- Create: `src/shared/domain.ts`
- Create: `src/shared/fun.ts`
- Create: `src/shared/quota.ts`
- Create: `tests/unit/fun.test.ts`
- Create: `tests/unit/quota.test.ts`

- [ ] Write tests for FuN prefix matching:

```ts
import { describe, expect, it } from "vitest";
import { isFunReleaseGroup } from "../../src/shared/fun";

describe("isFunReleaseGroup", () => {
  it("matches FuN prefixes case-insensitively", () => {
    expect(isFunReleaseGroup("FuN")).toBe(true);
    expect(isFunReleaseGroup("FUNHD")).toBe(true);
    expect(isFunReleaseGroup(" fun-team ")).toBe(true);
  });

  it("does not match empty or unrelated groups", () => {
    expect(isFunReleaseGroup("WvF")).toBe(false);
    expect(isFunReleaseGroup("")).toBe(false);
    expect(isFunReleaseGroup(null)).toBe(false);
  });
});
```

- [ ] Implement `isFunReleaseGroup`.
- [ ] Write tests for rolling 24h quota calculation.
- [ ] Implement `getRollingUsage`.
- [ ] Verify with `npm run test`.

### Task 3: SQLite Schema and Repositories

**Files:**

- Create: `src/main/db/client.ts`
- Create: `src/main/db/schema.ts`
- Create: `src/main/db/migrations.ts`
- Create: `src/main/db/repositories.ts`
- Create: `tests/unit/db-schema.test.ts`

- [ ] Define all tables listed in "Database Model".
- [ ] Add repository functions for:
  - instances
  - media items
  - media files
  - release candidates
  - jobs
  - job events
  - activity log
  - schedules
  - settings
- [ ] Test that migrations create all required tables.
- [ ] Test that `activity_log` rows can be queried by rolling 24h window.

### Task 4: Secret Storage

**Files:**

- Create: `src/main/secrets/secret-store.ts`
- Create: `tests/unit/secret-store.test.ts`

- [ ] Wrap Electron `safeStorage.encryptString` and `safeStorage.decryptString`.
- [ ] Store encrypted API keys in `instances.apiKeyEncrypted`.
- [ ] For test environments, provide deterministic in-memory encryption with a test-only prefix.
- [ ] Test that plaintext API keys are not returned by repository reads unless explicitly decrypted by the secret service.

### Task 5: ARR API Clients

**Files:**

- Create: `src/main/arr/arr-types.ts`
- Create: `src/main/arr/arr-api-client.ts`
- Create: `src/main/arr/sonarr-client.ts`
- Create: `src/main/arr/radarr-client.ts`
- Create: `tests/unit/arr-client.test.ts`

- [ ] Implement a typed base client with:
  - `baseUrl`
  - `apiKey`
  - timeout
  - JSON parsing
  - `X-Api-Key` header
- [ ] Implement Sonarr methods:
  - `getStatus`
  - `getSeries`
  - `getEpisodes(seriesId, includeEpisodeFile)`
  - `getReleasesForEpisode(episodeId)`
  - `grabRelease(release)`
  - `runEpisodeSearch(episodeIds)`
- [ ] Implement Radarr methods:
  - `getStatus`
  - `getMovies`
  - `getReleasesForMovie(movieId)`
  - `grabRelease(release)`
  - `runMoviesSearch(movieIds)`
- [ ] Test URL construction and headers without calling live ARR instances.

### Task 6: Analysis Service

**Files:**

- Create: `src/main/arr/analysis-service.ts`
- Create: `tests/unit/analysis.test.ts`

- [ ] Test Sonarr aggregation with fixture episodes containing `FuN`, `WvF`, empty file, and missing file.
- [ ] Test Radarr aggregation with fixture movies containing `FuN`, `TSCC`, and missing files.
- [ ] Implement upsert logic for `media_items` and `media_files`.
- [ ] Store `lastAnalyzedAt` after successful analysis.

### Task 7: Quota Service

**Files:**

- Create: `src/main/scheduler/quota-service.ts`
- Create: `tests/unit/quota-service.test.ts`

- [ ] Implement shared rolling 24h search budget.
- [ ] Implement shared rolling 24h grab budget.
- [ ] Implement manual grab entry.
- [ ] Implement budget reservation before search/grab.
- [ ] Test that Sonarr and Radarr activity rows share the same budget.
- [ ] Test that old rows outside 24h do not count.

### Task 8: Search and Grab Services

**Files:**

- Create: `src/main/arr/search-service.ts`
- Create: `src/main/arr/grab-service.ts`
- Create: `tests/unit/search-service.test.ts`
- Create: `tests/unit/grab-service.test.ts`

- [ ] Implement cooldown checks from `activity_log`.
- [ ] Implement Sonarr controlled release search using `GET /release?episodeId=...`.
- [ ] Implement Radarr controlled release search using `GET /release?movieId=...`.
- [ ] Store all release candidates.
- [ ] Filter FuN* candidates.
- [ ] Implement grab selection from stored candidates.
- [ ] Ensure duplicate release GUIDs are not grabbed twice.

### Task 9: Scheduler and Job Runner

**Files:**

- Create: `src/main/scheduler/scheduler.ts`
- Create: `src/main/scheduler/job-runner.ts`
- Create: `src/shared/schedule.ts`
- Create: `tests/unit/schedule.test.ts`
- Create: `tests/unit/job-runner.test.ts`

- [ ] Implement schedule interval types:
  - minutes
  - hours
  - days
  - daily time
- [ ] Implement `nextRunAt` calculation.
- [ ] Implement job queue states.
- [ ] Implement combined job order: analysis, search, grab.
- [ ] Implement budget-blocked status when quota is exhausted.
- [ ] Record progress and event rows during job execution.

### Task 10: IPC Contracts

**Files:**

- Create: `src/shared/ipc-contracts.ts`
- Create: `src/main/ipc.ts`
- Create: `src/renderer/state/ipc-client.ts`
- Create: `tests/unit/ipc-contracts.test.ts`

- [ ] Define typed IPC channels for:
  - settings read/write
  - instance test/save
  - analysis job enqueue
  - search job enqueue
  - grab job enqueue
  - schedule CRUD
  - job list
  - activity log
  - quota summary
  - table data
- [ ] Expose only safe APIs through preload.
- [ ] Test IPC payload validation.

### Task 11: Main Process Shell, Tray, Notifications

**Files:**

- Create: `src/main/app-shell.ts`
- Create: `src/main/tray.ts`
- Create: `src/main/notifications.ts`
- Modify: `src/main/index.ts`

- [ ] Create the browser window.
- [ ] Add tray icon behavior:
  - show app
  - pause scheduler
  - run analysis
  - quit
- [ ] Keep the app running when the window is closed.
- [ ] Add Windows notifications for:
  - job completed
  - job failed
  - budget exhausted
  - FuN candidates found

### Task 12: UI Shell and Design System

**Files:**

- Create: `src/renderer/components/AppFrame.tsx`
- Create: `src/renderer/components/KpiBar.tsx`
- Create: `src/renderer/components/TabNav.tsx`
- Create: `src/renderer/components/IconButton.tsx`
- Create: `src/renderer/components/StatusPill.tsx`
- Create: `src/renderer/components/ReleaseGroupBadge.tsx`
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/styles.css`

- [ ] Implement sticky top KPI/menu bar.
- [ ] Implement tab navigation.
- [ ] Apply dark theme CSS variables.
- [ ] Add tabular numerals globally for KPI and table numbers.
- [ ] Use lucide icons for action buttons.
- [ ] Use exact transition properties, not `transition: all`.
- [ ] Use active press scale `0.96` for buttons.

### Task 13: Data Table Component

**Files:**

- Create: `src/renderer/components/DataTable.tsx`
- Create: `src/renderer/state/table-state.ts`
- Create: `tests/unit/table-state.test.ts`

- [ ] Implement TanStack Table with:
  - sorting
  - column filters
  - global search
  - row selection
  - sticky header
  - virtualized rows
- [ ] Add stable column widths for numeric columns.
- [ ] Add bulk action toolbar.
- [ ] Test filter state serialization.

### Task 14: Sonarr and Radarr Views

**Files:**

- Create: `src/renderer/views/SonarrSeriesView.tsx`
- Create: `src/renderer/views/RadarrMoviesView.tsx`
- Create: `src/renderer/components/JobProgress.tsx`

- [ ] Build Sonarr table with required columns and filters.
- [ ] Build Radarr table with required columns and filters.
- [ ] Add row actions for analyze, search, grab, details, open in ARR.
- [ ] Add bulk actions for selected rows.
- [ ] Show cooldown and budget-blocked states.

### Task 15: Dashboard, Jobs, Quotas, Settings

**Files:**

- Create: `src/renderer/views/DashboardView.tsx`
- Create: `src/renderer/views/JobsView.tsx`
- Create: `src/renderer/views/QuotaView.tsx`
- Create: `src/renderer/views/SettingsView.tsx`

- [ ] Build dashboard KPIs and recent activity.
- [ ] Build jobs table with expandable events.
- [ ] Build quota view with rolling 24h usage and manual grab entry.
- [ ] Build settings view with instance forms, API key save, quota limits, FuN prefixes, cooldowns, schedules, notifications, tray behavior.

### Task 16: End-to-End Verification

**Files:**

- Create: `tests/e2e/app.spec.ts`

- [ ] Start the app in test mode.
- [ ] Verify Settings can save Sonarr and Radarr instances with encrypted keys.
- [ ] Verify Dashboard loads without crashing.
- [ ] Verify Sonarr table supports sort and filter.
- [ ] Verify Radarr table supports sort and filter.
- [ ] Verify a queued analysis job appears in Jobs.
- [ ] Verify sticky KPI bar and sticky table header with a screenshot assertion.
- [ ] Verify notification adapter is called on job completion in test mode.

## Manual Verification Against Live Instances

Use the configured UI, not hard-coded keys, for live verification.

1. Save Sonarr instance:
   - URL: `http://192.168.0.170:8989`
   - API key: enter in Settings UI
2. Save Radarr instance:
   - URL: `http://192.168.0.170:7878`
   - API key: enter in Settings UI
3. Test both connections.
4. Run analysis only.
5. Confirm Sonarr Criminal Record shows `8 / 16` FuN* files and `50%`.
6. Confirm Radarr movie `tmdbId=11397` shows release group `TSCC` and not FuN*.
7. Run search on a small selected set.
8. Confirm search budget decreases.
9. Add manual grab count.
10. Confirm grab budget decreases.
11. Run grab on a single selected FuN* candidate.
12. Confirm activity log records the grab result.

## Completion Criteria

- Sonarr and Radarr instances can be configured from the UI.
- API keys are not stored in plaintext.
- Analysis computes FuN* share for all Sonarr series and Radarr movies.
- Sonarr and Radarr tables are sortable, filterable, and have sticky headers.
- Sticky KPI/menu bar is present across all tabs.
- Search and grab actions are recorded in SQLite.
- Shared rolling 24h budgets are enforced across Sonarr and Radarr.
- Manual grab entries affect the grab budget.
- Scheduled jobs can run analysis, search, grab, or combinations.
- Tray icon keeps the app accessible while running in the background.
- Windows notifications are emitted for important job outcomes.
- Unit tests pass.
- End-to-end UI smoke tests pass.
