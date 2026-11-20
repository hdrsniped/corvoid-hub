import { hubRulesPath } from "./hub"
import { pathExists, writeNote } from "./fs"
import { isoDate } from "./format"
import { HARNESS_LABEL, type AiHarnessId } from "./harness"
import { patchNote } from "./markdown"
import { readSection } from "./sections"
import { projectNotePath, type ProjectRecord } from "./vault"

/**
 * Handing a project to another harness: a self-contained prompt (what to read, the repo, the version,
 * the open tasks) and the note write that records the new harness. Nothing else is stored, so an agent
 * or a person can do the same by hand.
 */

/** Open tasks of the project note (`## Next`), in note order. */
export function openTaskTexts(record: ProjectRecord): string[] {
  return readSection(record.note.body, "Next").flatMap((b) =>
    b.kind === "item" ? [b.text] : []
  )
}

/** True when the path is on disk. A failed check counts as missing. */
async function exists(path: string): Promise<boolean> {
  try {
    return await pathExists(path)
  } catch {
    return false
  }
}

/** The prompt an agent of the next harness can start from. Paths that are not on disk are left out. */
export async function buildContinuePrompt(
  record: ProjectRecord
): Promise<string> {
  const { project } = record
  const repo = (project.repo ?? "").trim()

  const read: string[] = []
  const rules = hubRulesPath()
  if (await exists(rules)) read.push(`${rules} (global rules)`)
  if (repo) {
    const agents = `${repo}\\AGENTS.md`
    if (await exists(agents)) read.push(agents)
    const handoff = `${repo}\\.ai\\HANDOFF.md`
    if (await exists(handoff)) read.push(handoff)
  }
  read.push(`the project note ${project.notePath}`)

  const total = project.done + project.open
  const tasks = openTaskTexts(record)
  const from = (project.harness ?? "").trim() || "no harness"

  const lines = [
    `Continue project ${project.name}. You are taking over from ${from}.`,
    `Read first: ${read.join(", ")}.`,
    `Repo: ${repo || "not set"}. Version v${project.version}, progress ${project.done}/${total}. Next step: ${
      (project.next ?? "").trim() || "not set"
    }.`,
  ]
  if (tasks.length === 0) lines.push("Open tasks: none.")
  else lines.push("Open tasks:", ...tasks.map((t) => `- ${t}`))
  lines.push(
    `Start with the first open task; log per the project's log mode (${(project.log ?? "").trim() || "on-demand"}).`
  )
  return lines.join("\n")
}

/** Takes the project over in `harness`: writes `harness` and `updated`, keeps every other key and the body. */
export async function setProjectHarness(
  record: ProjectRecord,
  harness: AiHarnessId
): Promise<void> {
  const note = patchNote(record.note, {
    harness: HARNESS_LABEL[harness],
    updated: isoDate(),
  })
  await writeNote(projectNotePath(record.project.name), note)
}
