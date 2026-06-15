import { useMemo, useState } from "react";
import type { ColumnDef, ColumnFiltersState, Row } from "@tanstack/react-table";
import { ExternalLink, Eye, Radar, Search, Zap } from "lucide-react";
import { clsx } from "clsx";
import { DataTable } from "../components/DataTable";
import { IconButton } from "../components/IconButton";
import { MediaDetailLists } from "../components/MediaDetailLists";
import { StatusPill, type StatusTone } from "../components/StatusPill";
import { useItemDetails } from "../state/use-item-details";
import { updateColumnFilter, type TableFilterValue } from "../state/table-state";
import { usePersistedTableState } from "../state/use-persisted-table-state";
import type { MediaItemDetails, SonarrSeriesTableRow } from "../../shared/ipc-contracts";

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
  onLoadDetails,
  onOpenInSonarr,
  onSearch,
  rows: liveRows,
  statusMessage = "Ready",
}: {
  analyzing?: boolean;
  onAnalyze?: (seriesIds?: number[]) => void;
  onGrab?: (seriesIds: number[]) => void;
  onLoadDetails?: (kind: "series" | "movie", arrId: number) => Promise<MediaItemDetails>;
  onOpenInSonarr?: (seriesId: number, titleSlug?: string) => void;
  onSearch?: (seriesIds: number[]) => void;
  rows?: SonarrSeriesTableRow[];
  statusMessage?: string;
}) {
  const [detailsRow, setDetailsRow] = useState<SonarrSeriesRow | null>(null);
  const { details, loading: detailsLoading } = useItemDetails("series", detailsRow?.arrId ?? null, onLoadDetails);
  const tableState = usePersistedTableState("arr-ops.table.sonarr", {
    sorting: [{ id: "nonFunFiles", desc: true }],
  });
  const resolvedRows = liveRows ?? [];
  const qualityProfileNames = useMemo(
    () => [...new Set(resolvedRows.map((r) => r.qualityProfileName).filter((n): n is string => Boolean(n)))].sort(),
    [resolvedRows],
  );
  const filterControls = useMemo(
    () => (
      <SonarrFilters
        columnFilters={tableState.state.columnFilters}
        onColumnFiltersChange={tableState.setColumnFilters}
        qualityProfileNames={qualityProfileNames}
      />
    ),
    [tableState, qualityProfileNames],
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
        enableHiding: false,
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
        meta: { sticky: "left" },
        size: 44,
      },
      {
        accessorKey: "title",
        cell: ({ getValue }) => <TitleCell value={getValue<string>()} />,
        enableHiding: false,
        header: "Title",
        meta: { sticky: "left" },
        size: 248,
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
        meta: { align: "right" },
        size: 100,
      },
      {
        accessorKey: "files",
        cell: ({ getValue }) => <NumberCell value={getValue<number>()} />,
        filterFn: positiveNumberFilter,
        header: "Files",
        meta: { align: "right" },
        size: 84,
      },
      {
        accessorKey: "totalSizeBytes",
        cell: ({ getValue }) => <NumberCell muted value={formatBytes(getValue<number>())} />,
        header: "Total size",
        meta: { align: "right" },
        size: 120,
      },
      {
        accessorKey: "funFiles",
        cell: ({ getValue }) => <NumberCell tone="good" value={getValue<number>()} />,
        filterFn: positiveNumberFilter,
        header: "FuN* files",
        meta: { align: "right" },
        size: 108,
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
          const status = getValue<SeriesStatus>();
          return <StatusPill tone={statusTone[status]}>{status}</StatusPill>;
        },
        header: "Status",
        size: 128,
      },
      {
        cell: ({ row }) => (
          <div className="flex justify-end gap-1">
            <IconButton className="px-2" icon={Eye} label={`Open details for ${row.original.title}`} onClick={() => setDetailsRow(row.original)} />
            <IconButton
              className="px-2"
              icon={ExternalLink}
              label={`Open ${row.original.title} in Sonarr`}
              onClick={() => onOpenInSonarr?.(row.original.arrId, row.original.titleSlug)}
            />
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
    [onOpenInSonarr],
  );

  return (
    <div className="flex flex-col gap-4">
      <AnalysisSection analyzing={analyzing} onAnalyze={() => onAnalyze?.()} statusMessage={statusMessage} title="Sonarr Analysis" />
      <DataTable
        bulkActions={(selectedRows) => (
          <>
            <IconButton
              disabled={analyzing}
              icon={Radar}
              label="Analyze selected series"
              onClick={() => onAnalyze?.(selectedRows.map((row) => row.original.arrId))}
              tone="primary"
            >
              Analyze selected
            </IconButton>
            <IconButton icon={Search} label="Search selected non-FuN series" onClick={() => onSearch?.(selectedRows.map((row) => row.original.arrId))}>
              Search selected
            </IconButton>
            <IconButton icon={Zap} label="Grab selected pending FuN releases" onClick={() => onGrab?.(selectedRows.map((row) => row.original.arrId))} tone="warning">
              Grab selected
            </IconButton>
          </>
        )}
        columnFilters={tableState.state.columnFilters}
        columns={columns}
        data={resolvedRows}
        description="Series-level coverage with pending FuN* candidates and selected-only search/grab controls."
        enableColumnVisibility
        filters={filterControls}
        globalFilter={tableState.state.globalFilter}
        getRowId={(row) => row.id}
        onColumnFiltersChange={tableState.setColumnFilters}
        onGlobalFilterChange={tableState.setGlobalFilter}
        onRowSelectionChange={tableState.setRowSelection}
        onSortingChange={tableState.setSorting}
        rowSelection={tableState.state.rowSelection}
        searchPlaceholder="Search series"
        selectedSummary={formatSelectedSummary}
        sorting={tableState.state.sorting}
        title="Sonarr Series"
      />
      {detailsRow ? (
        <section className="animate-fade-up rounded-xl bg-ink-925 p-4 shadow-card">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <h2 className="text-[15px] font-semibold text-white">{detailsRow.title}</h2>
              <p className="mt-1 text-[13px] text-ink-500">
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
          <MediaDetailLists details={details} kind="series" loading={detailsLoading} />
        </section>
      ) : null}
    </div>
  );
}

