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
| `type-section-title` | 3 | `PageSection`, `FormSection`, `DataTableShell` (committed canonical-recipe migration) |
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
it became `type-section-title`. The authoritative components
(`PageSection`/`FormSection`/`DataTableShell`) are committed to
`type-section-title` (UI-LINT-2-CORRECTIVE-2), but the primitive stack is
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
`DataTableShell` for tables. The shadcn `Card` primitive (in `components/ui`,
excluded from lint) carries `rounded-xl bg-card text-card-foreground` by
default, and is used in many business files. **The Card question is RESOLVED
(Option A):** see §2.5 — `<Card>` is a legitimate low-level `components/ui`
primitive, not a bypass. The rule targets only the hand-rolled recomposition in
business/layout scope, never `<Card>` itself.

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
| `surface-content` | ✅ | ✅ `PageSection`/`DataTableShell`/`FormSection`/toolbars/`StatsCard` | ❌ components migrated, but **only 1 page-level consumer** (committed `AttemptDetailPage` result-summary section; plus `shared.test.tsx`) | ✅ **GATED (narrow)** — Card decision RESOLVED (Option A); rule active on the hand-rolled recomposition only (see §2.5a) |
| `surface-attention` | ✅ | ✅ `InlineErrorBanner`/`ErrorState`/`EmptyState` | partial | not gated in Phase 2 (covered by component rules in Phase 3) |
| `surface-overlay` / `surface-navigation` / `surface-page` / `surface-subtle` | ✅ | ✅ (layout/shadcn) | ✅ (centralized) | not gated (no business recomposition risk) |

#### 2.5a Card decision — RESOLVED (Option A)

The previously-open Card question is now **RESOLVED**:

```text
Option A: <Card> is a legitimate low-level components/ui primitive.
```

- `<Card>` is **never** flagged by `exam-ui/no-raw-surface-recipe`. Its
  `bg-card` / `border` / `rounded-xl` classes live in the generated shadcn
  primitive `components/ui/card.tsx`, which is excluded from exam-ui lint scope
  by the flat-config `ignores` (and by `components/ui` being the generated
  layer agents must not hand-edit). Business pages may freely use `<Card>` as a
  low-level content primitive.
- The rule targets the **hand-rolled recomposition** in governed business/layout
  scope — a `className` expression containing `bg-card` + `border` + a panel
  radius (`rounded-lg` / base `rounded`) on the same element. That stack
  reproduces `surface-content` outside the owning component, and is detectable
  because all three primitives appear in one literal/template `className`.
- Control radii (`rounded-md` / `rounded-sm`) are deliberately excluded so a
  control block such as `ExamTimer` is not a false positive.

Why `components/ui` is outside the business reconstruction rule's enforcement
target: `components/ui` is the generated shadcn primitive layer. The visual
authority model treats it as the lowest building block (it is where
`surface-overlay` / `Card` / `Button` live), not as business consumer code. The
`exam-ui/*` rules apply to `src/pages`, `src/components/{shared,exam,settings,question}`,
and (minus the shadow rule) `src/components/layout` — never `src/components/ui`.

The stale "must be resolved before activating the rule" / "CONDITIONAL — gated
on resolving the `<Card>` question" language that appeared here and in §2.3 has
been corrected: the rule is active (error severity in `eslint.config.ts`), and
the Card decision is closed.

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
| domain status | `StatusBadge` + `statusMeta` | `<Badge className="bg-…">` / `<span>` for a value that **is** a `statusMeta` key (a lifecycle/diagnostic status) | 0 remaining audited `statusMeta` bypasses — two previously-cited sites were same-domain duplicates and have been **repaired** in UI-LINT-2-CORRECTIVE-2: `ProctorDashboardPage` misconduct severity (now `<StatusBadge status={`misconduct_${severity}`} />`) and `ExamMonitoringPage` attempt-status label (now derived via `getStatusMeta`). The remaining cited sites (`AttemptDetailPage` event-tone, `ExamMonitoringPage` online/warning) map **non-status** domains (audit action / online-state / warning-level) and are NOT `statusMeta` bypasses; see `P3-UI-LINT-2-phase3-authority-bypass-decision.md` §1 | **DEFERRED** — genuine status-color bypasses are dynamic-`className`/data-flow (not statically token-detectable) and collide with categorical `<Badge>` (question type/tags, explicitly NOT a status). Enforced by review and migration. |
| field error | `FieldError` | `<p text-{sm,xs} text-destructive>` | 0 unmigrated same-role debt | **RETIRED** — `exam-ui/prefer-field-error` was retired in UI-FIELD-ERROR-AUTHORITY-CLOSURE-1 (§8). Its structural recipe (`<p> + text-destructive + text-size`) could not deterministically distinguish FieldError ownership from DOMAIN_WARNING / CONTROL_STATE_FEEDBACK / INLINE_OPERATION_ERROR (4/4 remaining hits were false-semantic-overlap). FieldError remains the canonical authority; ownership is enforced by semantic migration review, not a structural lint proxy. |
| inline error banner | `InlineErrorBanner` | `<div rounded + destructive-surface>` | 4 files (grandfathered) | **ALREADY ACTIVE** (`exam-ui/prefer-inline-error-banner`) |
| confirmation dialog | `ConfirmDialog` | — | 0 bypasses | not gated (no bypass evidence) |
| content container | `PageSection` | `<Card shadow-sm><CardHeader><CardTitle text-base font-semibold>` | ≥8 pages | **NO** — blocked on `PageSection` migration coverage (2 consumers; UI-PILOT-1) |
| metric | `StatsCard` | `<p text-2xl font-bold>` | 20 occurrences across 5 pages | **NO** — blocked on `StatsCard` migration (1 consumer; UI-MIGRATE-N) |
| form block | `FormSection` | — | low | NO (1 consumer) |

