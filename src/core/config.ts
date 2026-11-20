import { invoke } from "@tauri-apps/api/core"

/**
 * Every path the app uses, resolved by Rust (`get_config` in src-tauri/src/lib.rs).
 * Rust reads corvoid-hub.json (env CORVOID_HUB_CONFIG, else next to the executable, else
 * %USERPROFILE%\.corvoid-hub.json) and fills missing keys with defaults, so the app is not tied
 * to one machine. Derived paths (skills, inbox, packs, scripts) come from the hub folder.
 */
export interface AppConfig {
  hub: string
  vault: string
  /** The app's own log folder. */
  logDir: string
  skills: string
  inbox: string
  packs: string
  hubSync: string
  applyLocks: string
  /** `<vault>\Projects`. */
  projects: string
  /** `<vault>\Log`. */
  logs: string
  /** Claude Code skill folder (`claudeSkills`). */
  claudeSkills: string
  /** Antigravity skill folder (`antigravitySkills`). */
  antigravitySkills: string
  /** OpenCode config folder (`opencodeConfig`). */
  opencodeConfig: string
  /** Antigravity.exe, when the app is installed (`antigravityExe`). */
  antigravityExe: string | null
  /** Where backups are written and listed (`backupDir`, default `<hub>\backups\corvoid`). */
  backupDir: string
  /** "daily" | "weekly" | "off" (`autoBackup`, default daily). */
  autoBackup: "daily" | "weekly" | "off"
  /** How many backups are kept before the oldest are pruned (`keepBackups`, default 10). */
  keepBackups: number
  vlog: string | null
  needleLog: string | null
  /** The config file that was read, or "defaults". */
  source: string
  /** True when a config file was found. Setup runs while this is false. */
  configured: boolean
  /** True when both quick log scripts are configured. */
  quickLog: boolean
  hubExists: boolean
  vaultExists: boolean
}

let current: AppConfig | null = null

const listeners = new Set<() => void>()

/**
 * Reads the config once. main.tsx awaits this before the first render; `reloadConfig` calls it again
 * after setup, so the new paths apply without a restart.
 */
export async function loadConfig(): Promise<AppConfig> {
  current ??= await invoke<AppConfig>("get_config")
  return current
}

/** Reads the config from Rust again and tells every subscriber (screens remount from AppShell). */
export async function reloadConfig(): Promise<AppConfig> {
  current = await invoke<AppConfig>("get_config")
  for (const listener of listeners) listener()
  return current
}

/**
 * One read of the config without touching the loaded copy. Setup polls this to notice a config file
 * an AI agent just wrote; only a real change goes through `reloadConfig`.
 */
export function readConfig(): Promise<AppConfig> {
  return invoke<AppConfig>("get_config")
}

/** Runs `listener` after a reload. Returns the unsubscribe function. */
export function onConfigChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The resolved paths. Throws only when something renders before `loadConfig` (a bug). */
export function cfg(): AppConfig {
  if (!current) throw new Error("the app config is not loaded yet")
  return current
}
