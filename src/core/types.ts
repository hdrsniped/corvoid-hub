import type { ComponentType } from "react"
import type { LucideIcon } from "lucide-react"

/** One entry returned by the Rust `list_dir` command. */
export interface DirEntry {
  name: string
  is_dir: boolean
  /** Unix seconds, if the filesystem reports it. */
  modified: number | null
}

export type ProjectStatus = "idea" | "active" | "blocked" | "paused" | "done"

/** A vault project hub note: `Projects/<Name>/<Name>.md`. */
export interface Project {
  name: string
  notePath: string
  status: ProjectStatus
  harness?: string
  next?: string
  updated?: string
  repo?: string
  /** Category slugs from categories.yaml. The first entry is the main category (sets the project color). Empty = none. */
  categories: string[]
  /** Log mode: "auto" logs finished tasks without asking, "on-demand" only when asked. */
  log?: string
  /** Current version of the project (frontmatter `version`, starts at 1). */
  version: number
  /** Finished tasks of the current version (items in `## Done`). */
  done: number
  /** Open tasks of the current version (items in `## Next`). */
  open: number
}

/** The main category slug of a project (its first entry), or undefined when it has none. */
export function mainCategory(categories: string[] | undefined): string | undefined {
  return categories && categories.length > 0 ? categories[0] : undefined
}

/** One daily log file: `Log/YYYY-MM-DD.md`, bullets of the form `- [[Projects/X/X|X]] — what was done (harness)`. */
export interface LogEntry {
  date: string
  path: string
  bullets: string[]
}

/** A normalized skill: `skills/<name>/SKILL.md`. */
export interface Skill {
  name: string
  description: string
  path: string
}

/** A skill waiting in `inbox/<name>/` for an agent to normalize. */
export interface InboxItem {
  name: string
  path: string
  source?: string
  date?: string
}

/** A screen of the app. Declared in src/modules/<id>/index.ts and listed once in src/modules/registry.ts. */
export interface ModuleDef {
  id: string
  title: string
  icon: LucideIcon
  /** Hash route, e.g. "/projects" (the app uses #/projects). */
  route: string
  /** The root folder the screen reads. A missing folder shows a friendly empty state instead. */
  needs: "hub" | "vault"
  component: ComponentType
}
