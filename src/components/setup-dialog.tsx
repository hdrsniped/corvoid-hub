import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { Check, ChevronDown, Copy, FolderOpen, Loader2, Save, Sparkles } from "lucide-react"
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
  isNeedleReady,
  needleConfigure,
  needleStatus,
  needleTipSeen,
  rememberNeedleTip,
  NEEDLE_TIP_KEY,
  type NeedleStatus,
} from "@/core/needle"
import { buildNeedleSetupPrompt } from "@/core/needle-setup-prompt"
import {
  configPath,
  setupDetect,
  setupSave,
  setupWireRules,
  type SetupDetect,
  type SetupFields,
  type WireResult,
} from "@/core/setup"

/** The tabs of the setup dialog. Add-ons is optional and can be skipped. */
export type SetupSection = "ai" | "manual" | "addons"

/** Window event that opens the setup dialog, so a toolbar button needs no shared state. */
const SETUP_EVENT = "hub:setup"

export function openSetup(section: SetupSection = "ai"): void {
  window.dispatchEvent(new CustomEvent(SETUP_EVENT, { detail: section }))
}

const POLL_MS = 2000

/**
 * First-run setup: either hand the job to an AI harness (a prompt with every detected path) or fill
 * the paths in by hand. Both write corvoid-hub.json and reload the config, so no restart is needed.
 */
export function SetupDialog() {
  // A fresh install opens it by itself; after that it is a toolbar item.
  const [open, setOpen] = useState(() => !cfg().configured)
  /** Which tab to show; the palette's "Set up" row asks for the Add-ons tab. */
  const [section, setSection] = useState<SetupSection>("ai")

  useEffect(() => {
    const show = (event: Event) => {
      const wanted = (event as CustomEvent<SetupSection>).detail
      if (wanted) setSection(wanted)
      setOpen(true)
    }
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
            you fill the paths in yourself. Add-ons are optional.
          </DialogDescription>
        </DialogHeader>
        <SetupBody key={section} onDone={() => setOpen(false)} initialTab={section} />
      </DialogContent>
    </Dialog>
  )
}

function SetupBody({ onDone, initialTab }: { onDone: () => void; initialTab: SetupSection }) {
  const [detect, setDetect] = useState<SetupDetect | null>(null)
  const [detectError, setDetectError] = useState<string | null>(null)
  const [tab, setTab] = useState<string>(initialTab)
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
        void suggestNeedle()
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
        <TabsTrigger value="addons">
          <Sparkles />
          Add-ons
        </TabsTrigger>
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

      <TabsContent value="addons" className="pt-3">
        <AddonsSetup onDone={finish} />
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
      void suggestNeedle()
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

/** Optional tab: the Needle add-on. Copy an install prompt, or take the two paths. Skipping is fine. */
function AddonsSetup({ onDone }: { onDone: () => void }) {
  const [status, setStatus] = useState<NeedleStatus | null>(null)
  const [config, setConfig] = useState("")
  const [python, setPython] = useState(() => cfg().needlePython ?? "")
  const [weights, setWeights] = useState(() => cfg().needleWeights ?? "")
  const [showPaths, setShowPaths] = useState(false)
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState(false)

  // An agent can write the two keys while this tab is open, so the dots are polled.
  useEffect(() => {
    let cancelled = false
    const tick = async () => {
      try {
        const next = await needleStatus()
        if (!cancelled) setStatus(next)
      } catch {
        // The status is a hint; a failed poll changes nothing.
      }
    }
    tick()
    const timer = setInterval(tick, POLL_MS)
    configPath()
      .then((path) => {
        if (!cancelled) setConfig(path)
      })
      .catch(() => {
        // The prompt names a fallback file then.
      })
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  const ready = isNeedleReady(status)

  async function copyPrompt() {
    try {
      await copyText(buildNeedleSetupPrompt(config || "corvoid-hub.json"))
      setCopied(true)
      toast.success("Prompt copied. Paste it into your AI harness.")
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  async function savePaths() {
    const file = python.trim()
    const model = weights.trim()
    if (!file || !model) {
      toast.error("Pick the Python and the needle3.cact file")
      return
    }
    setSaving(true)
    try {
      await needleConfigure(file, model)
      // The new keys are in the config now; cfg() must see them (the palette and quick log read it).
      await reloadConfig()
      toast.success("Needle add-on saved")
      setShowPaths(false)
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 rounded-lg border p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Sparkles className="size-4 text-muted-foreground" />
          <p className="text-sm font-medium">Needle</p>
          {ready && (
            <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              Ready
            </span>
          )}
          <span className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <AddonDot ok={Boolean(status?.pythonFound)} label="Python" />
              Python
            </span>
            <span className="flex items-center gap-1.5">
              <AddonDot ok={Boolean(status?.weightsFound)} label="Model" />
              Model
            </span>
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          Type commands in plain words in Ctrl+K, runs offline. It turns “add task fix login to
          Corvogames” into the matching action, and every write is confirmed first.
        </p>
        {status?.error && <p className="text-xs text-destructive">{status.error}</p>}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={copyPrompt} className="h-8">
            {copied ? <Check /> : <Copy />}
            {copied ? "Copy again" : "Set up with AI"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8"
            onClick={() => setShowPaths((current) => !current)}
          >
            I have it
          </Button>
        </div>
      </div>

      {showPaths && (
        <div className="flex flex-col gap-3 rounded-lg border border-dashed p-3">
          <PathRow
            label="Needle Python (its venv)"
            value={python}
            onChange={setPython}
            onPick={() => pick("file", setPython)}
            hint="…\venv\Scripts\python.exe"
          />
          <PathRow
            label="Model weights"
            value={weights}
            onChange={setWeights}
            onPick={() => pick("file", setWeights)}
            hint="…\models\needle3.cact"
          />
          <div className="flex justify-end">
            <Button size="sm" onClick={savePaths} disabled={saving} className="h-8">
              {saving ? <Loader2 className="animate-spin" /> : <Save />}
              {saving ? "Saving..." : "Use these"}
            </Button>
          </div>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Optional: skip it and everything else works as before. The model is Apache-2.0 by Cactus
        Compute (huggingface.co/Cactus-Compute/needle3), about 35 MB, and nothing leaves the machine.
      </p>
      {config && <p className="truncate font-mono text-[10px] text-muted-foreground">{config}</p>}

      <DialogFooter>
        <Button variant="outline" onClick={onDone} className="h-9">
          Skip
        </Button>
      </DialogFooter>
    </div>
  )
}

function AddonDot({ ok, label }: { ok: boolean; label: string }) {
  const dark = useDark()
  return (
    <span
      title={ok ? `${label} found` : `${label} not found`}
      aria-label={ok ? `${label} found` : `${label} not found`}
      className={cx("size-2 shrink-0 rounded-full", !ok && "bg-muted-foreground/40")}
      style={ok ? { background: trendColor(1, dark) } : undefined}
    />
  )
}

/**
 * One-time tip after setup: the palette also takes plain commands. The "Set up" action only shows
 * while the add-on is not installed; the tip is remembered in localStorage.
 */
async function suggestNeedle(): Promise<void> {
  if (needleTipSeen(NEEDLE_TIP_KEY)) return
  rememberNeedleTip(NEEDLE_TIP_KEY)
  let ready = false
  try {
    ready = isNeedleReady(await needleStatus())
  } catch {
    // Without a status the setup action is the safe choice.
  }
  toast.message("Tip: Ctrl+K understands plain commands with the Needle add-on", {
    duration: 12000,
    action: ready ? undefined : { label: "Set up", onClick: () => openSetup("addons") },
  })
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
