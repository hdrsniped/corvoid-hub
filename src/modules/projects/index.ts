import { FolderKanban } from "lucide-react"

import type { ModuleDef } from "@/core/types"

import { ProjectsPage } from "./ProjectsPage"

export const projectsModule: ModuleDef = {
  id: "projects",
  title: "Projects",
  icon: FolderKanban,
  route: "/projects",
  needs: "vault",
  component: ProjectsPage,
}
