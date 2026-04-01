# tack — Route Schema Specification (v1)

## Overview

tack is a tool-agnostic route schema for tracking AI-assisted development
work. A route captures the non-linear, multi-project reality of how
development actually happens — pivots, context switches, expanding scope — so
that work-in-progress survives context exhaustion, crashes, and session
boundaries.

The schema is the primary deliverable. The CLI is a convenience wrapper.

---

## Data Model

```
Route (1 YAML file)
├── id (UUID), slug, created_at, updated_at
├── origin: planned | tangent
├── depends_on: [route slugs]
├── sessions[]
│   └── id, started_at
└── tacks[]
    ├── id (t1, t2, ...), summary, status
    ├── project, done_at
    ├── depends_on: [tack IDs]
    ├── deliverable — the change request
    │   └── label, url
    ├── before[] — pre-work todos
    │   └── id (b1, b2, ...), text, done, done_at
    ├── after[] — post-work todos
    │   └── id (a1, a2, ...), text, done, done_at
    └── links[] — references (docs, issues, threads, etc.)
        └── label, url
```

---

## Requirements

### RT — Route Schema

**[RT-01]** The route schema shall use YAML as the on-disk format.

**[RT-02]** Each route shall be stored as a single file at
`~/.tack/routes/<slug>.yaml`.

**[RT-03]** Each route shall contain the following required fields:
- `id` (string) — a v4 UUID, generated once at creation time
- `slug` (string) — unique identifier, lowercase, hyphenated
- `created_at` (string) — ISO 8601 timestamp
- `updated_at` (string) — ISO 8601 timestamp
- `tacks` (array) — list of tack objects

**[RT-04]** Each route shall contain the following optional fields:
- `origin` (string) — one of: `planned`, `tangent`. Defaults to `planned` when
  omitted. A `tangent` is unplanned, reactive work (drive-by fix, opportunistic
  contribution, etc.) that wasn't part of any goal. Tangents may be promoted to
  `planned` if they grow in scope.
- `depends_on` (array of strings) — slugs of routes that must complete before
  this one can proceed

**[RT-05]** The `slug` field shall be unique across all route files in
`~/.tack/routes/`. When a slug matches an existing filename, the operation
shall fail with an error.

**[RT-06]** The `updated_at` field shall be set to the current time whenever
the route file is written.

**[RT-07]** A route shall be valid with an empty `tacks` array.

**[RT-08]** The `id` field shall be immutable after creation. It shall not
change when the route is updated.

**[RT-09]** Each route shall contain the following optional field:
- `sessions` (array) — Claude Code session references that touched this route

**[RT-10]** Each session entry shall contain the following required fields:
- `id` (string) — the Claude Code session identifier
- `started_at` (string) — ISO 8601 timestamp when the session first touched
  this route

---

### TK — Tacks

**[TK-01]** Each tack shall contain the following required fields:
- `id` (string) — route-scoped identifier in the format `t<N>` where N is a
  sequential integer starting at 1
- `summary` (string) — human-readable description of the work
- `status` (string) — one of: `pending`, `in_progress`, `done`, `blocked`,
  `dropped`

**[TK-02]** Each tack shall contain the following optional fields:
- `done_at` (string) — ISO 8601 date (YYYY-MM-DD) when the tack was completed
- `project` (string) — repository or project identifier (e.g., `org/repo-name`)
- `depends_on` (array of strings) — IDs of tacks within the same route that
  must complete first
- `deliverable` (object) — the change request this tack produces
- `before` (array) — pre-work todo items
- `after` (array) — post-work todo items
- `links` (array) — external references

**[TK-03]** When `status` is set to `done`, the `done_at` field shall be set
to the current date if not already present.

**[TK-04]** When `status` is set to `done`, if the tack has `after` items with
`done: false`, those items shall be surfaced to the user before proceeding.

**[TK-05]** Tack IDs shall be unique within a route. When a new tack is
added, its ID shall be `t<N>` where N is one greater than the highest existing
tack number.

**[TK-06]** When a tack's `depends_on` references a tack ID that does not
exist in the route, the operation shall fail with an error.

**[TK-07]** When a tack's `depends_on` references would create a circular
dependency, the operation shall fail with an error.

---

### DV — Deliverable

**[DV-01]** Each tack shall have at most one deliverable. The deliverable
represents the change request (PR/MR) that the tack produces.

**[DV-02]** Each deliverable shall contain the following required fields:
- `label` (string) — short display text
- `url` (string) — full URL

---

### TD — Todo Items

**[TD-01]** Todo items appear in two arrays on a tack: `before` (pre-work)
and `after` (post-work). Both arrays use the same item schema.

**[TD-02]** Each todo item shall contain the following required fields:
- `id` (string) — scoped identifier: `b<N>` for before items, `a<N>` for
  after items, where N is a sequential integer starting at 1
- `text` (string) — description of the instruction
- `done` (boolean) — whether the instruction has been completed

**[TD-03]** Each todo item shall contain the following optional fields:
- `done_at` (string) — ISO 8601 date (YYYY-MM-DD) when completed

**[TD-04]** When `done` is set to `true`, the `done_at` field shall be set to
the current date if not already present.

**[TD-05]** Todo IDs shall be unique within their respective array (before or
after). When a new todo is added, its ID shall use the next sequential number
for that array's prefix.

---

### DP — Dependencies

**[DP-01]** Route-level `depends_on` shall be an array of route slugs
(strings).

**[DP-02]** Tack-level `depends_on` shall be an array of tack IDs within the
same route.

**[DP-03]** When a tack has `depends_on` entries and any referenced tack has a
status other than `done`, the dependent tack's status shall not be set to
`in_progress` — the operation shall fail with an error indicating which
dependencies are unmet.

