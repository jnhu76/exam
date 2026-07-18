# Exam System Boundary Audit — Agent A

## A. Identity

```
RUN_ID: EXAM-BOUNDARY-A-20260718-214453-ddbc808b
AGENT_SLOT: A
TIMESTAMP: 20260718-214453
BRANCH: feat/exam-audit-0718
HEAD: ddbc808b9c640584ece7690dd8aef681739081a5
SHORT_SHA: ddbc808b
WORKTREE: clean (no uncommitted changes)
AUDIT SCOPE: PRODUCT · QUESTION-TYPE · EXAM-LIFECYCLE · SCORING · DATA-CONSISTENCY · SUBJECTIVE-QUESTION
```

## B. Verdict

**SUPPORTED WITH BLOCKERS**

The basic management loop (Admin CRUD → exam publish → candidate take → auto-grade → result) is substantially proven across all question types. Subjective/plain-text (`text_response`) has a complete path through code and E2E. Key blockers: (1) `fill_blank` candidate answering is code-complete but E2E skipped — the full loop has never been browser-verified; (2) `text_response` has no answer length limit (storage/performance risk); (3) `text_response` missing from `candidateResult.questionTypes` i18n — result page shows raw type key instead of localized label.

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
- Admin-only capability gates on all admin routes
- XSS-safe rendering: `dangerouslySetInnerHTML` NOT used anywhere; all answer rendering via `formatAnswer()` returns string → React JSX text content; explicit test at `GradingDetailPage.test.tsx:495-517` and `QuestionRenderer.test.tsx:79-92`

### PARTIALLY SUPPORTED
- fill_blank: frontend component (`FillBlankInput`) EXISTS and is functional (renders `<input type="text">` for each blank, supports single-blank string and multi-blank Record modes). `QuestionRenderer` dispatches to it. Grading engine handles exact/keyword matching. **E2E is skipped** (`fill-blank-e2e.spec.ts` line 18: `test.skip(true, "Phase 3 pending...")`). The component IS wired into `TakeExamPage` via `QuestionRenderer`, but the E2E comment at line 14-16 claims "The take page does not render a usable fill-blank/subjective input" — this appears outdated since `FillBlankInput` IS rendered. The skip is a scoping decision, not a technical limitation.
- text_response: code path + E2E proven for basic flow. **No explicit answer length limit** — `SubjectiveAnswerInput` accepts optional `maxLength` prop but `TextResponseInput` does not pass it; `SaveAnswerRequestSchema.answer` is `z.unknown()` with no validation. Candidates can submit arbitrarily large text payloads.
- text_response i18n: `candidateResult.questionTypes` in `zh-CN.ts:485-490` defines labels for `single_choice`, `multiple_choice`, `true_false`, `fill_blank` but **omits `text_response`**. `ResultPage.formatQuestionType()` does `t('candidateResult.questionTypes.${type}')` — for a `text_response` question, this returns the raw key `"text_response"` instead of a human-readable label.

### NOT SUPPORTED
- rich-text editing / rendering
- image/table/formula/attachment round-trip
- rubric display to candidates (by design — rubric is grader-only)
- queued entry (requireQueue) — code exists but not operationally wired
- timed_sync / deadline / untimed timing modes
- Electron lockdown

### PRODUCT DECISION REQUIRED
- fill_blank E2E boundary: is it Phase 3 or can it be promoted? (Component IS wired up, skip comment appears outdated)
- Very-long-answer limits for text_response (no explicit max length enforced at contract or route level)
- Post-submit score revision policy (currently one-way, no admin re-grade)
- Candidate result answer-standardAnswer comparison visibility (currently hidden for candidates)

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
- **Answer representation**: `string` (option ID) — `QuestionSchema.standardAnswer` validates it references a valid option ID
- **Validation**: `CreateQuestionRequestSchema` superRefine: must have ≥2 options; standardAnswer must be a string matching an option ID
- **Scoring**: `gradePrecise()` — exact `===` match; full score or zero
- **Partial credit**: None (binary)
- **Ordering**: Option IDs are the truth; candidate selects by option ID
- **Duplicate options**: Rejected at creation (option IDs must be unique)
- **Empty answer**: `candidateAnswer === undefined || candidateAnswer === null` → score = 0
- **Post-submit mutability**: Attempt status transitions to `submitted`/`graded`; answer protocol rejects further saves
- **Result rendering**: Score + correct flag per question; standardAnswer stripped from candidate view; visible in admin score detail
- **Export**: Included in CSV export with candidate answer + standard answer

