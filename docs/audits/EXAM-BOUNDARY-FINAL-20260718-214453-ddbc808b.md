# Exam System Boundary Audit — Final Report

## A. Identity

```
RUN_ID: EXAM-BOUNDARY-20260718-214453-ddbc808b
AUDIT TYPE: Parallel boundary audit (Agent A + Agent B merged)
TIMESTAMP: 20260718-223000
BRANCH: feat/exam-audit-0718
HEAD: ddbc808b9c640584ece7690dd8aef681739081a5
SHORT_SHA: ddbc808b
WORKTREE: clean (no uncommitted changes)
AUDIT SCOPE: PRODUCT · QUESTION-TYPE · EXAM-LIFECYCLE · SCORING · DATA-CONSISTENCY · SUBJECTIVE-QUESTION · AUTHORIZATION · RESOURCE-RELATIONSHIPS · UI-API-CONSISTENCY · E2E · UNSUPPORTED-FEATURE-CONTAINMENT
```

## B. Verdict

**SUPPORTED WITH BLOCKERS**

The basic management loop (Admin CRUD → exam publish → candidate take → auto-grade → result) is substantially proven across all question types. Authorization is well-architected with defense-in-depth. Candidate ownership chain is fully enforced with anti-enumeration. Subjective/plain-text (`text_response`) has a complete path through code and E2E. Browser E2E proves the happy path and manual grading flow.

**Blockers** (P2, none are P0/P1):
1. `fill_blank` candidate answering is code-complete but E2E skipped — never browser-verified
2. `text_response` has no answer length limit (storage/performance risk)
3. `text_response` missing from `candidateResult.questionTypes` i18n — result page shows raw type key
4. QuestionPage action buttons lack per-button capability checks (shown unconditionally, 403 on click)
5. Teacher/Proctor/Grader have NO resource-level assignment — all capabilities organization-wide despite `⚠️ scoped` design intent

## C. Executive Boundary Map

### PROVEN SUPPORTED
- single_choice: create → edit → publish → candidate render → autosave → submit → auto-grade → result → export
- multiple_choice: same full path with `partial_half` / `all_correct_full` scoring
- true_false: same full path (dedicated type with boolean standardAnswer)
- Exam lifecycle: draft → published → open → closed → archived + cancel (all 6 states, all transitions validated)
- Question snapshot immutability (4-layer copy-on-change chain, no live references in grading path)
- Answer Save Protocol (versioned, idempotent, conflict detection — all 5 conflict reasons handled)
- Server-side time authority (deadline, remaining seconds)
- Auto-grading for objective types
- Manual grading queue + detail + score entry for text_response
- Result publication modes (immediate / after_grading / manual)
- Enrollment → attempt → grade → score result pipeline
- Candidate ownership (attempt access gated by `requireOwnAttempt` preHandler + defense-in-depth `candidateId` check inside transaction)
- Anti-enumeration: cross-candidate probe → 404 (not 403)
- Admin-only capability gates on all admin routes
- XSS-safe rendering: `dangerouslySetInnerHTML` NOT used anywhere; explicit tests pass
- 91 production routes with consistent authorization
- Browser E2E: candidate-happy-path and manual-grading both pass

### PARTIALLY SUPPORTED
- fill_blank: frontend component (`FillBlankInput`) EXISTS and IS wired into `TakeExamPage`. Grading engine handles exact/keyword matching. **E2E skipped** with outdated comment.
- text_response: code path + E2E proven. **No explicit answer length limit**.
- text_response i18n: `candidateResult.questionTypes` omits `text_response` — result page shows raw key.
- QuestionPage capability gating: page-level nav gated, but action buttons shown unconditionally.
- Teacher/Proctor/Grader resource scoping: design intent (`⚠️ scoped`) but NO DB table exists.

### NOT SUPPORTED
- rich-text editing / rendering
- image/table/formula/attachment round-trip
- rubric display to candidates (by design)
- queued entry, timed_sync / deadline / untimed timing modes, Electron lockdown
- Teacher@course, Proctor@exam, Grader@exam resource-level assignment (Phase 3)
- Anonymous grading, multi-grader workflow (Phase 3)
- Attachment upload/storage/render (schema exists, no infrastructure)

