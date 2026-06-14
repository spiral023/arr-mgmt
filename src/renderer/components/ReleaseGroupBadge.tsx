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
        "inline-flex h-[22px] max-w-[9rem] items-center rounded-md border px-2 font-mono text-xs font-medium",
        isFun
          ? "border-signal-green/25 bg-signal-green/[0.08] text-signal-green"
          : "border-white/[0.08] bg-white/[0.03] text-ink-300",
      )}
      title={label}
    >
      <span className="truncate">{label}</span>
    </span>
  );
}
