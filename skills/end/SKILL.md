---
name: end
description: "Close a work session: read what actually landed, refuse to close on work that isn't durable yet, record the deliverable on the tack route, hand off the retro, and report the commands still owed rather than sequencing them. Triggers on \"wrap up\", \"all done\", \"close this out\"."
argument-hint: "[repo-name] [abandoned: reason]"
---

# End

Close the session `/tack:start` opened. Read the end state from live signals,
hold the session to a durable artifact, record what landed on the tack route,
hand off the retro, and hand back the list of commands still owed.

**The line this skill does not cross:** it never launches a commit, a review, a
merge, or a release on its own initiative. Timing and sequencing belong to the
user, who can see the same state this skill reports. Naming the next command is
the deliverable; deciding when to run it is not. The one thing it does insist on
is the durability floor in step 2, and there it *asks*.

**Name only commands the session actually has.** The `next` column below is
written against `/anchor:*`, which is where those operations live when anchor is
installed. Read the available-skills listing; with anchor absent, name the raw
`gh`, `glab`, and `git` equivalents instead. A named command that doesn't
resolve is worse than no name.

The same holds for every optional companion this skill reaches for: when one
isn't there, drop the step and **say which step was dropped** in the footer.
Skipping silently is what makes a thinner close look like a complete one.

**One output, at the end.** Steps 1–4 run silently: no per-step narration, no
interim findings, no announcing what is about to run. Step 5's table is the
skill's entire user-facing result, and it has a fixed shape and a fixed budget.

**Skip this when** the session opened no route and produced nothing to record, or
when the user is mid-task and only wants a status read. A session whose work went
nowhere is *not* a skip: it has bookkeeping of its own (step 2).

## 1. Read the end state

Read every signal fresh. The draft flag and the pipeline both flip live, and a
value carried over from earlier in the session is the one most likely to be
wrong.

**Issue these as parallel calls in one message.** Every read is independent, and
running them one per turn is most of what makes this skill slow.

```bash
git status --short
git log --oneline '@{upstream}..HEAD'    # single-quoted: @{…} trips the bash gate bare
gh pr view --json number,isDraft,mergeable,statusCheckRollup,reviewDecision
glab mr view --output json               # GitLab equivalent of the line above
tack status {slug}
```

**A pushed branch with an open draft CR and green checks is a stall, not a
finish.** It is the state a session leaves behind when it runs
`/anchor:prepare-review` and stops. Every visible signal reads as delivered:
commit pushed, description written, checks passing, reviewer-ready. The one bit
that says otherwise is the draft flag, and nothing downstream that tracks
deliverables can see it. Name it in step 5's one sentence when it shows up
(*"the ship stalled at the draft flag"*) — a sentence, not a paragraph.

## 2. Hold the durability floor

A session does not end on work that lives only in the working tree. The floor is
a **durable artifact**, and step 1's read says which level the session reached:

- **Minimum: a commit, pushed.** Off this machine, recoverable by someone else.
- **Usual: a pushed branch with a draft CR.** What makes the work visible to a
  reviewer, to anything reading routes, and to the next session that opens on
  this route.
- **Sometimes: released and verified.** When shipping was the session's point,
  a merged CR with no release behind it is still short of the floor.

Below the floor, **don't close**. Name the level the session is at, name the
commands that reach the next one (step 5 has them), and ask whether to run them
now. Asking is the whole mechanism: sequencing stays the user's, and a session
that ends with its work uncommitted has produced nothing that survives it.

Two states that read as done and are not: a clean `git status` with unpushed
commits, and the draft-flag stall above. Both look finished from inside the
session and leave nothing durable outside it.

### The dead end is a real ending, and it has its own bookkeeping

Some sessions produce nothing worth keeping: the approach was wrong, the premise
dissolved, the work turned out to be already done upstream. That is a legitimate
close, not a floor violation, and `/tack:end <reason>` is how it's declared. What
it must not do is leave the route open and the branch dangling for a fleet view
to report as live work.

