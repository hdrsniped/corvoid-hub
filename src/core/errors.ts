/** Turns anything thrown (Error, Tauri string error, unknown) into a readable message. */
export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  if (typeof e === "string") return e
  return String(e)
}