### Multiple choice
- **Answer representation**: `string[]` (array of option IDs)
- **Validation**: `CreateQuestionRequestSchema`: standardAnswer must be non-empty array of valid option IDs
- **Scoring**: `gradeMultipleChoice()` — set comparison; deduped + sorted
  - `all_correct_full`: full score if exact match, else zero
  - `partial_half`: half score if some correct and none wrong (subset with no incorrect selections)
  - Extra wrong selections → zero score
  - Missing correct selections → partial (if scoring mode allows)
- **Order independence**: Candidate answer is deduped + sorted before comparison
- **Empty selection**: `candidate.length === 0` → score = 0 (not partial)
- **Post-submit**: Same as single choice

### True/false
- **Dedicated type or alias?**: Dedicated `true_false` QuestionType with `boolean` standardAnswer
- **Storage**: `standardAnswer: boolean` (validated by contract)
- **Scoring**: Uses `gradePrecise()` — `candidateAnswer === question.standardAnswer`; exact match on boolean
- **Candidate render**: `TrueFalseInput` component — radio with true/false options
- **Consistency**: Separate enum value in `QuestionType`, separate render component, same grading path as single_choice

### Fill-blank
- **Answer representation**: `Record<string, string>` for multi-blank, or `string` for single-blank
- **Validation**: Content must contain `____` placeholder; standardAnswer must be non-empty string
- **Scoring**: `gradeFillBlank()` with two modes:
  - `exact`: normalized string equality (`trim()` + optional `toLocaleLowerCase()`)
  - `keyword`: normalized `includes()` — candidate answer contains the standard answer
- **Case sensitivity**: Configurable via `fillBlankCaseSensitive` (default: false)
- **Multiple accepted answers**: Pipe-delimited (`|`) in standardAnswer, matched against any
- **Leading/trailing spaces**: Trimmed by `normalizeBlank()`
- **Unicode normalization**: `toLocaleLowerCase()` used for case-insensitive mode
- **Numeric tolerance**: Not supported (string comparison only)
- **Empty answer**: `matchesBlank()` with empty candidate → no match → score = 0
- **Multi-blank**: Record form `{ "1": "ans1", "2": "ans2" }` — ALL blanks must match for full score

### Text response (subjective)
- **Answer representation**: `string` (arbitrary text)
- **Validation**: `SaveAnswerRequestSchema.answer` is `z.unknown()` — NO length or type validation at contract level
- **Scoring**: `makeResult(question, candidateAnswer, 0)` — always zero-score placeholder; real scoring via manual grading queue
- **Manual grading**: `gradeQuestion()` in `manualGrading.ts` — one-way `pending_manual → completed_manual`
- **Comment**: `comment` field on `AttemptGradingEntry` — grader can add feedback
- **Terminal aggregation**: `finalizeTerminalGrading` computes total from auto + manual entries

## F. Subjective-Question Boundary

### Classification: PLAIN-TEXT COMPLETE

**Evidence for classification (13-step journey verified)**:

