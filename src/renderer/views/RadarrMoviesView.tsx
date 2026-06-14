import { useMemo, useState } from "react";
import type { ColumnDef, ColumnFiltersState, Row } from "@tanstack/react-table";
import { ExternalLink, Eye, Radar, Search, Zap } from "lucide-react";
import { DataTable } from "../components/DataTable";
import { IconButton } from "../components/IconButton";
import { ReleaseGroupBadge } from "../components/ReleaseGroupBadge";
import { StatusPill, type StatusTone } from "../components/StatusPill";
import { updateColumnFilter } from "../state/table-state";
import { usePersistedTableState } from "../state/use-persisted-table-state";
import type { RadarrMovieTableRow } from "../../shared/ipc-contracts";

type MovieStatus = RadarrMovieTableRow["status"];

const statusTone: Record<MovieStatus, StatusTone> = {
  cooldown: "warning",
  failed: "danger",
  ready: "success",
  searchable: "running",
};

export function RadarrMoviesView({
  analyzing = false,
  onAnalyze,
  onGrab,
  onOpenInRadarr,
  onSearch,
  rows: liveRows,
  statusMessage = "Ready",
}: {
  analyzing?: boolean;
  onAnalyze?: (movieIds?: number[]) => void;
  onGrab?: (movieIds: number[]) => void;
  onOpenInRadarr?: (movieId: number) => void;
  onSearch?: (movieIds: number[]) => void;
  rows?: RadarrMovieTableRow[];
  statusMessage?: string;
}) {
  const [detailsRow, setDetailsRow] = useState<RadarrMovieTableRow | null>(null);
  const tableState = usePersistedTableState("arr-ops.table.radarr", {
    sorting: [{ id: "nonFunFiles", desc: true }],
  });
  const rows = liveRows ?? [];
  const filterControls = useMemo(
    () => <RadarrFilters columnFilters={tableState.state.columnFilters} onColumnFiltersChange={tableState.setColumnFilters} />,
    [tableState],
  );

  const columns = useMemo<Array<ColumnDef<RadarrMovieTableRow, unknown>>>(
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
        enableHiding: false,
        enableSorting: false,
        header: ({ table }) => (
          <input
            aria-label="Select all movies"
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
        size: 280,
      },
      {
        accessorKey: "year",
        cell: ({ getValue }) => <NumberCell value={getValue<number | undefined>() ?? "-"} />,
        header: "Year",
        size: 88,
      },
      {
        accessorKey: "monitored",
        cell: ({ getValue }) => <BooleanCell value={getValue<boolean>()} />,
        filterFn: booleanFilter,
        header: "Monitored",
        size: 112,
      },
      {
        accessorKey: "hasFiles",
        cell: ({ getValue }) => <BooleanCell value={getValue<boolean>()} />,
        filterFn: booleanFilter,
        header: "Has file",
        size: 104,
      },
      {
        accessorKey: "sizeBytes",
        cell: ({ getValue }) => <NumberCell value={formatBytes(getValue<number>())} />,
        header: "Size",
        size: 112,
      },
      {
        accessorKey: "releaseGroup",
        cell: ({ row }) => <ReleaseGroupBadge group={row.original.releaseGroup} isFun={row.original.isFun} />,
        header: "Release group",
        size: 148,
      },
      {
        accessorKey: "funShare",
        cell: ({ getValue }) => {
          const value = getValue<number>();
          return <NumberCell tone={value < 1 ? "warning" : "good"} value={formatPercent(value)} />;
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
          const status = getValue<MovieStatus>();
          return <StatusPill tone={statusTone[status]}>{status}</StatusPill>;
        },
        header: "Status",
        size: 124,
      },
      {
        cell: ({ row }) => (
          <div className="flex gap-2">
            <IconButton className="px-0" icon={Eye} label={`Open details for ${row.original.title}`} onClick={() => setDetailsRow(row.original)} />
            <IconButton className="px-0" icon={ExternalLink} label={`Open ${row.original.title} in Radarr`} onClick={() => onOpenInRadarr?.(row.original.arrId)} />
          </div>
        ),
        enableHiding: false,
        enableSorting: false,
        header: "Actions",
        id: "actions",
        size: 112,
      },
    ],
    [onOpenInRadarr],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 rounded-lg border border-white/10 bg-ink-900/80 p-4 shadow-surface md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-base font-semibold text-white">Radarr Analysis</h2>
          <p className="mt-1 text-sm text-ink-400">{statusMessage}</p>
        </div>
        <IconButton disabled={analyzing} icon={Radar} label="Analyze all Radarr movies" onClick={() => onAnalyze?.()} tone="success">
          {analyzing ? "Analyzing..." : "Analyze all"}
        </IconButton>
      </div>

      <DataTable
        bulkActions={(selectedRows) => (
          <>
            <IconButton
              disabled={selectedRows.length === 0 || analyzing}
              icon={Radar}
              label="Analyze selected Radarr movies"
              onClick={() => onAnalyze?.(selectedRows.map((row) => row.original.arrId))}
              tone="success"
            >
              Analyze
            </IconButton>
            <IconButton
              disabled={selectedRows.length === 0}
              icon={Search}
              label="Search selected Radarr movies"
              onClick={() => onSearch?.(selectedRows.map((row) => row.original.arrId))}
            >
              Search
            </IconButton>
            <IconButton
              disabled={selectedRows.length === 0}
              icon={Zap}
              label="Grab selected pending Radarr FuN releases"
              onClick={() => onGrab?.(selectedRows.map((row) => row.original.arrId))}
              tone="warning"
            >
              Grab
            </IconButton>
          </>
        )}
        columnFilters={tableState.state.columnFilters}
        columns={columns}
        data={rows}
        description="Movie-level FuN* coverage, candidate discovery, and selected-only operations."
        enableColumnVisibility
        filters={filterControls}
        getRowId={(row) => row.id}
        globalFilter={tableState.state.globalFilter}
        onColumnFiltersChange={tableState.setColumnFilters}
        onGlobalFilterChange={tableState.setGlobalFilter}
        onRowSelectionChange={tableState.setRowSelection}
        onSortingChange={tableState.setSorting}
        rowSelection={tableState.state.rowSelection}
        searchPlaceholder="Search movies"
        selectedSummary={formatSelectedSummary}
        sorting={tableState.state.sorting}
        title="Radarr Movies"
      />

      {detailsRow ? (
        <section className="rounded-lg border border-white/10 bg-ink-900/80 p-4 shadow-surface">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <h2 className="text-base font-semibold text-white">{detailsRow.title}</h2>
              <p className="mt-1 text-sm text-ink-400">
                {detailsRow.files} movie file, {detailsRow.nonFunFiles} non-FuN file, last analyzed {detailsRow.lastAnalyzed}.
              </p>
            </div>
            <StatusPill tone={statusTone[detailsRow.status]}>{detailsRow.status}</StatusPill>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Detail label="FuN* share" value={formatPercent(detailsRow.funShare)} />
            <Detail label="Pending FuN*" value={String(detailsRow.pendingFunCandidates)} />
            <Detail label="Size" value={formatBytes(detailsRow.sizeBytes)} />
            <Detail label="Last searched" value={detailsRow.lastSearched} />
            <Detail label="Last grabbed" value={detailsRow.lastGrabbed} />
          </div>
        </section>
      ) : null}
    </div>
  );
}

