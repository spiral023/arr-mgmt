# Automation Goals — Design Spec
**Date:** 2026-06-18  
**Status:** Draft for user review

## Overview

Add a new **Automation Goals** tab for long-running, rule-based Sonarr/Radarr automations. Goals are durable, editable, manually pausable, resumable after app or machine restarts, and can run on app startup or by schedule. Their primary use case is gradually moving large libraries toward a configured FuN coverage target, for example "bring all monitored Sonarr episodes with files to 95% FuN share".

The implementation should use a hybrid architecture: a new persistent automation layer plans and tracks work at file/episode level, while existing Sonarr/Radarr search, grab, analysis, job, and quota logic is reused or extracted into item-level helpers. This avoids a second ARR implementation while supporting multi-day, resumable work.

## Goals

- Create, edit, enable, disable, pause, resume, and reorder Automation Goals.
- Support scopes `sonarr`, `radarr`, and `both`.
- Measure goal progress at file/episode level:
  - Sonarr: episode files.
  - Radarr: movie files.
- Support AND-based filters for monitored state, file presence, quality profile, FuN share, analysis recency, search recency, and grab recency.
- Support target FuN share, initially as the only metric.
- Support multiple active goals in user-defined priority order.
- Run automatically on app startup and/or schedule, and also manually.
- Stop before global quota exhaustion using a global safety threshold, default 90%.
- Respect all global search/grab activity, including manual actions, pipelines, schedules, and automation actions.
- Resume automatically no earlier than 24 hours after quota safety stop, subject to the quota window.
- Track detailed status, progress, ETA, recent actions, and success metrics.
- Include new media that later matches a goal's filters.
- Avoid searching the same file/episode again until the configured minimum search interval has passed.
- After a successful grab, do not search the item again until a later analysis still marks it as Non-FuN.

## Non-Goals

- Fully nested AND/OR rule trees in V1.
- Per-goal quota limits or per-goal quota safety overrides.
- New FuN matching semantics beyond existing FuN prefix settings.
- Cloud synchronization or remote worker execution.
- Hard cancellation in the middle of a grab request.

## Architecture

### Core Concepts

`AutomationGoal`
: Durable user configuration. Defines scope, filters, target, execution behavior, scheduling, and priority.

`AutomationRun`
: One execution attempt for a goal. A run can be triggered manually, by startup, by schedule, or by resume.

`AutomationWorkItem`
: Persistent unit of work at file level. For Sonarr this represents an episode file; for Radarr this represents a movie file.

`AutomationGoalRunner`
: Main orchestration service. It reconciles goal membership, checks connection health, updates relevant library state, applies quotas/cooldowns, and executes search/grab work.

### Existing System Reuse

- `QuotaService` remains the single source for search/grab quota reservations.
- `activity_log` remains the source for global quota usage across manual and automatic actions.
- `JobRunner` remains the outer execution shell and event stream for active runs.
- Sonarr/Radarr search and grab logic should be extracted into reusable item-level helpers where needed.
- Existing analysis code should be reused for lightweight reconciliation and status refresh.

### Job Runner Integration

Add `JobKind = "automation"` and enqueue automation runs as normal jobs. The job provides visible runtime status, progress, cancellation, notifications, and compatibility with the existing Jobs view.

Automation-specific long-term state should live outside `jobs`, because goals and work items outlive individual runs.

## User Experience

### Navigation

Add a new top-level tab: **Automation Goals**.

The tab should be a dense operational dashboard, not a landing page. It should match the current app's utilitarian style and be optimized for scanning, repeated use, and multi-day monitoring.

### Layout

Recommended layout:

- Top command row:
  - `New goal`
  - `Run eligible goals`
  - global automation status
  - quota safety status
- Left or top goal list:
  - drag handle for priority
  - goal name
  - scope
  - enabled/paused/running status
  - current FuN share vs target
  - matching files and remaining Non-FuN files
  - next eligible run
- Detail panel for selected goal:
  - target and filters summary
  - progress and ETA
  - current run status
  - recent actions/log
  - edit, pause, resume, run now actions

### Goal Editor

The editor should be divided into compact sections:

1. **Basics**
   - name
   - scope: `Sonarr`, `Radarr`, `Both`
   - enabled
   - run on app startup
   - schedule settings

2. **Target**
   - metric: `FuN share`
   - level: file/episode
   - target value, default example `95%`

3. **Filters**
   - monitored: yes / no / either
   - has file: yes / no / either
   - quality profile: multi-select
   - current FuN share comparison
   - analyzed: yes / no / older than X days / within last X days
   - searched: never / older than X days / within last X days
   - grabbed: never / older than X days / within last X days

4. **Search and Grab Behavior**
   - action mode:
     - `Search only`
     - `Search + grab`
   - execution strategy:
     - `Grab immediately` (default)
     - `Search all, then grab`
   - minimum days between searches

