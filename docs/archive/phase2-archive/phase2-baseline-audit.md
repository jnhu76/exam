# Phase 2 Foundation Baseline Audit Report

> **Date:** 2026-06-29
> **Scope:** Phase 2 baseline audit — code inspection only, no modifications.
> **Principles:** No UI stack migration. No Koi/Wegent/Ant Design. No Tailwind/shadcn removal. No Phase 3 features. No test weakening.

---

## 0. Executive Summary

1. **Phase 2 baseline is fundamentally stable.** The core architecture (typed errors, state machines, row-level locking, contract schemas, test isolation, observability) is well-engineered and Phase 1 complete.

2. **Current maximum risk is the `submitAttempt()` TOCTOU race.** The function reads without `FOR UPDATE` then writes, creating a window for the deadline scanner to corrupt concurrent submits.

3. **UI should keep current baseline.** Tailwind v4 and shadcn/ui 27-component set are complete, no Ant Design/Koi/Wegent remnants exist. Minor cleanup only.

4. **Continue i18n in small steps, do not freeze.** The `messageRegistry` pattern is good; the blocker is 74 test files with Chinese text assertions — these should not be migrated en masse.

5. **Do not start any UI stack migration.** No Ant Design, Koi, Wegent, or Tailwind removal.

6. **Must fix now:** `submitAttempt()` row lock, `gradeAttempt()` transaction, E2E flakiness root cause, frontend test over-mocking reduction.

---

## 1. Foundation Matrix

| Area | Status | Evidence | Risk | Recommendation |
|------|--------|----------|------|----------------|
| **UI Baseline** | **DONE** | Tailwind v4 (`apps/web/src/index.css:1` `@import "tailwindcss"`), 27 shadcn components (`apps/web/src/components/ui/`), components.json style "new-york", no Ant/Koi/Wegent traces | Low — 6 raw `className` literals, 1 duplicate dialog | MINOR_CLEANUP_ONLY |
| **i18n** | **PARTIAL** | Custom `messageRegistry.ts` (39 error codes), no standard library, no React provider, 162 files with hardcoded zh-CN, 74 test files assert Chinese text | High — blocks adding locale switching | CONTINUE_SMALL_STEPS |
| **API Contract** | **DONE** | Zod schemas for all exam ops (`packages/contracts/src/attempt.ts`), typed error hierarchy (21 classes, `packages/domain/src/errors.ts`), shared type exports | Low — frontend doesn't do runtime Zod validation | Accept as Phase 2 contract |
| **Error Model** | **DONE** | Hierarchical `AppError` + 20+ subclasses, `buildErrorResponse` in `apps/api/src/plugins/errors.ts`, `getErrorMessage(code)` in `messageRegistry.ts` | Low | Already robust |
| **Auth / Permission** | **DONE** | JWT + HTTP-only cookie (`packages/auth/src/session.ts`), RBAC with 14 admin + 2 candidate permissions (`packages/auth/src/rbac.ts`), `authenticate`/`requirePermission` plugins | Low — proctor permissions defined but unassigned (Phase 3) | Phase 3 |
| **Tenant Isolation** | **DONE** | `organizationId` on all business tables, `validateTenantAccess()` no-op for Phase 1 single-tenant (`packages/auth/src/tenantGuard.ts`), repo methods all receive `ctx` | Low — no-op is intentional | Phase 4 activation |
| **State Machine** | **DONE** | 3 formal state machines (exam, attempt, enrollment) with command-driven transitions, `assertTransition()` throws `InvalidStateTransitionError`, tests cover valid+invalid transitions | Low | Already thorough |
| **DB Consistency** | **RISKY** | `submitAttempt()` reads without `FOR UPDATE` TOCTOU race (`packages/exam-engine/src/attemptCommands.ts:244-284`), `gradeAttempt()`/`finalizeGrading()` not transactional (`packages/exam-engine/src/grading.ts`), but row locking used in restore/heartbeat/deadline paths | **High — P0** | Must add row lock + transaction |
| **Redis Boundary** | **DONE** | Optional, `lazyConnect`, only used for health check (`apps/api/src/plugins/redis.ts`), no consistency-critical usage, no queue/pubsub | None — correct architecture | Phase 2 feature use |
| **Seed / Fixture** | **DONE** | Two-layer seed (baseline `seed.ts` + demo `demo-seed.ts`), idempotent `ON CONFLICT`, 18-point verification (`demo-seed-verify.ts`), env var overrides, programmatic shared fixtures (`buildTestApp` in `testHelpers.ts`) | Low | Stable |
| **Test Isolation** | **DONE** | Per-call isolated PG schema, worker-database mode, PG advisory lock for DDL serialization (`testInfraLock.ts`), DB name safety guard (`databaseUrl.ts`), 3-DB split (exam/exam_test/exam_e2e) | None — exemplary setup | Maintain |
| **Frontend Tests** | **RISKY** | 77 `vi.mock` calls, every page test mocks entire API module, 21 `toBeTruthy()`, 1 `expect(true).toBe(true)`, 74 test files couple to Chinese text | **High — P0** | Reduce over-mocking |
| **E2E** | **PARTIAL** | 17 spec files covering critical paths (happy path, disconnect-restore, double-click, save-submit-race, submit-flush, etc.). 2 specs (`fill-blank-e2e`, `manual-grading`) are intentionally skipped as **Phase 3 pending** (subjective/fill-blank runtime not implemented in Phase 2), NOT flaky. The remaining objective-loop specs were triaged in P0-3A/P0-3B: the candidate-runtime 3 (`submit-flush`, `refresh-during-exam`, `disconnect-restore`) and the remaining 4 (`save-submit-race`, `resume-attempt`, `double-click-start`, `result-publishing`) are stable green; the stale `test-results/` traces were infra noise (server-down `ECONNREFUSED`), not test-logic flake. | **Medium** | Phase 3 pending specs documented |
| **Observability** | **DONE** | pino structured logging with redaction (`apps/api/src/lib/logRedaction.ts`), `requestId` in all error envelopes, `auditLogs` table + repo + query endpoint, heartbeat/deadline scanner metrics, client event pipeline (internal only, no external analytics) | Low | Phase 2 ready |
| **CI / Tooling** | **DONE** | 3-job CI (static → verify + e2e parallel), `pnpm verify` quality gate (format:check → lint → lint:copy → lint:arch → lint:db-config → typecheck → coverage → build), husky pre-commit/pre-push hooks, comprehensive scripts (38 in root package.json) | Low — `code-quality.md` §14 drift (docs `lefthook`, repo uses `husky`) | Minor doc fix |
| **Documentation** | **PARTIAL** | SPEC.md (1161 lines, comprehensive, current), phase-roadmap.md (current), code-quality.md (minor drift §14), docs/dev/ (30+ files), observability-contract.md | Low — 1 knowable drift | Patch `code-quality.md` §14 |