### PRODUCT DECISION REQUIRED
- Should text_response answers have a maximum length?
- Should fill_blank E2E be promoted from Phase 3 to Phase 2?
- Should candidate result views show per-question answer comparison?
- Should admin be able to re-grade a `completed_manual` entry?
- Should QuestionPage buttons be hidden/disabled when user lacks the capability?
- Should attachments be stripped from candidate snapshot contract defensively?
- Should the `⚠️ scoped` annotations in presets.ts be resolved or documented as Phase 3?

## D. Question-Type Capability Matrix

| Question type | Create | Edit | Publish validation | Candidate render | Autosave | Submit | Grade | Result | Export | Actual status |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| single_choice | ✅ SOURCE | ✅ SOURCE | ✅ TEST | ✅ BROWSER | ✅ TEST | ✅ TEST | ✅ TEST | ✅ BROWSER | ✅ TEST | PROVEN |
| multiple_choice | ✅ SOURCE | ✅ SOURCE | ✅ TEST | ✅ SOURCE | ✅ TEST | ✅ TEST | ✅ TEST | ✅ BROWSER | ✅ TEST | PROVEN |
| true_false | ✅ SOURCE | ✅ SOURCE | ✅ TEST | ✅ BROWSER | ✅ TEST | ✅ TEST | ✅ TEST | ✅ BROWSER | ✅ TEST | PROVEN |
| fill_blank | ✅ SOURCE | ✅ SOURCE | ✅ TEST | ✅ SOURCE | ⚠️ SOURCE | ⚠️ E2E-SKIP | ✅ TEST | ⚠️ UNVERIFIED | ⚠️ UNVERIFIED | PARTIAL (E2E skipped) |
| text_response | ✅ SOURCE | ✅ SOURCE | ✅ SOURCE | ✅ BROWSER | ✅ TEST | ✅ E2E | ✅ E2E | ✅ BROWSER | ⚠️ UNVERIFIED | PLAIN-TEXT COMPLETE |
| essay/subjective (rich) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | UNSUPPORTED |

**Legend**: SOURCE = code proven, TEST = unit/integration test proven, BROWSER = E2E browser proven, E2E-SKIP = E2E exists but skipped, UNVERIFIED = not explicitly tested

## E. Objective-Question Semantics

### Single choice
- **Answer representation**: `string` (option ID)
- **Scoring**: `gradePrecise()` — exact `===` match; full score or zero (binary)
- **Empty answer**: score = 0
- **Post-submit**: immutable (answer protocol rejects further saves)

### Multiple choice
- **Answer representation**: `string[]` (array of option IDs)
- **Scoring**: `gradeMultipleChoice()` — set comparison; deduped + sorted
  - `all_correct_full`: full score if exact match, else zero
  - `partial_half`: half score if subset with no wrong selections
- **Empty selection**: score = 0

### True/false
- **Dedicated type** with `boolean` standardAnswer
- **Scoring**: `gradePrecise()` — exact boolean match

### Fill-blank
- **Answer representation**: `string` (single-blank) or `Record<string, string>` (multi-blank)
- **Scoring**: `gradeFillBlank()` — exact or keyword mode; pipe-delimited alternatives; configurable case sensitivity
- **Multi-blank**: ALL blanks must match for full score

### Text response (subjective)
- **Answer representation**: `string` (arbitrary text)
- **Validation**: `z.unknown()` — NO length validation
- **Scoring**: always zero-score placeholder; real scoring via manual grading queue
- **Manual grading**: one-way `pending_manual → completed_manual`

## F. Subjective-Question Boundary

### Classification: PLAIN-TEXT COMPLETE

**13-step journey verified** (author create → edit → publish → candidate render → autosave → restore → submit → grader view → grade → comment → result → export):

All steps verified through source code analysis and E2E browser testing. The `text_response` type has a complete plain-text path. Rich text is explicitly UNSUPPORTED and cleanly blocked.

**Not browser-proven**: very long answers, CJK stress test, emoji/HTML input, rapid autosave race.

## G. Exam Lifecycle Matrix

