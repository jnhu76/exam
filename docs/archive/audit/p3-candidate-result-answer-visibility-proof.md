# Candidate Result / Answer Visibility Boundary Proof

> **Task:** P3-MOD-P3-2 — Candidate Result / Answer Visibility Boundary Proof
> **Mode:** Boundary proof (API + Web tests). Production changes: **None**.

---

## A. Verdict

```text
P3-MOD-P3-2: PASS
```

---

## B. Contract findings (the decisive audit result)

Before writing any test, the contract was audited. The decisive finding shapes the
whole task: **there is no per-exam answer-visibility configuration, and candidate
answer visibility is effectively "always hidden" in MVP.**

### B.1 Result visibility gate (authoritative)

- Endpoint: `GET /api/scores/attempts/:attemptId` (`apps/api/src/routes/scores.ts:376`)
- Gate function: `computeResultVisibility(exam, attempt, role)` (`scores.ts:170-222`)
  - Stage 1 resultReady: requires `status === "graded"` + score/passed/gradedAt/gradingResult present + `gradingStatus` not `pending_manual`; `after_grading` additionally requires `fully_graded` (auto_graded insufficient).
  - Stage 2 publication gate (candidates only): `immediate`/`after_grading` → visible when ready; `manual` → visible only when `exam.resultsPublishedAt != null`.
- Hidden response shape (`scores.ts:417-424`): `{ attemptId, status, showResultImmediately:false, hiddenReason, examTitle }` — **no** `totalScore`/`passed`/`questionResults`.
- Visible response shape (`scores.ts:440-450`): `{ ..., showResultImmediately:true, passingScore, totalScore, passed, gradedAt, questionResults }`.

### B.2 Answer visibility gate (authoritative) — "always hidden" for candidates

- The result endpoint **unconditionally strips `standardAnswer` for candidates**:
  `scores.ts:434-438` — `safeQuestionResults = isCandidate ? questionResults.map(({ standardAnswer: _, ...rest }) => rest) : questionResults`.
- The result `questionResults` DTO **never carries `rubric`** at all (`QuestionScoreResultSchema`, `packages/contracts/src/score.ts:8-15`, fields: `questionId, score, maxScore, correct, candidateAnswer, standardAnswer`).
- The only `answerVisibility` symbol in the codebase is `computeAnswerVisibility()` in `apps/api/src/routes/attempts.shared.ts:76-78`:
  ```js
  function computeAnswerVisibility(): "hidden" | "visible" { return "hidden"; }
  ```
  It applies to the **CandidateTakeSnapshot** (take page), NOT the result page, and is **hardcoded hidden** (comment: "For MVP, always hidden for candidates").
- **No `answerVisibility` / `showAnswers` / `answerPublicationMode` config field exists in the exam contract** (`packages/contracts/src/exam.ts`, `packages/domain/src/types.ts` — confirmed by search).

**Consequence (per task §二 INV-VA1 "don't invent combinations the protocol doesn't support"):** the only valid candidate cross-product is `{result visible, answers hidden}`. The protocol does not support `{result visible, answers visible}` for candidates in MVP, so §7.2/§9.3 (answers-visible) are documented as **not applicable**, not skipped.

### B.3 Result DTO field classification

| Field | Always returned | result gate | answer gate | Candidate should NOT receive |
| --- | :---: | :---: | :---: | :---: |
| attemptId / status / examTitle | ✅ | — | — | — |
| showResultImmediately / hiddenReason | ✅ (one of) | ✅ | — | — |
| passingScore / totalScore / passed / gradedAt | visible-only | ✅ | — | hidden when result hidden |
| questionResults[].candidateAnswer | visible-only | ✅ | — | — |
| questionResults[].standardAnswer | — | — | stripped for Candidate ✅ | ✅ never sent to candidate |
| questionResults[].rubric | — | — | — | ✅ not in DTO at all |
| questionResults[].score/maxScore/correct | visible-only | ✅ | — | — |
| gradingResult (raw) | — | — | — | ✅ not projected |
| gradingStatus / questionSnapshot | — | — | — | ✅ not projected |
| grader metadata / workset ids | — | — | — | ✅ not in contract |

