import YAML from "yaml"

/**
 * A markdown note split into frontmatter and body.
 * `data` keeps every key it read (known or not), `body` is kept byte-for-byte,
 * so writing a note back does not drop anything the app does not understand.
 */
export interface Note {
  data: Record<string, unknown>
  body: string
  /** Line ending used by the file, so a write keeps the same style. */
  eol: string
}

// Opening "---" line, YAML up to a closing "---" line. Anchored to the start of the text.
const FRONTMATTER = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/

export function parseNote(text: string): Note {
  const eol = text.includes("\r\n") ? "\r\n" : "\n"
  const match = FRONTMATTER.exec(text)
  if (!match) {
    return { data: {}, body: text, eol }
  }

  const parsed: unknown = YAML.parse(match[1])
  if (parsed === null || parsed === undefined) {
    return { data: {}, body: text.slice(match[0].length), eol }
  }
  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    // Refuse rather than silently overwrite a frontmatter block we cannot represent as a mapping.
    throw new Error("frontmatter is not a key/value mapping; refusing to edit it")
  }

  return {
    data: parsed as Record<string, unknown>,
    body: text.slice(match[0].length),
    eol,
  }
}

export function stringifyNote(note: Note): string {
  if (Object.keys(note.data).length === 0) {
    return note.body
  }
  const yaml = YAML.stringify(note.data, { lineWidth: 0 }).replace(/\r?\n/g, note.eol)
  return `---${note.eol}${yaml}---${note.eol}${note.body}`
}

/** Returns a copy of the note with `patch` merged into its frontmatter. Other keys are untouched. */
export function patchNote(note: Note, patch: Record<string, unknown>): Note {
  return { ...note, data: { ...note.data, ...patch } }
}