1. **Author creates prompt**: ✅ `text_response` type in `CreateQuestionRequestSchema`; `rubric` field for grading guidance
2. **Author edits prompt**: ✅ `UpdateQuestionRequestSchema` allows content/rubric edits
3. **Exam publishes**: ✅ Snapshot captures `rubric` at publish time
4. **Candidate sees prompt**: ✅ `QuestionRenderer:62` dispatches to `TextResponseInput`
5. **Candidate enters multiline text**: ✅ `SubjectiveAnswerInput` — native `<Textarea>` with newlines preserved
6. **Answer autosaves**: ✅ Versioned save with debouncing; `waitForSaveSaved` in E2E
7. **Answer restores after refresh**: ✅ `CandidateTakeSnapshot` routes through `answerSource="draft"` for in_progress attempts
8. **Candidate submits**: ✅ `submitAndGradeAttempt` → freeze barrier → `submitted_answers` snapshot
9. **Grader sees exact answer**: ✅ `GET /admin/attempts/:attemptId/grading-details` returns frozen `candidateAnswer` from `attempt_grading_entries`
10. **Grader awards score**: ✅ `POST /admin/attempts/:attemptId/grade-question` → `pending_manual → completed_manual`
11. **Grader adds comment**: ✅ `comment` field on `AttemptGradingEntry`
12. **Result includes score**: ✅ `finalizeTerminalGrading` computes total from auto + manual entries
13. **Result/export renders consistently**: ⚠️ Result page shows total score; per-question breakdown visible in admin score detail. **NEW GAP**: `text_response` missing from `candidateResult.questionTypes` i18n — result page shows raw `"text_response"` key instead of "文本作答题"

**Not proven in browser/E2E**:
- Very long answers (no explicit max length)
- CJK text round-trip (E2E uses Chinese but not stress-tested)
- Emoji / HTML-looking input / script tags
- Rapid autosave with concurrent submits
- Post-submit editing rejection (implied by code, not browser-tested)

## G. Exam Lifecycle Matrix

| Current state | Action | Expected next state/result | UI exposure | API enforcement | Domain enforcement | DB/audit effect |
| --- | --- | --- | --- | --- | --- | --- |
| draft | publish | published | Admin button | `publishExam()` command | ≥1 question, valid schedule | QuestionSnapshot built, audit event |
| draft | edit | draft (updated) | Admin form | `updateExam()` route | draft-only edit guard | audit (implicit) |
| draft | delete | deleted | Admin button | `DELETE /exams/:id` | `ExamNotDraftError` if not draft | audit event |
| published | unpublish | draft | Admin button (only if now < openAt) | `unpublishExam()` command | stale-state reconciliation before guard | audit event |
| published | open | open | Auto or admin | `openExam()` / reconciliation | now ≥ openAt | audit event |
| published | cancel | canceled | Admin button | `cancelExam()` command | No active attempts (for open) | audit event |
| published | archive | archived | Admin button | `archiveExam()` command | Published/closed/canceled only | audit event |
| open | close | closed | Admin button | `closeExam()` command | ExamCloseNotAllowedError if unresolved attempts | audit event |
| open | extend | open (closeAt extended) | Admin dialog | `extendExam()` command | ExamExtendNotAllowedError | audit event, deadline updated |
| open | cancel | canceled | Admin button | `cancelExam()` command | ExamCancelNotAllowedError | audit event |
| closed | archive | archived | Admin button | `archiveExam()` command | Closed/canceled only | audit event |
| canceled | archive | archived | Admin button | `archiveExam()` command | Canceled only | audit event |

**Illegal transitions verified (all three defense layers)**:
- `open → draft`: No code path (state machine blocks)
- `closed → open through extend`: ExamExtendNotAllowedError (reason: NOT_OPEN) after stale-state reconciliation
- `archived → editable`: No code path
- `canceled → normal score export`: ExamCanceledResultsUnavailableError
- `submitted attempt → answer modification`: ATTEMPT_ALREADY_SUBMITTED rejection
- `draft exam → candidate start`: ExamNotOpenError

**Defense-in-depth architecture**:
1. State machine (`assertTransition`) — domain-level guard
2. Stale-state reconciliation (`executeAdminExamTransition` with `findByIdForUpdate` + `reconcileExamForMutation`) — prevents stale in-memory status bypass
3. Route-specific business guards (unresolved attempts, etc.)

## H. Snapshot and Historical Consistency

