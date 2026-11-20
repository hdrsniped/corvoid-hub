import { useState, type ComponentType, type ReactNode } from "react"
import { ChevronDown, ChevronRight, File, FileCode, FileText, Folder, FolderOpen, Globe, KeyRound, Plug, Terminal, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useLoad } from "@/core/hooks"
import { tryReadText } from "@/core/fs"
import { joinWin, usesTotal, type SkillEntry, type SkillFile, type SkillUses } from "@/core/skills"
import { cx } from "@/core/format"

import { GithubGlyph } from "./SkillBits"

type IconType = ComponentType<{ className?: string }>

const MAX_PREVIEW_BYTES = 200_000
const SCRIPT_SHELL = /\.(sh|bash|zsh|ps1|psm1|cmd|bat)$/i

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/** Detected features of a skill, as chips grouped by kind. Icons first; the text is the value. */
export function UsesPanel({ uses, onOpenFile }: { uses: SkillUses; onOpenFile: (rel: string) => void }) {
  if (usesTotal(uses) === 0) {
    return <p className="text-sm text-muted-foreground">Nothing detected: no keys, repos, hosts, tools or commands.</p>
  }
  return (
    <div className="flex flex-col gap-2.5">
      {uses.env.length > 0 && (
        <UsesRow label="Keys and env" icon={KeyRound}>
          {uses.env.map((n) => (
            <Chip key={n} icon={KeyRound} mono>
              {n}
            </Chip>
          ))}
        </UsesRow>
      )}
      {uses.repos.length > 0 && (
        <UsesRow label="GitHub" icon={GithubGlyph}>
          {uses.repos.map((r) => (
            <Chip key={r} icon={GithubGlyph} href={`https://github.com/${r}`}>
              {r}
            </Chip>
          ))}
        </UsesRow>
      )}
      {uses.domains.length > 0 && (
        <UsesRow label="Web" icon={Globe}>
          {uses.domains.map((d) => (
            <Chip key={d} icon={Globe} href={`https://${d}`}>
              {d}
            </Chip>
          ))}
        </UsesRow>
      )}
      {uses.mcp.length > 0 && (
        <UsesRow label="MCP servers" icon={Plug}>
          {uses.mcp.map((m) => (
            <Chip key={m} icon={Plug}>
              {m}
            </Chip>
          ))}
        </UsesRow>
      )}
      {uses.commands.length > 0 && (
        <UsesRow label="Commands" icon={Terminal}>
          {uses.commands.map((c) => (
            <Chip key={c} icon={Terminal} mono>
              {c}
            </Chip>
          ))}
        </UsesRow>
      )}
      {uses.scripts.length > 0 && (
        <UsesRow label="Scripts" icon={FileCode}>
          {uses.scripts.map((s) => (
            <Chip key={s} icon={SCRIPT_SHELL.test(s) ? Terminal : FileCode} mono onClick={() => onOpenFile(s)}>
              {s}
            </Chip>
          ))}
        </UsesRow>
      )}
    </div>
  )
}

function UsesRow({ label, icon: Icon, children }: { label: string; icon: IconType; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="flex w-28 shrink-0 items-center gap-1.5 pt-1 text-xs text-muted-foreground">
        <Icon className="size-3.5" />
        {label}
      </span>
      <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">{children}</div>
    </div>
  )
}

const CHIP = "inline-flex max-w-full items-center gap-1.5 rounded-md border bg-card px-2 py-1 text-xs"

function Chip({
  icon: Icon,
  children,
  href,
  onClick,
  mono,
}: {
  icon: IconType
  children: ReactNode
  href?: string
  onClick?: () => void
  mono?: boolean
}) {
  const body = (
    <>
      <Icon className="size-3 shrink-0 text-muted-foreground" />
      <span className={cx("truncate", mono && "font-mono")}>{children}</span>
    </>
  )
  // An external href is opened in the system browser by the app's navigation guard.
  if (href) {
    return (
      <a href={href} className={cx(CHIP, "hover:bg-muted")} title={href}>
        {body}
      </a>
    )
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cx(CHIP, "hover:bg-muted")}>
        {body}
      </button>
    )
  }
  return <span className={CHIP}>{body}</span>
}

