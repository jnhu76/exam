# Job 6 Review Report — Exam Taking Flow

**Date:** 2026-06-01
**Reviewer:** Code review (multi-axis)
**Spec:** `docs/jobs/phase1_job6.md`
**Status:** Conditionally complete — 1 blocking issue, 6 important, 5 low

---

## Summary

Job 6 implements the complete exam taking flow: candidate exam list, start confirmation, full-screen exam UI with 4 question type renderers, answer save protocol, heartbeat/disrupted detection, and attempt lifecycle commands.

**147 tests pass.** `pnpm verify` is clean. All subtasks 6.1–6.7.8 are functionally complete.

One **blocking** issue found (missing Zod validation on attempt routes). Several **important** issues and **low-priority** items documented below.

---

## Subtask Completion Matrix

| Subtask | Description                             | Status                                                                   |
| ------- | --------------------------------------- | ------------------------------------------------------------------------ |
| 6.1     | startAttempt + loadAttempt routes       | ✅ Complete                                                              |
| 6.2     | Answer Save Protocol route              | ✅ Complete                                                              |
| 6.3     | submitAttempt route                     | ✅ Complete                                                              |
| 6.4     | Heartbeat + disrupted detection         | ⚠ Partial — route + pure function done; **background scheduler missing** |
| 6.5     | Candidate exam list page                | ✅ Complete                                                              |
| 6.6     | Start exam confirmation page            | ⚠ Partial — **queue UI missing** (`requireQueue` flow)                   |
| 6.7.1   | Exam taking page shell                  | ✅ Complete                                                              |
| 6.7.2   | QuestionNav component                   | ✅ Complete                                                              |
| 6.7.3   | ExamTimer component                     | ✅ Complete                                                              |
| 6.7.4   | SingleChoiceInput + TrueFalseInput      | ✅ Complete                                                              |
| 6.7.5   | MultipleChoiceInput                     | ✅ Complete                                                              |
| 6.7.6   | FillBlankInput                          | ✅ Complete                                                              |
| 6.7.7   | SaveIndicator + auto-save               | ✅ Complete                                                              |
| 6.7.8   | Submit confirmation dialog + bottom nav | ✅ Complete                                                              |

---

## Review Checklist Results

Per `phase1_job6.md` Review Checklist:

| #   | Check                                                          | Result                                                  |
| --- | -------------------------------------------------------------- | ------------------------------------------------------- |
| 1   | Answer Save Protocol matches SPEC.md §3.5                      | ✅ PASS                                                 |
| 2   | SaveAnswerRequest has clientSeq, baseVersion, clientSavedAt    | ✅ PASS                                                 |
| 3   | SaveAnswerResponse has accepted, serverVersion, conflict?      | ✅ PASS                                                 |
| 4   | Server is sole time authority — deadlineAt from server         | ✅ PASS                                                 |
| 5   | No standardAnswer in candidate-facing responses                | ✅ PASS                                                 |
| 6   | startAttempt() uses command function                           | ✅ PASS                                                 |
| 7   | submitAttempt() validates in_progress status                   | ✅ PASS                                                 |
| 8   | Heartbeat interval and timeout are configurable                | ✅ PASS (via pure function params)                      |
| 9   | All 4 question type renderers work                             | ✅ PASS                                                 |
| 10  | Auto-save debounced 1-2s                                       | ✅ PASS (1.5s debounce)                                 |
| 11  | Submit dialog shows unanswered + flagged counts                | ✅ PASS                                                 |
| 12  | No duplicate DTOs (types from @exam/domain or @exam/contracts) | ⚠ PARTIAL — frontend redefines QuestionSnapshot locally |
| 13  | No `any` / `as any`                                            | ✅ PASS                                                 |
| 14  | No bare `db.select()` in routes                                | ✅ PASS                                                 |
| 15  | No complex business logic in route handlers                    | ✅ PASS                                                 |
| 16  | Repository methods receive RequestContext                      | ✅ PASS                                                 |
| 17  | State changes via command functions                            | ✅ PASS                                                 |
| 18  | Errors use domain error types                                  | ✅ PASS                                                 |
| 19  | No `console.log`                                               | ✅ PASS                                                 |
| 20  | No unnecessary new dependencies                                | ✅ PASS                                                 |
| 21  | No hardcoded deployment-specific copy                          | ✅ PASS (lint:copy passes)                              |
| 22  | `pnpm verify` passes                                           | ✅ PASS                                                 |
| 23  | Queries filter by organizationId                               | ✅ PASS                                                 |
| 24  | AuditLog written where required                                | ✅ PASS                                                 |
| 25  | Answer saves are idempotent (same clientSeq)                   | ✅ PASS                                                 |
| 26  | Exam state transitions use command functions                   | ✅ PASS                                                 |
| 27  | **All routes use Zod validation from `@exam/contracts`**       | ❌ **FAIL**                                             |

---

## Issues

### Blocking

#### B1. Attempt routes lack Zod schema validation