5. **Ordering**
   - default: `Oldest search first, never searched alphabetically`
   - optional:
     - lowest FuN share first
     - largest impact first
     - alphabetical

### UI Polish Rules

- Use segmented controls for scope, action mode, and execution strategy.
- Use toggles for binary settings.
- Use steppers or constrained number inputs for percent and day values.
- Use multi-select chips for quality profiles.
- Use tabular numbers for all progress, quota, ETA, and count values.
- Keep controls at least 40px hit area.
- Use icon buttons where the icon is familiar, with tooltips for ambiguous actions.
- Buttons should use `active:scale-[0.96]` unless that would interfere with a dense table interaction.
- Avoid nested cards inside cards. Use one list surface and one detail surface.
- Use restrained motion: interruptible hover/open/close transitions, no large page-load animation.

## Execution Rules

### Startup and Schedule

On app startup and scheduled automation ticks:

1. Load enabled goals ordered by priority.
2. Skip goals paused by the user.
3. Skip goals whose `next_eligible_run_at` is in the future.
4. For each eligible goal, run until one of these happens:
   - target reached
   - no searchable work remains
   - goal paused/cancelled
   - connection/search error blocks the run
   - quota safety threshold reached
5. Continue to the next goal only if quota budget remains.

Higher priority goals consume budget first. Lower priority goals run only if earlier goals leave budget available.

### Reconciliation

At the beginning of each goal run:

1. Test Sonarr/Radarr connectivity for the goal's scope.
2. Refresh relevant library state.
3. Recalculate FuN share and file-level FuN status.
4. Re-evaluate filters.
5. Mark no-longer-matching work items as `out_of_scope`.
6. Add newly matching work items.
7. Update existing items with latest analysis/search/grab state.

This is a lightweight reconciliation by default. A full library refresh can be added later if needed, but V1 should avoid forcing full analysis for every goal run.

### Search Capability

Do not spend budget on a separate artificial search test. The first real search in a run acts as the search capability test. If it fails with a connection, authentication, indexer, or ARR capability error, the run stops with `blocked_by_error`.

### Quota Safety

Add global settings:

```ts
automation: {
  quotaSafetyPercent: 90
}
```

Automation must stop before consuming beyond the safety threshold:

- search safety limit = `floor(searchLimit * quotaSafetyPercent / 100)`
- grab safety limit = `floor(grabLimit * quotaSafetyPercent / 100)`

Because `QuotaService` counts `activity_log` entries with quota type `search` or `grab`, manual actions and automation actions share the same quota pool. Automation must check current usage before each action and stop as `waiting_for_quota` when the safety threshold is reached.

When quota safety stops a goal:

- set run status `waiting_for_quota`
- set goal `next_eligible_run_at` no earlier than 24 hours later
- log the exact used/limit/safety values

### Cooldown

Each goal stores `min_search_interval_hours`.

Rules:

- Do not search an item if its latest successful, failed, or started search is newer than the interval.
- Items with no prior search are eligible and sort alphabetically after older searched items according to the default ordering rule.
- After a successful grab, the item is considered satisfied and should not be searched again.
- If later reconciliation still sees the item as Non-FuN, it can become eligible again after the search interval.

### Execution Strategy

`Grab immediately` (default):

1. Pick next eligible work item.
2. Search it.
3. If a valid FuN candidate is found and action mode is `Search + grab`, grab it immediately.
4. Continue to next item.

`Search all, then grab`:

1. Search eligible items first, storing candidates.
2. Once search phase is complete or blocked, grab stored valid FuN candidates if action mode is `Search + grab`.

`Search only`:

- Always stores candidates and never posts grab requests.

## Status Model

### Goal Status

Displayed goal status should be derived from stored goal/run state:

- `enabled`
- `running`
- `paused`
- `waiting_for_quota`
- `waiting_for_schedule`
- `blocked_by_error`
- `target_reached`

Manual pause must set a durable `paused_by_user` state. Startup and schedule runners must ignore paused goals.

### Work Item Status

Recommended statuses:

- `pending`
- `searching`
- `candidate_found`
- `grabbed`
- `satisfied`
- `cooldown`
- `out_of_scope`
- `failed`

### Run Status

Recommended statuses:

- `running`
- `completed`
- `waiting_for_quota`
- `target_reached`
- `blocked_by_error`
- `cancelled`

Manual pause while running should stop after the current item and leave the goal paused.

## Progress and Metrics

Each goal should show two forms of progress:

### Goal Progress

Current FuN share for the matching workset vs target:

```text
91.8% / 95% FuN
```

### Run Progress

Current run work queue progress:

```text
327 / 1842 checked
```

Recommended visible metrics:

- matching files
- remaining Non-FuN files
- pending candidates
- successful grabs from this goal
- last run duration
- next eligible run
- ETA based on recent throughput
- last error, if any

ETA can be approximate. It should be labeled as an estimate and based on recent average items per run or actions per hour.

## Data Model

### New Table: `automation_goals`

Suggested columns:

