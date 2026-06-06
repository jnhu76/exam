# Phase 1.2 Task List

## Phase A: Test Helpers Enhancement (P0)

- [x] A1: Expand testHelpers.ts — add createExamViaApi, publishExamViaApi, submitExamAsCandidate, exportResultsCsvAsAdmin

## Phase B: API Integration Tests — Gaps (P0)

- [x] B1: CSV export full integration tests (Content-Disposition, escaping, data-bearing, examId isolation)
- [x] B2: Candidate/profile invariant tests enhanced (no-profile rejection for exam start/submit)
- [x] B3: Permission boundary tests (new file, cross-role access)

## Phase C: Frontend Route & Nav Tests (P0)

- [x] C1: Sidebar nav link + active state tests
- [x] C2: Route separation test (/admin/results vs /admin/exams)

## Phase D: State Transition Tests (P1)

- [x] D1: Exam state machine API tests (legal/illegal transitions)

## Phase E: Boundary Input Tests (P1)

- [x] E1: API input validation tests (Zod schema boundaries)

## Phase F: Full-Stack Smoke Tests (P0)

- [x] F1: E2E smoke test suite (Fastify inject, no browser required)

## Bug Fixes & UX Enhancements

- [x] BUG-1: totalScore auto-calc from questions + api.ts error parsing + publish error display
- [x] BUG-2: Course delete blank page fix
- [x] ENH-3: EnrollmentPicker component with search, enrolled indicator, select-all, pagination
- [x] ENH-4: Settings page tabs layout (品牌设置 / 账号安全)
- [x] ENH-5: Timezone Select dropdown with 11 IANA options
- [x] ENH-6: Deferred to separate PR
- [x] ENH-7: Deferred to Phase 2

## Documentation & Cleanup

- [x] DOC-1: Write human-readable API reference documentation
- [x] DOC-2: Write CSV import/export format documentation
- [x] DOC-3: Generate mock data for students, questions, exams
- [x] DOC-4: Archive Phase 1/1.1/1.2 documents to organized structure
- [x] DOC-5: Write operation manual for common workflows

## Checkpoints

- [x] Checkpoint 1: P0 complete — all existing + new tests pass, pnpm verify green
- [x] Checkpoint 2: P1 complete — state machine + validation tests pass
- [x] Checkpoint 3: Final — smoke tests + enhancement fixes + review report

## Test Results

- API: 165 passed (22 files)
- Web: 140 passed (19 files)
- E2E: 5 passed (1 file)
- Exam engine: 86 passed (7 files)
- DB: 22 passed (5 files)
- Auth: 8 passed (4 files)
- Total: 426 passed

## Files Created/Modified in Phase 1.2

### New Files

- `apps/e2e/` — full-stack smoke test package (5 tests)
- `apps/web/src/components/exam/EnrollmentPicker.tsx` — reusable enrollment picker
- `apps/web/src/components/exam/ExamConfigForm.test.tsx` — totalScore behavior tests
- `apps/web/src/components/exam/EnrollmentPicker.test.tsx` — picker interaction tests
- `apps/web/src/components/settings/PasswordChangeForm.tsx` — shared password form
- `apps/web/src/components/settings/PlatformSettingsForm.test.tsx` — timezone tests
- `apps/web/src/pages/admin/CoursePage.test.tsx` — delete blank page test
- `apps/web/src/pages/admin/ExamDetailPage.test.tsx` — publish error test
- `code_review/phase1.2_test_review.md` — test suite review report
- `code_review/phase1.2_enhancement_review.md` — enhancement code review report
- `docs/phase1.2/enhancement.md` — enhancement spec

### Modified Files

- `apps/api/src/routes/testHelpers.ts` — expanded helpers
- `apps/api/src/routes/system.ts` — added GET /system/info endpoint
- `apps/web/src/components/exam/ExamConfigForm.tsx` — auto-calc totalScore with useEffect sync
- `apps/web/src/components/settings/PlatformSettingsForm.tsx` — timezone Select
- `apps/web/src/lib/api.ts` — error body parsing
- `apps/web/src/pages/admin/CoursePage.tsx` — loadCourses({ showLoading })
- `apps/web/src/pages/admin/ExamDetailPage.tsx` — EnrollmentPicker + pagination + publish error
- `apps/web/src/pages/admin/ExamCreatePage.tsx` — passes questions prop
- `apps/web/src/pages/admin/SettingsPage.tsx` — Tabs layout, shared PasswordChangeForm
- `apps/web/src/pages/exam/ExamSettingsPage.tsx` — shared PasswordChangeForm
