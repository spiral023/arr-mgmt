import { useEffect, useState } from "react";
import type { ColumnFiltersState, RowSelectionState, SortingState, Updater } from "@tanstack/react-table";
import { functionalUpdate } from "@tanstack/react-table";
import { createInitialTableState, type PersistedTableState, type TableStateDefaults } from "./table-state";

export function usePersistedTableState(key: string, defaults: TableStateDefaults = {}) {
  const [state, setState] = useState<PersistedTableState>(() => readState(key, defaults));

  useEffect(() => {
    window.localStorage.setItem(key, JSON.stringify(state));
  }, [key, state]);

  return {
    state,
    setColumnFilters: (updater: Updater<ColumnFiltersState>) =>
      setState((current) => ({ ...current, columnFilters: functionalUpdate(updater, current.columnFilters) })),
    setGlobalFilter: (updater: Updater<string>) =>
      setState((current) => ({ ...current, globalFilter: functionalUpdate(updater, current.globalFilter) })),
    setRowSelection: (updater: Updater<RowSelectionState>) =>
      setState((current) => ({ ...current, rowSelection: functionalUpdate(updater, current.rowSelection) })),
    setSorting: (updater: Updater<SortingState>) =>
      setState((current) => ({ ...current, sorting: functionalUpdate(updater, current.sorting) })),
  };
}

function readState(key: string, defaults: TableStateDefaults): PersistedTableState {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return createInitialTableState(defaults);
    }
    return { ...createInitialTableState(defaults), ...(JSON.parse(raw) as Partial<PersistedTableState>) };
  } catch {
    return createInitialTableState(defaults);
  }
}