| Historical dependency | Classification | Evidence |
| --- | --- | --- |
| Question content | **IMMUTABLE SNAPSHOT** (COPY-ON-PUBLISH) | `buildQuestionSnapshot()` in `examCommands.ts:49` copies type, content, options, standardAnswer, score, gradingRule, rubric at publish time |
| Option content | **IMMUTABLE SNAPSHOT** (isCorrect stripped) | `options.map(o => ({id: o.id, content: o.content}))` — `isCorrect` deliberately excluded |
| Correct answer | **IMMUTABLE SNAPSHOT** | `standardAnswer` frozen in `QuestionSnapshot`; grading reads `submittedAnswers` + `questionSnapshot` |
| Score value | **IMMUTABLE SNAPSHOT** | `QuestionSnapshot.score` frozen; `AttemptGradingEntry.maxScore` mirrors it |
| Grading rule | **IMMUTABLE SNAPSHOT** | `QuestionSnapshot.gradingRule` frozen; multiSelectScoring/fillBlankMatchMode fixed |
| Exam configuration | **COPY-ON-PUBLISH** | `questionSnapshot` on `exams` table built at publish time |
| Rubric | **IMMUTABLE SNAPSHOT** | `QuestionSnapshot.rubric` frozen at attempt creation |
| Draft answers | **LIVE REFERENCE** (mutable during in_progress) | Mutated by `saveAnswer`; versioned with conflict detection; discarded after submit |

**Chain of custody** (no live references in grading path):
1. QuestionBank `Question` → `publishExam()` → `Exam.questionSnapshot` (COPY-ON-PUBLISH)
2. `Exam.questionSnapshot` → `startOrRestoreAttempt()` → `Attempt.questionSnapshot` (COPY-ON-START)
3. `Attempt.answers` (live draft) → `submitAttempt()` → `Attempt.submittedAnswers` (COPY-ON-SUBMIT, freeze barrier)
4. `submittedAnswers` + `QuestionSnapshot` → `materializeGradingWorkset()` → `AttemptGradingEntry` rows (COPY-ON-SUBMIT)

**Editing a question after publication**: Does not affect in-progress attempts (snapshot is separate JSONB column)
**Editing a correct answer after submission**: Not possible — grading reads from `submittedAnswers` + `questionSnapshot`, not live question
**Deleting a referenced question**: Question deletion does not check for snapshot references (snapshot uses `originalQuestionId` as plain string, not FK) — **P3 finding**
**Changing question score after attempts exist**: Does not affect existing attempts (snapshot is immutable)

## I. Concurrency and Idempotency Boundaries

| Scenario | Mechanism | Evidence | Strength |
| --- | --- | --- | --- |
| autosave vs submit | `lockEnrollmentAndAttempt()` row lock + Attempt status guard in `processSaveAnswer` | `answerProtocol.ts:104-114`: `submitted`/`grading`/`graded` → reject ATTEMPT_ALREADY_SUBMITTED | Strong — pure decision, no race window |
| autosave vs submit | EA lock (Enrollment FOR UPDATE → Attempt FOR UPDATE) | `lockSeam.ts:68-120`: row-level serialization within `executeInTransaction` | Strong — PostgreSQL row lock |
| submit vs auto-close | Deadline reconciliation (`ensureAttemptDeadlineReconciled`) before submit | `submitAndGradeAttempt` reconciles deadline first; canonical effective deadline = `min(exam.closeAt, attempt.deadlineAt)` | Strong — single authoritative expiry seam |
| double submit | Attempt status check: `in_progress` → `submitted` transition only; already `submitted` validates workset consistency and returns | `attemptCommands.ts:289-296`: idempotent no-op under row lock | Strong |
| double grade | `entry.status !== "pending_manual"` check; `completed_manual` is terminal | `manualGrading.ts:147-153`: one-way completion, no idempotency key needed | Strong |
| repeat publish-results | Idempotent: `resultsPublishedAt` set once, not updated on re-publish | `examCommands.ts:410-411`: timestamp never updated on re-publish | Strong |
| repeat archive | Exam status guard: only from `published`/`closed`/`canceled` | `archiveExam` command with `assertTransition` | Strong |
| duplicate enrollment | Unique constraint: `(organizationId, examId, candidateId)` | DB unique index `exam_enrollments_org_exam_candidate_unique` | Strong — DB-level constraint |
| answer version conflict | `baseVersion < currentVersion` → `STALE_VERSION` | `answerProtocol.ts:161-171`: optimistic concurrency | Strong |
| answer idempotency | `clientSeq` key + `answersEqual` structural equality | `answerProtocol.ts:131-153`: replay returns prior result, no write | Strong |
| deadline reconciliation | Lazy inline freeze via `submitAttempt` + canonical `isAttemptDeadlineExpired` | `deadlineReconciliation.ts:218-313`: single authoritative expiry seam, within EA-locked tx | Strong |
| enrollment start lock | `findByExamAndCandidateForUpdate` in `startOrRestoreAttempt` | `attemptCommands.ts:150`: serializes concurrent starts | Strong |

