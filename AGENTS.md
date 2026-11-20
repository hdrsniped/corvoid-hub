# Corvoid Hub — agent guide

Desktop app (Tauri v2 + React + Vite + TypeScript + shadcn/ui) that is the UI for the AI hub and the Vortex Obsidian vault. Scaffolded with create-tauri-ui (https://tauriui.vercel.app/). Read this file before changing anything.

## What it manages (data lives in files, the app is only a view/editor)
| Root | Path | What |
|---|---|---|
| hub | `corvoid-hub.json` → `hub` | `AGENTS.md` (global rules), `apps.yaml` (index of my reusable apps: `name`, `path`, `what`, `run`), `packs/*.md`, `skills/<name>/SKILL.md`, `inbox/` (skills waiting to be normalized), `backups/removed-skills/`, `hub-sync.ps1` |
| vault | `corvoid-hub.json` → `vault` | `Projects/<Name>/<Name>.md` (frontmatter: type, status, harness, next, updated, repo, category (YAML list of slugs, first = main), log, version; sections `## Goal`, `## Next`, `## Done`, `## History` with `### v1`... and `## Notes`), `Log/YYYY-MM-DD.md` |

**The app is optional.** Everything it does must also be doable by an AI agent editing these files directly (add a skill = create `inbox/<name>/`; change a project = edit its note). Never put logic or data only the app understands. Never store app state that duplicates these files. Never read/write `.obsidian/` or `.smart-env/`.

## Layout
```
src-tauri/src/lib.rs      Rust commands: get_config, list_dir, read_text, write_text, delete_file, run_hub_sync,
                          skill_install_git, copy_into_inbox, save_inbox_text, skill_roots, path_exists,
                          resolve_path, skill_copy_to_hub, skill_transfer, skill_remove, quicklog_suggest,
                          quicklog_commit, apply_locks
                          Paths are not hardcoded: `Config` is loaded once (OnceLock) from corvoid-hub.json (see
                          Config below) and every derived path comes from it. Every path is checked against the
                          allowed roots: hub, vault, %USERPROFILE%\.claude\skills and %USERPROFILE%\.gemini\config\skills
                          (deny otherwise); .obsidian/.smart-env stay blocked.
                          write_text creates missing parent folders. delete_file only removes single files (no
                          folders, no links) inside hub\packs or hub\inbox. path_exists is the only command that
                          accepts any path: it answers a bool for apps.yaml folders and reads nothing.
                          skill_transfer copies a skill folder into hub|claude|gemini as <name> (slug-checked,
                          refuses an existing name or the same root); keep_original=false then moves the original
                          to <hub>\backups\removed-skills. skill_remove does the same for one folder and refuses
                          links/junctions ("managed by the hub, remove it from the hub instead").
                          quicklog_suggest runs needle-log.ps1 with -DryRun, quicklog_commit runs vlog.ps1 with
                          -Harness me (kind must be task|update, the project folder must be in Projects\), apply_locks
                          runs bin\apply-locks.ps1. Those three run off the UI thread with -ExecutionPolicy Bypass
                          and no console window. Missing scripts come back as a clear message, never a crash.
                          Logs go to <logDir> (default <hub>\.logs).
src/core/                 shared: tauri wrappers (fs.ts), frontmatter parse/write (markdown.ts), types.ts,
                          config.ts (cfg() + loadConfig, nothing hardcoded)
src/core/apps.ts          apps.yaml load/save (keeps header comments and unknown keys), add/rename/remove helpers
src/core/shell.ts         openFolder: opener plugin open_path, falls back to reveal_item_in_dir
src/core/clipboard.ts     copyText: async clipboard API, hidden-textarea fallback
src/core/vault.ts         project loader/saver (version, task sections, History archive), new project, daily logs
src/core/transfer.ts      hand-off to another harness: buildContinuePrompt (paths that exist only), setProjectHarness
src/core/navigation.ts    hash route: path + query, navigate/useRoute; a screen opens one item from the query
src/core/sections.ts      bullet blocks of a `##` section: parse, serialize, add, checkbox normalization
src/core/versions.ts      body layout Goal/Next/Done/History/Notes, progressOf, History `### vN` parse and archive
src/core/skills.ts        skill index (hub + harness folders): files, uses detection, SKILL.md load/save
src/core/hub.ts           rules, packs, inbox items, agent normalize prompt
src/core/stats.ts         activity data loader and trend math (weekly rows, cumulative rows, last touched, summary tiles)
src/core/links.ts         log bullet parsing: wikilinks, #task/#update, trailing (harness)
src/core/colors.ts        OKLCH palette: category, project (hash-shifted), freshness, harness brand colors, trend colors; useDark()
src/core/categories.ts    categories.yaml load/save (keeps header comments and unknown keys), slugs, farthest free hue
src/core/locks.ts         locks.yaml load/save (header kept), path matching (lockAt/isLocked/lockOf), setLock +
                          apply_locks, assertUnlocked guard for saves, useLocks() for screens and sheets
src/core/quicklog.ts      needle-log JSON suggestion parse (exit 0/3/4), kind guess, its no-project message
src/core/harness.ts       harness ids (claude-code | antigravity | opencode | me | other) parsed from log bullets; isAiHarness()
src/core/glossary.ts      glossary.yaml load/parse (list of {term, icon, means, say}), session cache, useGlossary(),
                          term(key) lookup by cv:x or x. Read-only: the app never writes this file.
src/assets/hub-mark.svg   the app's own mark (hub: center node + 5 linked nodes). Source for the app icons. Uses currentColor.
src/components/           shared UI pieces: harness-icon.tsx (HarnessIcon + HarnessGlyph), hub-mark.tsx (HubMark, HubMarkIcon),
                          lock-control.tsx (LockControl menu, LockBadge for card icon rows),
                          command-palette.tsx (Ctrl+K search over projects/apps/skills/terms/screens),
                          chart-gradient.tsx (AreaGradients, areaFill, useChartId), category-badge.tsx,
                          category-chips.tsx (main badge + "+N" popover), progress-bar.tsx (thin bar),
                          page-toolbar.tsx (PageToolbar portal into the top bar), external-link-guard.tsx,
                          term-hint.tsx (TermHint: muted (?) with the glossary meaning), term-icon.tsx (TermIcon:
                          kebab-case lucide name from glossary.yaml -> component)
src/modules/<id>/         one folder per screen, self-contained:
    index.ts              exports a ModuleDef { id, title, icon, route, needs, component } (needs = the root the screen reads)
    *.tsx                 UI; may import from src/core, src/components/ui and the shared src/components/*.tsx, never from another module
src/modules/projects/     ProjectsPage (cards, filters), ProjectEditor (detail sheet), CategoryPicker, NewProjectDialog, status.tsx
src/modules/apps/         AppsPage (cards, copy run, open folder, missing-path badge), AppDialog (add/edit with folder picker)
src/modules/activity/     ActivityPage (log + task/update filter), QuickLogDialog (Ctrl+L), StatCards, ActivityAreaChart,
                          StatsSection
src/modules/skills/       SkillsPage (search, source filter, inbox), SkillSheet (Overview/Edit), SkillOverview (uses, file tree),
                          SkillEditor (frontmatter form), SkillActions (Move to + Remove), AddSkillDialog, SkillBits
src/modules/guide/        GuidePage (glossary.yaml as compact cards, search, deep link ?term=cv:x)
src/modules/registry.ts   the ONLY place modules are listed. Add/remove a screen = add/remove one line here.
src/components/ui/        shadcn components (add with the shadcn CLI, don't hand-write)
```
Modules: `projects`, `apps`, `activity`, `graph`, `hub` (Rules, Packs, Categories, Locks tabs), `skills`, `guide`.

## Guide and term hints
- `<hub>\glossary.yaml` is the only vocabulary: a list of `{term: cv:x, icon: <lucide kebab-case>, means, say}`. The app reads it and never writes it. A missing file means no terms, not an error.
- `core/glossary.ts` parses it, caches the list for the session (`clearGlossaryCache()` + `reload()` in `useGlossary` read it again) and looks a term up with `term("cv:version")` or `term("version")`.
- Guide (last screen, `BookOpen`) shows one compact card per term: `TermIcon`, the term in mono, `means`, and `say` in a muted code chip with a copy button. Search matches every word in term, meaning or example. `#/guide?term=cv:version` fills the search box and rings that card.
- `TermHint term="cv:version"` renders a small muted (?) whose tooltip shows the term, `means` and `say`; it renders nothing when the glossary has no such term. Text always comes from glossary.yaml, never from a hardcoded string.
- Hints sit beside: version (project card and sheet), Log mode (New project), Harness and Transfer, Categories, Locks (project sheet and Hub > Locks), Next/Done task headers, the Skills "Hub" filter, and the Apps toolbar ("App index").
- The term icon comes from lucide's `icons` export via `TermIcon`, with `BookOpen` as fallback for an unknown name. Icons are never emoji or images.

## Project note model (tasks and versions)
- `version` is a whole number in the frontmatter, default 1 when missing.
- `## Next` holds open tasks as `- [ ] task`; `## Done` holds finished tasks of the current version as `- [x] task`. A legacy plain `- task` bullet is read as open in Next and finished in Done.
- On save the app rewrites both lists as checkboxes, keeps indented sub-lines, and writes the sections in the order Goal, Next, Done, History, Notes; other sections keep their text and follow.
- Ticking a Next task moves it to Done. At 100% a "Start v2" button (with a confirm dialog) archives Done under `## History` → `### v1`, clears Done and sets `version: 2`. Earlier versions are never deleted.
- Project cards and the detail sheet show `v1 · 5/7 · 71%` with a thin progress bar in the project color.

## Colors & categories
- Categories live in `<hub>\categories.yaml` (`slug`, `name`, `hue`). Edit them in Hub > Categories, in the project picker (New category field), or by hand. Slugs never change in the app, because project notes refer to them. Projects use `category: [slug, ...]` (YAML list; the first entry is the main category) and `log: auto|on-demand`. A single string is read as a one-item list, and the app always writes a list. No categories = key left out.
- A project can have several categories. `Project.categories: string[]`; `mainCategory()` (types.ts) gives the first. Project cards and the detail sheet show the main badge plus a muted "+N" chip (popover lists the rest). The Projects filter matches a project if ANY of its categories matches. Graph: a project links to the hub of every one of its categories. Activity and stats count a project in each category, but its color uses only the main one.
- Every color is `oklch()`. Category color = the category hue at the fixed L/C from `CATEGORY_TONE` in `colors.ts` (one set for light, one for dark). No category = neutral gray.
- Project color = its MAIN category hue shifted by a name hash (up to +-25 degrees) plus one of three lightness steps. Use it for card accents, timeline dots, graph nodes and chart series.
- L/C are constants in `colors.ts`, not CSS variables, because canvas (graph) and SVG chart attributes cannot read CSS variables. Read the theme with `useDark()`.
- Charts are area charts: `natural` curves, a vertical gradient fill fading to transparent (`AreaGradients`), project colors per series. The Activity stacked chart is `ActivityAreaChart.tsx` (range toggle 7d/30d/90d, custom tooltip).
- Harness icons are in the brand color (`harnessColor`): Claude Code = simple-icons brand converted to oklch; Antigravity = a small orbit glyph in Google blue; OpenCode is black in its brand, so it follows the theme (dark ink on light, light ink on dark). Names come from `harness.ts`.
- Harness `me`: log bullets ending in "(me)" that the user wrote without AI. Icon = the app mark (`HubMark`, grayscale). It is not an AI harness, so it is left out of the harness charts and tiles (`isAiHarness`).

## Harness display
- A harness is never text. Always `HarnessIcon` from `src/components/harness-icon.tsx` (or `HarnessGlyph` when the name sits next to it, e.g. a menu item): brand-colored Claude Code glyph, the real Antigravity PNG, OpenCode in the theme's ink, and `HubMark` for `me`.
- `HarnessIcon harness={raw}` always renders: empty → muted dashed circle, tooltip "No harness yet"; text that is not a known harness → muted "?" circle, tooltip = the raw text. So a project with `harness:` empty shows a state, not nothing.
- Hub-owned things (hub skills, apps from apps.yaml) show `HubMarkIcon`, never a text "Hub" pill. Hub skills also show every harness they reach.
- One icon row per card, bottom-right: project card = harness, skill card = hub mark + harnesses, app card = hub mark. A locked item adds `LockBadge` to the left of those. Icons in rows are `size-3.5`, icons in titles `size-4`.
- Stat cards (`StatCards.tsx`): gradient `from-primary/5 to-card`, outline trend badge (`trendColor`), footer insight. "Changed status this week" uses the note's `updated` date as a proxy, because status history is not kept.

## Transfer a project
- Project sheet → Harness field → `Transfer` (`ArrowRightLeft`): a menu with Claude Code / Antigravity / OpenCode (their glyphs) and "Copy continue prompt".
- Transfer copies a self-contained prompt (`core/transfer.ts` → `buildContinuePrompt`) and then writes `harness: <label>` + `updated: today` into the note with `patchNote`, so every other key and the body stay as they are. "Copy continue prompt" copies the same text without touching the note.
- The prompt names the hub rules, `<repo>\AGENTS.md`, `<repo>\.ai\HANDOFF.md` and the project note, but only paths that exist (`path_exists`); then repo, version, done/total, next step, the `## Next` items and the log mode.
- Toast after a transfer: `Transfer prompt copied. Paste it into <harness>.`

## Quick log (Ctrl+L)
- Activity toolbar → `Log` (`PenLine`) or Ctrl+L opens `src/modules/activity/QuickLogDialog.tsx` (the shortcut is registered while the Activity screen is mounted). Without `vlog` and `needleLog` in corvoid-hub.json the button is disabled with the reason and no shortcut is registered (`cfg().quickLog`).
- One sentence → `quicklog_suggest` runs `needle-log.ps1 "<sentence>" -DryRun`. It prints one JSON line `{project, kind, text, harness, confidence, sure}`; exit 3 = it could not tell the project, exit 4 = a low-confidence suggestion. The model takes a few seconds, so the Suggest button shows a spinner.
- The check row: project select (every project, project color dot, prefilled by needle-log), kind toggle `task`/`update` (prefilled), editable text, and — for `task` only — a "finishes task" select of that project's open `## Next` items, sent as `-Task`.
- `sure: false` shows a muted "check this" hint with the confidence; nothing is ever committed automatically.
- Exit 3 leaves the project select empty (the hardcoded sentence stays in the text) and shows needle-log's own message as the hint.
- Log → `quicklog_commit(project, kind, text, task)` runs `vlog.ps1` with `-Harness me`, toasts vlog's message and reloads Activity. Rust refuses any kind but `task`/`update` and any project that has no folder under `Projects\`.

## Locks
- `<hub>\locks.yaml`: header comments, then `- path: <abs path>` / `  mode: read-only|no-ai`. `core/locks.ts` keeps the header on save (same approach as categories.yaml) and writes a header-only file when there are no entries.
- `<hub>\bin\apply-locks.ps1` is the only enforcement (read-only bits and the Claude Code deny rules). Rust command `apply_locks()` runs it; every lock save calls it, so the file and the disk never disagree for long.
- `lockAt(path, locks)` matches the path itself or its nearest locked parent (case-insensitive, backslashes, `\\?\` stripped). `assertUnlocked` is called by `saveSkillMd` and `saveProject`, so a save inside a locked folder fails with the toast `Locked read-only, unlock it first.`
- `LockControl` (Lock/LockOpen, tooltip = mode, menu Unlocked/Read-only/No AI) sits on app cards (the app path), the skill sheet (skill folder) and the project sheet (repo folder when set, plus the vault folder).
- `LockBadge` puts the small mark in a card's bottom-right icon row, left of the harness/hub icons: muted for read-only, red-ish oklch for no-ai (`lockColor` in colors.ts).
- Hub → Locks tab (`modules/hub/LocksPanel.tsx`) lists every entry (path, mode select, Remove) and adds one with the folder picker; each change is saved and applied at once.

## Command palette (Ctrl+K)
- `src/components/command-palette.tsx`, shadcn `Command` dialog (`bunx shadcn@latest add command` also adds `ui/input-group.tsx` and the `cmdk` dependency). It searches projects, apps, skills, glossary terms and screens in one list; Enter opens the item. The sidebar footer shows the `Ctrl K` hint and opens it too (`openCommandPalette()` fires a window event, so nothing is lifted into the shell).
- Opening an item is a hash deep link, parsed with `core/navigation.ts`: `#/projects?open=<name>` (project sheet), `#/skills?skill=<key>` (skill sheet), `#/apps?focus=<name>` (scrolls to the card and rings it), `#/guide?term=cv:x` (Guide filtered to that term), `#/<route>` (screen). The screen derives its open item from the query, and closing the sheet calls `navigate()` to drop the query, so no open item is stored twice.
- The palette loads through the same loaders as the screens (projects, apps, skills, glossary) and caches them for a minute; a source that fails to load is skipped with a toast.

## App icon
- `src/assets/hub-mark.svg` is the source. To regenerate: render it to a 1024px PNG (a dark rounded square with the mark nested in it; `@resvg/resvg-js` in a scratch folder, output `app-icon.png` in this folder), then run `bunx tauri icon app-icon.png` here. That writes `src-tauri/icons`. Run `cargo check -j 2` in `src-tauri` afterwards.

## Layout notes
- The window does not scroll. `SidebarProvider` is `h-svh overflow-hidden`; the content area in `app-shell.tsx` is the `.app-scroll` element (thin oklch scrollbar in `index.css`).
- No page title rows. The sidebar label is the screen title; a page's actions (Refresh, New project, Sync...) portal into the top bar with `PageToolbar` from `src/components/page-toolbar.tsx`. Every screen has Refresh, a skeleton while it loads, an empty state with an `size-8` icon and a toast on errors (`useLoad` already toasts).
- Cards share one shape: `Card` + `CardHeader` (title, optional badge) + `CardFooter` (facts, icon row bottom-right), `gap-4` grids, `rounded-xl`. Badges come from `ui/badge`; colors are `oklch()` only, never hex/rgb/hsl.

## Skill sources
- hub: `<hub>\skills\<name>` (configured hub, source of truth).
- Claude Code: `%USERPROFILE%\.claude\skills\<name>`.
- Antigravity: `%USERPROFILE%\.gemini\config\skills\<name>`.
The three folders are allowed roots in Rust (`skill_roots`). `loadSkillIndex` (core/skills.ts) reads all three; a harness folder with the same name as a hub skill, or a symlink into the hub, is shown once as Hub with harness icons (`linked: true`). A skill present only in a harness folder is shown with that source.

## Move, copy and remove a skill
- The Edit tab starts with `SkillActions` (`modules/skills/SkillActions.tsx`): a **Move to** dropdown with every other slot (Hub with `HubMark`, Claude Code and Antigravity with `HarnessGlyph`) and a destructive-outline **Remove** button.
- The transfer dialog takes the name (prefilled slug) and the switch "Keep a copy here" (off = move). It calls `skill_transfer(src, hub|claude|gemini, name, keepOriginal)`.
- Moving = copy into the target, then the original goes to `<hub>\backups\removed-skills`. Removing (AlertDialog: "Moves <name> to backups\removed-skills. Harness copies update on sync.") calls `skill_remove`, which only accepts a folder that sits directly in one of the three skill roots. Nothing is ever hard-deleted.
- After a change that touches the hub (a hub skill is moved, or a skill lands in the hub) the UI runs `run_hub_sync`, so the harness links follow. A failing script is a toast; the change stands.
- Link entries (a hub skill's copies in a harness folder, `skill.linked`) disable both actions with the tooltip "Managed by the hub: change it in the hub folder." Rust refuses them too.
- Moving a hub skill to a single harness un-shares it: it leaves `skills\` and lands in that harness folder. `skills\` stays the source of truth for anything shared.

## Config (corvoid-hub.json)
- Nothing is hardcoded. Rust `Config` (`OnceLock`, loaded once) reads the first file it finds: `CORVOID_HUB_CONFIG`, then `corvoid-hub.json` next to the executable, then `%USERPROFILE%\.corvoid-hub.json`. No file = defaults; a broken file is logged (`logWarn`) and the defaults are used.
- Keys: `hub` (default `%USERPROFILE%\ai-hub`), `vault` (default `%USERPROFILE%\Documents\Vortex`), `vlog` and `needleLog` (optional; without both, quick log is off with a clear message), `logDir` (default `<hub>\.logs`). `corvoid-hub.example.json` is the template; README documents each key.
- Derived: `<hub>\{skills,inbox,packs}`, `<hub>\hub-sync.ps1`, `<hub>\bin\apply-locks.ps1`; `<vault>\Projects`, `<vault>\Log`. `get_config()` returns all of them plus `source` (the file that was read, or "defaults"), `quickLog`, `hubExists` and `vaultExists`.
- `src/core/config.ts` loads it once (`loadConfig()` awaited in `main.tsx` before the first render) and every screen uses `cfg()`. Never add a path constant back.
- A screen declares `needs: "hub" | "vault"` in its `index.ts`; `app-shell.tsx` renders `RootMissing` (components/root-missing.tsx, "Set your hub path in corvoid-hub.json") instead of the page when that folder is not on disk. Loaders also tolerate a missing `skills\` or `inbox\` folder.

## Skill intake (the key workflow)
The Skills screen offers three ways to add a skill; all land in `hub/inbox/<name>/`, not in `skills/`:
1. GitHub URL → shallow clone/download into `inbox/<name>/`.
2. File or folder (picker / drag-drop) → copied into `inbox/<name>/`.
3. Paste text/idea → saved as `inbox/<name>/SOURCE.md`.
Each inbox item gets `inbox/<name>/INTAKE.md` (source, date, user notes).
An AI harness then normalizes it (rule in hub AGENTS.md): writes a proper `skills/<name>/SKILL.md` (frontmatter `name`, `description` ≤ 1 line saying when to use it; body short, steps not essays), copies needed scripts, deletes the inbox item, and runs `hub-sync.ps1`.
The app shows inbox items as "Waiting for an agent" and has a "Copy agent prompt" button: `Normalize the skill in <hub>\inbox\<name> per the hub rules.`

## Rules for agents working on this app
- Keep modules independent; shared logic goes in `src/core/`.
- File writes must preserve unknown frontmatter keys and body text.
- No new heavy deps without a reason; charts = shadcn chart (recharts), graph = react-force-graph-2d.
- Harness = `HarnessIcon` only, never a text badge. No page `<h1>`. Delete a component as soon as nothing imports it (the four unused shadcn pieces were removed; `cmdk` is the only added dep).
- A screen's open item lives in the hash query (`core/navigation.ts`), not in a second piece of state.
- Build checks: `bun run build` (frontend) and `cargo check` in `src-tauri` (use `-j 2`; the machine is low on RAM).
