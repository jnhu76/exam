# Current Roadmap

> What is authorized now and next. This document is the operational companion
> to `docs/phase-roadmap.md` (which remains the phase-scope authority).

```text
STATUS:          CURRENT
AUTHORITY:        Roadmap (operational)
SCOPE:            Currently authorized work and next steps
OWNER:            Architecture
LAST VERIFIED:    2712c01 — aligned with docs/phase-roadmap.md, accepted ADRs,
                  and the frozen architecture scan review
SUPERSEDES:       —
RELATED ADRS:     All (status fields govern timing)
```

`docs/phase-roadmap.md` is the phase-scope authority (Phase 1 / 2 / 3 / 4).
This document states, operationally, **what may be done now and what blocks
what comes next.**

## Phase status (from `docs/phase-roadmap.md`)

- **Phase 1** — Minimal Deliverable Exam System. Implemented. Admin + Candidate
  core loop complete (see `docs/status/implementation-matrix.md`).
- **Phase 2** — Exam Operation. **Gate items implemented.** Proctor visibility,
  manual grading queue, retake policy, score strategy, timelines, diagnostics,
  result publishing, telemetry, and the candidate/admin permission boundary
  are in place. `timed_window` is the only timing mode; `timed_sync` / untimed
  / queue admission deferred.
- **Phase 3** — Collaboration, Permissions, Account Lifecycle. **Not started.**
  Scoped roles, invitation, SMTP reset, fill-blank/subjective runtime, WYSIWYG
  submit (ADR-008 Option D).
- **Phase 4** — Platformization and Integration. **Not started.** Optional
  multiTenant is Phase 4 only.

## Currently authorized work

**Project Simplification Wave 1** (this branch,
`chore/project-simplification-wave1`). Scope is deliberately bounded:

1. **Document reorganization** — reconstruct current architecture/status/ADR
   authority from code; archive point-in-time and superseded material.
2. **Mechanical cleanup** — delete verified-dead code and command entries only
   (`packages/exam-engine/src/types.ts`, `scripts/check-e2e-artifacts.mjs`,
   `package.json` `seed:e2e`, `package.json` `verify:nodb-tests`).
3. **Type 1 test cleanup** — mechanical duplicate coverage (re-export tests,
   test-infrastructure self-tests).
4. **Type 2 test cleanup** — behaviorally redundant coverage, deleted only
   when the surviving test covers the same inputs/behavior/failures.

## Forbidden in Wave 1

The following are **explicitly out of scope** for Wave 1 and must not be done
on this branch:

- Merging `authz` into `apps/api` (scan review §2.2 — rejected).
- Merging `exam-engine` into `apps/api` (scan review §2.3 — rejected).
- Merging `import-export` into `apps/api` (scan review §2.5 — keep provisionally).
- Moving the `auth` package (conditional merge blocked on DB-seed audit).
- Deleting Redis or changing its default policy (scan review §2.11 — optionalize
  only, Wave 3).
- Deleting Type 3 RBAC / security / permission-boundary tests (blocked on
  mutation evidence — scan review §2.13).
- Moving or rewriting `routeRegistry.ts` (scan review §2.9 — Wave 2 split only).
- Changing Docker build ordering (scan review §2.15 — investigate, do not
  assume).
- Deleting `smoke`, `docker-compose.test.override.yml`, or
  `scripts/rebuild-all.sh`.

## Blocking gates before any RBAC-sensitive change

Per scan review Gates 0 and 0.5, the following are blocked until M10-F is
re-executed and re-verified (PR #197 invalidated PR #196's M10-F closure
evidence):

- Deleting `packages/auth/src/rbac.ts`.
- Deleting the `requirePermission` implementation/type declaration.
- Deleting Type 3 authorization tests.
- Refactoring the route authorization oracle.
- Deleting permission compatibility evidence.
- Moving authz enforcement code.
- Modifying route authorization metadata.

**M10-F re-execution may proceed in parallel on a separate branch.** Until it
re-PASSes, the items above are preserved as-is on this branch.

## Next authorized work (after Wave 1)

Sequenced from the frozen scan review's execution waves (Wave 2+). These are
**not** authorized by Wave 1 and are listed for planning continuity only:

- **Wave 2 — Boundary purification:** `authz` framework-pollution audit;
  `exam-engine` dead-export pruning + `gradeQuestion` rename + `getRemainingSeconds`
  unification; `db` explicit-subpath exports; `import-export` codec boundary;
  `routeRegistry` inventory/policy split.
- **Wave 3 — Structural migration:** conditional `auth` → `apps/api/src/auth/`
  merge (after DB-seed dependency audit); Redis optionalization (compose
  profile, delete diagnostics-only tests, keep adapter); test-support
  relocations.
- **Wave 4 — Infrastructure polish:** Type 3 test deletions (after mutation
  evidence); Dockerfile build-ladder experiment (turbo vs current ladder);
  env config merge (`.env` vs `.env.example` port); verify-pipeline
  simplification; CI script consolidation.

## Authority precedence

When documents disagree, the precedence is:

1. `docs/SPEC.md` and `docs/phase-roadmap.md` (spec + phase authority).
2. Accepted ADR `Status` fields.
3. `docs/code-quality.md`.
4. Current architecture/status docs under `docs/architecture/` and
   `docs/status/`.
5. This document.

Archived and point-in-time documents (`docs/archive/`, `docs/evidence/`, and
the frozen scan files) never override the above.
