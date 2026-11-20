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

/**
 * Asks Needle for tool calls. Rust keeps one sidecar process, answers within 15 s and restarts it
 * once when it died. `tools` is the live schema list from `buildTools`.
 */
export function needleAsk(text: string, tools: NeedleTool[]): Promise<NeedleResult> {
  return invoke<NeedleResult>("needle_ask", { text, tools })
}

/**
 * Writes needlePython / needleWeights into corvoid-hub.json (null removes both, which turns the
 * add-on off) and stops the worker, so the next command uses the new paths.
 */
export function needleConfigure(python: string | null, weights: string | null): Promise<void> {
  return invoke<void>("needle_configure", { python, weights })
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
