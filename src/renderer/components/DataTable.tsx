import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import type {
  ColumnDef,
  ColumnFiltersState,
  OnChangeFn,
  Row,
  RowSelectionState,
  SortingState,
  Updater,
} from "@tanstack/react-table";
import {
  flexRender,
  functionalUpdate,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown, Search } from "lucide-react";
import { clsx } from "clsx";

const EMPTY_COLUMN_FILTERS: ColumnFiltersState = [];
const EMPTY_SORTING: SortingState = [];

export interface DataTableProps<TData extends object> {
  bulkActions?: (selectedRows: Array<Row<TData>>) => ReactNode;
  columnFilters?: ColumnFiltersState;
  columns: Array<ColumnDef<TData, unknown>>;
  data: TData[];
  description?: string;
  emptyMessage?: string;
  filters?: ReactNode;
  getRowId?: (row: TData, index: number) => string;
  globalFilter?: string;
  initialColumnFilters?: ColumnFiltersState;
  initialGlobalFilter?: string;
  initialSorting?: SortingState;
  onColumnFiltersChange?: OnChangeFn<ColumnFiltersState>;
  onGlobalFilterChange?: OnChangeFn<string>;
  onRowSelectionChange?: OnChangeFn<RowSelectionState>;
  onSortingChange?: OnChangeFn<SortingState>;
  rowSelection?: RowSelectionState;
  searchPlaceholder?: string;
  sorting?: SortingState;
  title: string;
}

