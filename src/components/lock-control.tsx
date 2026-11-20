import { Lock, LockOpen } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { lockColor, useDark } from "@/core/colors"
import { cx } from "@/core/format"
import { LOCK_LABEL, LOCK_MODES, type LockEntry, type LockMode } from "@/core/locks"

/** "Unlocked" or "Locked: Read-only" for a lock icon's tooltip. */
export function lockTitle(lock: LockEntry | undefined): string {
  return lock ? `Locked: ${LOCK_LABEL[lock.mode]}` : "Unlocked"
}

interface LockControlProps {
  /** Absolute path the lock applies to. Shown in the menu header. */
  path: string
  /** The lock covering this path, or undefined when it is unlocked. */
  lock: LockEntry | undefined
  /** Called with the new mode, or null to unlock. */
  onSet: (mode: LockMode | null) => void
  disabled?: boolean
}

/**
 * Lock button for one path: Lock when locked, LockOpen when not. Its menu switches between
 * Unlocked, Read-only and No AI; the tooltip names the current mode.
 */
export function LockControl({ path, lock, onSet, disabled }: LockControlProps) {
  const dark = useDark()
  const mode = lock?.mode ?? null
  const label = lockTitle(lock)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`${label}. Change lock`}
            title={label}
            disabled={disabled}
            style={{ color: lockColor(mode, dark) }}
          />
        }
      >
        {mode ? <Lock /> : <LockOpen />}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48 max-w-80">
        <p className="px-1.5 py-1 font-mono text-[11px] break-all text-muted-foreground">{path || "No path"}</p>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={mode ?? "none"}
          onValueChange={(value) => onSet(value === "none" ? null : (value as LockMode))}
        >
          <DropdownMenuRadioItem value="none">
            <LockOpen />
            Unlocked
          </DropdownMenuRadioItem>
          {LOCK_MODES.map((m) => (
            <DropdownMenuRadioItem key={m} value={m}>
              <Lock
                style={m === "no-ai" ? { color: lockColor("no-ai", dark) } : undefined}
              />
              {LOCK_LABEL[m]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * Small lock mark for a card's icon row: muted for read-only, red-ish for no-ai.
 * Renders nothing when the item is unlocked.
 */
export function LockBadge({ lock, className }: { lock: LockEntry | undefined; className?: string }) {
  const dark = useDark()
  if (!lock) return null
  const label = lockTitle(lock)

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          render={
            <span
              role="img"
              aria-label={label}
              className={cx("inline-flex size-5 shrink-0 items-center justify-center", className)}
            />
          }
        >
          <Lock
            className={cx("size-3.5 shrink-0", lock.mode === "no-ai" ? "" : "text-muted-foreground")}
            style={lock.mode === "no-ai" ? { color: lockColor("no-ai", dark) } : undefined}
          />
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
