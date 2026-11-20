import { useCallback, useEffect, useState } from "react"
import YAML from "yaml"

import { cfg } from "./config"
import { errorMessage } from "./errors"
import { tryReadText } from "./fs"

/** The shared vocabulary every harness and the app read. The app only ever reads this file. */
export function glossaryPath(): string {
  return `${cfg().hub}\\glossary.yaml`
}

/** One `cv:` word from glossary.yaml. */
export interface GlossaryTerm {
  /** The word as it is typed, e.g. "cv:version". */
  term: string
  /** The same word without the prefix, the key lookups use. */
  key: string
  /** Lucide icon name in kebab-case, e.g. "git-branch". */
  icon: string
  /** The plain one-line meaning. */
  means: string
  /** An example to type in a harness, e.g. "cv:start v2". */
  say: string
}

const PREFIX = "cv:"
const DEFAULT_ICON = "book-open"

/** "cv:Log-Mode" and "log-mode" both become "log-mode". */
export function termKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/^cv:/, "")
}

function toTerm(raw: unknown, index: number): GlossaryTerm {
  const at = `glossary.yaml item ${index + 1}`
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`${at} is not a key/value mapping`)
  const { term, icon, means, say } = raw as Record<string, unknown>
  if (typeof term !== "string" || !termKey(term)) throw new Error(`${at}: term is missing`)
  if (typeof means !== "string" || !means.trim()) throw new Error(`${at}: means is missing`)
  return {
    term: `${PREFIX}${termKey(term)}`,
    key: termKey(term),
    icon: typeof icon === "string" && icon.trim() ? icon.trim() : DEFAULT_ICON,
    means: means.trim(),
    say: typeof say === "string" ? say.trim() : "",
  }
}

/** Parses glossary.yaml (a top-level list). A term listed twice keeps its first entry. */
export function parseGlossary(text: string): GlossaryTerm[] {
  const parsed: unknown = YAML.parse(text)
  if (parsed === null || parsed === undefined) return []
  if (!Array.isArray(parsed)) throw new Error("glossary.yaml must be a list")
  const out: GlossaryTerm[] = []
  parsed.forEach((raw, index) => {
    const entry = toTerm(raw, index)
    if (!out.some((t) => t.key === entry.key)) out.push(entry)
  })
  return out
}

// One read per session: the glossary is small but TermHint sits in many places.
let cache: GlossaryTerm[] | null = null
let pending: Promise<GlossaryTerm[]> | null = null

/** Reads and parses glossary.yaml. Missing file = no terms, no error. */
function readGlossary(): Promise<GlossaryTerm[]> {
  return tryReadText(glossaryPath()).then((text) => (text === null ? [] : parseGlossary(text)))
}

function shared(): Promise<GlossaryTerm[]> {
  if (cache) return Promise.resolve(cache)
  pending ??= readGlossary().then(
    (terms) => {
      cache = terms
      pending = null
      return terms
    },
    (e: unknown) => {
      pending = null
      throw e
    }
  )
  return pending
}

/** Every term, from the cache once it has been read. */
export function loadGlossary(): Promise<GlossaryTerm[]> {
  return shared()
}

/** Drops the cache so the next read sees the file as it is now. */
export function clearGlossaryCache(): void {
  cache = null
  pending = null
}

/** Looks a term up by "cv:x" or "x" (case does not matter). */
export function term(key: string, terms?: GlossaryTerm[]): GlossaryTerm | undefined {
  const wanted = termKey(key)
  const list = terms ?? cache ?? []
  return list.find((t) => t.key === wanted)
}

export interface GlossaryState {
  terms: GlossaryTerm[]
  loading: boolean
  error: string | null
  /** Reads the file again, ignoring the cache. */
  reload: () => void
}

/**
 * The glossary for a screen or a hint. Shares one cached read with every other caller, and keeps a
 * failed read in `error` instead of toasting, so a screen full of TermHints is not a toast storm.
 */
export function useGlossary(): GlossaryState {
  const [terms, setTerms] = useState<GlossaryTerm[]>(() => cache ?? [])
  const [loading, setLoading] = useState(cache === null)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    loadGlossary()
      .then((list) => {
        if (cancelled) return
        setTerms(list)
        setError(null)
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(errorMessage(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [tick])

  const reload = useCallback(() => {
    clearGlossaryCache()
    setLoading(true)
    setTick((t) => t + 1)
  }, [])

  return { terms, loading, error, reload }
}
