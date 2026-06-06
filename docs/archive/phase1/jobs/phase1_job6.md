# Job 6: Exam Taking Flow

## Goal

Implement the complete exam execution lifecycle for candidates: start attempt, load attempt, answer save protocol, submit attempt, heartbeat/disrupted detection, restore attempt, server-side time authority, and the full-screen exam UI.

## Scope

- `startAttempt()` — create or restore ExamAttempt (checks time window, attempt count, enrollment)
- `loadAttempt()` — return questions without standardAnswer
- Answer Save Protocol — versioned, idempotent saves with conflict detection
- `submitAttempt()` — mark submitted, trigger grading
- Heartbeat + disrupted detection — `lastActivityAt` tracking, auto-mark disrupted
- `restoreAttempt()` — recover disrupted attempt with answers + remaining time
- Server-side time authority — `deadlineAt` calculated server-side
- Candidate exam list page
- Start exam confirmation page with queue support
- Full-screen exam taking UI with 4 question type renderers

## Out of Scope

- Auto-grading logic (J7)
- Score display (J7)
- Score management/export (J8)
- WebSocket proctoring (Phase 2)
- Electron lockdown (Phase 2)

## Dependencies

J3.5 (UI Foundation — shared layout, ExamLayout, page shell), J5B (Exam Management — need published exams with questions to attempt)

## UI Strategy

This is the most UI-intensive job. The exam-taking page is the core product experience and must be fully functional. All three candidate-facing pages must work end-to-end. J10 will polish visual consistency; it will not build missing pages or question type renderers.

**Minimum UI per page:**

- Exam list: card list with available/ended sections, attempt counts, scores
- Start confirmation: exam config summary, queue UI when enabled, auto-redirect
- Exam taking: full-screen mode, question nav with color-coded state, all 4 question type renderers, auto-save with SaveIndicator, countdown timer, submit confirmation dialog
- All user-facing text in zh-CN

**QuestionNavItem state model (used in 6.7):**

| State      | Symbol | Color  | Meaning           |
| ---------- | ------ | ------ | ----------------- |
| unanswered | ○      | gray   | not yet answered  |
| answered   | ●      | green  | answer saved      |
| flagged    | ◉      | yellow | marked for review |

- Current question has a distinct ring/border highlight
- 50+ questions: two-column layout with scroll

## Files to Create / Modify

- `apps/api/src/routes/attempts.ts`
- `packages/exam-engine/src/examCommands.ts` (extend with attempt commands)
- `packages/exam-engine/src/answerProtocol.ts`
- `packages/exam-engine/src/timer.ts`
- `apps/api/src/plugins/heartbeat.ts`
- `packages/contracts/src/attempt.ts` (extend if needed)
- `apps/web/src/pages/exam/ExamListPage.tsx`
- `apps/web/src/pages/exam/StartExamPage.tsx`
- `apps/web/src/pages/exam/TakeExamPage.tsx`
- `apps/web/src/components/exam/QuestionNav.tsx`
- `apps/web/src/components/exam/QuestionRenderer.tsx`
- `apps/web/src/components/exam/SingleChoiceInput.tsx`
- `apps/web/src/components/exam/MultipleChoiceInput.tsx`
- `apps/web/src/components/exam/FillBlankInput.tsx`
- `apps/web/src/components/exam/TrueFalseInput.tsx`
- `apps/web/src/components/exam/ExamTimer.tsx`
- `apps/web/src/components/exam/SaveIndicator.tsx`

## Data Model Changes

None (uses existing exam_attempts/exam_enrollments tables from J1).

## API Contracts

Uses `@exam/contracts` attempt schemas (defined in J0.5):

- `POST /api/attempts/:examId/start` — start or restore attempt
- `GET /api/attempts/:id` — load attempt (no standardAnswer)
- `POST /api/attempts/:attemptId/answers/:questionId` — Answer Save Protocol
- `POST /api/attempts/:attemptId/submit` — submit attempt
- `POST /api/attempts/:attemptId/heartbeat` — update lastActivityAt
- `POST /api/attempts/:attemptId/restore` — restore disrupted attempt

### Answer Save Protocol (SPEC.md §3.5)

Request:

```ts
SaveAnswerRequest {
  attemptId: string
  questionId: string
  answer: unknown
  clientSeq: number
  clientSavedAt: string
  baseVersion: number
}
```

Response:

```ts
SaveAnswerResponse {
  accepted: boolean
  serverVersion: number
  savedAt: string
  conflict?: {
    reason: "STALE_VERSION" | "SUBMITTED" | "ATTEMPT_CLOSED"
    latestAnswer?: unknown
  }
}
```

## UI Tasks

- Candidate exam list page (§3.7)
- Start exam confirmation page (§3.10)
- Exam taking page — full-screen answer interface (§3.8)

## TDD Plan

