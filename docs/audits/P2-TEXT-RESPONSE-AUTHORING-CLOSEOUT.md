# P2 Text Response Authoring Closeout

Closeout date: 2026-07-31
Branch: `feat/p2-text-response-authoring-closeout`
Base: `master` @ `eb06a36d` (PR #236 merged)
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

- Base is `master` @ `eb06a36d` (PR #236 merged, the `p1-grading-operator-closeout`
  branch is no longer the active base).
- PR #236 was merged; this branch is based on the merged result.
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
  attempt's grading basis. **Proven by integration test** (API-level: publish
  → PATCH live question → start attempt → submit → grading-details shows
  frozen values, not live-edit values).
- The one-time manual-scoring model and terminal closure are unchanged.

## 4. Question form changes

- `QuestionForm.tsx`: render an optional multiline **reference-answer**
  Textarea for `text_response`; type-switch into `text_response` always
  clears `standardAnswer` to `null` (minimal safe semantics — preserving
  the string would carry objective answers like `"A"` from single_choice
  into the reference field). Rubric is cleared on switch to objective types
  (the same as all other type-specific fields — no "preservation" claim).
- `CourseSearchSelect.tsx` (NEW): searchable course selector replacing the
  plain `<Select>`. Supports search input → `GET /api/courses?search=...`
  with debounce. In edit mode, if the question's courseId is not in the
  loaded list, it is fetched separately via `GET /api/courses/:id`.
- `QuestionEditPage.tsx`: course list loads the first page only (pageSize=20);
  the searchable CourseSearchSelect handles finding courses beyond the first
  page. Edit mode separately fetches the question's course if not in the
  loaded list.
- Backend: `courseRepo.ts` now exposes `listFiltered` with `search` parameter
  (case-insensitive substring match on `name` and `code`). The `GET /courses`
  API accepts an optional `?search=` query parameter.
- i18n (`zh-CN.ts`): `referenceAnswer` / placeholder / hint; course search
  placeholder / searching / no-results messages.

Tests (`QuestionEditPage.test.tsx`): forward reference answer;
whitespace→null (parameterized); edit readback of multiline reference;
cross-type isolation (single_choice→text_response, fill_blank→text_response,
text_response→single_choice, text_response→objective→text_response round-trip);
re-entry test replaced with cross-type isolation (Radix Select does not fire
onValueChange for same value, so re-entry was a no-op).

## 5. Create/edit/readback symmetry

Already PROVEN for objective types; extended for text_response:

- Create payload reaches POST with `type/options/standardAnswer/rubric`
  correct (existing + updated tests).
- Edit GET reads `rubric` (P3-MOD-P2-1C) AND the optional reference answer
  (new tests + E2E).
- PATCH round-trips; reload-after-edit confirms persistence (E2E).
- No stale fields leak when switching objective ↔ text_response. Type
  switch clears `standardAnswer` to `null` for text_response (minimal safe
  semantics — objective answers like `"A"` or `"TCP"` are never carried
  into the reference field). Cross-type isolation tested for both directions
  and the round-trip (text_response → objective → text_response).

## 6. Publish and snapshot authority

`test(exam): prove text response publish clarity and snapshot freeze`
(`8ee3c053`, engine unit tests, +3):

- The `publishExam` reject message for a text_response missing its rubric
  **names the offending question id** (so an admin authoring several items can
  locate the bad one — not a bare "publish failed").
- The frozen `QuestionSnapshot` carries the optional reference answer exactly
  as authored.
- A post-publish live-question edit does NOT mutate an already-published
  snapshot (freeze authority) — proven by:
  - Engine unit test: side-by-side `buildQuestionSnapshot` comparison.
  - **API integration test**: publish → PATCH live question → start attempt →
    submit → grading-details shows frozen (original) values, not live-edit
    values. This proves the snapshot persistence chain through the repository
    and grading-details projection.

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
  metadata still absent. **Save and submit response statuses asserted** to
  prevent false-green if the save/submit silently failed.
- **negative control**: admin grading-details DO contain the frozen rubric +
  reference, proving the leak test is not a false-green from data never stored.
- **snapshot freeze integration test**: publish → PATCH live question →
  start attempt → submit → grading-details shows frozen values, not
  live-edit values.

## 8. End-to-end product proof

`test(e2e): cover subjective authoring product loop` (`2db07a12`)

