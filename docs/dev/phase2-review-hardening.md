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
