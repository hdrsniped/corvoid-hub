import type { ComponentType, ReactNode } from "react"
import { FileCode, Globe, KeyRound, Plug, Terminal } from "lucide-react"
import { siGithub } from "simple-icons"

import { HarnessIcon } from "@/components/harness-icon"
import { HubMarkIcon } from "@/components/hub-mark"
import { Badge } from "@/components/ui/badge"
import { cx } from "@/core/format"
import { type SkillEntry, type SkillUses } from "@/core/skills"

type IconType = ComponentType<{ className?: string }>

/**
 * Where a skill is connected, as ONE row of icons (the only place a skill's source/harness is shown).
 * Hub skill: Corvoid Hub mark + every harness it reaches (OpenCode reads Claude Code's skills
 * folder, so it comes along with Claude). Local skill: only its own harness.
 */
export function ConnectionIcons({ skill, className }: { skill: SkillEntry; className?: string }) {
  const reached: string[] = [...skill.harnesses]
  if (skill.source === "hub" && reached.includes("claude-code")) reached.push("opencode")
  return (
    <span className={cx("inline-flex items-center gap-1", className)}>
      {skill.source === "hub" && <HubMarkIcon />}
      {reached.map((h) => (
        <HarnessIcon key={h} harness={h} />
      ))}
    </span>
  )
}

/** GitHub mark (simple-icons; lucide no longer ships brand icons). */
export function GithubGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cx("size-3", className)} fill="currentColor" aria-hidden="true">
      <path d={siGithub.path} />
    </svg>
  )
}

/** Small count chip with an icon. */
export function CountChip({ icon: Icon, label, count }: { icon: IconType; label: string; count: number }) {
  return (
    <span
      title={`${count} ${label}`}
      className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
    >
      <Icon className="size-3" />
      {count}
    </span>
  )
}

/** Compact feature counts for a card. Shows only the non-empty kinds. */
export function FeatureChips({ uses }: { uses: SkillUses }) {
  const items: [IconType, string, number][] = [
    [KeyRound, "API keys and env vars", uses.env.length],
    [GithubGlyph, "GitHub repos", uses.repos.length],
    [Globe, "web hosts", uses.domains.length],
    [Plug, "MCP servers", uses.mcp.length],
    [Terminal, "commands", uses.commands.length],
    [FileCode, "scripts", uses.scripts.length],
  ]
  const shown = items.filter(([, , n]) => n > 0)
  if (shown.length === 0) return null
  return (
    <span className="flex flex-wrap items-center gap-1">
      {shown.map(([icon, label, count]) => (
        <CountChip key={label} icon={icon} label={label} count={count} />
      ))}
    </span>
  )
}

/** Outline pill for facts in the detail header. */
export function InfoChip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <Badge variant="outline" className={cx("gap-1.5 font-normal text-muted-foreground", className)}>
      {children}
    </Badge>
  )
}