Ask for the reason if it wasn't given, then:

- **Drop the tack and record why on the route.** The reason is the whole value of
  a dead end, so it goes somewhere durable rather than dying with the session.

  ```bash
  tack drop {slug} t1
  tack describe {slug} "Abandoned: <reason>. <what the next attempt should know>"
  ```

- **Decide the branch and the tree explicitly, and ask before discarding.** Work
  worth re-reading later still wants a commit on the branch, dead end or not. Work
  that is genuinely garbage can go, but that is the user's call, never an
  assumption.
- **Don't leave a `blocked` tack behind**, unlike the ordinary close: blocked
  means someone is coming back to it.
- **A dead end is often the more retro-worthy session.** The failed approach is
  the finding, and it's the kind that gets rediscovered expensively. Hand step 4
  the retro rather than skipping it because nothing shipped.

## 3. Record what landed on the route

This is the bookkeeping nothing else does, and skipping it is what makes a fleet
view report a session that shipped as a session that stalled.

```bash
tack deliverable {slug} t1 "<merged CR or commit url>"   # label auto-derived
tack done {slug} t1
tack link add {slug} t1 "pipeline #3256652" "https://..."
tack status set {slug} t1 blocked                        # when it's waiting on someone
tack deliverable rm {slug} t1 --to-link                  # demote one recorded too early
```

Match the record to reality rather than to intent:

- **A deliverable is a landed thing.** An open CR is a `link`; a merged CR or a
  pushed commit is the `deliverable`. Recording an open CR as the deliverable
  closes the route while the work is still out for review.
- **Blocked beats done.** When the work waits on a reviewer, an approval gate, or
  another team, `tack status set … blocked` records the reason the route stays
  open. Silence reads as forgotten.
- **A second deliverable earns a second tack**, added now (`tack add`), not
  invented as a subdivision of the first.
- **Repair a record that's already wrong.** The route may already carry a
  deliverable written earlier in the session, when the CR looked finished and
  hadn't been marked draft-ready yet. Step 1's fresh read is what exposes it, and
  the fix is a demotion, not a note: `tack deliverable rm {slug} t1 --to-link`
  keeps the URL as a link and reopens the route. Check the flag's own help before
  reaching for it — `tack rename` takes two *route* slugs, and guessing an
  argument order here renames the route out from under the session.

## 4. Hand off the retro

Hand off to whatever retrospective skill this session has, and let it decide
whether the session earned one. It reads the session's own captured notes
first, so re-deriving that judgment here would duplicate work that already
happens downstream with better material.

- **Prefer a bare skill name over a plugin-namespaced one** (`retro` over
  `logbook:retro`). A bare skill is usually the user's own, fuller retro
  workflow installed locally; a plugin's namespaced skill is the generic
  fallback behind it, not the default to reach for first. Naming a specific
  plugin here would skip that local skill every time both are installed.
- **Don't recap the retro's material.** The worker reads this session's
  transcript, so listing what it has material on is output the user pays for and
  the worker never sees.
- **Don't wait for the document.** A retro that spawns its own session returns
  immediately; this session is closed regardless of what that one produces.
- **The exception is a skill the Skill tool refuses** (`cannot be used with Skill
  tool due to disable-model-invocation`) **and no bare alternative exists.**
  Then the user types it, and the seeds go with the ask so the worker doesn't
  start cold — name the specific moments worth a note, not the topic.

Notes deferred by *earlier* sessions, where the retro tool reports them, are one
`notes` line in step 5's block, not a paragraph of their own.

**Set no session signal here.** The route's state, which step 3 just wrote, is
what a fleet view reads to decide this session is done. Writing a separate status
gives the same field a second source that goes stale the moment the route moves.

## 5. Report what's still owed

