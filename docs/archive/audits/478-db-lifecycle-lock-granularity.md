# #478 research result — global DB lifecycle lock granularity falsification

Status: **RESEARCH COMPLETE — FINAL_DECISION = KEEP_GLOBAL** (2026-09-28)
Baseline: master `65d56777`, worktree `/home/hoo/Source/exam`, local WSL2 + docker-compose.dev single PG (PostgreSQL 18.4).
Nature: research / falsification / decision only. No production or test file was modified; all harnesses live under `/tmp/478/` (experiment-only).

```text
LIVE_MASTER = 65d567774cdf66bfff12269d3ed43e24ff02e398 (origin/master identical)
WORKTREE    = /home/hoo/Source/exam (master, clean; 2 unrelated untracked files preserved)
NODE        = v24.15.0
PNPM        = 11.1.2
VITEST      = 4.1.7
POSTGRES    = 18.4 (docker exam-dev-db-1, postgres:18.4 bookworm image family)
AVAILABLE_PARALLELISM = 8 → committed policy min(3, max(1, ap−1)) = 3 workers
```

---

## 1. Baseline (canonical `TEST_INFRA_TRACE=1 pnpm --filter @exam/db coverage`, 3 runs)

| run | files | tests | wall | acquisitions | wait p50/p95/max | hold p50/p95/max/sum |
| --- | --- | --- | --- | --- | --- | --- |
| r1 | 55 | 669 | 72.0s | 252 | 87 / 880 / 1417 ms | 97 / 704 / 1186 ms / 62.0s |
| r2 | 55 | 669 | 78.7s | 252 | 92 / 1118 / 4164 ms | 102 / 746 / 4096 ms / 70.3s |
| r3 | 55 | 669 | 75.3s | 252 | 78 / 923 / 4967 ms | 98 / 717 / 4894 ms / 68.8s |

- All 3 runs PASS, 0 flakes, 0 timeouts. Ordinary variance ±4.5%.
- Acquisition count reconciles with #480's Stage-A dataset (248 at `a2c99f4c`): per-caller composition identical, +4 total consistent with 52→55 files / 600→669 tests growth.
- **Lane utilization ≈ 91%** (hold sum 62–70s over wall 72–79s) at the committed cap=3. The suite is at the throughput knee on this machine, exactly as #480 concluded at 2–20 CPU profiles.
- The suite leaves **zero** `test_%` schema residue per run (93 drops for 92 creates + failure-path drops); containment works.

## 2. Participant inventory (reverse reachability from `withTestInfraLifecycleLock`)

| caller (site) | operation | resource | acquisitions/run | hold sum/run |
| --- | --- | --- | --- | --- |
| `dropTestSchema` (testIsolation.ts:181) | DROP SCHEMA CASCADE | one namespace in `exam_test` | 93 | 8.8s |
| `createTestSchema` (testIsolation.ts:141) | CREATE SCHEMA | one namespace in `exam_test` | 48 | 1.3s |
| `getIsolatedTestDb` (testDb.ts:126) | CREATE SCHEMA + drizzle migrate (ONE merged critical section) | fresh schema + its own `__drizzle_migrations` | 44 | 26.4s |
| `applyAllMigrations` (10 migration test files) | raw replay of all 44 migration files | fresh schema | 18 | 11.0s |
| `makeEnv` (0027-convergence) | drizzle migrate per test env | fresh schema | 12 | 6.6s |
| `dropDatabaseIfExists` (testWorkerDatabase.ts:266) | terminate-by-datname + DROP DATABASE | uniquely named fixture DB | 12 | 11.4s (I/O tail; max 4.9s single hold) |
| `ensureDatabaseExists` (testWorkerDatabase.ts:211) | catalog check + CREATE DATABASE | uniquely named fixture DB | 10 | 0.5s |
| testInfraLock.test.ts direct + runner frames | lock-semantics proofs | coordination DB | 15 | ~2.9s |

