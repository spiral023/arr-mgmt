import { clsx } from "clsx";

export type StatusTone = "idle" | "running" | "success" | "warning" | "danger" | "muted";

export interface StatusPillProps {
  children: string;
  tone?: StatusTone;
}

const toneClasses: Record<StatusTone, string> = {
  success: "border-signal-green/25 bg-signal-green/[0.08] text-signal-green",
  running: "border-signal-cyan/25 bg-signal-cyan/[0.08] text-signal-cyan",
  warning: "border-signal-amber/25 bg-signal-amber/[0.08] text-signal-amber",
  danger: "border-signal-red/25 bg-signal-red/[0.08] text-signal-red",
  idle: "border-white/10 bg-white/[0.03] text-ink-300",
  muted: "border-white/[0.06] bg-transparent text-ink-500",
};

const dotClasses: Record<StatusTone, string> = {
  success: "bg-signal-green",
  running: "bg-signal-cyan animate-pulse-dot",
  warning: "bg-signal-amber",
  danger: "bg-signal-red",
  idle: "bg-ink-500",
  muted: "bg-ink-600",
};

export function StatusPill({ children, tone = "idle" }: StatusPillProps) {
  return (
    <span
      className={clsx(
        "inline-flex h-[22px] items-center gap-1.5 whitespace-nowrap rounded-full border px-2 text-[11px] font-semibold uppercase tracking-[0.06em]",
        toneClasses[tone],
      )}
    >
      <span aria-hidden="true" className={clsx("h-1.5 w-1.5 shrink-0 rounded-full", dotClasses[tone])} />
      {children}
    </span>
  );
}
