import { useState, type ReactNode } from "react"
import { ArrowRightLeft, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { HarnessGlyph } from "@/components/harness-icon"
import { HubMark } from "@/components/hub-mark"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
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
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cfg } from "@/core/config"
import { errorMessage } from "@/core/errors"
import { runHubSync, skillRemove, skillRoots, skillTransfer, type SkillTarget } from "@/core/fs"
import { useLoad } from "@/core/hooks"
import { slugify } from "@/core/slug"
import { SOURCE_LABEL, type SkillEntry, type SkillSource } from "@/core/skills"

/** One place the app can copy a skill to: the hub, or one harness folder. */
interface Slot {
  source: SkillSource
  target: SkillTarget
  label: string
}

const SLOTS: Slot[] = [
  { source: "hub", target: "hub", label: "Hub" },
  { source: "claude-code", target: "claude", label: "Claude Code" },
  { source: "antigravity", target: "gemini", label: "Antigravity" },
]

/** The skill key a skill has after it lands in `source`, e.g. "hub:my-skill". */
function keyIn(source: SkillSource, folder: string): string {
  return `${source}:${folder}`
}

function SlotGlyph({ source, className }: { source: SkillSource; className?: string }) {
  if (source === "hub") return <HubMark className={className ?? "size-3.5"} />
  return <HarnessGlyph id={source} className={className} />
}

interface SkillActionsProps {
  skill: SkillEntry
  /** Called after a transfer or a removal, so the list reloads. */
  onChanged: () => void
  /** Called with the skill's new key after a transfer. */
  onMoved: (key: string) => void
  /** Called after a removal, so the sheet can close. */
  onRemoved: () => void
}

/**
 * "Move to" and "Remove" for one skill. Moving means copy + trash the original; removing always
 * goes to `<hub>\backups\removed-skills`. A hub change is followed by hub-sync, so harness copies
 * (and their links) match the hub again.
 */
