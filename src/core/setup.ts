import { invoke } from "@tauri-apps/api/core"

/** One path the Setup dialog shows, with whether it is already on disk. */
export interface DetectPath {
  path: string
  exists: boolean
}

/** What setup starts from: the resolved paths, the Obsidian vaults, and where the config goes. */
export interface SetupDetect {
  hub: DetectPath
  vault: DetectPath
  claudeSkills: DetectPath
  antigravitySkills: DetectPath
  opencodeConfig: DetectPath
  antigravityExe: DetectPath
  obsidianVaults: string[]
  configPath: string
  configured: boolean
}

/** The fields the manual form sends. An empty string leaves the default. */
export interface SetupFields {
  hub: string
  vault: string
  claudeSkills: string
  antigravitySkills: string
  opencodeConfig: string
  antigravityExe: string
}

export interface SetupSaveResult {
  configPath: string
  hub: string
  vault: string
  /** Files and folders the starter copy created (nothing that already existed). */
  created: string[]
}

/** One harness the global rules were connected to. */
export interface WireResult {
  harness: string
  ok: boolean
  path: string
  message: string
}

/** The paths setup asks about, read-only. */
export function setupDetect(): Promise<SetupDetect> {
  return invoke<SetupDetect>("setup_detect")
}

/** Writes the config file and creates the hub and vault folders (plus missing starters). */
export function setupSave(fields: SetupFields, createStarters: boolean): Promise<SetupSaveResult> {
  return invoke<SetupSaveResult>("setup_save", { fields, createStarters })
}

/**
 * Connects the hub rules to each harness: an import line in CLAUDE.md, an instructions entry in
 * OpenCode's config, or a plugin folder for Antigravity. Backs up what it edits.
 */
export function setupWireRules(harnesses: string[]): Promise<WireResult[]> {
  return invoke<WireResult[]>("setup_wire_rules", { harnesses })
}

/** Where corvoid-hub.json is (or will be) written. */
export function configPath(): Promise<string> {
  return invoke<string>("config_path")
}
