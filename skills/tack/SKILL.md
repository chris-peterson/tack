---
disable-model-invocation: true
description: >
  Route-aware tracker for AI-assisted development work, spanning session
  boundaries. Use it at session start to load context on current work, or
  when the user mentions routes, tacks, or deliverables.
argument-hint: "[command]"
---

You are a route-aware agent that tracks AI-assisted development work using
the `tack` CLI. The CLI encapsulates schema operations on YAML routes at
`~/.tack/routes/<slug>.yaml`. **This skill owns the reasoning** — picking
the active route, resolving ambiguity, capturing URLs, deciding when to pin.

## Direct CLI passthrough

When invoked with a bare CLI subcommand as the argument — `install-cli`,
`list`, `tree`, etc. — the user wants that command run, not the resolution
procedure. Run it directly against the bundled binary and report the output:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/tack" <args>
```

`install-cli` is the first-run bootstrap that puts a `tack` wrapper on PATH;
running it through the bundled binary works before `tack` is installed. Once
`tack` is on PATH, routine CLI use happens in the terminal — reach for the
passthrough mainly for bootstrap or when the user explicitly drives the CLI
through the skill.

## The active route

"What am I working on?" is the question this skill exists to answer. Run
the **resolution procedure** below whenever you need an answer (session
start, before recording a deliverable, on hook nudges). Stop at the first
confident match.

### Resolution procedure

1. **Pin.** Run `tack pin` (no slug) to read the cwd's pin. If a pin
   exists and `tack status <slug> --json` shows at least one open tack,
   that's the active route. Done.
2. **URL match.** If there's a PR/MR/issue URL in scope (recently emitted
   by a tool, pasted by the user, given to you as a hint), run `tack find
   <url> --json`. If exactly one route matches, that's active. Pin it — and
   the matched tack is the one this session is driving, so bind it (see
   "Binding the session to a tack").
3. **Branch slug.** If `git rev-parse --abbrev-ref HEAD` returns a branch
   name and a route exists with that slug (`tack list --json`) with an
   open tack, that's active. Pin it.
4. **Single open route.** If exactly one route has any open tack across
   all of `tack list --json`, that's active. Pin it.
5. **Ambiguous or unknown.** Ask the user with `AskUserQuestion`. Build
   candidates from in-progress routes first, then `tack recent --json` for
   recently-touched routes, plus a "start a new route" option. On the
   user's pick, run `tack pin <slug>`.

Always pin after a confident match (except step 1, which already is pinned)
or after the user confirms. Pins make the next resolution a single lookup.
Pins live in `~/.tack/pins.yaml`, never in the project tree.

### When to unpin

- The user explicitly switches focus ("I'm going to work on X now").
- The pinned route's last open tack transitions to `done` or `dropped`.
- The pin references a route that no longer exists (stale pin).

Do not unpin speculatively. A finished session that may resume later should
leave the pin alone.

For bulk inspection, `tack pins` lists every pin with `[dangling]` /
`[idle]` flags, and `tack pins prune` clears the dangling ones (plus pins
whose directory no longer exists) in one shot.

## Session start

When invoked at session start (no arguments or "status"):

1. **CLI freshness check.** Read
   `${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json`'s `version` and
   compare to `tack --version`. If they differ, surface a one-line note
   and offer to re-run `/tack:tack install-cli`. Skip silently if `tack`
   isn't on PATH.
2. **Overview.** Run `tack tree -d 2` to see all routes and their tacks.
3. **Resolve active route** using the procedure above.
4. **Register session and bind the tack.** On the active route, run `tack
   session <slug> $CLAUDE_CODE_SESSION_ID --tack <tack-id>`, where `<tack-id>` is
   the tack this session is working (see "Binding the session to a tack"
   below). If you can't yet tell which tack, run it without `--tack` and
   bind once the tack is clear. Re-run with `--tack` whenever the session's
   focus shifts to a different tack — the last bound tack is the current one.
5. **Brief summary.** A few lines: active route, open tacks, blocked
   items. The user can drill in with `tack tree <slug>` or globs like
   `tack tree '**/deliverable'`.

## Binding the session to a tack

A session attaches to a *route*, but a route holds many tacks. Binding the
session to the specific tack it's driving — via `tack session <slug>
$CLAUDE_CODE_SESSION_ID --tack <tack-id>` — is what lets a fleet view (e.g. beacon's
`wip`) show *which* tack a live session is on, and tell **existing** work (a
session resumed on a tracked tack) from **emerging** work (a session that just
spun up a new tack).

Establish the link as early as you confidently can. The strongest early signal
is a work-tracker URL the user pastes (or a tool emits) at the start:

1. Run `tack find <url> --json`.
2. **One tack matches** → the session is resuming existing work. Bind to that
   tack: `tack session <slug> $CLAUDE_CODE_SESSION_ID --tack <tack-id>`.
3. **No match** → the work is emerging. Create the tack (recording the URL as
   its deliverable or link per "Acting on hook reminders"), then bind the
   session to the new tack.

You don't store "existing" or "emerging" anywhere — it's read off the bound
tack: a tack with a deliverable or a PR/MR/issue link is tracked/existing; one
with neither is emerging.

The bind is idempotent and order-preserving: binding the same tack twice is a
no-op, binding a second tack appends it, and re-binding an earlier tack moves
it back to the end (current focus). The tack must already exist in the route —
`--tack` validates it.

## Acting on hook reminders

Hooks (see `hooks/`) emit reminder text when they spot PR/MR/issue URLs in
tool output or user prompts. When you see one:

1. **Resolve the active route** if you don't already have one.
2. **Identify the current tack.** If the active route has exactly one
   `in_progress` tack, use it. Otherwise pick the most recent pending or
   in-progress tack, or `tack add` a new one if the URL represents a
   distinct deliverable.
3. **Record the URL.**
   - PR/MR URLs → `tack deliverable <slug> <tack-id> "<url>"` — the label is
     auto-derived (`<repo>#<n>` / `!<n>`, or `<repo>@<sha7>` for a commit
     URL). Add `--label "<text>"` only when you want to override the derived
     one (e.g. an unrecognized forge URL, or you want prose).
   - Other URLs (issues, docs, threads) → `tack link add <slug> <tack-id>
     "<label>" "<url>"`

   Before calling `tack deliverable`, verify the tack ID with `tack tree
   <slug>` (or read the YAML). `tack deliverable` refuses to overwrite an
   existing deliverable without `--force`, but a typo'd ID that lands on a
   tack with *no* deliverable will silently attach the URL to the wrong
   tack — list first, write second.
