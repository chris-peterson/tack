# CLI Reference

## Routes

### `tack init <slug>`

Create a new route.

```bash
tack init auth-rewrite
```

### `tack status [slug] [--all]`

Show route details. Without a slug, shows a summary of all routes. Dropped
tacks are hidden by default; pass `--all` to include them.

```bash
tack status auth-rewrite
tack status auth-rewrite --all
tack status
```

### `tack list`

List all routes with open/total tack counts.

```bash
tack list
```

### `tack tree [path] [-d <depth>]`

Browse routes and tacks as a navigable tree. Paths use `/`-separated segments
with progressive drill-down. Supports glob wildcards (`*`, `?`) for querying
across routes and tacks.

**Depth levels:** 1 = routes only (default), 2 = routes + tacks, 3 = full details.

```bash
# Browse all routes
tack tree

# Drill into a route
tack tree auth-rewrite

# Drill into a tack
tack tree auth-rewrite/t1

# Drill into an aspect
tack tree auth-rewrite/t1/deliverable

# Expand all routes with tacks
tack tree -d 2

# Full detail on everything
tack tree -d 3
```

**Glob queries** (quote the path to prevent shell expansion):

```bash
# All deliverables (** matches across levels)
tack tree '**/deliverable'

# Everything under a route
tack tree 'ai-sdlc/**'

# All t1 tacks
tack tree '*/t1'

# Deliverables in routes matching a prefix
tack tree 'vault-*/*/deliverable'

# All dependency chains
tack tree '**/depends_on'

# Routes matching a pattern
tack tree 'fix-*'
```

`*` matches within a single path segment, `**` matches across segment
boundaries, `?` matches a single character.

**Tab completion** resolves each level progressively — routes append `/` so you
can keep drilling without retyping.

### `tack rename <old-slug> <new-slug>`

Rename a route. The route file is renamed, the `slug` field inside the YAML
is updated, and the route's `id` is preserved. Fails if `<new-slug>` already
exists, if `<old-slug>` does not exist, or if another route's `depends_on`
references `<old-slug>` (clear the reference first, then rename).

```bash
tack rename oss-quality opensource-contributions
```

Note on stale pins: any `<cwd>/.tack` pin files referencing the old slug
fail to resolve on the next session — `tack pin <old-slug>` and any
write targeting the old slug error with `Route not found`. The old name
is **not** resurrected, so there's no risk of a split route. Re-pin from
the affected working directory when you next visit it.

### `tack rm <slug> [--force]`

Delete a route. Requires `--force` to confirm.

```bash
tack rm auth-rewrite --force
```

## Tacks

### `tack add <slug> <summary> [options]`

Add a tack to a route.

| Option | Description |
|---|---|
| `--depends-on <id,...>` | Comma-separated tack IDs this depends on |
| `--done` | Create the tack already marked done (for backfilling merged work) |
| `--date <ts>` | When used with `--done`, set `done_at` to this `YYYY-MM-DD` or ISO 8601 date-time instead of "now" |
| `--deliverable <url>` | Set the deliverable URL on creation. The label is auto-derived from the URL (`repo #N` for GitHub PRs/issues, `repo !N` for GitLab MRs). For a custom label, use `tack deliverable` after creation. |

Unknown flags fail with a usage error rather than being silently ignored.

```bash
tack add auth-rewrite "Replace session middleware"
tack add auth-rewrite "Update SDK" --depends-on t1

# Backfill a tack for an already-merged PR
tack add auth-rewrite "Vault role migration" \
  --done --date 2026-04-30 \
  --deliverable https://github.com/org/repo/pull/42
```

### `tack start <slug> <tack-id>`

Start a tack. Fails if any declared dependency isn't `done`. The error
names two ways forward:

- **The work is actually parallel.** The declared edge no longer reflects
  reality — drop it: `tack depends rm <slug> <tack-id> <dep-id>`. The
  schema then matches what's happening.
- **You want the inconsistent state intentionally.** Keep the edge and
  write the status anyway: `tack status set <slug> <tack-id> in_progress`.
  Rare — preserves the dependency record for later audit while letting
  both tacks be in flight.

```bash
tack start auth-rewrite t1
```

### `tack status set <slug> <tack-id> <status>`

Set a tack's status directly, with no guards. Valid statuses: `pending`,
`in_progress`, `done`, `blocked`, `dropped`. When the new status is `done`
and `done_at` is not already set, it is stamped to the current time.

Use this as the escape hatch for representing states the guarded commands
([start], [done], [drop]) refuse to produce — reverting a `done` tack to
`pending`, putting a tack into `blocked`, etc.

```bash
tack status set auth-rewrite t1 blocked
tack status set auth-rewrite t1 pending   # revert a premature mark-done
```

### `tack done <slug> <tack-id> [--date <ts>]`

Complete a tack. `done_at` is stamped with the current ISO 8601 date-time
unless `--date <ts>` is given, in which case the supplied `YYYY-MM-DD` date
or full ISO 8601 date-time is used instead — supports backfilling work that
merged earlier than today. Shows pending after-todos if any exist.

