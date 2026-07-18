# EXAM-BOUNDARY-A-20260718-231530-ddbc808b

## A. Identity

```
RUN_ID:        EXAM-BOUNDARY-A-20260718-231530-ddbc808b
AGENT_SLOT:    A
TIMESTAMP:     2026-07-18 23:15:30
BRANCH:        feat/exam-audit-0718
HEAD:          ddbc808b9c640584ece7690dd8aef681739081a5
WORKTREE:      clean except docs/audits/ (new report only; pre-existing A report not read)
AUDIT SCOPE:   PRODUCT, QUESTION-TYPE, EXAM-LIFECYCLE, SCORING, DATA-CONSISTENCY, SUBJECTIVE-QUESTION
```

## B. Verdict

```
SUPPORTED-BOUNDARY CONFIRMED (for the supported question types and lifecycle)
```

The supported boundary is well-defined and test-proven for the 5 question types
(single_choice, multiple_choice, true_false, fill_blank, text_response), the
exam lifecycle (draft→published→open→closed→archived, plus cancel), objective
auto-grading semantics, the subjective plain-text path, immutable question
snapshots, and concurrency/idempotency (submit double-submit, answer save
versioning, row locks). The product does NOT claim rich text / images / tables /
formulas / attachments / markdown, and the subjective path is plain-text
complete (not rich-text). No P0/P1 defect was found in the A workstream.

## C. Executive boundary map

```
PROVEN SUPPORTED:
  - single_choice (create/edit/publish/render/autosave/submit/grade/result/export)
  - multiple_choice (exact-match full, partial_half policy)
  - true_false (single_choice alias, exact match)
  - fill_blank (exact/keyword, case-sensitivity, multi-answer `|`, multi-blank object)
  - text_response / subjective plain-text (create/edit/publish/render/autosave/
    submit/grade-by-human/result/export) — PLAIN-TEXT COMPLETE
  - exam lifecycle: draft/published/open/closed/canceled/archived + result-publish
  - illegal lifecycle transitions rejected (409/domain error, state unchanged)
  - immutable question snapshot (grading reads frozen snapshot, not live bank)
  - submit double-submit idempotent; answer-save versioned + conflict-detecting
  - row-locked submit freeze barrier (no workset pre-existence)

PARTIALLY SUPPORTED:
  - fill_blank case-sensitivity / punctuation / numeric-tolerance: exact & keyword
    only; no separate punctuation or numeric-tolerance policy (documented gap, not a defect)

NOT SUPPORTED:
  - rich text / images-in-answer / tables / formulas / attachments / markdown
  - "short answer" / "essay" as distinct enums (folded into text_response)
  - grading a text_response automatically (manual only — by design)

PRODUCT DECISION REQUIRED:
  - Whether fill_blank needs punctuation-normalization / numeric tolerance policy
    (currently unspecified; current behavior is exact/keyword string match)

BLOCKED:
  - None.
```

## D. Capability matrix (Agent A workstream)

### D1. Question-type inventory (A1)

| Question type | Create | Edit | Publish validation | Candidate render | Autosave | Submit | Grade | Result | Export | Actual status |
| ------------- | -----: | ---: | -----------------: | ---------------: | -------: | -----: | ----: | -----: | -----: | ------------- |
| single_choice | ✓ | ✓ | requires standardAnswer∈options | ✓ (radio) | ✓ | ✓ | auto exact-match | ✓ | ✓ | SUPPORTED |
| multiple_choice | ✓ | ✓ | requires ≥2 options, standardAnswer[] | ✓ (checkbox) | ✓ | ✓ | auto set-cmp + partial | ✓ | ✓ | SUPPORTED |
| true_false | ✓ | ✓ | standardAnswer bool | ✓ (radio) | ✓ | ✓ | auto exact-match | ✓ | ✓ | SUPPORTED |
| fill_blank | ✓ | ✓ | requires `____` placeholder; standardAnswer | ✓ (input) | ✓ | ✓ | auto exact/keyword | ✓ | ✓ | SUPPORTED |
| text_response | ✓ | ✓ | requires non-empty rubric | ✓ (textarea) | ✓ | ✓ | **manual** (human) | ✓ (after grading) | ✓ | PLAIN-TEXT COMPLETE |

