import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import {
  ChevronDown,
  Copy,
  Pencil,
  Plus,
  Trash2,
  ArrowRightLeft,
} from "lucide-react"
import { toast } from "sonner"

import { CategoryChips } from "@/components/category-chips"
import { HarnessGlyph, HarnessIcon } from "@/components/harness-icon"
import { LockControl } from "@/components/lock-control"
import { ProgressBar } from "@/components/progress-bar"
import { TermHint } from "@/components/term-hint"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
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
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { categoryBySlug, type Category } from "@/core/categories"
import { copyText } from "@/core/clipboard"
import { projectColor, useDark } from "@/core/colors"
import { cfg } from "@/core/config"
import { errorMessage } from "@/core/errors"
import { cx } from "@/core/format"
import {
  HARNESS_LABEL,
  KNOWN_HARNESSES,
  type AiHarnessId,
} from "@/core/harness"
import { lockAt, useLocks, type LockEntry, type LockMode } from "@/core/locks"
import { addItem, readSection, type Block } from "@/core/sections"
import { buildContinuePrompt, setProjectHarness } from "@/core/transfer"
import { mainCategory, type ProjectStatus } from "@/core/types"
import { saveProject, type ProjectRecord } from "@/core/vault"
import {
  normalizeItems,
  parseHistory,
  progressOf,
  sectionLines,
  splitBody,
} from "@/core/versions"

import { CategoryPicker } from "./CategoryPicker"
import { STATUS_ITEMS } from "./status"

interface ProjectEditorProps {
  record: ProjectRecord
  categories: Category[]
  onSaved: () => void
  onCategoriesChanged: () => void
  /** `#/projects?open=Name&tab=tasks`: scroll the Next list into view ("what's left on Name"). */
  focusTasks?: boolean
}

/**
 * Detail sheet for one project, in this order: status, categories, next step, version and progress,
 * Next tasks (add, tick to finish), Done tasks, History (one collapsible block per past version).
 */