| Current state | Action | Expected result | Domain enforcement | Defense layers |
| --- | --- | --- | --- | --- |
| draft | publish | published | ≥1 question, valid schedule | assertTransition + reconciliation + audit |
| draft | edit | draft (updated) | draft-only edit guard | assertTransition |
| draft | delete | deleted | ExamNotDraftError | assertTransition |
| published | unpublish | draft | stale-state reconciliation | assertTransition + lock |
| published | open | open | now ≥ openAt | auto-reconciliation |
| published | cancel | canceled | no active attempts | assertTransition + guard |
| published | archive | archived | published/closed/canceled only | assertTransition |
| open | close | closed | unresolved attempts guard | assertTransition + guard |
| open | extend | open (closeAt extended) | ExamExtendNotAllowedError | assertTransition |
| open | cancel | canceled | ExamCancelNotAllowedError | assertTransition + guard |
| closed | archive | archived | closed/canceled only | assertTransition |
| canceled | archive | archived | canceled only | assertTransition |

**Illegal transitions verified**: open→draft, closed→open, archived→editable, canceled→normal-score, submitted→answer-modification, draft→candidate-start — all rejected with domain errors.

## H. Snapshot and Historical Consistency

| Data | Classification | Evidence |
| --- | --- | --- |
| Question content | IMMUTABLE SNAPSHOT (COPY-ON-PUBLISH) | `buildQuestionSnapshot()` at publish time |
| Option content | IMMUTABLE SNAPSHOT (isCorrect stripped) | `options.map(o => ({id, content}))` |
| Correct answer | IMMUTABLE SNAPSHOT | frozen in QuestionSnapshot |
| Score value | IMMUTABLE SNAPSHOT | AttemptGradingEntry.maxScore mirrors snapshot |
| Grading rule | IMMUTABLE SNAPSHOT | multiSelectScoring/fillBlankMatchMode fixed |
| Rubric | IMMUTABLE SNAPSHOT | frozen at attempt creation |
| Draft answers | LIVE REFERENCE (mutable during in_progress) | versioned with conflict detection |
| Submitted answers | IMMUTABLE SNAPSHOT (COPY-ON-SUBMIT) | freeze barrier at submit time |

**Chain of custody**: QuestionBank → publishExam → Exam.questionSnapshot → startOrRestoreAttempt → Attempt.questionSnapshot → submitAttempt → Attempt.submittedAnswers → materializeGradingWorkset → AttemptGradingEntry. No live references in grading path.

## I. Concurrency and Idempotency Boundaries

| Scenario | Mechanism | Strength |
| --- | --- | --- |
| autosave vs submit | EA row lock + status guard | Strong |
| submit vs auto-close | Deadline reconciliation before submit | Strong |
| double submit | Status check: already submitted → validate workset + return | Strong |
| double grade | `completed_manual` terminal check | Strong |
| repeat publish-results | Idempotent: timestamp set once | Strong |
| duplicate enrollment | UNIQUE(orgId, examId, candidateId) | Strong |
| answer version conflict | `baseVersion < currentVersion` → STALE_VERSION | Strong |
| answer idempotency | `clientSeq` key + structural equality | Strong |
| deadline reconciliation | Canonical `min(exam.closeAt, attempt.deadlineAt)` | Strong |

## J. Route and Role Inventory

### Authorization Architecture (91 production routes)

| Strategy | Purpose | Denial Code |
|---|---|---|
| `requireRole(["Admin"])` | Legacy role-name gate | 403 |
| `requireCapability(Permission.X)` | Flat preset check | 403 |
| `requireScopedCapability(Permission.X, resourceType, paramKey)` | Preset + resource resolver | 403/404/503 |
| `requireOwnAttempt(Permission.X, paramKey)` | Preset + attempt ownership (anti-enumeration) | 404 |
| `requireScoreCapability()` | ScoreAllView OR (ScoreOwnView + ownership) | 404 |
| `requireExamEligibility(Permission.X, paramKey, denialMode)` | Preset + exam + candidate profile + enrollment | 403/404 |

### Role-Boundary Matrix

