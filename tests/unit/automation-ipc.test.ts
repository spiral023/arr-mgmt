import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IpcState } from "../../src/main/ipc";
import type { IpcChannel } from "../../src/shared/ipc-contracts";

const handlers = new Map<string, (event: unknown, payload?: unknown) => unknown>();
type TestState = IpcState & {
  automationRunner?: unknown;
  repositories: Record<string, any>;
  scheduler: {
    remove: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
  };
};

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (event: unknown, payload?: unknown) => unknown) => {
      handlers.set(channel, handler);
    }),
  },
  shell: { openExternal: vi.fn() },
}));

describe("automation IPC handlers", () => {
  beforeEach(() => {
    handlers.clear();
    vi.resetModules();
  });

  it("registers automation handlers and uses an injected automation runner for manual runs", async () => {
    const { registerIpcHandlers } = await import("../../src/main/ipc");
    const automationRunner = {
      runEligible: vi.fn(),
      runGoal: vi.fn(async () => ({ id: 5, goalId: 7, status: "completed" })),
    };
    const state = createState({ automationRunner });

    registerIpcHandlers(state);

    expect(automationChannels.every((channel) => handlers.has(channel))).toBe(true);
    await expect(invoke("automation:runGoal", { goalId: 7 })).resolves.toEqual({ id: 5, goalId: 7, status: "completed" });
    expect(automationRunner.runGoal).toHaveBeenCalledWith(7, "manual");
  });

  it("validates goal id payloads defensively", async () => {
    const { registerIpcHandlers } = await import("../../src/main/ipc");
    registerIpcHandlers(createState());

    await expect(invoke("automation:getGoal", {})).rejects.toThrow("goalId is required");
    await expect(invoke("automation:deleteGoal", { goalId: 0 })).rejects.toThrow("goalId is required");
    await expect(invoke("automation:pauseGoal", { goalId: "7" })).rejects.toThrow("goalId is required");
    await expect(invoke("automation:resumeGoal", { goalId: 1.5 })).rejects.toThrow("goalId is required");
    await expect(invoke("automation:runGoal", undefined)).rejects.toThrow("goalId is required");
  });

  it("validates reorder payloads defensively", async () => {
    const { registerIpcHandlers } = await import("../../src/main/ipc");
    registerIpcHandlers(createState());

    await expect(invoke("automation:reorderGoals", {})).rejects.toThrow("goalIds are required");
    await expect(invoke("automation:reorderGoals", { goalIds: [] })).rejects.toThrow("goalIds are required");
    await expect(invoke("automation:reorderGoals", { goalIds: [1, 0] })).rejects.toThrow("goalIds are required");
    await expect(invoke("automation:reorderGoals", { goalIds: [1, "2"] })).rejects.toThrow("goalIds are required");
  });

  it("validates automation goal payload shape before saving", async () => {
    const { registerIpcHandlers } = await import("../../src/main/ipc");
    registerIpcHandlers(createState());

    await expect(invoke("automation:saveGoal", goalInput({ targetFunShare: Number.NaN }))).rejects.toThrow(
      "Invalid automation target FuN share",
    );
    await expect(
      invoke("automation:saveGoal", goalInput({ filters: { monitored: "yes" } })),
    ).rejects.toThrow("Automation filters are required");
    await expect(
      invoke(
        "automation:saveGoal",
        goalInput({
          filters: {
            ...defaultFilters(),
            searched: { mode: "older_than", days: 0 },
          },
        }),
      ),
    ).rejects.toThrow("Invalid automation recency filter");
  });

  it("registers persisted automation schedules and runs startup goals", async () => {
    const { registerPersistedAutomationGoals } = await import("../../src/main/ipc");
    const automationRunner = {
      runEligible: vi.fn(async () => []),
      runGoal: vi.fn(async () => ({ id: 9, goalId: 7, status: "completed" })),
    };
    const scheduledGoal = goalView({
      id: 7,
      name: "Scheduled goal",
      schedule: { enabled: true, intervalKind: "hours", intervalValue: 12, timeOfDay: undefined },
    });
    const state = createState({
      automationRunner,
      repositories: {
        ...createState().repositories,
        automationGoals: {
          ...createState().repositories.automationGoals,
          list: vi.fn(() => [scheduledGoal, goalView({ id: 8, schedule: null })]),
        },
      },
    });

    await registerPersistedAutomationGoals(state);

    expect(state.scheduler.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: true,
        id: "automation:7",
        name: "Automation: Scheduled goal",
        rule: { intervalKind: "hours", intervalValue: 12, timeOfDay: undefined },
      }),
    );
    expect(automationRunner.runEligible).toHaveBeenCalledWith("startup");

    const scheduledRun = state.scheduler.upsert.mock.calls[0][0].run;
    await scheduledRun();
    expect(automationRunner.runGoal).toHaveBeenCalledWith(7, "schedule");
  });

  it("updates automation schedule registration when goals are saved, paused, resumed, or deleted", async () => {
    const { registerIpcHandlers } = await import("../../src/main/ipc");
    const savedGoal = goalView({
      id: 7,
      schedule: { enabled: true, intervalKind: "days", intervalValue: 1, timeOfDay: undefined },
    });
    const automationGoals = {
      delete: vi.fn(),
      find: vi.fn((id: number) => ({ ...savedGoal, id })),
      list: vi.fn(() => []),
      reorder: vi.fn(),
      setManualStatus: vi.fn(),
      upsert: vi.fn(() => savedGoal),
    };
    const state = createState({
      repositories: {
        ...createState().repositories,
        automationGoals,
      },
    });
    registerIpcHandlers(state);

    await invoke("automation:saveGoal", goalInput({ schedule: savedGoal.schedule }));
    await invoke("automation:pauseGoal", { goalId: 7 });
    await invoke("automation:resumeGoal", { goalId: 7 });
    await invoke("automation:deleteGoal", { goalId: 7 });

    expect(state.scheduler.upsert).toHaveBeenCalledWith(expect.objectContaining({ id: "automation:7" }));
    expect(state.scheduler.remove).toHaveBeenCalledWith("automation:7");
    expect(automationGoals.delete).toHaveBeenCalledWith(7);
  });
});

