import { useState } from "react"
import { ArchiveRestore, Plus, Puzzle, RefreshCw, Save, Settings2, Undo2, Play, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { PageToolbar } from "@/components/page-toolbar"
import { openSetup } from "@/components/setup-dialog"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { cfg } from "@/core/config"
import { errorMessage } from "@/core/errors"
import { cx } from "@/core/format"
import { runHubSync } from "@/core/fs"
import { useLoad } from "@/core/hooks"
import { slugify } from "@/core/slug"
import {
  createPack,
  deletePack,
  hubRulesPath,
  listPacks,
  loadPack,
  loadRules,
  saveRules,
  savePack,
} from "@/core/hub"

import { CategoriesPanel } from "./CategoriesPanel"
import { LocksPanel } from "./LocksPanel"
import { BackupsPanel } from "./BackupsPanel"
import { AddonsPanel } from "./AddonsPanel"

export function HubPage() {
  const [tab, setTab] = useState("rules")
  const [refreshKey, setRefreshKey] = useState(0)
  const [syncOpen, setSyncOpen] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncOutput, setSyncOutput] = useState("")
  const [syncFailed, setSyncFailed] = useState(false)

  async function syncNow() {
    setSyncOpen(true)
    setSyncing(true)
    setSyncFailed(false)
    setSyncOutput("Running hub-sync.ps1...")
    try {
      setSyncOutput((await runHubSync()) || "Sync finished with no output.")
    } catch (e) {
      setSyncFailed(true)
      setSyncOutput(errorMessage(e))
      toast.error("Hub sync failed")
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageToolbar>
        <Button variant="outline" size="sm" onClick={() => setRefreshKey((k) => k + 1)}>
          <RefreshCw />
          Refresh
        </Button>
        <Button variant="outline" size="sm" onClick={() => openSetup()}>
          <Settings2 />
          Setup
        </Button>
        <Button size="sm" onClick={syncNow} disabled={syncing}>
          <Play />
          {syncing ? "Syncing..." : "Sync now"}
        </Button>
      </PageToolbar>

      <Tabs value={tab} onValueChange={(v) => setTab(String(v))}>
        <TabsList>
          <TabsTrigger value="rules">Rules</TabsTrigger>
          <TabsTrigger value="packs">Packs</TabsTrigger>
          <TabsTrigger value="categories">Categories</TabsTrigger>
          <TabsTrigger value="locks">Locks</TabsTrigger>
          <TabsTrigger value="backups">
            <ArchiveRestore />
            Backups
          </TabsTrigger>
          <TabsTrigger value="addons">
            <Puzzle />
            Add-ons
          </TabsTrigger>
        </TabsList>
        <TabsContent value="rules" className="pt-4">
          <RulesPanel key={`rules-${refreshKey}`} />
        </TabsContent>
        <TabsContent value="packs" className="pt-4">
          <PacksPanel key={`packs-${refreshKey}`} />
        </TabsContent>
        <TabsContent value="categories" className="pt-4">
          <CategoriesPanel key={`categories-${refreshKey}`} />
        </TabsContent>
        <TabsContent value="locks" className="pt-4">
          <LocksPanel key={`locks-${refreshKey}`} />
        </TabsContent>
        <TabsContent value="backups" className="pt-4">
          <BackupsPanel key={`backups-${refreshKey}`} />
        </TabsContent>
        <TabsContent value="addons" className="pt-4">
          <AddonsPanel key={`addons-${refreshKey}`} />
        </TabsContent>
      </Tabs>

      <Dialog open={syncOpen} onOpenChange={setSyncOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{syncFailed ? "Hub sync failed" : "Hub sync"}</DialogTitle>
            <DialogDescription>Output of hub-sync.ps1. It copies the rules and skills to each harness.</DialogDescription>
          </DialogHeader>
          <pre
            className={cx(
              "max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-lg bg-muted p-3 font-mono text-xs",
              syncFailed && "text-destructive"
            )}
          >
            {syncOutput}
          </pre>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function RulesPanel() {
  const { data, error, loading, reload } = useLoad(loadRules, [])
  const [edited, setEdited] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  if (loading && data === undefined) return <Skeleton className="h-96 rounded-xl" />
  if (error && data === undefined) {
    return <p className="text-sm text-destructive">Could not read the rules file. Press Refresh to try again.</p>
  }

  const value = edited ?? data ?? ""
  const dirty = edited !== null && edited !== data

  async function save() {
    setSaving(true)
    try {
      await saveRules(value)
      toast.success("Rules saved")
      setEdited(null)
      reload()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground break-all">{hubRulesPath()}</p>
      <Textarea
        value={value}
        onChange={(e) => setEdited(e.target.value)}
        className="min-h-[60vh] font-mono text-sm"
        spellCheck={false}
      />
      <div className="flex items-center justify-end gap-2">
        {dirty && <span className="mr-auto text-xs text-muted-foreground">Unsaved changes</span>}
        <Button variant="outline" disabled={!dirty} onClick={() => setEdited(null)}>
          <Undo2 />
          Revert
        </Button>
        <Button disabled={!dirty || saving} onClick={save}>
          <Save />
          {saving ? "Saving..." : "Save"}
        </Button>
      </div>
    </div>
  )
}

function PacksPanel() {
  const packs = useLoad(listPacks, [])
  const [selected, setSelected] = useState<string | null>(null)
  const [newName, setNewName] = useState("")
  const [creating, setCreating] = useState(false)

  async function create() {
    const slug = slugify(newName)
    if (!slug) {
      toast.error("Enter a name for the pack")
      return
    }
    setCreating(true)
    try {
      await createPack(slug)
      toast.success(`Created pack ${slug}`)
      setNewName("")
      setSelected(slug)
      packs.reload()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
      <div className="flex flex-col gap-3">
        <p className="text-xs text-muted-foreground break-all">{cfg().packs}</p>
        {packs.loading && packs.data === undefined && <Skeleton className="h-40 rounded-xl" />}
        {packs.data?.length === 0 && <p className="text-sm text-muted-foreground">No packs yet. Create one below.</p>}
        <ul className="flex flex-col gap-1">
          {packs.data?.map((p) => (
            <li key={p.name}>
              <Button
                variant={selected === p.name ? "secondary" : "ghost"}
                className="w-full justify-start"
                onClick={() => setSelected(p.name)}
              >
                {p.name}.md
              </Button>
            </li>
          ))}
        </ul>
        <form
          className="flex flex-col gap-2 border-t pt-3"
          onSubmit={(e) => {
            e.preventDefault()
            create()
          }}
        >
          <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New pack name" />
          <p className="text-xs text-muted-foreground">Saved as {slugify(newName) || "name"}.md</p>
          <Button type="submit" variant="outline" disabled={creating || !newName.trim()}>
            <Plus />
            Create pack
          </Button>
        </form>
      </div>

      <div className="min-w-0">
        {selected ? (
          <PackEditor
            key={selected}
            name={selected}
            onSaved={packs.reload}
            onDeleted={() => {
              setSelected(null)
              packs.reload()
            }}
          />
        ) : (
          <div className="flex h-full min-h-60 items-center justify-center rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
            Select a pack to view or edit it.
          </div>
        )}
      </div>
    </div>
  )
}

function PackEditor({ name, onSaved, onDeleted }: { name: string; onSaved: () => void; onDeleted: () => void }) {
  const { data, error, loading, reload } = useLoad(() => loadPack(name), [name])
  const [edited, setEdited] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  if (loading && data === undefined) return <Skeleton className="h-96 rounded-xl" />
  if (error && data === undefined) {
    return <p className="text-sm text-destructive">Could not read pack {name}.</p>
  }

  const value = edited ?? data ?? ""
  const dirty = edited !== null && edited !== data

  async function save() {
    setSaving(true)
    try {
      await savePack(name, value)
      toast.success(`Saved ${name}.md`)
      setEdited(null)
      reload()
      onSaved()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    setDeleting(true)
    try {
      await deletePack(name)
      toast.success(`Deleted ${name}.md`)
      setConfirmDelete(false)
      onDeleted()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <>
      <div className="flex flex-col gap-3">
        <p className="text-xs text-muted-foreground break-all">{cfg().packs}\{name}.md</p>
        <Textarea
          value={value}
          onChange={(e) => setEdited(e.target.value)}
          className="min-h-[55vh] font-mono text-sm"
          spellCheck={false}
        />
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="destructive"
            className="mr-auto"
            onClick={() => setConfirmDelete(true)}
            disabled={saving || deleting}
          >
            <Trash2 />
            Delete
          </Button>
          {dirty && <span className="text-xs text-muted-foreground">Unsaved changes</span>}
          <Button variant="outline" disabled={!dirty} onClick={() => setEdited(null)}>
            <Undo2 />
            Revert
          </Button>
          <Button disabled={!dirty || saving} onClick={save}>
            <Save />
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>

      <Dialog open={confirmDelete} onOpenChange={(open) => !deleting && setConfirmDelete(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {name}.md?</DialogTitle>
            <DialogDescription>
              The file {cfg().packs}\{name}.md is removed from disk. The rules that reference it are not changed.
              This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={remove} disabled={deleting}>
              {deleting ? "Deleting..." : "Delete pack"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
