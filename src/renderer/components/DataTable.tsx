import type { ReactNode } from "react";
import { useDeferredValue, useMemo, useRef, useState } from "react";
import type {
  Column,
  ColumnDef,
  ColumnFiltersState,
  OnChangeFn,
  Row,
  RowData,
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
import { ArrowDown, ArrowUp, ChevronsUpDown, Columns3, Search, X } from "lucide-react";
import { clsx } from "clsx";

// Per-column display hints. `sticky: "left"` pins the column while the table
// scrolls horizontally; `align` controls horizontal cell alignment.
declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    align?: "left" | "center" | "right";
    sticky?: "left";
  }
}

const EMPTY_COLUMN_FILTERS: ColumnFiltersState = [];
const EMPTY_SORTING: SortingState = [];
const VIRTUALIZATION_THRESHOLD = 100;
const VIRTUAL_ROW_HEIGHT = 46;

// Solid row backgrounds so pinned cells stay opaque while scrolling.
const ROW_BG = "bg-ink-925";
const ROW_HOVER_BG = "group-hover:bg-ink-850";
const ROW_SELECTED_BG = "group-data-[selected=true]:bg-[#13242b]";

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
  const deferredGlobalFilter = useDeferredValue(resolvedGlobalFilter);
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
      globalFilter: deferredGlobalFilter,
      rowSelection: resolvedRowSelection,
      sorting: resolvedSorting,
    },
  });

  const selectedRows = table.getSelectedRowModel().rows;
  const rows = table.getRowModel().rows;
  const columnCount = table.getAllLeafColumns().length;

  // Accumulate left offsets for pinned columns (assumed leftmost & contiguous).
  const stickyOffsets = useMemo(() => {
    const offsets = new Map<string, number>();
    let acc = 0;
    for (const column of table.getVisibleLeafColumns()) {
      if (column.columnDef.meta?.sticky === "left") {
        offsets.set(column.id, acc);
        acc += column.getSize();
      }
    }
    return offsets;
  }, [table, columnVisibility]);

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
  const hasSelection = selectedRows.length > 0;

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
    <section className="overflow-hidden rounded-xl bg-ink-925 shadow-card">
      {/* Card header: title + prominent search */}
      <div className="border-b border-white/[0.06] px-4 py-3">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0">
            <h2 className="truncate text-[15px] font-semibold text-white">{title}</h2>
            {description ? <p className="mt-0.5 text-[13px] text-ink-500">{description}</p> : null}
          </div>
          <label className="relative block w-full min-w-0 md:w-72">
            <span className="sr-only">{searchPlaceholder}</span>
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500" />
            <input
              className="h-9 w-full rounded-md border border-white/10 bg-ink-950 pl-9 pr-3 text-[13px] text-ink-200 outline-none transition-[border-color,box-shadow] duration-150 ease-out placeholder:text-ink-500 focus:border-signal-cyan/60 focus:ring-2 focus:ring-signal-cyan/25"
              onChange={(event) => handleGlobalFilterChange(event.target.value)}
              placeholder={searchPlaceholder}
              type="search"
              value={resolvedGlobalFilter}
            />
          </label>
        </div>

        {/* Filter row: chips/dropdowns (left) + column visibility (right) */}
        {filters || enableColumnVisibility ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-2">{filters}</div>
            {enableColumnVisibility ? <ColumnVisibilityMenu open={columnMenuOpen} onOpenChange={setColumnMenuOpen} table={table} /> : null}
          </div>
        ) : null}
      </div>

      {/* Selection action bar — only present when rows are selected */}
      {bulkActions && hasSelection ? (
        <div className="flex animate-fade-up flex-col gap-2 border-b border-white/[0.06] bg-signal-cyan/[0.04] px-4 py-2 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.06em] text-signal-cyan">
              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-signal-cyan" />
              {selectedLabel}
            </span>
            <button
              aria-label="Clear selection"
              className="inline-flex h-6 items-center gap-1 rounded-md border border-white/10 bg-white/[0.02] px-2 text-[11px] font-medium text-ink-300 outline-none transition-[background-color,border-color,box-shadow,scale] duration-150 ease-out hover:bg-white/[0.07] hover:text-white focus-visible:ring-2 focus-visible:ring-signal-cyan/40 active:scale-[0.96]"
              onClick={() => table.resetRowSelection()}
              type="button"
            >
              <X aria-hidden="true" className="h-3 w-3" />
              Deselect all
            </button>
          </div>
          <div className="flex flex-wrap gap-2">{bulkActions(selectedRows)}</div>
        </div>
      ) : null}

      <div className="max-h-[64vh] overflow-auto" ref={scrollContainerRef}>
        <table className="min-w-full border-separate border-spacing-0 text-left text-[13px]" onClickCapture={handleTableSelectionClick}>
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const sorted = header.column.getIsSorted();
                  const SortIcon = sorted === "asc" ? ArrowUp : sorted === "desc" ? ArrowDown : ChevronsUpDown;
                  const align = header.column.columnDef.meta?.align ?? "left";
                  const stickyLeft = stickyOffsets.get(header.column.id);
                  const isSticky = stickyLeft !== undefined;
                  const headerContent = flexRender(header.column.columnDef.header, header.getContext());

                  return (
                    <th
                      className={clsx(
                        "sticky top-0 whitespace-nowrap border-b border-white/[0.08] bg-ink-925 px-3 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-500",
                        align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left",
                        isSticky ? "z-30" : "z-20",
                      )}
                      key={header.id}
                      style={{ width: header.getSize(), left: isSticky ? stickyLeft : undefined }}
                    >
                      {header.isPlaceholder ? null : header.column.getCanSort() ? (
                        <button
                          className={clsx(
                            "group/sort inline-flex h-6 items-center gap-1.5 rounded text-left outline-none",
                            "transition-colors duration-150 ease-out hover:text-ink-200 focus-visible:text-ink-200",
                            align === "right" && "flex-row-reverse",
                          )}
                          onClick={header.column.getToggleSortingHandler()}
                          type="button"
                        >
                          <span>{headerContent}</span>
                          <SortIcon
                            aria-hidden="true"
                            className={clsx(
                              "h-3 w-3 shrink-0 transition-opacity duration-150",
                              sorted ? "text-signal-cyan opacity-100" : "text-ink-500 opacity-0 group-hover/sort:opacity-70",
                            )}
                          />
                        </button>
                      ) : (
                        <span className="inline-flex h-6 items-center">{headerContent}</span>
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
                      className={clsx(
                        "group transition-colors duration-150 ease-out",
                        ROW_BG,
                        "hover:bg-ink-850 data-[selected=true]:bg-[#13242b]",
                      )}
                      data-index={rowIndex}
                      data-selected={row.getIsSelected()}
                      data-row-id={row.id}
                      key={row.id}
                      ref={shouldVirtualize ? rowVirtualizer.measureElement : undefined}
                    >
                      {row.getVisibleCells().map((cell) => {
                        const align = cell.column.columnDef.meta?.align ?? "left";
                        const stickyLeft = stickyOffsets.get(cell.column.id);
                        const isSticky = stickyLeft !== undefined;
                        return (
                          <td
                            className={clsx(
                              "border-b border-white/[0.05] px-3 py-2.5 align-middle text-ink-200",
                              align === "right" ? "text-right tabular-nums" : align === "center" ? "text-center" : "text-left",
                              isSticky && ["sticky z-10", ROW_BG, ROW_HOVER_BG, ROW_SELECTED_BG],
                            )}
                            key={cell.id}
                            style={{ left: isSticky ? stickyLeft : undefined }}
                          >
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </td>
                        );
                      })}
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
                <td className="px-4 py-16 text-center text-[13px] text-ink-500" colSpan={columnCount}>
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
  const hideableColumns = table.getAllLeafColumns().reduce<Array<Column<TData, unknown>>>((result, column) => {
    if (column.getCanHide()) {
      result.push(column);
    }
    return result;
  }, []);

  return (
    <div className="relative">
      <button
        aria-expanded={open}
        aria-label="Show or hide columns"
        className="inline-flex h-9 items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.02] px-3 text-[13px] font-medium text-ink-300 shadow-surface outline-none transition-[background-color,border-color,box-shadow,scale] duration-150 ease-out hover:bg-white/[0.07] hover:text-white focus-visible:ring-2 focus-visible:ring-signal-cyan/40 active:scale-[0.96]"
        onClick={() => onOpenChange((current) => !current)}
        type="button"
      >
        <Columns3 aria-hidden="true" className="h-4 w-4" />
        <span className="hidden sm:inline">Columns</span>
      </button>
      {open ? (
        <div className="absolute right-0 z-50 mt-2 max-h-80 w-56 origin-top-right animate-fade-up overflow-auto rounded-lg bg-ink-900 p-1.5 shadow-popover">
          {hideableColumns.map((column) => {
            const label = getColumnLabel(column.columnDef.header, column.id);
            return (
              <label
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-ink-200 transition-[background-color] duration-150 ease-out hover:bg-white/[0.06]"
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