File classification: **6/55 PURE** (context-types, databaseUrl, e2eSeedOrchestrator, postgres, destructiveDbNameGuard, testScope); 49 import isolation helpers — of these, ~26 repository test files are **DB_QUERY bodies** whose lock exposure is only the per-file setup/teardown edges; 11 are migration-replay/lifecycle-proof files; the rest mixed at the edges.

Not lifecycle-bound despite appearing so: `testScope.ts` (pure resolution), `testDbBootstrap.ts` (1 catalog-check acquisition per run on the implicit-local path), repository test bodies (ordinary SQL).

## 3. Operation/resource taxonomy (reality-merged)

```text
PURE                6 files, no PG
DB_QUERY            repository bodies; never locked (only setup/teardown edges are)
SCHEMA_CREATE       48/run  — pg_namespace row in exam_test
SCHEMA_DROP         93/run  — namespace + contained objects (CASCADE)
SCHEMA_MIGRATE      56/run  — drizzle journal INSIDE the isolated schema; DDL lands via search_path
MIGRATION_REPLAY    18/run  — raw replay, same isolation shape as SCHEMA_MIGRATE
DATABASE_CREATE     10/run  — pg_database row; fixture DBs uniquely named
DATABASE_DROP       12/run  — pg_terminate_backend(datname=X) + DROP DATABASE
```

Shared-catalog scan of all 44 migration files: **no** `CREATE EXTENSION/TYPE/FUNCTION/OPERATOR/EVENT TRIGGER`, **no** `public.`-qualified writes, **no** cross-schema object references (only read-only `pg_catalog` checks). Drizzle journal is per-`migrationsSchema` → replays into distinct schemas are object-disjoint. The suite's isolation model leaves **no shared mutable catalog object** across resources.

## 4. Conflict matrix

| A ∥ B | current | verdict | evidence |
| --- | --- | --- | --- |
| migrate schema A ∥ migrate schema B | serialized | **SAFE_TO_OVERLAP** | E1 15/15: journals complete, identical table sets; 1.84× throughput at N=2, per-op +9% |
| create/drop schema A ∥ create/drop schema B | serialized | **SAFE_TO_OVERLAP** | E2 15/15; catalog-level note: N simultaneous full CASCADE drops multiply `pg_locks` shared-memory usage (bulk multi-drop in one tx hits `max_locks_per_transaction`) |
| replay schema A ∥ drop schema B | serialized | **SAFE_TO_OVERLAP** | E3 15/15; replay unslowed |
| schema lifecycle ∥ database lifecycle | serialized | **SAFE_TO_OVERLAP** | E4 15/15 + pressure; terminate predicate is datname-scoped, never touches `exam_test` sessions |
| database A ∥ database B (create/drop) | serialized | SAFE, **zero throughput gain** | E5 15/15: 561ms/pair vs 273+273 sequential — PG self-serializes on WAL/pg_database; keep serialized |
| migrate ∥ drop of the SAME schema | never happens | hostile probe S7: drop wins, loser errors cleanly; no PG corruption | informational; any per-resource model serializes same-name by construction |
| ordinary query ∥ any lifecycle op | already unlocked | SAFE | never enters the sink |

**MUST_SERIALIZE invariants that genuinely remain**: (1) ordering within ONE resource's own bootstrap (create→migrate, ensure→migrate) — already single-acquisition by ADR-007 rule 3; (2) coordination homogeneity — all lifecycle keys must host on one coordination database (advisory locks are database-local; ADR-007 rule 7).

## 5. Historical reproducer and failure-class separation

