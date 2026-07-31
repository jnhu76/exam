# P2 Text Response Authoring Closeout

Closeout date: 2026-07-31
Branch: `feat/p2-text-response-authoring-closeout`
Base: `origin/feat/p1-grading-operator-closeout` @ `7e8d8414` (PR #236 was OPEN/draft, not merged)
Source audit: `docs/archive/phase3/p2-authoring-ui-flow-audit.md` (STALE — see §2)

## 1. Executive verdict

**CLOSED.** The P2 authoring product loop for plain-text `text_response` is
complete and proven through the real UI. The historical audit (F-1..F-4) was
already STALE: P3-MOD-P2-1C had landed `text_response` type selection, the
rubric field, edit readback, type-switch normalization, the list filter, and
publish validation. This closeout closed the one remaining **real** authoring
gap and added the missing proof layers (engine, API-level candidate leak,
real-UI E2E).

This closeout implements **plain-text text_response authoring**. It does
**not** implement rich-text/WYSIWYG editing. It does **not** implement
ADR-008 Option D final-answer payload barrier. No new question type system,
no second rubric table, no new score-aggregation path, no M11, no draft/reopen
grading. The one-time manual-scoring model and the `submitted_answers` /
`attempt_grading_entries` authority chain are unchanged.

The single real product gap fixed here: the QuestionForm forced
`standardAnswer = null` on `text_response` and never rendered the **optional
reference answer** field the contract, API, repo, and seed already supported.
The audit §6.2 requires it.

## 2. Resolved baseline

- PR #236 state at task start: **OPEN + draft** (not merged) → base resolved
  from `origin/feat/p1-grading-operator-closeout`.
- Resolved base SHA: `7e8d841423dc15a8b4a8ac8d16179d594e162749`.
- Working tree was clean → normal `git switch -c` (no worktree needed).
- The historical audit is **STALE for the current tree**. Its P0 (F-1
  `text_response` UI missing) and P1 (F-2 edit readback drops rubric) were
  already CLOSED by P3-MOD-P2-1C. This closeout re-verified every audit claim
  against current production code, not the audit document.

## 3. Frozen product boundary

Implemented (and frozen):

- Admin can create/edit a legal plain-text `text_response` via the real
  QuestionForm: type + content + required multiline rubric + **optional
  multiline reference answer** + score.
- Type data semantics preserved: `type=text_response`, `options=[]`,
  `rubric=required non-empty`, `standardAnswer=optional plain text | null`.
- `rubric` is the grading basis; `standardAnswer` is an optional reference,
  never the auto-grade authority.
- Candidate never sees `rubric` or `standardAnswer` (contract + projection +
  `.parse()` triple-guarded; proven by API-level leak tests).
- Frozen grading authority comes from the attempt's `questionSnapshot` (copied
  at publish); live-question edits after publish do not change an in-flight
  attempt's grading basis.
- The one-time manual-scoring model and terminal closure are unchanged.

## 4. Question form changes

`feat(question): support text_response authoring` (`08f45d95`)

- `QuestionForm.tsx`: render an optional multiline **reference-answer**
  Textarea for `text_response`; type-switch into `text_response` now
  preserves an in-flight reference draft (`string | null`) instead of forcing
  `null` (mirrors the rubric-preservation logic).
- `QuestionEditPage.tsx`: forward a non-empty reference answer verbatim;
  normalize blank/whitespace-only to `null` so no meaningless `"   "` is
  persisted (objective types still carry `rubric: null`).
- i18n (`zh-CN.ts`): `referenceAnswer` / placeholder / hint — candidate-
  invisible, not used for auto-grading.

Tests (`QuestionEditPage.test.tsx`, +6 net): forward reference answer;
whitespace→null (parameterized); edit readback of multiline reference;
re-entry preservation; updated the existing "not required" test.

## 5. Create/edit/readback symmetry

Already PROVEN for objective types; extended for text_response:

- Create payload reaches POST with `type/options/standardAnswer/rubric`
  correct (existing + updated tests).
- Edit GET reads `rubric` (P3-MOD-P2-1C) AND now preserves the reference
  answer across edit (new tests + E2E).
- PATCH round-trips; reload-after-edit confirms persistence (E2E).
- No stale fields leak when switching objective ↔ text_response (existing
  normalization tests retained; type switch no longer clears an in-flight
  reference answer when re-entering `text_response`).

## 6. Publish and snapshot authority

`test(exam): prove text response publish clarity and snapshot freeze`
(`8ee3c053`, engine unit tests, +3):

- The `publishExam` reject message for a text_response missing its rubric
  **names the offending question id** (so an admin authoring several items can
  locate the bad one — not a bare "publish failed").
- The frozen `QuestionSnapshot` carries the optional reference answer exactly
  as authored.
- A post-publish live-question edit does NOT mutate an already-published
  snapshot (freeze authority) — proven by a side-by-side buildQuestionSnapshot
  comparison.

(Publish rejecting null/placeholder/whitespace rubric was already covered by
the existing P3-L0-5 tests; this closeout adds the clarity + freeze guards.)

## 7. Candidate information isolation

`test(exam): protect subjective grading metadata in candidate take`
(`bc33fe60`, API integration, +3):

Structural isolation was already sound: `CandidateTakeQuestion` contract omits
`rubric`/`standardAnswer`/`gradingMode`/`correctOption`/`gradingRule`;
`buildCandidateTakeSnapshot` maps only safe fields; the response is
`.parse()`-ed (Zod strips unknowns). The existing leak test covered
single_choice only.

