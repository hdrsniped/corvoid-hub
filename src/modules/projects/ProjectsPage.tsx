import { useEffect, useMemo, useState } from "react"
import { Cell, Pie, PieChart } from "recharts"
import { FolderOpen, RefreshCw } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Sheet, SheetContent } from "@/components/ui/sheet"
import { CategoryChips } from "@/components/category-chips"
import { HarnessIcon } from "@/components/harness-icon"
import { LockBadge } from "@/components/lock-control"
import { PageToolbar } from "@/components/page-toolbar"
import { ProgressBar } from "@/components/progress-bar"
import { TermHint } from "@/components/term-hint"
import { projectColor, useDark } from "@/core/colors"
import { loadCategories, categoryBySlug } from "@/core/categories"
import { cfg } from "@/core/config"
import { cx } from "@/core/format"
import { useLoad } from "@/core/hooks"
import { lockOf, useLocks } from "@/core/locks"
import { navigate, useRoute } from "@/core/navigation"
import { DATA_CHANGED_EVENT } from "@/core/needle-actions"
import type { ProjectStatus } from "@/core/types"
import {
  loadProjects,
  PROJECT_STATUSES,
  type ProjectRecord,
} from "@/core/vault"

import { NewProjectDialog } from "./NewProjectDialog"
import { ProjectEditor } from "./ProjectEditor"
import { STATUS_LABEL, StatusBadge } from "./status"
import { mainCategory } from "@/core/types"
import { progressOf } from "@/core/versions"

type Filter = "all" | ProjectStatus

/** Category filter value: "all", "none" (no category), or a category slug. */
const ALL = "all"
const NONE = "none"

const CHART_CONFIG: ChartConfig = {
  idea: { label: STATUS_LABEL.idea, color: "var(--chart-5)" },
  active: { label: STATUS_LABEL.active, color: "var(--chart-1)" },
  blocked: { label: STATUS_LABEL.blocked, color: "var(--chart-2)" },
  paused: { label: STATUS_LABEL.paused, color: "var(--chart-3)" },
  done: { label: STATUS_LABEL.done, color: "var(--chart-4)" },
}

/** Most recently updated first; projects with no date go last. */
function byUpdatedThenName(a: ProjectRecord, b: ProjectRecord): number {
  const ua = a.project.updated ?? ""
  const ub = b.project.updated ?? ""
  if (ua !== ub) return ua < ub ? 1 : -1
  return a.project.name.localeCompare(b.project.name)
}

