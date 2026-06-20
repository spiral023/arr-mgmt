import { useMemo, useState } from "react";
import type { ColumnDef, ColumnFiltersState, Row } from "@tanstack/react-table";
import { Ban, ExternalLink, Eye, Play, Radar, Search, ShieldOff, Zap } from "lucide-react";
import { DataTable } from "../components/DataTable";
import { IconButton } from "../components/IconButton";
import { MediaDetailLists } from "../components/MediaDetailLists";
import { ReleaseGroupBadge } from "../components/ReleaseGroupBadge";
import { StatusPill, type StatusTone } from "../components/StatusPill";
import { useItemDetails } from "../state/use-item-details";
import { updateColumnFilter, type TableFilterValue } from "../state/table-state";
import { usePersistedTableState } from "../state/use-persisted-table-state";
import {
  BooleanCell,
  CountChip,
  DateCell,
  FilterChip,
  FilterSelect,
  NumberCell,
  PipelineSection,
  ShareCell,
  TitleCell,
} from "./SonarrSeriesView";
import type { MediaItemDetails, QuotaSummary, RadarrMovieTableRow } from "../../shared/ipc-contracts";

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
  onLoadDetails,
  onOpenInRadarr,
  onRunPipeline,
  onSearch,
  onSetOverride,
  quota,
  rows: liveRows,
  statusMessage = "Ready",
}: {
  analyzing?: boolean;
  onAnalyze?: (movieIds?: number[]) => void;
  onGrab?: (movieIds: number[]) => void;
  onLoadDetails?: (kind: "series" | "movie", arrId: number) => Promise<MediaItemDetails>;
  onOpenInRadarr?: (movieId: number) => void;
  onRunPipeline?: (movieIds?: number[]) => void;
  onSearch?: (movieIds: number[]) => void;
  onSetOverride?: (arrId: number, excluded: boolean) => void;
  quota?: QuotaSummary;
  rows?: RadarrMovieTableRow[];
  statusMessage?: string;
}) {
  const [detailsRow, setDetailsRow] = useState<RadarrMovieTableRow | null>(null);
  const [hideOverrides, setHideOverrides] = useState(false);
  const { details, loading: detailsLoading } = useItemDetails("movie", detailsRow?.arrId ?? null, onLoadDetails);
  const tableState = usePersistedTableState("arr-ops.table.radarr", {
    sorting: [{ id: "nonFunFiles", desc: true }],
  });
  const rows = liveRows ?? [];
  const qualityProfileNames = useMemo(
    () => [...new Set(rows.map((r) => r.qualityProfileName).filter((n): n is string => Boolean(n)))].sort(),
    [rows],
  );
  const filterControls = useMemo(
    () => (
      <>
        <RadarrFilters
          columnFilters={tableState.state.columnFilters}
          onColumnFiltersChange={tableState.setColumnFilters}
          qualityProfileNames={qualityProfileNames}
        />
        <FilterChip active={hideOverrides} label={hideOverrides ? "Overrides hidden" : "Hide overrides"} onClick={() => setHideOverrides((value) => !value)} />
      </>
    ),
    [tableState, qualityProfileNames, hideOverrides],
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
      {
        accessorKey: "qualityProfileName",
        cell: ({ getValue }) => <NumberCell muted value={getValue<string | undefined>() ?? "-"} />,
        filterFn: stringEqualityFilter,
        header: "Quality profile",
        size: 152,
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
        accessorKey: "isExcluded",
        cell: ({ getValue }) =>
          getValue<boolean>() ? (
            <span className="inline-flex h-[22px] items-center justify-center rounded-md border border-signal-amber/25 bg-signal-amber/[0.10] px-1.5 text-[12px] font-semibold text-signal-amber">
              Override
            </span>
          ) : (
            <span className="font-mono text-[13px] tabular-nums text-ink-600">—</span>
          ),
        filterFn: booleanFilter,
        header: "Override",
        size: 104,
      },
      {
        cell: ({ row }) => (
          <div className="flex justify-end gap-1">
            <IconButton className="px-2" icon={Eye} label={`Open details for ${row.original.title}`} onClick={() => setDetailsRow(row.original)} />
            <IconButton className="px-2" icon={ExternalLink} label={`Open ${row.original.title} in Radarr`} onClick={() => onOpenInRadarr?.(row.original.arrId)} />
            <IconButton
              className="px-2"
              icon={row.original.isExcluded ? ShieldOff : Ban}
              label={row.original.isExcluded ? `Re-include ${row.original.title}` : `Exclude ${row.original.title} from grabbing`}
              onClick={() => onSetOverride?.(row.original.arrId, !row.original.isExcluded)}
              tone={row.original.isExcluded ? "warning" : "default"}
            />
          </div>
        ),
        enableHiding: false,
        enableSorting: false,
        header: "Actions",
        id: "actions",
        meta: { align: "right" },
        size: 136,
      },
    ],
    [onOpenInRadarr, onSetOverride],
  );

  const visibleRows = hideOverrides ? rows.filter((row) => !row.isExcluded) : rows;

  return (
    <div className="flex flex-col gap-4">
      <PipelineSection
        analyzing={analyzing}
        onAnalyze={() => onAnalyze?.()}
        onRunPipeline={() => onRunPipeline?.()}
        quota={quota}
        statusMessage={statusMessage}
        title="Radarr Pipeline"
      />

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
            <IconButton
              icon={Ban}
              label="Exclude selected Radarr movies from grabbing"
              onClick={() => selectedRows.forEach((row) => onSetOverride?.(row.original.arrId, true))}
            >
              Exclude selected
            </IconButton>
            <span aria-hidden="true" className="mx-0.5 h-5 w-px bg-white/[0.08]" />
            <IconButton
              icon={Play}
              label="Run full pipeline for selected Radarr movies"
              onClick={() => onRunPipeline?.(selectedRows.map((row) => row.original.arrId))}
              tone="primary"
            >
              Run pipeline
            </IconButton>
          </>
        )}
        columnFilters={tableState.state.columnFilters}
        columns={columns}
        data={visibleRows}
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
          <MediaDetailLists details={details} kind="movie" loading={detailsLoading} />
        </section>
      ) : null}
    </div>
  );
}

