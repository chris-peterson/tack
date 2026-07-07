# CLI Reference

Tack ids display as `t<N>`. Anywhere a command takes a `<tack-id>`, `<dep-id>`,
or a `--depends-on` entry, the bare number works too — `t7` and `7` both
resolve to the same tack.

## Routes

### `tack init <slug>`

Create a new route.

```bash
tack init auth-rewrite
```

### `tack status [slug] [--all] [--json]`

Show route details. Without a slug, shows a summary of all routes. Dropped
tacks are hidden by default; pass `--all` to include them. `--json` emits the
route object (or, without a slug, the route summary array) for scripting.

```bash
tack status auth-rewrite
tack status auth-rewrite --all
tack status
tack status auth-rewrite --json
```

### `tack list [--json]`

List all routes with open/total tack counts. `--json` emits the full route
objects.

```bash
tack list
tack list --json
```

### `tack recent [--count <n>] [--since <date>] [--json]`

List routes by most recent activity, with open/total counts and the
`updated_at` timestamp. Filter with `--count` (cap the number of routes) and
`--since` (a `YYYY-MM-DD` date or ISO 8601 date-time). `--json` emits the same
rows as an array.

```bash
tack recent
tack recent --count 5
tack recent --since 2026-05-01 --json
```

### `tack find <url> [--json]`

Find every tack that references a URL, in any deliverable or link. `--json`
emits the matches as an array.

```bash
tack find https://github.com/org/repo/pull/42
tack find https://github.com/org/repo/pull/42 --json
```

### `tack tree [path] [-d <depth>] [--json]`

Browse routes and tacks as a navigable tree. Paths use `/`-separated segments
with progressive drill-down. Supports glob wildcards (`*`, `?`) for querying
across routes and tacks.

**Depth levels:** 1 = routes only (default), 2 = routes + tacks, 3 = full details.

**`--json`** returns the structured data behind the view instead of the
rendered tree, so the output drops straight into `jq` and other tooling. The
shape follows the navigation depth: no path → an array of full route objects;
a slug → that route; `slug/tack` → that tack; `slug/tack/aspect` → an object
holding the aspect value. Glob paths return a flat array of matches whose shape
varies by pattern depth (routes, `{slug, tack}`, or `{slug, tackId, aspect,
value}`). `--json` always emits full objects, so `-d` is ignored alongside it.

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

# Pipe a route's tacks into jq
tack tree auth-rewrite --json | jq '.tacks[] | select(.status == "in_progress")'
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

Note on stale pins: any pins referencing the old slug fail to resolve on
the next session — `tack pin <old-slug>` and any write targeting the old
slug error with `Route not found`. The old name is **not** resurrected, so
there's no risk of a split route. Re-pin from the affected working
directory when you next visit it.

### `tack group <slug> [<group>] [--clear]`

Set, change, or clear a route's group. The group buckets related routes in
downstream views (e.g. the `/wip` dashboard groups routes by it), so
re-grouping a route is a normal housekeeping operation. Without this verb the
only way to re-group an existing route was to hand-edit its YAML; `tack group`
goes through the same load → modify → validate → save path as the other
route-level operations.

```bash
tack group auth-rewrite platform   # set or change the group
tack group auth-rewrite --clear     # return the route to ungrouped
tack group auth-rewrite             # print the current group (exits non-zero if none)
```

The group must be a valid slug (`^[a-z0-9][a-z0-9-]*[a-z0-9]$`) — the same
constraint `tack init --group` enforces. An invalid group surfaces a
validation error and the route is left unchanged.

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
| `--deliverable <url>` | Set the deliverable URL on creation. The label is auto-derived from the URL (`repo#N` for GitHub PRs/issues, `repo!N` for GitLab MRs, `repo@<sha7>` for commits). For a custom label, use `tack deliverable` after creation. |

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

When run inside a Claude Code session (the `CLAUDE_CODE_SESSION_ID`
environment variable is set), `start` also binds that session to the tack —
the same link `tack session <slug> <session-id> --tack <tack-id>` writes.
That's what lets the fleet view (beacon) show which tack a session is
driving, with nothing extra to run. Outside a Claude session it's a no-op.

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

