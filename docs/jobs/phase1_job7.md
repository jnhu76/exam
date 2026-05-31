# Job 7: Auto-Grading + Result Page

## Goal

Implement grading engine for all 4 Phase 1 question types (single choice, multiple choice, fill-blank, true/false), grading trigger via `gradeAttempt()` command, score calculation with pass/fail determination, ExamEnrollment update, and candidate result page with dual-state display.

## Scope

- Grading engine: single choice + true/false (exact match)
- Grading engine: multiple choice (all-correct/partial/wrong scoring)
- Grading engine: fill-in-blank (exact + keyword match)
- `gradeAttempt()` command function
- Score calculation: totalScore, passed (>= passingScore)
- ExamEnrollment update: finalScore, finalPassed, finalAttemptId based on scoreStrategy
- ScoreResult persistence
- Candidate result page (showResultImmediately=true and false modes)
- Admin/Teacher view of single attempt result

## Out of Scope

- Score management page (J8)
- CSV export (J8)
- Essay/short_answer grading (Phase 2)
- Manual grading / teacher override (Phase 2)
- Grading analytics / statistics (Phase 2)

## Dependencies

J6 (Exam Taking Flow — needs submitted attempts to grade)

## Files to Create / Modify

- `packages/domain/src/gradingEngine.ts`
- `packages/exam-engine/src/examCommands.ts` (extend with gradeAttempt)
- `apps/api/src/routes/attempts.ts` (integrate grading trigger)
- `apps/api/src/routes/scores.ts` (score query endpoints)
- `packages/contracts/src/score.ts` (extend if needed)
- `apps/web/src/pages/exam/ResultPage.tsx`

## Data Model Changes

None (uses existing exam_attempts.score fields from J1).

## API Contracts

Uses `@exam/contracts` schemas:
- Score result response
- Attempt detail with grading results

## UI Tasks

- Result page with dual-state display (§3.9)

## TDD Plan

- Unit: single choice grading — correct/wrong/empty
- Unit: true/false grading — correct/wrong/empty
- Unit: multiple choice grading — all-correct/partial/wrong/empty with configurable strategy
- Unit: fill-blank grading — exact match, case sensitivity, whitespace trimming, keyword match, | separator
- Unit: gradeAttempt() — aggregate scores, determine passed, update enrollment
- Unit: scoreStrategy — latest/highest/first attempt selection
- Integration: complete submit → grade → view score flow

## Subtasks

- [ ] **7.1** Grading engine: single choice + true/false
  - Acceptance: Precise match of candidate answer against standardAnswer — match = full score, mismatch = 0; handles empty answer (0); NO fastify dependency (packages/domain only); true/false treated as binary choice
  - Files: `packages/domain/src/gradingEngine.ts`
  - Verify: unit tests cover correct answer → full score, wrong answer → 0, empty answer → 0 for both single choice and true/false

- [ ] **7.2** Grading engine: multiple choice
  - Acceptance: Scoring rules via GradingRule.multiSelectScoring — all correct = full score, partial correct = half score, any wrong selection = zero (configurable per exam); compares sorted candidate selection against sorted standardAnswer
  - Files: `packages/domain/src/gradingEngine.ts` (extend)
  - Verify: unit tests cover all-correct → full, partial correct → half, extra wrong option → zero, empty → 0, all wrong → 0

- [ ] **7.3** Grading engine: fill-in-blank
  - Acceptance: Exact match mode (trim whitespace, configurable case sensitivity) + keyword match mode (configurable via GradingRule.fillBlankMatchMode); support | separated multiple acceptable answers in standardAnswer (e.g. "原子|atom" — either accepted)
  - Files: `packages/domain/src/gradingEngine.ts` (extend)
  - Verify: unit tests cover exact match, case insensitivity, whitespace trimming, keyword match, multiple accepted answers via | separator

- [ ] **7.4** Grading trigger + score calculation
  - Acceptance: Submit triggers grading via `gradeAttempt()` command; aggregates all question scores → totalScore; determines passed (totalScore >= exam.passingScore); transitions attempt status to graded; updates ExamEnrollment finalScore/finalPassed based on scoreStrategy; produces ScoreResult: { attemptId, totalScore, passed, questionResults, gradedAt }
  - Files: `packages/exam-engine/src/examCommands.ts` (extend), `apps/api/src/routes/attempts.ts` (integrate), `apps/api/src/routes/scores.ts`
  - Verify: complete flow — answer questions → submit → view score; confirm totalScore correct; confirm passed/failed determination; confirm ExamEnrollment updated; test scoreStrategy selection

- [ ] **7.5** Client: result page (dual-state)
  - Acceptance: showResultImmediately=true — large card with totalScore + pass status + passing line; answer detail table (question number/type/your answer/correct answer/score with ✅green/❌red indicators); fill blank answers truncated with hover expand; showResultImmediately=false — only shows "已交卷 ✅ 等待成绩公布"; bottom "返回考试列表" button; color + icon dual indicators (not color-only for accessibility)
  - Files: `apps/web/src/pages/exam/ResultPage.tsx`
  - Verify: test showResultImmediately=true mode — confirm score card, answer table, color+icon indicators; test showResultImmediately=false mode — confirm waiting message; test fill blank truncation and hover expand; test "返回考试列表" navigation

## Acceptance Criteria

1. Single choice / true/false: exact match grading works
2. Multiple choice: configurable all/partial/zero scoring works
3. Fill-blank: exact match + keyword match + | separator works
4. graded attempt cannot have answers modified
5. ScoreResult persisted with all question-level results
6. passed calculated from totalScore >= passingScore
7. ExamEnrollment updated: finalScore, finalPassed, finalAttemptId
8. scoreStrategy selects correct attempt (latest/highest/first)
9. Result page shows correct dual-state display
10. No Fastify dependency in grading engine
11. `pnpm typecheck` passes

## Verify Commands

```bash
pnpm lint:copy
pnpm typecheck
pnpm test
pnpm db:generate && pnpm db:migrate && pnpm test:integration
pnpm --filter api dev
pnpm --filter web dev
```

## Review Checklist

- [ ] Grading engine in packages/domain (no Fastify dependency)
- [ ] gradeAttempt() is a command function (not direct mutation)
- [ ] graded status prevents further answer saves
- [ ] ScoreResult type matches domain types
- [ ] ExamEnrollment update uses scoreStrategy correctly
- [ ] Result page uses color + icon dual indicators for accessibility
- [ ] showResultImmediately flag from exam controlFlags
- [ ] No duplicate DTOs (types imported from `@exam/domain` or `@exam/contracts`)
- [ ] No `any` / `as any`
- [ ] No bare `db.select()` in routes (repository pattern only)
- [ ] No complex business logic in route handlers
- [ ] Repository methods receive RequestContext with organizationId
- [ ] State changes via command functions
- [ ] Errors use domain error types from `packages/domain/src/errors.ts`
- [ ] No `console.log` (use logger in api, nothing in packages)
- [ ] No unnecessary new dependencies
- [ ] No hardcoded deployment-specific product copy (e.g., 校内/校园/大学/学生)
- [ ] `pnpm verify` passes
- [ ] Queries filter by organizationId
- [ ] AuditLog written where required
