import { toast } from "sonner"

import { backupNow } from "./backup"
import { errorMessage } from "./errors"
import { logEntry, runHubSync, skillTransfer, type SkillTarget } from "./fs"
import { setLock } from "./locks"
import { navigate } from "./navigation"
import {
  NEEDLE_SCREENS,
  SKILL_TARGET_LABEL,
  lockModeOf,
  statusOf,
  type NeedleCall,
  type NeedleContext,
  type NeedleSkillTarget,
} from "./needle"
import { addItem, readSection } from "./sections"
import { loadSkillIndex } from "./skills"
import { slugify } from "./slug"
import { loadProjects, saveProject, type ProjectChange, type ProjectRecord } from "./vault"

// What a Needle call actually does. Safe calls run at once; the confirm card calls the same
// functions for the writes, so a command and a click leave the files in exactly the same state.

/** Fired after a command changed a note or the log, so an open screen reloads its data. */
export const DATA_CHANGED_EVENT = "hub:data-changed"

export function notifyDataChanged(): void {
  window.dispatchEvent(new Event(DATA_CHANGED_EVENT))
}

/** Shows one toast for a failed command. */
export function reportNeedleError(e: unknown): void {
  toast.error(errorMessage(e))
}

function text(value: unknown): string {
  return value === null || value === undefined ? "" : String(value).trim()
}

/** The project with this name, read fresh from the vault (the palette data may be a minute old). */
async function findProject(name: string): Promise<ProjectRecord> {
  const wanted = name.trim().toLowerCase()
  if (!wanted) throw new Error("no project was named")
  const { projects } = await loadProjects()
  const found = projects.find((r) => r.project.name.toLowerCase() === wanted)
  if (!found) throw new Error(`no project named "${name}"`)
  return found
}

/** Saves one project change, keeping every other field and section as it is. */
async function withProject(
  name: string,
  edit: (record: ProjectRecord) => Partial<ProjectChange>
): Promise<ProjectRecord> {
  const record = await findProject(name)
  const change: ProjectChange = {
    status: record.project.status,
    next: record.project.next ?? "",
    categories: record.project.categories,
    doneItems: readSection(record.note.body, "Done"),
    nextItems: readSection(record.note.body, "Next"),
    ...edit(record),
  }
  await saveProject(record, change)
  notifyDataChanged()
  return record
}

/** The skill with this name, folder or key. */
async function findSkill(wanted: string) {
  const said = wanted.trim().toLowerCase()
  if (!said) throw new Error("no skill was named")
  const index = await loadSkillIndex()
  const found = index.skills.find(
    (s) =>
      s.key.toLowerCase() === said ||
      s.name.toLowerCase() === said ||
      s.folder.toLowerCase() === said
  )
  if (!found) throw new Error(`no skill named "${wanted}"`)
  return found
}

const SKILL_TARGETS: Record<NeedleSkillTarget, { target: SkillTarget; source: string; label: string }> = {
  hub: { target: "hub", source: "hub", label: "Hub" },
  claude: { target: "claude", source: "claude-code", label: "Claude Code" },
  antigravity: { target: "gemini", source: "antigravity", label: "Antigravity" },
}

