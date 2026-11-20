import { AppWindow } from "lucide-react"

import type { ModuleDef } from "@/core/types"

import { AppsPage } from "./AppsPage"

export const appsModule: ModuleDef = {
  id: "apps",
  title: "Apps",
  icon: AppWindow,
  route: "/apps",
  needs: "hub",
  component: AppsPage,
}
