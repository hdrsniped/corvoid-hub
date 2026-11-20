import { invoke } from "@tauri-apps/api/core"

/**
 * Every path the app uses, resolved once by Rust at startup (`get_config` in src-tauri/src/lib.rs).
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
  vlog: string | null
  needleLog: string | null
  /** The config file that was read, or "defaults". */
  source: string
  /** True when both quick log scripts are configured. */
  quickLog: boolean
  hubExists: boolean
  vaultExists: boolean
}

let current: AppConfig | null = null

/** Reads the config once. main.tsx awaits this before the first render. */
export async function loadConfig(): Promise<AppConfig> {
  current ??= await invoke<AppConfig>("get_config")
  return current
}

/** The resolved paths. Throws only when something renders before `loadConfig` (a bug). */
export function cfg(): AppConfig {
  if (!current) throw new Error("the app config is not loaded yet")
  return current
}
