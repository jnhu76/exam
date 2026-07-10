# P3-UI-LINT-2-0 — UI Lint Readiness Audit

> Phase 0 coverage audit for UI-LINT-2 (`docs/frontend/P3-UI-Foundation-plan.md`).
>
> This is an **analysis-only** document. It measures current adoption of the
> semantic visual authorities (typography recipes, surface recipes, authoritative
> components) and classifies the remaining primitive-utility usage, so that each
> future lint rule in UI-LINT-2 can be activated only when its semantic
> replacement is **proven** (authority exists → replacement exists → migration
> coverage exists → false-positive risk understood).
>
> No enforcement, recipe, component, token, or source file was changed to
> produce this document. It establishes the baseline against which UI-LINT-2
> Phases 1–3 activate.

---

## How to read this report

- **Scope of all counts:** business / feature source only, i.e.
  `apps/web/src/{pages,components/shared,components/exam,components/settings,components/question}/**`.
  This is exactly the `businessGlobs` set in `apps/web/eslint.config.ts`.
  `components/ui` (generated shadcn primitives), `components/layout` (topbar
  elevation), `typography/`, `surface/`, and `lint/` are excluded — they are
  the authority implementations, not business consumers.
- **Counts are occurrence counts** of the matched token across files, unless
  noted as "file counts". They measure *adoption surface*, not exact call sites.
- **`type-*` / `surface-*` recipe counts** include their own recipe CSS/vocab
  definitions in `src/typography/` and `src/surface/`; the business-consumer
  count is listed separately where it matters.

---

## 1. Typography readiness

### 1.1 Semantic recipe adoption (business consumers)

Recipe inventory from `apps/web/src/typography/recipes.css` (11 recipes):
`type-page-title`, `type-page-description`, `type-section-title`, `type-body`,
`type-secondary`, `type-metadata`, `type-reading`, `type-long-response`,
`type-metric`, `type-numeric`, `type-code`.

| Recipe | Business-consumer occurrences | Primary consumer |
| --- | ---: | --- |
| `type-section-title` | 3 | `PageSection`, `FormSection`, `DataTableShell` (in-flight migration) |
| `type-page-title` | 3 | `PageHeader` (+ consistency tests) |
| `type-long-response` | 3 | `GradingDetailPage`, `CoursePage` |
| `type-secondary` | 2 | `StatsCard`, `PageSection` description |
| `type-page-description` | 2 | `PageHeader` |
| `type-metric` | 2 | `StatsCard` (+ recipe tests) |
| `type-metadata` | 2 | `StatsCard` trend |
| `type-reading` | 1 | `TakeExamPage` question stem |
| `type-body` | 0 | — |
| `type-numeric` | 0 | — |
| `type-code` | 0 | — |

**Total semantic recipe uses in business scope:** ~18 occurrences. The recipes
exist and are wired into the authoritative components, but **direct call-site
adoption is still early** — most pages still reach for primitive `text-*` /
`font-*` utilities.

### 1.2 Primitive typography usage in business scope

| Family | Count | Classification |
| --- | ---: | --- |
| `text-sm` | 110 | mostly **safe primitive** (body-ish text); some are semantic-typography bypass |
| `font-medium` | 50 | mixed: layout weight + some section-title bypass |
| `text-xs` | 35 | mostly metadata/secondary; some field-error overlap |
| `font-bold` | 21 | **semantic bypass** — metric/numeric titles |
| `text-base` | 17 | **semantic bypass** — section-title candidates |
| `text-2xl` | 14 | **semantic bypass** — metric size |
| `text-lg` | 9 | **semantic bypass** — section-title at page scale |
| `font-semibold` | 12 | **semantic bypass** — section-title + page-title |
| `text-3xl` | 5 | **semantic bypass** — metric size |
| `font-normal` | 7 | safe primitive |
| `text-xl` | 1 | reading bypass candidate |
| `text-5xl` | 1 | metric size (ResultPage total score) |
| `leading-tight` / `leading-none` | 1 each | safe primitive (layout) |
| `tracking-*` | 0 | none (no tracking bypass) |

