import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { DataTable } from "../components/DataTable";
import { IconButton } from "../components/IconButton";
import { StatusPill, type StatusTone } from "../components/StatusPill";

interface QuotaActionRow {
  action: string;
  app: "sonarr" | "radarr" | "external";
  at: string;
  count: number;
  item: string;
  quotaType: "search" | "grab";
  status: "success" | "failed" | "blocked";
}

const quotaActions: QuotaActionRow[] = [
  { action: "search", app: "sonarr", at: "22:01:18", count: 1, item: "Criminal Record S01E07", quotaType: "search", status: "success" },
  { action: "grab", app: "radarr", at: "21:58:44", count: 1, item: "Nicht noch ein Teenie-Film", quotaType: "grab", status: "blocked" },
  { action: "manual_grab_entry", app: "external", at: "21:31:09", count: 12, item: "Manual SABnzbd import", quotaType: "grab", status: "success" },
  { action: "search", app: "radarr", at: "20:29:27", count: 1, item: "Candidate scan batch", quotaType: "search", status: "success" },
];

const statusTone: Record<QuotaActionRow["status"], StatusTone> = {
  blocked: "warning",
  failed: "danger",
  success: "success",
};

const usage = [
  { label: "Search", limit: 2000, tone: "cyan", used: 417 },
  { label: "Grab", limit: 400, tone: "amber", used: 61 },
];

const timeline = [
  { hour: "00", search: 16, grab: 2 },
  { hour: "04", search: 48, grab: 5 },
  { hour: "08", search: 22, grab: 1 },
  { hour: "12", search: 93, grab: 14 },
  { hour: "16", search: 68, grab: 10 },
  { hour: "20", search: 170, grab: 29 },
];

export function QuotaView() {
  const columns = useMemo<Array<ColumnDef<QuotaActionRow, unknown>>>(
    () => [
      { accessorKey: "at", cell: ({ getValue }) => <Mono>{getValue<string>()}</Mono>, header: "Time", size: 96 },
      { accessorKey: "app", header: "Source", size: 96 },
      { accessorKey: "action", header: "Action", size: 150 },
      { accessorKey: "quotaType", header: "Quota", size: 96 },
      { accessorKey: "count", cell: ({ getValue }) => <Mono>{String(getValue<number>())}</Mono>, header: "Count", size: 88 },
      { accessorKey: "item", header: "Item", size: 280 },
      {
        accessorKey: "status",
        cell: ({ getValue }) => {
          const status = getValue<QuotaActionRow["status"]>();
          return <StatusPill tone={statusTone[status]}>{status}</StatusPill>;
        },
        header: "Status",
        size: 112,
      },
    ],
    [],
  );

  return (
    <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
      <section className="flex flex-col gap-4">
        <div className="rounded-lg border border-white/10 bg-ink-900/80 p-4 shadow-surface">
          <h2 className="text-base font-semibold text-white">Rolling 24h Usage</h2>
          <div className="mt-4 grid gap-3">
            {usage.map((item) => {
              const percent = Math.round((item.used / item.limit) * 100);
              return (
                <div className="rounded-md border border-white/10 bg-ink-950/60 p-3" key={item.label}>
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="font-semibold text-ink-200">{item.label}</span>
                    <span className="font-mono tabular-nums text-ink-200">
                      {item.used} / {item.limit}
                    </span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded bg-ink-800">
                    <div
                      className={item.tone === "cyan" ? "h-full rounded bg-signal-cyan" : "h-full rounded bg-signal-amber"}
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                  <div className="mt-2 text-xs text-ink-400">
                    <span className="font-mono tabular-nums">{item.limit - item.used}</span> remaining
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <form className="rounded-lg border border-white/10 bg-ink-900/80 p-4 shadow-surface" onSubmit={(event) => event.preventDefault()}>
          <h2 className="text-base font-semibold text-white">Manual Grab Entry</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-[8rem_1fr]">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.08em] text-ink-400">Count</span>
              <input className={fieldClassName} defaultValue={1} min={1} type="number" />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.08em] text-ink-400">App source</span>
              <select className={fieldClassName} defaultValue="external">
                <option value="sonarr">sonarr</option>
                <option value="radarr">radarr</option>
                <option value="external">external</option>
              </select>
            </label>
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.08em] text-ink-400">Note</span>
              <input className={fieldClassName} placeholder="External grab or manual import note" type="text" />
            </label>
          </div>
          <div className="mt-4">
            <IconButton icon={Plus} label="Record manual grab entry" tone="warning" type="submit">
              Record entry
            </IconButton>
          </div>
        </form>
      </section>

      <section className="flex flex-col gap-4">
        <div className="rounded-lg border border-white/10 bg-ink-900/80 p-4 shadow-surface">
          <h2 className="text-base font-semibold text-white">Usage Timeline</h2>
          <div className="mt-4 grid grid-cols-6 gap-2">
            {timeline.map((bucket) => (
              <div className="rounded-md border border-white/10 bg-ink-950/60 p-2" key={bucket.hour}>
                <div className="text-center font-mono text-xs tabular-nums text-ink-400">{bucket.hour}:00</div>
                <div className="mt-3 flex h-28 items-end justify-center gap-1">
                  <div className="w-4 rounded-t bg-signal-cyan" style={{ height: `${Math.max(8, bucket.search / 2)}%` }} />
                  <div className="w-4 rounded-t bg-signal-amber" style={{ height: `${Math.max(8, bucket.grab * 3)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <DataTable columns={columns} data={quotaActions} searchPlaceholder="Filter quota actions" title="Recent Quota Actions" />
      </section>
    </div>
  );
}

const fieldClassName =
  "h-10 w-full rounded-md border border-white/10 bg-ink-950 px-3 text-sm text-ink-200 outline-none shadow-surface transition-[background-color,border-color,box-shadow] duration-150 ease-out placeholder:text-ink-400 focus:border-signal-cyan focus:ring-2 focus:ring-signal-cyan/30";

function Mono({ children }: { children: string }) {
  return <span className="font-mono tabular-nums text-ink-200">{children}</span>;
}
