import { describe, expect, it } from "vitest";
import { fail, ok, paginate, pickFields, render } from "./output";

describe("output", () => {
  it("ok wraps data with a hint and omits page when absent", () => {
    expect(ok({ a: 1 }, "tip")).toEqual({ ok: true, hint: "tip", data: { a: 1 } });
  });

  it("ok includes page when provided", () => {
    const page = { total: 3, shown: 2, offset: 0 };
    expect(ok([1, 2], "tip", page)).toEqual({ ok: true, hint: "tip", data: [1, 2], page });
  });

  it("fail wraps an error with code and hint", () => {
    expect(fail("x_error", "boom", "do y")).toEqual({
      ok: false,
      hint: "do y",
      error: { code: "x_error", message: "boom" },
    });
  });

  it("paginate slices and reports counts", () => {
    const { slice, page } = paginate([1, 2, 3, 4, 5], 1, 2);
    expect(slice).toEqual([2, 3]);
    expect(page).toEqual({ total: 5, shown: 2, offset: 1 });
  });

  it("paginate clamps a negative offset to 0", () => {
    const { page } = paginate([1, 2, 3], -4, 2);
    expect(page.offset).toBe(0);
  });

  it("pickFields keeps only the requested keys", () => {
    expect(pickFields({ a: 1, b: 2, c: 3 }, ["a", "c"])).toEqual({ a: 1, c: 3 });
  });

  it("render is compact by default and indented with pretty", () => {
    const r = ok({ a: 1 }, "tip");
    expect(render(r, false)).toBe('{"ok":true,"hint":"tip","data":{"a":1}}');
    expect(render(r, true)).toContain("\n  ");
  });
});
