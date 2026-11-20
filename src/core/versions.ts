import { serializeBlocks, type Block } from "./sections"

/**
 * Layout of a project note body: `## Goal`, `## Next`, `## Done`, `## History` (`### v1`, `### v2`...), `## Notes`.
 * Other sections are kept in their original order after these. Unknown text is never dropped.
 */
export const SECTION_ORDER = ["Goal", "Next", "Done", "History", "Notes"]

export interface BodySection {
  title: string
  lines: string[]
}

export interface Body {
  /** Lines before the first `## ` heading. */
  pre: string[]
  sections: BodySection[]
}

const H2 = /^##\s+(.+?)\s*$/
const BULLET = /^[-*]\s+(?:\[[ xX]\]\s+)?(.*)$/

export function splitBody(text: string): Body {
  const pre: string[] = []
  const sections: BodySection[] = []
  let current: BodySection | null = null
  for (const line of text.split(/\r?\n/)) {
    const m = H2.exec(line)
    if (m) {
      current = { title: m[1], lines: [] }
      sections.push(current)
    } else if (current) {
      current.lines.push(line)
    } else {
      pre.push(line)
    }
  }
  return { pre, sections }
}

function sameTitle(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}

/** Lines of a `## title` section, or [] when it is missing. */
export function sectionLines(body: Body, title: string): string[] {
  return body.sections.find((s) => sameTitle(s.title, title))?.lines ?? []
}

/** Replaces the lines of a section. A missing section is added (the layout order puts it in place on join). */
export function setSectionLines(body: Body, title: string, lines: string[]): Body {
  const found = body.sections.some((s) => sameTitle(s.title, title))
  if (!found) return { ...body, sections: [...body.sections, { title, lines }] }
  return {
    ...body,
    sections: body.sections.map((s) => (sameTitle(s.title, title) ? { ...s, lines } : s)),
  }
}

function orderOf(title: string): number {
  const i = SECTION_ORDER.findIndex((t) => sameTitle(t, title))
  return i < 0 ? SECTION_ORDER.length : i
}

function trimBlank(lines: string[]): string[] {
  let end = lines.length
  while (end > 0 && lines[end - 1].trim() === "") end--
  let start = 0
  while (start < end && lines[start].trim() === "") start++
  return lines.slice(start, end)
}

/** Writes the body back in the standard section order. Section text is kept; blank lines between sections are normalized. */
export function joinBody(body: Body, eol: string): string {
  const ordered = body.sections
    .map((s, i) => ({ s, i }))
    .sort((a, b) => orderOf(a.s.title) - orderOf(b.s.title) || a.i - b.i)
    .map((x) => x.s)

  const out: string[] = trimBlank(body.pre)
  for (const s of ordered) {
    if (out.length > 0 && out[out.length - 1].trim() !== "") out.push("")
    out.push(`## ${s.title}`, ...trimBlank(s.lines))
  }
  return out.length === 0 ? "" : out.join(eol) + eol
}

/** Forces every bullet to a checkbox with the given state (`- [ ]` open, `- [x]` done). */
export function normalizeItems(blocks: Block[], checked: boolean): Block[] {
  return blocks.map((b) => (b.kind === "item" ? { ...b, hasBox: true, checked } : b))
}

/** Number of bullet items in a list. */
export function countItems(blocks: Block[]): number {
  return blocks.filter((b) => b.kind === "item").length
}

/** Done ÷ (done + open), as a whole percent. 0 when there are no tasks. */
export function progressOf(done: number, open: number): number {
  const total = done + open
  return total === 0 ? 0 : Math.round((done / total) * 100)
}

export interface HistoryVersion {
  /** Heading text, e.g. "v1". */
  label: string
  /** Finished task texts of that version. */
  items: string[]
}

/** Reads the `### vN` subsections of a History section. */
export function parseHistory(lines: string[]): HistoryVersion[] {
  const out: HistoryVersion[] = []
  let current: HistoryVersion | null = null
  for (const line of lines) {
    const h = /^###\s+(.+?)\s*$/.exec(line)
    if (h) {
      current = { label: h[1], items: [] }
      out.push(current)
      continue
    }
    const b = BULLET.exec(line.trim())
    if (b && current) current.items.push(b[1].trim())
  }
  return out
}

/**
 * Adds finished items under `### label` in a History section. Creates the heading at the end when it is missing,
 * and inserts into the existing subsection otherwise. Earlier versions are never removed.
 */
export function archiveLines(history: string[], label: string, itemLines: string[]): string[] {
  const heading = new RegExp(`^###\\s+${label}\\s*$`, "i")
  const at = history.findIndex((l) => heading.test(l.trimEnd()))
  if (at < 0) {
    const kept = trimBlank(history)
    return [...kept, ...(kept.length > 0 ? [""] : []), `### ${label}`, ...itemLines]
  }
  let end = at + 1
  while (end < history.length && !/^#{2,3}\s/.test(history[end])) end++
  let insertAt = end
  while (insertAt > at + 1 && history[insertAt - 1].trim() === "") insertAt--
  return [...history.slice(0, insertAt), ...itemLines, ...history.slice(insertAt)]
}

/** Lines for finished items in the note's bullet format (sub-lines kept). */
export function doneLines(done: Block[]): string[] {
  return serializeBlocks(normalizeItems(done, true))
}
