import { useMemo, useState } from "react";
import type { ColumnDef, ColumnFiltersState, Row } from "@tanstack/react-table";
import { ExternalLink, Eye, Radar, Search, Zap } from "lucide-react";
import { DataTable } from "../components/DataTable";
import { IconButton } from "../components/IconButton";
import { ReleaseGroupBadge } from "../components/ReleaseGroupBadge";
import { StatusPill, type StatusTone } from "../components/StatusPill";
import { updateColumnFilter } from "../state/table-state";
import { usePersistedTableState } from "../state/use-persisted-table-state";
import {
  AnalysisSection,
  BooleanCell,
  CountChip,
  DateCell,
  FilterSelect,
  NumberCell,
  ShareCell,
  TitleCell,
} from "./SonarrSeriesView";
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
        meta: { sticky: "left" },
        size: 44,
      },
      {
        accessorKey: "title",
        cell: ({ getValue }) => <TitleCell value={getValue<string>()} />,
        enableHiding: false,
        header: "Title",
        meta: { sticky: "left" },
        size: 252,
      },
      {
        accessorKey: "year",
        cell: ({ getValue }) => <NumberCell muted value={getValue<number | undefined>() ?? "-"} />,
        header: "Year",
        meta: { align: "right" },
        size: 84,
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
        cell: ({ getValue }) => <NumberCell muted value={formatBytes(getValue<number>())} />,
        header: "Size",
        meta: { align: "right" },
        size: 112,
      },
      {
        accessorKey: "releaseGroup",
        cell: ({ row }) => <ReleaseGroupBadge group={row.original.releaseGroup} isFun={row.original.isFun} />,
        header: "Release group",
        size: 152,
      },
      {
        accessorKey: "funShare",
        cell: ({ getValue }) => <ShareCell value={getValue<number>()} />,
        filterFn: funShareFilter,
        header: "FuN* share",
        meta: { align: "right" },
        size: 132,
      },
      {
        accessorKey: "nonFunFiles",
        cell: ({ getValue }) => <CountChip tone="warning" value={getValue<number>()} />,
        filterFn: positiveNumberFilter,
        header: "Non-FuN",
        meta: { align: "right" },
        size: 104,
      },
      {
        accessorKey: "pendingFunCandidates",
        cell: ({ getValue }) => <CountChip tone="info" value={getValue<number>()} />,
        filterFn: positiveNumberFilter,
        header: "Pending FuN*",
        meta: { align: "right" },
        size: 124,
      },
      { accessorKey: "lastAnalyzed", cell: ({ getValue }) => <DateCell value={getValue<string>()} />, header: "Last analyzed", size: 144 },
      { accessorKey: "lastSearched", cell: ({ getValue }) => <DateCell value={getValue<string>()} />, header: "Last searched", size: 144 },
      { accessorKey: "lastGrabbed", cell: ({ getValue }) => <DateCell value={getValue<string>()} />, header: "Last grabbed", size: 144 },
      {
        accessorKey: "status",
        cell: ({ getValue }) => {
          const status = getValue<MovieStatus>();
          return <StatusPill tone={statusTone[status]}>{status}</StatusPill>;
        },
        header: "Status",
        size: 128,
      },
      {
        cell: ({ row }) => (
          <div className="flex justify-end gap-1">
            <IconButton className="px-2" icon={Eye} label={`Open details for ${row.original.title}`} onClick={() => setDetailsRow(row.original)} />
            <IconButton className="px-2" icon={ExternalLink} label={`Open ${row.original.title} in Radarr`} onClick={() => onOpenInRadarr?.(row.original.arrId)} />
          </div>
        ),
        enableHiding: false,
        enableSorting: false,
        header: "Actions",
        id: "actions",
        meta: { align: "right" },
        size: 104,
      },
    ],
    [onOpenInRadarr],
  );

  return (
    <div className="flex flex-col gap-4">
      <AnalysisSection analyzing={analyzing} onAnalyze={() => onAnalyze?.()} statusMessage={statusMessage} title="Radarr Analysis" />

      <DataTable
        bulkActions={(selectedRows) => (
          <>
            <IconButton
              disabled={analyzing}
              icon={Radar}
              label="Analyze selected Radarr movies"
              onClick={() => onAnalyze?.(selectedRows.map((row) => row.original.arrId))}
              tone="primary"
            >
              Analyze selected
            </IconButton>
            <IconButton icon={Search} label="Search selected Radarr movies" onClick={() => onSearch?.(selectedRows.map((row) => row.original.arrId))}>
              Search selected
            </IconButton>
            <IconButton icon={Zap} label="Grab selected pending Radarr FuN releases" onClick={() => onGrab?.(selectedRows.map((row) => row.original.arrId))} tone="warning">
              Grab selected
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
        <section className="animate-fade-up rounded-xl bg-ink-925 p-4 shadow-card">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <h2 className="text-[15px] font-semibold text-white">{detailsRow.title}</h2>
              <p className="mt-1 text-[13px] text-ink-500">
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
    <div className="flex flex-wrap items-center gap-1.5">
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
  return `${selectedRows.length} selected · ${pending} pending FuN* files`;
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/[0.07] bg-ink-950/50 px-3 py-2.5">
      <div className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-ink-500">{label}</div>
      <div className="mt-1 font-mono text-[13px] text-ink-200">{value}</div>
    </div>
  );
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
