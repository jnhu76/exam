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
                 2ca3d687371a2f20eec518634d2e70c2c03421f5  (filled at corrective closeout)
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
  event stream, live polling dashboard, incident logging, force-submit,
  extend-time, misconduct flag, attempt timeline, manual grading queue, retake
  policy, score strategy, diagnostics, result publishing, telemetry, and the
  candidate/admin permission boundary are in place. `timed_window` is the only
  timing mode; `timed_sync` / untimed / queue admission are not implemented
  (Phase 3). See `docs/status/implementation-matrix.md` for the per-capability
  breakdown (force-submit/extend-time/misconduct are IMPLEMENTED, each with
  route + transaction + contract + capability gate + UI + tests).
- **Phase 3** — Collaboration, Permissions, Account Lifecycle.
  **Partially implemented — product workflow incomplete.** The authorization
  *infrastructure* is already built: the permission catalog, role presets,
  scoped/scored capability resolvers, assignment-backed runtime authority
  (RBAC-M10-E), and the candidate/admin permission boundary are live and
  enforced on every route. What is **NOT** done is the Phase 3 *product* work:
  scoped Teacher/Proctor/Grader/ContentManager role bundles as product roles,
  staff invitation, SMTP-based password reset, full account
  activation/deactivation lifecycle, audit-log search/export UI, fill-blank +
  subjective/rich-text runtime and grading, and WYSIWYG submit (ADR-008 Option
  D). Note: the proctor *authority actions* (force-submit, extend-time,
  misconduct) are already implemented under the Admin role (Phase 2), not
  waiting on a Proctor product-role bundle.
- **Phase 4** — Platformization and Integration. **Not started.**

## Project Simplification Wave status

```text
Architecture scan:            COMPLETED
Wave 0 (verdict freeze):      COMPLETED
Wave 1A (document authority): COMPLETED
Wave 1B (mechanical + test cleanup):
                              COMPLETED
Wave 1 corrective:            COMPLETED
Wave 1 closeout:              READY FOR MERGE
```

Wave 1 (initial execution + corrective) is complete. PR #198 carries the full
Wave 1 change set.

## Gate 0.5 (M10-F post-PR-197 rerun)

```text
Gate 0.5:    PENDING
```

No fresh post-PR-197 M10-F PASS evidence exists; the existing
`docs/evidence/RBAC-M10-F-FINAL-VERIFICATION-1.md` (base `94bc020`, pre-PR-197)
carries an INVALIDATION NOTICE, and the required
`docs/evidence/rbac-m10-closure-after-pr197.md` does not yet exist.

**Gate 0.5 effect:** blocks **future** RBAC-sensitive changes only (deleting
`packages/auth/src/rbac.ts` / `requirePermission`, Type 3 authorization tests,
refactoring the route authorization oracle, moving authz enforcement code,
modifying route authorization metadata). **It does NOT block PR #198.** An
independent review confirms PR #198 does not modify production authorization
enforcement, Redis, Docker, the route registry, or any Type 3 security test —
the RBAC-sensitive surface is untouched. Gate 0.5 may be closed by a parallel
M10-F rerun branch.

## E2E status

```text
Local E2E (this worktree):    NOT RUN — host port conflict
                              (main worktree's exam-db-1:15432 + exam-redis-1:6379
                               occupy the ports scripts/e2e/run-wsl.sh binds; the
                               runner has no Redis-port override). Environmental,
                               not a suite defect.

PR #198 CI E2E:               PASS — shard 1/2
                              PASS — shard 2/2
```

E2E is enabled, present (18 specs under `apps/e2e/e2e/`, including the three
declared blockers `candidate-happy-path`, `resume-attempt`, `submit-flush`),
and runs as **blocking CI** (sharded `e2e` job in
`.github/workflows/ci.yml`). Both shards passed on PR #198. E2E is therefore
not a blocker for this PR; the earlier "E2E re-enable as next work" framing
was inaccurate — E2E was already enabled and blocking.

## Wave 1 scope (what was done, now complete)

Wave 1 (initial execution + corrective) on branch
`chore/project-simplification-wave1` (PR #198):

- **Wave 1A** — documentation authority reconstruction (8 new current-authority
  docs; point-in-time/superseded material moved to `docs/archive/`; closure
  evidence moved to `docs/evidence/`).
- **Wave 1B** — mechanical deletions (`packages/exam-engine/src/types.ts`,
  `scripts/check-e2e-artifacts.mjs`, `package.json` `seed:e2e` +
  `verify:nodb-tests`); Type 1 + Type 2 duplicate-test removal.
- **Corrective-1** — M10-F invalidation, roadmap/status correction,
  baseline-vs-last-verified commit distinction, document link audit,
  restored permission-matrix negative control, restored login HTTP-client
  contract.
- **Corrective-2** — corrected capability authority (force-submit/extend-time/
  misconduct are IMPLEMENTED; proctor split into specific capabilities; Redis
  refined), corrected Phase 3 framing, fixed `docs/CURRENT.md` dead navigation,
  removed the inaccurate "E2E re-enable" TODO, removed redundant `.bak`,
  restored permission-matrix transport coverage.

## Forbidden in Wave 1

The following were **out of scope** for Wave 1 and were not done on this branch:

- Merging `authz` / `exam-engine` / `import-export` into `apps/api`.
- Moving the `auth` package (conditional merge blocked on DB-seed audit).
- Deleting Redis or changing its default policy.
- Deleting Type 3 RBAC / security / permission-boundary tests.
- Moving or rewriting `routeRegistry.ts`.
- Changing Docker build ordering.
- Deleting `smoke`, `docker-compose.test.override.yml`, or
  `scripts/rebuild-all.sh`.
- Any Wave 2 boundary-purification work.

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
