---
name: start
description: "Open a work session: read the linked issue or CR thread in full, derive one slug, cut the branch, and bind the tack route. Triggers on \"start work on <issue-url>\" or \"pick up #42\"."
argument-hint: "[what] [issue-url]"
---

# Start

Open a work session. One slug names the work, and the
branch, the tack route, and the session label all agree on it. Whatever playbook
follows assumes this ran: without it the branch answers to no route, nothing that
reads routes can see the work, and the linked ticket goes unread.

**Skip this when** a route already resolves for the session (the gate below),
when the ask is a question or a read-only investigation with no deliverable, or
when work is already underway on a named branch and only the thread reading is
wanted.

## Gate: is a session already open here?

Every prompt carries tack's own resolution line, injected by its
`UserPromptSubmit` hook. Read it before running anything:

- **A route resolves** (the branch or the project is named for one). The
  session is open. Report it in one line and stop. A second route over work
  already tracked is what makes every reader of those routes double-count it.
- **No route resolves** (`neither the branch nor the project name matches a
  route`). Continue below.

When that line isn't in context, probe instead: `tack status <name>` exits 1
with `Route not found`, so run it for the current branch and for the checkout's
directory name — the two the hook resolves on.

## Read the linked artifact in full

When the arguments carry a URL, that URL is the session's brief. Read the whole
artifact before anything else, and read it as a document rather than as a
lookup:

- **Fetch the description *and* every note or comment**, in chronological order
  (`glab api "projects/<path>/merge_requests/<n>/notes?per_page=100"`,
  `gh pr view <n> --comments`). One call returns the thread; read what it
  returns.
- **A fragment anchors a position, not a scope.** `#note_<id>`,
  `#issuecomment-<id>`, and line anchors point at where the conversation was
  when the link was copied. Never filter the fetched thread down to the anchored
  id: the surrounding notes are why the link was shared.
- **The user's own replies are constraints, not commentary.** A thread the user
  participated in usually already settles scope, contract, and versioning
  questions. Treat what they wrote there as decided.
- **State back what the thread settled** before proposing anything: who
  reported what, which approach was rejected and why, and any decision already
  made. If a later step is about to contradict one of those, surface the
  conflict instead of re-deciding it.

Skipping this is the most expensive mistake this skill can make: a fix that
lands in minutes gets re-litigated for an hour against a position the user
already stated in writing.

## Derive one slug

`${CLAUDE_PLUGIN_ROOT}/skills/start/scripts/parse-start-args.py` owns the
deterministic half. It recognizes GitLab
issue and MR URLs and GitHub issue and PR URLs, returning the `repo`, the
numeric id, and the reference notation (`#` for issues and GitHub PRs, `!` for
GitLab MRs); it exits non-zero on an unrecognized URL rather than guessing. It
also slugifies a `--hint` string with fixed rules (lowercase, non-alphanumerics
to hyphens, collapse, strip, truncate at 60).

The judgment stays here: which text becomes the slug. Pick the source by
priority:

1. **User-provided text** beyond the URL (the prompt text alongside the command,
   or the working directory name).
2. **The issue or CR title**, fetched when a URL was given (`glab api` for
   GitLab, `gh issue view` for GitHub).
3. **Ask**, when there is no text hint, no URL, and the cwd name is too generic
   to name the work.

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/skills/start/scripts/parse-start-args.py" \
  "https://gitlab.example.com/group/repo/-/issues/42" --hint "Fix the Select bug"
