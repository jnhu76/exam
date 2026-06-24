# Phase 2 Review Findings Hardening

> 2026-06-24 — Fix real engineering issues found during architecture audit.
> No Phase 3 features, no large-scale refactoring.

---

## Changes Made

### 1. Route grading queue through repositories

**Problem:** `apps/api/src/routes/gradingQueue.ts` was the only production route file that directly imported `drizzle-orm` and `@exam/db/src/schema/pg.js`, performing raw `fastify.db.select()` calls (lines 139-160). This violated the repository pattern invariant: all DB access must go through `create*Repo()` factories.

**Fix:** Created `packages/db/src/repository/gradingQueueRepo.ts` with `findExamById()` and `findCandidateWithUser()` methods. The route handler now calls these repo methods instead of building raw SQL queries.

**Files:**
- `packages/db/src/repository/gradingQueueRepo.ts` (new)
- `packages/db/src/index.ts` (export new repo)
- `apps/api/src/routes/gradingQueue.ts` (use repo, remove schema imports)

**Tests:** All 16 grading queue tests pass.

### 2. Push question filtering into repository

**Problem:** `apps/api/src/routes/question.ts` GET /questions loaded ALL questions via `repo.list(ctx)` then filtered in-memory by courseId, type, difficulty, and tags. For large question banks, this is a performance concern.

**Fix:** Added `listFiltered()` and `countByCourseId()` methods to `questionRepo.ts`. Filtering is now done via Drizzle `WHERE` clauses at the SQL level. Tags use PostgreSQL JSONB containment (`@>`).

**Files:**
- `packages/db/src/repository/questionRepo.ts` (add listFiltered, countByCourseId)
- `apps/api/src/routes/question.ts` (use listFiltered)

**Tests:** All 21 question tests pass.

### 3. Normalize course error responses

**Problem:** `apps/api/src/routes/course.ts` constructed error responses inline (`{ error: { code: "NOT_FOUND", message: "..." } }`) without using `buildErrorResponse()`. These responses lacked `requestId` and used non-standard error codes.

**Fix:** Replaced all inline error objects with `buildErrorResponse(request.id, ...)` from `lib/errorResponse.ts`. Added `ErrorResponseSchema` to route response definitions. Also replaced the DELETE handler's pattern of loading all questions to check count with `questionRepo.countByCourseId()`.

**Files:**
- `apps/api/src/routes/course.ts` (use buildErrorResponse, add ErrorResponseSchema)
- `packages/db/src/repository/questionRepo.ts` (add countByCourseId)

**Tests:** All 8 course tests pass.

### 4. Guard route database boundary

**Problem:** No CI-time enforcement preventing future route files from importing `drizzle-orm` or `@exam/db/src/schema/*` directly.

**Fix:** Added two new `forbid` rules to `scripts/check-architecture.mjs`:
- `from "drizzle-orm"` in routes → violation
- `from "@exam/db/src/schema/*"` in routes → violation

The existing `fastify.db.select()` rule was already in place.

**Files:**
- `scripts/check-architecture.mjs` (add 2 forbid rules)

**Verification:** `node scripts/check-architecture.mjs` passes.

---

## What Was NOT Changed (and why)

- **auth.ts, scores.ts, candidate.ts, exam.ts business policies** — The architecture audit flagged embedded domain policies (e.g., `computeResultVisibility`, `getScoreViewMeta`) as deepening candidates. These are real improvements but constitute architectural refactoring beyond the scope of "fix real engineering issues." Deferred to a dedicated refactoring effort.

- **Frontend useFetch hook** — The 26-page boilerplate duplication is a real issue but is a frontend concern, not a route-layer DB boundary violation. Deferred.

- **TakeExamPage decomposition** — The 717-line monolith is a real concern but is a frontend refactoring task. Deferred.

- **`fastify.db as Database` casts** — Multiple route files cast `fastify.db` to `Database` because the Fastify type augmentation in `plugins/db.ts` doesn't always propagate. This is a type-system issue across the codebase, not a pattern violation. Noted for future cleanup.

---

## Verification

- `pnpm --filter @exam/db typecheck` — PASS
- `pnpm --filter @exam/api typecheck` — PASS
- `pnpm --filter @exam/api exec vitest run src/routes/gradingQueue.test.ts` — 16/16 PASS
- `pnpm --filter @exam/api exec vitest run src/routes/question.test.ts` — 21/21 PASS
- `pnpm --filter @exam/api exec vitest run src/routes/course.test.ts` — 8/8 PASS
- `node scripts/check-architecture.mjs` — PASS
- `node scripts/check-hardcoded-copy.mjs` — PASS

---

## P2.1-B P0-like Audit Sweep (2026-06-24)

