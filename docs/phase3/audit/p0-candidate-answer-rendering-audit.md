# P3-MOD-P0-1 — Candidate Answer Rendering Audit

> **Type:** audit (no production code changes)
> **Authority:** `docs/phase3/job-cards-phase3-modules.md` P3-MOD-P0-1
> **Scope:** per-question-type rendering / save / restore / submit behavior, including `text_response`.
> **Output file:** this document (the only allowed artifact).

---

## 1. QuestionRenderer dispatch logic

File: `apps/web/src/components/exam/QuestionRenderer.tsx`

```ts
switch (question.type) {
  case "single_choice":   return <SingleChoiceInput ... />;
  case "multiple_choice": return <MultipleChoiceInput ... />;
  case "fill_blank":      return <FillBlankInput ... />;
  case "true_false":      return <TrueFalseInput ... />;
  default:                return <p>unsupportedType</p>;
}
```

- Dispatch is purely on `question.type`.
- **No `case "text_response"` exists** — a `text_response` question falls through to the `default` branch and renders the localized "unsupported type" error.
- `SubjectiveAnswerInput` is **not imported** by `QuestionRenderer` (orphan — see §5).

Component prop type: `question: CandidateQuestionSnapshot` (`apps/web/src/lib/examTypes.ts`), sourced from `LoadAttemptResponse["questionSnapshot"][number]`. **Note:** after P3-FSM-0 the page maps the snapshot question into this shape at `TakeExamPage.tsx:666-676`; field names `originalQuestionId` / `content` are still required by `QuestionRenderer`.

---

## 2. Per-type rendering / save / restore / submit matrix

Answer shape is the value sent to / received from the Answer Save Protocol
(`POST /api/attempts/:attemptId/answers/:questionId`, body field `answer`).

| 渲染用例 (render case) | 编码方式 (encoding) | 组件 (component) | 作答形状 (answer shape) | 保存 (save) | 恢复 (restore) | 提交 (submit) | 缺口 (gap) |
|---|---|---|---|---|---|---|---|
| `single_choice` | `type=single_choice` | `SingleChoiceInput` (`QuestionRenderer.tsx:21`) | `string` (option id) | ✅ `onChange(optionId)` → `saveAnswer` (debounced via `useSubmitFlush`) | ✅ `value: string \| undefined` rendered as selected radio | ✅ `submitAttempt` sends current draft; snapshot `answerValue` after submit | none |
| `multiple_choice` | `type=multiple_choice` | `MultipleChoiceInput` (`:35`) | `string[]` (sorted option ids) | ✅ `onChange(Array.from(set).sort())` | ✅ `value: string[]` builds `Set` for checkbox `checked` | ✅ | none |
| `true_false` | `type=true_false` | `TrueFalseInput` (`:53`) | `boolean` | ✅ `onChange(true \| false)` | ✅ `value: boolean \| undefined` | ✅ | none |
| `fill_blank` (objective) | `type=fill_blank`, `standardAnswer != null` | `FillBlankInput` (`:43`) | `string` (single blank) or `Record<string,string>` (multi-blank) | ✅ `onChange(record)` | ✅ value normalized to record; auto-detects blank count from `content.split("____")` | ✅ | none |
| **`text_response`** | `type=text_response` | **MISSING — no `case "text_response"` branch; renders `default` "unsupported type" error** | should be `string` (multi-line, newline-preserving) | ❌ **gap**: no input mounted → `onChange` never fires → no save | ❌ **gap**: cannot restore (no input) | ❌ **gap**: nothing to submit; backend `text_response` would have null draft | **GAP**: QuestionRenderer has no `text_response` dispatch; `SubjectiveAnswerInput` (the obvious textarea component) is an orphan and is never imported |

### Save / restore / submit protocol notes

- All save paths flow through `useSubmitFlush.scheduleSave()` (`apps/web/src/hooks/useSubmitFlush.ts:115`) with a 1500 ms debounce.
- After P3-FSM-0 the save execution seam also enforces `viewRef.current?.canSave` (`TakeExamPage.tsx:289`); rendering-disabled alone is not the save authority.
- Restore for all types flows from the authoritative `CandidateTakeSnapshot.questions[].answerValue` → `answers.get(id)` → `currentAnswer` → `<QuestionRenderer answer={currentAnswer} />`.
- After submit, the page reloads the snapshot; `answerSource='submitted'` values are rendered read-only via `currentQuestionView.disabled`.

