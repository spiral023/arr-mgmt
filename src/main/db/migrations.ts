import type { AppDatabase } from "./client";

const jobsColumns = `(
    id text primary key,
    name text not null,
    kind text not null check (kind in ('analysis', 'search', 'grab', 'combined', 'automation')),
    target_scope text not null check (target_scope in ('all', 'sonarr', 'radarr', 'selected')),
    status text not null check (status in ('queued', 'running', 'blocked_by_budget', 'completed', 'failed', 'cancelled')),
    progress_current integer not null default 0,
    progress_total integer not null default 0,
    success_count integer not null default 0,
    failure_count integer not null default 0,
    created_at text not null,
    started_at text,
    finished_at text
  )`;

const jobColumnNames = [
  "id",
  "name",
  "kind",
  "target_scope",
  "status",
  "progress_current",
  "progress_total",
  "success_count",
  "failure_count",
  "created_at",
  "started_at",
  "finished_at",
];

function createJobsTableStatement(tableName: "jobs" | "jobs_old_automation_kind_constraint", ifNotExists: boolean): string {
  return `create table ${ifNotExists ? "if not exists " : ""}${tableName} ${jobsColumns}`;
}

const statements = [
  `create table if not exists instances (
    id integer primary key autoincrement,
    kind text not null check (kind in ('sonarr', 'radarr')),
    name text not null,
    base_url text not null,
    api_key_encrypted text not null,
    enabled integer not null default 1,
    last_status text,
    last_status_at text,
    created_at text not null,
    updated_at text not null,
    unique(kind)
  )`,
  `create table if not exists media_items (
    id integer primary key autoincrement,
    instance_id integer not null references instances(id) on delete cascade,
    kind text not null check (kind in ('series', 'movie')),
    arr_id integer not null,
    title text not null,
    title_slug text,
    sort_title text,
    year integer,
    monitored integer not null default 0,
    has_file integer not null default 0,
    total_children integer not null default 0,
    children_with_file integer not null default 0,
    fun_children integer not null default 0,
    total_size_bytes integer not null default 0,
    fun_share real not null default 0,
    last_analyzed_at text,
    unique(instance_id, kind, arr_id)
  )`,
  `create table if not exists media_files (
    id integer primary key autoincrement,
    media_item_id integer not null references media_items(id) on delete cascade,
    arr_file_id integer,
    child_arr_id integer,
    season_number integer,
    episode_number integer,
    path text,
    relative_path text,
    release_group text,
    is_fun integer not null default 0,
    quality_name text,
    size_bytes integer not null default 0,
    date_added text
  )`,
  `create table if not exists release_candidates (
    id integer primary key autoincrement,
    instance_id integer not null references instances(id) on delete cascade,
    media_item_id integer references media_items(id) on delete cascade,
    child_arr_id integer,
    arr_release_guid text,
    title text not null,
    release_group text,
    is_fun integer not null default 0,
    quality_name text,
    size_bytes integer not null default 0,
    indexer text,
    approved integer,
    download_allowed integer,
    rejected integer,
    rejections_json text,
    raw_json text not null,
    found_at text not null
  )`,
  createJobsTableStatement("jobs", true),
  `create table if not exists job_events (
    id integer primary key autoincrement,
    job_id text not null references jobs(id) on delete cascade,
    level text not null check (level in ('info', 'warning', 'error')),
    message text not null,
    payload_json text,
    created_at text not null
  )`,
  `create table if not exists activity_log (
    id integer primary key autoincrement,
    instance_id integer references instances(id) on delete set null,
    media_item_id integer references media_items(id) on delete set null,
    child_arr_id integer,
    action text not null,
    quota_type text not null check (quota_type in ('none', 'search', 'grab')),
    status text not null,
    message text,
    payload_json text,
    created_at text not null
  )`,
  `create table if not exists schedules (
    id integer primary key autoincrement,
    name text not null,
    enabled integer not null default 1,
    actions_json text not null,
    target_scope text not null,
    interval_kind text not null,
    interval_value integer,
    time_of_day text,
    next_run_at text,
    last_run_at text,
    created_at text not null,
    updated_at text not null
  )`,
  `create table if not exists settings (
    key text primary key,
    value_json text not null
  )`,
  `create table if not exists coverage_snapshots (
    date text primary key,
    sonarr_fun_share real not null default 0,
    radarr_fun_share real not null default 0,
    total_fun_share real not null default 0,
    sonarr_fun_files integer not null default 0,
    radarr_fun_files integer not null default 0,
    total_files integer not null default 0,
    created_at text not null,
    updated_at text not null
  )`,
  `create table if not exists perf_samples (
    id integer primary key autoincrement,
    job_id text,
    app text,
    phase text not null,
    operation text not null,
    child_arr_id integer,
    strategy text,
    outcome text not null,
    duration_ms integer not null,
    detail text,
    created_at text not null
  )`,
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
    child_arr_id integer not null,
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
  "create index if not exists idx_activity_log_quota_created on activity_log(quota_type, created_at)",
  "create index if not exists idx_activity_log_media_action_created on activity_log(media_item_id, action, created_at)",
  "create index if not exists idx_activity_log_action_created on activity_log(action, created_at)",
  "create index if not exists idx_media_items_instance_kind on media_items(instance_id, kind)",
  "create index if not exists idx_release_candidates_media on release_candidates(media_item_id, child_arr_id)",
  "create index if not exists idx_perf_samples_phase_op on perf_samples(phase, operation, created_at)",
  "create index if not exists idx_perf_samples_job on perf_samples(job_id)",
  "create index if not exists idx_automation_goals_priority on automation_goals(priority)",
  "create index if not exists idx_automation_goals_next on automation_goals(enabled, manual_status, next_eligible_run_at)",
  "create index if not exists idx_automation_work_items_goal_status on automation_work_items(goal_id, status)",
  "create index if not exists idx_automation_work_items_goal_sort on automation_work_items(goal_id, sort_key)",
  "create index if not exists idx_automation_runs_goal on automation_runs(goal_id, started_at)",
  "create index if not exists idx_automation_events_goal on automation_events(goal_id, created_at)",
  `create table if not exists media_item_overrides (
    id integer primary key autoincrement,
    media_item_id integer not null references media_items(id) on delete cascade,
    is_excluded integer not null default 1,
    note text,
    created_at text not null,
    updated_at text not null,
    unique(media_item_id)
  )`,
  "create index if not exists idx_media_item_overrides_item on media_item_overrides(media_item_id)",
];

