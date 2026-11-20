import YAML from "yaml"

import { cfg } from "./config"
import { readText, writeText } from "./fs"
import { slugify } from "./slug"

/** Shared list of project categories. Every harness reads the same file. */
export function categoriesPath(): string {
  return `${cfg().hub}\\categories.yaml`
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export interface Category {
  slug: string
  name: string
  /** OKLCH hue, integer 0-359. */
  hue: number
  /** Keys this app does not know about. Kept on save. */
  extra: Record<string, unknown>
}

export interface CategoryFile {
  /** Comment lines at the top of the file, written back unchanged. */
  header: string
  categories: Category[]
  eol: string
}

export function normalizeHue(h: number): number {
  return ((Math.round(h) % 360) + 360) % 360
}

function toCategory(raw: unknown, index: number): Category {
  const at = `categories.yaml item ${index + 1}`
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`${at} is not a key/value mapping`)
  const { slug, name, hue, ...extra } = raw as Record<string, unknown>
  if (typeof slug !== "string" || !SLUG.test(slug)) throw new Error(`${at}: slug must be kebab-case`)
  if (typeof name !== "string" || !name.trim()) throw new Error(`${at}: name is missing`)
  const h = Number(hue)
  if (hue === undefined || hue === null || !Number.isFinite(h)) throw new Error(`${at}: hue must be a number`)
  return { slug, name: name.trim(), hue: normalizeHue(h), extra }
}

export function parseCategories(text: string): CategoryFile {
  const eol = text.includes("\r\n") ? "\r\n" : "\n"
  const lines = text.split(/\r?\n/)
  let i = 0
  while (i < lines.length && (lines[i].trim() === "" || lines[i].trimStart().startsWith("#"))) i++
  const header = lines.slice(0, i).join("\n").trimEnd()
  const body = lines.slice(i).join("\n")
  const parsed: unknown = body.trim() === "" ? [] : YAML.parse(body)
  if (!Array.isArray(parsed)) throw new Error("categories.yaml must be a list")
  return { header, categories: parsed.map(toCategory), eol }
}

export function serializeCategories(file: CategoryFile): string {
  const list = file.categories.map((c) => ({ slug: c.slug, name: c.name, hue: c.hue, ...c.extra }))
  const yaml = YAML.stringify(list, { lineWidth: 0 }).replace(/\r?\n/g, file.eol)
  const head = file.header ? file.header.replace(/\r?\n/g, file.eol) + file.eol + file.eol : ""
  return head + yaml
}

export async function loadCategories(): Promise<CategoryFile> {
  return parseCategories(await readText(categoriesPath()))
}

export async function saveCategories(file: CategoryFile): Promise<void> {
  await writeText(categoriesPath(), serializeCategories(file))
}

/** Slug for a new category: kebab-case from the name, unique among existing slugs. Throws when unusable. */
export function newCategorySlug(name: string, existing: string[]): string {
  const slug = slugify(name)
  if (!slug) throw new Error("the name needs at least one letter or digit")
  if (existing.includes(slug)) throw new Error(`a category with slug "${slug}" already exists`)
  return slug
}

/** The hue (0-359) whose smallest circular distance to any existing hue is largest. */
export function farthestHue(hues: number[]): number {
  if (hues.length === 0) return 200
  let best = 0
  let bestDistance = -1
  for (let h = 0; h < 360; h++) {
    let nearest = 360
    for (const other of hues) {
      const diff = Math.abs(h - other) % 360
      nearest = Math.min(nearest, diff, 360 - diff)
    }
    if (nearest > bestDistance) {
      bestDistance = nearest
      best = h
    }
  }
  return best
}

export function categoryBySlug(categories: Category[], slug: string | undefined): Category | undefined {
  if (!slug) return undefined
  return categories.find((c) => c.slug === slug)
}

/**
 * Reads a project's `category` frontmatter value as a list of slugs, in order (first = main).
 * Accepts the YAML list and the old single string. Blank and repeated entries are dropped.
 */
export function categoriesFromField(value: unknown): string[] {
  const raw: unknown[] = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]
  const out: string[] = []
  for (const item of raw) {
    const slug = String(item ?? "").trim()
    if (slug && !out.includes(slug)) out.push(slug)
  }
  return out
}
