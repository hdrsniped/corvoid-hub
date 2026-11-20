/** The AI harnesses that write log entries. */
export type AiHarnessId = "claude-code" | "antigravity" | "opencode"

/**
 * Parsed from the trailing "(harness)" of a log bullet. "me" is an entry the user wrote without an AI
 * harness; "other" is any harness name not listed here.
 */
export type HarnessId = AiHarnessId | "me" | "other"

/** Harnesses that get their own chart line and tile. "me" and "other" are shown only as neutral icons. */
export const KNOWN_HARNESSES: AiHarnessId[] = ["claude-code", "antigravity", "opencode"]

export const HARNESS_LABEL: Record<HarnessId, string> = {
  "claude-code": "Claude Code",
  antigravity: "Antigravity",
  opencode: "OpenCode",
  me: "Me",
  other: "Other",
}

export function isAiHarness(id: HarnessId | null | undefined): id is AiHarnessId {
  return id != null && (KNOWN_HARNESSES as HarnessId[]).includes(id)
}

/** Maps the free-text harness of a log bullet or project note to a harness id. Empty input gives null. */
export function harnessOf(raw: string | undefined): HarnessId | null {
  const s = (raw ?? "").trim().toLowerCase()
  if (!s) return null
  if (s === "me") return "me"
  if (s.includes("claude")) return "claude-code"
  if (s.includes("antigravity")) return "antigravity"
  if (s.includes("opencode")) return "opencode"
  return "other"
}
