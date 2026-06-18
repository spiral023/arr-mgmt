# Automation Goals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build durable, rule-based Automation Goals that can move Sonarr/Radarr libraries toward a configured FuN share target over multiple runs while respecting shared search/grab quotas.

**Architecture:** Add a persistent automation layer with goals, runs, work items, and events. Reuse the existing `JobRunner`, `QuotaService`, ARR clients, analysis persistence, and release candidate storage; extract item-level search/grab helpers only where needed. Renderer state remains IPC-driven and displays typed view models.

**Tech Stack:** Electron, React 18, TypeScript, better-sqlite3, Vitest, Tailwind CSS, lucide-react.

---

## File Map

### Create

- `src/main/automation/automation-types.ts`  
  Main-process domain types for normalized goals, filters, statuses, work items, and run planning.

- `src/main/automation/filtering.ts`  
  Pure filter evaluation for `media_items` + `media_files` rows.

- `src/main/automation/ordering.ts`  
  Pure work-item ordering functions.

- `src/main/automation/quota-safety.ts`  
  Pure safety threshold calculations and quota-stop checks.

- `src/main/automation/automation-runner.ts`  
  Orchestrates goal reconciliation, quota-aware execution, pause/resume, and job events.

- `src/main/automation/automation-ipc.ts`  
  Registers automation IPC handlers and keeps `src/main/ipc.ts` from growing further.

- `src/renderer/views/AutomationGoalsView.tsx`  
  Main Automation Goals tab: list, detail, editor shell, actions, events.

- `tests/unit/automation-filtering.test.ts`  
  Filter behavior tests.

- `tests/unit/automation-ordering.test.ts`  
  Work-item ordering tests.

- `tests/unit/automation-quota-safety.test.ts`  
  Safety threshold tests.

- `tests/unit/automation-repositories.test.ts`  
  Persistence tests for goals, runs, work items, and events.

- `tests/unit/automation-runner.test.ts`  
  Runner behavior tests with fake dependencies.

- `tests/unit/automation-ipc-client.test.ts`  
  Renderer IPC client tests for automation channels.

- `tests/unit/automation-view.test.tsx`  
  Renderer smoke tests for list/editor defaults and pause/resume controls.

### Modify

- `src/main/db/schema.ts`  
  Add automation table names and typed status/action unions.

- `src/main/db/migrations.ts`  
  Create automation tables and indexes; allow `jobs.kind = 'automation'`.

- `src/main/db/repositories.ts`  
  Add `automationGoals`, `automationRuns`, `automationWorkItems`, `automationEvents`, and media-file query helpers.

- `src/main/scheduler/job-runner.ts`  
  Add `JobKind = "automation"`.

- `src/main/settings/app-settings.ts`  
  Add global automation quota safety setting.

- `src/main/ipc.ts`  
  Call `registerAutomationIpcHandlers(state)` and export runner support.

- `src/main/index.ts` or app bootstrap file that calls `registerPersistedSchedules`  
  Trigger startup automation runner after app services are ready.

- `src/shared/ipc-contracts.ts`  
  Add automation channels, shared types, and settings shape.

- `src/renderer/state/ipc-client.ts`  
  Add automation client functions.

- `src/renderer/components/TabNav.tsx`  
  Add `automation` tab.

- `src/renderer/App.tsx`  
  Render `AutomationGoalsView` and refresh KPIs when automation jobs change.

- `src/renderer/views/SettingsView.tsx`  
  Add global quota safety percent setting.

- `tests/unit/db-schema.test.ts`  
  Assert automation tables exist and `automation` job kind is valid.

- `tests/unit/app-settings.test.ts`  
  Assert automation setting defaults and normalization.

---

## Task 1: Schema, Shared Types, and Settings

**Files:**
- Modify: `src/shared/ipc-contracts.ts`
- Modify: `src/main/db/schema.ts`
- Modify: `src/main/db/migrations.ts`
- Modify: `src/main/scheduler/job-runner.ts`
- Modify: `src/main/settings/app-settings.ts`
- Test: `tests/unit/db-schema.test.ts`
- Test: `tests/unit/app-settings.test.ts`

- [ ] **Step 1: Write failing schema tests**

Add to `tests/unit/db-schema.test.ts`:

```ts
it("creates automation tables", () => {
  const db = createInMemoryDatabase();
  migrateDatabase(db);

  const rows = db
    .prepare("select name from sqlite_master where type = 'table' order by name")
    .all() as Array<{ name: string }>;

  expect(rows.map((row) => row.name)).toEqual(
    expect.arrayContaining([
      "automation_events",
      "automation_goals",
      "automation_runs",
      "automation_work_items",
    ]),
  );
});

it("allows automation jobs", () => {
  const db = createInMemoryDatabase();
  migrateDatabase(db);

  expect(() =>
    db.prepare(
      `insert into jobs (
        id, name, kind, target_scope, status, progress_current, progress_total,
        success_count, failure_count, created_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("job-automation", "Automation", "automation", "all", "queued", 0, 0, 0, 0, "2026-06-18T00:00:00.000Z"),
  ).not.toThrow();
});
```

- [ ] **Step 2: Write failing settings test**

Add to `tests/unit/app-settings.test.ts`:

```ts
it("normalizes automation quota safety percent", () => {
  const db = createInMemoryDatabase();
  migrateDatabase(db);
  const repos = createRepositories(db);

  expect(getAppSettings(repos).automation.quotaSafetyPercent).toBe(90);

  updateAppSettings(repos, { automation: { quotaSafetyPercent: 80 } });
  expect(getAppSettings(repos).automation.quotaSafetyPercent).toBe(80);

  updateAppSettings(repos, { automation: { quotaSafetyPercent: 0 } });
  expect(getAppSettings(repos).automation.quotaSafetyPercent).toBe(90);
});
```

- [ ] **Step 3: Run failing tests**

Run:

```powershell
npx vitest run tests/unit/db-schema.test.ts tests/unit/app-settings.test.ts
```

Expected: FAIL because automation tables, `automation` job kind, and `settings.automation` do not exist.

- [ ] **Step 4: Add shared contracts**

In `src/shared/ipc-contracts.ts`, extend `IpcChannel`:

```ts
  | "automation:listGoals"
  | "automation:getGoal"
  | "automation:saveGoal"
  | "automation:deleteGoal"
  | "automation:reorderGoals"
  | "automation:pauseGoal"
  | "automation:resumeGoal"
  | "automation:runGoal"
  | "automation:runEligible"
  | "automation:listEvents";
```

Add shared types near the existing schedule/job types:

```ts
export type AutomationScope = "sonarr" | "radarr" | "both";
export type AutomationActionMode = "search_only" | "search_and_grab";
export type AutomationExecutionStrategy = "grab_immediately" | "search_then_grab";
export type AutomationOrdering = "oldest_search_first" | "lowest_fun_share_first" | "largest_impact_first" | "alphabetical";
export type AutomationManualStatus = "active" | "paused_by_user";
export type AutomationGoalStatus =
  | "enabled"
  | "running"
  | "paused"
  | "waiting_for_quota"
  | "waiting_for_schedule"
  | "blocked_by_error"
  | "target_reached";

export type AutomationTriState = "yes" | "no" | "either";
export type AutomationRecencyFilter =
  | { mode: "any" }
  | { mode: "never" }
  | { mode: "older_than"; days: number }
  | { mode: "within_last"; days: number };

export type AutomationGoalFilters = {
  monitored: AutomationTriState;
  hasFile: AutomationTriState;
  qualityProfiles: string[];
  funShare: { operator: "lt" | "lte" | "gt" | "gte"; value: number } | null;
  analyzed: AutomationRecencyFilter;
  searched: AutomationRecencyFilter;
  grabbed: AutomationRecencyFilter;
};

export type AutomationGoalInput = {
  id?: number;
  name: string;
  enabled: boolean;
  scope: AutomationScope;
  targetFunShare: number;
  filters: AutomationGoalFilters;
  actionMode: AutomationActionMode;
  executionStrategy: AutomationExecutionStrategy;
  ordering: AutomationOrdering;
  minSearchIntervalHours: number;
  runOnStartup: boolean;
  schedule: Pick<ScheduleInput, "enabled" | "intervalKind" | "intervalValue" | "timeOfDay"> | null;
};

export type AutomationGoalView = AutomationGoalInput & {
  id: number;
  priority: number;
  manualStatus: AutomationManualStatus;
  status: AutomationGoalStatus;
  currentFunShare: number;
  matchingFiles: number;
  remainingNonFunFiles: number;
  pendingCandidates: number;
  lastRunAt?: string;
  nextEligibleRunAt?: string;
  lastError?: string;
};

export type AutomationEventView = {
  id: number;
  goalId: number;
  runId?: number;
  level: "info" | "warning" | "error";
  message: string;
  createdAt: string;
};

export type AutomationGoalIdInput = { goalId: number };
export type AutomationReorderInput = { goalIds: number[] };
```

Extend `AppSettings`:

```ts
  automation: { quotaSafetyPercent: number };
```

Extend `AppSettingsInput`:

```ts
  automation: Partial<AppSettings["automation"]>;
```

- [ ] **Step 5: Add schema table names and job kind**

In `src/main/db/schema.ts`, add to `tableNames`:

```ts
  "automation_goals",
  "automation_runs",
  "automation_work_items",
  "automation_events",
```

In `src/main/scheduler/job-runner.ts`, update:

```ts
export type JobKind = "analysis" | "search" | "grab" | "combined" | "automation";
```

In `src/main/db/migrations.ts`, change the jobs `kind` check:

```sql
kind text not null check (kind in ('analysis', 'search', 'grab', 'combined', 'automation')),
```

- [ ] **Step 6: Add automation tables and indexes**

Add these statements before indexes in `src/main/db/migrations.ts`:

```ts
  `create table if not exists automation_goals (
    id integer primary key autoincrement,
    name text not null,
    enabled integer not null default 1,
    priority integer not null,
    scope text not null check (scope in ('sonarr', 'radarr', 'both')),
    target_fun_share real not null,
    filters_json text not null,
    action_mode text not null check (action_mode in ('search_only', 'search_and_grab')),
    execution_strategy text not null check (execution_strategy in ('grab_immediately', 'search_then_grab')),
    ordering text not null check (ordering in ('oldest_search_first', 'lowest_fun_share_first', 'largest_impact_first', 'alphabetical')),
    min_search_interval_hours integer not null,
    run_on_startup integer not null default 0,
    schedule_json text,
    manual_status text not null default 'active' check (manual_status in ('active', 'paused_by_user')),
    last_run_at text,
    next_eligible_run_at text,
    last_error text,
    created_at text not null,
    updated_at text not null
  )`,
  `create table if not exists automation_runs (
    id integer primary key autoincrement,
    goal_id integer not null references automation_goals(id) on delete cascade,
    job_id text references jobs(id) on delete set null,
    trigger text not null check (trigger in ('startup', 'schedule', 'manual', 'resume')),
    status text not null check (status in ('running', 'completed', 'waiting_for_quota', 'target_reached', 'blocked_by_error', 'cancelled')),
    progress_current integer not null default 0,
    progress_total integer not null default 0,
    started_at text not null,
    finished_at text
  )`,
  `create table if not exists automation_work_items (
    id integer primary key autoincrement,
    goal_id integer not null references automation_goals(id) on delete cascade,
    instance_id integer not null references instances(id) on delete cascade,
    media_item_id integer not null references media_items(id) on delete cascade,
    media_file_id integer references media_files(id) on delete set null,
    child_arr_id integer,
    kind text not null check (kind in ('episode', 'movie')),
    title text not null,
    sort_key text not null,
    is_fun integer not null default 0,
    status text not null check (status in ('pending', 'searching', 'candidate_found', 'grabbed', 'satisfied', 'cooldown', 'out_of_scope', 'failed')),
    last_analyzed_at text,
    last_searched_at text,
    last_grabbed_at text,
    search_attempt_count integer not null default 0,
    last_error text,
    updated_at text not null,
    unique(goal_id, instance_id, kind, child_arr_id)
  )`,
  `create table if not exists automation_events (
    id integer primary key autoincrement,
    goal_id integer not null references automation_goals(id) on delete cascade,
    run_id integer references automation_runs(id) on delete set null,
    level text not null check (level in ('info', 'warning', 'error')),
    message text not null,
    created_at text not null
  )`,
