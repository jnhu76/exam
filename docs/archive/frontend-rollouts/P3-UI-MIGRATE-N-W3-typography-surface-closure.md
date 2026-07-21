# UI-MIGRATE-N-W3 — Typography and Surface Debt Closure

> Wave evidence for the **Narrow Typography and Surface Debt Audit**.
> Accepted gates: `UI-MIGRATE-N-W2: PASS`, `UI-MIGRATE-N-W2 ADVERSARIAL
> REVIEW: PASS`, `UI-MIGRATE-N-W3: GO`.
>
> Starting HEAD: `018cc58`.

## A. Verdict

```text
UI-MIGRATE-N-W3: PASS
```

The wave migrated 4 proven `SECTION_TITLE` typography sites and 2 proven
`PAGE_CONTENT_SECTION` surface sites to their canonical recipes, then retired
both structural lint proxies after a per-site semantic audit proved every
remaining detector hit was false-semantic-overlap with no sound NARROW AST
boundary.

## B. Initial baseline truth

```text
W3 starting HEAD            : 018cc587f48064692b81a8ac5dd133822d7722fa
typography detector         : no-raw-typography  (text-{base,lg} + font-{semibold,bold})
typography baseline entries : 5  (ExamTopbar, QuestionHeader, DashboardPage,
                                  ExamListPage, TakeExamPage)
surface detector            : no-raw-surface-recipe  (bg-card + border + rounded-lg/rounded)
surface baseline entries    : 2  (QuestionWorkspace, TakeExamPage)
relevant recipe definitions :
  type-section-title — recipes.css:50  (1rem / 700 / 1.5rem / var(--text))
  surface-content    — surface/recipes.css:43  (var(--surface) / 1px var(--border) / var(--radius)=0.5rem)
```

Initial lint over the six baseline files: exit 0 (all entries grandfathered).

## C. Typography authority contract

`type-section-title` (recipes.css:50):

| Property | Owned value |
| --- | --- |
| font-family | `var(--font-ui)` |
| font-size | `1rem` (16px) |
| line-height | `1.5rem` |
| font-weight | `700` |
| color | `var(--text)` |
| semantic role | section heading / section title |

Authoritative consumers (all migrated to `type-section-title`):

| Consumer | Element | Semantic role | Valid authority use |
| --- | --- | --- | --- |
| `PageSection` | `<h2>` | section title | YES |
| `FormSection` | `<h2>` | section title | YES |
| `DataTableShell` | `<h2>` | section title | YES |

```text
TYPE_SECTION_TITLE_AUTHORITY_SCOPE_PROVEN:
YES
```

A page may validly select `type-section-title` directly (typography role)
without becoming a `PageSection` (container role). Recipe ownership and
component ownership are distinct.

## D. Typography node audit

Every matched node across the five baseline files, classified independently:

| File/site | Current structure | Semantic role | `type-section-title` owns it? |
| --- | --- | --- | --- |
| `ExamTopbar.tsx:38` | `<h1 truncate text-lg font-semibold text-foreground>` exam title | TOPBAR_TITLE (runtime chrome) | NO |
| `QuestionHeader.tsx:33` | `<h2 text-base font-semibold>` 第N题 | QUESTION_TITLE (repeated work-item) | NO |
| `DashboardPage.tsx:119` | `<CardTitle text-lg font-semibold>` 近期考试 | SECTION_TITLE (recent-exams block) | YES |
| `ExamListPage.tsx:117` | `<CardTitle text-lg>` exam.title (size only, no weight) | CARD label — not a detector match | n/a (out of scope) |
| `ExamListPage.tsx:237` | `<h2 text-lg font-semibold>` 可参加的考试 | SECTION_TITLE (card-group heading) | YES |
| `ExamListPage.tsx:255` | `<h2 text-lg font-semibold>` 历史考试 | SECTION_TITLE (card-group heading) | YES |
| `ExamListPage.tsx:273` | `<h2 text-lg font-semibold>` 即将开始 | SECTION_TITLE (card-group heading) | YES |
| `TakeExamPage.tsx:699` | `<div text-lg font-semibold>` 答题中/已结束 | RUNTIME_STATUS_TITLE | NO |
| `TakeExamPage.tsx:811` | `<div text-lg font-semibold text-foreground>` 时间到/自动交卷中 | OVERLAY_DEADLINE_TITLE | NO |

Heading level does not decide typography role: `QuestionHeader` uses `<h2>`
(the same level as PageSection section titles) but names a repeated
per-question work-item, not a page content section.

## E. Surface authority contract

`surface-content` (surface/recipes.css:43):