---

## 2. P0 Must Fix Now

### P0-1: `submitAttempt()` missing row lock — TOCTOU race with deadline scanner

```
Problem: submitAttempt() reads attempt via findById (no FOR UPDATE), then writes.
         Between read and write, deadline scanner autoSubmit could submit the same
         attempt. Idempotency check catches the visible effect, but duplicate
         processing (audit events, scoring) is not prevented.

Evidence: packages/exam-engine/src/attemptCommands.ts:244-284
          - Line 244: const attempt = await attemptRepo.findById(ctx, attemptId)
            (no FOR UPDATE)
          - Line 248-256: idempotency check (catches effect, not cause)
          - Line 284: await attemptRepo.update(ctx, attemptId, { status, submittedAt... })
          Compare: restoreAttempt() line 330 uses findByIdForUpdate
          heartbeat.ts line 128 uses findByIdForUpdate

Why now: Active race condition in production. Deadline scanner (every 30s)
         and candidate submit can collide. Failure mode is silent duplicate
         submission.

Minimal fix: Add findByIdForUpdate + executeInTransaction wrapper around
             the read → validate → write sequence in submitAttempt().

Files: packages/exam-engine/src/attemptCommands.ts
       packages/exam-engine/src/__tests__/attemptCommands.test.ts

Tests: Add test: findByIdForUpdate returns lock row; concurrent submit and
       deadline autoSubmit; second caller gets fresh state.

Risk if not fixed: Silent duplicate submissions, double audit events,
                   spurious grading work.
```

### P0-2: `gradeAttempt()` / `finalizeGrading()` not transactional

