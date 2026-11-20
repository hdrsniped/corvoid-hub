import type { ProcessRun } from "./fs"
import type { LogKind } from "./links"

/** What needle-log suggests: the project it picked, the kind it read from the sentence, and the text. */
export interface QuickLogSuggestion {
  project: string
  kind: LogKind
  text: string
  /** Model confidence in [0, 1], or null when it reported none. */
  confidence: number | null
  /** False = a guess to check before logging (needle-log's exit 4 case). */
  sure: boolean
}

/** needle-log's task words, used to guess the kind when it could not name a project. */
const TASK_WORDS = /\b(finish(ed)?|done|complete(d)?|ship(ped)?|implement(ed)?|built|add(ed)?|launch(ed)?)\b/i

export function guessKind(sentence: string): LogKind {
  return TASK_WORDS.test(sentence) ? "task" : "update"
}

/**
 * Reads the JSON line needle-log prints. Returns null when it printed no suggestion
 * (exit 3: it could not tell which project the work belongs to).
 */
export function parseSuggestion(run: ProcessRun): QuickLogSuggestion | null {
  for (const line of run.stdout.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed.startsWith("{")) continue
    try {
      const raw = JSON.parse(trimmed) as Record<string, unknown>
      const project = typeof raw.project === "string" ? raw.project.trim() : ""
      if (!project) continue
      const confidence =
        typeof raw.confidence === "number" && Number.isFinite(raw.confidence) ? raw.confidence : null
      return {
        project,
        kind: raw.kind === "task" ? "task" : "update",
        text: typeof raw.text === "string" ? raw.text : "",
        confidence,
        sure: raw.sure === true,
      }
    } catch {
      // Not the JSON line (a warning line, or the trailing hint text).
    }
  }
  return null
}

/** needle-log's own explanation (its last stdout line), used when it brings no suggestion. */
export function runMessage(run: ProcessRun): string {
  const lines = run.stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("{"))
  return lines.length > 0 ? lines[lines.length - 1] : run.stderr.trim()
}
