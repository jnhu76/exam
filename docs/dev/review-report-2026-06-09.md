# Code Review Report — 2026-06-09

Branch: `review/demo-seed-and-readme` (based on `master` @ `386eb99`)

## Scope

Full-stack review covering UI (React), API (Fastify), domain logic, demo seed, test infrastructure, and CI pipeline.

## 1. Issues Found & Fixed

### UI Fixes

| ID | File | Issue | Fix |
|---|---|---|---|
| FIX-01 | `CoursePage.tsx` | Tooltip shown even when description fully visible | Extracted `TruncatedCell` component using `ref.scrollHeight > ref.clientHeight` to detect truncation |
| FIX-02 | `QuestionPage.tsx` | `handleDelete` has no try/catch — uncaught rejection on failure | Added try/catch with `toast.error` |
| FIX-03 | `CandidatesPage.tsx` | `toggle()` and `importCsv()` have no error handling — UI goes stale on failure | Added try/catch with `toast.error` for both functions |
| FIX-04 | `TakeExamPage.tsx` | Submit failure is completely silent — user sees dialog close with no feedback | Added `toast.error("提交失败，请重试")` in catch block |
| FIX-05 | `QuestionRenderer.tsx` | No fallback for unknown question types — renders nothing silently | Added `default` case with error message |

### Coverage Improvements

| ID | Package | Before | After | Change |
|---|---|---|---|---|
| COV-01 | `@exam/contracts` | 0% lines | 97% lines | Added `contracts.test.ts` covering auth, course, exam, question, score, and attempt schemas (35 new tests) |
| COV-02 | `@exam/web` | 50% threshold | 60% threshold | Raised vitest coverage thresholds |
| COV-03 | `@exam/contracts` | no thresholds | 60/50/60 thresholds | Added vitest coverage config with thresholds |

### CI Improvements

| ID | Change |
|---|---|
| CI-01 | Added `Check coverage thresholds` step to `.github/workflows/ci.yml` — fails the build if any package drops below 60% line coverage |

### Documentation

| ID | Change |
|---|---|
| DOC-01 | Updated `README.md` with demo seed accounts, data summary, test guide link, documentation index, and new `pnpm db:seed:demo` commands |

## 2. Issues Found — Not Fixed (Deferred)

### High Priority (Security / Architecture)

| ID | Area | Issue | Recommendation |
|---|---|---|---|
| SEC-01 | Backend | `tenantPlugin` is a no-op — multi-tenant isolation depends entirely on `ctx.organizationId` from JWT with no verification | Implement proper tenant guard before Phase 1 release |
| SEC-02 | Backend | In-memory `examQueues` Map not shared across processes, no TTL cleanup | Replace with DB-backed queue or add TTL cleanup before multi-process deployment |
| SEC-03 | Backend | Answer save has no optimistic locking — concurrent requests can cause lost updates | Add version check at DB update level |
| SEC-04 | Scores | Admin/SuperAdmin score detail doesn't check `attempt.organizationId` — cross-org data leak possible | Add org scope check in `findVisibleAttempt` |
| SEC-05 | Server | No explicit `bodyLimit` on Fastify — vulnerable to large payload DoS | Set `bodyLimit: 1048576` in Fastify config |

### Medium Priority (Bugs / UX)

