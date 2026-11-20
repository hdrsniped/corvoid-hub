import { invoke } from "@tauri-apps/api/core"
import { toast } from "sonner"

import { cfg } from "./config"
import { errorMessage } from "./errors"

// Typed wrappers around the backup commands in src-tauri/src/lib.rs.
// A backup is one zip: hub/, vault/, corvoid-hub.json and manifest.json.

/** When the app writes a backup on its own at start (config key `autoBackup`). */
export type AutoBackup = "daily" | "weekly" | "off"

export const AUTO_BACKUP_MODES: AutoBackup[] = ["daily", "weekly", "off"]

export const AUTO_BACKUP_LABEL: Record<AutoBackup, string> = {
  daily: "Daily",
  weekly: "Weekly",
  off: "Off",
}

export interface BackupEntry {
  path: string
  size: number
  /** Modified time, unix seconds. */
  created: number
}

export interface BackupCreated {
  path: string
  size: number
  files: number
}

/** The folder the app writes backups into (config key `backupDir`). */
export function backupDir(): string {
  return cfg().backupDir
}

/** Writes one backup now. Without `destPath` it lands in backupDir; the save dialog passes a file. */
export function backupCreate(destPath?: string | null): Promise<BackupCreated> {
  return invoke<BackupCreated>("backup_create", { destPath: destPath ?? null })
}

/** The backups in backupDir, newest first. */
export function backupList(): Promise<BackupEntry[]> {
  return invoke<BackupEntry[]>("backup_list")
}

/**
 * Restores a backup into a new folder under backupDir. Rust backs up the current state first and
 * never overwrites in place; resolves with the folder the zip was extracted into.
 */
export function backupRestore(path: string): Promise<string> {
  return invoke<string>("backup_restore", { path })
}

/** Saves autoBackup and keepBackups into corvoid-hub.json (call reloadConfig afterwards). */
export function saveBackupSettings(autoBackup: AutoBackup, keepBackups: number): Promise<void> {
  return invoke<void>("backup_settings", {
    settings: { autoBackup, keepBackups },
  })
}

/** Makes a restored folder the active hub and vault by changing the two config paths only. */
export function adoptBackup(folder: string): Promise<{ hub: string; vault: string }> {
  return invoke<{ hub: string; vault: string }>("backup_adopt", { folder })
}

/** A byte count as KB, MB or GB. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B"
  const units = ["B", "KB", "MB", "GB"]
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
}

/** "2026-11-20 10:15" in local time, from unix seconds. */
export function backupDate(seconds: number): string {
  if (!seconds) return "unknown date"
  const date = new Date(seconds * 1000)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** "Back up now" with the shared toasts, used by the Backups tab and Ctrl+K. */
export async function backupNow(): Promise<BackupCreated | null> {
  const id = toast.loading("Backing up...")
  try {
    const created = await backupCreate()
    toast.success(`Backup saved: ${created.path}`, { id })
    return created
  } catch (e) {
    toast.error(errorMessage(e), { id })
    return null
  }
}