```

Add indexes:

```ts
  "create index if not exists idx_automation_goals_priority on automation_goals(priority)",
  "create index if not exists idx_automation_goals_next on automation_goals(enabled, manual_status, next_eligible_run_at)",
  "create index if not exists idx_automation_work_items_goal_status on automation_work_items(goal_id, status)",
  "create index if not exists idx_automation_work_items_goal_sort on automation_work_items(goal_id, sort_key)",
  "create index if not exists idx_automation_runs_goal on automation_runs(goal_id, started_at)",
  "create index if not exists idx_automation_events_goal on automation_events(goal_id, created_at)",
```

- [ ] **Step 7: Add settings default and normalization**

In `src/main/settings/app-settings.ts`, update defaults:

```ts
  automation: { quotaSafetyPercent: 90 },
```

Update `mergeSettings`:

```ts
    automation: { ...current.automation, ...input.automation },
```

Update `normalizeSettings`:

```ts
    automation: {
      quotaSafetyPercent: percentInteger(input.automation?.quotaSafetyPercent, defaultAppSettings.automation.quotaSafetyPercent),
    },
```

Add helper:

```ts
function percentInteger(value: unknown, fallback: number): number {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 100 ? Number(value) : fallback;
}
```

- [ ] **Step 8: Run tests**

Run:

```powershell
npx vitest run tests/unit/db-schema.test.ts tests/unit/app-settings.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit**

```powershell
git add src/shared/ipc-contracts.ts src/main/db/schema.ts src/main/db/migrations.ts src/main/scheduler/job-runner.ts src/main/settings/app-settings.ts tests/unit/db-schema.test.ts tests/unit/app-settings.test.ts
git commit -m "feat: add automation goal schema and settings"
```

---

## Task 2: Automation Repositories

**Files:**
- Modify: `src/main/db/repositories.ts`
- Test: `tests/unit/automation-repositories.test.ts`

- [ ] **Step 1: Write failing repository tests**

Create `tests/unit/automation-repositories.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { MediaItemAnalysis } from "../../src/main/arr/arr-types";
import { createInMemoryDatabase } from "../../src/main/db/client";
import { migrateDatabase } from "../../src/main/db/migrations";
import { createRepositories } from "../../src/main/db/repositories";

const defaultFilters = {
  monitored: "yes",
  hasFile: "yes",
  qualityProfiles: ["WEBDL-1080p"],
  funShare: { operator: "lt", value: 0.95 },
  analyzed: { mode: "any" },
  searched: { mode: "older_than", days: 7 },
  grabbed: { mode: "any" },
} as const;

describe("automation repositories", () => {
  it("creates, updates, lists, pauses, resumes, and reorders goals", () => {
    const db = createInMemoryDatabase();
    migrateDatabase(db);
    const repos = createRepositories(db);

    const goal = repos.automationGoals.upsert({
      name: "Sonarr to 95% FuN",
      enabled: true,
      scope: "sonarr",
      targetFunShare: 0.95,
      filters: defaultFilters,
      actionMode: "search_and_grab",
      executionStrategy: "grab_immediately",
      ordering: "oldest_search_first",
      minSearchIntervalHours: 168,
      runOnStartup: true,
      schedule: null,
      now: new Date("2026-06-18T10:00:00.000Z"),
    });

    expect(goal).toMatchObject({
      id: 1,
      name: "Sonarr to 95% FuN",
      priority: 1,
      manualStatus: "active",
      targetFunShare: 0.95,
    });

    repos.automationGoals.setManualStatus(goal.id, "paused_by_user", new Date("2026-06-18T10:01:00.000Z"));
    expect(repos.automationGoals.find(goal.id)?.manualStatus).toBe("paused_by_user");

    repos.automationGoals.setManualStatus(goal.id, "active", new Date("2026-06-18T10:02:00.000Z"));
    expect(repos.automationGoals.find(goal.id)?.manualStatus).toBe("active");

    const second = repos.automationGoals.upsert({
      ...goal,
      id: undefined,
      name: "Radarr to 95% FuN",
      scope: "radarr",
      now: new Date("2026-06-18T10:03:00.000Z"),
    });
    repos.automationGoals.reorder([second.id, goal.id], new Date("2026-06-18T10:04:00.000Z"));

    expect(repos.automationGoals.list().map((item) => item.id)).toEqual([second.id, goal.id]);
  });

  it("upserts work items from media files and records runs/events", () => {
    const db = createInMemoryDatabase();
    migrateDatabase(db);
    const repos = createRepositories(db);
    const instanceId = repos.instances.upsert({
      kind: "sonarr",
      name: "Sonarr",
      baseUrl: "http://sonarr.local:8989",
      apiKeyEncrypted: "encrypted",
      enabled: true,
      now: new Date("2026-06-18T10:00:00.000Z"),
    });
    const mediaItemId = repos.mediaItems.upsertAnalysis(instanceId, analysis());
    const goal = repos.automationGoals.upsert({
      name: "Goal",
      enabled: true,
      scope: "sonarr",
      targetFunShare: 0.95,
      filters: defaultFilters,
      actionMode: "search_and_grab",
      executionStrategy: "grab_immediately",
      ordering: "oldest_search_first",
      minSearchIntervalHours: 168,
      runOnStartup: true,
      schedule: null,
      now: new Date("2026-06-18T10:00:00.000Z"),
    });

    const files = repos.mediaFiles.listForAutomation({ scope: "sonarr" });
    expect(files).toHaveLength(2);

    repos.automationWorkItems.reconcile(goal.id, [
      {
        instanceId,
        mediaItemId,
        mediaFileId: files[1].mediaFileId,
        childArrId: 102,
        kind: "episode",
        title: "Example Series S01E02",
        sortKey: "example series s01e02",
        isFun: false,
        lastAnalyzedAt: "2026-06-18T10:00:00.000Z",
        lastSearchedAt: null,
        lastGrabbedAt: null,
        status: "pending",
        now: new Date("2026-06-18T10:05:00.000Z"),
      },
    ]);

    expect(repos.automationWorkItems.listForGoal(goal.id)).toEqual([
      expect.objectContaining({ childArrId: 102, status: "pending", title: "Example Series S01E02" }),
    ]);

    const run = repos.automationRuns.start({
      goalId: goal.id,
      trigger: "manual",
      jobId: "job-1",
      now: new Date("2026-06-18T10:06:00.000Z"),
    });
    repos.automationEvents.insert({
      goalId: goal.id,
      runId: run.id,
      level: "info",
      message: "Started",
      createdAt: new Date("2026-06-18T10:06:01.000Z"),
    });

    expect(repos.automationRuns.listForGoal(goal.id)).toEqual([expect.objectContaining({ id: run.id, status: "running" })]);
    expect(repos.automationEvents.list(goal.id, 10)).toEqual([expect.objectContaining({ message: "Started" })]);
  });
});

function analysis(): MediaItemAnalysis {
  return {
    arrId: 7,
    childrenWithFile: 2,
    files: [
      {
        arrFileId: 1001,
        childArrId: 101,
        episodeNumber: 1,
        isFun: true,
        path: "/tv/example/s01e01.mkv",
        qualityName: "WEBDL-1080p",
        releaseGroup: "FuN",
        seasonNumber: 1,
        sizeBytes: 1_000,
      },
      {
        arrFileId: 1002,
        childArrId: 102,
        episodeNumber: 2,
        isFun: false,
        path: "/tv/example/s01e02.mkv",
        qualityName: "WEBDL-1080p",
        releaseGroup: "WvF",
        seasonNumber: 1,
        sizeBytes: 2_000,
      },
    ],
    funChildren: 1,
    funShare: 0.5,
    funSizeBytes: 1_000,
    hasFile: true,
    kind: "series",
    lastAnalyzedAt: "2026-06-18T10:00:00.000Z",
    monitored: true,
    nonFunChildren: 1,
    title: "Example Series",
    titleSlug: "example-series",
    totalChildren: 2,
    totalSizeBytes: 3_000,
  };
}
```

- [ ] **Step 2: Run failing test**

Run:

```powershell
npx vitest run tests/unit/automation-repositories.test.ts
```

Expected: FAIL because repository namespaces do not exist.

- [ ] **Step 3: Add repository row helpers**

In `src/main/db/repositories.ts`, add type aliases near `ScheduleRow`:

