import { useState } from "react"
import { FolderSearch, Lock, Plus } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { TermHint } from "@/components/term-hint"
import { pickPath } from "@/core/dialog"
import { errorMessage } from "@/core/errors"
import { locksPath, LOCK_LABEL, LOCK_MODES, useLocks, type LockMode } from "@/core/locks"

const MODE_ITEMS = LOCK_MODES.map((m) => ({ value: m, label: LOCK_LABEL[m] }))

/**
 * Locks tab of the Hub screen: every entry of locks.yaml with its mode, plus a folder picker to add
 * one. Each change is written to locks.yaml and enforced at once by bin/apply-locks.ps1.
 */
export function LocksPanel() {
  const { locks, loading, set } = useLocks()
  const [path, setPath] = useState("")
  const [mode, setMode] = useState<LockMode>("read-only")
  const [adding, setAdding] = useState(false)

  async function browse() {
    try {
      const picked = await pickPath("folder")
      if (picked) setPath(picked)
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  async function add() {
    const target = path.trim()
    if (!target) return
    setAdding(true)
    const ok = await set(target, mode)
    if (ok) setPath("")
    setAdding(false)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <p className="text-xs break-all text-muted-foreground">{locksPath()}</p>
        <p className="text-xs text-muted-foreground">
          Read-only marks every file in the folder read-only. No AI also keeps agents from reading it. Saved
          entries are enforced by bin/apply-locks.ps1.
        </p>
      </div>

      {loading && locks.length === 0 && <Skeleton className="h-40 rounded-xl" />}
      {!loading && locks.length === 0 && (
        <div className="rounded-xl border border-dashed p-8 text-center">
          <Lock className="mx-auto mb-3 size-8 text-muted-foreground" />
          <p className="font-medium">No locks yet</p>
          <p className="text-sm text-muted-foreground">Pick a folder below to protect it.</p>
        </div>
      )}

      <ul className="flex flex-col gap-2">
        {locks.map((lock) => (
          <li key={lock.path} className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
            <Lock className="size-4 shrink-0 text-muted-foreground" />
            <code className="min-w-0 flex-1 font-mono text-xs break-all">{lock.path}</code>
            <Select
              value={lock.mode}
              onValueChange={(value) => value && set(lock.path, value as LockMode)}
              items={MODE_ITEMS}
            >
              <SelectTrigger size="sm" className="w-32" aria-label={`Mode for ${lock.path}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MODE_ITEMS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={() => set(lock.path, null)}>
              Remove
            </Button>
          </li>
        ))}
      </ul>

      <form
        className="flex flex-col gap-3 rounded-lg border border-dashed p-3"
        onSubmit={(e) => {
          e.preventDefault()
          add()
        }}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="lock-path" className="gap-1">
            Add lock
            <TermHint term="cv:lock" />
          </Label>
          <div className="flex items-center gap-2">
            <Input
              id="lock-path"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="C:\Dev\some-folder"
              className="font-mono text-xs"
            />
            <Button type="button" variant="outline" onClick={browse}>
              <FolderSearch />
              Browse
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <Select value={mode} onValueChange={(value) => value && setMode(value as LockMode)} items={MODE_ITEMS}>
            <SelectTrigger className="w-32" aria-label="Mode for the new lock">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MODE_ITEMS.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="submit" variant="outline" disabled={!path.trim() || adding}>
            <Plus />
            {adding ? "Adding..." : "Add lock"}
          </Button>
        </div>
      </form>
    </div>
  )
}