### 1.3 High-confidence semantic-typography bypass patterns

These are the patterns a `no-raw-typography` rule would target — a primitive
stack that reproduces a recipe's owned properties. Two bypass recipes have
enough evidence to gate:

#### (a) Section-title bypass — `text-{base,lg} font-semibold`

The exact pattern `text-base font-semibold` was the section-title recipe before
it became `type-section-title`. It is mid-migration in the authoritative
components (uncommitted in `PageSection`/`FormSection`/`DataTableShell`) but
still present in **business pages**:

```text
src/pages/exam/ExamListPage.tsx:237   <h2 className="text-lg font-semibold">
src/pages/exam/ExamListPage.tsx:255   <h2 className="text-lg font-semibold">
src/pages/exam/ExamListPage.tsx:273   <h2 className="text-lg font-semibold">
src/pages/admin/DashboardPage.tsx:119 <CardTitle className="text-lg font-semibold">
src/components/exam/QuestionHeader.tsx:33 <h2 className="text-base font-semibold">
src/pages/exam/TakeExamPage.tsx:699   <div className="text-lg font-semibold">
src/pages/exam/TakeExamPage.tsx:811   <div className="text-lg font-semibold text-foreground">
src/components/exam/ExamTopbar.tsx:38 <h1 className="truncate text-lg font-semibold text-foreground">
```

**Readiness:** ✅ recipe exists (`type-section-title`); consumers exist (the
three section components); false-positive risk is **low** for the
`text-{base,lg} font-semibold` combination on heading-like elements. The risk
is that `text-base font-semibold`/`text-lg font-semibold` also appears on
non-heading structural text — so the rule must scope to a weight+size stack,
not to a single utility. See Phase 1 plan.

#### (b) Metric bypass — `text-{2xl,3xl,4xl,5xl} font-bold (+ tabular-nums)`

The `type-metric` recipe owns weight + tabular-nums (not size). The bypass is a
large size utility combined with `font-bold` (and often `tabular-nums`) that
reproduces a KPI/stat number. 20 occurrences across 5 pages:

```text
src/pages/exam/StartExamPage.tsx:164   text-2xl font-semibold (page-title h1 — NOT metric)
src/pages/exam/ResultPage.tsx:106      text-5xl font-bold (metric)
src/pages/exam/ExamSettingsPage.tsx:9  text-2xl font-semibold (page-title h1 — NOT metric)
src/pages/admin/ScoreListPage.tsx      text-2xl font-bold ×5 (metric)
src/pages/admin/ExamDetailPage.tsx     text-2xl font-bold ×6 (metric)
src/pages/admin/SystemDiagnosticsPage.tsx:491 text-3xl font-bold (metric)
src/pages/admin/AttemptDetailPage.tsx  text-3xl font-bold tabular-nums ×3 (metric)
```

**Readiness:** ⚠️ recipe exists (`type-metric`) and the component authority
(`StatsCard`) exists, BUT `StatsCard` has **only 1 business consumer**
(`shared.test.tsx`). The 20 metric call sites have **not migrated** to
`StatsCard` — this is the component-authority "STAT-CARD-DRIFT" finding, which
is explicitly deferred to UI-MIGRATE-N. A `no-raw-typography` rule that flags
metric-size+bold would create ~20 violations with no migrated replacement yet.

**Decision:** `type-metric` / metric bypass is **NOT activated** in Phase 1. It
is blocked on `StatsCard` migration coverage (UI-MIGRATE-N / UI-PILOT-1). Until
then, only the **section-title** bypass (which has migrated authoritative
consumers) is gated.

### 1.4 Typography readiness verdict