## J. Test-Quality Assessment

### STRONG TESTS
- `gradingEngine.test.ts`: Exhaustive coverage of single_choice, multiple_choice, fill_blank, text_response scoring (including edge cases: empty answer, malformed standardAnswer, partial credit modes)
- `attemptCommands.test.ts`: State machine transitions, retake policy, late entry cutoff
- `gradingWorkset.test.ts`: Materialization consistency, terminal aggregation, `pending_manual` frozen answer
- `manualGradingCompletion.test.ts` / `manualGradingHold.test.ts`: Pending manual entry lifecycle, text_response with non-null standardAnswer
- `submitAndGradeAttempt`: Freeze barrier, crash recovery, idempotent re-entry
- `permissionBoundary.test.ts` / `candidateOwnership.test.ts`: Authorization enforcement
- `examStateMachine.test.ts`: All 6 exam states + transition guards
- `saveAnswer.test.ts`: Version conflict, idempotency, deadline exceeded
- `submitFreezeBarrier.test.ts`: Concurrent save-vs-submit race (N iterations, score consistency check)
- `gradingConcurrency.test.ts`: Real Postgres FOR UPDATE serialization test
- E2E `manual-grading.spec.ts`: Full text_response → submit → pending_manual → admin grade → fully_graded
- E2E `candidate-happy-path.spec.ts`: Complete candidate journey with text_response
- `GradingDetailPage.test.tsx:495-517`: XSS-safe rendering test (explicitly tests `<script>` tag injection, verifies no DOM pollution)
- `QuestionRenderer.test.tsx:79-92`: XSS-safe rendering test for text_response input

### WEAK TESTS
- `fill-blank-e2e.spec.ts`: Skipped (Phase 3 pending) — no runtime verification of fill_blank candidate answering via browser
- No E2E test for very-long-answer text_response
- No E2E test for rapid-autosave-race-with-submit
- No E2E test for CJK/emoji content round-trip in text_response
- No E2E test for cross-candidate attempt isolation (unit test exists at `candidateOwnership.test.ts` but no browser-level proof)

### VACUOUS TESTS
- None identified. All tests that were investigated exercise real code paths with meaningful assertions.

### MISSING NEGATIVE CONTROLS
- No test verifying fill_blank answer with Unicode mixed case is correctly normalized
- No test verifying question deletion when snapshots reference the question (soft data-consistency gap)
- No test verifying admin re-grade behavior after `completed_manual` (currently one-way, no test for the rejection path)

## K. Evidence Executed

### Test Suite Run

```bash
# Command
pnpm test

# Result
Test Files:  114 passed (114)
Tests:       1265 passed | 5 skipped (1270)
Duration:    252.29s
Start:       21:50:33

# What it proves
- All unit and integration tests pass
- No regressions detected
- 5 skipped tests (Redis-related, not boundary-relevant)

# What it does NOT prove
- No browser E2E tests were executed (Agent A does not own browser E2E)
- fill_blank candidate answering path not verified at runtime
```

### Source Code Verification (Key Files Read)