```
Problem: gradeAttempt() reads attempt, reads snapshots, reads enrollments,
         writes grading results across multiple tables without a transaction.
         If the process crashes mid-grade, partial grading state persists.

Evidence: packages/exam-engine/src/grading.ts
          - No executeInTransaction wrapper
          - Multiple writes to different tables (grading queue, attempt,
            enrollment) without atomicity
          - submitAndGradeAttempt() in same file also non-transactional
          Contrast: autoSubmitAndGrade() in deadlineScanner.ts line 110
          wraps in executeInTransaction

Why now: Mid-grade crash leaves system in unrecoverable partial state.
         Grade operation is not idempotent-friendly without atomicity.

Minimal fix: Wrap gradeAttempt() and related mutation functions in
             executeInTransaction.

Files: packages/exam-engine/src/grading.ts
       packages/exam-engine/src/__tests__/grading.test.ts

Tests: Add test: transaction rollback on error leaves no partial state.

Risk if not fixed: Partial grading state, manual DB recovery needed.
```

### P0-3: E2E flakiness — 7/17 specs with failure traces

```
Problem: 7 of 17 E2E spec files have recent failure artifacts in
         test-results/. Specs: disconnect-restore, result-publishing,
         double-click-start, save-submit-race, submit-flush,
         resume-attempt, refresh-during-exam. These cover critical paths.

Evidence: apps/e2e/test-results/ directory: 7 Chromium failure traces
          apps/e2e/e2e/disconnect-restore.spec.ts (205 lines)
          apps/e2e/e2e/save-submit-race.spec.ts (253 lines)
          apps/api/vitest.config.ts documents BUG-FLAKE-001 (background
          scanner flake with 5s timeout)

Why now: E2E is the CI gate for Phase 2. Flaky E2E means the CI gate
         is unreliable, which erodes team trust in CI.

Minimal fix: Triage each failure trace. Likely categories:
         a) Race with background scanner heartbeat/deadline timing
            → increase polling timeouts or add explicit waitFor condition
         b) Playwright action timeout on slow CI
            → increase actionTimeout or add retry-assertion pattern
         c) Flaky test setup (seed collision)
            → verify unique entity naming in E2E seed helpers
         Do NOT skip failing tests. Fix root cause.

Files: apps/e2e/e2e/ (7 spec files with failures)
       apps/e2e/lib/seed.ts (seed helpers)
       apps/e2e/playwright.config.ts (timeout config)

Tests: Run `pnpm test:e2e` 3 times; verify all 17 specs pass 3/3.

Risk if not fixed: CI gate becomes unreliable. Phase 2 regressions slip.
```

### P0-4: Frontend test over-mocking — 77 `vi.mock` calls mask real integration bugs

```
Problem: Every frontend page test mocks the entire API module. Tests verify
         component rendering in isolation but never validate that real API
         response shapes, error formats, or field names are handled correctly.
         Mock structure changes break many tests at once.

Evidence: 77 vi.mock calls across 30+ frontend test files
         Pattern in every admin/exam page test:
           vi.mock("@/lib/api", () => ({ apiGet: vi.fn(), apiPost: vi.fn() }))
         Pattern in every page test:
           vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
         Tests never validate real API contract compliance.

Why now: Phase 2 will add new API endpoints and modify existing ones.
         Over-mocked tests will pass even when frontend code doesn't
         handle real responses correctly, creating false confidence.

Minimal fix: Introduce one integration-style test per critical page
         (TakeExamPage, StartExamPage, ExamListPage) that uses
         a real Fastify test app (like API tests do with buildTestApp())
         via MSW or direct in-process server. Keep existing unit tests
         but reduce API mock surface.

Files: apps/web/src/pages/exam/TakeExamPage.test.tsx
       apps/web/src/pages/exam/StartExamPage.test.tsx
       apps/web/src/pages/exam/ExamListPage.test.tsx
       apps/web/src/pages/admin/ (any one admin page for pattern)

Tests: Add 3 integration tests. Existing unit tests remain passing.

Risk if not fixed: Phase 2 API changes can break frontend without test
         catching it. False confidence in CI.
```

---

## 3. P1 Fix Soon

