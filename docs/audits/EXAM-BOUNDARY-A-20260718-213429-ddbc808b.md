# Exam Platform Parallel Boundary Audit — Agent A

## A. Identity

```
RUN_ID:       EXAM-BOUNDARY-A-20260718-213429-ddbc808b
AGENT_SLOT:   A
TIMESTAMP:    20260718-213429
BRANCH:       feat/exam-audit-0718
HEAD:         ddbc808b9c640584ece7690dd8aef681739081a5
SHORT_SHA:    ddbc808b
BASE/MAIN:    master
WORKTREE:     clean (no uncommitted changes)
AUDIT SCOPE:  PRODUCT / QUESTION-TYPE / EXAM-LIFECYCLE / SCORING / DATA-CONSISTENCY / SUBJECTIVE-QUESTION
```

### Repository baseline

```
REPOSITORY:       git@github.com:jnhu76/exam.git
TEST FRAMEWORK:   vitest (unit/integration), Playwright (E2E)
E2E FRAMEWORK:    Playwright 1.61.0, Chromium only
DB TEST STRATEGY: worker-database isolation (exam_test), per-test truncate with testDb.ts name-safety guard
RECENT PRS:       #190 RBAC-M10-B Single-Tenant Corrective, #189 fix/rbac-m10-a-review-corrective-1
```

---

## B. Verdict

```
SUPPORTED WITH BLOCKERS
```

The product has a well-architected core exam loop with strong snapshot isolation, concurrency control, and lifecycle enforcement. However, the `fill_blank` question type is documented as "Partially supported" — it exists fully in the domain model, grading engine, contracts, DB schema, and admin UI, but its **candidate runtime, E2E test, and full auto-grading rendering are deferred to Phase 3**. The `text_response` subjective type is the inverse: fully wired in runtime and E2E (P3-MOD complete) but admin QuestionPreview has no representation.

---

## C. Executive boundary map

### PROVEN SUPPORTED
- Question types `single_choice`, `multiple_choice`, `true_false` — full lifecycle (create, edit, publish, candidate render, auto-grade, result, export)
- `text_response` — complete P3-MOD path (create, edit, publish-validate, candidate textarea, autosave, restore, submit, manual-grading queue, score, result, export)
- Auto-grading engine for all 4 objective types
- Exam lifecycle: draft → published → open → closed → canceled → archived (with all guards)
- REPEATABLE READ transaction isolation + row-level FOR UPDATE locking
- Snapshot immutability (questionSnapshot at publish, submittedAnswers at submit)
- Grading workset materialization from frozen data only
- Answer Save Protocol (versioned, idempotent, conflict detection)
- Candidate ownership enforcement (requireExamEligibility + requireOwnAttempt)
- E2E core journey (admin-flow, candidate-happy-path, resume, submit-flush, manual-grading)

### PARTIALLY SUPPORTED
- `fill_blank` — domain model, grading engine, admin create/edit UI are complete; but **candidate runtime**, **auto-grading after submission**, and **result rendering** have no E2E coverage (test skipped: "Phase 3 pending")
- `text_response` admin QuestionPreview — no preview rendering (only objective types shown)
- Fill-blank matching modes (`exact`/`keyword`, case sensitivity, pipe-delimited alternates) — fully implemented in grading engine but untested at E2E level

### NOT SUPPORTED
- Rich-text answers (no editor library, no Markdown, no `dangerouslySetInnerHTML`)
- Image/attachment upload in candidate answers (QuestionSnapshot has attachments field but TakeExamPage hardcodes `[]`)
- `timed_sync`, `deadline`, `untimed` timing modes (only `timed_window` is active; publish validates this)
- `random` question selection (only `manual` selection; publish validates this)
- `daily_limit`, `weekly_limit` retake policies (publish validates; only `unlimited`/`max_attempts`/`pass_then_stop` active)
- `queued` → `in_progress` attempt state path (requireQueue is Phase 2 deferred)

### PRODUCT DECISION REQUIRED
- Fill-blank partial-credit policy (currently all-or-nothing: full score only when ALL blanks correct; no per-blank partial credit)
- Fill-blank Unicode normalization (no explicit product decision; grading uses `.toLocaleLowerCase()` for case-insensitive mode which is locale-dependent)
- Fill-blank multi-blank answer format (Record<string,string> vs pipe-delimited in a single string)

