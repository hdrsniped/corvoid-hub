import { categoriesFromField, loadCategories, type Category } from "@/core/categories"
import { cfg } from "@/core/config"
import { listDir, tryReadText } from "@/core/fs"
import { wikiLinks } from "@/core/links"
import { parseNote } from "@/core/markdown"

export type NodeKind = "project" | "note" | "canvas" | "log" | "category"

export interface GraphNode {
  /** Vault-relative path with forward slashes, e.g. "Projects/AI Hub/AI Hub.md". Category hubs use "category:<slug>". */
  id: string
  label: string
  kind: NodeKind
  path: string
  preview: string
  /** Project folder name, for project hubs, notes and canvases. */
  project?: string
  /** Main category slug of the project (first of its categories), when it has one. Sets the project color. */
  category?: string
  /** All category slugs of the project (first = main). */
  categories?: string[]
}

export interface GraphLink {
  source: string
  target: string
  /** "link" = wikilink or canvas reference; "folder" = same project folder; "category" = category hub to project hub. */
  kind: "link" | "folder" | "category"
}

export interface GraphData {
  nodes: GraphNode[]
  links: GraphLink[]
  categories: Category[]
}

const FILE = /\.(md|canvas)$/i
const CANVAS_FILE_REF = /"file"\s*:\s*"((?:[^"\\]|\\.)*)"/g
const CANVAS_TEXT = /"text"\s*:\s*"((?:[^"\\]|\\.)*)"/g
const PREVIEW_CHARS = 600

function previewOf(fileName: string, raw: string): string {
  if (/\.canvas$/i.test(fileName)) {
    const texts = [...raw.matchAll(CANVAS_TEXT)].map((m) => m[1].replace(/\\n/g, " ").replace(/\\"/g, '"'))
    return texts.join(" · ").slice(0, PREVIEW_CHARS)
  }
  let body = raw
  try {
    body = parseNote(raw).body
  } catch {
    // Unparseable frontmatter: show the raw text instead.
  }
  return body.trim().slice(0, PREVIEW_CHARS)
}

/** Frontmatter of a hub note when it is a project note, otherwise null. */
function projectData(raw: string): Record<string, unknown> | null {
  try {
    const data = parseNote(raw).data
    return data.type === "project" ? data : null
  } catch {
    return null
  }
}

/**
 * Builds the vault graph: project hub notes, their sibling notes and canvases, log days,
 * and one hub per category linking its projects.
 * Edges come from [[wikilinks]] (resolved by path or by basename), canvas file references,
 * folder membership (hub note to each sibling), and category membership.
 */
export async function buildGraph(): Promise<GraphData> {
  const nodes: GraphNode[] = []
  const links: GraphLink[] = []
  const texts = new Map<string, string>()
  const projectHubs: Array<{ id: string; categories: string[] }> = []
  const projectsDir = cfg().projects
  const logDir = cfg().logs

  const folders = (await listDir(projectsDir)).filter((e) => e.is_dir)
  for (const folder of folders) {
    const dir = `${projectsDir}\\${folder.name}`
    const hubName = `${folder.name}.md`
    const files = (await listDir(dir)).filter((e) => !e.is_dir && FILE.test(e.name))
    const hubRaw = await tryReadText(`${dir}\\${hubName}`)
    const hub = hubRaw === null ? null : projectData(hubRaw)
    const hubIsProject = hub !== null
    const categories = categoriesFromField(hub?.category)
    const category = categories[0]
    const hubId = `Projects/${folder.name}/${hubName}`
    if (hubIsProject) projectHubs.push({ id: hubId, categories })

    const siblings: string[] = []
    for (const file of files) {
      const id = `Projects/${folder.name}/${file.name}`
      const raw = file.name === hubName ? (hubRaw ?? "") : ((await tryReadText(`${dir}\\${file.name}`)) ?? "")
      const kind: NodeKind =
        file.name === hubName && hubIsProject ? "project" : /\.canvas$/i.test(file.name) ? "canvas" : "note"
      nodes.push({
        id,
        label: file.name.replace(FILE, ""),
        kind,
        path: id,
        preview: previewOf(file.name, raw),
        project: folder.name,
        category,
        categories,
      })
      texts.set(id, raw)
      siblings.push(id)
    }
    if (hubIsProject) {
      for (const id of siblings) {
        if (id !== hubId) links.push({ source: hubId, target: id, kind: "folder" })
      }
    }
  }

  const logs = (await listDir(logDir)).filter((e) => !e.is_dir && /^\d{4}-\d{2}-\d{2}\.md$/.test(e.name))
  for (const file of logs) {
    const id = `Log/${file.name}`
    const raw = (await tryReadText(`${logDir}\\${file.name}`)) ?? ""
    nodes.push({ id, label: file.name.slice(0, 10), kind: "log", path: id, preview: previewOf(file.name, raw) })
    texts.set(id, raw)
  }

  const rank: Record<NodeKind, number> = { project: 0, note: 1, canvas: 2, log: 3, category: 4 }
  const resolve = (target: string): string | null => {
    const t = target.trim().replace(/\\/g, "/").replace(FILE, "").toLowerCase()
    if (!t) return null
    if (t.includes("/")) {
      const hit = nodes.find((n) => {
        const stem = n.id.replace(FILE, "").toLowerCase()
        return stem === t || stem.endsWith(`/${t}`)
      })
      return hit?.id ?? null
    }
    const candidates = nodes
      .filter((n) => n.label.toLowerCase() === t)
      .sort((a, b) => rank[a.kind] - rank[b.kind])
    return candidates[0]?.id ?? null
  }

  const seen = new Set<string>()
  for (const [from, raw] of texts) {
    const targets = wikiLinks(raw).map((l) => l.target)
    if (/\.canvas$/i.test(from)) {
      for (const m of raw.matchAll(CANVAS_FILE_REF)) targets.push(m[1].replace(/\\\\/g, "/"))
    }
    for (const target of targets) {
      const to = resolve(target)
      if (!to || to === from) continue
      const key = `${from}>${to}`
      if (seen.has(key)) continue
      seen.add(key)
      links.push({ source: from, target: to, kind: "link" })
    }
  }

  // Category hubs are added last so wikilink resolution never matches them by name.
  let categories: Category[]
  try {
    categories = (await loadCategories()).categories
  } catch {
    categories = []
  }
  for (const cat of categories) {
    // A project links to the hub of every one of its categories.
    const members = projectHubs.filter((p) => p.categories.includes(cat.slug))
    if (members.length === 0) continue
    const id = `category:${cat.slug}`
    nodes.push({
      id,
      label: cat.name,
      kind: "category",
      path: id,
      preview: `${members.length} project${members.length === 1 ? "" : "s"} in this category`,
      category: cat.slug,
    })
    for (const m of members) links.push({ source: id, target: m.id, kind: "category" })
  }

  return { nodes, links, categories }
}
