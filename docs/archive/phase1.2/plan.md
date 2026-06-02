# Phase 1.2 Implementation Plan

## Overview

Phase 1.2 is a test-hardening pass over the existing Phase 1.1 codebase. No new features. Focus: lock down core risks with stable, repeatable tests.

## Current State (from exploration)

- **API tests:** 18 files, 121 tests (all via `buildTestApp` + `fastify.inject`)
- **Web tests:** 14 files, 106 tests (vitest + react testing library)
- **Package tests:** 14 files (exam-engine, db, auth)
- **No Playwright** — no e2e infrastructure exists
- **No CI coverage reporting** — CI only runs lint+typecheck+test+build
- **`@exam/import-export`** has no real tests (only `tsc --noEmit`)
- **Existing helpers:** `buildTestApp`, `createCandidateViaApi` in testHelpers.ts

## Architecture Decisions

- All API integration tests use existing `buildTestApp` + `fastify.inject` pattern
- Playwright e2e is P0 per the spec but requires new infra — will set up minimal config + one smoke test
- CSV escaping tests go in `export.test.ts` (API-level), not a new file
- State transition tests go in a new `examStateMachine.test.ts` at API route level
- No new packages or heavy dependencies

## Task List

### Phase A: Test Helpers Enhancement (P0)

#### Task A1: Expand test helpers with exam lifecycle helpers

**Description:** Add `createExamViaApi`, `publishExamViaApi`, `submitExamAsCandidate`, `exportResultsCsvAsAdmin` to testHelpers.ts.

**Acceptance criteria:**
- [ ] `createExamViaApi` creates course + question + exam, returns examId
- [ ] `publishExamViaApi` publishes an exam, returns updated exam
- [ ] `submitExamAsCandidate` creates candidate, enrolls, starts, submits all answers
- [ ] `exportResultsCsvAsAdmin` calls export endpoint, returns response
- [ ] Each helper uses unique identifiers to avoid test pollution

**Verification:** Existing tests still pass after refactor

**Dependencies:** None

**Files:** `apps/api/src/routes/testHelpers.ts`

**Scope:** S (1 file)

---

### Phase B: API Integration Tests — Gaps (P0)

#### Task B1: CSV export full integration tests

**Description:** Expand `export.test.ts` to cover Content-Disposition, examId filtering, CSV escaping, and data-bearing export.

**Acceptance criteria:**
- [ ] Test Content-Disposition header contains `attachment`
- [ ] Test Content-Type is `text/csv; charset=utf-8`
- [ ] Test CSV headers are stable (考生姓名, 成绩, 及格状态, etc.)
- [ ] Test CSV with actual graded data contains score fields
- [ ] Test CSV escaping for commas, quotes, newlines in candidate names
- [ ] Test examId filtering (cross-exam isolation)
- [ ] All Phase 1.1 tests (404, empty, 401, 403) still pass

**Verification:** `pnpm vitest run apps/api/src/routes/export.test.ts`

**Dependencies:** A1 (for submitExamAsCandidate helper)

**Files:** `apps/api/src/routes/export.test.ts`

**Scope:** M (1 file, significant additions)

#### Task B2: Candidate/profile invariant tests (enhanced)

**Description:** Expand `candidateInvariant.test.ts` to cover no-profile rejection for exam start.

**Acceptance criteria:**
- [ ] Candidate without profile cannot start an exam (verified via API)
- [ ] Candidate without profile cannot submit answers
- [ ] Candidate with profile can do both

**Verification:** `pnpm vitest run apps/api/src/routes/candidateInvariant.test.ts`

**Dependencies:** A1

**Files:** `apps/api/src/routes/candidateInvariant.test.ts`

**Scope:** S

#### Task B3: Permission boundary tests

**Description:** New test file covering cross-role access for all critical endpoints.

