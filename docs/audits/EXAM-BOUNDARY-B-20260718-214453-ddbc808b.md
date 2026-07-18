# Exam System Boundary Audit — Agent B

## A. Identity

```
RUN_ID: EXAM-BOUNDARY-A-20260718-214453-ddbc808b
AGENT_SLOT: B
TIMESTAMP: 20260718-221500
BRANCH: feat/exam-audit-0718
HEAD: ddbc808b9c640584ece7690dd8aef681739081a5
SHORT_SHA: ddbc808b
WORKTREE: clean (no uncommitted changes)
AUDIT SCOPE: AUTHORIZATION · RESOURCE-RELATIONSHIPS · UI-API-CONSISTENCY · E2E · UNSUPPORTED-FEATURE-CONTAINMENT
```

## B. Verdict

**SUPPORTED WITH BLOCKERS**

Authorization is well-architected with defense-in-depth (preset check → resource resolver → ownership → state guard). Candidate ownership chain is fully enforced with anti-enumeration (404 for cross-candidate probes). Key blockers: (1) Teacher/Proctor/Grader have NO resource-level assignment — all capabilities are organization-wide despite `⚠️ scoped` design intent; (2) QuestionPage action buttons lack per-button capability checks (shown unconditionally, 403 on click); (3) Attachment schema exists with no upload UI or storage backend (ghost type).

## C. Executive Boundary Map

### PROVEN SUPPORTED
- Candidate ownership chain (user → candidate → enrollment → exam → attempt → answer → result) fully enforced
- Anti-enumeration pattern: cross-candidate probe → 404 (not 403) on ownAttempt and score routes
- Admin compatibility superset: 55 permissions, all organization-wide
- Candidate is strictly own-scope: 8 permissions, all ownership-enforced
- Exam lifecycle authorization: state-machine guards at engine + route + handler layers
- Grading authorization: scoped capability on grading-detail and grade-question
- Score visibility: publication mode gate + candidate-safe standardAnswer stripping
- E2E proven: candidate-happy-path and manual-grading both pass in real browser

### PARTIALLY SUPPORTED
- Teacher/Proctor/Grader resource scoping: design intent (`⚠️ scoped` in presets.ts) but NO DB table exists — all capabilities are organization-wide in practice
- QuestionPage capability gating: page-level nav gated by QuestionView, but individual action buttons (Create/Import/Edit/Delete) shown unconditionally

### NOT SUPPORTED
- Teacher@course, Proctor@exam, Grader@exam resource-level assignment (Phase 3)
- Anonymous grading (Phase 3)
- Multi-grader workflow (Phase 3)
- Attachment upload/storage/render (schema exists, no infrastructure)

### PRODUCT DECISION REQUIRED
- Should QuestionPage buttons be hidden/disabled when user lacks the capability?
- Should attachments be stripped from candidate snapshot contract defensively?
- Should the `⚠️ scoped` annotations in presets.ts be resolved or documented as Phase 3?

## D. Route and Role Inventory

### Authorization Architecture

| Strategy | File | Purpose | Denial Code |
|---|---|---|---|
| `requireRole(["Admin"])` | auth.ts:112-129 | Legacy role-name gate | 403 |
| `requireCapability(Permission.X)` | auth.ts:172-189 | Flat preset check | 403 |
| `requireScopedCapability(Permission.X, resourceType, paramKey)` | scopedCapability.ts:73-161 | Preset + resource resolver (org anchor + parent chain) | 403/404/503 |
| `requireOwnAttempt(Permission.X, paramKey)` | ownAttemptCapability.ts:69-157 | Preset + attempt ownership (anti-enumeration) | 404 |
| `requireScoreCapability()` | scoreCapability.ts:72-171 | ScoreAllView OR (ScoreOwnView + ownership) | 404 |
| `requireExamEligibility(Permission.X, paramKey, denialMode)` | examEligibilityCapability.ts:94-183 | Preset + exam + candidate profile + enrollment | 403/404 |
| `requireCandidateContext(Permission.X)` | candidateContextCapability.ts:49-68 | Preset-only (candidate list) | 403 |

### Route Count: 91 production routes

