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

## Phase F: Playwright Smoke (P0)

- [ ] F1: Playwright setup + minimal smoke test

## Checkpoints

- [x] Checkpoint 1: P0 complete — all existing + new tests pass, pnpm verify green
- [x] Checkpoint 2: P1 complete — state machine + validation tests pass
- [ ] Checkpoint 3: Final — Playwright smoke + CI + review report
- [ ] Review: 整体 Phase 1.2 审查将在 F1 完成后进行

## Test Results

- API: 160 passed (22 files) — was 121 (18 files)
- Web: 111 passed (14 files) — was 106 (14 files)
- Total: 271 passed — was 227