### BLOCKED
- `fill_blank` E2E — test skipped with "Phase 3 pending" in fill-blank-e2e.spec.ts
- Exam operations with active unresolved attempts: close/cancel require 0 unresolved attempts; no force-submit path from UI for bulk resolution

---

## D. Capability Matrix — Question Types

| Question type | Domain enum | Contracts Zod | DB schema | API routes | Admin create/edit | Publish validation | Candidate render | Autosave | Submit freeze | Auto-grade | Manual grade | Result display | Export (JSON) | Export (CSV) | E2E tested | Actual status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `single_choice` | ✅ | ✅ | ✅ (text col) | ✅ | ✅ | ✅ requires standardAnswer | ✅ RadioGroup | ✅ | ✅ → submittedAnswers | ✅ gradePrecise | ❌ auto | ✅ | ✅ planned | ✅ summary | ✅ | **SUPPORTED** |
| `multiple_choice` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ requires standardAnswer | ✅ CheckboxGroup | ✅ | ✅ | ✅ gradeMultipleChoice (partial half) | ❌ auto | ✅ | ✅ planned | ✅ summary | ✅ | **SUPPORTED** |
| `true_false` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ requires standardAnswer | ✅ RadioGroup T/F | ✅ | ✅ | ✅ gradePrecise (boolean) | ❌ auto | ✅ | ✅ planned | ✅ summary | ✅ | **SUPPORTED** |
| `fill_blank` | ✅ | ✅ | ✅ | ✅ | ✅ textarea for standardAnswer | ✅ requires standardAnswer | ✅ FillBlankInput | ✅ | ✅ | ✅ gradeFillBlank (exact/keyword) | ❌ auto | ✅ | ❌ no dedicated render | ✅ summary | ❌ | **PARTIAL** |
| `text_response` | ✅ P3-L0-1 | ✅ | ✅ | ✅ | ✅ textarea + rubric | ✅ requires rubric (standardAnswer optional) | ✅ Textarea (SubjectiveAnswerInput) | ✅ | ✅ | ❌ returns 0 placeholder | ✅ manualGrading | ✅ | ✅ | ✅ summary | ✅ manual-grading, result-publishing | **SUPPORTED** |

### Q: fill_blank — candidate runtime gap
The `FillBlankInput` component exists at `apps/web/src/components/exam/FillBlankInput.tsx` and is wired in `QuestionRenderer.tsx`. However:
- The fill-blank E2E test is skipped (`fill-blank-e2e.spec.ts` line 11-21): `test.skip(true, "Phase 3 pending")`
- The Phase Roadmap §"Phase 2 excluded" explicitly states: "fill-blank runtime / grading / result E2E" moved to Phase 3
- `seedExam()` in E2E lib supports fill_blank seed via `questions: [{ type: "fill_blank", ... }]` but it's never run

**Conclusion**: The component exists and appears functional from source inspection, but has NO verified E2E coverage. The Phase 2 baseline explicitly defers it.

---

## E. Objective-Question Semantics

### Single Choice (`gradePrecise`)
- **Answer representation**: string (option ID)
- **Validation rules**: exactly one correct option required at publish; ≥2 options in form
- **Scoring**: exact `===` match between candidate answer and `standardAnswer`
- **Partial credit**: none (all-or-nothing)
- **Zero/multiple correct answers**: contract validation rejects; publish validation rejects
- **Empty answer**: scores 0
- **Post-submit mutability**: rejected (status locked to submitted/graded)

### Multiple Choice (`gradeMultipleChoice`)
- **Answer representation**: string[] (option IDs)
- **Scoring**: set comparison (sorted unique strings)
- **Partial credit**: configurable via `multiSelectScoring`:
  - `all_correct_full`: full score only when all correct and no wrong
  - `partial_half`: half score when some correct and none wrong
- **Extra wrong option**: zero score in either mode
- **Missing correct option**: partial in `partial_half` mode, zero otherwise
- **Empty selection**: zero score
- **Option-order independence**: sort-before-compare guarantees it

### True/False (`gradePrecise`)
- **Answer representation**: boolean
- **Storage**: domain type is distinct `true_false`; grading reuses `gradePrecise` which does `===` boolean match
- **Correctness**: `standardAnswer` must be boolean (contract validation)

### Fill Blank (`gradeFillBlank` → `matchesBlank`)
- **Answer representation**: string (single blank) or `Record<string, string>` (multi-blank)
- **Match modes**:
  - `exact`: trimmed normalized equality (`===` after trim + lowercase unless caseSensitive)
  - `keyword`: `normalizedCandidate.includes(normalizedAccepted)` (substring containment)
