import { describe, expect, it } from "vitest";
import { orderAutomationWorkItems } from "../../src/main/automation/ordering";
import type { AutomationWorkItemForOrdering } from "../../src/main/automation/automation-types";

describe("orderAutomationWorkItems", () => {
  it("sorts searched items by oldest last searched date first, then never searched items alphabetically", () => {
    const items = [
      workItem({ title: "Zulu", sortKey: "zulu", lastSearchedAt: null }),
      workItem({ title: "Beta", sortKey: "beta", lastSearchedAt: "2026-06-17T12:00:00.000Z" }),
      workItem({ title: "Alpha", sortKey: "alpha", lastSearchedAt: null }),
      workItem({ title: "Gamma", sortKey: "gamma", lastSearchedAt: "2026-06-01T12:00:00.000Z" }),
    ];

    const ordered = orderAutomationWorkItems(items, "oldest_search_first");

    expect(ordered.map((item) => item.title)).toEqual(["Gamma", "Beta", "Alpha", "Zulu"]);
    expect(ordered).not.toBe(items);
    expect(items.map((item) => item.title)).toEqual(["Zulu", "Beta", "Alpha", "Gamma"]);
  });

  it("supports lowest FuN share, largest impact, and alphabetical orderings", () => {
    const items = [
      workItem({ title: "Zulu", sortKey: "zulu", itemFunShare: 0.8, sizeBytes: 200 }),
      workItem({ title: "Alpha", sortKey: "alpha", itemFunShare: 0.2, sizeBytes: 100 }),
      workItem({ title: "Beta", sortKey: "beta", itemFunShare: 0.5, sizeBytes: 300 }),
    ];

    expect(orderAutomationWorkItems(items, "lowest_fun_share_first").map((item) => item.title)).toEqual([
      "Alpha",
      "Beta",
      "Zulu",
    ]);
    expect(orderAutomationWorkItems(items, "largest_impact_first").map((item) => item.title)).toEqual([
      "Beta",
      "Zulu",
      "Alpha",
    ]);
    expect(orderAutomationWorkItems(items, "alphabetical").map((item) => item.title)).toEqual(["Alpha", "Beta", "Zulu"]);
  });

  it("uses stable identity fields to order duplicate sort keys and titles deterministically", () => {
    const items = [
      workItem({ instanceId: 2, kind: "episode", childArrId: 10, mediaFileId: 5 }),
      workItem({ instanceId: 1, kind: "movie", childArrId: 10, mediaFileId: 5 }),
      workItem({ instanceId: 1, kind: "episode", childArrId: 11, mediaFileId: null }),
      workItem({ instanceId: 1, kind: "episode", childArrId: 10, mediaFileId: 6 }),
      workItem({ instanceId: 1, kind: "episode", childArrId: 10, mediaFileId: 5 }),
    ];

    expect(orderAutomationWorkItems(items, "alphabetical").map(identity)).toEqual([
      "1:episode:10:5",
      "1:episode:10:6",
      "1:episode:11:null",
      "1:movie:10:5",
      "2:episode:10:5",
    ]);
  });
});

function workItem(overrides: Partial<AutomationWorkItemForOrdering> = {}): AutomationWorkItemForOrdering {
  return {
    instanceId: 1,
    kind: "episode",
    childArrId: 1,
    mediaFileId: 1,
    title: "Example",
    sortKey: "example",
    itemFunShare: 0.5,
    sizeBytes: 1_000,
    lastSearchedAt: null,
    ...overrides,
  };
}

function identity(item: AutomationWorkItemForOrdering): string {
  return `${item.instanceId}:${item.kind}:${item.childArrId}:${item.mediaFileId}`;
}