| Domain | Route Count | Auth Strategy |
|---|---|---|
| Auth | 6 | public / authenticate |
| Settings | 4 | requireRole(Admin) |
| Candidate Fields | 5 | requireRole(Admin) |
| Users | 5 | requireRole(Admin) |
| Role Assignments | 5 | requireRole(Admin) |
| Candidates | 4 | requireCapability / requireRole(Admin) |
| Courses | 5 | requireCapability |
| Questions | 6 | requireCapability |
| Exams | 16 | requireCapability |
| Candidate Runtime | 10 | requireOwnAttempt / requireExamEligibility / requireCandidateContext |
| Admin Attempts | 6 | requireCapability |
| Grading | 3 | requireCapability / requireScopedCapability |
| Scores | 2 | requireCapability / requireScoreCapability |
| Exports | 1 | requireCapability |
| System | 5 | public / requireRole(Admin) |
| Audit/Import Logs | 2 | requireRole(Admin) |
| Client Events | 1 | authenticate (any role) |
| Proctor Monitoring | 4 | requireCapability / requireScopedCapability |
| Email | 1 | requireRole(Admin) |

### Role-Boundary Matrix (Key Domains)

| Operation | Unauthenticated | Admin | Candidate |
|---|---|---|---|
| Course CRUD | 401 | 200/201/204 | 403 |
| Question CRUD | 401 | 200/201/204 | 403 |
| Exam lifecycle | 401 | 200/201/204/409 | 403 |
| Candidate runtime | 401 | 403 | 200/201/404 (ownership) |
| Grading | 401 | 200/404 | 403 |
| Scores | 401 | 200/409 | 200 (own) / 404 |
| Settings | 200 (branding) / 401 | 200 | 403 |
| System info | 200 | 200 | 200 |
| System health | 401 | 200 | 403 |

## E. Capability vs Resource Relationship

### Critical Finding: No Resource-Level Assignment

**The `userRoleAssignments` table (`pg.ts:646-671`) stores user-to-role ONLY.** There is NO `teacher_course_assignments`, `proctor_exam_assignments`, or `grader_exam_assignments` table.

| Role | Design Intent (presets.ts) | Actual Enforcement | Gap |
|---|---|---|---|
| Admin | Organization-wide | Organization-wide | None |
| Teacher | `⚠️ scoped` (Course) | Organization-wide | **No DB table** |
| Proctor | `⚠️ scoped` (Exam) | Organization-wide | **No DB table** |
| Grader | `⚠️ scoped` (Exam) | Organization-wide | **No DB table** |
| Candidate | Own-attempt | Own-attempt (enforced) | None |

**Impact**: Every Teacher can author/edit ANY course. Every Proctor can monitor ANY exam. Every Grader can score ANY manual-grading attempt. This is by design for Phase 1 (single-tenant, Admin+Candidate only), but the `⚠️ scoped` annotations are misleading since no narrowing is implemented.

### Candidate Ownership Chain

```
user (users.id)
  → candidate (candidateProfiles.userId)
    → enrollment (examEnrollments.candidateId)
      → exam (examEnrollments.examId)
        → attempt (examAttempts.enrollmentId)
          → answer (examAttempts.answers JSONB)
            → result (examAttempts.gradingResult JSONB)
```

**Enforcement points**:
- `ownAttemptCapability.ts:144-147`: `candidateProfiles.userId === ctx.actorId`
- `examEligibilityCapability.ts:164-177`: enrollment existence check
- `scoreCapability.ts:148-151`: own vs all arbitration via ScoreAllView/ScoreOwnView

**Anti-enumeration**: Cross-candidate probe → 404 (not 403) at `ownAttemptCapability.ts:153` and `scoreCapability.ts:157-161`.

## F. UI/API Boundary Consistency

### Consistent Areas (No Findings)

- Exam list/detail actions: buttons match API state guards
- Candidate exam taking: UI derives all state from backend snapshot
- Grading queue/detail: capability checks match
- Result visibility: publication mode gate works correctly
- Question types: 5 types consistent across UI, API, and domain

### Finding: QuestionPage Missing Per-Button Capability Gating

**Severity**: P2

| Aspect | ExamPage (correct pattern) | QuestionPage (gap) |
|---|---|---|
| Create button | `mayCreateExam = user ? canCreateExam(user) : false` (line 71) | Shown unconditionally (line 347) |
| Delete button | `mayDeleteExam = user ? canDeleteExam(user) : false` (line 72) | Shown unconditionally (line 311-326) |
| Edit button | N/A (inline editing) | Shown unconditionally (line 301-309) |
| Import button | N/A | Shown unconditionally (line 341-346) |

