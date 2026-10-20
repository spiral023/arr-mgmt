import type { ReactNode } from "react";
import { formatDateTime } from "../../shared/date-time";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  CalendarClock,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCw,
  Save,
  Trash2,
  Workflow,
} from "lucide-react";
import { clsx } from "clsx";
import { IconButton } from "../components/IconButton";
import { StatusPill, type StatusTone } from "../components/StatusPill";
import {
  deleteAutomationGoal,
  getAutomationGoal,
  listAutomationEvents,
  listAutomationGoals,
  pauseAutomationGoal,
  resumeAutomationGoal,
  runAutomationGoal,
  saveAutomationGoal,
} from "../state/ipc-client";
import type {
  AutomationEventView,
  AutomationGoalFilters,
  AutomationGoalInput,
  AutomationGoalStatus,
  AutomationGoalView,
  AutomationOrdering,
  AutomationRecencyFilter,
  AutomationTriState,
  ScheduleIntervalKind,
} from "../../shared/ipc-contracts";

const fieldClassName =
  "h-10 w-full rounded-md border border-white/10 bg-ink-950 px-3 text-sm text-ink-200 outline-none shadow-surface transition-[background-color,border-color,box-shadow] duration-150 ease-out placeholder:text-ink-500 focus:border-signal-cyan focus:ring-2 focus:ring-signal-cyan/30";
const compactFieldClassName =
  "h-9 w-full rounded-md border border-white/10 bg-ink-950 px-2.5 text-sm text-ink-200 outline-none shadow-surface transition-[background-color,border-color,box-shadow] duration-150 ease-out focus:border-signal-cyan focus:ring-2 focus:ring-signal-cyan/30";
const sectionClassName = "rounded-lg border border-white/10 bg-ink-900/80 p-4 shadow-surface";

const statusTone: Record<AutomationGoalStatus, StatusTone> = {
  blocked_by_error: "danger",
  enabled: "idle",
  paused: "muted",
  running: "running",
  target_reached: "success",
  waiting_for_quota: "warning",
  waiting_for_schedule: "idle",
};

