import { Badge } from "@/components/ui/badge"
import type { ProjectStatus } from "@/core/types"

export const STATUS_LABEL: Record<ProjectStatus, string> = {
  idea: "Idea",
  active: "Active",
  blocked: "Blocked",
  paused: "Paused",
  done: "Done",
}

/** Items for the status Select (value = stored status, label = what the user sees). */
export const STATUS_ITEMS = (Object.keys(STATUS_LABEL) as ProjectStatus[]).map((value) => ({
  value,
  label: STATUS_LABEL[value],
}))

const VARIANT: Record<ProjectStatus, "default" | "secondary" | "destructive" | "outline"> = {
  idea: "outline",
  active: "default",
  blocked: "destructive",
  paused: "secondary",
  done: "outline",
}

export function StatusBadge({ status }: { status: ProjectStatus }) {
  return <Badge variant={VARIANT[status]}>{STATUS_LABEL[status]}</Badge>
}