Close with one table in `/tack:start`'s shape — the state read in step 1 and the
commands that advance it. This is the skill's whole output:

```text
| change | state | next |
|---|---|---|
| [cleat#3](https://…/pull/3) | draft · checks ✅ test, preview · `2ff4d9e` | `gh pr ready 3` → /code-review → /anchor:merge → /anchor:release |
| [cleat#7](https://…/pull/7) | merged · `a91c204` | — |

**route** cleat t5 open, #3 and the commit as links · **retro** launched in a new tab
**notes** 3 sessions hold deferred notes — `/logbook:retro <id>`
```

- **Emit it as markdown, not inside a fence.** The example above is fenced so
  its source is visible; what reaches the user is a rendered table with working
  links. A fenced copy is the old text block with extra steps.
- **One row per thing the user can act on** — a CR, a pushed commit, the working
  tree when step 2's floor isn't met. A session with nothing to act on (a dead
  end, a read-only close) drops the table and keeps the footer.
- **`next` is commands in the order they run**, arrow-separated, no
  explanations. Nothing left to run is `—`.
- **The footer is `route`, `retro`, `notes`**, bold-labelled, one line each, and
  any field with nothing to say is dropped.
- **Live links, not dead tokens.** The change cell carries a linked forge
  reference (`cleat#3`, `ai-tools!23`), never a bare number or a raw URL, and
  shas go in backticks at 7 characters. Name absent signals as absent (`no
  checks`, never `green`).
- **The columns hold the alignment, so nothing depends on padding.** The shape
  this replaces was a space-aligned text block whose second repo wrapped out of
  its column and whose forge references couldn't be clicked.
- **Above the table, at most one sentence**, and only when step 1 found the draft
  stall, step 2 found the floor unmet, or step 3 corrected a record. Otherwise
  the table stands alone.
- **Below it, at most one line per caveat** from the state table's two flagged
  rows.
- **No prose recap of what steps 1–4 did.** The wall of text this replaces is
  the failure mode: the user reads the table, then acts.

**This table has a second, earlier trigger.** The `landing-nudge` hook fires when
a CR description is written — the first moment a session has something
reviewable — and asks for a table in this shape right there. That preview is not
the close: it reports where things stand and what runs next, while this skill
still records the deliverable on the route (step 3) and hands off the retro
(step 4). So a session that already emitted the preview does **not** skip this
step; it re-reads the state and closes properly.

| State | Next |
|---|---|
| Uncommitted changes in the tree | `/anchor:commit` |
| Committed, not pushed | `git push` |
| Pushed, no CR | `/anchor:prepare-review` |
| CR still a draft | `gh pr ready <n>` / `glab mr update <n> --ready` |
| No review pass on the changeset | `/code-review` |
| Open review threads | `/anchor:resolve-feedback` |
| Checks pending | `/anchor:pipeline --watch` |
| `SPEC.md` present, ledger not refreshed | `/sextant:spec-status` — before the release, not trailing the CR |
| Ready, green, approved | `/anchor:merge` |
| Merged, repo publishes releases | `/anchor:release` — it owns the version bump; a hand-bump lands a conflicting commit |
| Nothing left to run, floor cleared | say that in one line and stop |
| Declared a dead end | nothing to run; the route carries the reason |

## Multi-repo sessions

`/tack:end <name>` resolves `<name>` to one repo by case-insensitive substring match
against the basename of every git repo the session touched. One match: confirm it
in one line and close against it. Zero or several: list the touched repos and
ask. Without an argument the target is the cwd repo.

When the session touched several repos, run steps 1, 2, 3, and 5 once per repo, then
hand off the retro once for the whole session.

## Related

`/tack:start` opens what this closes. The end-state read exists because a session
that *feels* shipped and a session whose draft flag is still set are
indistinguishable without it — read the signals, don't recall them. Reporting
owed commands rather than running them is what keeps the close inside the work
the session actually did.
