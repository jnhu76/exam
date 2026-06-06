# Phase 1.2 Test Suite — Review Report

**Date:** 2026-06-02
**Reviewer:** Code Review Agent (GLM-5.1)
**Scope:** Phase 1.2 test infrastructure + integration tests (A1–E1)

---

## Verdict

**APPROVED**

All 271 tests pass (160 API, 111 Web). Tests follow consistent patterns, cover stated Phase 1.2 requirements, and map cleanly to spec concerns. Optional findings addressed in follow-up commit.

---

## Changes Under Review

| Task | Description                       | File                                               |
| ---- | --------------------------------- | -------------------------------------------------- |
| A1   | Test helpers expansion            | `api/src/routes/testHelpers.ts`, `helpers.test.ts` |
| B1   | CSV export integration tests      | `api/src/routes/export.test.ts`                    |
| B2   | Candidate/profile invariant tests | `api/src/routes/candidateInvariant.test.ts`        |
| B3   | Permission boundary tests         | `api/src/routes/permissionBoundary.test.ts`        |
| C1   | Sidebar nav + active state tests  | `web/src/components/layout/layout.test.tsx`        |
| C2   | Route separation tests            | `web/src/lib/routes.test.ts`                       |
| D1   | Exam state machine API tests      | `api/src/routes/examStateMachine.test.ts`          |
| E1   | API input validation tests        | `api/src/routes/inputValidation.test.ts`           |

---

## A1: testHelpers.ts + helpers.test.ts

**Files:** `testHelpers.ts` (317 lines), `helpers.test.ts` (101 lines)

### Correctness

- `buildTestApp` correctly sets up in-memory SQLite, seeds, registers all plugins (auth, tenant, rate-limit, security), returns typed context with tokens.
- `createCandidateViaApi`, `createExamViaApi`, `publishExamViaApi`, `submitExamAsCandidate`, `exportResultsCsvAsAdmin` follow throw-on-non-2xx pattern.
- Helpers test exercises full lifecycle: create → publish → submit → export with meaningful assertions.

### Readability

- Clean, well-structured. Each helper has a single responsibility. Error messages include status code and body.

### Architecture

- `submitExamAsCandidate` does a lot (create candidate, enroll, start, answer, submit) — appropriate for a high-level helper reducing boilerplate.

### Findings

- **Optional:** `createExamViaApi` opts object has 9 fields. `questionScore` and `totalScore` could conflict — single question worth 50 with totalScore 100 will fail publish. Latent footgun; all current callers pass matching values.
- **Nit:** `type FastifyInstance = TestContext["app"]` defined mid-file at line 130.

**Verdict:** Solid.

---

## B1: export.test.ts (CSV Export Integration)

**File:** `export.test.ts` (320 lines, 8 tests)

### Correctness

- Tests cover: 404, empty CSV, 401 unauthenticated, 403 candidate, Content-Disposition header, graded data, CSV escaping (RFC 4180), examId isolation.
- Escaping test checks `'"Zhang, ""San"""'` — correct.
- Isolation test verifies export B has header-only, export A has data.

### Findings

- **Optional:** `beforeAll` manually creates course/question/exam instead of using helpers. Duplicates logic.
- **Nit:** `typeof res.body === "string" ? res.body : res.body.toString()` duplicated from `exportResultsCsvAsAdmin`.

**Verdict:** Good coverage.

---

## B2: candidateInvariant.test.ts

**File:** `candidateInvariant.test.ts` (174 lines, 5 tests)

### Correctness

- Tests: user+profile created together, candidate with profile can list exams, seed candidate without profile gets empty list, cannot start without profile, cannot submit without profile.

### Findings

- **Lines 17–39:** Local `createCandidateViaApi` duplicates `testHelpers.ts` with different signature. Should consolidate.
- **Lines 153–173:** "Cannot submit answers" test only tests start path (same as previous test with different exam). Misleading name.

**Verdict:** Good invariant coverage. Two issues to fix.

---

## B3: permissionBoundary.test.ts

**File:** `permissionBoundary.test.ts` (206 lines, 14 tests)

### Correctness

