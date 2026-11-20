import { useEffect, useState, type ReactNode } from "react"
import {
  AppWindow,
  Copy,
  EllipsisVertical,
  FolderOpen,
  Pencil,
  Plus,
  RefreshCw,
  Terminal,
  Trash2,
  TriangleAlert,
} from "lucide-react"
import { toast } from "sonner"

import { HubMarkIcon } from "@/components/hub-mark"
import { LockBadge, LockControl } from "@/components/lock-control"
import { PageToolbar } from "@/components/page-toolbar"
import { TermHint } from "@/components/term-hint"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  appsPath,
  loadApps,
  removeApp,
  saveApps,
  upsertApp,
  type AppEntry,
  type AppsFile,
} from "@/core/apps"
import { copyText } from "@/core/clipboard"
import { errorMessage } from "@/core/errors"
import { cx } from "@/core/format"
import { pathExists } from "@/core/fs"
import { useLoad } from "@/core/hooks"
import { lockAt, useLocks, type LockEntry, type LockMode } from "@/core/locks"
import { useRoute } from "@/core/navigation"
import { openFolder } from "@/core/shell"

import { AppDialog } from "./AppDialog"

/** DOM id of a card, so the command palette can scroll one into view (#/apps?focus=<name>). */
function cardId(name: string): string {
  return `app-card:${name}`
}

interface AppsView {
  file: AppsFile
  /** Names of apps whose folder is empty or not on disk. */
  missing: Set<string>
}

/** apps.yaml, plus an existence check per folder. A rejected check counts as present (older builds). */
async function loadAppsView(): Promise<AppsView> {
  const file = await loadApps()
  const checks = await Promise.all(
    file.apps.map((app) =>
      app.path.trim()
        ? pathExists(app.path).catch(() => true)
        : Promise.resolve(false)
    )
  )
  return {
    file,
    missing: new Set(file.apps.filter((_, i) => !checks[i]).map((a) => a.name)),
  }
}

export function AppsPage() {
  const { data, error, loading, reload } = useLoad(loadAppsView, [])
  const { locks, set: setLock } = useLocks()
  const [editing, setEditing] = useState<{ app: AppEntry | null } | null>(null)
  const [removing, setRemoving] = useState<AppEntry | null>(null)
  const [busy, setBusy] = useState(false)

  const apps = data?.file.apps ?? []

  // The command palette opens a card with #/apps?focus=<name>: scroll it into view and ring it.
  const { params } = useRoute()
  const focus = params.get("focus")
  useEffect(() => {
    if (!focus) return
    document
      .getElementById(cardId(focus))
      ?.scrollIntoView({ block: "center", behavior: "smooth" })
  }, [focus, apps.length])

  async function save(entry: AppEntry) {
    if (!data) throw new Error("apps.yaml is not loaded yet")
    const original = editing?.app?.name
    await saveApps({
      ...data.file,
      apps: upsertApp(data.file.apps, entry, original),
    })
    toast.success(original ? `Saved ${entry.name}` : `Added ${entry.name}`)
    setEditing(null)
    reload()
  }

  async function remove(app: AppEntry) {
    if (!data) return
    setBusy(true)
    try {
      await saveApps({
        ...data.file,
        apps: removeApp(data.file.apps, app.name),
      })
      toast.success(`Removed ${app.name} from apps.yaml`)
      setRemoving(null)
      reload()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <TooltipProvider>
      <div className="flex flex-col gap-6 p-6">
        <PageToolbar>
          <span className="mr-auto flex items-center gap-1 text-xs text-muted-foreground">
            App index
            <TermHint term="cv:app" />
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={reload}
            disabled={loading}
          >
            <RefreshCw className={cx(loading && "animate-spin")} />
            Refresh
          </Button>
          <Button size="sm" onClick={() => setEditing({ app: null })}>
            <Plus />
            Add app
          </Button>
        </PageToolbar>

        {loading && !data && (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-32 rounded-xl" />
            ))}
          </div>
        )}

        {error && !data && (
          <p className="text-sm text-destructive">
            Could not read apps.yaml. Check {appsPath()}, then press Refresh.
          </p>
        )}

        {data && apps.length === 0 && (
          <div className="rounded-xl border border-dashed p-10 text-center">
            <AppWindow className="mx-auto mb-3 size-8 text-muted-foreground" />
            <p className="font-medium">No apps yet</p>
            <p className="text-sm text-muted-foreground">
              Add one and its entry is saved in apps.yaml.
            </p>
          </div>
        )}

        {apps.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {apps.map((app) => (
              <AppCard
                key={app.name}
                app={app}
                missing={data?.missing.has(app.name) ?? false}
                highlighted={focus === app.name}
                lock={app.path ? lockAt(app.path, locks) : undefined}
                onSetLock={(mode) => setLock(app.path, mode)}
                onEdit={() => setEditing({ app })}
                onRemove={() => setRemoving(app)}
              />
            ))}
          </div>
        )}

        {editing && (
          <AppDialog
            key={editing.app?.name ?? "new"}
            app={editing.app}
            existingNames={apps.map((a) => a.name)}
            onClose={() => setEditing(null)}
            onSave={save}
          />
        )}

        <Dialog
          open={removing !== null}
          onOpenChange={(open) => !open && !busy && setRemoving(null)}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Remove {removing?.name}?</DialogTitle>
              <DialogDescription>
                Only the entry in apps.yaml is removed. The folder at{" "}
                {removing?.path || "its path"} is left alone. This cannot be
                undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setRemoving(null)}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => removing && remove(removing)}
                disabled={busy}
              >
                {busy ? "Removing..." : "Remove app"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  )
}

