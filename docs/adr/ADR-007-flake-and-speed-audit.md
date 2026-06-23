# ADR-007 Flake & Test Speed Audit Report

## 1. Executive Summary

ADR-007 is **not complete**. Phases 2A–5B are landed with stress evidence, but
Phase 6 (CI shard) has only config preparation — no live CI validation. The
root causes of BUG-FLAKE-001 through 004 are structurally fixed by the per-file
schema isolation (B方案), but **no mitigation has been removed**: `fileParallelism:
false`, `verify:db-tests` serial chain, and scanner legacy timeout all remain.
A new flake in `testWorkerDatabase.test.ts` under coverage mode suggests the
B方案 fix is incomplete for physical-DB-lifecycle tests.

Test slowness comes from three sources: (1) `apps/api` serial by default (~149s
vs ~38s achievable), (2) `verify:db-tests` runs test + coverage sequentially
for both `@exam/db` and `@exam/api`, duplicating the same test execution under
heavier v8 instrumentation, and (3) `testWorkerDatabase.test.ts` PG integration
tests (CREATE DATABASE) are slow under coverage. The safest first step is
script-layer reorganization (`verify:fast` without coverage), not parallelism
changes.

---

## 2. Current Test Architecture

### 2.1 Architecture Table

| Item | Current Behavior | Evidence File:Line | Risk |
|------|-----------------|-------------------|------|
| Default `TEST_DB_ISOLATION` | Unset → `testIsolation.ts` treats as enabled (file-schema). `testScope.ts` treats as `"worker-database"` (unused default). `testDatabase.ts` treats as enabled (file-schema). | `testIsolation.ts:265-269`, `testScope.ts:208`, `testDatabase.ts:131-135` | **Dual interpretation**: `testScope.ts` defaults to `worker-database` but is never consumed by `buildTestApp`. The actual default is file-schema. Misleading documentation risk. |
| `file-schema` path | `setupIsolatedTestDb()` → `CREATE SCHEMA` → `SET search_path` → per-file schema. Cleanup = `DROP SCHEMA CASCADE`. | `testIsolation.ts:203-239`, `testHelpers.ts:156-177` | Safe. Schema names start with `test_`. Cleanup guard rejects non-`test_` prefixes. |
| `worker-database` path | `setupWorkerTestDatabase()` → `ensureDatabaseExists()` → `CREATE DATABASE` → `migratePostgres()` → `TRUNCATE` on reset. | `testWorkerDatabase.ts:223-277`, `testDatabase.ts:114-117` | **CREATE DATABASE cannot run in transaction**. Heavy under coverage. New flake source. |
| `buildTestApp()` default | File-schema path. Creates new schema per call, migrates, seeds, builds Fastify. | `testHelpers.ts:100-177` | Each call: CREATE SCHEMA + migrate + seed (3 argon2 hashes) + Fastify plugin chain + 2 JWTs. |
| `buildTestApp()` worker-DB mode | Worker-database path. Reuses existing worker DB, no per-call migrate. | `testHelpers.ts:132-154` | No `resetPostgres()` called (deliberate: shared `ctx.org` reference). Data accumulates across `buildTestApp` calls within same file. |
| `apps/api` parallelism | `fileParallelism: false` (serial). Only parallel when `TEST_DB_ISOLATION=worker-database` + `API_TEST_MAX_WORKERS≥1`. | `vitest.config.ts:50-78` | **Serial default is the #1 speed bottleneck**. ~149s vs ~38s achievable. |
| `packages/db` parallelism | Default parallel (no override). | `packages/db/vitest.config.ts:29-32` | Safe. 8 files, 6 DB-touching, all use isolated schemas. |
| `pnpm verify` chain | `format:check → lint → lint:copy → lint:arch → typecheck → verify:nodb-tests → verify:db-tests → build` | `package.json:33` | `verify:db-tests` = `test:db && test:api && coverage:db && coverage:api` — **4 sequential DB-heavy tasks**. |
| `@exam/db#test → @exam/db#coverage` | turbo dependency enforces serial. | `turbo.json:30-32` | **Duplicate test execution**: `test:db` runs all tests, then `coverage:db` runs the same tests again with v8 instrumentation. |
| `@exam/api#test → @exam/api#coverage` | turbo dependency enforces serial. | `turbo.json:27-29` | Same duplication: `test:api` runs 623 tests, `coverage:api` runs 623 tests again. |
| CI `verify` job | Single job, no matrix. Runs `pnpm test → test:integration → build → coverage`. | `ci.yml:17-89` | No worker-database, no sharding. Uses shared `exam_test` DB. |
| CI `api-fast` job | 2 shards × 1 worker. `TEST_DB_ISOLATION=worker-database`. | `ci.yml:91-149` | Config prepared, **live CI validation pending**. |
| CI `e2e` job | Separate PG (`exam_e2e`). Playwright Chromium. | `ci.yml:151-309` | Isolated. Not affected by API test flakes. |