| class | historical evidence | status |
| --- | --- | --- |
| A — wrong worker-slot cardinality | PR #335: `VITEST_WORKER_ID` binding → per-file DB churn → queue amplification (13 DBs for 2 slots probe) | **structurally fixed** (VITEST_POOL_ID binding) |
| B — concurrent DDL/catalog correctness failure | **NONE EXISTS** in ADR-007, test-flakes registry, or PR history. The lock's original rationale (Phase 6D: "contend on the same PG engine… can exceed the default 5s testTimeout") is a contention/timeout claim, not a corruption claim | no reproducer ever existed; E-suite is the strongest bounded falsification attempt — none found |
| C — queue/timeout cascade | test-flakes 2026-08-26: one 23.4s DROP DATABASE hold → 23.5–23.9s schema-setup waits → 6 suites hook-timeout; #463; #480 (112 runs) | **mitigated** by cap=3 (queue depth bounded; hooks carry 30s budgets; baseline max wait ~5s) |

Consequence: the ONE-key design (ADR-007 rule 5) is a **contention-shaping and conservatism choice, not a load-bearing correctness requirement**. Its correctness-necessity claim is falsified for this suite's operation set; what remains is a simplicity/robustness tradeoff.

## 6. Controlled overlap experiments (experiment-only, `/tmp/478/`)

All harnesses import the real built helpers from `packages/db/dist`; every round verifies journal completeness, table-set equality, expected schema/database existence, absence of leaks, and closed connections. 168/168 checks PASS overall.

| exp | result |
| --- | --- |
| E1 migrate∥migrate | 15/15 clean; pair p50 491ms vs 451ms single (E1S) → 1.84× throughput, +9% per-op |
| E2 create/drop∥create/drop | 15/15 clean; pair p50 79ms |
| E3 replay∥drop-other-schema | 15/15 clean; p50 487ms (unslowed) |
| E4 schema-migrate ∥ db create+drop | 15/15 clean; p50 1243ms vs 2235ms sequential → overlap wins 1.8×; max 7258ms (DROP I/O tail roughly doubles under overlap — I/O-bound, matches the documented 4.3–5.7s historical tail) |
| E5 db create/drop ∥ db create/drop | 15/15 clean; NO gain (561ms vs 546ms sequential) — keep serialized |
| Pressure N=6×12 / N=8×10 / N=4×15 random ops | 3/3 CLEAN: 0 op errors, 0 leaked schemas/dbs, 0 lingering connections |
| S7 hostile same-schema migrate∥drop | drop wins cleanly; out of scope by construction |

## 7. Negative controls