- 4 categories: unauthenticated (401), candidate (403), teacher partial access, admin full access.
- Each test focused on single endpoint + role.

### Findings

- **Optional:** Missing teacher export CSV test. Route allows Teacher role but no test verifies it returns 200.

**Verdict:** Good boundary coverage.

---

## C1: layout.test.tsx (Sidebar Nav + Active State)

**File:** `layout.test.tsx` (255 lines, ~16 tests)

### Correctness

- Branding fallback, role visibility (Admin, SuperAdmin, Teacher, Candidate), nav link hrefs, ExamLayout header nav, collapsed state, layout shell isolation.

### Findings

- **Optional:** "always shows question bank group for all roles" (line 105) only tests candidate role. Name says "all" but tests one.

**Verdict:** Thorough.

---

## C2: routes.test.ts

**File:** `routes.test.ts` (52 lines, 4 tests)

### Correctness

- All route constants and dynamic route functions verified.
- Key: `routes.admin.results !== routes.admin.exams`.

**Verdict:** Clean. No issues.

---

## D1: examStateMachine.test.ts

**File:** `examStateMachine.test.ts` (162 lines, 7 tests)

### Correctness

- Tests: draft→update, draft→publish, publish→republish (409), published→archive, archived→publish (409), draft→delete, published→delete (409).
- Cross-referenced with `examCommands.ts` VALID_TRANSITIONS — all correct.

### Findings

- **Nit:** Line 73 — first publish result not asserted before testing republish.
- **Missing:** `open`/`close` transitions not tested (no API routes yet).

**Verdict:** Good primary transition coverage.

---

## E1: inputValidation.test.ts

**File:** `inputValidation.test.ts` (186 lines, 8 tests)

### Correctness

- Tests: empty title, oversized title, negative passingScore, invalid datetime, empty question content, negative score, duplicate username, malformed login.
- All check `error.code === "VALIDATION_ERROR"` except duplicate (409).

### Findings

- **Optional:** Missing: `passingScore > totalScore`, `durationMinutes ≤ 0`, `closeAt < openAt`, `questionIds: []`.

**Verdict:** Good Zod boundary coverage.

---

## Missing Coverage (noted for future)

| Area                               | Status          | Reason                  |
| ---------------------------------- | --------------- | ----------------------- |
| `openExam`/`closeExam` transitions | Not API-exposed | No routes yet           |
| Answer Save Protocol conflicts     | Not tested      | Complex; deferred       |
| Heartbeat → disrupted recovery     | Not tested      | Requires timer mocking  |
| Multi-tenant isolation             | Not tested      | Cross-org leakage check |

---

## Issues Resolved in Follow-Up

| Issue                              | File                         | Resolution                                                             |
| ---------------------------------- | ---------------------------- | ---------------------------------------------------------------------- |
| Duplicated `createCandidateViaApi` | `candidateInvariant.test.ts` | Import from testHelpers                                                |
| Misleading "cannot submit" test    | `candidateInvariant.test.ts` | Renamed + added actual submit test                                     |
| "all roles" test name              | `layout.test.tsx`            | Fixed to test multiple roles                                           |
| Missing teacher export test        | `permissionBoundary.test.ts` | Added teacher export CSV test                                          |
| Missing validation edges           | `inputValidation.test.ts`    | Added passingScore > totalScore, durationMinutes ≤ 0, closeAt < openAt |
| Unasserted first publish           | `examStateMachine.test.ts`   | Added assertion                                                        |
| Manual beforeAll setup             | `export.test.ts`             | Refactored to use helpers                                              |
| Answer save conflicts              | `answerSaveProtocol.test.ts` | New file                                                               |
| Multi-tenant isolation             | `tenantIsolation.test.ts`    | New file                                                               |

---

## Review Checklist

- [x] Change matches spec/task requirements
- [x] Edge cases handled
- [x] Error paths handled
- [x] Tests cover the change adequately
- [x] Names are clear and consistent
- [x] Follows existing patterns
- [x] No unnecessary coupling
- [x] No secrets in code
- [x] Input validated at boundaries
- [x] Tests pass (160 API, 111 Web)
- [x] Build succeeds
