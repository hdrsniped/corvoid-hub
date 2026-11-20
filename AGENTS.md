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
                          resolve_path, skill_copy_to_hub, skill_transfer, skill_remove, needle_status,
                          needle_ask, needle_configure,
                          log_entry, apply_locks, setup_detect, setup_save, setup_wire_rules, config_path,
                          harness_icon, backup_create, backup_list, backup_restore, backup_settings,
                          backup_adopt
                          Paths are not hardcoded: `Config` (RwLock, reloadable) comes from corvoid-hub.json (see
                          Config below) and every derived path comes from it. Every path is checked against the
                          allowed roots: hub, vault, and the configured claudeSkills and antigravitySkills folders
                          (deny otherwise); .obsidian/.smart-env stay blocked.
                          write_text creates missing parent folders. delete_file only removes single files (no
                          folders, no links) inside hub\packs or hub\inbox. path_exists is the only command that
                          accepts any path: it answers a bool for apps.yaml folders and reads nothing.
                          skill_transfer copies a skill folder into hub|claude|gemini as <name> (slug-checked,
                          refuses an existing name or the same root); keep_original=false then moves the original
                          to <hub>\backups\removed-skills. skill_remove does the same for one folder and refuses
                          links/junctions ("managed by the hub, remove it from the hub instead").
                          needle_* is the optional Needle add-on: one lazy sidecar (addons/needle/needle_serve.py,
                          started with the configured Python, no console window, killed on app exit) that answers
                          a sentence with tool calls; needle_ask restarts it once after a crash and times out at
                          15 s, needle_status reports the two files and the worker, needle_configure writes
                          needlePython/needleWeights and stops the worker (None/None turns it off). log_entry is the
                          built-in quick log writer (daily bullet, ticked task, new tasks, frontmatter; local date,
                          locks checked), apply_locks runs bin\apply-locks.ps1. The two scripts run off the UI
                          thread with -ExecutionPolicy Bypass and no console window. Missing scripts come back as a
                          clear message, never a crash.
                          setup_* is first-run setup (see Setup below) and harness_icon reads the Antigravity icon
                          out of its exe. get_config reloads the config when the file on disk changed, so a setup
                          written by an agent is picked up without a restart. Logs go to <logDir> (default <hub>\.logs).
                          backup_* is the zip backup (see Backups below); it writes into backupDir, which may live
                          outside the hub and vault.
addons/needle/            the optional add-on's sidecar: needle_serve.py (JSON lines on stdin/stdout) and
                          smoke_test.py (sends three commands, prints the calls). Bundled via tauri.conf
                          bundle.resources; a dev build falls back to this repo folder.
src/core/                 shared: tauri wrappers (fs.ts), frontmatter parse/write (markdown.ts), types.ts,
                          config.ts (cfg() + loadConfig + reloadConfig/onConfigChange, nothing hardcoded)
src/core/setup.ts         first-run setup: setup_detect, setup_save, setup_wire_rules, config_path + types
src/core/setup-prompt.ts  buildSetupPrompt: the plain-text prompt handed to an AI harness (no cv: words)
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
src/core/quicklog.ts      built-in project/kind/task guesses for quick log (no model)
src/core/needle.ts        Needle add-on wrappers (needle_status/ask/configure, single in-flight request), the tool
                          list (schema, sentence, confirm fields), grounding (groundCalls/groundResult),
                          looksLikeCommand/looksLikeQuestion, projectQuestion, builtinProjectFilter,
                          isNeedleReady, tip keys
src/core/needle-actions.ts  what a call does: safe calls navigate, writes reuse saveProject/logEntry/setLock/
                          skill_transfer/backupNow; notifyDataChanged() fires hub:data-changed
src/core/needle-setup-prompt.ts  buildNeedleSetupPrompt: the plain-text install prompt for an AI harness
src/core/harness.ts       harness ids (claude-code | antigravity | opencode | me | other) parsed from log bullets; isAiHarness()
src/core/glossary.ts      glossary.yaml load/parse (list of {term, icon, means, say}), session cache, useGlossary(),
                          term(key) lookup by cv:x or x. Read-only: the app never writes this file.
src/core/backup.ts        backup_create/list/restore/settings/adopt wrappers, backupNow() (shared toast),
                          backupDate/formatBytes
