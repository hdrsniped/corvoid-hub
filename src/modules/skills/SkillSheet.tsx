import { useState } from "react"
import { Clock, Eye, File, Pencil, Sparkles } from "lucide-react"

import { LockControl } from "@/components/lock-control"
import { Badge } from "@/components/ui/badge"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { lockAt, useLocks } from "@/core/locks"
import { formatAgo, type SkillEntry } from "@/core/skills"

import { ConnectionIcons, InfoChip } from "./SkillBits"
import { SkillEditor } from "./SkillEditor"
import { SkillOverview } from "./SkillOverview"

interface SkillSheetProps {
  skill: SkillEntry | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onChanged: () => void
  onMoved: (key: string) => void
  onRemoved: () => void
}

/** Detail view of one skill: header facts, then Overview (uses, files) and Edit. */
export function SkillSheet({ skill, open, onOpenChange, onChanged, onMoved, onRemoved }: SkillSheetProps) {
  const [tab, setTab] = useState("overview")
  const { locks, set: setLock } = useLocks(onChanged)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 overflow-y-auto p-0 sm:max-w-2xl">
        {skill && (
          <>
            <SheetHeader className="gap-3 border-b p-5 pr-12">
              <SheetTitle className="flex items-center gap-2 text-lg break-all">
                <Sparkles className="size-4 shrink-0 text-muted-foreground" />
                {skill.name}
              </SheetTitle>
              <SheetDescription>{skill.description || (skill.hasSkillFile ? "No description." : "No SKILL.md yet.")}</SheetDescription>
              <div className="flex flex-wrap items-center gap-2">
                <ConnectionIcons skill={skill} />
                <InfoChip>
                  <File className="size-3" />
                  {skill.fileCount} {skill.fileCount === 1 ? "file" : "files"}
                </InfoChip>
                <InfoChip>
                  <Clock className="size-3" />
                  {formatAgo(skill.modified)}
                </InfoChip>
                {!skill.hasSkillFile && <Badge variant="destructive">No SKILL.md</Badge>}
                <LockControl
                  path={skill.dir}
                  lock={lockAt(skill.dir, locks)}
                  onSet={(mode) => setLock(skill.dir, mode)}
                />
              </div>
            </SheetHeader>

            <div className="p-5">
              <Tabs value={tab} onValueChange={(v) => setTab(String(v))}>
                <TabsList>
                  <TabsTrigger value="overview">
                    <Eye />
                    Overview
                  </TabsTrigger>
                  <TabsTrigger value="edit">
                    <Pencil />
                    Edit
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="overview" className="pt-4">
                  <SkillOverview skill={skill} />
                </TabsContent>
                <TabsContent value="edit" className="pt-4" keepMounted>
                  <SkillEditor skill={skill} onChanged={onChanged} onMoved={onMoved} onRemoved={onRemoved} />
                </TabsContent>
              </Tabs>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