- **Case sensitivity**: controlled by `fillBlankCaseSensitive` flag in GradingRule (default: `false` = case-insensitive)
- **Leading/trailing spaces**: trimmed via `.trim()` before comparison
- **Unicode normalization**: **No explicit Unicode normalization** (NFC/NFD). Uses `.toLocaleLowerCase()` for case-insensitive mode, which is locale-dependent. Noted as unresolved.
- **Multiple accepted answers**: pipe-delimited (`|`) — `standard.split("|").some(...)`
- **Answer order (multi-blank)**: `Object.entries(standard).every(...)` — all blanks must match; order of keys in Object.entries is implementation-defined (ES2015 string-key insertion order — fragile if order is semantically meaningful)
- **Punctuation**: no trimming of punctuation; exact mode requires exact string match
- **Numeric tolerance**: not supported; string matching only
- **Partial credit**: **None**. `correct ? question.score : 0` — all blanks must match for any points. No per-blank scoring.

### Subjective / Text Response
- **Manual-graded only**: `gradeQuestion` returns zero-score placeholder
- **Grading source**: materialized `attempt_grading_entries` with `gradingMode: "manual"` and `status: "pending_manual"`
- **Score entry**: via `POST /admin/attempts/:attemptId/grade-question` → `manualGrading.completeManualGrading()`
- **One-way**: `pending_manual → completed_manual` (no undo)
- **Finalization**: after all manual entries are `completed_manual`, `gradingStatus` transitions to `fully_graded`

---

## F. Subjective-Question Boundary Classification

```
CLASSIFICATION: PLAIN-TEXT COMPLETE
```

### Evidence of completeness:

| Requirement | Status | Evidence |
|---|---|---|
| Author creates prompt | ✅ | QuestionForm.tsx: type=text_response → rubric textarea, standardAnswer=null |
| Author edits prompt | ✅ | Same form, PATCH question route |
| Exam publishes | ✅ | publishExam validates rubric non-empty, non-placeholder |
| Candidate sees prompt | ✅ | QuestionRenderer.tsx → TextResponseInput → SubjectiveAnswerInput (textarea) |
| Candidate enters multiline text | ✅ | `<textarea>` with `min-h-48 resize-y`, no maxLength by default |
| Answer autosaves | ✅ | Answer Save Protocol; period+change-based save |
| Answer restores after refresh/relogin | ✅ | restoreAttempt path + answer loading from attempt.answers |
| Candidate submits | ✅ | submitAndGradeAttempt.ts: freeze → materialize → grade |
| Grader sees exact answer | ✅ | GradingDetailPage.tsx: frozen answer from submittedAnswers |
| Grader awards score | ✅ | POST grade-question → manualGrading.completeManualGrading |
| Grader adds comment | ✅ | manualGrading.ts: `comment` field on grading entry |
| Result includes score | ✅ | ResultPage.tsx, Scores route |
| Result/export renders consistently | ✅ | formatAnswer() used across all surfaces |

### Edge-case handling:

| Edge case | Behavior | Evidence |
|---|---|---|
| Empty answer | Stored as null in submittedAnswers; grader sees empty | AnswerProtocol.buildSubmittedAnswersSnapshot |
| Very long answer | No explicit truncation; stored in JSONB | No maxLength in input; JSONB has ~1GB limit |
| Line breaks | Preserved via `white-space: pre-wrap` in `type-long-response` recipe | GradingDetailPage, ResultPage |
| CJK text | Works as plain text; no special handling needed | Standard React rendering |
| HTML-looking input | Rendered as literal text (React escaping); NO dangerouslySetInnerHTML | GradingDetailPage.test.tsx: script/b tags render as text |
| Script tags | Safe — React escapes by default | Same XSS test suite |
| Rapid autosave | Versioned answer protocol with conflict detection | answerProtocol.ts: baseVersion check |
| Submit racing with autosave | Submit locks attempt row; concurrent saves rejected with ATTEMPT_ALREADY_SUBMITTED | save-submit-race spec |
| Post-submit editing | Rejected — status machine blocks | answerProtocol.ts: ATTEMPT_ALREADY_SUBMITTED |

### Gaps:

