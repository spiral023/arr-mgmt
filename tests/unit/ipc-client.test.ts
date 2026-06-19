import { afterEach, describe, expect, it, vi } from "vitest";
import {
  analyzeRadarr,
  deleteAutomationGoal,
  grabRadarrMovies,
  getAutomationGoal,
  listAutomationEvents,
  listAutomationGoals,
  pauseAutomationGoal,
  reorderAutomationGoals,
  resumeAutomationGoal,
  runAutomationEligible,
  runAutomationGoal,
  saveAutomationGoal,
  searchRadarrMovies,
} from "../../src/renderer/state/ipc-client";
import type { AutomationGoalInput } from "../../src/shared/ipc-contracts";

describe("ipc-client Radarr actions", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(window, "arrOps");
  });

  it("targets Radarr channels instead of Sonarr channels", async () => {
    const invoke = vi.fn(async () => ({ ok: true })) as unknown as Window["arrOps"]["invoke"] & {
      mock: { calls: Array<[string, unknown?]> };
    };
    window.arrOps = {
      invoke,
      onJobEvent: () => () => undefined,
    };

    await analyzeRadarr([201]);
    await searchRadarrMovies([201]);
    await grabRadarrMovies([201]);

    expect(invoke.mock.calls.map(([channel]) => channel)).toEqual([
      "jobs:enqueue",
      "radarr:search",
      "radarr:grab",
    ]);
    expect(invoke.mock.calls[0][1]).toEqual({
      movieIds: [201],
      name: "Analyze selected Radarr movies",
      target: "radarr",
    });
  });
});

describe("ipc-client automation actions", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(window, "arrOps");
  });

  it("invokes automation channels with the expected payloads", async () => {
    const invoke = vi.fn(async () => ({ ok: true })) as unknown as Window["arrOps"]["invoke"] & {
      mock: { calls: Array<[string, unknown?]> };
    };
    window.arrOps = {
      invoke,
      onJobEvent: () => () => undefined,
    };
    const goal = automationGoalInput();

    await listAutomationGoals();
    await getAutomationGoal(7);
    await saveAutomationGoal(goal);
    await deleteAutomationGoal(7);
    await reorderAutomationGoals([9, 7]);
    await pauseAutomationGoal(7);
    await resumeAutomationGoal(7);
    await runAutomationGoal(7);
    await runAutomationEligible();
    await listAutomationEvents(7);

    expect(invoke.mock.calls).toEqual([
      ["automation:listGoals", undefined],
      ["automation:getGoal", { goalId: 7 }],
      ["automation:saveGoal", goal],
      ["automation:deleteGoal", { goalId: 7 }],
      ["automation:reorderGoals", { goalIds: [9, 7] }],
      ["automation:pauseGoal", { goalId: 7 }],
      ["automation:resumeGoal", { goalId: 7 }],
      ["automation:runGoal", { goalId: 7 }],
      ["automation:runEligible", undefined],
      ["automation:listEvents", { goalId: 7 }],
    ]);
  });
});

function automationGoalInput(): AutomationGoalInput {
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
      searched: { mode: "any" },
    },
    minSearchIntervalHours: 168,
    name: "Goal",
    ordering: "oldest_search_first",
    runOnStartup: true,
    schedule: null,
    scope: "sonarr",
    targetFunShare: 0.95,
  };
}
