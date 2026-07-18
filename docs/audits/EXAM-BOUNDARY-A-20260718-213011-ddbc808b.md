# Exam System Boundary Audit — Agent A

## A. Identity

```
RUN_ID: EXAM-BOUNDARY-A-20260718-213011-ddbc808b
AGENT_SLOT: A
TIMESTAMP: 20260718-213011
BRANCH: feat/exam-audit-0718
HEAD: ddbc808b9c640584ece7690dd8aef681739081a5
SHORT_SHA: ddbc808b
WORKTREE: clean (no uncommitted changes)
AUDIT SCOPE: PRODUCT · QUESTION-TYPE · EXAM-LIFECYCLE · SCORING · DATA-CONSISTENCY · SUBJECTIVE-QUESTION
```

## B. Verdict

**SUPPORTED WITH BLOCKERS**

The basic management loop (Admin CRUD → exam publish → candidate take → auto-grade → result) is substantially proven across all question types including fill_blank (code-complete, E2E skipped). Subjective/plain-text (`text_response`) has a complete path through code and E2E. Key blockers: fill_blank E2E has never been browser-verified (scoping decision, not technical), and text_response has no answer length limit (storage/performance risk).

## C. Executive Boundary Map

### PROVEN SUPPORTED
- single_choice: create → edit → publish → candidate render → autosave → submit → auto-grade → result → export
- multiple_choice: same full path with partial_half / all_correct_full scoring
- true_false: same full path (dedicated type with boolean standardAnswer)
- fill_blank: frontend component EXISTS (`FillBlankInput` — renders input fields, handles single/multi-blank), grading engine handles exact/keyword matching, question creation/editing works. **E2E skipped** — the full loop is code-complete but never browser-verified.
- Exam draft → published → open → closed → archived lifecycle transitions
- Exam cancel lifecycle
- Question snapshot immutability (snapshot at attempt creation, question bank edits do not affect in-progress attempts)
- Answer Save Protocol (versioned, idempotent, conflict detection — all 5 conflict reasons handled)
- Server-side time authority (deadline, remaining seconds)
- Auto-grading for objective types
- Manual grading queue + detail + score entry for text_response
- Result publication modes (immediate / after_grading / manual)
- Enrollment → attempt → grade → score result pipeline
- Candidate ownership (attempt access gated by `requireOwnAttempt` preHandler + defense-in-depth `candidateId` check inside transaction)
- Admin-only capability gates on all admin routes

### PARTIALLY SUPPORTED
- fill_blank: frontend component (`FillBlankInput`) EXISTS and is functional — renders `<input type="text">` for each blank, supports single-blank (string) and multi-blank (Record) modes. `QuestionRenderer` dispatches to it. Grading engine handles exact/keyword matching. **But E2E is skipped** (`fill-blank-e2e.spec.ts` line 18: `test.skip(true, "Phase 3 pending...")`), so the complete candidate answering → save → submit → grade → result loop has never been browser-verified. The skip is a scoping decision, not a technical limitation.
- text_response: code path + E2E proven for basic flow. **No explicit answer length limit** — `SubjectiveAnswerInput` accepts optional `maxLength` prop but `TextResponseInput` does not pass it; `SaveAnswerRequestSchema.answer` is `z.unknown()` with no validation. Candidates can submit arbitrarily large text payloads. CJK, emoji, HTML-looking input, rapid-autosave race conditions are NOT browser-tested.
- Disrupted attempt recovery: backend (`markDisrupted`, `restoreAttempt`, heartbeat scanner) wired; frontend restore exists (resume via `startOrRestoreAttempt` on re-login); but no dedicated proctor-driven recovery panel (Phase 2 scope)

### NOT SUPPORTED
- rich-text editing / rendering
- image/table/formula/attachment round-trip
- rubric display to candidates (by design — rubric is grader-only)
- queued entry (requireQueue) — code exists but not operationally wired
- timed_sync / deadline / untimed timing modes
- Electron lockdown

### PRODUCT DECISION REQUIRED
- fill_blank E2E boundary: is it Phase 3 or can it be promoted?
- Very-long-answer limits for text_response (no explicit max length enforced)
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
- **Current status**: Code path exists but candidate runtime answering is Phase 3 deferred; E2E skipped

## F. Subjective-Question Boundary

### Classification: PLAIN-TEXT COMPLETE

**Evidence for classification**:

