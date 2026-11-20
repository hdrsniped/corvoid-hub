/**
 * Turns free text into a folder/skill name: lowercase a-z, 0-9 and single dashes, max 100 chars.
 * Matches the rule enforced in src-tauri/src/lib.rs (valid_slug).
 */
export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100)
    .replace(/-+$/, "")
}
