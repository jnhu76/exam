# P3-UI-PILOT-1 — GradingDetailPage Representative Migration Evidence

Status: **PASS** (post-pilot record). This document is the durable evidence
record for the UI-PILOT-1 representative page migration pilot, committed as
the third of the three UI-PILOT-1 commits.

Pilot page: `apps/web/src/pages/admin/GradingDetailPage.tsx`

This is a **semantic-authority migration pilot**, not a visual redesign. Its
purpose is to prove that one real, behaviorally non-trivial page can be
migrated from primitive/local presentation composition to the existing UI
authorities while preserving observable behavior and reducing registered UI
debt — and, equally, to prove where an authority does **not** apply.

It does **not** begin broad `UI-MIGRATE-N`.

---

## A. Verdict

```text
UI-PILOT-1: PASS
```

---

## B. Initial page role inventory

| Site (GradingDetailPage.tsx) | Current structure / classes | Semantic role | Authority candidate | Final classification |
| --- | --- | --- | --- | --- |
| page header | `<PageHeader title description status actions>` | page heading | `PageHeader` | already authoritative — preserved |
| header status | `<StatusBadge status={gradingStatus}>` | domain status (grading) | `statusMeta` / `StatusBadge` | already authoritative — preserved (`pending_manual` / `fully_graded` owned by `statusMeta`) |
| per-question card | `<Card><CardHeader><CardTitle text-base>` + body (answer / score / comment / save) | titled arbitrary content section, one per question | `PageSection` | **evaluated → NOT APPLICABLE** (see §F + §I) |
| `CardTitle className="text-base"` | shadcn `CardTitle` + `text-base` | section title | `PageSection` title | rides on the per-question decision above — NOT APPLICABLE |
| candidate-answer well | `<div type-long-response min-h-16 rounded-md border bg-muted/30 p-3>` | read-only long candidate text | `type-long-response` recipe (already owns typography) | already authoritative for typography; border/bg/radius are structural inline-cell layout, not a standalone surface region — preserved |
| score field block | `<div space-y-2>` + `<Label>` + `<Input>` | form field, no separate authority | primitives | preserved |
| **validation `<p>`** | `<p className="text-sm text-destructive">` | **field/control validation failure** | `FieldError` | **migrated → `<FieldError>`** (see §E) |
| comment field block | `<div space-y-2>` + `<Label>` + `<Textarea>` | form field, no validation error role | primitives | preserved |
| save row | `<div flex items-center gap-2>` + Button + graded span | action footer + metadata | structural / primitives | preserved |
| load-failure state | `<ErrorState>` | page/resource load error | `ErrorState` | already authoritative — preserved |
| loading state | `<LoadingState>` | page loading | `LoadingState` | already authoritative — preserved |

---

## C. Observable behavior invariants

Derived from code + tests. UI-PILOT-1 is valid only if all of these survive.

| Behavior | Evidence | Preserved |
| --- | --- | --- |
| initial loading state | `isLoading` → `<LoadingState/>` ("加载中...") | YES |
| load-failure state | `<ErrorState message="加载评分详情失败" onRetry>` | YES |
| null/empty response | `<ErrorState message="评分数据加载异常，请重试" onRetry>` | YES |
| header title / description / status / back | `<PageHeader>` | YES |
| per-question title = `q.content` | rendered text | YES |
| `满分: N` · `主观题` subtitle | two-part inline metadata row | YES (unchanged structure) |
| candidate answer cell | `data-testid=grading-candidate-answer-{id}`, `type-long-response`, plain text | YES |
| score input | `data-testid=grading-score-input-{id}`, number, min/max | YES |
| validation error text | "分数不能超过满分 (N)" / "分数不能为负数" | YES (now via `<FieldError>`) |
| error ↔ score-control association | error rendered inside the score field block | YES (same DOM position) |
| **error cleared after valid save** | `handleSave` deletes the error key on the success path | YES — protected by new characterization test |
| **error scoped to its own question** | per-question `validationErrors[questionId]` | YES — protected by new characterization test |
| comment textarea | `data-testid=grading-comment-input-{id}` | YES |
| save button + disabled-while-saving | `data-testid=grading-save-btn-{id}` | YES |
| save → POST `/grade-question` `{questionId, score, comment}` | unchanged | YES |
| success / fully-graded / failure toasts | sonner `toast.success` / `toast.error` | YES (no new inline banner introduced) |
| "已评分: N 分" record span | rendered when `q.entry` present | YES |
| XSS: answer rendered as plain text | React escaping | YES |