| Recipe | Recipe exists | Authoritative consumer exists | Migration coverage | Phase 1 gate? |
| --- | --- | --- | --- | --- |
| `type-section-title` | ✅ | ✅ `PageSection`/`FormSection`/`DataTableShell` | ✅ 3 components migrated | **YES** |
| `type-page-title` | ✅ | ✅ `PageHeader` (10 consumers) | ✅ | (covered by PageHeader; bare `text-2xl font-bold` is metric, not page-title — not gated to avoid collision) |
| `type-page-description` | ✅ | ✅ `PageHeader` | ✅ | covered by PageHeader adoption |
| `type-metric` | ✅ | ✅ `StatsCard` | ❌ 1 consumer, 20 bypasses unmigrated | **NO** (blocked on StatsCard migration) |
| `type-body` / `type-secondary` / `type-metadata` | ✅ | partial (StatsCard) | ❌ no broad page migration | NO (too broad, high false-positive) |
| `type-reading` / `type-long-response` | ✅ | partial | partial | NO (narrow; defer) |
| `type-numeric` / `type-code` | ✅ | ❌ no migrated consumer | ❌ | NO |

---

## 2. Surface readiness

### 2.1 Semantic recipe adoption (business consumers)

Recipe inventory from `apps/web/src/surface/recipes.css` (6 recipes):
`surface-page`, `surface-content`, `surface-subtle`, `surface-navigation`,
`surface-overlay`, `surface-attention`.

| Recipe | Business-consumer occurrences | Primary consumer |
| --- | ---: | --- |
| `surface-content` | 7 | `PageSection`, `DataTableShell`, `FormSection`, `DataToolbar`, `ListToolbar`, `StatsCard` |
| `surface-attention` | 1 | `InlineErrorBanner` |

**Total semantic surface uses in business scope:** 8. The recipes are wired into
the authoritative components, but — as with typography — the authoritative
components are themselves early in adoption.

### 2.2 Primitive surface usage in business scope

| Family | Count | Classification |
| --- | ---: | --- |
| `bg-muted` | 11 | legitimate primitive (table/subtle regions) |
| `bg-destructive/10` | 9 | attention surface (feedback) — component-owned |
| `bg-background` | 8 | page canvas — token, legitimate |
| `bg-warning/10`, `bg-warning-soft`, `bg-warning` | 5 | feedback soft fills — legitimate |
| `bg-card` | 5 | **surface-content bypass candidate** |
| `bg-success*` | 8 | feedback — legitimate |
| `bg-primary*` | 13 | interactive/selected state — legitimate |
| `border` (bare) | 35 | default border — legitimate primitive |
| `border-*` colors | ~30 | legitimate (destructive/primary/dashed accents) |
| `rounded-md` | 22 | control radius — legitimate primitive |
| `rounded-lg` | 17 | panel radius — **surface-content component** |
| `rounded` (base) | 6 | legitimate primitive |
| `shadow-sm` | 30 | **business-shadow debt** (already enforced forward; see below) |

### 2.3 The `surface-content` recomposition

The bypass a `no-raw-surface-recipe` rule would target is a business page that
recomposes the `surface-content` recipe by hand:

```text
bg-card + border + rounded-lg   (+ optional shadow-sm / padding)
```

Files where `bg-card` appears in business scope:

```text
src/pages/exam/TakeExamPage.tsx          (2 — exam question area)
src/components/exam/SaveIndicator.tsx    (1)
src/components/exam/QuestionWorkspace.tsx (1)
src/components/exam/ExamTimer.tsx        (1)
```

These overlap with `border` + `rounded-lg` recomposition. The component
authority is clear: `PageSection` owns this surface for arbitrary content,
`DataTableShell` for tables. **But:** the shadcn `Card` primitive (in
`components/ui`, excluded from lint) carries `rounded-xl bg-card text-card-foreground`
by default, and is used in 18 business files (`<Card>` usage counts: 40/32/26/…
across admin/exam pages). The unresolved question is whether `<Card>` is a
legitimate primitive the lint must allow (Option A) or a deprecated surface
that must migrate to `PageSection` (Option B). **This must be resolved before
activating the rule.** See Phase 2 plan.

### 2.4 Elevation — `no-business-shadow` is already active

The `exam-ui/no-business-shadow` rule (UI-LINT-1) is **already enforcing** the
forward elevation rule: no new `shadow-*` in business content. The current debt
is fully grandfathered in `baseline.json`:

```text
exam-ui/no-business-shadow baseline (7 files):
  DashboardPage, ExamDetailPage, ProctorDashboardPage, ScoreListPage,
  SystemDiagnosticsPage, ExamListPage, TakeExamPage
```

> **`StatsCard` note (verified):** the component-authority doc (EXTEND) lists
> `StatsCard` as carrying `shadow-sm`. That debt is **already cleared**: today
> `StatsCard` selects `surface-content` and is deliberately flat — the only
> remaining `shadow-sm` text in `StatsCard.tsx` is an explanatory comment
> documenting *why* it stays flat ("carries a default shadow-sm … a metric and
> a shadow are orthogonal concerns"). No `className` on `StatsCard` carries a
> shadow utility, so it is correctly absent from the baseline. The 7-file
> baseline above is the complete current business-shadow debt.

### 2.5 Surface readiness verdict

| Recipe | Recipe exists | Authoritative consumer exists | Migration coverage | Phase 2 gate? |
| --- | --- | --- | --- | --- |
| `surface-content` | ✅ | ✅ `PageSection`/`DataTableShell`/`FormSection`/toolbars/`StatsCard` | ❌ components migrated, but **only 2 page-level consumers** (`AttemptDetailPage` in-flight) | **CONDITIONAL** — gated on resolving the `<Card>` question (Option A/B) |
| `surface-attention` | ✅ | ✅ `InlineErrorBanner`/`ErrorState`/`EmptyState` | partial | not gated in Phase 2 (covered by component rules in Phase 3) |
| `surface-overlay` / `surface-navigation` / `surface-page` / `surface-subtle` | ✅ | ✅ (layout/shadcn) | ✅ (centralized) | not gated (no business recomposition risk) |

---

## 3. Component-bypass readiness

### 3.1 Authoritative component adoption (consumer file counts)

| Component | Consumer files | Role |
| --- | ---: | --- |
| `LoadingState` | 27 | full-area loading |
| `ErrorState` | 26 | full-area error |
| `PageHeader` | 10 | page header |
| `StatusBadge` | 9 | domain status |
| `InlineErrorBanner` | 6 | inline error banner |
| `FieldError` | 5 | field validation error |
| `PageSection` | 2 | content container |
| `StatsCard` | 1 | metric presentation |
| `FormSection` | 1 | form block |
| `DataTableShell` | 1 | table container |
| `DataToolbar` | 1 | table toolbar |
| `ListToolbar` | 1 | list toolbar |
| `EmptyState` | 1 | empty placeholder |
| `ConfirmDialog` | 0 | confirmation dialog |

The high-adoption components (`LoadingState`, `ErrorState`, `PageHeader`,
`StatusBadge`, `InlineErrorBanner`, `FieldError`) are the ones with enough
migration coverage to defend a bypass rule. The low-adoption components
(`PageSection`, `StatsCard`, `FormSection`, `DataTableShell`) are still in the
migration ramp-up — their bypass rules are gated on UI-PILOT-1 / UI-MIGRATE-N.

### 3.2 Bypass patterns and readiness per role

| Role | Authority | Bypass pattern | Bypass count | Phase 3 gate? |
| --- | --- | --- | --- | --- |
| domain status | `StatusBadge` + `statusMeta` | `<Badge className="bg-…">` for domain state | `AttemptDetailPage` event-tone map; categorical `Badge` (question type/tags) is NOT a bypass | **CONDITIONAL** — status-color rule, but must distinguish domain status from categorical labels (high false-positive risk). Gated narrowly. |
| field error | `FieldError` | `<p text-{sm,xs} text-destructive>` | 6 files (grandfathered) | **ALREADY ACTIVE** (`exam-ui/prefer-field-error`) |
| inline error banner | `InlineErrorBanner` | `<div rounded + destructive-surface>` | 4 files (grandfathered) | **ALREADY ACTIVE** (`exam-ui/prefer-inline-error-banner`) |
| confirmation dialog | `ConfirmDialog` | — | 0 bypasses | not gated (no bypass evidence) |
| content container | `PageSection` | `<Card shadow-sm><CardHeader><CardTitle text-base font-semibold>` | ≥8 pages | **NO** — blocked on `PageSection` migration coverage (2 consumers; UI-PILOT-1) |
| metric | `StatsCard` | `<p text-2xl font-bold>` | 20 occurrences across 5 pages | **NO** — blocked on `StatsCard` migration (1 consumer; UI-MIGRATE-N) |
| form block | `FormSection` | — | low | NO (1 consumer) |

### 3.3 Component-bypass readiness verdict

Only the **status-color** role has both a strong authority (`statusMeta` +
`StatusBadge`) and a documented bypass (`AttemptDetailPage` event-tone). But it
is also the highest-false-positive role: categorical `<Badge>` (question type,
tags) is explicitly **not** a status and must be allowed. A status-color rule
therefore requires element/context heuristics that are **not high-confidence
enough** for deterministic lint today. **Phase 3 activates it narrowly or
defers it.** The other roles (PageSection, StatsCard) are blocked on migration
coverage and are **not** activated.

---

## 4. Existing lint baseline state

Current `apps/web/src/lint/exam-ui/baseline.json` (deterministic-debt contract):

| Rule | Baseline entries | Debt shape |
| --- | ---: | --- |
| `exam-ui/prefer-field-error` | 6 | `text-destructive\|text-size` per file |
| `exam-ui/prefer-inline-error-banner` | 4 | `destructive-surface\|rounded` per file |
| `exam-ui/no-arbitrary-typography` | 1 | `ExamTimer.tsx::text-[11px]` |
| `exam-ui/no-business-shadow` | 7 | `shadow-sm` per file |

The baseline is **small and explicit** (18 total entries across 4 rules), each
entry a real documented bypass. This satisfies the Phase 4 rule: "small
explicit debt list" — no bulk file ignores. New rules added in UI-LINT-2 must
follow the same baseline discipline.

---

## 5. Phase activation plan (summary)

Derived from the readiness verdicts above. Each phase activates a rule **only**
when the four prerequisites hold (authority exists / replacement exists /
migration coverage / false-positive risk understood).

| Phase | Rule | Gate status |
| --- | --- | --- |
| **Phase 1** | `exam-ui/no-raw-typography` (section-title bypass only) | ✅ **READY** — `type-section-title` recipe + 3 migrated component consumers + low false-positive for weight+size stack. Metric bypass **deferred** (blocked on `StatsCard` migration). |
| **Phase 2** | `exam-ui/no-raw-surface-recipe` (`surface-content` recomposition) | ⚠️ **CONDITIONAL** — must first resolve the `<Card>` primitive question (Option A: Card stays primitive → lint protects pages; Option B: Card deprecated → migration required). Detection of `bg-card + border + rounded-lg (+ shadow-sm)` is well-defined; the gate is the Card decision, not the detection. |
| **Phase 3** | `exam-ui/no-authority-bypass` | ⚠️ **PARTIAL** — field-error and inline-error-banner sub-roles are **already active** (UI-LINT-1). Status-color sub-role is high-false-positive (categorical `Badge` is not a status) and is **deferred or activated very narrowly**. PageSection/StatsCard sub-roles are **blocked on migration coverage**. |
| **Phase 4** | Baseline cleanup | ✅ Current baseline is already small/explicit; new rules add their own grandfathered debt with the same per-entry discipline. |

---

## 6. Out of scope (explicit)

This audit did **not**:

- add, remove, or change any lint rule, baseline entry, recipe, token, or CSS;
- create, delete, rename, merge, or migrate any component or consumer;
- change any test or test coverage;
- migrate any page.

Only this documentation file was produced.

---

## 7. Verification

Documentation-only. The static gate is run to prove nothing was disturbed.

```bash
pnpm lint:eslint
pnpm verify:static
```

(Results recorded in the UI-LINT-2 final report.)