/** Runs one call. Safe calls navigate; writes hit the same functions the screens use. */
export async function runNeedleCall(call: NeedleCall, ctx: NeedleContext = {}): Promise<void> {
  const args = call.arguments ?? {}
  switch (call.name) {
    case "filter_projects": {
      const params: Record<string, string> = {}
      const status = text(args.status).toLowerCase()
      if (status) params.status = status
      const category = text(args.category).toLowerCase()
      if (category) params.category = category
      navigate("/projects", Object.keys(params).length > 0 ? params : undefined)
      return
    }
    case "open_project": {
      const record = await findProject(text(args.project))
      navigate("/projects", { open: record.project.name })
      return
    }
    case "project_overview": {
      // The sheet opens on its task lists (Next first), so the answer to "what's left" is in view.
      const record = await findProject(text(args.project))
      navigate("/projects", { open: record.project.name, tab: "tasks" })
      return
    }
    case "add_task": {
      const task = text(args.task)
      if (!task) throw new Error("the task is empty")
      const record = await withProject(text(args.project), (r) => ({
        nextItems: addItem(readSection(r.note.body, "Next"), task, true, false),
      }))
      toast.success(`Task added to ${record.project.name}`)
      return
    }
    case "log_work": {
      const project = text(args.project)
      const body = text(args.text)
      if (!body) throw new Error("what was done is empty")
      const kind = text(args.kind).toLowerCase() === "update" ? "update" : "task"
      const result = await logEntry({
        project,
        kind,
        text: body,
        harness: "me",
        next: text(args.next) || null,
      })
      toast.success(result.message)
      notifyDataChanged()
      return
    }
    case "set_next": {
      const next = text(args.next)
      if (!next) throw new Error("the next step is empty")
      const record = await withProject(text(args.project), () => ({ next }))
      toast.success(`Next step of ${record.project.name} set`)
      return
    }
    case "set_status": {
      const record = await withProject(text(args.project), (r) => ({
        status: statusOf(args.status, r.project.status),
      }))
      toast.success(`${record.project.name} is now ${statusOf(args.status, record.project.status)}`)
      return
    }
    case "start_version": {
      const record = await withProject(text(args.project), () => ({ startNextVersion: true }))
      toast.success(`Started v${record.project.version + 1} of ${record.project.name}`)
      return
    }
    case "backup_now":
      // backupNow shows its own toast (success or failure).
      await backupNow()
      return
    case "lock_folder": {
      const path = text(args.path)
      if (!path) throw new Error("the folder is empty")
      const mode = lockModeOf(args.mode)
      await setLock(path, mode)
      toast.success(mode === "no-ai" ? `${path} is now no-ai` : `${path} is now read-only`)
      return
    }
    case "go_to": {
      const screen = text(args.screen).replace(/^\//, "").toLowerCase()
      if (!NEEDLE_SCREENS.includes(screen)) throw new Error(`no screen called "${screen}"`)
      navigate(`/${screen}`)
      return
    }
    case "open_skill": {
      const skill = await findSkill(text(args.skill))
      navigate("/skills", { skill: skill.key })
      return
    }
    case "move_skill": {
      const wanted = text(args.target) as NeedleSkillTarget
      const target = SKILL_TARGETS[wanted]
      if (!target) throw new Error(`a skill can move to hub, claude or antigravity`)
      const skill = await findSkill(text(args.skill))
      if (skill.source === target.source) throw new Error(`${skill.name} is already in ${target.label}`)
      if (skill.linked) {
        throw new Error("Managed by the hub: change it in the hub folder.")
      }
      await skillTransfer({
        srcPath: skill.dir,
        target: target.target,
        name: slugify(skill.folder),
        keepOriginal: false,
      })
      // A hub change is followed by hub-sync, so the harness links follow the hub.
      if (skill.source === "hub" || target.target === "hub") {
        try {
          await runHubSync()
        } catch (e) {
          toast.error(`Moved, but the hub sync failed: ${errorMessage(e)}`)
        }
      }
      toast.success(`Moved ${skill.name} to ${SKILL_TARGET_LABEL[wanted]}. The original is in backups.`)
      notifyDataChanged()
      return
    }
    case "open_app": {
      const name = text(args.app)
      if (ctx.apps && ctx.apps.length > 0) {
        const found = ctx.apps.find((a) => a.name.toLowerCase() === name.toLowerCase())
        if (!found) throw new Error(`no app named "${name}"`)
        navigate("/apps", { focus: found.name })
        return
      }
      navigate("/apps", { focus: name })
      return
    }
    default:
      throw new Error(`unknown command "${call.name}"`)
  }
}

/** Runs several calls in order; the first failure stops the rest. */
export async function runNeedleCalls(calls: NeedleCall[], ctx: NeedleContext = {}): Promise<void> {
  for (const call of calls) await runNeedleCall(call, ctx)
}
