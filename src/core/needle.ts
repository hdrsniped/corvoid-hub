import { invoke } from "@tauri-apps/api/core"
import {
  AppWindow,
  ArchiveRestore,
  ArrowRightLeft,
  ArrowRightToLine,
  CheckCircle2,
  Filter,
  FolderKanban,
  ListPlus,
  Lock,
  PenLine,
  Play,
  Sparkles,
  type LucideIcon,
} from "lucide-react"

import type { AppEntry } from "./apps"
import type { Category } from "./categories"
import { useLoad } from "./hooks"
import { LOCK_MODES, type LockMode } from "./locks"
import type { SkillEntry } from "./skills"
import { PROJECT_STATUSES, type ProjectRecord } from "./vault"
import type { ProjectStatus } from "./types"

// Typed wrappers around the Needle sidecar commands in src-tauri/src/lib.rs, plus the tool list the
// palette sends: one sentence in, one or two tool calls out, every write confirmed by the user.

/** What the app knows about the optional sidecar (Tauri `needle_status`). */
export interface NeedleStatus {
  /** Both config keys are set. */
  configured: boolean
  pythonFound: boolean
  weightsFound: boolean
  /** The worker is running right now (it starts on the first command). */
  running: boolean
  /** Why the last request failed, when it did. */
  error: string | null
}

/** One call the model made. `arguments` is whatever the tool schema allows. */
export interface NeedleCall {
  name: string
  arguments: Record<string, unknown>
}

/** One answer: the confident calls, the held ones (low confidence) and how long it took. */
export interface NeedleResult {
  calls: NeedleCall[]
  held: NeedleCall[]
  confidence: number | null
  ms: number
}

/** The JSON schema of one tool, as the sidecar expects it. */
export interface NeedleTool {
  name: string
  description: string
  parameters: {
    type: "object"
    properties: Record<string, unknown>
    required: string[]
  }
}

export function needleStatus(): Promise<NeedleStatus> {
  return invoke<NeedleStatus>("needle_status")
}

/** The ask in flight, so two effects that fire at once never start (or queue) two sidecar calls. */
let pendingAsk: { key: string; promise: Promise<NeedleResult> } | null = null

/**
 * Asks Needle for tool calls. Rust keeps one sidecar process, answers within 15 s and restarts it
 * once when it died. `tools` is the live schema list from `buildTools`.
 *
 * With `ctx` every call is grounded against the sentence first (`groundResult`): an argument the
 * user never said is dropped, and a call that loses its required argument is not shown at all.
 * Two identical asks that overlap share one request, so the worker is never started twice.
 */
export function needleAsk(
  text: string,
  tools: NeedleTool[],
  ctx?: NeedleContext
): Promise<NeedleResult> {
  const key = text.trim()
  if (pendingAsk && pendingAsk.key === key) return pendingAsk.promise
  const promise = invoke<NeedleResult>("needle_ask", { text: key, tools }).then((result) =>
    ctx ? groundResult(key, result, ctx) : result
  )
  pendingAsk = { key, promise }
  const clear = () => {
    if (pendingAsk?.promise === promise) pendingAsk = null
  }
  promise.then(clear, clear)
  return promise
}

/** The setup write in flight: the dialog's two buttons must not write (or restart) twice. */
let pendingConfigure: Promise<void> | null = null

/**
 * Writes needlePython / needleWeights into corvoid-hub.json (null removes both, which turns the
 * add-on off) and stops the worker, so the next command uses the new paths.
 */
export function needleConfigure(python: string | null, weights: string | null): Promise<void> {
  if (pendingConfigure) return pendingConfigure
  const promise = invoke<void>("needle_configure", { python, weights }).finally(() => {
    if (pendingConfigure === promise) pendingConfigure = null
  })
  pendingConfigure = promise
  return promise
}