```ts
type AutomationGoalRow = {
  id: number;
  name: string;
  enabled: 0 | 1;
  priority: number;
  scope: AutomationGoalView["scope"];
  targetFunShare: number;
  filtersJson: string;
  actionMode: AutomationGoalView["actionMode"];
  executionStrategy: AutomationGoalView["executionStrategy"];
  ordering: AutomationGoalView["ordering"];
  minSearchIntervalHours: number;
  runOnStartup: 0 | 1;
  scheduleJson: string | null;
  manualStatus: AutomationGoalView["manualStatus"];
  lastRunAt: string | null;
  nextEligibleRunAt: string | null;
  lastError: string | null;
};

function formatAutomationGoalRow(row: AutomationGoalRow): AutomationGoalView {
  return {
    id: row.id,
    name: row.name,
    enabled: Boolean(row.enabled),
    priority: row.priority,
    scope: row.scope,
    targetFunShare: row.targetFunShare,
    filters: JSON.parse(row.filtersJson) as AutomationGoalView["filters"],
    actionMode: row.actionMode,
    executionStrategy: row.executionStrategy,
    ordering: row.ordering,
    minSearchIntervalHours: row.minSearchIntervalHours,
    runOnStartup: Boolean(row.runOnStartup),
    schedule: row.scheduleJson ? (JSON.parse(row.scheduleJson) as AutomationGoalView["schedule"]) : null,
    manualStatus: row.manualStatus,
    status: deriveAutomationGoalStatus(row),
    currentFunShare: 0,
    matchingFiles: 0,
    remainingNonFunFiles: 0,
    pendingCandidates: 0,
    lastRunAt: row.lastRunAt ?? undefined,
    nextEligibleRunAt: row.nextEligibleRunAt ?? undefined,
    lastError: row.lastError ?? undefined,
  };
}

function deriveAutomationGoalStatus(row: AutomationGoalRow): AutomationGoalView["status"] {
  if (row.manualStatus === "paused_by_user") return "paused";
  if (row.lastError) return "blocked_by_error";
  if (row.nextEligibleRunAt && new Date(row.nextEligibleRunAt).getTime() > Date.now()) return "waiting_for_schedule";
  return row.enabled ? "enabled" : "paused";
}
```

Add required imports:

```ts
  AutomationEventView,
  AutomationGoalInput,
  AutomationGoalView,
  AutomationManualStatus,
```

- [ ] **Step 4: Add media file automation listing repository**

Inside `createRepositories(db)`, add `mediaFiles` before `releaseCandidates`:

```ts
    mediaFiles: {
      listForAutomation(input: { scope: "sonarr" | "radarr" | "both" }): Array<{
        instanceId: number;
        instanceKind: "sonarr" | "radarr";
        mediaItemId: number;
        mediaKind: "series" | "movie";
        mediaArrId: number;
        mediaTitle: string;
        sortTitle: string | null;
        monitored: boolean;
        hasFile: boolean;
        mediaFunShare: number;
        qualityProfileName: string | null;
        lastAnalyzedAt: string | null;
        mediaFileId: number;
        arrFileId: number | null;
        childArrId: number | null;
        seasonNumber: number | null;
        episodeNumber: number | null;
        releaseGroup: string | null;
        isFun: boolean;
        fileQualityName: string | null;
        sizeBytes: number;
        lastSearchedAt: string | null;
        lastGrabbedAt: string | null;
      }> {
        const kinds = input.scope === "both" ? ["sonarr", "radarr"] : [input.scope];
        const placeholders = kinds.map(() => "?").join(",");
        const rows = db.prepare(
          `with last_activity as (
             select
               instance_id,
               media_item_id,
               child_arr_id,
               max(case when action = 'search' then created_at end) as lastSearchedAt,
               max(case when action = 'grab' then created_at end) as lastGrabbedAt
             from activity_log
             where action in ('search', 'grab')
             group by instance_id, media_item_id, child_arr_id
           )
           select
             i.id as instanceId,
             i.kind as instanceKind,
             mi.id as mediaItemId,
             mi.kind as mediaKind,
             mi.arr_id as mediaArrId,
             mi.title as mediaTitle,
             mi.sort_title as sortTitle,
             mi.monitored,
             mi.has_file as hasFile,
             mi.fun_share as mediaFunShare,
             mi.quality_profile_name as qualityProfileName,
             mi.last_analyzed_at as lastAnalyzedAt,
             mf.id as mediaFileId,
             mf.arr_file_id as arrFileId,
             mf.child_arr_id as childArrId,
             mf.season_number as seasonNumber,
             mf.episode_number as episodeNumber,
             mf.release_group as releaseGroup,
             mf.is_fun as isFun,
             mf.quality_name as fileQualityName,
             mf.size_bytes as sizeBytes,
             la.lastSearchedAt,
             la.lastGrabbedAt
           from media_files mf
           join media_items mi on mi.id = mf.media_item_id
           join instances i on i.id = mi.instance_id
           left join last_activity la
             on la.instance_id = i.id
            and la.media_item_id = mi.id
            and coalesce(la.child_arr_id, -1) = coalesce(mf.child_arr_id, -1)
           where i.kind in (${placeholders})
           order by mi.title collate nocase, mf.season_number, mf.episode_number, mf.id`,
        ).all(...kinds) as Array<any>;

        return rows.map((row) => ({
          ...row,
          monitored: Boolean(row.monitored),
          hasFile: Boolean(row.hasFile),
          isFun: Boolean(row.isFun),
        }));
      },
    },
```

- [ ] **Step 5: Add automation repository namespaces**

Inside `createRepositories(db)`, add `automationGoals`, `automationWorkItems`, `automationRuns`, and `automationEvents` after `schedules`.

Use these public methods:

```ts
automationGoals: {
  upsert(input: AutomationGoalInput & { now: Date }): AutomationGoalView;
  list(): AutomationGoalView[];
  find(id: number): AutomationGoalView | undefined;
  delete(id: number): void;
  reorder(goalIds: number[], now: Date): void;
  setManualStatus(id: number, status: AutomationManualStatus, now: Date): void;
  markRunResult(id: number, input: { lastRunAt: Date; nextEligibleRunAt?: Date | null; lastError?: string | null }): void;
}
```

The `upsert` method should calculate the next priority for new goals:

```ts
const nextPriority = input.id
  ? undefined
  : ((db.prepare("select coalesce(max(priority), 0) + 1 as priority from automation_goals").get() as { priority: number }).priority);
```

Use `JSON.stringify(input.filters)` and `JSON.stringify(input.schedule)` for JSON fields.

Add `automationWorkItems.reconcile(goalId, desiredItems)` by:

1. Select existing IDs for `goal_id`.
2. Upsert desired items by unique `(goal_id, instance_id, kind, child_arr_id)`.
3. Mark existing IDs missing from desired items as `out_of_scope`.

Add `automationRuns.start`, `automationRuns.finish`, `automationRuns.updateProgress`, `automationRuns.listForGoal`.

Add `automationEvents.insert` and `automationEvents.list(goalId, limit)`.

- [ ] **Step 6: Run repository tests**

Run:

```powershell
npx vitest run tests/unit/automation-repositories.test.ts tests/unit/repositories.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/main/db/repositories.ts tests/unit/automation-repositories.test.ts
git commit -m "feat: add automation repositories"
```

---

## Task 3: Pure Automation Rules

**Files:**
- Create: `src/main/automation/automation-types.ts`
- Create: `src/main/automation/filtering.ts`
- Create: `src/main/automation/ordering.ts`
- Create: `src/main/automation/quota-safety.ts`
- Test: `tests/unit/automation-filtering.test.ts`
- Test: `tests/unit/automation-ordering.test.ts`
- Test: `tests/unit/automation-quota-safety.test.ts`

- [ ] **Step 1: Write failing filtering tests**

Create `tests/unit/automation-filtering.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { matchesAutomationFilters } from "../../src/main/automation/filtering";
import type { AutomationMediaFile } from "../../src/main/automation/automation-types";

const baseFile: AutomationMediaFile = {
  instanceId: 1,
  instanceKind: "sonarr",
  mediaItemId: 10,
  mediaKind: "series",
  mediaArrId: 7,
  mediaTitle: "Example Series",
  sortTitle: "example series",
  monitored: true,
  hasFile: true,
  mediaFunShare: 0.5,
  qualityProfileName: "WEBDL-1080p",
  lastAnalyzedAt: "2026-06-10T10:00:00.000Z",
  mediaFileId: 100,
  arrFileId: 1001,
  childArrId: 102,
  seasonNumber: 1,
  episodeNumber: 2,
  releaseGroup: "WvF",
  isFun: false,
  fileQualityName: "WEBDL-1080p",
  sizeBytes: 2_000,
  lastSearchedAt: "2026-06-01T10:00:00.000Z",
  lastGrabbedAt: null,
};

describe("automation filtering", () => {
  it("matches AND filters for monitored, file presence, quality profile, FuN share, and recency", () => {
    expect(
      matchesAutomationFilters(baseFile, {
        monitored: "yes",
        hasFile: "yes",
        qualityProfiles: ["WEBDL-1080p"],
        funShare: { operator: "lt", value: 0.95 },
        analyzed: { mode: "within_last", days: 30 },
        searched: { mode: "older_than", days: 7 },
        grabbed: { mode: "never" },
      }, new Date("2026-06-18T10:00:00.000Z")),
    ).toBe(true);
  });

  it("rejects files that fail any AND filter", () => {
    expect(
      matchesAutomationFilters({ ...baseFile, monitored: false }, {
        monitored: "yes",
        hasFile: "yes",
        qualityProfiles: [],
        funShare: null,
        analyzed: { mode: "any" },
        searched: { mode: "any" },
        grabbed: { mode: "any" },
      }, new Date("2026-06-18T10:00:00.000Z")),
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Write failing ordering tests**

Create `tests/unit/automation-ordering.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { orderAutomationWorkItems } from "../../src/main/automation/ordering";
import type { AutomationWorkItemForOrdering } from "../../src/main/automation/automation-types";

describe("automation ordering", () => {
  it("defaults to oldest search first and never searched alphabetically", () => {
    const items: AutomationWorkItemForOrdering[] = [
      { id: 1, sortKey: "zeta", lastSearchedAt: null, mediaFunShare: 0.2, sizeBytes: 1 },
      { id: 2, sortKey: "alpha", lastSearchedAt: null, mediaFunShare: 0.2, sizeBytes: 1 },
      { id: 3, sortKey: "middle", lastSearchedAt: "2026-06-10T10:00:00.000Z", mediaFunShare: 0.2, sizeBytes: 1 },
      { id: 4, sortKey: "oldest", lastSearchedAt: "2026-06-01T10:00:00.000Z", mediaFunShare: 0.2, sizeBytes: 1 },
    ];

    expect(orderAutomationWorkItems(items, "oldest_search_first").map((item) => item.id)).toEqual([4, 3, 2, 1]);
  });
});
```

- [ ] **Step 3: Write failing quota safety tests**

Create `tests/unit/automation-quota-safety.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { getAutomationSafetyLimit, shouldStopForQuotaSafety } from "../../src/main/automation/quota-safety";

describe("automation quota safety", () => {
  it("calculates floor safety limits", () => {
    expect(getAutomationSafetyLimit(10_000, 90)).toBe(9_000);
    expect(getAutomationSafetyLimit(401, 90)).toBe(360);
  });

  it("stops when used reaches the safety limit", () => {
    expect(shouldStopForQuotaSafety({ used: 8_999, limit: 10_000, safetyPercent: 90 })).toBe(false);
    expect(shouldStopForQuotaSafety({ used: 9_000, limit: 10_000, safetyPercent: 90 })).toBe(true);
  });
});
```

- [ ] **Step 4: Run failing tests**

Run:

```powershell
npx vitest run tests/unit/automation-filtering.test.ts tests/unit/automation-ordering.test.ts tests/unit/automation-quota-safety.test.ts
```

Expected: FAIL because modules do not exist.

- [ ] **Step 5: Implement automation types**

Create `src/main/automation/automation-types.ts`:

```ts
import type {
  AutomationGoalFilters,
  AutomationOrdering,
  AutomationWorkItemView,
} from "../../shared/ipc-contracts";