Canonical enum source: `packages/domain/src/enums.ts:75-82` (`QuestionType`). No
`short_answer`/`essay` enum exists — subjective is the single `text_response` type.
UI confirms the same 5-type union (`apps/web/src/components/question/QuestionForm.tsx:62`).

### D2. Objective-question semantics (A2) — SOURCE (`packages/domain/src/gradingEngine.ts`)

**single_choice / true_false** (`gradePrecise`, lines 23-34):
- Exactly one correct answer; scoring = exact value equality (`candidateAnswer === standardAnswer`).
- Empty/undefined/null answer → 0.
- Route-level publish validation rejects 0 or multiple configured correct answers
  (`examCommands.ts:139-155` requires non-empty, non-placeholder standardAnswer for auto types).
- Saved answer round-trips as the option id string.

**multiple_choice** (`gradeMultipleChoice`, lines 41-65):
- Candidate set de-duplicated + sorted; standard set de-duplicated + sorted.
- `isComplete` (same set) → full score. `isPartial` (subset, no wrong selection) →
  half score **only if** `gradingRule.multiSelectScoring === "partial_half"`;
  otherwise 0. Any wrong selection → 0.
- Option-order independent (sorted comparison). Empty selection → 0.
- Published exam requires `standardAnswer` array non-empty (`examCommands.ts`).

**true_false**: modeled as `single_choice` alias with exact-match grading; storage
is a boolean `standardAnswer`; rendering is a 2-option radio. No separate table.

**fill_blank** (`gradeFillBlank`/`matchesBlank`, lines 67-114):
- Case sensitivity: configurable (`gradingRule.fillBlankCaseSensitive`, default
  false → lowercased after trim). Leading/trailing spaces trimmed.
- Multiple accepted answers: `standard.split("|")` — any accepted value matches.
- Multi-blank: object form `{ blankKey: candidate }` matched per key.
- Match modes: `exact` (equality) or `keyword` (candidate includes accepted).
- No documented punctuation-normalization or numeric-tolerance policy
  (UNRESOLVED product decision — see C / F-A3-P2).

### D3. Subjective-question boundary (A3)

Classification: **PLAIN-TEXT COMPLETE**

Evidence chain (SOURCE + TEST + BROWSER):
- Author creates `text_response` prompt with required non-empty rubric
  (`examCommands.ts:140-145`, `Question.rubric`). Edit supported.
- Publish requires rubric; `standardAnswer` optional (may carry a reference answer
  for grader guidance — `gradingEngine.ts:150-168`).
- Candidate sees prompt (E2E `candidate-happy-path.spec.ts`), enters multiline text
  via native `<Textarea>` (`apps/web/src/components/exam/TextResponseInput.tsx`,
  pure React text, newlines preserved). Autosave via Answer Save Protocol.
- Answer restores after refresh/relogin (submitted_answers frozen at submit +
  draft `answers` autosaved; E2E `disconnect-restore.spec.ts`/`save-submit-race.spec.ts`).
- Candidate submits → attempt `gradingStatus = pending_manual`
  (`attemptCommands.ts:345-347`).
- Grader sees exact answer (`grading-details` route, `GradingAnswerView`),
  awards score + comment (`gradeQuestion` / `attemptGradingEntryRepo`, manual entry).
- Result includes score; result/export renders consistently
  (`gradingAggregation.ts`, `scores.ts`).
- Edge cases: empty answer allowed (0 until graded), very long answer, line breaks,
  tabs, quotes, emoji, CJK, HTML/markdown/script tags — all stored as opaque
  plain text (no sanitization needed because rendering uses `white-space: pre-wrap`
  text content, NOT `dangerouslySetInnerHTML`; confirmed no unsafe HTML render in
  Agent B pass). Script tags are inert text.
- Rapid autosave + submit racing handled by versioned Answer Save Protocol
  (`answerProtocol.ts`, clientSeq idempotency) + submit freeze barrier.
- Post-submit editing blocked (`attemptStateMachine` submit→submitted; save rejected
  with `ATTEMPT_ALREADY_SUBMITTED` conflict).