### 2.2 Critical Observation: `verify:db-tests` Execution Chain

```
pnpm verify:db-tests
  ├── pnpm test:db          → turbo test --filter=@exam/db           (~10s, parallel)
  ├── pnpm test:api         → turbo test --filter=@exam/api          (~149s, serial)
  ├── pnpm coverage:db      → turbo coverage --filter=@exam/db       (~10s, parallel)
  └── pnpm coverage:api     → turbo coverage --filter=@exam/api      (~149s, serial)
```

Total: ~318s (~5.3 min). Of this, ~298s is `@exam/api` (test + coverage).
The `@exam/api` tests run **twice** — once without coverage, once with. The
coverage run is strictly slower due to v8 instrumentation overhead.

---

## 3. Flake Status Review

### 3.1 Status Table

| Document Location | Current Phrasing | Problem | Suggested Fix |
|-------------------|-----------------|---------|---------------|
| `test-flakes.md` BUG-FLAKE-001 "已升级" status | "已升级（≥3 次复发，2026-06-13）。已从单点 timeout 缓解升级为 A′ serial containment → B 方案基础实施就位 → B 方案全量迁移完成" | Implies B方案 is the "root fix". But `fileParallelism: false` remains and PR86 proved it **cannot be removed** even with B方案. The "New root fix" section (line 42) says B方案 "从源头消除跨文件/跨worker/跨package DB状态泄漏" — true for state leak, but not for I/O contention. | Clarify: B方案 fixed state leak. `fileParallelism: false` remains for I/O contention. These are **different root causes**. BUG-FLAKE-001 cannot be closed until both are resolved. |
| `test-flakes.md` BUG-FLAKE-001 "Remaining mitigations" | Lists A′ `fileParallelism: false` and C方案 scanner timeout | Correct but understates: A′ is not just a "mitigation" — it's the **only** thing preventing the I/O contention flake. B方案 didn't fix I/O contention. | Rephrase: "A′ is the primary containment for I/O contention. B方案 fixed state leak only." |
| `test-flakes.md` BUG-FLAKE-002 "状态" | "已缓解（Option A：DB-touching turbo 任务严格串行化）。Option B 已完成" | Claims B方案 completed. But `verify:db-tests` serial chain (Option A) still exists and is the actual working mitigation. | Clarify: Option A (serial chain) is the active mitigation. Option B (schema isolation) fixed state leak but serial chain remains for I/O. |
| `test-flakes.md` BUG-FLAKE-003 "状态" | "已缓解（2026-06-20，cleanup containment 方案 + A′ serial）。B 方案已完成" | Same issue: B方案 fixed state leak, but cleanup containment + serial remain. | Clarify: cleanup containment is still needed for within-file data accumulation. |
| `test-flakes.md` BUG-FLAKE-004 "状态" | "已缓解（2026-06-20，explicit cleanup 方案）。B 方案已完成" | Same pattern. | Clarify: explicit cleanup still needed for files that don't use `buildTestApp`. |
| `test-flakes.md` Phase 5 evidence section | "5/5 PASS" for maxWorkers=2 and maxWorkers=4 | **Local only**. Evidence is explicitly labeled as such but the "Completed" status in ADR-007 table may be misread as "CI-ready". | Ensure ADR-007 table says "Completed (local)" not just "Completed". |
| `test-flakes.md` new `testWorkerDatabase.test.ts` timeout | Not yet documented as a separate flake entry | This is a **new flake** in the `ensureDatabaseExists` test under coverage mode. Should be tracked. | Add as BUG-FLAKE-005 or document in existing entry. |
| `test-flakes.md` "Phase 5 后 Roadmap" | "CI shard prep → Next" | Phase 6 is "Config prepared" but the roadmap says "Next" which is ambiguous. | Clarify: "Phase 6 config prepared. Live CI validation pending." |
| ADR-007 "Implementation Status" table | Phase 6: "Config prepared" | Accurate. But the table doesn't distinguish between "config prepared" and "live validated". | Add "Live CI validation pending" to the Phase 6 row. |
| ADR-007 "Completion Boundary" | "CI shard configuration is prepared and documented. (done — Phase 6 plan)" | Completion boundary says Phase 6 is "done" but live CI validation is pending. | Change to "CI shard configuration prepared (done); live CI validation pending." |