/** True when both files are configured and on disk: commands can be asked. */
export function isNeedleReady(status: NeedleStatus | null | undefined): boolean {
  return Boolean(status && status.configured && status.pythonFound && status.weightsFound)
}

/** The add-on status, reloadable (Hub > Add-ons, the Guide card and the palette all read it). */
export function useNeedleStatus() {
  return useLoad(needleStatus, [])
}

/** localStorage keys of the dismissible Needle tips. Writes never throw. */
export const NEEDLE_TIP_KEY = "corvoid.needle.tip"
export const NEEDLE_DOT_KEY = "corvoid.needle.dot"
export const NEEDLE_GUIDE_KEY = "corvoid.needle.guide"

/** Window event after the palette cleared the sidebar's Sparkles dot. */
export const NEEDLE_SEEN_EVENT = "hub:needle-seen"

/** True once the user dismissed (or completed) a one-time Needle tip. */
export function needleTipSeen(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "1"
  } catch {
    return false
  }
}

export function rememberNeedleTip(key: string): void {
  try {
    window.localStorage.setItem(key, "1")
  } catch {
    // Private mode or a full quota: the tip simply shows again next time.
  }
}

/** Everything a tool's enums are filled from. Missing sources just mean fewer enum values. */
export interface NeedleContext {
  projects?: ProjectRecord[]
  categories?: Category[]
  skills?: SkillEntry[]
  apps?: AppEntry[]
}

/** The screens `go_to` may open: the module id, which is also the route without the slash. */
export const NEEDLE_SCREENS = ["projects", "apps", "activity", "graph", "hub", "skills", "guide"]

/** Where a skill can be moved: the hub, or a harness's own folder. */
export type NeedleSkillTarget = "hub" | "claude" | "antigravity"

export const SKILL_TARGET_LABEL: Record<NeedleSkillTarget, string> = {
  hub: "Hub",
  claude: "Claude Code",
  antigravity: "Antigravity",
}

/** How a confirm card draws one field: a select from live data or a text box. */
export type ToolFieldKind =
  | "text"
  | "project"
  | "status"
  | "category"
  | "kind"
  | "mode"
  | "screen"
  | "skill"
  | "app"
  | "target"

export interface ToolField {
  key: string
  label: string
  kind: ToolFieldKind
  /** Optional fields may stay empty. */
  optional?: boolean
  placeholder?: string
}

export interface ToolSpec {
  name: string
  /** Short human name of the action ("Add task"). */
  label: string
  /** One line for the model: when to use it. */
  description: string
  icon: LucideIcon
  /** Safe actions run on Enter; everything else opens the confirm card. */
  safe: boolean
  fields: ToolField[]
}