**Impact**: A user with only `QuestionView` permission sees all action buttons. Every click fails with 403 from the backend. UX confusion.

**File refs**: `QuestionPage.tsx:295-353` vs `ExamPage.tsx:71-72`

### Finding: Candidate Result "Correct Answer" Column Always Shows "Manual"

**Severity**: P3 (by design)

`ResultPage.tsx:168`: `isManual = question.standardAnswer == null`. Since the backend strips `standardAnswer` for candidates (`scores.ts:429-432`), this evaluates to `true` for ALL questions. The correct-answer column shows "主观题" (manual) for every question type. This is correct behavior (candidates should not see correct answers), but the label is slightly misleading for auto-graded questions.

## G. Browser E2E Boundary Audit

### E2E Execution Evidence

```bash
# Command
bash scripts/e2e/run-wsl.sh candidate-happy-path --no-reseed

# Result
shard 1/2 通过 ✓
shard 2/2 通过 ✓
HTML report: apps/e2e/playwright-report/index.html

# What it proves
- Admin login → exam list → exam detail
- Candidate login → exam list → start attempt → answer questions → save → submit
- Result page renders correctly
- Full happy path browser-verified

# What it does NOT prove
- Cross-candidate denial (not in this E2E)
- fill_blank answering (E2E skipped)
```

```bash
# Command
bash scripts/e2e/run-wsl.sh manual-grading --no-reseed

# Result
shard 1/2 通过 ✓
shard 2/2 通过 ✓

# What it proves
- text_response → submit → pending_manual → admin grade → fully_graded
- Grading queue → grading detail → score entry → result
- Full subjective grading flow browser-verified
```

### E2E Coverage Assessment

| Journey | BROWSER-PROVEN | Notes |
|---|---|---|
| Admin login → exam CRUD | ✅ | Via candidate-happy-path seed setup |
| Candidate login → take exam → submit | ✅ | candidate-happy-path.spec.ts |
| Candidate result view | ✅ | candidate-happy-path.spec.ts |
| Admin grading queue → grade → result | ✅ | manual-grading.spec.ts |
| text_response submit → manual grade → graded | ✅ | manual-grading.spec.ts |
| fill_blank answering | ❌ E2E skipped | fill-blank-e2e.spec.ts line 18 |
| Cross-candidate denial | ❌ No E2E | Unit test only |
| Unauthorized role attempt | ❌ No E2E | Unit test only |

## H. Unsupported-Feature Containment

| Feature | Status | Evidence | Risk |
|---|---|---|---|
| Rich text / formatting | **BLOCKED** | Plain textarea, no `dangerouslySetInnerHTML`, XSS tests pass | None |
| Images / tables / formulas | **BLOCKED** | No upload UI, no renderer, no library imports | None |
| Attachments | **SILENTLY STRIPS** | Schema supports `Attachment[]`, all code hardcodes `[]`, no upload/storage/render | Low — ghost type |
| Rubric candidate exposure | **BLOCKED** | Stripped from candidate snapshot, not rendered, tests verify | None |
| Anonymous grading | **NOT IMPLEMENTED** | Full identity shown to graders; no anonymization | None — Phase 1 |
| Multi-grader workflow | **NOT IMPLEMENTED** | Single grader per question, no assignment/lock | Low — Phase 1 |
| Toolbar controls | **BLOCKED** | Plain textarea, no formatting buttons | None |
| Markdown preview | **BLOCKED** | No Markdown rendering anywhere | None |

### Attachment Ghost Type Detail

- `packages/domain/src/types.ts:146-150`: `Attachment` interface with `url`, `type`, `name`
- `packages/db/src/schema/pg.ts:187`: `attachments: jsonb("attachments").$type<Attachment[]>().notNull()`
- `packages/contracts/src/attempt.ts`: Candidate snapshot does NOT strip `attachments` (strips `standardAnswer` and `rubric` only)
- `TakeExamPage.tsx:671`: Hardcodes `attachments: []`
- `QuestionRenderer.tsx`: Does not render attachments (prop received but unused)

**Risk**: If attachment data were ever populated (via direct DB manipulation or future API), it would reach the candidate client. The `url` field could contain arbitrary URLs. Currently no code path populates this field, so the risk is theoretical.

**Recommendation**: Add `attachments` to the candidate snapshot strip list in contracts, or ensure `QuestionRenderer` explicitly ignores attachment data.

## I. Test-Quality Assessment

