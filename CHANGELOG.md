# Changelog

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
- **Spec updates** — CL-13 rewritten (link add no longer promotes), CL-05 extended (done-time disambiguation), CL-36 added (tack move).
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

- New requirements: `[CL-32]` depends add, `[CL-33]` depends rm, `[CL-34]` status set, `[CL-35]` rename. `[CL-07]` tightened to describe the new error-message guidance.
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

- [TK-02], [TK-03], [TD-03], [TD-04] updated for the date-or-date-time form on `done_at`.
- [CL-04], [CL-05], [CL-08] updated for the new `--date`, `--done`, `--deliverable`, and `--force` flags.
- `skills/tack/SKILL.md` adds a "Backfilling already-merged work" section and a note that agents should verify tack IDs before calling `tack deliverable`.

## 0.10.0

### Features
- New `tack pin <slug>` / `tack unpin` commands persist the active route for a working directory in a `.tack` YAML file at the cwd root. The tack skill reads the pin first when resolving "what am I working on?", so pinned routes win over branch-slug or single-open-route heuristics. Commit the file for shared assignment or `.gitignore` it for per-dev state.

### Architecture
- Spec now states the layering explicitly: the CLI encapsulates schema operations as a deterministic primitive; the skill owns reasoning (route resolution, ambiguity prompts, URL capture); hooks emit advisory reminders. The CLI no longer reaches into inference — that lives entirely in `skills/tack/SKILL.md`. New `[ST-06]` covers the pin file format; new `[CL-30]`/`[CL-31]` cover the pin/unpin commands; AG- expanded with a formal resolution procedure (`[AG-03]`) and pin discipline (`[AG-10]`); new **HK** category formalizes what each hook does.
- Hook reminder text now points at the tack skill rather than naming specific CLI commands, routing all writes through one path (the skill) so context (which slug, which tack) is applied by the only component that sees it.

## 0.9.1

### Fixes
- The `tack` skill now points agents at `tack init <slug> --group tangent` for tangent routes. Previously it referenced `--tangent`, an unimplemented flag, so agents following the skill hit "Unknown option: --tangent" at runtime.
- `tack recent --since <value>` now reports an error when the value isn't a parseable date. Previously it silently filtered out every route, which looked like "no recent routes" rather than "your input is wrong."

### Other
- Spec catches up to the shipped CLI: `tack edit`, `tack merge`, and `tack --version` are now formal requirements [CL-27], [CL-28], [CL-29].
- Wording tightened on [TK-04] (gating responsibility lies with the caller, not the CLI), [AG-02] ("background" → "without blocking the user prompt"), and [AG-03] (matches the actual `UserPromptSubmit` + branch-slug heuristic, not the URL inference that never shipped).
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