export function SkillActions({ skill, onChanged, onMoved, onRemoved }: SkillActionsProps) {
  const roots = useLoad(skillRoots, [])
  const [target, setTarget] = useState<Slot | null>(null)
  const [removeOpen, setRemoveOpen] = useState(false)

  const otherSlots = SLOTS.filter((s) => s.source !== skill.source)
  const origin = SLOTS.find((s) => s.source === skill.source)
  // A hub skill that harness folders only see as a link has one owner: the hub.
  const lockedTip = skill.linked ? "Managed by the hub: change it in the hub folder." : ""

  function rootPath(slot: Slot): string {
    if (slot.target === "hub") return cfg().skills
    const root = slot.target === "claude" ? roots.data?.claude : roots.data?.gemini
    return root ?? ""
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed p-3">
      <p className="min-w-0 text-sm text-muted-foreground">
        {skill.source === "hub"
          ? "Shared from the hub. Harness copies follow the hub on sync."
          : `Local to ${SOURCE_LABEL[skill.source]}. Move it to the hub to share it with every harness.`}
      </p>
      <TooltipProvider>
        <div className="flex items-center gap-2">
          <Hinted disabled={Boolean(lockedTip)} tip={lockedTip}>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button variant="outline" size="sm" disabled={Boolean(lockedTip)} />}
              >
                <ArrowRightLeft />
                Move to
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Move or copy into</DropdownMenuLabel>
                {otherSlots.map((slot) => (
                  <DropdownMenuItem key={slot.source} onClick={() => setTarget(slot)}>
                    <SlotGlyph source={slot.source} />
                    {slot.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </Hinted>
          <Hinted disabled={Boolean(lockedTip)} tip={lockedTip}>
            <Button
              variant="outline"
              size="sm"
              className="text-destructive"
              disabled={Boolean(lockedTip)}
              onClick={() => setRemoveOpen(true)}
            >
              <Trash2 />
              Remove
            </Button>
          </Hinted>
        </div>
      </TooltipProvider>

      {target && (
        <TransferDialog
          skill={skill}
          slot={target}
          rootPath={rootPath(target)}
          onOpenChange={(open) => {
            if (!open) setTarget(null)
          }}
          onDone={(key) => {
            setTarget(null)
            onChanged()
            onMoved(key)
          }}
        />
      )}

      <AlertDialog open={removeOpen} onOpenChange={setRemoveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {skill.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Moves {skill.name} to backups\removed-skills. Harness copies update on sync.
              {origin ? ` This is the ${origin.label} copy.` : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <RemoveConfirm
              skill={skill}
              onDone={() => {
                setRemoveOpen(false)
                onChanged()
                onRemoved()
              }}
            />
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/** Wraps a disabled control so its tooltip still shows on hover. */
function Hinted({
  disabled,
  tip,
  children,
}: {
  disabled: boolean
  tip: string
  children: ReactNode
}) {
  if (!disabled) return <>{children}</>
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex" />}>{children}</TooltipTrigger>
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  )
}

function TransferDialog({
  skill,
  slot,
  rootPath,
  onOpenChange,
  onDone,
}: {
  skill: SkillEntry
  slot: Slot
  rootPath: string
  onOpenChange: (open: boolean) => void
  onDone: (key: string) => void
}) {
  const [name, setName] = useState(() => slugify(skill.folder))
  const [keep, setKeep] = useState(false)
  const [busy, setBusy] = useState(false)
  const slug = slugify(name)

  async function transfer() {
    if (!slug) return
    setBusy(true)
    try {
      const path = await skillTransfer({
        srcPath: skill.dir,
        target: slot.target,
        name: slug,
        keepOriginal: keep,
      })
      // Hub changes are followed by hub-sync, so the new folder list already reflects the links.
      if (skill.source === "hub" || slot.target === "hub") await syncHub()
      toast.success(
        keep
          ? `Copied to ${slot.label}.`
          : `Moved to ${slot.label}. The original is in the removed-skills backup.`
      )
      onOpenChange(false)
      onDone(keyIn(slot.source, slug))
      // The folder name can change; the path is worth a look then.
      if (slug !== skill.folder) toast.message(`New folder: ${path}`)
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {keep ? "Copy" : "Move"} {skill.name} to {slot.label}
          </DialogTitle>
          <DialogDescription>
            {keep
              ? `The folder is copied into ${slot.label} and the original stays where it is.`
              : `The folder is copied into ${slot.label}, then the original moves to backups\\removed-skills.`}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label>Name in {slot.label}</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => setName(slugify(name))} />
          {rootPath && (
            <p className="font-mono text-xs break-all text-muted-foreground">
              {rootPath}\{slug || "<name>"}
            </p>
          )}
        </div>
        <label className="flex items-start gap-3 rounded-lg border p-3">
          <Switch checked={keep} onCheckedChange={setKeep} className="mt-0.5" />
          <span className="flex flex-col gap-0.5">
            <span className="text-sm font-medium">Keep a copy here</span>
            <span className="text-xs text-muted-foreground">
              Off means move: the original goes to the removed-skills backup, nothing is deleted.
            </span>
          </span>
        </label>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button onClick={transfer} disabled={busy || !slug}>
            {busy ? "Working..." : keep ? "Copy" : "Move"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RemoveConfirm({ skill, onDone }: { skill: SkillEntry; onDone: () => void }) {
  const [busy, setBusy] = useState(false)

  async function remove() {
    setBusy(true)
    try {
      const backup = await skillRemove(skill.dir)
      if (skill.source === "hub") await syncHub()
      toast.success(`Removed. The backup is ${backup}.`)
      onDone()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AlertDialogAction
      className="bg-destructive text-white hover:bg-destructive/90"
      disabled={busy}
      onClick={remove}
    >
      <Trash2 />
      {busy ? "Removing..." : "Remove"}
    </AlertDialogAction>
  )
}

/** Runs hub-sync after a hub change; a missing or failing script is reported, the change stands. */
async function syncHub() {
  try {
    await runHubSync()
  } catch (e) {
    toast.error(`Saved, but the hub sync failed: ${errorMessage(e)}`)
  }
}
