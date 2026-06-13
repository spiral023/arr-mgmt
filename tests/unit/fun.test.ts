import { describe, expect, it } from "vitest";
import { isFunReleaseGroup } from "../../src/shared/fun";

describe("isFunReleaseGroup", () => {
  it("matches the default FuN prefix case-insensitively after trimming", () => {
    expect(isFunReleaseGroup("FuN")).toBe(true);
    expect(isFunReleaseGroup("FUNHD")).toBe(true);
    expect(isFunReleaseGroup(" fun-team ")).toBe(true);
  });

  it("does not match empty, nullish, or unrelated release groups", () => {
    expect(isFunReleaseGroup("WvF")).toBe(false);
    expect(isFunReleaseGroup("")).toBe(false);
    expect(isFunReleaseGroup(null)).toBe(false);
    expect(isFunReleaseGroup(undefined)).toBe(false);
  });

  it("uses custom prefixes with the same trimming and case-folding rules", () => {
    expect(isFunReleaseGroup(" Proper-Team ", [" proper "])).toBe(true);
    expect(isFunReleaseGroup("FuN", ["proper"])).toBe(false);
  });
});
