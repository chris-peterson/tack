# AGENTS.md

## What Is This?

**tack** is a lightweight, tool-agnostic route schema and CLI for pinning the
state of AI-assisted development work to disk. It captures the non-linear
reality of how development actually happens — pivots, context switches,
multi-repo changes — so that work-in-progress survives context exhaustion,
crashes, and session boundaries.

tack is not a project management system. It answers three questions:

1. Where was I?
2. What am I delivering?
3. What depends on what?

## Build Philosophy

- **The schema is the product.** The CLI is a convenience wrapper. Any tool that
  reads/writes conforming YAML is a first-class citizen.
- **YAML on disk, JSON Schema for validation.** Human-readable files that are
  also machine-verifiable.
- **One file per route.** `~/.tack/routes/<slug>.yaml`. Easy to list, archive,
  delete, or version-control.
- **Flat over nested.** A route contains tacks (units of work). Each tack is
  one concrete deliverable — an MR, a deployment, a script run. No sub-items,
  no hierarchy.
- **Dependencies, not workflows.** Tacks declare what they depend on. There is
  no enforced state machine or prescribed workflow.
- **Tool-agnostic core.** The schema has no assumptions about Claude Code,
  Cursor, Windsurf, or any specific AI coding tool. Integrations are packaging
  concerns, not schema concerns.

## Key Constraints

- No server, no sync, no cloud — local files only
- No symlinks
- No fallback code paths — if an operation fails, surface the error
- YAML files must be hand-editable (UUIDs are generated once at creation, not
  on every write)
- Tack IDs are simple sequential strings (`t1`, `t2`) — human-readable,
  route-scoped
- Route slugs are the human-facing key — unique, lowercase, hyphenated
- Each route also has an immutable v4 UUID for stable machine references

## Quality Gates

Every gate below runs on `pull_request` in `.github/workflows/build.yml` and has
a `just` recipe for running it locally first:

| Gate | Local | What it catches |
|---|---|---|
| Build + tests | `just test` | Behavior regressions |
| Committed `dist/` | `just check-dist` | A `src/` edit shipped without the rebuild — `bin/tack` runs the committed `dist/cli.js`, so a stale one reaches every installed user while CI's own fresh build stays green |
| Completion coverage | `just completions-check` | A command added to `src/cli.ts` and forgotten in `src/completions.ts` |
| CLI grammar | included in `just test` | Any change to a command, subcommand, or flag, against the `spec/v1/cli-usage.txt` snapshot |
| Schema conformance | `just validate-schema` | A published `examples/` fixture that no longer validates |
| shellcheck | `just lint-shell` | Defects in the hooks and the URL library |
| Generated artifacts | `just check-generated` | `plugin.json`, `suite.describe`, or docs drifting from their source |

Two notes on the last two rows. `just check` previews pending projections but
exits zero even when drift is pending, so `check-generated` is the gate:
regenerate, then let `git diff --exit-code` decide. And when a usage change is
intended, re-record the grammar with `just usage-snapshot` in the same commit —
the snapshot diff is how a reviewer sees a grammar change.

## Naming Conventions

The word "tack" is used at two levels:

1. **tack** (the project) — the schema + CLI
2. **tack** (within a route) — a single unit of work / deliverable

A **route** is a YAML file representing a series of tacks. In code and CLI
output, prefer "route" over "session", "project", or "plan"; prefer "tack"
over "task", "item", "change", or "entry".

## Suggested Build Order

1. SPEC.md — requirements with formal IDs
2. JSON Schema — `schema/route.schema.json`
3. CLI scaffolding — parse YAML, validate against schema
4. `tack init` — create a new route file
5. `tack status` — display route state
6. `tack add` — add a tack to a route
7. `tack done` — mark a tack as done
8. `tack link add` / `tack link rm` — attach or remove a link on a tack
9. Integration packaging (Claude Code plugin, etc.)