| Operation | Unauthenticated | Admin | Candidate |
| --- | --- | --- | --- |
| Course/Question CRUD | 401 | 200/201/204 | 403 |
| Exam lifecycle | 401 | 200/201/204/409 | 403 |
| Candidate runtime | 401 | 403 | 200/201/404 (ownership) |
| Grading | 401 | 200/404 | 403 |
| Scores | 401 | 200/409 | 200 (own) / 404 |
| Settings (branding) | 200 | 200 | 200 |
| System info | 200 | 200 | 200 |

## K. Capability vs Resource Relationship

### Critical Finding: No Resource-Level Assignment

**The `userRoleAssignments` table stores user-to-role ONLY.** There is NO `teacher_course_assignments`, `proctor_exam_assignments`, or `grader_exam_assignments` table.

| Role | Design Intent | Actual Enforcement | Gap |
| --- | --- | --- | --- |
| Admin | Organization-wide | Organization-wide | None |
| Teacher | `⚠️ scoped` (Course) | Organization-wide | **No DB table** |
| Proctor | `⚠️ scoped` (Exam) | Organization-wide | **No DB table** |
| Grader | `⚠️ scoped` (Exam) | Organization-wide | **No DB table** |
| Candidate | Own-attempt | Own-attempt (enforced) | None |

### Candidate Ownership Chain

```
user → candidate → enrollment → exam → attempt → answer → result
```

Enforced at: `ownAttemptCapability.ts:144-147`, `examEligibilityCapability.ts:164-177`, `scoreCapability.ts:148-151`. Anti-enumeration: cross-candidate probe → 404.

## L. UI/API Boundary Consistent Areas

- Exam list/detail actions: buttons match API state guards ✅
- Candidate exam taking: UI derives all state from backend snapshot ✅
- Grading queue/detail: capability checks match ✅
- Result visibility: publication mode gate works correctly ✅
- Question types: 5 types consistent across UI, API, and domain ✅

## M. Browser E2E Boundary Audit

### E2E Execution Evidence

```bash
# candidate-happy-path
bash scripts/e2e/run-wsl.sh candidate-happy-path --no-reseed
→ shard 1/2 通过 ✓  shard 2/2 通过 ✓

# manual-grading
bash scripts/e2e/run-wsl.sh manual-grading --no-reseed
→ shard 1/2 通过 ✓  shard 2/2 通过 ✓
```

### E2E Coverage

| Journey | BROWSER-PROVEN |
| --- | --- |
| Admin login → exam CRUD | ✅ |
| Candidate login → take exam → submit | ✅ |
| Candidate result view | ✅ |
| Admin grading queue → grade → result | ✅ |
| text_response submit → manual grade → graded | ✅ |
| fill_blank answering | ❌ E2E skipped |
| Cross-candidate denial | ❌ Unit test only |
| Unauthorized role attempt | ❌ Unit test only |

## N. Unsupported-Feature Containment

| Feature | Status | Risk |
| --- | --- | --- |
| Rich text / formatting | BLOCKED | None |
| Images / tables / formulas | BLOCKED | None |
| Attachments | SILENTLY STRIPS | Low — ghost type |
| Rubric candidate exposure | BLOCKED | None |
| Anonymous grading | NOT IMPLEMENTED | None — Phase 1 |
| Multi-grader workflow | NOT IMPLEMENTED | Low — Phase 1 |
| Toolbar controls | BLOCKED | None |
| Markdown preview | BLOCKED | None |

## O. Findings

### P2 Findings (5)