export type AutomationMediaFile = {
  instanceId: number;
  instanceKind: "sonarr" | "radarr";
  mediaItemId: number;
  mediaKind: "series" | "movie";
  mediaArrId: number;
  mediaTitle: string;
  sortTitle: string | null;
  monitored: boolean;
  hasFile: boolean;
  mediaFunShare: number;
  qualityProfileName: string | null;
  lastAnalyzedAt: string | null;
  mediaFileId: number;
  arrFileId: number | null;
  childArrId: number | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  releaseGroup: string | null;
  isFun: boolean;
  fileQualityName: string | null;
  sizeBytes: number;
  lastSearchedAt: string | null;
  lastGrabbedAt: string | null;
};

export type DesiredAutomationWorkItem = {
  instanceId: number;
  mediaItemId: number;
  mediaFileId: number;
  childArrId: number | null;
  kind: "episode" | "movie";
  title: string;
  sortKey: string;
  isFun: boolean;
  lastAnalyzedAt: string | null;
  lastSearchedAt: string | null;
  lastGrabbedAt: string | null;
  status: "pending" | "satisfied" | "cooldown";
  now: Date;
};

export type AutomationWorkItemForOrdering = {
  id: number;
  sortKey: string;
  lastSearchedAt: string | null;
  mediaFunShare: number;
  sizeBytes: number;
};

export type { AutomationGoalFilters, AutomationOrdering, AutomationWorkItemView };
```

If `AutomationWorkItemView` is not yet defined in shared contracts, add:

```ts
export type AutomationWorkItemView = {
  id: number;
  goalId: number;
  instanceId: number;
  mediaItemId: number;
  mediaFileId?: number;
  childArrId?: number;
  kind: "episode" | "movie";
  title: string;
  sortKey: string;
  isFun: boolean;
  status: "pending" | "searching" | "candidate_found" | "grabbed" | "satisfied" | "cooldown" | "out_of_scope" | "failed";
  lastAnalyzedAt?: string;
  lastSearchedAt?: string;
  lastGrabbedAt?: string;
  searchAttemptCount: number;
  lastError?: string;
};
```

- [ ] **Step 6: Implement filtering**

Create `src/main/automation/filtering.ts`:

```ts
import type { AutomationGoalFilters } from "../../shared/ipc-contracts";
import type { AutomationMediaFile } from "./automation-types";

export function matchesAutomationFilters(file: AutomationMediaFile, filters: AutomationGoalFilters, now: Date): boolean {
  return (
    matchesTriState(file.monitored, filters.monitored) &&
    matchesTriState(file.hasFile, filters.hasFile) &&
    matchesQuality(file.qualityProfileName, filters.qualityProfiles) &&
    matchesFunShare(file.mediaFunShare, filters.funShare) &&
    matchesRecency(file.lastAnalyzedAt, filters.analyzed, now) &&
    matchesRecency(file.lastSearchedAt, filters.searched, now) &&
    matchesRecency(file.lastGrabbedAt, filters.grabbed, now)
  );
}

function matchesTriState(value: boolean, expected: "yes" | "no" | "either"): boolean {
  if (expected === "either") return true;
  return expected === "yes" ? value : !value;
}

function matchesQuality(value: string | null, allowed: string[]): boolean {
  return allowed.length === 0 || (value !== null && allowed.includes(value));
}

function matchesFunShare(value: number, filter: AutomationGoalFilters["funShare"]): boolean {
  if (!filter) return true;
  if (filter.operator === "lt") return value < filter.value;
  if (filter.operator === "lte") return value <= filter.value;
  if (filter.operator === "gt") return value > filter.value;
  return value >= filter.value;
}

function matchesRecency(value: string | null, filter: AutomationGoalFilters["analyzed"], now: Date): boolean {
  if (filter.mode === "any") return true;
  if (filter.mode === "never") return value === null;
  if (!value) return false;
  const ageMs = now.getTime() - new Date(value).getTime();
  const thresholdMs = filter.days * 24 * 60 * 60 * 1000;
  return filter.mode === "older_than" ? ageMs > thresholdMs : ageMs <= thresholdMs;
}
```

- [ ] **Step 7: Implement ordering**

Create `src/main/automation/ordering.ts`:

```ts
import type { AutomationOrdering } from "../../shared/ipc-contracts";
import type { AutomationWorkItemForOrdering } from "./automation-types";

export function orderAutomationWorkItems<T extends AutomationWorkItemForOrdering>(items: T[], ordering: AutomationOrdering): T[] {
  return [...items].sort((a, b) => compareItems(a, b, ordering));
}

function compareItems(a: AutomationWorkItemForOrdering, b: AutomationWorkItemForOrdering, ordering: AutomationOrdering): number {
  if (ordering === "oldest_search_first") {
    return compareSearchAge(a, b) || compareAlpha(a, b);
  }
  if (ordering === "lowest_fun_share_first") {
    return a.mediaFunShare - b.mediaFunShare || compareAlpha(a, b);
  }
  if (ordering === "largest_impact_first") {
    return b.sizeBytes - a.sizeBytes || compareAlpha(a, b);
  }
  return compareAlpha(a, b);
}

function compareSearchAge(a: AutomationWorkItemForOrdering, b: AutomationWorkItemForOrdering): number {
  if (a.lastSearchedAt && b.lastSearchedAt) {
    return new Date(a.lastSearchedAt).getTime() - new Date(b.lastSearchedAt).getTime();
  }
  if (a.lastSearchedAt) return -1;
  if (b.lastSearchedAt) return 1;
  return 0;
}

function compareAlpha(a: AutomationWorkItemForOrdering, b: AutomationWorkItemForOrdering): number {
  return a.sortKey.localeCompare(b.sortKey, undefined, { sensitivity: "base" });
}
```

- [ ] **Step 8: Implement quota safety**

Create `src/main/automation/quota-safety.ts`:

```ts
export function getAutomationSafetyLimit(limit: number, safetyPercent: number): number {
  return Math.floor(limit * (safetyPercent / 100));
}

export function shouldStopForQuotaSafety(input: { used: number; limit: number; safetyPercent: number }): boolean {
  return input.used >= getAutomationSafetyLimit(input.limit, input.safetyPercent);
}

export function nextQuotaEligibleAt(now: Date, minimumDelayHours = 24): Date {
  return new Date(now.getTime() + minimumDelayHours * 60 * 60 * 1000);
}
```

- [ ] **Step 9: Run pure rule tests**

Run:

```powershell
npx vitest run tests/unit/automation-filtering.test.ts tests/unit/automation-ordering.test.ts tests/unit/automation-quota-safety.test.ts
```

Expected: PASS.

- [ ] **Step 10: Commit**

```powershell
git add src/main/automation/automation-types.ts src/main/automation/filtering.ts src/main/automation/ordering.ts src/main/automation/quota-safety.ts tests/unit/automation-filtering.test.ts tests/unit/automation-ordering.test.ts tests/unit/automation-quota-safety.test.ts src/shared/ipc-contracts.ts
git commit -m "feat: add automation rule engine"
```

---

## Task 4: Goal Reconciliation and Runner Skeleton

**Files:**
- Create: `src/main/automation/automation-runner.ts`
- Modify: `src/main/db/repositories.ts`
- Test: `tests/unit/automation-runner.test.ts`

- [ ] **Step 1: Write failing runner reconciliation tests**

Create `tests/unit/automation-runner.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { AutomationGoalRunner } from "../../src/main/automation/automation-runner";
import { createInMemoryDatabase } from "../../src/main/db/client";
import { migrateDatabase } from "../../src/main/db/migrations";
import { createRepositories } from "../../src/main/db/repositories";

describe("AutomationGoalRunner", () => {
  it("reconciles matching Non-FuN files into work items", async () => {
    const db = createInMemoryDatabase();
    migrateDatabase(db);
    const repos = createRepositories(db);
    const instanceId = repos.instances.upsert({
      kind: "sonarr",
      name: "Sonarr",
      baseUrl: "http://sonarr.local:8989",
      apiKeyEncrypted: "encrypted",
      enabled: true,
      now: new Date("2026-06-18T10:00:00.000Z"),
    });
    repos.mediaItems.upsertAnalysis(instanceId, {
      arrId: 7,
      childrenWithFile: 1,
      files: [{
        arrFileId: 1002,
        childArrId: 102,
        episodeNumber: 2,
        isFun: false,
        path: "/tv/example/s01e02.mkv",
        qualityName: "WEBDL-1080p",
        releaseGroup: "WvF",
        seasonNumber: 1,
        sizeBytes: 2_000,
      }],
      funChildren: 0,
      funShare: 0,
      funSizeBytes: 0,
      hasFile: true,
      kind: "series",
      lastAnalyzedAt: "2026-06-18T10:00:00.000Z",
      monitored: true,
      nonFunChildren: 1,
      title: "Example Series",
      totalChildren: 1,
      totalSizeBytes: 2_000,
    });
    const goal = repos.automationGoals.upsert({
      name: "Goal",
      enabled: true,
      scope: "sonarr",
      targetFunShare: 0.95,
      filters: {
        monitored: "yes",
        hasFile: "yes",
        qualityProfiles: ["WEBDL-1080p"],
        funShare: { operator: "lt", value: 0.95 },
        analyzed: { mode: "any" },
        searched: { mode: "any" },
        grabbed: { mode: "any" },
      },
      actionMode: "search_only",
      executionStrategy: "grab_immediately",
      ordering: "oldest_search_first",
      minSearchIntervalHours: 168,
      runOnStartup: true,
      schedule: null,
      now: new Date("2026-06-18T10:00:00.000Z"),
    });

    const runner = new AutomationGoalRunner({
      repositories: repos,
      now: () => new Date("2026-06-18T10:00:00.000Z"),
      testConnection: vi.fn(async () => undefined),
      executeItem: vi.fn(async () => ({ status: "searched", candidateFound: false, grabbed: false })),
      getQuotaSummary: () => ({
        search: { used: 0, remaining: 100, limit: 100 },
        grab: { used: 0, remaining: 100, limit: 100 },
      }),
      quotaSafetyPercent: () => 90,
    });

    await runner.reconcileGoal(goal.id);

    expect(repos.automationWorkItems.listForGoal(goal.id)).toEqual([
      expect.objectContaining({
        childArrId: 102,
        kind: "episode",
        status: "pending",
        title: "Example Series S01E02",
      }),
    ]);
  });
});
```

- [ ] **Step 2: Run failing test**

Run:

```powershell
npx vitest run tests/unit/automation-runner.test.ts
```

Expected: FAIL because `AutomationGoalRunner` does not exist or repository methods are incomplete.

- [ ] **Step 3: Implement runner skeleton**

Create `src/main/automation/automation-runner.ts`:

```ts
import type { QuotaSummary } from "../../shared/ipc-contracts";
import type { createRepositories } from "../db/repositories";
import { matchesAutomationFilters } from "./filtering";
import { shouldStopForQuotaSafety } from "./quota-safety";

