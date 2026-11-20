import { Badge } from "@/components/ui/badge"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import type { Category } from "@/core/categories"

import { CategoryBadge } from "./category-badge"

/**
 * The main category as a badge, plus a muted "+N" chip. The "+N" chip opens a popover with the rest.
 * Clicks stop here, so a card that contains this does not open when the chip is used.
 */
export function CategoryChips({ slugs, categories }: { slugs: string[]; categories: Category[] }) {
  if (slugs.length === 0) {
    return <span className="text-muted-foreground">No category</span>
  }
  const [main, ...rest] = slugs
  return (
    <span className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
      <CategoryBadge slug={main} categories={categories} />
      {rest.length > 0 && (
        <Popover>
          <PopoverTrigger
            render={
              <button type="button" className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/50" />
            }
          >
            <Badge variant="secondary" className="tabular-nums">
              +{rest.length}
            </Badge>
          </PopoverTrigger>
          <PopoverContent align="start" className="flex w-auto flex-col gap-1.5 p-2">
            {rest.map((slug) => (
              <CategoryBadge key={slug} slug={slug} categories={categories} className="justify-start" />
            ))}
          </PopoverContent>
        </Popover>
      )}
    </span>
  )
}
