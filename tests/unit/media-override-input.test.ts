import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn(),
  },
  shell: { openExternal: vi.fn() },
}));

describe("assertMediaOverrideInput", () => {
  it("accepts a valid movie exclusion payload", async () => {
    const { assertMediaOverrideInput } = await import("../../src/main/ipc");
    expect(assertMediaOverrideInput({ kind: "movie", arrId: 201, excluded: true })).toEqual({
      kind: "movie",
      arrId: 201,
      excluded: true,
      note: undefined,
    });
  });

  it("rejects an invalid kind", async () => {
    const { assertMediaOverrideInput } = await import("../../src/main/ipc");
    expect(() => assertMediaOverrideInput({ kind: "album", arrId: 1, excluded: true })).toThrow();
  });

  it("rejects a non-positive arrId", async () => {
    const { assertMediaOverrideInput } = await import("../../src/main/ipc");
    expect(() => assertMediaOverrideInput({ kind: "series", arrId: 0, excluded: true })).toThrow();
  });

  it("rejects a non-boolean excluded flag", async () => {
    const { assertMediaOverrideInput } = await import("../../src/main/ipc");
    expect(() => assertMediaOverrideInput({ kind: "series", arrId: 5, excluded: "yes" })).toThrow();
  });
});
