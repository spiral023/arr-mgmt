import { useMemo, useState } from "react";
import type { ColumnDef, ColumnFiltersState } from "@tanstack/react-table";
import { ExternalLink, Eye, Radar, Search, Zap } from "lucide-react";
import { DataTable } from "../components/DataTable";
import { IconButton } from "../components/IconButton";
import { StatusPill, type StatusTone } from "../components/StatusPill";
import { updateColumnFilter, type TableFilterValue } from "../state/table-state";
import type { SonarrSeriesTableRow } from "../../shared/ipc-contracts";

type SeriesStatus = "ready" | "searchable" | "cooldown" | "failed";

type SonarrSeriesRow = SonarrSeriesTableRow;

const statusTone: Record<SeriesStatus, StatusTone> = {
  cooldown: "warning",
  failed: "danger",
  ready: "success",
  searchable: "running",
};

export function SonarrSeriesView({
  analyzing = false,
  onAnalyze,
  onGrab,
  onOpenInSonarr,
  onSearch,
  rows: liveRows,
  statusMessage = "Ready",
}: {
  analyzing?: boolean;
  onAnalyze?: (seriesIds?: number[]) => void;
  onGrab?: (seriesIds: number[]) => void;
  onOpenInSonarr?: (seriesId: number, titleSlug?: string) => void;
  onSearch?: (seriesIds: number[]) => void;
  rows?: SonarrSeriesTableRow[];
  statusMessage?: string;
}) {
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [detailsRow, setDetailsRow] = useState<SonarrSeriesRow | null>(null);
  const resolvedRows = liveRows ?? [];
  const filterControls = useMemo(
    () => <SonarrFilters columnFilters={columnFilters} onColumnFiltersChange={setColumnFilters} />,
    [columnFilters],
  );

  const columns = useMemo<Array<ColumnDef<SonarrSeriesRow, unknown>>>(
    () => [
      {
        cell: ({ row }) => (
          <input
            aria-label={`Select ${row.original.title}`}
            checked={row.getIsSelected()}
            className="h-4 w-4 rounded border-white/20 bg-ink-950 accent-signal-cyan"
            onChange={row.getToggleSelectedHandler()}
            type="checkbox"
          />
        ),
        enableSorting: false,
        header: ({ table }) => (
          <input
            aria-label="Select all series"
            checked={table.getIsAllRowsSelected()}
            className="h-4 w-4 rounded border-white/20 bg-ink-950 accent-signal-cyan"
            onChange={table.getToggleAllRowsSelectedHandler()}
            type="checkbox"
          />
        ),
        id: "select",
        size: 48,
      },
      {
        accessorKey: "title",
        cell: ({ getValue }) => <span className="font-semibold text-white">{getValue<string>()}</span>,
        header: "Title",
        size: 260,
      },
      {
        accessorKey: "monitored",
        cell: ({ getValue }) => <BooleanCell value={getValue<boolean>()} />,
        filterFn: booleanFilter,
        header: "Monitored",
        size: 112,
      },
      {
        accessorKey: "episodes",
        cell: ({ getValue }) => <NumberCell value={getValue<number>()} />,
        header: "Episodes",
        size: 104,
      },
      {
        accessorKey: "files",
        cell: ({ getValue }) => <NumberCell value={getValue<number>()} />,
        filterFn: positiveNumberFilter,
        header: "Files",
        size: 88,
      },
      {
        accessorKey: "totalSizeBytes",
        cell: ({ getValue }) => <NumberCell value={formatBytes(getValue<number>())} />,
        header: "Total size",
        size: 128,
      },
      {
        accessorKey: "funFiles",
        cell: ({ getValue }) => <NumberCell tone="good" value={getValue<number>()} />,
        filterFn: positiveNumberFilter,
        header: "FuN* files",
        size: 112,
      },
      {
        accessorKey: "funShare",
        cell: ({ getValue }) => {
          const value = getValue<number>();
          return <NumberCell tone={value < 0.7 ? "danger" : value < 1 ? "warning" : "good"} value={formatPercent(value)} />;
        },
        filterFn: funShareFilter,
        header: "FuN* share",
        size: 120,
      },
      {
        accessorKey: "nonFunFiles",
        cell: ({ getValue }) => <NumberCell tone={getValue<number>() > 0 ? "warning" : "default"} value={getValue<number>()} />,
        filterFn: positiveNumberFilter,
        header: "Non-FuN",
        size: 104,
      },
      {
        accessorKey: "pendingFunCandidates",
        cell: ({ getValue }) => <NumberCell tone={getValue<number>() > 0 ? "good" : "default"} value={getValue<number>()} />,
        filterFn: positiveNumberFilter,
        header: "Pending FuN*",
        size: 128,
      },
      { accessorKey: "lastAnalyzed", header: "Last analyzed", size: 150 },
      { accessorKey: "lastSearched", header: "Last searched", size: 150 },
      { accessorKey: "lastGrabbed", header: "Last grabbed", size: 150 },
      {
        accessorKey: "status",
        cell: ({ getValue }) => {
          const status = getValue<SeriesStatus>();
          return <StatusPill tone={statusTone[status]}>{status}</StatusPill>;
        },
        header: "Status",
        size: 128,
      },
      {
        cell: ({ row }) => (
          <div className="flex gap-2">
            <IconButton className="px-0" icon={Eye} label={`Open details for ${row.original.title}`} onClick={() => setDetailsRow(row.original)} />
            <IconButton
              className="px-0"
              icon={ExternalLink}
              label={`Open ${row.original.title} in Sonarr`}
              onClick={() => onOpenInSonarr?.(row.original.arrId, row.original.titleSlug)}
            />
          </div>
        ),
        enableSorting: false,
        header: "Actions",
        id: "actions",
        size: 112,
      },
    ],
    [onOpenInSonarr],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 rounded-lg border border-white/10 bg-ink-900/80 p-4 shadow-surface md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-base font-semibold text-white">Sonarr Analysis</h2>
          <p className="mt-1 text-sm text-ink-400">{statusMessage}</p>
        </div>
        <IconButton disabled={analyzing} icon={Radar} label="Analyze all Sonarr series" onClick={() => onAnalyze?.()} tone="success">
          {analyzing ? "Analyzing..." : "Analyze all"}
        </IconButton>
      </div>
      <DataTable
        bulkActions={(selectedRows) => (
          <>
            <IconButton
              disabled={selectedRows.length === 0 || analyzing}
              icon={Radar}
              label="Analyze selected series"
              onClick={() => onAnalyze?.(selectedRows.map((row) => row.original.arrId))}
              tone="success"
            >
              Analyze selected
            </IconButton>
            <IconButton
              disabled={selectedRows.length === 0}
              icon={Search}
              label="Search selected non-FuN series"
              onClick={() => onSearch?.(selectedRows.map((row) => row.original.arrId))}
            >
              Search selected
            </IconButton>
            <IconButton
              disabled={selectedRows.length === 0}
              icon={Zap}
              label="Grab selected pending FuN releases"
              onClick={() => onGrab?.(selectedRows.map((row) => row.original.arrId))}
              tone="warning"
            >
              Grab selected
            </IconButton>
          </>
        )}
        columnFilters={columnFilters}
        columns={columns}
        data={resolvedRows}
        description="Series-level coverage with selected-only search/grab controls, pending FuN* candidates, and FuN* share filters."
        filters={filterControls}
        getRowId={(row) => row.id}
        initialSorting={[{ id: "nonFunFiles", desc: true }]}
        searchPlaceholder="Search series"
        title="Sonarr Series"
      />
      {detailsRow ? (
        <section className="rounded-lg border border-white/10 bg-ink-900/80 p-4 shadow-surface">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <h2 className="text-base font-semibold text-white">{detailsRow.title}</h2>
              <p className="mt-1 text-sm text-ink-400">
                {detailsRow.files} files across {detailsRow.episodes} episodes, {detailsRow.nonFunFiles} non-FuN files, last analyzed {detailsRow.lastAnalyzed}.
              </p>
            </div>
            <StatusPill tone={statusTone[detailsRow.status]}>{detailsRow.status}</StatusPill>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Detail label="FuN* share" value={formatPercent(detailsRow.funShare)} />
            <Detail label="Pending FuN*" value={String(detailsRow.pendingFunCandidates)} />
            <Detail label="Total size" value={formatBytes(detailsRow.totalSizeBytes)} />
            <Detail label="Last searched" value={detailsRow.lastSearched} />
            <Detail label="Last grabbed" value={detailsRow.lastGrabbed} />
          </div>
        </section>
      ) : null}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-white/10 bg-ink-950/60 px-3 py-2">
      <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-400">{label}</div>
      <div className="mt-1 font-mono text-sm text-ink-200">{value}</div>
    </div>
  );
}

