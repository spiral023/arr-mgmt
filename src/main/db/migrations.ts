import type { AppDatabase } from "./client";

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
  `create table if not exists jobs (
    id text primary key,
    name text not null,
    kind text not null check (kind in ('analysis', 'search', 'grab', 'combined')),
    target_scope text not null check (target_scope in ('all', 'sonarr', 'radarr', 'selected')),
    status text not null check (status in ('queued', 'running', 'blocked_by_budget', 'completed', 'failed', 'cancelled')),
    progress_current integer not null default 0,
    progress_total integer not null default 0,
    success_count integer not null default 0,
    failure_count integer not null default 0,
    created_at text not null,
    started_at text,
    finished_at text
  )`,
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
  "create index if not exists idx_activity_log_quota_created on activity_log(quota_type, created_at)",
  "create index if not exists idx_media_items_instance_kind on media_items(instance_id, kind)",
  "create index if not exists idx_release_candidates_media on release_candidates(media_item_id, child_arr_id)",
];

export function migrateDatabase(db: AppDatabase): void {
  const migrate = db.transaction(() => {
    for (const statement of statements) {
      db.prepare(statement).run();
    }
  });
  migrate();
}
