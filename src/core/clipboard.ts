/**
 * Copies text to the system clipboard.
 * Falls back to a hidden textarea when the async clipboard API is unavailable in the webview.
 */
export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    return
  } catch {
    // Some webviews refuse the async API; the old selection trick still works.
  }

  const area = document.createElement("textarea")
  area.value = text
  area.setAttribute("readonly", "")
  area.style.position = "fixed"
  area.style.top = "0"
  area.style.left = "0"
  area.style.opacity = "0"
  document.body.appendChild(area)
  area.select()
  try {
    if (!document.execCommand("copy")) throw new Error("the clipboard is not available")
  } finally {
    document.body.removeChild(area)
  }
}
