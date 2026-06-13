import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { clsx } from "clsx";

type IconButtonTone = "default" | "danger" | "success" | "warning";

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon;
  label: string;
  tone?: IconButtonTone;
  children?: ReactNode;
}

const toneClasses: Record<IconButtonTone, string> = {
  danger: "border-signal-red/30 text-signal-red hover:bg-signal-red/10 hover:shadow-surface-hover",
  default: "border-white/10 text-ink-200 hover:bg-white/[0.06] hover:text-white hover:shadow-surface-hover",
  success: "border-signal-green/30 text-signal-green hover:bg-signal-green/10 hover:shadow-surface-hover",
  warning: "border-signal-amber/30 text-signal-amber hover:bg-signal-amber/10 hover:shadow-surface-hover",
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
        "inline-flex min-h-10 min-w-10 items-center justify-center gap-2 rounded-md border bg-ink-900/85 px-3 text-sm font-medium shadow-surface outline-none",
        "transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-out active:scale-[0.96]",
        "focus-visible:border-signal-cyan focus-visible:ring-2 focus-visible:ring-signal-cyan/30 disabled:cursor-not-allowed disabled:opacity-45",
        toneClasses[tone],
        className,
      )}
    >
      <Icon aria-hidden="true" className="h-4 w-4 shrink-0" strokeWidth={2} />
      {children ? <span>{children}</span> : null}
    </button>
  );
}