---

## D. Characterization tests

Two characterization tests were added to
`apps/web/src/pages/admin/GradingDetailPage.test.tsx` **before** migration and
confirmed green on the pre-migration code, then re-confirmed green after
migration. They protect observable behavior, not primitive class stacks.

| Test | Behavior protected |
| --- | --- |
| `clears the field validation error after a subsequent valid save` | the field-validation feedback is cleared from the score control once a valid save succeeds (guards the `&&`-gating → `<FieldError>` falsy-swallow equivalence) |
| `scopes the score validation error to its own question` | a validation failure on one question's score control does not surface as feedback on a different question's control (guards per-question error ownership across any DOM restructuring) |

Pre-migration: 28/28 green. Post-migration: 28/28 green.

---

## E. Semantic migrations

| Old structure | Role | Authority | Why valid |
| --- | --- | --- | --- |
| `<p className="text-sm text-destructive">{validationErrors[q.questionId]}</p>` (gated by `&&`) | field/control validation failure | `<FieldError>` | Input domain = `validationErrors[questionId]` (a per-score-control validation result); decision dimension = save rejection. `FieldError` owns exactly the field-validation-failure role. `<FieldError>` swallows falsy children (returns `null`), which is behaviorally equivalent to the old `&&` gate — the error node is absent when there is no error and present (as a `<p role="alert">`) when there is. Layout placement is unchanged (same position in the score field block). |

This was the **only** migration applied. No other authority substitution was made.

---

## F. Rejected migrations (authorities deliberately NOT used)

### PageSection — per-question grading cards

**Decision: NOT APPLICABLE.**

The per-question cards were evaluated for migration to `PageSection` and
rejected on a semantic-ownership basis, not a visual-shape basis.

`PageSection` is the page-level content-section authority with a stable
anatomy of **title + explanatory description + section actions + arbitrary
body + footer**. Its `description` is secondary explanatory prose; its
`actions` slot owns section operations.

The per-question grading card has a different scope: it is a **repeated
domain work item** whose header carries **structured question metadata**
(`满分: N` · `主观题` — a two-part inline metadata row with a separator).
That structured-metadata role maps to neither `description` (prose) nor
`actions` (operations). Forcing it into `description` or `actions` would
change the information hierarchy to satisfy a component shape, which is
exactly the visual-shape-only substitution this pilot forbids.

The Card primitive is a legitimate low-level surface; keeping it here is not
a bypass.

### StatsCard

**Decision: NO GENUINE STATSCARD ROLE ON PILOT PAGE.**

The page has no KPI / summary-metric role. The score input is a numeric
**input control**, not a metric display; the "已评分: N 分" span is a factual
record, not a KPI with label + value + trend. StatsCard was not adopted and
no metric presentation was manufactured to improve migration coverage.

### InlineErrorBanner

**Decision: NOT APPLICABLE.**

The page's only save-failure feedback is a sonner `toast.error`, which is
deliberately not rendered inline on the page. There is no inline
operation/section destructive banner to migrate.

### FormSection / DataTableShell

**Decision: NOT APPLICABLE.**

There is no table. The per-question fields are not gathered into a single
form-semantic block (each question is a mixed display+form content item);
they are not a `FormSection` role.

### ErrorState / LoadingState / PageHeader / StatusBadge

Already authoritative on the page; preserved unchanged.

---

## G. Authority assessment

| Authority | Applicable to GradingDetailPage? | Used? | Evidence |
| --- | --- | --- | --- |
| `PageHeader` | YES (page heading) | YES (pre-existing) | header title/description/status/actions |
| `PageSection` | evaluated → NOT APPLICABLE (per-question cards are repeated metadata work items, not page-level content sections) | NO | §F; §I gap |
| `FormSection` | NO | NO | no form-semantic grouping block |
| `DataTableShell` | NO | NO | no table |
| `StatsCard` | NO (no genuine metric role) | NO | §F |
| `FieldError` | YES (score-control validation failure) | **YES — migrated** | §E |
| `InlineErrorBanner` | NO (save failure is a toast, not an inline banner) | NO | §F |
| `StatusBadge` / `statusMeta` | YES (grading status) | YES (pre-existing) | `gradingStatus` routed through `statusMeta` |

