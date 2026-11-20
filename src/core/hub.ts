import { cfg } from "./config"
import { deleteFile, listDir, readNote, readText, tryReadText, writeText } from "./fs"
import type { InboxItem, Skill } from "./types"

/** Global rules shared by every harness. */
export function hubRulesPath(): string {
  return `${cfg().hub}\\AGENTS.md`
}

export function loadRules(): Promise<string> {
  return readText(hubRulesPath())
}

export function saveRules(text: string): Promise<void> {
  return writeText(hubRulesPath(), text)
}

export interface PackFile {
  name: string
  path: string
}

export function packPath(name: string): string {
  return `${cfg().packs}\\${name}.md`
}

export async function listPacks(): Promise<PackFile[]> {
  const packs = cfg().packs
  const files = (await listDir(packs)).filter(
    (e) => !e.is_dir && e.name.toLowerCase().endsWith(".md")
  )
  return files.map((f) => ({ name: f.name.slice(0, -3), path: `${packs}\\${f.name}` }))
}

export function loadPack(name: string): Promise<string> {
  return readText(packPath(name))
}

export function savePack(name: string, text: string): Promise<void> {
  return writeText(packPath(name), text)
}

/** Creates a new pack file. Refuses to overwrite an existing one. */
export async function createPack(name: string): Promise<void> {
  const existing = await tryReadText(packPath(name))
  if (existing !== null) throw new Error(`pack "${name}" already exists`)
  await writeText(packPath(name), `# ${name}\n\n`)
}

/** Deletes `packs/<name>.md`. The Rust side deletes single files only, never folders. */
export function deletePack(name: string): Promise<void> {
  return deleteFile(packPath(name))
}

export interface SkillEntry extends Skill {
  /** False when the folder has no SKILL.md yet. */
  hasSkillFile: boolean
}

/** Lists `skills/<name>/SKILL.md`, reading name and description from the frontmatter. */
export async function loadSkills(): Promise<SkillEntry[]> {
  const skills = cfg().skills
  const folders = (await listDir(skills)).filter((e) => e.is_dir)
  const entries = await Promise.all(
    folders.map(async (folder): Promise<SkillEntry> => {
      const path = `${skills}\\${folder.name}`
      try {
        const note = await readNote(`${path}\\SKILL.md`)
        const name = note.data.name ? String(note.data.name) : folder.name
        const description = note.data.description ? String(note.data.description) : ""
        return { name, description, path, hasSkillFile: true }
      } catch {
        return { name: folder.name, description: "", path, hasSkillFile: false }
      }
    })
  )
  return entries.sort((a, b) => a.name.localeCompare(b.name))
}

/** Lists `inbox/<name>/` folders, with source and date from INTAKE.md when present. */
export async function loadInbox(): Promise<InboxItem[]> {
  const inbox = cfg().inbox
  // No inbox folder yet = nothing waiting, not an error.
  const folders = await listDir(inbox).then(
    (all) => all.filter((e) => e.is_dir),
    () => [],
  )
  const items = await Promise.all(
    folders.map(async (folder): Promise<InboxItem> => {
      const path = `${inbox}\\${folder.name}`
      const intake = await tryReadText(`${path}\\INTAKE.md`)
      const source = intake?.match(/^- Source:\s*(.+)$/m)?.[1].trim()
      const date = intake?.match(/^- Date:\s*(.+)$/m)?.[1].trim()
      return { name: folder.name, path, source, date }
    })
  )
  return items.sort((a, b) => a.name.localeCompare(b.name))
}

export function inboxAgentPrompt(name: string): string {
  return `Normalize the skill in ${cfg().inbox}\\${name} per the hub rules.`
}