| ID | Source | Title | Product Impact | Source Evidence | Confidence | Disposition |
| --- | --- | --- | --- | --- | --- | --- |
| F-P2-1 | Agent A | fill_blank E2E skipped — complete loop never browser-verified | Full candidate answering → save → submit → grade → result loop never browser-verified. Component IS wired into TakeExamPage, but E2E is skipped with outdated comment. | `fill-blank-e2e.spec.ts:18`; `FillBlankInput.tsx` (functional); `QuestionRenderer.tsx:44-53` (dispatches) | SOURCE-PROVEN | Promote E2E to run |
| F-P2-2 | Agent A | text_response has no answer length limit | Candidates can submit megabyte-scale text payloads to JSONB columns. No UI feedback. | `attempt.ts:157` (`answer: z.unknown()`); `TextResponseInput.tsx` (no maxLength) | SOURCE-PROVEN | Add max length to contract/textarea |
| F-P2-3 | Agent A | text_response missing from candidateResult.questionTypes i18n | Result page shows raw `"text_response"` key instead of localized label. | `zh-CN.ts:485-490` (missing); `ResultPage.tsx:40-43` (fallback) | SOURCE-PROVEN | Add i18n entry |
| F-P2-4 | Agent B | QuestionPage action buttons shown without per-button capability checks | User with QuestionView sees Create/Import/Edit/Delete buttons. Every click fails 403. | `QuestionPage.tsx:295-353` vs `ExamPage.tsx:71-72` | SOURCE-PROVEN | Add `can(user, Permission.QuestionX)` checks |
| F-P2-5 | Agent B | Teacher/Proctor/Grader have no resource-level assignment | All capabilities are organization-wide despite `⚠️ scoped` design intent. No DB table exists. | `presets.ts:124-140`; `pg.ts:646-671` (no resource scope) | SOURCE-PROVEN | Phase 3 scope — document as known limitation |

### P3 Findings (7)

| ID | Source | Title | Product Impact | Source Evidence | Confidence |
| --- | --- | --- | --- | --- | --- |
| F-P3-1 | Agent A | fill_blank Unicode normalization untested | `toLocaleLowerCase()` may not handle all Unicode case mappings | `gradingEngine.ts:67-69` | SOURCE-PROVEN |
| F-P3-2 | Agent A | No E2E test for cross-candidate attempt isolation | Unit test exists but no browser-level proof | `candidateOwnership.test.ts` | TEST-PROVEN (unit) |
| F-P3-3 | Agent A | Question deletion does not check snapshot references | Soft data-consistency gap (snapshot uses plain string, not FK) | `pg.ts` questions table | SOURCE-PROVEN |
| F-P3-4 | Agent A | No admin re-grade policy | `completed_manual` is terminal; no admin override path | `manualGrading.ts:147-153` | SOURCE-PROVEN |
| F-P3-5 | Agent A | Result page does not show per-question answer comparison for candidates | Candidate sees total score only; per-question is admin-only | `ResultPage.tsx:202-206` | SOURCE-PROVEN |
| F-P3-6 | Agent B | Attachment ghost type | Schema supports `Attachment[]` but no upload/storage/render. Candidate snapshot does not strip attachments. | `types.ts:146-150`; `pg.ts:187`; `attempt.ts` | SOURCE-PROVEN |
| F-P3-7 | Agent B | Candidate result "correct answer" column shows "主观题" for all types | Backend strips standardAnswer, causing isManual=true for all questions. Correct behavior, slightly misleading label. | `ResultPage.tsx:168`; `scores.ts:429-432` | SOURCE-PROVEN |

### Downgraded from Previous Analysis

| Previous Concern | Current Status | Reason |
| --- | --- | --- |
| XSS rendering for text_response | NOT A FINDING | Already tested: `GradingDetailPage.test.tsx:495-517` and `QuestionRenderer.test.tsx:79-92`. No `dangerouslySetInnerHTML` in production code. React JSX escapes by default. |

## P. Test-Quality Assessment

### STRONG TESTS
- `gradingEngine.test.ts`: Exhaustive scoring coverage (5 types, edge cases)
- `attemptCommands.test.ts`: State machine transitions, retake policy
- `gradingWorkset.test.ts`: Materialization consistency, terminal aggregation
- `manualGradingCompletion.test.ts` / `manualGradingHold.test.ts`: Manual entry lifecycle
- `submitAndGradeAttempt`: Freeze barrier, crash recovery, idempotent re-entry
- `permissionBoundary.test.ts` / `candidateOwnership.test.ts`: Authorization
- `examStateMachine.test.ts`: All 6 states + transition guards
- `saveAnswer.test.ts`: Version conflict, idempotency, deadline
- `submitFreezeBarrier.test.ts`: Concurrent save-vs-submit race
- `gradingConcurrency.test.ts`: Real Postgres FOR UPDATE serialization
- `permissionBoundary.test.ts`: Role × route boundary
- `ownAttemptResolver.test.ts`: Ownership resolution
- `examEligibilityResolver.test.ts`: Eligibility chain
- `scoreCapability.test.ts`: Own vs all arbitration
- E2E `candidate-happy-path.spec.ts`: Full browser journey
- E2E `manual-grading.spec.ts`: Full grading journey

