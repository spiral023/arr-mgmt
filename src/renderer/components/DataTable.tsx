import type { ReactNode } from "react";
import { useMemo, useRef, useState } from "react";
import type {
  ColumnDef,
  ColumnFiltersState,
  OnChangeFn,
  Row,
  RowSelectionState,
  SortingState,
  Table,
  Updater,
  VisibilityState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  flexRender,
  functionalUpdate,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown, Columns3, Search } from "lucide-react";
import { clsx } from "clsx";

const EMPTY_COLUMN_FILTERS: ColumnFiltersState = [];
const EMPTY_SORTING: SortingState = [];
const VIRTUALIZATION_THRESHOLD = 100;
const VIRTUAL_ROW_HEIGHT = 42;

export interface DataTableProps<TData extends object> {
  bulkActions?: (selectedRows: Array<Row<TData>>) => ReactNode;
  columnFilters?: ColumnFiltersState;
  columns: Array<ColumnDef<TData, unknown>>;
  data: TData[];
  description?: string;
  emptyMessage?: string;
  enableColumnVisibility?: boolean;
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
  selectedSummary?: (selectedRows: Array<Row<TData>>) => string;
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
  enableColumnVisibility = false,
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
  selectedSummary,
  sorting,
  title,
}: DataTableProps<TData>) {
  const [internalColumnFilters, setInternalColumnFilters] = useState<ColumnFiltersState>(initialColumnFilters);
  const [internalGlobalFilter, setInternalGlobalFilter] = useState(initialGlobalFilter);
  const [internalRowSelection, setInternalRowSelection] = useState<RowSelectionState>({});
  const [internalSorting, setInternalSorting] = useState<SortingState>(initialSorting);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [columnMenuOpen, setColumnMenuOpen] = useState(false);
  const lastRangeRowIdRef = useRef<string | null>(null);

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
    onColumnVisibilityChange: setColumnVisibility,
    onGlobalFilterChange: handleGlobalFilterChange,
    onRowSelectionChange: handleRowSelectionChange,
    onSortingChange: handleSortingChange,
    state: {
      columnFilters: resolvedColumnFilters,
      columnVisibility,
      globalFilter: resolvedGlobalFilter,
      rowSelection: resolvedRowSelection,
      sorting: resolvedSorting,
    },
  });

  const selectedRows = table.getSelectedRowModel().rows;
  const rows = table.getRowModel().rows;
  const columnCount = table.getAllLeafColumns().length;
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const shouldVirtualize = rows.length > VIRTUALIZATION_THRESHOLD;
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    enabled: shouldVirtualize,
    estimateSize: () => VIRTUAL_ROW_HEIGHT,
    getScrollElement: () => scrollContainerRef.current,
    initialRect: { height: 640, width: 0 },
    overscan: 12,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();
  const fallbackVirtualIndexes = useMemo(
    () =>
      shouldVirtualize && virtualRows.length === 0
        ? rows.slice(0, 50).map((_, index) => index)
        : [],
    [rows, shouldVirtualize, virtualRows.length],
  );
  const visibleRowIndexes = shouldVirtualize
    ? virtualRows.length > 0
      ? virtualRows.map((virtualRow) => virtualRow.index)
      : fallbackVirtualIndexes
    : rows.map((_, index) => index);
  const paddingTop = shouldVirtualize && virtualRows.length > 0 ? virtualRows[0].start : 0;
  const paddingBottom =
    shouldVirtualize && virtualRows.length > 0
      ? rowVirtualizer.getTotalSize() - virtualRows[virtualRows.length - 1].end
      : shouldVirtualize
        ? Math.max(0, rows.length - visibleRowIndexes.length) * VIRTUAL_ROW_HEIGHT
        : 0;
  const selectedLabel = useMemo(() => {
    return selectedSummary ? selectedSummary(selectedRows) : `${selectedRows.length} selected`;
  }, [selectedRows, selectedSummary]);

  function handleTableSelectionClick(event: React.MouseEvent<HTMLTableElement>) {
    if (!isCheckboxClick(event.target)) {
      return;
    }

    const rowId = event.target.closest("tr")?.dataset.rowId;
    const row = rowId ? table.getRowModel().rows.find((candidate) => candidate.id === rowId) : undefined;
    if (!row) {
      return;
    }

    if (!event.shiftKey || !lastRangeRowIdRef.current) {
      lastRangeRowIdRef.current = row.id;
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const visibleRows = table.getRowModel().rows;
    const previousIndex = visibleRows.findIndex((candidate) => candidate.id === lastRangeRowIdRef.current);
    const currentIndex = visibleRows.findIndex((candidate) => candidate.id === row.id);
    if (previousIndex < 0 || currentIndex < 0) {
      lastRangeRowIdRef.current = row.id;
      return;
    }

    const [start, end] = previousIndex < currentIndex ? [previousIndex, currentIndex] : [currentIndex, previousIndex];
    const shouldSelectRange = event.target.checked;

    handleRowSelectionChange((current) => {
      const next = { ...current };
      for (const rangeRow of visibleRows.slice(start, end + 1)) {
        if (shouldSelectRange) {
          next[rangeRow.id] = true;
        } else {
          delete next[rangeRow.id];
        }
      }
      return next;
    });
    lastRangeRowIdRef.current = row.id;
  }

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
            {enableColumnVisibility ? <ColumnVisibilityMenu open={columnMenuOpen} onOpenChange={setColumnMenuOpen} table={table} /> : null}
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

      <div className="max-h-[64vh] overflow-auto" ref={scrollContainerRef}>
        <table className="min-w-full border-separate border-spacing-0 text-left text-sm" onClickCapture={handleTableSelectionClick}>
          <thead className="sticky top-0 z-10 bg-ink-850 shadow-[0_1px_0_rgba(255,255,255,0.10)]">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const sortDirection = header.column.getIsSorted();
                  const SortIcon = sortDirection === "asc" ? ArrowUp : sortDirection === "desc" ? ArrowDown : ArrowUpDown;

                  const headerContent = flexRender(header.column.columnDef.header, header.getContext());

                  return (
                    <th
                      className="whitespace-nowrap border-b border-white/10 px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-ink-400"
                      key={header.id}
                      style={{ width: header.getSize() }}
                    >
                      {header.isPlaceholder ? null : header.column.getCanSort() ? (
                        <button
                          className={clsx(
                            "group inline-flex min-h-10 items-center gap-2 rounded px-1 text-left outline-none",
                            "transition-[background-color,color,transform] duration-150 ease-out active:scale-[0.98]",
                            "cursor-pointer hover:bg-white/[0.04] hover:text-ink-200 focus-visible:ring-2 focus-visible:ring-signal-cyan/30",
                          )}
                          onClick={header.column.getToggleSortingHandler()}
                          type="button"
                        >
                          {headerContent}
                          <SortIcon aria-hidden="true" className="h-3.5 w-3.5 text-ink-400 group-hover:text-ink-200" />
                        </button>
                      ) : (
                        <div className="inline-flex min-h-10 items-center gap-2 px-1">{headerContent}</div>
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {rows.length > 0 ? (
              <>
                {paddingTop > 0 ? (
                  <tr aria-label="Rows above viewport">
                    <td aria-label="Rows above viewport spacer" className="border-0 p-0" colSpan={columnCount} style={{ height: paddingTop }} />
                  </tr>
                ) : null}
                {visibleRowIndexes.map((rowIndex) => {
                  const row = rows[rowIndex];
                  return (
                    <tr
                      className="border-b border-white/5 bg-ink-900/70 transition-[background-color] duration-150 ease-out hover:bg-white/[0.035] data-[selected=true]:bg-signal-cyan/10"
                      data-index={rowIndex}
                      data-selected={row.getIsSelected()}
                      data-row-id={row.id}
                      key={row.id}
                      ref={shouldVirtualize ? rowVirtualizer.measureElement : undefined}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <td className="border-b border-white/5 px-3 py-2 align-middle text-ink-200" key={cell.id}>
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      ))}
                    </tr>
                  );
                })}
                {paddingBottom > 0 ? (
                  <tr aria-label="Rows below viewport">
                    <td aria-label="Rows below viewport spacer" className="border-0 p-0" colSpan={columnCount} style={{ height: paddingBottom }} />
                  </tr>
                ) : null}
              </>
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

function ColumnVisibilityMenu<TData extends object>({
  onOpenChange,
  open,
  table,
}: {
  onOpenChange: (open: boolean | ((open: boolean) => boolean)) => void;
  open: boolean;
  table: Table<TData>;
}) {
  const hideableColumns = table.getAllLeafColumns().reduce<Array<(typeof table)["getAllLeafColumns"] extends () => Array<infer TColumn> ? TColumn : never>>(
    (result, column) => {
      if (column.getCanHide()) {
        result.push(column);
      }
      return result;
    },
    [],
  );

  return (
    <div className="relative">
      <button
        aria-expanded={open}
        aria-label="Show or hide columns"
        className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-md border border-white/10 bg-ink-950 px-3 text-sm text-ink-200 shadow-surface outline-none transition-[background-color,border-color,box-shadow,scale] duration-150 ease-out hover:bg-white/[0.06] focus-visible:border-signal-cyan focus-visible:ring-2 focus-visible:ring-signal-cyan/30 active:scale-[0.96]"
        onClick={() => onOpenChange((current) => !current)}
        type="button"
      >
        <Columns3 aria-hidden="true" className="h-4 w-4" />
      </button>
      {open ? (
        <div className="absolute right-0 z-30 mt-2 max-h-80 w-56 overflow-auto rounded-lg bg-ink-900 p-2 shadow-[0_0_0_1px_rgba(255,255,255,0.10),0_18px_48px_rgba(0,0,0,0.42)]">
          {hideableColumns.map((column) => {
            const label = getColumnLabel(column.columnDef.header, column.id);
            return (
              <label
                className="flex min-h-10 items-center gap-2 rounded-md px-2 text-sm text-ink-200 transition-[background-color] duration-150 ease-out hover:bg-white/[0.05]"
                key={column.id}
              >
                <input
                  checked={column.getIsVisible()}
                  className="h-4 w-4 rounded border-white/20 bg-ink-950 accent-signal-cyan"
                  onChange={column.getToggleVisibilityHandler()}
                  type="checkbox"
                />
                <span className="truncate">{label}</span>
              </label>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function getColumnLabel<TData extends object>(header: ColumnDef<TData, unknown>["header"], fallback: string): string {
  return typeof header === "string" ? header : fallback;
}

function isCheckboxClick(target: EventTarget): target is HTMLInputElement {
  const element = target as Partial<HTMLInputElement> | null;
  return element?.type === "checkbox" && typeof element.checked === "boolean";
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