src/assets/hub-mark.svg   the app's own mark (hub: center node + 5 linked nodes). Source for the app icons. Uses currentColor.
src/components/           shared UI pieces: harness-icon.tsx (HarnessIcon + HarnessGlyph), hub-mark.tsx (HubMark, HubMarkIcon),
                          lock-control.tsx (LockControl menu, LockBadge for card icon rows),
                          command-palette.tsx (Ctrl+K search over projects/apps/skills/terms/screens + Setup + Back up now
                          + plain-language commands when Needle is ready),
                          setup-dialog.tsx (first-run Setup: With an AI / Manual / Add-ons, openSetup(section) event),
                          needle-confirm.tsx (the confirm card of a command: editable fields, Confirm/Cancel),
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
src/modules/hub/          HubPage (Rules, Packs, Categories, Locks, Backups, Add-ons tabs), CategoriesPanel,
                          LocksPanel, BackupsPanel, AddonsPanel (Needle status, Set up, Test, Turn off)
src/modules/guide/        GuidePage (glossary.yaml as compact cards, search, deep link ?term=cv:x, the dismissible
                          "Commands (Needle add-on)" card)
src/modules/registry.ts   the ONLY place modules are listed. Add/remove a screen = add/remove one line here.
src/components/ui/        shadcn components (add with the shadcn CLI, don't hand-write)
```
Modules: `projects`, `apps`, `activity`, `graph`, `hub` (Rules, Packs, Categories, Locks, Backups, Add-ons tabs), `skills`, `guide`.

## Guide and term hints
- `<hub>\glossary.yaml` is the only vocabulary: a list of `{term: cv:x, icon: <lucide kebab-case>, means, say}`. The app reads it and never writes it. A missing file means no terms, not an error.
- `core/glossary.ts` parses it, caches the list for the session (`clearGlossaryCache()` + `reload()` in `useGlossary` read it again) and looks a term up with `term("cv:version")` or `term("version")`.
- Guide (last screen, `BookOpen`) shows one compact card per term: `TermIcon`, the term in mono, `means`, and `say` in a muted code chip with a copy button. Search matches every word in term, meaning or example. `#/guide?term=cv:version` fills the search box and rings that card.
- `TermHint term="cv:version"` renders a small muted (?) whose tooltip shows the term, `means` and `say`; it renders nothing when the glossary has no such term. Text always comes from glossary.yaml, never from a hardcoded string.
- Hints sit beside: version (project card and sheet), Log mode (New project), Harness and Transfer, Categories, Locks (project sheet and Hub > Locks), Next/Done task headers, the Skills "Hub" filter, and the Apps toolbar ("App index").
- The term icon comes from lucide's `icons` export via `TermIcon`, with `BookOpen` as fallback for an unknown name. Icons are never emoji or images.
- Above the terms, the dismissible “Commands (Needle add-on)” card shows four example commands (click one to copy), the add-on status and a Set up button (`openSetup("addons")`); its flag is `NEEDLE_GUIDE_KEY`.

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
- Harness icons are in the brand color (`harnessColor`): Claude Code = simple-icons brand converted to oklch; Antigravity = the installed app's own icon when there is one (else a neutral `Orbit` glyph in Google blue); OpenCode is black in its brand, so it follows the theme (dark ink on light, light ink on dark). Names come from `harness.ts`.
- Harness `me`: log bullets ending in "(me)" that the user wrote without AI. Icon = the app mark (`HubMark`, grayscale). It is not an AI harness, so it is left out of the harness charts and tiles (`isAiHarness`).

## Harness display
- A harness is never text. Always `HarnessIcon` from `src/components/harness-icon.tsx` (or `HarnessGlyph` when the name sits next to it, e.g. a menu item): brand-colored Claude Code glyph, Antigravity's installed app icon (or the `Orbit` fallback), OpenCode in the theme's ink, and `HubMark` for `me`.
- The Antigravity icon is not shipped: Rust `harness_icon("antigravity")` extracts it from `antigravityExe` with System.Drawing into `<logDir>\..\icons\antigravity.png` (cache, regenerated when the exe is newer) and returns a base64 data URL. `antigravityAppIcon()` (core/harness.ts) caches that promise for the session; without the app, an `Orbit` glyph in the brand hue is drawn.
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
- Activity toolbar → `Log` (`PenLine`) or Ctrl+L opens `src/modules/activity/QuickLogDialog.tsx` (the shortcut is registered while the Activity screen is mounted). Logging is built in, so it is always on; only the optional Needle `Fill` button needs the add-on.
- One box: the sentence, plus a project select (color dots), a kind toggle `task`/`update`, a harness select (icon + name, default `me`), a "finishes task" select for `task` and an optional "Next step" field (the note's `next`).
- Project and kind are guessed as you type, without a model: `guessProject` (`core/quicklog.ts`) picks the longest project name, or the name without spaces and dashes, that appears in the sentence (else the most recently updated active project); `guessKind` reads the task words (finish/done/complete/ship/implement/built/add/launch). The task select is preselected with `bestTaskMatch`, the open `## Next` item with the most shared words. Picking a project, kind or task by hand wins over the guess.
- The sparkles `Fill` button appears only when the add-on is ready (`isNeedleReady(needleStatus)`): it asks the sidecar with `log_work` only (`buildTools(ctx, ["log_work"])`) and fills project, kind, text and next from the first call (confident or held). A project that is not in the vault is not applied; the hint says so. Without the add-on the built-in guess stands and nothing is ever written automatically.
- Log → `log_entry(project, kind, text, harness, task, next, add)` in Rust, which writes the vault itself (no script). It refuses any kind but `task`/`update`, any harness but `claude code`/`antigravity`/`opencode`/`me`, a project name with separators or `..`, and a project with no `Projects\<Name>\<Name>.md`. It also checks `locks.yaml` and refuses a note or log under a read-only or no-ai lock.
- What it writes, exactly as vlog.ps1 did: the daily `Log\YYYY-MM-DD.md` (local date, created with `---\ntype: log\ndate: <d>\n---\n\n## Done today\n` when missing) gets `- [[Projects/<P>/<P>|<P>]] — #<kind> <text> (<harness>)` (em dash) after a newline; for `task`, the first open `## Next` item (`- [ ] x` or `- x`) whose text contains the task words (else the log text) moves with its indented sub-lines to the end of `## Done` as `- [x] x` (`## Done` is created after Next when missing); `add` appends `- [ ] t` to `## Next`. Frontmatter gets `updated: <today>`, `harness: <harness>` and `next: "<next>"` (`"` becomes `'`), inserted before the closing `---` when missing. Files are UTF-8 without BOM and LF.
- It returns `{message, ticked}`: `logged #task to <date>; ticked: X`, `…; no matching open task (log only)`, `…; added N task(s)`. The toast shows it and Activity reloads.

## Needle add-on (plain-language commands)
- Optional and off by default. Two config keys: `needlePython` (its own venv) and `needleWeights` (`needle3.cact`). `needle_status` answers `{configured, pythonFound, weightsFound, running, error}`; `isNeedleReady` means configured and both files exist.
- The sidecar (`addons/needle/needle_serve.py`, our own code) is started lazily by Rust on the first command and killed on app exit. It ships through `bundle.resources` (a dev build reads `<repo>\addons\needle`). Rust never uses a shell: `python -I needle_serve.py --weights <path>`, hidden console, `CACTUS_TELEMETRY=0`, `HF_HUB_OFFLINE=1`; the script puts the engine cache next to the weights (`XDG_CACHE_HOME`, `HF_HOME`). No network once the weights are on disk.
- Protocol: one JSON line in `{"id", "text", "tools": [...]}`, one JSON line out `{"id", "calls": [{name, arguments}], "held": [...], "confidence", "ms"}` or `{"id", "error"}`. The model loads once and is rebuilt only when the tools list hash changes. `needle_ask` waits 15 s and restarts the worker once after a crash or timeout.
- Tools, with enums filled from live data (`core/needle.ts` → `buildTools`): `filter_projects(status?, category?)`, `open_project(project)`, `project_overview(project)`, `add_task(project, task)`, `log_work(project, kind task|update, text, next?)`, `set_next(project, next)`, `set_status(project, status)`, `start_version(project)`, `backup_now()`, `lock_folder(path, mode)`, `go_to(screen)`, `open_skill(skill)`, `move_skill(skill, target hub|claude|antigravity)`, `open_app(app)`.
- **Grounding (`groundCalls` / `groundResult`):** an argument the sentence never said is dropped, and a call that loses a required one is not shown at all, so junk (`status=idea`, `category=automation`) can never appear. Project/skill/app names must be in the sentence (whole, without spaces, or one word of 4+ letters); enum values match the value, its label or one word of it; free text needs at least half its words; a path must be typed out. A call with nothing left (or `filter_projects` with no filter) is dropped, held calls also need confidence ≥ 0.05. `needleAsk(text, tools, ctx)` applies it, so every screen that displays an answer is grounded.
- **Only commands go to Needle.** `looksLikeQuestion` (what/why/how/… or a trailing “?”) never asks. A question about a project is answered by the built-in row “Show what’s left on <Project>” (`projectQuestion`, `project_overview`, opens `#/projects?open=<name>&tab=tasks`) and “show paused projects” / “show me ai tooling stuff” by `builtinProjectFilter`, both before anything is sent. If nothing survives, the Action group is not drawn at all.
- The worker is single-flight: `needle_ensure` runs under the `NEEDLE` mutex, kills any previous child before spawning, and `NeedleSidecar::drop` kills its process; `needleAsk`/`needleConfigure` share one in-flight promise so two React effects cannot start two requests. `needle_ask` waits 15 s and restarts the worker once after a crash or timeout.
- **Writes are always confirmed.** Safe calls (`filter_projects`, `open_project`, `project_overview`, `go_to`, `open_skill`, `open_app`) run on Enter. Every other call opens `NeedleConfirm` (`components/needle-confirm.tsx`) with editable fields (selects for enums, inputs for text) and Confirm/Cancel; several calls confirm together. A held result (`suppressed_calls`) shows greyed as “Did you mean…” and still needs confirm. Writes reuse the screens' functions: `saveProject`, `logEntry`, `setLock`, `skillTransfer` (+ hub-sync), `backupNow`; a change fires `hub:data-changed` so an open screen reloads.
- Ctrl+K: placeholder “Search, or type a command…”, a Sparkles “Needle” chip while ready, and `looksLikeCommand` (two or more words with a verb) asks after 400 ms or on Tab. The Action group sits first and shows 1–2 preview rows, each with the `↵` key hint; the same sentence is asked once (`lastAsked`), and nothing survives grounding means no Action group at all. Without the add-on a command-looking sentence shows one muted “Commands need the Needle add-on · Set up” row that opens Setup → Add-ons (`openSetup("addons")`).
- Discoverability (all dismissible, remembered in localStorage with try/catch in `core/needle.ts`): a one-time toast after setup (“Tip: Ctrl+K understands plain commands with the Needle add-on”, with Set up while it is not installed), the Guide card “Commands (Needle add-on)” with four examples and status, and a Sparkles dot on the sidebar Search button until the palette is opened once while ready.
- Hub → **Add-ons** tab (`modules/hub/AddonsPanel.tsx`): status dots, Set up (Setup's Add-ons tab), Test (runs `open <first project>` and shows the parsed call) and Turn off (`needle_configure(null, null)` removes both keys and stops the worker).
- Setup → **Add-ons** tab: the Needle card, “Set up with AI” (`buildNeedleSetupPrompt(configPath)` → venv, `pip install cactus-compute`, the weights from Hugging Face, cache/env, then write both keys and ask first) and “I have it” (two file pickers + `needle_configure`). Skipping is fine.

## Locks
- `<hub>\locks.yaml`: header comments, then `- path: <abs path>` / `  mode: read-only|no-ai`. `core/locks.ts` keeps the header on save (same approach as categories.yaml) and writes a header-only file when there are no entries.
- `<hub>\bin\apply-locks.ps1` is the only enforcement (read-only bits and the Claude Code deny rules). Rust command `apply_locks()` runs it; every lock save calls it, so the file and the disk never disagree for long.
- `lockAt(path, locks)` matches the path itself or its nearest locked parent (case-insensitive, backslashes, `\\?\` stripped). `assertUnlocked` is called by `saveSkillMd` and `saveProject`, so a save inside a locked folder fails with the toast `Locked read-only, unlock it first.`
- `LockControl` (Lock/LockOpen, tooltip = mode, menu Unlocked/Read-only/No AI) sits on app cards (the app path), the skill sheet (skill folder) and the project sheet (repo folder when set, plus the vault folder).
- `LockBadge` puts the small mark in a card's bottom-right icon row, left of the harness/hub icons: muted for read-only, red-ish oklch for no-ai (`lockColor` in colors.ts).
- Hub → Locks tab (`modules/hub/LocksPanel.tsx`) lists every entry (path, mode select, Remove) and adds one with the folder picker; each change is saved and applied at once.

## Backups
- One backup = one zip in `backupDir`: `corvoid-backup-YYYYMMDD-HHMMSS.zip` with `hub/`, `vault/`, `corvoid-hub.json` and `manifest.json` (app version, created, hub path, vault path, file count, skipped files). Files are streamed through the `zip` crate (deflate); files over 50 MB are skipped and named in the manifest.
- `hub/` leaves out `node_modules`, `target`, `dist`, `.git`, `backups/`, `.logs/`, and any `app/` folder that holds a `package.json` (an app repo is not hub data). `vault/` holds only `Projects/`, `Log/`, `Templates/`, `_system/` and the root `*.md` files, never `.obsidian/`, `.smart-env/` or `.trash/`. Links are never followed.
- Rust (`lib.rs`): `backup_create(destPath?)` writes one now (the save dialog path, else `backupDir`) and returns `{path, size, files}`; `backup_list()` lists the zips in `backupDir`, newest first; `backup_settings(autoBackup, keepBackups)` writes those two keys and reloads the config; `backup_adopt(folder)` points `hub`/`vault` at `folder\hub` and `folder\vault` (config paths only, no file moves).
- **Restore never overwrites in place.** `backup_restore(path)` first writes a fresh backup of the current state, then extracts into `<backupDir>\restore-YYYYMMDD-HHMMSS` and returns that folder. Zip entries with `..` or absolute paths are refused, so a zip cannot write outside its folder.
- Auto backup runs on a background thread at start (after the config is loaded): when `autoBackup` is `daily`/`weekly` and the newest zip is older than 1/7 days, it writes one, then deletes the oldest beyond `keepBackups`. Pruning only touches files that match the backup name pattern.
- Hub screen → **Backups** tab (`modules/hub/BackupsPanel.tsx`, `ArchiveRestore`): Back up now, Export to file… (native save dialog), Open folder, the auto-backup select (Daily/Weekly/Off), the keep count, and the list (date, size, Restore). Restore asks in an AlertDialog; the dialog afterwards offers Open folder and **Use as my hub and vault**. Ctrl+K has **Back up now** (`core/backup.ts` → `backupNow()`).
- Every backup toasts its file path. `src/core/backup.ts` holds the wrappers, `backupNow()`, `backupDate()` and `formatBytes()`.

## Command palette (Ctrl+K)
- `src/components/command-palette.tsx`, shadcn `Command` dialog (`bunx shadcn@latest add command` also adds `ui/input-group.tsx` and the `cmdk` dependency). It searches projects, apps, skills, glossary terms and screens in one list; Enter opens the item. The "App" group also holds Setup and **Back up now** (writes a backup at once). The sidebar footer shows the `Ctrl K` hint and opens it too (`openCommandPalette()` fires a window event, so nothing is lifted into the shell).
- Opening an item is a hash deep link, parsed with `core/navigation.ts`: `#/projects?open=<name>` (project sheet; `&tab=tasks` also scrolls the Next list into view for “what’s left on X”), `#/skills?skill=<key>` (skill sheet), `#/apps?focus=<name>` (scrolls to the card and rings it), `#/guide?term=cv:x` (Guide filtered to that term), `#/<route>` (screen). The screen derives its open item from the query, and closing the sheet calls `navigate()` to drop the query, so no open item is stored twice.
- The palette loads through the same loaders as the screens (projects, apps, skills, categories, glossary) and caches them for a minute; a source that fails to load is skipped with a toast.
- With the Needle add-on ready the palette also takes a sentence: the Sparkles “Needle” chip sits in the input, `looksLikeCommand` starts a 400 ms debounce (Tab asks at once), and the first group is **Action** with 1–2 preview rows (`callSentence`). Selecting a safe row runs it; a write row opens `NeedleConfirm` with every write call of that answer, so multi-call results confirm together. A command-looking sentence without the add-on shows one muted “Commands need the Needle add-on · Set up” row.

## App icon
- `src/assets/hub-mark.svg` is the source. To regenerate: render it to a 1024px PNG (a dark rounded square with the mark nested in it; `@resvg/resvg-js` in a scratch folder, output `app-icon.png` in this folder), then run `bunx tauri icon app-icon.png` here. That writes `src-tauri/icons`. Run `cargo check -j 2` in `src-tauri` afterwards.

## Layout notes
- The window does not scroll. `SidebarProvider` is `h-svh overflow-hidden`; the content area in `app-shell.tsx` is the `.app-scroll` element (thin oklch scrollbar in `index.css`).
- No page title rows. The sidebar label is the screen title; a page's actions (Refresh, New project, Sync...) portal into the top bar with `PageToolbar` from `src/components/page-toolbar.tsx`. Every screen has Refresh, a skeleton while it loads, an empty state with an `size-8` icon and a toast on errors (`useLoad` already toasts).
- Cards share one shape: `Card` + `CardHeader` (title, optional badge) + `CardFooter` (facts, icon row bottom-right), `gap-4` grids, `rounded-xl`. Badges come from `ui/badge`; colors are `oklch()` only, never hex/rgb/hsl.

## Skill sources
- hub: `<hub>\skills\<name>` (configured hub, source of truth).
- Claude Code: `%USERPROFILE%\.claude\skills\<name>` (`claudeSkills`).
- Antigravity: `%USERPROFILE%\.gemini\config\skills\<name>` (`antigravitySkills`).
The three folders are allowed roots in Rust (`skill_roots`). `loadSkillIndex` (core/skills.ts) reads all three; a harness folder with the same name as a hub skill, or a symlink into the hub, is shown once as Hub with harness icons (`linked: true`). A skill present only in a harness folder is shown with that source.

## Move, copy and remove a skill
- The Edit tab starts with `SkillActions` (`modules/skills/SkillActions.tsx`): a **Move to** dropdown with every other slot (Hub with `HubMark`, Claude Code and Antigravity with `HarnessGlyph`) and a destructive-outline **Remove** button.
- The transfer dialog takes the name (prefilled slug) and the switch "Keep a copy here" (off = move). It calls `skill_transfer(src, hub|claude|gemini, name, keepOriginal)`.
- Moving = copy into the target, then the original goes to `<hub>\backups\removed-skills`. Removing (AlertDialog: "Moves <name> to backups\removed-skills. Harness copies update on sync.") calls `skill_remove`, which only accepts a folder that sits directly in one of the three skill roots. Nothing is ever hard-deleted.
- After a change that touches the hub (a hub skill is moved, or a skill lands in the hub) the UI runs `run_hub_sync`, so the harness links follow. A failing script is a toast; the change stands.
- Link entries (a hub skill's copies in a harness folder, `skill.linked`) disable both actions with the tooltip "Managed by the hub: change it in the hub folder." Rust refuses them too.
- Moving a hub skill to a single harness un-shares it: it leaves `skills\` and lands in that harness folder. `skills\` stays the source of truth for anything shared.

## Config (corvoid-hub.json)
- Nothing is hardcoded. Rust `Config` (`RwLock`, reloadable) reads the first file it finds: `CORVOID_HUB_CONFIG`, then `corvoid-hub.json` next to the executable, then `%USERPROFILE%\.corvoid-hub.json`. No file = defaults; a broken file is logged (`logWarn`) and the defaults are used.
- Keys: `hub` (default `%USERPROFILE%\ai-hub`), `vault` (default `%USERPROFILE%\Documents\Vortex`), `claudeSkills` (default `%USERPROFILE%\.claude\skills`), `antigravitySkills` (default `%USERPROFILE%\.gemini\config\skills`), `opencodeConfig` (default `%USERPROFILE%\.config\opencode`), `antigravityExe` (default: the first existing of `%LOCALAPPDATA%\Programs\antigravity\Antigravity.exe` and `%ProgramFiles%\Antigravity\Antigravity.exe`), `needlePython` + `needleWeights` (optional: the Needle add-on's Python and `needle3.cact`; a lone `needleLog` from an older config is ignored), `logDir` (default `<hub>\.logs`), `backupDir` (default `<hub>\backups\corvoid`), `autoBackup` (daily | weekly | off, default daily), `keepBackups` (default 10). A `vlog` key from an older config is ignored. `corvoid-hub.example.json` is the template; README documents each key.
- Derived: `<hub>\{skills,inbox,packs}`, `<hub>\hub-sync.ps1`, `<hub>\bin\apply-locks.ps1`; `<vault>\Projects`, `<vault>\Log`. `get_config()` returns all of them plus the harness folders, `source` (the file that was read, or "defaults"), `configured` (a config file was found), `needlePython`/`needleWeights`, `needleConfigured` (both keys set), `hubExists` and `vaultExists`.
- `get_config` calls `refresh_if_changed()`: if the file on disk is not the loaded one or is newer, the config is reloaded. That is how Setup's 2 s poll notices a config an agent just wrote.
- `src/core/config.ts` loads it once (`loadConfig()` awaited in `main.tsx` before the first render) and every screen uses `cfg()`. `reloadConfig()` (after setup) notifies `onConfigChange` subscribers; `AppShell` bumps a key so the open screen remounts on the new roots. Never add a path constant back.
- A screen declares `needs: "hub" | "vault"` in its `index.ts`; `app-shell.tsx` renders `RootMissing` (components/root-missing.tsx, one sentence plus an **Open setup** button) instead of the page when that folder is not on disk. Loaders also tolerate a missing `skills\` or `inbox\` folder.

## Setup (first run)
- `src/components/setup-dialog.tsx` renders one compact Dialog in `app-shell.tsx`. It opens by itself while `cfg().configured` is false, and from Hub's toolbar **Setup** button and the Ctrl+K palette (`openSetup()` fires a `hub:setup` window event, so no state lives in the shell).
- **With an AI** (default tab): `ToggleGroup` of the three harness logos, a collapsed read-only preview of the prompt, a big **Copy prompt** button, then a spinner and "Waiting for setup…" while `get_config` is polled every 2 s. When `configured` turns true: toast "Setup done", close, `reloadConfig()`.
- The prompt (`core/setup-prompt.ts` → `buildSetupPrompt`, plain text, no `cv:` words) says what the app is, lists every path from `setup_detect` (so the agent does not guess), and walks it through: confirm hub/vault, write the config with the five keys, create the hub starters and the vault `Projects`/`Log`/`Templates/Project.md`, then wire the rules into the chosen harnesses (Claude Code `@<hub>\AGENTS.md` in CLAUDE.md, OpenCode `instructions` entry, Antigravity plugin folder), backing up every file first.
- **Manual** tab: one row per path (status dot, label, input, native picker; a select of `obsidianVaults` for the vault), checkboxes "Create starter files" and "Connect global rules to my harnesses", and Save.
- **Add-ons** tab (optional, can be skipped): the Needle card with one line of what it does, Python/model status dots polled every 2 s, **Set up with AI** (`core/needle-setup-prompt.ts` → `buildNeedleSetupPrompt(config_path)`: venv, `pip install cactus-compute`, weights from Hugging Face, offline env, then write `needlePython`/`needleWeights` and ask first) and **I have it** (two file pickers → `needle_configure`). `openSetup("addons")` opens it on that tab.
- `setup_detect()` is read-only: the six paths with `{path, exists}`, `obsidianVaults` from `%APPDATA%\obsidian\obsidian.json` (`vaults.*.path`, errors ignored), `configPath`, `configured`.
- `setup_save(fields, createStarters)` merges into the existing config (keeps `needlePython`, `needleWeights`, `logDir`, `backupDir`, `autoBackup`, `keepBackups`), writes it at `config_target_path()` (env var, else the file in use, else `%USERPROFILE%\.corvoid-hub.json`), creates hub and vault, and copies missing starters from `examples/` (`include_str!`): hub `AGENTS.md`, `categories.yaml`, `glossary.yaml`, `apps.yaml`, `locks.yaml`, `skills/`, `packs/`; vault `Projects/`, `Log/`, `Templates/Project.md`. Existing files are never overwritten. Then it reloads the config.
- `setup_wire_rules(harnesses)` only touches a harness whose folder exists, backs up each edited file as `<name>.bak-YYYYMMDD-HHMMSS` next to it, and is idempotent: an import line, `instructions` entry or plugin folder that is already there is left alone (jsonc comments are stripped before reading). Antigravity gets `<antigravitySkills>\..\plugins\corvoid-hub\` with `plugin.json` and `rules/AGENTS.md`; that copy is re-copied by the agent whenever the rules change.

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
