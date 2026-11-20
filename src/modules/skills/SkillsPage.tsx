import { useEffect, useMemo, useState } from "react"
import { Copy, Inbox, Play, RefreshCw, Search, Sparkles } from "lucide-react"
import { toast } from "sonner"

import { HarnessGlyph } from "@/components/harness-icon"
import { HubMark } from "@/components/hub-mark"
import { LockBadge } from "@/components/lock-control"
import { PageToolbar } from "@/components/page-toolbar"
import { TermHint } from "@/components/term-hint"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { errorMessage } from "@/core/errors"
import { cx } from "@/core/format"
import { runHubSync } from "@/core/fs"
import { useLoad } from "@/core/hooks"
import { inboxAgentPrompt, loadInbox } from "@/core/hub"
import { lockAt, useLocks, type LockEntry } from "@/core/locks"
import { navigate, useRoute } from "@/core/navigation"
import { DATA_CHANGED_EVENT } from "@/core/needle-actions"
import {
  loadSkillIndex,
  type SkillEntry,
  type SkillSource,
} from "@/core/skills"

import { AddSkillDialog } from "./AddSkillDialog"
import { ConnectionIcons, FeatureChips } from "./SkillBits"
import { SkillSheet } from "./SkillSheet"

type SourceFilter = "all" | SkillSource

const FILTERS: { id: SourceFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "hub", label: "Hub" },
  { id: "claude-code", label: "Claude Code" },
  { id: "antigravity", label: "Antigravity" },
]

/** Same glyphs as the cards: the hub mark for hub skills, the brand glyph for a harness folder. */
function FilterGlyph({ id }: { id: SourceFilter }) {
  if (id === "all") return null
  if (id === "hub")
    return <HubMark className="size-3.5 text-muted-foreground" />
  return <HarnessGlyph id={id} />
}

function matches(skill: SkillEntry, query: string): boolean {
  if (!query) return true
  const u = skill.uses
  const haystack = [
    skill.name,
    skill.folder,
    skill.description,
    ...u.env,
    ...u.repos,
    ...u.domains,
    ...u.mcp,
    ...u.commands,
  ]
    .join(" ")
    .toLowerCase()
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => haystack.includes(term))
}