### 3.2 Can BUG-FLAKE-001 Be Closed?

**No.** Two distinct root causes remain unresolved:

1. **State leak** — Fixed by B方案 (per-file schema isolation). Verified by
   stress evidence.
2. **I/O contention** — NOT fixed by B方案. `fileParallelism: false` is the
   only containment. PR86 proved that even with B方案, parallel execution
   under default workers causes auth.test.ts timeout.

BUG-FLAKE-001 can only be closed when:
- `fileParallelism: false` is removed **AND** stress evidence shows no regression.
- OR the I/O contention root cause is identified and fixed (e.g., template DB,
  semaphore around schema migration, or reduced worker count).

### 3.3 Can BUG-FLAKE-002 Be Closed?

**No.** The serial chain `verify:db-tests` remains. The B方案 fixed state leak,
but the serial chain was added for I/O contention (PR88). Closing it requires
stress evidence after removal.

### 3.4 Can BUG-FLAKE-003 / 004 Be Closed?

**Partially.** B方案 fixed the cross-file state leak. But:
- BUG-FLAKE-003: `beforeEach` cleanup in deadline-scanner tests may still be
  needed for within-file data accumulation (different root cause).
- BUG-FLAKE-004: `afterAll` cleanup in tenant-isolation tests may still be
  needed for files that don't use `buildTestApp`.

Both should be verified by running the affected tests **without** cleanup
under worker-database mode, then checking for state leak.

### 3.5 New Flake: `testWorkerDatabase.test.ts`

The `ensureDatabaseExists` test times out under `pnpm verify` coverage mode
but passes standalone. This is a **new flake** that should be tracked as
BUG-FLAKE-005 or appended to BUG-FLAKE-001 as a physical-DB-lifecycle
instance. Root cause: v8 coverage instrumentation + turbo cross-task PG
contention + `CREATE DATABASE` is a heavy DDL operation.

### 3.6 Documentation Inconsistency: "4 DB Tasks Concurrent"

The `test-flakes.md` BUG-FLAKE-002 section (line 335-343) describes the
historical failure chain as "4 个 DB 任务并发挤 PG". This is accurate for
the **historical** state (before PR88). After PR88, turbo enforces serial
dependency: `db#test → db#coverage → api#test → api#coverage`. The max
concurrent PG tasks is now 2 (db:test + api:test can overlap via turbo, or
db:coverage + api:coverage). The documentation should be updated to reflect
the current state.

### 3.7 Phase 5 Evidence Over-Interpretation

