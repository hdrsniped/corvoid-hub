import { listEntries, resolvePath, skillRoots, tryReadText, writeText, type ListedEntry, type SkillRootPaths } from "./fs"
import { assertUnlocked } from "./locks"
import { parseNote, stringifyNote } from "./markdown"

// Skill model for the Skills screen. Scans the hub, Claude Code and Antigravity skill folders.
// Hub skills are the source; a harness copy with the same name (or a symlink into the hub) is the same skill.

export type LocalHarness = "claude-code" | "antigravity"
export type SkillSource = "hub" | LocalHarness

export interface SkillFile {
  /** Path inside the skill folder, forward slashes. */
  rel: string
  name: string
  isDir: boolean
  depth: number
  size: number
  /** Unix seconds. */
  modified: number | null
}

/** Features found by scanning SKILL.md and the text files of the skill folder. */
export interface SkillUses {
  /** Environment variables and API key names. */
  env: string[]
  /** GitHub repos as owner/repo. */
  repos: string[]
  /** Other web hosts. */
  domains: string[]
  /** MCP server names (from mcp__server__tool). */
  mcp: string[]
  /** First word of each command line in shell code blocks. */
  commands: string[]
  /** Script files in the folder (rel paths). */
  scripts: string[]
}

export interface SkillEntry {
  /** Unique within the index: "hub:<folder>", "claude-code:<folder>" or "antigravity:<folder>". */
  key: string
  /** Name from the frontmatter, or the folder name. */
  name: string
  description: string
  /** Folder name on disk. */
  folder: string
  hasSkillFile: boolean
  source: SkillSource
  /** Harnesses the skill is present in. For hub skills: where it is synced; for local ones: its own harness. */
  harnesses: LocalHarness[]
  /** Folder on disk. Hub skills point into the hub; local ones into the harness folder. */
  dir: string
  /**
   * True when this hub skill is only present in a harness folder as a link created by hub-sync.
   * Transfer and remove are disabled for it: the hub owns it.
   */
  linked: boolean
  /** Everything in the folder (depth-first, folders before files). */
  files: SkillFile[]
  fileCount: number
  /** Newest file modification, unix seconds. */
  modified: number | null
  uses: SkillUses
}

export interface SkillIndex {
  skills: SkillEntry[]
  roots: SkillRootPaths
}

export const SOURCE_LABEL: Record<SkillSource, string> = {
  hub: "Hub",
  "claude-code": "Claude Code",
  antigravity: "Antigravity",
}

export function usesTotal(u: SkillUses): number {
  return u.env.length + u.repos.length + u.domains.length + u.mcp.length + u.commands.length + u.scripts.length
}

const MAX_FILES = 400
const MAX_DEPTH = 4
const MAX_READ_BYTES = 200_000
const SKIP_DESCEND = new Set(["node_modules", ".git", "__pycache__"])
const TEXT_EXT = /\.(md|txt|json|jsonc|ya?ml|toml|ini|cfg|csv|ps1|psm1|sh|bash|zsh|py|js|mjs|cjs|ts|tsx|jsx|rb|go|rs|cmd|bat|pl|lua|html|css|xml)$/i
const SCRIPT_EXT = /\.(ps1|psm1|sh|bash|zsh|py|js|mjs|cjs|ts|rb|go|cmd|bat|pl|lua)$/i
const SHELL_LANGS = new Set(["", "sh", "bash", "zsh", "shell", "console", "powershell", "ps1", "pwsh", "cmd", "bat"])
const NOT_COMMANDS = new Set([
  "cd", "echo", "if", "elif", "else", "fi", "for", "while", "do", "done", "then", "case", "esac", "in", "set", "export",
  "unset", "return", "exit", "print", "let", "const", "var", "function", "def", "import", "from", "class", "true", "false",
  "null", "local", "source", "end", "try", "catch", "throw", "await", "async", "new", "fn", "pub", "use", "package",
  "module", "require", "struct", "impl", "param", "foreach", "break", "continue", "else", "switch",
])
const GITHUB_SKIP_OWNERS = new Set(["topics", "orgs", "features", "marketplace", "sponsors", "apps", "settings", "login", "about", "collections", "search"])

