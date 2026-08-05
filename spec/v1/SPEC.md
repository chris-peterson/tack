# tack — Route Schema Specification (v1)

## Overview

tack is a tool-agnostic route schema for tracking AI-assisted development
work. A route captures the non-linear, multi-project reality of how
development actually happens — pivots, context switches, expanding scope — so
that work-in-progress survives context exhaustion, crashes, and session
boundaries.

The schema is the primary deliverable. The CLI encapsulates schema
operations as a deterministic primitive. A separate Claude Code plugin
bundles hooks and a skill that layer reasoning on top — picking the active
route, prompting on ambiguity, capturing URLs — using the CLI as its only
write path.

```mermaid
%%{ init: { 'look': 'handDrawn' } }%%
flowchart LR
    subgraph deterministic ["Deterministic"]
        cli["tack CLI"]
        schema["~/.tack/routes/*.yaml"]
        cli --> schema
    end

    subgraph plugin ["Claude Code plugin"]
        hooks["hooks"]
        skill["tack skill"]
        hooks --> skill
    end

    skill --> cli
```

The CLI and YAML schema are the durable, tool-agnostic layer. The plugin is
a Claude-Code-specific surface that wraps the CLI; other agents or tools can
target the same schema by speaking to the CLI directly.

---

## Data Model

```
Route (1 YAML file)
├── id (UUID), slug, created_at, updated_at
├── group (optional grouping slug)
├── depends_on: [route slugs]
├── sessions[]
│   └── id, started_at, tacks[] — route-scoped tack IDs the session is driving
└── tacks[]
    ├── id (t1, t2, ...), summary, status
    ├── done_at
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

```
Repo database (1 YAML file, ~/.tack/repos.yaml)
└── <normalized-remote> (map key, e.g. github.com/chris-peterson/anchor)
    ├── names[]  — names the repo is known by (derived name + custom aliases)
    └── locals[] — absolute paths of known checkouts/worktrees