type Repositories = ReturnType<typeof createRepositories>;

export type AutomationExecuteItemResult = {
  status: "searched" | "candidate_found" | "grabbed" | "failed";
  candidateFound: boolean;
  grabbed: boolean;
  error?: string;
};

export type AutomationGoalRunnerOptions = {
  repositories: Repositories;
  now: () => Date;
  testConnection: (scope: "sonarr" | "radarr" | "both") => Promise<void>;
  executeItem: (input: { goalId: number; workItemId: number }) => Promise<AutomationExecuteItemResult>;
  getQuotaSummary: () => QuotaSummary;
  quotaSafetyPercent: () => number;
};

export class AutomationGoalRunner {
  constructor(private readonly options: AutomationGoalRunnerOptions) {}

  async reconcileGoal(goalId: number): Promise<void> {
    const goal = this.requireGoal(goalId);
    await this.options.testConnection(goal.scope);
    const now = this.options.now();
    const files = this.options.repositories.mediaFiles.listForAutomation({ scope: goal.scope });
    const desired = files
      .filter((file) => matchesAutomationFilters(file, goal.filters, now))
      .map((file) => {
        const episodeSuffix =
          file.instanceKind === "sonarr" && file.seasonNumber !== null && file.episodeNumber !== null
            ? ` S${String(file.seasonNumber).padStart(2, "0")}E${String(file.episodeNumber).padStart(2, "0")}`
            : "";
        const isSatisfied = file.isFun;
        return {
          instanceId: file.instanceId,
          mediaItemId: file.mediaItemId,
          mediaFileId: file.mediaFileId,
          childArrId: file.childArrId,
          kind: file.instanceKind === "sonarr" ? "episode" as const : "movie" as const,
          title: `${file.mediaTitle}${episodeSuffix}`,
          sortKey: `${file.sortTitle ?? file.mediaTitle}${episodeSuffix}`.toLowerCase(),
          isFun: file.isFun,
          lastAnalyzedAt: file.lastAnalyzedAt,
          lastSearchedAt: file.lastSearchedAt,
          lastGrabbedAt: file.lastGrabbedAt,
          status: isSatisfied ? "satisfied" as const : "pending" as const,
          now,
        };
      });

    this.options.repositories.automationWorkItems.reconcile(goal.id, desired);
    this.options.repositories.automationEvents.insert({
      goalId: goal.id,
      level: "info",
      message: `Reconciled ${desired.length} matching file(s)`,
      createdAt: now,
    });
  }

  async runGoal(goalId: number, trigger: "startup" | "schedule" | "manual" | "resume", jobId?: string): Promise<void> {
    const goal = this.requireGoal(goalId);
    if (!goal.enabled || goal.manualStatus === "paused_by_user") {
      return;
    }
    await this.reconcileGoal(goalId);
    const run = this.options.repositories.automationRuns.start({ goalId, trigger, jobId, now: this.options.now() });
    const quota = this.options.getQuotaSummary();
    const safetyPercent = this.options.quotaSafetyPercent();
    if (
      shouldStopForQuotaSafety({ used: quota.search.used, limit: quota.search.limit, safetyPercent }) ||
      shouldStopForQuotaSafety({ used: quota.grab.used, limit: quota.grab.limit, safetyPercent })
    ) {
      this.options.repositories.automationRuns.finish(run.id, {
        status: "waiting_for_quota",
        finishedAt: this.options.now(),
      });
      return;
    }
    this.options.repositories.automationRuns.finish(run.id, {
      status: "completed",
      finishedAt: this.options.now(),
    });
  }

  private requireGoal(goalId: number) {
    const goal = this.options.repositories.automationGoals.find(goalId);
    if (!goal) {
      throw new Error(`Automation goal ${goalId} not found`);
    }
    return goal;
  }
}
```

- [ ] **Step 4: Add missing repository method signatures used by runner**

If Task 2 did not add these methods completely, implement:

```ts
automationWorkItems.listForGoal(goalId: number): AutomationWorkItemView[]
automationRuns.finish(id: number, input: { status: AutomationRunStatus; finishedAt: Date }): void
```

Add `AutomationRunStatus` to shared contracts if needed:

```ts
export type AutomationRunStatus = "running" | "completed" | "waiting_for_quota" | "target_reached" | "blocked_by_error" | "cancelled";
```

- [ ] **Step 5: Run runner tests**

Run:

```powershell
npx vitest run tests/unit/automation-runner.test.ts tests/unit/automation-repositories.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/main/automation/automation-runner.ts src/main/db/repositories.ts tests/unit/automation-runner.test.ts src/shared/ipc-contracts.ts
git commit -m "feat: add automation goal reconciliation"
```

---

## Task 5: ARR Item Execution Adapter

**Files:**
- Modify: `src/main/ipc.ts`
- Create or modify: `src/main/automation/automation-runner.ts`
- Test: `tests/unit/automation-runner.test.ts`

- [ ] **Step 1: Add runner test for immediate grab strategy**

Add to `tests/unit/automation-runner.test.ts`:

```ts
it("executes pending work items with grab_immediately strategy", async () => {
  const calls: number[] = [];
  const repos = makeAutomationReposWithOnePendingItem({
    actionMode: "search_and_grab",
    executionStrategy: "grab_immediately",
  });
  const runner = new AutomationGoalRunner({
    repositories: repos,
    now: () => new Date("2026-06-18T10:00:00.000Z"),
    testConnection: vi.fn(async () => undefined),
    executeItem: vi.fn(async ({ workItemId }) => {
      calls.push(workItemId);
      return { status: "grabbed", candidateFound: true, grabbed: true };
    }),
    getQuotaSummary: () => ({
      search: { used: 0, remaining: 100, limit: 100 },
      grab: { used: 0, remaining: 100, limit: 100 },
    }),
    quotaSafetyPercent: () => 90,
  });

  await runner.runGoal(1, "manual", "job-1");

  expect(calls).toEqual([1]);
  expect(repos.automationWorkItems.listForGoal(1)[0]).toEqual(expect.objectContaining({ status: "grabbed" }));
});
```

Add a local helper in the test file:

```ts
function makeAutomationReposWithOnePendingItem(input: {
  actionMode: "search_only" | "search_and_grab";
  executionStrategy: "grab_immediately" | "search_then_grab";
}) {
  const db = createInMemoryDatabase();
  migrateDatabase(db);
  const repos = createRepositories(db);
  const goal = repos.automationGoals.upsert({
    name: "Goal",
    enabled: true,
    scope: "sonarr",
    targetFunShare: 0.95,
    filters: {
      monitored: "either",
      hasFile: "either",
      qualityProfiles: [],
      funShare: null,
      analyzed: { mode: "any" },
      searched: { mode: "any" },
      grabbed: { mode: "any" },
    },
    actionMode: input.actionMode,
    executionStrategy: input.executionStrategy,
    ordering: "oldest_search_first",
    minSearchIntervalHours: 168,
    runOnStartup: true,
    schedule: null,
    now: new Date("2026-06-18T10:00:00.000Z"),
  });
  const instanceId = repos.instances.upsert({
    kind: "sonarr",
    name: "Sonarr",
    baseUrl: "http://sonarr.local:8989",
    apiKeyEncrypted: "encrypted",
    enabled: true,
    now: new Date("2026-06-18T10:00:00.000Z"),
  });
  repos.automationWorkItems.reconcile(goal.id, [{
    instanceId,
    mediaItemId: 1,
    mediaFileId: 1,
    childArrId: 101,
    kind: "episode",
    title: "Item",
    sortKey: "item",
    isFun: false,
    lastAnalyzedAt: null,
    lastSearchedAt: null,
    lastGrabbedAt: null,
    status: "pending",
    now: new Date("2026-06-18T10:00:00.000Z"),
  }]);
  return repos;
}
```

- [ ] **Step 2: Run failing runner test**

Run:

```powershell
npx vitest run tests/unit/automation-runner.test.ts
```

Expected: FAIL because `runGoal` does not execute items.

- [ ] **Step 3: Implement work-item execution loop**

In `src/main/automation/automation-runner.ts`, update `runGoal` after quota pre-check:

```ts
const items = this.options.repositories.automationWorkItems.listRunnableForGoal(goal.id, goal.ordering);
this.options.repositories.automationRuns.updateProgress(run.id, { current: 0, total: items.length });

let current = 0;
for (const item of items) {
  const latestGoal = this.requireGoal(goal.id);
  if (latestGoal.manualStatus === "paused_by_user") {
    this.options.repositories.automationRuns.finish(run.id, { status: "cancelled", finishedAt: this.options.now() });
    return;
  }

  const latestQuota = this.options.getQuotaSummary();
  if (
    shouldStopForQuotaSafety({ used: latestQuota.search.used, limit: latestQuota.search.limit, safetyPercent }) ||
    shouldStopForQuotaSafety({ used: latestQuota.grab.used, limit: latestQuota.grab.limit, safetyPercent })
  ) {
    const next = nextQuotaEligibleAt(this.options.now());
    this.options.repositories.automationGoals.markRunResult(goal.id, {
      lastRunAt: this.options.now(),
      nextEligibleRunAt: next,
      lastError: null,
    });
    this.options.repositories.automationRuns.finish(run.id, { status: "waiting_for_quota", finishedAt: this.options.now() });
    return;
  }

  this.options.repositories.automationWorkItems.markStatus(item.id, "searching", this.options.now());
  const result = await this.options.executeItem({ goalId: goal.id, workItemId: item.id });
  this.options.repositories.automationWorkItems.markExecutionResult(item.id, {
    status: result.status === "grabbed" ? "grabbed" : result.status === "candidate_found" ? "candidate_found" : result.status === "failed" ? "failed" : "pending",
    searchedAt: this.options.now(),
    grabbedAt: result.grabbed ? this.options.now() : null,
    error: result.error ?? null,
  });
  current += 1;
  this.options.repositories.automationRuns.updateProgress(run.id, { current, total: items.length });
}

