import { useState } from "react"
import { Check, Loader2, Sparkles } from "lucide-react"

import { Button } from "@/components/ui/button"
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
import { errorMessage } from "@/core/errors"
import {
  callSentence,
  fieldOptions,
  optionLabel,
  toolSpec,
  type NeedleCall,
  type NeedleContext,
  type ToolField,
} from "@/core/needle"
import { runNeedleCalls } from "@/core/needle-actions"

/** Sentinel for "no value" in a Select (base-ui needs a real string). */
const NONE = "__none__"

function text(value: unknown): string {
  return value === null || value === undefined ? "" : String(value)
}

/**
 * The confirm card of a plain-language command: one editable block per call, with the enum fields as
 * selects from live data. Writes never reach the files until Confirm.
 */
export function NeedleConfirm({
  calls,
  ctx,
  onClose,
}: {
  calls: NeedleCall[]
  ctx: NeedleContext
  onClose: () => void
}) {
  const [values, setValues] = useState<NeedleCall[]>(() =>
    calls.map((call) => ({
      name: call.name,
      arguments: { ...call.arguments },
    }))
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function setField(index: number, key: string, value: string) {
    setValues((current) =>
      current.map((call, i) =>
        i === index ? { ...call, arguments: { ...call.arguments, [key]: value } } : call
      )
    )
  }

  async function confirm() {
    const missing = values.flatMap((call) => {
      const spec = toolSpec(call.name)
      if (!spec) return [`${call.name} is not an action this app knows`]
      return spec.fields
        .filter((field) => !field.optional && !text(call.arguments[field.key]).trim())
        .map((field) => `${spec.label}: ${field.label.toLowerCase()} is empty`)
    })
    if (missing.length > 0) {
      setError(missing[0])
      return
    }
    setBusy(true)
    setError(null)
    try {
      await runNeedleCalls(values, ctx)
      onClose()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-muted-foreground" />
            {values.length > 1 ? `${values.length} actions` : "Run this action?"}
          </DialogTitle>
          <DialogDescription>
            Check the fields, then Confirm. Nothing is written until you do.
          </DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[55vh] flex-col gap-3 overflow-y-auto pr-0.5">
          {values.map((call, index) => {
            const spec = toolSpec(call.name)
            const Icon = spec?.icon ?? Sparkles
            return (
              <div key={`${call.name}-${index}`} className="flex flex-col gap-2 rounded-lg border p-3">
                <div className="flex items-start gap-2">
                  <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{spec?.label ?? call.name}</p>
                    <p className="text-xs break-words text-muted-foreground">{callSentence(call)}</p>
                  </div>
                </div>
                {spec && spec.fields.length > 0 && (
                  <div className="grid gap-2">
                    {spec.fields.map((field) => (
                      <Field
                        key={field.key}
                        field={field}
                        value={text(call.arguments[field.key])}
                        options={fieldOptions(field.kind, ctx)}
                        onChange={(value) => setField(index, field.key, value)}
                        disabled={busy}
                      />
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={confirm} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <Check />}
            {busy ? "Running..." : "Confirm"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Field({
  field,
  value,
  options,
  onChange,
  disabled,
}: {
  field: ToolField
  value: string
  options: string[] | undefined
  onChange: (value: string) => void
  disabled: boolean
}) {
  const label = field.optional ? `${field.label} (optional)` : field.label
  if (!options || options.length === 0) {
    return (
      <div className="flex flex-col gap-1">
        <Label className="text-xs text-muted-foreground">{label}</Label>
        <Input
          value={value}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 text-sm"
          disabled={disabled}
          spellCheck={false}
        />
      </div>
    )
  }

  const items = [
    ...(field.optional ? [{ value: NONE, label: "Any" }] : []),
    ...options.map((option) => ({ value: option, label: optionLabel(field.kind, option) })),
  ]

  return (
    <div className="flex flex-col gap-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Select
        value={value || NONE}
        onValueChange={(next) => {
          const picked = String(next ?? NONE)
          onChange(picked === NONE ? "" : picked)
        }}
        items={items}
      >
        <SelectTrigger className="h-8 w-full text-sm" aria-label={field.label} disabled={disabled}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