/** The complete tool list. One place for the schema, the sentence and the confirm fields. */
export const TOOL_SPECS: ToolSpec[] = [
  {
    name: "filter_projects",
    label: "Filter projects",
    description: "Show the projects screen, optionally only projects with a status or a category.",
    icon: Filter,
    safe: true,
    fields: [
      { key: "status", label: "Status", kind: "status", optional: true },
      { key: "category", label: "Category", kind: "category", optional: true },
    ],
  },
  {
    name: "open_project",
    label: "Open project",
    description: "Open one project's note and tasks.",
    icon: FolderKanban,
    safe: true,
    fields: [{ key: "project", label: "Project", kind: "project" }],
  },
  {
    name: "project_overview",
    label: "Project overview",
    description: "Show the open tasks and progress of a project.",
    icon: FolderKanban,
    safe: true,
    fields: [{ key: "project", label: "Project", kind: "project" }],
  },
  {
    name: "add_task",
    label: "Add task",
    description: "Add one open task to a project's Next list.",
    icon: ListPlus,
    safe: false,
    fields: [
      { key: "project", label: "Project", kind: "project" },
      { key: "task", label: "Task", kind: "text", placeholder: "what should be done" },
    ],
  },
  {
    name: "log_work",
    label: "Log work",
    description: "Write one bullet in today's log and tick the task it finishes.",
    icon: PenLine,
    safe: false,
    fields: [
      { key: "project", label: "Project", kind: "project" },
      { key: "kind", label: "Kind", kind: "kind" },
      { key: "text", label: "What was done", kind: "text", placeholder: "finished the boss fight" },
      { key: "next", label: "Next step", kind: "text", optional: true, placeholder: "what comes next" },
    ],
  },
  {
    name: "set_next",
    label: "Set next step",
    description: "Replace the project's next step.",
    icon: ArrowRightToLine,
    safe: false,
    fields: [
      { key: "project", label: "Project", kind: "project" },
      { key: "next", label: "Next step", kind: "text" },
    ],
  },
  {
    name: "set_status",
    label: "Set status",
    description: "Change the status of a project.",
    icon: CheckCircle2,
    safe: false,
    fields: [
      { key: "project", label: "Project", kind: "project" },
      { key: "status", label: "Status", kind: "status" },
    ],
  },
  {
    name: "start_version",
    label: "Start version",
    description: "Archive the finished tasks and start the next version of a project.",
    icon: Play,
    safe: false,
    fields: [{ key: "project", label: "Project", kind: "project" }],
  },
  {
    name: "backup_now",
    label: "Back up now",
    description: "Write one backup zip of the hub and vault.",
    icon: ArchiveRestore,
    safe: false,
    fields: [],
  },
  {
    name: "lock_folder",
    label: "Lock folder",
    description: "Mark a folder read-only, or no-ai to keep agents out.",
    icon: Lock,
    safe: false,
    fields: [
      { key: "path", label: "Folder", kind: "text", placeholder: "C:\\Dev\\some-folder" },
      { key: "mode", label: "Mode", kind: "mode" },
    ],
  },
  {
    name: "go_to",
    label: "Go to",
    description: "Open one screen of the app.",
    icon: ArrowRightToLine,
    safe: true,
    fields: [{ key: "screen", label: "Screen", kind: "screen" }],
  },
  {
    name: "open_skill",
    label: "Open skill",
    description: "Open one skill's sheet.",
    icon: Sparkles,
    safe: true,
    fields: [{ key: "skill", label: "Skill", kind: "skill" }],
  },
  {
    name: "move_skill",
    label: "Move skill",
    description: "Move a skill into the hub, Claude Code or Antigravity.",
    icon: ArrowRightLeft,
    safe: false,
    fields: [
      { key: "skill", label: "Skill", kind: "skill" },
      { key: "target", label: "Move to", kind: "target" },
    ],
  },
  {
    name: "open_app",
    label: "Open app",
    description: "Show one app of the apps index.",
    icon: AppWindow,
    safe: true,
    fields: [{ key: "app", label: "App", kind: "app" }],
  },
]

export function toolSpec(name: string): ToolSpec | undefined {
  return TOOL_SPECS.find((spec) => spec.name === name)
}

/** The values a select offers for one field, from live data. Undefined = a text box. */
export function fieldOptions(kind: ToolFieldKind, ctx: NeedleContext): string[] | undefined {
  switch (kind) {
    case "project":
      return (ctx.projects ?? []).map((r) => r.project.name)
    case "status":
      return [...PROJECT_STATUSES]
    case "category":
      return (ctx.categories ?? []).map((c) => c.slug)
    case "kind":
      return ["task", "update"]
    case "mode":
      return [...LOCK_MODES]
    case "screen":
      return [...NEEDLE_SCREENS]
    case "skill":
      return (ctx.skills ?? []).map((s) => s.name)
    case "app":
      return (ctx.apps ?? []).map((a) => a.name)
    case "target":
      return ["hub", "claude", "antigravity"]
    case "text":
      return undefined
  }
}