| ID | Area | File | Issue |
|---|---|---|---|
| BUG-01 | Backend | `attempts.ts` | ~~`submitAttempt` then `gradeAttempt` not in transaction — grading failure leaves attempt in `submitted` state~~ **✅ Fixed (2026-06-13)**: submit 走 `tx+lock → readGradingSnapshot → computeGradingResult → finalizeGrading(tx+lock)`；submit 对 submitted/graded 幂等，崩溃卡 submitted 可重试 submit 完成评分 |
| BUG-02 | Backend | `server.ts` | SPA fallback serves `index.html` for `/api/*` typos instead of 404 JSON |
| BUG-03 | Backend | `exam.ts` | `archiveExam` route has no try/catch — inconsistent with `/publish` route |
| BUG-04 | Backend | `errors.ts` | `isConstraintError` only detects SQLite — will miss PostgreSQL unique violations in J9 |
| UX-01 | Frontend | `ScoreListPage.tsx` | Search input is non-functional (renders but has no `value`/`onChange`) |
| UX-02 | Frontend | `TakeExamPage.tsx` | No `beforeunload` handler — accidental tab close loses exam progress |
| UX-03 | Frontend | `StartExamPage.tsx` | `pollQueue` has no try/catch — network error causes stale state, potential infinite error loop |
| UX-04 | Frontend | `FillBlankInput.tsx` | Uses raw `<input>` instead of shadcn `<Input>` — visual inconsistency |
| UX-05 | Frontend | `QuestionPage.tsx` | `page` state not reset on search change — user can get stuck on empty page |
| UX-06 | Frontend | `ExamPage.tsx` | No null guard on `new Date(exam.openAt)` — renders "Invalid Date" |
| UX-07 | Frontend | `CandidatesPage.tsx` | `importRows()`, `previewRows()` run CSV parsing on every render — should use `useMemo` |
| UX-08 | Frontend | `ScoreListPage.tsx` | CSV export creates `<a>` without appending to DOM — may not work in some browsers |
| DATA-01 | DB | `demo-seed.ts` | Open exam candidate4 enrollment has `status: "completed"` but no `finalScore`/`finalPassed` |
| DATA-02 | DB | `demo-seed-verify.ts` | Verification re-seeds before verifying — destructive if run against wrong database |
| DATA-03 | Engine | `attemptCommands.ts` | `restoreAttempt` doesn't check if exam is still open |
| DATA-04 | Engine | `attemptCommands.ts` | `startAttempt` allows new attempt while one is `disrupted` — orphaned attempt |

### Low Priority (Code Quality)

| ID | Area | Issue |
|---|---|---|
| QUAL-01 | Types | `request: any` / `reply: any` pervasive in API route handlers — bypasses TypeScript safety |
| QUAL-02 | Duplication | `PaginatedResponse<T>` interface duplicated in CoursePage, ExamPage, QuestionPage |
| QUAL-03 | Duplication | `createExamRepoAdapter` / `createAttemptRepoAdapter` copy-pasted across 3 files |
| QUAL-04 | A11y | `UsersPage.tsx` form inputs missing `id`/`htmlFor` — label-input associations broken |
| QUAL-05 | A11y | `TakeExamPage.tsx` no heading hierarchy for question content |
| QUAL-06 | Code | `uuid(tag)` in demo-seed.ts ignores `tag` parameter entirely |
| QUAL-07 | Engine | `gradeQuestion` switch has no exhaustiveness guard for future question types |
| QUAL-08 | Engine | `publishExam` doesn't verify questions have `standardAnswer` |

## 3. Test Coverage Summary

All packages now meet the coverage threshold:

| Package | Lines | Branches | Functions |
|---|---|---|---|
| `@exam/domain` | 100% | 100% | 100% |
| `@exam/db` | 80% | 61% | 63% |
| `@exam/contracts` | 97% | 92% | 75% |
| `@exam/auth` | 80% | 50% | 100% |
| `@exam/api` | 82% | 60% | 81% |
| `@exam/web` | 81% | 70% | 70% |

Total tests: **739** (177 API + 306 web + 33 domain + 26 db + 87 exam-engine + 68 contracts + 8 auth + 31 e2e + 3 imports)

## 4. Smoke / E2E Test Coverage

| Test Suite | Tests | Coverage |
|---|---|---|
| `apps/e2e/e2e/*.spec.ts` | 4 files | Playwright browser E2E (Docker): candidate happy-path, resume-attempt, submit-flush, demo-seed-accounts — runs via `docker-compose.test.yml` e2e service or CI |
| `apps/api` route suite (e.g. `smoke.test.ts`) | many | Phase 1.1 regression — critical path: publish, enroll, start, delete constraint, password change, plus full API coverage |