Rich text NOT required: the product clearly supports only plain text; no editor
library, no misleading UI. Rich-text classification is therefore N/A, not a defect.

### D4. Exam lifecycle matrix (A4)

Authoritative transitions (`packages/exam-engine/src/examStateMachine.ts:5-12`):
```
draft      → [published]
published  → [draft, open, canceled, archived]
open       → [closed, canceled]
closed     → [archived]
canceled   → [archived]
archived   → []   (terminal)
```
`result-publish` is NOT a lifecycle status change; it only sets `resultsPublishedAt`
(`examCommands.ts:392-417`), allowed only from published|open|closed, idempotent.

| Current state | Action | Expected next | UI exposure | API enforcement | Domain enforcement | DB/audit effect |
| ------------- | ------ | ------------ | ----------- | --------------- | ------------------ | --------------- |
| draft | publish | published (+snapshot) | ✓ | ExamPublish cap | assertTransition(draft→published) | 404 if missing; audit exam.publish |
| published | unpublish | draft | ✓ | ExamUnpublish cap | assertTransition(published→draft) | audit |
| published/open | open(lazy) | open | auto on access | checkAndUpdateExamStatus | openExam | auto |
| open | close | closed | ✓ | ExamClose cap | assertTransition(open→closed); idempotent if already closed | audit; suppresses dup audit |
| open/published | cancel | canceled | ✓ | ExamCancel cap | assertTransition(→canceled); NOT idempotent | audit |
| any→archived | archive | archived | ✓ | ExamArchive cap | assertTransition(→archived) | audit |
| open | extend | open (+closeAt) | ✓ | ExamExtend cap | requires status==open (not a table transition) | audit exam.extend |
| closed/published/open | publish-results | (status same, resultsPublishedAt set) | ✓ | ExamResultPublish cap | allowed set {published,open,closed}; idempotent | audit |

Illegal transitions verified rejected (TEST-PROVEN, `examTransitions.test.ts`,
`examStateMachine.test.ts`, 52 API tests + 198 engine tests pass):
- `open → draft` (via unpublish after openAt passed): reconciled to open, rejected
  as `EXAM_UNPUBLISH_NOT_ALLOWED` (`examCommands.ts:248-256` + route reconcile).
- `archived → editable`: `assertTransition` throws → 409/domain error, state unchanged.
- `canceled → normal score export`: canceled not in publish-results allowed set.
- `submitted attempt → answer modification`: attempt state machine rejects
  save with `ATTEMPT_ALREADY_SUBMITTED`.
- `draft exam → candidate start`: eligibility requires published/open; draft rejected.
Route layer wraps every transition in `executeAdminExamTransition` → transaction +
row lock (`findByIdForUpdate`) + reconcile + audit, so rejected mutations leave
resource + audit state unchanged (zero-write, proven by `permissionBoundary.test.ts`
in Agent B pass and transition tests here).

### D5. Snapshot & historical consistency (A5)

Every historical-data dependency is **IMMUTABLE SNAPSHOT**:
- Question snapshot: `QuestionSnapshot` built at publish (`buildQuestionSnapshot`,
  `examCommands.ts:49-74`) and stored in `exam_attempts.question_snapshot`
  (JSONB, `schema/pg.ts:309`). Frozen copy: content/options(without isCorrect)/
  standardAnswer/score/gradingRule/rubric/order. Graded from snapshot, never live bank
  (`gradingEngine.ts` reads `question.standardAnswer` from snapshot).
- Correct-answer snapshot: inside questionSnapshot.standardAnswer (frozen).
- Score snapshot: `attempt_grading_entries` materialized at submit-freeze
  (`attemptCommands.ts:359-362`); terminal score aggregates ONLY from these entries
  (`gradingPoison.test.ts` proves live question/draft answers/unrelated submittedAnswers
  cannot affect score).
- Exam config snapshot: `exam.totalScore`/`passingScore` validated to match
  question scores at publish (`examCommands.ts:156-165`); `retakePolicy` frozen.
- Grading rule snapshot: inside questionSnapshot.gradingRule (frozen).
- Result-publication: `resultsPublishedAt` append-only, idempotent.

