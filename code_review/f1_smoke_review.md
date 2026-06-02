# F1 Smoke Tests — Code Review Report

**Date:** 2026-06-02
**Reviewer:** Code Review Agent (GLM-5.1)
**Scope:** F1 full-stack smoke tests + GET /system/info endpoint
**Branch:** `fix/phase1.2-enhancements`

---

## Verdict

**APPROVED** — with findings for follow-up

5 smoke tests pass. TDD cycle followed (RED → GREEN → REFACTOR). No blockers.

---

## Changes Under Review

| Item | Description | File |
|------|-------------|------|
| F1a | E2E smoke test package | `apps/e2e/` (new) |
| F1b | GET /system/info endpoint | `apps/api/src/routes/system.ts` |
| F1c | Todo update | `docs/phase1.2/todo.md` |

---

## F1a: E2E Smoke Test Package

**Directory:** `apps/e2e/` (4 files: `package.json`, `vitest.config.ts`, `src/smoke.test.ts`)

### Correctness

- `buildFullStackApp` registers all 13 route plugins + health endpoint — complete route coverage.
- Full lifecycle test: course → question → exam → publish → enroll → start → answer → submit → verify score. This is the critical exam path.
- Auth flow test: login success + wrong password rejection.
- System info test: new endpoint (TDD — wrote test first, watched 404 fail, then implemented).
- Health check test: verifies unauthenticated access.

### Architecture

- `buildFullStackApp` duplicates the route registration pattern from `server.ts`. This is acceptable for smoke tests (explicit is better than importing server.ts which has side effects like `app.listen()`), but creates a maintenance burden when routes are added/removed.
- `@exam/e2e` depends on `@exam/api` (workspace dep) to import route modules and testHelpers — clean dependency chain.
- Uses `fastify.inject()` not real HTTP — fast, no network, works in any environment.

### Findings

- **[F1-R1] Recommended:** `buildFullStackApp` is called 4 times (once per describe block). Each call creates a new SQLite in-memory DB + seeds. This is ~4x slower than needed. Should share a single app instance across all describe blocks or use a top-level `beforeAll`.

- **[F1-R2] Recommended:** No frontend smoke tests. The current e2e package tests backend API only. Critical frontend pages have zero test coverage:
  - **TakeExamPage** (320 lines) — the most critical page in the system
  - **ExamCreatePage** (317 lines) — complex form with question selection
  - **StartExamPage** (225 lines) — pre-exam instructions
  - **LoginPage** — no dedicated test file
  - 10 more admin pages with zero tests

  The backend lifecycle test proves the API chain works, but doesn't verify the React UI can drive it. Frontend flow tests using `@testing-library/react` + mocked API should be added for the critical paths.

- **[F1-R3] Optional:** `buildFullStackApp` route registration should match `server.ts` exactly. Currently if someone adds a new route to `server.ts`, the smoke test won't cover it unless manually updated. Consider a shared route manifest.

### Test Coverage (5 tests)

| Suite | Tests | Coverage |
|-------|-------|----------|
| System info | 1 | New /system/info endpoint |
| Health check | 1 | Unauthenticated health |
| Auth flow | 2 | Login success + failure |
| Full lifecycle | 1 | Complete exam path (9 API calls) |

---

## F1b: GET /system/info Endpoint

**File:** `apps/api/src/routes/system.ts` (lines 36-41)

### Correctness

- Returns `{ version, uptime }` without auth — correct for a public system info endpoint.
- `version` falls back to `"0.0.0"` when `npm_package_version` is not set — appropriate.
- `uptime` from `process.uptime()` — number in seconds.

### Security

- No auth required. Returns only version and uptime — no sensitive data. Acceptable.
- Does NOT expose Node.js version, OS details, or file paths — good.

### Findings

- **[F1-R4] Optional:** `version` uses `process.env.npm_package_version` which only works when launched via `npm run` or `pnpm run`. If the server is started directly (`node dist/server.js`), it returns `"0.0.0"`. Consider reading from `package.json` at build time or passing via `APP_VERSION` env var.

- **[F1-R5] Nit:** The endpoint is not registered in `@exam/contracts` with a Zod schema. All other system endpoints (`/system/health`, `/system/dashboard`) validate their response with Zod. Should add `SystemInfoResponseSchema` for consistency.

---

## Frontend Test Coverage Gap Analysis

### Critical — Zero Tests

| Page | Lines | Risk |
|------|-------|------|
| `TakeExamPage` | 320 | **Highest risk** — answer save, timer, heartbeat, submission |
| `ExamCreatePage` | 317 | Complex form — config + question selection + publish |
| `StartExamPage` | 225 | Pre-exam instructions, countdown, queue |
| `LoginPage` | 75 | Login form interaction, validation |
| `QuestionPage` | 325 | Question bank listing, filtering |
| `QuestionEditPage` | 150 | Question CRUD form |
| `QuestionImportPage` | 352 | CSV/Excel import flow |
| `ScoreListPage` | 332 | Score listing, filtering |
| `AttemptDetailPage` | 200 | Individual attempt review |
| `DashboardPage` | 161 | Admin stats |
| `ExamPage` | 185 | Admin exam list |
| `SystemHealthPage` | 193 | System monitoring |

### Adequate Coverage

| Page/Component | Tests | Assessment |
|----------------|-------|------------|
| `EnrollmentPicker` | 14 | Thorough |
| `ExamConfigForm` | 7 | Good |
| `AuthContext` | 12 | Thorough |
| `api` client | 15 | Thorough |
| `CoursePage` | 1 | Good depth (delete flow) |
| `SettingsPage` | 4 | Adequate |
| `ResultPage` | 4 | Good |

### Shallow Coverage (title + list only)

| Page | Tests | Missing |
|------|-------|---------|
| `CandidatesPage` | 3 | CRUD, validation, pagination |
| `UsersPage` | 3 | CRUD, role assignment |
| `OrganizationsPage` | 3 | CRUD, settings |
| `CandidateFieldsPage` | 3 | CRUD, reordering |
| `ExamDetailPage` | 1 | Enrollment, stats, archive |

---

## Summary of Findings

| ID | Severity | Description | Action |
|----|----------|-------------|--------|
| F1-R1 | Recommended | buildFullStackApp called 4 times — 4 separate DB instances | Share single app across describe blocks |
| F1-R2 | **Recommended** | No frontend flow tests — 12 pages with zero coverage | Add critical path frontend tests (TakeExamPage, ExamCreatePage, LoginPage) |
| F1-R3 | Optional | Route registration may drift from server.ts | Consider shared manifest |
| F1-R4 | Optional | version returns "0.0.0" outside npm/pnpm | Consider build-time injection |
| F1-R5 | Nit | /system/info response not Zod-validated | Add schema for consistency |

---

## Recommended Next Steps (Priority Order)

1. **Add frontend smoke tests** for the 3 most critical pages:
   - `LoginPage` — login form interaction → auth redirect
   - `ExamCreatePage` — create exam flow → question selection → save/publish
   - `TakeExamPage` — answer input → save → submit → result

2. **Refactor buildFullStackApp** to share a single app instance across all e2e describe blocks.

3. **Add SystemInfoResponseSchema** to `@exam/contracts`.

---

## Review Checklist

- [x] TDD cycle followed (RED: 404, GREEN: implemented, REFACTOR: clean)
- [x] Tests pass (5 e2e + 421 other = 426 total)
- [x] Typecheck clean
- [x] No security issues (no sensitive data exposed)
- [x] Follows existing patterns
- [x] Frontend test coverage gap identified and documented
