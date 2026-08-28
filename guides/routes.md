# Working a tack route

The reasoning behind the `tack` CLI: picking the active route, binding the
session to the tack it's driving, and recording URLs against it. tack's hooks
point here when they spot a PR/MR/issue URL nothing tracks yet, and `/tack:start`
points here for a session that never ran it.

Routine CLI use belongs in the terminal — `tack --help` is the authoritative
command list, and https://chris-peterson.github.io/tack/#/cli renders it in full.

## Resolving the active route

Stop at the first confident match.

1. **Branch slug.** If `git rev-parse --abbrev-ref HEAD` returns a branch name
   and a route exists with that slug, that's the active route. This is the
   binding `/tack:start` sets up, and the most specific one — a branch belongs
   to one piece of work.
2. **Project name.** If the checkout's directory name matches a route slug,
   that's the active route. Plenty of repos carry one long-lived route of the
   same name, which is what makes this the right guess for work sitting on the
   default branch.
3. **URL match.** If there's a PR/MR/issue URL in scope (recently emitted by a
   tool, pasted by the user, given to you as a hint), run `tack find --url
   <url> --json`. If exactly one route matches, that's active — and the matched
   tack is the one this session is driving, so bind it (see "Binding the
   session to a tack").
4. **Repo match.** With no URL in hand, run `tack find --path --json` (it
   resolves the cwd's `origin` remote to a repo and returns the routes whose
   deliverables/links live there). If exactly one route matches, that's active.
5. **Single open route.** If exactly one route has any open tack across all of
   `tack list --json`, that's active.
6. **Ambiguous or unknown.** Ask the user with `AskUserQuestion`. Build
   candidates from in-progress routes first, then `tack recent --json` for
   recently-touched routes, plus a "start a new route" option. When the user
   starts a new route, run `tack init <slug>` and add the first tack with
   `tack add <slug> <summary>`.

Steps 1 and 2 are the two the `session-nudge` hook already ran on this prompt,
and they end the search most of the time: when either matched, the hook named
the route in context and recorded the session on it. The rest are the signals
the hook has no cheap way to see.

A route resolved at step 3, 4, 5, or 6 resolves the same way next time only if
the same signal is still in scope. When the work is going to span sessions, the
durable fix is a branch named for the slug (`/tack:start` cuts one).

## Binding the session to a tack

A session attaches to a *route*, but a route holds many tacks. Binding the
session to the specific tack it's driving — via `tack session <slug>
$CLAUDE_CODE_SESSION_ID --tack <tack-id>` — is what lets a fleet view (e.g.
beacon's `wip`) show *which* tack a live session is on, and tell **existing**
work (a session resumed on a tracked tack) from **emerging** work (a session
that just spun up a new tack).

The hook's bind is route-level only, so the `--tack` half is yours. Establish it
as early as you confidently can. The strongest early signal is a work-tracker
URL the user pastes (or a tool emits) at the start:

1. Run `tack find --url <url> --json`.
2. **One tack matches** → the session is resuming existing work. Bind to that
   tack: `tack session <slug> $CLAUDE_CODE_SESSION_ID --tack <tack-id>`.
3. **No match** → the work is emerging. Create the tack (recording the URL per
   "Recording a URL" below), then bind the session to the new tack.

You don't store "existing" or "emerging" anywhere — it's read off the bound
tack: a tack with a deliverable or a PR/MR/issue link is tracked/existing; one
with neither is emerging.

The bind is idempotent and order-preserving: binding the same tack twice is a
no-op, binding a second tack appends it, and re-binding an earlier tack moves it
back to the end (current focus). The tack must already exist in the route —
`--tack` validates it.

Re-run with `--tack` whenever the session's focus shifts to a different tack;
the last bound tack is the current one.

## Recording a URL

1. **Resolve the active route** if you don't already have one.
2. **Identify the current tack.** If the active route has exactly one
   `in_progress` tack, use it. Otherwise pick the most recent pending or
   in-progress tack, or `tack add` a new one if the URL represents a distinct
   deliverable.
3. **Record the URL.**
   - PR/MR URLs → `tack deliverable <slug> <tack-id> "<url>"` — the label is
     auto-derived (`<repo>#<n>` / `!<n>`, or `<repo>@<sha7>` for a commit URL).
     Add `--label "<text>"` only when you want to override the derived one (e.g.
     an unrecognized forge URL, or you want prose).
   - Other URLs (issues, docs, threads) → `tack link add <slug> <tack-id>
     "<label>" "<url>"`
   - **Epics and milestones are links, never deliverables.** A deliverable is
     the change request a tack produces; an epic or milestone is a container the
     work sits inside, so several tacks can share one and none of them *is* it.
     Labels derive as `<group>&<n>` and `<repo>%<n>`, GitLab's own reference
     syntax.
   - GitLab serves the same issue from `/-/issues/<n>` and `/-/work_items/<n>`.
     Both are recognized and derive the same `<repo>#<n>` label. They are stored
     as written, so recording one form when the other is already attached leaves
     two links pointing at one issue — prefer whichever form the route already
     uses.

   Before calling `tack deliverable`, verify the tack ID with `tack tree <slug>`
   (or read the YAML). `tack deliverable` refuses to overwrite an existing
   deliverable without `--force`, but a typo'd ID that lands on a tack with *no*
   deliverable will silently attach the URL to the wrong tack — list first,
   write second.
4. **Mention what you did in one line.** Don't prompt; just record.

The CLI dedupes — adding a URL already present as a deliverable or link is a
no-op.

## Tack creation discipline

- Most sessions produce a single tack.
- Add a new tack only when a distinct deliverable emerges (separate PR/MR).
- Do not add tacks speculatively for work that hasn't been committed.

If a session produced multiple tacks that turned out to represent the same
deliverable, use `tack merge` to consolidate them before ending.

Do not prompt the user more than once per distinct event. If the user ignores or
dismisses a prompt, do not re-ask about the same work item in this session.

## Completing a tack

When a tack is done, run `tack done <slug> <tack-id>`. If pending `after` todos
exist, surface them before moving on:

> Pending todo items:
>   [ ] Update deployment docs
>   [ ] Notify the team

If the tack has no deliverable but two or more PR/MR links in `links`,
`tack done` completes the status change and prints a `Multiple PR/MR links
present` warning to stderr listing the candidates. Read that warning and either
run `tack deliverable <slug> <tack-id> <url> --label "<text>"` with the user's
chosen URL, or surface the candidates to the user to pick. Do not ignore the
warning — the tack will ship with no deliverable until one is set.

## Backfilling already-merged work

When triaging existing CRs into routes, the work was completed before the
current moment and the date matters for downstream timeline views. Use the
explicit-date forms:

```bash
# Brand-new tack for a CR that already merged
tack add <slug> "<summary>" --done --date <YYYY-MM-DD> \
  --deliverable "<url>"

# Existing tack that should be marked done at a prior date
tack done <slug> <tack-id> --date <YYYY-MM-DD>
```

`--date` accepts either `YYYY-MM-DD` or a full ISO 8601 date-time. Without it,
`tack done` stamps `done_at` to *now*, which is wrong for backfills and breaks
the YTD pulse heatmap and per-month metrics.

The `--deliverable <url>` flag on `tack add` auto-derives a label from the URL.
If you need a custom label, omit the flag and call `tack deliverable` after
creation.

## Moving tacks between routes

When the user reorganizes routes (e.g. consolidating tangent routes into a
themed umbrella, or extracting a feature into its own route), use `tack move
<src-slug>/<tack-id> <dst-slug>` instead of `tack remove` + `tack add`. `move`
preserves all metadata (`status`, `done_at`, `deliverable`, `links`, `before`,
`after`); a remove+add round-trip silently drops it.

`depends_on` references are route-local. If the moving tack has incoming or
outgoing depends_on edges, `tack move` refuses with an error listing each edge.
Resolve by either:

- `tack move <src>/<id> <dst> --include-dependents` to move the whole dependent
  chain together (use this when the closure of dependents belongs in the new
  route too)
- `tack depends rm <slug> <tack-id> <dep-id>` to break the edge first

## Browsing with `tack tree`

```bash
tack tree                          # All routes (depth 1)
tack tree <slug>                   # Tacks in a route (depth 2)
tack tree <slug>/<tack-id>         # Tack details
tack tree <slug>/<tack-id>/<aspect> # One aspect (deliverable, before, after, links, depends_on)
tack tree -d 2                     # All routes expanded with tacks
```

Glob queries (quote to prevent shell expansion) — `*` matches within a segment,
`**` across segments, `?` one character:

```bash
tack tree '**/deliverable'         # All deliverables across all routes
tack tree 'ai-sdlc/**'             # Everything under a route
tack tree '*/t1'                   # Every t1 across all routes
```

Add `--json` to any of these to get the structured data instead of the rendered
tree — full route/tack objects for navigation paths, a flat array of matches for
globs. Parse it with `jq` rather than scraping the text view.

## Unreadable route files

A command that reads the whole store (`list`, `recent`, `tree`, `status`
without a slug, `find`) renders the routes it could read, names any it could not
on stderr, and exits **non-zero**. So a non-zero exit from one of these does not
mean the output is unusable — read it, and treat the named files as work you are
not seeing.

Run `tack doctor` for the full report: each file's path and every rule it
breaks. Repair is a hand edit of the YAML — offer to make it, rather than
telling the user to go read the schema. `tack export` is the exception that
still refuses outright, since a route missing from an archive makes the archive
wrong rather than partial.