**[DP-04]** Route-level dependencies shall be informational. The CLI shall
display them in `tack status` output but shall not enforce them (the referenced
route files may not exist locally).

---

### LK — Links

**[LK-01]** Each link shall contain the following required fields:
- `label` (string) — short display text
- `url` (string) — full URL

---

### ST — Storage

**[ST-01]** Route files shall be stored in `~/.tack/routes/`.

**[ST-02]** The storage directory shall be created automatically on first use
if it does not exist.

**[ST-03]** Route filenames shall match the pattern `<slug>.yaml`.

**[ST-04]** The JSON Schema at `schema/route.schema.json` shall be the
canonical validation source for route files.

**[ST-05]** When reading a route file, the CLI shall validate it against the
JSON Schema. If validation fails, the CLI shall report the errors and exit
without modifying the file.

---

### CL — CLI

**[CL-01]** The CLI shall be invoked as `tack <command> [options]`.

**[CL-02]** `tack init <slug> [--tangent]` — When invoked, the CLI shall create
a new route file at `~/.tack/routes/<slug>.yaml` with a generated v4 UUID as
`id`, an empty `tacks` array, and `created_at`/`updated_at` set to the current
time. When `--tangent` is passed, the route's `origin` shall be set to
`tangent`.

**[CL-03]** `tack status [slug]` — When invoked with a slug, the CLI shall
display the route's tacks, their statuses, dependencies, deliverable, and any
pending todo items. When invoked without a slug, the CLI shall display a
summary of all routes.

**[CL-04]** `tack add <slug> <summary> [--project <project>]
[--depends-on <id,...>]` — When invoked, the CLI shall add a new tack to the
specified route with the next sequential ID.

**[CL-05]** `tack done <slug> <tack-id>` — When invoked, the CLI shall set the
specified tack's status to `done` and `done_at` to the current date. If the
tack has pending `after` items, they shall be displayed.

**[CL-06]** `tack drop <slug> <tack-id>` — When invoked, the CLI shall set the
specified tack's status to `dropped`.

**[CL-07]** `tack start <slug> <tack-id>` — When invoked, the CLI shall set
the specified tack's status to `in_progress`. If the tack has `depends_on`
entries with unmet dependencies, the operation shall fail per [DP-03].

**[CL-08]** `tack deliverable <slug> <tack-id> <label> <url>` — When invoked,
the CLI shall set the deliverable on the specified tack.

**[CL-09]** `tack before <slug> <tack-id> <text>` — When invoked, the CLI
shall add a pre-work todo item to the specified tack with `done: false`.

**[CL-10]** `tack after <slug> <tack-id> <text>` — When invoked, the CLI
shall add a post-work todo item to the specified tack with `done: false`.

**[CL-11]** `tack todo done <slug> <tack-id> <todo-id>` — When invoked, the
CLI shall mark the specified todo item as `done: true` and set `done_at` to
the current date per [TD-04].

**[CL-12]** `tack todo drop <slug> <tack-id> <todo-id>` — When invoked, the
CLI shall remove the specified todo item from its array.

**[CL-13]** `tack link <slug> <tack-id> <label> <url>` — When invoked, the
CLI shall add a link to the specified tack.

**[CL-14]** `tack list` — When invoked, the CLI shall list all route files in
`~/.tack/routes/` with their slug, number of tacks, and number of open tacks.

**[CL-15]** `tack rm <slug> [--force]` — When invoked, the CLI shall delete
the route file at `~/.tack/routes/<slug>.yaml`. The CLI shall require
`--force` to confirm deletion; without it, the CLI shall display a
confirmation message and exit without deleting.

**[CL-16]** When any write command succeeds, the CLI shall display the updated
state of the affected tack or route.

---

### AG — Agent Integration

**[AG-01]** The agent shall be implemented as a Claude Code skill that reads
and writes tack route files using the CLI defined in the CL category.

**[AG-02]** When a session begins, the agent shall load all active routes
(routes with at least one tack whose status is not `done` or `dropped`) in
the background to build context about current work.

**[AG-03]** When the user begins work in a project that is not referenced by
any active route's tacks (via the `project` field), the agent shall ask
whether the work is a tangent. The question shall be phrased as a single
non-blocking line (e.g., "This doesn't seem related to any current route —
tangent?").

**[AG-04]** When the user confirms a tangent, the agent shall create a new
route with `origin` set to `tangent` and add the first tack.

**[AG-05]** When a tack produces a deliverable (PR/MR URL appears in the
session), the agent shall record it on the current tack automatically without
prompting the user.

**[AG-06]** When a URL is pasted or referenced during a session, the agent
shall capture it as a link on the current tack automatically. URLs already
recorded as a deliverable per [AG-05] shall not be duplicated as links.

**[AG-07]** The agent shall not prompt the user more than once per distinct
event. If the user ignores or dismisses a prompt, the agent shall not re-ask
about the same work item in the same session.

**[AG-08]** When the user completes a tack, the agent shall surface any
pending `after` todo items per [TK-04] before moving on.

**[AG-09]** When the agent begins operating on a route, it shall record the
current Claude Code session ID in the route's `sessions` array per [RT-09].
If the session ID already exists, it shall not duplicate.

---

## Anti-Requirements

The following are explicitly out of scope:

- **No project management.** No sprints, epics, story points, or velocity.
- **No time tracking.** No start times, durations, or estimates.
- **No git operations.** tack does not create branches, commits, or tags.
- **No enforced workflows.** No prescribed state machines beyond the status
  enum. Users can move between statuses freely (except where dependencies
  constrain transitions per [DP-03]).
- **No server, sync, or cloud.** Local files only.
- **No cross-route dependency enforcement.** Route-level `depends_on` is
  informational only per [DP-04].
