# P3-MOD-P1-1 — Manual Grading API/UI Closure Proof

> **Status:** DONE. This document proves the manual-grading closure under the
> accepted grading authority graph, after the narrow P1-1 production fix that
> exposes frozen `standardAnswer` + `rubric` to the grader.
>
> **Authority preserved:** score source = `attempt_grading_entries`; aggregation
> seam = `aggregateGradingEntries`; terminal closure = `finalizeTerminalGrading`.
> No second terminal path was introduced.

---

## 1. The defect and the repair

### 1.1 Confirmed defect

The `GradingDetailsQuestionSchema` / grading-details projection omitted:

```text
standardAnswer   (frozen QuestionSnapshot.standardAnswer)
rubric           (frozen QuestionSnapshot.rubric)
```

Both already existed on the frozen `QuestionSnapshot`. The grader therefore
lacked the frozen grading basis required by protocol §6.2 / §1.5.

### 1.2 Repair (narrow, authority-preserving)

Three files changed in production code:

| File | Change |
| ---- | ------ |
| `packages/contracts/src/score.ts` | `GradingDetailsQuestionSchema` gains `standardAnswer: z.unknown().nullable()` and `rubric: z.string().nullable()`. |
| `apps/api/src/routes/gradingQueue.ts` | grading-details projection emits `q.standardAnswer ?? null` and `q.rubric ?? null` from the frozen `QuestionSnapshot`. |
| `apps/web/src/pages/admin/GradingDetailPage.tsx` | renders the frozen reference answer + rubric as plain text (`whitespace-pre-wrap`), with a `formatStandardAnswer` helper whose null-state label is "未设置" (distinct from the candidate "未作答"). |

The projection reads from `attempt.questionSnapshot` (already loaded for the
existing `content`/`type`/`maxScore`/`candidateAnswer` projection). **No new
data source, no live-question JOIN, no `submitted_answers` runtime fallback, no
draft `answers` read.**

---

## 2. Grading authority graph (non-regression proof)

The accepted authority graph is preserved exactly:

```text
submitted_answers
    = frozen submit truth
    = submit-time workset materialization input
        ↓
attempt_grading_entries
    = materialized grading workset
    = manual queue work authority
    = terminal score source
        ↓
gradeQuestion
    = pending-manual-only one-way completion
        ↓
remaining pending manual work?
    ├── YES → submitted + pending_manual
    └── NO  → finalizeTerminalGrading (canonical terminal closure)
                  ↓
              aggregateGradingEntries (canonical aggregation seam, closure-internal)
                  ↓
              canonical terminal projections
```

### 2.1 Structural lock evidence

`apps/api/src/runtime/gradingArchitecture.structural.test.ts` — **12 tests, GREEN**.

This lock asserts:
- `aggregateGradingEntries` has exactly **one** production caller:
  `finalizeTerminalGrading` (`packages/exam-engine/src/grading.ts`).
- `gradeQuestion` / auto path (`finalizeGrading`/`gradeAttemptIdempotent`) both
  delegate to `finalizeTerminalGrading`, never call `aggregateGradingEntries`
  directly.
- `aggregateGradingEntries` body never reads `attempt.answers` /
  `attempt.submittedAnswers` / `attempt.gradingResult` — only `attempt.id` +
  `attempt.questionSnapshot`.
- `enrollment.{finalScore, finalPassed, finalAttemptId}` writer-inventory
  allowlist = `{ grading.ts }` (only `finalizeTerminalGrading`).

The P1-1 repair touched `gradingQueue.ts` projection only (a read-side
presentation field). It did **not** alter `aggregateGradingEntries`,
`finalizeTerminalGrading`, `gradeQuestion`, the workset materialization, or any
writer inventory. The structural lock passed unchanged → **authority
non-regression proven.**

---

## 3. Test evidence

### 3.1 Focused API tests — `gradingQueue.test.ts`

All **GREEN** (942 passed, 5 skipped). The P1-1-specific slice is
`describe("grading-details frozen metadata projection (P3-MOD-P1-1)")`:

| Test | Proves |
| ---- | ------ |
| `projects frozen standardAnswer and rubric from the QuestionSnapshot` | RED-first: frozen metadata is projected from the snapshot (was missing). |
| `keeps frozen metadata even when the live question row changes` | grading-details does **not** JOIN live questions — a live `questions` row edit is invisible to the response. |
| `projects null standardAnswer/rubric for a text_response without them` | null-safe projection: a text_response with no reference answer renders null, not a fabricated value. |
| `renders a multiline candidate answer and rubric as frozen plain text` | candidateAnswer comes from the materialized grading entry (provenance = submit-time `submitted_answers`); rubric is frozen multiline. |

### 3.2 UI tests — `GradingDetailPage.test.tsx`

All **GREEN** (675 passed). P1-1 slice:
`describe("frozen grading metadata rendering (P3-MOD-P1-1)")`:

