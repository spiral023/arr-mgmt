import { beforeEach, describe, expect, it, vi } from "vitest";
import { Scheduler } from "../../src/main/scheduler/scheduler";
import { registerIpcHandlers, registerPersistedAutomationGoals, type IpcState } from "../../src/main/ipc";

const handlers = new Map<string, (event: unknown, payload?: unknown) => unknown>();
vi.mock("electron", () => ({
  ipcMain: { handle: (channel: string, handler: (event: unknown, payload?: unknown) => unknown) => handlers.set(channel, handler) },
  shell: { openExternal: vi.fn() },
}));

describe("scheduler IPC", () => {
  beforeEach(() => handlers.clear());

  it("uses the actual scheduler shared with tray controls", () => {
    const scheduler = new Scheduler();
    registerIpcHandlers({ scheduler } as IpcState);
    expect(handlers.get("scheduler:getState")?.(null)).toEqual({ paused: false });
    expect(handlers.get("scheduler:setPaused")?.(null, { paused: true })).toEqual({ paused: true });
    expect(scheduler.isPaused()).toBe(true);
    scheduler.setPaused(false);
    expect(handlers.get("scheduler:getState")?.(null)).toEqual({ paused: false });
  });

  it.each([undefined, {}, { paused: "true" }, { paused: 1 }])("rejects invalid pause payloads: %j", (payload) => {
    const scheduler = new Scheduler();
    registerIpcHandlers({ scheduler } as IpcState);
    expect(() => handlers.get("scheduler:setPaused")?.(null, payload)).toThrow("paused must be a boolean");
    expect(scheduler.isPaused()).toBe(false);
  });

  it("does not start startup automations when a persisted pause is restored", async () => {
    const scheduler = new Scheduler();
    scheduler.setPaused(true);
    const runEligible = vi.fn();
    await registerPersistedAutomationGoals({ scheduler,
      repositories: { automationGoals: { list: () => [] } }, automationRunner: { runEligible },
    } as unknown as IpcState);
    expect(runEligible).not.toHaveBeenCalled();
  });
});
