import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener"

/**
 * Opens a folder in the system file manager.
 * `revealed` means the opener scope refused the folder and its parent was opened instead;
 * `failed` means neither call was allowed.
 */
export async function openFolder(path: string): Promise<"opened" | "revealed" | "failed"> {
  try {
    await openPath(path)
    return "opened"
  } catch {
    // The opener may not be allowed to open this exact folder (e.g. a scope change needs a restart).
  }
  try {
    await revealItemInDir(path)
    return "revealed"
  } catch {
    return "failed"
  }
}
