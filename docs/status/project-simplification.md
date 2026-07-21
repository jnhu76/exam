# Project Simplification Status

> Operational status of the project-simplification effort. Single source of
> truth for wave / gate / closeout state.

```text
STATUS:          CURRENT
AUTHORITY:        Status (simplification effort)
SCOPE:            Project Simplification waves, gates, and closeout
OWNER:            Architecture
BASELINE SYSTEM COMMIT:
                 e7af792815e8cf4bcff122a3d1d8db500b9d6eff (PR #197, Wave 1 base)
LAST VERIFIED REPOSITORY COMMIT:
                 c0dde8f1c11d05e78cf9dfb871afd3bbdee6daa2  (filled at corrective closeout)
SUPERSEDES:       —
RELATED ADRS:     — (governed by docs/architecture/* and docs/roadmap/current.md)
```

## Wave / gate status

```text
Architecture scan:                              COMPLETED
  - docs/architecture-scan-findings-2026-07-21.md  (frozen)
  - docs/architecture-scan-review-2026-07-21.md    (frozen, verified)

Wave 0 (verdict freeze):                        COMPLETED
  - Package verdicts frozen in the scan review.
  - ADR status labels confirmed; ADR-001/004/009 retained (not archived).

Wave 1A (document authority reconstruction):    COMPLETED
  - 8 current-authority documents created under docs/README.md,
    docs/architecture/, docs/status/, docs/roadmap/, docs/adr/README.md.
  - Point-in-time / superseded material moved to docs/archive/ (6 subdirs).
  - Final closure / verification proof moved to docs/evidence/.

Wave 1B (mechanical + test cleanup):            COMPLETED — CORRECTIVE REVIEW OPEN
  - Mechanical deletions:
      packages/exam-engine/src/types.ts
      scripts/check-e2e-artifacts.mjs
      package.json seed:e2e  (duplicate of db:seed:e2e)
      package.json verify:nodb-tests  (no callers)
  - Type 1 test deletions (mechanical duplicates):
      apps/web/src/lib/sanitizeClientEvent.test.ts
      apps/api/src/authz/permissionMatrix.helpers.test.ts
      apps/api/src/authz/permissionMatrix.fixture.test.ts
  - Type 2 test deletions (behaviorally redundant):
      apps/api/src/orchestrators/submitAndGradeAttempt.test.ts
      apps/web/src/__tests__/integration/login.integration.test.tsx
  - Corrective review open: see Corrective-1 items below.

Wave 1 closeout:                                IN PROGRESS

Gate 0.5 (M10-F post-PR197 rerun):              PENDING
  - Existing evidence docs/evidence/RBAC-M10-F-FINAL-VERIFICATION-1.md
    is PRE-PR197 (base 94bc020, ancestor of PR197 e7af792) and is marked
    INVALIDATED as current closure.
  - Required fresh evidence docs/evidence/rbac-m10-closure-after-pr197.md
    does NOT yet exist.
  - RBAC-sensitive changes remain blocked (see docs/roadmap/current.md).
```

## Wave 1 initial execution

Wave 1 initial execution completed. **Corrective closeout remains open.**

This status file does not claim "all work completed." The corrective review
must close before Wave 1 is declared done.

## Corrective-1 open items

1. **M10-F reconciliation** — Gate 0.5 is PENDING; invalidation header added
   to the old evidence file; no fresh post-PR-197 PASS exists.
2. **Roadmap / status correction** — Wave status, multi-tenant
   (PROPOSED — NOT AUTHORIZED), desktop (Runtime container TBD), and the
   baseline-vs-last-verified commit distinction are reflected here and in
   `docs/roadmap/current.md`.
3. **Document metadata correction** — every current-authority document now
   distinguishes `Baseline system commit` from
   `Last verified repository commit`.
4. **Documentation reference-integrity audit** — see
   `docs/evidence/wave1-document-link-audit.md`.
5. **Permission-matrix negative control** — restored as a compact targeted
   test (`permissionMatrix.verdict.test.ts`) preserving the `"unexpected"`
   classification branch.
6. **Web login HTTP-client contract** — restored as an MSW HTTP-boundary test
   (`api.auth.test.ts`) owning client/server wire compatibility.
7. **E2E status** — see "E2E status" below.

## E2E status

```text
E2E: NOT RUN — host port conflict (environmental, not a suite defect)
```

The E2E suite is enabled, present (18 specs under `apps/e2e/e2e/`, including
the three declared blockers `candidate-happy-path.spec.ts`,
`resume-attempt.spec.ts`, `submit-flush.spec.ts`), and wired into CI
(`.github/workflows/ci.yml` `e2e` job, sharded). The WSL runner
(`scripts/e2e/run-wsl.sh`) and Docker runner (`scripts/e2e/run.sh`) both
exist.

**Why it was NOT RUN in this corrective:** the WSL E2E runner starts its own
dev compose (`docker-compose.dev.yml`) that binds host ports 15432 (postgres)
and 6379 (redis). Both are already held on this host by the main worktree's
long-running dev containers (`exam-db-1` on 15432, `exam-redis-1` on 6379,
both up ~28h). The runner supports a `DB_HOST_PORT` override but **no Redis
port override**, so two worktrees cannot run dev compose simultaneously on
one host. This is an environment constraint, not a test or suite defect.

**Blocking-CI classification:** AGENTS.md (current roadmap authority) and
`docs/phase-roadmap.md` declare "E2E re-enable for happy path / resume /
submit-flush as blocking CI" as the **next authorized work after Phase 1
singleTenant cleanup**. It is therefore an **active declared blocker that is
not yet resolved**, not deferred work. Wave 1 (docs + mechanical + targeted
test cleanup) does not touch E2E specs or the E2E runner, so this corrective
does not change E2E status. The E2E re-enable decision belongs to the next
authorized work item, not to this corrective.

**Waiver rationale for this corrective:** this branch does not modify any E2E
spec, the E2E runner, route handlers, or authz enforcement. The risk that
Wave 1 changes (doc moves, deletion of dead `types.ts`/scripts, removal of
duplicate tests, restoration of the verdict/login-contract tests) altered
E2E behavior is negligible because `pnpm verify` (full unit + coverage +
build) passes and no production runtime path was changed. E2E must still be
run before the E2E-re-enable gate is declared closed; that is separate work.

## Forbidden in this corrective

- Wave 2 work (boundary purification, package moves, routeRegistry split).
- Any package merge.
- Any RBAC-sensitive change while Gate 0.5 is PENDING.
- Squashing, resetting, rebasing, or rewriting the five Wave 1 commits.