1. **`toBeTruthy()` cleanup** (21 occurrences) — Replace with `toBeDefined()`, `not.toBeNull()`, or specific value assertions in E2E and API tests. Produces unhelpful failure messages. (`apps/e2e/e2e/multi-select-e2e.spec.ts:49`, `apps/api/src/routes/testBackgroundJobs.test.ts:110`, `apps/web/src/lib/clientSessionId.test.ts:15` and 18 more)

2. **`ConfirmActionDialog` → deprecate** — Thin wrapper around `ConfirmDialog` adding only `disabled` prop. Remove component, inline prop forwarding at caller sites. (`apps/web/src/components/shared/ConfirmActionDialog.tsx`)

3. **Raw `className` template literals** (6 components) — `FillBlankInput.tsx:60`, `MultipleChoiceInput.tsx:34`, `SingleChoiceInput.tsx:21`, `TrueFalseInput.tsx:24`, `ExamTimer.tsx:35`, `SaveIndicator.tsx:60,63` use raw string interpolation instead of `cn()`. This breaks Tailwind class merging when parent components pass `className`.

4. **Hardcoded Chinese in API routes** (6 files) — `attempts.candidate.ts:793,800,807`, `user.ts:177,197`, `exam.ts:588` throw Chinese messages directly instead of using English + error code → `messageRegistry`. Risk of double-locale. Migrate to English debug messages.

5. **`gradeAttempt()` / `finishGrading()` non-transactional** — Already listed as P0-2.

6. **`code-quality.md` §14 drift** — Documents Lefthook with specific hook commands; repo uses Husky with different commands. Update doc to match reality.

7. **Empty `components/app/` directory** — Declared in project structure conventions and `components.json` aliases but contains 0 files. Either remove or add a README placeholder.

8. **`expect(true).toBe(true)`** in `state-lifecycle.spec.ts:55` — Replace with `test.todo()` or remove. Present value is zero.

---

## 4. Defer

| Item | Reason |
|------|--------|
| **Koi UI migration** | Not started. No remnants. Not a priority. |
| **Wegent UI migration** | Not started. No remnants. Not a priority. |
| **Ant Design migration** | Already fully purged. No remnants remain. Defer permanently. |
| **Tailwind removal** | Complete, working, v4 current. No reason to remove. |
| **shadcn removal** | 27 components, all functional. No reason to remove. |
| **1700+ Chinese test assertions migration** | Would break 74 test files. This is a structured effort that should happen alongside i18n enablement, not before. |
| **UI polish / visual redesign** | Audit conclusion: UI baseline is functional. Polish belongs in a dedicated visual pass, not as pre-work. |
| **Phase 3 features** (Proctor role, Teacher role, Grader role, scoped permissions, invitation flow) | Not in Phase 2 scope. Not permitted per project rules. |
| **Multi-tenant activation** | Phase 4 scope. `validateTenantAccess()` currently no-op is correct. |
| **Redis production integration** | Phase 2 feature (queue, pub/sub). Current optional + health-only is correct. |
| **Excel/XLSX export support** | CSV-only is sufficient for Phase 1/2. |
| **Full frontend Zod runtime validation** | Type-level imports are standard for Phase 1/2. Add when API client is formalized. |
| **Multi-tenant mode** | Phase 1 single-tenant is the only runnable mode. |

---

## 5. Recommended Next Jobs

### Job 1: Add row lock to `submitAttempt()`

```text
Goal:       Eliminate TOCTOU race between candidate submit and deadline scanner
Scope:      packages/exam-engine/src/attemptCommands.ts
Non-goals:  Refactor grading, add new features
Files:      packages/exam-engine/src/attemptCommands.ts
            packages/exam-engine/src/__tests__/attemptCommands.test.ts
Steps:      1. Read current submitAttempt implementation
            2. Add findByIdForUpdate + executeInTransaction
            3. Write test: concurrent submit + autoSubmit produces clean state
            4. Run pnpm verify
Tests:      New test in attemptCommands.test.ts, existing tests must pass
Review:     Ensure idempotency check still fires, ensure audit event is inside transaction
Rollback:   git revert the commit
```

### Job 2: Wrap `gradeAttempt()` in transaction

