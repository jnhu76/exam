# #669 Phase E — Seam Graph (§4)

As-built production map at `master` 67079eff. Every edge is annotated with its
trust owner (raw/untrusted → interpreted) and freeze owner (mutable → frozen).

## Main candidate/answer chain

```text
author/editor input (Tiptap, apps/web)
  │  EDGE T1 raw→interpreted  TRUST OWNER: server re-validation (never client)
  ▼
question write canonicalization
  │  apps/api/src/routes/questionContent.ts:87 resolveQuestionContentWrite
  │  (canonicalizeContentDocument + plainTextProjection derivation;
  │   routes: POST /api/questions question.ts:247, PATCH /api/questions/:id
  │   question.ts:359 with assertRichContentUpdateAllowed:129)
  ▼
question repository (packages/db questionRepo; questions.content_document JSONB)
  │
  ▼
publish trust  ══ MUTABLE→FROZEN FREEZE OWNER ══
  │  packages/exam-engine/src/examCommands.ts:148 publishExam
  │  - per-question/option classifyPersistedQuestionContent gate (:113)
  │  - projection invariant content == plainTextProjection(document) (:250, :268)
  │  - buildQuestionSnapshot (:67) → exams.question_snapshot (:295, :307)
  │  route: POST /api/exams/:id/publish (apps/api/src/routes/exam.ts:1237)
  ▼
QuestionSnapshot (frozen; also copied per-attempt at create:
  attemptCommands.ts:440 materializeAttemptPresentation →
  exam_attempts.question_snapshot)
  │
  ▼
candidate editor/input (apps/web RichTextAnswerInput; take snapshot:
  GET /api/candidate/attempts/:id/take attempts.candidate.ts:815,
  attempts.shared.ts:145 — server ships raw draft value; typed
  classification is the web read seam RichTextAnswerInput.tsx:53)
  │  EDGE raw→interpreted TRUST OWNER: validateAnswerForQuestion
  ▼
SaveAnswer canonicalization
  │  POST /api/attempts/:attemptId/answers/:questionId (attempts.candidate.ts:944)
  │  → engine saveAnswer (answerProtocol.ts:379) precedence:
  │    repo-affinity/identity → NotFound → P1 membership (:414) →
  │    receipt lookup (:430) → processSaveAnswer (:137):
  │    voided→ATTEMPT_CLOSED (:150) → submitted/graded→ALREADY_SUBMITTED (:159)
  │    → deadline (:173) → canonicalize (:189) → identity on CANONICAL (:207)
  │    → known-replay (:209) → STALE_VERSION (:238) → FUTURE_VERSION (:255)
  │    → accept (version+1, newReceipt)
  │  canonicalizer: apps/api/src/lib/validateAnswerForQuestion.ts:41
  ▼
answer persistence + replay receipt  ══ single protocol commit ══
  │  exam_attempts.answers JSONB + exam_answer_save_receipts
  │  (append-only; PK (org, attempt, question, client_seq))
  │  attemptRepo.appendAnswerReceipt in the same tx (:477-484)
  ▼
restore/reload/recovery
  │  POST /api/attempts/:id/restore attempts.candidate.ts:1256;
  │  STALE_VERSION adoption ships engine-persisted serverAnswer (wire :1114)
  │  web classification: RichTextAnswerInput.tsx:53 (fail-closed D3)
  ▼
submit freeze  ══ MUTABLE→FROZEN FREEZE OWNER ══
  │  POST /api/attempts/:id/submit attempts.candidate.ts:1128
  │  → orchestrator submitAndGradeAttempt.ts (one locked tx)
  │  → submitAttempt attemptCommands.ts:515
  │  → buildSubmittedAnswersSnapshot answerProtocol.ts:505 (PURE COPY:
  │     no canonicalizer at submit; values as-is, ordered by snapshot order)
  │  → exam_attempts.submitted_answers
  ▼
grading
  │  computeGradingResult grading.ts:142 (frozen submitted_answers +
  │  frozen snapshot); workset gradingWorkset.ts:133
  │  GET /api/admin/attempts/:id/grading-details gradingQueue.ts:154
  │  (frozen contentDocument/answerMode projected; client classifies answer)
  ▼
result
  │  ResultPage.tsx:71 resolveRichAnswerDocument (DISPLAY-only)
  ▼
export
  │  GET /api/admin/attempts/:id/export[/csv] attempts.admin.ts:400/446
  │  → buildAttemptExport attempts.admin.ts:549
  │  → resolveExportAnswerView attemptExportAnswer.ts:66
  │    (classifyPersistedRichAnswer @ frozen answerMode; projection null on
  │     corrupt/unsupported; objective slots never Rich-classified)
  ▼
render
  │  ContentRenderer.tsx:39 resolvePersistedQuestionDocument before
  │  ContentDocumentRenderer; MathRenderer→katexRender.ts
  │  (trust:false, maxSize:50, maxExpand:1000, latex bound)
```

## Independent static question path

```text
question repository (content_document, options[].content_document)
  → preview (authoring; QuestionForm projection preview — advisory only)
  → publish (D5.1 classify gate + projection invariant + freeze)
  → frozen snapshot (exams.question_snapshot / exam_attempts.question_snapshot)
  → candidate/grader/result static render (ContentRenderer trust boundary)
```

## Trust-owner ledger (every raw→interpreted edge)

| Edge | Trust owner | Mechanism |
|---|---|---|
| editor JSON → canonical | server write seams | `canonicalizeContentDocument` at question/option/answer write; client checks advisory |
| persisted answer → interpreted | §7 answer classifier | `classifyPersistedRichAnswer` (web read + API export); server runtime trusts D1-canonical writes |
| persisted question doc → interpreted | §7 static classifier | `classifyPersistedQuestionContent` (ContentRenderer + publish gate) |
| answer value → replay identity | SaveAnswer protocol | `canonicalAnswerIdentity` on the D1-canonical value only |
| export value → CSV/JSON view | export policy | `resolveExportAnswerView` (delegates semantics to the classifier) |

## Freeze-owner ledger (every mutable→frozen edge)

| Edge | Freeze owner | Mechanism |
|---|---|---|
| question bank → exam snapshot | publishExam | classify-then-freeze; snapshot built after all checks |
| exam snapshot → attempt snapshot | attempt create | `materializeAttemptPresentation` copy |
| draft answers → submitted_answers | submitAttempt | `buildSubmittedAnswersSnapshot` pure copy under row lock |
| rubric/standardAnswer/score | same snapshot copies | `buildQuestionSnapshot` |
