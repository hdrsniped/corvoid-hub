import { isoDate, shortDate } from "./format"
import { harnessOf, isAiHarness, KNOWN_HARNESSES, type AiHarnessId, type HarnessId } from "./harness"
import { parseLogBullet, type LogKind } from "./links"
import { loadCategories, type Category } from "./categories"
import { loadLogs, loadProjects, type LogDay, type ProjectRecord } from "./vault"

/** One log bullet, parsed. */
export interface Entry {
  date: string
  harness: HarnessId | null
  projects: string[]
  kind: LogKind
}

export interface ActivityData {
  days: LogDay[]
  entries: Entry[]
  projects: ProjectRecord[]
  categories: Category[]
}

export async function loadActivity(): Promise<ActivityData> {
  const [days, projects, categories] = await Promise.all([
    loadLogs(),
    loadProjects().then((r) => r.projects),
    loadCategories().then(
      (f) => f.categories,
      () => []
    ),
  ])
  const entries = days.flatMap((day) =>
    day.bullets.map((raw): Entry => {
      const bullet = parseLogBullet(raw)
      return { date: day.date, harness: harnessOf(bullet.harness), projects: bullet.projects, kind: bullet.kind }
    })
  )
  return { days, entries, projects, categories }
}

// Dates are YYYY-MM-DD strings. Arithmetic runs at local noon to stay clear of DST shifts.
function parseIso(iso: string): Date {
  return new Date(`${iso}T12:00:00`)
}

export function addDays(iso: string, n: number): string {
  const d = parseIso(iso)
  d.setDate(d.getDate() + n)
  return isoDate(d)
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((parseIso(to).getTime() - parseIso(from).getTime()) / 86_400_000)
}

/** Monday of the week containing `iso`. */
export function weekStart(iso: string): string {
  const d = parseIso(iso)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return isoDate(d)
}

export interface HarnessWeekRow {
  label: string
  "claude-code": number
  antigravity: number
  opencode: number
}

/** Entries per week for each known harness, from the first logged week up to this week. */
export function weeklyHarnessRows(entries: Entry[], today: string): { rows: HarnessWeekRow[]; weeksWithData: number } {
  const starts = [...new Set(entries.map((e) => weekStart(e.date)))].sort()
  if (starts.length === 0) return { rows: [], weeksWithData: 0 }
  const current = weekStart(today)
  const weeks: string[] = []
  for (let w = starts[0]; w <= current; w = addDays(w, 7)) weeks.push(w)

  const rows = new Map<string, HarnessWeekRow>(
    weeks.map((w) => [w, { label: shortDate(w), "claude-code": 0, antigravity: 0, opencode: 0 }])
  )
  for (const e of entries) {
    const row = rows.get(weekStart(e.date))
    if (row && isAiHarness(e.harness)) row[e.harness] += 1
  }
  return { rows: weeks.map((w) => rows.get(w)!), weeksWithData: starts.length }
}

/** Running total of entries per project, one row per day from the first entry to today. */
export function cumulativeRows(
  entries: Entry[],
  names: string[],
  today: string
): { rows: Record<string, string | number>[]; datesWithData: number } {
  const dates = [...new Set(entries.map((e) => e.date))].sort()
  if (dates.length === 0) return { rows: [], datesWithData: 0 }

  const perDay = new Map<string, Record<string, number>>()
  for (const e of entries) {
    for (const p of e.projects) {
      if (!names.includes(p)) continue
      const day = perDay.get(e.date) ?? {}
      day[p] = (day[p] ?? 0) + 1
      perDay.set(e.date, day)
    }
  }

  const totals: Record<string, number> = Object.fromEntries(names.map((n) => [n, 0]))
  const end = today > dates[dates.length - 1] ? today : dates[dates.length - 1]
  const rows: Record<string, string | number>[] = []
  for (let d = dates[0]; d <= end; d = addDays(d, 1)) {
    const added = perDay.get(d)
    if (added) for (const [k, v] of Object.entries(added)) totals[k] += v
    rows.push({ label: shortDate(d), ...totals })
  }
  return { rows, datesWithData: dates.length }
}

export interface TouchRow {
  name: string
  /** All category slugs of the project (first = main). */
  categories: string[]
  /** Latest log date, or the note's `updated` when there is no log. */
  date: string | null
  days: number | null
}

/** Days since each project was last touched, most stale first. */
export function lastTouched(projects: ProjectRecord[], entries: Entry[], today: string): TouchRow[] {
  const rows = projects.map(({ project }): TouchRow => {
    let latest: string | null = null
    for (const e of entries) {
      if (e.projects.includes(project.name) && (latest === null || e.date > latest)) latest = e.date
    }
    const updated = project.updated && /^\d{4}-\d{2}-\d{2}$/.test(project.updated) ? project.updated : null
    const date = latest ?? updated
    return {
      name: project.name,
      categories: project.categories,
      date,
      days: date ? daysBetween(date, today) : null,
    }
  })
  return rows.sort((a, b) => (b.days ?? Number.MAX_SAFE_INTEGER) - (a.days ?? Number.MAX_SAFE_INTEGER))
}

export interface SummaryTiles {
  activeProjects: number
  totalProjects: number
  /** Notes whose `updated` date falls this week. Status changes are not logged, so this is the closest proxy. */
  updatedThisWeek: number
  /** Finished tasks (#task entries) this week and last week. */
  tasksThisWeek: number
  tasksLastWeek: number
  /** Most used AI harness this month. `share` is its part of this month's AI-harness entries (0 to 1). */
  topHarness: { id: AiHarnessId; count: number; share: number } | null
}

export function summaryTiles(projects: ProjectRecord[], entries: Entry[], today: string): SummaryTiles {
  const weekFrom = weekStart(today)
  const prevWeekFrom = addDays(weekFrom, -7)
  const month = today.slice(0, 7)

  let thisWeek = 0
  let lastWeek = 0
  const monthly = new Map<AiHarnessId, number>()
  for (const e of entries) {
    if (e.kind === "task" && e.date >= weekFrom && e.date <= today) thisWeek++
    if (e.kind === "task" && e.date >= prevWeekFrom && e.date < weekFrom) lastWeek++
    if (e.date.startsWith(month) && isAiHarness(e.harness)) {
      monthly.set(e.harness, (monthly.get(e.harness) ?? 0) + 1)
    }
  }

  const monthTotal = [...monthly.values()].reduce((a, b) => a + b, 0)
  let topHarness: SummaryTiles["topHarness"] = null
  for (const id of KNOWN_HARNESSES) {
    const count = monthly.get(id) ?? 0
    if (count > 0 && (!topHarness || count > topHarness.count)) {
      topHarness = { id, count, share: count / monthTotal }
    }
  }

  return {
    activeProjects: projects.filter((p) => p.project.status === "active").length,
    totalProjects: projects.length,
    updatedThisWeek: projects.filter((p) => {
      const u = p.project.updated
      return !!u && u >= weekFrom && u <= today
    }).length,
    tasksThisWeek: thisWeek,
    tasksLastWeek: lastWeek,
    topHarness,
  }
}
