import { useMemo } from "react"
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts"

import { AreaGradients, areaFill, useChartId } from "@/components/chart-gradient"
import { HarnessIcon } from "@/components/harness-icon"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { categoryBySlug } from "@/core/categories"
import { clamp, freshnessColor, harnessColor, projectColor, useDark } from "@/core/colors"
import { cx, isoDate } from "@/core/format"
import { HARNESS_LABEL, KNOWN_HARNESSES } from "@/core/harness"
import { cumulativeRows, lastTouched, weeklyHarnessRows, type ActivityData } from "@/core/stats"
import { mainCategory } from "@/core/types"

/** The trend charts and the last-touched list. Stat tiles and the stacked project chart sit above. */
export function StatsSection({ data }: { data: ActivityData }) {
  const dark = useDark()
  const today = isoDate()
  const harnessId = useChartId()
  const momentumId = useChartId()

  const weekly = useMemo(() => weeklyHarnessRows(data.entries, today), [data.entries, today])
  const loggedNames = useMemo(
    () => data.projects.map((p) => p.project.name).filter((n) => data.entries.some((e) => e.projects.includes(n))),
    [data]
  )
  const momentum = useMemo(() => cumulativeRows(data.entries, loggedNames, today), [data.entries, loggedNames, today])
  const touched = useMemo(() => lastTouched(data.projects, data.entries, today), [data, today])

  const hueByProject = useMemo(
    () =>
      new Map<string, number | undefined>(
        data.projects.map(({ project }) => [
          project.name,
          categoryBySlug(data.categories, mainCategory(project.categories))?.hue,
        ])
      ),
    [data]
  )

  const harnessConfig: ChartConfig = useMemo(
    () =>
      Object.fromEntries(
        KNOWN_HARNESSES.map((id) => [id, { label: HARNESS_LABEL[id], color: harnessColor(id, dark) }])
      ),
    [dark]
  )
  const momentumConfig: ChartConfig = useMemo(
    () =>
      Object.fromEntries(
        loggedNames.map((name) => [
          name,
          { label: name, color: projectColor(name, hueByProject.get(name), dark) },
        ])
      ),
    [loggedNames, hueByProject, dark]
  )

  const maxDays = Math.max(30, ...touched.map((t) => t.days ?? 0))

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Trends</h2>
        <p className="text-sm text-muted-foreground">How work is spread across harnesses and projects over time.</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Harness usage over time</CardTitle>
            <CardDescription>Entries per week for each harness. A rising area means more use.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {weekly.weeksWithData < 2 ? (
              <NotEnoughHistory />
            ) : (
              <>
                <ChartContainer config={harnessConfig} className="h-56 w-full">
                  <AreaChart data={weekly.rows} margin={{ left: 0, right: 8, top: 4 }}>
                    <AreaGradients
                      id={harnessId}
                      items={KNOWN_HARNESSES.map((id) => ({ key: id, color: harnessColor(id, dark) }))}
                      from={0.45}
                    />
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={24} />
                    <YAxis allowDecimals={false} width={24} tickLine={false} axisLine={false} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    {KNOWN_HARNESSES.map((id) => (
                      <Area
                        key={id}
                        dataKey={id}
                        type="natural"
                        stroke={harnessColor(id, dark)}
                        strokeWidth={2}
                        fill={areaFill(harnessId, id)}
                        isAnimationActive={false}
                      />
                    ))}
                  </AreaChart>
                </ChartContainer>
                <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  {KNOWN_HARNESSES.map((id) => (
                    <li key={id} className="flex items-center gap-1.5">
                      <span className="h-0.5 w-4 rounded-full" style={{ background: harnessColor(id, dark) }} />
                      <HarnessIcon harness={id} />
                      {HARNESS_LABEL[id]}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Project momentum</CardTitle>
            <CardDescription>Running total of entries per project. Flat lines are stalled projects.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {momentum.datesWithData < 2 || loggedNames.length === 0 ? (
              <NotEnoughHistory />
            ) : (
              <>
                <ChartContainer config={momentumConfig} className="h-56 w-full">
                  <AreaChart data={momentum.rows} margin={{ left: 0, right: 8, top: 4 }}>
                    <AreaGradients
                      id={momentumId}
                      items={loggedNames.map((name) => ({
                        key: keyOf(name),
                        color: projectColor(name, hueByProject.get(name), dark),
                      }))}
                      from={0.35}
                    />
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={24} />
                    <YAxis allowDecimals={false} width={24} tickLine={false} axisLine={false} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    {loggedNames.map((name) => (
                      <Area
                        key={name}
                        dataKey={name}
                        type="natural"
                        stroke={projectColor(name, hueByProject.get(name), dark)}
                        strokeWidth={2}
                        fill={areaFill(momentumId, keyOf(name))}
                        isAnimationActive={false}
                      />
                    ))}
                  </AreaChart>
                </ChartContainer>
                <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  {loggedNames.map((name) => (
                    <li key={name} className="flex items-center gap-1.5">
                      <span
                        className="size-2 rounded-full"
                        style={{ background: projectColor(name, hueByProject.get(name), dark) }}
                      />
                      {name}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Last touched</CardTitle>
            <CardDescription>Days since each project's latest entry, or its last update. Stale bars fade to gray.</CardDescription>
          </CardHeader>
          <CardContent>
            {touched.length === 0 ? (
              <p className="text-sm text-muted-foreground">No projects yet.</p>
            ) : (
              <ul className="flex flex-col gap-2.5">
                {touched.map((row) => {
                  const hue = hueByProject.get(row.name)
                  const width = row.days === null ? 100 : clamp((row.days / maxDays) * 100, 2, 100)
                  const label = row.days === null ? "never" : row.days === 0 ? "today" : `${row.days} d`
                  return (
                    <li key={row.name} className="grid grid-cols-[minmax(0,10rem)_1fr_4.5rem] items-center gap-3 text-sm">
                      <span className="flex min-w-0 items-center gap-2">
                        <span
                          className="size-2 shrink-0 rounded-full"
                          style={{ background: projectColor(row.name, hue, dark) }}
                        />
                        <span className="truncate">{row.name}</span>
                      </span>
                      <div className="h-2 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${width}%`, background: freshnessColor(row.days, hue, dark) }}
                        />
                      </div>
                      <span className={cx("text-right text-xs tabular-nums text-muted-foreground")}>{label}</span>
                    </li>
                  )
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </section>
  )
}

/** Recharts reads dataKey as a path, so project names with dots need a safe key for the gradient id. */
function keyOf(name: string): string {
  return name.replace(/[^a-zA-Z0-9]/g, "_")
}

function NotEnoughHistory() {
  return (
    <div className="flex h-56 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
      Not enough history yet
    </div>
  )
}
