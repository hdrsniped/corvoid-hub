import { useState } from "react"
import { ArchiveRestore, Download, FolderOpen, RotateCcw } from "lucide-react"
import { toast } from "sonner"

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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import {
  AUTO_BACKUP_LABEL,
  AUTO_BACKUP_MODES,
  adoptBackup,
  backupCreate,
  backupDate,
  backupDir,
  backupList,
  backupRestore,
  formatBytes,
  saveBackupSettings,
  type AutoBackup,
  type BackupEntry,
} from "@/core/backup"
import { cfg, reloadConfig } from "@/core/config"
import { baseNameOf, pickSavePath } from "@/core/dialog"
import { errorMessage } from "@/core/errors"
import { useLoad } from "@/core/hooks"
import { openFolder } from "@/core/shell"

const MODE_ITEMS = AUTO_BACKUP_MODES.map((mode) => ({ value: mode, label: AUTO_BACKUP_LABEL[mode] }))

/**
 * Backups tab of the Hub screen: one zip per backup (hub, vault, config and manifest). Back up now,
 * export through the save dialog, open the folder, and restore into a new folder (never in place).
 */
export function BackupsPanel() {
  const list = useLoad(backupList, [])
  const [busy, setBusy] = useState<"create" | "export" | null>(null)
  const [restoreTarget, setRestoreTarget] = useState<BackupEntry | null>(null)
  const [restoring, setRestoring] = useState(false)
  const [restored, setRestored] = useState<string | null>(null)
  const [adopting, setAdopting] = useState(false)
  const [auto, setAuto] = useState<AutoBackup>(cfg().autoBackup)
  const [keep, setKeep] = useState(String(cfg().keepBackups))
  const [savingSettings, setSavingSettings] = useState(false)

  async function create(dest?: string) {
    setBusy(dest ? "export" : "create")
    try {
      const created = await backupCreate(dest)
      toast.success(`Backup saved: ${created.path}`)
      list.reload()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  async function exportToFile() {
    try {
      const picked = await pickSavePath({
        title: "Export a backup",
        defaultPath: backupDir(),
        filters: [{ name: "Zip", extensions: ["zip"] }],
      })
      if (picked) await create(picked)
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  async function changeAuto(value: AutoBackup) {
    setAuto(value)
    setSavingSettings(true)
    try {
      await saveBackupSettings(value, cfg().keepBackups)
      await reloadConfig()
      toast.success(`Automatic backups: ${AUTO_BACKUP_LABEL[value].toLowerCase()}`)
    } catch (e) {
      toast.error(errorMessage(e))
      setAuto(cfg().autoBackup)
    } finally {
      setSavingSettings(false)
    }
  }

  async function changeKeep(raw: string) {
    const count = Math.round(Number(raw))
    if (!Number.isFinite(count) || count < 1 || count > 100) {
      toast.error("Keep between 1 and 100 backups")
      setKeep(String(cfg().keepBackups))
      return
    }
    setKeep(String(count))
    if (count === cfg().keepBackups) return
    setSavingSettings(true)
    try {
      await saveBackupSettings(cfg().autoBackup, count)
      await reloadConfig()
      toast.success(`Keeping the newest ${count} backups`)
    } catch (e) {
      toast.error(errorMessage(e))
      setKeep(String(cfg().keepBackups))
    } finally {
      setSavingSettings(false)
    }
  }

  async function restore(entry: BackupEntry) {
    setRestoring(true)
    const id = toast.loading("Restoring...")
    try {
      const folder = await backupRestore(entry.path)
      toast.success(`Restored into ${folder}`, { id })
      setRestoreTarget(null)
      setRestored(folder)
      list.reload()
    } catch (e) {
      toast.error(errorMessage(e), { id })
    } finally {
      setRestoring(false)
    }
  }

  async function useAsMine(folder: string) {
    setAdopting(true)
    try {
      const next = await adoptBackup(folder)
      await reloadConfig()
      toast.success(`Hub is now ${next.hub}`)
      setRestored(null)
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setAdopting(false)
    }
  }

  async function reveal(path: string) {
    const result = await openFolder(path)
    if (result === "failed") toast.error("Could not open the folder")
  }

  const entries = list.data ?? []

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <p className="text-xs break-all text-muted-foreground">{backupDir()}</p>
        <p className="text-xs text-muted-foreground">
          One zip per backup: the hub, the vault (Projects, Log, Templates, _system and root notes), the config and a
          manifest. Build output, .git and backups are left out.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => create()} disabled={busy !== null}>
          <ArchiveRestore />
          {busy === "create" ? "Backing up..." : "Back up now"}
        </Button>
        <Button variant="outline" size="sm" onClick={exportToFile} disabled={busy !== null}>
          <Download />
          {busy === "export" ? "Exporting..." : "Export to file..."}
        </Button>
        <Button variant="outline" size="sm" onClick={() => reveal(backupDir())}>
          <FolderOpen />
          Open folder
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-4 rounded-lg border border-dashed p-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="backup-auto" className="text-xs">
            Automatic backups
          </Label>
          <Select value={auto} onValueChange={(value) => value && changeAuto(value as AutoBackup)} items={MODE_ITEMS}>
            <SelectTrigger id="backup-auto" size="sm" className="w-32" aria-label="Automatic backups">
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
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="backup-keep" className="text-xs">
            Keep
          </Label>
          <Input
            id="backup-keep"
            type="number"
            min={1}
            max={100}
            value={keep}
            disabled={savingSettings}
            onChange={(e) => setKeep(e.target.value)}
            onBlur={(e) => changeKeep(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") changeKeep(e.currentTarget.value)
            }}
            className="w-20"
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Off keeps backups manual. Only the newest backups beyond the keep count are deleted.
        </p>
      </div>

      {list.loading && list.data === undefined && <Skeleton className="h-40 rounded-xl" />}
      {!list.loading && entries.length === 0 && (
        <div className="rounded-xl border border-dashed p-8 text-center">
          <ArchiveRestore className="mx-auto mb-3 size-8 text-muted-foreground" />
          <p className="font-medium">No backups yet</p>
          <p className="text-sm text-muted-foreground">Back up now writes the first one into the folder above.</p>
        </div>
      )}

      <ul className="flex flex-col gap-2">
        {entries.map((entry) => (
          <li key={entry.path} className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
            <ArchiveRestore className="size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{baseNameOf(entry.path)}</p>
              <p className="text-xs text-muted-foreground">
                {backupDate(entry.created)} · {formatBytes(entry.size)}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => setRestoreTarget(entry)}>
              <RotateCcw />
              Restore
            </Button>
          </li>
        ))}
      </ul>

      <AlertDialog
        open={restoreTarget !== null}
        onOpenChange={(open) => !open && !restoring && setRestoreTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore this backup?</AlertDialogTitle>
            <AlertDialogDescription>
              {restoreTarget ? `${baseNameOf(restoreTarget.path)} is extracted into a new folder under the backup
              folder. ` : ""}
              Your current hub and vault are backed up first, and nothing is overwritten in place. Afterwards you can
              open the folder or use it as your hub and vault.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={restoring}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={restoring} onClick={() => restoreTarget && restore(restoreTarget)}>
              <RotateCcw />
              {restoring ? "Restoring..." : "Restore"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={restored !== null} onOpenChange={(open) => !open && setRestored(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Restored into a new folder</DialogTitle>
            <DialogDescription className="break-all">{restored}</DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Nothing changed yet. Using it as your hub and vault only rewrites the two paths in corvoid-hub.json, no
            files are moved.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => restored && reveal(restored)}>
              <FolderOpen />
              Open folder
            </Button>
            <Button onClick={() => restored && useAsMine(restored)} disabled={adopting}>
              {adopting ? "Applying..." : "Use as my hub and vault"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