function SonarrFilters({
  columnFilters,
  onColumnFiltersChange,
}: {
  columnFilters: ColumnFiltersState;
  onColumnFiltersChange: (filters: ColumnFiltersState) => void;
}) {
  const activeFunShare = columnFilters.find((filter) => filter.id === "funShare")?.value;
  const activePending = columnFilters.find((filter) => filter.id === "pendingFunCandidates")?.value;
  const activeStatus = columnFilters.find((filter) => filter.id === "status")?.value;
  const activeMonitored = columnFilters.find((filter) => filter.id === "monitored")?.value;

  function toggleFilter(columnId: string, value: TableFilterValue, exclusiveColumns: string[] = [columnId]) {
    let next = columnFilters;
    for (const column of exclusiveColumns) {
      next = updateColumnFilter(next, column, "");
    }
    const isActive = columnFilters.some((filter) => filter.id === columnId && filter.value === value);
    if (!isActive) {
      next = updateColumnFilter(next, columnId, value);
    }
    onColumnFiltersChange(next);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <QuickFilterButton active={activeFunShare === "lt1"} label="Hide 100% FuN*" onClick={() => toggleFilter("funShare", "lt1")} />
      <QuickFilterButton active={activeFunShare === "lt70"} label="FuN* <70%" onClick={() => toggleFilter("funShare", "lt70")} />
      <QuickFilterButton active={activePending === "positive"} label="Pending FuN*" onClick={() => toggleFilter("pendingFunCandidates", "positive")} />
      <QuickFilterButton active={activeStatus === "searchable"} label="Searchable" onClick={() => toggleFilter("status", "searchable")} />
      <QuickFilterButton active={activeMonitored === true} label="Monitored" onClick={() => toggleFilter("monitored", true)} />
      <FilterSelect
        label="FuN state"
        onChange={(value) => {
          let next = updateColumnFilter(columnFilters, "funFiles", "");
          next = updateColumnFilter(next, "nonFunFiles", "");
          if (value === "hasFun") next = updateColumnFilter(next, "funFiles", "positive");
          if (value === "missingFun") next = updateColumnFilter(next, "nonFunFiles", "positive");
          onColumnFiltersChange(next);
        }}
        options={[
          ["", "All FuN states"],
          ["hasFun", "Has FuN*"],
          ["missingFun", "Missing FuN*"],
        ]}
      />
      <FilterSelect
        label="Flags"
        onChange={(value) => {
          let next = updateColumnFilter(columnFilters, "monitored", "");
          next = updateColumnFilter(next, "files", "");
          next = updateColumnFilter(next, "status", "");
          if (value === "monitored") next = updateColumnFilter(next, "monitored", true);
          if (value === "hasFiles") next = updateColumnFilter(next, "files", "positive");
          if (value === "searchableNow") next = updateColumnFilter(next, "status", "searchable");
          if (value === "blockedByCooldown") next = updateColumnFilter(next, "status", "cooldown");
          if (value === "failedLastSearch") next = updateColumnFilter(next, "status", "failed");
          onColumnFiltersChange(next);
        }}
        options={[
          ["", "All flags"],
          ["monitored", "Monitored only"],
          ["hasFiles", "Has files"],
          ["searchableNow", "Searchable now"],
          ["blockedByCooldown", "Blocked by cooldown"],
          ["failedLastSearch", "Failed last search"],
        ]}
      />
    </div>
  );
}

function QuickFilterButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-pressed={active}
      className={`h-10 rounded-md border px-3 text-sm font-medium outline-none shadow-surface transition-[background-color,border-color,color,box-shadow] duration-150 ease-out focus:border-signal-cyan focus:ring-2 focus:ring-signal-cyan/30 ${
        active
          ? "border-signal-cyan/40 bg-signal-cyan/10 text-signal-cyan"
          : "border-white/10 bg-ink-950 text-ink-200 hover:bg-white/[0.06] hover:text-white"
      }`}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}

function FilterSelect({
  label,
  onChange,
  options,
}: {
  label: string;
  onChange: (value: string) => void;
  options: Array<[string, string]>;
}) {
  return (
    <label className="block">
      <span className="sr-only">{label}</span>
      <select
        className="h-10 rounded-md border border-white/10 bg-ink-950 px-3 text-sm text-ink-200 outline-none shadow-surface transition-[background-color,border-color,box-shadow] duration-150 ease-out focus:border-signal-cyan focus:ring-2 focus:ring-signal-cyan/30"
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map(([value, text]) => (
          <option key={value || text} value={value}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}

function BooleanCell({ value }: { value: boolean }) {
  return <StatusPill tone={value ? "success" : "muted"}>{value ? "yes" : "no"}</StatusPill>;
}

function NumberCell({ tone = "default", value }: { tone?: "default" | "good" | "warning" | "danger"; value: number | string }) {
  const toneClass =
    tone === "good"
      ? "text-signal-green"
      : tone === "warning"
        ? "text-signal-amber"
        : tone === "danger"
          ? "text-red-400"
          : "text-ink-200";
  return <span className={`font-mono text-sm tabular-nums ${toneClass}`}>{value}</span>;
}

function booleanFilter(row: { getValue: (id: string) => unknown }, columnId: string, value: unknown) {
  return value === "" || row.getValue(columnId) === value;
}

function positiveNumberFilter(row: { getValue: (id: string) => unknown }, columnId: string, value: unknown) {
  return value !== "positive" || Number(row.getValue(columnId)) > 0;
}

function funShareFilter(row: { getValue: (id: string) => unknown }, columnId: string, value: unknown) {
  const share = Number(row.getValue(columnId));
  if (value === "lt1") return share < 1;
  if (value === "lt70") return share < 0.7;
  return true;
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function formatBytes(value: number) {
  if (value === 0) return "0 GB";
  return `${(value / 1_000_000_000).toFixed(1)} GB`;
}
