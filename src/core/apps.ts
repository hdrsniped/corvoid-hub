import YAML from "yaml"

import { cfg } from "./config"
import { readText, writeText } from "./fs"

/** Index of reusable apps and workflows. Each app stays its own repo at `path`. */
export function appsPath(): string {
  return `${cfg().hub}\\apps.yaml`
}

export interface AppEntry {
  name: string
  /** Folder of the app's own repo. Empty for a global command with no repo. */
  path: string
  /** One line: what the app is for. */
  what: string
  /** Command or script that starts it. */
  run: string
  /** Keys this app does not know about. Kept on save. */
  extra: Record<string, unknown>
}

export interface AppsFile {
  /** Comment lines at the top of the file, written back unchanged. */
  header: string
  apps: AppEntry[]
  eol: string
}

function field(value: unknown, at: string, key: string): string {
  if (value === undefined || value === null) return ""
  if (typeof value !== "string") throw new Error(`${at}: ${key} must be text`)
  return value.trim()
}

function toApp(raw: unknown, index: number): AppEntry {
  const at = `apps.yaml item ${index + 1}`
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`${at} is not a key/value mapping`)
  const { name, path, what, run, ...extra } = raw as Record<string, unknown>
  const appName = field(name, at, "name")
  if (!appName) throw new Error(`${at}: name is missing`)
  return {
    name: appName,
    path: field(path, at, "path"),
    what: field(what, at, "what"),
    run: field(run, at, "run"),
    extra,
  }
}

export function parseApps(text: string): AppsFile {
  const eol = text.includes("\r\n") ? "\r\n" : "\n"
  const lines = text.split(/\r?\n/)
  let i = 0
  while (i < lines.length && (lines[i].trim() === "" || lines[i].trimStart().startsWith("#"))) i++
  const header = lines.slice(0, i).join("\n").trimEnd()
  const body = lines.slice(i).join("\n")
  const parsed: unknown = body.trim() === "" ? [] : YAML.parse(body)
  if (!Array.isArray(parsed)) throw new Error("apps.yaml must be a list")
  return { header, apps: parsed.map(toApp), eol }
}

export function serializeApps(file: AppsFile): string {
  const list = file.apps.map((a) => ({ name: a.name, path: a.path, what: a.what, run: a.run, ...a.extra }))
  const yaml = YAML.stringify(list, { lineWidth: 0 }).replace(/\r?\n/g, file.eol)
  // No blank line between the header comments and the list: that is how apps.yaml is written by hand.
  const head = file.header ? file.header.replace(/\r?\n/g, file.eol) + file.eol : ""
  return head + yaml
}

export async function loadApps(): Promise<AppsFile> {
  return parseApps(await readText(appsPath()))
}

export async function saveApps(file: AppsFile): Promise<void> {
  await writeText(appsPath(), serializeApps(file))
}

/** Validation message for an app name, or "" when it is usable. `original` is the name being renamed. */
export function appNameProblem(name: string, existing: string[], original?: string): string {
  if (!name.trim()) return "The app needs a name"
  const same = (other: string) =>
    other.toLowerCase() === name.trim().toLowerCase() && other.toLowerCase() !== (original ?? "").toLowerCase()
  if (existing.some(same)) return "An app with this name already exists"
  return ""
}

/** The current list with `entry` added, or replacing the app called `original` when given. */
export function upsertApp(apps: AppEntry[], entry: AppEntry, original?: string): AppEntry[] {
  if (!original) return [...apps, entry]
  return apps.map((a) => (a.name === original ? entry : a))
}

/** The current list without the app called `name`. */
export function removeApp(apps: AppEntry[], name: string): AppEntry[] {
  return apps.filter((a) => a.name !== name)
}

/** A new entry from the dialog fields, keeping the extra keys of the app it replaces. */
export function appEntry(fields: Pick<AppEntry, "name" | "path" | "what" | "run">, original?: AppEntry): AppEntry {
  return {
    name: fields.name.trim(),
    path: fields.path.trim(),
    what: fields.what.trim(),
    run: fields.run.trim(),
    extra: original?.extra ?? {},
  }
}
