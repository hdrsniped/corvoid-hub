import { categoriesFromField } from "./categories"
import { cfg } from "./config"
import { listDir, readNote, readText, writeNote, writeText } from "./fs"
import { isoDate } from "./format"
import { assertUnlocked } from "./locks"
import { parseNote, patchNote, stringifyNote, type Note } from "./markdown"
import { readSection, serializeBlocks, type Block } from "./sections"
import type { LogEntry, Project, ProjectStatus } from "./types"
import {
  archiveLines,
  countItems,
  doneLines,
  joinBody,
  normalizeItems,
  sectionLines,
  setSectionLines,
  splitBody,
} from "./versions"

/** Frontmatter value for a category list: a YAML list, or undefined (key left out) when empty. */
function categoryValue(categories: string[]): string[] | undefined {
  const list = categoriesFromField(categories)
  return list.length > 0 ? list : undefined
}

export const PROJECT_STATUSES: ProjectStatus[] = ["idea", "active", "blocked", "paused", "done"]

/** A project hub note together with its parsed markdown, so a save keeps unknown keys and the body. */
export interface ProjectRecord {
  project: Project
  note: Note
}

export interface ProjectProblem {
  folder: string
  message: string
}

export function projectNotePath(name: string): string {
  return `${cfg().projects}\\${name}\\${name}.md`
}

function asString(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined
  const s = String(value).trim()
  return s === "" ? undefined : s
}

/** Frontmatter `version`: a whole number from 1. Missing or bad values count as 1. */
function asVersion(value: unknown): number {
  const n = Number(value)
  return Number.isInteger(n) && n >= 1 ? n : 1
}

function normalizeStatus(value: unknown): ProjectStatus {
  const s = String(value ?? "").trim() as ProjectStatus
  return PROJECT_STATUSES.includes(s) ? s : "idea"
}

/** Reads every `Projects/<Name>/<Name>.md` whose frontmatter has `type: project`. */
export async function loadProjects(): Promise<{ projects: ProjectRecord[]; problems: ProjectProblem[] }> {
  const folders = (await listDir(cfg().projects)).filter((e) => e.is_dir)
  const results = await Promise.allSettled(
    folders.map(async (folder) => {
      const note = await readNote(projectNotePath(folder.name))
      if (note.data.type !== "project") return null
      const d = note.data
      const project: Project = {
        name: folder.name,
        notePath: projectNotePath(folder.name),
        status: normalizeStatus(d.status),
        harness: asString(d.harness),
        next: asString(d.next),
        updated: asString(d.updated),
        repo: asString(d.repo),
        categories: categoriesFromField(d.category),
        log: asString(d.log),
        version: asVersion(d.version),
        done: countItems(readSection(note.body, "Done")),
        open: countItems(readSection(note.body, "Next")),
      }
      return { project, note } satisfies ProjectRecord
    })
  )

  const projects: ProjectRecord[] = []
  const problems: ProjectProblem[] = []
  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      if (r.value) projects.push(r.value)
      return
    }
    // A folder without a hub note is normal (for example a scratch folder); only report real parse failures.
    const message = r.reason instanceof Error ? r.reason.message : String(r.reason)
    if (!/cannot find|no such file|not found|cannot read/i.test(message)) {
      problems.push({ folder: folders[i].name, message })
    }
  })
  return { projects, problems }
}

export interface ProjectChange {
  status: ProjectStatus
  next: string
  /** Category slugs in order (first = main). Empty = none. */
  categories: string[]
  /** Items of `## Done` (finished). Saved as `- [x]`. */
  doneItems: Block[]
  /** Items of `## Next` (open). Saved as `- [ ]`. */
  nextItems: Block[]
  /**
   * Start the next version: the Done items move to `## History` under `### v<current>`, Done is cleared
   * and `version` goes up by one.
   */
  startNextVersion?: boolean
}

/**
 * Saves the editable parts of a project note. Sections are written in the standard order and tasks are
 * normalized to checkboxes. Other frontmatter keys and other sections are kept.
 */
export async function saveProject(record: ProjectRecord, change: ProjectChange): Promise<void> {
  await assertUnlocked(projectNotePath(record.project.name))
  const eol = record.note.eol
  const current = record.project.version
  let body = splitBody(record.note.body)
  let done = normalizeItems(change.doneItems, true)
  let version = current

  if (change.startNextVersion) {
    body = setSectionLines(
      body,
      "History",
      archiveLines(sectionLines(body, "History"), `v${current}`, doneLines(done))
    )
    done = []
    version = current + 1
  }

  body = setSectionLines(body, "Next", serializeBlocks(normalizeItems(change.nextItems, false)))
  body = setSectionLines(body, "Done", serializeBlocks(done))

  const note = patchNote(
    { ...record.note, body: joinBody(body, eol) },
    {
      status: change.status,
      next: change.next,
      // undefined is left out when the note is written, so no categories removes the key.
      category: categoryValue(change.categories),
      version,
      updated: isoDate(),
    }
  )
  await writeNote(projectNotePath(record.project.name), note)
}

export interface NewProjectOptions {
  status: ProjectStatus
  next: string
  categories: string[]
  log: "auto" | "on-demand"
}

/** Creates `Projects/<name>/<name>.md` from Templates/Project.md. Refuses to overwrite an existing note. */
export async function createProject(name: string, options: NewProjectOptions): Promise<void> {
  const path = projectNotePath(name)
  const exists = await readText(path).then(
    () => true,
    () => false
  )
  if (exists) throw new Error(`a project named "${name}" already exists`)

  const template = parseNote(await readText(`${cfg().vault}\\Templates\\Project.md`))
  const note = patchNote(template, {
    type: "project",
    status: options.status,
    next: options.next,
    category: categoryValue(options.categories),
    log: options.log,
    version: 1,
    updated: isoDate(),
  })
  await writeText(path, stringifyNote(note))
}

export type LogDay = LogEntry

/** Reads `Log/YYYY-MM-DD.md` files. Each top-level bullet becomes one entry in `bullets`. */
export async function loadLogs(): Promise<LogDay[]> {
  const logDir = cfg().logs
  const files = (await listDir(logDir)).filter(
    (e) => !e.is_dir && /^\d{4}-\d{2}-\d{2}\.md$/.test(e.name)
  )
  const days = await Promise.allSettled(
    files.map(async (file) => {
      const path = `${logDir}\\${file.name}`
      const note = parseNote(await readText(path))
      const bullets = note.body
        .split(/\r?\n/)
        .filter((line) => /^-\s+\S/.test(line))
        .map((line) => line.replace(/^-\s+/, "").trim())
      return { date: file.name.slice(0, 10), path, bullets } satisfies LogDay
    })
  )
  return days
    .flatMap((r) => (r.status === "fulfilled" ? [r.value] : []))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
}
