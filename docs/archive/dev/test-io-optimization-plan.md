# Test I/O Optimization Plan

> Phase 2 of the test-I/O optimization task. Designs the safe speedup before any
> code change. Candidate strategies are evaluated against the Phase 1 root-cause
> evidence, with authoritative tool behavior verified via Context7 (Vitest,
> Drizzle) and the PostgreSQL docs (CREATE DATABASE TEMPLATE). The selected plan
> is the minimal, reversible, evidence-based win.

## Summary

The two actionable api-suite cost centers are (1) the **35.7s per-file import
overhead** (redundant module re-import per isolated fork) and (2) the **~11s
per-build migration I/O** (all 7 migrations re-run on ~58 fresh schemas).
Authoritative evidence selects:

- **`isolate: false`** (Vitest) to collapse the import overhead — directly
  targets the largest bucket, is a documented Vitest optimization, and is safe
  here because the api suite already runs serially (`fileParallelism:false` →
  one worker) AND every file gets its OWN isolated PG schema (no cross-file DB
  state to leak). Correctness depends on module-level state discipline; this is
  the principal risk and is validated by a full-suite run.
- **migrate-once-per-process cache** to remove redundant migration — Drizzle's
  `migrate()` is idempotent (applied migrations are skipped), so caching the
  first migration and TRUNCATE-resetting between builds is safe.

**Rejected**: Template-DB cloning — PostgreSQL requires the template to have
**zero other connections** during the copy (official docs), which makes it
unsafe for any future parallelism and offers only a modest ~62ms-vs-84ms gain.

## Constraints

- No Phase 3 features; no business-semantic change; no state-machine rewrite.
- PostgreSQL stays canonical; Redis stays optional infra.
- No `fileParallelism:true` flip without isolation evidence (BUG-FLAKE-001).
- No test deletion, no skip/timeout/retry masking, no coverage reduction.
- Every change must have before/after timing and a clean full-suite run.
- Reversible: each change is a standalone commit.

## Candidate strategies

| Strategy | Expected impact | Risk | Implementation cost | Decision |
|---|---:|---:|---:|---|
| `isolate: false` (Vitest) for apps/api | **-30 to -40s** (kill import 35.7s) | Med (module-state sharing across files) | Low (config flag + validation) | **SELECT (Phase 3a)** |
| migrate-once-per-process cache | **-5 to -10s** (remove ~11s migrate repeats) | Low (each fork still owns its schema; TRUNCATE reset) | Med (cache helper in testHelpers) | **SELECT (Phase 3b)** |
| Template-DB clone (`CREATE DATABASE TEMPLATE`) | -3s | **High** (PG: template must have 0 connections — breaks parallelism; official docs) | Med | **REJECT** |
| Per-worker database (existing, opt-in) | enables parallelism | Med (BUG-FLAKE-001 I/O contention) | exists | DEFER (Phase 7 only) |
| Seed redesign / split | ~0 (seed is 12ms/build — disproved as cost) | Med (E2E semantic risk) | High | **REJECT (no evidence)** |
| Coverage layering (`verify:fast`) | -1 api-sized run in dev loop | Low | Low | SELECT (Phase 8) |
| globalSetup for import warming | small | Med | Med | DEFER (isolate:false subsumes) |
| web/jsdom pool tuning | -60s+ (separate problem) | Med | Med | **OUT OF SCOPE** (not PG I/O) |

### Evidence basis (authoritative)

- **Vitest `isolate: false`**: official improving-performance guide — "Disable
  test isolation globally … for projects that don't rely on side effects and
  properly clean up their state." With `isolate:false`, files run in the same
  worker WITHOUT re-importing modules between files (vitest-dev/vitest v4.1.6,
  `guide/improving-performance.md`). Context7 `/vitest-dev/vitest/v4.1.6`.
- **Drizzle `migrate()` idempotency**: "Safe to run on every startup as
  already-applied migrations are skipped" (drizzle-team docs, migrations.mdx).
  Context7 `/drizzle-team/drizzle-orm-docs`.
