import { describe, expect, it } from "vitest";
import { filterOutExcluded } from "../../src/main/media-overrides";

describe("filterOutExcluded", () => {
  const items = [
    { id: "a", mediaItemId: 1 },
    { id: "b", mediaItemId: 2 },
    { id: "c", mediaItemId: null },
    { id: "d", mediaItemId: undefined },
  ];

  it("removes items whose mediaItemId is excluded", () => {
    const result = filterOutExcluded(items, new Set([2]), (item) => item.mediaItemId);
    expect(result.map((item) => item.id)).toEqual(["a", "c", "d"]);
  });

  it("keeps everything when nothing is excluded", () => {
    const result = filterOutExcluded(items, new Set<number>(), (item) => item.mediaItemId);
    expect(result).toHaveLength(4);
  });
});