function RadarrFilters({
  columnFilters,
  onColumnFiltersChange,
}: {
  columnFilters: ColumnFiltersState;
  onColumnFiltersChange: (filters: ColumnFiltersState) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <FilterSelect
        label="FuN state"
        onChange={(value) => {
          let next = updateColumnFilter(columnFilters, "funShare", "");
          let next2 = updateColumnFilter(next, "nonFunFiles", "");
          if (value === "fun") next2 = updateColumnFilter(next2, "funShare", "eq1");
          if (value === "notFun") next2 = updateColumnFilter(next2, "nonFunFiles", "positive");
          onColumnFiltersChange(next2);
        }}
        options={[
          ["", "All FuN states"],
          ["fun", "Is FuN*"],
          ["notFun", "Not FuN*"],
        ]}
      />
      <FilterSelect
        label="Flags"
        onChange={(value) => {
          let next = updateColumnFilter(columnFilters, "monitored", "");
          next = updateColumnFilter(next, "hasFiles", "");
          next = updateColumnFilter(next, "pendingFunCandidates", "");
          next = updateColumnFilter(next, "status", "");
          if (value === "monitored") next = updateColumnFilter(next, "monitored", true);
          if (value === "hasFile") next = updateColumnFilter(next, "hasFiles", true);
          if (value === "searchableNow") next = updateColumnFilter(next, "status", "searchable");
          if (value === "candidateFound") next = updateColumnFilter(next, "pendingFunCandidates", "positive");
          onColumnFiltersChange(next);
        }}
        options={[
          ["", "All flags"],
          ["monitored", "Monitored only"],
          ["hasFile", "Has file"],
          ["searchableNow", "Searchable now"],
          ["candidateFound", "Candidate found"],
        ]}
      />
    </div>
  );
}

function formatSelectedSummary(selectedRows: Array<Row<RadarrMovieTableRow>>): string {
  const pending = selectedRows.reduce((total, row) => total + row.original.pendingFunCandidates, 0);
  return `${selectedRows.length} selected - ${pending} pending FuN* files`;
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-white/10 bg-ink-950/60 px-3 py-2">
      <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-400">{label}</div>
      <div className="mt-1 font-mono text-sm text-ink-200">{value}</div>
    </div>
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

function NumberCell({ tone = "default", value }: { tone?: "default" | "good" | "warning"; value: number | string }) {
  const toneClass = tone === "good" ? "text-signal-green" : tone === "warning" ? "text-signal-amber" : "text-ink-200";
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
  if (value === "eq1") return share === 1;
  return true;
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function formatBytes(value: number) {
  if (value === 0) return "0 GB";
  if (value >= 1_000_000_000_000) return `${(value / 1_000_000_000_000).toFixed(1)} TB`;
  return `${(value / 1_000_000_000).toFixed(1)} GB`;
}
