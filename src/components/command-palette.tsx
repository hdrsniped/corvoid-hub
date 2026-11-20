import { useEffect, useMemo, useRef, useState } from "react"
import {
  AppWindow,
  ArchiveRestore,
  FolderKanban,
  Loader2,
  Plus,
  Settings2,
  Sparkles,
} from "lucide-react"
import { toast } from "sonner"

import { HarnessIcon } from "@/components/harness-icon"
import { HubMarkIcon } from "@/components/hub-mark"
import { NeedleConfirm } from "@/components/needle-confirm"
import { openSetup } from "@/components/setup-dialog"
import { TermIcon } from "@/components/term-icon"
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command"
import { loadApps, type AppEntry } from "@/core/apps"
import { backupNow } from "@/core/backup"
import { loadCategories, type Category } from "@/core/categories"
import { cfg } from "@/core/config"
import { errorMessage } from "@/core/errors"
import { loadGlossary, type GlossaryTerm } from "@/core/glossary"
import { navigate } from "@/core/navigation"
import {
  NEEDLE_DOT_KEY,
  NEEDLE_SEEN_EVENT,
  buildTools,
  callSentence,
  isNeedleReady,
  looksLikeCommand,
  needleAsk,
  needleStatus,
  needleTipSeen,
  rememberNeedleTip,
  toolSpec,
  type NeedleCall,
  type NeedleContext,
  type NeedleResult,
  type NeedleStatus,
} from "@/core/needle"
import { reportNeedleError, runNeedleCall } from "@/core/needle-actions"
import { loadSkillIndex, SOURCE_LABEL, type SkillEntry } from "@/core/skills"
import { loadProjects, type ProjectRecord } from "@/core/vault"
import { modules } from "@/modules/registry"

/** Window event that opens the palette, so the sidebar hint does not need the palette's state. */
const OPEN_EVENT = "hub:command"

export function openCommandPalette(): void {
  window.dispatchEvent(new Event(OPEN_EVENT))
}

interface PaletteData {
  projects: ProjectRecord[]
  apps: AppEntry[]
  skills: SkillEntry[]
  categories: Category[]
  terms: GlossaryTerm[]
}

/** Everything the palette searches. Same loaders as the screens, so nothing is stored twice. */
async function loadPalette(): Promise<PaletteData> {
  const c = cfg()
  // A missing root is an empty state on its own screens; the palette simply leaves that source out.
  const [projects, apps, skills, categories, terms] = await Promise.allSettled([
    c.vaultExists ? loadProjects() : Promise.resolve({ projects: [], problems: [] }),
    c.hubExists ? loadApps() : Promise.resolve({ header: "", apps: [], eol: "\n" }),
    c.hubExists ? loadSkillIndex() : Promise.resolve({ skills: [], roots: { hub: c.skills, claude: null, gemini: null } }),
    c.hubExists ? loadCategories() : Promise.resolve({ header: "", categories: [], eol: "\n" }),
    c.hubExists ? loadGlossary() : Promise.resolve([]),
  ])
  const results = [projects, apps, skills, categories, terms]
  const failed = results.filter((r) => r.status === "rejected")
  // One unreadable source should not empty the whole palette; all five means something is wrong.
  if (failed.length === results.length) throw failed[0].reason
  if (failed.length > 0) toast.error("Some palette sources could not be read")
  return {
    projects: projects.status === "fulfilled" ? projects.value.projects : [],
    apps: apps.status === "fulfilled" ? apps.value.apps : [],
    skills: skills.status === "fulfilled" ? skills.value.skills : [],
    categories: categories.status === "fulfilled" ? categories.value.categories : [],
    terms: terms.status === "fulfilled" ? terms.value : [],
  }
}

/** The index is cached for a minute: the skills scan reads many files and Ctrl+K is used often. */
const CACHE_MS = 60_000

/** How long typing pauses before the palette asks Needle. */
const ASK_DELAY_MS = 400