export function AutomationView() {
  const [events, setEvents] = useState<AutomationEventView[]>([]);
  const [goals, setGoals] = useState<AutomationGoalView[]>([]);
  const [draft, setDraft] = useState<AutomationGoalInput>(() => defaultGoalInput());
  const [selectedGoalId, setSelectedGoalId] = useState<number | null>(null);
  const [message, setMessage] = useState("Ready");

  const selectedGoal = useMemo(
    () => (selectedGoalId ? goals.find((goal) => goal.id === selectedGoalId) : undefined),
    [goals, selectedGoalId],
  );

  const refresh = useCallback(async (goalId = selectedGoalId) => {
    const nextGoals = await listAutomationGoals();
    setGoals(nextGoals);
    const nextSelectedId = goalId ?? nextGoals[0]?.id ?? null;
    setSelectedGoalId(nextSelectedId);
    if (nextSelectedId) {
      const goal = await getAutomationGoal(nextSelectedId);
      if (goal) setDraft(toGoalInput(goal));
      setEvents(await listAutomationEvents(nextSelectedId));
    } else {
      setEvents([]);
      setDraft(defaultGoalInput());
    }
  }, [selectedGoalId]);

  useEffect(() => {
    void refresh(null);
  }, [refresh]);

  async function saveDraft() {
    setMessage("Saving automation goal...");
    try {
      const saved = await saveAutomationGoal(draft);
      setMessage(`Saved: ${saved.name}`);
      await refresh(saved.id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function runGoal(goalId: number) {
    setMessage("Queueing automation run...");
    try {
      await runAutomationGoal(goalId);
      setMessage("Automation run queued");
      await refresh(goalId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function pauseGoal(goalId: number) {
    await pauseAutomationGoal(goalId);
    setMessage("Automation goal paused");
    await refresh(goalId);
  }

  async function resumeGoal(goalId: number) {
    await resumeAutomationGoal(goalId);
    setMessage("Automation goal resumed");
    await refresh(goalId);
  }

  async function removeGoal(goalId: number) {
    await deleteAutomationGoal(goalId);
    setMessage("Automation goal deleted");
    await refresh(null);
  }

  function newGoal() {
    setSelectedGoalId(null);
    setEvents([]);
    setDraft(defaultGoalInput());
    setMessage("New automation goal");
  }

  function editGoal(goal: AutomationGoalView) {
    setSelectedGoalId(goal.id);
    setDraft(toGoalInput(goal));
    void listAutomationEvents(goal.id).then(setEvents);
  }

  const aggregate = useMemo(() => summarizeGoals(goals), [goals]);

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.08fr)_minmax(420px,0.92fr)]">
      <div className="flex min-w-0 flex-col gap-4">
        <section className={sectionClassName}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Header
              description={`${aggregate.active} active, ${aggregate.waiting} waiting, ${aggregate.errors} blocked`}
              icon={Workflow}
              title="Automation Goals"
            />
            <div className="flex items-center gap-2">
              <IconButton icon={RefreshCw} label="Refresh automation goals" onClick={() => void refresh()} />
              <IconButton icon={Plus} label="Create automation goal" onClick={newGoal} tone="primary">
                New goal
              </IconButton>
            </div>
          </div>
          <div className="mt-3 rounded-md border border-white/10 bg-ink-950/60 px-3 py-2 text-sm text-ink-200 shadow-surface">
            {message}
          </div>
          <div className="mt-4 grid gap-3">
            {goals.length === 0 ? (
              <div className="rounded-md border border-dashed border-white/12 bg-white/[0.02] px-4 py-8 text-center text-sm text-ink-400">
                No automation goals configured.
              </div>
            ) : (
              goals.map((goal) => (
                <GoalRow
                  goal={goal}
                  isSelected={goal.id === selectedGoalId}
                  key={goal.id}
                  onDelete={() => void removeGoal(goal.id)}
                  onEdit={() => editGoal(goal)}
                  onPause={() => void pauseGoal(goal.id)}
                  onResume={() => void resumeGoal(goal.id)}
                  onRun={() => void runGoal(goal.id)}
                />
              ))
            )}
          </div>
        </section>

        <section className={sectionClassName}>
          <div className="flex items-center justify-between gap-3">
            <Header description={selectedGoal ? selectedGoal.name : "Select or save a goal"} icon={CalendarClock} title="Automation Log" />
            {selectedGoal ? <StatusPill tone={statusTone[selectedGoal.status]}>{selectedGoal.status}</StatusPill> : null}
          </div>
          <div className="mt-4 divide-y divide-white/10 rounded-md border border-white/10 bg-ink-950/60">
            {events.length === 0 ? (
              <div className="px-3 py-4 text-sm text-ink-400">No automation events yet.</div>
            ) : (
              events.map((event) => (
                <div className="grid gap-2 px-3 py-3 text-sm md:grid-cols-[10rem_6rem_1fr]" key={event.id}>
                  <Mono>{formatDateTime(event.createdAt)}</Mono>
                  <StatusPill tone={event.level === "error" ? "danger" : event.level === "warning" ? "warning" : "idle"}>
                    {event.level}
                  </StatusPill>
                  <span className="text-pretty text-ink-200">{event.message}</span>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      <section className={sectionClassName}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Header description="Rule, target, ordering and cadence" icon={Save} title={draft.id ? "Edit Goal" : "Goal Editor"} />
          <IconButton icon={Save} label="Save automation goal" onClick={() => void saveDraft()} tone="primary">
            Save
          </IconButton>
        </div>

        <div className="mt-4 grid gap-4">
          <Field label="Name">
            <input className={fieldClassName} value={draft.name} onChange={(event) => updateDraft({ name: event.target.value })} />
          </Field>

          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Scope">
              <Segmented
                options={[
                  ["sonarr", "Sonarr"],
                  ["radarr", "Radarr"],
                  ["both", "Both"],
                ]}
                value={draft.scope}
                onChange={(scope) => updateDraft({ scope })}
              />
            </Field>
            <Field label="Target FuN share">
              <NumberInput
                max={100}
                min={1}
                suffix="%"
                value={Math.round(draft.targetFunShare * 100)}
                onChange={(value) => updateDraft({ targetFunShare: clamp(value, 1, 100) / 100 })}
              />
            </Field>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Action">
              <Segmented
                options={[
                  ["search_and_grab", "Search + grab"],
                  ["search_only", "Search only"],
                ]}
                value={draft.actionMode}
                onChange={(actionMode) => updateDraft({ actionMode })}
              />
            </Field>
            <Field label="Strategy">
              <Segmented
                options={[
                  ["grab_immediately", "Grab immediately"],
                  ["search_then_grab", "Search first"],
                ]}
                value={draft.executionStrategy}
                onChange={(executionStrategy) => updateDraft({ executionStrategy })}
              />
            </Field>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Ordering">
              <select
                className={fieldClassName}
                value={draft.ordering}
                onChange={(event) => updateDraft({ ordering: event.target.value as AutomationOrdering })}
              >
                <option value="oldest_search_first">Oldest search first</option>
                <option value="alphabetical">Alphabetical</option>
                <option value="lowest_fun_share_first">Lowest FuN share first</option>
                <option value="largest_impact_first">Largest impact first</option>
              </select>
            </Field>
            <Field label="Minimum search interval">
              <NumberInput
                min={0}
                suffix="hours"
                value={draft.minSearchIntervalHours}
                onChange={(value) => updateDraft({ minSearchIntervalHours: Math.max(0, Math.round(value)) })}
              />
            </Field>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <CheckRow
              checked={draft.runOnStartup}
              label="Run on app start"
              onChange={(runOnStartup) => updateDraft({ runOnStartup })}
            />
            <CheckRow
              checked={draft.enabled}
              label="Goal enabled"
              onChange={(enabled) => updateDraft({ enabled })}
            />
          </div>

          <RuleEditor filters={draft.filters} onChange={(filters) => updateDraft({ filters })} />
          <ScheduleEditor goal={draft} onChange={updateDraft} />
        </div>
      </section>
    </div>
  );

  function updateDraft(patch: Partial<AutomationGoalInput>) {
    setDraft((current) => ({ ...current, ...patch }));
  }
}

function GoalRow({
  goal,
  isSelected,
  onDelete,
  onEdit,
  onPause,
  onResume,
  onRun,
}: {
  goal: AutomationGoalView;
  isSelected: boolean;
  onDelete: () => void;
  onEdit: () => void;
  onPause: () => void;
  onResume: () => void;
  onRun: () => void;
}) {
  const percent = goal.matchingFiles > 0 ? Math.round((goal.currentFunShare / Math.max(goal.targetFunShare, 0.01)) * 100) : 0;
  return (
    <div
      className={clsx(
        "rounded-md bg-ink-950/60 p-3 shadow-surface transition-[background-color,box-shadow] duration-150 ease-out",
        isSelected ? "bg-[#10242d] shadow-primary-glow" : "hover:bg-ink-850 hover:shadow-surface-hover",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <button className="min-w-0 flex-1 text-left" onClick={onEdit} type="button">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-white text-balance">{goal.name}</h3>
            <StatusPill tone={statusTone[goal.status]}>{goal.status}</StatusPill>
          </div>
          <p className="mt-1 text-pretty text-xs text-ink-400">
            {goal.scope} · {Math.round(goal.currentFunShare * 100)}% / {Math.round(goal.targetFunShare * 100)}% FuN · {goal.remainingNonFunFiles} remaining
          </p>
        </button>
        <div className="flex shrink-0 items-center gap-2">
          <IconButton className="px-0" icon={Play} label={`Run ${goal.name}`} onClick={onRun} tone="success" />
          {goal.manualStatus === "paused_by_user" ? (
            <IconButton className="px-0" icon={RotateCw} label={`Resume ${goal.name}`} onClick={onResume} />
          ) : (
            <IconButton className="px-0" icon={Pause} label={`Pause ${goal.name}`} onClick={onPause} />
          )}
          <IconButton className="px-0" icon={Trash2} label={`Delete ${goal.name}`} onClick={onDelete} tone="danger" />
        </div>
      </div>
      <div className="mt-3">
        <div className="flex justify-between font-mono text-xs tabular-nums text-ink-300">
          <span>{goal.matchingFiles} matching</span>
          <span>{Math.min(100, percent)}%</span>
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded bg-ink-800">
          <div className="h-full rounded bg-signal-cyan" style={{ width: `${Math.min(100, percent)}%` }} />
        </div>
      </div>
    </div>
  );
}

function RuleEditor({ filters, onChange }: { filters: AutomationGoalFilters; onChange: (filters: AutomationGoalFilters) => void }) {
  const update = (patch: Partial<AutomationGoalFilters>) => onChange({ ...filters, ...patch });
  return (
    <div className="rounded-md bg-ink-950/50 p-3 shadow-surface">
      <h3 className="text-sm font-semibold text-white">Rules</h3>
      <div className="mt-3 grid gap-3">
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Monitored">
            <TriState value={filters.monitored} onChange={(monitored) => update({ monitored })} />
          </Field>
          <Field label="Has file">
            <TriState value={filters.hasFile} onChange={(hasFile) => update({ hasFile })} />
          </Field>
        </div>
        <div className="grid gap-3 md:grid-cols-[1fr_8rem]">
          <Field label="Quality profiles">
            <input
              className={fieldClassName}
              placeholder="Any profile"
              value={filters.qualityProfiles.join(", ")}
              onChange={(event) => update({ qualityProfiles: splitCsv(event.target.value) })}
            />
          </Field>
          <Field label="FuN share">
            <div className="grid grid-cols-[4.5rem_1fr] gap-2">
              <select
                className={compactFieldClassName}
                value={filters.funShare?.operator ?? "lt"}
                onChange={(event) =>
                  update({
                    funShare: {
                      operator: event.target.value as NonNullable<AutomationGoalFilters["funShare"]>["operator"],
                      value: filters.funShare?.value ?? 0.95,
                    },
                  })
                }
              >
                <option value="lt">&lt;</option>
                <option value="lte">&lt;=</option>
                <option value="gt">&gt;</option>
                <option value="gte">&gt;=</option>
              </select>
              <NumberInput
                max={100}
                min={0}
                suffix="%"
                value={Math.round((filters.funShare?.value ?? 0.95) * 100)}
                onChange={(value) =>
                  update({
                    funShare: { operator: filters.funShare?.operator ?? "lt", value: clamp(value, 0, 100) / 100 },
                  })
                }
              />
            </div>
          </Field>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <RecencyField label="Analyzed" value={filters.analyzed} onChange={(analyzed) => update({ analyzed })} />
          <RecencyField label="Searched" value={filters.searched} onChange={(searched) => update({ searched })} />
          <RecencyField label="Grabbed" value={filters.grabbed} onChange={(grabbed) => update({ grabbed })} />
        </div>
      </div>
    </div>
  );
}

function ScheduleEditor({
  goal,
  onChange,
}: {
  goal: AutomationGoalInput;
  onChange: (patch: Partial<AutomationGoalInput>) => void;
}) {
  const schedule = goal.schedule ?? { enabled: false, intervalKind: "daily_time" as ScheduleIntervalKind, timeOfDay: "03:30" };
  const updateSchedule = (patch: Partial<typeof schedule>) => onChange({ schedule: { ...schedule, ...patch } });
  return (
    <div className="rounded-md bg-ink-950/50 p-3 shadow-surface">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-white">Schedule</h3>
        <CheckRow checked={Boolean(goal.schedule?.enabled)} label="Scheduled" onChange={(enabled) => updateSchedule({ enabled })} />
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <Field label="Cadence">
          <select
            className={fieldClassName}
            value={schedule.intervalKind}
            onChange={(event) => updateSchedule({ intervalKind: event.target.value as ScheduleIntervalKind })}
          >
            <option value="daily_time">Daily time</option>
            <option value="hours">Every N hours</option>
            <option value="days">Every N days</option>
          </select>
        </Field>
        {schedule.intervalKind === "daily_time" ? (
          <Field label="Time">
            <input className={fieldClassName} type="time" value={schedule.timeOfDay ?? "03:30"} onChange={(event) => updateSchedule({ timeOfDay: event.target.value })} />
          </Field>
        ) : (
          <Field label="Interval">
            <NumberInput min={1} suffix={schedule.intervalKind} value={schedule.intervalValue ?? 24} onChange={(value) => updateSchedule({ intervalValue: Math.max(1, Math.round(value)) })} />
          </Field>
        )}
      </div>
    </div>
  );
}

function RecencyField({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (value: AutomationRecencyFilter) => void;
  value: AutomationRecencyFilter;
}) {
  const days = "days" in value ? value.days : 7;
  return (
    <Field label={label}>
      <div className="grid grid-cols-[1fr_5rem] gap-2">
        <select
          className={compactFieldClassName}
          value={value.mode}
          onChange={(event) => {
            const mode = event.target.value as AutomationRecencyFilter["mode"];
            onChange(mode === "older_than" || mode === "within_last" ? { mode, days } : { mode });
          }}
        >
          <option value="any">Any</option>
          <option value="never">Never</option>
          <option value="older_than">Older than</option>
          <option value="within_last">Within last</option>
        </select>
        <input
          className={compactFieldClassName}
          disabled={value.mode !== "older_than" && value.mode !== "within_last"}
          min={1}
          type="number"
          value={days}
          onChange={(event) => {
            if (value.mode === "older_than" || value.mode === "within_last") {
              onChange({ mode: value.mode, days: Math.max(1, Number(event.target.value)) });
            }
          }}
        />
      </div>
    </Field>
  );
}

function TriState({ onChange, value }: { onChange: (value: AutomationTriState) => void; value: AutomationTriState }) {
  return (
    <Segmented
      options={[
        ["yes", "Yes"],
        ["no", "No"],
        ["either", "Either"],
      ]}
      value={value}
      onChange={onChange}
    />
  );
}

function Segmented<T extends string>({
  onChange,
  options,
  value,
}: {
  onChange: (value: T) => void;
  options: Array<[T, string]>;
  value: T;
}) {
  return (
    <div className="grid min-h-10 grid-flow-col overflow-hidden rounded-md bg-ink-950 p-1 shadow-surface">
      {options.map(([id, label]) => (
        <button
          className={clsx(
            "min-h-8 rounded px-2 text-xs font-semibold transition-[background-color,color,scale] duration-150 ease-out active:scale-[0.96]",
            id === value ? "bg-signal-cyan text-ink-950" : "text-ink-400 hover:bg-white/[0.06] hover:text-white",
          )}
          key={id}
          onClick={() => onChange(id)}
          type="button"
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function CheckRow({ checked, label, onChange }: { checked: boolean; label: string; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex min-h-10 cursor-pointer items-center gap-2 rounded-md bg-ink-950 px-3 text-sm text-ink-200 shadow-surface">
      <input checked={checked} className="h-4 w-4 accent-signal-cyan" type="checkbox" onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

function NumberInput({
  max,
  min,
  onChange,
  suffix,
  value,
}: {
  max?: number;
  min?: number;
  onChange: (value: number) => void;
  suffix: string;
  value: number;
}) {
  return (
    <div className="relative">
      <input
        className={clsx(fieldClassName, "pr-16 tabular-nums")}
        max={max}
        min={min}
        type="number"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-ink-500">{suffix}</span>
    </div>
  );
}

function Field({ children, label }: { children: ReactNode; label: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.06em] text-ink-500">{label}</span>
      {children}
    </label>
  );
}

function Header({ description, icon: Icon, title }: { description: string; icon: LucideIcon; title: string }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-white/[0.04] text-signal-cyan shadow-surface">
        <Icon aria-hidden="true" className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <h2 className="truncate text-base font-semibold text-white text-balance">{title}</h2>
        <p className="truncate text-sm text-ink-400">{description}</p>
      </div>
    </div>
  );
}

function Mono({ children }: { children: string }) {
  return <span className="font-mono tabular-nums text-ink-300">{children}</span>;
}

function defaultGoalInput(): AutomationGoalInput {
  return {
    actionMode: "search_and_grab",
    enabled: true,
    executionStrategy: "grab_immediately",
    filters: {
      analyzed: { mode: "any" },
      funShare: { operator: "lt", value: 0.95 },
      grabbed: { mode: "any" },
      hasFile: "yes",
      monitored: "yes",
      qualityProfiles: [],
      searched: { mode: "older_than", days: 7 },
    },
    minSearchIntervalHours: 168,
    name: "Bring library to 95% FuN",
    ordering: "oldest_search_first",
    runOnStartup: true,
    schedule: null,
    scope: "both",
    targetFunShare: 0.95,
  };
}

function toGoalInput(goal: AutomationGoalView): AutomationGoalInput {
  return {
    actionMode: goal.actionMode,
    enabled: goal.enabled,
    executionStrategy: goal.executionStrategy,
    filters: goal.filters,
    id: goal.id,
    minSearchIntervalHours: goal.minSearchIntervalHours,
    name: goal.name,
    ordering: goal.ordering,
    runOnStartup: goal.runOnStartup,
    schedule: goal.schedule,
    scope: goal.scope,
    targetFunShare: goal.targetFunShare,
  };
}

function summarizeGoals(goals: AutomationGoalView[]) {
  return {
    active: goals.filter((goal) => goal.enabled && goal.manualStatus === "active").length,
    errors: goals.filter((goal) => goal.status === "blocked_by_error").length,
    waiting: goals.filter((goal) => goal.status === "waiting_for_quota" || goal.status === "waiting_for_schedule").length,
  };
}

function splitCsv(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