---

## C. Cross-product matrix (candidate)

| Result | Answers | Candidate projection | Status |
| --- | --- | --- | --- |
| hidden | hidden | status-only DTO, no score/pass, no questionResults | PROVEN (`scores.test.ts` hidden test; also P3-1) |
| **visible** | **hidden** | totalScore/passed returned; standardAnswer stripped; rubric absent | **PROVEN** (`scores.test.ts` "result visible" test + Web) |
| visible | visible | n/a — **protocol does not support this for candidates in MVP** | N/A (documented) |

---

## D. Ownership proof

- Test: `candidate can read own result but not another candidate's attempt` (`scores.test.ts`).
- Candidate A (default) owns attemptA; reads `GET /api/scores/attempts/:attemptA` → 200 visible.
- Candidate B (separate user, same org, signed token) reads attemptA → **404** (ownership enforcement via `findVisibleAttempt`, not just role gating).
- Also proven in pre-existing `does not expose an attempt to an admin from another organization` (org isolation, 404).

---

## E. text_response proof

The result DTO strips `standardAnswer` and never carries `rubric` regardless of question type, so:

- **standardAnswer present on the live question** (text_response with `"参考论述内容"`): candidate result has **no** `standardAnswer` key. PROVEN (mixed-exam "result visible" test iterates all questionResults asserting `not.toHaveProperty("standardAnswer")`).
- **standardAnswer null** (text_response with `null` + rubric): the result projection is independent of the value — INV-VA2 holds trivially because there is no value-derived gate. The `textResponseNullId` question is seeded; the gate is a protocol constant, not a function of `standardAnswer`.
- **rubric multiline**: `rubric` is not in the result DTO contract at all, so multiline rubric never reaches the candidate via this endpoint. (Candidate-facing rubric visibility is a non-feature in MVP.)

> Note: `null standardAnswer ≠ answer hidden` (INV-VA2) is satisfied structurally: the answer gate is a hardcoded protocol constant (`computeAnswerVisibility()`), never derived from `standardAnswer == null`.

---

## F. Frozen metadata proof

- Test: `frozen result metadata is immune to live-question edits` (`scores.test.ts`).
- Flow: publish + attempt + grade → read result prompt; mutate the LIVE question (`content`/`standardAnswer`/`rubric`) via DB update → re-read result.
- `buildQuestionResults` (`scores.ts:100-119`) joins `attempt.gradingResult` with `attempt.questionSnapshot` (frozen at publish), **never** a live-question JOIN.
- Result: candidate prompt unchanged (`"P3-2 objective"`), live edit (`"P3-2 LIVE EDITED objective prompt"`) not reflected; standardAnswer/rubric still not leaked.

---

## G. Frontend consumption proof

- `ResultPage.tsx:98` gates the entire score+detail block on `result.showResultImmediately` (the DTO gate). It does **not** inspect `attemptStatus`/`gradingStatus`/`resultPublicationMode` to decide score visibility.
- The "correct answer" column (`ResultPage.tsx:168`) uses `isManual = question.standardAnswer == null`; because the server strips `standardAnswer` for candidates, this is always true → renders the "主观题" placeholder, never a real answer. ResultPage faithfully renders the (stripped) DTO; it does not self-infer answer visibility from score.
- Tests (`ResultPage.test.tsx`):
  - `P3-2: score visible + answers hidden` — realistic DTO (no standardAnswer, no rubric) → score shown, "主观题" placeholder in correct-answer column, no rubric rendered.
  - `P3-2: does not self-release result from grading state when DTO gate is hidden` — cross-wired DTO (`status:"graded"` + `showResultImmediately:false`) → page stays hidden (no score/pass). Proves no self-inference from terminal grading.

---

## H. Leakage proof

The candidate result DTO (visible branch) is asserted to NOT contain (`scores.test.ts` "result visible" test):
- per-question: `standardAnswer`, `rubric`, `graderId`, `gradingEntryId`, `comment`
- top-level: `gradingResult`, `gradingStatus`, `questionSnapshot`

