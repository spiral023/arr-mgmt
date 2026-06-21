import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn() },
  shell: { openExternal: vi.fn() },
  safeStorage: { encryptString: vi.fn(), decryptString: vi.fn() },
  app: { getPath: vi.fn(() => ""), whenReady: vi.fn() },
}));

import * as ipc from "../main/ipc";

describe("ipc workflow helper exports", () => {
  it("exposes the helpers the CLI relies on", () => {
    for (const name of [
      "enqueueSonarrAnalysis",
      "enqueueRadarrAnalysis",
      "enqueueSonarrSearch",
      "enqueueSonarrGrab",
      "enqueueRadarrSearch",
      "enqueueRadarrGrab",
      "enqueueCombinedJob",
      "getQuotaSummary",
      "formatSonarrRowDates",
      "formatRadarrRowDates",
      "formatActivityRow",
      "createProductionAutomationRunner",
    ]) {
      expect(typeof (ipc as Record<string, unknown>)[name], name).toBe("function");
    }
  });
});
