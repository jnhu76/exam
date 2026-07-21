# Database Boundary Contract

> Reconstructed from production code at the verified commit.

```text
STATUS:          CURRENT
AUTHORITY:        Architecture
SCOPE:            packages/db boundary, repository rule, db ↔ domain contract
OWNER:            Architecture
BASELINE SYSTEM COMMIT:
                 e7af792815e8cf4bcff122a3d1d8db500b9d6eff (PR #197)
LAST VERIFIED REPOSITORY COMMIT:
                 c0dde8f1c11d05e78cf9dfb871afd3bbdee6daa2
                 The baseline system commit is NOT the final verification
                 commit of the reorganized repository.
SUPERSEDES:       —
RELATED ADRS:     ADR-005 (lock-reconcile-assert-mutate), ADR-006 (now() in repos)
```

## 1. Stack

- **PostgreSQL is the only supported database.** Repository and service code
  must remain database-agnostic.
- **Drizzle ORM** is the access layer (`drizzle-orm/postgres-js` + `postgres`).
- Schema lives in `packages/db/src/schema/pg.ts`. Migrations live under
  `packages/db/src/migrations/`.
- Three local databases isolate dev / test / e2e: `exam` (dev runtime),
  `exam_test` (vitest), `exam_e2e` (WSL Playwright). See `AGENTS.md`
  "Local Database Discipline" — these must not be mixed.

## 2. Dependency direction

```text
domain (leaf — no internal deps)
   ↑
db     (may type-import domain types/enums; MUST NOT depend on api/web/desktop,
        exam-engine commands, fastify, or react)
```

- `packages/db` declares `@exam/domain` as a production dependency (used for
  JSONB field typing: `AnswerRecord`, `ControlFlags`, `GradingRule`,
  `QuestionSnapshot`, `SubmittedAnswersSnapshot`, etc.).
- `packages/db` declares `@exam/auth` **only as a devDependency** — the only
  call sites are seed scripts (`seed.ts`, `e2e-seed.ts`) that dynamically
  import `@exam/auth/src/password.js` for hashing. Runtime library code in
  `db` must not import `@exam/auth`. (This is the blocker tracked for the
  conditional `auth` merge — scan review §2.4, §2.16.)

Rules:

- **DB CAN depend on:** domain types, domain enums, pure data structures.
- **DB MUST NOT depend on:** domain orchestration, exam-engine commands, API
  services, fastify, web, desktop.
- **Domain MUST NOT know about:** column/table names, Drizzle, PostgreSQL,
  migrations, repositories.

## 3. Repository rule (binding)

**All database access goes through repository methods that take `ctx` as the
first argument.** Bare `db.select()` / `db.execute()` in route handlers is
forbidden and is enforced by review and lint.

`ctx` carries the resolved organization and actor, which is how the
single-tenant data boundary is enforced at the data-access layer rather than
ad-hoc per route.

Repository layout (`packages/db/src/repository/`): one file per aggregate —
`attemptRepo`, `attemptGradingEntryRepo`, `auditLogRepo`, `candidateRepo`,
`candidateFieldRepo`, `clientEventRepo`, `courseRepo`, `emailOutboxRepo`,
`enrollmentRepo`, `examRepo`, `gradingQueueRepo`, `importJobLogRepo`,
`organizationRepo`, `questionRepo`, `settingsRepo`, `systemStatsRepo`,
`userRepo`, `userRoleAssignmentRepo`, plus `baseRepo`.

## 4. Package exports (current state, Wave 2 cleanup)

`packages/db/package.json` currently exports:

```json
{
  "exports": {
    ".": "./dist/index.js",
    "./src/*": "./dist/*"
  }
}
```

The `"./src/*": "./dist/*"` wildcard allows deep imports into arbitrary
internal paths and weakens the package boundary. Wave 2 work (not authorized
here) will replace it with explicit subpath exports:

```json
{
  "exports": {
    ".": "./dist/index.js",
    "./schema": "./dist/schema/index.js",
    "./repositories": "./dist/repository/index.js",
    "./testing": "./dist/testing/index.js"
  }
}
```

Until that change lands, treat the barrel (`@exam/db`) and the repository
index as the public surface; do not reach into arbitrary `src/*` paths from
`apps/api`.

## 5. Time in repositories

Repository methods that need "now" must accept it as a parameter (threaded
from `fastify.now()` at the call site) or read it inside the mandated strict
zones. Raw `new Date()` and SQL `now()` are banned in strict business zones
(ADR-006, enforced by a structural test with a zoned allowlist).

## 6. Concurrency

- **Row locks** protect attempt submit/grade and stateful admin operations.
  The mandatory pattern is **lock-reconcile-assert-mutate** (ADR-005): acquire
  the row lock, reconcile current state, assert preconditions, then mutate in
  the same transaction.
- **`submitAndGradeAttempt`** collapses submit + auto-grade into a single
  transaction under the row lock (ADR-008). This closes the stale-snapshot
  race; concurrent save-vs-submit ordering is decided by Postgres
  lock-acquisition order and is documented as legitimate.

## 7. Wave 1 boundary (what this doc does NOT authorize)

This document describes the current database boundary. It does **not**
authorize:

- The `./src/*` → explicit-subpath exports change (Wave 2).
- Any change to seed-script `@exam/auth` imports (tracked under the `auth`
  merge blocker).
- Introducing a second database backend.
- Splitting the schema file or moving repositories.