```bash
# Question type inventory
packages/domain/src/enums.ts          — 5 QuestionType values (closed set)
packages/contracts/src/question.ts    — CreateQuestionRequestSchema, superRefine validation
packages/db/src/schema/pg.ts          — questions table (type: text, no DB enum)
apps/web/src/components/exam/QuestionRenderer.tsx — dispatches to 5 input components
apps/web/src/components/exam/FillBlankInput.tsx   — functional component (78 lines)
apps/web/src/components/exam/TextResponseInput.tsx — wraps SubjectiveAnswerInput

# Grading engine
packages/domain/src/gradingEngine.ts  — gradeQuestion dispatch, gradePrecise, gradeMultipleChoice, gradeFillBlank
packages/exam-engine/src/manualGrading.ts — gradeQuestion (manual), one-way completed_manual guard

# Lifecycle
packages/exam-engine/src/examStateMachine.ts — EXAM_VALID_TRANSITIONS map
packages/exam-engine/src/examCommands.ts     — publishExam, unpublishExam, openExam, closeExam, cancelExam, archiveExam, extendExam, publishResults
apps/api/src/routes/exam.ts                  — all exam route handlers with executeAdminExamTransition

# Snapshot
packages/exam-engine/src/attemptCommands.ts   — startOrRestoreAttempt (COPY-ON-START), submitAttempt (freeze barrier)
packages/exam-engine/src/answerProtocol.ts    — processSaveAnswer (versioned), buildSubmittedAnswersSnapshot
packages/exam-engine/src/gradingWorkset.ts    — computeExpectedGradingEntries (COPY-ON-SUBMIT)

# Concurrency
apps/api/src/orchestrators/submitAndGradeAttempt.ts — single-transaction submit+grade with EA lock
packages/exam-engine/src/deadlineReconciliation.ts  — ensureAttemptDeadlineReconciled, computeEffectiveDeadline
packages/db/src/schema/pg.ts                        — UNIQUE constraints on enrollments and attempts

# XSS verification
apps/web/src/pages/admin/GradingDetailPage.tsx:36-51     — formatAnswer returns string (no dangerouslySetInnerHTML)
apps/web/src/pages/admin/GradingDetailPage.test.tsx:495-517 — explicit XSS test with <script> injection
apps/web/src/components/exam/QuestionRenderer.test.tsx:79-92 — XSS test for text_response input
grep dangerouslySetInnerHTML *.tsx — only in test files (asserting absence)

# i18n gap
apps/web/src/i18n/locales/zh-CN.ts:485-490 — candidateResult.questionTypes missing text_response
apps/web/src/pages/exam/ResultPage.tsx:40-43 — formatQuestionType falls back to raw key
```

### Architecture Lint

```bash
# Command
pnpm lint:arch

# What it proves
- Dependency boundaries are respected
- No forbidden cross-package imports
```

### Code Quality

```bash
# Command
pnpm verify

# What it proves
- TypeScript strict mode passes
- Prettier formatting passes
- ESLint passes
- All tests pass
```

## L. Recommended Closure Plan

### MUST FIX BEFORE BASIC PRODUCT CLOSURE
(none — basic product closure criteria are met for the objective-question loop)

### CAN DEFER
- **F-A-P2-1**: fill_blank E2E: the `FillBlankInput` component IS wired into `TakeExamPage` via `QuestionRenderer`. The E2E skip comment ("The take page does not render a usable fill-blank/subjective input") appears outdated. Recommend promoting the E2E to run and fixing any actual runtime issues, rather than deferring to Phase 3.
- **F-A-P2-2**: Very-long-answer limits for text_response (no explicit max in contract; textarea has no maxLength)
- **F-A-P3-1**: Unicode/CJK normalization test for fill_blank keyword mode
- **F-A-P3-2**: E2E test for cross-candidate attempt isolation
- **F-A-P3-3**: Question deletion snapshot reference check
- **F-A-P3-4**: Admin re-grade policy for completed_manual entries
- **F-A-P3-5**: Candidate result per-question answer comparison visibility

### REQUIRES PRODUCT DECISION
- Should text_response answers have a maximum length?
- Should fill_blank E2E be promoted from Phase 3 to Phase 2?
- Should candidate result views show per-question answer comparison (current: total score only for objective)?
- Should admin be able to re-grade a `completed_manual` entry (currently one-way)?

