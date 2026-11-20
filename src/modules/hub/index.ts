import { Boxes } from "lucide-react"

import type { ModuleDef } from "@/core/types"

import { HubPage } from "./HubPage"

export const hubModule: ModuleDef = {
  id: "hub",
  title: "Hub",
  icon: Boxes,
  route: "/hub",
  needs: "hub",
  component: HubPage,
}
