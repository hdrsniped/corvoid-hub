import { cx } from "@/core/format"

/** Thin progress bar. `value` is 0 to 100; `color` is any CSS color (use oklch from core/colors). */
export function ProgressBar({ value, color, className }: { value: number; color: string; className?: string }) {
  const pct = Math.min(100, Math.max(0, value))
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      className={cx("h-1.5 overflow-hidden rounded-full bg-muted", className)}
    >
      <div className="h-full rounded-full transition-[width]" style={{ width: `${pct}%`, background: color }} />
    </div>
  )
}
