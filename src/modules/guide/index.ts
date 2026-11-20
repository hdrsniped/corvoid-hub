import { BookOpen } from "lucide-react"

import type { ModuleDef } from "@/core/types"

import { GuidePage } from "./GuidePage"

export const guideModule: ModuleDef = {
  id: "guide",
  title: "Guide",
  icon: BookOpen,
  route: "/guide",
  needs: "hub",
  component: GuidePage,
}
