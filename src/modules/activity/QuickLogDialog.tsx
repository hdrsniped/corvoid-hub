import { useMemo, useState, type ReactNode } from "react"
import { Loader2, PenLine, Sparkles, TriangleAlert } from "lucide-react"
import { toast } from "sonner"

import { HarnessGlyph } from "@/components/harness-icon"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { categoryBySlug, loadCategories } from "@/core/categories"
import { projectColor, useDark } from "@/core/colors"
import { errorMessage } from "@/core/errors"
import { logEntry } from "@/core/fs"
import { HARNESS_LABEL, type HarnessId } from "@/core/harness"
import { useLoad } from "@/core/hooks"
import type { LogKind } from "@/core/links"
import { buildTools, isNeedleReady, needleAsk, useNeedleStatus } from "@/core/needle"
import { bestTaskMatch, guessKind, guessProject } from "@/core/quicklog"
import { readSection } from "@/core/sections"
import { mainCategory } from "@/core/types"
import { loadProjects } from "@/core/vault"

/** Sentinel for "no project picked" and "no task finished": base-ui Select wants a real value. */
const NONE = "__none__"

const KIND_ITEMS = [
  { value: "task", label: "Task" },
  { value: "update", label: "Update" },
]

/** The harness of a hand-written entry: the app mark first, then the AI harnesses. */
const HARNESS_ITEMS: { value: HarnessId; label: string }[] = [
  { value: "me", label: HARNESS_LABEL.me },
  { value: "claude-code", label: HARNESS_LABEL["claude-code"] },
  { value: "antigravity", label: HARNESS_LABEL.antigravity },
  { value: "opencode", label: HARNESS_LABEL.opencode },
]

/** The harness as a log bullet spells it ("claude code"), which is what Rust accepts. */
function harnessText(id: HarnessId): string {
  return id === "claude-code" ? "claude code" : id
}

/**
 * Quick log: one sentence, a project and kind guessed from it, then Log writes one bullet into
 * today's log (and ticks the task it finishes) through Rust. The optional Needle add-on can fill
 * the fields from the same sentence; without it the built-in guess stays in charge.
 */