**Acceptance criteria:**
- [ ] Candidate cannot access any /admin/* API (exams CRUD, scores, export, candidates)
- [ ] Unauthenticated gets 401 on all protected endpoints
- [ ] Teacher can access exams/scores/export but not users/candidates
- [ ] Admin can access all management APIs

**Verification:** `pnpm vitest run apps/api/src/routes/permissionBoundary.test.ts`

**Dependencies:** A1

**Files:** `apps/api/src/routes/permissionBoundary.test.ts` (new)

**Scope:** M

---

### Phase C: Frontend Route & Nav Tests (P0)

#### Task C1: Sidebar nav link and active state tests

**Description:** Add tests to `layout.test.tsx` verifying sidebar links point to correct routes and NavLink active behavior.

**Acceptance criteria:**
- [ ] "考试管理" link points to `/admin/exams`
- [ ] "成绩查询" link points to `/admin/results`
- [ ] NavLink is used (not plain Link)
- [ ] Active state rendering verified for at least `/admin/exams`

**Verification:** `pnpm vitest run apps/web/src/components/layout/layout.test.tsx`

**Dependencies:** None

**Files:** `apps/web/src/components/layout/layout.test.tsx`

**Scope:** S

#### Task C2: Route separation test

**Description:** Test that `/admin/results` renders ResultsOverviewPage, not ExamPage.

**Acceptance criteria:**
- [ ] `/admin/results` route exists in routes.ts
- [ ] Route wiring in App.tsx maps correctly

**Verification:** `pnpm vitest run apps/web/src/lib/routes.test.ts`

**Dependencies:** None

**Files:** `apps/web/src/lib/routes.test.ts`

**Scope:** XS

---

### Phase D: State Transition Tests (P1)

#### Task D1: Exam state machine API tests

**Description:** Test all legal and illegal exam state transitions via API.

**Acceptance criteria:**
- [ ] draft → published (valid)
- [ ] draft → archived (valid if not published)
- [ ] published → archived (valid)
- [ ] published → published (rejected: already published)
- [ ] draft edit works, published edit rejected
- [ ] closed exam rejects new attempts

**Verification:** `pnpm vitest run apps/api/src/routes/examStateMachine.test.ts`

**Dependencies:** A1

**Files:** `apps/api/src/routes/examStateMachine.test.ts` (new)

**Scope:** M

---

### Phase E: Boundary Input Tests (P1)

#### Task E1: API input validation tests

**Description:** Test Zod schema boundaries for exam, question, candidate creation.

**Acceptance criteria:**
- [ ] Empty title rejected
- [ ] Oversized title (>200 chars) rejected
- [ ] Negative score rejected
- [ ] Invalid email rejected
- [ ] Duplicate candidate username rejected
- [ ] Invalid time range (closeAt < openAt) rejected

**Verification:** `pnpm vitest run apps/api/src/routes/inputValidation.test.ts`

**Dependencies:** A1

**Files:** `apps/api/src/routes/inputValidation.test.ts` (new)

**Scope:** M

---

### Phase F: Playwright Smoke (P0)

#### Task F1: Playwright setup + minimal smoke test

**Description:** Install Playwright, create config, write one smoke test covering admin login → exam list.

**Acceptance criteria:**
- [ ] `@playwright/test` installed in root
- [ ] `playwright.config.ts` exists with minimal config
- [ ] One smoke test: admin login, see dashboard
- [ ] `pnpm test:e2e` runs the smoke test
- [ ] CI job for e2e added (or documented as manual)

**Verification:** `pnpm test:e2e` passes

**Dependencies:** None (can run in parallel)

**Files:** `playwright.config.ts`, `e2e/smoke.spec.ts`, `package.json` updates

**Scope:** M

---

### Checkpoint: After Phase A-C (P0 complete)
- [ ] All 227+ existing tests pass
- [ ] New CSV export tests pass
- [ ] Permission boundary tests pass
- [ ] Sidebar nav tests pass
- [ ] `pnpm verify` passes

### Checkpoint: After Phase D-E (P1 complete)
- [ ] State machine tests pass
- [ ] Input validation tests pass

### Final Checkpoint: Phase F
- [ ] Playwright smoke passes locally
- [ ] CI updated
- [ ] Review report written

## Execution Order

```
A1 → B1, B2, B3 (parallel after A1)
C1, C2 (parallel, no deps)
D1 (after B1)
E1 (after B3)
F1 (parallel, no deps)
```

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Playwright install large | Slow CI | Cache browser install, only run smoke |
| Test pollution between files | Flaky | Use unique IDs via helpers |
| Existing tests break | Regression | Run full suite after each phase |
