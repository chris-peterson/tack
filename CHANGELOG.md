# Changelog

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
