/** Obsidian [[wikilink]] helpers. Used by the Activity and Graph screens. */

export interface WikiLink {
  /** Link target without the alias, e.g. "Projects/AI Hub/AI Hub". */
  target: string
  alias?: string
}

const WIKILINK = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g

export function wikiLinks(text: string): WikiLink[] {
  return [...text.matchAll(WIKILINK)].map((m) => ({
    target: m[1].trim(),
    alias: m[2]?.trim() || undefined,
  }))
}

/** "Projects/AI Hub/AI Hub.md" -> "AI Hub". Strips folders and a .md or .canvas extension. */
export function linkBaseName(target: string): string {
  const last = target.split("/").filter(Boolean).pop() ?? target
  return last.replace(/\.(md|canvas)$/i, "")
}

/** Project name a link points at, when it targets Projects/<Name>/... Otherwise null. */
export function linkedProject(target: string): string | null {
  const parts = target.split("/").filter(Boolean)
  if (parts[0] !== "Projects" || parts.length < 2) return null
  return parts[1]
}

/** `#task` = a finished task of the project's Next list; `#update` (or no tag) = anything else. */
export type LogKind = "task" | "update"

export interface LogBullet {
  /** Bullet text with wikilinks replaced by their alias, the trailing harness and the #task/#update tag removed. */
  text: string
  kind: LogKind
  /** Projects linked from this bullet, without duplicates. */
  projects: string[]
  /** Harness shown in trailing parentheses, e.g. "claude code". */
  harness?: string
}

/** Parses one log bullet such as `[[Projects/AI Hub/AI Hub|AI Hub]] — did a thing (claude code)`. */
export function parseLogBullet(raw: string): LogBullet {
  let rest = raw.trim()
  let harness: string | undefined
  const tail = /\s*\(([^()]+)\)\s*$/.exec(rest)
  if (tail) {
    harness = tail[1].trim()
    rest = rest.slice(0, tail.index).trim()
  }

  const kind: LogKind = /(^|\s)#task\b/i.test(rest) ? "task" : "update"
  rest = rest.replace(/(^|\s)#(task|update)\b/gi, " ").replace(/\s{2,}/g, " ").trim()

  const projects: string[] = []
  for (const link of wikiLinks(rest)) {
    const project = linkedProject(link.target)
    if (project && !projects.includes(project)) projects.push(project)
  }

  const text = rest
    .replace(WIKILINK_GLOBAL, (_m, target: string, alias: string | undefined) =>
      alias?.trim() || linkBaseName(target.trim())
    )
    .replace(/^—\s*/, "")
    .trim()

  return { text, kind, projects, harness }
}

const WIKILINK_GLOBAL = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g