export function SkillsPage() {
  const index = useLoad(loadSkillIndex, [])
  const inbox = useLoad(loadInbox, [])
  const { locks } = useLocks()
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState<SourceFilter>("all")
  const [manualKey, setManualKey] = useState<string | null>(null)
  const [shown, setShown] = useState<SkillEntry | null>(null)
  const [syncing, setSyncing] = useState(false)

  // The command palette opens a skill with #/skills?skill=<key>; a card click wins over the query.
  const { params } = useRoute()
  const skillParam = params.get("skill") || null
  const selectedKey = manualKey ?? skillParam

  const skills = useMemo(() => index.data?.skills ?? [], [index.data])
  const loading = index.loading || inbox.loading

  const visible = useMemo(
    () =>
      skills.filter(
        (s) =>
          (filter === "all" || s.source === filter) && matches(s, query.trim())
      ),
    [skills, filter, query]
  )

  // Keep the sheet's skill while a reload is in flight, and follow it when its key changes (after Move to Hub).
  function open(skill: SkillEntry) {
    setShown(skill)
    setManualKey(skill.key)
  }
  function onSheetChange(next: boolean) {
    if (next) return
    setManualKey(null)
    if (skillParam) navigate("/skills")
  }
  const current = skills.find((s) => s.key === selectedKey)
  if (current && current !== shown) setShown(current)

  function reloadAll() {
    index.reload()
    inbox.reload()
  }

  // A palette command can move a skill to another folder.
  useEffect(() => {
    window.addEventListener(DATA_CHANGED_EVENT, reloadAll)
    return () => window.removeEventListener(DATA_CHANGED_EVENT, reloadAll)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index.reload, inbox.reload])

  async function copyPrompt(name: string) {
    try {
      await navigator.clipboard.writeText(inboxAgentPrompt(name))
      toast.success("Agent prompt copied. Paste it into an agent session.")
    } catch {
      toast.error("Could not copy to the clipboard")
    }
  }

  async function syncNow() {
    setSyncing(true)
    try {
      await runHubSync()
      toast.success("Hub synced. Skills are now in every harness folder.")
      index.reload()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageToolbar>
        <Button
          variant="outline"
          size="sm"
          onClick={reloadAll}
          disabled={loading}
        >
          <RefreshCw className={cx(loading && "animate-spin")} />
          Refresh
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={syncNow}
          disabled={syncing}
        >
          <Play />
          {syncing ? "Syncing..." : "Sync"}
        </Button>
        <AddSkillDialog onAdded={inbox.reload} />
      </PageToolbar>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, description, keys, repos, tools"
              className="pl-8"
            />
          </div>
          <div className="flex flex-wrap gap-1">
            {FILTERS.map((f) => {
              const count =
                f.id === "all"
                  ? skills.length
                  : skills.filter((s) => s.source === f.id).length
              return (
                <Button
                  key={f.id}
                  size="sm"
                  variant={filter === f.id ? "default" : "outline"}
                  onClick={() => setFilter(f.id)}
                  aria-pressed={filter === f.id}
                >
                  <FilterGlyph id={f.id} />
                  {f.label}
                  {f.id === "hub" && <TermHint term="cv:hub" />}
                  <span className="text-muted-foreground">{count}</span>
                </Button>
              )
            })}
          </div>
        </div>

        {index.loading && index.data === undefined && (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-32 rounded-xl" />
            ))}
          </div>
        )}
        {index.data && skills.length === 0 && (
          <div className="rounded-xl border border-dashed p-10 text-center">
            <Sparkles className="mx-auto mb-3 size-8 text-muted-foreground" />
            <p className="font-medium">No skills yet</p>
            <p className="text-sm text-muted-foreground">
              Add one with Add skill; an agent normalizes it into
              skills/&lt;name&gt;/SKILL.md.
            </p>
          </div>
        )}
        {index.data && skills.length > 0 && visible.length === 0 && (
          <p className="text-sm text-muted-foreground">No skill matches.</p>
        )}
        {visible.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {visible.map((skill) => (
              <SkillCard
                key={skill.key}
                skill={skill}
                lock={lockAt(skill.dir, locks)}
                onOpen={() => open(skill)}
              />
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">
            Inbox — waiting for an agent
          </h2>
          <p className="text-sm text-muted-foreground">
            Copy the prompt and give it to an agent. It writes
            skills/&lt;name&gt;/SKILL.md and removes the inbox item.
          </p>
        </div>
        {inbox.loading && inbox.data === undefined && (
          <Skeleton className="h-24 rounded-xl" />
        )}
        {inbox.data?.length === 0 && (
          <p className="text-sm text-muted-foreground">The inbox is empty.</p>
        )}
        {inbox.data && inbox.data.length > 0 && (
          <ul className="flex flex-col gap-2">
            {inbox.data.map((item) => (
              <li
                key={item.path}
                className="flex flex-wrap items-center gap-3 rounded-lg border p-3"
              >
                <Inbox className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium break-all">{item.name}</p>
                  <p className="text-xs break-all text-muted-foreground">
                    {[item.source, item.date].filter(Boolean).join(" · ") ||
                      item.path}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => copyPrompt(item.name)}
                >
                  <Copy />
                  Copy agent prompt
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <SkillSheet
        skill={shown}
        open={selectedKey !== null}
        onOpenChange={onSheetChange}
        onChanged={index.reload}
        onMoved={(key) => {
          // The moved skill has a new key (hub, Claude Code or Antigravity), so a deep link to the old one is dropped.
          if (skillParam) navigate("/skills")
          setManualKey(key)
        }}
        onRemoved={() => {
          if (skillParam) navigate("/skills")
          setManualKey(null)
          setShown(null)
        }}
      />
    </div>
  )
}

function SkillCard({
  skill,
  lock,
  onOpen,
}: {
  skill: SkillEntry
  lock: LockEntry | undefined
  onOpen: () => void
}) {
  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onOpen()
        }
      }}
      className="h-full cursor-pointer gap-3 transition hover:ring-2 hover:ring-ring/40 focus-visible:ring-ring"
    >
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="flex min-w-0 items-center gap-2">
            <Sparkles className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate">{skill.name}</span>
          </CardTitle>
          {!skill.hasSkillFile && (
            <Badge variant="destructive">No SKILL.md</Badge>
          )}
        </div>
        <CardDescription className="line-clamp-2 min-h-10">
          {skill.description ||
            (skill.hasSkillFile
              ? "No description in frontmatter."
              : "This folder has no SKILL.md yet.")}
        </CardDescription>
      </CardHeader>
      <CardFooter className="mt-auto flex-wrap items-center justify-between gap-2 text-xs">
        <FeatureChips uses={skill.uses} />
        <span className="flex items-center gap-1">
          <LockBadge lock={lock} />
          <ConnectionIcons skill={skill} />
        </span>
      </CardFooter>
    </Card>
  )
}