Phase 5 local evidence (5/5 stress pass at maxWorkers=4) is explicitly labeled
"local only" in the test-flakes.md. However, the ADR-007 Implementation Status
table marks Phase 5A and 5B as "Completed" without the "(local)" qualifier.
This could be misread as "CI-ready". The table should clarify.

---

## 4. Test Speed Bottleneck Review

### 4.1 Speed Source Table

| Slow Source | Evidence | Necessary? | Optimization | Risk |
|-------------|----------|-----------|-------------|------|
| `apps/api` serial (`fileParallelism: false`) | ~149s for 623 tests. Parallel would be ~38s (2.6×). | **No** — safety net, not required. PR86 showed ≤4 workers is safe locally. | Enable worker-database + maxWorkers=4 locally. | **Medium**: re-introduces I/O contention risk if workers > 4 or PG is slow. Requires stress evidence. |
| `verify:db-tests` runs test + coverage sequentially | `test:db && test:api && coverage:db && coverage:api` — same tests run twice. | **No** — historical mitigation from BUG-FLAKE-002/PR88. | Remove serial chain, let turbo handle dependencies. Or create `verify:fast` without coverage. | **Low** for `verify:fast` (no coverage = no I/O amplification). **Medium** for removing serial chain. |
| `@exam/api` coverage overhead | v8 instrumentation makes each test ~1.5-2× slower. | **Yes** for merge gate. **No** for local dev. | Split into `verify:fast` (no coverage) and `verify:full` (with coverage). | **None** — script-only change. |
| `testWorkerDatabase.test.ts` PG integration | `CREATE DATABASE` + `migratePostgres` + `TRUNCATE` under coverage. 5s timeout under contention. | **Yes** for correctness (physical DB lifecycle must be tested). | Split into separate `test:db:lifecycle` script. Run less frequently. | **Low** — script separation only. |
| `buildTestApp()` per-call overhead | Fastify plugin chain + seed + JWTs per call. ~52 files × N calls each. | **Yes** — each test file needs isolated app. | Template DB (Phase 8) would reduce migrate cost. Not urgent. | **High** — template DB adds complexity. Deferred. |
| `packages/db` parallel | Already parallel. ~10s. | Optimal. | None needed. | N/A |
| CI `verify` job serial | Single job, no matrix. | **Yes** for CI correctness. | Phase 6 shard config is ready. | **Low** — config already prepared. |

### 4.2 Where Time Is Actually Spent

Based on evidence from test-flakes.md stress runs:

```
pnpm verify total:                    ~318s (5.3 min)
  ├── format:check + lint + typecheck: ~15s
  ├── verify:nodb-tests:              ~5s (non-DB packages)
  ├── verify:db-tests:               ~298s
  │   ├── test:db:                    ~10s (packages/db, parallel)
  │   ├── test:api:                  ~149s (apps/api, serial)
  │   ├── coverage:db:               ~10s (packages/db, parallel)
  │   └── coverage:api:             ~129s (apps/api, serial, slower due to v8)
  └── build:                          ~10s
```

**~94% of verify time is `@exam/api` test + coverage.** The single biggest
win is enabling parallelism for `apps/api` in local dev.

### 4.3 Necessary vs Historical Costs

| Cost | Status | Can Remove? |
|------|--------|------------|
| `fileParallelism: false` | Historical mitigation from BUG-FLAKE-001 | Only with stress evidence showing ≤4 workers is safe |
| `verify:db-tests` serial chain | Historical mitigation from BUG-FLAKE-002/PR88 | Only with stress evidence showing no turbo contention |
| scanner 15_000ms timeout | Historical mitigation from BUG-FLAKE-001 | Only with evidence scanner converges reliably |
| `testWorkerDatabase` PG integration tests | **Necessary** — physical DB lifecycle must be tested | Cannot remove, but can split to less frequent execution |
| `buildTestApp()` per-call overhead | **Necessary** — test isolation requires fresh app | Template DB (Phase 8) reduces migrate cost |

