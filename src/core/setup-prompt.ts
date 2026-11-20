import { HARNESS_LABEL, type AiHarnessId } from "./harness"
import type { DetectPath, SetupDetect } from "./setup"

/**
 * The prompt a user pastes into an AI harness to set Corvoid Hub up. Plain text, no shorthand: the
 * agent that reads it may know nothing about this app. Every path comes from `setup_detect`, so the
 * agent never guesses where things go.
 */
export function buildSetupPrompt({
  harnesses,
  detect,
}: {
  harnesses: AiHarnessId[]
  detect: SetupDetect
}): string {
  const found = (p: DetectPath) => `${p.path} (${p.exists ? "exists" : "not there yet"})`
  const picked =
    harnesses.length > 0
      ? harnesses.map((h) => HARNESS_LABEL[h]).join(", ")
      : "ask me which harnesses I use, then use those"
  const vaultHints =
    detect.obsidianVaults.length > 0
      ? `\n  Obsidian knows about these vaults: ${detect.obsidianVaults.join(", ")}`
      : ""

  return `Corvoid Hub is a small desktop app for the plain files that make up an AI coding setup: one hub folder holding the global rules, skills and stack packs, plus an Obsidian vault with one note per project and one daily log. The app only reads and edits those files, so everything below can also be done by hand. It is not set up on this machine yet.

Set it up with me. Ask me before you write or change anything, and wait for my answer at each step. Do not guess paths and do not create anything I have not agreed to.

Paths I detected (start from these):
  Config file the app reads: ${detect.configPath}
  Hub folder: ${found(detect.hub)}
  Obsidian vault: ${found(detect.vault)}${vaultHints}
  Claude Code skills: ${found(detect.claudeSkills)}
  Antigravity skills: ${found(detect.antigravitySkills)}
  OpenCode config: ${found(detect.opencodeConfig)}
  Antigravity app: ${detect.antigravityExe.path ? found(detect.antigravityExe) : "not found"}

Harnesses to connect: ${picked}.

Steps:

1. Confirm with me the hub folder and the Obsidian vault (create them if I agree; a vault can be any folder, Obsidian does not have to know it yet).

2. Write the config file at ${detect.configPath}. It is JSON with absolute Windows paths (backslashes doubled) and these keys:
   {
     "hub": "<hub folder>",
     "vault": "<Obsidian vault>",
     "claudeSkills": "<Claude Code skills folder>",
     "antigravitySkills": "<Antigravity skills folder>",
     "opencodeConfig": "<OpenCode config folder>"
   }
   Keep any keys that are already in the file.

3. Create the hub files that are missing (never overwrite an existing file):
   - AGENTS.md: the global rules every harness follows (environment, how to work, how to log).
   - categories.yaml: a list of {slug, name, hue} (hue 0-360). These are the project categories.
   - apps.yaml: a list of {name, path, what, run} for my reusable tools.
   - locks.yaml: a list of {path, mode}, mode read-only or no-ai. Agent rules must respect it.
   - glossary.yaml: a list of {term, icon, means, say}. Shared vocabulary both I and the agents use.
   - skills/ and packs/: empty folders for now.
   In the vault, create Projects/, Log/ and Templates/Project.md.
   A project note is Projects/<Name>/<Name>.md with frontmatter: type: project, status (idea, active, blocked, paused, done), category (a list of slugs from categories.yaml), log (auto or on-demand), version (1), harness, next, updated (YYYY-MM-DD), repo (path). Sections: ## Goal, ## Next (open tasks as "- [ ] task"), ## Done ("- [x] task"), ## History, ## Notes.
   A daily log is Log/YYYY-MM-DD.md, one bullet per finished thing:
   - [[Projects/<Name>/<Name>|<Name>]] — #task what was done (harness)
   Use #task when it finishes a task from ## Next, #update for anything else, and the harness name at the end.

4. Wire the global rules into ${picked}, so every harness reads the same file. Back up every file before you change it, as <name>.bak-YYYYMMDD-HHMMSS next to it, and skip a harness whose folder does not exist:
   - Claude Code: add the line "@<hub folder>\\AGENTS.md" to ~/.claude/CLAUDE.md.
   - OpenCode: add "<hub folder>\\AGENTS.md" as an entry in the "instructions" array of ~/.config/opencode/opencode.json (or opencode.jsonc when that is the file I have).
   - Antigravity: create the plugin folder ~/.gemini/config/plugins/corvoid-hub/ with plugin.json {"name":"corvoid-hub","version":"1.0.0","description":"Corvoid Hub global rules"} and a copy of the hub AGENTS.md at rules/AGENTS.md. That copy has to be re-copied whenever the rules change.
   Do not add comments and do not touch anything else in those files.

5. Tell me to click Refresh in Corvoid Hub. Setup is then done and the app stops asking.`
}