- **`CREATE DATABASE TEMPLATE` restriction**: PostgreSQL docs (current) —
  "no other sessions can be connected to the template database while it is
  being copied. CREATE DATABASE will fail if any other session is connected."
  WebSearch (postgresql.org/docs/current/sql-createdatabase.html). This rules
  out the template approach for any parallel worker future.

## Selected plan

### Phase 3a — `isolate: false` for apps/api (TRIED + DISPROVEN)

> **Result (tried 2026-06-24, reverted):** No improvement. `import` stayed at
> 42.35s (was 35.7–42.7s); wall stayed ~143s. Root cause: the `forks` pool
> (Vitest default) runs **each file in a separate child process** regardless of
> `isolate`. Context7 `/vitest-dev/vitest/v4.1.6` confirms forks isolation is
> process-based — `isolate:false` only disables in-process module reset, but
> since each file is a new process there is nothing to share. The suite DID pass
> (646/5skip), proving it is safe, but it buys nothing under `fileParallelism:false`
> + the forks pool. Reverted; not pursued. (A `pool:'threads'`+`isolate:false`
> switch would share module cache, but changes the concurrency/native-module
> model and is higher-risk — deferred.)

### Phase 3b — migrate-once-per-process cache (the verified I/O win)  **← SELECTED**

In `apps/api/src/routes/testHelpers.ts`, cache the migrated schema per process
(vitest worker). On the FIRST `buildTestApp` in a process: CREATE SCHEMA +
migrate (as today). On subsequent builds in the SAME process: reuse the migrated
schema and TRUNCATE business tables (fast reset) instead of re-CREATE + re-migrate.

**Why safe**: Drizzle `migrate()` is idempotent; a TRUNCATE RESTART IDENTITY
CASCADE resets business rows exactly like `resetPostgres()` in the worker-DB
path. Migration metadata (`__drizzle_migrations`) is preserved. Each process
still owns its own schema(s). This mirrors the already-accepted worker-DB
TRUNCATE-reset behavior, just applied to the file-schema path within a process.

**Risk + guard**: the existing comment in testHelpers.ts:119 notes some files
build the app multiple times and reuse `ctx.org` across builds — TRUNCATE on
every build would wipe that org. So the cache+TRUNCATE is applied ONLY at the
**schema-creation** level (skip re-CREATE/re-migrate when a migrated schema is
already cached), NOT a forced TRUNCATE on every build. The first build migrates;
later builds in the same process reuse the migrated schema and the per-file
cleanup still drops it at end-of-process.

### Phase 8 — `verify:fast` (coverage layering)

Add `pnpm verify:fast` (already partially exists) that skips the coverage
double-run. No correctness change; just a faster dev-loop command. The full
`pnpm verify` (with coverage) stays the CI gate.

## Rollback plan

- Phase 3a: revert the one `isolate: false` line in `apps/api/vitest.config.ts`.
  No other change depends on it. Baseline serial behavior restored instantly.
- Phase 3b: revert the cache helper in `testHelpers.ts`. The original per-build
  CREATE+migrate path is restored. The schema-isolation contract is unchanged.
- Phase 8: remove the `verify:fast` script. `verify` is untouched.
- All three are independent; any can be reverted alone.

## Validation plan

For each phase, before/after:
- `pnpm --filter @exam/api exec vitest run` — must stay 651/651 (0 fail), record
  the vitest `import`/`tests` breakdown and wall time.
- `pnpm verify:static` — must pass.
- `pnpm --filter @exam/db exec vitest run` — must stay green (unaffected).
- Confirm no orphan PG schemas accumulate (`SELECT count(*) FROM
  information_schema.schemata WHERE schema_name LIKE 'test_%'` before/after).
- Final: `pnpm verify` if feasible, else the largest stable subset.

## Non-goals

- No `fileParallelism:true` default flip (needs BUG-FLAKE-001 I/O evidence —
  Phase 7 experiment only, not a default change).
- No seed architecture change (seed is 12ms/build; no evidence it is a cost).
- No web/jsdom optimization (separate problem; web has no PG dependency).
- No Redis-as-business-state, no `FOR UPDATE` replacement, no state-machine edit.
- No OpenTelemetry, no new test framework.
