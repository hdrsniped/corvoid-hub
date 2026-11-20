import { useEffect, useMemo, useRef, useState } from "react"
import ForceGraph2D from "react-force-graph-2d"
import { RefreshCw } from "lucide-react"

import { PageToolbar } from "@/components/page-toolbar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { categoryColor, neutralColor, oklch, projectColor, useDark, categoryTone } from "@/core/colors"
import { cx } from "@/core/format"
import { useLoad } from "@/core/hooks"

import { buildGraph, type GraphData, type GraphNode, type NodeKind } from "./buildGraph"

const KIND_LABEL: Record<NodeKind, string> = {
  category: "Category hub",
  project: "Project hub",
  note: "Project note",
  canvas: "Canvas",
  log: "Log day",
}

/** Legend order. Shape and size carry the kind; color carries the project. */
const KINDS: NodeKind[] = ["category", "project", "note", "canvas", "log"]

/** Tracks the pixel size of an element so the canvas can fill it. */
function useBox<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [box, setBox] = useState({ width: 0, height: 0 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setBox({ width: el.clientWidth, height: el.clientHeight })
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return [ref, box] as const
}

/** Display node: a graph node with its canvas color, plus the fields the force simulation adds. */
type DrawNode = GraphNode & { color: string; x?: number; y?: number }
type DrawLink = { source: string; target: string; kind: string; color: string }

function nodeColor(node: GraphNode, hueOf: Map<string, number>, dark: boolean): string {
  const hue = node.category !== undefined ? hueOf.get(node.category) : undefined
  switch (node.kind) {
    case "category":
      return categoryColor(hue, dark)
    case "log":
      return neutralColor(dark, 0.7)
    case "note":
      return projectColor(node.project ?? node.label, hue, dark, 0.6)
    default:
      return projectColor(node.project ?? node.label, hue, dark)
  }
}

export function GraphPage() {
  const { data, error, loading, reload } = useLoad(buildGraph, [])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showHubs, setShowHubs] = useState(true)
  const [boxRef, box] = useBox<HTMLDivElement>()
  const dark = useDark()

  const hueOf = useMemo(
    () => new Map((data?.categories ?? []).map((c) => [c.slug, c.hue])),
    [data]
  )

  // The force simulation mutates node objects, so give it fresh copies each time the graph is rebuilt
  // or the hub toggle changes.
  const graphData = useMemo<{ nodes: DrawNode[]; links: DrawLink[] } | null>(() => {
    if (!data) return null
    const visible = (n: GraphNode) => showHubs || n.kind !== "category"
    const nodes = data.nodes.filter(visible).map((n): DrawNode => ({ ...n, color: nodeColor(n, hueOf, dark) }))
    const ids = new Set(nodes.map((n) => n.id))
    const links = data.links
      .filter((l) => ids.has(l.source) && ids.has(l.target))
      .map((l): DrawLink => {
        const hub = nodes.find((n) => n.id === l.source)
        const color =
          l.kind === "category"
            ? categoryColor(hub?.category ? hueOf.get(hub.category) : undefined, dark, 0.45)
            : neutralColor(dark, 0.2)
        return { source: l.source, target: l.target, kind: l.kind, color }
      })
    return { nodes, links }
  }, [data, showHubs, hueOf, dark])

  const selected: GraphNode | null = data?.nodes.find((n) => n.id === selectedId) ?? null
  const linkCount = selected
    ? data?.links.filter((l) => l.source === selected.id || l.target === selected.id).length ?? 0
    : 0
  const labelColor = oklch(dark ? { l: 0.93, c: 0, h: 0 } : { l: 0.27, c: 0, h: 0 })

  return (
    <div className="flex flex-col gap-4 p-6">
      <PageToolbar>
        <Button variant="outline" size="sm" onClick={reload} disabled={loading}>
          <RefreshCw className={cx(loading && "animate-spin")} />
          Refresh
        </Button>
      </PageToolbar>

      {error && !data && (
        <p className="text-sm text-destructive">Could not build the graph. Check the vault path, then press Refresh.</p>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div ref={boxRef} className="relative h-[68vh] min-h-96 overflow-hidden rounded-xl border bg-card">
          {loading && !data && <Skeleton className="absolute inset-0 rounded-xl" />}

          {data && data.nodes.length === 0 && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 p-6 text-center">
              <p className="font-medium">Nothing to draw yet</p>
              <p className="text-sm text-muted-foreground">Create a project or add a log day in the vault.</p>
            </div>
          )}

          {graphData && graphData.nodes.length > 0 && box.width > 0 && (
            <ForceGraph2D
              graphData={graphData}
              width={box.width}
              height={box.height}
              cooldownTicks={120}
              linkColor={(link) => (link as unknown as DrawLink).color}
              linkWidth={(link) => {
                const k = (link as unknown as DrawLink).kind
                return k === "folder" ? 0.6 : k === "category" ? 1.2 : 1
              }}
              nodeCanvasObject={(raw, ctx, scale) => {
                const node = raw as unknown as DrawNode
                const r = node.kind === "category" ? 8 : node.kind === "project" ? 6 : 4
                ctx.beginPath()
                ctx.arc(node.x ?? 0, node.y ?? 0, r, 0, 2 * Math.PI)
                ctx.fillStyle = node.color
                ctx.fill()
                if (node.id === selectedId) {
                  ctx.lineWidth = 2 / scale
                  ctx.strokeStyle = labelColor
                  ctx.stroke()
                }
                if (node.kind === "project" || node.kind === "category" || scale > 1.6) {
                  const fontSize = 11 / scale
                  ctx.font = `${fontSize}px sans-serif`
                  ctx.textAlign = "center"
                  ctx.textBaseline = "top"
                  ctx.fillStyle = labelColor
                  ctx.fillText(node.label, node.x ?? 0, (node.y ?? 0) + r + 1 / scale)
                }
              }}
              nodePointerAreaPaint={(raw, color, ctx) => {
                const node = raw as unknown as { x?: number; y?: number }
                ctx.beginPath()
                ctx.arc(node.x ?? 0, node.y ?? 0, 7, 0, 2 * Math.PI)
                ctx.fillStyle = color
                ctx.fill()
              }}
              onNodeClick={(raw) => setSelectedId((raw as unknown as GraphNode).id)}
              onBackgroundClick={() => setSelectedId(null)}
            />
          )}

          <ul className="pointer-events-none absolute bottom-3 left-3 flex flex-col gap-1 rounded-lg bg-background/80 p-2 text-xs backdrop-blur">
            {KINDS.map((k) => (
              <li key={k} className="flex items-center gap-2">
                <span
                  className={cx("rounded-full bg-muted-foreground/60", k === "category" || k === "project" ? "size-3" : "size-2")}
                />
                {KIND_LABEL[k]}
              </li>
            ))}
            <li className="pt-1 text-muted-foreground">Color = project, hue = category</li>
          </ul>
        </div>

        <div className="flex flex-col gap-4">
          <Card className="h-fit">
            {selected ? (
              <>
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{KIND_LABEL[selected.kind]}</Badge>
                    <span className="text-xs text-muted-foreground">{linkCount} links</span>
                  </div>
                  <CardTitle className="break-words">{selected.label}</CardTitle>
                  <CardDescription className="break-all font-mono text-xs">{selected.path}</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <p className="max-h-80 overflow-y-auto whitespace-pre-wrap break-words text-sm">
                    {selected.preview || "No preview text."}
                  </p>
                  <Button variant="ghost" size="sm" className="self-start" onClick={() => setSelectedId(null)}>
                    Clear selection
                  </Button>
                </CardContent>
              </>
            ) : (
              <CardHeader>
                <CardTitle className="text-base">Select a node</CardTitle>
                <CardDescription>Click a node to see its path and a preview of the note.</CardDescription>
              </CardHeader>
            )}
          </Card>

          <Card className="h-fit">
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-base">Categories</CardTitle>
                <div className="flex items-center gap-2">
                  <Checkbox id="graph-show-hubs" checked={showHubs} onCheckedChange={(v) => setShowHubs(v === true)} />
                  <Label htmlFor="graph-show-hubs" className="text-xs font-normal">
                    Category hubs
                  </Label>
                </div>
              </div>
              <CardDescription>Projects in one category are linked through its hub.</CardDescription>
            </CardHeader>
            <CardContent>
              {data && data.categories.length > 0 ? (
                <ul className="flex flex-col gap-1.5 text-sm">
                  {data.categories.map((c) => (
                    <CategoryRow key={c.slug} name={c.name} hue={c.hue} dark={dark} count={countIn(data, c.slug)} />
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No categories yet. Add some on the Hub screen.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

/** Projects in a category, counting every category a project has (not only its main one). */
function countIn(data: GraphData, slug: string): number {
  return data.nodes.filter((n) => n.kind === "project" && n.categories?.includes(slug)).length
}

function CategoryRow({ name, hue, dark, count }: { name: string; hue: number; dark: boolean; count: number }) {
  return (
    <li className="flex items-center justify-between gap-2">
      <span className="flex min-w-0 items-center gap-2">
        <span
          className="size-2.5 shrink-0 rounded-full"
          style={{ background: oklch(categoryTone(hue, dark)) }}
        />
        <span className="truncate">{name}</span>
      </span>
      <span className="text-xs tabular-nums text-muted-foreground">{count}</span>
    </li>
  )
}