/** Human labels for the enum values (screen ids, skill targets, lock modes). */
export function optionLabel(kind: ToolFieldKind, value: string): string {
  if (kind === "target") return SKILL_TARGET_LABEL[value as NeedleSkillTarget] ?? value
  if (kind === "screen") return value.charAt(0).toUpperCase() + value.slice(1)
  if (kind === "mode") return value === "no-ai" ? "No AI" : "Read-only"
  return value
}

/** The tools the model sees, with enums filled from what is on disk right now. */
export function buildTools(ctx: NeedleContext, only?: string[]): NeedleTool[] {
  return TOOL_SPECS.filter((spec) => !only || only.includes(spec.name)).map((spec) => {
    const properties: Record<string, unknown> = {}
    const required: string[] = []
    for (const field of spec.fields) {
      const values = fieldOptions(field.kind, ctx)
      properties[field.key] = {
        type: "string",
        description: field.label,
        ...(values && values.length > 0 ? { enum: values } : {}),
      }
      if (!field.optional) required.push(field.key)
    }
    return {
      name: spec.name,
      description: spec.description,
      parameters: { type: "object" as const, properties, required },
    }
  })
}

function text(value: unknown): string {
  if (value === null || value === undefined) return ""
  return String(value).trim()
}

/** One plain sentence for a call, shown in the palette and on the confirm card. */
export function callSentence(call: NeedleCall): string {
  const a = call.arguments ?? {}
  const project = text(a.project)
  switch (call.name) {
    case "filter_projects": {
      const status = text(a.status)
      const category = text(a.category)
      if (status && category) return `Show ${status} projects in ${category}`
      if (status) return `Show ${status} projects`
      if (category) return `Show projects in ${category}`
      return "Show all projects"
    }
    case "open_project":
      return `Open ${project || "a project"}`
    case "project_overview":
      return `Show what's left on ${project || "a project"}`
    case "add_task":
      return `Add task "${text(a.task)}" to ${project || "a project"}`
    case "log_work": {
      const kind = text(a.kind) === "update" ? "update" : "task"
      const next = text(a.next)
      return `Log ${kind} "${text(a.text)}" on ${project || "a project"}${next ? `, next "${next}"` : ""}`
    }
    case "set_next":
      return `Set next step of ${project || "a project"} to "${text(a.next)}"`
    case "set_status":
      return `Set ${project || "a project"} to ${text(a.status) || "another status"}`
    case "start_version":
      return `Start the next version of ${project || "a project"}`
    case "backup_now":
      return "Back up the hub and vault now"
    case "lock_folder":
      return `Lock ${text(a.path) || "a folder"} ${text(a.mode) === "no-ai" ? "for no AI" : "read-only"}`
    case "go_to":
      return `Go to ${optionLabel("screen", text(a.screen)) || "a screen"}`
    case "open_skill":
      return `Open skill ${text(a.skill) || "a skill"}`
    case "move_skill":
      return `Move skill ${text(a.skill) || "a skill"} to ${
        SKILL_TARGET_LABEL[text(a.target) as NeedleSkillTarget] ?? "another place"
      }`
    case "open_app":
      return `Open app ${text(a.app) || "an app"}`
    default:
      return call.name.replace(/_/g, " ")
  }
}

/** Verbs that make a sentence a command rather than a search. */
const COMMAND_VERB =
  /\b(add|open|show|list|filter|log|record|set|change|start|begin|back\s*up|backup|lock|unlock|go|jump|move|copy|mark|finish|tick|switch|make)\b/i

/** True for something that reads like a plain-language command ("add a task fix login"). */
export function looksLikeCommand(input: string): boolean {
  const said = input.trim()
  if (said.split(/\s+/).length < 2) return false
  return COMMAND_VERB.test(said)
}

/** Confidence as a short percentage, or "" when the model reported none. */
export function confidenceText(confidence: number | null): string {
  return confidence === null || !Number.isFinite(confidence)
    ? ""
    : `${Math.round(confidence * 100)}%`
}

