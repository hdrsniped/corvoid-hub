import { useMemo, useState } from "react"
import { BookOpen, Copy, RefreshCw, Search, Sparkles, Terminal, X } from "lucide-react"
import { toast } from "sonner"

import { PageToolbar } from "@/components/page-toolbar"
import { openSetup } from "@/components/setup-dialog"
import { TermIcon } from "@/components/term-icon"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { copyText } from "@/core/clipboard"
import { errorMessage } from "@/core/errors"
import { cx } from "@/core/format"
import {
  glossaryPath,
  useGlossary,
  type GlossaryState,
  type GlossaryTerm,
} from "@/core/glossary"
import { useRoute } from "@/core/navigation"
import {
  NEEDLE_GUIDE_KEY,
  isNeedleReady,
  needleTipSeen,
  rememberNeedleTip,
  useNeedleStatus,
} from "@/core/needle"

/** Every word of the query must appear in the term, its meaning or its example. */
function matches(entry: GlossaryTerm, query: string): boolean {
  if (!query) return true
  const haystack = `${entry.term} ${entry.key} ${entry.means} ${entry.say}`.toLowerCase()
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word))
}

/**
 * The Guide screen: glossary.yaml as compact cards, one per `cv:` term. It is the only place the
 * vocabulary is shown in full, and Ctrl+K opens it filtered to a term (#/guide?term=cv:version).
 */
export function GuidePage() {
  const glossary = useGlossary()
  const { params } = useRoute()
  const wanted = params.get("term")
  // A deep link seeds the search box: keying on the term restarts the content with that query.
  return <GuideContent key={wanted ?? ""} wanted={wanted} glossary={glossary} />
}

function GuideContent({
  wanted,
  glossary,
}: {
  /** Term from the hash query, e.g. "cv:version". */
  wanted: string | null
  glossary: GlossaryState
}) {
  const { terms, loading, error, reload } = glossary
  const [query, setQuery] = useState(wanted ?? "")

  const visible = useMemo(
    () => terms.filter((entry) => matches(entry, query.trim())),
    [terms, query]
  )

  async function copyExample(say: string) {
    try {
      await copyText(say)
      toast.success("Copied the example")
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageToolbar>
        <Button
          variant="outline"
          size="sm"
          onClick={reload}
          disabled={loading}
        >
          <RefreshCw className={cx(loading && "animate-spin")} />
          Refresh
        </Button>
      </PageToolbar>

      <div className="flex flex-col gap-3">
        <div className="flex items-start gap-2 rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
          <BookOpen className="mt-0.5 size-4 shrink-0" />
          <p>
            Type these in any AI harness.{" "}
            <span className="font-mono text-foreground">cv:</span> words mean
            exactly this.
          </p>
        </div>
        <div className="relative max-w-md">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search a term, its meaning or an example"
            className="pl-8"
          />
        </div>
      </div>

      <NeedleGuideCard />

      {loading && terms.length === 0 && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>
      )}

      {error && (
        <p className="text-sm text-destructive">
          Could not read {glossaryPath()}. {error}
        </p>
      )}

      {!loading && !error && terms.length === 0 && (
        <div className="rounded-xl border border-dashed p-10 text-center">
          <BookOpen className="mx-auto mb-3 size-8 text-muted-foreground" />
          <p className="font-medium">No terms yet</p>
          <p className="text-sm text-muted-foreground">
            The app reads {glossaryPath()}. Add a term there and press Refresh.
          </p>
        </div>
      )}

      {terms.length > 0 && visible.length === 0 && (
        <p className="text-sm text-muted-foreground">No term matches.</p>
      )}

      {visible.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {visible.map((entry) => (
            <TermCard
              key={entry.key}
              entry={entry}
              highlighted={
                wanted !== null &&
                (wanted === entry.term || wanted === entry.key)
              }
              onCopy={() => copyExample(entry.say)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/** Four plain sentences the add-on understands; clicking one copies it. */
const NEEDLE_EXAMPLES = [
  "add task fix login to Corvogames",
  "log an update on Starfall: tuned the boss fight",
  "set Corvogames to paused",
  "back up now",
]

/**
 * The Guide's compact card for plain-language commands: what they are, four examples and whether
 * the optional add-on is ready. Dismissing it is remembered in localStorage.
 */
function NeedleGuideCard() {
  const status = useNeedleStatus()
  const [hidden, setHidden] = useState(() => needleTipSeen(NEEDLE_GUIDE_KEY))
  if (hidden) return null

  const ready = isNeedleReady(status.data)

  async function copyExample(sentence: string) {
    try {
      await copyText(sentence)
      toast.success("Copied the command")
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <Card size="sm" className="gap-3">
      <CardHeader>
        <CardTitle className="flex min-w-0 items-center gap-2">
          <Terminal className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">Commands (Needle add-on)</span>
          <span className="ml-auto flex items-center gap-2">
            <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              {ready ? "Ready" : "Not set up"}
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Hide the commands card"
              onClick={() => {
                rememberNeedleTip(NEEDLE_GUIDE_KEY)
                setHidden(true)
              }}
            >
              <X />
            </Button>
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm text-muted-foreground">
        <p>
          Type a sentence in <span className="font-mono text-foreground">Ctrl K</span> and the app
          turns it into the matching action. It runs offline, and every write is confirmed first.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {NEEDLE_EXAMPLES.map((sentence) => (
            <button
              key={sentence}
              type="button"
              title="Copy this command"
              onClick={() => void copyExample(sentence)}
              className="max-w-full truncate rounded-md bg-muted px-2 py-1 font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              {sentence}
            </button>
          ))}
        </div>
      </CardContent>
      <CardFooter className="mt-auto">
        {ready ? (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Sparkles className="size-3.5" />
            Needle is ready. Ask in Ctrl K.
          </p>
        ) : (
          <Button size="sm" variant="outline" onClick={() => openSetup("addons")}>
            <Sparkles />
            Set up Needle
          </Button>
        )}
      </CardFooter>
    </Card>
  )
}

function TermCard({
  entry,
  highlighted,
  onCopy,
}: {
  entry: GlossaryTerm
  /** True when the command palette jumped straight to this term. */
  highlighted: boolean
  onCopy: () => void
}) {
  return (
    <Card
      size="sm"
      className={cx(
        "h-full gap-3",
        highlighted && "ring-2 ring-ring/60"
      )}
    >
      <CardHeader>
        <CardTitle className="flex min-w-0 items-center gap-2">
          <TermIcon icon={entry.icon} />
          <span className="truncate font-mono">{entry.term}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        {entry.means}
      </CardContent>
      <CardFooter className="mt-auto gap-2">
        <code
          title={entry.say}
          className="min-w-0 flex-1 truncate rounded-md bg-muted px-2 py-1 font-mono text-xs text-muted-foreground"
        >
          {entry.say || "No example"}
        </code>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Copy the example for ${entry.term}`}
          disabled={!entry.say}
          onClick={onCopy}
        >
          <Copy />
        </Button>
      </CardFooter>
    </Card>
  )
}
