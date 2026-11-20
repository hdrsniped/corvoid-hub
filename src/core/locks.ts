import { useEffect } from "react"
import { toast } from "sonner"
import YAML from "yaml"

import { cfg } from "./config"
import { errorMessage } from "./errors"
import { applyLocks, pathExists, readText, writeText } from "./fs"
import { useLoad } from "./hooks"

/**
 * `locks.yaml`: folders the app and every agent must treat carefully.
 * read-only = files marked read-only on disk; no-ai = read-only plus "don't read or edit".
 * Enforcement lives in `bin/apply-locks.ps1`, never in this file.
 */
export function locksPath(): string {
  return `${cfg().hub}\\locks.yaml`
}

export const LOCK_MODES = ["read-only", "no-ai"] as const
export type LockMode = (typeof LOCK_MODES)[number]

export const LOCK_LABEL: Record<LockMode, string> = {
  "read-only": "Read-only",
  "no-ai": "No AI",
}

export interface LockEntry {
  /** Absolute path of the locked file or folder. */
  path: string
  mode: LockMode
  /** Keys this app does not know about. Kept on save. */
  extra: Record<string, unknown>
}

export interface LocksFile {
  /** Comment lines at the top of the file, written back unchanged. */
  header: string
  locks: LockEntry[]
  eol: string
}

function toLock(raw: unknown, index: number): LockEntry {
  const at = `locks.yaml item ${index + 1}`
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`${at} is not a key/value mapping`)
  const { path, mode, ...extra } = raw as Record<string, unknown>
  const p = typeof path === "string" ? path.trim() : ""
  if (!p) throw new Error(`${at}: path is missing`)
  if (mode !== "read-only" && mode !== "no-ai") throw new Error(`${at}: mode must be read-only or no-ai`)
  return { path: p, mode, extra }
}

export function parseLocks(text: string): LocksFile {
  const eol = text.includes("\r\n") ? "\r\n" : "\n"
  const lines = text.split(/\r?\n/)
  let i = 0
  while (i < lines.length && (lines[i].trim() === "" || lines[i].trimStart().startsWith("#"))) i++
  const header = lines.slice(0, i).join("\n").trimEnd()
  const body = lines.slice(i).join("\n")
  const parsed: unknown = body.trim() === "" ? [] : YAML.parse(body)
  if (parsed === null || parsed === undefined) return { header, locks: [], eol }
  if (!Array.isArray(parsed)) throw new Error("locks.yaml must be a list")
  return { header, locks: parsed.map(toLock), eol }
}

export function serializeLocks(file: LocksFile): string {
  const head = file.header ? file.header.replace(/\r?\n/g, file.eol) + file.eol : ""
  // No locks: keep the file as just the header comments (that is how it is written by hand).
  if (file.locks.length === 0) return head
  const list = file.locks.map((l) => ({ path: l.path, mode: l.mode, ...l.extra }))
  const yaml = YAML.stringify(list, { lineWidth: 0 }).replace(/\r?\n/g, file.eol)
  return head + file.eol + yaml
}

export async function loadLocks(): Promise<LocksFile> {
  // No locks.yaml yet means no locks.
  if (!(await pathExists(locksPath()))) return parseLocks("")
  return parseLocks(await readText(locksPath()))
}

export async function saveLocks(file: LocksFile): Promise<void> {
  await writeText(locksPath(), serializeLocks(file))
}

/** Lowercase, backslashes, no verbatim prefix and no trailing slash. For comparing Windows paths. */
export function normPath(path: string): string {
  return path
    .trim()
    .replace(/^\\\\\?\\/, "")
    .split("/")
    .join("\\")
    .replace(/\\+$/, "")
    .toLowerCase()
}

/** True when `path` is `parent` itself or inside it. */
export function isSameOrInside(path: string, parent: string): boolean {
  const p = normPath(path)
  const q = normPath(parent)
  if (!p || !q) return false
  return p === q || p.startsWith(`${q}\\`)
}