| Gap | Description | Severity |
|---|---|---|
| Preview gap | QuestionPreview.tsx has no text_response representation; admin sees only question content + "未设置" for standardAnswer | P3 |
| No rubric preview in admin form | Rubric textarea is visible during editing but no preview of how candidate will see the prompt | P3 |
| CSV export per-question answers | Scores CSV exports aggregate only; per-attempt JSON export includes answers but no dedicated CSV for per-question answers | P3 |

---

## G. Exam Lifecycle Matrix

### States: `draft → published → open → closed → canceled → archived`

| Current state | Action | Expected next state | UI exposure | API enforcement | Domain enforcement | DB/audit effect |
|---|---|---|---|---|---|---|
| draft | create | draft | Admin form → POST /exams | Validates courseId, questionIds | Creates draft exam | INSERT + audit: exam.create |
| draft | edit | draft | Admin form → PATCH /exams/:id | requireCapability(ExamUpdate) | Full edit allowed | UPDATE + audit: exam.update |
| draft | delete | (removed) | Admin detail → DELETE | requireCapability(ExamDelete); status=draft only | ExamNotDraftError if not draft | DELETE + audit: exam.delete |
| draft | publish | published | Admin detail → Publish button | requireCapability(ExamPublish) | assertTransition + 12 validation guards (see below) | UPDATE status + questionSnapshot + audit: exam.publish |
| published | unpublish | draft | Admin detail → Unpublish | requireCapability(ExamUnpublish); Admin only | assertTransition; must not have been auto-opened | UPDATE status + audit: exam.unpublish |
| published | open | open | Auto via reconcile (openAt reached) | reconcileExamForMutation | assertTransition | UPDATE status + audit: exam.open |
| published | cancel | canceled | Admin detail → Cancel | requireCapability(ExamCancel); Admin only | assertTransition; route checks unresolved attempts=0 | UPDATE status + audit: exam.cancel |
| published | archive | archived | Admin detail → Archive | requireCapability(ExamArchive); Admin only | assertTransition | UPDATE status + audit: exam.archive |
| open | close | closed | Admin detail → Close | requireCapability(ExamClose) | assertTransition; route checks unresolved attempts=0; idempotent for closed | UPDATE status + audit: exam.close |
| open | cancel | canceled | Admin detail → Cancel | requireCapability(ExamCancel); Admin only | assertTransition; route checks unresolved attempts=0 | UPDATE status + audit: exam.cancel |
| open | extend | open (closeAt changes) | Admin detail → Extend | requireCapability(ExamExtend); Admin only | must be open; extendMinutes>0; new closeAt≤original+extend | UPDATE closeAt + audit: exam.extend |
| closed | archive | archived | Admin detail → Archive | requireCapability(ExamArchive); Admin only | assertTransition; idempotent return | UPDATE status + audit: exam.archive |
| canceled | archive | archived | Admin detail → Archive | requireCapability(ExamArchive); Admin only | assertTransition; idempotent return | UPDATE status + audit: exam.archive |
| any published/open/closed | publish-results | (no status change; resultsPublishedAt set) | Admin detail → Publish Results | requireCapability(ExamResultPublish) | status in {published,open,closed}; idempotent | UPDATE resultsPublishedAt + audit: exam.publish_results |

### Publish validation guards (12 checks):
1. `assertTransition(draft → published)`
2. questionIds.length > 0
3. passingScore > 0
4. durationMinutes > 0
5. timingMode === "timed_window" only
6. questionSelectionMode === "manual" only
7. retakePolicy in {unlimited, max_attempts, pass_then_stop}
8. openAt < closeAt
9. totalScore === sum of question scores
10. passingScore ≤ totalScore
11. All questions belong to exam's courseId
12. Per-type standardAnswer/rubric non-empty, non-placeholder

### Unpublish safety:
- Route reconciles status first; if auto-opened → denies with ExamUnpublishNotAllowedError
- Prevents `open → draft` backdoor
- Only Admin can unpublish (Teacher cannot)

### Close/Cancel safety:
- Rejects if unresolved attempts exist (countUnresolvedByExam > 0)
- Unresolved = queued, in_progress, disrupted, submitted, grading
- 409 with activeAttemptCount in error body

### All illegal transitions verified as rejected:
```
draft→open, draft→archived, draft→canceled, published→published (duplicate publish),
open→draft, open→published, open→archived, closed→open, closed→canceled,
closed→draft, closed→published, canceled→open, canceled→canceled, archived→anything
```

---

## H. Snapshot and Historical Consistency