this.options.repositories.automationGoals.markRunResult(goal.id, {
  lastRunAt: this.options.now(),
  nextEligibleRunAt: null,
  lastError: null,
});
this.options.repositories.automationRuns.finish(run.id, { status: "completed", finishedAt: this.options.now() });
```

Import `nextQuotaEligibleAt`.

- [ ] **Step 4: Implement repository methods required by loop**

Add to `automationWorkItems`:

```ts
listRunnableForGoal(goalId: number, ordering: AutomationOrdering): Array<AutomationWorkItemView & { mediaFunShare: number; sizeBytes: number }>
markStatus(id: number, status: AutomationWorkItemView["status"], now: Date): void
markExecutionResult(id: number, input: { status: AutomationWorkItemView["status"]; searchedAt: Date; grabbedAt: Date | null; error: string | null }): void
```

`listRunnableForGoal` should select statuses `pending`, `candidate_found`, and `failed` when `last_error` is not a systemic block. It should join `media_items` and `media_files` to include `mediaFunShare` and `sizeBytes`, then call `orderAutomationWorkItems`.

- [ ] **Step 5: Extract ARR adapter entry point**

In `src/main/ipc.ts`, export a narrow function that automation can call:

```ts
export async function executeAutomationWorkItem(
  state: IpcState,
  input: { goalId: number; workItemId: number },
): Promise<AutomationExecuteItemResult> {
  const item = state.repositories.automationWorkItems.find(input.workItemId);
  if (!item) {
    return { status: "failed", candidateFound: false, grabbed: false, error: "Work item not found" };
  }
  if (item.kind === "episode") {
    return executeAutomationSonarrEpisode(state, item);
  }
  return executeAutomationRadarrMovie(state, item);
}
```

Implement `executeAutomationSonarrEpisode` and `executeAutomationRadarrMovie` by reusing the logic already present in `searchSonarrCandidates`, `searchRadarrCandidates`, `grabSonarrCandidates`, and `grabRadarrCandidates`:

- reserve search via `createQuotaService(state).reserve("search", ...)`
- query releases for the item's `childArrId`
- store `releaseCandidates.insert(...)` for the best FuN candidate
- if goal action mode is `search_and_grab` and strategy is `grab_immediately`, reserve grab and post `grabRelease`
- complete reservations with success/failed
- return `candidate_found`, `grabbed`, `searched`, or `failed`

Keep this adapter small. Move duplicated release-selection details into helper functions inside `ipc.ts` only if the patch becomes hard to review.

- [ ] **Step 6: Run runner tests**

Before running tests, add the `search_then_grab` branch in `AutomationGoalRunner.runGoal`. Use separate phases so the runner first searches all eligible items, then grabs items whose status became `candidate_found`:

```ts
if (goal.executionStrategy === "search_then_grab") {
  const searchItems = this.options.repositories.automationWorkItems.listRunnableForGoal(goal.id, goal.ordering);
  this.options.repositories.automationRuns.updateProgress(run.id, { current: 0, total: searchItems.length });

  let current = 0;
  for (const item of searchItems) {
    if (this.shouldStopForCurrentQuota(safetyPercent)) {
      this.finishWaitingForQuota(goal.id, run.id);
      return;
    }
    this.options.repositories.automationWorkItems.markStatus(item.id, "searching", this.options.now());
    const result = await this.options.executeItem({ goalId: goal.id, workItemId: item.id, phase: "search" });
    this.options.repositories.automationWorkItems.markExecutionResult(item.id, {
      status: result.candidateFound ? "candidate_found" : result.status === "failed" ? "failed" : "pending",
      searchedAt: this.options.now(),
      grabbedAt: null,
      error: result.error ?? null,
    });
    current += 1;
    this.options.repositories.automationRuns.updateProgress(run.id, { current, total: searchItems.length });
  }

  if (goal.actionMode === "search_and_grab") {
    const grabItems = this.options.repositories.automationWorkItems.listCandidateItemsForGoal(goal.id, goal.ordering);
    this.options.repositories.automationRuns.updateProgress(run.id, { current: 0, total: grabItems.length });
    current = 0;
    for (const item of grabItems) {
      if (this.shouldStopForCurrentQuota(safetyPercent)) {
        this.finishWaitingForQuota(goal.id, run.id);
        return;
      }
      const result = await this.options.executeItem({ goalId: goal.id, workItemId: item.id, phase: "grab" });
      this.options.repositories.automationWorkItems.markExecutionResult(item.id, {
        status: result.grabbed ? "grabbed" : result.status === "failed" ? "failed" : "candidate_found",
        searchedAt: item.lastSearchedAt ? new Date(item.lastSearchedAt) : this.options.now(),
        grabbedAt: result.grabbed ? this.options.now() : null,
        error: result.error ?? null,
      });
      current += 1;
      this.options.repositories.automationRuns.updateProgress(run.id, { current, total: grabItems.length });
    }
  }
}
```

Add private helpers used above:

```ts
private shouldStopForCurrentQuota(safetyPercent: number): boolean {
  const quota = this.options.getQuotaSummary();
  return (
    shouldStopForQuotaSafety({ used: quota.search.used, limit: quota.search.limit, safetyPercent }) ||
    shouldStopForQuotaSafety({ used: quota.grab.used, limit: quota.grab.limit, safetyPercent })
  );
}

private finishWaitingForQuota(goalId: number, runId: number): void {
  const now = this.options.now();
  this.options.repositories.automationGoals.markRunResult(goalId, {
    lastRunAt: now,
    nextEligibleRunAt: nextQuotaEligibleAt(now),
    lastError: null,
  });
  this.options.repositories.automationRuns.finish(runId, { status: "waiting_for_quota", finishedAt: now });
}
```

Update `AutomationGoalRunnerOptions.executeItem` and its implementations to accept an optional phase:

```ts
executeItem: (input: { goalId: number; workItemId: number; phase?: "search" | "grab" }) => Promise<AutomationExecuteItemResult>;
```

Add repository method:

```ts
automationWorkItems.listCandidateItemsForGoal(goalId: number, ordering: AutomationOrdering): Array<AutomationWorkItemView & { mediaFunShare: number; sizeBytes: number }>
```

Then run:

Run:

```powershell
npx vitest run tests/unit/automation-runner.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/main/automation/automation-runner.ts src/main/db/repositories.ts src/main/ipc.ts tests/unit/automation-runner.test.ts
git commit -m "feat: execute automation work items"
```

---

## Task 6: Automation IPC

**Files:**
- Create: `src/main/automation/automation-ipc.ts`
- Modify: `src/main/ipc.ts`
- Modify: `src/renderer/state/ipc-client.ts`
- Test: `tests/unit/automation-ipc-client.test.ts`

- [ ] **Step 1: Write failing IPC client tests**

Create `tests/unit/automation-ipc-client.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  listAutomationGoals,
  pauseAutomationGoal,
  resumeAutomationGoal,
  runAutomationGoal,
  saveAutomationGoal,
} from "../../src/renderer/state/ipc-client";

describe("automation ipc client", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(window, "arrOps");
  });

  it("targets automation channels", async () => {
    const invoke = vi.fn(async () => ({ ok: true })) as unknown as Window["arrOps"]["invoke"] & {
      mock: { calls: Array<[string, unknown?]> };
    };
    window.arrOps = { invoke, onJobEvent: () => () => undefined };

    await listAutomationGoals();
    await saveAutomationGoal({
      name: "Goal",
      enabled: true,
      scope: "sonarr",
      targetFunShare: 0.95,
      filters: {
        monitored: "yes",
        hasFile: "yes",
        qualityProfiles: [],
        funShare: { operator: "lt", value: 0.95 },
        analyzed: { mode: "any" },
        searched: { mode: "any" },
        grabbed: { mode: "any" },
      },
      actionMode: "search_and_grab",
      executionStrategy: "grab_immediately",
      ordering: "oldest_search_first",
      minSearchIntervalHours: 168,
      runOnStartup: true,
      schedule: null,
    });
    await pauseAutomationGoal(1);
    await resumeAutomationGoal(1);
    await runAutomationGoal(1);

    expect(invoke.mock.calls.map(([channel]) => channel)).toEqual([
      "automation:listGoals",
      "automation:saveGoal",
      "automation:pauseGoal",
      "automation:resumeGoal",
      "automation:runGoal",
    ]);
  });
});
```

- [ ] **Step 2: Run failing IPC client test**

Run:

```powershell
npx vitest run tests/unit/automation-ipc-client.test.ts
```

Expected: FAIL because client functions do not exist.

- [ ] **Step 3: Add renderer IPC client functions**

In `src/renderer/state/ipc-client.ts`, add imports for automation types and functions:

```ts
export function listAutomationGoals(): Promise<AutomationGoalView[]> {
  return invokeIpc("automation:listGoals");
}

export function saveAutomationGoal(input: AutomationGoalInput): Promise<AutomationGoalView> {
  return invokeIpc("automation:saveGoal", input);
}

export function pauseAutomationGoal(goalId: number): Promise<AutomationGoalView> {
  return invokeIpc("automation:pauseGoal", { goalId });
}

export function resumeAutomationGoal(goalId: number): Promise<AutomationGoalView> {
  return invokeIpc("automation:resumeGoal", { goalId });
}

export function runAutomationGoal(goalId: number): Promise<ArrActionResult> {
  return invokeIpc("automation:runGoal", { goalId });
}

export function runEligibleAutomationGoals(): Promise<ArrActionResult> {
  return invokeIpc("automation:runEligible");
}

export function listAutomationEvents(goalId: number): Promise<AutomationEventView[]> {
  return invokeIpc("automation:listEvents", { goalId });
}
```

- [ ] **Step 4: Add main IPC registration module**

Create `src/main/automation/automation-ipc.ts`:

```ts
import { ipcMain } from "electron";
import type { ArrActionResult, AutomationGoalInput, AutomationReorderInput } from "../../shared/ipc-contracts";
import type { IpcState } from "../ipc";
import { AutomationGoalRunner } from "./automation-runner";

export function registerAutomationIpcHandlers(state: IpcState): void {
  ipcMain.handle("automation:listGoals", () => state.repositories.automationGoals.list());
  ipcMain.handle("automation:getGoal", (_event, payload: unknown) => {
    const goalId = assertGoalId(payload);
    const goal = state.repositories.automationGoals.find(goalId);
    if (!goal) throw new Error("Automation goal not found");
    return goal;
  });
  ipcMain.handle("automation:saveGoal", (_event, payload: unknown) => {
    return state.repositories.automationGoals.upsert({ ...assertGoalInput(payload), now: new Date() });
  });
  ipcMain.handle("automation:deleteGoal", (_event, payload: unknown) => {
    state.repositories.automationGoals.delete(assertGoalId(payload));
    return { ok: true };
  });
  ipcMain.handle("automation:reorderGoals", (_event, payload: unknown) => {
    const input = assertReorderInput(payload);
    state.repositories.automationGoals.reorder(input.goalIds, new Date());
    return state.repositories.automationGoals.list();
  });
  ipcMain.handle("automation:pauseGoal", (_event, payload: unknown) => {
    const goalId = assertGoalId(payload);
    state.repositories.automationGoals.setManualStatus(goalId, "paused_by_user", new Date());
    return state.repositories.automationGoals.find(goalId);
  });
  ipcMain.handle("automation:resumeGoal", (_event, payload: unknown) => {
    const goalId = assertGoalId(payload);
    state.repositories.automationGoals.setManualStatus(goalId, "active", new Date());
    return state.repositories.automationGoals.find(goalId);
  });
  ipcMain.handle("automation:runGoal", (_event, payload: unknown): ArrActionResult => {
    const goalId = assertGoalId(payload);
    const job = state.jobRunner.enqueue({
      name: `Automation goal ${goalId}`,
      kind: "automation",
      target: "all",
      run: (context) => createRunner(state).runGoal(goalId, "manual", context.jobId),
    });
    return { ok: true, jobId: job.id, message: "Automation goal queued" };
  });
  ipcMain.handle("automation:runEligible", (): ArrActionResult => {
    const job = state.jobRunner.enqueue({
      name: "Run eligible automation goals",
      kind: "automation",
      target: "all",
      run: async (context) => {
        for (const goal of state.repositories.automationGoals.list()) {
          context.throwIfCancelled();
          await createRunner(state).runGoal(goal.id, "manual", context.jobId);
        }
      },
    });
    return { ok: true, jobId: job.id, message: "Eligible automation goals queued" };
  });
  ipcMain.handle("automation:listEvents", (_event, payload: unknown) => {
    return state.repositories.automationEvents.list(assertGoalId(payload), 100);
  });
}

