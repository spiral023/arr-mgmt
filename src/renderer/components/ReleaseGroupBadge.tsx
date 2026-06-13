import { clsx } from "clsx";

export interface ReleaseGroupBadgeProps {
  group: string | null | undefined;
  isFun?: boolean;
}

export function ReleaseGroupBadge({ group, isFun }: ReleaseGroupBadgeProps) {
  const label = group?.trim() || "Unknown";

  return (
    <span
      className={clsx(
        "inline-flex h-7 max-w-36 items-center rounded border px-2 font-mono text-xs font-semibold tabular-nums",
        isFun
          ? "border-signal-green/30 bg-signal-green/10 text-signal-green"
          : "border-white/10 bg-ink-800/80 text-ink-200",
      )}
    >
      <span className="truncate">{label}</span>
    </span>
  );
}
