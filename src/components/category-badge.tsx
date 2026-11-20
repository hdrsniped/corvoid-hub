import { Badge } from "@/components/ui/badge"
import { cx } from "@/core/format"
import { categoryColor, useDark } from "@/core/colors"
import { categoryBySlug, type Category } from "@/core/categories"

/** Category name with a dot in the category color. Renders nothing when there is no slug. */
export function CategoryBadge({
  slug,
  categories,
  className,
}: {
  slug?: string
  categories: Category[]
  className?: string
}) {
  const dark = useDark()
  if (!slug) return null
  const category = categoryBySlug(categories, slug)
  return (
    <Badge variant="outline" className={cx("gap-1.5", className)}>
      <span className="size-2 shrink-0 rounded-full" style={{ background: categoryColor(category?.hue, dark) }} />
      {category?.name ?? slug}
    </Badge>
  )
}