---

## 5. Risk Review of Proposed Speedups

### 5.1 Scheme A: `verify:fast`

| Aspect | Assessment |
|--------|-----------|
| **收益** | Eliminates coverage overhead from local dev loop. Saves ~129s (coverage:api) + ~10s (coverage:db) = ~139s. Total verify drops from ~318s to ~179s. |
| **风险** | **Low**. No parallelism change. No isolation change. Just skips coverage. Coverage still runs in `verify:full` (merge gate). |
| **是否建议** | **Yes, strongly recommended as first step.** |
| **前置验证** | `pnpm verify:fast` (new script) passes. `pnpm verify:full` (existing verify) passes. No code changes needed. |

Implementation: Add `"verify:fast": "pnpm format:check && pnpm lint && pnpm lint:copy && pnpm lint:arch && pnpm typecheck && pnpm verify:nodb-tests && pnpm test:db && pnpm test:api && pnpm build"` to `package.json`.

### 5.2 Scheme B: `test:api:fast`

| Aspect | Assessment |
|--------|-----------|
| **收益** | ~3.9× speedup for `@exam/api` tests (149s → 38s). Combined with Scheme A, total verify:fast drops to ~68s. |
| **风险** | **Medium**. Requires `TEST_DB_ISOLATION=worker-database` + `API_TEST_MAX_WORKERS=4`. PR86 showed this is safe locally, but: (1) CI runner core count differs from local, (2) `testWorkerDatabase.test.ts` already flaking under coverage — may also flake under parallel worker-DB creation. |
| **是否建议** | **Yes, but only after Scheme A lands and `testWorkerDatabase` flake is resolved.** |
| **前置验证** | 1. `testWorkerDatabase.test.ts` flake resolved. 2. `TEST_DB_ISOLATION=worker-database API_TEST_MAX_WORKERS=4 pnpm --filter @exam/api test` ×5 stress pass. 3. `pnpm verify:fast` with Scheme B applied ×3 pass. |

### 5.3 Scheme C: Split `testWorkerDatabase.test.ts`

| Aspect | Assessment |
|--------|-----------|
| **收益** | Physical DB lifecycle tests (CREATE DATABASE, migrate, truncate) run separately from pure-logic tests. Reduces flake surface for normal `pnpm test:db`. |
| **风险** | **Low**. Script separation only. Full `verify` still runs everything. `verify:fast` skips lifecycle tests. |
| **是否建议** | **Yes.** |
| **前置验证** | `pnpm test:db` still passes. `pnpm test:db:lifecycle` passes. `pnpm verify` still passes. |

Implementation: Add `"test:db:lifecycle": "pnpm --filter @exam/db exec vitest run src/testWorkerDatabase.test.ts"` to `package.json`. Adjust `test:db` to exclude lifecycle tests if desired, or keep them included.

### 5.4 Scheme D: Coverage Dedup

| Aspect | Assessment |
|--------|-----------|
| **收益** | Eliminates running same tests twice (once for `test`, once for `coverage`). Saves ~10s (db) + ~20s (api overhead difference). |
| **风险** | **Medium**. Need to verify: does `vitest run --coverage` actually run the same test files as `vitest run`? If yes, the serial chain is pure overhead. If coverage adds test files, removing it would miss coverage data. |
| **是否建议** | **Investigate first.** If coverage runs same tests, merge into single step. If not, keep separate. |
| **前置验证** | Compare test file list between `vitest run` and `vitest run --coverage` for both `@exam/db` and `@exam/api`. Count `it()` blocks in each mode. |

### 5.5 Scheme E: Template Database

