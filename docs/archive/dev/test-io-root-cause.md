# Test I/O Root Cause Analysis

> Phase 1 of the test-I/O optimization task. Decompose "I/O contention" into
> verified, evidenced sources. Every candidate is backed by a command, timing,
> or file location. No code changed in this phase.

## Summary

The Phase 2 收口's "I/O contention" label resolves into **three distinct,
independent** sources — only one of which is the PostgreSQL DDL/migration
contention that motivated BUG-FLAKE-001's serial mitigation:

1. **api `import` overhead (~36–43s)**: `apps/api` runs serial
   (`fileParallelism:false` → vitest `forks` pool, one isolated fork per file).
   Each fork re-imports the entire Fastify + plugins + db + contracts stack.
   This is pure CPU/module-load, not PG I/O. Measured: vitest `import` =
   35.7–42.7s across runs.
2. **api per-build migrate/DDL (~11s spread across `tests`)**: every
   `buildTestApp` (default `file-schema` path) does CREATE SCHEMA + runs all 7
   Drizzle migrations + seed. ~58 builds across the suite at ~195ms each.
   `migratePostgres` (~84ms) is the dominant per-build cost; `seed` is small
   (~12ms). This IS PG I/O, but it is **per-build, not concurrent** under the
   current serial regime.
3. **web/jsdom suite (~122–132s)**: the dominant cost of `test:nodb`, and
   **entirely unrelated to PostgreSQL** (web has no DB dependency). This is a
   separate problem (jsdom environment + import) and is out of scope for a
   PG-I/O task.

The BUG-FLAKE-001 *concurrent* DDL contention is real but only manifests when
parallelism is restored; under the current serial api run it is dormant.

## Root cause candidates

| Candidate | Evidence | Impact | Confidence | Fix strategy |
|---|---|---:|---:|---|
| api per-build migrate (7 files × 58 builds) | bench ~84ms/migrate; migratePostgres.ts:73 runs all 7 each fresh schema | ~5–11s | **high** | migrate-once-per-process cache, or template-DB clone |
| api per-file import overhead | vitest `import` 35.7–42.7s; serial forks re-import stack | ~36–43s | **high** | (harder) globalSetup to warm cache, or reduce import fan-out; out of low-risk scope |
| web jsdom suite (separate) | web 122–132s; env 41s+import 23.5s; no PG dep | ~122–132s | **high (disproved as PG cause)** | separate task; not PG I/O |
| per-build CREATE SCHEMA | bench ~36ms × 58 | ~2s | high | subsumed by migrate-once |
| per-build cleanup DROP SCHEMA | bench ~51ms × 58 | ~3s | high | subsumed by migrate-once |
| seed (org+3 users) per build | bench ~12ms × 58 | ~0.7s | high | NOT a priority (small) |
| concurrent DDL contention (BUG-FLAKE-001) | test-flakes.md PR86 matrix; dormant under serial | 0 now / high if parallelized | high | advisory lock exists; matters only at parallelism |
| coverage instrumentation | verify runs api test + api coverage separately | ~api-sized extra | medium | coverage layering (Phase 8) |
| background scanner leak | onClose clearInterval (heartbeat.ts:254) | 0 | disproved | none |

## PostgreSQL lifecycle findings

- **Repeated migration is the PG I/O cost.** `migratePostgres` (postgres.ts:73)
  calls Drizzle's `migrate()`, which on a fresh schema has no
  `__drizzle_migrations` tracking rows and therefore runs all 7 migrations
  (233 lines). Measured ~84ms/build (Phase 0 bench), confirmed ~111ms in the
  clone bench (migrate-into-template-db).
- **Build count is high**: ~58 `buildTestApp` references across api test files.
  Many files use the "one buildTestApp per `describe` block" pattern
  (exam.test.ts: 4 describe→4 builds; examTransitions.test.ts: 6; auth.test.ts:
  6), multiplying the migrate cost within a single file.
- **CREATE SCHEMA (~36ms) + DROP SCHEMA CASCADE (~51ms)** per build add
  ~87ms/build. The advisory lock (`testInfraLock`) serializes these across
  workers, so under serial api they do not contend — but they are repeated
  work.
- **Template-DB clone is faster**: `CREATE DATABASE ... TEMPLATE <migrated>`
  measures **~62ms** vs ~84–111ms to migrate — a real but modest gain, and it
  requires the template DB to have zero connections (a concurrency hazard for
  parallel workers). **Not the primary win.**
- **TRUNCATE is cheap**: `resetPostgres()` (TRUNCATE RESTART IDENTITY CASCADE)
  is the worker-DB reset path and is fast — it is the basis for a
  "migrate-once, reset-between-builds" strategy.