### WEAK TESTS
- `fill-blank-e2e.spec.ts`: Skipped — no runtime verification
- No E2E for very-long-answer, rapid-autosave-race, CJK/emoji round-trip
- No E2E for cross-candidate denial or unauthorized role attempt
- No test for QuestionPage button visibility for non-admin roles

### VACUOUS TESTS
- None identified

### MISSING NEGATIVE CONTROLS
- fill_blank Unicode mixed case normalization
- question deletion with snapshot references
- admin re-grade after `completed_manual`
- attachment data stripped from candidate snapshot

## Q. Evidence Executed

### Unit/Integration Tests

```bash
# Command
pnpm test

# Result
Test Files:  114 passed (114)
Tests:       1265 passed | 5 skipped (1270)
Duration:    252.29s

# Proves
- All unit and integration tests pass
- No regressions
- Authorization, ownership, grading, lifecycle all verified
```

### Browser E2E Tests

```bash
# Command
bash scripts/e2e/run-wsl.sh candidate-happy-path --no-reseed
→ shard 1/2 通过 ✓  shard 2/2 通过 ✓

# Proves
- Admin login → exam management
- Candidate login → exam list → start → answer → save → submit → result
- Full happy path in real Chromium browser

# Command
bash scripts/e2e/run-wsl.sh manual-grading --no-reseed
→ shard 1/2 通过 ✓  shard 2/2 通过 ✓

# Proves
- text_response → submit → pending_manual → admin grade → fully_graded
- Grading queue → detail → score entry → result
- Full subjective grading flow in real browser
```

### Source Code Verification

```bash
# Question type inventory
packages/domain/src/enums.ts          — 5 QuestionType values (closed set)
packages/contracts/src/question.ts    — CreateQuestionRequestSchema, superRefine validation
packages/db/src/schema/pg.ts          — questions table (type: text, no DB enum)
apps/web/src/components/exam/QuestionRenderer.tsx — dispatches to 5 input components
apps/web/src/components/exam/FillBlankInput.tsx   — functional component (78 lines)
apps/web/src/components/exam/TextResponseInput.tsx — wraps SubjectiveAnswerInput

# Grading engine
packages/domain/src/gradingEngine.ts  — gradeQuestion dispatch, all grading functions
packages/exam-engine/src/manualGrading.ts — gradeQuestion (manual), one-way guard

# Lifecycle
packages/exam-engine/src/examStateMachine.ts — EXAM_VALID_TRANSITIONS map
packages/exam-engine/src/examCommands.ts     — all exam commands
apps/api/src/routes/exam.ts                  — all exam route handlers

# Snapshot
packages/exam-engine/src/attemptCommands.ts   — startOrRestoreAttempt, submitAttempt
packages/exam-engine/src/answerProtocol.ts    — processSaveAnswer, buildSubmittedAnswersSnapshot
packages/exam-engine/src/gradingWorkset.ts    — computeExpectedGradingEntries

# Concurrency
apps/api/src/orchestrators/submitAndGradeAttempt.ts — single-tx submit+grade with EA lock
packages/exam-engine/src/deadlineReconciliation.ts  — canonical deadline authority
packages/db/src/schema/pg.ts                        — UNIQUE constraints

# Authorization
packages/authz/src/presets.ts — 6 role presets, 57 permissions
packages/authz/src/catalog.ts — permission catalog
apps/api/src/authz/*.ts       — all capability preHandlers
apps/api/src/authz/resolvers/*.ts — all resolvers

# UI
apps/web/src/pages/admin/QuestionPage.tsx — missing capability checks (295-353)
apps/web/src/pages/admin/ExamPage.tsx — proper capability checks (71-72)
apps/web/src/pages/exam/TakeExamPage.tsx — deriveTakeExamView pattern
apps/web/src/pages/admin/GradingDetailPage.tsx — XSS-safe rendering

# XSS verification
grep dangerouslySetInnerHTML *.tsx — only in test files (asserting absence)
apps/web/src/pages/admin/GradingDetailPage.test.tsx:495-517 — XSS test
apps/web/src/components/exam/QuestionRenderer.test.tsx:79-92 — XSS test

# i18n
apps/web/src/i18n/locales/zh-CN.ts:485-490 — missing text_response

# Schema
packages/db/src/schema/pg.ts:646-671 — userRoleAssignments (user-to-role only)
packages/db/src/schema/pg.ts:187 — attachments column (ghost type)
```