### 3.3 Component-bypass readiness verdict

The **status-color** role has a strong authority (`statusMeta` + `StatusBadge`).
The semantic-ownership audit (`P3-UI-LINT-2-phase3-authority-bypass-decision.md`
§1) originally classified all previously-cited sites as distinct non-status
domains; UI-LINT-2-CORRECTIVE-2 corrected two of them as same-domain
duplicates and repaired them: `ProctorDashboardPage` misconduct severity
(`misconduct_warning`/`misconduct_serious` are `statusMeta` keys) and
`ExamMonitoringPage` attempt-status label (`statusMeta` owns the `labelKey`).
The remaining cited sites map distinct non-status input domains (audit action,
online-state, warning-level) that merely reuse the `StatusTone` color
vocabulary — legitimate local presentation policy, not bypasses owed to
`statusMeta`. A genuine status-color bypass (a hand-rolled color for a value
that *is* a `statusMeta` key) remains possible, but enforcing it by lint is
data-flow-bound and collides with categorical `<Badge>` (question type/tags),
so it is enforced by review and migration, not by a deterministic rule. The
other roles (PageSection, StatsCard) are blocked on migration coverage and are
**not** activated.

---

## 4. Existing lint baseline state (Phase 4 debt registry)

Current `apps/web/src/lint/exam-ui/baseline.json` (deterministic-debt contract),
after UI-LINT-2 Phases 1–2 and UI-FIELD-ERROR-AUTHORITY-CLOSURE-1:

| Rule | Baseline entries | Debt shape |
| --- | ---: | --- |
| `exam-ui/prefer-inline-error-banner` | 4 | `destructive-surface\|rounded` per file |
| `exam-ui/no-arbitrary-typography` | 1 | `ExamTimer.tsx::text-[11px]` |
| `exam-ui/no-business-shadow` | 7 | `shadow-sm` per file |
| `exam-ui/no-raw-typography` | 5 | `font-weight\|text-size` per file (section-title bypass) |
| `exam-ui/no-raw-surface-recipe` | 2 | `bg-card\|border\|panel-radius` per file (surface-content bypass) |

> `exam-ui/prefer-field-error` was retired in UI-FIELD-ERROR-AUTHORITY-CLOSURE-1
> (§8). Its baseline array was removed; it is no longer an active deterministic
> rule. See §4.4-reconciled below for the per-site semantic classification.

The baseline is **small and explicit** — 19 total entries across 5 active rules,
each entry a real file-level signature. This satisfies the Phase 4 rule: "small
explicit debt list" — **no bulk file ignores, no thousands of ignored files.**
The full per-entry debt registry follows. Each entry records the four required
fields (location / reason / owner / migration plan).

### 4.1 Debt registry — `exam-ui/no-raw-typography` (5 entries, added Phase 1)

| Location | Reason | Owner | Migration plan |
| --- | --- | --- | --- |
| `components/exam/ExamTopbar.tsx` | runtime topbar title `text-lg font-semibold` (page-title role, not section-title) | UI-PILOT-1 (exam runtime) | route through `type-page-title` (topbar already has a heading role) when the exam-runtime page migrates |
| `components/exam/QuestionHeader.tsx` | question-section title `text-base font-semibold` | UI-PILOT-1 | replace with `type-section-title` or wrap in a section component |
| `pages/admin/DashboardPage.tsx` | `CardTitle text-lg font-semibold` | UI-MIGRATE-N | migrate titled `<Card>` block to `PageSection` (drops the bypass) |
| `pages/exam/ExamListPage.tsx` (3 nodes) | card list section titles `text-lg font-semibold` | UI-MIGRATE-N | migrate list section to `PageSection`/`DataTableShell` |
| `pages/exam/TakeExamPage.tsx` (2 nodes) | exam-runtime section titles `text-lg font-semibold` | UI-PILOT-1 (exam runtime) | route through `type-section-title` |