| Aspect | Assessment |
|--------|-----------|
| **收益** | `CREATE DATABASE ... TEMPLATE` is ~10× faster than `CREATE DATABASE` + `migratePostgres`. Would eliminate per-worker DB creation cost. |
| **风险** | **High**. Adds complexity: template must be rebuilt on migration changes. Template DB must be pre-migrated and seeded. Adds new infrastructure to maintain. |
| **是否建议** | **No, not now.** ADR-007 correctly deferred this to Phase 8. Only pursue if Phase 6/5B evidence shows DB creation is still a bottleneck after other optimizations. |
| **前置验证** | Measure: how much time does `setupWorkerTestDatabase()` spend in `ensureDatabaseExists()` + `migratePostgres()` vs total `buildTestApp()` time. If <10%, template DB is not worth the complexity. |

---

## 6. Recommended Phase 6 Plan

### Phase 6A: Script Layer Reorganization (No Code Changes)

**目标**: Separate fast feedback loop from full merge gate.

**改动范围**:
- `package.json`: Add `verify:fast` (no coverage, no lifecycle tests).
- `package.json`: Add `test:db:lifecycle` (separate physical DB lifecycle tests).
- `docs/dev/test-flakes.md`: Add BUG-FLAKE-005 entry for `testWorkerDatabase` timeout.

**不改什么**:
- No vitest config changes.
- No turbo config changes.
- No code changes.
- No test changes.
- No CI changes.

**验证命令**:
```bash
pnpm verify:fast          # ~179s (no coverage)
pnpm verify               # ~318s (full, unchanged)
pnpm test:db:lifecycle    # standalone lifecycle tests
```

**Rollback**: Delete `verify:fast` and `test:db:lifecycle` scripts.

**是否允许进入 CI**: No — local dev convenience only. CI continues using `verify`.

### Phase 6B: Worker-Database Fast Path (Local Only)

**目标**: Enable parallel `apps/api` tests in local dev via worker-database.

**改动范围**:
- None — `resolveParallelism()` already supports this via env vars.
- Developer workflow: `TEST_DB_ISOLATION=worker-database API_TEST_MAX_WORKERS=4 pnpm --filter @exam/api test`.

**不改什么**:
- No default behavior change.
- No CI change.
- No vitest config change.
- No turbo change.

**验证命令**:
```bash
TEST_DB_ISOLATION=worker-database API_TEST_MAX_WORKERS=4 pnpm --filter @exam/api test  # ×5
pnpm verify:fast  # regression check
pnpm verify       # regression check
```

**Rollback**: Unset `API_TEST_MAX_WORKERS` → back to serial.

**是否允许进入 CI**: No — local only. CI `api-fast` job already uses worker-database.

### Phase 6C: Coverage Dedup Investigation

**目标**: Determine if `test` + `coverage` runs the same tests, and if so, merge.

**改动范围**:
- Investigation only. Compare test file lists between `vitest run` and `vitest run --coverage`.
- If same: merge `test:api` + `coverage:api` into single `vitest run --coverage` step.
- If different: keep separate.

**不改什么**:
- Until investigation completes, no changes.

**验证命令**:
```bash
pnpm --filter @exam/api exec vitest run --reporter=verbose 2>&1 | grep "✓" | wc -l
pnpm --filter @exam/api exec vitest run --coverage --reporter=verbose 2>&1 | grep "✓" | wc -l
# Compare counts
```

**Rollback**: N/A (investigation only).

**是否允许进入 CI**: Depends on findings.

### Phase 6D: Template Database (Deferred)

**目标**: Reduce per-worker DB creation cost.

**改动范围**:
- `packages/db/src/testWorkerDatabase.ts`: Add template DB creation + `CREATE DATABASE ... TEMPLATE`.
- Migration hash tracking for template invalidation.

**不改什么**:
- No default behavior change until explicitly opted in.

**验证命令**:
```bash
# Measure before/after
time TEST_DB_ISOLATION=worker-database API_TEST_MAX_WORKERS=4 pnpm --filter @exam/api test
```

**Rollback**: Disable template DB via env var.

**是否允许进入 CI**: Only after local evidence shows significant speedup.

