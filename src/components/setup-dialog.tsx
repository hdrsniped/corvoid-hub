import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { Check, ChevronDown, Copy, FolderOpen, Loader2, Save } from "lucide-react"
import { toast } from "sonner"

import { HarnessGlyph } from "@/components/harness-icon"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { copyText } from "@/core/clipboard"
import { trendColor, useDark } from "@/core/colors"
import { cfg, readConfig, reloadConfig } from "@/core/config"
import { pickPath } from "@/core/dialog"
import { errorMessage } from "@/core/errors"
import { cx } from "@/core/format"
import { pathExists } from "@/core/fs"
import {
  HARNESS_LABEL,
  KNOWN_HARNESSES,
  isAiHarness,
  type AiHarnessId,
  type HarnessId,
} from "@/core/harness"
import { buildSetupPrompt } from "@/core/setup-prompt"
import {
  setupDetect,
  setupSave,
  setupWireRules,
  type SetupDetect,
  type SetupFields,
  type WireResult,
} from "@/core/setup"

/** Window event that opens the setup dialog, so a toolbar button needs no shared state. */
const SETUP_EVENT = "hub:setup"

export function openSetup(): void {
  window.dispatchEvent(new Event(SETUP_EVENT))
}

const POLL_MS = 2000

/**
 * First-run setup: either hand the job to an AI harness (a prompt with every detected path) or fill
 * the paths in by hand. Both write corvoid-hub.json and reload the config, so no restart is needed.
 */
export function SetupDialog() {
  // A fresh install opens it by itself; after that it is a toolbar item.
  const [open, setOpen] = useState(() => !cfg().configured)

  useEffect(() => {
    const show = () => setOpen(true)
    window.addEventListener(SETUP_EVENT, show)
    return () => window.removeEventListener(SETUP_EVENT, show)
  }, [])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Set up Corvoid Hub</DialogTitle>
          <DialogDescription>
            Point the app at your hub folder and Obsidian vault. An AI harness can do it for you, or
            you fill the paths in yourself.
          </DialogDescription>
        </DialogHeader>
        <SetupBody onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  )
}

function SetupBody({ onDone }: { onDone: () => void }) {
  const [detect, setDetect] = useState<SetupDetect | null>(null)
  const [detectError, setDetectError] = useState<string | null>(null)
  const [tab, setTab] = useState("ai")
  const [harnesses, setHarnesses] = useState<AiHarnessId[]>(["claude-code"])
  /** False when the user opened Setup later just to reconnect something. */
  const [needsSetup] = useState(() => !cfg().configured)
  /** Polling only reacts to a setup that was not done when the dialog opened. */
  const wasConfigured = useRef(cfg().configured)

  useEffect(() => {
    let cancelled = false
    setupDetect()
      .then((value) => {
        if (!cancelled) setDetect(value)
      })
      .catch((e: unknown) => {
        if (!cancelled) setDetectError(errorMessage(e))
      })
    return () => {
      cancelled = true
    }
  }, [])

  // An agent writes the config while this dialog is open: notice it, reload, close.
  useEffect(() => {
    let cancelled = false
    const tick = async () => {
      try {
        const next = await readConfig()
        if (cancelled || !next.configured || wasConfigured.current) return
        wasConfigured.current = true
        await reloadConfig()
        toast.success("Setup done")
        onDone()
      } catch {
        // A poll that fails changes nothing; the next one tries again.
      }
    }
    const timer = setInterval(tick, POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [onDone])

  function finish() {
    wasConfigured.current = true
    onDone()
  }

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(String(v))}>
      <TabsList>
        <TabsTrigger value="ai">With an AI</TabsTrigger>
        <TabsTrigger value="manual">Manual</TabsTrigger>
      </TabsList>

      <TabsContent value="ai" className="pt-3">
        <AiSetup
          detect={detect}
          error={detectError}
          harnesses={harnesses}
          setHarnesses={setHarnesses}
          needsSetup={needsSetup}
        />
      </TabsContent>

      <TabsContent value="manual" className="pt-3">
        <ManualSetup detect={detect} onDone={finish} />
      </TabsContent>
    </Tabs>
  )
}