/** The lock mode of a call argument, defaulting to read-only. */
export function lockModeOf(value: unknown): LockMode {
  return text(value) === "no-ai" ? "no-ai" : "read-only"
}

/** The project status of a call argument, defaulting to the record's own status. */
export function statusOf(value: unknown, fallback: ProjectStatus): ProjectStatus {
  const said = text(value) as ProjectStatus
  return PROJECT_STATUSES.includes(said) ? said : fallback
}

// ---------------------------------------------------------------------------------------------
// Grounding. Needle fills every argument it can, so a question about one project used to come back
// as "Show idea projects in automation". A call may only use what the sentence actually says: an
// argument the user never said is dropped, and a call that loses a required argument is not shown.
// ---------------------------------------------------------------------------------------------

/** Lowercase words only, so "AI-Tooling" and "ai tooling" compare equal. */
function fold(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
}

/** True when the phrase is said in the input, letter by letter with the spaces removed. */
export function says(input: string, phrase: string): boolean {
  const target = fold(phrase)
  if (!target) return false
  const said = fold(input)
  if (` ${said} `.includes(` ${target} `)) return true
  return said.replace(/ /g, "").includes(target.replace(/ /g, ""))
}

/** A project, skill or app name: whole, without spaces, or one word of four or more letters. */
export function mentionsName(input: string, name: string): boolean {
  const target = fold(name)
  if (!target) return false
  if (says(input, name)) return true
  return target.split(" ").some((word) => word.length >= 4 && says(input, word))
}

/** The longest name the input mentions, so "Corvoid Commerce Hub" wins over a shorter project. */
export function mentionsAnyName(input: string, names: string[]): string | null {
  const matches = names.filter((name) => mentionsName(input, name))
  if (matches.length === 0) return null
  return matches.reduce((best, name) => (fold(name).length > fold(best).length ? name : best))
}

/** An enum value (status, category, kind, screen, mode, target): the value, its label or one word of it. */
function mentionsValue(
  input: string,
  kind: ToolFieldKind,
  value: string,
  ctx: NeedleContext
): boolean {
  const labels = [value, optionLabel(kind, value)]
  if (kind === "category") {
    const category = (ctx.categories ?? []).find((c) => c.slug === value)
    if (category) labels.push(category.name)
  }
  return labels.some((label) => {
    if (says(input, label)) return true
    // "game-dev" also counts when the sentence says just "game".
    return fold(label)
      .split(" ")
      .some((part) => part.length >= 3 && says(input, part))
  })
}

/** Free text (task, text, next): kept only when at least half of its words are in the input. */
function mentionsText(input: string, value: string): boolean {
  const parts = fold(value).split(" ").filter(Boolean)
  if (parts.length === 0) return false
  const hits = parts.filter((part) => says(input, part)).length
  return hits * 2 >= parts.length
}

/** A path counts only when it is in the input as typed. */
function mentionsPath(input: string, value: string): boolean {
  const target = fold(value)
  return target !== "" && fold(input).replace(/ /g, "").includes(target.replace(/ /g, ""))
}

/** True when the sentence supports this argument. */
function argumentSaid(
  input: string,
  field: ToolField,
  value: string,
  ctx: NeedleContext
): boolean {
  switch (field.kind) {
    case "project":
    case "skill":
    case "app":
      return mentionsName(input, value)
    case "status":
    case "category":
    case "kind":
    case "screen":
    case "mode":
    case "target":
      return mentionsValue(input, field.kind, value, ctx)
    case "text":
      return field.key === "path" ? mentionsPath(input, value) : mentionsText(input, value)
  }
}

