import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/renderer/App";
import { getSchedulerState, setSchedulerPaused } from "../../src/renderer/state/ipc-client";

const events = vi.hoisted(() => ({ callback: undefined as undefined | ((value: { paused: boolean }) => void) }));
vi.mock("../../src/renderer/state/ipc-client", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../src/renderer/state/ipc-client")>(),
  getSchedulerState: vi.fn(async () => ({ paused: false })),
  setSchedulerPaused: vi.fn(async (paused: boolean) => ({ paused })),
  subscribeToSchedulerEvents: (callback: (value: { paused: boolean }) => void) => {
    events.callback = callback;
    return () => { events.callback = undefined; };
  },
}));

describe("scheduler controls", () => {
  beforeEach(() => {
    vi.mocked(getSchedulerState).mockResolvedValue({ paused: false });
    vi.mocked(setSchedulerPaused).mockImplementation(async (paused) => ({ paused }));
  });

  it("loads persisted state, calls the backend, and reflects changes from the tray", async () => {
    vi.mocked(getSchedulerState).mockResolvedValue({ paused: true });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Resume scheduler" }));
    await waitFor(() => expect(setSchedulerPaused).toHaveBeenCalledWith(false));
    await screen.findByRole("button", { name: "Pause scheduler" });
    events.callback?.({ paused: true });
    await screen.findByRole("button", { name: "Resume scheduler" });
  });

  it("retains the confirmed state and shows failures instead of pretending to pause", async () => {
    vi.mocked(setSchedulerPaused).mockRejectedValue(new Error("IPC failed"));
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Pause scheduler" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Scheduler state could not be changed");
    expect(screen.getByRole("button", { name: "Pause scheduler" })).toBeEnabled();
  });
});