### 4.2 Debt registry — `exam-ui/no-raw-surface-recipe` (2 entries, added Phase 2)

| Location | Reason | Owner | Migration plan |
| --- | --- | --- | --- |
| `components/exam/QuestionWorkspace.tsx` | hand-rolled `rounded-lg border bg-card p-5` content surface | UI-PILOT-1 (exam runtime) | select `surface-content` (or wrap in `PageSection`/`Card`) |
| `pages/exam/TakeExamPage.tsx` (2 nodes) | exam question area + sidebar `rounded-lg border bg-card` | UI-PILOT-1 (exam runtime) | select `surface-content` |

### 4.3 Debt registry — `exam-ui/no-business-shadow` (7 entries, UI-LINT-1)

| Location | Reason | Owner | Migration plan |
| --- | --- | --- | --- |
| `pages/admin/DashboardPage.tsx` | `<Card shadow-sm>` | UI-MIGRATE-N | drop `shadow-sm` on `PageSection` migration |
| `pages/admin/ExamDetailPage.tsx` (10 nodes) | `<Card shadow-sm>` stat cards | UI-MIGRATE-N | migrate stat cards to `StatsCard` (flat) + titled blocks to `PageSection` |
| `pages/admin/ProctorDashboardPage.tsx` | `<Card shadow-sm>` | UI-MIGRATE-N (Phase2 proctor) | drop on migration |
| `pages/admin/ScoreListPage.tsx` (7 nodes) | `<Card shadow-sm>` stat cards | UI-MIGRATE-N | migrate to `StatsCard` |
| `pages/admin/SystemDiagnosticsPage.tsx` (8 nodes) | `<Card shadow-sm>` stat cards | UI-MIGRATE-N | migrate to `StatsCard` |
| `pages/exam/ExamListPage.tsx` | `<Card shadow-sm>` | UI-MIGRATE-N | drop on `PageSection` migration |
| `pages/exam/TakeExamPage.tsx` | exam question area `shadow-sm` | UI-PILOT-1 | drop — it is already `surface-content` |

### 4.4 Reconciled — former `exam-ui/prefer-field-error` sites (rule RETIRED)

`exam-ui/prefer-field-error` was retired in UI-FIELD-ERROR-AUTHORITY-CLOSURE-1
(§8/§9). The original blanket classification "inline field error → replace with
`FieldError`" was disproven by the seven-site semantic audit: the structural
recipe (`<p> + text-destructive + text-size`) matched four distinct non-FieldError
semantic roles. The per-site classification that replaced the blanket debt
registry is below. Only the same-role sites migrate to `FieldError`; the others
are routed to their correct owners.

| Former baseline site | Semantic role (verified) | FieldError owner? | Final status |
| --- | --- | --- | --- |
| `components/exam/ExamConfigForm.tsx` — `timeError` | FIELD_CONTROL_VALIDATION | YES | migrated → `<FieldError>` (UI-MIGRATE-N-W1) |
| `components/exam/ExamConfigForm.tsx` — `scoreError` | FIELD_CONTROL_VALIDATION | YES | migrated → `<FieldError>` (UI-MIGRATE-N-W1) |
| `components/exam/ExamConfigForm.tsx` — `showWarning` | DOMAIN_WARNING (manual-total ≠ computed-sum advisory; no `role="alert"`) | NO | retained — distinct domain-warning role, no authority today |
| `components/exam/QuestionRenderer.tsx` — unsupportedType | CONTROL_STATE_FEEDBACK (default switch case, no owning control) | NO | retained — distinct unsupported-type role, no authority today |
| `components/exam/SubjectiveAnswerInput.tsx` — `error` | FIELD_CONTROL_VALIDATION | YES | migrated → `<FieldError id={helpId}>` (CLOSURE-1 §7; required the `id` API extension) |
| `pages/admin/CandidateFieldsPage.tsx` — `mutationError` | INLINE_OPERATION_ERROR (dialog save/delete API failure) | NO | routed to UI-MIGRATE-N-W2 (InlineErrorBanner wave) |
| `pages/admin/CandidatesPage.tsx` — `saveError` | INLINE_OPERATION_ERROR (dialog save API failure) | NO | routed to UI-MIGRATE-N-W2 (InlineErrorBanner wave) |
| `pages/admin/GradingDetailPage.tsx` — validation error | FIELD_CONTROL_VALIDATION | YES | migrated → `<FieldError>` (UI-PILOT-1) |

Three distinct non-FieldError categories that the lint recipe falsely conflated
with field-error debt:

```text
true FieldError same-role debt            → migrate to FieldError (done)
lint recipe false-semantic-overlap        → NOT FieldError debt; correct owner per role
authority API blocked same-role debt      → FieldError id extension unblocked it (done)
```

FieldError ownership is now enforced by semantic migration review against
`P3-UI-component-authority.md` §2 and the authority component tests
(`FieldError.test.tsx`), not by a structural lint proxy.

### 4.5 Debt registry — `exam-ui/prefer-inline-error-banner` (4 entries, UI-LINT-1)

| Location | Reason | Owner | Migration plan |
| --- | --- | --- | --- |
| `components/exam/ExamTimer.tsx` | destructive control surface | UI-PILOT-1 | evaluate vs `InlineErrorBanner` (may be a distinct control role) |
| `pages/LoginPage.tsx` | inline destructive banner | UI-MIGRATE-N | replace with `<InlineErrorBanner>` |
| `pages/admin/ExamDetailPage.tsx` | inline destructive banner | UI-MIGRATE-N | replace with `<InlineErrorBanner>` |
| `pages/exam/StartExamPage.tsx` | inline destructive banner | UI-PILOT-1 | replace with `<InlineErrorBanner>` |

### 4.6 Debt registry — `exam-ui/no-arbitrary-typography` (1 entry, UI-LINT-1)

| Location | Reason | Owner | Migration plan |
| --- | --- | --- | --- |
| `components/exam/ExamTimer.tsx` | `text-[11px]` timer label | UI-PILOT-1 | route through `type-metadata` or `type-numeric` recipe |

### Phase 4 verdict

The baseline is compliant: 25 explicit entries, zero bulk ignores, every entry
has a documented location / reason / owner / migration plan. Entries are removed
as their owning migration task (UI-PILOT-1, UI-MIGRATE-N) clears each bypass —
the `baseline.json` file shrinks as debt is paid, never grows except by explicit
reviewed addition.

---

## 5. Phase activation plan (summary)

Derived from the readiness verdicts above. Each phase activates a rule **only**
when the four prerequisites hold (authority exists / replacement exists /
migration coverage / false-positive risk understood).

> **Terminology note:** "Phase 1 / 2 / 3 / 4" in this section and in the rule
> header comments (`Phase 1 (UI-LINT-2)`, `Phase 2 (UI-LINT-2)`) refer to
> **UI-LINT-2 implementation stages** — the staged activation of individual
> `exam-ui/*` rules inside the UI-LINT-2 work item. They are NOT product phase
> labels (Phase 1 / Phase 2 of the exam-platform roadmap). A rule marked
> "Phase 1 (UI-LINT-2)" means "the first UI-LINT-2 activation stage".

| Phase (UI-LINT-2 stage) | Rule | Status |
| --- | --- | --- |
| **Phase 1 (UI-LINT-2)** | `exam-ui/no-raw-typography` (section-title bypass only) | ✅ **ACTIVE (error)** — `type-section-title` recipe + 3 migrated component consumers + low false-positive for weight+size stack. Metric bypass **deferred** (blocked on `StatsCard` migration). |
| **Phase 2 (UI-LINT-2)** | `exam-ui/no-raw-surface-recipe` (`surface-content` recomposition) | ✅ **ACTIVE (error)** — Card decision RESOLVED (Option A: `<Card>` stays a low-level primitive, never flagged). Rule targets the hand-rolled `bg-card` + `border` + panel-radius recomposition in governed business/layout scope only (see §2.5a). |
| **Phase 3 (UI-LINT-2)** | `exam-ui/no-authority-bypass` | ⚠️ **PARTIAL** — field-error and inline-error-banner sub-roles are **already active** (UI-LINT-1). Status-color sub-role: see the semantic-ownership boundary in `P3-UI-LINT-2-phase3-authority-bypass-decision.md` — two same-domain duplicates (ProctorDashboard misconduct severity, ExamMonitoring attempt-status label) were repaired in UI-LINT-2-CORRECTIVE-2; the remaining audited sites are **not** `statusMeta` bypasses (distinct semantic domains reusing the `StatusTone` vocabulary), so no migration is owed there. Deterministic lint enforcement of genuine status-color bypasses remains data-flow-bound and deferred. PageSection/StatsCard sub-roles are **blocked on migration coverage**. Phase 3 activates zero new rules. |
| **Phase 4 (UI-LINT-2)** | Baseline cleanup | ✅ Current baseline is already small/explicit; new rules add their own grandfathered debt with the same per-entry discipline. |

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

Documentation-only. The static gate verifies that all static checks pass:

```bash
pnpm lint:eslint
pnpm verify:static
```

(Results: exit 0 — all static checks pass.)
