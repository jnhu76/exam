# Phase 1 Job 7 Review

## Review Scope

Reviewed `phase1-job7-auto-grading` against `dev`, focusing on:

- grading state transitions and score persistence
- tenant isolation and candidate ownership checks
- Zod request/response contracts
- candidate result-page flow
- Job 8 handoff documentation

## Result

No blocking issues remain. The branch is ready to merge into `dev`.

## Fixed During Review

### R1: Hidden result contract rejected valid non-graded attempt states

**Severity:** Important

`GET /api/scores/attempts/:attemptId` intentionally returns a hidden response when an attempt is not yet graded. The hidden Zod response schema originally allowed only `submitted`, `grading`, and `graded`, so querying a valid `in_progress` or `disrupted` attempt returned `400`.

**Fix:** Expanded the hidden response schema to support all valid attempt states and added an API regression test for `in_progress`.

## Security Review

- Candidate result queries use both tenant-scoped repository context and `candidateId` ownership filtering.
- Admin/Teacher result queries remain tenant-scoped through repository context.
- Added an API regression test confirming that a teacher from another organization receives `404` for an attempt outside their tenant.
- Result visibility remains role-aware: candidates respect `showResultImmediately`; Admin/Teacher can review graded details.

## State Flow Review

- Submit transitions `in_progress` or `disrupted` attempts to `submitted`.
- `gradeAttempt()` transitions `submitted` → `grading` → `graded`.
- Grading persists question-level results, total score, pass status, and `gradedAt`.
- Enrollment selection applies `latest`, `highest`, and `first` strategies.
- Answer saves after grading are rejected by the answer-save protocol.

## UI Review

- Candidate submit flow navigates to `/exam/:attemptId/result`.
- Result page supports immediate-score and waiting states.
- Detail table includes question number, question, type, candidate answer, standard answer, and score.
- Correct/wrong display uses icons and colors together.
- Fill-blank answers truncate with the full value available through hover text.
- Ended exams link to the selected final attempt result.

## Verification

- `pnpm db:generate` — passed; no schema migration generated
- `pnpm db:migrate` — passed
- `pnpm test:integration` — passed; DB 17 tests, API 87 tests
- `pnpm verify` — passed
- Coverage — API 74.26% statements, Web 60.46%, DB 71.03%, Auth 80%
- `git diff --check` — passed

## Known Non-Blocking Follow-Ups

- Submit and grading are synchronous but are not wrapped in a database transaction. The current pure grading path is deterministic; add transactional orchestration when the database layer introduces transaction support.
- Vite still reports a production chunk-size warning for the `536.77 kB` main JavaScript bundle. This is tracked in `docs/todo.md`.
- Admin/Teacher score-management pages and CSV export remain scheduled for Job 8.