export function ProjectsPage() {
  const { data, error, loading, reload } = useLoad(loadProjects, [])
  const categories = useLoad(loadCategories, [])
  const { locks } = useLocks()
  const dark = useDark()
  const [filterPick, setFilterPick] = useState<Filter | null>(null)
  const [categoryPick, setCategoryPick] = useState<string | null>(null)
  const [manualOpen, setManualOpen] = useState<string | null>(null)
  // The command palette (and a plain link) opens a project with #/projects?open=<name>.
  const { params } = useRoute()
  const openParam = params.get("open") || null
  // `#/projects?open=X&tab=tasks` opens the sheet on its task lists ("what's left on X").
  const focusTasks = params.get("tab") === "tasks"
  // A card click wins over the query, so a deep link to a project that no longer exists
  // cannot block the sheet; closing the sheet drops both.
  const openName = manualOpen ?? openParam

  // A palette command that saves a project note fires this, so the open cards show the new state.
  useEffect(() => {
    window.addEventListener(DATA_CHANGED_EVENT, reload)
    return () => window.removeEventListener(DATA_CHANGED_EVENT, reload)
  }, [reload])

  const categoryList = useMemo(
    () => categories.data?.categories ?? [],
    [categories.data]
  )
  // A command can filter through the hash (#/projects?status=active&category=game-dev); a chip
  // click wins over the query until the filters change.
  const statusParam = params.get("status")
  const categoryParam = params.get("category")
  const filter: Filter =
    filterPick ??
    (PROJECT_STATUSES.includes(statusParam as ProjectStatus) ? (statusParam as Filter) : "all")
  const categoryFilter =
    categoryPick ??
    (categoryParam === NONE || categoryList.some((c) => c.slug === categoryParam)
      ? (categoryParam as string)
      : ALL)
  const projects = useMemo(() => data?.projects ?? [], [data])
  const counts = useMemo(
    () =>
      PROJECT_STATUSES.map((status) => ({
        status,
        label: STATUS_LABEL[status],
        count: projects.filter((p) => p.project.status === status).length,
      })),
    [projects]
  )
  const visible = useMemo(
    () =>
      projects
        .filter((p) => filter === "all" || p.project.status === filter)
        .filter((p) => {
          if (categoryFilter === ALL) return true
          if (categoryFilter === NONE) return p.project.categories.length === 0
          // Matches when ANY of the project's categories is the one picked.
          return p.project.categories.includes(categoryFilter)
        })
        .sort(byUpdatedThenName),
    [projects, filter, categoryFilter]
  )
  const selected = projects.find((p) => p.project.name === openName) ?? null

  const categoryItems = useMemo(
    () => [
      { value: ALL, label: "All categories" },
      ...categoryList.map((c) => ({ value: c.slug, label: c.name })),
      { value: NONE, label: "No category" },
    ],
    [categoryList]
  )

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageToolbar>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            reload()
            categories.reload()
          }}
          disabled={loading}
        >
          <RefreshCw className={cx(loading && "animate-spin")} />
          Refresh
        </Button>
        <NewProjectDialog
          existingNames={projects.map((p) => p.project.name)}
          categories={categoryList}
          onCreated={reload}
          onCategoriesChanged={categories.reload}
        />
      </PageToolbar>

      {loading && !data && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-36 rounded-xl" />
          ))}
        </div>
      )}

      {error && !data && (
        <p className="text-sm text-destructive">
          Could not load projects. Check the vault path, then press Refresh.
        </p>
      )}

      {data && projects.length === 0 && (
        <div className="rounded-xl border border-dashed p-10 text-center">
          <FolderOpen className="mx-auto mb-3 size-8 text-muted-foreground" />
          <p className="font-medium">No projects yet</p>
          <p className="text-sm text-muted-foreground">
            Create one with New project. It is saved as a hub note in the vault.
          </p>
        </div>
      )}

      {data && projects.length > 0 && (
        <div className="grid gap-6 lg:grid-cols-[17rem_1fr]">
          <Card>
            <CardHeader>
              <CardTitle>By status</CardTitle>
              <CardDescription>{projects.length} projects</CardDescription>
            </CardHeader>
            <div className="flex flex-col items-center gap-4 px-4 pb-4">
              <ChartContainer
                config={CHART_CONFIG}
                className="aspect-square h-44"
              >
                <PieChart>
                  <ChartTooltip content={<ChartTooltipContent hideLabel />} />
                  <Pie
                    data={counts}
                    dataKey="count"
                    nameKey="status"
                    innerRadius={48}
                    outerRadius={80}
                    strokeWidth={2}
                  >
                    {counts.map((c) => (
                      <Cell key={c.status} fill={`var(--color-${c.status})`} />
                    ))}
                  </Pie>
                </PieChart>
              </ChartContainer>
              <ul className="grid w-full gap-1 text-sm">
                {counts.map((c) => (
                  <li
                    key={c.status}
                    className="flex items-center justify-between"
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className="size-2.5 rounded-sm"
                        style={{ background: `var(--color-${c.status})` }}
                      />
                      {c.label}
                    </span>
                    <span className="text-muted-foreground tabular-nums">
                      {c.count}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </Card>

          <div className="flex min-w-0 flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              {(["all", ...PROJECT_STATUSES] as Filter[]).map((f) => {
                const count =
                  f === "all"
                    ? projects.length
                    : (counts.find((c) => c.status === f)?.count ?? 0)
                return (
                  <Button
                    key={f}
                    size="sm"
                    variant={filter === f ? "default" : "outline"}
                    onClick={() => setFilterPick(f)}
                  >
                    {f === "all" ? "All" : STATUS_LABEL[f]}
                    <span className="tabular-nums opacity-70">{count}</span>
                  </Button>
                )
              })}
              <Select
                value={categoryFilter}
                onValueChange={(v) => v && setCategoryPick(String(v))}
                items={categoryItems}
              >
                <SelectTrigger
                  size="sm"
                  className="ml-auto w-44"
                  aria-label="Filter by category"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {categoryItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {visible.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No projects match these filters.
              </p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
                {visible.map((rec) => {
                  // Accent color comes from the main category (first entry) only.
                  const hue = categoryBySlug(
                    categoryList,
                    mainCategory(rec.project.categories)
                  )?.hue
                  const accent = projectColor(rec.project.name, hue, dark)
                  const { done, open, version } = rec.project
                  const total = done + open
                  const pct = progressOf(done, open)
                  return (
                    // A div, not a button: the category "+N" chip inside is a button of its own.
                    <div
                      key={rec.project.name}
                      role="button"
                      tabIndex={0}
                      className="min-w-0 cursor-pointer rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                      onClick={() => setManualOpen(rec.project.name)}
                      onKeyDown={(e) => {
                        if (
                          e.target === e.currentTarget &&
                          (e.key === "Enter" || e.key === " ")
                        ) {
                          e.preventDefault()
                          setManualOpen(rec.project.name)
                        }
                      }}
                    >
                      <Card
                        className="h-full min-w-0 gap-3 border-l-[3px] transition hover:ring-2 hover:ring-ring/40"
                        style={{ borderLeftColor: accent }}
                      >
                        <CardHeader className="min-w-0 grid-cols-1">
                          <div className="flex min-w-0 items-start justify-between gap-2">
                            <CardTitle className="min-w-0 flex-1 truncate" title={rec.project.name}>
                              {rec.project.name}
                            </CardTitle>
                            <span className="shrink-0">
                              <StatusBadge status={rec.project.status} />
                            </span>
                          </div>
                          <CardDescription className="line-clamp-2 min-h-10">
                            {rec.project.next || "No next step set"}
                          </CardDescription>
                        </CardHeader>
                        <CardFooter className="flex-col items-stretch gap-2.5 text-xs text-muted-foreground">
                          <div className="flex min-w-0 items-center gap-2">
                            <CategoryChips
                              slugs={rec.project.categories}
                              categories={categoryList}
                            />
                            <span className="ml-auto hidden shrink-0 sm:inline">
                              Updated {rec.project.updated ?? "never"}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 tabular-nums">
                            <span className="flex shrink-0 items-center gap-1">
                              <span className="shrink-0">
                                v{version} ·{" "}
                                {total > 0
                                  ? `${done}/${total} tasks`
                                  : "no tasks"}
                              </span>
                              <TermHint term="cv:version" />
                            </span>
                            {total > 0 && (
                              <>
                                <ProgressBar
                                  value={pct}
                                  color={accent}
                                  className="flex-1"
                                />
                                <span className="w-9 shrink-0 text-right">
                                  {pct}%
                                </span>
                              </>
                            )}
                            <span className="ml-auto flex items-center gap-1">
                              <LockBadge
                                lock={lockOf(
                                  [
                                    rec.project.repo,
                                    `${cfg().projects}\\${rec.project.name}`,
                                  ],
                                  locks
                                )}
                              />
                              <HarnessIcon harness={rec.project.harness} />
                            </span>
                          </div>
                        </CardFooter>
                      </Card>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {data && data.problems.length > 0 && (
        <div className="rounded-lg border border-destructive/40 p-3 text-xs text-destructive">
          <p className="mb-1 font-medium">
            Some project notes could not be read:
          </p>
          <ul className="list-disc pl-5">
            {data.problems.map((p) => (
              <li key={p.folder}>
                {p.folder}: {p.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      <Sheet
        open={selected !== null}
        onOpenChange={(open) => {
          if (open) return
          setManualOpen(null)
          // Dropping the query tells the palette-deep-linked sheet it is closed.
          if (openParam) navigate("/projects")
        }}
      >
        <SheetContent className="overflow-y-auto">
          {selected && (
            <ProjectEditor
              key={selected.project.name}
              record={selected}
              categories={categoryList}
              onSaved={reload}
              onCategoriesChanged={categories.reload}
              focusTasks={focusTasks}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}