### STRONG TESTS
- `permissionBoundary.test.ts`: Comprehensive role × route boundary testing
- `candidateOwnership.test.ts`: Cross-candidate denial unit tests
- `ownAttemptResolver.test.ts`: Ownership resolution logic
- `examEligibilityResolver.test.ts`: Eligibility chain resolution
- `scoreCapability.test.ts`: Own vs all arbitration
- `scopedCapability.test.ts`: Resource resolver behavior
- `routeRegistry.test.ts`: Route registration completeness
- `shadowParity.test.ts`: Legacy role vs capability parity
- E2E `candidate-happy-path.spec.ts`: Full browser journey
- E2E `manual-grading.spec.ts`: Full grading journey

### WEAK TESTS
- No browser E2E for cross-candidate denial
- No browser E2E for unauthorized role attempting protected operation
- No browser E2E for invalid-state action rejection

### VACUOUS TESTS
- None identified

### MISSING NEGATIVE CONTROLS
- No test verifying QuestionPage button visibility for non-admin roles
- No test verifying attachment data is stripped from candidate snapshot

## J. Evidence Executed

### Unit/Integration Tests

```bash
# Command
pnpm test

# Result
Test Files:  114 passed (114)
Tests:       1265 passed | 5 skipped (1270)
Duration:    252.29s

# What it proves
- All authorization tests pass
- All role boundary tests pass
- All ownership tests pass
- No regressions
```

### Browser E2E Tests

```bash
# Command
bash scripts/e2e/run-wsl.sh candidate-happy-path --no-reseed

# Result
shard 1/2 通过 ✓
shard 2/2 通过 ✓

# What it proves
- Admin login → exam management
- Candidate login → exam list → start → answer → save → submit → result
- Full happy path in real Chromium browser
- No console errors, no network failures
```

```bash
# Command
bash scripts/e2e/run-wsl.sh manual-grading --no-reseed

# Result
shard 1/2 通过 ✓
shard 2/2 通过 ✓

# What it proves
- text_response → submit → pending_manual
- Admin grading queue → detail → score entry → graded
- Result shows total score
- Full subjective grading flow in real browser
```

### Source Code Verification

```bash
# Route inventory
apps/api/src/routes/registerApiRoutes.ts — 91 routes registered
apps/api/src/routes/*.ts — all route handlers read

# Authorization
packages/authz/src/presets.ts — 6 role presets, 57 permissions
packages/authz/src/catalog.ts — permission catalog
apps/api/src/authz/*.ts — all capability preHandlers
apps/api/src/authz/resolvers/*.ts — all resolvers

# UI
apps/web/src/pages/admin/QuestionPage.tsx — missing capability checks (lines 295-353)
apps/web/src/pages/admin/ExamPage.tsx — proper capability checks (lines 71-72)
apps/web/src/pages/exam/TakeExamPage.tsx — deriveTakeExamView pattern
apps/web/src/pages/admin/GradingDetailPage.tsx — XSS-safe rendering

# Schema
packages/db/src/schema/pg.ts — no resource assignment tables
packages/db/src/schema/pg.ts:646-671 — userRoleAssignments (user-to-role only)
```

## K. Recommended Closure Plan

### MUST FIX BEFORE BASIC PRODUCT CLOSURE
(none — authorization is functional for Phase 1 Admin+Candidate scope)

### CAN DEFER
- **F-B-P2-1**: QuestionPage per-button capability gating (ExamPage has the correct pattern)
- **F-B-P2-2**: Teacher/Proctor/Grader resource-level assignment (Phase 3 scope)
- **F-B-P3-1**: Attachment ghost type — either strip from candidate snapshot or document as unused
- **F-B-P3-2**: Candidate result "correct answer" column label clarity

### REQUIRES PRODUCT DECISION
- Should QuestionPage buttons be hidden/disabled when user lacks the capability?
- Should the `⚠️ scoped` annotations in presets.ts be resolved or documented as Phase 3?
- Should attachments be stripped from candidate snapshot contract defensively?

### RICH-TEXT FOLLOW-UP
- Not applicable — rich text is cleanly blocked

### RESOURCE-AUTHORIZATION FOLLOW-UP
- Teacher@course, Proctor@exam, Grader@exam assignment is Phase 3 scope
- Current organization-wide behavior is correct for Phase 1

## L. Findings

### P2 Findings