### Phase 6E: Partial Default Parallelism (Future)

**目标**: Make worker-database the default for `apps/api` tests.

**改动范围**:
- `apps/api/vitest.config.ts`: Change default from `fileParallelism: false` to `fileParallelism: true` when `TEST_DB_ISOLATION` is unset.
- **Requires**: Stress evidence showing no regression at default worker count.

**不改什么**:
- CI until Phase 6 live validation passes.

**验证命令**:
```bash
# Must pass 5/5 before merging
pnpm --filter @exam/api test  # ×5 (should auto-detect worker-database)
pnpm verify                    # ×3
```

**Rollback**: Revert vitest config to `fileParallelism: false`.

**是否允许进入 CI**: Only after local 5/5 stress + CI shard live validation.

---

## 7. Concrete Next Prompt for Implementation

```
Phase 6A: Script Layer Reorganization

1. Add to package.json scripts:
   - "verify:fast": "pnpm format:check && pnpm lint && pnpm lint:copy && pnpm lint:arch && pnpm typecheck && pnpm verify:nodb-tests && pnpm test:db && pnpm test:api && pnpm build"
   - "test:db:lifecycle": "pnpm --filter @exam/db exec vitest run src/testWorkerDatabase.test.ts"

2. Add BUG-FLAKE-005 to docs/dev/test-flakes.md:
   - Symptom: testWorkerDatabase.test.ts ensureDatabaseExists times out under pnpm verify coverage mode
   - Root cause: v8 instrumentation + turbo cross-task PG contention + CREATE DATABASE is heavy DDL
   - Standalone: passes immediately (12/12 in 843ms)
   - Mitigation: split lifecycle tests into separate script

3. Update docs/dev/test-flakes.md:
   - BUG-FLAKE-001: Clarify that B方案 fixed state leak, not I/O contention
   - BUG-FLAKE-002: Clarify that serial chain is the active mitigation
   - Phase 5 evidence: Add "(local)" qualifier to Completed status

4. Verify:
   - pnpm verify:fast passes
   - pnpm verify passes (unchanged)
   - pnpm test:db:lifecycle passes
```

---

## 8. Open Questions / Evidence Gaps

1. **Does `vitest run --coverage` run the same test files as `vitest run`?**
   Need to compare test file lists. If yes, the serial `test + coverage` chain
   is pure overhead.

2. **What is the actual time breakdown of `setupWorkerTestDatabase()`?**
   Need to measure `ensureDatabaseExists()` + `migratePostgres()` vs total
   `buildTestApp()` time. If DB creation is <10% of total, template DB is
   not worth the complexity.

3. **Does `testWorkerDatabase.test.ts` flake under `TEST_DB_ISOLATION=worker-database API_TEST_MAX_WORKERS=4`?**
   The flake is under coverage mode. Need to verify if it also flakes under
   plain test mode with worker-database.

4. **Is the `testWorkerDatabase` timeout a BUG-FLAKE-001 instance or a new class?**
   BUG-FLAKE-001 is about scanner timeout under parallel + shared schema.
   This is about CREATE DATABASE under coverage + turbo contention. Different
   root cause, same symptom family. Should it be a new BUG-FLAKE-005 or an
   appendix to 001?

5. **Can `verify:db-tests` serial chain be removed?**
   PR88 added it for turbo cross-task PG contention. After B方案 (schema
   isolation), is the contention eliminated? Need stress evidence.

6. **What is the actual CI timing for `api-fast` shards?**
   Phase 6 config is prepared but no live CI validation exists. Need real
   timing data from GitHub Actions.

7. **Is `fileParallelism: false` still necessary with B方案 + worker-database?**
   PR86 tested this and found auth.test.ts still flaking. But that was
   without worker-database (used file-schema). Has anyone tested
   `fileParallelism: true` + `worker-database` + `maxWorkers=4` under
   coverage mode? The Phase 5 evidence is for test-only, not coverage.