### RICH-TEXT FOLLOW-UP
- Not applicable for Phase 1 — rich text is explicitly excluded

### RESOURCE-AUTHORIZATION FOLLOW-UP
- Not in scope for Agent A

## M. Findings

### P2 Findings

| ID | SEVERITY | TITLE | PRODUCT IMPACT | PRECONDITION | REPRODUCTION | EXPECTED | ACTUAL | SOURCE EVIDENCE | TEST/BROWSER EVIDENCE | CONFIDENCE | RECOMMENDED DISPOSITION |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| F-A-P2-1 | P2 | fill_blank E2E skipped — complete loop never browser-verified | Candidates cannot be proven to complete fill_blank answering → save → submit → grade → result in a real browser. The `FillBlankInput` component IS functional and wired into `TakeExamPage`, but the E2E is skipped with an outdated comment. | Exam with fill_blank question published and assigned to candidate | `pnpm test:e2e -- fill-blank` — test is skipped at line 18 | E2E runs and verifies full candidate journey | E2E skipped (`test.skip(true, "Phase 3 pending...")`); component IS wired up via `QuestionRenderer:44-53` | `apps/e2e/e2e/fill-blank-e2e.spec.ts:18`; `apps/web/src/components/exam/FillBlankInput.tsx` (functional); `apps/web/src/components/exam/QuestionRenderer.tsx:44-53` (dispatches) | No browser evidence; unit test at `gradingEngine.test.ts:80-166` covers scoring logic | SOURCE-PROVEN (component wired, E2E skipped) | Promote E2E to run; the skip comment appears outdated since FillBlankInput IS rendered |
| F-A-P2-2 | P2 | text_response has no answer length limit — potential storage/performance risk | Candidates can submit megabyte-scale text payloads that persist to JSONB columns (`attempt.answers`, `attempt_grading_entries.candidate_answer`, `attempt.submitted_answers`). No UI feedback for excessively long input. | text_response question in exam | Candidate types unlimited text → saves → submits | Contract or route should enforce max length | `SaveAnswerRequestSchema.answer: z.unknown()` — no length validation; `TextResponseInput` does not pass `maxLength` to `SubjectiveAnswerInput` | `packages/contracts/src/attempt.ts:157` (`answer: z.unknown()`); `apps/web/src/components/exam/TextResponseInput.tsx:17-32` (no maxLength) | No test for long answer behavior | SOURCE-PROVEN | Add max length to contract and/or textarea |
| F-A-P2-3 | P2 | text_response missing from candidateResult.questionTypes i18n — result page shows raw type key | When a candidate views their result for a `text_response` question, `ResultPage.formatQuestionType()` returns the raw key `"text_response"` instead of a localized label like "文本作答题". Misleading UX. | Exam with text_response question, candidate submits, result published | Candidate views result page → text_response question type shows raw key | Should show "文本作答题" (localized label) | Shows raw `"text_response"` string | `apps/web/src/i18n/locales/zh-CN.ts:485-490` (missing `text_response`); `apps/web/src/pages/exam/ResultPage.tsx:40-43` (fallback logic) | No browser test covers this specific i18n path | SOURCE-PROVEN | Add `text_response: "文本作答题"` to `candidateResult.questionTypes` |

### P3 Findings

