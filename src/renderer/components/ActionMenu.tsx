import { useEffect, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { ChevronDown } from "lucide-react";
import { clsx } from "clsx";

export type ActionMenuTone = "default" | "primary" | "success" | "warning" | "danger";

export type ActionMenuItem = {
  icon: LucideIcon;
  label: string;
  description?: string;
  disabled?: boolean;
  tone?: ActionMenuTone;
  onClick?: () => void;
};

const triggerToneClasses: Record<ActionMenuTone, string> = {
  primary:
    "border-transparent bg-signal-cyan text-ink-950 shadow-[0_1px_2px_rgba(0,0,0,0.4)] hover:bg-[#6ac6da] hover:shadow-primary-glow",
  success: "border-signal-green/30 bg-signal-green/[0.06] text-signal-green shadow-surface hover:bg-signal-green/12",
  warning: "border-signal-amber/30 bg-signal-amber/[0.06] text-signal-amber shadow-surface hover:bg-signal-amber/12",
  danger: "border-signal-red/30 bg-signal-red/[0.06] text-signal-red shadow-surface hover:bg-signal-red/12",
  default: "border-white/10 bg-white/[0.02] text-ink-200 shadow-surface hover:bg-white/[0.07] hover:text-white",
};

export function ActionMenu({
  icon: Icon,
  items,
  label,
  shortLabel,
  tone = "default",
}: {
  icon: LucideIcon;
  items: ActionMenuItem[];
  label: string;
  shortLabel?: string;
  tone?: ActionMenuTone;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={containerRef}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={label}
        title={label}
        className={clsx(
          "inline-flex h-9 min-w-9 items-center justify-center gap-1.5 rounded-md border px-3 text-[13px] font-medium outline-none",
          "transition-[background-color,border-color,color,box-shadow,scale] duration-150 ease-out active:scale-[0.96]",
          "focus-visible:ring-2 focus-visible:ring-signal-cyan/40",
          triggerToneClasses[tone],
        )}
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
        <span className="hidden truncate sm:inline">{shortLabel ?? label}</span>
        <ChevronDown
          aria-hidden="true"
          className={clsx("h-3.5 w-3.5 shrink-0 transition-transform duration-150 ease-out", open && "rotate-180")}
        />
      </button>
      {open ? (
        <div
          className="absolute right-0 z-50 mt-2 w-72 origin-top-right animate-fade-up rounded-lg bg-ink-900 p-1.5 shadow-popover"
          role="menu"
        >
          {items.map((item) => {
            const ItemIcon = item.icon;
            return (
              <button
                className={clsx(
                  "flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left outline-none",
                  "transition-[background-color,scale] duration-150 ease-out active:scale-[0.98]",
                  "hover:bg-white/[0.06] focus-visible:bg-white/[0.06] focus-visible:ring-1 focus-visible:ring-signal-cyan/30 disabled:cursor-not-allowed disabled:opacity-40",
                )}
                disabled={item.disabled}
                key={item.label}
                onClick={() => {
                  setOpen(false);
                  item.onClick?.();
                }}
                role="menuitem"
                type="button"
              >
                <span className={clsx("grid h-7 w-7 shrink-0 place-items-center rounded-md", itemIconChrome(item.tone))}>
                  <ItemIcon aria-hidden="true" className="h-4 w-4" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-semibold text-ink-200">{item.label}</span>
                  {item.description ? <span className="block truncate text-xs text-ink-500">{item.description}</span> : null}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function itemIconChrome(tone: ActionMenuItem["tone"]) {
  if (tone === "success") return "bg-signal-green/12 text-signal-green";
  if (tone === "warning") return "bg-signal-amber/12 text-signal-amber";
  if (tone === "danger") return "bg-signal-red/12 text-signal-red";
  if (tone === "primary") return "bg-signal-cyan/12 text-signal-cyan";
  return "bg-white/[0.05] text-ink-300";
}
