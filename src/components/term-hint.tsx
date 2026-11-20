import { CircleQuestionMark } from "lucide-react"

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cx } from "@/core/format"
import { term as glossaryTerm, useGlossary } from "@/core/glossary"

/**
 * A small muted (?) beside a label whose name is a `cv:` term. The tooltip shows the term, its plain
 * meaning and an example sentence, all read from glossary.yaml. Renders nothing when the glossary has
 * no such term, so a missing entry never leaves an empty icon behind.
 */
export function TermHint({ term, className }: { term: string; className?: string }) {
  const { terms } = useGlossary()
  const entry = glossaryTerm(term, terms)
  if (!entry) return null

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          render={
            <span
              role="img"
              aria-label={`${entry.term}: ${entry.means}`}
              className={cx(
                "inline-flex size-4 shrink-0 cursor-help items-center justify-center rounded-full text-muted-foreground/60 hover:text-muted-foreground",
                className
              )}
            />
          }
        >
          <CircleQuestionMark className="size-3.5" />
        </TooltipTrigger>
        <TooltipContent
          side="top"
          className="max-w-xs flex-col items-start gap-1 text-left"
        >
          <span className="font-mono text-[10px] opacity-70">{entry.term}</span>
          <span>{entry.means}</span>
          {entry.say && (
            <code className="rounded-sm bg-background/10 px-1.5 py-0.5 font-mono text-[11px] ring-1 ring-background/25">
              {entry.say}
            </code>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
