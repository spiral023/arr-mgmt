import { describe, expect, it } from "vitest";
import { matchesAutomationFilters } from "../../src/main/automation/filtering";
import type { AutomationMediaFile } from "../../src/main/automation/automation-types";
import type { AutomationGoalFilters } from "../../src/shared/ipc-contracts";

const now = new Date("2026-06-18T12:00:00.000Z");

const filters = {
  monitored: "yes",
  hasFile: "yes",
  qualityProfiles: ["WEBDL-1080p"],
  funShare: { operator: "lt", value: 0.9 },
  analyzed: { mode: "within_last", days: 2 },
  searched: { mode: "older_than", days: 7 },
  grabbed: { mode: "never" },
} satisfies AutomationGoalFilters;

describe("matchesAutomationFilters", () => {
  it("returns true for a file matching every AND criterion", () => {
    expect(matchesAutomationFilters(mediaFile(), filters, now)).toBe(true);
  });

  it("returns false when one AND criterion fails", () => {
    expect(matchesAutomationFilters(mediaFile({ qualityProfileName: "Bluray-1080p" }), filters, now)).toBe(false);
  });

  it("supports tri-state no values for monitored, has file, analyzed, searched, and grabbed", () => {
    const triStateFilters = {
      monitored: "no",
      hasFile: "no",
      qualityProfiles: [],
      funShare: null,
      analyzed: { mode: "never" },
      searched: { mode: "never" },
      grabbed: { mode: "never" },
    } satisfies AutomationGoalFilters;

    expect(
      matchesAutomationFilters(
        mediaFile({
          monitored: false,
          hasFile: false,
          lastAnalyzedAt: null,
          lastSearchedAt: null,
          lastGrabbedAt: null,
          qualityProfileName: null,
        }),
        triStateFilters,
        now,
      ),
    ).toBe(true);
  });

  it("supports any tri-state filters, empty quality profile lists, FuN share comparisons, and recent grabbed timestamps", () => {
    const permissiveFilters = {
      monitored: "either",
      hasFile: "either",
      qualityProfiles: [],
      funShare: { operator: "gte", value: 0.4 },
      analyzed: { mode: "any" },
      searched: { mode: "any" },
      grabbed: { mode: "within_last", days: 1 },
    } satisfies AutomationGoalFilters;

    expect(
      matchesAutomationFilters(
        mediaFile({
          monitored: false,
          hasFile: false,
          itemFunShare: 0.4,
          lastGrabbedAt: "2026-06-18T06:00:00.000Z",
          qualityProfileName: null,
        }),
        permissiveFilters,
        now,
      ),
    ).toBe(true);
  });
});

function mediaFile(overrides: Partial<AutomationMediaFile> = {}): AutomationMediaFile {
  return {
    instanceId: 1,
    instanceKind: "sonarr",
    mediaItemId: 10,
    mediaFileId: 100,
    childArrId: 101,
    kind: "episode",
    title: "Example Series S01E01",
    sortKey: "example series s01e01",
    isFun: false,
    qualityName: "WEBDL-1080p",
    releaseGroup: "WvF",
    sizeBytes: 1_000,
    seasonNumber: 1,
    episodeNumber: 1,
    monitored: true,
    hasFile: true,
    itemFunShare: 0.5,
    lastAnalyzedAt: "2026-06-17T12:00:00.000Z",
    lastSearchedAt: "2026-06-01T12:00:00.000Z",
    lastGrabbedAt: null,
    qualityProfileName: "WEBDL-1080p",
    ...overrides,
  };
}