## Seed findings

- **Seed is NOT the bottleneck.** `seed()` (seed.ts:80) inserts 1 org + 3 users
  via idempotent upsert, ~12ms/build. Even at 58 builds that is ~0.7s total.
  The migrate that precedes it (~84ms) is ~7× more expensive per build.
- **No shared default-org pollution**: per-file schema isolation gives each
  file its own org/users (no ID sharing). E2E seed (`e2e-seed.ts`) is separate.
- Conclusion: **seed redesign is NOT warranted by I/O evidence.** The 收口
  hypothesis that seed might be a high-cost/pollution source is **disproved**
  for the api suite. (web/jsdom is the nodb cost; it has no seed.)

## Background worker findings

- **No leak.** Heartbeat + deadline scanners register `onClose`→`clearInterval`
  (heartbeat.ts:254, deadlineScanner.ts:244). `buildTestApp` cleanup calls
  `app.close()`, stopping timers between contexts.
- **Scanner integration tests are intentional** (testBackgroundJobs.test.ts,
  deadline-scanner.test.ts) and opt-in by registering the scanner plugin — not
  a default-leak. No change needed.
- Redis/presence/rate-limit have no runtime consumers in tests; Redis adds ~0
  cost when unset (default).

## Turbo/Vitest findings

- **`fileParallelism:false` is a mitigation, not a cost driver by itself** —
  it serializes files to avoid BUG-FLAKE-001 concurrent DDL contention, but
  its side effect is that each file runs in a fresh isolated fork, paying full
  import cost. The serialization removes contention but does not add PG I/O;
  the per-file import is the price of isolation.
- **api import 35.7–42.7s** is real and is the **single largest api cost
  bucket**, larger than the migrate I/O. It is module-load CPU, not PG I/O.
- turbo: `@exam/api#test` dependsOn `@exam/db#test` (api waits db) — intentional
  ordering, not a bottleneck.

## Coverage findings

- `verify:db-tests` runs api **test + coverage** separately (each ~api-sized),
  doubling the api cost in full verify. Coverage instrumentation adds overhead
  on top. This is a full-verify cost amplifier, addressable by layering
  (`verify:fast` without coverage) — Phase 8.

## Frontend/nodb findings

- **`test:nodb` ~105–115s cold is almost entirely `@exam/web` (122–132s).**
  web has NO PostgreSQL dependency (jsdom, component/unit tests). The other
  nodb packages are tiny (auth 1.5s; contracts/domain/exam-engine/import-export
  sub-second). This is a **separate problem from PG I/O** and should be
  optimized independently (jsdom pool, import reduction) — explicitly OUT OF
  SCOPE for this PG-I/O task.

## Confirmed root causes

1. **api per-build migration I/O (~11s)** — repeated 7-file Drizzle migrate on
   ~58 fresh schemas. EVIDENCE: bench 84ms/migrate, 58 buildTestApp refs,
   per-describe-build pattern. FIXABLE with migrate-once-per-process caching.
2. **api per-file import overhead (~36–43s)** — redundant module re-import per
   isolated fork. EVIDENCE: vitest `import` breakdown. Harder to fix safely
   (globalSetup); deferred.
3. **web/jsdom (~122s)** — unrelated to PG. EVIDENCE: web has no DB dep.
   Separate task.

## Disproved hypotheses

- **Seed is a high-cost source**: disproved (~12ms/build; migrate is 7× larger).
- **Background worker leak**: disproved (onClose clearInterval).
- **Concurrent DDL contention under serial run**: dormant (only at parallelism).
- **`test:nodb` is a PG I/O problem**: disproved (it is web/jsdom).

## Recommended implementation plan

Target the **highest-confidence, lowest-risk, fully-reversible** win first:

1. **Migrate-once-per-process cache** (api `file-schema` path): cache the
   migrated schema across `buildTestApp` calls within one vitest fork, so a
   file with N describe-blocks pays migrate ONCE instead of N times. Reset
   between builds via TRUNCATE (fast) instead of CREATE SCHEMA + migrate.
   Expected: cut the ~11s migrate I/O substantially; risk low because each
   fork still owns an isolated schema (correctness preserved). REVERSIBLE.
2. **Coverage layering** (Phase 8): add `verify:fast` (no coverage) so the
   common dev loop skips the coverage double-run. No correctness impact.
3. **Defer**: import-overhead reduction (globalSetup) and web/jsdom (separate
   task) — both larger but higher-risk or out of scope.

Do NOT change `fileParallelism`, seed structure, or business state in this
round. The migrate cache is the minimal, evidence-based win.