```text
Goal:       Make grading atomic — crash mid-grade leaves no partial state
Scope:      packages/exam-engine/src/grading.ts
Non-goals:  Change grading logic, add new features
Files:      packages/exam-engine/src/grading.ts
            packages/exam-engine/src/__tests__/grading.test.ts
Steps:      1. Read current gradeAttempt()
            2. Identify all DB writes that must be atomic
            3. Wrap in executeInTransaction
            4. Write test: simulate crash, verify rollback
            5. Run pnpm verify
Tests:      New rollback test, existing passing
Rollback:   git revert
```

### Job 3: Triage and fix 3 E2E flaky specs

```text
Goal:       Reduce E2E flakiness from 7/17 to 0/17
Scope:      apps/e2e/e2e/ (3 highest-value specs: disconnect-restore,
            submit-flush, refresh-during-exam)
Non-goals:  Rewrite E2E framework, add new spec files
Files:      apps/e2e/e2e/disconnect-restore.spec.ts
            apps/e2e/e2e/submit-flush.spec.ts
            apps/e2e/e2e/refresh-during-exam.spec.ts
Steps:      1. Run each spec 5 times, collect all failure traces
            2. Categorize failures (timeout vs assertion vs seed collision)
            3. Fix root cause for each category
            4. Run each spec 5 times, verify 5/5 pass
            5. Run full pnpm test:e2e, verify all 17 pass
Tests:      Existing spec files
Rollback:   git revert the commit
```

### Job 4: Add frontend integration test for TakeExamPage

```text
Goal:       Reduce API over-mocking by adding one integration test with real server
Scope:      apps/web/src/pages/exam/TakeExamPage.test.tsx (add, don't replace)
Non-goals:  Convert all tests, remove existing tests
Files:      apps/web/src/pages/exam/TakeExamPage.test.tsx
            apps/web/src/lib/api.ts
Steps:      1. Set up MSW or in-process Fastify for the test
            2. Write test: start attempt → save answer → submit → verify
            3. Existing mocked tests remain passing
            4. Run pnpm verify
Tests:      One new integration test + all existing pass
Rollback:   git revert
```

### Job 5: Patch `code-quality.md` §14 Husky drift

```text
Goal:       Docs match reality
Scope:      docs/code-quality.md §14 only
Non-goals:  Rewrite entire doc, change hooks behavior
Files:      docs/code-quality.md
Steps:      1. Read current §14
            2. Replace "Lefthook manages" with "Husky manages"
            3. Update hook commands to match .husky/pre-commit and .husky/pre-push
            4. Run pnpm verify (format check only)
Tests:      None needed
Rollback:   git revert
```

---

## 6. Final Recommendation

### 6.1 Can Phase 2 baseline continue as mainline?

**Yes — Phase 2 baseline is clean for the objective-question exam loop.**
The P0 items (submit row lock, grading transaction, E2E triage, submit
freeze barrier) are resolved. Fill-blank and manual-grading E2E remain
**Phase 3 pending by scope decision** (subjective/fill-blank runtime not
implemented in Phase 2) — they are skipped, not flaky and not claimed done.
See `docs/phase-roadmap.md` Phase 2 "excluded" + Phase 3 "in scope", and
ADR-008 for the WYSIWYG-submit follow-up.

### 6.2 Should UI stay in current baseline state?

**Yes.** Tailwind v4 + shadcn/ui (27 components) is complete and functional. No traces of Ant Design, Koi, or Wegent. The minor issues (6 raw `className`, 1 duplicate dialog, empty dir) do not warrant a baseline change.

### 6.3 Should all UI stack migration be paused?

**Yes.** No Ant Design reintroduction, no Koi/Wegent adoption, no Tailwind/shadcn removal.

### 6.4 Should i18n continue?

**Yes, in small steps.** The `messageRegistry` + `statusMeta` pattern is a good foundation. Do not attempt the 74-test migration in one job. First i18n job: extract hardcoded Chinese from one page component into a locale constant file as a proof of concept, without migrating tests.

### 6.5 First construction job?

**P0-1: Add row lock to `submitAttempt()`.** Highest risk (active production race), smallest scope (single function), easiest to verify (existing test suite + new concurrent test). Estimated: one focused commit.

---

## Appendix A: UI Baseline Conclusion

```text
UI Baseline Recommendation:
- KEEP_CURRENT_BASELINE
```

## Appendix B: i18n Conclusion

```text
i18n Recommendation:
- CONTINUE_SMALL_STEPS
```
