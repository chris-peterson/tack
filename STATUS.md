# tack — Spec Coverage Status

Tracking status of the requirements declared in [`spec/v1/SPEC.md`](spec/v1/SPEC.md).
Updated after each `/spec-audit`.

**Last audit:** 2026-06-27
**Spec version:** v1
**Coverage:** 118 / 118 source-verified normative behaviors (100%) — 0 Partial, 0 Missing, 0 Contradicts — plus 5 deferred (FUT-01..05)

The HK category (HK-01..05) formalizes the hook layer. AG-02 and HK-04 are now
**Covered**: the spec was reworded to match what the implementation actually
guarantees (AG-02 drops the unenforceable "without blocking" clause; HK-04
describes the existence-only steps 1 and 3 the shell hook runs). The CL-37
forge note and the CL-21a..d / CL-36a..d / TD-01 edits restructure existing
requirements without adding new behavior, so the source-verified count holds
at 87; CL-37 makes the already-verified GitHub/GitLab URL detection explicit.

## Status by category

| Prefix | Count | Status | Notes |
|--------|------:|--------|-------|
| RT-01..11 | 11 | All Covered | `src/types.ts`, `schema/route.schema.json`, `src/route.ts`; includes RT-09/RT-10 sessions and RT-11 session→tack binding (`Session.tacks`) |
| TK-01..08 | 8 | All Covered | `src/route.ts`; TK-08 bare-id resolution (`normalizeTackId`) |
| DV-01..02 | 2 | All Covered | `src/types.ts`, `src/route.ts` |
| TD-01..05 | 5 | All Covered | `src/route.ts`; TD-01 reworded to shall form |
| DP-01..04 | 4 | All Covered | `src/route.ts` |
| LK-01 | 1 | Covered | `src/types.ts` |
| ST-01..06 | 6 | All Covered | `src/route.ts`; ST-06 pins file (`~/.tack/pins.yaml`) |
| CL-01..48 (+CL-19a, CL-21a..d, CL-36a..d, CL-37a) | 58 | All Covered | includes CL-17/CL-18 (session + `--tack` binding / `--json`), CL-19a (`install-cli`), CL-30..36 (pin/unpin, depends add/rm, status set, rename, move), CL-37 (forge note) + CL-37a (commit-URL label derivation), CL-38 (`--help`/`-h`/`help` + usage exit semantics, incl. subcommand-level `--help`/`-h`, `src/cli.ts`), CL-39/CL-40 (`tack pins` list + prune, `src/route.ts` `listPins`/`prunePins`), CL-41 (group-scoped subcommand errors on stderr, `src/cli.ts` `groupError`, `src/cli.test.ts`), CL-42..47 (`tack repo` lookup/list/alias/prune/rebuild/rm, `src/repos.ts` + `src/cli.ts`), CL-48 (duplicate-URL warning on attach, `src/route.ts` `findCollisions`, `src/cli.ts` `warnUrlCollision`, `src/cli.test.ts`) |
| AG-01..11 | 11 | All Covered | AG-02 reworded to drop "without blocking"; AG-10 (auto-pin on confident resolution); AG-11 (early session→tack binding via `tack find`, existing-vs-emerging derivation) covered in `skills/tack/SKILL.md` |
| HK-01..05 | 5 | All Covered | HK-04 reworded to match the existence-only steps 1/3 the hook runs |
| RP-01..07 | 7 | All Covered | `~/.tack/repos.yaml` repo database (`src/repos.ts`): RP-02 remote normalization, RP-06 capture from deliverable/link URLs, RP-07 capture from `init`/`pin` cwd origin; tests in `src/repos.test.ts`, `src/cli.test.ts` |
| FUT-01..05 | 5 | Deferred | Backup feature — out of scope for v1 |

## Audit history

### 2026-06-27 — Duplicate-URL warning (CL-48)