### Snapshot classification:

| Data | Snapshot mechanism | Classification | Evidence |
|---|---|---|---|
| Question content/type/score/options | `buildQuestionSnapshot()` at publish → stored in `exams.questionSnapshot` (JSONB) | **COPY-ON-PUBLISH** (immutable) | examCommands.ts; gradingQueue.test.ts proves live question edit doesn't leak |
| Option correctness flag | Stripped in snapshot (options carry only `{id, content}`); grading uses `standardAnswer` | **IMMUTABLE SNAPSHOT** | types.ts OptionSnapshot has no isCorrect |
| Standard answer | Copied into `QuestionSnapshot.standardAnswer` | **IMMUTABLE SNAPSHOT** | gradingQueue.test.ts:1516-1556 proves frozen standardAnswer |
| Rubric | Copied from `Question.rubric` into `QuestionSnapshot.rubric` | **IMMUTABLE SNAPSHOT** | Same gradingQueue.test.ts evidence |
| Attempt snapshot | Copied from `exam.questionSnapshot` at `startAttempt` | **COPY-ON-START** | attemptCommands.ts:209 |
| Submitted answers | Built from draft answers at submit time via `buildSubmittedAnswersSnapshot()` | **IMMUTABLE SNAPSHOT** | answerProtocol.ts:473-492; written inside lock transaction |
| Grading workset | Materialized from frozen `submittedAnswers` + `questionSnapshot` only | **IMMUTABLE SNAPSHOT** | gradingWorkset.ts: reads only frozen sources |
| Grading entry score | Written once; re-grade returns 409 | **IMMUTABLE SNAPSHOT** | manualGradingCompletion.test.ts; manual-grading E2E |
| Score strategy / passingScore | Stored on `Exam` entity; **NOT** snapshotted per-attempt | **LIVE REFERENCE** | Potential gap if exam config changes between attempts |
| Result publication mode | Stored on `Exam`; **NOT** snapshotted | **LIVE REFERENCE** | Same potential gap |

### Verified protections:
- **Edit question after publish → no leak**: gradingQueue.test.ts mutates live question row; grading-details endpoint still returns frozen values
- **Edit question after submission → no leak**: scores.test.ts mutates live question; scores endpoint returns frozen data
- **Delete referenced question**: publish creates snapshot; existing attempts unaffected (question deletion only removes from bank, not from JSONB snapshots)
- **Change question score after attempts exist**: Exam.questionSnapshot is a copy; existing attempts unaffected; NEW publishes get new snapshot

### Gaps:

| Gap | Impact | Severity |
|---|---|---|
| `Exam.scoreStrategy`/`passingScore`/`resultPublicationMode` are live references | Changing these after attempts exist affects how existing attempts' scores are SELECTED (not computed). For example, switching from `highest` to `latest` mid-exam changes which attempt is the "final" score. | **P1** |
| No `examConfigSnapshot` on ExamAttempt | The attempt does not freeze the exam-level policy it started under. If admin changes score strategy between candidate A's and B's attempts, they get different treatment. | P1 |
| Legacy fallback path in `computeGradingResult` reads from mutable `attempt.answers` | For attempts predating `submitted_answers` column, grading reads the mutable answers column instead of frozen submittedAnswers | P1 (for legacy rows only) |

---

## I. Concurrency and Idempotency Boundaries

### Concurrency model:

| Operation | Protection | Mechanism |
|---|---|---|
| Answer save | Optimistic versioning + Enrollment FOR UPDATE + Attempt FOR UPDATE | answerProtocol.ts: baseVersion check; lockSeam.ts: normalized lock order |
| Submit attempt | REPEATABLE READ tx + Attempt FOR UPDATE | submitAndGradeAttempt.ts: locked transaction |
| Grade (auto) | Same tx as submit; Enrollment FOR UPDATE | finalizeTerminalGrading reads enrollment under lock |
| Grade (manual) | No concurrency guard within grading (single-grader assumption) | manualGrading.ts: no FOR UPDATE on grading entry |
| Deadline scanner vs submit | Reproducible serialization failure (40001) + retry | deadlineScanner.ts locks Exam FOR UPDATE after Attempt |
| Heartbeat scan vs submit | Heartbeat rechecks status under lock; no-op if already submitted | heartbeat.ts:123-136 |
| Enroll duplicate | Unique constraint (organizationId, examId, candidateId) | schema.pg.ts |
| Start attempt duplicate | Unique constraint (organizationId, enrollmentId, attemptNo) | schema.pg.ts |