export function QuickLogDialog({ onClose, onLogged }: { onClose: () => void; onLogged: () => void }) {
  const projects = useLoad(loadProjects, [])
  const categories = useLoad(loadCategories, [])
  const needle = useNeedleStatus()
  const dark = useDark()

  const [sentence, setSentence] = useState("")
  /** Set once the user picks a project or a kind, so the guess stops overriding the choice. */
  const [projectPick, setProjectPick] = useState<string | null>(null)
  const [kindPick, setKindPick] = useState<LogKind | null>(null)
  /** null = follow the word-overlap guess, "" = no task. */
  const [taskPick, setTaskPick] = useState<string | null>(null)
  const [harness, setHarness] = useState<HarnessId>("me")
  const [next, setNext] = useState("")
  const [suggesting, setSuggesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [hint, setHint] = useState<string | null>(null)

  const records = useMemo(() => projects.data?.projects ?? [], [projects.data])
  const categoryList = useMemo(() => categories.data?.categories ?? [], [categories.data])
  const needleReady = isNeedleReady(needle.data)

  const project = projectPick ?? guessProject(records.map((r) => r.project), sentence)
  const kind = kindPick ?? guessKind(sentence)

  /** Accent of a project, from its main category. */
  function colorOf(name: string): string {
    const record = records.find((r) => r.project.name === name)
    const hue = categoryBySlug(categoryList, mainCategory(record?.project.categories))?.hue
    return projectColor(name, hue, dark)
  }

  /** Open `## Next` tasks of the picked project, read with the same parser the project sheet uses. */
  const openTasks = useMemo(() => {
    const record = records.find((r) => r.project.name === project)
    if (!record) return []
    return readSection(record.note.body, "Next").flatMap((b) => (b.kind === "item" ? [b.text] : []))
  }, [records, project])

  /** The task the sentence looks like it finishes, unless the user chose one (or none). */
  const task =
    taskPick !== null && (taskPick === "" || openTasks.includes(taskPick))
      ? taskPick
      : bestTaskMatch(openTasks, sentence)

  const projectItems = useMemo(
    () => [
      { value: NONE, label: "Pick a project" },
      ...records.map((r) => ({ value: r.project.name, label: r.project.name })),
    ],
    [records]
  )

  const taskItems = useMemo(
    () => [{ value: NONE, label: "No task" }, ...openTasks.map((t) => ({ value: t, label: t }))],
    [openTasks]
  )

  const harnessItems = useMemo(
    () => HARNESS_ITEMS.map((h) => ({ value: h.value as string, label: h.label })),
    []
  )

  /** Asks Needle to fill the fields from the sentence (log_work); the built-in guess does the rest. */
  async function fillWithNeedle() {
    const said = sentence.trim()
    if (!said || suggesting) return
    setSuggesting(true)
    setHint(null)
    try {
      const result = await needleAsk(
        said,
        buildTools({ projects: records, categories: categoryList }, ["log_work"])
      )
      const call = [...result.calls, ...result.held].find((c) => c.name === "log_work")
      if (!call) {
        setHint("Needle found nothing to log in that sentence.")
        return
      }
      const args = call.arguments
      const named = String(args.project ?? "").trim()
      const known = records.find((r) => r.project.name.toLowerCase() === named.toLowerCase())
      if (known) setProjectPick(known.project.name)
      setKindPick(args.kind === "update" ? "update" : "task")
      if (typeof args.text === "string" && args.text.trim()) setSentence(args.text.trim())
      if (typeof args.next === "string" && args.next.trim()) setNext(args.next.trim())
      setTaskPick(null)
      if (!known) {
        setHint(
          named
            ? `Needle reads "${named}", which is not in the vault. Pick a project below.`
            : "Needle did not say which project this is. Pick one below."
        )
      } else if (result.held.length > 0) {
        setHint("Low confidence, check the fields before logging.")
      }
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setSuggesting(false)
    }
  }

  async function save() {
    if (!project) {
      toast.error("Pick a project first")
      return
    }
    const said = sentence.trim()
    if (!said) {
      toast.error("Say what you did")
      return
    }
    setSaving(true)
    try {
      const result = await logEntry({
        project,
        kind,
        text: said,
        harness: harnessText(harness),
        task: kind === "task" ? task || null : null,
        next: next.trim() || null,
      })
      toast.success(result.message)
      onLogged()
      onClose()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose()
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Log work</DialogTitle>
          <DialogDescription>
            One bullet in today&apos;s log, written in the vault. The project, kind and task are guessed
            from your sentence; nothing is written until Log.
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            save()
          }}
        >
          <Field label="What did you do?" htmlFor="quicklog-text">
            <div className="flex items-center gap-2">
              <Input
                id="quicklog-text"
                value={sentence}
                onChange={(e) => setSentence(e.target.value)}
                placeholder="finished the boss fight on Starfall"
                autoFocus
                disabled={saving}
              />
              {needleReady && (
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={fillWithNeedle}
                  disabled={!sentence.trim() || suggesting || saving}
                  title="Fill with Needle"
                  aria-label="Fill with Needle"
                >
                  {suggesting ? <Loader2 className="animate-spin" /> : <Sparkles />}
                </Button>
              )}
            </div>
          </Field>

          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
            <Field label="Project">
              <div className="flex items-center gap-2">
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ background: project ? colorOf(project) : undefined }}
                  aria-hidden="true"
                />
                <Select
                  value={project || NONE}
                  onValueChange={(value) => {
                    const picked = String(value ?? NONE)
                    setProjectPick(picked === NONE ? "" : picked)
                    setTaskPick(null)
                  }}
                  items={projectItems}
                >
                  <SelectTrigger className="w-full" aria-label="Project">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {projectItems.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.value === NONE ? (
                          item.label
                        ) : (
                          <>
                            <span
                              className="size-2 shrink-0 rounded-full"
                              style={{ background: colorOf(item.value) }}
                              aria-hidden="true"
                            />
                            {item.label}
                          </>
                        )}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </Field>

            <Field label="Kind">
              <ToggleGroup
                multiple={false}
                variant="outline"
                value={[kind]}
                onValueChange={(value) => {
                  const picked = value[0]
                  if (picked === "task" || picked === "update") setKindPick(picked)
                }}
              >
                {KIND_ITEMS.map((item) => (
                  <ToggleGroupItem key={item.value} value={item.value} className="px-2.5 text-xs">
                    {item.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </Field>
          </div>

          {kind === "task" && openTasks.length > 0 && (
            <Field label="Finishes task (optional)">
              <Select
                value={task || NONE}
                onValueChange={(value) => setTaskPick(String(value ?? NONE) === NONE ? "" : String(value))}
                items={taskItems}
              >
                <SelectTrigger className="w-full" aria-label="Finishes task">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {taskItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}

          <div className="grid gap-3 sm:grid-cols-[auto_minmax(0,1fr)]">
            <Field label="Harness">
              <Select
                value={harness}
                onValueChange={(value) => setHarness(String(value ?? "me") as HarnessId)}
                items={harnessItems}
              >
                <SelectTrigger className="w-36" aria-label="Harness">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {HARNESS_ITEMS.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      <HarnessGlyph id={item.value} />
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Next step (optional)" htmlFor="quicklog-next">
              <Input
                id="quicklog-next"
                value={next}
                onChange={(e) => setNext(e.target.value)}
                placeholder="What comes next"
                disabled={saving}
              />
            </Field>
          </div>

          {hint && (
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <TriangleAlert className="mt-px size-3.5 shrink-0" />
              {hint}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || suggesting || !project || !sentence.trim()}>
              {saving ? <Loader2 className="animate-spin" /> : <PenLine />}
              {saving ? "Logging..." : "Log"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  )
}
