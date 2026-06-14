import { useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus, RefreshCw } from "lucide-react";
import { DataTable } from "../components/DataTable";
import { IconButton } from "../components/IconButton";
import { StatusPill, type StatusTone } from "../components/StatusPill";
import { getQuotaSummary, getRecentActivity, recordManualGrab } from "../state/ipc-client";
import type { ActivityRowView, QuotaSummary } from "../../shared/ipc-contracts";

const emptyQuota: QuotaSummary = {
  search: { used: 0, remaining: 0, limit: 0 },
  grab: { used: 0, remaining: 0, limit: 0 },
};

const statusTone: Record<string, StatusTone> = {
  blocked_by_budget: "warning",
  failed: "danger",
  skipped: "warning",
  started: "running",
  success: "success",
};

export function QuotaView() {
  const [activity, setActivity] = useState<ActivityRowView[]>([]);
  const [count, setCount] = useState(1);
  const [message, setMessage] = useState("Ready");
  const [note, setNote] = useState("");
  const [quota, setQuota] = useState<QuotaSummary>(emptyQuota);

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh() {
    const [nextQuota, nextActivity] = await Promise.all([getQuotaSummary(), getRecentActivity()]);
    setQuota(nextQuota);
    setActivity(nextActivity.filter((row) => row.quota !== "none"));
  }

  async function submitManualGrab(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("Recording manual grab entry...");
    try {
      const nextQuota = await recordManualGrab({ count, note });
      setQuota(nextQuota);
      setNote("");
      setMessage(`Recorded ${count} manual grab ${count === 1 ? "entry" : "entries"}`);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  const columns = useMemo<Array<ColumnDef<ActivityRowView, unknown>>>(
    () => [
      { accessorKey: "at", cell: ({ getValue }) => <Mono>{getValue<string>()}</Mono>, header: "Time", size: 150 },
      { accessorKey: "app", header: "Source", size: 96 },
      { accessorKey: "action", header: "Action", size: 150 },
      { accessorKey: "quota", header: "Quota", size: 96 },
      { accessorKey: "item", header: "Item", size: 300 },
      {
        accessorKey: "status",
        cell: ({ getValue }) => {
          const status = getValue<string>();
          return <StatusPill tone={statusTone[status] ?? "idle"}>{status}</StatusPill>;
        },
        header: "Status",
        size: 132,
      },
    ],
    [],
  );

  return (
    <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
      <section className="flex flex-col gap-4">
        <div className="rounded-lg border border-white/10 bg-ink-900/80 p-4 shadow-surface">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-white">Rolling 24h Usage</h2>
            <IconButton icon={RefreshCw} label="Refresh quotas" onClick={() => void refresh()} />
          </div>
          <div className="mt-4 grid gap-3">
            <UsageMeter label="Search" limit={quota.search.limit} remaining={quota.search.remaining} tone="cyan" used={quota.search.used} />
            <UsageMeter label="Grab" limit={quota.grab.limit} remaining={quota.grab.remaining} tone="amber" used={quota.grab.used} />
          </div>
        </div>

        <form className="rounded-lg border border-white/10 bg-ink-900/80 p-4 shadow-surface" onSubmit={submitManualGrab}>
          <h2 className="text-base font-semibold text-white">Manual Grab Entry</h2>
          <div className="mt-3 rounded-md border border-white/10 bg-ink-950/60 px-3 py-2 text-sm text-ink-200 shadow-surface">{message}</div>
          <div className="mt-4 grid gap-3 sm:grid-cols-[8rem_1fr]">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.08em] text-ink-400">Count</span>
              <input className={fieldClassName} min={1} onChange={(event) => setCount(Number(event.target.value))} type="number" value={count} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.08em] text-ink-400">Note</span>
              <input className={fieldClassName} onChange={(event) => setNote(event.target.value)} placeholder="External grab or manual import note" type="text" value={note} />
            </label>
          </div>
          <div className="mt-4">
            <IconButton icon={Plus} label="Record manual grab entry" tone="warning" type="submit">
              Record entry
            </IconButton>
          </div>
        </form>
      </section>

      <section className="min-w-0">
        <DataTable columns={columns} data={activity} searchPlaceholder="Filter quota actions" title="Recent Quota Actions" />
      </section>
    </div>
  );
}

function UsageMeter({ label, limit, remaining, tone, used }: { label: string; limit: number; remaining: number; tone: "amber" | "cyan"; used: number }) {
  const percent = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return (
    <div className="rounded-md border border-white/10 bg-ink-950/60 p-3">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="font-semibold text-ink-200">{label}</span>
        <span className="font-mono tabular-nums text-ink-200">
          {used} / {limit}
        </span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded bg-ink-800">
        <div className={tone === "cyan" ? "h-full rounded bg-signal-cyan" : "h-full rounded bg-signal-amber"} style={{ width: `${percent}%` }} />
      </div>
      <div className="mt-2 text-xs text-ink-400">
        <span className="font-mono tabular-nums">{remaining}</span> remaining
      </div>
    </div>
  );
}

const fieldClassName =
  "h-10 w-full rounded-md border border-white/10 bg-ink-950 px-3 text-sm text-ink-200 outline-none shadow-surface transition-[background-color,border-color,box-shadow] duration-150 ease-out placeholder:text-ink-400 focus:border-signal-cyan focus:ring-2 focus:ring-signal-cyan/30";

function Mono({ children }: { children: string }) {
  return <span className="font-mono tabular-nums text-ink-200">{children}</span>;
}
