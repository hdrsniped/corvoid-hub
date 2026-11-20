import { siClaudecode, siOpencode, type SimpleIcon } from "simple-icons"

import antigravityLogo from "@/assets/antigravity.png"

import { HubMark } from "@/components/hub-mark"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { harnessColor, useDark } from "@/core/colors"
import { cx } from "@/core/format"
import { HARNESS_LABEL, harnessOf, type HarnessId } from "@/core/harness"

/** Brand glyphs from the simple-icons package. Antigravity has none there, so it gets its own mark. */
const BRAND: Partial<Record<HarnessId, SimpleIcon>> = {
  "claude-code": siClaudecode,
  opencode: siOpencode,
}

const GLYPH = "size-3.5 shrink-0"

/**
 * The bare brand glyph of a harness, in its brand color. `me` is the app mark, an unknown harness
 * gets a question mark. Used inside a tooltip (HarnessIcon) and in the transfer menu.
 */
export function HarnessGlyph({
  id,
  className,
}: {
  id: HarnessId
  className?: string
}) {
  const dark = useDark()
  const cls = cx(GLYPH, className)

  if (id === "me")
    return <HubMark className={cx(cls, "text-muted-foreground")} />

  const brand = BRAND[id]
  if (brand) {
    return (
      <svg
        viewBox="0 0 24 24"
        className={cls}
        style={{ color: harnessColor(id, dark) }}
        fill="currentColor"
        aria-hidden="true"
      >
        <path d={brand.path} />
      </svg>
    )
  }
  if (id === "antigravity") {
    // Antigravity's own app icon (from its installed app.asar), full color.
    return (
      <img src={antigravityLogo} alt="" className={cls} draggable={false} />
    )
  }
  return (
    <span
      aria-hidden="true"
      className={cx(
        cls,
        "inline-flex items-center justify-center rounded-full border border-muted-foreground/40 text-[9px] leading-none font-semibold text-muted-foreground"
      )}
    >
      ?
    </span>
  )
}

interface HarnessIconProps {
  /** Raw harness text from a log bullet or project note. Empty or unknown still renders a muted icon. */
  harness?: string
  /** Wrapper classes (spacing). */
  className?: string
  /** Overrides the glyph size, for a larger icon in a stat tile. */
  glyphClassName?: string
}

/**
 * A harness as a small icon with its name in a tooltip. Empty = dashed circle ("No harness yet"),
 * unknown text = muted question mark with the raw text. A harness is never shown as a text badge.
 */
export function HarnessIcon({
  harness,
  className,
  glyphClassName,
}: HarnessIconProps) {
  const id = harnessOf(harness)
  const raw = (harness ?? "").trim()
  const label =
    id === null ? "No harness yet" : id === "other" ? raw : HARNESS_LABEL[id]

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          render={
            <span
              role="img"
              aria-label={label}
              className={cx(
                "inline-flex size-5 shrink-0 items-center justify-center",
                className
              )}
            />
          }
        >
          {id === null ? (
            <span
              aria-hidden="true"
              className={cx(
                "size-3.5 shrink-0 rounded-full border border-dashed border-muted-foreground/60",
                glyphClassName
              )}
            />
          ) : (
            <HarnessGlyph id={id} className={glyphClassName} />
          )}
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
