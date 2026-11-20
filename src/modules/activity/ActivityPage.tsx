import { useEffect, useMemo, useState } from "react"
import { CircleCheck, PenLine, RefreshCw, ScrollText } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { PageToolbar } from "@/components/page-toolbar"
import { HarnessIcon } from "@/components/harness-icon"
import { trendColor, useDark } from "@/core/colors"
import { cx, shortDate } from "@/core/format"
import { useLoad } from "@/core/hooks"
import { parseLogBullet, type LogBullet, type LogKind } from "@/core/links"
import { loadActivity, type ActivityData } from "@/core/stats"
import { DATA_CHANGED_EVENT } from "@/core/needle-actions"
import type { LogDay } from "@/core/vault"

import { ActivityAreaChart } from "./ActivityAreaChart"
import { QuickLogDialog } from "./QuickLogDialog"
import { StatCards } from "./StatCards"
import { StatsSection } from "./StatsSection"

interface ParsedDay {
  date: string
  items: LogBullet[]
}

/** "all", or only the entries with this kind. */
type KindFilter = "all" | LogKind

function parseDays(days: LogDay[]): ParsedDay[] {
  return days.map((day) => ({
    date: day.date,
    // Newest bullet first within the day.
    items: [...day.bullets].reverse().map(parseLogBullet),
  }))
}

export function ActivityPage() {
  const { data, error, loading, reload } = useLoad(loadActivity, [])
  const dark = useDark()
  const [kind, setKind] = useState<KindFilter>("all")
  const [logOpen, setLogOpen] = useState(false)
  const days = useMemo(() => data?.days ?? [], [data])
  const parsed = useMemo(() => parseDays(days), [days])
  const shown = useMemo(
    () =>
      parsed
        .map((day) => ({ date: day.date, items: day.items.filter((i) => kind === "all" || i.kind === kind) }))
        .filter((day) => day.items.length > 0),
    [parsed, kind]
  )

  // Ctrl+L opens quick log while this screen is mounted, the same shape as the palette's Ctrl+K.
  // Logging is built in, so the shortcut is always on.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "l" && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
        e.preventDefault()
        setLogOpen(true)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  // A palette command can write a log bullet while this screen is open.
  useEffect(() => {
    window.addEventListener(DATA_CHANGED_EVENT, reload)
    return () => window.removeEventListener(DATA_CHANGED_EVENT, reload)
  }, [reload])

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageToolbar>
        <Button variant="outline" size="sm" onClick={reload} disabled={loading}>
          <RefreshCw className={cx(loading && "animate-spin")} />
          Refresh
        </Button>
        <Button size="sm" onClick={() => setLogOpen(true)} title="Log work (Ctrl+L)">
          <PenLine />
          Log
        </Button>
      </PageToolbar>

      {loading && !data && (
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-28 rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-80 rounded-xl" />
        </div>
      )}

      {error && !data && (
        <p className="text-sm text-destructive">Could not load the logs. Check the vault path, then press Refresh.</p>
      )}

      {data && days.length === 0 && (
        <div className="rounded-xl border border-dashed p-10 text-center">
          <ScrollText className="mx-auto mb-3 size-8 text-muted-foreground" />
          <p className="font-medium">No log entries yet</p>
          <p className="text-sm text-muted-foreground">Add bullets to a Log/YYYY-MM-DD.md note in the vault.</p>
        </div>
      )}

      {data && days.length > 0 && (
        <>
          <StatCards data={data as ActivityData} />
          <ActivityAreaChart data={data as ActivityData} />
          <StatsSection data={data as ActivityData} />

          <section className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold tracking-tight">Log</h2>
              <ToggleGroup
                multiple={false}
                variant="outline"
                size="sm"
                value={[kind]}
                onValueChange={(v) => {
                  const next = v[0]
                  if (next === "all" || next === "task" || next === "update") setKind(next)
                }}
              >
                <ToggleGroupItem value="all" className="px-2.5 text-xs">
                  All
                </ToggleGroupItem>
                <ToggleGroupItem value="task" className="px-2.5 text-xs">
                  Tasks
                </ToggleGroupItem>
                <ToggleGroupItem value="update" className="px-2.5 text-xs">
                  Updates
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
            <div className="grid gap-4 xl:grid-cols-2">
              {shown.length === 0 && <p className="text-sm text-muted-foreground">No entries match this filter.</p>}
              {shown.map((day) => (
                <Card key={day.date}>
                  <CardHeader>
                    <CardTitle className="text-base">{shortDate(day.date)}</CardTitle>
                    <CardDescription>{day.date}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ul className="flex flex-col gap-3">
                      {day.items.map((item, i) => (
                        <li key={i} className="flex items-start gap-2">
                          {item.kind === "task" ? (
                            <CircleCheck
                              className="mt-0.5 size-4 shrink-0"
                              style={{ color: trendColor(1, dark) }}
                              aria-label="Task"
                            />
                          ) : (
                            <span
                              role="img"
                              aria-label="Update"
                              className="mt-1.5 size-2 shrink-0 rounded-full bg-muted-foreground"
                            />
                          )}
                          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                            <p className="break-words text-sm">{item.text}</p>
                            <div className="flex flex-wrap items-center gap-1.5">
                              {item.projects.map((p) => (
                                <Badge key={p} variant="secondary">
                                  {p}
                                </Badge>
                              ))}
                              <HarnessIcon harness={item.harness} />
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        </>
      )}

      {logOpen && (
        <QuickLogDialog
          onClose={() => setLogOpen(false)}
          onLogged={reload}
        />
      )}
    </div>
  )
}