export function AnalysisSection({
  analyzing,
  onAnalyze,
  statusMessage,
  title,
}: {
  analyzing: boolean;
  onAnalyze: () => void;
  statusMessage: string;
  title: string;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-xl bg-ink-925 p-4 shadow-card sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-signal-cyan/[0.10] text-signal-cyan">
          <Radar aria-hidden="true" className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-[15px] font-semibold text-white">{title}</h2>
            <StatusPill tone={analyzing ? "running" : "idle"}>{analyzing ? "running" : "idle"}</StatusPill>
          </div>
          <p className="mt-0.5 truncate text-[13px] text-ink-500">{statusMessage}</p>
        </div>
      </div>
      <IconButton disabled={analyzing} icon={Radar} label={`Analyze all ${title}`} onClick={onAnalyze} tone="primary">
        {analyzing ? "Analyzing..." : "Analyze all"}
      </IconButton>
    </section>
  );
}

function formatSelectedSummary(selectedRows: Array<Row<SonarrSeriesRow>>): string {
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

function SonarrFilters({
  columnFilters,
  onColumnFiltersChange,
  qualityProfileNames,
}: {
  columnFilters: ColumnFiltersState;
  onColumnFiltersChange: (filters: ColumnFiltersState) => void;
  qualityProfileNames: string[];
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

export function FilterChip({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      aria-pressed={active}
      className={clsx(
        "inline-flex h-8 items-center rounded-full border px-3 text-[12px] font-medium outline-none",
        "transition-[background-color,border-color,color] duration-150 ease-out active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-signal-cyan/40",
        active
          ? "border-signal-cyan/40 bg-signal-cyan/[0.12] text-signal-cyan"
          : "border-white/[0.09] bg-white/[0.02] text-ink-400 hover:bg-white/[0.06] hover:text-ink-200",
      )}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}

export function FilterSelect({
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
        className="h-8 rounded-md border border-white/[0.09] bg-white/[0.02] px-2.5 text-[12px] font-medium text-ink-300 outline-none transition-[background-color,border-color] duration-150 ease-out hover:bg-white/[0.06] focus:border-signal-cyan/60 focus:ring-2 focus:ring-signal-cyan/25"
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

export function TitleCell({ maxWidth = 220, value }: { maxWidth?: number; value: string }) {
  return (
    <span className="block truncate font-semibold text-white" style={{ maxWidth }} title={value}>
      {value}
    </span>
  );
}

export function DateCell({ value }: { value: string }) {
  return <span className="font-mono text-[12.5px] text-ink-400">{value}</span>;
}

export function BooleanCell({ value }: { value: boolean }) {
  return <StatusPill tone={value ? "success" : "muted"}>{value ? "yes" : "no"}</StatusPill>;
}

export function NumberCell({ muted = false, tone = "default", value }: { muted?: boolean; tone?: "default" | "good" | "warning" | "danger"; value: number | string }) {
  const toneClass =
    tone === "good"
      ? "text-signal-green"
      : tone === "warning"
        ? "text-signal-amber"
        : tone === "danger"
          ? "text-signal-red"
          : muted
            ? "text-ink-400"
            : "text-ink-200";
  return <span className={clsx("font-mono text-[13px] tabular-nums", toneClass)}>{value}</span>;
}

export function ShareCell({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const tone = value < 0.7 ? "danger" : value < 1 ? "warning" : "good";
  const bar = tone === "good" ? "bg-signal-green" : tone === "warning" ? "bg-signal-amber" : "bg-signal-red";
  const text = tone === "good" ? "text-signal-green" : tone === "warning" ? "text-signal-amber" : "text-signal-red";
  return (
    <span className="inline-flex items-center justify-end gap-2">
      <span className="h-1.5 w-12 overflow-hidden rounded-full bg-white/[0.07]">
        <span className={clsx("block h-full rounded-full", bar)} style={{ width: `${Math.max(2, pct)}%` }} />
      </span>
      <span className={clsx("w-9 text-right font-mono text-[13px] font-medium tabular-nums", text)}>{pct}%</span>
    </span>
  );
}

export function CountChip({ tone, value }: { tone: "warning" | "info"; value: number }) {
  if (!value || value <= 0) {
    return <span className="font-mono text-[13px] tabular-nums text-ink-600">0</span>;
  }
  const cls =
    tone === "warning"
      ? "border-signal-amber/25 bg-signal-amber/[0.10] text-signal-amber"
      : "border-signal-cyan/25 bg-signal-cyan/[0.10] text-signal-cyan";
  return (
    <span className={clsx("inline-flex h-[22px] min-w-[1.9rem] items-center justify-center rounded-md border px-1.5 font-mono text-[12px] font-semibold tabular-nums", cls)}>
      {value}
    </span>
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
  return `${(value / 1_000_000_000).toFixed(1)} GB`;
}
