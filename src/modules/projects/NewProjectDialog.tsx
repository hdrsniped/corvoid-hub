import { useState } from "react"
import { Plus } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { TermHint } from "@/components/term-hint"
import type { Category } from "@/core/categories"
import { errorMessage } from "@/core/errors"
import type { ProjectStatus } from "@/core/types"
import { createProject } from "@/core/vault"

import { CategoryPicker } from "./CategoryPicker"
import { STATUS_ITEMS } from "./status"

interface NewProjectDialogProps {
  existingNames: string[]
  categories: Category[]
  onCreated: () => void
  onCategoriesChanged: () => void
}

type LogMode = "auto" | "on-demand"

const LOG_ITEMS: { value: LogMode; label: string }[] = [
  { value: "auto", label: "Auto (log finished tasks)" },
  { value: "on-demand", label: "On demand (only when asked)" },
]

/** Validation message for a project name, or "" when it is usable. */
function nameProblem(name: string, existing: string[]): string {
  if (!name) return ""
  if (/[<>:"/\\|?*]/.test(name)) return 'Name cannot contain < > : " / \\ | ? *'
  if (existing.some((n) => n.toLowerCase() === name.toLowerCase())) return "A project with this name already exists"
  return ""
}

export function NewProjectDialog({ existingNames, categories, onCreated, onCategoriesChanged }: NewProjectDialogProps) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [status, setStatus] = useState<ProjectStatus>("idea")
  const [next, setNext] = useState("")
  const [picked, setPicked] = useState<string[]>([])
  const [log, setLog] = useState<LogMode>("on-demand")
  const [busy, setBusy] = useState(false)

  const trimmed = name.trim()
  const problem = nameProblem(trimmed, existingNames)

  async function create() {
    if (!trimmed || problem) return
    setBusy(true)
    try {
      await createProject(trimmed, { status, next: next.trim(), categories: picked, log })
      toast.success(`Created project ${trimmed}`)
      setOpen(false)
      setName("")
      setStatus("idea")
      setNext("")
      setPicked([])
      setLog("on-demand")
      onCreated()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        <Plus />
        New project
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>Creates Projects/&lt;name&gt;/&lt;name&gt;.md from the vault project template.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-project-name">Name</Label>
            <Input id="new-project-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="My project" autoFocus />
            {problem && <p className="text-xs text-destructive">{problem}</p>}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label>Status</Label>
              <Select value={status} onValueChange={(v) => v && setStatus(v as ProjectStatus)} items={STATUS_ITEMS}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_ITEMS.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label className="gap-1">
                Categories (first = main)
                <TermHint term="cv:category" />
              </Label>
              <CategoryPicker
                value={picked}
                onChange={setPicked}
                categories={categories}
                onCategoryAdded={onCategoriesChanged}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="gap-1">
              Log mode
              <TermHint term="cv:log-mode" />
            </Label>
            <Select value={log} onValueChange={(v) => v && setLog(v as LogMode)} items={LOG_ITEMS}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LOG_ITEMS.map((l) => (
                  <SelectItem key={l.value} value={l.value}>
                    {l.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-project-next">Next step (optional)</Label>
            <Input id="new-project-next" value={next} onChange={(e) => setNext(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={create} disabled={!trimmed || Boolean(problem) || busy}>
            {busy ? "Creating..." : "Create project"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
