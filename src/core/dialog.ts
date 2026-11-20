import { open } from "@tauri-apps/plugin-dialog"

/** Opens the native file or folder picker. Resolves with the chosen absolute path, or null if cancelled. */
export async function pickPath(kind: "file" | "folder"): Promise<string | null> {
  const picked = await open({ directory: kind === "folder", multiple: false })
  return typeof picked === "string" ? picked : null
}

/** Last segment of a Windows or POSIX path. */
export function baseNameOf(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path
}