/** Copy-to-agent tab: pick the harnesses, copy the prompt, wait for the config file to appear. */
function AiSetup({
  detect,
  error,
  harnesses,
  setHarnesses,
  needsSetup,
}: {
  detect: SetupDetect | null
  error: string | null
  harnesses: AiHarnessId[]
  setHarnesses: (next: AiHarnessId[]) => void
  needsSetup: boolean
}) {
  const [copiedPrompt, setCopiedPrompt] = useState("")
  const prompt = useMemo(
    () => (detect ? buildSetupPrompt({ harnesses, detect }) : ""),
    [detect, harnesses]
  )
  const copied = prompt !== "" && copiedPrompt === prompt

  async function copy() {
    if (!prompt) return
    try {
      await copyText(prompt)
      setCopiedPrompt(prompt)
      const names = harnesses.map((h) => HARNESS_LABEL[h]).join(", ") || "your AI harness"
      toast.success(`Prompt copied. Paste it into ${names}.`)
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">Harnesses to connect</Label>
        <ToggleGroup
          multiple
          variant="outline"
          size="sm"
          value={harnesses}
          onValueChange={(value) =>
            setHarnesses(value.filter((v): v is AiHarnessId => isAiHarness(v as HarnessId)))
          }
        >
          {KNOWN_HARNESSES.map((id) => (
            <ToggleGroupItem key={id} value={id} className="gap-1.5 px-2 text-xs">
              <HarnessGlyph id={id} />
              {HARNESS_LABEL[id]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <Collapsible>
        <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted">
          Preview prompt
          <ChevronDown className="size-3.5 shrink-0" />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <pre className="mt-2 max-h-56 overflow-auto rounded-lg bg-muted p-3 font-mono text-[11px] whitespace-pre-wrap">
            {prompt || "Reading the detected paths..."}
          </pre>
        </CollapsibleContent>
      </Collapsible>

      <Button onClick={copy} disabled={!prompt} className="h-9">
        {copied ? <Check /> : <Copy />}
        {copied ? "Copy again" : "Copy prompt"}
      </Button>

      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        {needsSetup ? (
          <>
            <Loader2 className="size-3.5 shrink-0 animate-spin" />
            Waiting for setup…
          </>
        ) : (
          <>Setup is done. Copy this prompt again to reconnect a harness or move an existing folder.</>
        )}
        <span className="truncate font-mono text-[10px]">{detect?.configPath}</span>
      </p>
      <p className="text-xs text-muted-foreground">
        The window closes by itself once the config file is there. The prompt tells the agent to ask
        before it writes anything, and to back up the files it touches.
      </p>
    </div>
  )
}

/** Manual tab: one row per path with a picker and a status dot, then two switches and Save. */
function ManualSetup({ detect, onDone }: { detect: SetupDetect | null; onDone: () => void }) {
  const [fields, setFields] = useState<SetupFields>(() => ({
    hub: cfg().hub,
    vault: cfg().vault,
    claudeSkills: cfg().claudeSkills,
    antigravitySkills: cfg().antigravitySkills,
    opencodeConfig: cfg().opencodeConfig,
    antigravityExe: cfg().antigravityExe ?? "",
  }))
  const [createStarters, setCreateStarters] = useState(true)
  const [wireRules, setWireRules] = useState(true)
  const [saving, setSaving] = useState(false)

  function set(key: keyof SetupFields, value: string) {
    setFields((current) => ({ ...current, [key]: value }))
  }

  async function save() {
    if (!fields.hub.trim() || !fields.vault.trim()) {
      toast.error("The hub folder and the vault are required")
      return
    }
    setSaving(true)
    try {
      const result = await setupSave(fields, createStarters)
      let wired: WireResult[] = []
      // Only the harnesses whose folder is really here; Rust skips the rest anyway.
      const targets: AiHarnessId[] = []
      if (detect?.claudeSkills.exists) targets.push("claude-code")
      if (detect?.opencodeConfig.exists) targets.push("opencode")
      if (detect?.antigravitySkills.exists) targets.push("antigravity")
      if (wireRules && targets.length > 0) {
        try {
          wired = await setupWireRules(targets)
        } catch (e) {
          toast.error(`Saved, but the rules were not connected: ${errorMessage(e)}`)
        }
      } else if (wireRules) {
        toast.info("No harness folder found, so no rules were connected")
      }
      await reloadConfig()
      const created = result.created.length
      toast.success(created > 0 ? `Setup saved, ${created} starter items created` : "Setup saved")
      const connected = wired.filter((w) => w.ok && w.message !== "already connected")
      const failed = wired.filter((w) => !w.ok)
      if (connected.length > 0) {
        toast.success(`Rules connected: ${connected.map((w) => harnessLabel(w.harness)).join(", ")}`)
      }
      for (const item of failed) toast.error(`${harnessLabel(item.harness)}: ${item.message}`)
      onDone()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  const vaultOptions = detect?.obsidianVaults ?? []

  return (
    <div className="flex flex-col gap-3">
      <PathRow
        label="Hub folder"
        value={fields.hub}
        onChange={(v) => set("hub", v)}
        onPick={() => pick("folder", (v) => set("hub", v))}
        required
        hint="Not there yet? It is created when you save."
      />

      <div className="flex flex-col gap-1.5">
        <PathRow
          label="Obsidian vault"
          value={fields.vault}
          onChange={(v) => set("vault", v)}
          onPick={() => pick("folder", (v) => set("vault", v))}
          required
          hint="Not there yet? It is created when you save."
        />
        {vaultOptions.length > 0 && (
          <Select
            value={vaultOptions.includes(fields.vault) ? fields.vault : undefined}
            onValueChange={(value) => set("vault", String(value))}
            items={vaultOptions.map((path) => ({ value: path, label: path }))}
          >
            <SelectTrigger size="sm" className="w-full text-xs" aria-label="Obsidian vaults">
              <SelectValue placeholder="Use a vault Obsidian knows" />
            </SelectTrigger>
            <SelectContent>
              {vaultOptions.map((path) => (
                <SelectItem key={path} value={path}>
                  {path}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <PathRow
        label="Claude Code skills"
        value={fields.claudeSkills}
        onChange={(v) => set("claudeSkills", v)}
        onPick={() => pick("folder", (v) => set("claudeSkills", v))}
      />
      <PathRow
        label="Antigravity skills"
        value={fields.antigravitySkills}
        onChange={(v) => set("antigravitySkills", v)}
        onPick={() => pick("folder", (v) => set("antigravitySkills", v))}
      />
      <PathRow
        label="OpenCode config"
        value={fields.opencodeConfig}
        onChange={(v) => set("opencodeConfig", v)}
        onPick={() => pick("folder", (v) => set("opencodeConfig", v))}
      />
      <PathRow
        label="Antigravity app (.exe)"
        value={fields.antigravityExe}
        onChange={(v) => set("antigravityExe", v)}
        onPick={() => pick("file", (v) => set("antigravityExe", v))}
        hint="Used for its icon. Leave empty to find it automatically."
      />

      <div className="flex flex-col gap-2 border-t pt-3">
        <label className="flex items-start gap-2 text-xs">
          <Checkbox checked={createStarters} onCheckedChange={(v) => setCreateStarters(v === true)} />
          <span>
            Create starter files
            <span className="block text-muted-foreground">
              Rules, categories, apps, locks and glossary in the hub; Projects, Log and a project
              template in the vault. Existing files are never overwritten.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-xs">
          <Checkbox checked={wireRules} onCheckedChange={(v) => setWireRules(v === true)} />
          <span>
            Connect global rules to my harnesses
            <span className="block text-muted-foreground">
              Adds the hub AGENTS.md to Claude Code and OpenCode, or as an Antigravity plugin. Every
              file it edits is backed up next to itself first.
            </span>
          </span>
        </label>
      </div>

      <DialogFooter>
        <Button onClick={save} disabled={saving} className="h-9">
          {saving ? <Loader2 className="animate-spin" /> : <Save />}
          {saving ? "Saving..." : "Save setup"}
        </Button>
      </DialogFooter>
    </div>
  )
}

function harnessLabel(raw: string): string {
  return (HARNESS_LABEL as Record<string, string>)[raw] ?? raw
}

async function pick(kind: "file" | "folder", set: (path: string) => void) {
  const path = await pickPath(kind)
  if (path) set(path)
}

/** One path: status dot, label, input and a native picker. */
function PathRow({
  label,
  value,
  onChange,
  onPick,
  required,
  hint,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  onPick: () => void
  required?: boolean
  hint?: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <StatusDot path={value} required={required} />
        <Label className="text-xs">{label}</Label>
        {required && <span className="text-[10px] text-muted-foreground">required</span>}
      </div>
      <div className="flex items-center gap-1.5">
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Pick a folder"
          className="h-8 font-mono text-xs"
          spellCheck={false}
        />
        <Button type="button" variant="outline" size="icon-sm" onClick={onPick} aria-label={`Pick ${label}`}>
          <FolderOpen />
        </Button>
      </div>
      {hint && <p className="pl-4 text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  )
}

/** Green when the path exists, red when a required one does not, grey while optional or unchecked. */
function StatusDot({ path, required }: { path: string; required?: boolean }) {
  const dark = useDark()
  const state = usePathStatus(path)
  const color =
    state === "found"
      ? trendColor(1, dark)
      : state === "missing" && required
        ? trendColor(-1, dark)
        : undefined
  const label = state === "found" ? "Exists" : state === "missing" ? "Not there yet" : "Checking"
  return (
    <span
      title={label}
      aria-label={label}
      className={cx("size-2 shrink-0 rounded-full", !color && "bg-muted-foreground/40")}
      style={color ? { background: color } : undefined}
    />
  )
}

/** True/false for a path, checked after a short pause so typing does not spam Rust. */
function usePathStatus(path: string): "found" | "missing" | "unknown" {
  const [checked, setChecked] = useState<{ path: string; exists: boolean } | null>(null)
  const trimmed = path.trim()

  useEffect(() => {
    if (!trimmed) return
    let cancelled = false
    const timer = setTimeout(() => {
      pathExists(trimmed)
        .then((exists) => {
          if (!cancelled) setChecked({ path: trimmed, exists })
        })
        .catch(() => {
          if (!cancelled) setChecked({ path: trimmed, exists: false })
        })
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [trimmed])

  if (!trimmed) return "missing"
  if (checked?.path !== trimmed) return "unknown"
  return checked.exists ? "found" : "missing"
}