export function migrateDatabase(db: AppDatabase): void {
  const shouldRebuildJobs = hasLegacyJobsKindConstraint(db);
  const foreignKeysWereEnabled = shouldRebuildJobs && isForeignKeyEnforcementEnabled(db);
  if (foreignKeysWereEnabled) {
    db.pragma("foreign_keys = OFF");
  }

  const migrate = db.transaction(() => {
    ensureJobsAutomationKindConstraint(db);
    for (const statement of statements) {
      db.prepare(statement).run();
    }
    ensureColumn(db, "media_items", "title_slug", "text");
    ensureColumn(db, "media_items", "quality_profile_name", "text");
  });

  try {
    migrate();
  } finally {
    if (foreignKeysWereEnabled) {
      db.pragma("foreign_keys = ON");
    }
  }
}

function ensureColumn(db: AppDatabase, table: string, column: string, type: string): void {
  const columns = db.prepare(`pragma table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((item) => item.name === column)) {
    db.prepare(`alter table ${table} add column ${column} ${type}`).run();
  }
}

function ensureJobsAutomationKindConstraint(db: AppDatabase): void {
  if (!hasLegacyJobsKindConstraint(db)) {
    return;
  }

  const oldTableName = "jobs_old_automation_kind_constraint";
  const legacyAlterTableWasEnabled = isLegacyAlterTableEnabled(db);
  if (!legacyAlterTableWasEnabled) {
    db.pragma("legacy_alter_table = ON");
  }

  try {
    db.prepare(`alter table jobs rename to ${oldTableName}`).run();
    db.prepare(createJobsTableStatement("jobs", false)).run();
    db
      .prepare(`insert into jobs (${jobColumnNames.join(", ")}) select ${jobColumnNames.join(", ")} from ${oldTableName}`)
      .run();
    db.prepare(`drop table ${oldTableName}`).run();
  } finally {
    if (!legacyAlterTableWasEnabled) {
      db.pragma("legacy_alter_table = OFF");
    }
  }
}

function hasLegacyJobsKindConstraint(db: AppDatabase): boolean {
  const row = db.prepare("select sql from sqlite_master where type = 'table' and name = 'jobs'").get() as
    | { sql: string | null }
    | undefined;
  const sql = row?.sql?.replace(/\s+/g, " ").toLowerCase();
  return (
    sql?.includes("kind in ('analysis', 'search', 'grab', 'combined')") === true &&
    !sql.includes("kind in ('analysis', 'search', 'grab', 'combined', 'automation')")
  );
}

function isForeignKeyEnforcementEnabled(db: AppDatabase): boolean {
  return db.pragma("foreign_keys", { simple: true }) === 1;
}

function isLegacyAlterTableEnabled(db: AppDatabase): boolean {
  return db.pragma("legacy_alter_table", { simple: true }) === 1;
}