/** Keeps only the calls (and arguments) the sentence supports. */
export function groundCalls(input: string, calls: NeedleCall[], ctx: NeedleContext): NeedleCall[] {
  const out: NeedleCall[] = []
  for (const call of calls) {
    const spec = toolSpec(call.name)
    if (!spec) continue
    const raw = call.arguments ?? {}
    const kept: Record<string, unknown> = {}
    let usable = true
    for (const field of spec.fields) {
      const value = text(raw[field.key])
      if (!value) {
        // A required argument the model left out makes the call unusable; an optional one stays out.
        if (!field.optional) usable = false
        continue
      }
      if (argumentSaid(input, field, value, ctx)) {
        kept[field.key] = raw[field.key]
      } else if (!field.optional) {
        usable = false
        break
      }
    }
    // "Filter projects" with no grounded filter is just the projects screen: not an action.
    if (usable && call.name === "filter_projects" && Object.keys(kept).length === 0) usable = false
    if (usable) out.push({ name: call.name, arguments: kept })
  }
  return out
}

/** Grounds a whole answer. Held calls are also dropped below confidence 0.05. */
export function groundResult(
  input: string,
  result: NeedleResult,
  ctx: NeedleContext
): NeedleResult {
  const confidence = result.confidence
  const heldUsable = confidence === null || confidence >= 0.05
  return {
    ...result,
    calls: groundCalls(input, result.calls, ctx),
    held: heldUsable ? groundCalls(input, result.held, ctx) : [],
  }
}

// ---------------------------------------------------------------------------------------------
// Questions. Only commands go to Needle; a question about a project is answered by the app itself.
// ---------------------------------------------------------------------------------------------

/** Sentences that end with "?" or open with a question word. */
const QUESTION_START =
  /^(what|whats|why|how|hows|when|where|which|who|whom|whose|is|are|can|could|does|do|did|should|will|would|any)\b/i

export function looksLikeQuestion(input: string): boolean {
  const said = input.trim()
  if (!said) return false
  if (said.endsWith("?")) return true
  return QUESTION_START.test(said)
}

/** Question shapes that ask for a project's state ("what's left on X", "X status", "show X tasks"). */
const OVERVIEW_FORMS: RegExp[] = [
  /^(?:what(?:'s|s| is| are)?|anything)\s+(?:left|next|remaining|todo|to do|still)\b/i,
  /^what(?:'s|s| is)?\s+(?:the\s+)?(?:status|progress|tasks|todos)\b/i,
  /^how(?:'s|s| is| are)?\s+.+\s+(?:going|doing)\b/i,
  /^(?:show|list|tell me about|give me)\s+.+\s+(?:tasks|todos|status|progress|left|next)\b/i,
  /\b(?:status|tasks|todos|progress)\s*$/i,
]

/**
 * The project a question asks about, or null. This is the built-in answer that runs before (and
 * instead of) Needle, so "what's left on Corvogames" never becomes a filter command.
 */
export function projectQuestion(input: string, projectNames: string[]): string | null {
  const said = input.trim().replace(/[?!.]+$/, "")
  if (!said) return null
  if (!OVERVIEW_FORMS.some((form) => form.test(said))) return null
  return mentionsAnyName(said, projectNames)
}

const FILTER_START = /^(show|list|filter|find|which)\b/i

/**
 * A "show paused projects" / "show me ai tooling stuff" filter built without the model: only the
 * status or category words the sentence actually contains, from the live lists. Never invents one.
 */
export function builtinProjectFilter(input: string, ctx: NeedleContext): NeedleCall | null {
  const said = input.trim()
  if (!said || looksLikeQuestion(said) || !FILTER_START.test(said)) return null
  const args: Record<string, string> = {}
  const status = PROJECT_STATUSES.find((value) => mentionsValue(said, "status", value, ctx))
  if (status) args.status = status
  // The longest category first, so "game dev" wins over a slug that merely shares a word.
  const category = (ctx.categories ?? [])
    .map((c) => c.slug)
    .sort((a, b) => fold(b).length - fold(a).length)
    .find((slug) => mentionsValue(said, "category", slug, ctx))
  if (category) args.category = category
  return Object.keys(args).length > 0 ? { name: "filter_projects", arguments: args } : null
}