const RE_VAULT_RUN = /\bvault\s+run\s+([A-Za-z_][A-Za-z0-9_]*(?:\s*,\s*[A-Za-z_][A-Za-z0-9_]*)*)/g
const RE_ENV_REFS = [
  /\$env:([A-Za-z_]\w*)/g,
  /process\.env\.([A-Za-z_]\w*)/g,
  /process\.env\[\s*['"`]([A-Za-z_]\w*)['"`]\s*\]/g,
  /os\.environ(?:\.get)?\s*[[(]\s*['"]([A-Za-z_]\w*)['"]/g,
  /\bgetenv\(\s*['"]([A-Za-z_]\w*)['"]/g,
]
const RE_KEY_NAMES = /\b([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*_(?:KEY|TOKEN|API))\b/g
const RE_GITHUB = /github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/g
const RE_URL = /https?:\/\/([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)/g
const RE_MCP = /mcp__([A-Za-z0-9-]+(?:_[A-Za-z0-9-]+)*?)__[A-Za-z0-9_-]+/g
const RE_FENCE = /```([A-Za-z0-9_+-]*)[^\n]*\n([\s\S]*?)```/g
const RE_COMMAND_WORD = /^([A-Za-z][A-Za-z0-9_.-]*)(?=\s|$)/

export function joinWin(dir: string, rel: string): string {
  return rel ? `${dir}\\${rel.split("/").join("\\")}` : dir
}

/** Lowercase, backslashes, no trailing slash. For comparing Windows paths. */
function normWin(p: string): string {
  return p.split("/").join("\\").replace(/\\+$/, "").toLowerCase()
}

async function walk(dir: string, rel: string, depth: number, out: SkillFile[]): Promise<void> {
  if (depth > MAX_DEPTH) return
  let entries: ListedEntry[]
  try {
    entries = await listEntries(joinWin(dir, rel))
  } catch {
    // An unreadable or out-of-root folder (for example a link elsewhere) shows as empty.
    return
  }
  for (const e of entries) {
    if (out.length >= MAX_FILES) return
    const childRel = rel ? `${rel}/${e.name}` : e.name
    out.push({ rel: childRel, name: e.name, isDir: e.is_dir, depth, size: e.size, modified: e.modified })
    if (e.is_dir && !SKIP_DESCEND.has(e.name)) await walk(dir, childRel, depth + 1, out)
  }
}

function isReadable(f: SkillFile): boolean {
  if (f.isDir || f.size > MAX_READ_BYTES) return false
  if (f.name.toLowerCase().startsWith(".env")) return false // never read env files
  return TEXT_EXT.test(f.name) || !f.name.includes(".")
}

function addAll(set: Set<string>, re: RegExp, text: string, pick: (m: RegExpExecArray) => string | undefined) {
  for (const m of text.matchAll(re)) {
    const v = pick(m)
    if (v) set.add(v)
  }
}

/** Finds the features a skill uses. Pure: takes the text of each readable file. */
export function detectUses(texts: { rel: string; text: string }[], files: SkillFile[]): SkillUses {
  const env = new Set<string>()
  const repos = new Set<string>()
  const domains = new Set<string>()
  const mcp = new Set<string>()
  const commands = new Set<string>()

  for (const { text } of texts) {
    for (const m of text.matchAll(RE_VAULT_RUN)) {
      for (const n of m[1].split(",")) env.add(n.trim())
    }
    for (const re of RE_ENV_REFS) addAll(env, re, text, (m) => m[1])
    addAll(env, RE_KEY_NAMES, text, (m) => m[1])

    addAll(repos, RE_GITHUB, text, (m) => {
      const owner = m[1]
      if (GITHUB_SKIP_OWNERS.has(owner.toLowerCase())) return undefined
      const repo = m[2].replace(/\.git$/, "").replace(/\.+$/, "")
      return repo ? `${owner}/${repo}` : undefined
    })

    addAll(domains, RE_URL, text, (m) => {
      const host = m[1].toLowerCase().replace(/^www\./, "")
      return host === "github.com" ? undefined : host
    })

    addAll(mcp, RE_MCP, text, (m) => m[1])

    for (const fence of text.matchAll(RE_FENCE)) {
      if (!SHELL_LANGS.has(fence[1].toLowerCase())) continue
      for (const raw of fence[2].split("\n")) {
        let line = raw.trim()
        if (!line || line.startsWith("#") || line.startsWith("//")) continue
        line = line.replace(/^(PS[^>\n]*>|\$|>)\s*/, "")
        const word = RE_COMMAND_WORD.exec(line)?.[1]
        if (word && !NOT_COMMANDS.has(word.toLowerCase())) commands.add(word)
      }
    }
  }

  const scripts = files.filter((f) => !f.isDir && SCRIPT_EXT.test(f.name)).map((f) => f.rel)
  const sorted = (s: Set<string>) => [...s].sort((a, b) => a.localeCompare(b))
  return {
    env: sorted(env),
    repos: sorted(repos),
    domains: sorted(domains),
    mcp: sorted(mcp),
    commands: sorted(commands),
    scripts,
  }
}

async function readSkill(args: {
  key: string
  source: SkillSource
  folder: string
  dir: string
  harnesses: LocalHarness[]
  linked: boolean
}): Promise<SkillEntry> {
  const files: SkillFile[] = []
  await walk(args.dir, "", 0, files)

  const texts: { rel: string; text: string }[] = []
  for (const f of files) {
    if (!isReadable(f)) continue
    const text = await tryReadText(joinWin(args.dir, f.rel))
    if (text !== null) texts.push({ rel: f.rel, text })
  }

  const hasSkillFile = files.some((f) => !f.isDir && f.rel === "SKILL.md")
  let name = args.folder
  let description = ""
  const skillText = texts.find((t) => t.rel === "SKILL.md")?.text
  if (skillText !== undefined) {
    try {
      const note = parseNote(skillText)
      if (note.data.name) name = String(note.data.name)
      if (note.data.description) description = String(note.data.description).trim()
    } catch {
      // Frontmatter that is not a mapping: keep the folder name and show no description.
    }
  }

  const mtimes = files.map((f) => f.modified).filter((m): m is number => m !== null)
  return {
    key: args.key,
    name,
    description,
    folder: args.folder,
    hasSkillFile,
    source: args.source,
    harnesses: args.harnesses,
    linked: args.linked,
    dir: args.dir,
    files,
    fileCount: files.filter((f) => !f.isDir).length,
    modified: mtimes.length ? Math.max(...mtimes) : null,
    uses: detectUses(texts, files),
  }
}

/** Scans all three skill folders. Hub skills absorb same-named copies and symlinks into the hub. */
export async function loadSkillIndex(): Promise<SkillIndex> {
  const roots = await skillRoots()
  // A fresh install may not have the hub skills folder yet: that is an empty list, not an error.
  let hubEntries: ListedEntry[]
  try {
    hubEntries = await listEntries(roots.hub)
  } catch {
    hubEntries = []
  }
  const hubDirs = hubEntries.filter((e) => e.is_dir && !e.name.startsWith("."))
  const hubNames = new Set(hubDirs.map((e) => e.name))
  const hubRoot = normWin(roots.hub)

  // Which harness folders hold a copy of each hub skill, and which of those copies are links.
  const presence = new Map<string, LocalHarness[]>()
  const linked = new Set<string>()
  const locals: { source: LocalHarness; folder: string; dir: string }[] = []
  const harnessRoots: [LocalHarness, string | null][] = [
    ["claude-code", roots.claude],
    ["antigravity", roots.gemini],
  ]
  for (const [source, root] of harnessRoots) {
    if (!root) continue
    let entries: ListedEntry[]
    try {
      entries = await listEntries(root)
    } catch {
      continue
    }
    for (const e of entries) {
      if (!e.is_dir || e.name.startsWith(".")) continue
      const dir = `${root}\\${e.name}`
      let linkedToHub = false
      if (e.symlink) {
        try {
          linkedToHub = normWin(await resolvePath(dir)).startsWith(`${hubRoot}\\`)
        } catch {
          linkedToHub = false
        }
      }
      if (hubNames.has(e.name) || linkedToHub) {
        presence.set(e.name, [...(presence.get(e.name) ?? []), source])
        if (e.symlink || linkedToHub) linked.add(e.name)
      } else {
        locals.push({ source, folder: e.name, dir })
      }
    }
  }

  const hub = hubDirs.map((e) =>
    readSkill({
      key: `hub:${e.name}`,
      source: "hub",
      folder: e.name,
      dir: `${roots.hub}\\${e.name}`,
      harnesses: presence.get(e.name) ?? [],
      linked: linked.has(e.name),
    })
  )
  const local = locals.map((l) =>
    readSkill({
      key: `${l.source}:${l.folder}`,
      source: l.source,
      folder: l.folder,
      dir: l.dir,
      harnesses: [l.source],
      linked: false,
    })
  )
  const skills = await Promise.all([...hub, ...local])
  // Hub skills first, then harness-local ones; alphabetical inside each group.
  skills.sort(
    (a, b) =>
      Number(a.source !== "hub") - Number(b.source !== "hub") ||
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  )
  return { skills, roots }
}

/** "today", "3d ago", "2mo ago" for a unix-seconds timestamp. */
export function formatAgo(unixSecs: number | null): string {
  if (unixSecs === null) return "unknown"
  const days = Math.floor((Date.now() / 1000 - unixSecs) / 86_400)
  if (days <= 0) return "today"
  if (days === 1) return "yesterday"
  if (days < 31) return `${days}d ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

/** Fields of a SKILL.md, plus the untouched frontmatter so a save keeps unknown keys. */
export interface SkillMd {
  exists: boolean
  data: Record<string, unknown>
  body: string
  eol: string
}

export async function loadSkillMd(dir: string): Promise<SkillMd> {
  const text = await tryReadText(`${dir}\\SKILL.md`)
  if (text === null) return { exists: false, data: {}, body: "", eol: "\n" }
  const note = parseNote(text)
  return { exists: true, data: note.data, body: note.body, eol: note.eol }
}

export interface SkillFields {
  name: string
  description: string
  body: string
}

/** Writes SKILL.md, keeping every frontmatter key the form does not show. Creates the file if missing. */
export async function saveSkillMd(dir: string, current: SkillMd, fields: SkillFields): Promise<void> {
  await assertUnlocked(`${dir}\\SKILL.md`)
  const data: Record<string, unknown> = { ...current.data, name: fields.name.trim() }
  const description = fields.description.trim()
  if (description) data.description = description
  else delete data.description
  const body = fields.body.replace(/\r?\n/g, current.eol)
  await writeText(`${dir}\\SKILL.md`, stringifyNote({ data, body, eol: current.eol }))
}
