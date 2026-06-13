import { useMemo, useState } from "react";
import type { ColumnDef, ColumnFiltersState } from "@tanstack/react-table";
import { ExternalLink, Eye, Radar, Search, Zap } from "lucide-react";
import { DataTable } from "../components/DataTable";
import { IconButton } from "../components/IconButton";
import { StatusPill, type StatusTone } from "../components/StatusPill";
import { updateColumnFilter } from "../state/table-state";

type SeriesStatus = "ready" | "searchable" | "cooldown" | "failed";

interface SonarrSeriesRow {
  blockedByCooldown: boolean;
  episodes: number;
  failedLastSearch: boolean;
  files: number;
  funFiles: number;
  funShare: number;
  hasFiles: boolean;
  id: string;
  lastAnalyzed: string;
  lastGrabbed: string;
  lastSearched: string;
  monitored: boolean;
  nonFunFiles: number;
  searchableNow: boolean;
  status: SeriesStatus;
  title: string;
  totalSizeBytes: number;
}

const rows: SonarrSeriesRow[] = [
  {
    blockedByCooldown: false,
    episodes: 16,
    failedLastSearch: false,
    files: 16,
    funFiles: 8,
    funShare: 0.5,
    hasFiles: true,
    id: "series-1",
    lastAnalyzed: "2026-06-13 21:58",
    lastGrabbed: "2026-06-12 23:41",
    lastSearched: "2026-06-13 20:18",
    monitored: true,
    nonFunFiles: 8,
    searchableNow: true,
    status: "searchable",
    title: "Criminal Record",
    totalSizeBytes: 28_400_000_000,
  },
  {
    blockedByCooldown: true,
    episodes: 80,
    failedLastSearch: false,
    files: 80,
    funFiles: 80,
    funShare: 1,
    hasFiles: true,
    id: "series-2",
    lastAnalyzed: "2026-06-13 21:50",
    lastGrabbed: "2026-06-13 06:24",
    lastSearched: "2026-06-13 06:05",
    monitored: true,
    nonFunFiles: 0,
    searchableNow: false,
    status: "cooldown",
    title: "Slow Horses",
    totalSizeBytes: 142_700_000_000,
  },
  {
    blockedByCooldown: false,
    episodes: 10,
    failedLastSearch: true,
    files: 7,
    funFiles: 1,
    funShare: 0.14,
    hasFiles: true,
    id: "series-3",
    lastAnalyzed: "2026-06-13 19:07",
    lastGrabbed: "-",
    lastSearched: "2026-06-13 19:08",
    monitored: true,
    nonFunFiles: 6,
    searchableNow: false,
    status: "failed",
    title: "Severance",
    totalSizeBytes: 61_300_000_000,
  },
  {
    blockedByCooldown: false,
    episodes: 24,
    failedLastSearch: false,
    files: 0,
    funFiles: 0,
    funShare: 0,
    hasFiles: false,
    id: "series-4",
    lastAnalyzed: "2026-06-12 23:11",
    lastGrabbed: "-",
    lastSearched: "-",
    monitored: false,
    nonFunFiles: 0,
    searchableNow: false,
    status: "ready",
    title: "Archive Hold",
    totalSizeBytes: 0,
  },
];

const statusTone: Record<SeriesStatus, StatusTone> = {
  cooldown: "warning",
  failed: "danger",
  ready: "success",
  searchable: "running",
};

export function SonarrSeriesView() {
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
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
        cell: ({ getValue }) => <NumberCell tone="good" value={formatPercent(getValue<number>())} />,
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
            <IconButton className="px-0" icon={Eye} label={`Open details for ${row.original.title}`} />
            <IconButton className="px-0" icon={ExternalLink} label={`Open ${row.original.title} in Sonarr`} />
          </div>
        ),
        enableSorting: false,
        header: "Actions",
        id: "actions",
        size: 112,
      },
    ],
    [],
  );

  return (
    <DataTable
      bulkActions={(selectedRows) => (
        <>
          <IconButton disabled={selectedRows.length === 0} icon={Radar} label="Analyze selected series" tone="success">
            Analyze selected
          </IconButton>
          <IconButton disabled={selectedRows.length === 0} icon={Search} label="Search non-FuN selected series">
            Search non-FuN
          </IconButton>
          <IconButton disabled={selectedRows.length === 0} icon={Zap} label="Grab available FuN releases" tone="warning">
            Grab FuN*
          </IconButton>
        </>
      )}
      columnFilters={columnFilters}
      columns={columns}
      data={rows}
      description="Series-level coverage with cooldown, searchability, and FuN* share filters."
      filters={filterControls}
      getRowId={(row) => row.id}
      initialSorting={[{ id: "nonFunFiles", desc: true }]}
      searchPlaceholder="Search series"
      title="Sonarr Series"
    />
  );
}

function SonarrFilters({
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

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function formatBytes(value: number) {
  if (value === 0) return "0 GB";
  return `${(value / 1_000_000_000).toFixed(1)} GB`;
}
