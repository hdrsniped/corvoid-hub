import type { ModuleDef } from "@/core/types"

import { activityModule } from "./activity"
import { appsModule } from "./apps"
import { graphModule } from "./graph"
import { guideModule } from "./guide"
import { hubModule } from "./hub"
import { projectsModule } from "./projects"
import { skillsModule } from "./skills"

/** The ONLY place modules are listed. Add or remove a screen by adding or removing one line here. */
export const modules: ModuleDef[] = [
  projectsModule,
  appsModule,
  activityModule,
  graphModule,
  hubModule,
  skillsModule,
  guideModule,
]

export function findModuleByRoute(route: string): ModuleDef | undefined {
  return modules.find((m) => m.route === route)
}