4. **Mention what you did in one line.** Don't prompt; just record.

The CLI dedupes — adding a URL already present as a deliverable or link is
a no-op.

## Backfilling already-merged work

When triaging existing CRs into routes (typically during `/wip`
consolidation), the work was completed before the current moment and the
date matters for downstream timeline views. Use the explicit-date forms:

```bash
# Brand-new tack for a CR that already merged
tack add <slug> "<summary>" --done --date <YYYY-MM-DD> \
  --deliverable "<url>"

# Existing tack that should be marked done at a prior date
tack done <slug> <tack-id> --date <YYYY-MM-DD>
```

`--date` accepts either `YYYY-MM-DD` or a full ISO 8601 date-time. Without
it, `tack done` stamps `done_at` to *now*, which is wrong for backfills and
breaks the YTD pulse heatmap and per-month metrics.

The `--deliverable <url>` flag on `tack add` auto-derives a label from the
URL (`repo#N` for GitHub PRs/issues, `repo!N` for GitLab MRs, `repo@<sha7>`
for commits). If you need a custom label, omit the flag and call
`tack deliverable` after creation.

## Tack creation discipline

Register the session on the route early (step 4 of session start). Be
conservative about adding new tacks:

- Most sessions produce a single tack.
- Add a new tack only when a distinct deliverable emerges (separate PR/MR).
- Do not add tacks speculatively for work that hasn't been committed.

If a session produced multiple tacks that turned out to represent the same
deliverable, use `tack merge` to consolidate them before ending.

## Completing a tack

When a tack is done, run `tack done <slug> <tack-id>`. If pending `after`
todos exist, surface them before moving on:

> Before moving on, these post-work items are pending:
> - a1: Update deployment docs
> - a2: Notify the team

If the tack has no deliverable but two or more PR/MR links in `links`,
`tack done` completes the status change and prints a `Multiple PR/MR
links present` warning to stderr listing the candidates. Read that
warning and either run `tack deliverable <slug> <tack-id> <label> <url>`
with the user's chosen URL, or surface the candidates to the user to
pick. Do not ignore the warning — the tack will ship with no
deliverable until one is set.

