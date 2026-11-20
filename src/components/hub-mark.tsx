import hubMarkUrl from "@/assets/hub-mark.svg"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cx } from "@/core/format"

/**
 * The app's own mark (src/assets/hub-mark.svg), drawn as a CSS mask so it takes the surrounding
 * text color: `text-foreground` in the sidebar, grayscale wherever it is used.
 */
export function HubMark({ className }: { className?: string }) {
  const mask = `url("${hubMarkUrl}") center / contain no-repeat`
  return (
    <span
      aria-hidden="true"
      className={cx("inline-block shrink-0 bg-current", className)}
      style={{ WebkitMask: mask, mask }}
    />
  )
}

/**
 * The mark as an icon row entry: "this belongs to the hub" (hub skills, apps). Same size and
 * tooltip behaviour as HarnessIcon, so a card's icon row stays consistent.
 */
export function HubMarkIcon({ className }: { className?: string }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          render={
            <span
              role="img"
              aria-label="Corvoid Hub"
              className={cx(
                "inline-flex size-5 shrink-0 items-center justify-center",
                className
              )}
            />
          }
        >
          <HubMark className="size-3.5 text-muted-foreground" />
        </TooltipTrigger>
        <TooltipContent>Corvoid Hub</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