New text_response-specific API-level leak tests:
- in_progress take: every subjective field absent from the question object AND
  from the raw serialized body (no nested-object smuggling), for a
  text_response carrying BOTH a multiline rubric and a multiline reference
  answer.
- after submit: candidate may re-read their own submitted answer; grading
  metadata still absent.
- **negative control**: admin grading-details DO contain the frozen rubric +
  reference, proving the leak test is not a false-green from data never stored.

## 8. End-to-end product proof

`test(e2e): cover subjective authoring product loop` (`2db07a12`)

The first E2E that creates a `text_response` through the **real QuestionForm**
(not seedExam). Full product loop in one spec:

```
Admin UI: 新增题目 → select 文本作答题 → content + multiline rubric +
  multiline reference answer → save (payload: rubric + reference, options: [])
  → bank list + text_response filter reach it
  → edit round-trips rubric + reference; rubric/content edit persists across
    a fresh edit-page GET, reference preserved
→ API assembles an exam with the UI-authored question and publishes it
  (publishExam accepts the non-empty UI rubric)
→ candidate (enrolled) starts, sees the prompt, does NOT see rubric /
  reference (UI + API-level leak guard), answers multiline plain text, submits
→ admin grading-details show the frozen UI-authored rubric + reference +
  the candidate's frozen answer
→ admin completes manual grading → graded + fully_graded
→ candidate result visible (immediate) with score identity
```

Verified GREEN via `bash scripts/e2e/run-wsl.sh text-response-authoring` on
both shards (exit 0).

## 9. Test evidence

| Command | Exit | Result |
| --- | --- | --- |
| `pnpm --filter web exec vitest run src/pages/admin/QuestionEditPage.test.tsx` | 0 | 27 passed (was 21; +6) |
| `pnpm --filter web exec vitest run src/pages/admin/QuestionPage.test.tsx src/components/exam/QuestionRenderer.test.tsx` | 0 | 5 passed |
| `pnpm --filter @exam/exam-engine exec vitest run src/examCommands.test.ts` | 0 | 60 passed (was 57; +3) |
| `pnpm --filter api exec vitest run src/routes/attempts/candidate-take-text-response.test.ts` | 0 | 3 passed (new file) |
| `pnpm --filter api exec vitest run src/routes/attempts/candidate-take.test.ts` | 0 | 4 passed (no regression) |
| `pnpm verify:static` | 0 | format + lint + copy + arch + db-config + env-contract + repo-contract + ui-gates + eslint + typecheck + openapi all pass |
| `bash scripts/e2e/run-wsl.sh text-response-authoring` | 0 | 2/2 shards pass (real-UI authoring + full product loop) |
| `pnpm verify` | (see morning report) | (coverage + build) |

Every command was run with a real exit code; no GREEN claim is made without a run.

## 10. Per-capability verdict

| Capability | Result | Evidence |
| --- | --- | --- |
| text_response selectable | CLOSED | QuestionForm.tsx type selector; QuestionPage filter; constants TYPE_VARIANT |
| rubric authoring | CLOSED | QuestionForm rubric Textarea; save-time + publish-time validation |
| optional reference answer | CLOSED | (this closeout) QuestionForm reference Textarea; blank→null; edit readback |
| create/edit/readback | CLOSED | QuestionEditPage GET/POST/PATCH; QuestionEditPage.test.tsx + E2E |
| question list filtering | CLOSED | QuestionPage type filter includes text_response |
| exam publish through UI | CLOSED | E2E publishes an exam containing the UI-authored question |
| candidate metadata isolation | CLOSED | contract + projection + .parse(); candidate-take-text-response.test.ts |
| candidate answering | CLOSED | QuestionRenderer → TextResponseInput; E2E multiline answer + submit |
| submit → manual grading product loop | CLOSED | E2E: submit → pending_manual queue → frozen answer/rubric/reference |
| final score | CLOSED | E2E: grade → graded + fully_graded; result totalScore identity |

## 11. Remaining limitations

Out of scope (frozen boundary), unchanged:

- No rich-text / WYSIWYG editing (TipTap/Lexical/Slate/Quill not introduced).
- No HTML/Markdown rendering protocol; `dangerouslySetInnerHTML` not used.
- No image upload / attachments / formula editor.
- No ADR-008 Option D final-answer payload barrier (separate contract change,
  out of Phase-2 scope per ADR-008).
- No draft grading / re-grade / reopen / revision / anonymous grading /
  double-grading / batch grading / AI-assisted grading / M11 assignment.
- No new Question table, no second rubric table, no new score-aggregation path.

## 12. Files changed

Production (1):
- `apps/web/src/components/question/QuestionForm.tsx` — optional reference-
  answer field + type-switch preservation.
- `apps/web/src/pages/admin/QuestionEditPage.tsx` — reference-answer blank→null
  normalization in the save payload.
- `apps/web/src/i18n/locales/zh-CN.ts` — referenceAnswer label/placeholder/hint.

Tests (4):
- `apps/web/src/pages/admin/QuestionEditPage.test.tsx` — +6 text_response
  reference-answer tests.
- `packages/exam-engine/src/examCommands.test.ts` — +3 publish-clarity +
  snapshot-freeze tests.
- `apps/api/src/routes/attempts/candidate-take-text-response.test.ts` — NEW,
  3 API-level leak tests + negative control.
- `apps/e2e/e2e/text-response-authoring.spec.ts` — NEW, real-UI authoring +
  full product loop E2E.

## 13. Commands and results

Captured in `.artifacts/p2-text-response-authoring/{baseline,test-results}.md`
(gitignored execution evidence). Headline numbers in §9.
