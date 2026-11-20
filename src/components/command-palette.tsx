import { useEffect, useState } from "react"
import { AppWindow, FolderKanban, Sparkles } from "lucide-react"
import { toast } from "sonner"

import { HarnessIcon } from "@/components/harness-icon"
import { HubMarkIcon } from "@/components/hub-mark"
import { TermIcon } from "@/components/term-icon"
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { loadApps, type AppEntry } from "@/core/apps"
import { cfg } from "@/core/config"
import { errorMessage } from "@/core/errors"
import { loadGlossary, type GlossaryTerm } from "@/core/glossary"
import { navigate } from "@/core/navigation"
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
  terms: GlossaryTerm[]
}

/** Everything the palette searches. Same loaders as the screens, so nothing is stored twice. */
async function loadPalette(): Promise<PaletteData> {
  const c = cfg()
  // A missing root is an empty state on its own screens; the palette simply leaves that source out.
  const [projects, apps, skills, terms] = await Promise.allSettled([
    c.vaultExists ? loadProjects() : Promise.resolve({ projects: [], problems: [] }),
    c.hubExists ? loadApps() : Promise.resolve({ header: "", apps: [], eol: "\n" }),
    c.hubExists ? loadSkillIndex() : Promise.resolve({ skills: [], roots: { hub: c.skills, claude: null, gemini: null } }),
    c.hubExists ? loadGlossary() : Promise.resolve([]),
  ])
  const results = [projects, apps, skills, terms]
  const failed = results.filter((r) => r.status === "rejected")
  // One unreadable source should not empty the whole palette; all four means something is wrong.
  if (failed.length === results.length) throw failed[0].reason
  if (failed.length > 0) toast.error("Some palette sources could not be read")
  return {
    projects: projects.status === "fulfilled" ? projects.value.projects : [],
    apps: apps.status === "fulfilled" ? apps.value.apps : [],
    skills: skills.status === "fulfilled" ? skills.value.skills : [],
    terms: terms.status === "fulfilled" ? terms.value : [],
  }
}

/** The index is cached for a minute: the skills scan reads many files and Ctrl+K is used often. */
const CACHE_MS = 60_000

/**
 * Ctrl+K palette: one search over projects, apps, skills, glossary terms and screens. Enter opens the
 * item through its hash route (#/projects?open=Name, #/skills?skill=key, #/apps?focus=Name,
 * #/guide?term=cv:x, #/screen).
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [data, setData] = useState<PaletteData | null>(null)
  const [loadedAt, setLoadedAt] = useState(0)

  useEffect(() => {
    // A fresh search each time the palette opens; closing keeps the list as it was.
    const show = () => {
      setQuery("")
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

  function go(path: string, params?: Record<string, string>) {
    setOpen(false)
    navigate(path, params)
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Search Corvoid Hub"
      description="Jump to a project, an app, a skill, a term or a screen."
      className="sm:max-w-lg"
    >
      <Command value={query} onValueChange={setQuery}>
        <CommandInput
          placeholder="Search projects, apps, skills, terms, screens..."
          autoFocus
        />
        <CommandList>
          <CommandEmpty>
            {data ? "Nothing matches." : "Reading projects, apps and skills..."}
          </CommandEmpty>

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
  )
}
