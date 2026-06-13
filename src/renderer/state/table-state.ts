import type { ColumnFiltersState, RowSelectionState, SortingState } from "@tanstack/react-table";

export type TableFilterValue = boolean | number | string;

export interface PersistedTableState {
  columnFilters: ColumnFiltersState;
  globalFilter: string;
  rowSelection: RowSelectionState;
  sorting: SortingState;
}

export type TableStateDefaults = Partial<PersistedTableState>;

export function createInitialTableState(defaults: TableStateDefaults = {}): PersistedTableState {
  return {
    columnFilters: defaults.columnFilters ?? [],
    globalFilter: defaults.globalFilter ?? "",
    rowSelection: defaults.rowSelection ?? {},
    sorting: defaults.sorting ?? [],
  };
}

export function serializeTableState(state: PersistedTableState): URLSearchParams {
  const params = new URLSearchParams();
  const globalFilter = state.globalFilter.trim();
  const sorting = serializeSorting(state.sorting);
  const filters = serializeFilters(state.columnFilters);
  const selected = serializeRowSelection(state.rowSelection);

  if (globalFilter) {
    params.set("q", globalFilter);
  }
  if (sorting) {
    params.set("sort", sorting);
  }
  if (filters) {
    params.set("filters", filters);
  }
  if (selected) {
    params.set("selected", selected);
  }

  return params;
}

export function deserializeTableState(params: URLSearchParams): PersistedTableState {
  return {
    columnFilters: deserializeFilters(params.get("filters")),
    globalFilter: params.get("q") ?? "",
    rowSelection: deserializeRowSelection(params.get("selected")),
    sorting: deserializeSorting(params.get("sort")),
  };
}

export function updateColumnFilter(
  filters: ColumnFiltersState,
  id: string,
  value: TableFilterValue | null | undefined,
): ColumnFiltersState {
  const nextFilters = filters.filter((filter) => filter.id !== id);

  if (value === "" || value === null || value === undefined) {
    return nextFilters;
  }

  return [...nextFilters, { id, value }];
}

function serializeSorting(sorting: SortingState): string {
  return sorting.reduce<string[]>((parts, sort) => {
    if (sort.id) {
      parts.push(`${sort.id}:${sort.desc ? "desc" : "asc"}`);
    }

    return parts;
  }, []).join(",");
}

function deserializeSorting(value: string | null): SortingState {
  if (!value) {
    return [];
  }

  return value.split(",").flatMap((part) => {
    const [id, direction] = part.split(":");
    if (!id || (direction !== "asc" && direction !== "desc")) {
      return [];
    }

    return [{ id, desc: direction === "desc" }];
  });
}

function serializeFilters(filters: ColumnFiltersState): string {
  return filters.reduce<string[]>((parts, filter) => {
    if (filter.id && filter.value !== "" && filter.value !== null && filter.value !== undefined) {
      parts.push(`${filter.id}:${JSON.stringify(filter.value)}`);
    }

    return parts;
  }, []).join(",");
}

function deserializeFilters(value: string | null): ColumnFiltersState {
  if (!value) {
    return [];
  }

  return value.split(",").flatMap((part) => {
    const separatorIndex = part.indexOf(":");
    if (separatorIndex <= 0 || separatorIndex === part.length - 1) {
      return [];
    }

    const id = part.slice(0, separatorIndex);
    const rawValue = part.slice(separatorIndex + 1);

    try {
      return [{ id, value: JSON.parse(rawValue) as TableFilterValue }];
    } catch {
      return [];
    }
  });
}

function serializeRowSelection(rowSelection: RowSelectionState): string {
  return Object.entries(rowSelection).reduce<string[]>((parts, [id, selected]) => {
    if (selected) {
      parts.push(id);
    }

    return parts;
  }, []).join(",");
}

function deserializeRowSelection(value: string | null): RowSelectionState {
  if (!value) {
    return {};
  }

  return value.split(",").reduce<RowSelectionState>((selection, rawId) => {
    const id = rawId.trim();
    if (id) {
      selection[id] = true;
    }

    return selection;
  }, {});
}
