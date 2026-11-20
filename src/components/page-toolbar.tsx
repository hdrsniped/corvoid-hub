import { createContext, useContext, type ReactNode } from "react"
import { createPortal } from "react-dom"

/** The top bar's right-hand slot. Set by AppShell; null until the bar has mounted. */
export const ToolbarSlotContext = createContext<HTMLElement | null>(null)

/**
 * Puts a page's actions (Refresh, New project...) into the app's top bar, so a page has no title row of its own.
 * Renders nothing until the bar exists.
 */
export function PageToolbar({ children }: { children: ReactNode }) {
  const slot = useContext(ToolbarSlotContext)
  return slot ? createPortal(children, slot) : null
}