interface AppCardProps {
  app: AppEntry
  missing: boolean
  /** Ringed for a moment after the command palette jumped to it. */
  highlighted: boolean
  /** The lock covering the app's folder, if any. */
  lock: LockEntry | undefined
  onSetLock: (mode: LockMode | null) => void
  onEdit: () => void
  onRemove: () => void
}

function AppCard({
  app,
  missing,
  highlighted,
  lock,
  onSetLock,
  onEdit,
  onRemove,
}: AppCardProps) {
  async function copyRun() {
    try {
      await copyText(app.run)
      toast.success("Copied the run command")
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  async function openItsFolder() {
    const result = await openFolder(app.path)
    if (result === "opened") return
    if (result === "revealed") {
      toast.info("Opened the parent folder")
      return
    }
    try {
      await copyText(app.path)
      toast.info("Could not open the folder; copied its path instead")
    } catch {
      toast.error("Could not open the folder or copy its path")
    }
  }

  return (
    <div
      id={cardId(app.name)}
      className={cx(
        "rounded-xl transition-shadow",
        highlighted && "ring-2 ring-ring/60"
      )}
    >
      <Card className="h-full gap-3">
        <CardHeader>
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="min-w-0 truncate">{app.name}</CardTitle>
            <div className="-mt-1 -mr-1 flex shrink-0 items-center gap-0.5">
              <IconAction
                label="Copy run command"
                disabled={!app.run}
                onClick={copyRun}
              >
                <Copy />
              </IconAction>
              <IconAction
                label="Open folder"
                disabled={!app.path}
                onClick={openItsFolder}
              >
                <FolderOpen />
              </IconAction>
              <LockControl
                path={app.path}
                lock={lock}
                onSet={onSetLock}
                disabled={!app.path}
              />
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Actions for ${app.name}`}
                    />
                  }
                >
                  <EllipsisVertical />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={onEdit}>
                    <Pencil />
                    Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem variant="destructive" onClick={onRemove}>
                    <Trash2 />
                    Remove
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
          <CardDescription className="line-clamp-1 min-h-5">
            {app.what || "No description"}
          </CardDescription>
        </CardHeader>
        <CardFooter className="flex-col items-stretch gap-2 text-xs text-muted-foreground">
          <div className="flex min-w-0 items-center gap-1.5">
            <FolderOpen className="size-3.5 shrink-0 opacity-60" />
            <Tooltip>
              <TooltipTrigger
                render={<span className="min-w-0 cursor-default truncate" />}
              >
                {app.path || "No folder"}
              </TooltipTrigger>
              <TooltipContent className="max-w-md break-all">
                {app.path || "No folder recorded"}
              </TooltipContent>
            </Tooltip>
            {missing && (
              <Badge
                variant="destructive"
                className="h-4 shrink-0 px-1.5 text-[10px]"
                title={
                  app.path
                    ? `The folder ${app.path} is not on disk`
                    : "No folder is recorded for this app"
                }
              >
                <TriangleAlert />
                Path missing
              </Badge>
            )}
          </div>
          <div className="flex min-w-0 items-center gap-1.5 font-mono">
            <Terminal className="size-3.5 shrink-0 opacity-60" />
            <span className="truncate">{app.run || "No run command"}</span>
          </div>
          {/* Hub-owned: the entry lives in apps.yaml, which the hub syncs and an agent can edit. */}
          <div className="flex items-center justify-end gap-1.5">
            <LockBadge lock={lock} />
            <HubMarkIcon />
          </div>
        </CardFooter>
      </Card>
    </div>
  )
}

/** Ghost icon button with its label in a tooltip. */
function IconAction({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            disabled={disabled}
            onClick={onClick}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