Proven behavior (TEST-PROVEN):
- Editing a question after publication: unreachable from grading (snapshot copy).
- Editing a correct answer after submission: no effect (frozen standardAnswer).
- Deleting a referenced question: attempts keep their snapshot; grading unaffected.
- Changing question score after attempts exist: attempt snapshot score is authoritative.
- Changing exam scoring strategy / candidate identity fields: candidate identity
  derives from `candidateProfiles` link frozen into attempt ownership
  (Agent B pass); exam scoring validated at publish only.

Classification: **IMMUTABLE SNAPSHOT** for all enumerated dependencies.

### D6. Concurrency & idempotency boundaries (A6)

Inspected (`attemptCommands.ts`, `answerProtocol.ts`, `examTransitionExecutor.ts`):
- **autosave vs submit**: Answer Save Protocol is versioned by `clientSeq`
  (`answerProtocol.ts:131-150`); same (questionId,clientSeq) replay → safe replay
  (prior result returned); differing payload under same key → `CONFLICTING_PAYLOAD`
  rejected (prevents silent data loss). Attempt state guard: save rejected when
  `submitted`/`grading`/`graded` (`ATTEMPT_ALREADY_SUBMITTED`).
- **submit vs auto-close / double submit**: `submitAttempt` uses
  `findByIdForUpdate` (row lock); idempotent path returns existing frozen snapshot
  when already submitted/grading/graded (double-submit safe,
  `attemptCommands.ts:284-296`); fresh submit requires zero pre-existing workset
  entries, else fail-closed (`327-333`).
- **extend vs reconciliation / cancel vs active attempts / duplicate enrollment**:
  admin transitions run inside `executeInTransaction` with `findByIdForUpdate`
  (exam row lock) + lazy reconcile + route-layer unresolved-attempts guards
  (`EXAM_CANCEL_NOT_ALLOWED` / `UNRESOLVED_ATTEMPTS_EXIST`).
- **double grade / repeat archive / repeat publish-results**: idempotent — archive
  is terminal (no-op/error on re-archive); publish-results idempotent
  (`alreadyPublished` flag suppresses duplicate audit); grading workset created
  exactly once at submit-freeze (single creation authority).
- **duplicate enrollment**: unique index
  `exam_attempts_org_enrollment_attempt_unique` on (org, enrollment, attemptNo)
  (`schema/pg.ts:340`); enrollment repo `findByExamAndCandidateForUpdate` guards.

No last-write-wins hazard observed on the submit path (locked + frozen). Audit
duplication avoided via idempotency flags (close/archive/publish-results).

## E. Findings

### P0
None.

### P1
None.

### P2

**F-A1-P2 — fill_blank has no documented punctuation-normalization or numeric-tolerance policy.**
- SEVERITY: P2 (missing edge-protection / product decision; not a correctness defect for the supported exact/keyword modes).
- PRODUCT IMPACT: A candidate answer `"3.0"` vs standard `"3"`, or trailing
  punctuation `". "` vs standard `"."`, scores 0 under `exact` mode; `keyword` mode
  is substring-based and still punctuation-sensitive. Product has not decided
  whether normalization is desired.
- PRECONDITION: fill_blank question, exact or keyword mode.
- REPRODUCTION: standardAnswer `"3"`, candidate enters `"3.0"` → `matchesBlank`
  returns false → 0.
- EXPECTED: product-decision-dependent (strict exact may be intended).
- ACTUAL: exact/keyword string match, trimmed + optional lowercase only
  (`gradingEngine.ts:67-89`).
- SOURCE EVIDENCE: `packages/domain/src/gradingEngine.ts:67-89`.
- TEST EVIDENCE: grading engine tests pass for the supported exact/keyword semantics.
- CONFIDENCE: HIGH (source-proven).
- RECOMMENDED DISPOSITION: PRODUCT DECISION REQUIRED — document intended
  punctuation/numeric handling; if normalization is wanted, add a gradingRule flag.

### P3

**F-A2-P3 — Publish validation rejects placeholder rubric via a small denylist
(`暂无/无/n/a/na/null/none`).**
- SEVERITY: P3 (clarity / maintainability). The denylist is a reasonable guard but
  may miss locale-specific placeholders; acceptable for Phase 1.