export function ProjectEditor({
  record,
  categories,
  onSaved,
  onCategoriesChanged,
  focusTasks = false,
}: ProjectEditorProps) {
  const { project } = record
  const dark = useDark()
  const { locks, set: setLock } = useLocks(onSaved)
  const tasksRef = useRef<HTMLDivElement>(null)
  const body = useMemo(() => splitBody(record.note.body), [record.note.body])
  const [status, setStatus] = useState<ProjectStatus>(project.status)
  const [picked, setPicked] = useState<string[]>(project.categories)
  const [editingCategories, setEditingCategories] = useState(false)
  const [next, setNext] = useState(project.next ?? "")
  const [todo, setTodo] = useState<Block[]>(() =>
    normalizeItems(readSection(record.note.body, "Next"), false)
  )
  const [done, setDone] = useState<Block[]>(() =>
    normalizeItems(readSection(record.note.body, "Done"), true)
  )
  const [draft, setDraft] = useState("")
  const [saving, setSaving] = useState(false)
  const [confirmNewVersion, setConfirmNewVersion] = useState(false)

  const openCount = todo.filter((b) => b.kind === "item").length
  const doneCount = done.filter((b) => b.kind === "item").length
  const total = openCount + doneCount
  const pct = progressOf(doneCount, openCount)
  const complete = total > 0 && openCount === 0
  const hue = categoryBySlug(categories, mainCategory(picked))?.hue
  const accent = projectColor(project.name, hue, dark)
  const history = useMemo(
    () => parseHistory(sectionLines(body, "History")),
    [body]
  )
  /** The project's own folder in the vault: `Projects/<Name>`. */
  const vaultFolder = `${cfg().projects}\\${project.name}`

  // A "what's left on X" answer opens the sheet on the task lists, not on the top fields.
  useEffect(() => {
    if (!focusTasks) return
    tasksRef.current?.scrollIntoView({ block: "start", behavior: "smooth" })
  }, [focusTasks, project.name])

  async function save(startNextVersion = false) {
    setSaving(true)
    try {
      await saveProject(record, {
        status,
        next: next.trim(),
        categories: picked,
        doneItems: done,
        nextItems: todo,
        startNextVersion,
      })
      toast.success(
        startNextVersion
          ? `Started v${project.version + 1} of ${project.name}`
          : `Saved ${project.name}`
      )
      if (startNextVersion) setDone([])
      setConfirmNewVersion(false)
      onSaved()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  /** Ticking an open task moves it to Done as `- [x]`. */
  function finish(index: number) {
    const block = todo[index]
    if (block?.kind !== "item") return
    setTodo(todo.filter((_, j) => j !== index))
    setDone([...done, { ...block, hasBox: true, checked: true }])
  }

  /** Unticking a Done task moves it back to Next as `- [ ]`. */
  function reopen(index: number) {
    const block = done[index]
    if (block?.kind !== "item") return
    setDone(done.filter((_, j) => j !== index))
    setTodo([...todo, { ...block, hasBox: true, checked: false }])
  }

  function addTask() {
    const text = draft.trim()
    if (!text) return
    setTodo(addItem(todo, text, true, false))
    setDraft("")
  }

  return (
    <>
      <SheetHeader>
        <SheetTitle>{project.name}</SheetTitle>
        <SheetDescription className="break-all">
          {project.repo ? `Repo: ${project.repo}` : "No repo set"}
        </SheetDescription>
      </SheetHeader>

      <div className="flex flex-col gap-6 px-4 pb-4">
        <Field label="Status">
          <Select
            value={status}
            onValueChange={(v) => v && setStatus(v as ProjectStatus)}
            items={STATUS_ITEMS}
          >
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
        </Field>

        <Field label="Harness" hint={<TermHint term="cv:harness" />}>
          <div className="flex items-center justify-between gap-2">
            <HarnessIcon harness={project.harness} />
            <span className="flex items-center gap-1">
              <TransferMenu record={record} onSaved={onSaved} />
              <TermHint term="cv:transfer" />
            </span>
          </div>
        </Field>

        <Field label="Locks" hint={<TermHint term="cv:lock" />}>
          <div className="flex flex-col gap-2">
            {project.repo && (
              <LockRow
                label="Repo folder"
                path={project.repo}
                lock={lockAt(project.repo, locks)}
                onSet={(mode) => setLock(project.repo as string, mode)}
              />
            )}
            <LockRow
              label="Vault folder"
              path={vaultFolder}
              lock={lockAt(vaultFolder, locks)}
              onSet={(mode) => setLock(vaultFolder, mode)}
            />
          </div>
        </Field>

        <Field label="Categories" hint={<TermHint term="cv:category" />}>
          {editingCategories ? (
            <div className="flex flex-col gap-3">
              <CategoryPicker
                value={picked}
                onChange={setPicked}
                categories={categories}
                onCategoryAdded={onCategoriesChanged}
              />
              <div className="flex justify-end">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditingCategories(false)}
                >
                  Done editing
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <CategoryChips slugs={picked} categories={categories} />
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEditingCategories(true)}
              >
                <Pencil />
                Edit
              </Button>
            </div>
          )}
        </Field>

        <Field label="Next step">
          <Input
            value={next}
            onChange={(e) => setNext(e.target.value)}
            placeholder="The next concrete step"
          />
        </Field>

        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="flex items-center gap-1 text-sm font-medium tabular-nums">
              <span>
                v{project.version}
                <span className="text-muted-foreground">
                  {" "}
                  · {doneCount}/{total} · {pct}%
                </span>
              </span>
              <TermHint term="cv:version" />
            </h3>
            {complete && (
              <Button size="sm" onClick={() => setConfirmNewVersion(true)}>
                Start v{project.version + 1}
              </Button>
            )}
          </div>
          <ProgressBar value={pct} color={accent} />
        </section>

        <div
          ref={tasksRef}
          className={cx(
            "scroll-mt-4 rounded-lg",
            focusTasks && "-mx-2 px-2 py-1 ring-1 ring-ring/30"
          )}
        >
          <TaskList
            title="Next"
            hint={<TermHint term="cv:task" />}
            items={todo}
            empty="No open tasks."
            onToggle={finish}
            onRemove={(i) => setTodo(todo.filter((_, j) => j !== i))}
            footer={
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  addTask()
                }}
              >
                <Input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Add a task"
                />
                <Button
                  type="submit"
                  variant="outline"
                  size="icon"
                  aria-label="Add task"
                >
                  <Plus />
                </Button>
              </form>
            }
          />
        </div>

        <TaskList
          title="Done"
          hint={<TermHint term="cv:task" />}
          items={done}
          empty="Nothing finished in this version yet."
          onToggle={reopen}
          onRemove={(i) => setDone(done.filter((_, j) => j !== i))}
        />

        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">History</h3>
          {history.length === 0 && (
            <p className="text-xs text-muted-foreground">
              No earlier versions.
            </p>
          )}
          {[...history].reverse().map((v) => (
            <Collapsible key={v.label} className="rounded-lg border">
              <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm">
                <span className="font-medium">{v.label}</span>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  {v.items.length} done
                  <ChevronDown className="size-4" />
                </span>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <ul className="flex flex-col gap-1.5 border-t px-3 py-2 text-sm text-muted-foreground">
                  {v.items.map((item, i) => (
                    <li
                      key={i}
                      className="line-through decoration-muted-foreground/50"
                    >
                      {item}
                    </li>
                  ))}
                  {v.items.length === 0 && (
                    <li className="no-underline">Nothing finished.</li>
                  )}
                </ul>
              </CollapsibleContent>
            </Collapsible>
          ))}
        </section>

        <div className="flex justify-end">
          <Button onClick={() => save(false)} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>

      <Dialog
        open={confirmNewVersion}
        onOpenChange={(open) => !saving && setConfirmNewVersion(open)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Start v{project.version + 1}?</DialogTitle>
            <DialogDescription>
              The {doneCount} finished tasks of v{project.version} move to
              History, Done is cleared and the version becomes{" "}
              {project.version + 1}. Other unsaved edits in this sheet are saved
              too.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmNewVersion(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button onClick={() => save(true)} disabled={saving}>
              {saving ? "Saving..." : `Start v${project.version + 1}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  /** Optional TermHint for a label that is a cv: term. */
  hint?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="gap-1">
        {label}
        {hint}
      </Label>
      {children}
    </div>
  )
}

/** One lockable folder in the project sheet: its lock button, the label and the path. */
function LockRow({
  label,
  path,
  lock,
  onSet,
}: {
  label: string
  path: string
  lock: LockEntry | undefined
  onSet: (mode: LockMode | null) => void
}) {
  return (
    <div className="flex items-center gap-2">
      <LockControl path={path} lock={lock} onSet={onSet} />
      <span className="min-w-0 flex-1">
        <span className="block text-xs text-muted-foreground">{label}</span>
        <span className="block truncate font-mono text-xs" title={path}>
          {path}
        </span>
      </span>
    </div>
  )
}

/**
 * Hands the project to another harness: copies a self-contained prompt and writes the new harness
 * (plus today) into the note. "Copy continue prompt" copies the same text without touching the note,
 * for a fresh session in the harness that already owns it.
 */
function TransferMenu({
  record,
  onSaved,
}: {
  record: ProjectRecord
  onSaved: () => void
}) {
  const [busy, setBusy] = useState(false)

  async function copyOnly() {
    setBusy(true)
    try {
      await copyText(await buildContinuePrompt(record))
      toast.success("Continue prompt copied")
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  async function transfer(target: AiHarnessId) {
    setBusy(true)
    try {
      await copyText(await buildContinuePrompt(record))
      await setProjectHarness(record, target)
      toast.success(
        `Transfer prompt copied. Paste it into ${HARNESS_LABEL[target]}.`
      )
      onSaved()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="outline" size="sm" disabled={busy} />}
      >
        <ArrowRightLeft />
        Transfer
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto min-w-48">
        <DropdownMenuLabel>Transfer to</DropdownMenuLabel>
        {KNOWN_HARNESSES.map((id) => (
          <DropdownMenuItem key={id} onClick={() => transfer(id)}>
            <HarnessGlyph id={id} />
            {HARNESS_LABEL[id]}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={copyOnly}>
          <Copy />
          Copy continue prompt
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

interface TaskListProps {
  title: string
  /** TermHint beside the title (cv:task for Next and Done). */
  hint?: ReactNode
  items: Block[]
  empty: string
  /** Called with the index of a bullet when its checkbox changes. */
  onToggle: (index: number) => void
  onRemove: (index: number) => void
  footer?: ReactNode
}

function TaskList({
  title,
  hint,
  items,
  empty,
  onToggle,
  onRemove,
  footer,
}: TaskListProps) {
  const rows = items.flatMap((block, index) =>
    block.kind === "item" ? [{ block, index }] : []
  )
  return (
    <section className="flex flex-col gap-2">
      <h3 className="flex items-center gap-1 text-sm font-medium">
        {title}{" "}
        <span className="text-muted-foreground">({rows.length})</span>
        {hint}
      </h3>
      {rows.length === 0 && (
        <p className="text-xs text-muted-foreground">{empty}</p>
      )}
      <ul className="flex flex-col gap-2">
        {rows.map(({ block, index }) => {
          if (block.kind !== "item") return null
          const checked = block.checked
          return (
            <li key={index} className="flex items-start gap-2">
              <Checkbox
                className="mt-0.5"
                checked={checked}
                onCheckedChange={() => onToggle(index)}
                aria-label={block.text}
              />
              <div className="min-w-0 flex-1">
                <p
                  className={cx(
                    "text-sm break-words",
                    checked && "text-muted-foreground line-through"
                  )}
                >
                  {block.text}
                </p>
                {block.extra.length > 0 && (
                  <ul className="mt-1 flex flex-col gap-0.5 text-xs text-muted-foreground">
                    {block.extra.map((line, k) => (
                      <li key={k} className="break-words">
                        {line.trim().replace(/^[-*]\s+/, "- ")}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove ${block.text}`}
                onClick={() => onRemove(index)}
              >
                <Trash2 />
              </Button>
            </li>
          )
        })}
      </ul>
      {footer}
    </section>
  )
}
