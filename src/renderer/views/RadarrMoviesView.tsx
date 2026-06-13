import { useMemo, useState } from "react";
import type { ColumnDef, ColumnFiltersState } from "@tanstack/react-table";
import { ExternalLink, Eye, Radar, Search, Zap } from "lucide-react";
import { DataTable } from "../components/DataTable";
import { IconButton } from "../components/IconButton";
import { ReleaseGroupBadge } from "../components/ReleaseGroupBadge";
import { StatusPill, type StatusTone } from "../components/StatusPill";
import { updateColumnFilter } from "../state/table-state";

type MovieStatus = "ready" | "candidate" | "searchable" | "blocked";

interface RadarrMovieRow {
  candidateFound: boolean;
  hasFile: boolean;
  id: string;
  isFun: boolean;
  lastAnalyzed: string;
  lastGrabbed: string;
  lastSearched: string;
  monitored: boolean;
  releaseGroup: string | null;
  searchableNow: boolean;
  sizeBytes: number;
  status: MovieStatus;
  title: string;
  year: number;
}

const rows: RadarrMovieRow[] = [
  {
    candidateFound: true,
    hasFile: true,
    id: "movie-8222",
    isFun: false,
    lastAnalyzed: "2026-06-13 21:53",
    lastGrabbed: "-",
    lastSearched: "2026-06-13 20:29",
    monitored: true,
    releaseGroup: "TSCC",
    searchableNow: true,
    sizeBytes: 8_900_000_000,
    status: "candidate",
    title: "Nicht noch ein Teenie-Film",
    year: 2001,
  },
  {
    candidateFound: false,
    hasFile: true,
    id: "movie-2",
    isFun: true,
    lastAnalyzed: "2026-06-13 21:49",
    lastGrabbed: "2026-06-11 22:19",
    lastSearched: "2026-06-11 21:45",
    monitored: true,
    releaseGroup: "FuNHD",
    searchableNow: false,
    sizeBytes: 14_200_000_000,
    status: "ready",
    title: "Heat",
    year: 1995,
  },
  {
    candidateFound: false,
    hasFile: true,
    id: "movie-3",
    isFun: false,
    lastAnalyzed: "2026-06-13 20:10",
    lastGrabbed: "-",
    lastSearched: "2026-06-13 20:11",
    monitored: true,
    releaseGroup: "WvF",
    searchableNow: false,
    sizeBytes: 21_700_000_000,
    status: "blocked",
    title: "Dune: Part Two",
    year: 2024,
  },
  {
    candidateFound: false,
    hasFile: false,
    id: "movie-4",
    isFun: false,
    lastAnalyzed: "2026-06-12 18:02",
    lastGrabbed: "-",
    lastSearched: "-",
    monitored: false,
    releaseGroup: null,
    searchableNow: false,
    sizeBytes: 0,
    status: "searchable",
    title: "Pending Import",
    year: 2026,
  },
];

const statusTone: Record<MovieStatus, StatusTone> = {
  blocked: "warning",
  candidate: "running",
  ready: "success",
  searchable: "idle",
};

export function RadarrMoviesView() {
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const filterControls = useMemo(
    () => <RadarrFilters columnFilters={columnFilters} onColumnFiltersChange={setColumnFilters} />,
    [columnFilters],
  );

  const columns = useMemo<Array<ColumnDef<RadarrMovieRow, unknown>>>(
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
        cell: ({ getValue }) => <NumberCell value={getValue<number>()} />,
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
        accessorKey: "hasFile",
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
        accessorKey: "isFun",
        cell: ({ getValue }) => <StatusPill tone={getValue<boolean>() ? "success" : "muted"}>{getValue<boolean>() ? "yes" : "no"}</StatusPill>,
        filterFn: booleanFilter,
        header: "FuN*",
        size: 88,
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
            <IconButton className="px-0" icon={Eye} label={`Open details for ${row.original.title}`} />
            <IconButton className="px-0" icon={ExternalLink} label={`Open ${row.original.title} in Radarr`} />
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
          <IconButton disabled={selectedRows.length === 0} icon={Radar} label="Analyze selected movies" tone="success">
            Analyze selected
          </IconButton>
          <IconButton disabled={selectedRows.length === 0} icon={Search} label="Search selected movies">
            Search selected
          </IconButton>
          <IconButton disabled={selectedRows.length === 0} icon={Zap} label="Grab available FuN releases" tone="warning">
            Grab FuN*
          </IconButton>
        </>
      )}
      columnFilters={columnFilters}
      columns={columns}
      data={rows}
      description="Movie-level FuN* coverage, candidate discovery, and per-title operations."
      filters={filterControls}
      getRowId={(row) => row.id}
      initialSorting={[{ id: "status", desc: false }]}
      searchPlaceholder="Search movies"
      title="Radarr Movies"
    />
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
          let next = updateColumnFilter(columnFilters, "isFun", "");
          if (value === "fun") next = updateColumnFilter(next, "isFun", true);
          if (value === "notFun") next = updateColumnFilter(next, "isFun", false);
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
          next = updateColumnFilter(next, "hasFile", "");
          next = updateColumnFilter(next, "status", "");
          if (value === "monitored") next = updateColumnFilter(next, "monitored", true);
          if (value === "hasFile") next = updateColumnFilter(next, "hasFile", true);
          if (value === "searchableNow") next = updateColumnFilter(next, "status", "searchable");
          if (value === "candidateFound") next = updateColumnFilter(next, "status", "candidate");
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

function NumberCell({ value }: { value: number | string }) {
  return <span className="font-mono text-sm text-ink-200 tabular-nums">{value}</span>;
}

function booleanFilter(row: { getValue: (id: string) => unknown }, columnId: string, value: unknown) {
  return value === "" || row.getValue(columnId) === value;
}

function formatBytes(value: number) {
  if (value === 0) return "0 GB";
  return `${(value / 1_000_000_000).toFixed(1)} GB`;
}
