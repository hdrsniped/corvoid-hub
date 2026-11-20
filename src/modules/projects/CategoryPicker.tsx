import { useState } from "react"
import { Plus, Star } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { CategoryBadge } from "@/components/category-badge"
import { categoryColor, useDark } from "@/core/colors"
import { farthestHue, loadCategories, newCategorySlug, saveCategories, type Category } from "@/core/categories"
import { errorMessage } from "@/core/errors"

interface CategoryPickerProps {
  /** Selected category slugs. The first one is the main category. */
  value: string[]
  onChange: (next: string[]) => void
  /** All categories from categories.yaml. */
  categories: Category[]
  /** Called after a new category was written to categories.yaml, so lists can reload. */
  onCategoryAdded: () => void
}

/**
 * Multi-select for a project's categories: toggle chips, a main-category list (first = main),
 * and an inline field that creates a new category in categories.yaml and selects it.
 */
export function CategoryPicker({ value, onChange, categories, onCategoryAdded }: CategoryPickerProps) {
  const dark = useDark()
  const [draft, setDraft] = useState("")
  const [adding, setAdding] = useState(false)

  function toggle(slug: string) {
    onChange(value.includes(slug) ? value.filter((s) => s !== slug) : [...value, slug])
  }

  function makeMain(slug: string) {
    onChange([slug, ...value.filter((s) => s !== slug)])
  }

  async function addCategory() {
    const name = draft.trim()
    if (!name) return
    setAdding(true)
    try {
      const file = await loadCategories()
      const slug = newCategorySlug(name, file.categories.map((c) => c.slug))
      const hue = farthestHue(file.categories.map((c) => c.hue))
      await saveCategories({
        ...file,
        categories: [...file.categories, { slug, name, hue, extra: {} }],
      })
      onChange([...value, slug])
      setDraft("")
      onCategoryAdded()
      toast.success(`Added category ${name}`)
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setAdding(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1.5">
        {categories.length === 0 && <p className="text-xs text-muted-foreground">No categories yet. Add one below.</p>}
        {categories.map((c) => {
          const selected = value.includes(c.slug)
          return (
            <Button
              key={c.slug}
              type="button"
              size="sm"
              variant={selected ? "secondary" : "outline"}
              aria-pressed={selected}
              onClick={() => toggle(c.slug)}
            >
              <span className="size-2 shrink-0 rounded-full" style={{ background: categoryColor(c.hue, dark) }} />
              {c.name}
            </Button>
          )
        })}
      </div>

      {value.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {value.map((slug, index) => (
            <li key={slug} className="flex items-center justify-between gap-2">
              <CategoryBadge slug={slug} categories={categories} />
              {index === 0 ? (
                <Badge variant="outline" className="gap-1">
                  <Star className="size-3 fill-current" aria-hidden="true" />
                  Main
                </Badge>
              ) : (
                <Button type="button" variant="ghost" size="sm" onClick={() => makeMain(slug)}>
                  <Star />
                  Make main
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          void addCategory()
        }}
      >
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="New category name"
          aria-label="New category name"
        />
        <Button type="submit" variant="outline" size="sm" disabled={!draft.trim() || adding}>
          <Plus />
          {adding ? "Adding..." : "Add"}
        </Button>
      </form>
    </div>
  )
}
