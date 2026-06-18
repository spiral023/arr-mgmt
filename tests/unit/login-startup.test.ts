import { describe, expect, it, vi } from "vitest";
import { applyLoginStartupSetting } from "../../src/main/settings/login-startup";
import type { AppSettings } from "../../src/shared/ipc-contracts";

describe("login startup settings", () => {
  it("applies the open-at-login setting to Electron", () => {
    const adapter = {
      setLoginItemSettings: vi.fn(),
    };

    applyLoginStartupSetting(settingsWithOpenAtLogin(true), adapter);
    applyLoginStartupSetting(settingsWithOpenAtLogin(false), adapter);

    expect(adapter.setLoginItemSettings).toHaveBeenNthCalledWith(1, { openAtLogin: true });
    expect(adapter.setLoginItemSettings).toHaveBeenNthCalledWith(2, { openAtLogin: false });
  });
});

function settingsWithOpenAtLogin(openAtLogin: boolean): AppSettings {
  return {
    automation: { quotaSafetyPercent: 90 },
    cooldownHours: { episodeSearch: 24, movieSearch: 24 },
    fun: { displayName: "FuN*", prefixes: ["fun"] },
    notifications: { candidatesFound: true, jobFinished: true, quotaExhausted: true },
    quota: { grabLimit: 400, searchLimit: 10000, windowHours: 24 },
    tray: { keepRunningOnClose: true, openAtLogin, showControls: true },
  };
}