- **NC1 — scheduling split (Model S)**: real suite at `--maxWorkers=4` → 70.4s (−6.5%), wait p50 87→510ms; at 6 → 70.0s (no further gain), wait **max 6771ms** (queue envelope broken). Scheduling past the saturated lane buys ≤6–10% and destroys headroom; consistent with #480's 112-run matrix. **REJECTED.**
- **NC2 — lifecycle-frequency reduction**: hold composition is ~91% intrinsic per-file isolation/replay work; no material lock-level redundancy exists. Material reduction would require a template-schema/isolation-architecture change (new correctness surface: sequence state, object ownership) — out of #478's scope, recorded as the future workload lever.
- **NC3 — cap=3 re-verified at current HEAD**: 3/3 PASS at 669 tests (+69 since #480's baseline), wait p95 ≈ 1s, envelope holding. The committed policy is confirmed, not stale.

## 8. Candidate models

| model | verdict | reason |
| --- | --- | --- |
| G — ONE key + cap=3 | **CHOSEN** | 0 failures; at the knee; residual tail risk bounded by hook budgets |
| S — split test classes only | REJECTED | ≤6% ceiling (NC1), leaves in-body victim class intact |
| B — bounded N=2 same-class semaphore | REJECTED | cross-process N-semaphore is strictly more mechanism than class keys; no unique benefit proven (E5 shows the only N>1 win is inside the schema class, which C/R address with keys, not semaphores) |
| C — class keys (schema lane ∥ database lane) | NOT RECOMMENDED NOW; pre-validated contingency | E4+pressure prove the split safe. Best-case LOCAL gain ≈ wall − (11.9s db-class holds × ~0.45–1.0 overlap efficiency) ≈ 5–16%. Decisive counter: the db-class holds ARE the host-I/O tail — the saving is largest exactly where I/O is worst (slow WSL2) and shrinks toward single digits on fast-NVMe CI, the machine that matters. Adds a 2nd key + class tagging + the new mis-tagging failure-mode class. Below the 15–20% aid on transfer-adjusted estimate; job not a CI bottleneck (Package-coverage ≈ 95s, parallel fan-out; api-coverage is the big job) |
| R — per-resource identity keys | REJECTED AS OF TODAY | E1/E3+pressure prove resource independence for THIS op set; local ceiling 30–40%. Rejected on: (a) highest proof burden — rewrite the single-key regression suite, re-derive ADR-007 rules 3/5/7, FNV key-collision analysis; (b) re-introduces the lock-namespace ≠ protected-resource-namespace risk class that PR #335 rounds 4–5 just eliminated for the run lease (a future mis-tagged caller silently under-serializes — fails only in rare races); (c) gain is CPU-contingent: E1's 1.84× was measured with PG on idle cores; on 4-vCPU CI where PG shares cores with coverage-instrumented workers, migration replay is CPU-bound and the overlap gain collapses toward the CPU floor |

## 9. Final decision

```text
FINAL_DECISION = KEEP_GLOBAL
IMPLEMENTATION_AUTHORIZED = NO
READY_TO_UPDATE_481 = YES
READY_TO_CLOSE_478 = YES   (a negative result is a complete successful result per #478 §18)
RUN_LEASE_TOUCHED = NO     (#644 disposition intact, read-only)
TIMEOUT_INFLATION = NO
ISOLATION_REGRESSION = NO  (no repo file modified; 669/669 × 3 baseline runs)
```

**WHY**: The two failure classes that once motivated global serialization were structurally fixed elsewhere (identity → PR #335; queue → cap=3, PR #479). No category-B correctness reproducer ever existed, and the E-suite + pressure tests falsify the residual correctness claim for this suite's operation set. But decomposition's value is environment-relative: it saves time in proportion to how slow the host's database I/O and CPU are, which is worst exactly on the slow local hosts where the suite is least run, and smallest on fast CI where `@exam/db` coverage is a ~60–75s slice of a non-bottleneck parallel job. Against that stands a real, permanent complexity cost — new keys/class tags, a new silent-under-serialization failure mode class (the exact class PR #335 rounds 4–5 eliminated for the run lease), and a rewritten regression corpus. The transfer-adjusted gain sits at or below the issue's own 15–20% complexity gate; the conservative engine that already works keeps.

**PR335_FINDINGS_PRESERVED**: slot identity (VITEST_POOL_ID), one-critical-section-per-setup, bootstrap memoization/server-side precheck, authority propagation, ONE-key engine guarantee (now evidence-qualified rather than correctness-loaded), hook budgets at call sites, run-lease single-run contract — all unchanged.

**WHAT REMAINS NOT PROVEN**:
1. The exact CI-runner wall-time effect of Models C/R (estimates are local-machine arithmetic + measured per-op contention factors, not CI prototype runs).
2. Model R's safety under a future op set that adds extensions, shared functions/types, or `public.`-qualified writes — the current proof is scoped to "44 migration files, per-schema journals, no shared objects".
3. Behavior of N>2 concurrent schema-class migrations on 2-vCPU profiles (E1 measured N=2 on an 8-core host).

**Re-open triggers** (documented for #481): (a) db-package growth pushes body-level wait p95 > ~2s at cap=3; (b) db coverage becomes a pipeline bottleneck; (c) a new lifecycle class with materially different resource semantics appears — then the pre-validated first move is Model C's two-key split at that boundary, with E4+pressure as its safety evidence.

Artifacts: `/tmp/478/` (baseline logs + trace parser `parse-trace.mjs`, experiment harness `overlap-exp.mjs`, pressure harness `pressure.mjs`) — experiment-only, not persisted into the repository. Experiment fixtures fully cleaned (0 residue in PG).