---

## 3. SaveAnswerRequestSchema answer validation

File: `packages/contracts/src/attempt.ts:157`

```ts
export const SaveAnswerRequestSchema = z.object({
  ...
  answer: z.unknown(),     // line 157
  ...
});
```

- The `answer` field is validated as `z.unknown()` — **no type-specific validation at the API boundary.**
- This is an intentional design choice (API accepts arbitrary JSON for forward compatibility with future question types), **not a bug**.
- **Consequence:** frontend correctness depends entirely on `QuestionRenderer` dispatching to the right input component and that component producing the correct answer shape. There is no server-side guard that catches a `text_response` answer accidentally encoded as a boolean or array.
- For `text_response`, this means: if the renderer is missing, the candidate simply cannot produce a value (the `default` error branch mounts no `onChange` source). The gap surfaces at the UI layer, not the protocol layer.

---

## 4. Domain QuestionType enum

File: `packages/domain/src/enums.ts:75-84`

```ts
export const QuestionType = {
  SingleChoice: "single_choice",
  MultipleChoice: "multiple_choice",
  TrueFalse: "true_false",
  FillBlank: "fill_blank",
  // P3-L0-1: independent QuestionType for constructed free-text responses.
  TextResponse: "text_response",
};
export type QuestionType = (typeof QuestionType)[keyof typeof QuestionType];
```

- The enum **does** include `text_response` (added by P3-L0-1).
- The card's note that "the enum only has 4 values" is **stale** — P3-L0-1 already added `text_response`. The domain layer is ready; only the **renderer** is missing the dispatch.
- `gradingEngine.ts:141-145` confirms `text_response` is treated as a manual-graded placeholder here (`gradeAnswer` returns zero; real scoring lives in `manualGrading`). This is consistent with `gradingMode='manual'` derivation.

---

## 5. SubjectiveAnswerInput orphan status

File: `apps/web/src/components/exam/SubjectiveAnswerInput.tsx` (78 lines)

- The component **exists**: a textarea with label, char-count, optional `maxLength`, optional `readOnly`, error display, `aria-invalid` / `aria-describedby`.
- i18n keys referenced: `candidateRuntime.answer.subjective.label`, `.placeholder`, `.charCount`, `.charCountWithMax`.
- **`grep SubjectiveAnswerInput apps/web/src`**: the symbol is referenced only inside its own file (definition + the local `SubjectiveAnswerInputProps` type). **Never imported by `QuestionRenderer`** (or any other production file).
- **No test file** `SubjectiveAnswerInput.test.tsx exists. The card's claim that it is "tested" is stale.
- **Conclusion:** `SubjectiveAnswerInput` is a fully-formed but **dead** component. It is the natural candidate to back the `text_response` rendering gap discovered in §2 — either by importing it directly or by aliasing it as `TextResponseInput`.

---

## 6. Gap summary

| Gap | Severity | Owning card |
|---|---|---|
| `QuestionRenderer` has no `case "text_response"` branch → renders "unsupported type" for any `text_response` question | **blocking** for the candidate free-text answer path | **P3-MOD-P0-2** (text_response runtime) |
| `SubjectiveAnswerInput` is orphaned and untested | supporting — provides the implementation substrate for P3-MOD-P0-2 | P3-MOD-P0-2 |
| `QuestionRenderer.test.tsx` does not exist — no test guards the dispatch table | supporting — P3-MOD-P0-2 must add `QuestionRenderer.test.tsx` covering all 5 types including `text_response` | P3-MOD-P0-2 |
| SaveAnswerRequestSchema `answer: z.unknown()` provides no type guard | accepted design choice (not a gap to fix here) | none |

### Required fix scope (for P3-MOD-P0-2)

Per the approved card, the next implementation card owns the repair and must:

1. Add `case "text_response"` to `QuestionRenderer.tsx`, rendering a textarea backed by `SubjectiveAnswerInput` (renamed/exposed as `TextResponseInput`, or imported directly).
2. Preserve newlines on save and restore.
3. Render submitted values read-only with `white-space: pre-wrap`.
4. Forbid `dangerouslySetInnerHTML` (XSS safety).
5. Add `QuestionRenderer.test.tsx` covering `text_response` rendering, save/restore of newlines, and post-submit lock.

This audit does **not** fix the gap (rule 10: audit-only).
