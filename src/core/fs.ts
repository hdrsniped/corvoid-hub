import { invoke } from "@tauri-apps/api/core"

import { parseNote, stringifyNote, type Note } from "./markdown"
import type { DirEntry } from "./types"

// Typed wrappers around the Rust commands in src-tauri/src/lib.rs.
// Each Rust command rejects paths outside the hub and vault roots.

export function listDir(path: string): Promise<DirEntry[]> {
  return invoke<DirEntry[]>("list_dir", { path })
}

/** A `list_dir` entry with the extra fields the skills screen needs. */
export interface ListedEntry extends DirEntry {
  /** True when the entry is itself a symbolic link (is_dir then refers to its target). */
  symlink: boolean
  size: number
}

/** Like listDir, with symlink and size info. */
export function listEntries(path: string): Promise<ListedEntry[]> {
  return invoke<ListedEntry[]>("list_dir", { path })
}

export interface SkillRootPaths {
  hub: string
  claude: string | null
  gemini: string | null
}

/** Hub, Claude Code and Antigravity skill folders, resolved from the user profile in Rust. */
export function skillRoots(): Promise<SkillRootPaths> {
  return invoke<SkillRootPaths>("skill_roots")
}

/**
 * True when the path exists on disk. Read-only and allowed for any path: the apps index points at
 * repos anywhere on disk, and the app only needs to know whether the folder is still there.
 */
export function pathExists(path: string): Promise<boolean> {
  return invoke<boolean>("path_exists", { path })
}

/** Canonical path of a folder or file (symlinks followed). Rejects paths outside the allowed roots. */
export function resolvePath(path: string): Promise<string> {
  return invoke<string>("resolve_path", { path })
}

/** The three skill folders the app can copy between. */
export type SkillTarget = "hub" | "claude" | "gemini"

/**
 * Copies a skill folder into the hub, Claude Code or Antigravity as `<name>`. With
 * `keepOriginal: false` the original goes to `<hub>\backups\removed-skills` instead of staying.
 * Resolves with the new folder path.
 */
export function skillTransfer(args: {
  srcPath: string
  target: SkillTarget
  name: string
  keepOriginal: boolean
}): Promise<string> {
  return invoke<string>("skill_transfer", {
    srcPath: args.srcPath,
    target: args.target,
    name: args.name,
    keepOriginal: args.keepOriginal,
  })
}

/**
 * Moves a skill folder to `<hub>\backups\removed-skills` (never a hard delete). Resolves with the
 * backup path. Links are refused: a harness link is the hub's copy.
 */
export function skillRemove(path: string): Promise<string> {
  return invoke<string>("skill_remove", { path })
}

export function readText(path: string): Promise<string> {
  return invoke<string>("read_text", { path })
}

/** Writes a file. Missing parent folders are created. */
export function writeText(path: string, content: string): Promise<void> {
  return invoke<void>("write_text", { path, content })
}

/** Deletes one file. Rust only allows files inside the hub's packs and inbox folders. */
export function deleteFile(path: string): Promise<void> {
  return invoke<void>("delete_file", { path })
}

/** Runs hub-sync.ps1 and resolves with its combined stdout and stderr. */
export function runHubSync(): Promise<string> {
  return invoke<string>("run_hub_sync")
}

/** Runs bin/apply-locks.ps1 (read-only bits and the Claude Code deny rules) and returns its output. */
export function applyLocks(): Promise<string> {
  return invoke<string>("apply_locks")
}

/** stdout, stderr and exit code of a script that reports its own result (quick log uses 0/3/4). */
export interface ProcessRun {
  stdout: string
  stderr: string
  code: number
}

/** Runs needle-log.ps1 with -DryRun: it suggests a project and never writes. */
export function quicklogSuggest(sentence: string): Promise<ProcessRun> {
  return invoke<ProcessRun>("quicklog_suggest", { sentence })
}

/** Logs one bullet with vlog.ps1 as harness "me". Resolves with vlog's own message. */
export function quicklogCommit(args: {
  project: string
  kind: "task" | "update"
  text: string
  /** Words of an open `## Next` task this finishes, or null. */
  task?: string | null
}): Promise<string> {
  return invoke<string>("quicklog_commit", {
    project: args.project,
    kind: args.kind,
    text: args.text,
    task: args.task ?? null,
  })
}

/** Shallow-clones a GitHub repo into inbox/<name>/ and writes INTAKE.md. Resolves with the new folder path. */
export function skillInstallGit(url: string, name: string): Promise<string> {
  return invoke<string>("skill_install_git", { url, name })
}

/** Copies a user-picked file or folder into inbox/<name>/ and writes INTAKE.md. Resolves with the new folder path. */
export function copyIntoInbox(srcPath: string, name: string): Promise<string> {
  return invoke<string>("copy_into_inbox", { srcPath, name })
}

/** Saves pasted text as inbox/<name>/SOURCE.md and writes INTAKE.md. Resolves with the new folder path. */
export function saveInboxText(name: string, text: string): Promise<string> {
  return invoke<string>("save_inbox_text", { name, text })
}

/** Reads a markdown note and splits it into frontmatter and body. */
export async function readNote(path: string): Promise<Note> {
  return parseNote(await readText(path))
}

/** Writes a note back, keeping unknown frontmatter keys and the body. */
export function writeNote(path: string, note: Note): Promise<void> {
  return writeText(path, stringifyNote(note))
}

/** Reads a file and resolves with null instead of throwing when it is missing or unreadable. */
export function tryReadText(path: string): Promise<string | null> {
  return readText(path).then(
    (text) => text,
    () => null
  )
}