```

---

## Requirements

### ROUTE — Route Schema

**[ROUTE-01]** The route schema shall use YAML as the on-disk format.

**[ROUTE-02]** Each route shall be stored as a single file at
`~/.tack/routes/<slug>.yaml`.

**[ROUTE-03]** Each route shall contain the following required fields:
- `id` (string) — a v4 UUID, generated once at creation time
- `slug` (string) — unique identifier, lowercase, hyphenated
- `created_at` (string) — ISO 8601 timestamp
- `updated_at` (string) — ISO 8601 timestamp
- `tacks` (array) — list of tack objects

**[ROUTE-04]** Each route shall contain the following optional fields:
- `group` (string) — a grouping slug for associating related routes. Multiple
  routes may share the same group. Uses the same format as `slug` (lowercase,
  hyphenated). The field is purely organizational — the CLI does not enforce or
  validate group membership.
- `depends_on` (array of strings) — slugs of routes that must complete before
  this one can proceed
- `title` (string) — a human-readable name for the route, free-form and
  unconstrained. It is displayed alongside the slug, never in place of it: the
  slug remains the addressing key every command takes and every listing prints,
  so a reader can always type back what they see.
- `description` (string) — markdown prose stating the route's goal and why it
  matters, for a consumer that shows route-level context (a WIP dashboard, or
  `tack status`). It is durable prose, kept free of ephemeral state: counts,
  tack IDs, and current status are derived from the `tacks` array and go stale
  the moment a tack lands. The CLI stores and prints the markdown verbatim; it
  does not render or interpret it.

**[ROUTE-12]** A slug — a route's ([ROUTE-03]) or a group's ([ROUTE-04]) —
shall match `^[a-z0-9][a-z0-9-]*[a-z0-9]$`: lowercase alphanumerics and
hyphens, beginning and ending alphanumeric. The pattern is anchored at both
ends by two separate character classes, so it admits nothing shorter than two
characters; the minimum is a consequence of that shape rather than a rule of
its own, and relaxing it is additive under [COMPAT-02]. The pattern lives in
`schema/route.schema.json` ([STORE-04]) and is checked at the command boundary
([STORE-08]).

**[ROUTE-13]** A route's completeness shall be derived from its tacks and shall
not be stored: a route is `done` when it holds at least one tack and none of
them carries a `status` of anything but `done` or `dropped` ([TACK-01]), and
`active` otherwise. Adding an open tack to a finished route returns it to
`active`. A route with no tacks is `active` — `done` would assert completed work
that never existed. The derived value is named `state` rather than `status`
because a tack's `status` is set by the caller and this one cannot be; it
appears in the route and listing renderings ([CLI-03], [CLI-14]) and never in
the route file, which the schema closes against unknown fields ([STORE-04]).

**[ROUTE-14]** `created_at` shall be no later than the earliest `done_at` among
the route's tacks: on each write, a route whose earliest tack date precedes its
`created_at` shall adopt that date, widened to a date-time when the tack
recorded a bare `YYYY-MM-DD` ([TACK-03]). The floor ratchets earlier only.
Recomputing it in both directions would move a route's creation forward when its
earliest tack is deleted, and a route's creation does not un-happen. `updated_at`
stays touch-on-write for the mirror-image reason: it has to bump on mutations
that touch no tack date at all — a rename, a regroup, a link added — which a
maximum over child dates cannot observe.

**[ROUTE-05]** The `slug` field shall be unique across all route files in
`~/.tack/routes/`. When a slug matches an existing filename, the operation
shall fail with an error.

**[ROUTE-06]** The `updated_at` field shall be set to the current time whenever
the route file is written, except when `tack import --replace` ([CLI-50])
restores a route verbatim, which preserves the archived timestamp.

**[ROUTE-07]** A route shall be valid with an empty `tacks` array.

**[ROUTE-08]** The `id` field shall be immutable after creation. It shall not
change when the route is updated.

**[ROUTE-09]** Each route shall contain the following optional field:
- `sessions` (array) — Claude Code session references that touched this route

**[ROUTE-10]** Each session entry shall contain the following required fields:
- `id` (string) — the Claude Code session identifier
- `started_at` (string) — ISO 8601 timestamp when the session first touched
  this route

**[ROUTE-11]** Each session entry shall contain the following optional field:
- `tacks` (array of strings) — IDs of tacks *within this route* that the
  session is driving, in touch order. The last entry is the session's current
  focus. Because the array lives inside the route file, the IDs are bare
  route-scoped `t<N>` values; a cross-route consumer (e.g. a fleet view that
  reads every route) addresses them as `<slug>/<tack-id>` per [CLI-21a]. This
  is the session→tack link: `sessions[]` already records session→route per
  [ROUTE-09], and this field narrows it to the specific tack(s) a session is
  working, so a reader keyed on the Claude session id can resolve which tack a
  live session is driving — not just which route.

---

### TACK — Tacks

**[TACK-01]** Each tack shall contain the following required fields:
- `id` (string) — route-scoped identifier in the format `t<N>` where N is a
  sequential integer starting at 1
- `summary` (string) — human-readable description of the work
- `status` (string) — one of: `pending`, `in_progress`, `done`, `blocked`,
  `dropped`

**[TACK-02]** Each tack shall contain the following optional fields:
- `done_at` (string) — ISO 8601 date (`YYYY-MM-DD`) or date-time
  (`YYYY-MM-DDTHH:MM:SSZ`) when the tack was completed. The CLI writes the
  full date-time on new completions; bare dates are accepted on read for
  backward compatibility with routes created before v0.11.0.
- `depends_on` (array of strings) — IDs of tacks within the same route that
  must complete first
- `deliverable` (object) — the change request this tack produces
- `before` (array) — pre-work todo items
- `after` (array) — post-work todo items
- `links` (array) — external references

**[TACK-03]** When `status` is set to `done`, the `done_at` field shall be set
to the current ISO 8601 date-time if not already present. Callers may supply
an explicit timestamp (date or date-time) per [CLI-05] to backfill already-merged
work.

**[TACK-04]** When `status` is set to `done`, if the tack has `after` items with
`done: false`, those items shall be surfaced in the response so the calling
agent can confirm or close them out. The CLI persists the status change before
displaying the pending items; gating responsibility lies with the caller.

**[TACK-05]** Tack IDs shall be unique within a route. When a new tack is
added, its ID shall be `t<N>` where N is one greater than the highest existing
tack number.

**[TACK-06]** When a tack's `depends_on` references a tack ID that does not
exist in the route, the operation shall fail with an error.

**[TACK-07]** When a tack's `depends_on` references would create a circular
dependency, the operation shall fail with an error.

**[TACK-08]** Wherever a command argument identifies a tack — a `<tack-id>`, a
`<dep-id>`, or an entry in `--depends-on` — both the canonical `t<N>` form and
the bare `<N>` form shall resolve to the same tack. Bare ids are normalized to
`t<N>` at the lookup boundary, so the form a caller types does not change the
result or the stored value. An argument that is neither form is left unchanged
and still produces the usual "tack not found" error.

---

### DEL — Deliverable

**[DEL-01]** Each tack shall have at most one deliverable. The deliverable
represents the change request (PR/MR) that the tack produces.

**[DEL-02]** Each deliverable shall contain the following required fields:
- `label` (string) — short display text
- `url` (string) — full URL

---

### TODO — Todo Items

**[TODO-01]** The system shall represent both `before` (pre-work) and `after`
(post-work) todo items with the same item schema.

**[TODO-02]** Each todo item shall contain the following required fields:
- `id` (string) — scoped identifier: `b<N>` for before items, `a<N>` for
  after items, where N is a sequential integer starting at 1
- `text` (string) — description of the instruction
- `done` (boolean) — whether the instruction has been completed

**[TODO-03]** Each todo item shall contain the following optional fields:
- `done_at` (string) — ISO 8601 date (`YYYY-MM-DD`) or date-time
  (`YYYY-MM-DDTHH:MM:SSZ`) when completed. New writes use the full date-time;
  bare dates remain valid on read.

**[TODO-04]** When `done` is set to `true`, the `done_at` field shall be set to
the current ISO 8601 date-time if not already present.

**[TODO-05]** Todo IDs shall be unique within their respective array (before or
after). When a new todo is added, its ID shall use the next sequential number
for that array's prefix.

---

### DEP — Dependencies

**[DEP-01]** Route-level `depends_on` shall be an array of route slugs
(strings).

**[DEP-02]** Tack-level `depends_on` shall be an array of tack IDs within the
same route.

**[DEP-03]** When a tack has `depends_on` entries and any referenced tack has a
status other than `done`, the dependent tack's status shall not be set to
`in_progress` — the operation shall fail with an error indicating which
dependencies are unmet.

**[DEP-04]** Route-level dependencies shall be informational. The CLI shall
display them in `tack status` output but shall not enforce them (the referenced
route files may not exist locally).

---

### LINK — Links

**[LINK-01]** Each link shall contain the following required fields:
- `label` (string) — short display text
- `url` (string) — full URL

---

### STORE — Storage

**[STORE-01]** Route files shall be stored in `~/.tack/routes/`.

**[STORE-02]** The storage directory shall be created automatically on first use
if it does not exist.

**[STORE-03]** Route filenames shall match the pattern `<slug>.yaml`.

**[STORE-04]** The JSON Schema at `schema/route.schema.json` shall be the
canonical validation source for route files.

**[STORE-05]** When reading a route file, the CLI shall validate it against the
JSON Schema. If validation fails, the CLI shall report the errors and exit
without modifying the file.

**[STORE-07]** When reading a route file, the CLI shall require the file's
internal `slug` to equal its filename stem (per [STORE-03]) and shall otherwise
report the disagreement — naming both the filename and the declared slug — and
exit without modifying the file. Writes resolve their path from the route's
`slug`, so a file loaded under a different name would be written back under the
declared one on the next mutation, renaming the route silently.

**[STORE-09]** Where a command reads every route file rather than one named
route — a listing, a cross-route search, an export — it shall apply [STORE-05]
and [STORE-07] to each file and fail on the first that does not pass, rather
than skipping it and reporting the rest. A skipped route is an invisible route:
the output looks complete, and the work recorded in the unreadable file is
missing from it with nothing on screen to say so.

**[STORE-08]** Where a command accepts a slug from the caller — a route slug
([CLI-02], [CLI-35], [CLI-52]) or a group slug ([CLI-02], [CLI-51], [CLI-52])
— the CLI shall check
it against the slug pattern at the command boundary and report a message naming
the rule. A route named in the command shall be resolved before its group
argument is checked, so a missing route is reported as such.

**[STORE-06]** Pins shall be stored in a single YAML file at `~/.tack/pins.yaml`,
a map keyed by absolute working-directory path. Each entry has the following
fields:
- `slug` (string, required) — the pinned route's slug
- `pinned_at` (string, required) — ISO 8601 timestamp of when the pin was
  written
- `session_id` (string, optional) — informational; the Claude Code session
  that wrote the pin

tack shall never write state into the working directory itself — a state
file in the project tree is one `git add .` away from being committed to a
repo where it has no business. All tack state lives under `~/.tack/`.

---

### CLI — CLI

**[CLI-01]** The CLI shall be invoked as `tack <command> [options]`.

**[CLI-02]** `tack init <slug> [--group <slug>]` — When invoked, the CLI shall
create a new route file at `~/.tack/routes/<slug>.yaml` with a generated v4
UUID as `id`, an empty `tacks` array, and `created_at`/`updated_at` set to
the current time. When `--group` is passed, the route's `group` shall be set
to the given slug. When the `CLAUDE_CODE_SESSION_ID` environment variable is
set (the CLI is running inside a Claude Code session), the CLI shall also
record that session on the route per [ROUTE-09] — route-level, without binding a
tack ([ROUTE-11] binding is reserved for [CLI-07] / [CLI-17], which know the tack).
Creating a route in a session is a declaration that the session is working it,
so a fleet reader keyed on the session id attributes the session to the route
with no separate `tack session` call. Outside a Claude session this is a no-op.

**[CLI-03]** `tack status [slug] [--all]` — When invoked with a slug, the CLI
shall display the route's tacks, their statuses, dependencies, deliverable,
and any pending todo items. Tacks with status `dropped` shall be omitted by
default; when `--all` is passed, dropped tacks shall be included. When invoked
without a slug, the CLI shall display a summary of all routes.

**[CLI-04]** `tack add <slug> <summary> [--depends-on <id,...>] [--done] [--date <ts>] [--deliverable <url>] [--link "label,url"]...` —
When invoked, the CLI shall add a new tack to the specified route with the
next sequential ID. When `--done` is passed, the tack shall be created with
status `done` and `done_at` set to the current ISO 8601 date-time, or to the
explicit value of `--date <ts>` (a `YYYY-MM-DD` date or full ISO 8601
date-time) when supplied — this is the supported path for backfilling
already-merged work. When `--deliverable <url>` is passed, the tack shall be
created with its `deliverable` field set; the label is auto-derived from the
URL using the recognition rules in [CLI-37]. When the URL does not match
a recognized pattern, the URL itself is used as the label. `--link` is
repeatable and attaches a link per invocation; each value is `"label,url"`
(matching `tack link add`'s `<label> <url>` pair per [CLI-13]). The CLI shall
split each value at the first comma whose suffix parses as an absolute URL, so
that commas are permitted in the label (enumerations, clauses) and in the URL
(query values such as `?ids=1,2`); a value with no such comma shall be rejected
with a usage error naming the expected `"label,url"` form. Links are
deduplicated on creation against the deliverable and one another, consistent
with [CLI-13]. The CLI shall
reject unknown flags with a usage error rather than silently ignoring them.
When the `CLAUDE_CODE_SESSION_ID` environment variable is set, the CLI shall
also record that session on the route per [ROUTE-09], route-level (as [CLI-02]
does for `tack init`).

**[CLI-05]** `tack done <slug> <tack-id> [--date <ts>]` — When invoked, the CLI
shall set the specified tack's status to `done`. `done_at` shall be set to the
current ISO 8601 date-time, or to the explicit value of `--date <ts>`
(`YYYY-MM-DD` or full ISO 8601 date-time) when supplied — used to backfill
work that merged on a prior date. If the tack has pending `after` items, they
shall be displayed. If the tack has no deliverable and its `links` array
contains exactly one PR/MR URL, that link shall be promoted to the tack's
deliverable and removed from `links`. If the tack has no deliverable and the
`links` array contains two or more PR/MR URLs, the CLI shall not promote any
of them — the status change still completes, and the CLI shall emit a warning
to stderr naming the candidates and the `tack deliverable` command to pick
one.

**[CLI-06]** `tack drop <slug> <tack-id>` — When invoked, the CLI shall set the
specified tack's status to `dropped`. The tack shall remain in the route file
as a historical record of intentionally descoped work. To permanently delete a
tack created in error, use [CLI-25].

**[CLI-07]** `tack start <slug> <tack-id>` — When invoked, the CLI shall set
the specified tack's status to `in_progress`. If the tack has `depends_on`
entries with unmet dependencies, the operation shall fail per [DEP-03]. The
error message shall guide the user to either drop the edge with
[CLI-33] (`tack depends rm`) when the declared ordering no longer holds, or
to bypass the guard with [CLI-34] (`tack status set`) when the inconsistent
state is intentional. When the `CLAUDE_CODE_SESSION_ID` environment variable
is set (the CLI is running inside a Claude Code session), the CLI shall also
bind that session to the started tack per [ROUTE-11] / [CLI-17] — starting a tack
in a session is the declaration that the session is driving it, so a fleet
reader keyed on the Claude session id (e.g. beacon) can attribute the session
to the tack with no separate `tack session --tack` call. Outside a Claude
session (variable unset) this is a no-op.

**[CLI-08]** `tack deliverable <slug> <tack-id> <url> [--label <text>] [--force]` —
When invoked, the CLI shall set the deliverable on the specified tack. The
label is auto-derived from the URL using the recognition rules in [CLI-37];
`--label <text>` overrides the derived label and is used verbatim. The CLI
shall require exactly the three positionals `<slug> <tack-id> <url>` and fail
with a usage error otherwise. If the tack already has a deliverable, the CLI
shall fail with an error showing the existing deliverable's label and URL
unless `--force` is passed. The overwrite guard prevents typo'd tack IDs from
silently clobbering an unrelated tack's deliverable.

**[CLI-08a]** `tack deliverable rm <slug> <tack-id> [--to-link]` — When
invoked, the CLI shall remove the deliverable from the specified tack — the
inverse of [CLI-08]. By default the tack is left with no deliverable. When
`--to-link` is passed, the deliverable shall instead be relocated into the
tack's `links` array preserving its label and URL, so the URL is never lost in
the transition; if that URL is already present in `links`, the relocation is a
no-op on the link (no duplicate), consistent with [CLI-13]. If the tack has no
deliverable, the CLI shall fail with a clear message. The `rm` subcommand does
not rename the set form of [CLI-08], which keeps its bare `<slug> <tack-id>
<url>` positional grammar.

**[CLI-09]** `tack before <slug> <tack-id> <text>` — When invoked, the CLI
shall add a pre-work todo item to the specified tack with `done: false`.

**[CLI-10]** `tack after <slug> <tack-id> <text>` — When invoked, the CLI
shall add a post-work todo item to the specified tack with `done: false`.

**[CLI-11]** `tack todo done <slug> <tack-id> <todo-id>` — When invoked, the
CLI shall mark the specified todo item as `done: true` and set `done_at` to
the current date per [TODO-04].

**[CLI-12]** `tack todo rm <slug> <tack-id> <todo-id>` — When invoked, the CLI
shall delete the specified todo item from its array.

**[CLI-13]** `tack link add <slug> <tack-id> <label> <url>` — When invoked,
the CLI shall add a link to the specified tack's `links` array. The URL
is always recorded as a link, even when it matches a PR/MR pattern (the
recognized forges are defined in [CLI-37]);
setting a deliverable is the separate, explicit operation of
`tack deliverable` ([CLI-08]). If the URL already exists on the tack (as
the `deliverable` URL or in `links`), the CLI shall not add a duplicate.

**[CLI-14]** `tack list` — When invoked, the CLI shall list all route files in
`~/.tack/routes/` with their slug, number of tacks, and number of open tacks.
Each entry shall also carry the route's `title` ([ROUTE-04]) when one is set, so
the listing names the route as well as addressing it. The `--json` form
([CLI-18]) serializes the full route, so it carries `title` alongside every
other field.

**[CLI-15]** `tack rm <slug> [--force]` — When invoked, the CLI shall delete
the route file at `~/.tack/routes/<slug>.yaml`. The CLI shall require
`--force` to confirm deletion; without it, the CLI shall write the confirmation
message to **stderr** (consistent with [CLI-41]) and exit **non-zero** without
deleting. Nothing is written to stdout, so a caller redirecting it receives no
output — which matches the outcome, since no route was deleted.

**[CLI-16]** When any write command succeeds, the CLI shall display the updated
state of the affected tack or route.

**[CLI-17]** `tack session <slug> <session-id> [--tack <tack-id>]` — When
invoked, the CLI shall record the session ID in the route's `sessions` array
per [ROUTE-09]. If the session ID already exists, it shall not duplicate. When
`--tack <tack-id>` is passed, the CLI shall bind the session to that tack per
[ROUTE-11]: the tack ID is appended to the session entry's `tacks` array (bare
`<N>` is normalized to `t<N>` per [TACK-08]). A tack already present in the
array is moved to the end rather than duplicated, so the last entry is always
the session's current focus and a pivot back to an earlier tack makes it
current again. The CLI shall fail if `<tack-id>` does not exist in the route.

**[CLI-18]** `tack list [--json]` and `tack status [slug] [--json]` — When
`--json` is passed, the CLI shall output the result as JSON instead of the
default text format.

**[CLI-19]** `tack completions <shell>` — When invoked, the CLI shall install
shell tab completions. Supported shells: `zsh`.

**[CLI-19a]** `tack install-cli [--dir <path>]` — In addition to dropping the
`tack` wrapper on PATH, the CLI shall install the zsh completion script (the
same artifact `tack completions zsh` produces). A single invocation
provisions both PATH access and tab completion.

**[CLI-20]** When tab completing tack IDs, the shell shall display each tack's
summary as a completion description alongside the ID.

**[CLI-21]** `tack tree [path] [-d <depth>]` — When invoked without a path, the
CLI shall display all routes as a navigable tree.

**[CLI-21a]** The `path` argument uses `/`-separated segments supporting three
levels:
- `<slug>` — display that route's tacks
- `<slug>/<tack-id>` — display that tack's details
- `<slug>/<tack-id>/<aspect>` — display only that aspect (`deliverable`,
  `before`, `after`, `links`, `depends_on`)

**[CLI-21b]** Path segments may contain glob wildcards (`*`, `?`, `**`) which
match against values at that level. `*` matches within a single segment, `**`
matches across segment boundaries (e.g., `**/deliverable` finds deliverables at
any depth, `ai-sdlc/**` shows everything under a route). Glob paths must be
quoted to prevent shell expansion.

**[CLI-21c]** The `-d`/`--depth` option controls expansion: depth 1 = routes
only, depth 2 = routes + tacks, depth 3 = routes + tacks + details. Default
depth is 1 when no path is given, 2 when a route path is given.

**[CLI-21d]** Tab completion for the `path` argument shall resolve each level
progressively with `/` suffixes, allowing filesystem-style drill-down without
retyping.

**[CLI-22]** `tack recent [--count <n>] [--since <date>]` — When invoked, the
CLI shall list routes sorted by `updated_at` descending, showing each route's
slug, last-updated time, and a summary of open tacks. The `--count` option
limits the number of results (default: 10). The `--since` option filters to
routes with `updated_at` on or after the given ISO 8601 date (e.g.,
`2026-04-01`).

**[CLI-24]** When displaying individual tack state in text output, the CLI shall
prefix the tack ID with a bracketed status icon: `[ ]` pending, `[>]`
in_progress, `[x]` done, `[!]` blocked, `[-]` dropped. Todo items shall use
`[x]` for done and `[ ]` for not done.

**[CLI-23]** `tack find --url <url> [--json]` — When invoked with `--url`, the
CLI shall search all routes for tacks whose deliverable URL or link URLs match
the given URL, and display each match as a tree: route slug, tack summary, and
the matching deliverable or link. Matching is exact, except that a GitLab
`/-/work_items/<n>` URL and the `/-/issues/<n>` URL for the same project and
number shall match each other ([CLI-37]) — one issue, two paths. Canonicalization
applies to the comparison only; URLs are stored as given. When `--json` is
passed, the CLI shall output the results as JSON. If no matches are found, the
CLI shall report that no tacks reference the given URL.

**[CLI-23a]** `tack find --path [<dir>] [--json]` — When invoked with `--path`,
the CLI shall resolve the given directory (default the current working
directory) to a repo key by reading its `origin` remote and normalizing it per
the repo database rules, then search all routes for tacks whose deliverable or
link URL belongs to that repo key using the forge-URL recognition rules in
[CLI-37]. Matches shall be displayed and, with `--json`, emitted in the same
form as [CLI-23]. When the directory is not a git repository with an `origin`
remote, `--json` shall emit an empty array and the human form shall report that
no repo was found; when the repo is recognized but no tack references it, the
CLI shall report that no tacks reference that repo. The command shall exit zero
in all of these cases (a lookup with no result is not an error).

**[CLI-23b]** `tack find` shall require exactly one of `--url` ([CLI-23]) or
`--path` ([CLI-23a]) as its selector; invoking it with neither or with both
shall fail with an error naming the two selectors.

**[CLI-25]** `tack remove <slug> <tack-id> [--force]` — When invoked, the CLI
shall delete the specified tack from the route's `tacks` array. Subsequent tacks
continue the ID sequence per [TACK-05] — `t<N>` is one greater than the highest
*existing* tack number — so removing the highest-numbered tack frees that ID for
the next `tack add` to reuse.
If any other tack's `depends_on` array references the tack being deleted, the
operation shall fail with an error listing the dependents, unless `--force` is
passed. When `--force` is passed, the references to the deleted tack shall be
stripped from all dependent tacks' `depends_on` arrays.

**[CLI-26]** `tack link rm <slug> <tack-id> <url>` — When invoked, the CLI
shall remove the link with the matching URL from the specified tack's
`links` array. If no link with that URL exists, the CLI shall fail with
an error.

**[CLI-27]** `tack edit <slug> <tack-id> <summary>` — When invoked, the CLI
shall update the specified tack's `summary` field in place and refresh
`updated_at`.

**[CLI-28]** `tack merge <slug> <source-id> <target-id>` — When invoked, the
CLI shall merge the source tack into the target: todos (`before`/`after`)
and `links` are appended to the target (with new sequential todo IDs); if
the source has a `deliverable` and the target does not, the deliverable is
moved to the target; if both tacks have a deliverable, the target's
deliverable is kept and the source's is discarded. The source tack is then
removed from the route's `tacks` array, leaving a single surviving tack.
Subsequent tacks continue the ID sequence per [TACK-05], consistent with
`tack remove` ([CLI-25]) — the freed source ID is reusable if it was the
highest-numbered.

> Note: callers wanting to preserve a source deliverable when both tacks
> have one should record it as a link on the target before merging.

**[CLI-29]** `tack --version` / `tack -v` — When invoked, the CLI shall print
the `version` field of `.claude-plugin/plugin.json` (resolved from the
plugin root) and exit zero.

**[CLI-30]** `tack pin <slug>` — When invoked, the CLI shall record the given
slug as the active route for the current working directory in
`~/.tack/pins.yaml` per [STORE-06]. The CLI shall fail if no route file exists
for the given slug. When invoked without arguments (`tack pin`), the CLI
shall display the current cwd's pin and exit zero if one exists, or report
that no pin is set and exit non-zero.

**[CLI-31]** `tack unpin` — When invoked, the CLI shall remove the current
working directory's entry from `~/.tack/pins.yaml` if one exists. The
command shall succeed silently if no pin is set; absence of a pin is not an
error.

**[CLI-32]** `tack depends add <slug> <tack-id> <dep-id>` — When invoked, the
CLI shall append `<dep-id>` to the specified tack's `depends_on` array. If
the dependency already exists, the operation shall be a no-op (idempotent).
The CLI shall reject self-dependencies and shall reject additions that would
introduce a circular dependency, consistent with [TACK-07].

**[CLI-33]** `tack depends rm <slug> <tack-id> <dep-id>` — When invoked, the
CLI shall remove `<dep-id>` from the specified tack's `depends_on` array. If
the array becomes empty, the field shall be omitted from the YAML. If
`<dep-id>` is not present, the CLI shall fail with an error.

**[CLI-34]** `tack status set <slug> <tack-id> <status>` — When invoked, the
CLI shall set the specified tack's `status` field to the given value
(`pending`, `in_progress`, `done`, `blocked`, or `dropped`) without enforcing
[DEP-03] dependency guards. When the new status is `done` and `done_at` is
not already set, the CLI shall stamp `done_at` per [TACK-03]. This command is
the supported escape hatch for representing states the guarded commands
([CLI-05], [CLI-06], [CLI-07]) refuse to produce (e.g., reverting a `done` tack
to `pending`, or putting a tack into `blocked`).

**[CLI-35]** `tack rename <old-slug> <new-slug>` — When invoked, the CLI
shall rename the route file from `<old-slug>.yaml` to `<new-slug>.yaml` and
update the `slug` field inside the file. The route's `id` ([ROUTE-08]) shall
be preserved. The CLI shall fail if `<new-slug>` already exists as a route,
if `<old-slug>` does not exist, or if any other route's `depends_on`
references `<old-slug>` (per [DEP-01]).

**[CLI-36]** `tack move <src-slug>/<tack-id> <dst-slug> [--include-dependents]`
— When invoked, the CLI shall remove the specified tack from the source
route's `tacks` array and append it to the destination route's `tacks` array.

**[CLI-36a]** The moved tack shall receive a new sequential ID per [TACK-05] (the
ID continues from the destination's existing maximum; the source-route ID it
vacates follows the same [TACK-05] sequencing as `tack remove` ([CLI-25]) — it
is reusable if it was the highest-numbered). All tack metadata — `summary`,
`status`, `done_at`, `deliverable`, `links`, `before`, `after` — shall be
preserved verbatim.

**[CLI-36b]** Because tack IDs are route-local per [TACK-05], `depends_on`
references cannot cross route boundaries. The CLI shall refuse the move if the
tack being moved has any incoming or outgoing `depends_on` edge that would
cross the boundary (a moving tack depending on a staying tack, or a staying
tack depending on a moving tack), and shall display each offending edge in the
error so the user can resolve it with [CLI-33] (`tack depends rm`) or by
including the dependent chain.

**[CLI-36c]** When `--include-dependents` is passed, the move set is expanded to
the transitive closure of tacks that depend on the source tack within the
source route. Their `depends_on` arrays are rewritten to reference the new IDs
assigned in the destination. The cross-boundary refusal of [CLI-36b] still
applies — if any staying tack depends on a moving tack, the move shall fail.

**[CLI-36d]** The CLI shall fail if `<src-slug>` and `<dst-slug>` are the same
route, if either route does not exist, or if `<tack-id>` does not exist in the
source route.

**[CLI-37]** The PR/MR/issue URL recognition used for deliverable
auto-derivation and label extraction ([CLI-04], [CLI-08], [CLI-13]) shall support
two forges: GitHub (`https://github.com/<owner>/<repo>/pull/<n>` and
`/issues/<n>`) and GitLab (`https://gitlab.<host>/<group>/<repo>/-/merge_requests/<n>`,
`/-/issues/<n>`, and `/-/work_items/<n>`). The derived label is `<repo>#<n>` for
a PR or issue and `<repo>!<n>` for an MR. GitLab serves one issue from both
`/-/issues/<n>` and `/-/work_items/<n>`; the CLI shall recognize both and derive
the same label and `issue` kind from each. URLs from other forges are recorded
verbatim as links or labels but are not classified as PR/MR/issue. The hook
scanners ([HOOK-02], [HOOK-03]) recognize the same two forges.

**[CLI-37b]** GitLab epic (`https://gitlab.<host>/groups/<group>/-/epics/<n>`)
and milestone (`/-/milestones/<n>`) URLs shall additionally be recognized for
label derivation ([CLI-04], [CLI-08]), producing `<group>&<n>` and `<repo>%<n>`
respectively — GitLab's own reference syntax. Neither is a change request: they
shall not be promoted to a deliverable on `tack done` ([CLI-05]). Both shall be
surfaced by the hook scanners ([HOOK-02], [HOOK-03]), which nudge the agent to
record them as links ([AGT-06]). Neither shall contribute an entry to the repo
database ([REPO-06]): both can be group-scoped, where the path carries a group
rather than a repo.

**[CLI-37a]** Commit URLs — `https://github.com/<owner>/<repo>/commit/<sha>` and
`https://gitlab.<host>/<group>/<repo>/-/commit/<sha>` — are additionally
recognized for label derivation ([CLI-04], [CLI-08]), producing a
`<repo>@<sha7>` label from the first seven characters of the sha. A commit is
not a PR/MR/issue: it is not promoted to a deliverable on `tack done` ([CLI-05])
and is not surfaced by the hook scanners ([HOOK-02], [HOOK-03]).

**[CLI-38]** `tack --help` / `tack -h` / `tack help` — When invoked, the CLI
shall print the usage text to stdout and exit zero. The `--help` / `-h` flag
shall be honored after any subcommand as well (e.g. `tack session --help`,
`tack pins --help`): the CLI shall print the usage text to stdout and exit
zero rather than treating the flag as a subcommand argument — which would
otherwise throw on subcommands parsed strictly, or be silently ignored by
subcommands that parse flags manually. When invoked with no arguments or with
an unrecognized command, the CLI shall print the same usage text to stderr
and exit non-zero; the unrecognized-command case shall name the offending
command.

**[CLI-39]** `tack pins [--json]` — When invoked, the CLI shall list every pin
in `~/.tack/pins.yaml` ([STORE-06]) with its directory, slug, and `pinned_at`
timestamp, flagging entries whose route no longer exists (dangling) and
entries whose route has no open tacks (idle). With `--json`, the CLI shall
emit the structured pin list including the computed flags. The command shall
exit zero even when the list is empty.

**[CLI-40]** `tack pins prune` — When invoked, the CLI shall remove every pin
whose route no longer exists and every pin whose directory no longer exists
on disk, displaying each removed entry and the reason (dangling route /
missing directory). Pins to existing routes with no open tacks shall be
kept — idle is informational ([CLI-39]); they are removed only by explicit
`tack unpin` ([CLI-31]).

**[CLI-41]** Subcommand-group verbs (`tack status set`, `tack todo`, `tack
link`, `tack depends`) invoked without a valid subcommand shall print a
group-scoped error to stderr that names the offending input and the accepted
subcommands (e.g. `tack link: expected 'add' or 'rm' (got 'my-slug')`), then
exit non-zero — rather than dumping the global usage text. This keeps the
failure visible to scripted callers that quiet or capture one stream;
contrast the global-usage fallback of [CLI-38] for top-level errors.

**[CLI-42]** `tack repo <partial> [--json]` — When invoked, the CLI shall match
`<partial>` case-insensitively against every repo's `names` in
`~/.tack/repos.yaml` ([REPO-01]) and report each matched repo's remote as an
HTTPS URL (`https://<key>`). With exactly one match, the CLI shall print the
URL; with several, it shall list them; with none, it shall exit non-zero with a
not-found message. With `--json`, the CLI shall emit the structured match list.

**[CLI-43]** `tack repo [--json]` (no positional argument) — When invoked, the
CLI shall list every repo in the database with its `names` and existing
`locals`. With `--json`, the CLI shall emit the structured repo list. The
command shall exit zero even when the database is empty.

**[CLI-44]** `tack repo alias <match> <alias>` — When invoked, the CLI shall add
`<alias>` to the matched repo's `names`. If `<match>` resolves to more than one
repo, the CLI shall fail and list the candidates.

**[CLI-45]** `tack repo prune` — When invoked, the CLI shall remove from every
repo's `locals` any path that no longer exists on disk, displaying each removed
path. It shall not remove repo entries themselves; a repo with no locals (e.g.
one captured from a URL but never cloned) is retained.

**[CLI-46]** `tack repo rm <match>` — When invoked, the CLI shall remove the
matched repo entry. If `<match>` resolves to more than one repo, the CLI shall
fail and list the candidates.

**[CLI-47]** `tack repo rebuild` — When invoked, the CLI shall reconstruct the
repo database from existing tack data: every deliverable and link URL across all
routes that parses as a forge change reference ([REPO-06]), and every existing
pinned directory's `origin` remote ([REPO-07]). The rebuild is additive — it adds
names and locals but removes nothing, so custom aliases ([CLI-44]) survive a
re-run. It backfills the database for routes recorded before capture existed.

**[CLI-48]** Duplicate-URL warning — When a URL is attached as a deliverable
(`tack add --deliverable`, `tack deliverable`) or a link (`tack link add`),
the CLI shall check whether the same URL already appears as a deliverable or
link on any other tack (the same match rule as `tack find`, [CLI-23], so the two
GitLab issue paths warn against each other), and
if so shall print a warning to stderr that names the existing route(s) and tack
id(s) with a `warning: url already on ` prefix. The tack being mutated is
excluded, so re-attaching a URL already present on that same tack does not
warn. The warning is informational: the attach still completes and the command
exits zero.

**[CLI-49]** Export — `tack export [--out-file <path>] [--compress]` shall
serialize the entire local store (all routes, the repo database, and pins) as a
single JSON document carrying a top-level `schemaVersion` (currently `1`), an
`exportedAt` ISO timestamp, and a `generator` string. It shall write the archive
uncompressed to stdout by default; `--out-file` shall redirect it to a file
(emitting the summary line to stderr) and `--compress` shall gzip the output.

**[CLI-50]** Import — `tack import <file> [--merge|--replace] [--dry-run]` shall
read an archive produced by [CLI-49] — gzip-compressed or plain JSON, detected by
content — and refuse one whose `schemaVersion` exceeds the running tack's. `--replace` (full restore) shall overwrite each
route in the archive verbatim and replace the repo database and pins wholesale.
`--merge` (the default, for combining machines) shall: create routes absent
locally; for a route that exists on both, append only tacks whose identity
(deliverable URL, else summary + `done_at`) is not already present, assigning
fresh ids and remapping `depends_on` edges to those ids; union repo *names*
while ignoring machine-specific repo `locals`; and skip pins. It shall report
every `old id → new id` reassignment. `--dry-run` shall report the outcome
without writing.

**[CLI-51]** `tack group <slug> [<group>] [--clear]` — When invoked with a
`<group>` argument, the CLI shall set the route's `group` field ([ROUTE-04]) to
that slug; the value is checked against the slug pattern at the command
boundary per [STORE-08].
When `--clear` is passed, the CLI shall remove the `group` field. When invoked
with neither, the CLI shall report the route's current group — printing it and
exiting zero if a group is set, or reporting that none is set and exiting
non-zero, mirroring `tack pin` ([CLI-30]).

**[CLI-52]** `tack merge-routes <new-slug> <src-slug>... [--group <slug>] [--created-at <date>] [--break-deps]`
— When invoked, the CLI shall create a new route `<new-slug>`, move every tack
from every `<src-slug>` into it, and delete the emptied source route files. The
CLI shall fail if `<new-slug>` already exists, if it names a source route, if
any `<src-slug>` is repeated or does not exist, or if no source is given.

**[CLI-52a]** Destination tack IDs shall be assigned in chronological order — by
each tack's `done_at`, falling back to its source route's `created_at` for tacks
without one, then the source route's `created_at` and original numeric ID as
tiebreakers — following [TACK-05] sequencing over the combined set. All tack
metadata — `summary`, `status`, `done_at`, `deliverable`, `links`, `before`,
`after` — and route-local `depends_on` (remapped to the new IDs) shall be
preserved.

**[CLI-52b]** Session records ([ROUTE-09]) from every source shall carry over to
the new route with their tack references remapped to the new IDs; a session
recorded on more than one source shall be unified into a single entry taking the
earliest `started_at`. A session tack reference with no surviving tack (which
`tack remove` ([CLI-25]) can leave behind, since it does not prune session refs)
shall be dropped rather than fail the merge.

**[CLI-52c]** The new route's `created_at` shall default to the earliest source
route's `created_at`, or the `--created-at <date>` value when given. The new
route's group shall be the `--group <slug>` value, or the first source route's
group otherwise. The `title` ([ROUTE-04]) shall be the first source route's title.
Every source `description` shall carry over, joined in source order by a
markdown horizontal rule, since the merge deletes the source files and a body
left behind would be unrecoverable.

**[CLI-52d]** When a route outside the merge set has a route-level `depends_on`
([DEP-01]) referencing a source route, the CLI shall refuse the merge to avoid
dangling the reference, unless `--break-deps` is passed, which repoints those
references at `<new-slug>`.

**[CLI-53]** `tack title <slug> [<text>] [--clear]` — When invoked with a
`<text>` argument, the CLI shall set the route's `title` field ([ROUTE-04]) to
that text. When `--clear` is passed, the CLI shall remove the field. When
invoked with neither, the CLI shall report the route's current title — printing
it and exiting zero if one is set, or reporting that none is set and exiting
non-zero, mirroring `tack group` ([CLI-51]).

**[CLI-54]** `tack describe <slug> [<text>] [--file <path>] [--clear]` — When
invoked, the CLI shall set, clear, or report the route's `description` field
([ROUTE-04]) following the same three-way shape as [CLI-53].

**[CLI-54a]** A description is markdown and therefore multi-line, so the CLI
shall accept the body from a file with `--file <path>`, or from standard input
with `--file -`, in addition to an inline `<text>` argument. Passing both
`<text>` and `--file` shall fail rather than pick a winner. The body shall be
stored verbatim except for trailing newlines, which shall be stripped so a piped
file and an equivalent inline argument produce the same stored value. A body that
is empty once stripped shall fail rather than store an empty description, since
that reads as a truncated pipe and `--clear` already removes the field.

**[CLI-55]** Failures not reported at the call site — a route or tack that does
not exist, a schema rule the write would break, an unrecognized flag — shall
reach the caller as a single `tack: <message>` line on stderr with a non-zero
exit, not as an interpreter stack trace. A failure raised while parsing
arguments shall additionally point at `tack --help` ([CLI-38]). Setting the
`TACK_DEBUG` environment variable shall restore the stack, which a message
cannot substitute for when the throw is a defect rather than a refusal.

**[CLI-56]** `tack reconcile [slug] [--dry-run]` — When invoked, the CLI shall
ask the git forge (GitHub, GitLab) whether each candidate tack's deliverable
has merged and set the
merged ones to `done` ([CLI-05]), reporting each one it closed. A candidate is
an open tack whose deliverable URL is a pull or merge request ([CLI-37]); a tack
with no deliverable, or one pointing at an issue, epic, milestone, or commit, is
never queried, since none of those merge. Without a slug the sweep covers every
route. `--dry-run` reports the same set without writing.

**[CLI-56a]** The `done_at` recorded shall be the merge timestamp the forge
reports, not the time of the sweep — reconcile is a catch-up, so stamping the
present would date the work to whenever someone remembered to run it.

**[CLI-56b]** `tack reconcile` is the only command that requires network
access, and it shall reach the forge through the forge's own CLI (`gh`, `glab`)
rather than a built-in HTTP client, so it inherits the caller's existing
authentication and never handles a credential. A missing forge CLI, an
unreadable change request, or a URL from a forge it has no reader for shall fail
the command naming the URL ([CLI-55]) rather than being passed over — a silently
skipped tack is indistinguishable from one that hasn't merged.

---

### AGT — Agent Integration

The CLI encapsulates schema operations; the skill encapsulates reasoning.
Inference (what's active, which route to attach to, when to prompt) lives in
the skill and uses CLI primitives. Hooks emit reminders (see HK); the skill
acts on them.

**[AGT-01]** The agent shall be implemented as a Claude Code skill that reads
and writes tack route files using the CLI defined in the CLI category.

**[AGT-02]** When a session begins, the plugin's skill shall load all active
routes (routes with at least one tack whose status is not `done` or `dropped`)
to build context about current work.

**[AGT-03]** The agent shall maintain the answer to "what am I working on?"
for the current working directory by running the following resolution
procedure in order, stopping at the first confident match:

1. **Pin** — Run `tack pin` (no slug) to read the cwd's pin per [STORE-06]. If
   present and the referenced route exists with at least one open tack, the
   pinned route is active.
2. **URL match** — When a PR/MR/issue URL is in scope (recently emitted by
   a tool, pasted by the user, or passed as a hint), run `tack find --url
   <url> --json` and use the matched route if exactly one is returned. The matched
   tack is also the session's tack per [AGT-11] — bind it via [AGT-09].
3. **Branch slug** — When the cwd is a git repository, run `tack list
   --json` and use the route whose slug equals the current branch name if
   it has at least one open tack.
4. **Single open route** — If exactly one route has an open tack, use it.
5. **Ambiguous or unknown** — Prompt the user via `AskUserQuestion` with
   candidates: in-progress routes, recently-updated routes (via `tack
   recent --json`), or a "start a new route" option. On the user's pick,
   record the answer with `tack pin <slug>` per [AGT-10].

**[AGT-04]** When the user confirms a new route during resolution per [AGT-03],
the agent shall run `tack init <slug>` and add the first tack with `tack add`.

**[AGT-05]** When a hook emits a deliverable reminder per [HOOK-02], or a PR/MR
URL otherwise appears in the session, the agent shall record the URL on the
active route's current tack via `tack deliverable <slug> <tack-id> <label>
<url>` without prompting the user. If no active tack exists, the agent shall
add one with `tack add` and then record the deliverable.

**[AGT-06]** When a hook emits a link reminder per [HOOK-02], or a non-PR/MR
URL is referenced in the session, the agent shall capture it via `tack link
add <slug> <tack-id> <label> <url>` on the active tack. URLs already recorded
as a deliverable per [AGT-05] shall not be duplicated; the CLI enforces this
per [CLI-13].

**[AGT-07]** The agent shall not prompt the user more than once per distinct
event. If the user ignores or dismisses a prompt, the agent shall not re-ask
about the same work item in the same session.

**[AGT-08]** When the user completes a tack, the agent shall surface any
pending `after` todo items per [TACK-04] before moving on.

**[AGT-09]** When the agent begins operating on a route, it shall record the
current Claude Code session ID in the route's `sessions` array per [ROUTE-09].
If the session ID already exists, it shall not duplicate. When the agent has
resolved which tack the session is working — a tack matched per [AGT-11], the
single open tack, or one the agent created for this session — it shall pass
`--tack <tack-id>` to bind the session to that tack per [ROUTE-11], and re-bind
when the session's focus shifts to a different tack.

**[AGT-11]** The agent shall establish the session→tack link as early as it
confidently can, so a fleet view can distinguish *existing* work (a session
resumed on tracked work) from *emerging* work (a session that spun up a new
tack). When a PR/MR/issue/tracker URL is in scope at session start (pasted by
the user, passed as a hint, or emitted by a tool per [HOOK-02]/[HOOK-03]), the
agent shall run `tack find --url <url> --json` per [CLI-23]:
- **Match** — exactly one tack references the URL: the session is resuming
  existing work. The agent shall bind the session to that tack per [AGT-09].
- **No match** — the work is emerging. The agent shall create a tack per
  [AGT-04]/[AGT-05] (recording the URL as its deliverable or link) and bind the
  session to the new tack.

The existing-vs-emerging distinction is not stored as a flag; a consumer
derives it from the bound tack's own state — a tack carrying a deliverable or
a PR/MR/issue link ([CLI-37]) is tracked/existing, one with neither is
emerging.

**[AGT-10]** When the agent resolves an active route via [AGT-03] in a way
that is not already pinned (URL match, branch slug, single-open-route, or
user pick), the agent shall pin the result with `tack pin <slug>` so future
resolutions are immediate. The agent shall not pin speculatively — only
after a confident match or user confirmation. The agent shall `tack unpin`
when the user explicitly switches focus or when the pinned route's last open
tack transitions to `done` or `dropped`.

---

### HOOK — Hooks

Hooks are scaffolding around the agent. They surface signals the agent might
otherwise miss (URLs in tool output, URLs in user prompts, version drift),
and they emit reminder text the agent reads as additional context. Hooks
never write to route files directly; the skill performs all writes via the
CLI per [AGT-05] and [AGT-06].

**[HOOK-01]** A `SessionStart` hook shall compare the installed CLI wrapper's
version to the plugin's `version` per [CLI-29]. When they differ, the hook
shall emit a one-line note suggesting `tack install-cli`. The hook shall
silently no-op when `tack` is not on `PATH` and shall never block session
start.

**[HOOK-02]** A `PostToolUse` hook scoped to the `Bash` tool shall scan tool
output for PR/MR and issue URLs (the recognized forges are defined in
[CLI-37]). For each match, the hook shall first check whether a tack already
tracks the URL by running `tack find --url <url>` ([CLI-23]); a URL already mapped
emits no reminder, so the hooks stop nagging about work that is already
recorded. Only an untracked URL shall emit reminder text, instructing the
agent to ensure a route/tack mapping exists via the tack skill per [AGT-05] or
[AGT-06] depending on URL type. When `tack` is not on `PATH` the tracked-check
cannot run, so the hook shall emit the reminder unconditionally.

**[HOOK-03]** A `UserPromptSubmit` hook shall scan the user's prompt for
PR/MR and issue URLs ([CLI-37]) and emit the same kind of reminder as
[HOOK-02], with the same already-tracked gating. The
hook is responsible for noticing URLs the user pastes inline rather than
through a Bash tool call.

**[HOOK-04]** The `UserPromptSubmit` hook shall also, once per session, resolve
the route for the current cwd by running [AGT-03] step 1 (pin for cwd, via
`tack pin`) and step 3 (branch-slug route) — existence-only, without verifying
the route's open-tack state and without prompting the user. When a route
resolves, the hook shall record the current session on it per [ROUTE-09]
(route-level, no tack binding), so session→route attribution does not depend on
the agent remembering to run `tack session`. When neither resolves, the hook
shall emit a one-line nudge suggesting the user invoke the tack skill to
identify or create a route. The hook shall debounce so this fires at most once
per session.

**[HOOK-05]** Hook reminders are advisory: the *judgment-laden* writes — which
slug and tack a URL maps to — shall be made by the agent via the tack skill,
not by the hook, so that context the hook cannot see is applied and those
schema writes go through one path. The hook may perform deterministic reads
(the `tack find` tracked-check per [HOOK-02]) and the route-level session record
per [HOOK-04], which need no such judgment.

---

### REPO — Repo Database

The repo database is a standalone index that maps the names a git repository is
known by to its remote, accumulated as tack observes work. It answers "what is
the remote for the repo I call `<name>`?" independently of any route. "Repo"
here means a git repository identified by its remote — a forge-neutral term
(GitHub's "repository"/"Projects" and GitLab's "project"/"repository" each carry
platform-specific meaning) and distinct from the project-management sense ruled
out in the Anti-Requirements.

**[REPO-01]** The repo database shall be stored as a single YAML file at
`~/.tack/repos.yaml`, a map keyed by each repo's normalized remote.

**[REPO-02]** A repo key shall be its git remote normalized to scheme-less
`host/path` form: the URL scheme and any `git@host:` or `ssh://` prefix removed,
the host and path joined with `/`, and a trailing `.git` stripped — so the HTTPS
and SSH forms of one remote resolve to a single entry (e.g.
`github.com/chris-peterson/anchor`).

**[REPO-03]** Each repo entry shall contain the following fields:
- `names` (array of strings, required) — the names the repo is known by: the
  auto-derived repo name (the last path segment of the key) plus any custom
  aliases. Lookup matches `<partial>` against this list.
- `locals` (array of strings, optional) — absolute paths of known local
  checkouts or worktrees of the repo.

**[REPO-04]** The `~/.tack/repos.yaml` file and the `~/.tack/` directory shall be
created automatically on first write if they do not exist.

**[REPO-05]** The repo database is internal derived state, like pins ([STORE-06]):
tack is its sole writer, so — unlike the route schema, which is the product —
it is not governed by a published JSON Schema. A missing file shall be treated
as an empty database.

**[REPO-06]** When the CLI records a deliverable or link URL that parses as a
forge change reference ([CLI-37]), it shall upsert a repo keyed by the URL's
normalized remote ([REPO-02]) and add the derived repo name to `names` if absent.
Capture is best-effort: a failure to update the repo database shall not fail
the command that triggered it.

**[REPO-07]** When `tack init` or `tack pin` runs inside a git working directory,
the CLI shall read that directory's `origin` remote (a read-only git query)
and, when one is present, upsert the corresponding repo ([REPO-02]) and add the
absolute working-directory path to `locals` if absent. When no `origin` remote
is present, the CLI shall record nothing and shall not error.

---

### SERVE — Document Server

`tack status` prints a route into a terminal that can render a clickable link,
and beacon already joins a slice of tack into its fleet view with nowhere to
send a reader who wants the whole route. SERVE is that destination: a read-only
projection of the same files the CLI reads, on the same machine.

**[SERVE-01]** `tack serve [--port <n>]` shall run an HTTP server bound to
`127.0.0.1` on a default port of 8788, in the foreground until interrupted. The
bind address is not configurable: these documents are one process reading
another user's private work-tracking files away from being a disclosure, and a
`--host` flag is the shape that mistake takes.

**[SERVE-02]** The server shall render three documents: an index of every route
at `/`, one route at `/route/<slug>`, and every route of a group at
`/group/<slug>`. A tack shall be an anchor within its route document
(`/route/<slug>#<tack-id>`) rather than a document of its own, so following a
link to a tack lands in the context of its route.

**[SERVE-03]** The server shall hold no state of its own: every request re-reads
`~/.tack/routes/` ([STORE-01]) so a document and the CLI cannot disagree. An
edit to a route file shall be visible on the next request without a restart.

**[SERVE-04]** A request for a slug or group that does not exist shall return
404 with a message naming it, never an empty document. A route file that fails
validation shall return 500 reporting the failure ([STORE-09]) — the documents
inherit the CLI's refusal to render work it could not read.

**[SERVE-11]** Each path in [SERVE-02] shall serve two representations of the
same thing, chosen by the request's `Accept` header: the HTML document, and
JSON in the shape the CLI's own `--json` emits ([CLI-14]), including the
derived `state` ([ROUTE-13]). HTML shall be the default, so a request carrying
no preference or only `*/*` gets the document; quality values decide when both
are named. Error responses shall follow the same negotiation, so a client
asking for JSON is never handed an HTML error page to parse.

A second URL tree for the machine-readable form would make one route
addressable two ways, and the spelling that ends up in a consumer's config is
then not necessarily the one that stays maintained.

**[SERVE-05]** Every request shall be refused unless its `Host` header names
loopback: a hostname that resolves to `127.0.0.1` is otherwise enough for a
page in the user's browser to reach these documents. The server shall accept
`GET` everywhere and `POST` only at the edit path ([SERVE-12]); any other
method is refused.

**[SERVE-12]** `POST /route/<slug>/edit` shall set or clear a route's `title`
and `description` ([ROUTE-04]) from a form body, through the same write path
the CLI uses ([CLI-53], [CLI-54]) so the page cannot record what the CLI would
refuse. A field absent from the body is left unchanged; a field present and
empty is cleared, matching `--clear` — a reader who empties the box means the
field has no value, and a separate control for that is a control nobody finds.
The response is a 303 back to the document, so reloading the result is a `GET`
rather than a resubmission, or the updated route as JSON when the client
negotiated JSON ([SERVE-11]).

**[SERVE-13]** A write shall additionally be refused when the request carries
an `Origin` that is not loopback. [SERVE-05]'s `Host` check does not cover it:
a cross-site form can `POST` to a loopback server without ever reading the
response, so a write has to prove same-origin, which the `Origin` header is
what browsers attach for. A request with no `Origin` is not a browser
navigation and shall be allowed.

**[SERVE-06]** Every value interpolated into a document comes from a
hand-editable file and shall be HTML-escaped. A URL shall additionally be
rendered as a link only when its scheme is `http` or `https`, since escaping
alone leaves a `javascript:` href live.

**[SERVE-07]** The server shall add no runtime dependency beyond the Node
standard library, and shall inline its own CSS. A document server that needs a
build step is a document server that stops working after an upgrade.

**[SERVE-08]** `tack serve install|uninstall|status [--port <n>]` shall manage
an opt-in supervised server — a launchd user agent on macOS, a systemd user
unit on Linux — that restarts on its own and starts at login. The unit shall
invoke the wrapper installed on `PATH` ([CLI-19a]) rather than a versioned
plugin path, which a plugin upgrade would leave pointing at a directory that no
longer exists. On a platform with neither supervisor, `install` shall print the
manual `tack serve` invocation instead of failing.

**[SERVE-09]** `tack status` shall render the route slug and each tack id as
OSC 8 hyperlinks to the corresponding documents when stdout is a terminal known
to support them, and as unchanged plain text otherwise — including whenever
stdout is not a TTY, so piped and captured output stays clean.
`TACK_HYPERLINKS` shall force the choice either way and `TACK_SERVE_PORT` shall
point the links at a server running on another port.

**[SERVE-10]** The links shall be emitted without checking whether a server is
listening. A liveness probe would cost a round trip on every `tack status` to
pre-answer a question the browser answers when the link is followed; a link to
a server that is down fails at click time, which is the cheaper failure.

---

### COMPAT — Compatibility

The schema is the product ([Overview]), which makes tack's consumers scripts,
agents, and tools that read the YAML or drive the CLI — none of which are in
this repo and none of which can be updated in step with it. This section states
what a `1.x` release lets them build on, and what it does not.

**[COMPAT-01]** The following surfaces are frozen for the `1.x` series and
shall change only additively ([COMPAT-02]):

- the route schema — the field names, types, and value formats given by ROUTE,
  TACK, DEL, TODO, DEP, and LINK, as enforced by `schema/route.schema.json`
  ([STORE-04]);
- where those files live — `~/.tack/routes/<slug>.yaml` ([STORE-01],
  [STORE-03]);
- the CLI grammar — command and subcommand names, flag names, and positional
  argument order, as recorded in `spec/v1/cli-usage.txt` ([COMPAT-05]);
- exit codes — zero on success and non-zero on failure, plus any specific code
  a requirement names;
- the shape of `--json` output wherever a command accepts the flag: key names,
  nesting, and value types.

**[COMPAT-02]** An additive change adds a surface without altering one that
exists: a new optional schema field, a new command or subcommand, a new flag, a
new key in a `--json` object, or a validation rule that accepts input the
previous release refused. Additive changes ship in a minor release, and a
consumer shall tolerate schema fields and `--json` keys it does not recognize.

The CLI is not such a consumer of its own files: `schema/route.schema.json`
closes every object (`additionalProperties: false`), so a route file carrying a
field added by a later `1.x` is refused by an earlier one ([STORE-05]).
Compatibility runs one way — a release reads what its predecessors wrote, not
what its successors will. The export archive behaves the same way, refusing a
`schemaVersion` above the one it knows ([CLI-50]).

**[COMPAT-03]** The following are not frozen and may change in any release:

- human-readable output — the text and layout of every rendering that isn't
  `--json`;
- the wording of errors and warnings. [CLI-55] freezes the `tack:` prefix and
  the non-zero exit; the sentence after the prefix is not part of the contract,
  and neither is any other message's phrasing;
- the on-disk layout of `~/.tack/pins.yaml` ([STORE-06]) and `~/.tack/repos.yaml`
  ([REPO-01]). Both are the CLI's own bookkeeping, reached through the commands
  that own them (`tack pin`, `tack pins`, `tack repo`); neither is governed by a
  published JSON Schema ([REPO-05]), and reading or writing either file directly
  is outside the contract;
- the plugin surface — hook nudge text and the skill's prose ([AGT], [HOOK]).
  It is Claude-Code-specific and reasons rather than stores; the CLI it drives
  is the frozen part.

**[COMPAT-04]** The following require a major release: removing or renaming a
schema field, command, subcommand, or flag; changing the type or meaning of an
existing field; making an optional field required; changing what an exit code
means; removing or renaming a `--json` key; and tightening validation so input
a `1.x` release accepted is refused.

**[COMPAT-05]** `spec/v1/cli-usage.txt` shall hold the grammar frozen by
[COMPAT-01] as `tack --help` emits it ([CLI-38]), and the test suite shall fail
on any difference between the two. Re-recording the snapshot is therefore the
act of declaring a grammar change intended, and the change's kind under
[COMPAT-02] or [COMPAT-04] decides the version bump it needs.

**[COMPAT-06]** A `1.x` release shall read any route file ([COMPAT-01]) and
import any export archive ([CLI-49]) written by an earlier `1.x` release,
without a migration step.

---

## Anti-Requirements

The following are explicitly out of scope:

- **No project management.** No sprints, epics, story points, or velocity.
- **No time tracking.** No start times, durations, or estimates.
- **No git operations.** tack does not create branches, commits, or tags.
- **No enforced workflows.** No prescribed state machines beyond the status
  enum. Users can move between statuses freely (except where dependencies
  constrain transitions per [DEP-03]).
- **No sync, no cloud, no non-loopback bind.** Local files are the only store.
  Two commands are allowed out of that shell and no more: `tack reconcile`
  ([CLI-56]) asks a forge a question the local files cannot answer, and
  `tack serve` ([SERVE-01]) projects those same files to `127.0.0.1` for the
  reader sitting at the machine. Neither ships work anywhere, and both are one
  command wide by design, so nothing else grows a network dependency by
  drifting into it.
- **No cross-route dependency enforcement.** Route-level `depends_on` is
  informational only per [DEP-04].
