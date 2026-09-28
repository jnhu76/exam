# Physical-DB lifecycle reduction in `@exam/db` (post-#649)

Status: **RESEARCH + IMPLEMENTED CONVERSION SET — independently reviewed, ready** (2026-09-28)
Follow-up to: `docs/research/db-test-post-649-perf-attribution.md` (branch `research/db-test-post-649-perf`, commit `c0608718`, measurement-only; preserved untouched).
Scope: reduce **unnecessary physical `CREATE DATABASE` / `DROP DATABASE`** lifecycle operations in the `@exam/db` test run — especially fixture/cleanup drops that force PostgreSQL requested checkpoints — while keeping every test whose semantic subject IS physical database lifecycle.
Out of scope (unchanged, per the perf attribution's falsifications): PostgreSQL tuning (`fsync`/`checkpoint_*`/`max_wal_size` untouched), lifecycle-lock redesign (ONE key preserved, #478), worker cap (`DB_TEST_WORKER_CAP=3` preserved), schema-lane volume (`getIsolatedTestDb` — schema lifecycle is not physical-DB lifecycle).

```text
LIVE_MASTER   = a4a813fa4c1866e951941eb5954e173426c3a11c (verified post-#649)
BRANCH        = perf/db-test-physical-lifecycle-reduction (from LIVE_MASTER)
PERF_REPORT   = docs/research/db-test-post-649-perf-attribution.md @ c0608718 (untouched)
RAW_ARTIFACTS = /tmp/exam-lifecycle-lab/{baseline,candidate}/ + causal-experiment.mjs (NOT durable; this report is self-contained)
```

---

## 1. Checkpoint causality (the physical fact this task stands on)

Controlled per-operation deltas of `pg_stat_checkpointer` / `pg_stat_wal` on the dev PostgreSQL 18.4 server (N=3 per op, throwaway `exam_test_ckpt_*` names, dirty-buffer generator DB alive to emulate run-time cache pressure):

| operation | wall (dirty cache) | num_requested Δ | num_done Δ | sync_time Δ | WAL Δ |
|---|---:|---:|---:|---:|---:|
| `CREATE DATABASE` (empty, wal_log strategy) | 95–467ms | **0** | 0 | 0 | 0 |
| `ensure`-existing (catalog check only) | 0–3ms | **0** | 0 | 0 | 0 |
| `DROP DATABASE` missing (`IF EXISTS` no-op) | 1ms | **0** | 0 | 0 | 0 |
| `DROP DATABASE` existing (empty DB) | 28–1200ms | **+1** | +1 | +5–871ms | 0–21MB |
| `DROP DATABASE` existing (terminated conn) | 33–49ms | **+1** | +1 | +5ms | 0 |
| `CREATE`+`DROP` pair (fixture style) | 60–62ms | **+1** (from the drop) | +1 | +5ms | 0 |

**Established causality:** every physical `DROP DATABASE` of an EXISTING database requests exactly one synchronous forced checkpoint (`num_requested +1`, front-end pause bounded by its sync cost — 1.2s wall / 871ms sync when the shared buffer cache was dirty); `CREATE DATABASE`, ensure-on-existing, and drop-of-missing never do. The run-level `num_requested +11` observed by the perf attribution is therefore fully accounted for by the 11 drop-existing operations per run (§3).

## 2. Caller inventory (static, complete for `@exam/db`)

Search surface: `dropDatabaseIfExists`, `ensureDatabaseExists`, `setupWorkerTestDatabase`, raw `CREATE DATABASE`/`DROP DATABASE`, `withDatabaseName`, `TEST_ADMIN_DATABASE`. Out-of-scope callers recorded for completeness in §7.

| # | File / caller | CREATE? | DROP? | Why a physical DB exists | Class | DROP_ROLE | Convert? |
|---|---|---|---|---|---|---|---|
| 1 | `testWorkerDatabase.test.ts` → `ensureDatabaseExists` "creates if missing, idempotent" | 1 | cleanup | create + idempotency semantics under test | **A** | SUBJECT | NO |
| 2 | `testWorkerDatabase.test.ts` → "idempotent when missing" ×2 | 0 | missing ×2 | drop-missing semantics under test | **A** | SUBJECT | NO (free) |
| 3 | `testWorkerDatabase.test.ts` → "drops a database that exists" | 1 | 1 | **the real DROP is the test** | **A** | SUBJECT | NO |
| 4 | `testWorkerDatabase.test.ts` → full lifecycle (migrate/connect/truncate/reset/close) | 1 (bootstrap) | cleanup | worker bootstrap semantics under test | **A/C** | consequence of required CREATE | NO |
| 5 | `testWorkerDatabase.test.ts` → bootstrap memo ("first pays ONE critical section") | 1 (bootstrap) | cleanup | first ACT must really bootstrap on an absent DB | **C** | consequence | NO |
| 6 | `testWorkerDatabase.test.ts` → memo authority scoping (2 tests) | 1 (bootstrap A; B fact-skips) + 1 (B fresh ACT) | cleanup ×2 | authority scoping + fresh-DB ACT proof | **C** | consequence | NO |
| 7 | `testWorkerDatabase.test.ts` → **`truncateBusinessTables` no-op path** | 1 (bootstrap) | cleanup | needs a *migrated DB with zero rows* — NOT a fresh physical DB | **D** | FIXTURE_CLEANUP | **YES → C1** |
| 8 | `testWorkerDatabase.test.ts` → `afterAll` legacy-name sweep | 0 | missing | hygiene for a pre-Phase-6D name | **E** | FIXTURE (drop-missing = free) | NO (no prize) |
| 9 | `testInfraLock.test.ts` → coordauth authority fixture (`ensureDb`/`dropDb`, raw) | 1 (raw) | 1 (raw) | advisory locks are database-local → needs a DIFFERENT coordination DB with zero sibling traffic | **B** | FIXTURE_CLEANUP | **YES → C2** |
| 10 | `testInfraLock.test.ts` → coordwrap authority fixture (raw) | 1 (raw) | 1 (raw) | same as #9 | **B** | FIXTURE_CLEANUP | **YES → C2 (merged with #9)** |
| 11 | `testInfraLock.test.ts` → coordwrap `target` | 1 (via wrapper under test) | 1 (raw) | wrapper's CREATE is the subject; absence required | **A** (+cleanup of what A created) | consequence | NO (residue would poison) |
| 12 | `testDbWorkerScoped.failurePath.test.ts` → throwaway slot + `BEFORE TRUNCATE` trigger | 1 (bootstrap) | cleanup | crash-residue safety requires an ephemeral slot OUTSIDE `exam_test_db_w1..w3` | **C** (safety-bound) | consequence (safety) | NO (task directive) |
| 13 | `testDbWorkerScoped.test.ts` → predecessor bootstrap | 0 warm (persistent slot, fact-based precheck) | 0 | uses the persistent package slot already | **—** | — | already optimal |
| 14 | `testDbBootstrap.test.ts` / globalSetup `prepareTestDatabase` | 0 (ensure on existing `exam_test` = catalog check) | 0 | explicit-missing test proves NO create | **A** | — | NO (no lifecycle) |

Definitions (task §5): **A** = DB semantics under test · **B** = coordination-authority semantics · **C** = fresh DB required for proof · **D** = clean-state convenience only · **E** = cleanup only · **F** = uncertain. No caller remained in **F** after the audit.

Totals (per run, trace-reconciled master): physical **CREATE 11** (3 wrapper-subject + 6 bootstraps + 2 raw fixtures), physical **DROP 15** (existing 11 + missing 4). Drop-role split: **SEMANTIC_REQUIRED_DROP = 1** (#3 — the drop IS the test) **+ 10 consequence-of-required-CREATE** (unavoidable: their DBs must be born fresh, and leaving them would poison); **FIXTURE_CLEANUP_DROP = 4 removable** (#7, #9, #10 — plus one of the two raw fixture drops disappears by merging #9+#10).

## 3. Dynamic reconciliation (TEST_INFRA_TRACE, master)

`TEST_INFRA_TRACE=1 pnpm --filter @exam/db test` — 59 files / 707 tests PASS, 219 acquisitions (matches the perf attribution exactly):

| caller | acquisitions | hold sum |
|---|---:|---:|
| `dropTestSchema` | 75 | 6336ms |
| `createTestSchema` | 48 | 1316ms |
| `getIsolatedTestDb` (CREATE SCHEMA + migrate) | 26 | 13746ms |
| `applyAllMigrations` | 18 | 9994ms |
| **`dropDatabaseIfExists`** | **13** (existing 9 + missing 4) | **7452ms** |
| `makeEnv` (0027) | 12 | 5949ms |
| `ensureDatabaseExists` (3 with real CREATE; 8 catalog-check only) | 11 | 426ms |
| worker-slot bootstrap (`testWorkerDatabase.ts:423`) | 6 (all real CREATE + full migrate) | 3320ms |
| direct `withTestInfraLifecycleLock` (testInfraLock tests) | 10 | ~160ms |

Raw (lock-bypassing) lifecycle in `testInfraLock.test.ts`: `ensureDb` ×2 (CREATE) + `dropDb` ×2 (DROP existing) — invisible to the lane trace but checkpoint-forcing per §1.
**Reconciliation:** drop-existing total = 9 (wrapper) + 2 (raw) = **11 = `num_requested` Δ (+11) in every run** ✓. One trace acquisition (27ms ensure, no CREATE, no checkpoint) could not be pinned to a file from pids alone; it is immaterial (req=0).

## 4. Selected conversions (proof equivalence)

### C1 — `truncateBusinessTables` no-op path → persistent package slot

```text
OLD_MECHANISM = unique throwaway DB (TEST_WORKER_ID=phase6d_noop_<rand>)
                → bootstrap: CREATE DATABASE + full migrate under the lane
                → resetPostgres() ×2 → DROP DATABASE (existing, +1 checkpoint)
NEW_MECHANISM = persistent package worker slot (#648 seam:
                setupWorkerTestDatabase({ scope: resolveDbPackageTestScope() }))
                → resetPostgres() ×1 (clears predecessor state)
                → resetPostgres() ×2 (the no-op proof, zero-row precondition
                  established by construction: truncateBusinessTables TRUNCATEs
                all business tables) → close() — no DROP, slot persists
OLD_PROOF     = resetPostgres does not error on a freshly-migrated DB with
                zero business rows (twice)
NEW_PROOF     = identical code path (truncateBusinessTables on the migrated
                public schema) does not error with zero business rows (twice),
                after a first reset deterministically established the
                zero-row precondition
WHY_EQUIVALENT= the test's subject is truncateBusinessTables' no-op behavior on
                a real migrated schema — identical function, identical schema,
                identical zero-row state. Physical absence and unique identity
                were fixture properties, not proof properties. The describe
                self-skips under TEST_DB_ISOLATION=file-schema (WORKER_SLOT_
                DESCRIBE, same seam rule as testDbWorkerScoped.test.ts) because
                the package slot is a worker-database-mode resource; in that
                mode the old test needed CREATEDB anyway (restricted-role
                environments could not run it either).
REMOVED       = 1 CREATE + 1 full migrate (lane hold + WAL) + 1 DROP-existing
                (+1 checkpoint) per run
```

### C2 — `testInfraLock.test.ts`: ONE shared per-run coordination fixture

```text
OLD_MECHANISM = coordauth creates `exam_test_coordauth_<rand>` and coordwrap
                creates `exam_test_coordwrap_<rand>`; each is raw-CREATEd at
                test start and raw-DROPped in its own finally (2 CREATE +
                2 DROP-existing per run, bypassing the lane)
NEW_MECHANISM = ONE file-level `COORD_AUTHORITY_FIXTURE_DB`
                (`exam_test_coordauth_<pid>_<rand>`, per-run unique), created
                if missing by each test (cheap, failure-tolerant), dropped ONCE
                by the file-level afterAll
OLD_PROOF     = lock/wrapper rows tagged with the injected authority's OID can
                only come from this file's sessions (no sibling traffic on a
                unique DB; ambient `postgres` divergence fails the poll)
NEW_PROOF     = identical: per-run uniqueness keeps zero sibling traffic under
                ANY run overlap (concurrent invocations get different fixture
                DBs, exactly like the old per-test names); the two tests run
                sequentially in one file, so the exactly-one-granted-row
                discrimination is unchanged; each test re-ensures (create-if-
                missing) so a failure in one cannot break the other
WHY_EQUIVALENT= the B-class requirement is "a DIFFERENT existing database with
                no sibling lifecycle-key traffic" — NOT "a NEW unique database
                per TEST". Per-run uniqueness is preserved; only the per-TEST
                duplication was fixture convenience. A stable cross-run name
                was REJECTED (see §5) precisely because it would not preserve
                discrimination under two simultaneous file-schema runs.
REMOVED       = 1 CREATE + 1 DROP-existing (+1 checkpoint) per run
```

## 5. Rejected candidates (and why)

| candidate | reason |
|---|---|
| Stable (cross-run) coordination fixture DB | removes 2 more checkpoints, but two simultaneous `file-schema`-mode runs (no package lease in that mode) would share the fixture and break coordauth's exactly-one-granted-row poll — a determinism regression; unique-per-run names are the mechanism the file itself documents for sibling-traffic elimination |
| `failurePath` throwaway slot → normal slot | FORBIDDEN by the task: a crash could leave the `BEFORE TRUNCATE` trigger on `exam_test_db_w1..w3` and poison unrelated tests; crash-residue safety is part of its proof |
| `ensure`/`dropdrop`/`memo`/`memoauth`/full-lifecycle fixture drops | A/C classes: the DB must be born fresh for the proof (absence required), so its cleanup drop is the unavoidable consequence of a required CREATE; converting would weaken the proof |
| `afterAll` legacy-name sweep removal | drop-missing costs 1ms and 0 checkpoints (measured, §1) — no defensible prize, and removal deletes a hygiene obligation |
| `coordwrap` `target` drop | absence is required for the wrapper-CREATE proof; skipping the drop leaks a DB per run (poison) |
| `getIsolatedTestDb` fresh-schema volume (26 acq / 13.7s) | schema lifecycle, not physical-DB lifecycle — outside this task's target |
| Stable-slot reuse for the full-lifecycle / memo / memoauth proofs | those proofs REQUIRE the bootstrap ACT on an absent DB (fresh-DB class C) |

## 6. Before/after measurements

Same environment as the perf attribution (WSL2, Docker Desktop, PostgreSQL 18.4, warm `exam_test_db_w1..w3`, sequential runs, one probe per run). `pnpm --filter @exam/db test`, 59 files / 707 tests, all runs PASS except as noted (none).

### Physical lifecycle + checkpoints (per run)

| metric | baseline (master `a4a813fa`) | candidate | Δ |
|---|---:|---:|---:|
| physical CREATE DATABASE | 11 | **9** | −2 |
| physical DROP DATABASE (total) | 15 | **13** | −2 |
| — DROP existing (checkpoint-forcing) | 11 | **9** | **−2** |
| — DROP missing (free) | 4 | 4 | 0 |
| SEMANTIC_REQUIRED_DROP | 1 | 1 | 0 |
| requested checkpoints (`num_requested` Δ) | +11 every run (4/4) | **+9 every run (4/4)** | **−2 (−18%)** |
| completed checkpoints | +11 | +9 | −2 |
| lane acquisitions (`TEST_INFRA_TRACE`) | 219 | **217** | −2 |
| `dropDatabaseIfExists` lane holds | 13 acq / 7452ms | 12 acq | −1 acq |
| worker-slot bootstrap acquisitions | 6 / 3320ms | 5 | −1 |

Per-run checkpoint telemetry (req/done identical every run; sync/write are load-dependent accumulations, not additive slices):

```text
BASELINE  trace1 req=11 done=11 sync=8.7s  wal=260MB   base1 req=11 sync=6.8s  wal=263MB
          base2   req=11 done=11 sync=10.5s wal=261MB   base3 req=11 sync=10.1s wal=262MB
CANDIDATE cand-trace req=9 done=9 sync=8.0s wal=300MB  cand1 req=9 sync=8.9s wal=251MB
          cand2   req=9  done=9 sync=9.4s  wal=318MB   cand3 req=9 sync=13.0s wal=282MB
```

### Wall time

| run set | walls (s) | median |
|---|---|---:|
| baseline N=3 | 61.49 / 63.95 / 64.83 | 63.95 |
| baseline trace run | 62.27 | — |
| candidate N=3 | 63.09 / 65.02 / 65.08 | 65.02 |
| candidate trace run | 61.41 | — |

`WALL_IMPROVEMENT = NOT DEMONSTRATED AT N=3` (medians 63.95 → 65.02, inside the ±1.5–2s run-to-run spread of identical code; the perf attribution already bounded the prize by the slowest-worker-chain structure). The honest causal claim is the deterministic one:

```text
CHECKPOINT_CAUSALITY = PROVEN (§1: each drop-existing = exactly +1 requested
                       checkpoint; create/ensure/drop-missing = +0)
PHYSICAL_DB_FREQUENCY_REDUCTION = YES (create 11→9, drop-existing 11→9,
                       requested checkpoints 11→9 in every measured run)
```

## 7. Recorded out-of-scope callers (NOT modified)

- `apps/api/src/e2e-reseed-convergence.test.ts` — `ensureDatabaseExists`/`createDatabase`/`dropDatabaseIfExists` on `RESET_TEST_DB`: the reseed lifecycle IS the subject (A). Outside `@exam/db`.
- `apps/api/tests/bootstrapLifetime/bootstrap-lifetime.test.ts` and `apps/api/tests/slotReuse/slot-reuse-isolation.test.ts` — afterAll drops of a dedicated slot DB created by a child Vitest boot (E cleanup of an A-created DB; creation is the subject). Outside `@exam/db`.
- `apps/api/src/routes/testDatabase.ts` — production route using `setupWorkerTestDatabase` (not a fixture).
- `docs/research/exam-550-final-capacity-reproof-1/harness/lib/db.ts` — archived research harness, not part of any test run.

## 8. Independent review (fresh-context subagent)

A fresh-context reviewer inspected the exact candidate HEAD + surrounding code + authority docs (testing.md §2.8, ADR-007) and ran read-only checks (prettier, `scripts/check-db-config.mjs`, `tsc --noEmit` — all pass):

```text
Q1 physical-semantics proofs weakened?  PASS — all A-class tests byte-identical to master;
                                        converted noop test proves the same subject, arguably
                                        stronger (preconditioning reset also covers non-empty state)
Q2 coordination proofs ambiguous?       PASS — per-run uniqueness is the actual discriminator and is
                                        preserved (pid+rand ≥ old rand-only); proofs are order-
                                        independent (each test re-ensures; advisory locks die with
                                        sessions; all sessions closed in finally)
Q3 crash residue poisoning?             PASS — forks isolate:true + per-slot file serialization; noop
                                        resets cannot interleave with getWorkerScopedTestDb's
                                        once-per-file fact; afterAll dropDb terminates lingering
                                        backends; worst case = one per-run-unique leftover name
Q4 cleanup obligations removed?         PASS — legacy sweep retained; fixture drops relocated (not
                                        removed); coordwrap target drop retained with INVARIANT comment
Q5 hidden shared-state race?            PASS — fixture is a pure string; one root afterAll; explicit
                                        numeric budget (Guard 5); WORKER_SLOT_DESCRIBE is the
                                        established module-load env-read pattern
Q6 DROP/checkpoint frequency decreased? PASS — call-site delta −2 CREATE / −2 drop-existing; raw
                                        artifacts: num_requested +11 (4/4 baseline) → +9 (4/4 candidate)
Q7 frozen #478/#649 invariants?         PASS — one lifecycle key, cap=3, no timeout inflation,
                                        no PG config change, no new mechanism
P0 = 0   P1 = 0   P2 = 0   P3 = 4   READY_TO_MERGE = TRUE
```

P3 observations (all accepted, none blocking): (a) the no-op case self-skips under `TEST_DB_ISOLATION=file-schema` (documented in C1 — the old variant needed CREATEDB anyway); (b) the shared-fixture proofs rely on vitest's default sequential in-file execution but do not depend on order; (c) the afterAll fixture drop is best-effort (`catch`), identical to the old per-test finallys; (d) pre-existing untracked worktree files (`.env.deploy`, two `docs/research/*.md`) are NOT part of this change and must not ride along in any future commit.

## 9. Validation evidence

```text
GATES
  DB_TEST        = PASS (707/707, 4 runs incl. trace)
  DB_COVERAGE    = PASS (707/707, thresholds met)
  VERIFY_STATIC  = PASS (format, lint, lint:arch, lint:db-config, lint:db-journal,
                   lint:env-contract, lint:eslint, typecheck, openapi)
  VERIFY         = PASS (exit 0: static + @exam/db 707 + @exam/api 2774 + @exam/web 2202
                   + @exam/auth 25 coverage + build)
  FOCUSED        = PASS (testWorkerDatabase.test.ts + testInfraLock.test.ts: 43/43,
                   re-confirmed on a quiet server; 3 transient lease-conflict failures
                   during a concurrent `pnpm verify` were the run-lease working as
                   designed, unrelated to the diff)
  FORMAT         = PASS (prettier clean)
```

## 10. Invariants preserved

```text
DB_TEST_WORKER_CAP_CHANGED  = NO
LIFECYCLE_LOCK_CHANGED      = NO (one advisory key; #478 frozen)
TIMEOUTS_CHANGED            = NO (existing 30s hook/test budgets only)
POSTGRES_CONFIG_CHANGED     = NO
API_BEHAVIOR_CHANGED        = NO
GET_ISOLATED_TEST_DB_CHANGED= NO
NEW_MECHANISM               = NONE (reused #648 package slot + file-level afterAll)
```