# -> repo=repo  ref_type=issue  number=42  prefix=#  ref=#42  slug=fix-the-select-bug
```

## Bind the slug

**1. The branch.** Switch to `{slug}` if it exists, otherwise cut it from the
freshly fetched default branch — never from whatever happens to be checked out:

```bash
git fetch origin {default}
git checkout -b {slug} --no-track origin/{default}
```

**Don't drop `--no-track`.** Without it the new branch takes
`origin/{default}` as its upstream, and the first plain `git push` refuses:
*"The upstream branch of your current branch does not match the name of your
current branch."* The branch wants no upstream until its own first push sets
one.

`{default}` is the repo's default branch, which
`git symbolic-ref --short refs/remotes/origin/HEAD` resolves. Whichever branch
the checkout was parked on belongs to whatever ran here last; branching off it
stacks this work on a base it has no relationship to, and the dependency only
surfaces at review. Stack deliberately — `git checkout -b {slug}` off the
current branch — when the user says this work builds on it, and say that you
did.

Uncommitted work in the tree carries over to the new branch. When the tree is
dirty with changes that belong somewhere else, say so and ask before branching.

**When another live session already holds this checkout**, one tree can't serve
both: its index and HEAD are shared, so each session's commits sweep up the
other's in-flight files. The `checkout-collision` hook names the occupants on
the first prompt. Give this work its own tree with `EnterWorktree {slug}`, which
switches this session into it and branches from the default branch by default
(`worktree.baseRef: fresh`), so step 1's base is handled.

Tell the user you did, and what it means for them: which sessions hold the
original checkout, and the path and branch this session now works in. They are
steering several windows, and one of them silently changing directory is its own
way to lose track of work. `ExitWorktree` is theirs to ask for, not yours to
call — Claude Code prompts to keep or remove the tree when the session ends.

**2. The tack route.** The route persists across conversations and is the source
of truth for work-in-progress state that `/tack:end` and every fleet reader work
from. Create it and link the brief:

```bash
tack init {slug}
tack add {slug} "Initial implementation"
tack link add {slug} t1 "{repo} {ref}" "{issue_url}"
```

Omit the `tack link add` when no URL was given.

**Don't run `tack session`.** The `tack init` and `tack add` calls above already
record the session on the route, from `CLAUDE_CODE_SESSION_ID`, so a `tack
session` call here writes what they just wrote.

Branch-slug match is what resolves the route on later turns, so the branch you
just cut is what keeps this session findable. **When the work has no branch of
its own** — it stays on the default branch, or a worktree's branch is named for
something else — the hook falls back to a route named for the checkout, so give
the route the project's name and it still resolves.

**Don't set a session label.** A bound route is what a fleet view reads to label
the session, so writing one separately gives it a second, staler source for the
same field.

## Report, then hand off

Close with the session's state in one table and the command the work continues under.
Name the skill; don't invoke it — which playbook fits is the user's call:

```text
| field | value |
|---|---|
| brief | [#42](https://…/issues/42) Select drops the second value — 4 notes, scope settled |
| branch | `fix-the-select-bug` (new) |
| route | `fix-the-select-bug t1` |
| next | `/fix` |
```

The example is fenced so its source is visible; emit the table as markdown, not
inside a fence, so the links work. `/end` closes on a table in the same shape,
so the open and the close read as a pair and `next` means the same thing in both. The
brief's forge reference is a live link, never a bare number or a raw URL.

**`next` names a playbook the session actually has.** Resolve it from the
available-skills listing rather than a fixed name: a defect with an unknown cause
wants a diagnosis skill, new capability on an existing codebase wants an
implementation one. `git config tack.handoff` overrides the choice where a repo
always opens the same way. With nothing suitable in the listing, drop the row —
a named command that doesn't resolve is worse than no row. The `/fix` above is
illustrative. Where a row is dropped for that reason, say so in the sentence
above the table rather than leaving a thinner open looking complete.

With no URL there is no brief row; say what the work is in one sentence above the
table instead.

## Keep the route current while the session runs

- **Links, as they appear.** Attach URLs to the tack when they first surface
  rather than waiting to be asked. Typical triggers: the user pastes a URL,
  `git push` prints an MR URL, a pipeline gets referenced.

  ```bash
  tack link add {slug} t1 "pipeline #3256652" "https://..."
  ```

- **Tacks, only for discrete deliverables.** Never add one speculatively. A
  second tack means a second committed deliverable (a separate PR or MR); most
  sessions produce one.

`/tack:end` reads this state to decide what actually landed, so a route left
empty makes the close guess.

## Related

`/tack:end` closes what this opens. `/tack:tack` owns route resolution for a
session that never ran this — note that `tack start` is a CLI subcommand that
moves a tack to `in_progress`, a different thing from this skill.
