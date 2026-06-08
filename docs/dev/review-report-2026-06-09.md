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
| BUG-01 | Backend | `attempts.ts` | `submitAttempt` then `gradeAttempt` not in transaction — grading failure leaves attempt in `submitted` state |
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
| `@exam/web` | 72% | 66% | 68% |

Total tests: **646** (177 API + 247 web + 33 domain + 26 db + 87 exam-engine + 68 contracts + 8 auth)

## 4. Smoke / E2E Test Coverage

Existing smoke tests cover the minimum link:

| Test Suite | Tests | Coverage |
|---|---|---|
| `apps/e2e/smoke.test.ts` | 6 | Health check, system info, auth flow, full exam lifecycle (create→publish→submit→score), candidate import |
| `apps/api/smoke.test.ts` | 8 | Phase 1.1 regression — critical path: publish, enroll, start, delete constraint, password change |

## 5. CI Pipeline

```
format:check → lint → lint:copy → typecheck → test → test:e2e → coverage → coverage gate (60%) → build
```

The coverage gate step reads `coverage-summary.json` from each package and fails the build if any package drops below 60% line coverage.

## 6. Modified Files

| File | Change |
|---|---|
| `README.md` | Demo seed accounts, commands, docs index |
| `.github/workflows/ci.yml` | Coverage gate step |
| `apps/web/src/components/exam/QuestionRenderer.tsx` | Default fallback case |
| `apps/web/src/pages/admin/QuestionPage.tsx` | Error handling on delete + toast import |
| `apps/web/src/pages/admin/CandidatesPage.tsx` | Error handling on toggle/import + toast import |
| `apps/web/src/pages/exam/TakeExamPage.tsx` | Submit error toast + toast import |
| `apps/web/vitest.config.ts` | Coverage thresholds raised to 60/50/50 |
| `packages/contracts/vitest.config.ts` | Added coverage config with thresholds |
| `packages/contracts/src/__tests__/contracts.test.ts` | New: 35 contract validation tests |
| `packages/contracts/package.json` | Added `@vitest/coverage-v8` devDependency |
