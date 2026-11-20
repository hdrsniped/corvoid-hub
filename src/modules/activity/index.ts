import { Activity } from "lucide-react"

import type { ModuleDef } from "@/core/types"

import { ActivityPage } from "./ActivityPage"

export const activityModule: ModuleDef = {
  id: "activity",
  title: "Activity",
  icon: Activity,
  route: "/activity",
  needs: "vault",
  component: ActivityPage,
}