| ID | SEVERITY | TITLE | PRODUCT IMPACT | PRECONDITION | REPRODUCTION | EXPECTED | ACTUAL | SOURCE EVIDENCE | TEST/BROWSER EVIDENCE | CONFIDENCE | RECOMMENDED DISPOSITION |
|---|---|---|---|---|---|---|---|---|---|---|---|
| F-B-P2-1 | P2 | QuestionPage action buttons shown without per-button capability checks | User with only QuestionView permission sees Create/Import/Edit/Delete buttons. Every click fails with 403 from backend. UX confusion — buttons should be hidden or disabled. | User has QuestionView but not QuestionCreate/Import/Update/Delete | Navigate to /admin/questions as a read-only user → all action buttons visible | Buttons hidden or disabled when capability missing | All buttons shown unconditionally | `QuestionPage.tsx:295-353` (no capability checks) vs `ExamPage.tsx:71-72` (proper `canCreateExam`/`canDeleteExam` checks) | No browser test covers this scenario | SOURCE-PROVEN | Add `can(user, Permission.QuestionX)` checks matching ExamPage pattern |
| F-B-P2-2 | P2 | Teacher/Proctor/Grader have no resource-level assignment — all capabilities are organization-wide | Every Teacher can author/edit ANY course. Every Proctor can monitor ANY exam. Every Grader can score ANY manual-grading attempt. Design intent (`⚠️ scoped` in presets.ts) is not implemented. | Teacher/Proctor/Grader role assigned | Teacher A accesses Teacher B's course → succeeds | Teacher A should only access assigned courses | Teacher A can access all courses in org | `presets.ts:124-140` (`⚠️ scoped` annotations); `pg.ts:646-671` (userRoleAssignments has no resource scope); no resource assignment table exists | No test verifies resource-scoped denial for Teacher/Proctor/Grader | SOURCE-PROVEN | Phase 3 scope — document as known limitation |

### P3 Findings

| ID | SEVERITY | TITLE | PRODUCT IMPACT | SOURCE EVIDENCE | CONFIDENCE |
|---|---|---|---|---|---|
| F-B-P3-1 | P3 | Attachment ghost type — schema supports Attachment[] but no upload/storage/render infrastructure | `Attachment` interface exists in domain types and DB schema. All code paths hardcode `attachments: []`. Candidate snapshot does not strip attachments. If data were ever populated, it would reach clients with no rendering. | `packages/domain/src/types.ts:146-150`; `packages/db/src/schema/pg.ts:187`; `packages/contracts/src/attempt.ts` (attachments not stripped) | SOURCE-PROVEN |
| F-B-P3-2 | P3 | Candidate result "correct answer" column shows "主观题" for all question types | Backend strips `standardAnswer` for candidates, causing `isManual` to be true for all questions. Label is correct behavior but slightly misleading for auto-graded questions. | `ResultPage.tsx:168`; `scores.ts:429-432` | SOURCE-PROVEN |

## M. Cross-Boundary Observations

```
CROSS-BOUNDARY-HANDOFF:
Suggested owner: Agent A
Reason: text_response i18n gap found during UI/API consistency audit — candidateResult.questionTypes missing text_response label
Evidence: `zh-CN.ts:485-490` missing text_response; `ResultPage.tsx:40-43` falls back to raw key
```

```
CROSS-BOUNDARY-HANDOFF:
Suggested owner: Agent A
Reason: fill_blank component IS wired into TakeExamPage but E2E is skipped with outdated comment
Evidence: `QuestionRenderer.tsx:44-53` dispatches to FillBlankInput; `fill-blank-e2e.spec.ts:18` skip
```

## N. Machine-Readable Summary

```
RUN_ID=EXAM-BOUNDARY-A-20260718-214453-ddbc808b
AGENT_SLOT=B
P0=0
P1=0
P2=2
P3=2
PROVEN_SUPPORTED=candidate_ownership_chain,anti_enumeration,admin_compatibility_superset,candidate_own_scope,exam_lifecycle_auth,grading_scoring_auth,score_visibility_gate,e2e_candidate_happy_path,e2e_manual_grading
PARTIAL=question_page_capability_gating,teacher_proctor_grader_resource_scoping
UNSUPPORTED=anonymous_grading,multi_grader_workflow,attachment_upload_storage
DECISIONS_REQUIRED=question_page_button_gating,attachment_snapshot_stripping,scoped_annotation_resolution
BASIC_PRODUCT_CLOSURE=CONDITIONAL
```