### `tack deliverable <slug> <tack-id> <url> [--label <text>] [--force]`

Set the change request for a tack. The label is derived from the URL —
`<repo>#<n>` for a GitHub PR/issue, `<repo>!<n>` for a GitLab MR,
`<repo>@<sha7>` for a commit; unrecognized URLs keep the URL as the label.
Pass `--label` to override the derived label (e.g. an unrecognized forge URL,
or to use prose).

If a deliverable is already recorded, the command refuses with an error showing
the existing label and URL — this prevents a typo'd tack ID from silently
clobbering an unrelated tack's deliverable. Pass `--force` to overwrite
intentionally.

If the URL is already attached to another tack (as a deliverable or link), the
command prints a `warning: url already on <route>/<tack> ...` to stderr naming
where it lives, so you can spot a duplicate before a downstream tool
double-counts the work. The attach still completes — the warning is
informational. Re-attaching a URL already on the same tack does not warn.

```bash
tack deliverable auth-rewrite t1 https://github.com/org/repo/pull/42            # label → "repo#42"
tack deliverable auth-rewrite t1 https://github.com/org/repo/pull/42 --label "Session PR"
tack deliverable auth-rewrite t1 https://github.com/org/repo/pull/43 --label "New session PR" --force
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

If the URL is already attached to another tack, the command prints a
`warning: url already on ...` to stderr (see `tack deliverable`). The link is
still added.

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

Pin a route to the current directory. The pin is recorded in
`~/.tack/pins.yaml` (keyed by absolute cwd) — tack never writes state into
the project tree. Invoking with no slug prints the current pin (exit 1 if no
pin is set).

```bash
tack pin auth-rewrite    # pin
tack pin                 # show current pin
```

Each pin holds `slug`, `pinned_at`, and an optional `session_id`.

### `tack unpin`

Clear the pin for the current directory. Exits zero whether or not a pin
existed.

```bash
tack unpin
```

### `tack pins [--json]`

List every pin with its directory, slug, and pin timestamp. Entries whose
route no longer exists are flagged `[dangling]`; entries whose route has no
open tacks are flagged `[idle]`. `--json` emits the structured list with the
computed flags.

```bash
tack pins
tack pins --json
```

### `tack pins prune`

Remove pins whose route no longer exists or whose directory is gone from
disk, printing each removed entry with the reason. Idle pins are kept — a
finished route that may resume later holds its pin until you `tack unpin`
or re-pin the directory.

```bash
tack pins prune
```

## Backup

### `tack export [path]`

Bundle the entire local store — every route, the repo database, and pins —
into a single gzip-compressed JSON document. The document carries a
`schemaVersion` (currently `1`), an `exportedAt` timestamp, and a `generator`
string, so a future format change can be migrated rather than misread. When
`path` is omitted the file is written to `tack-backup-<YYYY-MM-DD>.json.gz`
in the current directory.

```bash
tack export                         # → tack-backup-2026-07-07.json.gz
tack export ~/backups/tack.json.gz  # explicit path
```

### `tack import <file> [--merge|--replace] [--dry-run]`

Read an archive produced by `tack export`. An archive whose `schemaVersion`
is newer than the running tack is refused rather than mishandled.

- **`--merge`** (default) — combine the archive with the local store, for
  syncing a second machine. Routes absent locally are created. For a route
  that exists on both, only tacks whose identity — the deliverable URL, or
  summary + `done_at` when there's no deliverable — isn't already present are
  appended; they get fresh ids, `depends_on` edges are remapped to the new
  ids, and every `old id → new id` reassignment is reported. Repo *names* are
  unioned; machine-specific repo `locals` and pins are ignored.
- **`--replace`** — full restore onto the same machine: overwrite each route
  in the archive verbatim and replace the repo database and pins wholesale.
- **`--dry-run`** — report what would change without writing anything.

```bash
tack import tack-backup-2026-07-07.json.gz            # merge (default)
tack import tack-backup-2026-07-07.json.gz --dry-run  # preview only
tack import tack-backup-2026-07-07.json.gz --replace  # restore this machine
```