function createRunner(state: IpcState): AutomationGoalRunner {
  return new AutomationGoalRunner({
    repositories: state.repositories,
    now: () => new Date(),
    testConnection: async () => undefined,
    executeItem: (input) => state.executeAutomationWorkItem(input),
    getQuotaSummary: () => state.getQuotaSummary(),
    quotaSafetyPercent: () => state.getAppSettings().automation.quotaSafetyPercent,
  });
}

function assertGoalId(payload: unknown): number {
  if (typeof payload !== "object" || payload === null || !("goalId" in payload) || !Number.isInteger(payload.goalId)) {
    throw new Error("goalId is required");
  }
  return Number(payload.goalId);
}

function assertGoalInput(payload: unknown): AutomationGoalInput {
  if (typeof payload !== "object" || payload === null) {
    throw new Error("Invalid automation goal payload");
  }
  return payload as AutomationGoalInput;
}

function assertReorderInput(payload: unknown): AutomationReorderInput {
  if (typeof payload !== "object" || payload === null || !("goalIds" in payload) || !Array.isArray(payload.goalIds)) {
    throw new Error("goalIds is required");
  }
  return { goalIds: payload.goalIds.filter((id): id is number => Number.isInteger(id) && id > 0) };
}
```

If `IpcState` lacks helper functions, add these fields in `src/main/ipc.ts`:

```ts
  executeAutomationWorkItem: (input: { goalId: number; workItemId: number }) => Promise<AutomationExecuteItemResult>;
  getQuotaSummary: () => QuotaSummary;
  getAppSettings: () => AppSettings;
```

Wire them where `IpcState` is constructed in the bootstrap file.

- [ ] **Step 5: Register automation IPC handlers**

In `src/main/ipc.ts`, import:

```ts
import { registerAutomationIpcHandlers } from "./automation/automation-ipc";
```

Inside `registerIpcHandlers(state)`, add near other handler registration:

```ts
  registerAutomationIpcHandlers(state);
```

- [ ] **Step 6: Run IPC client test**

Run:

```powershell
npx vitest run tests/unit/automation-ipc-client.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/main/automation/automation-ipc.ts src/main/ipc.ts src/renderer/state/ipc-client.ts tests/unit/automation-ipc-client.test.ts src/shared/ipc-contracts.ts
git commit -m "feat: add automation ipc"
```

---

## Task 7: Startup and Schedule Automation

**Files:**
- Modify: `src/main/automation/automation-runner.ts`
- Modify: `src/main/automation/automation-ipc.ts`
- Modify: `src/main/index.ts`
- Test: `tests/unit/automation-runner.test.ts`

- [ ] **Step 1: Add test for eligible goals**

Add to `tests/unit/automation-runner.test.ts`:

```ts
it("skips paused goals and goals not yet eligible", async () => {
  const repos = makeAutomationReposWithOnePendingItem({
    actionMode: "search_only",
    executionStrategy: "grab_immediately",
  });
  repos.automationGoals.setManualStatus(1, "paused_by_user", new Date("2026-06-18T10:00:00.000Z"));
  const executed: number[] = [];
  const runner = new AutomationGoalRunner({
    repositories: repos,
    now: () => new Date("2026-06-18T10:00:00.000Z"),
    testConnection: vi.fn(async () => undefined),
    executeItem: vi.fn(async ({ goalId }) => {
      executed.push(goalId);
      return { status: "searched", candidateFound: false, grabbed: false };
    }),
    getQuotaSummary: () => ({
      search: { used: 0, remaining: 100, limit: 100 },
      grab: { used: 0, remaining: 100, limit: 100 },
    }),
    quotaSafetyPercent: () => 90,
  });

  await runner.runEligible("startup", "job-1");

  expect(executed).toEqual([]);
});
```

- [ ] **Step 2: Run failing test**

Run:

```powershell
npx vitest run tests/unit/automation-runner.test.ts
```

Expected: FAIL because `runEligible` does not exist.

- [ ] **Step 3: Implement eligible goal selection**

In `src/main/automation/automation-runner.ts`, add:

```ts
async runEligible(trigger: "startup" | "schedule" | "manual" | "resume", jobId?: string): Promise<void> {
  const now = this.options.now();
  const goals = this.options.repositories.automationGoals.list().filter((goal) => {
    if (!goal.enabled) return false;
    if (goal.manualStatus === "paused_by_user") return false;
    if (trigger === "startup" && !goal.runOnStartup) return false;
    if (goal.nextEligibleRunAt && new Date(goal.nextEligibleRunAt).getTime() > now.getTime()) return false;
    return true;
  });

  for (const goal of goals) {
    await this.runGoal(goal.id, trigger, jobId);
    const quota = this.options.getQuotaSummary();
    const safetyPercent = this.options.quotaSafetyPercent();
    if (
      shouldStopForQuotaSafety({ used: quota.search.used, limit: quota.search.limit, safetyPercent }) ||
      shouldStopForQuotaSafety({ used: quota.grab.used, limit: quota.grab.limit, safetyPercent })
    ) {
      return;
    }
  }
}
```

- [ ] **Step 4: Use `runEligible` in IPC**

In `src/main/automation/automation-ipc.ts`, replace the `automation:runEligible` loop with:

```ts
run: (context) => createRunner(state).runEligible("manual", context.jobId),
```

- [ ] **Step 5: Add startup hook**

In the main bootstrap file that creates `IpcState` and registers handlers, enqueue startup automation after repositories, job runner, and instance store are ready:

```ts
state.jobRunner.enqueue({
  name: "Startup automation goals",
  kind: "automation",
  target: "all",
  run: (context) => createAutomationGoalRunner(state).runEligible("startup", context.jobId),
});
```

If no exported factory exists, create one in `src/main/automation/automation-ipc.ts`:

```ts
export function createAutomationGoalRunner(state: IpcState): AutomationGoalRunner {
  return createRunner(state);
}
```

Use it both in IPC and startup code.

- [ ] **Step 6: Run tests**

Run:

```powershell
npx vitest run tests/unit/automation-runner.test.ts
npm run lint
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/main/automation/automation-runner.ts src/main/automation/automation-ipc.ts src/main/index.ts tests/unit/automation-runner.test.ts
git commit -m "feat: run eligible automation goals"
```

---

## Task 8: Automation Goals Renderer Tab

**Files:**
- Create: `src/renderer/views/AutomationGoalsView.tsx`
- Modify: `src/renderer/components/TabNav.tsx`
- Modify: `src/renderer/App.tsx`
- Test: `tests/unit/automation-view.test.tsx`

- [ ] **Step 1: Write failing view test**

Create `tests/unit/automation-view.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AutomationGoalsView } from "../../src/renderer/views/AutomationGoalsView";
import type { AutomationGoalView } from "../../src/shared/ipc-contracts";

const goal: AutomationGoalView = {
  id: 1,
  name: "Sonarr to 95% FuN",
  enabled: true,
  priority: 1,
  scope: "sonarr",
  targetFunShare: 0.95,
  filters: {
    monitored: "yes",
    hasFile: "yes",
    qualityProfiles: [],
    funShare: { operator: "lt", value: 0.95 },
    analyzed: { mode: "any" },
    searched: { mode: "older_than", days: 7 },
    grabbed: { mode: "any" },
  },
  actionMode: "search_and_grab",
  executionStrategy: "grab_immediately",
  ordering: "oldest_search_first",
  minSearchIntervalHours: 168,
  runOnStartup: true,
  schedule: null,
  manualStatus: "active",
  status: "enabled",
  currentFunShare: 0.918,
  matchingFiles: 1842,
  remainingNonFunFiles: 151,
  pendingCandidates: 12,
};

