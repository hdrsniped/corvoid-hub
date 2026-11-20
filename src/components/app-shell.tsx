import { useEffect, useState } from "react"
import { Moon, Search, Sparkles, Sun } from "lucide-react"

import {
  CommandPalette,
  openCommandPalette,
} from "@/components/command-palette"
import { useTheme } from "@/components/theme-provider"
import { RootMissing } from "@/components/root-missing"
import { SetupDialog } from "@/components/setup-dialog"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { ToolbarSlotContext } from "@/components/page-toolbar"
import { cfg, onConfigChange } from "@/core/config"
import {
  NEEDLE_DOT_KEY,
  NEEDLE_SEEN_EVENT,
  isNeedleReady,
  needleStatus,
  needleTipSeen,
} from "@/core/needle"
import { useRoute } from "@/core/navigation"
import { findModuleByRoute, modules } from "@/modules/registry"

export function AppShell() {
  const route = useRoute()
  const { theme, setTheme } = useTheme()

  const active = findModuleByRoute(route.path) ?? modules[0]
  const ActivePage = active.component
  const missing = active.needs === "hub" ? !cfg().hubExists : !cfg().vaultExists
  // Pages portal their actions (Refresh, New project...) into this slot of the top bar.
  const [toolbarSlot, setToolbarSlot] = useState<HTMLDivElement | null>(null)
  // Setup changes the roots, so the open screen remounts and loads from the new folders.
  const [configVersion, setConfigVersion] = useState(0)
  /** The Sparkles dot on the Search button, until the palette is opened once with Needle ready. */
  const [needleDot, setNeedleDot] = useState(false)

  useEffect(() => onConfigChange(() => setConfigVersion((v) => v + 1)), [])

  // The add-on can be set up at any time (Setup, Hub > Add-ons, or an agent writing the config).
  useEffect(() => {
    let cancelled = false
    needleStatus()
      .then((status) => {
        if (cancelled) return
        setNeedleDot(isNeedleReady(status) && !needleTipSeen(NEEDLE_DOT_KEY))
      })
      .catch(() => {
        // No status means no dot; the app works as usual.
      })
    return () => {
      cancelled = true
    }
  }, [configVersion])

  useEffect(() => {
    const hide = () => setNeedleDot(false)
    window.addEventListener(NEEDLE_SEEN_EVENT, hide)
    return () => window.removeEventListener(NEEDLE_SEEN_EVENT, hide)
  }, [])

  const isDark =
    theme === "dark" ||
    (theme === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches)

  return (
    // The window is the full viewport. Only the content area scrolls; the sidebar stays put.
    <SidebarProvider className="h-svh overflow-hidden">
      <Sidebar>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Modules</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {modules.map((m) => (
                  <SidebarMenuItem key={m.id}>
                    <SidebarMenuButton
                      isActive={m.id === active.id}
                      render={<a href={`#${m.route}`} />}
                    >
                      <m.icon />
                      <span>{m.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <Button
            variant="ghost"
            className="justify-between"
            onClick={openCommandPalette}
          >
            <span className="flex items-center gap-2">
              <Search />
              Search
              {needleDot && (
                <Sparkles
                  className="size-3 text-primary"
                  aria-label="Ctrl+K understands plain commands"
                />
              )}
            </span>
            <kbd className="rounded border bg-muted px-1.5 py-0.5 font-sans text-[10px] text-muted-foreground">
              Ctrl K
            </kbd>
          </Button>
          <Button
            variant="ghost"
            className="justify-start"
            onClick={() => setTheme(isDark ? "light" : "dark")}
          >
            {isDark ? <Sun /> : <Moon />}
            {isDark ? "Light mode" : "Dark mode"}
          </Button>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset className="min-h-0 overflow-hidden">
        <header className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
          <SidebarTrigger />
          <Separator orientation="vertical" className="h-4" />
          <div
            ref={setToolbarSlot}
            className="flex min-w-0 flex-1 items-center justify-end gap-2"
          />
        </header>
        <div className="app-scroll min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
          <ToolbarSlotContext.Provider value={toolbarSlot}>
            {missing ? (
              <RootMissing key={configVersion} root={active.needs} />
            ) : (
              <ActivePage key={`${active.id}-${configVersion}`} />
            )}
          </ToolbarSlotContext.Provider>
        </div>
      </SidebarInset>
      <CommandPalette />
      <SetupDialog />
    </SidebarProvider>
  )
}