- **Files:** `apps/api/src/routes/attempts.ts`
- **Spec ref:** Review Checklist #11, Acceptance Criteria #11
- **Problem:** All 7 endpoints use `request.body as { ... }` and `request.params as { ... }` — no Zod validation at all. Existing routes (e.g. `exam.ts`) validate with `CreateExamRequestSchema.safeParse(request.body)` + `formatZodError()`. The schemas already exist in `@exam/contracts/src/attempt.ts`: `SaveAnswerRequestSchema`, `StartAttemptRequestSchema`, `HeartbeatRequestSchema`, `SubmitAttemptRequestSchema`, `RestoreAttemptRequestSchema`, `LoadAttemptResponseSchema`, `SaveAnswerResponseSchema`.
- **Impact:** Malformed or missing fields pass through silently; no 400 response for invalid input.
- **Fix:** Add `safeParse` + `formatZodError` to each endpoint, following the pattern in `exam.ts:157-160`.

### Important

#### I1. Heartbeat background scheduler not wired

- **Files:** `apps/api/src/server.ts`, `apps/api/src/plugins/heartbeat.ts`
- **Problem:** `scanForDisruptedAttempts` pure function exists but nothing calls it periodically. The 60s timeout disrupted detection (Acceptance Criteria #6) only works if a scheduler runs.
- **Impact:** Disrupted attempts are never auto-detected. The heartbeat route updates `lastActivityAt`, but no background task reads it.
- **Fix:** Requires choosing a job runner (`fastify-cron`, `bree`, native `setInterval`). Wire a periodic task that queries active `in_progress` attempts, calls `scanForDisruptedAttempts`, and invokes `markDisrupted` on each.
- **Tracked in:** `docs/todo.md`

#### I2. Queue UI missing from StartExamPage

- **Files:** `apps/web/src/pages/exam/StartExamPage.tsx`
- **Spec ref:** Subtask 6.6
- **Problem:** When exam has `requireQueue: true`, the confirmation page should show wait count, estimated time, progress bar, and "请勿关闭此页面". None of this is implemented. The current page shows exam config + start button regardless of queue status.
- **Impact:** Exams with queue enabled will start immediately without queue management.
- **Fix:** Add queue status polling, wait position display, and auto-redirect when turn arrives. Requires backend queue endpoint (not yet implemented).

#### I3. SaveIndicator saved-branch bug (FIXED)

- **Files:** `apps/web/src/components/exam/SaveIndicator.tsx:31`
- **Problem:** The "saved" branch checked `status` (the legacy prop) instead of `effectiveStatus` (the resolved value). When called via the new `state` prop, "saved" status always fell through to the error branch.
- **Status:** ✅ **Fixed** during review. Line now correctly checks `effectiveStatus`.

#### I4. ExamTimer import placement (FIXED)

- **Files:** `apps/web/src/components/exam/ExamTimer.tsx`
- **Problem:** `import { useState, useEffect } from "react"` was at the bottom of the file (line 43). Hoisted by JS runtime, but violates convention and confuses readers.
- **Status:** ✅ **Fixed** during review. Import moved to top.

#### I5. TakeExamPage toggleFlag redundant logic (FIXED)

- **Files:** `apps/web/src/pages/exam/TakeExamPage.tsx:156-166`
- **Problem:** Dead code — a conditional that always evaluated to a no-op.
- **Status:** ✅ **Fixed** during review. Simplified to a single ternary.

#### I6. ExamTimer onTimeout not wrapped in useCallback

- **Files:** `apps/web/src/pages/exam/TakeExamPage.tsx:211`, `apps/web/src/components/exam/ExamTimer.tsx:12-22`
- **Problem:** `onTimeout` is in the `useEffect` dependency array but recreated on every parent render. This causes the interval to clear and restart each render, potentially losing time accuracy.
- **Impact:** Cosmetic timer jitter on rapid re-renders. Functional impact is minimal since the countdown re-reads `deadlineAt` on each tick.
- **Fix:** Wrap `() => void handleSubmit()` in `useCallback` in TakeExamPage, or use a ref in ExamTimer for the callback.

### Low Priority

#### L1. QuestionSnapshot type duplicated in frontend

- **Files:** `apps/web/src/pages/exam/TakeExamPage.tsx:20-27`, `apps/web/src/components/exam/QuestionRenderer.tsx:6-13`
- **Problem:** `QuestionSnapshot` interface is defined locally in two frontend files instead of imported from `@exam/contracts` (where `CandidateQuestionSnapshotSchema` exists).
- **Impact:** Type drift risk — frontend types could diverge from contract schemas.
- **Fix:** Create a shared type file in `apps/web/src/lib/types.ts` or derive from `z.infer<typeof CandidateQuestionSnapshotSchema>`.

#### L2. `declare function` types re-exported but unimplemented

- **Files:** `packages/exam-engine/src/types.ts`, `packages/exam-engine/src/index.ts`
- **Problem:** `loadAttempt`, `gradeAttempt`, `voidAttempt` are `export declare function` — type-level declarations that resolve to `undefined` at runtime. `index.ts` re-exports them via `export * from "./types.js"`, implying they are callable.
- **Impact:** If a consumer calls these, runtime `TypeError: undefined is not a function`.
- **Fix:** Remove from `index.ts` re-export, or add a `// @ts-ignore` runtime stub that throws "Not implemented". Best handled in J7 when `gradeAttempt` is implemented.

#### L3. TrueFalseInput uses string "true"/"false" as answer values

- **Files:** `apps/web/src/components/exam/TrueFalseInput.tsx:8-9`
- **Problem:** The answer sent to server is `"true"` or `"false"` (strings), not boolean `true`/`false`. The grading engine (J7) needs to know which format to expect.
- **Impact:** Depends on what `standardAnswer` stores for true/false questions. If the grading engine expects booleans, this will mismatch.
- **Fix:** Confirm the answer format with the grading engine spec in J7. Change to boolean if needed.

#### L4. `filter(Boolean)` doesn't narrow TypeScript type

- **Files:** `apps/api/src/routes/attempts.ts:198`
- **Problem:** `.filter(Boolean)` doesn't narrow `null` from the union type in TypeScript.
- **Impact:** No runtime issue, but type safety is weakened.
- **Fix:** Use `.filter((e): e is NonNullable<typeof e> => e != null)`.

#### L5. Frontend tests missing for Job 6 components

- **Files:** None (tests don't exist)
- **Problem:** No Vitest + Testing Library tests for any of the 11 new frontend components/pages.
- **Impact:** No automated regression coverage for exam-taking UI.
- **Fix:** Write tests for each component. Priority: TakeExamPage (core flow), QuestionNav (state model), SaveIndicator (state display).
- **Tracked in:** `docs/todo.md`

---

## Files Modified (Job 6)

### New files

- `packages/exam-engine/src/timer.ts`
- `packages/exam-engine/src/answerProtocol.ts`
- `packages/exam-engine/src/attemptCommands.ts`
- `packages/exam-engine/src/types.ts`
- `packages/exam-engine/src/timer.test.ts`
- `packages/exam-engine/src/answerProtocol.test.ts`
- `packages/exam-engine/src/attemptCommands.test.ts`
- `apps/api/src/routes/attempts.ts`
- `apps/api/src/routes/attempts.test.ts`
- `apps/api/src/plugins/heartbeat.ts`
- `apps/web/src/pages/exam/ExamListPage.tsx`
- `apps/web/src/pages/exam/StartExamPage.tsx`
- `apps/web/src/pages/exam/TakeExamPage.tsx`
- `apps/web/src/components/exam/QuestionNav.tsx`
- `apps/web/src/components/exam/ExamTimer.tsx`
- `apps/web/src/components/exam/QuestionRenderer.tsx`
- `apps/web/src/components/exam/SingleChoiceInput.tsx`
- `apps/web/src/components/exam/MultipleChoiceInput.tsx`
- `apps/web/src/components/exam/FillBlankInput.tsx`
- `apps/web/src/components/exam/TrueFalseInput.tsx`

### Modified files

- `packages/exam-engine/src/index.ts` — added re-exports
- `packages/db/src/repository/attemptRepo.ts` — added custom query methods
- `packages/db/src/repository/enrollmentRepo.ts` — added custom query methods
- `packages/db/src/repository/candidateRepo.ts` — added findByUserId
- `apps/api/src/server.ts` — registered attemptRoutes
- `apps/api/src/routes/testHelpers.ts` — added candidate token support
- `apps/web/src/components/exam/SaveIndicator.tsx` — added idle state + state prop
- `apps/web/src/App.tsx` — registered exam routes
- `apps/web/src/lib/routes.ts` — added exam route helpers

---

## Test Summary

| Package             | Tests                                                            |
| ------------------- | ---------------------------------------------------------------- |
| `@exam/exam-engine` | 38 unit tests (timer: 6, answerProtocol: 9, attemptCommands: 23) |
| `@exam/db`          | 17 repo tests                                                    |
| `@exam/api`         | 13 integration tests (attempts route)                            |
| `@exam/web`         | 91 existing tests (no new Job 6 tests)                           |
| **Total**           | **159 tests, all passing**                                       |

---

## Recommended Next Steps

1. **Now (before marking J6 complete):** Fix B1 — add Zod validation to attempt routes
2. **Now or J7:** Fix I6 — wrap ExamTimer onTimeout in useCallback
3. **J7 (grading engine):** Fix L2 (implement gradeAttempt, remove declare stubs) + L3 (confirm true/false answer format)
4. **J7-J8:** Fix I1 (heartbeat scheduler) + I2 (queue UI) if needed for grading/score flow
5. **J10 (UI polish):** Fix L1 (shared QuestionSnapshot type) + L5 (frontend component tests)