- `id`
- `name`
- `enabled`
- `priority`
- `scope`
- `target_fun_share`
- `filters_json`
- `action_mode`
- `execution_strategy`
- `ordering`
- `min_search_interval_hours`
- `run_on_startup`
- `schedule_json` or `schedule_id`
- `manual_status`
- `last_run_at`
- `next_eligible_run_at`
- `created_at`
- `updated_at`

`manual_status` values:

- `active`
- `paused_by_user`

### New Table: `automation_work_items`

Suggested columns:

- `id`
- `goal_id`
- `instance_id`
- `media_item_id`
- `media_file_id`
- `child_arr_id`
- `kind`
- `title`
- `sort_key`
- `is_fun`
- `status`
- `last_analyzed_at`
- `last_searched_at`
- `last_grabbed_at`
- `search_attempt_count`
- `last_error`
- `updated_at`

Work items should refer to local `media_files.id` where possible, but reconciliation must be able to recover from media file replacement. The stable match should use ARR identifiers such as `instance_id`, item kind, `child_arr_id`, `arr_file_id`, and path where available.

### New Table: `automation_runs`

Suggested columns:

- `id`
- `goal_id`
- `job_id`
- `trigger`
- `status`
- `progress_current`
- `progress_total`
- `started_at`
- `finished_at`

`trigger` values:

- `startup`
- `schedule`
- `manual`
- `resume`

### New Table: `automation_events`

Suggested columns:

- `id`
- `goal_id`
- `run_id`
- `level`
- `message`
- `created_at`

Automation events should be separate from `job_events` because goals have long-term history across many jobs. The UI can still link active runs to their `job_id`.

## IPC Surface

Add channels:

- `automation:listGoals`
- `automation:getGoal`
- `automation:saveGoal`
- `automation:deleteGoal`
- `automation:reorderGoals`
- `automation:pauseGoal`
- `automation:resumeGoal`
- `automation:runGoal`
- `automation:runEligible`
- `automation:listEvents`

Add shared types:

- `AutomationGoalInput`
- `AutomationGoalView`
- `AutomationGoalFilters`
- `AutomationGoalStatus`
- `AutomationRunView`
- `AutomationWorkItemView`
- `AutomationEventView`

## Error Handling

### Connection Failure

If Sonarr/Radarr cannot be reached at run start, stop the run as `blocked_by_error`, log the instance and message, and set a retry delay.

### Search Capability Failure

If the first real search exposes a structural search problem, stop the run as `blocked_by_error`. Examples include authentication failure, ARR command/API failure, or indexer capability failure.

### Item Failure

If a single item fails, mark it `failed`, store the error, increment failure count, and continue unless the run hits a repeated systemic failure threshold.

### Quota Safety

Quota safety is not a failure. It sets `waiting_for_quota` and schedules the next eligible run.

### Edit While Running

Saving edits while a goal is running should apply to the next reconciliation. The UI should offer a clear option to stop the active run after the current item if the user wants changes to take effect immediately.

### Pause While Running

Pause should stop after the current item. It should not interrupt an in-flight grab request.

## Testing Plan

### Unit Tests

- Filter evaluation for monitored, file presence, quality profile, FuN share, analysis recency, search recency, and grab recency.
- Goal reconciliation adds new matching work items.
- Goal reconciliation marks removed items `out_of_scope`.
- Default ordering: oldest search first, never searched alphabetically.
- Cooldown prevents repeat search before `min_search_interval_hours`.
- Successful grab suppresses further search until later analysis still shows Non-FuN.
- Quota safety stops at 90% of configured search/grab limits.
- Quota safety includes existing manual search/grab activity.
- Execution strategy `grab_immediately`.
- Execution strategy `search_then_grab`.
- Startup resume respects `next_eligible_run_at`.
- Manual pause prevents startup/schedule auto-run.

### Integration and IPC Tests

- Create, edit, pause, resume, delete, and reorder goals.
- Run one goal manually.
- Run eligible goals in priority order.
- Automation run emits job and automation events.
- Blocked-by-quota run resumes after eligible time.

### UI Tests

- Goal list renders status, progress, and quota safety numbers.
- Editor saves default values correctly.
- Filter summary matches saved filter state.
- Action mode and execution strategy segmented controls persist correctly.
- Pause and resume buttons reflect current goal state.

### Regression Tests

- Existing Sonarr/Radarr manual search and grab flows still pass.
- Existing combined pipeline flow still passes.
- Existing quota service tests still pass after safety-threshold changes.

## Implementation Notes

- Prefer extracting reusable ARR item operations before writing the automation runner.
- Keep automation-specific logic out of renderer state; renderer should call IPC and render view models.
- Use structured JSON for filters in the database, but normalize them through typed shared contracts.
- Do not add a second quota counter. `activity_log` and `QuotaService` remain authoritative.
- Do not overload `jobs` with durable goal state.
- Keep V1 filters AND-only to reduce ambiguity and make resume behavior predictable.