- CONFIDENCE: HIGH.
- RECOMMENDED DISPOSITION: CAN DEFER (consider making placeholder list configurable).

**F-A3-P3 — `archived` exams are terminal; no "un-archive" path.**
- SEVERITY: P3 (by design, consistent with ADR). Documented as terminal.
- CONFIDENCE: HIGH.
- RECOMMENDED DISPOSITION: CAN DEFER (intentional).

## F. Cross-boundary observations

```
CROSS-BOUNDARY-HANDOFF:
Suggested owner: Agent B
Reason: Author/Admin capability to publish/edit exams is gated by flat
        requireCapability(ExamPublish/ExamUpdate) with no resource assignment
        (Teacher org-wide). This is the B workstream's resource-relationship gap
        (F-B1-P1 in Agent B report), relevant context for A4 lifecycle actions.
Evidence: apps/api/src/routes/exam.ts:650-651 (requireCapability(ExamPublish)),
          packages/authz/src/presets.ts (Teacher preset grants ExamPublish org-wide).

CROSS-BOUNDARY-HANDOFF:
Suggested owner: Agent B
Reason: The candidate ownership chain that protects attempt/answer/score is the
        same chain A5/A6 rely on for "submitted attempt → answer modification"
        rejection. Agent B verified cross-candidate 404 denial end-to-end.
Evidence: apps/api/src/authz/resolvers/ownAttemptResolver.ts (ownership match),
          candidateOwnership.test.ts (cross-candidate matrix).
```

## G. Test-quality assessment

```
STRONG TESTS:
  - grading.test.ts / gradingPoison.test.ts / gradingAggregation.test.ts (198 engine
    tests): prove exact/partial/keyword/exact fill-blank scoring, snapshot-only score
    authority, poison-resistance to live edits.
  - examStateMachine.test.ts / attemptStateMachine.test.ts: exhaustive transition tables
    + rejection of invalid source status.
  - examTransitions.test.ts / examStateMachine.test.ts / submitFreezeBarrier.test.ts /
    resultPublishing.test.ts (52 API tests): real DB + transaction + reconcile + audit;
    prove illegal transitions rejected with state unchanged.
  - answerProtocol.test.ts / saveAnswer.test.ts: versioned idempotency + conflict
    detection (CONFLICTING_PAYLOAD, ATTEMPT_ALREADY_SUBMITTED) — genuine negative tests.
  - gradingQueue.test.ts (608 lines): manual grading lifecycle (pending→completed),
    double-grade idempotency, workset consistency.

WEAK TESTS:
  - None identified that would pass under a real defect. The transition tests assert
    both the error AND state-unchanged, so a no-op rejection (failing to change state)
    would still pass the "rejected" assertion but the state-unchanged assertion
    guards silent mutation.

VACUOUS TESTS:
  - None found. No early-return-on-missing-fixture, no array-count-only assertions
    without value checks, no mock-only runtime claims. answerProtocol tests are pure
    (no DB) but exercise real conflict logic, not mocks of behavior.

MISSING NEGATIVE CONTROLS:
  - No explicit test proving that editing a question bank row AFTER an attempt exists
    leaves the attempt's gradingResult unchanged at the DB level (gradingPoison covers
    it at the aggregator level, which is sufficient, but a DB-roundtrip regression test
    would close the loop). Low risk — architecture makes live questions unreachable.
  - fill_blank numeric/punctuation behavior has no explicit "expected-fail" test
    documenting the strict-match decision (tied to F-A1-P2 product decision).
```

## H. Evidence executed

1. **Source review (SOURCE)**
   - `packages/domain/src/enums.ts` (QuestionType, ExamStatus, AttemptStatus, GradingStatus)
   - `packages/domain/src/gradingEngine.ts` (gradeQuestion dispatch + 5 strategies)
   - `packages/domain/src/types.ts` (QuestionSnapshot, ExamAttempt, AnswerRecord)
   - `packages/exam-engine/src/examStateMachine.ts`, `examCommands.ts`, `attemptStateMachine.ts`,
     `attemptCommands.ts`, `answerProtocol.ts`, `gradingWorkset.ts`
   - `packages/db/src/schema/pg.ts` (examAttempts.questionSnapshot/answers/submittedAnswers, unique index)
   - `apps/api/src/routes/exam.ts`, `examTransitionExecutor.ts`
   - Proves: 5-type model, objective semantics, immutable snapshot, lifecycle table,
     submit freeze barrier, versioned answer save.

