# Architecture Scan Findings — exam platform

**Date:** 2026-07-21
**Mode:** Read-only audit
**Scope:** apps/\*, packages/\*, scripts/\*, docs/\*, docker/\*, config files, CI workflows, test suites
**Branch:** feat/project-simplification-architecture-scan (after PR #196)

## Executive Summary

The exam platform's architecture is _well-layered_ for its domain (exam lifecycle, attempt lifecycle, grading, RBAC), but carries **substantial Phase 1 dead weight** from planning artifacts and forward-looking infrastructure. The scan identified **~15 high-confidence deletions** and **~12 simplification opportunities** that would reduce total concepts by ~40% without losing any protected invariant.

### Key metrics

| Metric | Current | Target | Reduction |
|--------|---------|--------|-----------|
| Packages | 7 | 3 | 57% |
| ADRs | 11 | 6 | 45% |
| Role/permission registries | 3 | 1 | 67% |
| Lint scripts | 16 | ~10 | 38% |
| Test redundancy | ~500 LOC | 0 | 100% |
| Infrastructure deps | 2 (PG + Redis) | 1 (PG only) | 50% |

---

## 1. Executive Complexity Diagnosis

The codebase is healthy where it matters: the exam state machine, attempt lifecycle, grading engine, RBAC capability layer, and answer protocol are all single-authority, well-tested modules. The complexity is _accidental_ — it comes from:

1. **Package split without consumer diversity**: 4 of 7 packages have no consumer outside `apps/api`. The build boundary adds 4× config files, 4× build steps, and the deep-import pattern that subverts barrels.
2. **ADR proliferation**: 11 ADRs, but 3 are the same topic (ADR-007 × 3), 2 describe unused infrastructure, 1 is a wishlist. Only 6 are active architectural decisions.
3. **Script/config sprawl**: 16 lint scripts, but 2 duplicate each other, 1 duplicates an ESLint rule, 1 is always-failing, 3 are unwired.
4. **Test redundancy**: 7 test files/blocks prove the same invariants as richer surviving tests.
5. **Redis as dead infrastructure**: 1 production consumer (diagnostics ping), 0 business paths, yet it ships in all docker-compose files and has its own plugin + test suite.

**The preferred result is not a more sophisticated architecture. The preferred result is a smaller architecture that still protects all real product, security, transaction, concurrency, and lifecycle invariants.**

---

## 2. Current Authority / Source-of-Truth Map

| Concern | Authoritative source | Competing sources | Verdict |
|---------|---------------------|-------------------|---------|
| Role/Permission registry | `authz/catalog.ts` | `domain/enums.ts`, `auth/rbac.ts`, `authz/legacyMap.ts` | 3 competitors, 1 dead |
| Exam state machine | `exam-engine/examStateMachine.ts` | — | Single authority |
| Attempt state machine | `exam-engine/attemptStateMachine.ts` | — | Single authority |
| Grading logic | `domain/gradingEngine.ts` | — | Single authority |
| API contracts | `packages/contracts/src/` | — | Single authority |
| Time authority | `api/plugins/now.ts` | — | Single authority |
| DOM status tone | `web/lib/statusMeta.ts` + `StatusBadge` | — | Single authority |
| RBAC capabilities | `authz/src/` + `api/src/authz/` | `auth/rbac.ts` (dead) | Split across 2 packages |
| Test isolation | `db/src/testScope.ts` | ADR-007 × 3 | Triplicated docs |
| Audit durability policy | `api/src/audit/auditPolicy.ts` | ADR-006 (2026-07-21 corrective) | Heavy for Phase 1 |
| Infrastructure deps | PostgreSQL only | Redis (ADR-001, unused) | 1 unused dep |

---

## 3. Package and Module Dependency Findings

### Finding 3.1 — Four packages with no consumer diversity

| Package | Consumers | Real callers | Verdict |
|---------|-----------|-------------|---------|
| `packages/auth` | 55 deep-imports, all in `apps/api` + `db` seed | Barrel: `export {}` (dead) | MERGE into `apps/api` |
| `packages/authz` | `apps/api` + `apps/web` (constants only) | Barrel: 0 importers | MERGE into `apps/api` |
| `packages/exam-engine` | 16 imports, all in `apps/api` | — | MERGE into `apps/api` |
| `packages/import-export` | 2 imports, both in `apps/api` | One 44-line csv.ts file | MERGE into `apps/api` |

**Simpler shape:** 3 packages (`domain`, `contracts`, `db`). Auth, authz, exam-engine, and import-export become internal directories under `apps/api/src/`.

### Finding 3.2 — Triple role/permission registry

- `packages/domain/src/enums.ts` — SCREAMING_SNAKE `Permission` + `Role` (legacy)
- `packages/auth/src/rbac.ts` — `ROLE_PERMISSIONS` flat map (0 callers — DEAD)
- `packages/authz/src/catalog.ts` — dotted `Permission` + `Role` (authoritative)
- `packages/authz/src/legacyMap.ts` — 87-line 1:1 bridge

**What can be deleted:** `auth/rbac.ts` (0 callers confirmed), `legacyMap.ts` (after migration), legacy `Permission`/`Role` from `domain/enums`. `requirePermission` decorator (0 route consumers).

### Finding 3.3 — Dead exports in exam-engine

- `packages/exam-engine/src/types.ts` — 3 `declare function` stubs, 0 callers → DELETE
- `packages/exam-engine/src/index.ts:3-9` — 6 re-exports with 0 external consumers → DELETE
- `packages/exam-engine/src/timer.ts:10` `getRemainingSeconds` — 0 prod callers; web reimplements → UNIFY
- `packages/exam-engine/src/grading.ts:429` `gradeAttempt` — "retained for test compatibility" → MOVE to test helper
- `packages/exam-engine/src/attemptCommands.ts:91` `startAttempt` — tests only → MOVE to test helper

### Finding 3.4 — `gradeQuestion` name collision

- `packages/domain/src/gradingEngine.ts:129` — pure per-question auto-grader
- `packages/exam-engine/src/manualGrading.ts:86` — side-effectful command mutating DB

**Rename:** engine's `gradeQuestion` → `completeManualGrade` or `gradeQuestionCommand`.

### Finding 3.5 — `routeRegistry.ts` is a test fixture in production

`apps/api/src/authz/routeRegistry.ts` (1061 LOC) is a declarative route→permission catalog with **zero production consumers**. Only two test files reference it. Move to `apps/api/src/authz/__tests__/routeRegistry.ts`.

---

## 4. ADR/Code Conformance Findings

### Per-ADR verdicts

| ADR | Decision | Verdict | Justification |
|-----|----------|---------|---------------|
| ADR-001 Redis | Optional baseline, off by default | **ADR_OVERDESIGNED** | 1 production read site (diagnostics ping). No business path uses Redis. |
| ADR-002 WebSocket/SSE | HTTP polling first | **CODE_CONFORMS** | No WS/SSE endpoint exists. Proctor uses HTTP polling. |
| ADR-003 Job Queue | Defer, prefer PG-backed | **CODE_CONFORMS** | Email outbox + grading queue are PG-backed. No BullMQ. |
| ADR-004 Desktop/Electron | Defer to Phase 3+ | **CODE_CONFORMS** | `apps/desktop/` does not exist. Pure planning artifact. |
| ADR-005 Exam operations | 3-axis state model + lock-reconcile-assert-mutate | **CODE_CONFORMS** | Every Slice 1–4 item implemented exactly as specified. |
| ADR-006 Time authority | `fastify.now()` is the only clock API | **CODE_CONFORMS** | Plugin, structural test, zoned allowlist all match. |
| ADR-007 (flake-and-speed) | Phase 6 close-out: verify ~330s→~123s | **BOTH_NEED_SIMPLIFICATION** | Stale snapshot; references deleted scripts. |
| ADR-007 (evidence-gap) | Verifies flake-and-speed claims | **ADR_OBSOLETE** | Recommended scripts never landed. |
| ADR-007 (stateful-isolation) | Single test-scope model | **ADR_OVERDESIGNED** | Phase 7 (Redis/Queue) deferred; unused prefix plumbing. |
| ADR-008 Submit freeze | Single-transaction submit + grade + finalize | **CODE_CONFORMS** | J1 fix in place; tests assert all invariants. |
| ADR-009 Frontend FSM | Adopt reducer + transition table | **CODE_DIVERGES** | "No code implemented" by design (Proposed). Wishlist. |

### Simplification opportunities

1. **ADR-001 — Redis is dead weight.** Remove Redis service, plugin, test files, and config. The `redis-fallback-guard.test.ts` exists only to prove nothing uses Redis.
2. **ADR-007 trio → one doc.** Two are point-in-time audit reports; merge into `docs/dev/test-flakes.md`. Keep only `ADR-007-stateful-infrastructure-test-isolation.md` as the real ADR.
3. **Archive ADR-001, ADR-004, ADR-009.** ADR-001 (Redis) and ADR-004 (Electron) describe unused infrastructure. ADR-009 is a wishlist with "No code implemented."
4. **ADR-007 references missing docs.** `docs/dev/test-ci-parallelism-plan.md` and `docs/dev/test-suite-taxonomy.md` are cited but do not exist.

---

## 5. Redundant Test Findings

### Deletion candidates with surviving evidence

| Delete | Surviving test | Confidence | Evidence rationale |
|--------|---------------|------------|-------------------|
| `mutation-campaign-results/` | (none — gitignored, untracked) | HIGH | Pure throwaway artifacts |
| `submitAndGradeAttempt.test.ts` | `candidate-save-submit.test.ts` lines 602, 629, 1129 | HIGH | All 4 tests subsumed |
| `adminSuperset.test.ts` (api) | `adminCompatibility.test.ts` (authz) | HIGH | Stronger: covers non-route perms too |
| `permissionMatrix.helpers.test.ts` | 4 `permissionMatrix.*.test.ts` files | MEDIUM | Test-of-test; exercised indirectly |
| `permissionMatrix.fixture.test.ts` | 4 `permissionMatrix.*.test.ts` files | MEDIUM | Test-of-test; exercised indirectly |
| `login.integration.test.tsx` (web) | `LoginPage.test.tsx` | HIGH | 4× richer |
| `sanitizeClientEvent.test.ts` (web re-export) | `contracts/__tests__/sanitizeClientEvent.test.ts` | HIGH | Tests a re-export, no web-side impl |
| `unauthorized-access.test.ts` AC2 block (lines 122-158) | `permissionBoundary.test.ts` lines 245, 295, 779-985 | MEDIUM | Strict subset of M10-C matrix |
| `rbac-matrix.test.ts` AC1/AC5/AC6 (keep AC4+AC7) | `permissionBoundary.test.ts` + `m10dPermissionBoundary.test.ts` | MEDIUM | Unique smoke evidence preserved |

### Recommended test clusters — KEEP

- All 6 `apps/api/src/runtime/*.structural.test.ts` — prevent historical regressions
- `packages/exam-engine/src/grading{Poison,ScoreIdentity,Aggregation}.test.ts` — distinct mutation-killing proofs
- `apps/api/src/routes/submitFreezeBarrier.test.ts` — only real-Postgres save-vs-submit race proof
- `apps/api/src/authz/routeRegistryConformance.test.ts` (937 LOC) — only check for vacuous-pass hole
- `apps/api/src/authz/assignmentAuthorityRuntime.test.ts` (807 LOC) — only HTTP-layer JWT role proof
- `apps/web/src/pages/exam/TakeExamPage.snapshot.test.tsx` — despite misleading name, only FSM-0 take proof

### Repeated fixtures

- 7 `apps/api/tests/security/*.test.ts` files copy the same ~50-line `setupApiTestDatabaseFromEnv` → `migratePostgres` → `seed` → `signJWT` block. Extract `buildSecurityTestApp` helper.
- 23 `apps/web/src/pages/admin/*.test.tsx` files repeat `AuthProvider initialUser={{ ... permissionsForRole("Admin") }}`. Extract `renderAdminPage` helper.

---

## 6. Config / Docker / Script Findings

### Dead scripts

| Script | Why dead | Action |
|--------|----------|--------|
| `scripts/check-e2e-artifacts.mjs` | Asserts CI substrings that no longer exist | DELETE |
| `scripts/check-docstring-coverage.mjs` | No gate exit code; not wired | DELETE or wire |
| `scripts/check-test-env-contract.mjs` | Not wired; regex-test of CI text | DELETE or wire |
| `scripts/check-test-time-contract.mjs` | Not wired; overlaps with check-test-env | DELETE or MERGE |
| `scripts/rebuild-all.sh` | Duplicates `pnpm --filter "./packages/*" build` | DELETE |

### Duplicate scripts

| Script | Duplicate of | Action |
|--------|-------------|--------|
| `seed:e2e` (package.json:33) | `db:seed:e2e` (package.json:32) | DELETE `seed:e2e` |
| `test:integration` (root + turbo + api + db) | `test` (byte-identical) | DELETE everywhere |
| `check-raw-color-usage.mjs` | `check-token-bypass.mjs` (both flag arbitrary-value color) | MERGE |
| `check-high-font-weight.mjs` | `exam-ui/no-heavy-font-weight` ESLint rule | DELETE (after extending ESLint glob to .css) |

### Drift

| Item | Detail | Action |
|------|--------|--------|
| `verify` re-spells `verify:static` prefix | `package.json:38` vs `:44` drift independently | SIMPLIFY: `pnpm verify:static && coverage && build` |
| `docker-compose.test.override.yml` | Only referenced in comments | DELETE or promote |
| `.env` (15432) vs `.env.example` (5432) | Opposite default ports | MERGE to one default |
| `.env.test.example` | 6-line subset of `.env.example` | MERGE into `.env.example` |
| `lint:md` (`package.json:18`) | Dep installed + configured but never wired | Wire into `verify:static` or DELETE |
| `smoke` (`package.json:37`, `turbo.json:78`) | Defined but not wired | Wire or DELETE |
| `verify:nodb-tests` (`package.json:43`) | Only in archived docs | DELETE |
| Dockerfile per-package build ladder | `Dockerfile:33-55` hand-maintained topo sort | SIMPLIFY: `pnpm --filter "./packages/*" build` |

### Three databases — KEEP

The `exam` / `exam_test` / `exam_e2e` split is load-bearing. Each has a distinct purpose and cannot be merged safely:
- `exam_test` vs `exam`: vitest's worker-DB isolation would destroy dev data.
- `exam_e2e` vs `exam_test`: E2E reseeds to known demo state every run; vitest isolation would collide.

---

## 7. Incomplete Vertical-Slice Findings

### Phase 2 features partially implemented

The following features have **both backend routes and frontend UI pages** but are documented as Phase 2:

| Feature | Backend | Frontend | Status |
|---------|---------|----------|--------|
| Proctor monitoring | `routes/proctorMonitoring.ts` | `ProctorDashboardPage.tsx`, `ProctorWorkspacePage.tsx` | Fully implemented (polling, not real-time) |
| Force-submit / extend-time / misconduct | `routes/attempts.admin.ts` (lines 117-168) | `ProctorDashboardPage.tsx` | Backend + UI exist |
| Manual grading queue | `routes/gradingQueue.ts` | `GradingQueuePage.tsx`, `GradingDetailPage.tsx` | Fully implemented |
| `canceled` exam state | `routes/exam.ts` (cancel + archive) | `ExamDetailPage.tsx` | Implemented per ADR-005 Slice 4 |

These are **not incomplete** — they are Phase 2 features that were delivered ahead of the roadmap. The Phase 1 documentation is what's stale (claims "Phase 2 not implemented").

### Schema fields with no Phase 1 consumer

The following fields exist in `packages/domain/src/types.ts` but are always `false`/`0`/`""` in Phase 1 (stored in `controlFlags` JSONB column):

| Field | Domain type | DB schema | Phase 1 behavior |
|-------|-------------|-----------|------------------|
| `requireQueue` | `ControlFlags` | JSONB (default false) | Never used |
| `batchSize` | `ControlFlags` | JSONB (default 0) | Never used |
| `batchInterval` | `ControlFlags` | JSONB (default 0) | Never used |
| `requireLockdown` | `ControlFlags` | JSONB (default false) | Never used |
| `restrictIp` | `ControlFlags` | JSONB (default false) | Never used |

These are **intentional design** — the JSONB column allows the contract to be forward-looking without migration. Not a simplification target, but flagging as documentation.

### Timing modes not used in Phase 1

| Mode | Enums | Phase 1 |
|------|-------|---------|
| `timed_window` | `TimingMode.TimedWindow` | ✅ Phase 1 |
| `timed_sync` | `TimingMode.TimedSync` | ❌ Phase 2 |
| `deadline` | `TimingMode.Deadline` | ❌ Phase 2 |
| `untimed` | `TimingMode.Untimed` | ❌ Phase 2 |

---

## 8. Unified Cleanup Manifest

### DELETE (no regression risk)

| ID | Item | Evidence required |
|----|------|-------------------|
| A1 | `packages/auth/src/rbac.ts` | 0 callers confirmed |
| A2 | `packages/exam-engine/src/types.ts` | 0 callers confirmed |
| A3 | 6 dead re-exports from `exam-engine/src/index.ts:3-9` | rg confirms 0 external consumers |
| A4 | `requirePermission` decorator in `plugins/auth.ts` | 0 route consumers |
| A5 | `mutation-campaign-results/` directory | gitignored, untracked, unreferenced |
| A6 | `test:integration` everywhere (root + turbo + api + db) | ADR-007 already calls it removed |
| A7 | `seed:e2e` (duplicate of `db:seed:e2e`) | byte-identical |
| A8 | `scripts/check-e2e-artifacts.mjs` | CI mismatch; not wired |
| A9 | `scripts/rebuild-all.sh` | `pnpm --filter "./packages/*" build` |
| A10 | `docker-compose.test.override.yml` | only referenced in comments |
| A11 | `submitAndGradeAttempt.test.ts` | `candidate-save-submit.test.ts` preserves |
| A12 | `adminSuperset.test.ts` (api) | `adminCompatibility.test.ts` (authz) preserves |
| A13 | `permissionMatrix.{helpers,fixture}.test.ts` | 4 matrix files exercise indirectly |
| A14 | `login.integration.test.tsx` (web) | `LoginPage.test.tsx` preserves |
| A15 | `sanitizeClientEvent.test.ts` (web) | `contracts/__tests__` preserves |
| A16 | `unauthorized-access.test.ts` AC2 block | `permissionBoundary.test.ts` preserves |
| A17 | `rbac-matrix.test.ts` AC1/AC5/AC6 blocks | Keep AC4 + AC7 |
| A18 | `verify:nodb-tests` | Only in archived docs |
| A19 | `smoke` (root + turbo) | Not wired anywhere |
| A20 | `check-docstring-coverage.mjs` | Not a gate (no exit code) |
| A21 | `check-test-env-contract.mjs` | Not wired; CI text regex test |
| A22 | `check-test-time-contract.mjs` | Not wired; overlaps with env contract |

### SIMPLIFY (merge or restructure)

| ID | Item | Action |
|----|------|--------|
| B1 | `packages/auth`, `authz`, `exam-engine`, `import-export` | Inline into `apps/api` |
| B2 | `domain/enums.Permission` + `auth/rbac` + `authz/legacyMap` | Collapse to single registry |
| B3 | Redis infrastructure | Remove all: plugin, compose services, test files, config |
| B4 | `verify` (package.json:38) | Reuse `verify:static` prefix |
| B5 | `check-raw-color-usage.mjs` + `check-token-bypass.mjs` | Merge into one scanner |
| B6 | `check-high-font-weight.mjs` | Delete after extending ESLint glob to .css |
| B7 | `packages/db/src/test*.ts` + `api/src/routes/test{Redis,Database}.ts` | Move to test trees |
| B8 | `apps/api/src/authz/routeRegistry.ts` | Move to `__tests__/` |
| B9 | `gradeQuestion` in `manualGrading.ts` | Rename to `completeManualGrade` |
| B10 | `getRemainingSeconds` | Unify: export from engine, import in web |
| B11 | ADR-007 trio | Merge 2 reports into `docs/dev/test-flakes.md` |
| B12 | ADR-001, ADR-004, ADR-009 | Archive (move to `docs/archive/`) |
| B13 | Dockerfile build ladder | Simplify to `pnpm --filter "./packages/*" build` |
| B14 | `.env` vs `.env.example` vs `.env.test.example` | Pick one port default; merge `.env.test.example` |
| B15 | `lint:md` | Wire into `verify:static` or DELETE |
| B16 | `lint:eslint` | Wire `no-console` to replace `check-code-quality.mjs` |
| B17 | `check-stale-ui-docs.mjs` | Fold into `check-ant-residue.mjs` docs pass |

### KEEP (no action)

| ID | Item | Why |
|----|------|-----|
| C1 | 3-DB split (exam/test/e2e) | Load-bearing for each purpose |
| C2 | 6 structural tests | Prevent historical regressions |
| C3 | Grading poison/identity/aggregation tests | Distinct mutation-killing proofs |
| C4 | `submitFreezeBarrier.test.ts` | Only real-Postgres race proof |
| C5 | State-machine tests (3 layers) | VALUABLE_OVERLAP, not redundant |
| C6 | `packages/domain` | Leaf node, genuinely shared |
| C7 | `packages/contracts` | Shared by api + web + db |
| C8 | `packages/db` | Shared by api + scripts |
| C9 | `check-ant-residue.mjs` | Unique ban guard |
| C10 | `check-row-action-icons.mjs` | Unique ban guard |

---

## 9. Governing Principle Audit

For every finding, we applied the governing principle in order:

1. **Delete** — 22 items (A1-A22)
2. **Merge** — 5 items (B1, B2, B5, B11, B14)
3. **Reuse** — 1 item (B4: verify → verify:static)
4. **Make direct** — 3 items (B7, B8, B10)
5. **Document an invariant** — 0 items (all structural tests already exist)
6. **Add abstraction** — 0 items (no new abstractions proposed)

**No finding introduces a new abstraction for the sake of cleaner architecture.**

---

## 10. First-priority recommendation

**Merge ghost packages into the api** (B1). This is the highest-ROI simplification because:

- Reduces monorepo packages from 7 to 3 (57% reduction)
- Eliminates the deep-import pattern that already subverts 4 barrels
- Removes the most confusing package boundary (auth vs authz — same concern, split by internal seam)
- Simplifies the Dockerfile per-package build ladder
- Is a prerequisite for several other cleanups (B2 triple registry, B3 Redis, B10 dead exports)

Estimated effort: 1-2 days for the merge, 1 day for test path updates.