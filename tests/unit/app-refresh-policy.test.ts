import { describe, expect, it } from "vitest";
import { shouldRefreshSonarrRows } from "../../src/renderer/state/refresh-policy";

describe("shouldRefreshSonarrRows", () => {
  it("refreshes the large Sonarr row set only while the Sonarr tab is visible", () => {
    expect(shouldRefreshSonarrRows("sonarr")).toBe(true);
    expect(shouldRefreshSonarrRows("dashboard")).toBe(false);
    expect(shouldRefreshSonarrRows("jobs")).toBe(false);
  });
});