### Idempotency:

| Operation | Idempotent? | Mechanism |
|---|---|---|
| submitAttempt | ✅ | Status check: if already submitted/graded → verify workset consistency → return existing |
| finalizeGrading | ✅ | If status === "graded" → return false (no-op) |
| gradeAttemptIdempotent | ✅ | If status === "graded" → return stored score |
| flagMisconduct | ✅ | Re-flag overwrites previous (last-write-wins) |
| restoreAttempt | ✅ | If already in_progress → return as-is |
| publishExam | ❌ Not idempotent | draft→published only; duplicate publish on published exam → InvalidStateTransitionError |
| publishResults | ✅ | If resultsPublishedAt already set → return { alreadyPublished: true } |
| closeExam | ✅ | If already closed → return as-is (idempotent) |
| archiveExam | ✅ | If already archived → return as-is (suppress duplicate audit) |

### Gaps:

| Gap | Impact | Severity |
|---|---|---|
| Manual grading no concurrency protection | If two graders score the same entry near-simultaneously, last-write-wins with no conflict detection | P2 (low likelihood in single-grader Phase 1/3) |
| No idempotency key on HTTP level | Relying on state-machine for idempotency means: retried POST /start creates new attempt (unique constraint prevents duplicates but client gets 409 instead of original 201) | P2 |
| `executeInTransaction` doesn't retry unique_violation | Concurrent start-attempt may fail with 23505 at `REPEATABLE READ`; client must retry manually | P2 |

---

## J. Cross-Boundary Observations

### CROSS-BOUNDARY-HANDOFF-1: Proctor Dashboard 403
**Suggested owner**: Agent B
**Reason**: The `ProctorDashboardPage` calls `GET /api/admin/exams/:id/candidates/status` which is gated by `ExamEnrollmentManage`. Proctor role preset lacks this permission. The UI gate `maySeeProctor` checks `ExamRoomView` (which Proctor has), leading to a clickable button that always 403s.
**Evidence**: ExamDetailPage.tsx:455-461 shows button; proctorMonitoring.ts route handler uses `requireCapability(Permission.ExamEnrollmentManage)`; Proctor preset excludes this permission.

### CROSS-BOUNDARY-HANDOFF-2: Teacher/Proctor/Grader org-wide access
**Suggested owner**: Agent B
**Reason**: All three roles have organization-wide resource access — no `teacherId`/`proctorId`/`graderId` column exists. Scoped assignment infrastructure is unimplemented.
**Evidence**: Schema has no scoping columns; presets.ts documents "scoped assignment narrows them per resource" as future intent only.

### CROSS-BOUNDARY-HANDOFF-3: Duplicate misconduct endpoints
**Suggested owner**: Agent B
**Reason**: `POST /admin/attempts/:attemptId/misconduct` and `POST /admin/attempts/:attemptId/proctor-incident` both record misconduct flags but the UI only calls the first.
**Evidence**: Two separate route files (attempts.admin.ts vs proctorMonitoring.ts); UI calls misconduct only.

---

## K. Test-Quality Assessment

### STRONG TESTS:
- `gradingConcurrency.test.ts` — proves Enrollment FOR UPDATE prevents last-write-wins on finalScore
- `gradingWorkset.test.ts` — proves submitAttempt idempotency with exact-match, partial, extra, mode-mismatch, score-mismatch
- `scores.test.ts` — proves frozen result metadata immune to live question edits
- `gradingQueue.test.ts` — proves frozen standardAnswer/rubric survive live question mutation
- `answerProtocol.test.ts` — proves idempotent replay, stale version rejection, clientSeq dedup
- `manual-grading.spec.ts` (E2E) — complete text_response journey from candidate to graded result
- `save-submit-race.spec.ts` (E2E) — concurrent save + submit doesn't corrupt

### WEAK TESTS:
- `QuestionRenderer.test.tsx` — tests individual component rendering but not within the full TakeExamPage flow
- `QuestionForm.test.tsx` — tests form field rendering but not submit validation for text_response rubric

### VACUOUS TESTS:
- None identified as fully vacuous. All test files have specific assertions.

### MISSING NEGATIVE CONTROLS:
- No test proves that changing `Exam.scoreStrategy` after attempts exist does NOT affect already-graded attempts' finalScore selection
- No test proves that changing `Exam.passingScore` after submission does NOT retroactively change pass/fail
- No full-chain integration test: publish → start → edit question bank → submit → verify frozen snapshot