| Property | Owned value | Raw-token equivalent |
| --- | --- | --- |
| background | `var(--surface)` | `bg-card` → `--color-card` → `var(--surface)` |
| border | `1px solid var(--border)` | `border` → `--color-border` → `var(--border)` |
| radius | `var(--radius)` = `0.5rem` | `rounded-lg` (0.5rem) |
| shadow/elevation | none (hierarchy via background tier + typography + spacing) | — |
| padding | not owned (layout concern) | — |
| semantic scope | titled/untitled bordered content region | — |

Authoritative consumers (all select `surface-content`):

`PageSection`, `DataTableShell`, `FormSection`, `DataToolbar`, `ListToolbar`,
`StatsCard`. The shadcn `<Card>` primitive is an accepted low-level content
surface (Option A — never flagged, lives in `components/ui`).

```text
SURFACE_CONTENT_AUTHORITY_SCOPE_PROVEN:
YES
```

Selecting `surface-content` does not require a component migration: a
specialized workspace may consume the recipe directly while retaining its own
structure.

## F. Surface node audit

Every matched node across the two baseline files:

| File/site | Current anatomy | Semantic scope | `surface-content` owns appearance? | Component migration required? |
| --- | --- | --- | --- | --- |
| `QuestionWorkspace.tsx:27` | `<div rounded-lg border bg-card p-5 text-card-foreground>` question prompt surface | QUESTION_CONTENT_SURFACE | YES (token-equivalent) | NO — direct recipe selection |
| `TakeExamPage.tsx:735` | `<aside rounded-lg border bg-card p-3 xl:sticky xl:top-24 xl:w-24 xl:overflow-y-auto>` QuestionNavigator | SIDEBAR_SURFACE (sticky nav control shell) | NO | NO — retained |
| `TakeExamPage.tsx:798` | `<section relative rounded-lg border bg-card p-5 shadow-sm md:p-8>` take-question-section | QUESTION_CONTENT_SURFACE | YES (token-equivalent; `shadow-sm` is separate W4 debt) | NO — direct recipe selection |

## G. Characterization evidence

Focused tests added before migration, run against pre-migration code (all
passed, establishing the baseline). They assert durable role invariants — not
raw typography/surface utility strings.

| Site | Test | Pre-migration result | Invariant |
| --- | --- | --- | --- |
| `DashboardPage` 近期考试 | "keeps the 近期考试 section title naming the recent-exams block" | PASS | title present + names the Card content block |
| `ExamListPage` 可参加的考试 | "keeps the 可参加的考试 heading as a section title over its card group" | PASS | `<h2>` heading + tied to its card-group `<section>` |
| `ExamListPage` 历史考试 | "keeps the 历史考试 heading as a section title over its card group" | PASS | `<h2>` heading + tied to its card-group `<section>` |
| `QuestionWorkspace` question surface | "keeps the question content surface as a distinct region holding the prompt" | PASS | prompt inside a distinct bordered region within the workspace `<section>` |
| `TakeExamPage` question surface | "keeps the question content surface region holding the prompt and answer controls" | PASS | `take-question-section` holds prompt + reachable answer radio |

## H. Accepted typography migrations

| Site | Migration | Authority route | Normalization |
| --- | --- | --- | --- |
| `DashboardPage.tsx:119` | `CardTitle className="text-lg font-semibold"` → `type-section-title` | direct recipe selection | AUTHORITY-OWNED TYPOGRAPHY NORMALIZATION: 18px/600 → 16px/700 |
| `ExamListPage.tsx:237` | `<h2 className="text-lg font-semibold">` → `type-section-title` | direct recipe selection | AUTHORITY-OWNED TYPOGRAPHY NORMALIZATION: 18px/600 → 16px/700 |
| `ExamListPage.tsx:255` | `<h2 className="text-lg font-semibold">` → `type-section-title` | direct recipe selection | AUTHORITY-OWNED TYPOGRAPHY NORMALIZATION: 18px/600 → 16px/700 |
| `ExamListPage.tsx:273` | `<h2 className="text-lg font-semibold">` → `type-section-title` | direct recipe selection | AUTHORITY-OWNED TYPOGRAPHY NORMALIZATION: 18px/600 → 16px/700 |

Element type (`<h2>`, `<CardTitle>`), content, i18n, and layout classes
preserved. No `PageSection` introduced solely to obtain title typography.

## I. Rejected typography migrations (retained as baseline overlap)

| Site | Classification | Reason |
| --- | --- | --- |
| `ExamTopbar.tsx:38` | TOPBAR_TITLE | runtime topbar chrome / current-exam identity; not a content-section heading |
| `QuestionHeader.tsx:33` | QUESTION_TITLE | repeated domain work-item title; heading level does not decide typography role |
| `TakeExamPage.tsx:699` | RUNTIME_STATUS_TITLE | runtime status (答题中/已结束); not a content-section heading |
| `TakeExamPage.tsx:811` | OVERLAY_DEADLINE_TITLE | deadline-overlay title (时间到/自动交卷中); not a content-section heading |

