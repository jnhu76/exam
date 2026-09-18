# #549 harness — burst-on-resume measurement

Research-only measurement harness for the admission batch-release decision
(#549, F-08-2 deterministic equivalent). Not wired into any package script;
no production surface.

## Run

```bash
# full 16-scenario matrix
pnpm --filter @exam/db exec tsx \
  docs/research/exam-549-admission-release-semantics-1/harness/burst-on-resume.ts

# subset (comma-separated scenario ids)
SCENARIOS=R-f082-repro,N200-dtall pnpm --filter @exam/db exec tsx \
  docs/research/exam-549-admission-release-semantics-1/harness/burst-on-resume.ts
```

Requires the dev database container (`pnpm db:up`). The harness targets the
repo-owned test database (`exam_test`, name-guarded resolution) inside a
per-run isolated schema that is dropped on exit — dev data is never touched.

## What it measures

Each resumed "client" replays the queue route's exact engine sequence
(`joinAdmissionQueue → reconcileAdmission → previewAdmissionStatus`) against
the real `examAdmissionRepo` on real PostgreSQL with the production-shaped
postgres.js pool (default max=10). The server clock is deterministic: every
poll observes `now = T0 + Δt`.

- expected vs observed eligible/materialized counts (predicate authority check)
- burst wall clock; per-poll p50/p95/max
- exact statement count per poll (wrapped `sql.unsafe` funnel, burst window only)
- pool saturation (in-flight statements + `pg_stat_activity` active sessions)

Raw JSON artifacts land in [`results/`](results/); the canonical full-matrix
run cited by the decision report is
`burst-2026-09-18T15-05-54-574Z.json`.

Note: a harmless `schema ... already exists, skipping` NOTICE is emitted at
startup — drizzle's migrator re-runs `CREATE SCHEMA IF NOT EXISTS` for its
migration-tracking table inside the already-created isolation schema.