> **Note**: The legacy `apps/e2e/src/*` Vitest smoke files (`smoke.test.ts`, `api-smoke.test.ts`) and the old `apps/e2e/src/e2e/browser.spec.ts` Playwright suite + `playwright.docker.config.ts` were removed as dead code (zero references, no run entry, referenced removed Phase 1 routes). API-level smoke coverage now lives in the `@exam/api` route test suite.

## 5. CI Pipeline

```
format:check → lint → lint:copy → lint:arch → typecheck → test → test:e2e → coverage → build
```

Vitest `coverage.thresholds` enforces minimum coverage at test time (web: 80/70/70, contracts: 60/50/60).

## 6. Modified Files

| File | Change |
|---|---|
| `README.md` | Demo seed accounts, commands, docs index |
| `.github/workflows/ci.yml` | Removed broken shell coverage gate (vitest thresholds enforce) |
| `apps/web/src/components/exam/QuestionRenderer.tsx` | Default fallback case |
| `apps/web/src/pages/admin/QuestionPage.tsx` | Error handling on delete + toast import |
| `apps/web/src/pages/admin/CandidatesPage.tsx` | Error handling on toggle/import + toast import |
| `apps/web/src/pages/exam/TakeExamPage.tsx` | Submit error toast + toast import |
| `apps/web/vitest.config.ts` | Coverage thresholds raised to 80/70/70 |
| `packages/contracts/vitest.config.ts` | Added coverage config with thresholds |
| `packages/contracts/src/__tests__/contracts.test.ts` | New: 35 contract validation tests |
| `packages/contracts/package.json` | Added `@vitest/coverage-v8` devDependency |
| `apps/web/src/pages/admin/__tests__/CandidateFieldsPage.test.tsx` | Rewritten: 4→18 tests |
| `apps/web/src/pages/admin/__tests__/CoursePage.test.tsx` | Rewritten: 2→18 tests |
| `apps/web/src/pages/admin/__tests__/UsersPage.test.tsx` | Rewritten: 9→16 tests |
| `apps/web/src/pages/admin/__tests__/CandidatesPage.test.tsx` | Rewritten: 8→18 tests |
| `apps/web/src/pages/admin/__tests__/ExamDetailPage.test.tsx` | Rewritten: 5→17 tests |
| `apps/web/src/components/question/__tests__/SingleChoiceInput.test.tsx` | New |
| `apps/web/src/components/question/__tests__/MultipleChoiceInput.test.tsx` | New |
| `apps/web/src/components/settings/__tests__/PasswordChangeForm.test.tsx` | New |
| `apps/web/src/components/shared/__tests__/ImportWizard.test.tsx` | New |
| `apps/e2e/src/api-smoke.test.ts` | New: 26 backend API smoke tests *(removed as dead code in a later cleanup; API coverage now lives in the `@exam/api` route suite)* |
| `apps/e2e/src/e2e/browser.spec.ts` | New: Playwright browser E2E tests *(removed as dead code in a later cleanup; active E2E is `apps/e2e/e2e/*.spec.ts`)* |
| `apps/e2e/playwright.config.ts` | New: Playwright config with webServer setup |
| `apps/e2e/package.json` | Added `@playwright/test`, `test:e2e:browser` script |

## 7. Known Limitations

- **Playwright browser E2E** runs via Docker (`docker-compose.test.yml` e2e service, Playwright image) or CI; the local WSL environment cannot host a browser. The legacy `apps/e2e/src/e2e/browser.spec.ts` was removed as dead code; the active suite is `apps/e2e/e2e/*.spec.ts`.
- **SEC-01 through SEC-05** deferred to Phase 1 hardening sprint.
- **BUG-01 through BUG-04, UX-01 through UX-08, DATA-01 through DATA-04** deferred — tracked in this report for prioritization.
- **QUAL-01 through QUAL-08** deferred — code quality improvements for future backlog.