function RadarrFilters({
  columnFilters,
  onColumnFiltersChange,
  qualityProfileNames,
}: {
  columnFilters: ColumnFiltersState;
  onColumnFiltersChange: (filters: ColumnFiltersState) => void;
  qualityProfileNames: string[];
}) {
  const activeFunShare = columnFilters.find((f) => f.id === "funShare")?.value;
  const activePending = columnFilters.find((f) => f.id === "pendingFunCandidates")?.value;
  const activeStatus = columnFilters.find((f) => f.id === "status")?.value;
  const activeMonitored = columnFilters.find((f) => f.id === "monitored")?.value;

  function toggleFilter(columnId: string, value: TableFilterValue, exclusiveColumns: string[] = [columnId]) {
    let next = columnFilters;
    for (const col of exclusiveColumns) next = updateColumnFilter(next, col, "");
    const isActive = columnFilters.some((f) => f.id === columnId && f.value === value);
    if (!isActive) next = updateColumnFilter(next, columnId, value);
    onColumnFiltersChange(next);
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <FilterChip active={activeFunShare === "lt1"} label="Hide 100% FuN*" onClick={() => toggleFilter("funShare", "lt1")} />
      <FilterChip active={activeFunShare === "lt70"} label="FuN* <70%" onClick={() => toggleFilter("funShare", "lt70")} />
      <FilterChip active={activePending === "positive"} label="Pending FuN*" onClick={() => toggleFilter("pendingFunCandidates", "positive")} />
      <FilterChip active={activeStatus === "searchable"} label="Searchable" onClick={() => toggleFilter("status", "searchable")} />
      <FilterChip active={activeMonitored === true} label="Monitored" onClick={() => toggleFilter("monitored", true)} />
      <span aria-hidden="true" className="mx-0.5 h-5 w-px bg-white/[0.08]" />
      <FilterSelect
        label="FuN state"
        onChange={(value) => {
          let next = updateColumnFilter(columnFilters, "funShare", "");
          next = updateColumnFilter(next, "nonFunFiles", "");
          if (value === "fun") next = updateColumnFilter(next, "funShare", "eq1");
          if (value === "notFun") next = updateColumnFilter(next, "nonFunFiles", "positive");
          onColumnFiltersChange(next);
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
      {qualityProfileNames.length > 0 && (
        <FilterSelect
          label="Quality profile"
          onChange={(value) => onColumnFiltersChange(updateColumnFilter(columnFilters, "qualityProfileName", value))}
          options={[["", "All profiles"], ...qualityProfileNames.map((n): [string, string] => [n, n])]}
        />
      )}
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
  if (value === "lt1") return share < 1;
  if (value === "lt70") return share < 0.7;
  return true;
}

function stringEqualityFilter(row: { getValue: (id: string) => unknown }, columnId: string, value: unknown) {
  return value === "" || row.getValue(columnId) === value;
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function formatBytes(value: number) {
  if (value === 0) return "0 GB";
  if (value >= 1_000_000_000_000) return `${(value / 1_000_000_000_000).toFixed(1)} TB`;
  return `${(value / 1_000_000_000).toFixed(1)} GB`;
}
