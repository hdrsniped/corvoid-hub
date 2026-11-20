import { useState, type ReactNode } from "react"
import { FileUp, FolderUp, GitBranch, Plus, Type } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { cfg } from "@/core/config"
import { errorMessage } from "@/core/errors"
import { copyIntoInbox, saveInboxText, skillInstallGit } from "@/core/fs"
import { baseNameOf, pickPath } from "@/core/dialog"
import { slugify } from "@/core/slug"

interface AddSkillDialogProps {
  onAdded: () => void
}

/** Shows the slug the item will be saved under, and normalizes the field on blur. */
function NameField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const slug = slugify(value)
  return (
    <div className="flex flex-col gap-1.5">
      <Label>Name</Label>
      <Input
        value={value}
        placeholder="my-skill"
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => onChange(slugify(value))}
      />
      <p className="break-all text-xs text-muted-foreground">
        Saved as {cfg().inbox}\{slug || "<name>"}
      </p>
    </div>
  )
}

export function AddSkillDialog({ onAdded }: AddSkillDialogProps) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState("url")

  function done() {
    setOpen(false)
    onAdded()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        <Plus />
        Add skill
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a skill</DialogTitle>
          <DialogDescription>New skills go to the inbox first. An agent normalizes them afterwards.</DialogDescription>
        </DialogHeader>
        <Tabs value={tab} onValueChange={(v) => setTab(String(v))}>
          <TabsList>
            <TabsTrigger value="url">
              <GitBranch />
              GitHub URL
            </TabsTrigger>
            <TabsTrigger value="file">
              <FileUp />
              File or folder
            </TabsTrigger>
            <TabsTrigger value="text">
              <Type />
              Paste text
            </TabsTrigger>
          </TabsList>
          <TabsContent value="url" className="pt-4">
            <UrlForm onDone={done} />
          </TabsContent>
          <TabsContent value="file" className="pt-4">
            <FileForm onDone={done} />
          </TabsContent>
          <TabsContent value="text" className="pt-4">
            <TextForm onDone={done} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}

function FormActions({ children }: { children: ReactNode }) {
  return <div className="flex justify-end pt-2">{children}</div>
}

function UrlForm({ onDone }: { onDone: () => void }) {
  const [url, setUrl] = useState("")
  const [name, setName] = useState("")
  const [busy, setBusy] = useState(false)

  function onUrlChange(value: string) {
    setUrl(value)
    if (!name) {
      // Suggest a name from the last URL segment, e.g. https://github.com/me/cool-skill -> cool-skill.
      const last = value.trim().replace(/\/+$/, "").split("/").pop() ?? ""
      setName(slugify(last.replace(/\.git$/, "")))
    }
  }

  async function submit() {
    const slug = slugify(name)
    if (!url.trim() || !slug) return
    setBusy(true)
    try {
      await skillInstallGit(url.trim(), slug)
      toast.success(`Cloned into the inbox as ${slug}`)
      onDone()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label>GitHub URL</Label>
        <Input value={url} onChange={(e) => onUrlChange(e.target.value)} placeholder="https://github.com/owner/repo" />
      </div>
      <NameField value={name} onChange={setName} />
      <FormActions>
        <Button type="submit" disabled={busy || !url.trim() || !slugify(name)}>
          {busy ? "Cloning..." : "Clone into inbox"}
        </Button>
      </FormActions>
    </form>
  )
}

function FileForm({ onDone }: { onDone: () => void }) {
  const [picked, setPicked] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [busy, setBusy] = useState(false)

  async function choose(kind: "file" | "folder") {
    try {
      const path = await pickPath(kind)
      if (!path) return
      setPicked(path)
      if (!name) setName(slugify(baseNameOf(path).replace(/\.[^.]+$/, "")))
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  async function submit() {
    const slug = slugify(name)
    if (!picked || !slug) return
    setBusy(true)
    try {
      await copyIntoInbox(picked, slug)
      toast.success(`Copied into the inbox as ${slug}`)
      onDone()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label>Source</Label>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => choose("file")}>
            <FileUp />
            Choose file
          </Button>
          <Button variant="outline" onClick={() => choose("folder")}>
            <FolderUp />
            Choose folder
          </Button>
        </div>
        <p className="break-all text-xs text-muted-foreground">{picked ?? "Nothing picked yet."}</p>
      </div>
      <NameField value={name} onChange={setName} />
      <FormActions>
        <Button onClick={submit} disabled={busy || !picked || !slugify(name)}>
          {busy ? "Copying..." : "Copy into inbox"}
        </Button>
      </FormActions>
    </div>
  )
}

function TextForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("")
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)

  async function submit() {
    const slug = slugify(name)
    if (!slug || !text.trim()) return
    setBusy(true)
    try {
      await saveInboxText(slug, text)
      toast.success(`Saved to the inbox as ${slug}`)
      onDone()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <NameField value={name} onChange={setName} />
      <div className="flex flex-col gap-1.5">
        <Label>Idea or skill text</Label>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Describe the skill, or paste its instructions"
          className="min-h-40"
        />
      </div>
      <FormActions>
        <Button onClick={submit} disabled={busy || !slugify(name) || !text.trim()}>
          {busy ? "Saving..." : "Save to inbox"}
        </Button>
      </FormActions>
    </div>
  )
}