/** The lock that covers `path` (itself or the nearest locked parent), if any. Deeper paths win. */
export function lockAt(path: string, locks: LockEntry[]): LockEntry | undefined {
  let best: LockEntry | undefined
  for (const lock of locks) {
    if (!isSameOrInside(path, lock.path)) continue
    if (!best || normPath(lock.path).length > normPath(best.path).length) best = lock
  }
  return best
}

/** True when the path or any parent folder is locked. */
export function isLocked(path: string, locks: LockEntry[]): boolean {
  return lockAt(path, locks) !== undefined
}

/** The first lock covering any of `paths`, in the order given. */
export function lockOf(paths: (string | undefined)[], locks: LockEntry[]): LockEntry | undefined {
  for (const p of paths) {
    if (!p) continue
    const hit = lockAt(p, locks)
    if (hit) return hit
  }
  return undefined
}

/** The list with `path` set to `mode`, or without it when `mode` is null. Sorted by path. */
export function withLock(file: LocksFile, path: string, mode: LockMode | null): LocksFile {
  const target = path.trim()
  const original = file.locks.find((l) => normPath(l.path) === normPath(target))
  const rest = file.locks.filter((l) => normPath(l.path) !== normPath(target))
  if (!target || mode === null) return { ...file, locks: rest }
  const entry: LockEntry = { path: target, mode, extra: original?.extra ?? {} }
  const locks = [...rest, entry].sort((a, b) => a.path.toLowerCase().localeCompare(b.path.toLowerCase()))
  return { ...file, locks }
}

/** Saves the new mode for `path`, then enforces the whole file with apply-locks.ps1. */
export async function setLock(path: string, mode: LockMode | null): Promise<LocksFile> {
  const file = await loadLocks()
  const next = withLock(file, path, mode)
  // Unlocking a path that is not listed (or setting the mode it already has) is a no-op.
  if (serializeLocks(next) === serializeLocks(file)) return file
  await saveLocks(next)
  try {
    await applyLocks()
  } catch (e) {
    throw new Error(`locks.yaml is saved, but apply-locks.ps1 failed: ${errorMessage(e)}`, { cause: e })
  }
  return next
}

/**
 * Refuses to write anything under a read-only or no-ai path.
 * Called by the skill and project savers, so the guard holds however the save is started.
 */
export async function assertUnlocked(path: string): Promise<void> {
  const file = await loadLocks().catch(() => null)
  if (file && lockAt(path, file.locks)) throw new Error("Locked read-only, unlock it first.")
}

/** Mounted useLocks() reloads, notified together after every lock save. */
const listeners = new Set<() => void>()

function notifyChanged() {
  for (const reload of listeners) reload()
}

/**
 * locks.yaml for a screen or a sheet: the list, plus `set(path, mode)` which saves, runs
 * apply-locks.ps1, shows a toast and reloads. `onChanged` runs after a successful change so the
 * caller can refresh its own data.
 */
export function useLocks(onChanged?: () => void) {
  const loaded = useLoad(loadLocks, [])

  // Every mounted useLocks() reloads after a save, so a change in a sheet also updates the cards.
  useEffect(() => {
    listeners.add(loaded.reload)
    return () => {
      listeners.delete(loaded.reload)
    }
  }, [loaded.reload])

  const locks = loaded.data?.locks ?? []

  async function set(path: string, mode: LockMode | null): Promise<boolean> {
    try {
      await setLock(path, mode)
      toast.success(mode ? `${path} is now ${LOCK_LABEL[mode].toLowerCase()}` : `Unlocked ${path}`)
      notifyChanged()
      onChanged?.()
      return true
    } catch (e) {
      toast.error(errorMessage(e))
      return false
    }
  }

  return { locks, loading: loaded.loading, error: loaded.error, reload: loaded.reload, set }
}