| Test | Proves |
| ---- | ------ |
| `renders the frozen standardAnswer and rubric as plain text for text_response` | Both fields render; both carry `whitespace-pre-wrap`. |
| `shows not-set labels when standardAnswer and rubric are null` | Null reference answer → "未设置"; distinct from candidate "未作答". |
| `renders rubric and standardAnswer as literal text (no HTML execution)` | `<script>` payload stays literal text; no DOM execution; XSS-safe (no `dangerouslySetInnerHTML`). |
| `preserves multiline whitespace-pre-wrap on rubric and standardAnswer` | `whitespace-pre-wrap` class present on both fields. |

### 3.3 Score command boundaries (pre-existing, regression-confirmed)

From `gradingQueue.test.ts` + the Slice 3C boundary `describe` block, all GREEN:

| Boundary | Evidence |
| -------- | -------- |
| `0 <= score <= entry.maxScore` | Slice `returns 400 when score exceeds the question maxScore` |
| missing entry fail closed (no lazy create) | Slice `returns 404 when the grading entry is missing` |
| auto entry reject | Slice `rejects manual grading on an auto_graded attempt` (409) |
| completed_manual reject 409 | Slice `does not overwrite a completed_manual entry` |
| graded + fully_graded reject 409 | Slice `rejects manual grading after the attempt reaches graded + fully_graded` |
| strict terminal (same-value + diff-value re-grade rejected) | Slice 3C `rejects same-value/different-value re-grade` |
| no post-terminal re-grade overwrite | Slice `rejects post-terminal score revision` |

### 3.4 Partial / final completion (canonical terminal path)

| Behavior | Evidence |
| -------- | -------- |
| partial manual completion → submitted + pending_manual; one pending queue work remains; grading.finalized absent | `returns two queue items ... then one after grading the first` (`gradingQueue.test.ts`) — `pendingQuestionCount: 1`, `gradingStatus: pending_manual` after first grade |
| final manual completion → finalizeTerminalGrading → aggregateGradingEntries inside canonical closure → graded + fully_graded; queue work absent; grading.finalized present | `flips gradingStatus to fully_graded when the last question is graded` + `records a grading.finalized audit when last question is graded` |

### 3.5 Mixed score identity

`reconciles objective + manual into the attempt total on full grading`
(`gradingQueue.test.ts` Slice 13):

```text
distinct objective (q-obj, 40, correct) + manual (q-sub, 60, graded 50)
→ totalScore: 90, passed: true (passingScore 50)
```

Final score = SUM(attempt_grading_entries.earnedScore) = SUM(gradingResult
questions[].earnedScore) = 90, computed through the single canonical
`finalizeTerminalGrading` closure. (Full identity equality across all three
sources is additionally locked by `gradingScoreIdentity.test.ts` in the
exam-engine package.)

### 3.6 Organization isolation

`does not expose another organization's pending grading entries`
(`gradingQueue.test.ts` Slice 3N): a foreign-org pending-manual entry is
invisible to the caller's tenant via the repo's `ctx.organizationId` guard.
The P1-1 repair added only presentation fields on the already-org-scoped
`findById(ctx, ...)` attempt read — no tenant-model change.

---

## 4. What P1-1 did NOT change (forbidden list)

```text
second terminal grading path introduced        = NO
grading work reconstructed                      = NO
attempt.answers used as grading truth          = NO
submitted_answers runtime fallback added       = NO
live question metadata used as frozen grader basis = NO  (proven by test §3.1 row 2)
post-terminal ordinary re-grade added          = NO
candidate result release implemented in P1     = NO
grading workset schema / queue authority / manual completion lifecycle / terminal aggregation = UNCHANGED
```

The grading detail continues to read candidate answer from the materialized
grading entry's frozen `candidateAnswer` (provenance: `submitted_answers` at
materialization). The frozen `standardAnswer`/`rubric` come from the frozen
`QuestionSnapshot`, never from a live `questions` JOIN.

---

## 5. Files changed (P1-1)

Production:
- `packages/contracts/src/score.ts` — schema fields added.
- `apps/api/src/routes/gradingQueue.ts` — projection fields added.
- `apps/web/src/pages/admin/GradingDetailPage.tsx` — render + `formatStandardAnswer`.
- `apps/web/src/i18n/locales/zh-CN.ts` — `standardAnswer` / `rubric` / `notSet` keys.

Tests:
- `apps/api/src/routes/gradingQueue.test.ts` — P1-1 frozen-metadata slice (4 tests).
- `apps/web/src/pages/admin/GradingDetailPage.test.tsx` — P1-1 render slice (4 tests).

Verification:
- focused API tests: GREEN (942 passed, 5 skipped)
- grading structural lock: GREEN (12 tests)
- focused web tests: GREEN (675 passed)
- full `pnpm verify`: GREEN (recorded at commit time)
