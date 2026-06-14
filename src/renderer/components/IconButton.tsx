import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { clsx } from "clsx";

type IconButtonTone = "default" | "primary" | "danger" | "success" | "warning";

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon;
  label: string;
  tone?: IconButtonTone;
  children?: ReactNode;
}

const toneClasses: Record<IconButtonTone, string> = {
  primary:
    "border-transparent bg-signal-cyan text-ink-950 shadow-[0_1px_2px_rgba(0,0,0,0.4)] hover:bg-[#6ac6da] hover:shadow-primary-glow",
  default: "border-white/10 bg-white/[0.02] text-ink-200 shadow-surface hover:bg-white/[0.07] hover:text-white hover:shadow-surface-hover",
  danger: "border-signal-red/30 bg-signal-red/[0.06] text-signal-red shadow-surface hover:bg-signal-red/12 hover:shadow-surface-hover",
  success: "border-signal-green/30 bg-signal-green/[0.06] text-signal-green shadow-surface hover:bg-signal-green/12 hover:shadow-surface-hover",
  warning: "border-signal-amber/30 bg-signal-amber/[0.06] text-signal-amber shadow-surface hover:bg-signal-amber/12 hover:shadow-surface-hover",
};

export function IconButton({
  children,
  className,
  icon: Icon,
  label,
  tone = "default",
  type = "button",
  ...props
}: IconButtonProps) {
  return (
    <button
      aria-label={label}
      title={label}
      type={type}
      {...props}
      className={clsx(
        "inline-flex h-9 min-w-9 items-center justify-center gap-1.5 rounded-md border px-3 text-[13px] font-medium outline-none",
        "transition-[background-color,border-color,color,box-shadow,scale] duration-150 ease-out active:scale-[0.96]",
        "focus-visible:ring-2 focus-visible:ring-signal-cyan/40 focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent",
        toneClasses[tone],
        className,
      )}
    >
      <Icon aria-hidden="true" className="h-4 w-4 shrink-0" strokeWidth={2} />
      {children ? <span className="truncate">{children}</span> : null}
    </button>
  );
}