| ID | SEVERITY | TITLE | PRODUCT IMPACT | SOURCE EVIDENCE | CONFIDENCE |
| --- | --- | --- | --- | --- | --- |
| F-A-P3-1 | P3 | fill_blank Unicode normalization untested | `normalizeBlank()` uses `toLocaleLowerCase()` which may not handle all Unicode case mappings correctly | `packages/domain/src/gradingEngine.ts:67-69` | SOURCE-PROVEN |
| F-A-P3-2 | P3 | No E2E test for cross-candidate attempt isolation | `candidateOwnership.test.ts` exists as unit test but no browser-level E2E proving Candidate A cannot see Candidate B's attempt | `apps/api/src/routes/candidateOwnership.test.ts` | TEST-PROVEN (unit only) |
| F-A-P3-3 | P3 | Question deletion does not check snapshot references | Deleting a question from the question bank does not verify if it is referenced by any exam's `questionSnapshot`; this is a soft data-consistency gap since snapshot uses `originalQuestionId` (plain string, not FK) | `packages/db/src/schema/pg.ts` questions table — no FK from examAttempts.questionSnapshot | SOURCE-PROVEN |
| F-A-P3-4 | P3 | No admin re-grade policy | Once a `text_response` entry is `completed_manual`, the grading command rejects further score changes; there is no admin override path | `packages/exam-engine/src/manualGrading.ts:147-153` | SOURCE-PROVEN |
| F-A-P3-5 | P3 | Result page does not show per-question answer comparison for candidates | Candidate sees total score + pass/fail; per-question breakdown (answer vs standard) is admin-only | `apps/web/src/pages/exam/ResultPage.tsx:202-206` | SOURCE-PROVEN |

### Downgraded from Previous Report

| Previous ID | Previous Severity | Current Status | Reason |
| --- | --- | --- | --- |
| F-A-P2-3 (old) | P2 | NOT A FINDING | XSS-safe rendering is ALREADY tested: `GradingDetailPage.test.tsx:495-517` explicitly tests `<script>` injection and verifies no DOM pollution. `QuestionRenderer.test.tsx:79-92` tests text_response XSS. No `dangerouslySetInnerHTML` usage found in production code (only in test assertions proving absence). React JSX renders `formatAnswer()` return values as text content. |

## N. Cross-Boundary Observations

```
CROSS-BOUNDARY-HANDOFF:
Suggested owner: Agent B
Reason: Authorization boundary observation — `requireOwnAttempt` preHandler + defense-in-depth candidateId check inside transaction. Agent A verified the domain-level ownership chain (user → candidate → enrollment → exam → attempt → answer → result) but did not execute browser-level cross-candidate denial tests. Agent B should verify this in the E2E workstream.
Evidence: `apps/api/src/authz/ownAttemptResolver.test.ts` (9 unit tests); `apps/api/src/routes/candidateOwnership.test.ts` (unit-level cross-candidate denial)
```

```
CROSSBOUNDARY-HANDOFF:
Suggested owner: Agent B
Reason: UI/API consistency — fill_blank component IS wired into TakeExamPage but E2E is skipped with outdated comment. Agent B should verify the actual browser rendering behavior in the UI/API consistency workstream.
Evidence: `apps/web/src/components/exam/QuestionRenderer.tsx:44-53` dispatches to FillBlankInput; `apps/web/src/components/exam/FillBlankInput.tsx` is a functional 78-line component; E2E skip at `fill-blank-e2e.spec.ts:18`
```

```
CROSS-BOUNDARY-HANDOFF:
Suggested owner: Agent B
Reason: text_response i18n gap may affect UI/API consistency assessment. Candidate result page shows raw type key for text_response questions.
Evidence: `apps/web/src/i18n/locales/zh-CN.ts:485-490` missing text_response; `apps/web/src/pages/exam/ResultPage.tsx:40-43`
```

## Machine-Readable Summary

```
RUN_ID=EXAM-BOUNDARY-A-20260718-214453-ddbc808b
AGENT_SLOT=A
P0=0
P1=0
P2=3
P3=5
PROVEN_SUPPORTED=single_choice,multiple_choice,true_false,exam_lifecycle,question_snapshot_immutable,answer_save_protocol,auto_grading,manual_grading_text_response,enrollment_attempt_pipeline,candidate_ownership,xss_safe_rendering
PARTIAL=fill_blank_e2e_skipped,text_response_no_length_limit,text_response_i18n_gap
UNSUPPORTED=rich_text,image_table_formula,queued_entry,timed_sync,deadline,untimed
DECISIONS_REQUIRED=text_response_max_length,fill_blank_e2e_promotion,candidate_result_detail_visibility,admin_regrade_policy
BASIC_PRODUCT_CLOSURE=CONDITIONAL
```
