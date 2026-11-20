import { Sparkles } from "lucide-react"

import type { ModuleDef } from "@/core/types"

import { SkillsPage } from "./SkillsPage"

export const skillsModule: ModuleDef = {
  id: "skills",
  title: "Skills",
  icon: Sparkles,
  route: "/skills",
  needs: "hub",
  component: SkillsPage,
}
