import { useId } from "react"

/** A DOM-safe id for chart gradients. useId gives colons, which break url(#id) references. */
export function useChartId(): string {
  return useId().replace(/[^a-zA-Z0-9]/g, "")
}

/** `url(#...)` fill for an area made by AreaGradients with the same id and key. */
export function areaFill(id: string, key: string): string {
  return `url(#${id}-${key})`
}

/**
 * Vertical gradient fills for recharts areas: solid at the top, fading to transparent at the
 * baseline. Render inside a chart; the fills are referenced with areaFill(id, key).
 */
export function AreaGradients({
  id,
  items,
  from = 0.7,
  to = 0.04,
}: {
  id: string
  items: Array<{ key: string; color: string }>
  /** Opacity at the top of each area. */
  from?: number
  /** Opacity at the baseline. */
  to?: number
}) {
  return (
    <defs>
      {items.map((item) => (
        <linearGradient key={item.key} id={`${id}-${item.key}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="5%" style={{ stopColor: item.color, stopOpacity: from }} />
          <stop offset="95%" style={{ stopColor: item.color, stopOpacity: to }} />
        </linearGradient>
      ))}
    </defs>
  )
}