---

## L. Evidence Executed

All evidence is SOURCE-PROVEN via direct file inspection. Key files:

| Evidence | Source |
|---|---|
| QuestionType enum | packages/domain/src/enums.ts:75-83 |
| Grading engine | packages/domain/src/gradingEngine.ts (252 lines) |
| Exam state machine transitions | packages/exam-engine/src/examStateMachine.ts |
| Exam commands (publish guards) | packages/exam-engine/src/examCommands.ts:80-173 |
| Snapshot construction | packages/exam-engine/src/examCommands.ts:49-74 |
| Attempt commands (start/submit/restore) | packages/exam-engine/src/attemptCommands.ts |
| Answer Save Protocol | packages/exam-engine/src/answerProtocol.ts |
| Grading workset materialization | packages/exam-engine/src/gradingWorkset.ts |
| Manual grading | packages/exam-engine/src/manualGrading.ts |
| Frozen snapshot tests | gradingQueue.test.ts:1516-1556, scores.test.ts:1203-1253 |
| Concurrency tests | gradingConcurrency.test.ts, save-submit-race.spec.ts |
| Fill-blank E2E skip | apps/e2e/e2e/fill-blank-e2e.spec.ts:11-21 |
| Phase roadmap (fill-blank deferred) | docs/phase-roadmap.md:159,171,195-196 |
| TextResponseInput (plain textarea) | apps/web/src/components/exam/TextResponseInput.tsx |
| SubjectiveAnswerInput | apps/web/src/components/exam/SubjectiveAnswerInput.tsx |
| XSS safety tests | GradingDetailPage.test.tsx:493-517, QuestionRenderer.test.tsx:79-92 |
| No rich-text libraries | grep across all package.json files |

---

## M. Recommended Closure Plan

### MUST FIX BEFORE BASIC PRODUCT CLOSURE:
1. **Snapshot exam-level policy fields** — `scoreStrategy`, `passingScore`, `resultPublicationMode` should be frozen per-attempt to prevent retroactive policy changes (P1)
2. **Reconcile legacy `submitted_answers` fallback** — backfill script to eliminate mutable answer path (P1)
3. **fill_blank E2E enable or explicit Phase 3 documentation** — current state is ambiguous (partially implemented but no E2E proof) (P2)

### CAN DEFER:
1. fill_blank candidate runtime E2E → Phase 3 (already decided)
2. Prefill admin QuestionPreview for text_response → Phase 3 polish
3. Per-blank partial credit for fill_blank → Phase 3 enhancement
4. Unicode normalization policy for fill_blank → Phase 3 hardening

### REQUIRES PRODUCT DECISION:
1. Fill-blank partial-credit: all-or-nothing vs per-blank scoring
2. Fill-blank Unicode normalization: NFC/NFD vs as-is
3. Exam policy snapshot: whether `scoreStrategy`/`passingScore` changes should apply retroactively

### RICH-TEXT FOLLOW-UP:
- No rich-text support exists. This is correctly bounded — product clearly supports only plain text. No finding needed.

### RESOURCE-AUTHORIZATION FOLLOW-UP:
- Refer to Agent B's report for Teacher/Proctor/Grader scoping decisions.

---

## N. Final Machine-Readable Summary

```
RUN_ID=EXAM-BOUNDARY-A-20260718-213429-ddbc808b
AGENT_SLOT=A
P0=0
P1=3
P2=3
P3=2
PROVEN_SUPPORTED=single_choice,multiple_choice,true_false,text_response,exam_lifecycle,answer_save_protocol,snapshot_immutability,concurrency_control,candidate_authorization
PARTIAL=fill_blank,text_response_preview
UNSUPPORTED=rich_text,image_attachments,non_timed_window_modes,random_selection,daily_weekly_retake,queued_state
DECISIONS_REQUIRED=fill_blank_partial_credit,fill_blank_unicode,exam_policy_snapshot
BASIC_PRODUCT_CLOSURE=CONDITIONAL
```

Conditional on:
1. Snapshot exam-level policy fields (`scoreStrategy`, `passingScore`, `resultPublicationMode`) per-attempt
2. Eliminate legacy mutable-answer grading path
3. Either enable fill_blank E2E or document explicit Phase 3 boundary for fill_blank candidate runtime