The first E2E that creates a `text_response` through the **real QuestionForm**
(not seedExam). The test covers the full product loop with this scope:

- **Question authoring (UI)**: create + edit + readback + list filter (API)
- **Candidate answering (UI)**: start exam → see prompt without rubric/reference
  → answer multiline plain text → submit
- **Exam assembly, publishing, enrollment, grading (API)**: these steps use
  API helpers to consume the UI-authored entity
- **Grading queue (API)**: after submit, verifies the attempt appears in the
  admin grading queue with `pendingQuestionCount = 1`, proving the submit →
  manual-grading pipeline works (not just direct API access to a known
  attemptId).

Product flow:

```text
Admin UI: 新增题目 → select 文本作答题 via CourseSearchSelect (trigger
  labelled 所属课程, targeted by name — not DOM order) →
  content + multiline rubric + multiline reference answer → save
  (payload: rubric + reference, options: [])
  → bank list + UI type filter (按题型筛选 → 文本作答题) reach it
  → edit round-trips rubric + reference; rubric/content edit persists across
    a fresh edit-page GET, reference preserved
→ API assembles an exam with the UI-authored question and publishes it
  (publishExam accepts the non-empty UI rubric)
→ candidate (enrolled via API) starts (UI), sees the prompt, does NOT see
  rubric / reference (UI + API-level leak guard), answers multiline plain
  text (UI), submits (UI)
→ admin Grading Queue UI shows the attempt (queue row testid → detail page),
  with pendingQuestionCount = 1 — real queue discovery, not a known-id API jump
→ admin grading-details (API) show the frozen UI-authored rubric + reference +
  the candidate's frozen answer
→ admin completes manual grading (API) → graded + fully_graded
→ candidate result visible (API) with score identity
```

The E2E proves **real UI question authoring + the list-page type filter +
candidate answering + grading-queue discovery** through the actual pages.
Exam assembly, enrollment, grading completion, and the grading-details
projection read use API helpers — the loop may consume the UI-authored
entity via API; the authoring, filter, answer, and queue-discovery surfaces
are UI-driven. Exam Create UI and Enrollment UI are not exercised in this
spec — they are covered by separate E2E specs (exam-lifecycle, etc.).

The `text_response` type filter is verified through the **real list-page UI
Select** (`按题型筛选 → 文本作答题`), whose trigger carries an `aria-label`
so it is targetable by role+name (not DOM order). Grading-queue discovery is
verified through the **real Grading Queue page** (row `data-testid=
grading-queue-row-<attemptId>` → click → detail page), not a known-id API
jump to grading-details.

The test uses a seed course ("基础安全培训") instead of creating a new one,
avoiding CI flakiness when parallel shards may create 100+ courses. The
**searchable CourseSearchSelect** component (used by the admin UI, trigger
labelled `所属课程`) can find courses beyond the initial page; if more than
100 courses match a search term (the contract page cap), the dropdown shows a
visible truncation hint rather than silently hiding the rest.

Verified GREEN via `bash scripts/e2e/run-wsl.sh text-response-authoring` on
both shards (exit 0). CI green on PR #237.

## 9. Test evidence

| Command | Exit | Result |
| --- | --- | --- |
| `pnpm --filter web vitest run src/pages/admin/QuestionEditPage.test.tsx` | 0 | 30 passed (was 21; +9; option-A leak test fixed to a real radio selection) |
| `pnpm --filter web vitest run src/components/question/CourseSearchSelect.test.tsx` | 0 | 3 passed (NEW: a11y label + truncation hint shown/hidden) |
| `pnpm --filter web vitest run src/pages/admin/QuestionPage.test.tsx src/components/exam/QuestionRenderer.test.tsx` | 0 | 5 passed |
| `pnpm --filter @exam/exam-engine vitest run src/examCommands.test.ts` | 0 | 60 passed (was 57; +3) |
| `pnpm --filter api vitest run src/routes/attempts/candidate-take-text-response.test.ts` | 0 | 4 passed (now asserts publish status in beforeAll) |
| `pnpm --filter api vitest run src/routes/course.test.ts` | 0 | 10 passed (search length bound, no regression) |
| `pnpm verify:static` | 0 | format + lint + copy + arch + db-config + env-contract + repo-contract + ui-gates + eslint + typecheck + openapi all pass |
| `bash scripts/e2e/run-wsl.sh text-response-authoring` | 0 | 2/2 shards pass (real-UI authoring + UI type filter + UI grading-queue discovery) |
| `pnpm verify` | 0 | (coverage + build) |