These expose a layout/runtime title authority gap (no `type-*` recipe owns
topbar/question/overlay titles yet), not section-title debt.

## J. Accepted surface migrations

| Site | Migration | Authority route | Equivalence |
| --- | --- | --- | --- |
| `QuestionWorkspace.tsx:27` | `rounded-lg border bg-card` → `surface-content` | direct recipe selection (preserves `p-5 text-card-foreground`) | token-equivalent (no normalization) |
| `TakeExamPage.tsx:798` | `rounded-lg border bg-card` → `surface-content` | direct recipe selection (preserves `relative p-5 shadow-sm md:p-8`) | token-equivalent; `shadow-sm` retained (separate W4 no-business-shadow debt) |

Layout, padding, and interaction classes preserved independently of the
governed surface recipe. No `PageSection` introduced to satisfy lint.

## K. Rejected surface migrations (retained as baseline overlap)

| Site | Classification | Reason |
| --- | --- | --- |
| `TakeExamPage.tsx:735` | SIDEBAR_SURFACE | sticky QuestionNavigator control shell; distinct structural role from a page content region |

## L. Authority gaps

- **Layout/runtime title authority gap**: `TOPBAR_TITLE`, `QUESTION_TITLE`,
  `RUNTIME_STATUS_TITLE`, and `OVERLAY_DEADLINE_TITLE` have no `type-*` recipe
  owner today. They are not migrated to `type-section-title` (wrong role).
  This is a forward authority gap for a future layout/runtime typography layer,
  not W3 scope.
- No surface-authority API gap was encountered: `surface-content` direct
  selection covered every proven same-role site without a component migration.

## M. Typography lint fitness

```text
SOUND_TYPOGRAPHY_DETECTOR_EXISTS:
NO

NO_RAW_TYPOGRAPHY_LINT:
RETIRE
```

After the proven SECTION_TITLE migrations, 4/4 remaining hits were
false-semantic-overlap (TOPBAR / QUESTION / RUNTIME_STATUS / OVERLAY titles).
No sound NARROW AST boundary could distinguish SECTION_TITLE ownership from
these distinct roles: element types appear in both owner and non-owner shapes
(`PageSection` and `QuestionHeader` both use `<h2>`), and no `role`/`aria`
landmark owns the distinction (contrast `prefer-inline-error-banner`, which
narrows soundly on the authority-owned `role="alert"`). This is the same
unsoundness that retired `prefer-field-error` in
UI-FIELD-ERROR-AUTHORITY-CLOSURE-1 §8.

## N. Surface lint fitness

```text
SOUND_SURFACE_DETECTOR_EXISTS:
NO

NO_RAW_SURFACE_RECIPE_LINT:
RETIRE
```

After the proven PAGE_CONTENT_SECTION migrations, 1/1 remaining hit was a
SIDEBAR_SURFACE (false-semantic-overlap). The detector already narrowed on
panel radius (excluding `rounded-md` controls), but the sidebar uses
`rounded-lg` (the panel radius the detector keys on) and cannot be
distinguished from a content region by AST. `bg-card + border + panel-radius`
is a legitimate primitive shape for both content regions and navigation shells;
it is not an intentionally forbidden recomposition across all business roles.

## O. Baseline delta

```text
ANY_TYPOGRAPHY_BASELINE_ENTRY_REMOVED:
YES  (all 5 removed — rule retired)

ALL_TYPOGRAPHY_REMOVALS_EARNED:
YES  (4 SECTION_TITLE sites migrated; 1 file-level entry covered 3 h2 nodes)

ALL_TYPOGRAPHY_RETAINED_ENTRIES_EXPLAINED:
YES  (retained sites are distinct roles; explained in §I; rule retired so no baseline remains)

ANY_SURFACE_BASELINE_ENTRY_REMOVED:
YES  (all 2 removed — rule retired)

ALL_SURFACE_REMOVALS_EARNED:
YES  (2 PAGE_CONTENT_SECTION sites migrated; sidebar retained as distinct role)

ALL_SURFACE_RETAINED_ENTRIES_EXPLAINED:
YES  (sidebar is SIDEBAR_SURFACE; explained in §K; rule retired so no baseline remains)
```

