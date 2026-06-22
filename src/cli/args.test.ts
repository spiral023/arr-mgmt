import { describe, expect, it } from "vitest";
import { isCliInvocation, parseCliArgs, parseIds } from "./args";

describe("parseIds", () => {
  it("parses a comma list into positive integers", () => {
    expect(parseIds("1,2,3")).toEqual([1, 2, 3]);
  });
  it("drops non-integers and non-positives", () => {
    expect(parseIds("1,0,-2,x,4")).toEqual([1, 4]);
  });
  it("returns [] for undefined", () => {
    expect(parseIds(undefined)).toEqual([]);
  });
  it("extracts IDs from Radarr URLs and comma lists", () => {
    expect(parseIds("http://192.168.0.170:7878/movie/14292,9050")).toEqual([14292, 9050]);
  });
});

describe("isCliInvocation", () => {
  it("is true when --cli is present", () => {
    expect(isCliInvocation(["--cli"])).toBe(true);
  });
  it("is true when the first positional is a known verb", () => {
    expect(isCliInvocation(["library", "summary"])).toBe(true);
  });
  it("is false for GUI-style invocation", () => {
    expect(isCliInvocation([])).toBe(false);
    expect(isCliInvocation(["--some-electron-flag"])).toBe(false);
  });
});

describe("parseCliArgs", () => {
  it("extracts verb, sub and rest positionals (ignoring --cli)", () => {
    const a = parseCliArgs(["--cli", "item", "series", "123"]);
    expect(a.verb).toBe("item");
    expect(a.sub).toBe("series");
    expect(a.rest).toEqual(["123"]);
  });
  it("parses options and ids", () => {
    const a = parseCliArgs(["search", "sonarr", "--ids", "5,8", "--limit", "10", "--pretty"]);
    expect(a.sub).toBe("sonarr");
    expect(a.ids).toEqual([5, 8]);
    expect(a.limit).toBe(10);
    expect(a.pretty).toBe(true);
    expect(a.full).toBe(false);
  });
  it("parses the missing grab flag", () => {
    const a = parseCliArgs(["missing", "radarr", "--ids", "http://192.168.0.170:7878/movie/14292", "--grab"]);
    expect(a.verb).toBe("missing");
    expect(a.sub).toBe("radarr");
    expect(a.ids).toEqual([14292]);
    expect(a.grab).toBe(true);
  });
  it("defaults verb to help when no positional is given", () => {
    expect(parseCliArgs(["--cli"]).verb).toBe("help");
  });
});