- Unit: `startAttempt()` — time window check, attempt count check, enrollment check
- Unit: answer save protocol — idempotency (same clientSeq), version conflict, post-submit rejection
- Unit: `submitAttempt()` — status transition validation
- Unit: `restoreAttempt()` — answers + remaining time recovery
- Unit: server-side time — deadlineAt calculation
- Integration: full start → answer → submit flow
- Integration: disrupted → restore flow

## Subtasks

- [ ] **6.1** ExamAttempt routes: start + load
  - Acceptance: POST /api/attempts/:examId/start creates or restores ExamAttempt (checks time window, attempt count, ExamEnrollment status); new attempts copy the published exam's immutable `QuestionSnapshot` data instead of reading current question bank rows; uses `startAttempt()` command function; GET /api/attempts/:id returns candidate-safe snapshot data without standardAnswer
  - Files: `apps/api/src/routes/attempts.ts`, `packages/exam-engine/src/examCommands.ts`
  - Verify: curl simulate candidate starting exam within time window; curl get attempt and confirm standardAnswer not exposed; test outside time window rejection; test max attempt count rejection

- [ ] **6.2** Answer save route (Answer Save Protocol)
  - Acceptance: POST /api/attempts/:attemptId/answers/:questionId validates attempt status must be in_progress; updates lastActivityAt; implements full Answer Save Protocol — clientSeq idempotency (same clientSeq returns same result), baseVersion conflict detection (old version cannot overwrite new); submitted/graded state rejects saves
  - Files: `apps/api/src/routes/attempts.ts` (extend), `packages/exam-engine/src/answerProtocol.ts`
  - Verify: curl save answer successfully; test idempotent replay with same clientSeq returns identical response; test version conflict by sending stale baseVersion; test save rejected after submit

- [ ] **6.3** Submit attempt route
  - Acceptance: POST /api/attempts/:attemptId/submit uses `submitAttempt()` command; validates must be in_progress; checks deadlineAt — if past deadline, still accepts but notes timeout; transitions attempt to submitted and exposes the grading hook that J7 implements
  - Files: `apps/api/src/routes/attempts.ts` (extend)
  - Verify: curl submit attempt; confirm status transitions to submitted; confirm grading triggered (J7 implements actual grading); test submit from wrong status rejected

- [ ] **6.4** Heartbeat + disrupted detection
  - Acceptance: POST /api/attempts/:attemptId/heartbeat updates lastActivityAt; scheduled task scans for attempts with no heartbeat for 60s and calls `markDisrupted()`; disrupted attempts can be restored via `restoreAttempt()`
  - Files: `apps/api/src/routes/attempts.ts` (extend), `apps/api/src/plugins/heartbeat.ts`
  - Verify: curl send heartbeat; stop heartbeat for 60s; check attempt status is disrupted; confirm restoreAttempt() restores answers and remaining time

- [ ] **6.5** Client: exam list page (candidate)
  - Acceptance: Exam card list showing name, timing mode/duration/passing score, open period, attempt count/high score; two sections: "可参加的考试" (available) and "已结束" (ended); passed exams show ✅ and score; buttons: 开始考试 (available exams) / 查看结果 (completed exams); all user-facing strings in zh-CN
  - Files: `apps/web/src/pages/exam/ExamListPage.tsx`
  - Verify: browser view exam list with available and ended sections; confirm passed exam shows ✅ and score; click 开始考试 navigates to confirmation page

- [ ] **6.6** Client: start exam confirmation page + queue
  - Acceptance: Confirmation page shows exam config summary (timing/duration/passing score/question count/control flags/attempt count); warning text: "开始后倒计时立即启动，中途不可暂停"; queue status when requireQueue enabled: wait count, estimated time, progress bar, "请勿关闭此页面"; auto-redirect to exam page when turn arrives
  - Files: `apps/web/src/pages/exam/StartExamPage.tsx`
  - Verify: walk through confirm → start flow; with requireQueue enabled, confirm queue UI shows; confirm auto-redirect when turn arrives