### P0-like 判定标准

P0-like 是指与原始 P0 同类的真实工程风险：
- DB/repository boundary violations (route 直接 import drizzle-orm / schema / raw db.select)
- In-memory filtering on full DB results (repo.list() 后 .filter()/.some()/.find())
- Inline error responses bypassing the standard error contract
- Missing CI guards allowing pattern violations to regress

纯风格问题（分页 helper 抽取、request.ctx! vs request["ctx"] 统一、schema 去重）不算 P0-like。

### 扫描方法

使用 `rg` 扫描 5 类问题：
- **A. DB/repository boundary**: `from "drizzle-orm" | from "@exam/db/src/schema" | fastify.db.(select|insert|update|delete)` in routes
- **B. Tenant/context boundary**: `targetOrganizationId | organizationId` in routes/lib
- **C. API error contract**: `send({ error | code: "..."` in routes
- **D. List/query performance**: `repo.list(ctx)` then `.filter()/.some()/.find()` in routes
- **E. State/audit/transaction**: `executeInTransaction | recordAudit | status changes` in routes

### Findings Summary

| # | Category | File | Finding | Verdict |
|---|----------|------|---------|---------|
| 1 | A | gradingQueue.ts | drizzle-orm + schema imports | **Fixed** (P0) |
| 2 | D | question.ts | repo.list() + in-memory filter | **Fixed** (P0) |
| 3 | C | course.ts | inline error objects | **Fixed** (P0) |
| 4 | D | course.ts | repo.list().some() for duplicate check | **Fixed** (P0) |
| 5 | D | exam.ts:1227,1300 | enrollmentRepo.list().filter() | **Fixed** (new) |
| 6 | D | candidateField.ts:93,145 | repo.list().some() for uniqueness | **Defer** — tiny table (5-10 rows) |
| 7 | D | attempts.candidate.ts | .find()/.filter() on in-memory queue/state | **Defer** — runtime state, not DB |
| 8 | D | gradingQueue.ts:78,170,241,251 | filtering on snapshot data in memory | **Defer** — snapshot is immutable |
| 9 | D | exam.ts:109,123,408,411,466 | filtering on loaded data | **Defer** — post-load presentation logic |
| 10 | — | attempts/attempts.testHelpers.ts | drizzle-orm import | **False positive** — test file |
| 11 | — | apps/api/src/scripts/* | drizzle-orm + schema imports | **False positive** — scripts, not routes |
| 12 | — | packages/db/* | drizzle-orm imports | **False positive** — db package allowed |

**Results**: 12 candidates scanned, 5 fix, 4 defer, 3 false positive.

### Fixed (new in P2.1-B)

#### 5. Push enrollment filtering into repository

**Problem:** `apps/api/src/routes/exam.ts` lines 1227 and 1300 called `enrollmentRepo.list(ctx)` (loads ALL org enrollments) then filtered by `examId` in JavaScript. This is the same pattern as the question.ts P0 — loading potentially thousands of rows when only a few dozen are needed.

**Fix:** Added `listByExam(ctx, examId)` method to `enrollmentRepo.ts`. The route handler now calls this method instead of `list(ctx).filter()`.

**Files:**
- `packages/db/src/repository/enrollmentRepo.ts` (add listByExam)
- `apps/api/src/routes/exam.ts` (use listByExam at lines 1227 and 1300)

**Tests:** All 44 exam tests pass.

### Deferred (with rationale)

- **candidateField.ts repo.list().some()**: Candidate fields are a tiny table (5-10 rows max). Adding a `hasUniqueField()` method would add abstraction without meaningful performance gain.
- **attempts.candidate.ts in-memory operations**: Exam queue state, attempt state derivation, and answer versioning are runtime state operations on small in-memory collections. These are not DB query patterns.
- **exam.ts post-load filtering**: Filtering on already-loaded data for presentation logic (completedCount, passedCount, etc.) is acceptable — the data is already in memory.
- **gradingQueue.ts snapshot filtering**: Question snapshots are immutable JSONB arrays loaded with the attempt. Filtering for subjective questions is a presentation concern, not a DB concern.

### False Positives

- `attempts/attempts.testHelpers.ts` — test infrastructure, not production code
- `apps/api/src/scripts/*` — one-off scripts (bootstrap, reset-password), not route handlers
- `packages/db/*` — the db package is the correct location for drizzle-orm usage

### Verification

- `pnpm --filter @exam/db build` — PASS
- `pnpm --filter @exam/api typecheck` — PASS
- `pnpm --filter @exam/api exec vitest run src/routes/exam.test.ts` — 44/44 PASS
- `node scripts/check-architecture.mjs` — PASS
- `node scripts/check-hardcoded-copy.mjs` — PASS