Every command was run with a real exit code; no GREEN claim is made without a run.

## 10. Per-capability verdict

| Capability | Result | Evidence |
| --- | --- | --- |
| text_response selectable | CLOSED | QuestionForm.tsx type selector; QuestionPage filter; constants TYPE_VARIANT |
| rubric authoring | CLOSED | QuestionForm rubric Textarea; save-time + publish-time validation |
| optional reference answer | CLOSED | (this closeout) QuestionForm reference Textarea; blank→null; edit readback |
| create/edit/readback | CLOSED | QuestionEditPage GET/POST/PATCH; QuestionEditPage.test.tsx + E2E |
| question list filtering | CLOSED | QuestionPage type filter (trigger `aria-label=按题型筛选`); E2E drives the UI Select |
| exam publish (consumes UI-authored question) | CLOSED | E2E publishes an exam containing the UI-authored question (API) |
| candidate metadata isolation | CLOSED | contract + projection + .parse(); candidate-take-text-response.test.ts |
| candidate answering | CLOSED | QuestionRenderer → TextResponseInput; E2E multiline answer + submit |
| grading queue discovery | CLOSED | E2E: Grading Queue UI row (`grading-queue-row-<id>`) → detail page; pendingQuestionCount=1 |
| manual grading (consumes frozen answer) | CLOSED | E2E: submit → pending_manual queue → frozen answer/rubric/reference |
| snapshot freeze (persistence) | CLOSED | API integration test: publish → PATCH live → attempt → grading-details shows frozen values |
| final score | CLOSED | E2E: grade → graded + fully_graded; result totalScore identity |
| course search (beyond first page) | CLOSED | CourseSearchSelect (trigger `aria-label=所属课程`) + API `?search=`; truncation hint when >100 match |
| selector accessibility (stable names) | CLOSED | CourseSearchSelect + list type filter carry role+name; E2E targets by name, not DOM order |

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
- Course search is capped at the contract page size (100 matches); beyond
  that a truncation hint is shown (no infinite-scroll / pagination loop in
  the dropdown). 100+ courses matching a single term is an extreme edge case.
- No `pg_trgm` GIN index for course search (CodeRabbit suggestion) —
  premature for Phase-1 course volumes; deferred to a future perf pass.
- No full keyboard listbox navigation for `CourseSearchSelect`
  (active-option state, Arrow/Enter, `aria-activedescendant`) — a genuine
  a11y improvement, but a new behavior surface deferred to a follow-up.
- Exam Create UI and Enrollment UI are not exercised in this E2E spec.

## 12. Files changed

Production (6):
- `apps/web/src/components/question/QuestionForm.tsx` — optional reference-
  answer field; type-switch clears standardAnswer (minimal safe semantics).
- `apps/web/src/components/question/CourseSearchSelect.tsx` — NEW searchable
  course selector with debounced search API.
- `apps/web/src/pages/admin/QuestionEditPage.tsx` — reference-answer blank→null
  normalization; fetch course by ID in edit mode if not in loaded list.
- `apps/web/src/i18n/locales/zh-CN.ts` — referenceAnswer + course search labels.
- `apps/api/src/routes/course.ts` — `GET /courses` accepts `?search=` parameter.
- `packages/db/src/repository/courseRepo.ts` — NEW `listFiltered` method with
  case-insensitive search on `name` and `code`.

Tests (4):
- `apps/web/src/pages/admin/QuestionEditPage.test.tsx` — +9 text_response
  reference-answer tests (forward, whitespace→null, edit readback, cross-type
  isolation for both directions, round-trip cleanup).
- `packages/exam-engine/src/examCommands.test.ts` — +3 publish-clarity +
  snapshot-freeze tests.
- `apps/api/src/routes/attempts/candidate-take-text-response.test.ts` — NEW,
  4 tests (3 API-level leak + 1 snapshot freeze integration).
- `apps/e2e/e2e/text-response-authoring.spec.ts` — NEW, real-UI authoring +
  candidate answering + API-driven assembly/grading + grading queue discovery.

## 13. Commands and results

Captured in `.artifacts/p2-text-response-authoring/{baseline,test-results}.md`
(gitignored execution evidence). Headline numbers in §9.