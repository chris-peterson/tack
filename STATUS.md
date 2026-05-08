# tack — Spec Coverage Status

Tracking status of the requirements declared in [`spec/v1/SPEC.md`](spec/v1/SPEC.md).
Updated after each `/spec-audit`.

**Last audit:** 2026-05-08
**Spec version:** v1
**Coverage:** 73 / 73 normative requirements (100%) + 5 deferred (FUT-01..05)

After this session's edits the spec now covers the three commands that
shipped without coverage (`edit`, `merge`, `--version`), and the wording
issues in TK-04 / AG-02 / AG-03 are tightened. The skill-vs-CLI mismatch
on `--tangent` is fixed by routing through `--group tangent`.

## Status by category

| Prefix | Count | Status | Notes |
|--------|------:|--------|-------|
| RT-01..10 | 10 | All Covered | `src/types.ts`, `schema/route.schema.json`, `src/route.ts` |
| TK-01..07 | 7 | All Covered | TK-04 wording tightened 2026-05-08 |
| DV-01..02 | 2 | All Covered | `src/types.ts`, `src/route.ts` |
| TD-01..05 | 5 | All Covered | `src/route.ts` |
| DP-01..04 | 4 | All Covered | `src/route.ts` |
| LK-01 | 1 | Covered | `src/types.ts` |
| ST-01..05 | 5 | All Covered | `src/route.ts` |
| CL-01..29 (+19a) | 30 | All Covered | CL-27/28/29 added 2026-05-08 |
| AG-01..09 | 9 | All Covered | AG-02 / AG-03 wording tightened 2026-05-08 |
| FUT-01..05 | 5 | Deferred | Backup feature — out of scope for v1 |

## Audit history

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
  - Forge support: PR/MR detection regex (`route.ts:284-285`,
    `hooks/*.sh`) is GitHub + GitLab only. Self-hosted Bitbucket / Azure
    DevOps / Gitea are silently treated as "not a PR/MR." Either document
    the supported forges in the spec or generalize the pattern.
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
  - Hooks (`cli-freshness.sh`, `session-nudge.sh`, `capture-urls.sh`) are
    not covered by any requirement category. Either add an `HK` prefix
    or note that hook implementation is outside the schema spec.
  - EARS conformance polish for the "list of fields" requirements (RT-03,
    RT-04, RT-09, RT-10, TK-01, TK-02, TD-01, TD-02, DV-02, LK-01, CL-21).
    They read fine but don't decompose into single testable assertions.

## How to use this file

When you implement a new requirement, change the row's status and add an
evidence pointer. When an audit reveals drift, update the row to **Partial**
or **Contradicts** with a one-line note.