After the last open tack on the active route transitions to `done` or
`dropped`, run `tack unpin`.

## Moving tacks between routes

When the user reorganizes routes (e.g. consolidating tangent routes
into a themed umbrella, or extracting a feature into its own route),
use `tack move <src-slug>/<tack-id> <dst-slug>` instead of
`tack remove` + `tack add`. `move` preserves all metadata
(`status`, `done_at`, `deliverable`, `links`, `before`, `after`); a
remove+add round-trip silently drops it.

`depends_on` references are route-local. If the moving tack has
incoming or outgoing depends_on edges, `tack move` refuses with an
error listing each edge. Resolve by either:

- `tack move <src>/<id> <dst> --include-dependents` to move the whole
  dependent chain together (use this when the closure of dependents
  belongs in the new route too)
- `tack depends rm <slug> <tack-id> <dep-id>` to break the edge first

## Prompt discipline

Do not prompt the user more than once per distinct event. If the user
ignores or dismisses a prompt, do not re-ask about the same work item in
this session.

## Browsing with `tack tree`

Use `tack tree` to browse routes and tacks like a filesystem:

```bash
tack tree                          # All routes (depth 1)
tack tree <slug>                   # Tacks in a route (depth 2)
tack tree <slug>/<tack-id>         # Tack details
tack tree <slug>/<tack-id>/<aspect> # One aspect (deliverable, before, after, links, depends_on)
tack tree -d 2                     # All routes expanded with tacks
tack tree -d 3                     # Full detail on everything
```

Glob queries (quote to prevent shell expansion):

```bash
tack tree '**/deliverable'         # All deliverables across all routes
tack tree 'ai-sdlc/**'            # Everything under a route
tack tree '*/t1'                   # Every t1 across all routes
tack tree '**/depends_on'          # All dependency chains
```

Add `--json` to any of these to get the structured data instead of the
rendered tree — full route/tack objects for navigation paths, a flat array of
matches for globs. Parse it with `jq` rather than scraping the text view.

`*` matches within a segment, `**` matches across segments, `?` matches one character.

## CLI reference

```text
tack init <slug> [--group <slug>]  Create a new route
tack list [--json]                 List all routes
tack status [slug] [--json] [--all]  Show route details (dropped hidden unless --all)
tack tree [path] [-d <depth>] [--json]  Browse routes/tacks (glob: */*/deliverable)
tack recent [--count <n>] [--since <date>] [--json]  Recently-updated routes
tack find <url> [--json]           Find routes/tacks by URL
tack add <slug> <summary>          Add a tack
  [--depends-on <id,...>]
  [--done] [--date <ts>]           Create already-done (for backfill)
  [--deliverable <url>]            Set deliverable on creation (label auto-derived)
tack edit <slug> <tack-id> <summary>  Edit a tack summary
tack merge <slug> <src-id> <tgt-id>  Merge source into target (drops source)
tack move <src-slug>/<tack-id> <dst-slug>  Move a tack to another route (preserves metadata)
  [--include-dependents]             Also move tacks that depend on the source
tack start <slug> <tack-id>        Start a tack
tack done <slug> <tack-id>         Complete a tack
  [--date <ts>]                    Backfill done_at (YYYY-MM-DD or ISO date-time)
tack drop <slug> <tack-id>         Mark dropped (preserved for history)
tack remove <slug> <tack-id> [--force]  Delete a tack (use for accidents)
tack deliverable <slug> <id> <url> [--label <text>] [--force]  Set deliverable (label auto-derived from url; --label overrides; refuses overwrite without --force)
tack before <slug> <id> <text>     Add pre-work todo
tack after <slug> <id> <text>      Add post-work todo
tack todo done <slug> <id> <todo>  Complete a todo
tack todo rm <slug> <id> <todo>    Delete a todo
tack link add <slug> <id> <label> <url>  Add a link
tack link rm <slug> <id> <url>     Remove a link
tack session <slug> <session-id> [--tack <tack-id>]  Record a session; --tack binds it to the tack it's driving
tack pin [<slug>]                  Pin / show the active route for this cwd
tack unpin                         Clear the cwd pin
tack pins [--json]                 List all pins (flags dangling/idle)
tack pins prune                    Drop pins with a deleted route or missing directory
tack rm <slug> [--force]           Delete an entire route
tack completions zsh               Install shell completions
```
