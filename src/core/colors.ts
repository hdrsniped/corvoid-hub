import { useEffect, useState } from "react"

import type { HarnessId } from "./harness"

/**
 * All colors in the app are OKLCH. Lightness and chroma are fixed per theme here;
 * the hue comes from the category (or the harness). Concrete values, not CSS variables,
 * because canvas (graph) and SVG attributes (charts) cannot read CSS variables reliably.
 */
export interface Tone {
  l: number
  c: number
  /** Degrees. */
  h: number
}

const CATEGORY_TONE = {
  light: { l: 0.6, c: 0.16 },
  dark: { l: 0.78, c: 0.14 },
} as const

/** Lightness of stale (muted gray) items per theme. */
const MUTED_GRAY_L = { light: 0.74, dark: 0.42 } as const

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x))
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

export function oklch(t: Tone, alpha = 1): string {
  const h = ((t.h % 360) + 360) % 360
  const a = alpha < 1 ? ` / ${alpha.toFixed(2)}` : ""
  return `oklch(${t.l.toFixed(3)} ${t.c.toFixed(3)} ${h.toFixed(1)}${a})`
}

function isDarkDocument(): boolean {
  return typeof document !== "undefined" && document.documentElement.classList.contains("dark")
}

/** True while the app is in dark mode. Re-renders the caller when the theme class changes. */
export function useDark(): boolean {
  const [dark, setDark] = useState(isDarkDocument)
  useEffect(() => {
    const observer = new MutationObserver(() => setDark(isDarkDocument()))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })
    return () => observer.disconnect()
  }, [])
  return dark
}

/** Category tone: its hue at the theme's fixed lightness and chroma. No category (undefined hue) = neutral gray. */
export function categoryTone(hue: number | undefined, dark: boolean): Tone {
  if (hue === undefined) return { l: dark ? 0.7 : 0.56, c: 0, h: 0 }
  const base = dark ? CATEGORY_TONE.dark : CATEGORY_TONE.light
  return { l: base.l, c: base.c, h: hue }
}

export function categoryColor(hue: number | undefined, dark: boolean, alpha = 1): string {
  return oklch(categoryTone(hue, dark), alpha)
}

export function neutralColor(dark: boolean, alpha = 1): string {
  return oklch(categoryTone(undefined, dark), alpha)
}

/** Stable value in [0, 1) for a string (FNV-1a). Same input, same output, on every run. */
export function hashUnit(input: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0) / 4294967296
}

/**
 * Project tone: the category hue shifted by up to +-25 degrees, plus one of three lightness
 * steps and a little chroma variation, all picked by a hash of the project name.
 * Projects in the same category stay distinguishable.
 */
export function projectTone(name: string, hue: number | undefined, dark: boolean): Tone {
  const base = categoryTone(hue, dark)
  if (hue === undefined) return base
  const shift = (hashUnit(name) - 0.5) * 50
  const step = [-0.07, 0, 0.07][Math.floor(hashUnit(`${name}#l`) * 3)]
  const chroma = 0.85 + 0.3 * hashUnit(`${name}#c`)
  return { l: clamp(base.l + step, 0.4, 0.92), c: base.c * chroma, h: hue + shift }
}

export function projectColor(name: string, hue: number | undefined, dark: boolean, alpha = 1): string {
  return oklch(projectTone(name, hue, dark), alpha)
}

/**
 * Freshness scale for "last touched": the category color when touched today,
 * fading to a muted gray by 30 days. null (never touched) is fully gray.
 */
export function freshnessColor(days: number | null, hue: number | undefined, dark: boolean): string {
  const base = categoryTone(hue, dark)
  const t = days === null ? 1 : clamp(days / 30, 0, 1)
  const grayL = dark ? MUTED_GRAY_L.dark : MUTED_GRAY_L.light
  return oklch({ l: lerp(base.l, grayL, t), c: lerp(base.c, 0, t), h: base.h })
}

/**
 * Brand color of a harness (its icon and chart line). Claude Code and Antigravity use fixed brand
 * oklch values (converted from their brand hex). OpenCode's brand is black, so it follows the theme:
 * dark ink on light, light ink on dark. "me" and "other" are neutral.
 */
export function harnessColor(id: HarnessId, dark: boolean): string {
  switch (id) {
    case "claude-code":
      return "oklch(0.672 0.131 38.8)"
    case "antigravity":
      return "oklch(0.630 0.180 260.0)"
    case "opencode":
      return dark ? "oklch(0.985 0 0)" : "oklch(0.205 0 0)"
    default:
      return neutralColor(dark)
  }
}

/** Trend badge and footer color: green-ish for up, red-ish for down, neutral for no change. */
export function trendColor(direction: -1 | 0 | 1, dark: boolean): string {
  if (direction > 0) return dark ? "oklch(0.8 0.15 150)" : "oklch(0.5 0.14 150)"
  if (direction < 0) return dark ? "oklch(0.75 0.17 25)" : "oklch(0.55 0.2 25)"
  return neutralColor(dark)
}

/**
 * Lock mark color: read-only is a muted ink (undefined, so the muted class applies), no-ai is red-ish,
 * because that mode also keeps agents from reading the path.
 */
export function lockColor(mode: "read-only" | "no-ai" | null, dark: boolean): string | undefined {
  if (mode !== "no-ai") return undefined
  return dark ? "oklch(0.72 0.17 25)" : "oklch(0.55 0.2 25)"
}

