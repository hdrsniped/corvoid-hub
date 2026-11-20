import { Network } from "lucide-react"

import type { ModuleDef } from "@/core/types"

import { GraphPage } from "./GraphPage"

export const graphModule: ModuleDef = {
  id: "graph",
  title: "Graph",
  icon: Network,
  route: "/graph",
  needs: "vault",
  component: GraphPage,
}
