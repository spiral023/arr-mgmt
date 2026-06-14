import { useState } from "react";
import type { LucideIcon } from "lucide-react";
import { ChevronDown } from "lucide-react";
import { clsx } from "clsx";

export type ActionMenuItem = {
  icon: LucideIcon;
  label: string;
  description?: string;
  disabled?: boolean;
  tone?: "default" | "success" | "warning" | "danger";
  onClick?: () => void;
};

export function ActionMenu({
  icon: Icon,
  items,
  label,
  tone = "default",
}: {
  icon: LucideIcon;
  items: ActionMenuItem[];
  label: string;
  tone?: "default" | "success" | "warning";
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        aria-expanded={open}
        aria-label={label}
        className={clsx(
          "inline-flex min-h-10 min-w-10 items-center justify-center gap-2 rounded-md border bg-ink-900/85 px-3 text-sm font-medium shadow-surface outline-none",
          "transition-[background-color,border-color,color,box-shadow,scale] duration-150 ease-out active:scale-[0.96]",
          "focus-visible:border-signal-cyan focus-visible:ring-2 focus-visible:ring-signal-cyan/30",
          tone === "success"
            ? "border-signal-green/30 text-signal-green hover:bg-signal-green/10"
            : tone === "warning"
              ? "border-signal-amber/30 text-signal-amber hover:bg-signal-amber/10"
              : "border-white/10 text-ink-200 hover:bg-white/[0.06] hover:text-white",
        )}
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
        <span className="hidden sm:inline">{label}</span>
        <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0" />
      </button>
      {open ? (
        <div className="absolute right-0 z-40 mt-2 w-72 rounded-lg bg-ink-900 p-2 shadow-[0_0_0_1px_rgba(255,255,255,0.10),0_18px_48px_rgba(0,0,0,0.42)]">
          {items.map((item) => {
            const ItemIcon = item.icon;
            return (
              <button
                className={clsx(
                  "flex min-h-11 w-full items-center gap-3 rounded-md px-2 text-left outline-none transition-[background-color,scale] duration-150 ease-out active:scale-[0.96]",
                  "hover:bg-white/[0.05] focus-visible:ring-2 focus-visible:ring-signal-cyan/30 disabled:cursor-not-allowed disabled:opacity-45",
                )}
                disabled={item.disabled}
                key={item.label}
                onClick={() => {
                  setOpen(false);
                  item.onClick?.();
                }}
                type="button"
              >
                <ItemIcon aria-hidden="true" className={clsx("h-4 w-4 shrink-0", toneClass(item.tone))} />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-ink-200">{item.label}</span>
                  {item.description ? <span className="block truncate text-xs text-ink-400">{item.description}</span> : null}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function toneClass(tone: ActionMenuItem["tone"]) {
  if (tone === "success") return "text-signal-green";
  if (tone === "warning") return "text-signal-amber";
  if (tone === "danger") return "text-signal-red";
  return "text-signal-cyan";
}
