# Changelog

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