export function DataTable<TData extends object>({
  bulkActions,
  columnFilters,
  columns,
  data,
  description,
  emptyMessage = "No rows match the current filters.",
  filters,
  getRowId,
  globalFilter,
  initialColumnFilters = EMPTY_COLUMN_FILTERS,
  initialGlobalFilter = "",
  initialSorting = EMPTY_SORTING,
  onColumnFiltersChange,
  onGlobalFilterChange,
  onRowSelectionChange,
  onSortingChange,
  rowSelection,
  searchPlaceholder = "Search rows",
  sorting,
  title,
}: DataTableProps<TData>) {
  const [internalColumnFilters, setInternalColumnFilters] = useState<ColumnFiltersState>(initialColumnFilters);
  const [internalGlobalFilter, setInternalGlobalFilter] = useState(initialGlobalFilter);
  const [internalRowSelection, setInternalRowSelection] = useState<RowSelectionState>({});
  const [internalSorting, setInternalSorting] = useState<SortingState>(initialSorting);

  const resolvedColumnFilters = columnFilters ?? internalColumnFilters;
  const resolvedGlobalFilter = globalFilter ?? internalGlobalFilter;
  const resolvedRowSelection = rowSelection ?? internalRowSelection;
  const resolvedSorting = sorting ?? internalSorting;

  const handleColumnFiltersChange = useControlledChange(
    resolvedColumnFilters,
    onColumnFiltersChange,
    setInternalColumnFilters,
  );
  const handleGlobalFilterChange = useControlledChange(
    resolvedGlobalFilter,
    onGlobalFilterChange,
    setInternalGlobalFilter,
  );
  const handleRowSelectionChange = useControlledChange(
    resolvedRowSelection,
    onRowSelectionChange,
    setInternalRowSelection,
  );
  const handleSortingChange = useControlledChange(resolvedSorting, onSortingChange, setInternalSorting);

  const table = useReactTable({
    columns,
    data,
    enableRowSelection: true,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getRowId,
    getSortedRowModel: getSortedRowModel(),
    onColumnFiltersChange: handleColumnFiltersChange,
    onGlobalFilterChange: handleGlobalFilterChange,
    onRowSelectionChange: handleRowSelectionChange,
    onSortingChange: handleSortingChange,
    state: {
      columnFilters: resolvedColumnFilters,
      globalFilter: resolvedGlobalFilter,
      rowSelection: resolvedRowSelection,
      sorting: resolvedSorting,
    },
  });

  const selectedRows = table.getSelectedRowModel().rows;
  const rows = table.getRowModel().rows;
  const columnCount = table.getAllLeafColumns().length;
  const selectedLabel = useMemo(() => {
    const count = selectedRows.length;
    return `${count} selected`;
  }, [selectedRows.length]);

  return (
    <section className="overflow-hidden rounded-lg border border-white/10 bg-ink-900/80 shadow-surface">
      <div className="border-b border-white/10 bg-ink-900/95 px-4 py-3">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-white">{title}</h2>
            {description ? <p className="mt-1 text-sm text-ink-400">{description}</p> : null}
          </div>
          <div className="flex flex-col gap-2 md:flex-row md:items-center">
            <label className="relative block min-w-64">
              <span className="sr-only">{searchPlaceholder}</span>
              <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
              <input
                className="h-10 w-full rounded-md border border-white/10 bg-ink-950 pl-9 pr-3 text-sm text-ink-200 outline-none shadow-surface transition-[background-color,border-color,box-shadow] duration-150 ease-out placeholder:text-ink-400 focus:border-signal-cyan focus:ring-2 focus:ring-signal-cyan/30"
                onChange={(event) => handleGlobalFilterChange(event.target.value)}
                placeholder={searchPlaceholder}
                type="search"
                value={resolvedGlobalFilter}
              />
            </label>
            {filters}
          </div>
        </div>
      </div>

      {bulkActions ? (
        <div className="flex flex-col gap-2 border-b border-white/10 bg-ink-850/80 px-4 py-2 md:flex-row md:items-center md:justify-between">
          <span className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-400">{selectedLabel}</span>
          <div className="flex flex-wrap gap-2">{bulkActions(selectedRows)}</div>
        </div>
      ) : null}

      <div className="max-h-[64vh] overflow-auto">
        <table className="min-w-full border-separate border-spacing-0 text-left text-sm">
          <thead className="sticky top-0 z-10 bg-ink-850 shadow-[0_1px_0_rgba(255,255,255,0.10)]">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const sortDirection = header.column.getIsSorted();
                  const SortIcon = sortDirection === "asc" ? ArrowUp : sortDirection === "desc" ? ArrowDown : ArrowUpDown;

                  return (
                    <th
                      className="whitespace-nowrap border-b border-white/10 px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-ink-400"
                      key={header.id}
                      style={{ width: header.getSize() }}
                    >
                      {header.isPlaceholder ? null : (
                        <button
                          className={clsx(
                            "group inline-flex min-h-10 items-center gap-2 rounded px-1 text-left outline-none",
                            "transition-[background-color,color,transform] duration-150 ease-out active:scale-[0.98]",
                            header.column.getCanSort()
                              ? "cursor-pointer hover:bg-white/[0.04] hover:text-ink-200 focus-visible:ring-2 focus-visible:ring-signal-cyan/30"
                              : "cursor-default",
                          )}
                          disabled={!header.column.getCanSort()}
                          onClick={header.column.getToggleSortingHandler()}
                          type="button"
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {header.column.getCanSort() ? (
                            <SortIcon aria-hidden="true" className="h-3.5 w-3.5 text-ink-400 group-hover:text-ink-200" />
                          ) : null}
                        </button>
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {rows.length > 0 ? (
              rows.map((row) => (
                <tr
                  className="border-b border-white/5 bg-ink-900/70 transition-[background-color] duration-150 ease-out hover:bg-white/[0.035] data-[selected=true]:bg-signal-cyan/10"
                  data-selected={row.getIsSelected()}
                  key={row.id}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td className="border-b border-white/5 px-3 py-2 align-middle text-ink-200" key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td className="px-4 py-12 text-center text-sm text-ink-400" colSpan={columnCount}>
                  {emptyMessage}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function useControlledChange<TValue>(
  currentValue: TValue,
  externalOnChange: OnChangeFn<TValue> | undefined,
  internalOnChange: (value: TValue) => void,
): OnChangeFn<TValue> {
  return (updater: Updater<TValue>) => {
    const nextValue = functionalUpdate(updater, currentValue);
    internalOnChange(nextValue);
    externalOnChange?.(nextValue);
  };
}
