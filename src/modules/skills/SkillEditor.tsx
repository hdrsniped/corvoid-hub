import { useState, type ReactNode } from "react"
import { Save } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { errorMessage } from "@/core/errors"
import { useLoad } from "@/core/hooks"
import { loadSkillMd, saveSkillMd, type SkillEntry, type SkillFields, type SkillMd } from "@/core/skills"

import { SkillActions } from "./SkillActions"

interface SkillEditorProps {
  skill: SkillEntry
  /** Called after a save or a move, so the list reloads. */
  onChanged: () => void
  /** Called after a move with the new skill's key ("hub:<name>"). */
  onMoved: (key: string) => void
  /** Called after a removal, so the sheet closes. */
  onRemoved: () => void
}

/** Edits the frontmatter (name, description) and the body of SKILL.md. Unknown frontmatter keys are kept. */
export function SkillEditor({ skill, onChanged, onMoved, onRemoved }: SkillEditorProps) {
  const md = useLoad(() => loadSkillMd(skill.dir), [skill.dir])
  if (!md.data) {
    return md.error ? <p className="text-sm text-destructive">{md.error}</p> : <Skeleton className="h-64 rounded-xl" />
  }
  return (
    <SkillForm
      key={skill.dir}
      skill={skill}
      md={md.data}
      onChanged={onChanged}
      onMoved={onMoved}
      onRemoved={onRemoved}
    />
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  )
}

function SkillForm({ skill, md, onChanged, onMoved, onRemoved }: SkillEditorProps & { md: SkillMd }) {
  // Textareas hold \n only, so the saved baseline uses \n too; the save writes the file's own line ending.
  const [base, setBase] = useState<SkillFields>(() => ({
    name: md.data.name ? String(md.data.name) : skill.folder,
    description: md.data.description ? String(md.data.description) : "",
    body: md.body.replace(/\r\n/g, "\n"),
  }))
  const [name, setName] = useState(base.name)
  const [description, setDescription] = useState(base.description)
  const [body, setBody] = useState(base.body)
  const [saving, setSaving] = useState(false)

  const dirty = name !== base.name || description !== base.description || body !== base.body
  const canSave = dirty && !saving && name.trim().length > 0

  async function save() {
    setSaving(true)
    try {
      const fields = { name: name.trim(), description: description.trim(), body }
      await saveSkillMd(skill.dir, md, fields)
      setBase(fields)
      setName(fields.name)
      setDescription(fields.description)
      toast.success("SKILL.md saved")
      onChanged()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <SkillActions skill={skill} onChanged={onChanged} onMoved={onMoved} onRemoved={onRemoved} />

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Description">
          <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="One line: when to use it" />
        </Field>
      </div>

      <Field label="Body">
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          spellCheck={false}
          className="min-h-80 font-mono text-sm leading-relaxed"
        />
      </Field>

      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">
          {!md.exists ? "No SKILL.md yet. Saving creates one." : dirty ? "Unsaved changes" : "All changes saved"}
        </span>
        <Button onClick={save} disabled={!canSave}>
          <Save />
          {saving ? "Saving..." : "Save"}
        </Button>
      </div>
    </div>
  )
}