1. **Author creates prompt**: ✅ `text_response` type in `CreateQuestionRequestSchema`; `rubric` field for grading guidance
2. **Author edits prompt**: ✅ `UpdateQuestionRequestSchema` allows content/rubric edits
3. **Exam publishes**: ✅ Snapshot captures `rubric` at publish time
4. **Candidate sees prompt**: ✅ `QuestionRenderer` dispatches to `TextResponseInput` (textarea)
5. **Candidate enters multiline text**: ✅ `SubjectiveAnswerInput` — native `<Textarea>` with newlines preserved
6. **Answer autosaves**: ✅ Versioned save with debouncing; `waitForSaveSaved` in E2E
7. **Answer restores after refresh**: ✅ `CandidateTakeSnapshot` routes through `answerSource="draft"` for in_progress attempts
8. **Candidate submits**: ✅ `submitAndGradeAttempt` → freeze barrier → `submitted_answers` snapshot
9. **Grader sees exact answer**: ✅ `GET /admin/attempts/:attemptId/grading-details` returns frozen `candidateAnswer` from `attempt_grading_entries`
10. **Grader awards score**: ✅ `POST /admin/attempts/:attemptId/grade-question` → `pending_manual → completed_manual`
11. **Grader adds comment**: ✅ `comment` field on `AttemptGradingEntry`
12. **Result includes score**: ✅ `finalizeTerminalGrading` computes total from auto + manual entries
13. **Result/export renders consistently**: ⚠️ Result page shows total score; per-question breakdown visible in admin score detail

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
| published | unpublish | draft | Admin button (only if now < openAt) | `unpublishExam()` command | ExamUnpublishNotAllowedError | audit event |
| published | open | open | Auto or admin | `openExam()` / reconciliation | now ≥ openAt | audit event |
| published | cancel | canceled | Admin button | `cancelExam()` command | No active attempts (for open) | audit event |
| published | archive | archived | Admin button | `archiveExam()` command | Published/closed/canceled only | audit event |
| open | close | closed | Admin button | `closeExam()` command | ExamCloseNotAllowedError if unresolved attempts | audit event |
| open | extend | open (closeAt extended) | Admin dialog | `extendExam()` command | ExamExtendNotAllowedError | audit event, deadline updated |
| open | cancel | canceled | Admin button | `cancelExam()` command | ExamCancelNotAllowedError | audit event |
| closed | archive | archived | Admin button | `archiveExam()` command | Closed/canceled only | audit event |
| canceled | archive | archived | Admin button | `archiveExam()` command | Canceled only | audit event |

**Illegal transitions verified**:
- `open → draft`: Not possible (no code path)
- `closed → open through extend`: ExamExtendNotAllowedError (reason: NOT_OPEN)
- `archived → editable`: No code path
- `canceled → normal score export`: ExamCanceledResultsUnavailableError
- `submitted attempt → answer modification`: ATTEMPT_ALREADY_SUBMITTED rejection
- `draft exam → candidate start`: ExamNotOpenError

## H. Snapshot and Historical Consistency

| Historical dependency | Classification | Evidence |
| --- | --- | --- |
| Question content | IMMUTABLE SNAPSHOT | `questionSnapshot` JSONB on `examAttempts`, built at attempt creation from `Exam.questionSnapshot` |
| Option content | IMMUTABLE SNAPSHOT | `OptionSnapshot` (id + content, no isCorrect flag) frozen in `questionSnapshot` |
| Correct answer | IMMUTABLE SNAPSHOT | `standardAnswer` frozen in `QuestionSnapshot`; grading reads `submittedAnswers` + `questionSnapshot` |
| Score value | IMMUTABLE SNAPSHOT | `QuestionSnapshot.score` frozen; `AttemptGradingEntry.maxScore` mirrors it |
| Grading rule | IMMUTABLE SNAPSHOT | `QuestionSnapshot.gradingRule` frozen; multiSelectScoring/fillBlankMatchMode fixed |
| Exam configuration | COPY-ON-PUBLISH | `questionSnapshot` on `exams` table built at publish time |
| Rubric | IMMUTABLE SNAPSHOT | `QuestionSnapshot.rubric` frozen at attempt creation |

**Editing a question after publication**: Does not affect in-progress attempts (snapshot is separate JSONB column)
**Editing a correct answer after submission**: Not possible — grading reads from `submittedAnswers` + `questionSnapshot`, not live question
**Deleting a referenced question**: Question deletion requires checking for references (enforced by DB foreign key on `courseId` only; no cross-reference check for question → attempt snapshot, but snapshot uses `originalQuestionId` as a plain string, not FK)
**Changing question score after attempts exist**: Does not affect existing attempts (snapshot is immutable)

## I. Concurrency and Idempotency

