import { useState } from "react"
import { Plus, Save, Undo2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { categoryColor, oklch, useDark, categoryTone } from "@/core/colors"
import {
  categoriesPath,
  farthestHue,
  loadCategories,
  newCategorySlug,
  saveCategories,
  type Category,
} from "@/core/categories"
import { errorMessage } from "@/core/errors"
import { useLoad } from "@/core/hooks"

/** Edits categories.yaml: add, rename and change the hue. Slugs never change, because project notes refer to them. */
export function CategoriesPanel() {
  const { data, error, loading, reload } = useLoad(loadCategories, [])
  const dark = useDark()
  const [draft, setDraft] = useState<Category[] | null>(null)
  const [newName, setNewName] = useState("")
  const [newHue, setNewHue] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)

  if (loading && data === undefined) return <Skeleton className="h-96 rounded-xl" />
  if (error && data === undefined) {
    return <p className="text-sm text-destructive">Could not read categories.yaml. Press Refresh to try again.</p>
  }
  if (data === undefined) return null

  const rows = draft ?? data.categories
  const dirty = draft !== null
  const addHue = newHue ?? farthestHue(rows.map((c) => c.hue))

  function update(slug: string, patch: Partial<Pick<Category, "name" | "hue">>) {
    setDraft(rows.map((c) => (c.slug === slug ? { ...c, ...patch } : c)))
  }

  function add() {
    const name = newName.trim()
    try {
      const slug = newCategorySlug(name, rows.map((c) => c.slug))
      setDraft([...rows, { slug, name, hue: addHue, extra: {} }])
      setNewName("")
      setNewHue(null)
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  async function save() {
    if (rows.some((c) => !c.name.trim())) {
      toast.error("A category needs a name")
      return
    }
    setSaving(true)
    try {
      await saveCategories({ ...data!, categories: rows.map((c) => ({ ...c, name: c.name.trim() })) })
      toast.success("Categories saved")
      setDraft(null)
      reload()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs break-all text-muted-foreground">{categoriesPath()}</p>

      <ul className="flex flex-col gap-2">
        {rows.map((c) => (
          <li key={c.slug} className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
            <span
              className="size-6 shrink-0 rounded-md border"
              style={{ background: categoryColor(c.hue, dark) }}
              title={oklch(categoryTone(c.hue, dark))}
            />
            <Input
              className="w-56"
              value={c.name}
              aria-label={`Name for ${c.slug}`}
              onChange={(e) => update(c.slug, { name: e.target.value })}
            />
            <code className="text-xs text-muted-foreground">{c.slug}</code>
            <HueControl hue={c.hue} dark={dark} label={`Hue for ${c.name}`} onChange={(hue) => update(c.slug, { hue })} />
          </li>
        ))}
        {rows.length === 0 && <p className="text-sm text-muted-foreground">No categories yet. Add one below.</p>}
      </ul>

      <form
        className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed p-3"
        onSubmit={(e) => {
          e.preventDefault()
          add()
        }}
      >
        <span
          className="size-6 shrink-0 rounded-md border"
          style={{ background: categoryColor(addHue, dark) }}
          title={oklch(categoryTone(addHue, dark))}
        />
        <Input
          className="w-56"
          value={newName}
          placeholder="New category name"
          aria-label="New category name"
          onChange={(e) => setNewName(e.target.value)}
        />
        <code className="text-xs text-muted-foreground">
          {newName.trim() ? `slug: ${safeSlug(newName, rows.map((c) => c.slug))}` : "slug: auto"}
        </code>
        <HueControl hue={addHue} dark={dark} label="Hue for the new category" onChange={setNewHue} />
        <Button type="submit" variant="outline" disabled={!newName.trim()}>
          <Plus />
          Add category
        </Button>
      </form>

      <div className="flex items-center justify-end gap-2">
        {dirty && <span className="mr-auto text-xs text-muted-foreground">Unsaved changes</span>}
        <Button variant="outline" disabled={!dirty} onClick={() => setDraft(null)}>
          <Undo2 />
          Revert
        </Button>
        <Button disabled={!dirty || saving} onClick={save}>
          <Save />
          {saving ? "Saving..." : "Save categories"}
        </Button>
      </div>
    </div>
  )
}

function safeSlug(name: string, existing: string[]): string {
  try {
    return newCategorySlug(name, existing)
  } catch {
    return "name"
  }
}

/** Hue slider with the OKLCH swatch it produces and the hue in degrees. */
function HueControl({
  hue,
  dark,
  label,
  onChange,
}: {
  hue: number
  dark: boolean
  label: string
  onChange: (hue: number) => void
}) {
  return (
    <div className="flex min-w-56 flex-1 items-center gap-3">
      <input
        type="range"
        min={0}
        max={359}
        step={1}
        value={hue}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
        style={{ accentColor: categoryColor(hue, dark) }}
      />
      <span className="w-12 text-right text-xs text-muted-foreground tabular-nums">{hue}°</span>
    </div>
  )
}