```bash
tack done auth-rewrite t1
tack done auth-rewrite t1 --date 2026-04-30
```

### `tack drop <slug> <tack-id>`

Mark a tack as dropped. The tack stays in the route file as a historical record
of intentionally descoped work. Use this for scope changes — "we decided not to
ship this."

```bash
tack drop auth-rewrite t2
```

### `tack remove <slug> <tack-id> [--force]`

Delete a tack from a route. Use this for accidents — duplicates, test tacks,
wrong route. If other tacks depend on the target, the operation fails unless
`--force` is passed; with `--force`, the references are stripped from dependents.

```bash
tack remove auth-rewrite t3
tack remove auth-rewrite t1 --force   # t2 depended on t1; its depends_on is stripped
```

### `tack move <src-slug>/<tack-id> <dst-slug> [--include-dependents]`

Move a tack from one route to another, preserving all metadata
(`status`, `done_at`, `deliverable`, `links`, `before`, `after`). The
moved tack gets the next sequential ID in the destination; the source
ID is not reused.

Because tack IDs are route-local, `depends_on` references cannot cross
route boundaries. If the source tack has any incoming or outgoing edge
to a tack that isn't moving, the operation refuses and lists each
offending edge so you can either break it with `tack depends rm` or
move the dependent chain together.

```bash
tack move scratch/t3 auth-rewrite                  # one tack
tack move scratch/t3 auth-rewrite --include-dependents  # t3 + everything that depends on t3
```

With `--include-dependents`, the move set expands to the transitive
closure of tacks within the source route that depend on the target.
Their `depends_on` arrays are rewritten to the new IDs in the
destination. The cross-boundary refusal still applies — if a tack
that's staying behind depends on a moving tack, the move fails.

## Dependencies

Tack-level dependencies declare ordering within a route — child tacks
default to refusing `tack start` until parents reach `done`. Use the
commands below to edit those edges after creation.

### `tack depends add <slug> <tack-id> <dep-id>`

Append a dependency. Idempotent — adding an existing dependency is a no-op.
Refuses self-dependencies and cycles.

```bash
tack depends add auth-rewrite t3 t1
```

### `tack depends rm <slug> <tack-id> <dep-id>`

Remove a dependency. Fails if the dependency isn't set. If this empties the
list, the field is removed from the YAML.

```bash
tack depends rm auth-rewrite t3 t1
```

## Deliverable

### `tack deliverable <slug> <tack-id> <label> <url> [--force]`

Set the change request for a tack. If a deliverable is already recorded, the
command refuses with an error showing the existing label and URL — this
prevents a typo'd tack ID from silently clobbering an unrelated tack's
deliverable. Pass `--force` to overwrite intentionally.

```bash
tack deliverable auth-rewrite t1 "Session PR" https://github.com/org/repo/pull/42
tack deliverable auth-rewrite t1 "New session PR" https://github.com/org/repo/pull/43 --force
```

## Todos

### `tack before <slug> <tack-id> <text>`

Add a pre-work todo.

```bash
tack before auth-rewrite t1 "Read compliance requirements"
```

### `tack after <slug> <tack-id> <text>`

Add a post-work todo.

```bash
tack after auth-rewrite t1 "Notify security team"
```

### `tack todo done <slug> <tack-id> <todo-id>`

Complete a todo item.

```bash
tack todo done auth-rewrite t1 b1
```

### `tack todo rm <slug> <tack-id> <todo-id>`

Delete a todo item.

```bash
tack todo rm auth-rewrite t1 a2
```

## Links

### `tack link add <slug> <tack-id> <label> <url>`

Add a reference link to a tack. The URL is always recorded as a link —
even when it points at a PR/MR — so links and deliverables stay
explicit. Use `tack deliverable` to set the change request directly.

```bash
tack link add auth-rewrite t1 "Design doc" https://docs.example.com/auth
tack link add auth-rewrite t1 "Slack thread" https://slack.com/archives/C123/p456
```

### `tack link rm <slug> <tack-id> <url>`

Remove a link from a tack by URL. Fails if no link with that URL exists.

```bash
tack link rm auth-rewrite t1 https://slack.com/archives/C123/p456
```

## Pinning

A pin marks a route as active for a working directory. The tack skill reads
the pin first when resolving "what am I working on?", so pinned routes win
over branch-slug or single-open-route heuristics.

### `tack pin [<slug>]`

Pin a route to the current directory. Writes a `.tack` YAML file at the cwd
root. Invoking with no slug prints the current pin (exit 1 if no pin is set).

```bash
tack pin auth-rewrite    # pin
tack pin                 # show current pin
```

The pin file holds `slug`, `pinned_at`, and an optional `session_id`. Commit
it for shared assignment across a team, or `.gitignore` it for per-dev state.

### `tack unpin`

Clear the pin for the current directory. Exits zero whether or not a pin
existed.

```bash
tack unpin
```
