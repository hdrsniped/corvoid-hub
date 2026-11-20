/**
 * Edits the lists inside a markdown note section (for example `## Done` and `## Next`).
 * Only bullet lines are rewritten. Indented sub-lines stay attached to their bullet,
 * and any other lines in the section are kept as they were.
 */

export type Block =
  | {
      kind: "item"
      text: string
      /** Only meaningful when hasBox is true. */
      checked: boolean
      /** False for a plain "- text" bullet, true for "- [ ] text" or "- [x] text". */
      hasBox: boolean
      /** Indented lines that belong to this bullet (kept byte-for-byte). */
      extra: string[]
    }
  | { kind: "raw"; line: string }

const BULLET = /^[-*]\s+(?:\[([ xX])\]\s+)?(.*)$/
const INDENTED = /^\s+\S/
const ANY_SECTION = /^#{1,2}\s/

export function parseBlocks(lines: string[]): Block[] {
  const blocks: Block[] = []
  for (const line of lines) {
    const m = BULLET.exec(line)
    if (m) {
      const box = m[1]
      blocks.push({
        kind: "item",
        text: m[2].trim(),
        checked: box !== undefined && box.toLowerCase() === "x",
        hasBox: box !== undefined,
        extra: [],
      })
      continue
    }
    const last = blocks[blocks.length - 1]
    if (last && last.kind === "item" && INDENTED.test(line)) {
      last.extra.push(line)
      continue
    }
    blocks.push({ kind: "raw", line })
  }
  return blocks
}

function bulletLine(b: Extract<Block, { kind: "item" }>): string {
  const box = b.hasBox ? `[${b.checked ? "x" : " "}] ` : ""
  return `- ${box}${b.text}`
}

export function serializeBlocks(blocks: Block[]): string[] {
  const out: string[] = []
  for (const b of blocks) {
    if (b.kind === "raw") {
      out.push(b.line)
    } else {
      out.push(bulletLine(b), ...b.extra)
    }
  }
  return out
}

function isBlank(b: Block): boolean {
  return b.kind === "raw" && b.line.trim() === ""
}

/** Returns a copy of `blocks` with a new bullet appended after the last non-blank line. */
export function addItem(blocks: Block[], text: string, hasBox: boolean, checked = false): Block[] {
  const item: Block = { kind: "item", text, checked, hasBox, extra: [] }
  let idx = blocks.length
  while (idx > 0 && isBlank(blocks[idx - 1])) idx--
  return [...blocks.slice(0, idx), item, ...blocks.slice(idx)]
}

function findSection(lines: string[], title: string): { start: number; end: number } | null {
  const heading = new RegExp(`^##\\s+${title}\\s*$`, "i")
  const at = lines.findIndex((l) => heading.test(l.trimEnd()))
  if (at < 0) return null
  let end = at + 1
  while (end < lines.length && !ANY_SECTION.test(lines[end])) end++
  return { start: at + 1, end }
}

/** Reads the bullets of a `## title` section. Returns [] when the section is missing. */
export function readSection(body: string, title: string): Block[] {
  const lines = body.split(/\r?\n/)
  const range = findSection(lines, title)
  return range ? parseBlocks(lines.slice(range.start, range.end)) : []
}

/**
 * Replaces the body of a `## title` section with `blocks`.
 * The section is appended at the end of the note when it does not exist yet.
 */
export function writeSection(body: string, title: string, blocks: Block[], eol: string): string {
  const lines = body.split(/\r?\n/)
  const content = serializeBlocks(blocks)
  const range = findSection(lines, title)
  if (!range) {
    const base = body.replace(/\s*$/, "")
    const tail = [`## ${title}`, ...content]
    return (base ? base + eol + eol : "") + tail.join(eol) + eol
  }
  return [...lines.slice(0, range.start), ...content, ...lines.slice(range.end)].join(eol)
}
