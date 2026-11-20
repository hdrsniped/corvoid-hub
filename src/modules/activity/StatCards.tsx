import { useMemo, type ReactNode } from "react"
import { Minus, TrendingDown, TrendingUp, type LucideIcon } from "lucide-react"

import { HarnessIcon } from "@/components/harness-icon"
import { Badge } from "@/components/ui/badge"
import { Card, CardAction, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { trendColor, useDark } from "@/core/colors"
import { isoDate, shortDate } from "@/core/format"
import { HARNESS_LABEL } from "@/core/harness"
import { lastTouched, summaryTiles, type ActivityData } from "@/core/stats"

/** Four headline tiles in the style of shadcn's section cards. */
export function StatCards({ data }: { data: ActivityData }) {
  const dark = useDark()
  const today = isoDate()

  const tiles = useMemo(() => summaryTiles(data.projects, data.entries, today), [data, today])
  const stalest = useMemo(() => {
    const active = new Set(data.projects.filter((p) => p.project.status === "active").map((p) => p.project.name))
    // lastTouched is sorted most stale first (never touched first).
    return lastTouched(data.projects, data.entries, today).find((r) => active.has(r.name))
  }, [data, today])

  const delta = tiles.tasksThisWeek - tiles.tasksLastWeek
  const deltaDir = delta > 0 ? 1 : delta < 0 ? -1 : 0
  const deltaPct =
    tiles.tasksLastWeek > 0
      ? `${delta > 0 ? "+" : ""}${Math.round((delta / tiles.tasksLastWeek) * 100)}%`
      : delta > 0
        ? "New"
        : "0%"
  const DeltaIcon = deltaDir > 0 ? TrendingUp : deltaDir < 0 ? TrendingDown : Minus

  const activeShare = tiles.totalProjects > 0 ? Math.round((tiles.activeProjects / tiles.totalProjects) * 100) : 0
  const stalestDays = stalest?.days ?? null
  const stalestDir = stalest && (stalestDays === null || stalestDays > 14) ? -1 : 0

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Stat
        dark={dark}
        label="Active projects"
        value={String(tiles.activeProjects)}
        badge={`${activeShare}% of ${tiles.totalProjects}`}
        footer={`${tiles.updatedThisWeek} updated this week`}
        description="Status changes are not logged, so this counts notes whose date was updated this week."
      />
      <Stat
        dark={dark}
        label="Tasks done this week"
        value={String(tiles.tasksThisWeek)}
        badge={deltaPct}
        trend={deltaDir}
        trendIcon={DeltaIcon}
        footer={deltaDir > 0 ? "Up vs last week" : deltaDir < 0 ? "Down vs last week" : "Flat vs last week"}
        description={`${tiles.tasksLastWeek} tasks last week. Weeks start on Monday.`}
      />
      <Stat
        dark={dark}
        label="Most used harness this month"
        value={
          tiles.topHarness ? (
            <span className="flex items-center gap-2">
              <HarnessIcon harness={tiles.topHarness.id} className="size-6" glyphClassName="size-5" />
              {HARNESS_LABEL[tiles.topHarness.id]}
            </span>
          ) : (
            "None yet"
          )
        }
        badge={tiles.topHarness ? `${Math.round(tiles.topHarness.share * 100)}% share` : undefined}
        footer={tiles.topHarness ? `${HARNESS_LABEL[tiles.topHarness.id]} leads this month` : "No AI entries this month"}
        description={tiles.topHarness ? `${tiles.topHarness.count} AI entries this month` : "Log entries with a harness to see this"}
      />
      <Stat
        dark={dark}
        label="Stalest active project"
        value={stalest ? stalest.name : "None"}
        badge={stalest ? (stalestDays === null ? "Never" : `${stalestDays} d`) : undefined}
        trend={stalestDir}
        trendIcon={stalestDir < 0 ? TrendingDown : undefined}
        footer={
          stalest
            ? stalestDays === null
              ? "Never logged"
              : `Untouched for ${stalestDays} days`
            : "No active projects"
        }
        description={stalest?.date ? `Last activity ${shortDate(stalest.date)}` : "Add a log entry to start tracking"}
      />
    </div>
  )
}

interface StatProps {
  dark: boolean
  label: string
  value: ReactNode
  /** Outline badge text in the top right. Omit for no badge. */
  badge?: string
  trend?: -1 | 0 | 1
  trendIcon?: LucideIcon
  footer: string
  description: string
}

function Stat({ dark, label, value, badge, trend = 0, trendIcon: TrendIcon, footer, description }: StatProps) {
  const color = trendColor(trend, dark)
  return (
    <Card className="@container/card bg-linear-to-t from-primary/5 to-card shadow-xs">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="truncate text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">{value}</CardTitle>
        {badge && (
          <CardAction>
            <Badge variant="outline" className="gap-1 tabular-nums" style={{ color }}>
              {TrendIcon && <TrendIcon className="size-3.5" aria-hidden="true" />}
              {badge}
            </Badge>
          </CardAction>
        )}
      </CardHeader>
      <CardFooter className="flex-col items-start gap-1.5 text-sm">
        <div className="line-clamp-1 flex items-center gap-2 font-medium">
          {footer}
          {TrendIcon && <TrendIcon className="size-4" style={{ color }} aria-hidden="true" />}
        </div>
        <div className="text-muted-foreground">{description}</div>
      </CardFooter>
    </Card>
  )
}