**Authority contract gap?** See §I.

---

## H. Baseline debt delta

| Rule | Before | After | Delta |
| --- | --- | --- | --- |
| `exam-ui/prefer-field-error` | entry `apps/web/src/pages/admin/GradingDetailPage.tsx::text-destructive\|text-size` | entry removed | **−1** |

Evidence: with the page migrated to `<FieldError>`, the page contains no `<p>`
with a destructive text utility + a text-size utility. The rule (which exempts
`FieldError.tsx` itself by filename) finds no violation in
`GradingDetailPage.tsx`, and `pnpm lint:eslint` (which runs at
`--max-warnings=0`) exits 0 after the baseline entry is removed.

No other baseline entries were touched. No replacement baseline entries were
added.

---

## I. Authority contract gaps

One uncovered authority gap surfaced and is reported for post-pilot authority
review (NOT created in UI-PILOT-1):

```text
repeated grading/review item with title + structured metadata + body
→ no authoritative component today
```

Concretely: a repeated domain work item (here, one per grading question)
whose header is a **title plus structured inline metadata** (maxScore + type,
with a separator) and whose body mixes read-only display with form controls.
`PageSection`'s anatomy (title + prose description + section actions) does
not own a structured-metadata header role; `FormSection` is form-block
scoped; `DataTableShell` is table scoped. None proven to own this role.

This gap is recorded, not worked around. UI-PILOT-1 did **not** create a new
component from this single consumer.

---

## J. Verification (this record; final committed-HEAD proof is in §K)

| Command | Exit code | Result |
| --- | ---: | --- |
| `pnpm lint:eslint` | 0 | no violations |
| `pnpm --filter @exam/web test` | 0 | 801 / 801 passed (was 799; +2 characterization tests) |
| `pnpm verify:static` | 0 | 17/17 tasks (format, code-quality, copy, arch, db-config, eslint, typecheck, openapi) |

---

## K. Changed files and commits

```text
AttemptDetailPage.tsx excluded from all commits
```

The working tree at pilot start was clean except for untracked `.zcode/`; the
expected unrelated dirty `AttemptDetailPage.tsx` migration was not present in
the working tree, so there was nothing to preserve there. `AttemptDetailPage.tsx`
was never staged or touched by UI-PILOT-1.

UI-PILOT-1 commits:

```text
test(ui): characterize grading detail pilot behavior
refactor(ui): migrate grading detail field-error authority
docs(ui): record representative migration evidence
```

The baseline entry removal ships together with the production migration
commit (single authority role, single debt owner); per pilot §13 a separate
baseline-cleanup commit is optional and was not required here.

### Final committed-HEAD verification

Final proof belongs to the final committed HEAD and was produced in an
isolated detached worktree bootstrapped with
`pnpm install --frozen-lockfile && pnpm build`, then:

```text
pnpm lint:eslint          → exit 0
pnpm --filter @exam/web test → 801/801 passed, zero collection failures
pnpm verify:static        → exit 0
```

(Detached-worktree transcript captured in the pilot session; the three
commands above all exited 0.)

---

## L. Final invariants

```text
PILOT_PAGE_ONLY:                                               YES
BUSINESS_BEHAVIOR_PRESERVED:                                   YES
SEMANTIC_ROLES_CLASSIFIED_BEFORE_MIGRATION:                    YES
NO_VISUAL_SHAPE_ONLY_COMPONENT_SUBSTITUTION:                   YES
NO_NEW_UI_AUTHORITY_CREATED:                                   YES
REGISTERED_DEBT_REDUCED_OR_EXPLICITLY_PROVEN_NOT_APPLICABLE:   YES
FINAL_VERIFICATION_BELONGS_TO_FINAL_COMMITTED_HEAD:            YES
UNRELATED_ATTEMPT_DETAIL_DIRTY_WORK_PRESERVED:                 YES
```

All eight YES → PASS.

---

## M. Next gate

```text
UI-PILOT-1: READY FOR ADVERSARIAL REVIEW
```

UI-MIGRATE-N is **not** begun. The PageSection-structured-metadata gap in §I
is the first candidate for post-pilot authority review before any broad
migration pass.