### Code Quality

```bash
pnpm verify     # TypeScript strict + Prettier + ESLint + all tests pass
pnpm lint:arch  # Dependency boundaries respected
```

## R. Recommended Closure Plan

### MUST FIX BEFORE BASIC PRODUCT CLOSURE
(none — basic product closure criteria are met for the objective-question loop)

### CAN DEFER

| ID | Finding | Recommendation |
| --- | --- | --- |
| F-P2-1 | fill_blank E2E skipped | Promote E2E to run; the skip comment is outdated since FillBlankInput IS rendered |
| F-P2-2 | text_response no length limit | Add max length to contract and/or textarea |
| F-P2-3 | text_response i18n gap | Add `text_response: "文本作答题"` to `candidateResult.questionTypes` |
| F-P2-4 | QuestionPage capability gating | Add `can(user, Permission.QuestionX)` checks matching ExamPage pattern |
| F-P2-5 | Teacher/Proctor/Grader resource scoping | Phase 3 scope — document as known limitation |
| F-P3-1 | fill_blank Unicode normalization | Add test for Unicode mixed case |
| F-P3-2 | Cross-candidate E2E | Add browser-level ownership denial test |
| F-P3-3 | Question deletion snapshot check | Add reference check or document as by-design |
| F-P3-4 | Admin re-grade policy | Document one-way completion as intentional |
| F-P3-5 | Candidate result detail | Product decision: show per-question comparison? |
| F-P3-6 | Attachment ghost type | Strip from candidate snapshot or document as unused |
| F-P3-7 | Result "correct answer" label | Consider label change for auto-graded questions |

### REQUIRES PRODUCT DECISION

1. Should text_response answers have a maximum length?
2. Should fill_blank E2E be promoted from Phase 3 to Phase 2?
3. Should candidate result views show per-question answer comparison?
4. Should admin be able to re-grade a `completed_manual` entry?
5. Should QuestionPage buttons be hidden/disabled when user lacks the capability?
6. Should attachments be stripped from candidate snapshot contract defensively?
7. Should the `⚠️ scoped` annotations in presets.ts be resolved or documented as Phase 3?

### RICH-TEXT FOLLOW-UP
Not applicable — rich text is cleanly blocked.

### RESOURCE-AUTHORIZATION FOLLOW-UP
Teacher@course, Proctor@exam, Grader@exam assignment is Phase 3 scope. Current organization-wide behavior is correct for Phase 1.

## S. Machine-Readable Summary

```
RUN_ID=EXAM-BOUNDARY-20260718-214453-ddbc808b
AUDIT_TYPE=parallel-merged
P0=0
P1=0
P2=5
P3=7
PROVEN_SUPPORTED=single_choice,multiple_choice,true_false,exam_lifecycle,question_snapshot_immutable,answer_save_protocol,auto_grading,manual_grading_text_response,enrollment_attempt_pipeline,candidate_ownership,anti_enumeration,xss_safe_rendering,e2e_candidate_happy_path,e2e_manual_grading
PARTIAL=fill_blank_e2e_skipped,text_response_no_length_limit,text_response_i18n_gap,question_page_capability_gating,teacher_proctor_grader_resource_scoping
UNSUPPORTED=rich_text,image_table_formula,queued_entry,timed_sync,anonymous_grading,multi_grader,attachment_upload_storage
DECISIONS_REQUIRED=text_response_max_length,fill_blank_e2e_promotion,candidate_result_detail_visibility,admin_regrade_policy,question_page_button_gating,attachment_snapshot_stripping,scoped_annotation_resolution
BASIC_PRODUCT_CLOSURE=CONDITIONAL
```
