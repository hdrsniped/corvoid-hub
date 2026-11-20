import { useMemo, useState, type ReactNode } from "react"
import { Loader2, PenLine, Sparkles, TriangleAlert } from "lucide-react"
import { toast } from "sonner"

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
import { quicklogCommit, quicklogSuggest } from "@/core/fs"
import { useLoad } from "@/core/hooks"
import type { LogKind } from "@/core/links"
import { guessKind, parseSuggestion, runMessage, type QuickLogSuggestion } from "@/core/quicklog"
import { readSection } from "@/core/sections"
import { mainCategory } from "@/core/types"
import { loadProjects } from "@/core/vault"

/** Sentinel for "no project picked" and "no task finished": base-ui Select wants a real value. */
const NONE = "__none__"

const KIND_ITEMS = [
  { value: "task", label: "Task" },
  { value: "update", label: "Update" },
]

/**
 * Quick log: one sentence, a suggestion from needle-log (project, kind, text), a check row, then
 * vlog.ps1 writes the bullet with harness "me". Nothing is written until Log is pressed.
 */
export function QuickLogDialog({ onClose, onLogged }: { onClose: () => void; onLogged: () => void }) {
  const projects = useLoad(loadProjects, [])
  const categories = useLoad(loadCategories, [])
  const dark = useDark()

  const [sentence, setSentence] = useState("")
  const [suggesting, setSuggesting] = useState(false)
  const [committing, setCommitting] = useState(false)
  /** True once needle-log was asked: the check row is shown from then on. */
  const [asked, setAsked] = useState(false)
  const [suggestion, setSuggestion] = useState<QuickLogSuggestion | null>(null)
  const [hint, setHint] = useState<string | null>(null)
  const [project, setProject] = useState("")
  const [kind, setKind] = useState<LogKind>("update")
  const [text, setText] = useState("")
  const [taskWords, setTaskWords] = useState("")

  const records = useMemo(() => projects.data?.projects ?? [], [projects.data])
  const categoryList = useMemo(() => categories.data?.categories ?? [], [categories.data])

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

  async function suggest() {
    const said = sentence.trim()
    if (!said || suggesting) return
    setSuggesting(true)
    setAsked(true)
    setHint(null)
    try {
      const run = await quicklogSuggest(said)
      const found = parseSuggestion(run)
      if (!found) {
        // Exit 3: needle-log could not name a project. Keep the sentence and let the user pick.
        setSuggestion(null)
        setProject("")
        setKind(guessKind(said))
        setText(said)
        setTaskWords("")
        setHint(runMessage(run) || "Couldn't tell which project this is. Pick one below.")
        return
      }
      setSuggestion(found)
      setProject(found.project)
      setKind(found.kind)
      setText(found.text)
      setTaskWords("")
      setHint(
        found.sure
          ? null
          : `Check this before logging${
              found.confidence === null ? "" : ` (confidence ${Math.round(found.confidence * 100)}%)`
            }.`
      )
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setSuggesting(false)
    }
  }

  async function commit() {
    if (!project) {
      toast.error("Pick a project first")
      return
    }
    if (!text.trim()) {
      toast.error("Say what you did")
      return
    }
    setCommitting(true)
    try {
      const message = await quicklogCommit({
        project,
        kind,
        text: text.trim(),
        task: kind === "task" ? taskWords || null : null,
      })
      toast.success(message || `Logged ${kind} to ${project}`)
      onLogged()
      onClose()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setCommitting(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !suggesting && !committing) onClose()
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Log work</DialogTitle>
          <DialogDescription>
            needle-log reads the sentence and picks the project; vlog.ps1 writes one bullet to today's log
            as harness &quot;me&quot;.
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (!asked) suggest()
            else commit()
          }}
        >
          <Field label="What did you do?" htmlFor="quicklog-sentence">
            <div className="flex items-center gap-2">
              <Input
                id="quicklog-sentence"
                value={sentence}
                onChange={(e) => setSentence(e.target.value)}
                onKeyDown={(e) => {
                  // Enter in this field always asks needle-log again; the Log button commits.
                  if (e.key === "Enter") {
                    e.preventDefault()
                    suggest()
                  }
                }}
                placeholder="fixed the login redirect on Corvoid Hub"
                autoFocus
                disabled={suggesting || committing}
              />
              <Button
                type="button"
                variant="outline"
                onClick={suggest}
                disabled={!sentence.trim() || suggesting || committing}
              >
                {suggesting ? <Loader2 className="animate-spin" /> : <Sparkles />}
                {suggesting ? "Thinking..." : asked ? "Again" : "Suggest"}
              </Button>
            </div>
          </Field>

          {asked && (
            <div className="flex flex-col gap-3 rounded-lg border p-3">
              <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
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
                        const next = String(value ?? NONE)
                        setProject(next === NONE ? "" : next)
                        setTaskWords("")
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
                      const next = value[0]
                      if (next === "task" || next === "update") setKind(next)
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

              <Field label="Log text" htmlFor="quicklog-text">
                <Input
                  id="quicklog-text"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="What was done, in one line"
                  disabled={committing}
                />
              </Field>

              {kind === "task" && openTasks.length > 0 && (
                <Field label="Finishes task (optional)">
                  <Select
                    value={taskWords || NONE}
                    onValueChange={(value) => setTaskWords(String(value ?? NONE) === NONE ? "" : String(value))}
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

              {hint && (
                <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                  <TriangleAlert className="mt-px size-3.5 shrink-0" />
                  {hint}
                </p>
              )}

              {suggestion === null && asked && !suggesting && (
                <p className="text-xs text-muted-foreground">Pick the project, check the text, then press Log.</p>
              )}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={suggesting || committing}>
              Cancel
            </Button>
            <Button type="submit" disabled={!asked || suggesting || committing || !project || !text.trim()}>
              {committing ? <Loader2 className="animate-spin" /> : <PenLine />}
              {committing ? "Logging..." : "Log"}
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