describe("AutomationGoalsView", () => {
  it("renders goals and exposes pause/run actions", () => {
    const onPause = vi.fn();
    const onRun = vi.fn();
    render(
      <AutomationGoalsView
        goals={[goal]}
        events={[]}
        onCreate={vi.fn()}
        onPause={onPause}
        onResume={vi.fn()}
        onRun={onRun}
        onSave={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByText("Sonarr to 95% FuN")).toBeInTheDocument();
    expect(screen.getByText("91.8% / 95%")).toBeInTheDocument();
    expect(screen.getByText("151 remaining")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Pause Sonarr to 95% FuN"));
    fireEvent.click(screen.getByLabelText("Run Sonarr to 95% FuN now"));

    expect(onPause).toHaveBeenCalledWith(1);
    expect(onRun).toHaveBeenCalledWith(1);
  });
});
```

- [ ] **Step 2: Run failing view test**

Run:

```powershell
npx vitest run tests/unit/automation-view.test.tsx
```

Expected: FAIL because view does not exist.

- [ ] **Step 3: Add tab nav item**

In `src/renderer/components/TabNav.tsx`, import `Bot` or `ListChecks` from `lucide-react`, update type:

```ts
export type AppTabId = "dashboard" | "sonarr" | "radarr" | "automation" | "stats" | "jobs" | "quotas" | "settings";
```

Add tab:

```ts
{ id: "automation", label: "Automation", icon: ListChecks },
```

Place it after Radarr.

- [ ] **Step 4: Implement view**

Create `src/renderer/views/AutomationGoalsView.tsx`:

```tsx
import { Pause, Play, Plus, RotateCcw, Save } from "lucide-react";
import type { AutomationEventView, AutomationGoalInput, AutomationGoalView } from "../../shared/ipc-contracts";
import { IconButton } from "../components/IconButton";
import { StatusPill } from "../components/StatusPill";

export function AutomationGoalsView({
  events,
  goals,
  onCreate,
  onPause,
  onResume,
  onRun,
  onSave,
  onSelect,
}: {
  events: AutomationEventView[];
  goals: AutomationGoalView[];
  onCreate: () => void;
  onPause: (goalId: number) => void;
  onResume: (goalId: number) => void;
  onRun: (goalId: number) => void;
  onSave: (input: AutomationGoalInput) => void;
  onSelect: (goalId: number) => void;
}) {
  const selected = goals[0];
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)]">
      <section className="rounded-lg border border-white/10 bg-ink-900/80 p-4 shadow-surface">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-balance text-base font-semibold text-white">Automation Goals</h2>
            <p className="mt-1 text-pretty text-sm text-ink-400">Rule-based FuN coverage work, ordered by priority.</p>
          </div>
          <IconButton icon={Plus} label="Create automation goal" onClick={onCreate} tone="primary">
            New goal
          </IconButton>
        </div>
        <div className="mt-4 divide-y divide-white/10 overflow-hidden rounded-md border border-white/10">
          {goals.map((goal) => (
            <button
              className="grid w-full gap-3 px-3 py-3 text-left transition-[background-color] duration-150 hover:bg-white/[0.04] md:grid-cols-[1fr_auto]"
              key={goal.id}
              onClick={() => onSelect(goal.id)}
              type="button"
            >
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-semibold text-white">{goal.name}</span>
                  <StatusPill tone={goal.status === "blocked_by_error" ? "danger" : goal.status === "paused" ? "muted" : "idle"}>
                    {goal.status}
                  </StatusPill>
                </div>
                <div className="mt-2 grid gap-2 font-mono text-xs tabular-nums text-ink-300 sm:grid-cols-3">
                  <span>{formatPercent(goal.currentFunShare)} / {formatPercent(goal.targetFunShare)}</span>
                  <span>{goal.remainingNonFunFiles} remaining</span>
                  <span>{goal.matchingFiles} files</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {goal.manualStatus === "paused_by_user" ? (
                  <IconButton className="px-0" icon={RotateCcw} label={`Resume ${goal.name}`} onClick={(event) => { event.stopPropagation(); onResume(goal.id); }} />
                ) : (
                  <IconButton className="px-0" icon={Pause} label={`Pause ${goal.name}`} onClick={(event) => { event.stopPropagation(); onPause(goal.id); }} />
                )}
                <IconButton className="px-0" icon={Play} label={`Run ${goal.name} now`} onClick={(event) => { event.stopPropagation(); onRun(goal.id); }} tone="primary" />
              </div>
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-white/10 bg-ink-900/80 p-4 shadow-surface">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-balance text-base font-semibold text-white">{selected ? selected.name : "Goal details"}</h2>
            <p className="mt-1 text-pretty text-sm text-ink-400">{selected ? `${selected.scope} · ${selected.executionStrategy}` : "Select or create a goal"}</p>
          </div>
          {selected ? (
            <IconButton icon={Save} label="Save automation goal" onClick={() => onSave(selected)} tone="default">
              Save
            </IconButton>
          ) : null}
        </div>
        <div className="mt-4 rounded-md bg-ink-950/60 p-3">
          <h3 className="text-sm font-semibold text-white">Recent actions</h3>
          <div className="mt-3 divide-y divide-white/10">
            {events.length === 0 ? <p className="text-sm text-ink-400">No events yet.</p> : null}
            {events.map((event) => (
              <div className="grid gap-2 py-2 text-sm md:grid-cols-[8rem_5rem_1fr]" key={event.id}>
                <span className="font-mono text-xs tabular-nums text-ink-400">{formatTime(event.createdAt)}</span>
                <StatusPill tone={event.level === "error" ? "danger" : event.level === "warning" ? "warning" : "idle"}>{event.level}</StatusPill>
                <span className="text-ink-200">{event.message}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
```

- [ ] **Step 5: Wire App state**

In `src/renderer/App.tsx`, import view and IPC functions:

```ts
import { AutomationGoalsView } from "./views/AutomationGoalsView";
import {
  listAutomationEvents,
  listAutomationGoals,
  pauseAutomationGoal,
  resumeAutomationGoal,
  runAutomationGoal,
  saveAutomationGoal,
} from "./state/ipc-client";
import type { AutomationEventView, AutomationGoalInput, AutomationGoalView } from "../shared/ipc-contracts";
```

Add state:

```ts
const [automationGoals, setAutomationGoals] = useState<AutomationGoalView[]>([]);
const [automationEvents, setAutomationEvents] = useState<AutomationEventView[]>([]);
```

Add refresh helpers:

```ts
async function refreshAutomationGoals() {
  const goals = await listAutomationGoals();
  setAutomationGoals(goals);
  if (goals[0]) {
    setAutomationEvents(await listAutomationEvents(goals[0].id));
  }
}
```

Add effect when tab is active:

```ts
useEffect(() => {
  if (activeTab !== "automation") return;
  void refreshAutomationGoals();
  const scheduler = createRefreshScheduler(refreshAutomationGoals, { minimumDelayMs: 1_500 });
  const interval = window.setInterval(() => scheduler.trigger(), 3_000);
  const unsubscribe = subscribeToJobEvents(() => scheduler.trigger());
  return () => {
    window.clearInterval(interval);
    unsubscribe();
    scheduler.dispose();
  };
}, [activeTab]);
```

Add render:

```tsx
{activeTab === "automation" ? (
  <AutomationGoalsView
    goals={automationGoals}
    events={automationEvents}
    onCreate={() => undefined}
    onPause={(goalId) => void pauseAutomationGoal(goalId).then(refreshAutomationGoals)}
    onResume={(goalId) => void resumeAutomationGoal(goalId).then(refreshAutomationGoals)}
    onRun={(goalId) => void runAutomationGoal(goalId).then(refreshAutomationGoals)}
    onSave={(input: AutomationGoalInput) => void saveAutomationGoal(input).then(refreshAutomationGoals)}
    onSelect={(goalId) => void listAutomationEvents(goalId).then(setAutomationEvents)}
  />
) : null}
```

- [ ] **Step 6: Run view tests**

Run:

```powershell
npx vitest run tests/unit/automation-view.test.tsx tests/unit/automation-ipc-client.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/renderer/views/AutomationGoalsView.tsx src/renderer/components/TabNav.tsx src/renderer/App.tsx tests/unit/automation-view.test.tsx
git commit -m "feat: add automation goals view"
```

---

## Task 9: Settings UI for Quota Safety

**Files:**
- Modify: `src/renderer/views/SettingsView.tsx`
- Test: existing settings tests or create `tests/unit/settings-view.test.tsx` if none exists

- [ ] **Step 1: Add renderer test for quota safety setting**

If there is no settings view test, create `tests/unit/settings-view.test.tsx` with a smoke test matching the current `SettingsView` props. Include this assertion:

```tsx
expect(screen.getByLabelText("Automation quota safety percent")).toHaveValue(90);
```

- [ ] **Step 2: Run failing settings view test**

Run:

```powershell
npx vitest run tests/unit/settings-view.test.tsx tests/unit/app-settings.test.ts
```

Expected: FAIL because the setting is not rendered.

- [ ] **Step 3: Add quota safety input**

In `src/renderer/views/SettingsView.tsx`, add a constrained number input in the quota/settings section:

```tsx
<label className="flex flex-col gap-1 text-sm text-ink-200">
  <span>Automation quota safety percent</span>
  <input
    aria-label="Automation quota safety percent"
    className="h-10 rounded-md border border-white/10 bg-ink-950 px-3 font-mono tabular-nums text-white outline-none focus:ring-2 focus:ring-signal-cyan/40"
    max={100}
    min={1}
    type="number"
    value={settings.appSettings.automation.quotaSafetyPercent}
    onChange={(event) =>
      setDraft((current) => ({
        ...current,
        automation: { ...current.automation, quotaSafetyPercent: Number(event.target.value) },
      }))
    }
  />
</label>
```

Use the existing draft/save pattern in `SettingsView`; do not introduce a separate state model.

- [ ] **Step 4: Run tests**

Run:

```powershell
npx vitest run tests/unit/settings-view.test.tsx tests/unit/app-settings.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/renderer/views/SettingsView.tsx tests/unit/settings-view.test.tsx
git commit -m "feat: expose automation quota safety setting"
```

---

## Task 10: Verification Pass

**Files:**
- Review all changed files.

- [ ] **Step 1: Run focused automation tests**

Run:

```powershell
npx vitest run tests/unit/automation-filtering.test.ts tests/unit/automation-ordering.test.ts tests/unit/automation-quota-safety.test.ts tests/unit/automation-repositories.test.ts tests/unit/automation-runner.test.ts tests/unit/automation-ipc-client.test.ts tests/unit/automation-view.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run full unit suite**

Run:

```powershell
npm test
```

Expected: PASS.

- [ ] **Step 3: Run TypeScript build check**

Run:

```powershell
npm run lint
```

Expected: PASS.

- [ ] **Step 4: Run production build**

Run:

```powershell
npm run build
```

Expected: PASS.

- [ ] **Step 5: Manual UI smoke**

Run:

```powershell
npm run dev
```

Expected:

- App launches.
- Automation tab appears in the primary navigation.
- Automation Goals view renders with no goals.
- Creating test data through IPC/tests does not break dashboard, Jobs, Quotas, Sonarr, or Radarr views.
- Settings shows `Automation quota safety percent`.

- [ ] **Step 6: Final commit if verification required changes**

If verification produces fixes:

```powershell
git add src/main src/renderer src/shared tests docs
git commit -m "fix: stabilize automation goals"
```

If verification produces no changes, do not create an empty commit.

---

## Self-Review Notes

- Spec coverage:
  - Durable goals: Tasks 1, 2, 6, 8.
  - File/episode-level work items: Tasks 2, 3, 4.
  - AND filters: Task 3.
  - Multiple active goals in priority order: Tasks 2 and 7.
  - Startup/schedule/manual runs: Tasks 6 and 7.
  - Shared global quotas and 90% safety stop: Tasks 1, 3, 5, 9.
  - Resume after quota stop: Tasks 5 and 7 via `nextEligibleRunAt`.
  - Search cooldown: Tasks 3 and 5.
  - Search-only and search+grab: Tasks 5 and 8.
  - Grab immediately and search-then-grab: Task 5 includes both the immediate loop and the two-phase search-then-grab loop.
  - Status, progress, logs: Tasks 2, 4, 6, 8.
  - Tests and regression verification: Task 10.
- Type consistency:
  - Shared renderer contracts are defined before main/renderer usage.
  - Main automation types reuse shared contracts rather than redefining UI-facing shapes.
  - `JobKind = "automation"` is added before automation jobs are enqueued.
- Scope control:
  - V1 uses AND-only filters.
  - V1 uses one global quota safety percent.
  - V1 keeps renderer forms compact; advanced nested rule builders are excluded.
