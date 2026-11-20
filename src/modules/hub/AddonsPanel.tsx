import { useState } from "react"
import { Loader2, Play, Power, Puzzle, Sparkles } from "lucide-react"
import { toast } from "sonner"

import { openSetup } from "@/components/setup-dialog"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { trendColor, useDark } from "@/core/colors"
import { cfg } from "@/core/config"
import { errorMessage } from "@/core/errors"
import { useLoad } from "@/core/hooks"
import {
  buildTools,
  callSentence,
  isNeedleReady,
  needleAsk,
  needleConfigure,
  needleStatus,
  type NeedleContext,
  type NeedleResult,
} from "@/core/needle"
import { loadCategories } from "@/core/categories"
import { loadProjects } from "@/core/vault"

/**
 * Hub > Add-ons: the optional Needle add-on. It says whether the two files are there, sets it up
 * (the Setup dialog's Add-ons tab), tests it with a real command, and turns it off.
 */
export function AddonsPanel() {
  const status = useLoad(needleStatus, [])
  const dark = useDark()
  const [testing, setTesting] = useState(false)
  const [tested, setTested] = useState<{ text: string; result: NeedleResult } | null>(null)
  const [turningOff, setTurningOff] = useState(false)

  const ready = isNeedleReady(status.data)

  async function test() {
    setTesting(true)
    try {
      const [projects, categories] = await Promise.all([loadProjects(), loadCategories()])
      const ctx: NeedleContext = {
        projects: projects.projects,
        categories: categories.categories,
      }
      const first = projects.projects[0]?.project.name
      const text = first ? `open ${first}` : "back up now"
      const result = await needleAsk(text, buildTools(ctx))
      setTested({ text, result })
      status.reload()
      if (result.calls.length === 0 && result.held.length === 0) {
        toast.message("Needle answered, but read no action")
      }
    } catch (e) {
      toast.error(errorMessage(e))
      status.reload()
    } finally {
      setTesting(false)
    }
  }

  async function turnOff() {
    setTurningOff(true)
    try {
      await needleConfigure(null, null)
      toast.success("Needle add-on turned off")
      status.reload()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setTurningOff(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <p className="text-xs text-muted-foreground">
          Add-ons are optional tools the app runs for you. Needle turns a sentence typed in Ctrl+K
          into an action, fully offline.
        </p>
      </div>

      {status.loading && !status.data && <Skeleton className="h-32 rounded-xl" />}

      {status.data && (
        <div className="flex flex-col gap-3 rounded-lg border p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Sparkles className="size-4 text-muted-foreground" />
            <p className="text-sm font-medium">Needle</p>
            <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              {ready ? (status.data.running ? "Running" : "Ready") : "Not set up"}
            </span>
            <span className="ml-auto flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <Dot ok={status.data.pythonFound} label="Python" dark={dark} />
              <Dot ok={status.data.weightsFound} label="Model" dark={dark} />
            </span>
          </div>

          <p className="text-xs text-muted-foreground">
            Type commands in plain words in Ctrl+K: “add task fix login to Corvogames”, “log an
            update on Starfall: tuned the boss fight”, “back up now”. Every write opens a confirm
            card first, and nothing leaves the machine.
          </p>

          <div className="flex flex-col gap-1">
            <p className="font-mono text-[10px] break-all text-muted-foreground">
              {status.data.configured ? (cfg().needlePython ?? "needlePython is not set") : "needlePython is not set"}
            </p>
            <p className="font-mono text-[10px] break-all text-muted-foreground">
              {status.data.configured ? (cfg().needleWeights ?? "needleWeights is not set") : "needleWeights is not set"}
            </p>
          </div>

          {status.data.error && <p className="text-xs text-destructive">{status.data.error}</p>}

          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => openSetup("addons")}>
              <Puzzle />
              {ready ? "Change setup" : "Set up"}
            </Button>
            <Button size="sm" variant="outline" onClick={test} disabled={!ready || testing}>
              {testing ? <Loader2 className="animate-spin" /> : <Play />}
              {testing ? "Testing..." : "Test"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="ml-auto text-destructive"
              onClick={turnOff}
              disabled={!status.data.configured || turningOff}
            >
              {turningOff ? <Loader2 className="animate-spin" /> : <Power />}
              {turningOff ? "Turning off..." : "Turn off"}
            </Button>
          </div>
        </div>
      )}

      <Dialog open={tested !== null} onOpenChange={(open) => !open && setTested(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Needle read this</DialogTitle>
            <DialogDescription className="break-words">
              “{tested?.text}” became the calls below. Nothing was written; commands in Ctrl+K ask
              before they change a file.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 rounded-lg bg-muted p-3 font-mono text-xs">
            {tested && tested.result.calls.length === 0 && tested.result.held.length === 0 && (
              <p className="text-muted-foreground">No action in that sentence.</p>
            )}
            {tested?.result.calls.map((call, index) => (
              <p key={`call-${index}`}>{`${call.name}(${JSON.stringify(call.arguments)})`}</p>
            ))}
            {tested?.result.held.map((call, index) => (
              <p key={`held-${index}`} className="text-muted-foreground">
                {`held: ${call.name}(${JSON.stringify(call.arguments)})`}
              </p>
            ))}
            {tested && (tested.result.calls.length > 0 || tested.result.held.length > 0) && (
              <p className="text-muted-foreground">
                {tested.result.calls.map(callSentence).join(" · ")}
              </p>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {tested?.result.ms ?? 0} ms
            {tested?.result.confidence !== null && tested?.result.confidence !== undefined
              ? ` · confidence ${Math.round(tested.result.confidence * 100)}%`
              : ""}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTested(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function Dot({ ok, label, dark }: { ok: boolean; label: string; dark: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        title={ok ? `${label} found` : `${label} not found`}
        aria-label={ok ? `${label} found` : `${label} not found`}
        className={ok ? "size-2 rounded-full" : "size-2 rounded-full bg-muted-foreground/40"}
        style={ok ? { background: trendColor(1, dark) } : undefined}
      />
      {label}
    </span>
  )
}
