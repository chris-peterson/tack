# Changelog

## 0.27.0

### Added
- **`tack add --link "label,url"` attaches a link on creation** (issue #15). The flag mirrors `--deliverable` and is repeatable, so filing an issue-shaped tack no longer needs a follow-up `tack link add` with the freshly-minted tack id threaded in. `--link` combines with `--deliverable`, and links are deduplicated against the deliverable and one another on creation.
- **`tack deliverable rm <slug> <tack-id>` clears a deliverable** (issue #24) — the inverse of setting one. `--to-link` instead demotes the deliverable into `links`, preserving its label and URL, which is the fix for a cross-route duplicate: keep the deliverable on the tack that owns it and demote it to a link on the other so it stops double-counting. Removing from a tack with no deliverable fails with a clear message.

### Fixed
- The `tack add` row in the README quick reference listed a `--project` flag that the command does not accept; it now lists the real options.

### Fixed
- **The marketplace component listing no longer counts `lib-url.sh` as a hook.** The shared URL-detection helper — sourced by the `session-nudge` and `capture-urls` hooks — moved from `hooks/` to `scripts/`, so it's no longer mistaken for a registered hook. The two hooks source it by relative path; behavior is unchanged.

### Other
- Spec requirement category prefixes were renamed to natural mnemonic codes (internal to `SPEC.md`; no runtime effect).

## 0.26.0

### Added
- **Sessions are recorded when you create a route or tack, not just when you run `tack start`.** `tack init` and `tack add` now attribute the current Claude session to the route (route-level) when running inside a session, using the same mechanism `tack start` already used to bind the started tack. Session capture no longer depends on the agent remembering to run `tack session`.

### Changed
- **The URL-detection hooks now ensure a mapping exists instead of nagging.** When a PR/MR/issue URL appears in a prompt or in tool output, the hook checks whether a tack already tracks it: an already-tracked URL stays silent (no more redundant reminders), and only an untracked URL prompts the agent to create the route/tack mapping — which, via the change above, also records the session. Shared detection logic now lives in one place so the two hooks can't drift.

## 0.25.0

### Changed
- `tack export` now writes an **uncompressed** archive to **stdout** by default, so it pipes and diffs cleanly. Two new flags cover the old behavior: `--out-file <path>` redirects the archive to a file (the summary line then goes to stderr) and `--compress` gzips the output. The positional `[path]` argument is gone — use `--out-file`. `tack import` reads either form, detecting gzip vs. plain JSON by content, so existing compressed backups still import.

### Fixed
- Sessions are now recorded **deterministically**. Previously a session only landed in the store when the agent ran `tack session` (or someone ran `tack start`), so most sessions were never captured — thousands of sessions produced session data on only a handful of routes. The `session-nudge` hook now records the session on the resolved route (by pin, else branch-slug) on the first prompt of every session, leaving the agent to bind the specific tack when it knows which one the session is driving.

## 0.24.1

### Fixed
- Tab-completion now covers four CLI commands that had drifted out of the zsh completion script: `export` and `import` (added in 0.24.0 but never registered for completion) plus the older `recent` and `find`. All four are now offered as first-word completions, with argument completion for `find`, `export`, and `import`.

### Other
- A CI check (`scripts/check-completions.mjs`, wired into the Build workflow and a `just completions-check` recipe) now fails the build whenever a CLI command exists in the dispatch but is missing from the completion script, so completion-vs-CLI drift can't recur.

## 0.24.0

### Features
- Back up and move your tack data with `tack export` / `tack import`. `tack export [path]` writes your entire store — every route, the repo database, and pins — as a single gzip-compressed JSON file tagged with a schema version (defaulting to `tack-backup-<date>.json.gz`). `tack import <file>` reads it back: `--merge` (the default) combines a backup into another machine — creating missing routes and appending only tacks that aren't already there (matched by deliverable URL, else summary + completion date), assigning fresh ids, remapping dependencies, and reporting every id reassignment, while unioning repo names but skipping machine-specific checkouts and pins. `--replace` restores a machine wholesale, and `--dry-run` previews without writing. An archive from a newer schema version is refused rather than mishandled.

## 0.23.0

### Features
- Attaching a URL that's already tracked elsewhere now warns you. When you record a PR/MR/issue as a deliverable or link — via `tack deliverable`, `tack add --deliverable`, or `tack link add` — tack scans your other tacks for the same URL and prints a `warning: url already on <route>/<tack> ...` to stderr naming where it already lives, so you catch a duplicate before a downstream tool double-counts the work. The attach still completes and exits zero (the warning is informational), and re-attaching a URL to the tack it's already on stays quiet.

## 0.22.1

### Fixed

- **PostToolUse URL-capture hook now fires.** It read the wrong stdin field (`tool_result` instead of `tool_response`), so PR/MR/issue URLs appearing in Bash output were silently never captured. It now reads the correct field.
- **`tack done` ambiguous-deliverable hint is now runnable.** It printed a four-positional `tack deliverable` form the command rejects; it now suggests the correct `<url> --label "<text>"` form.

### Changed

- **tack skill brought in line with the CLI.** Corrected the `tack deliverable` signature and the `tack done` pending-todo output shape, added the commands the reference had drifted past (`rename`, `group`, `status set`, `depends`, `repo`), and tightened the skill description to reduce over-firing.

## 0.22.0

### Features
- `tack start` now binds the current Claude Code session to the tack it starts (when `CLAUDE_CODE_SESSION_ID` is set) — the same link `tack session --tack` writes. Starting a tack in a session is the declaration that the session is driving it, so a fleet view keyed on the session id (beacon) attributes the session to that tack automatically, with no separate command. A no-op in an ad-hoc terminal where the variable is unset.

## 0.21.1

### Fixes
- The `/tack:tack` skill can now be invoked by the model, not only by typing the command. It was marked `disable-model-invocation`, which silently defeated the session hooks that nudge the agent to resolve the active route or record a pasted PR/MR URL — those nudges told the agent to "use the tack skill" but the flag forbade it. The nudges are now actionable.

## 0.21.0

### Features
- `/tack:tack` accepts a bare CLI subcommand and runs the bundled binary directly — e.g. `/tack:tack install-cli` to put the `tack` wrapper on your PATH, or `/tack:tack list` / `tree` to drive the CLI through the skill.

### Other
- `/tack:tack` is now invoked explicitly rather than activating on its own. The skill no longer auto-triggers on natural-language cues like "where was I" or "what am I working on" — run `/tack:tack` when you want it. This stops unsolicited activation and trims the context the plugin keeps resident in every session.
- `/tack:tack` resolves to a single artifact. The duplicate slash-command definition was removed, so the skill is the one place that owns the behavior.

## 0.20.1

### Other
- Trimmed the `tack` skill's `description` frontmatter to cut the always-resident context cost. Kept the high-signal natural-language cues ("where was I", "what am I working on", "wip"); dropped the name-echo triggers and generic prose.

## 0.20.0

### Features
- New `tack group <slug> [<group>] [--clear]` verb sets, changes, clears, or shows a route's group on an existing route — so a route can be regrouped in place (and the `/wip` dashboard grouping reorganized) without recreating it. An invalid group slug surfaces the schema error and leaves the route unchanged.

## 0.19.1

Fixes session→tack binding, which silently did nothing because the code and the `/tack:tack` skill read `CLAUDE_SESSION_ID` — a variable the Claude Code harness never sets. The harness exposes the active session id as `CLAUDE_CODE_SESSION_ID`.

- `writePin` now reads `CLAUDE_CODE_SESSION_ID`, so a pin records the session that created it instead of dropping the field.
- The `/tack:tack` skill's `tack session <slug> $CLAUDE_CODE_SESSION_ID --tack <id>` now expands to a real id, so the bind command records the link instead of losing its positional argument.

## 0.19.0

### Features

- **`tack repo <name>` resolves a project name to its git remote.** tack now keeps a repo database built from the forge URLs and pinned directories it already sees, so you can look up a remote by partial name — `tack repo anchor` → `https://github.com/chris-peterson/anchor`. Multiple matches are listed; `--json` for scripting.
- **List, alias, and maintenance commands.** Bare `tack repo` lists the database; `tack repo alias <match> <alias>` adds a custom name; `tack repo prune` drops local paths that no longer exist; `tack repo rm <match>` removes an entry.
- **`tack repo rebuild` backfills the database** from every deliverable/link URL across your routes plus pinned directories' remotes — populating it for work recorded before the feature existed.
- **Automatic capture.** Recording a deliverable or link URL, and running `tack init` / `tack pin` inside a git repo, now also records the repo's remote (and local checkout). Best-effort — it never blocks the command that triggered it.

### Other

- Spec: new REPO category (REPO-01..07) for the repo database, plus CLI-42..47 for the `tack repo` commands. STATUS.md coverage at 117/117.

## 0.18.1

### Bug Fixes

- **`--help` / `-h` works after any subcommand.** `tack <subcommand> --help` previously fell through the top-level help check: subcommands parsed with strict `parseArgs` (`session`, `init`, `recent`, `tree`, `deliverable`, `move`) threw an uncaught `ERR_PARSE_ARGS_UNKNOWN_OPTION`, while subcommands parsing flags manually (`pins`, `list`, `status`) silently ignored the flag and ran anyway. A single guard before the command switch now prints the usage text and exits zero for `--help`/`-h` after any subcommand, matching bare `tack --help` (CLI-38).

## 0.18.0

### Features

- **Sessions link to the specific tack they're driving.** `tack session <slug> <session-id> --tack <tack-id>` binds a session to a tack within the route, stored as a `tacks` array on the session entry (touch order, last = current focus). A session was previously associated only with a route, so a fleet view could group live sessions by route but not show which tack each one was working. Re-binding a tack moves it to the end, so a pivot back to an earlier tack makes it current again (RTE-11, CLI-17).
- **The skill establishes the session→tack link early from a tracker URL.** When a PR/MR/issue URL is in scope at session start, the tack skill runs `tack find` on it — a match binds the session to the existing tack, no match means emerging work (create the tack, then bind) — so a dashboard can tell resumed/tracked work from work spun up fresh in the session. Whether work is existing or emerging is read off the bound tack's own state (does it carry a deliverable or tracker link?), not stored as a flag (AGT-11).

## 0.17.0

### Features

- **Tack-id arguments accept the bare number** (#11). Every command that takes a `<tack-id>`, `<dep-id>`, or `--depends-on` entry now accepts `7` as well as `t7` — both resolve to the same tack, and bare ids are stored in the canonical `t<N>` form. Previously some subcommands rejected the bare number (`tack deliverable <slug> 7 …` → `Tack not found: 7`) while others accepted it, so callers had to guess which form each one wanted (TACK-08).
- **`tack deliverable` derives the label from the URL** (#11). `tack deliverable <slug> <tack-id> <url>` now auto-derives the label, matching what `tack add --deliverable <url>` already did. `--label <text>` overrides it for the occasional case the default doesn't fit (CLI-08).
- **Commit URLs derive a `<repo>@<sha7>` label** (#11). GitHub `…/commit/<sha>` and GitLab `…/-/commit/<sha>` URLs now produce a readable deliverable label from the seven-character short sha instead of falling back to the full URL. Commits are not treated as PR/MR/issue references — they are not promoted on `tack done` and do not trigger the hook scanners (CLI-37a).

### Changed

- **`tack deliverable` takes the label as `--label`, not a positional** (#11). The signature is now `tack deliverable <slug> <tack-id> <url> [--label <text>]`; the old `tack deliverable <slug> <tack-id> <label> <url>` positional form is no longer accepted. An explicit label is the exception now that the derived default covers PR/MR/issue/commit URLs, so it moves to a flag rather than a positional slot wedged before the URL (CLI-08).
- **Derived deliverable labels drop the space before the sigil** (#11). Auto-derived labels now use the canonical forge notation — `repo#42`, `repo!99`, `repo@<sha7>` — instead of the previous `repo #42` / `repo !99`. Only newly-derived labels are affected; labels already stored in route files are left as-is (CLI-37).

## 0.16.1

### Bug Fixes

- **`tack merge` now leaves a single tack** (#12). Merging soft-dropped the source to status `dropped` but kept it in the route with its original deliverable, so any audit scanning for duplicate deliverable URLs kept flagging the merged pair. The source is now removed outright — its ID is not reused, consistent with `tack remove` — so a merge collapses two tacks into one (CLI-28).
- **Malformed subcommand-group invocations report the specific problem on stderr** (#17). `tack link <slug> …` (missing the `add`/`rm` subcommand), and the equivalent `status set` / `todo` / `depends` mistakes, printed the full global usage — a caller capturing output got a ~1.5 KB usage blob with no pointer to the actual mistake. They now print a group-scoped message naming the accepted subcommands and the offending input — e.g. `tack link: expected 'add' or 'rm' (got 'my-slug')` — keeping the non-zero exit (CLI-41).

## 0.16.0

### Features

- **`tack pins [--json]`** — List every pin with its directory, slug, and pin timestamp. Entries whose route no longer exists are flagged `[dangling]`; entries whose route has no open tacks are flagged `[idle]` (CLI-39). The central `~/.tack/pins.yaml` introduced in 0.15.0 is what makes a whole-fleet listing possible — the old per-directory `.tack` files couldn't be enumerated.
- **`tack pins prune`** — Remove pins whose route was deleted or whose directory is gone from disk, printing each removal with the reason. Idle pins are kept; explicit `tack unpin` remains the way to drop a pin for a finished-but-resumable route (CLI-40).

## 0.15.0

### Breaking Changes

- **Pins moved out of the project tree.** `tack pin` now records pins in `~/.tack/pins.yaml` (a map keyed by absolute cwd) instead of writing a `.tack` file at the cwd root. A state file in the project tree is one `git add .` away from being committed to a repo where it has no business — tack state now lives entirely under `~/.tack/`. Existing `<cwd>/.tack` files are no longer read; delete them and re-pin (`tack pin <slug>`) from the affected directories.

### Features

- **`tack --help` / `tack -h` / `tack help`** — Print the usage text to stdout and exit zero. Previously `--help` was rejected as an unknown command. Usage shown for errors (no arguments, unrecognized command) now goes to stderr and keeps the non-zero exit.

## 0.14.0

### Features

- **`tack tree` and `tack recent` now accept `--json`.** The flag emits the structured data behind the view instead of the rendered text, so output pipes straight into `jq`. For `tree`, the JSON shape follows the navigation depth — an array of routes (no path), one route (`<slug>`), one tack (`<slug>/<tack>`), or an aspect object (`<slug>/<tack>/<aspect>`) — and glob paths return a flat array of matches whose shape varies by pattern depth. This brings `tree` and `recent` in line with `status`, `list`, and `find`, which already supported `--json`.

### Other

- Documented `--json` across the CLI reference, including the commands that already supported it (`status`, `list`, `find`) and previously-undocumented `recent` and `find` sections.

## 0.13.0

> ⚠️ Behavior changes in `tack link add` and `tack done` may affect automation that relied on silent PR/MR → deliverable promotion. See Breaking Changes below.

### Breaking Changes

- **`tack link add` no longer auto-promotes PR/MR URLs to `deliverable`.** Previously, calling `tack link add` with a PR/MR URL on a tack with no deliverable silently set it as the deliverable. The URL now always records as a link. To set a deliverable, call `tack deliverable` explicitly. The old behavior bit when porting a tack whose source schema was "no deliverable, just links" — the destination ended up with a deliverable that wasn't there before, changing data shape and downstream dashboard enrichment.
- **`tack done` no longer silently picks one of several PR/MR links to promote.** With exactly one PR/MR link, the convenience promotion still happens (unchanged). With two or more, the status change still completes but no link is promoted; the CLI emits a stderr warning listing the candidates and the `tack deliverable` command to pick one. Scripts that relied on first-wins behavior in the ambiguous case must now invoke `tack deliverable` explicitly.

### Features

- **`tack move <src-slug>/<tack-id> <dst-slug> [--include-dependents]`** — Relocate a tack between routes, preserving all metadata (`status`, `done_at`, `deliverable`, `links`, `before`, `after`). The moved tack takes the next sequential ID in the destination; source IDs are not reused. Because tack IDs are route-local, `depends_on` references cannot cross route boundaries — the command refuses moves that would orphan edges and lists every offending one so you can break it with `tack depends rm` or include the dependent chain with `--include-dependents`.

### Fixes

- **`tack deliverable` now strips a matching link from `links`** when setting a deliverable with the same URL. A URL no longer appears in both `deliverable` and `links` simultaneously — eliminates duplicate rows in `tack find` and keeps the data shape consistent with the new `link add` / `done` semantics.

### Other

- **Skill updates** — `tack` skill now documents `tack move` and tells agents to read stderr after `tack done` for the multi-PR/MR ambiguity warning.
- **Spec updates** — CLI-13 rewritten (link add no longer promotes), CLI-05 extended (done-time disambiguation), CLI-36 added (tack move).
- **Internal refactor** — `nextTackId` extracted to share with `moveTack`; raises a clear error on non-numeric tack IDs.
- **zsh completion** — `tack move` uses a dedicated path completer that stops at `<slug>/<tack-id>` (no trailing `/` or aspect drill-down).

Closes #2.

## 0.12.0

### Features

- **`tack depends add/rm`** — Edit a tack's `depends_on` array after creation without hand-editing YAML. `add` is idempotent and refuses self-edges and cycles; `rm` errors if the dependency isn't set and drops the field when the array empties.
- **`tack status set <slug> <tack-id> <status>`** — Direct status write with no guards. Subsumes `start`/`done`/`drop` mechanically (those keep their conveniences). Use it to revert a `done` tack to `pending`, put a tack into `blocked`, or otherwise reach states the guarded commands refuse to produce. Stamps `done_at` when transitioning to `done` and the field isn't already set.
- **`tack rename <old-slug> <new-slug>`** — Rename a route file and its in-YAML `slug` field while preserving the route's `id`. Refuses if the destination exists or if any other route's `depends_on` references the old slug.

Closes #1.

### Fixes

- `tack start`'s unmet-dependency error now names the two resolution paths — `tack depends rm` to drop the edge when the work is actually parallel, or `tack status set` to write the inconsistent status anyway. Previously the error just said "unmet dependencies" with no guidance, so users hand-edited the YAML.

### Spec / Docs

- New requirements: `[CLI-32]` depends add, `[CLI-33]` depends rm, `[CLI-34]` status set, `[CLI-35]` rename. `[CLI-07]` tightened to describe the new error-message guidance.
- `docs/cli.md` adds a Dependencies section and a Status entry under Tacks; `tack rename` joins the Routes section.

## 0.11.1

### Build / Packaging

- Ship pre-built `dist/` instead of compiling on first run. `typescript` moved to `devDependencies`; `bin/tack` now installs runtime deps only (`npm install --omit=dev`) if `node_modules` is missing, and skips the compile step. Plugin install footprint drops from ~31M to ~4M per cached version.

## 0.11.0

### Features

- **Backfill support for already-merged work.** `tack done` and `tack add` now accept an optional `--date <ts>` flag taking either `YYYY-MM-DD` or a full ISO 8601 date-time. `tack add` also gains `--done` (create a tack already at status `done`) and `--deliverable <url>` (set the deliverable on creation, with the label auto-derived from PR/MR/issue URL — `repo #N` for GitHub, `repo !N` for GitLab MRs). The canonical backfill shape is now one command instead of a YAML hand-edit: `tack add <slug> "<summary>" --done --date 2026-04-30 --deliverable <url>`. Closes #5, #6, #7.
- **Full ISO 8601 date-time on `done_at`.** `tack done` and `tack todo done` now stamp `done_at` with the full ISO 8601 date-time instead of a bare `YYYY-MM-DD`, so downstream tooling that visualizes completions over time can resolve order within a single day. Bare `YYYY-MM-DD` remains valid on read for backward compatibility with routes created before this release; no migration is required. Closes #9.

### Fixes

- **`tack deliverable` no longer silently clobbers a typo'd target.** When the specified tack already has a deliverable, the command now fails with a message naming the existing label and URL, and requires `--force` to overwrite intentionally. Previously a typo'd tack ID could silently corrupt an unrelated tack's deliverable.
- **`tack add --deliverable <url>` actually does something.** Previously the flag was silently swallowed by an `allowUnknown` parser setting, so `tack add ... --deliverable <url>` succeeded with no deliverable recorded. The flag now creates the tack and sets the deliverable atomically. Unknown flags on `tack add` are also rejected with a usage error instead of being ignored.

### Spec / Docs / Skill

- [TACK-02], [TACK-03], [TODO-03], [TODO-04] updated for the date-or-date-time form on `done_at`.
- [CLI-04], [CLI-05], [CLI-08] updated for the new `--date`, `--done`, `--deliverable`, and `--force` flags.
- `skills/tack/SKILL.md` adds a "Backfilling already-merged work" section and a note that agents should verify tack IDs before calling `tack deliverable`.

## 0.10.0

### Features
- New `tack pin <slug>` / `tack unpin` commands persist the active route for a working directory in a `.tack` YAML file at the cwd root. The tack skill reads the pin first when resolving "what am I working on?", so pinned routes win over branch-slug or single-open-route heuristics. Commit the file for shared assignment or `.gitignore` it for per-dev state.

### Architecture
- Spec now states the layering explicitly: the CLI encapsulates schema operations as a deterministic primitive; the skill owns reasoning (route resolution, ambiguity prompts, URL capture); hooks emit advisory reminders. The CLI no longer reaches into inference — that lives entirely in `skills/tack/SKILL.md`. New `[STG-06]` covers the pin file format; new `[CLI-30]`/`[CLI-31]` cover the pin/unpin commands; AG- expanded with a formal resolution procedure (`[AGT-03]`) and pin discipline (`[AGT-10]`); new **HK** category formalizes what each hook does.
- Hook reminder text now points at the tack skill rather than naming specific CLI commands, routing all writes through one path (the skill) so context (which slug, which tack) is applied by the only component that sees it.

## 0.9.1

### Fixes
- The `tack` skill now points agents at `tack init <slug> --group tangent` for tangent routes. Previously it referenced `--tangent`, an unimplemented flag, so agents following the skill hit "Unknown option: --tangent" at runtime.
- `tack recent --since <value>` now reports an error when the value isn't a parseable date. Previously it silently filtered out every route, which looked like "no recent routes" rather than "your input is wrong."

### Other
- Spec catches up to the shipped CLI: `tack edit`, `tack merge`, and `tack --version` are now formal requirements [CLI-27], [CLI-28], [CLI-29].
- Wording tightened on [TACK-04] (gating responsibility lies with the caller, not the CLI), [AGT-02] ("background" → "without blocking the user prompt"), and [AGT-03] (matches the actual `UserPromptSubmit` + branch-slug heuristic, not the URL inference that never shipped).
- New `STATUS.md` tracks spec coverage (73/73 normative + 5 deferred) and an advisory backlog for the next audit.

## 0.9.0

### Features
- `SessionStart` hook now checks CLI wrapper freshness on every Claude Code session start, regardless of which surface invokes the CLI. Previously the freshness check lived in the `tack` skill, which only fired on skill invocation — consumers calling `tack` directly (other skills, shell, tooling) bypassed it. The hook compares `tack --version` against `plugin.json#version` and emits an `additionalContext` nudge when they differ; silent on match, silent when the CLI isn't on PATH, never blocks the session.

## 0.8.0

### Features
- `tack --version` (and `-v`) now reports the installed plugin version, sourced from `.claude-plugin/plugin.json`.
- The tack skill now checks CLI freshness on session start. If the shell `tack` wrapper (from `/tack:install-cli`) is older than the running plugin, it surfaces a one-line note and offers to refresh.

### Other
- Reconciled version drift across manifests: `plugin.json` is now the single source of truth, and `package.json` is frozen as `"private": true` with a stub version. Prior releases had `plugin.json` and `package.json` versions diverging silently.
