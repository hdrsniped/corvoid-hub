import { open, save } from "@tauri-apps/plugin-dialog"

/** Opens the native file or folder picker. Resolves with the chosen absolute path, or null if cancelled. */
export async function pickPath(kind: "file" | "folder"): Promise<string | null> {
  const picked = await open({ directory: kind === "folder", multiple: false })
  return typeof picked === "string" ? picked : null
}

/**
 * Opens the native save dialog and resolves with the chosen absolute path, or null if cancelled.
 * `filters` keeps the file list to the extension the app actually writes.
 */
export async function pickSavePath(options: {
  title?: string
  defaultPath?: string
  filters?: { name: string; extensions: string[] }[]
}): Promise<string | null> {
  const picked = await save(options)
  return typeof picked === "string" ? picked : null
}

/** Last segment of a Windows or POSIX path. */
export function baseNameOf(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path
}
