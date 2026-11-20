/** Small formatting and class helpers shared by all modules. */

export function pad2(n: number): string {
  return String(n).padStart(2, "0")
}

/** Local calendar date as YYYY-MM-DD. */
export function isoDate(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

/** The last `n` local dates as YYYY-MM-DD, oldest first, ending today. */
export function lastDays(n: number): string[] {
  const out: string[] = []
  const now = new Date()
  for (let i = n - 1; i >= 0; i--) {
    out.push(isoDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)))
  }
  return out
}

/** Short label for a YYYY-MM-DD string, e.g. "Nov 20". */
export function shortDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

/** Joins class names, skipping empty values. Modules use this instead of importing lib/utils. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ")
}
