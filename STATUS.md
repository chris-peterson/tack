# tack — Spec Coverage Status

Tracking status of the requirements declared in [`spec/v1/SPEC.md`](spec/v1/SPEC.md).
Updated after each `/spec-audit`.

**Last audit:** 2026-05-31
**Spec version:** v1
**Coverage:** 87 / 87 source-verified normative behaviors (100%) — 0 Partial, 0 Missing, 0 Contradicts — plus 5 deferred (FUT-01..05)

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
| RT-01..10 | 10 | All Covered | `src/types.ts`, `schema/route.schema.json`, `src/route.ts`; includes RT-09/RT-10 sessions |
| TK-01..07 | 7 | All Covered | `src/route.ts` |
| DV-01..02 | 2 | All Covered | `src/types.ts`, `src/route.ts` |
| TD-01..05 | 5 | All Covered | `src/route.ts`; TD-01 reworded to shall form |
| DP-01..04 | 4 | All Covered | `src/route.ts` |
| LK-01 | 1 | Covered | `src/types.ts` |
| ST-01..06 | 6 | All Covered | `src/route.ts`; ST-06 pointer file (`<cwd>/.tack`) |
| CL-01..37 (+CL-19a) | 38 | All Covered | includes CL-17/CL-18 (session/`--json`), CL-19a (`install-cli`), CL-30..36 (pin/unpin, depends add/rm, status set, rename, move), CL-37 (forge note); CL-21 and CL-36 decomposed into lettered sub-requirements (CL-21a..d, CL-36a..d) |
| AG-01..10 | 10 | All Covered | AG-02 reworded to drop "without blocking"; AG-10 (auto-pin on confident resolution) covered |
| HK-01..05 | 5 | All Covered | HK-04 reworded to match the existence-only steps 1/3 the hook runs |
| FUT-01..05 | 5 | Deferred | Backup feature — out of scope for v1 |

## Audit history

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
