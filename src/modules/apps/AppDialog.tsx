import { useState } from "react"
import { FolderSearch } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { appEntry, appNameProblem, type AppEntry } from "@/core/apps"
import { pickPath } from "@/core/dialog"
import { errorMessage } from "@/core/errors"

interface AppDialogProps {
  /** The app being edited; null adds a new one. */
  app: AppEntry | null
  existingNames: string[]
  onClose: () => void
  onSave: (entry: AppEntry) => Promise<void>
}

/** Add or edit one entry of apps.yaml. */
export function AppDialog({ app, existingNames, onClose, onSave }: AppDialogProps) {
  const [name, setName] = useState(app?.name ?? "")
  const [path, setPath] = useState(app?.path ?? "")
  const [what, setWhat] = useState(app?.what ?? "")
  const [run, setRun] = useState(app?.run ?? "")
  const [busy, setBusy] = useState(false)

  const problem = appNameProblem(name, existingNames, app?.name)

  async function browse() {
    try {
      const picked = await pickPath("folder")
      if (picked) setPath(picked)
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  async function save() {
    if (problem) return
    setBusy(true)
    try {
      await onSave(appEntry({ name, path, what, run }, app ?? undefined))
    } catch (e) {
      toast.error(errorMessage(e))
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{app ? `Edit ${app.name}` : "New app"}</DialogTitle>
          <DialogDescription>
            Saved to apps.yaml. The app itself stays in its own folder; this is only the index entry.
          </DialogDescription>
        </DialogHeader>

        <form
          id="app-form"
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            save()
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="app-name">Name</Label>
            <Input
              id="app-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My app"
              autoFocus
            />
            {name.trim() && problem && <p className="text-xs text-destructive">{problem}</p>}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="app-path">Folder</Label>
            <div className="flex items-center gap-2">
              <Input
                id="app-path"
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder="C:\Dev\my-app"
                className="font-mono text-xs"
              />
              <Button type="button" variant="outline" onClick={browse}>
                <FolderSearch />
                Browse
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="app-what">What it does</Label>
            <Input
              id="app-what"
              value={what}
              onChange={(e) => setWhat(e.target.value)}
              placeholder="One line: what it is for"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="app-run">Run command</Label>
            <Input
              id="app-run"
              value={run}
              onChange={(e) => setRun(e.target.value)}
              placeholder="bun run dev"
              className="font-mono text-xs"
            />
            <p className="text-xs text-muted-foreground">A script path or a command on PATH. It is copied, never run.</p>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={Boolean(problem) || busy}>
              {busy ? "Saving..." : app ? "Save app" : "Add app"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
