# Current Roadmap

> What is authorized now and next. This document is the operational companion
> to `docs/phase-roadmap.md` (which remains the phase-scope authority).

```text
STATUS:          CURRENT
AUTHORITY:        Roadmap (operational)
SCOPE:            Currently authorized work, next steps, and gate status
OWNER:            Architecture
BASELINE SYSTEM COMMIT:
                 e7af792815e8cf4bcff122a3d1d8db500b9d6eff (PR #197, Wave 1 base)
LAST VERIFIED REPOSITORY COMMIT:
                 c0dde8f1c11d05e78cf9dfb871afd3bbdee6daa2  (filled at corrective closeout)
SUPERSEDES:       —
RELATED ADRS:     All (status fields govern timing)
```

`docs/phase-roadmap.md` is the phase-scope authority (Phase 1 / 2 / 3 / 4).
This document states, operationally, **what may be done now, what blocks what
comes next, and the status of each simplification wave / gate.**

## Phase status (from `docs/phase-roadmap.md`)

- **Phase 1** — Minimal Deliverable Exam System. Implemented. Admin + Candidate
  core loop complete (see `docs/status/implementation-matrix.md`).
- **Phase 2** — Exam Operation. **Gate items implemented.** Proctor visibility,
  manual grading queue, retake policy, score strategy, timelines, diagnostics,
  result publishing, telemetry, and the candidate/admin permission boundary
  are in place. `timed_window` is the only timing mode; `timed_sync` / untimed
  / queue admission deferred (Phase 3).
- **Phase 3** — Collaboration, Permissions, Account Lifecycle. **Not started.**
  Scoped roles, invitation, SMTP reset, fill-blank/subjective runtime, WYSIWYG
  submit (ADR-008 Option D).
- **Phase 4** — Platformization and Integration. **Not started.**

## Project Simplification Wave status

```text
Architecture scan:          COMPLETED
Wave 0 (verdict freeze):    COMPLETED
Wave 1A (document authority): COMPLETED
Wave 1B (mechanical + test cleanup):
                            COMPLETED — CORRECTIVE REVIEW OPEN
Wave 1 closeout:            IN PROGRESS
Gate 0.5 (M10-F post-PR197 rerun):
                            PENDING
                            (no fresh post-PR-197 M10-F PASS evidence exists;
                             see docs/evidence/RBAC-M10-F-FINAL-VERIFICATION-1.md
                             invalidation notice; required file
                             docs/evidence/rbac-m10-closure-after-pr197.md
                             does not yet exist)
```

Wave 1 initial execution completed. **Corrective closeout remains open.**

## Currently authorized work

**Project Simplification Wave 1 Corrective** (this branch,
`chore/project-simplification-wave1`). The corrective is additive on top of
the five Wave 1 commits; it does not squash, reset, rebase, or rewrite them.
Scope:

1. Reconcile M10-F status against actual post-PR-197 evidence (Gate 0.5).
2. Correct roadmap / status authority to match reality.
3. Distinguish baseline system commit from last verified repository commit in
   every current-authority document.
4. Documentation reference-integrity audit and link repair.
5. Restore the permission-matrix negative control (`"unexpected"` branch).
6. Restore the missing Web login HTTP-client contract (client/server wire
   compatibility).

## Forbidden in Wave 1 (and this corrective)

The following are **out of scope** for Wave 1 and this corrective and must not
be done on this branch:

- Merging `authz` / `exam-engine` / `import-export` into `apps/api`.
- Moving the `auth` package (conditional merge blocked on DB-seed audit).
- Deleting Redis or changing its default policy.
- Deleting Type 3 RBAC / security / permission-boundary tests (blocked on
  mutation evidence and Gate 0.5).
- Moving or rewriting `routeRegistry.ts`.
- Changing Docker build ordering.
- Deleting `smoke`, `docker-compose.test.override.yml`, or
  `scripts/rebuild-all.sh`.
- Any Wave 2 boundary-purification work.

## Blocking gates before any RBAC-sensitive change

Gate 0.5 (M10-F post-PR-197 rerun) is **PENDING**. The following are blocked
until a fresh post-PR-197 M10-F PASS is produced and independently supported
(see the invalidation notice on
`docs/evidence/RBAC-M10-F-FINAL-VERIFICATION-1.md`):

- Deleting `packages/auth/src/rbac.ts`.
- Deleting the `requirePermission` implementation/type declaration.
- Deleting Type 3 authorization tests.
- Refactoring the route authorization oracle.
- Deleting permission compatibility evidence.
- Moving authz enforcement code.
- Modifying route authorization metadata.

**M10-F re-execution may proceed in parallel on a separate branch.** Until it
re-PASSes, the items above are preserved as-is on this branch.

## Strategic direction status

These record how currently-undecided directions are treated. They are not
implementation commitments.

```text
Multi-tenant (multiTenant):
                 PROPOSED — NOT AUTHORIZED
                 Optional multiTenant is Phase 4 platformization only.
                 Not authorized in any current wave; no tenant switcher,
                 organizationSlug login, SuperAdmin, or cross-tenant surface
                 may be introduced before Phase 4.

Desktop client:
                 Runtime container TBD
                 No accepted ADR fixes the implementation technology.
                 ADR-004 records Desktop/Electron as DEFERRED; `apps/desktop/`
                 does not exist and `controlFlags.requireLockdown` is
                 schema-only. Whether the future client is Electron or another
                 runtime container is undecided.
```

## Next authorized work (after Wave 1 corrective)

Sequenced from the frozen scan review's execution waves (Wave 2+). These are
**not** authorized by Wave 1 or this corrective and are listed for planning
continuity only:

- **Wave 2 — Boundary purification:** `authz` framework-pollution audit;
  `exam-engine` dead-export pruning + `gradeQuestion` rename + `getRemainingSeconds`
  unification; `db` explicit-subpath exports; `import-export` codec boundary;
  `routeRegistry` inventory/policy split.
- **Wave 3 — Structural migration:** conditional `auth` → `apps/api/src/auth/`
  merge (after DB-seed dependency audit); Redis optionalization (compose
  profile, delete diagnostics-only tests, keep adapter); test-support
  relocations.
- **Wave 4 — Infrastructure polish:** Type 3 test deletions (after mutation
  evidence and Gate 0.5); Dockerfile build-ladder experiment (turbo vs current
  ladder); env config merge (`.env` vs `.env.example` port); verify-pipeline
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