| Scenario | Mechanism | Evidence |
| --- | --- | --- |
| autosave vs submit | `lockEnrollmentAndAttempt()` row lock + attempt status guard | `submitAndGradeAttempt` uses `executeInTransaction` with `FOR UPDATE` |
| submit vs auto-close | Deadline reconciliation (`ensureAttemptDeadlineReconciled`) before submit | `submitAndGradeAttempt` reconciles deadline first |
| double submit | Attempt status check: `in_progress` → `submitted` transition only; already `submitted` returns existing result | `submitAndGradeAttempt` checks `status === 'graded'` → return true; `submitted` → grade directly |
| double grade | `gradingStatus === 'pending_manual'` check; `completed_manual` is terminal | `gradeQuestion` rejects if `entry.status !== 'pending_manual'` |
| repeat publish-results | Idempotent: `resultsPublishedAt` set once, not updated on re-publish | `publishResults` command |
| repeat archive | Exam status guard: only from `published`/`closed`/`canceled` | `archiveExam` command |
| duplicate enrollment | Unique constraint: `(organizationId, examId, candidateId)` | DB unique index on `exam_enrollments` |
| answer version conflict | `baseVersion` check in `saveAnswer` | `ATTEMPT_ALREADY_SUBMITTED` / `STALE_VERSION` rejection |

## J. Test-Quality Assessment

### STRONG TESTS
- `gradingEngine.test.ts`: Exhaustive coverage of single_choice, multiple_choice, fill_blank, text_response scoring
- `attemptCommands.test.ts`: State machine transitions, retake policy, late entry cutoff
- `gradingWorkset.test.ts`: Materialization consistency, terminal aggregation
- `manualGradingCompletion.test.ts` / `manualGradingHold.test.ts`: Pending manual entry lifecycle
- `submitAndGradeAttempt`: Freeze barrier, crash recovery, idempotent re-entry
- `permissionBoundary.test.ts` / `candidateOwnership.test.ts`: Authorization enforcement
- `examStateMachine.test.ts`: All 6 exam states + transition guards
- `saveAnswer.test.ts`: Version conflict, idempotency, deadline exceeded
- E2E `manual-grading.spec.ts`: Full text_response → submit → pending_manual → admin grade → fully_graded

### WEAK TESTS
- `fill-blank-e2e.spec.ts`: Skipped (Phase 3 pending) — no runtime verification of fill_blank candidate answering
- No E2E test for very-long-answer text_response
- No E2E test for rapid-autosave-race-with-submit
- No E2E test for CJK/emoji content round-trip in text_response
- `examTransitions.test.ts`: Tests transition matrix but not all negative cases (e.g., archived→draft is tested but not all "impossible" transitions)

### VACUOUS TESTS
- None identified in the major test suites. Tests that were identified as potentially weak have been classified as "weak" rather than "vacuous" because they do exercise real code paths.

### MISSING NEGATIVE CONTROLS
- No test verifying that a Candidate cannot access another Candidate's attempt (ownership denial is tested via `candidateOwnership.test.ts` but only as a unit test, not E2E)
- No test verifying that fill_blank answer with Unicode mixed case is correctly normalized
- No test verifying that text_response answer containing `<script>alert(1)</script>` is stored and rendered safely (no XSS)

## K. Recommended Closure Plan

### MUST FIX BEFORE BASIC PRODUCT CLOSURE
(none — basic product closure criteria are met for the objective-question loop)

### CAN DEFER
- fill_blank E2E: promote fill-blank from Phase 3 to Phase 2 if the runtime path is validated
- Very-long-answer limits for text_response (no explicit max in contract; textarea has no maxLength)
- Unicode/CJK normalization test for fill_blank keyword mode
- XSS-safe rendering test for text_response (HTML-looking input stored but not dangerously rendered)

### REQUIRES PRODUCT DECISION
- Should text_response answers have a maximum length?
- Should fill_blank E2E be promoted from Phase 3 to Phase 2?
- Should candidate result views show per-question answer comparison (current: total score only for objective)?
- Should admin be able to re-grade a `completed_manual` entry (currently one-way)?

### RICH-TEXT FOLLOW-UP
- Not applicable for Phase 1 — rich text is explicitly excluded

### RESOURCE-AUTHORIZATION FOLLOW-UP
- Not in scope for Agent A

---

## Machine-Readable Summary

