import { FolderX } from "lucide-react"

import { cfg } from "@/core/config"

/**
 * Friendly empty state for a screen whose root folder is not on disk. Nothing crashed: the
 * config just points at a folder that does not exist (yet).
 */
export function RootMissing({ root }: { root: "hub" | "vault" }) {
  const c = cfg()
  const path = root === "hub" ? c.hub : c.vault
  return (
    <div className="flex flex-col items-center justify-center gap-2 p-10 text-center">
      <FolderX className="mb-1 size-8 text-muted-foreground" />
      <p className="font-medium">No {root} folder at {path}</p>
      <p className="max-w-md text-sm text-muted-foreground">
        Set your {root} path in corvoid-hub.json
        {c.source === "defaults" ? " (no config file found, so the default is used)" : ` (currently ${c.source})`} and reopen the app.
      </p>
    </div>
  )
}