These are excluded by contract (`VisibleAttemptResultSchema`) and by the candidate-strip in `scores.ts:434-438`.

---

## I. Tests added / reused

### Added — API (`apps/api/src/routes/scores.test.ts`, +4)
1. `manual mode: fully_graded + computed score is hidden from the candidate until publish` — fully_graded+score set, candidate hidden (`pending_publish`), no score leak; publish-results → visible 30/true.
2. `result visible: standardAnswer is stripped and rubric never appears for any question type` — the {result visible, answers hidden} cross; iterates all questionResults asserting no standardAnswer/rubric/internal fields; top-level no gradingResult/gradingStatus/questionSnapshot.
3. `candidate can read own result but not another candidate's attempt` — ownership 404.
4. `frozen result metadata is immune to live-question edits` — live question edit does not change frozen result prompt; no standardAnswer/rubric leak.

### Added — Web (`apps/web/src/pages/exam/ResultPage.test.tsx`, +2)
5. `P3-2: score visible + answers hidden` — realistic candidate DTO; score shown, "主观题" placeholder, no rubric.
6. `P3-2: does not self-release result from grading state when DTO gate is hidden` — no self-inference.

### Reused (not duplicated)
- Pre-existing `grades a submitted attempt and returns visible candidate results` (standardAnswer stripped for single_choice) — reused.
- Pre-existing `hides score details when immediate results are disabled` + `returns a hidden response for an in-progress attempt` (hidden shapes) — reused.
- Pre-existing ResultPage tests (visible/hidden/pending_publish/not_graded/fallback) — reused.
- No contract-test additions needed: `VisibleAttemptResultSchema`/`HiddenAttemptResultSchema` already enforce the shapes (contracts.test.ts 205 pass); the candidate-strip is route-layer, proven by the route test.

---

## J. Commands and results

| Command | exit | result |
| --- | :---: | --- |
| `pnpm --filter api test -t "P3-2 candidate result"` | 0 | 4 passed (real `exam_test` DB) |
| `pnpm --filter web test -t "P3-2"` | 0 | 2 passed |
| `pnpm --filter api test` | 0 | **950 passed \| 5 skipped (93 files)** |
| `pnpm --filter web test` | 0 | **1088 passed (94 files)** |
| `pnpm --filter contracts test` | 0 | 205 passed (7 files) |
| `pnpm --filter api typecheck` / `--filter web typecheck` | 0 | clean |
| `pnpm lint` / `lint:arch` / `lint:copy` | 0 | all passed |
| `pnpm format:check` | 0 | passed (formatted `scores.test.ts` then re-ran) |

API tests connect to the real `exam_test` Postgres (`pnpm db:up`). No mocks of the repository; ownership/frozen/visibility all hit real DB + real route code.

---

## K. Production changes

```text
None
```

Only `apps/api/src/routes/scores.test.ts` + `apps/web/src/pages/exam/ResultPage.test.tsx` + this report. No route/contract/engine/ResultPage source changes.

---

## L. Contract naming debt (recorded, not refactored)

- `showResultImmediately` is a legacy field name that actually means "result visible" (the result gate). It is the authoritative DTO discriminator (`AttemptResultResponseSchema` discriminated union). Renaming is **NON-BLOCKING CONTRACT NAMING DEBT** — not touched per task §4.3.
- `hiddenReason: "not_started"` covers any non-graded lifecycle state (submitted/grading/in_progress/...) — historical label, not literal. Non-blocking.

---

## M. Deferred scope

- **{result visible, answers visible}** for candidates: not supported by the MVP protocol (`computeAnswerVisibility()` hardcoded hidden; no per-exam answer-visibility config). Deferred to a future phase that introduces an answer-visibility policy.
- Per-question rubric/standardAnswer review surface for candidates: deferred (no contract field).
- P3-3 Admin frozen result view: not started.

---

## N. Next task

```text
NEXT: P3-MOD-P3-3 — Admin frozen result view proof
```