| File | Matched nodes | Semantic verdicts | Final rule result | Baseline result |
| --- | --- | --- | --- | --- |
| `DashboardPage.tsx` | 1 (SECTION_TITLE) | migrated | rule retired | array removed |
| `ExamListPage.tsx` | 3 (SECTION_TITLE) | migrated | rule retired | array removed |
| `ExamTopbar.tsx` | 1 (TOPBAR_TITLE) | retained — distinct role | rule retired | array removed |
| `QuestionHeader.tsx` | 1 (QUESTION_TITLE) | retained — distinct role | rule retired | array removed |
| `TakeExamPage.tsx` (typ) | 2 (RUNTIME/OVERLAY) | retained — distinct roles | rule retired | array removed |
| `QuestionWorkspace.tsx` | 1 (QUESTION_CONTENT_SURFACE) | migrated | rule retired | array removed |
| `TakeExamPage.tsx` (surf) | 2 (1 migrated, 1 SIDEBAR) | 1 migrated, 1 retained | rule retired | array removed |

No new baseline entries. Shadow and arbitrary-typography baseline arrays
untouched.

## P. Same-role search

Bounded search over the full business scope for additional raw
section-title / surface-content recomposition:

```text
UNREGISTERED_SECTION_TITLE_BYPASS_FOUND:
NO  (the only remaining text-{base,lg}+font-{semibold,bold} combos are the 4 retained distinct-role sites)

UNREGISTERED_SURFACE_CONTENT_BYPASS_FOUND:
NO  (the only remaining bg-card+border+rounded-lg combo is the retained SIDEBAR aside)
```

No newly discovered files were migrated outside W3's registered scope.

## Q. Test-count provenance

```text
previous suite total  : 813   (after the W3 characterize+migrate commit)
− deleted tests       : 40    (no-raw-typography.test.ts + no-raw-surface-recipe.test.ts)
− deleted tests       : 4     (4 baseline-behavior grandfather/new-violation tests for the retired rules)
+ added tests         : 0     (retirement commit)
= final suite total   : 769   (77 files)
```

W3 added 5 characterization tests (in the migrate commit: +1 DashboardPage,
+2 ExamListPage, +1 QuestionWorkspace, +1 TakeExamPage). The retirement commit
removed 44 tests (the two rule test files + the four baseline-behavior cases
that exercised those rules). Net W3 delta vs the W2 end state (808): +5
characterization, −44 retired-rule = −39 (808 → 769). No unexplained delta.

## R. Verification

Final committed HEAD — isolated verification:

```text
pnpm lint:eslint       : exit 0
pnpm --filter @exam/web test : 769 passed, 0 failures, 0 collection errors
```

## S. Changed files and commits

```text
de0b357 refactor(ui): migrate proven typography and surface authorities
        — 4 typography + 2 surface migrations; 5 characterization tests
<retire> fix(ui-lint): retire unsound no-raw-typography and no-raw-surface-recipe
        — rules, tests, wirings, baseline arrays removed; recipe authority retained
<docs>   docs(ui): record typography and surface migration evidence
        — this document; AGENTS.md, lint-readiness-report, agent-construction-guide,
          surface-vocabulary, Foundation-plan reconciled
```

## T. Final invariants

```text
ALL_REGISTERED_TYPOGRAPHY_NODES_AUDITED:
YES

EVERY_TYPOGRAPHY_MIGRATION_SAME_ROLE:
YES

NO_TOPBAR_PAGE_QUESTION_OR_CONTROL_TITLE_FORCED_TO_SECTION_RECIPE:
YES

ALL_REGISTERED_SURFACE_NODES_AUDITED:
YES

EVERY_SURFACE_MIGRATION_SAME_ROLE:
YES

NO_SPECIALIZED_CONTROL_OR_WORKSPACE_FORCED_TO_CONTENT_SURFACE:
YES

NO_RAW_TYPOGRAPHY_LINT_DECISION:
RETIRE

NO_RAW_SURFACE_RECIPE_LINT_DECISION:
RETIRE

ALL_TYPOGRAPHY_REMOVALS_EARNED:
YES

ALL_SURFACE_REMOVALS_EARNED:
YES

NO_SHADOW_OR_ARBITRARY_TYPOGRAPHY_DEBT_TOUCHED:
YES

NO_NEW_BASELINE_ENTRY_ADDED:
YES

TEST_COUNT_DELTA_FULLY_ATTRIBUTED:
YES

FINAL_VERIFICATION_BELONGS_TO_FINAL_COMMITTED_HEAD:
YES
```

Every YES/NO invariant is YES; both lint decisions are RETIRE. PASS.

## U. Next gate

```text
UI-MIGRATE-N-W4:
READY FOR ELEVATION / ARBITRARY TYPOGRAPHY AUDIT
```

W4 scope is the `no-business-shadow` and `no-arbitrary-typography` baseline
families, which W3 deliberately did not touch.