function fileIcon(f: SkillFile): IconType {
  if (/\.md$/i.test(f.name)) return FileText
  if (/\.(sh|bash|zsh|ps1|psm1|cmd|bat|py|js|mjs|cjs|ts|rb|go|pl|lua)$/i.test(f.name)) return FileCode
  return File
}

/** The skill folder as an indented tree. Folders collapse; a file opens in the viewer below. */
export function SkillOverview({ skill }: { skill: SkillEntry }) {
  const [viewRel, setViewRel] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())

  function toggle(rel: string) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(rel)) next.delete(rel)
      else next.add(rel)
      return next
    })
  }

  const visible = skill.files.filter((f) => {
    const parts = f.rel.split("/")
    for (let i = 1; i < parts.length; i++) {
      if (collapsed.has(parts.slice(0, i).join("/"))) return false
    }
    return true
  })

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-medium">Uses</h3>
        <UsesPanel uses={skill.uses} onOpenFile={setViewRel} />
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">Files</h3>
          <span className="font-mono text-xs break-all text-muted-foreground">{skill.dir}</span>
        </div>
        {visible.length === 0 ? (
          <p className="text-sm text-muted-foreground">The folder is empty.</p>
        ) : (
          <div className="max-h-64 overflow-auto rounded-lg border p-1">
            {visible.map((f) => {
              const isOpen = !collapsed.has(f.rel)
              const Icon = f.isDir ? (isOpen ? FolderOpen : Folder) : fileIcon(f)
              return (
                <button
                  key={f.rel}
                  type="button"
                  onClick={() => (f.isDir ? toggle(f.rel) : setViewRel(f.rel))}
                  style={{ paddingLeft: 8 + f.depth * 14 }}
                  className={cx(
                    "flex w-full items-center gap-2 rounded-md py-1 pr-2 text-left text-sm hover:bg-muted",
                    viewRel === f.rel && "bg-muted"
                  )}
                >
                  {f.isDir ? (
                    isOpen ? (
                      <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
                    )
                  ) : (
                    <span className="size-3.5 shrink-0" />
                  )}
                  <Icon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{f.name}</span>
                  {!f.isDir && <span className="shrink-0 text-xs text-muted-foreground">{formatSize(f.size)}</span>}
                </button>
              )
            })}
          </div>
        )}
        {skill.files.length >= 400 && (
          <p className="text-xs text-muted-foreground">Showing the first 400 entries.</p>
        )}
        {viewRel && <FileViewer key={viewRel} dir={skill.dir} file={skill.files.find((f) => f.rel === viewRel)} onClose={() => setViewRel(null)} />}
      </section>
    </div>
  )
}

function FileViewer({ dir, file, onClose }: { dir: string; file: SkillFile | undefined; onClose: () => void }) {
  const tooBig = file !== undefined && file.size > MAX_PREVIEW_BYTES
  const path = file ? joinWin(dir, file.rel) : ""
  const text = useLoad(() => (file && !tooBig ? tryReadText(path) : Promise.resolve(null)), [path, tooBig])

  return (
    <div className="flex flex-col overflow-hidden rounded-lg border">
      <div className="flex items-center justify-between gap-2 border-b bg-muted/50 px-3 py-1.5">
        <span className="min-w-0 truncate font-mono text-xs">{file?.rel}</span>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close file">
          <X />
        </Button>
      </div>
      {file && tooBig ? (
        <p className="p-3 text-sm text-muted-foreground">Too large to preview ({formatSize(file.size)}).</p>
      ) : text.loading ? (
        <p className="p-3 text-sm text-muted-foreground">Loading...</p>
      ) : text.data === null || text.data === undefined ? (
        <p className="p-3 text-sm text-muted-foreground">This file cannot be previewed as text.</p>
      ) : (
        <pre className="max-h-96 overflow-auto p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words">
          {text.data}
        </pre>
      )}
    </div>
  )
}
