import { clsx } from "clsx";

export type StatusTone = "idle" | "running" | "success" | "warning" | "danger" | "muted";

export interface StatusPillProps {
  children: string;
  tone?: StatusTone;
}

const toneClasses: Record<StatusTone, string> = {
  danger: "border-signal-red/30 bg-signal-red/10 text-signal-red",
  idle: "border-white/10 bg-white/[0.04] text-ink-200",
  muted: "border-white/10 bg-ink-800/70 text-ink-400",
  running: "border-signal-cyan/30 bg-signal-cyan/10 text-signal-cyan",
  success: "border-signal-green/30 bg-signal-green/10 text-signal-green",
  warning: "border-signal-amber/30 bg-signal-amber/10 text-signal-amber",
};

export function StatusPill({ children, tone = "idle" }: StatusPillProps) {
  return (
    <span
      className={clsx(
        "inline-flex h-6 items-center rounded border px-2 text-xs font-semibold uppercase tracking-[0.08em]",
        toneClasses[tone],
      )}
    >
      {children}
    </span>
  );
}