+1 ID (CL-48, issue #10). Attaching a URL as a deliverable or link now scans
the other tacks for the same exact URL — reusing `find()`'s match rule
([CL-23]) via `findCollisions` — and warns to stderr when it already lives
elsewhere, naming each route/tack. The mutated tack is excluded so an
idempotent re-attach stays quiet; the attach still completes and exits zero.
`src/route.ts` `findCollisions`, `src/cli.ts` `warnUrlCollision`, tests in
`src/cli.test.ts`.

### 2026-06-24 — Repo database (RP category)

+13 IDs (RP-01..07, CL-42..47). A standalone index at `~/.tack/repos.yaml` maps
the names a repo is known by to its remote, keyed by the remote normalized to
scheme-less `host/path` form (RP-02) so the HTTPS and SSH forms of one remote
collapse to a single entry. Captured best-effort as tack observes work:
recording a deliverable/link URL that parses as a forge change reference upserts
the repo (RP-06), and `tack init` / `tack pin` read the cwd's `origin` remote to
record a local checkout (RP-07). `tack repo <partial>` (CL-42) matches a partial
against every repo's `names` and returns the HTTPS remote; `tack repo` lists
(CL-43); `alias` adds a custom name (CL-44); `prune` drops stale locals while
retaining URL-only entries (CL-45); `rebuild` backfills the database from every
forge URL across routes plus pinned directories' origin remotes (CL-47); `rm`
removes an entry (CL-46). The database
is internal derived state like pins — no published JSON Schema (RP-05). Covered
by `src/repos.ts`, `src/cli.ts`, `src/display.ts`, `src/completions.ts`; tested
in `src/repos.test.ts` and `src/cli.test.ts`.

### 2026-06-23 — Coverage refresh (spec-status)

**CL-38** extended to cover subcommand-level `--help` / `-h` (`tack session
--help`, `tack pins --help`, …): the flag now prints usage and exits zero
after any subcommand rather than throwing on strictly-parsed subcommands or
being silently ignored by manually-parsed ones. No new ID; count holds at 104.

### 2026-06-15 — 0.18.0 (session→tack link)

+2 IDs (RT-11, AG-11). **RT-11** adds the optional `tacks` array to each session
entry — the bare route-scoped tack IDs a session is driving, in touch order
(last = current focus). This narrows the existing session→route record (RT-09)
to the specific tack(s) a session works, so a fleet view keyed on the Claude
session id can resolve which tack a live session is on. **CL-17** gains
`--tack <tack-id>`, which appends the tack to the session entry (move-to-end on
re-bind, validated against the route). **AG-11** has the skill establish the
link as early as possible: a work-tracker URL in scope at session start is run
through `tack find`; a match binds the session to the existing tack, no match
means emerging work (create + bind). Existing-vs-emerging is derived from the
bound tack's own state, not stored. Covered by new tests in `src/route.test.ts`
(`recordSession` binding cases) and `src/cli.test.ts` (`tack session --tack`).

### 2026-06-15 — 0.17.0 (issue #11)

+2 IDs (TK-08, CL-37a). **TK-08** documents that every tack-id argument accepts
both the bare `<N>` and prefixed `t<N>` form, normalized at the lookup boundary
(`normalizeTackId` in `src/route.ts`, applied in `findTack` and the
`depends_on` / `depends add` / `depends rm` paths). **CL-08** gains the url-only
shorthand (`tack deliverable <slug> <tack-id> <url>`), auto-deriving the label;
**CL-04**/**CL-08** now reference the recognition rules in CL-37. **CL-37a**
adds commit-URL recognition for label derivation (`<repo>@<sha7>`), scoped out
of done-promotion and the hook scanners. All covered by new tests in
`src/route.test.ts` and `src/cli.test.ts`.

### 2026-06-05 — 0.16.1 patch (issues #12, #17)

+1 ID (CL-41, group-scoped subcommand errors). CL-28 (`tack merge`) reworded:
the source tack is now **removed**, not soft-dropped to status `dropped` —
fixing the duplicate-deliverable shadow (issue #12). CL-41 documents the
group-scoped stderr errors for malformed `status set` / `todo` / `link` /
`depends` invocations (issue #17); both covered by new tests in
`src/route.test.ts` and `src/cli.test.ts`.

### 2026-06-02 — Coverage refresh (spec-status)

+3 IDs (CL-38 help/usage semantics, CL-39/CL-40 pins list + prune), all
Covered; ST-06 storage relocated to `~/.tack/pins.yaml`; inventory recounted
to 99 normative by including the lettered decompositions (CL-19a, CL-21a..d,
CL-36a..d) as individual requirements — prior audits held the headline at 87
by counting decompositions as part of their parent.

### 2026-05-31 — Coverage refresh + spec alignment

Reconciled STATUS.md against the current spec inventory (87 normative + 5
deferred). Rebuilt the category table to include requirements added since the
prior audit: the HK category (HK-01..05), CL-30..36, CL-17/CL-18, CL-19a,
AG-10, ST-06, and RT-09/RT-10.

Took the spec-alignment direction on the two gaps and brought both to
**Covered** without touching code:

- **[AG-02]** Reworded to drop the unenforceable "without blocking the user
  prompt" clause; it now states the skill loads all active routes when a
  session begins. (A `SessionStart`-hook prefetch remains deferred feature
  work, not a spec guarantee.)
- **[HK-04]** Reworded to match `hooks/session-nudge.sh`: the hook checks
  AG-03 step 1 (pin at cwd) and step 3 (branch-slug route), existence-only,
  without verifying open-tack state. Dropped the "steps 1–4" claim.

Also resolved the standing forge-support backlog item and applied EARS polish:

- Added **[CL-37]** documenting GitHub and GitLab as the supported forges for
  PR/MR/issue URL detection (verified against `src/route.ts:453-462`,
  `hooks/capture-urls.sh:18`, `hooks/session-nudge.sh:22`). Cross-referenced
  from CL-13, HK-02, and HK-03.
- Reworded **[TD-01]** from descriptive to shall form.
- Decomposed **[CL-21]** (tree) into CL-21a..d (path grammar, glob semantics,
  depth defaults, tab completion) and **[CL-36]** (move) into CL-36a..d (ID
  assignment/metadata, cross-boundary refusal, `--include-dependents` closure,
  precondition failures).

The source-verified normative count stays at 87 — the new sub-IDs are additive
decompositions of existing requirements, not new behaviors.

### 2026-05-18 — CL escape-hatch / dependency commands

Added CL-32..35 and tightened CL-07 error guidance (issue #1) to point users at
`tack depends rm` (CL-33) and `tack status set` (CL-34) when a dependency guard
fires.

### 2026-05-08 — First audit

Coverage was 62/70 (89%) before this session's edits. All 8 partial items
were spec/wording issues. Two were also user-facing breakages (the skill
referenced `--tangent`, an unimplemented flag; `tack recent --since` silently
swallowed bad input).

- **Spec edits applied (`spec/v1/SPEC.md`)**
  - Added `[CL-27]` `tack edit` (was shipping undocumented).
  - Added `[CL-28]` `tack merge` (was shipping undocumented; semantics
    verified against `mergeTacks` in `src/route.ts:330` — when both tacks
    have a deliverable, the source's is dropped).
  - Added `[CL-29]` `tack --version` / `-v`.
  - Tightened `[TK-04]` to acknowledge that the CLI persists status before
    surfacing pending after-items; gating is the caller's responsibility.
  - Tightened `[AG-02]` ("background" → "without blocking the user prompt").
  - Tightened `[AG-03]` to reflect the actual implementation
    (`UserPromptSubmit` hook + branch-slug heuristic), not the
    URL-inference language that never shipped.

- **Doc edits (`docs/spec.md`)**
  - Updated headline count (70 → 73) and CL row (`CL-01..16` →
    `CL-01..29 (plus CL-19a)`).

- **Skill edits (`skills/tack/SKILL.md`)**
  - Replaced `tack init <slug> --tangent` with `tack init <slug> --group
    tangent` (two occurrences). Agents following the skill no longer hit
    "Unknown option: --tangent" at runtime.

- **Code edits (`src/route.ts`)**
  - `recent()` now throws on invalid `--since` input rather than silently
    filtering everything out.

- **Backlog (advisory; not addressed this pass)**
  - Forge support: PR/MR detection regex (`route.ts:453-462`,
    `hooks/*.sh`) is GitHub + GitLab only. Self-hosted Bitbucket / Azure
    DevOps / Gitea are silently treated as "not a PR/MR." (Resolved
    2026-05-31 by documenting the supported forges in CL-37 rather than
    generalizing the pattern.)
  - Slug pattern enforcement: today validation happens at YAML schema
    write/load, not at the CLI entry. A user passing `tack init MyRoute`
    fails at save() rather than at the `init` command boundary.
  - `tack rm` (no `--force`) exits with code 1, which can break CI scripts
    that expect 0 for "no-op confirm." Spec passes literally; behavior is
    user-hostile.
  - Filename-vs-slug consistency: `route.ts:39-54` doesn't verify that the
    file's internal `slug` matches its filename. A hand-edited mismatch
    will load successfully and later save to the filename, silently
    renaming.
  - EARS conformance polish for the "list of fields" requirements (RT-03,
    RT-04, RT-09, RT-10, TK-01, TK-02, TD-02, DV-02, LK-01). These remain
    acceptable Ubiquitous form. (TD-01 reworded to shall form and CL-21
    decomposed into sub-requirements on 2026-05-31.)

## How to use this file

When you implement a new requirement, change the row's status and add an
evidence pointer. When an audit reveals drift, update the row to **Partial**
or **Contradicts** with a one-line note.