const automationChannels: IpcChannel[] = [
  "automation:listGoals",
  "automation:getGoal",
  "automation:saveGoal",
  "automation:deleteGoal",
  "automation:reorderGoals",
  "automation:pauseGoal",
  "automation:resumeGoal",
  "automation:runGoal",
  "automation:runEligible",
  "automation:listEvents",
];

function invoke(channel: IpcChannel, payload?: unknown) {
  const handler = handlers.get(channel);
  if (!handler) {
    throw new Error(`Handler ${channel} was not registered`);
  }
  return Promise.resolve().then(() => handler({}, payload));
}

function createState(overrides: Record<string, unknown> = {}) {
  return {
    instanceStore: {
      getWithApiKey: vi.fn(),
      list: vi.fn(() => []),
      save: vi.fn(),
    },
    jobRunner: {
      enqueue: vi.fn(),
      listEvents: vi.fn(() => []),
      listJobs: vi.fn(() => []),
      cancel: vi.fn(),
      waitFor: vi.fn(),
    },
    repositories: {
      activityLog: { listRecent: vi.fn(() => []), countSince: vi.fn(() => 0) },
      automationEvents: { list: vi.fn(() => []) },
      automationGoals: {
        delete: vi.fn(),
        find: vi.fn((id: number) => ({ id, name: "Goal" })),
        list: vi.fn(() => []),
        reorder: vi.fn(),
        setManualStatus: vi.fn(),
        upsert: vi.fn((input) => ({ ...input, id: input.id ?? 1, priority: 1, manualStatus: "active" })),
      },
      instances: { upsert: vi.fn() },
      mediaItems: {
        itemDetails: vi.fn(),
        listRadarrRows: vi.fn(() => []),
        listSonarrRows: vi.fn(() => []),
        summary: vi.fn(),
      },
      schedules: { delete: vi.fn(), list: vi.fn(() => []), upsert: vi.fn() },
      settings: { get: vi.fn(), set: vi.fn() },
      stats: { summary: vi.fn() },
    },
    scheduler: { remove: vi.fn(), upsert: vi.fn(), isPaused: vi.fn(() => false) },
    ...overrides,
  } as unknown as TestState;
}

function goalInput(overrides: Record<string, unknown> = {}) {
  return {
    actionMode: "search_and_grab",
    enabled: true,
    executionStrategy: "grab_immediately",
    filters: defaultFilters(),
    minSearchIntervalHours: 168,
    name: "Goal",
    ordering: "oldest_search_first",
    runOnStartup: true,
    schedule: null,
    scope: "sonarr",
    targetFunShare: 0.95,
    ...overrides,
  };
}

function defaultFilters() {
  return {
    analyzed: { mode: "any" },
    funShare: { operator: "lt", value: 0.95 },
    grabbed: { mode: "any" },
    hasFile: "yes",
    monitored: "yes",
    qualityProfiles: [],
    searched: { mode: "older_than", days: 7 },
  };
}

function goalView(overrides: Record<string, unknown> = {}) {
  return {
    ...goalInput(),
    currentFunShare: 0,
    id: 1,
    manualStatus: "active",
    matchingFiles: 0,
    pendingCandidates: 0,
    priority: 1,
    remainingNonFunFiles: 0,
    status: "enabled",
    ...overrides,
  };
}
