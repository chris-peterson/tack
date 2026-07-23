# tack — Spec Coverage Status

Tracking status of the requirements declared in [`spec/v1/SPEC.md`](spec/v1/SPEC.md).
Updated after each `/sextant:spec-status` or `/sextant:spec-sync` run.

**Last audit:** 2026-07-15
**Spec version:** v1
**Coverage:** 127 / 127 source-verified normative behaviors (100%) — 0 Partial, 0 Missing, 0 Contradicts — plus 5 deferred (FUT-01..05)

This `/sextant:spec-sync` pass captured one drift item: the new
`tack merge-routes` command (issue #8) shipped without a requirement. Added as
**CLI-52** with decompositions **CLI-52a..d** (chronological destination IDs +
metadata/`depends_on` preservation, session carry-over with tack-ref remap,
`created_at`/group defaults, and the external route-dep guard) — all Covered by
`mergeRoutes` in `src/route.ts`, the `merge-routes` dispatch in `src/cli.ts`,
and 14 tests in `src/route.test.ts`. No contradictions, no other drift.
Source-verified count moves 122 → 127.

## Status by category

| Prefix | Count | Status | Notes |
|--------|------:|--------|-------|
| RTE-01..11 | 11 | All Covered | `src/types.ts`, `schema/route.schema.json`, `src/route.ts`; includes RTE-09/RTE-10 sessions and RTE-11 session→tack binding (`Session.tacks`) |
| TACK-01..08 | 8 | All Covered | `src/route.ts`; TACK-08 bare-id resolution (`normalizeTackId`) |
| DEL-01..02 | 2 | All Covered | `src/types.ts`, `src/route.ts` |
| TODO-01..05 | 5 | All Covered | `src/route.ts`; TODO-01 reworded to shall form |
| DEP-01..04 | 4 | All Covered | `src/route.ts` |
| LINK-01 | 1 | Covered | `src/types.ts` |
| STG-01..06 | 6 | All Covered | `src/route.ts`; STG-06 pins file (`~/.tack/pins.yaml`) |
| CLI-01..52 (+CLI-08a, CLI-19a, CLI-21a..d, CLI-23a..b, CLI-36a..d, CLI-37a, CLI-52a..d) | 69 | All Covered | CLI-23a/CLI-23b (`tack find --path` path lookup and the exactly-one `--url`/`--path` selector guard — `repoKeyForCwd` in `src/repos.ts`, `findByRepoKey` in `src/route.ts`, `find` dispatch in `src/cli.ts`, tests in `src/route.test.ts`/`src/cli.test.ts`); CLI-52 (`tack merge-routes`, whole-route consolidation with chronological destination IDs, metadata/`depends_on`/session preservation, `created_at`/group defaults, external route-dep guard — `mergeRoutes` in `src/route.ts`, `merge-routes` dispatch in `src/cli.ts`, tests in `src/route.test.ts`); CLI-51 (`tack group` show/set/clear, `src/cli.ts` group case + `setGroup`/`clearGroup` in `src/route.ts`); also includes CLI-02/CLI-04 (`init`/`add` record the current session route-level via `recordSessionIfPresent`, `src/cli.ts`; CLI-04 also takes repeatable `--link "label,url"`, deduped in `addTack`), CLI-08a (`deliverable rm` clears or `--to-link`-demotes the deliverable, `src/route.ts` `removeDeliverable` + `src/cli.ts` dispatch, tests in `src/route.test.ts`/`src/cli.test.ts`), CLI-17/CLI-18 (session + `--tack` binding / `--json`), CLI-19a (`install-cli`), CLI-30..36 (pin/unpin, depends add/rm, status set, rename, move), CLI-37 (forge note) + CLI-37a (commit-URL label derivation), CLI-38 (`--help`/`-h`/`help` + usage exit semantics, incl. subcommand-level `--help`/`-h`, `src/cli.ts`), CLI-39/CLI-40 (`tack pins` list + prune, `src/route.ts` `listPins`/`prunePins`), CLI-41 (group-scoped subcommand errors on stderr, `src/cli.ts` `groupError`, `src/cli.test.ts`), CLI-42..47 (`tack repo` lookup/list/alias/prune/rebuild/rm, `src/repos.ts` + `src/cli.ts`), CLI-48 (duplicate-URL warning on attach, `src/route.ts` `findCollisions`, `src/cli.ts` `warnUrlCollision`, `src/cli.test.ts`), CLI-49/CLI-50 (`export` to stdout by default with `--out-file`/`--compress`, `import` detecting gzip-vs-plain by content, schema versioning + identity-dedup merge, `src/backup.ts` + `src/cli.ts`, `src/cli.test.ts`) |
| AGT-01..11 | 11 | All Covered | AGT-02 reworded to drop "without blocking"; AGT-10 (auto-pin on confident resolution); AGT-11 (early session→tack binding via `tack find`, existing-vs-emerging derivation) covered in `skills/tack/SKILL.md` |
| HOOK-01..05 | 5 | All Covered | HOOK-02/HOOK-03 gate the URL reminder on `tack find` (already-tracked URLs stay silent; untracked ones nudge to create the mapping), shared in `scripts/lib-url.sh`; HOOK-04 records the session route-level when a route resolves; HOOK-05 permits the hook's deterministic reads (`tack find`) and the route-level session write while keeping URL→tack mapping with the agent |
| REPO-01..07 | 7 | All Covered | `~/.tack/repos.yaml` repo database (`src/repos.ts`): REPO-02 remote normalization, REPO-06 capture from deliverable/link URLs, REPO-07 capture from `init`/`pin` cwd origin; tests in `src/repos.test.ts`, `src/cli.test.ts` |
| FUT-01..05 | 5 | Deferred | Backup feature — out of scope for v1 |

## Audit history

### 2026-07-15 — merge-routes drift → spec (issue #8)

+5 IDs (CLI-52, CLI-52a..d). A `/sextant:spec-sync` pass found one drift item:
`tack merge-routes <new-slug> <src-slug>...` shipped without a requirement.
Captured to spec (source → spec) as **CLI-52** — create the umbrella, move every
tack from every source, delete the emptied sources — with four decompositions:
**CLI-52a** chronological destination IDs (by `done_at`, source `created_at`
fallback) with all tack metadata and route-local `depends_on` preserved
(remapped); **CLI-52b** session carry-over with tack refs remapped and
cross-source sessions unified, dropping refs orphaned by `tack remove`;
**CLI-52c** `created_at` (earliest source, or `--created-at`) and group
(`--group`, or first source) defaults; **CLI-52d** the external route-level
`depends_on` guard with the `--break-deps` repoint. All Covered by `mergeRoutes`
(`src/route.ts`), the `merge-routes` dispatch (`src/cli.ts`), and 14 tests in
`src/route.test.ts`. No contradictions or other drift. Count moves 122 → 127.

### 2026-07-11 — spec-sync reconciliation (conflicts → code)

+1 ID (CLI-51). A `/sextant:spec-sync` pass found the spec 117/121 against a
literal reading; all four gaps are now closed by aligning the **spec** to the
shipping code (the user's "source wins" call) plus one skill completion:

- **Tack-ID reuse — CLI-25/CLI-28/CLI-36a ⇄ TACK-05.** The three commands
  promised a removed/merged/moved tack's id "shall not be reused," but
  `nextTackNumber` (`src/route.ts`) is `max(existing)+1` per TACK-05, so
  removing the highest-numbered tack frees its id for the next `tack add`. The
  non-reuse language was struck from all three; they now state the id is
  reusable when it was the highest-numbered. No code change.
- **RTE-06 ⇄ CLI-50.** RTE-06's "always bump `updated_at` on write" contradicted
  `import --replace`'s verbatim restore (`writeRoute`, `src/route.ts`). RTE-06
  gained a verbatim-restore exception.
- **CLI-51 (`tack group`) drift → spec.** The shipping `tack group <slug>
  [<group>] [--clear]` show/set/clear-group command had no requirement; added as
  CLI-51 (`src/cli.ts` group case, `setGroup`/`clearGroup` in `src/route.ts`).
- **AGT-04 skill gap.** `skills/tack/SKILL.md` resolution step 5 pinned a
  not-yet-created slug on the "start a new route" pick; it now runs `tack init`
  + first `tack add` before pinning, per AGT-04.

Two doc corrections outside the count: the public root `SPEC.md` category table
carried the pre-2026-07-08 prefixes (`RT`/`TK`/…) and omitted REPO — refreshed
to `RTE`/`TACK`/…/`REPO`; and SKILL.md's `tack rename` line dropped its
inaccurate "+ pins" claim (`rename()` does not touch `~/.tack/pins.yaml`).

### 2026-07-09 — deliverable rm + add --link (0.27.0)

+1 ID (CLI-08a). **CLI-08a** adds `tack deliverable rm <slug> <tack-id>
[--to-link]`, the inverse of CLI-08: it clears the deliverable by default, or
relocates it into `links` (preserving label + URL) with `--to-link`. The
clear-then-relocate is one operation on the tack, so the URL is never
momentarily absent — sidestepping `addLink`'s dedupe no-op — and the relocation
is skipped when the URL is already a link; removing from a tack with no
deliverable fails with a clear message. **CLI-04** gained a repeatable `--link
"label,url"` flag (split on the first comma, comma-less rejected) that attaches
links on creation, deduped against the deliverable and one another in
`addTack` — an extension of an existing ID. Covered by `src/route.ts`
(`removeDeliverable`, `addTack` links), `src/cli.ts`, and new tests in
`src/route.test.ts` and `src/cli.test.ts` (13 added). Also swept the grammar
through `--help`, zsh completions, `docs/cli.md`, and `skills/tack/SKILL.md`.

### 2026-07-08 — Category prefix rename + session/URL capture (0.25.0, 0.26.0)

+0 IDs. **Rename:** category prefixes expanded to natural mnemonic codes
(RT→RTE, TK→TACK, DV→DEL, TD→TODO, DP→DEP, LK→LINK, ST→STG, CL→CLI, AG→AGT,
HK→HOOK, RP→REPO; FUT unchanged) across `spec/v1/SPEC.md`, this file,
`CHANGELOG.md`, and code comments/tests — numeric parts unchanged, no behavior
touched. **Behaviors** (all extend existing IDs): `tack init`/`add` now record
the current Claude session on the route route-level when `CLAUDE_CODE_SESSION_ID`
is set (CLI-02/CLI-04), so session capture no longer depends on `tack start` or
the agent. `tack export` writes uncompressed JSON to stdout by default, with
`--out-file` redirecting to a file and `--compress` gzipping (CLI-49); `import`
detects gzip vs. plain JSON by content (CLI-50). The URL hooks now check
`tack find` before nudging — an already-tracked URL stays silent, an untracked
one nudges to create the mapping (HOOK-02/HOOK-03, shared `scripts/lib-url.sh`) —
and the `UserPromptSubmit` hook records the session on a resolved route
(HOOK-04). HOOK-05 reworded to permit the hook's deterministic reads/route-level
write. `src/cli.ts`, `hooks/*.sh`, `src/cli.test.ts`.

### 2026-07-07 — Export / import backup (CLI-49, CLI-50)

+2 IDs. `tack export` bundles all routes, the repo database, and pins into a
single gzip-compressed JSON document with a top-level `schemaVersion` (1).
`tack import` reads it back, refusing a newer schema version. `--replace`
restores wholesale; `--merge` (default) creates absent routes and appends only
tacks whose identity (deliverable URL, else summary + `done_at`) isn't already
present, assigning fresh ids, remapping `depends_on`, and reporting every
reassignment; it unions repo names but ignores machine-specific `locals` and
pins. `--dry-run` previews without writing. `src/backup.ts` (`buildArchive`,
`parseArchive`, `applyImport`), `src/cli.ts`, tests in `src/cli.test.ts`.

### 2026-06-27 — Duplicate-URL warning (CLI-48)

+1 ID (CLI-48, issue #10). Attaching a URL as a deliverable or link now scans
the other tacks for the same exact URL — reusing `find()`'s match rule
([CLI-23]) via `findCollisions` — and warns to stderr when it already lives
elsewhere, naming each route/tack. The mutated tack is excluded so an
idempotent re-attach stays quiet; the attach still completes and exits zero.
`src/route.ts` `findCollisions`, `src/cli.ts` `warnUrlCollision`, tests in
`src/cli.test.ts`.

### 2026-06-24 — Repo database (REPO category)

+13 IDs (REPO-01..07, CLI-42..47). A standalone index at `~/.tack/repos.yaml` maps
the names a repo is known by to its remote, keyed by the remote normalized to
scheme-less `host/path` form (REPO-02) so the HTTPS and SSH forms of one remote
collapse to a single entry. Captured best-effort as tack observes work:
recording a deliverable/link URL that parses as a forge change reference upserts
the repo (REPO-06), and `tack init` / `tack pin` read the cwd's `origin` remote to
record a local checkout (REPO-07). `tack repo <partial>` (CLI-42) matches a partial
against every repo's `names` and returns the HTTPS remote; `tack repo` lists
(CLI-43); `alias` adds a custom name (CLI-44); `prune` drops stale locals while
retaining URL-only entries (CLI-45); `rebuild` backfills the database from every
forge URL across routes plus pinned directories' origin remotes (CLI-47); `rm`
removes an entry (CLI-46). The database
is internal derived state like pins — no published JSON Schema (REPO-05). Covered
by `src/repos.ts`, `src/cli.ts`, `src/display.ts`, `src/completions.ts`; tested
in `src/repos.test.ts` and `src/cli.test.ts`.

### 2026-06-23 — Coverage refresh (spec-status)

**CLI-38** extended to cover subcommand-level `--help` / `-h` (`tack session
--help`, `tack pins --help`, …): the flag now prints usage and exits zero
after any subcommand rather than throwing on strictly-parsed subcommands or
being silently ignored by manually-parsed ones. No new ID; count holds at 104.

### 2026-06-15 — 0.18.0 (session→tack link)

+2 IDs (RTE-11, AGT-11). **RTE-11** adds the optional `tacks` array to each session
entry — the bare route-scoped tack IDs a session is driving, in touch order
(last = current focus). This narrows the existing session→route record (RTE-09)
to the specific tack(s) a session works, so a fleet view keyed on the Claude
session id can resolve which tack a live session is on. **CLI-17** gains
`--tack <tack-id>`, which appends the tack to the session entry (move-to-end on
re-bind, validated against the route). **AGT-11** has the skill establish the
link as early as possible: a work-tracker URL in scope at session start is run
through `tack find`; a match binds the session to the existing tack, no match
means emerging work (create + bind). Existing-vs-emerging is derived from the
bound tack's own state, not stored. Covered by new tests in `src/route.test.ts`
(`recordSession` binding cases) and `src/cli.test.ts` (`tack session --tack`).

### 2026-06-15 — 0.17.0 (issue #11)

+2 IDs (TACK-08, CLI-37a). **TACK-08** documents that every tack-id argument accepts
both the bare `<N>` and prefixed `t<N>` form, normalized at the lookup boundary
(`normalizeTackId` in `src/route.ts`, applied in `findTack` and the
`depends_on` / `depends add` / `depends rm` paths). **CLI-08** gains the url-only
shorthand (`tack deliverable <slug> <tack-id> <url>`), auto-deriving the label;
**CLI-04**/**CLI-08** now reference the recognition rules in CLI-37. **CLI-37a**
adds commit-URL recognition for label derivation (`<repo>@<sha7>`), scoped out
of done-promotion and the hook scanners. All covered by new tests in
`src/route.test.ts` and `src/cli.test.ts`.

### 2026-06-05 — 0.16.1 patch (issues #12, #17)

+1 ID (CLI-41, group-scoped subcommand errors). CLI-28 (`tack merge`) reworded:
the source tack is now **removed**, not soft-dropped to status `dropped` —
fixing the duplicate-deliverable shadow (issue #12). CLI-41 documents the
group-scoped stderr errors for malformed `status set` / `todo` / `link` /
`depends` invocations (issue #17); both covered by new tests in
`src/route.test.ts` and `src/cli.test.ts`.

### 2026-06-02 — Coverage refresh (spec-status)

+3 IDs (CLI-38 help/usage semantics, CLI-39/CLI-40 pins list + prune), all
Covered; STG-06 storage relocated to `~/.tack/pins.yaml`; inventory recounted
to 99 normative by including the lettered decompositions (CLI-19a, CLI-21a..d,
CLI-36a..d) as individual requirements — prior audits held the headline at 87
by counting decompositions as part of their parent.

### 2026-05-31 — Coverage refresh + spec alignment

Reconciled STATUS.md against the current spec inventory (87 normative + 5
deferred). Rebuilt the category table to include requirements added since the
prior audit: the HOOK category (HOOK-01..05), CLI-30..36, CLI-17/CLI-18, CLI-19a,
AGT-10, STG-06, and RTE-09/RTE-10.

Took the spec-alignment direction on the two gaps and brought both to
**Covered** without touching code:

- **[AGT-02]** Reworded to drop the unenforceable "without blocking the user
  prompt" clause; it now states the skill loads all active routes when a
  session begins. (A `SessionStart`-hook prefetch remains deferred feature
  work, not a spec guarantee.)
- **[HOOK-04]** Reworded to match `hooks/session-nudge.sh`: the hook checks
  AGT-03 step 1 (pin at cwd) and step 3 (branch-slug route), existence-only,
  without verifying open-tack state. Dropped the "steps 1–4" claim.

Also resolved the standing forge-support backlog item and applied EARS polish:

- Added **[CLI-37]** documenting GitHub and GitLab as the supported forges for
  PR/MR/issue URL detection (verified against `src/route.ts:453-462`,
  `hooks/capture-urls.sh:18`, `hooks/session-nudge.sh:22`). Cross-referenced
  from CLI-13, HOOK-02, and HOOK-03.
- Reworded **[TODO-01]** from descriptive to shall form.
- Decomposed **[CLI-21]** (tree) into CLI-21a..d (path grammar, glob semantics,
  depth defaults, tab completion) and **[CLI-36]** (move) into CLI-36a..d (ID
  assignment/metadata, cross-boundary refusal, `--include-dependents` closure,
  precondition failures).

The source-verified normative count stays at 87 — the new sub-IDs are additive
decompositions of existing requirements, not new behaviors.

### 2026-05-18 — CL escape-hatch / dependency commands

Added CLI-32..35 and tightened CLI-07 error guidance (issue #1) to point users at
`tack depends rm` (CLI-33) and `tack status set` (CLI-34) when a dependency guard
fires.

### 2026-05-08 — First audit

Coverage was 62/70 (89%) before this session's edits. All 8 partial items
were spec/wording issues. Two were also user-facing breakages (the skill
referenced `--tangent`, an unimplemented flag; `tack recent --since` silently
swallowed bad input).

- **Spec edits applied (`spec/v1/SPEC.md`)**
  - Added `[CLI-27]` `tack edit` (was shipping undocumented).
  - Added `[CLI-28]` `tack merge` (was shipping undocumented; semantics
    verified against `mergeTacks` in `src/route.ts:330` — when both tacks
    have a deliverable, the source's is dropped).
  - Added `[CLI-29]` `tack --version` / `-v`.
  - Tightened `[TACK-04]` to acknowledge that the CLI persists status before
    surfacing pending after-items; gating is the caller's responsibility.
  - Tightened `[AGT-02]` ("background" → "without blocking the user prompt").
  - Tightened `[AGT-03]` to reflect the actual implementation
    (`UserPromptSubmit` hook + branch-slug heuristic), not the
    URL-inference language that never shipped.

- **Doc edits (`docs/spec.md`)**
  - Updated headline count (70 → 73) and CL row (`CLI-01..16` →
    `CLI-01..29 (plus CLI-19a)`).

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
    2026-05-31 by documenting the supported forges in CLI-37 rather than
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
  - EARS conformance polish for the "list of fields" requirements (RTE-03,
    RTE-04, RTE-09, RTE-10, TACK-01, TACK-02, TODO-02, DEL-02, LINK-01). These remain
    acceptable Ubiquitous form. (TODO-01 reworded to shall form and CLI-21
    decomposed into sub-requirements on 2026-05-31.)

## How to use this file

When you implement a new requirement, change the row's status and add an
evidence pointer. When an audit reveals drift, update the row to **Partial**
or **Contradicts** with a one-line note.
