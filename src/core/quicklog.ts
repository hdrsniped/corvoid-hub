import type { LogKind } from "./links"
import type { Project } from "./types"

/** Task words: what quick log reads as a finished task when there is no model. */
const TASK_WORDS = /\b(finish(ed)?|done|complete(d)?|ship(ped)?|implement(ed)?|built|add(ed)?|launch(ed)?)\b/i

export function guessKind(sentence: string): LogKind {
  return TASK_WORDS.test(sentence) ? "task" : "update"
}

/** Letters and digits only, so "Prompt Lab" also matches "promptlab". */
function squash(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "")
}

/**
 * The project a sentence is about, guessed without a model: the longest project name (or the name
 * without spaces and dashes) that appears in the sentence, case-insensitive. Otherwise the most
 * recently updated active project, so the select always starts somewhere useful.
 */
export function guessProject(projects: Project[], sentence: string): string {
  const said = sentence.toLowerCase()
  const squashed = squash(sentence)
  let best: { name: string; length: number } | null = null
  for (const project of projects) {
    const name = project.name.trim()
    if (!name) continue
    const lower = name.toLowerCase()
    const compact = squash(name)
    // The name as typed, or the same name without spaces and dashes ("promptlab").
    const hit = said.includes(lower) || (compact !== lower && compact.length > 2 && squashed.includes(compact))
    if (!hit) continue
    const length = Math.max(name.length, compact.length)
    if (!best || length > best.length) best = { name: project.name, length }
  }
  if (best) return best.name

  const active = projects.filter((project) => project.status === "active")
  const pool = active.length > 0 ? active : projects
  return [...pool].sort((a, b) => (b.updated ?? "").localeCompare(a.updated ?? ""))[0]?.name ?? ""
}

/** Words that say little about which task was finished. */
const STOP_WORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "into", "was", "were", "has", "have",
  "had", "not", "but", "you", "are", "its", "all", "any", "now", "then", "out", "off", "over",
  "new", "some", "one", "two", "did", "does", "done", "just", "very", "well",
])

/** Lowercase words of three letters or more, without the stop words. */
function words(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(
    (word) => word.length >= 3 && !STOP_WORDS.has(word)
  )
}

/**
 * The open task the log text most likely finishes: the most shared words, ties going to the longer
 * task. "" when nothing overlaps.
 */
export function bestTaskMatch(tasks: string[], text: string): string {
  const said = new Set(words(text))
  let best = { task: "", score: 0, length: 0 }
  for (const task of tasks) {
    const score = words(task).filter((word) => said.has(word)).length
    if (score === 0) continue
    if (score > best.score || (score === best.score && task.length > best.length)) {
      best = { task, score, length: task.length }
    }
  }
  return best.task
}
