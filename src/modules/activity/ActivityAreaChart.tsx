import { useMemo, useState } from "react"
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts"

import { AreaGradients, areaFill, useChartId } from "@/components/chart-gradient"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, type ChartConfig } from "@/components/ui/chart"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { categoryBySlug } from "@/core/categories"
import { projectColor, useDark } from "@/core/colors"
import { mainCategory } from "@/core/types"
import { lastDays, shortDate } from "@/core/format"
import type { ActivityData } from "@/core/stats"

const RANGES = { "7d": 7, "30d": 30, "90d": 90 } as const
type Range = keyof typeof RANGES

/** One stacked area: `key` is a safe data key (project names can contain dots), `name` is the project. */
interface Series {
  key: string
  name: string
  color: string
}

/**
 * Entries per day, one stacked area per project. Biggest project at the bottom of the stack.
 * An entry that links two projects counts once for each. "Tasks only" counts #task entries.
 */
export function ActivityAreaChart({ data }: { data: ActivityData }) {
  const dark = useDark()
  const id = useChartId()
  const [range, setRange] = useState<Range>("30d")
  const [scope, setScope] = useState<"all" | "task">("all")
  const days = RANGES[range]

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

  const { rows, series } = useMemo(() => {
    const dates = lastDays(days)
    const inRange = new Set(dates)
    const perDay = new Map<string, Map<string, number>>()
    const totals = new Map<string, number>()
    for (const e of data.entries) {
      if (!inRange.has(e.date)) continue
      if (scope === "task" && e.kind !== "task") continue
      for (const p of e.projects) {
        const day = perDay.get(e.date) ?? new Map<string, number>()
        day.set(p, (day.get(p) ?? 0) + 1)
        perDay.set(e.date, day)
        totals.set(p, (totals.get(p) ?? 0) + 1)
      }
    }

    const names = [...totals.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([n]) => n)
    const series: Series[] = names.map((name, i) => ({
      key: `s${i}`,
      name,
      color: projectColor(name, hueByProject.get(name), dark),
    }))
    const rows = dates.map((date) => {
      const day = perDay.get(date)
      const row: Record<string, string | number> = { date, label: shortDate(date) }
      series.forEach((s, i) => {
        row[s.key] = day?.get(names[i]) ?? 0
      })
      return row
    })
    return { rows, series }
  }, [data, days, hueByProject, dark, scope])

  const config: ChartConfig = useMemo(
    () => Object.fromEntries(series.map((s) => [s.key, { label: s.name, color: s.color }])),
    [series]
  )

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>Activity by project</CardTitle>
        <CardDescription>
          {scope === "task" ? "Tasks done per day" : "Entries per day"}, stacked by project. Last {days} days.
        </CardDescription>
        <CardAction className="flex items-center gap-2">
          <ToggleGroup
            multiple={false}
            variant="outline"
            size="sm"
            value={[scope]}
            onValueChange={(v) => {
              const next = v[0]
              if (next === "all" || next === "task") setScope(next)
            }}
          >
            <ToggleGroupItem value="all" className="px-2.5 text-xs">
              All
            </ToggleGroupItem>
            <ToggleGroupItem value="task" className="px-2.5 text-xs">
              Tasks only
            </ToggleGroupItem>
          </ToggleGroup>
          <ToggleGroup
            multiple={false}
            variant="outline"
            size="sm"
            value={[range]}
            onValueChange={(v) => {
              const next = v[0]
              if (next === "7d" || next === "30d" || next === "90d") setRange(next)
            }}
          >
            {(Object.keys(RANGES) as Range[]).map((r) => (
              <ToggleGroupItem key={r} value={r} className="px-2.5 text-xs">
                {r}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </CardAction>
      </CardHeader>
      <CardContent>
        {series.length === 0 ? (
          <div className="flex h-72 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
            No entries linked to a project in the last {days} days
          </div>
        ) : (
          <ChartContainer config={config} className="h-72 w-full">
            <AreaChart data={rows} margin={{ left: 0, right: 8, top: 8 }}>
              <AreaGradients id={id} items={series} />
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={24} />
              <YAxis allowDecimals={false} width={28} tickLine={false} axisLine={false} />
              <ChartTooltip cursor={false} content={<ActivityTooltip series={series} />} />
              <ChartLegend content={<ChartLegendContent />} />
              {series.map((s) => (
                <Area
                  key={s.key}
                  dataKey={s.key}
                  type="natural"
                  stackId="projects"
                  stroke={s.color}
                  strokeWidth={1.5}
                  fill={areaFill(id, s.key)}
                  isAnimationActive={false}
                />
              ))}
            </AreaChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  )
}

interface TooltipProps {
  active?: boolean
  payload?: Array<{ payload?: Record<string, unknown> }>
  series: Series[]
}

/** Lists each project's entries for the hovered day, busiest first, with the day's total. */
function ActivityTooltip({ active, payload, series }: TooltipProps) {
  const row = payload?.[0]?.payload
  if (!active || !row) return null
  const items = series
    .map((s) => ({ ...s, count: Number(row[s.key] ?? 0) }))
    .filter((s) => s.count > 0)
    .sort((a, b) => b.count - a.count)
  const total = items.reduce((sum, s) => sum + s.count, 0)

  return (
    <div className="grid min-w-44 gap-1.5 rounded-lg border bg-popover px-2.5 py-2 text-xs text-popover-foreground shadow-xl">
      <div className="font-medium">{shortDate(String(row.date))}</div>
      {items.length === 0 ? (
        <div className="text-muted-foreground">No entries</div>
      ) : (
        <>
          <ul className="grid gap-1">
            {items.map((s) => (
              <li key={s.key} className="flex items-center justify-between gap-4">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="size-2 shrink-0 rounded-full" style={{ background: s.color }} />
                  <span className="truncate">{s.name}</span>
                </span>
                <span className="tabular-nums">{s.count}</span>
              </li>
            ))}
          </ul>
          <div className="flex justify-between gap-4 border-t pt-1.5 font-medium">
            <span>Total</span>
            <span className="tabular-nums">{total}</span>
          </div>
        </>
      )}
    </div>
  )
}