- [ ] **6.7** Client: exam taking page (core answer interface)
  - This subtask is split into 6.7.1–6.7.8 for incremental implementation.

  - [ ] **6.7.1** Exam taking page shell + full-screen layout
    - Acceptance: Full-screen mode with no sidebar or navigation; top toolbar area reserved for exam name, timer, progress, submit; main area split into left question nav column (w-20) and right answer area; bottom nav bar with prev/flag/next; bottom status bar with answered/unanswered/flagged/total counts; page loads attempt data on mount and redirects if attempt not in_progress
    - Files: `apps/web/src/pages/exam/TakeExamPage.tsx`
    - Verify: navigate to exam page with active attempt; confirm full-screen layout; confirm no sidebar/navigation; confirm redirect when no active attempt

  - [ ] **6.7.2** QuestionNav component with state model
    - Acceptance: Left column (w-20) shows numbered question buttons; each button renders with QuestionNavItem state model (○ gray=unanswered, ● green=answered, ◉ yellow=flagged); current question has distinct ring/border highlight; click navigates to that question; 50+ questions uses two-column layout with scroll
    - Files: `apps/web/src/components/exam/QuestionNav.tsx`
    - Verify: render with 10 questions in various states; confirm color coding; click each question and confirm navigation; render with 60 questions and confirm two-column scroll

  - [ ] **6.7.3** ExamTimer component
    - Acceptance: Top toolbar countdown timer; displays MM:SS format; <5min turns text red; =0 triggers auto-submit via `submitAttempt()`; countdown uses server-side `deadlineAt` (client is cosmetic display only); page refresh re-fetches deadline from server
    - Files: `apps/web/src/components/exam/ExamTimer.tsx`
    - Verify: render timer with various remaining durations; confirm red at <5min; confirm auto-submit at 0; confirm page refresh shows correct remaining time

  - [ ] **6.7.4** SingleChoiceInput + TrueFalseInput renderers
    - Acceptance: SingleChoiceInput renders radio group from question options; TrueFalseInput renders binary radio (是/否 or similar); answer change triggers auto-save; selected option visually distinct
    - Files: `apps/web/src/components/exam/SingleChoiceInput.tsx`, `apps/web/src/components/exam/TrueFalseInput.tsx`
    - Verify: render single choice with 4 options; select one; confirm auto-save fires; render true/false; select one; confirm auto-save fires

  - [ ] **6.7.5** MultipleChoiceInput renderer
    - Acceptance: Renders checkbox group from question options; multiple selections allowed; answer change triggers auto-save; selected options visually distinct
    - Files: `apps/web/src/components/exam/MultipleChoiceInput.tsx`
    - Verify: render multi-select with 5 options; select 2; confirm auto-save fires; select/deselect; confirm updated auto-save

  - [ ] **6.7.6** FillBlankInput renderer
    - Acceptance: Renders input fields matching blank positions in question content; answer change triggers auto-save; supports multiple blanks per question
    - Files: `apps/web/src/components/exam/FillBlankInput.tsx`
    - Verify: render fill-blank with 2 blanks; type into each; confirm auto-save fires for each change

  - [ ] **6.7.7** SaveIndicator + auto-save integration
    - Acceptance: SaveIndicator shows "保存中..." during save, "✓已保存" on success, "⚠保存失败" on failure; answer changes debounced 1-2s; uses Answer Save Protocol with clientSeq and baseVersion; version conflict shows error indicator; re-attempts on transient failure
    - Files: `apps/web/src/components/exam/SaveIndicator.tsx`
    - Verify: type answer and confirm debounced save; confirm indicator transitions through states; simulate conflict and confirm error indicator; confirm successful save shows ✓已保存

  - [ ] **6.7.8** Submit confirmation dialog + bottom nav actions
    - Acceptance: Submit button in top toolbar opens confirmation dialog; dialog shows unanswered count + flagged count + "交卷后不可修改"; confirm submits via `submitAttempt()` and navigates to result page; bottom nav: ◀ prev / ⚑ flag toggle / next ▶; flag toggle updates QuestionNavItem state
    - Files: `apps/web/src/pages/exam/TakeExamPage.tsx` (extend)
    - Verify: click submit with unanswered questions; confirm dialog shows correct counts; confirm submit navigates to result; test flag toggle updates nav state; test prev/next navigation

## Acceptance Criteria

1. Same clientSeq replay does not duplicate writes
2. Old baseVersion cannot overwrite new answer
3. Submitted/graded attempt rejects answer saves
4. Countdown timer uses server-side deadlineAt (client is cosmetic only)
5. Page refresh recovers in_progress attempt with answers intact
6. Disrupted attempt detected after 60s heartbeat timeout
7. restoreAttempt() recovers answers + remaining time
8. standardAnswer never exposed to candidate
9. QuestionSnapshot is copied from the published exam when a new ExamAttempt is created, so later question bank edits cannot affect it
10. All routes use repository pattern with RequestContext
11. All routes use Zod validation from `@exam/contracts`
12. `pnpm typecheck` passes

## Verify Commands

```bash
pnpm lint:copy
pnpm typecheck
pnpm test
pnpm db:generate && pnpm db:migrate && pnpm test:integration
pnpm --filter api dev
pnpm --filter web dev
pnpm verify
```

## Review Checklist

- [ ] Answer Save Protocol matches SPEC.md §3.5 exactly
- [ ] SaveAnswerRequest has clientSeq, baseVersion, clientSavedAt
- [ ] SaveAnswerResponse has accepted, serverVersion, conflict?
- [ ] Server is sole time authority — deadlineAt from server
- [ ] No standardAnswer in candidate-facing responses
- [ ] startAttempt() uses command function, not direct mutation
- [ ] submitAttempt() validates in_progress status
- [ ] Heartbeat interval and timeout are configurable
- [ ] All 4 question type renderers work
- [ ] Auto-save debounced 1-2s, uses Answer Save Protocol
- [ ] Submit dialog shows unanswered + flagged counts
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
- [ ] Answer saves are idempotent (same clientSeq returns same result)
- [ ] Exam state transitions use command functions, no direct status mutation
