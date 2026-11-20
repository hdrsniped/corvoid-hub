import { createElement } from "react"
import { BookOpen, icons as LUCIDE, type LucideIcon } from "lucide-react"

import { cx } from "@/core/format"

// Every lucide icon, keyed by its PascalCase name. A glossary icon is kebab-case ("git-branch"),
// so the name is converted before the lookup; an unknown name falls back to BookOpen.
const ICONS = LUCIDE as unknown as Record<string, LucideIcon | undefined>

function iconFor(kebab: string): LucideIcon {
  const pascal = kebab
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1).toLowerCase())
    .join("")
  return ICONS[pascal] ?? BookOpen
}

/** The icon of a glossary term, from the kebab-case name in glossary.yaml. */
export function TermIcon({
  icon,
  className,
}: {
  /** Lucide name in kebab-case, e.g. "git-branch". */
  icon: string
  className?: string
}) {
  // createElement, not <Icon/>: the component comes from a lookup, so it is not a stable binding.
  return createElement(iconFor(icon), {
    "aria-hidden": true,
    className: cx("size-4 shrink-0 text-muted-foreground", className),
  })
}
