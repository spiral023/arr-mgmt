import { describe, expect, it } from "vitest";
import {
  createInitialTableState,
  deserializeTableState,
  serializeTableState,
  updateColumnFilter,
} from "../../src/renderer/state/table-state";

describe("table-state", () => {
  it("creates an empty state with optional defaults", () => {
    expect(
      createInitialTableState({
        globalFilter: "criminal",
        sorting: [{ id: "title", desc: false }],
      }),
    ).toEqual({
      columnFilters: [],
      globalFilter: "criminal",
      rowSelection: {},
      sorting: [{ id: "title", desc: false }],
    });
  });

  it("serializes filter, sort, search, and row selection state", () => {
    const query = serializeTableState({
      columnFilters: [
        { id: "status", value: "searchable" },
        { id: "monitored", value: true },
      ],
      globalFilter: "FuN release",
      rowSelection: {
        "series-10": true,
        "series-11": false,
        "series-12": true,
      },
      sorting: [
        { id: "funShare", desc: true },
        { id: "title", desc: false },
      ],
    });

    expect(query.toString()).toBe(
      "q=FuN+release&sort=funShare%3Adesc%2Ctitle%3Aasc&filters=status%3A%22searchable%22%2Cmonitored%3Atrue&selected=series-10%2Cseries-12",
    );
  });

  it("deserializes state and ignores malformed sort/filter entries", () => {
    const state = deserializeTableState(
      new URLSearchParams({
        filters: 'status:"failed",badfilter,hasFile:true,count:4',
        q: "matrix",
        selected: "movie-1,movie-2",
        sort: "title:asc,bad:sideways,year:desc,:asc",
      }),
    );

    expect(state).toEqual({
      columnFilters: [
        { id: "status", value: "failed" },
        { id: "hasFile", value: true },
        { id: "count", value: 4 },
      ],
      globalFilter: "matrix",
      rowSelection: {
        "movie-1": true,
        "movie-2": true,
      },
      sorting: [
        { id: "title", desc: false },
        { id: "year", desc: true },
      ],
    });
  });

  it("adds, replaces, and removes a column filter immutably", () => {
    const original = [{ id: "status", value: "running" }];

    expect(updateColumnFilter(original, "status", "failed")).toEqual([
      { id: "status", value: "failed" },
    ]);
    expect(updateColumnFilter(original, "kind", "grab")).toEqual([
      { id: "status", value: "running" },
      { id: "kind", value: "grab" },
    ]);
    expect(updateColumnFilter(original, "status", "")).toEqual([]);
    expect(original).toEqual([{ id: "status", value: "running" }]);
  });
});