/**
 * Ctrl+K palette: one search over projects, apps, skills, glossary terms and screens, plus plain
 * language commands when the optional Needle add-on is ready. Enter opens the item through its hash
 * route (#/projects?open=Name, #/skills?skill=key, #/apps?focus=Name, #/guide?term=cv:x, #/screen);
 * a command that writes opens the confirm card first.
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [data, setData] = useState<PaletteData | null>(null)
  const [loadedAt, setLoadedAt] = useState(0)
  const [needle, setNeedle] = useState<NeedleStatus | null>(null)
  const [asked, setAsked] = useState<NeedleResult | null>(null)
  const [asking, setAsking] = useState(false)
  const [confirm, setConfirm] = useState<NeedleCall[] | null>(null)
  /** Answers to older questions are ignored (a later keystroke won). */
  const askSeq = useRef(0)

  const ready = isNeedleReady(needle)

  const ctx = useMemo<NeedleContext>(
    () => ({
      projects: data?.projects ?? [],
      categories: data?.categories ?? [],
      skills: data?.skills ?? [],
      apps: data?.apps ?? [],
    }),
    [data]
  )

  useEffect(() => {
    // A fresh search each time the palette opens; closing keeps the list as it was.
    const show = () => {
      setQuery("")
      setAsked(null)
      setAsking(false)
      askSeq.current += 1
      setOpen(true)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        if (open) setOpen(false)
        else show()
      }
    }
    window.addEventListener("keydown", onKey)
    window.addEventListener(OPEN_EVENT, show)
    return () => {
      window.removeEventListener("keydown", onKey)
      window.removeEventListener(OPEN_EVENT, show)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    if (data && Date.now() - loadedAt < CACHE_MS) return
    let cancelled = false
    loadPalette()
      .then((next) => {
        if (cancelled) return
        setData(next)
        setLoadedAt(Date.now())
      })
      .catch((e: unknown) => {
        if (!cancelled) toast.error(errorMessage(e))
      })
    return () => {
      cancelled = true
    }
  }, [open, data, loadedAt])

  // The add-on can be set up while the app runs: read its status each time the palette opens.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    needleStatus()
      .then((status) => {
        if (cancelled) return
        setNeedle(status)
        // Ready and opened once: the sidebar's Sparkles dot has done its job.
        if (isNeedleReady(status) && !needleTipSeen(NEEDLE_DOT_KEY)) {
          rememberNeedleTip(NEEDLE_DOT_KEY)
          window.dispatchEvent(new Event(NEEDLE_SEEN_EVENT))
        }
      })
      .catch(() => {
        // Status is a hint, not a requirement: search still works.
      })
    return () => {
      cancelled = true
    }
  }, [open])

  async function askNow(input: string) {
    const text = input.trim()
    if (!text || !data) return
    const seq = ++askSeq.current
    setAsking(true)
    try {
      const result = await needleAsk(text, buildTools(ctx))
      if (askSeq.current !== seq) return
      setAsked(result)
    } catch (e) {
      if (askSeq.current === seq) toast.error(errorMessage(e))
    } finally {
      if (askSeq.current === seq) setAsking(false)
    }
  }

  // Typing a sentence that reads like a command asks Needle after a short pause.
  useEffect(() => {
    const text = query.trim()
    if (!open || !ready || !data || !looksLikeCommand(text)) return
    const timer = setTimeout(() => void askNow(text), ASK_DELAY_MS)
    return () => clearTimeout(timer)
    // askNow is recreated per render on purpose; the query and the loaded data are the triggers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, open, ready, data])

  function go(path: string, params?: Record<string, string>) {
    setOpen(false)
    navigate(path, params)
  }

  /** A safe call runs at once; a write (or any held suggestion) asks for confirmation. */
  function choose(call: NeedleCall, held: boolean) {
    const spec = toolSpec(call.name)
    if (!spec) {
      toast.error(`Unknown action ${call.name}`)
      return
    }
    if (!held && spec.safe) {
      setOpen(false)
      void runNeedleCall(call, ctx).catch(reportNeedleError)
      return
    }
    // Multi-call answers are confirmed together.
    const writes = asked
      ? [
          ...asked.calls.filter((c) => !toolSpec(c.name)?.safe),
          ...asked.held,
        ]
      : []
    setOpen(false)
    setConfirm(writes.length > 0 ? writes : [call])
  }

  // Two preview rows at most: the confident calls first, then a held one as "Did you mean…".
  const preview = asked
    ? [
        ...asked.calls.slice(0, 2).map((call) => ({ call, held: false })),
        ...asked.held.slice(0, 2).map((call) => ({ call, held: true })),
      ].slice(0, 2)
    : []
  const wantsCommand = looksLikeCommand(query)
  /** The add-on answered, but read no action in the sentence. */
  const noAction = asked !== null && preview.length === 0

  return (
    <>
      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="Search Corvoid Hub"
        description="Jump to a project, an app, a skill, a term or a screen, or type a command."
        className="sm:max-w-lg"
      >
        <Command>
          <CommandInput
            value={query}
            onValueChange={(value) => {
              setQuery(value)
              // A new sentence replaces the last answer; an in-flight one is ignored by its seq.
              askSeq.current += 1
              setAsked(null)
              setAsking(false)
            }}
            placeholder="Search, or type a command…"
            autoFocus
            trailing={
              ready ? (
                <span className="flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                  <Sparkles className="size-3" />
                  Needle
                </span>
              ) : undefined
            }
            onKeyDown={(e) => {
              // Tab asks right away, without waiting for the pause after typing.
              if (e.key === "Tab" && ready && query.trim()) {
                e.preventDefault()
                void askNow(query)
              }
            }}
          />
          <CommandList>
            <CommandEmpty>
              {data ? "Nothing matches." : "Reading projects, apps and skills..."}
            </CommandEmpty>

            {(asking || preview.length > 0 || noAction) && (
              <CommandGroup heading="Action">
                {asking && (
                  <CommandItem value="needle-asking" keywords={[query]} disabled>
                    <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
                    <span className="text-muted-foreground">Asking Needle…</span>
                  </CommandItem>
                )}
                {noAction && (
                  <CommandItem value="needle-none" keywords={[query]} disabled>
                    <Sparkles className="size-3.5 text-muted-foreground" />
                    <span className="text-muted-foreground">No action found in that sentence.</span>
                  </CommandItem>
                )}
                {preview.map(({ call, held }, index) => {
                  const spec = toolSpec(call.name)
                  const Icon = spec?.icon ?? Sparkles
                  return (
                    <CommandItem
                      key={`${call.name}-${index}`}
                      value={`needle-action-${index}`}
                      keywords={[query, callSentence(call)]}
                      onSelect={() => choose(call, held)}
                    >
                      <Icon className="size-3.5 text-muted-foreground" />
                      <span className={held ? "truncate text-muted-foreground" : "truncate"}>
                        {held ? `Did you mean… ${callSentence(call)}` : callSentence(call)}
                      </span>
                      {held ? (
                        <CommandShortcut>check</CommandShortcut>
                      ) : spec?.safe ? (
                        <CommandShortcut>open</CommandShortcut>
                      ) : (
                        <CommandShortcut>confirm</CommandShortcut>
                      )}
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            )}

            {!ready && wantsCommand && (
              <CommandGroup heading="Add-on">
                <CommandItem
                  value="needle-setup"
                  keywords={[query]}
                  onSelect={() => {
                    setOpen(false)
                    openSetup("addons")
                  }}
                >
                  <Plus className="size-3.5 text-muted-foreground" />
                  <span className="truncate text-muted-foreground">
                    Commands need the Needle add-on
                  </span>
                  <CommandShortcut>Set up</CommandShortcut>
                </CommandItem>
              </CommandGroup>
            )}

            <CommandGroup heading="Screens">
              {modules.map((m) => (
                <CommandItem
                  key={m.id}
                  value={`screen:${m.id}`}
                  keywords={[m.title, m.route]}
                  onSelect={() => go(m.route)}
                >
                  <m.icon className="size-3.5 text-muted-foreground" />
                  {m.title}
                </CommandItem>
              ))}
            </CommandGroup>

            <CommandGroup heading="App">
              <CommandItem
                value="app:setup"
                keywords={["setup", "paths", "config", "hub folder", "vault", "add-on", "needle"]}
                onSelect={() => {
                  setOpen(false)
                  openSetup()
                }}
              >
                <Settings2 className="size-3.5 text-muted-foreground" />
                Setup
              </CommandItem>
              <CommandItem
                value="app:backup"
                keywords={["backup", "archive", "zip", "snapshot", "save"]}
                onSelect={() => {
                  setOpen(false)
                  void backupNow()
                }}
              >
                <ArchiveRestore className="size-3.5 text-muted-foreground" />
                Back up now
              </CommandItem>
            </CommandGroup>

            {data && data.projects.length > 0 && (
              <CommandGroup heading="Projects">
                {data.projects.map(({ project }) => (
                  <CommandItem
                    key={project.name}
                    value={`project:${project.name}`}
                    keywords={[
                      project.name,
                      project.next ?? "",
                      project.status,
                      ...project.categories,
                    ]}
                    onSelect={() => go("/projects", { open: project.name })}
                  >
                    <FolderKanban className="size-3.5 text-muted-foreground" />
                    <span className="truncate">{project.name}</span>
                    <span className="ml-auto flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                      <span className="truncate">{project.next}</span>
                      <HarnessIcon harness={project.harness} />
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {data && data.apps.length > 0 && (
              <CommandGroup heading="Apps">
                {data.apps.map((app) => (
                  <CommandItem
                    key={app.name}
                    value={`app:${app.name}`}
                    keywords={[app.name, app.what, app.run, app.path]}
                    onSelect={() => go("/apps", { focus: app.name })}
                  >
                    <AppWindow className="size-3.5 text-muted-foreground" />
                    <span className="truncate">{app.name}</span>
                    <span className="ml-auto flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                      <span className="truncate">{app.what}</span>
                      <HubMarkIcon />
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {data && data.skills.length > 0 && (
              <CommandGroup heading="Skills">
                {data.skills.map((skill) => (
                  <CommandItem
                    key={skill.key}
                    value={`skill:${skill.key}`}
                    keywords={[
                      skill.name,
                      skill.folder,
                      skill.description,
                      SOURCE_LABEL[skill.source],
                    ]}
                    onSelect={() => go("/skills", { skill: skill.key })}
                  >
                    <Sparkles className="size-3.5 text-muted-foreground" />
                    <span className="truncate">{skill.name}</span>
                    <span className="ml-auto flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                      <span className="truncate">{skill.description}</span>
                      {skill.source === "hub" ? (
                        <HubMarkIcon />
                      ) : (
                        <HarnessIcon harness={skill.source} />
                      )}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {data && data.terms.length > 0 && (
              <CommandGroup heading="Terms">
                {data.terms.map((entry) => (
                  <CommandItem
                    key={entry.key}
                    value={`term:${entry.key}`}
                    keywords={[entry.term, entry.means, entry.say]}
                    onSelect={() => go("/guide", { term: entry.term })}
                  >
                    <TermIcon icon={entry.icon} className="size-3.5" />
                    <span className="truncate font-mono text-xs">{entry.term}</span>
                    <span className="ml-auto truncate text-xs text-muted-foreground">
                      {entry.means}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </CommandDialog>

      {confirm && confirm.length > 0 && (
        <NeedleConfirm calls={confirm} ctx={ctx} onClose={() => setConfirm(null)} />
      )}
    </>
  )
}