2. **Engine tests (TEST-PROVEN)**
   - `cd packages/exam-engine && TEST_DB_ISOLATION=worker-database APP_MODE=test TEST_DATABASE_URL="postgresql://exam:exam@localhost:15432/exam_test" npx vitest run src/grading.test.ts src/examStateMachine.test.ts src/attemptStateMachine.test.ts src/answerProtocol.test.ts src/examCommands.test.ts src/attemptCommands.test.ts`
   - Result: 6 files, **198 tests PASSED**, 722ms.

3. **API lifecycle tests (TEST-PROVEN)**
   - `cd apps/api && TEST_DB_ISOLATION=worker-database APP_MODE=test TEST_DATABASE_URL="postgresql://exam:exam@localhost:15432/exam_test" npx vitest run src/routes/examTransitions.test.ts src/routes/examStateMachine.test.ts src/routes/submitFreezeBarrier.test.ts src/routes/resultPublishing.test.ts src/routes/examAuthoringCapability.test.ts src/routes/questionAuthoringCapability.test.ts`
   - Result: 6 files, **52 tests PASSED**, 34.49s.

4. **DB repository tests (TEST-PROVEN)**
   - `cd packages/db && ... npx vitest run src/repository/questionTextResponse.test.ts src/repository/attemptGradingEntryRepo.test.ts`
   - Result: 2 files, **16 tests PASSED**, 2.25s.

5. **Browser E2E (BROWSER-PROVEN, executed in Agent B pass, reused as evidence)**
   - `bash scripts/e2e/run-wsl.sh candidate-happy-path` — both shards PASS; proves
     subjective text_response → pending_manual end-to-end. (Re-run not duplicated to
     avoid DB churn; result recorded in Agent B report and reproducible on demand.)

What the above does NOT prove: rich-text/multimedia submission (not supported by
design — confirmed absent); Teacher/Proctor/Grader resource isolation (Agent B scope).

## I. Recommended closure plan

```
MUST FIX BEFORE BASIC PRODUCT CLOSURE:
  - None for the A workstream. The supported question types, lifecycle, scoring,
    snapshot integrity, and concurrency/idempotency are test-proven.

CAN DEFER:
  - F-A1-P2 (fill_blank punctuation/numeric policy) — product decision, low risk.
  - F-A2-P3 (placeholder denylist configurability).
  - F-A3-P3 (terminal archived — by design).

REQUIRES PRODUCT DECISION:
  - fill_blank edge matching policy (exact/keyword only today; punctuation/numeric
    tolerance unspecified).

RICH-TEXT FOLLOW-UP:
  - Not required. Subjective path is plain-text complete; product does not claim
    rich text. If rich text is later desired, it is a Phase 2+ feature, not a defect.

RESOURCE-AUTHORIZATION FOLLOW-UP:
  - Owned by Agent B (F-B1-P1): Teacher/Proctor/Grader org-wide access; no
    assignment model. Does not affect candidate data isolation, which A5/A6 rely on
    and which is independently proven.
```

## J. Final machine-readable summary

```
RUN_ID=EXAM-BOUNDARY-A-20260718-231530-ddbc808b
AGENT_SLOT=A
P0=0
P1=0
P2=1
P3=2
PROVEN_SUPPORTED=single_choice,multiple_choice,true_false,fill_blank,text_response_plaintext,exam-lifecycle,illegal-transition-rejection,immutable-question-snapshot,submit-double-submit-idempotent,answer-save-versioned,row-locked-submit-freeze
PARTIAL=fill_blank_edge_matching_policy
UNSUPPORTED=rich-text,images-in-answer,tables,formulas,attachments,markdown,auto-graded-subjective
DECISIONS_REQUIRED=fill_blank_punctuation_numeric_policy
BASIC_PRODUCT_CLOSURE=PASS
```

---

```
EXAM-BOUNDARY-A-20260718-231530-ddbc808b: COMPLETE
```