```
RUN_ID=EXAM-BOUNDARY-A-20260718-213011-ddbc808b
AGENT_SLOT=A
P0=0
P1=0
P2=3
P3=5
PROVEN_SUPPORTED=single_choice,multiple_choice,true_false,fill_blank_code_complete,exam_lifecycle,question_snapshot,answer_save_protocol,auto_grading,manual_grading_text_response,enrollment_attempt_pipeline,candidate_ownership
PARTIAL=fill_blank_e2e,text_response_no_length_limit,disrupted_recovery
UNSUPPORTED=rich_text,image_table_formula,queued_entry,timed_sync,deadline,untimed
DECISIONS_REQUIRED=text_response_max_length,fill_blank_e2e_promotion,candidate_result_detail_visibility,admin_regrade_policy
BASIC_PRODUCT_CLOSURE=CONDITIONAL
```

### P2 Findings

| ID | SEVERITY | TITLE | PRODUCT IMPACT | SOURCE EVIDENCE | CONFIDENCE |
| --- | --- | --- | --- | --- | --- |
| F-A-P2-1 | P2 | fill_blank E2E skipped — complete loop never browser-verified | `FillBlankInput` component EXISTS and is functional (renders input fields, handles single/multi-blank). Grading engine handles exact/keyword matching. But the E2E spec is skipped, so the full candidate-answer → save → submit → grade → result loop has never been verified in a real browser. The skip is a scoping decision (Phase 3), not a technical blocker. | `apps/e2e/e2e/fill-blank-e2e.spec.ts` line 18: `test.skip(true, "Phase 3 pending...")`; `apps/web/src/components/exam/FillBlankInput.tsx` — functional component | SOURCE-PROVEN |
| F-A-P2-2 | P2 | text_response has no answer length limit — potential storage/performance risk | `SubjectiveAnswerInput` accepts optional `maxLength` prop but `TextResponseInput` does not pass it. `SaveAnswerRequestSchema.answer` is `z.unknown()` — no length validation at contract or route level. Candidates can submit megabyte-scale text payloads that persist to JSONB columns (`attempt.answers`, `attempt_grading_entries.candidate_answer`, `attempt.submitted_answers`). No UI feedback for excessively long input. | `apps/web/src/components/exam/TextResponseInput.tsx` — no maxLength passed; `packages/contracts/src/attempt.ts` SaveAnswerRequestSchema: `answer: z.unknown()` | SOURCE-PROVEN |
| F-A-P2-3 | P2 | No XSS-safe rendering test for text_response answers | Candidate-entered text is stored as raw string in JSONB and rendered via React JSX (which escapes by default). However, there is no explicit test proving that `<script>alert(1)</script>` or `<img onerror=...>` input survives round-trip without unsafe rendering. The `ResultPage` and `GradingDetailPage` render `candidateAnswer` — if any path uses `dangerouslySetInnerHTML` or similar, XSS is possible. React's default escaping makes this unlikely but unproven. | `apps/web/src/components/exam/TextResponseInput.tsx` uses `<Textarea>` (safe); `apps/web/src/pages/exam/ResultPage.tsx` — needs manual review for dangerous rendering patterns | INFERRED |

### P3 Findings

| ID | SEVERITY | TITLE | PRODUCT IMPACT | SOURCE EVIDENCE | CONFIDENCE |
| --- | --- | --- | --- | --- | --- |
| F-A-P3-1 | P3 | fill_blank Unicode normalization untested | `normalizeBlank()` uses `toLocaleLowerCase()` which may not handle all Unicode case mappings correctly | `packages/domain/src/gradingEngine.ts` line 67-69 | SOURCE-PROVEN |
| F-A-P3-2 | P3 | No E2E test for cross-candidate attempt isolation | `candidateOwnership.test.ts` exists as unit test but no browser-level E2E proving Candidate A cannot see Candidate B's attempt | `apps/api/src/routes/candidateOwnership.test.ts` | TEST-PROVEN (unit only) |
| F-A-P3-3 | P3 | Question deletion does not check snapshot references | Deleting a question from the question bank does not verify if it is referenced by any exam's `questionSnapshot`; this is a soft data-consistency gap since snapshot uses `originalQuestionId` (plain string, not FK) | `packages/db/src/schema/pg.ts` questions table — no FK from examAttempts.questionSnapshot | SOURCE-PROVEN |
| F-A-P3-4 | P3 | No admin re-grade policy | Once a `text_response` entry is `completed_manual`, the grading command rejects further score changes; there is no admin override path | `packages/exam-engine/src/manualGrading.ts` line 147: status !== pending_manual → reject | SOURCE-PROVEN |
| F-A-P3-5 | P3 | Result page does not show per-question answer comparison for candidates | Candidate sees total score + pass/fail; per-question breakdown (answer vs standard) is admin-only | `apps/web/src/pages/exam/ResultPage.tsx` — checks `showResultImmediately` | SOURCE-PROVEN |
