# P3-UI-COMP-1 — Component Authority

> Authority for the shared visual components of the Exam frontend
> (UI-COMP-1). This document reconciles the existing shared components in
> `apps/web/src/components/shared/` against the semantic visual vocabulary
> (`apps/web/src/typography/typography-vocabulary.md`) and the accepted visual
> audit (`docs/frontend/P3-UI-AUDIT-0-frontend-visual-language-audit.md`).
>
> This is an **analysis + authority definition** document. No production code,
> component, styling, dependency, or lint rule was changed to produce it. The
> decisions here are the authority that future UI work must follow; the
> migrations themselves belong to later tasks (UI-PILOT-1, UI-MIGRATE-N).
>
> Source of evidence: line-by-line reading of every file in
> `apps/web/src/components/shared/`, `apps/web/src/lib/statusMeta.ts`,
> representative pages in `apps/web/src/pages/`, plus consumer/bypass searches
> across the `apps/web/src` tree.

---

## 1. Authority rules

A component is an **authoritative** owner of a visual role only if it owns one
or more of:

```text
semantic meaning
stable anatomy
interaction behavior
accessibility contract
variant contract
visual ownership
```

A component is **not** authoritative merely because JSX is duplicated, it looks
similar, it wraps Tailwind classes, or it has a generic name. The question is
always: **what semantic decision does this component own?**

Two components must not independently claim the same visual role without an
explicit semantic distinction documented in this file.

A component's visual ownership is scoped. A component may own a recipe
selection (e.g. `PageHeader` owns `type-page-title`) without owning the raw
font properties — those remain owned by the semantic recipes
(`apps/web/src/typography/recipes.css`). Conversely, a typography recipe is
owned by the recipe layer, not by any single component.

### Classification vocabulary

Every reviewed component receives exactly one decision:

| Decision | Meaning |
| --- | --- |
| **KEEP** | Owns a stable, distinct semantic role. Retained as the authority. |
| **EXTEND** | Owns a valid role but is incomplete (missing variant / a11y / responsive). Role authority is retained; gaps are migration work. |
| **MERGE** | Two components own the same semantic role with same users/anatomy/semantics. One absorbs the other. |
| **RENAME** | Current name actively conflicts with semantic meaning. Rename only for semantic clarity, never aesthetics. |
| **DEMOTE** | Not a semantic authority (generic wrapper / styling convenience). May remain in code but loses authority status. |
| **REMOVE** | Unused / duplicate / unsafe. (Not performed in this task — decisions recorded for later.) |
| **ROLE UNKNOWN** | Evidence insufficient to assign a role. Do not force false certainty. |

---

## 2. Confirmed authorities

These components own a distinct semantic role and are retained as the
authoritative owner for that role. They are the components a future agent must
reuse; bypassing them is the drift the audit documented.

| Role | Authority component | Authority backing |
| --- | --- | --- |
| page header (single page title + description + status + actions) | `PageHeader` | `type-page-title` / `type-page-description` recipes |
| domain status presentation | `StatusBadge` + `statusMeta.ts` + `statusMetaUtils.ts` | status → tone mapping (single source of truth) |
| form field validation error | `FieldError` | `role=alert` + critical text |
| inline destructive error banner | `InlineErrorBanner` | `role=alert` + destructive surface recipe |
| full-area loading placeholder | `LoadingState` | `role=status` + `aria-busy` + spinner |
| empty-data placeholder | `EmptyState` | icon + title + description + action |
| full-area error placeholder | `ErrorState` | `role=alert` + retry affordance |
| generic confirmation dialog | `ConfirmDialog` | `AlertDialog` shell + trigger + confirm/cancel |
| tabular-data shell | `DataTableShell` | titled/toolbar/footer content container with `overflow-hidden` |
| data-table operation toolbar | `DataToolbar` | `role=toolbar` + filter/action/summary slots |
| data-table pagination | `DataTablePagination` | page window + summary + prev/next |
| table row action group | `RowActions` | `role=group` + leading/children/trailing slots |
| controlled search input | `SearchInput` | leading icon + clear button + i18n defaults |
| form field layout primitives | `FieldGroup` / `Field` / `FieldRow` / `FieldStack` / `FormStack` | vertical/grid field spacing recipes |

### Decision detail — confirmed authorities

#### `PageHeader` — KEEP

- **Semantic role:** the single header of a page. Owns the strongest
  non-numeric hierarchy (`type-page-title`) plus its description
  (`type-page-description`), an inline status slot, and an actions slot.
- **Anatomy:** `<header>` → title row (title + status) + description; actions
  pinned to the end. Responsive `flex-col sm:flex-row`.
- **Owned behavior / a11y:** responsive stacking; no semantic landmark beyond
  the `h1` (the heading rank is owned here — pages must not emit a second
  `h1`).
- **Variants:** none (intentionally flat).
- **Typography:** owns the recipe **selection** for `type-page-title` and
  `type-page-description`; does not own font properties.
- **Consumers:** 23 admin pages — universal adoption.
- **Known bypasses:** `StartExamPage` / `ResultPage` / `ExamSettingsPage`
  emit their own `h1` (audit §9 vocabulary, flagged `page-title` consumers).
  These bypass the component but still owe the `type-page-title` recipe.
- **Decision rationale:** distinct role, high adoption, owns a heading-rank
  contract. KEEP. No EXTEND needed — responsive description handling is
  already present.

#### `StatusBadge` — KEEP

- **Semantic role:** domain status presentation. The single presentation
  component over the `statusMeta.ts` → tone mapping.
- **Anatomy:** `<span data-status-tone>` → icon + i18n label.
- **Owned behavior / a11y:** tone derived from `statusMeta`; `data-status-tone`
  for testing; icon `aria-hidden`; label via `t(statusLabelKey(...))`.
- **Variants:** `showIcon` boolean; tone contract from `StatusTone` union.
- **Authority backing:** `statusMeta.ts` (status → labelKey/tone/icon),
  `statusMetaUtils.ts`. Typography vocabulary explicitly REJECTS a `status`
  typography recipe — status is a component + mapping authority, never a
  `type-*` recipe.
- **Consumers:** 10 pages.
- **Known bypasses (status-color drift, audit defect #5):**
  - `AttemptDetailPage` renders timeline events via `<Badge className={eventToneClass[...]}>`
    — a hand-rolled tone map parallel to `statusMeta`.
  - `QuestionPage` renders question type via `<Badge variant={TYPE_VARIANT[...]}>`
    and tags via `<Badge variant="outline">`.
  - `AttemptDetailPage` / `CandidatesPage` use plain `text` or `<Badge>`
    for boolean/pass-fail states.
  - **Note:** not every `<Badge>` is a bypass. `QuestionPage` type/tag badges
    are *categorical labels*, not domain statuses — they are legitimately not
    `StatusBadge`. The bypass is only where a **domain status** is rendered
    without `statusMeta` + `StatusBadge`.
- **Decision rationale:** the strongest authority in the codebase (explicit
  three-layer mapping). KEEP.

#### `FieldError` — KEEP

- **Semantic role:** form field validation error.
- **Anatomy:** `<p role=alert>` critical text; renders nothing when empty.
- **Owned behavior / a11y:** `role=alert` (assertive), `text-destructive`.
- **Typography:** reuses secondary/`xs` size + critical color; the vocabulary
  explicitly REJECTS a `field-error` *typography* recipe — the authority is
  this component.
- **Consumers:** `LoginPage`, `CandidatesPage`, `CoursePage`, `SettingsPage`,
  `UsersPage`, `ExamConfigForm`.
- **Known bypasses (field-error drift):** `GradingDetailPage:236`
  (`text-sm text-destructive`), `CandidateFieldsPage`, `QuestionRenderer`,
  `SubjectiveAnswerInput`, `ExamDetailPage`, parts of `ExamConfigForm`.
  Note: the former `exam-ui/prefer-field-error` lint rule was **retired** in
  UI-FIELD-ERROR-AUTHORITY-CLOSURE-1 (§8) — its structural recipe could not
  deterministically distinguish FieldError ownership from DOMAIN_WARNING /
  CONTROL_STATE_FEEDBACK / INLINE_OPERATION_ERROR roles. The same-role bypasses
  (`GradingDetailPage`, `ExamConfigForm` time/score, `SubjectiveAnswerInput`)
  have been migrated to `FieldError`; the non-owner sites are routed to their
  correct roles. FieldError ownership is now enforced by semantic migration
  review + the authority component tests, not by a structural lint proxy.
- **Decision rationale:** distinct role, has an accessibility contract the
  bypass recipes lack (`role=alert`). KEEP.

#### `InlineErrorBanner` — KEEP

- **Semantic role:** inline destructive error banner — a block-level,
  bordered notice for form/submit/validation failures.
- **Anatomy:** `<div role=alert>` → destructive border + `bg-destructive-soft`
  + destructive text.
- **Owned behavior / a11y:** `role=alert`; destructive surface recipe.
- **Consumers:** `CandidateFieldsPage`, `ExamCreatePage`, `ExamEditPage`,
  `QuestionEditPage`, `SettingsPage`.
- **Known bypasses:** `ExamDetailPage:528` inlines an equivalent recipe
  (`rounded-md border border-destructive bg-destructive/10 px-4 py-3 text-sm
  text-destructive`) instead of using this component. Target of the active
  `exam-ui/prefer-inline-error-banner` lint rule.
- **Distinction from `FieldError`:** `FieldError` is a per-field inline error
  (small, under one control); `InlineErrorBanner` is a block-level banner for
  form-wide / submit errors. Different anatomy, different a11y scope — both
  KEEP, distinct roles.
- **Decision rationale:** distinct role, owns a destructive surface recipe,
  has a bypass lint. KEEP.

#### `LoadingState` — KEEP

- **Semantic role:** full-area loading placeholder (page/section loading).
- **Anatomy:** `<div role=status aria-busy>` → spinner + i18n label.
- **Owned behavior / a11y:** `role=status` + `aria-busy=true`.
- **Consumers:** 25 pages — universal adoption.
- **Known bypasses:** isolated `<LoaderCircle className="animate-spin">`
  inline spinners exist (audit §4 "inline spinner"); these are *inline*
  affordances (e.g. button-side), not full-area loading — distinct role.
- **Decision rationale:** distinct role, owns a loading a11y contract, near-
  universal adoption. KEEP.

#### `EmptyState` — KEEP

- **Semantic role:** empty-data placeholder (no rows / no results).
- **Anatomy:** dashed bordered panel → icon + title + description + action.
- **Owned behavior / a11y:** icon `aria-hidden`; semantic heading (`h2`).
- **Consumers:** 19 pages.
- **Decision rationale:** distinct role, high adoption. KEEP.

#### `ErrorState` — KEEP

- **Semantic role:** full-area error placeholder (failed fetch / failed load).
- **Anatomy:** dashed destructive bordered panel → alert icon + message +
  retry + extra action.
- **Owned behavior / a11y:** `role=alert`; retry affordance via `Button`.
- **Consumers:** 27 pages — universal adoption.
- **Distinction from `InlineErrorBanner`:** `ErrorState` is a full-area
  placeholder that *replaces* the content (no data could be shown);
  `InlineErrorBanner` is a notice shown *alongside* content/form. Different
  anatomy and role — both KEEP.
- **Decision rationale:** distinct role, universal adoption. KEEP.

#### `ConfirmDialog` — KEEP (absorbs `ConfirmActionDialog`)

- **Semantic role:** generic confirmation dialog.
- **Anatomy:** `AlertDialog` → trigger + title + description + cancel/confirm
  footer; confirm can be `destructive`.
- **Owned behavior / a11y:** `AlertDialog` focus trap + `asChild` trigger;
  `data-variant` for styling hooks.
- **Consumers:** 8 pages + `ConfirmActionDialog`.
- **Decision rationale:** see collision finding §4. `ConfirmDialog` is the
  single confirmation authority; `ConfirmActionDialog` is DEMOTED into it.

#### `DataTableShell`, `DataToolbar`, `DataTablePagination` — KEEP

See §3 / §4 for the titled-container and toolbar collision review. These are
retained as the **tabular-data** authorities and distinguished from
`PageSection` (content container) and `ListToolbar` (different interaction
context).

#### `RowActions` — KEEP

- **Semantic role:** table row action group.
- **Anatomy:** `<div role=group aria-label>` → leading + children + trailing.
- **Owned behavior / a11y:** `role=group` + i18n label.
- **Consumers:** `CandidateFieldsPage`, `CandidatesPage`, `CoursePage`,
  `QuestionPage`, `UsersPage`.
- **Known bypasses:** `ExamPage` and others inline `flex gap-1` / `gap-1.5`
  for row actions (audit §4). Low-confidence to lint today (a flex group is
  also a legitimate layout), so the authority is by convention until a
  stronger rule lands.
- **Decision rationale:** owns a `role=group` accessibility contract the inline
  recipes lack. KEEP.

#### `SearchInput`, `FieldGroup` family — KEEP

- **`SearchInput`:** controlled search with leading icon + clear button + i18n
  defaults. 3 consumers. Distinct interaction (search affordance), KEEP.
- **`FieldGroup` / `Field` / `FieldRow` / `FieldStack` / `FormStack`:** pure
  spacing/layout primitives for form fields. `FieldGroup` family is widely
  adopted (10 consumers). These are layout **recipes expressed as components**;
  they own spacing contracts, not appearance. KEEP as layout authorities.

---

## 3. Ambiguous components (deep review)

These were flagged by the audit and the task brief as likely collision areas.
Each is resolved below by semantic role, not by appearance.

### 3.1 `StatsCard` — EXTEND (metric presentation authority)

The audit documented **STAT-CARD-DRIFT**: the "numeric KPI overview" exists in
four forms (`StatsCard`, `<Card shadow-sm><p text-2xl bold>` in
`ExamDetailPage`/`ScoreListPage`/`SystemDiagnosticsPage`, the Card-less
`<p text-3xl bold>` in `AttemptDetailPage`, and the skeleton variant). The
question is whether `StatsCard` is:

- **(A) metric presentation authority**, or
- **(B) just a card layout containing typography.**

**Verdict: (A) — `StatsCard` is the metric presentation authority.**

Evidence:
- It owns the **anatomy**: label (`type-secondary`) + value (`type-metric`) +
  optional icon (in a primary-soft tile) + optional trend (`type-metadata`).
  That is exactly the `label / value / trend` anatomy the task requires for
  metric authority.
- It owns **recipe selection** for the three metric-related typography roles
  (`type-secondary`, `type-metric`, `type-metadata`) — it does not re-pin font
  properties itself.
- The four bypass forms are *the same semantic role* (a KPI number with a
  label) implemented four ways — which is precisely the case where one
  authority should own it.

Decision: **EXTEND.** The role is valid and owned, but the component is
incomplete relative to its bypasses:
- missing a **skeleton/loading variant** (the audit's stat-skeleton form);
- missing explicit **size variant** support, because `type-metric` deliberately
  leaves size to layout (`text-2xl`/`text-3xl`/`text-5xl` across consumers) —
  the migration must decide whether size is a `StatsCard` variant or stays at
  the call site;
- current anatomy uses `shadow-sm`, which conflicts with the forward elevation
  rule (ordinary content must not own elevation). Migration should drop the
  shadow and rely on border/surface.

Do **not** create a second metric component. The four bypass forms migrate to
`StatsCard` (UI-MIGRATE-N), not to a new `KpiCard`.

### 3.2 `PageSection` vs `ContentCard` vs `DataTableShell` — the titled-container collision

The audit documented three "titled content container" implementations plus
hand-rolled `<Card><CardHeader><CardTitle text-base>` in ≥8 pages. The task
requires determining whether these are the same role or distinct.

**Verdict: distinct roles, but only two survive as titled-container
authorities; `ContentCard` is DEMOTED and `PageSection`/`DataTableShell` are
kept with a sharp boundary.**

| Component | Role | Keeps? |
| --- | --- | --- |
| `PageSection` | **content container** — a titled, bordered section of *arbitrary* page content; owns title + description + actions + body + footer; uses padding on the body. | KEEP (content container) |
| `DataTableShell` | **tabular-data container** — a titled shell whose body is a dense table; owns `overflow-hidden` + flush content (no body padding, so `<Table>` meets the border); toolbar slot. | KEEP (table container) |
| `ContentCard` | a **borderless, padding-thin card** with no title; `React.ComponentProps<typeof Card>` wrapper. | DEMOTE |

Rationale:
- `PageSection` vs `DataTableShell` is a **real semantic distinction**, not
  appearance: `DataTableShell` owns `overflow-hidden` + flush content (a table
  must touch the shell border), while `PageSection` owns padded arbitrary
  content + footer. They are not merged.
- `ContentCard` is a thin `Card` wrapper (`gap-0 rounded-lg py-0` + `p-5`
  content). It owns **no** distinct semantic role beyond what the shadcn `Card`
  primitive already provides, and it has **zero consumers** today. It is a
  styling convenience, not an authority. DEMOTE (it may remain in code, but it
  is not a titled-container authority and must not be cited as one).
- The hand-rolled `<Card shadow-sm><CardHeader><CardTitle text-base>` blocks
  across detail/dashboard pages are **bypasses of `PageSection`** (they are
  titled content containers with arbitrary content). Their migration target is
  `PageSection`, not a new component and not `ContentCard`.

> Important: do **not** merge `PageSection` and `DataTableShell`. Their body
> semantics differ (padded content vs flush table + overflow). A future
> refactor may unify their header, but the body treatment must remain distinct.

### 3.3 `ListToolbar` vs `DataToolbar` — the toolbar collision

Both render "rounded bordered card with search/filter/actions/summary." The
audit flagged them as a semantic near-duplicate differing only by breakpoint
and slot naming.

**Verdict: distinct interaction contexts today, but the distinction is thin
and must be made explicit. Both KEEP pending a sharper contract.**

| Component | Slot model | Breakpoint | Consumers |
| --- | --- | --- | --- |
| `ListToolbar` | named slots: `search` + `filters` + `actions` + `summary` | `lg` | `QuestionPage` |
| `DataToolbar` | free `children` + `actions` + `summary` | `sm` | `ExamPage` |

Analysis:
- They are **not** the same component with different names: `ListToolbar` owns
  a *named-slot* contract (search / filters) that imposes a specific list-page
  anatomy; `DataToolbar` is a *free-children* toolbar for a data table.
- However the current distinction (named slots vs free children, `lg` vs `sm`)
  is too subtle to be a reliable authority boundary. Pages pick "list" or
  "data" with no objective rule (audit §3 risk table).
- Decision: **KEEP both**, but record the intended boundary:
  - `DataToolbar` = operation workspace for a **tabular data surface** (pairs
    with `DataTableShell`); free children so any filter shape composes.
  - `ListToolbar` = operation workspace for a **list/card-list surface**;
    named `search` + `filters` slots enforcing a search-first anatomy.
- This boundary is provisional (ROLE-UNKNOWN-adjacent). If a future migration
  cannot keep the two anatomies meaningfully distinct, the correct action is
  to MERGE into one toolbar with optional named slots — **not** to keep two
  near-identical shells. Re-evaluate at UI-PILOT-1.

### 3.4 `ConfirmDialog` vs `ConfirmActionDialog` — the dialog collision

The audit flagged these as a semantic + code near-duplicate: `ConfirmActionDialog`
is a 33-line shell that only adds `disabled` merging + default-label resolution
over `ConfirmDialog`.

**Verdict: MERGE. `ConfirmActionDialog` is DEMOTED into `ConfirmDialog`.**

Evidence:
- `ConfirmActionDialog` has **zero consumers** today.
- It does not own a distinct semantic role: "destructive action confirmation"
  is already expressed by `ConfirmDialog`'s `destructive` prop. There is no
  separate *generic confirmation* vs *destructive confirmation* role here —
  both accept `destructive`, `trigger`, `onConfirm`.
- Its only additive behavior is `disabled || confirmDisabled` merging and
  default-label resolution — which `ConfirmDialog` already does itself.

Decision: `ConfirmActionDialog` is **DEMOTED** (not an authority). The single
confirmation authority is `ConfirmDialog`. Removal is a later cleanup task;
this document records that no new consumer should use `ConfirmActionDialog`,
and the component must not be cited as an authority.

### 3.5 `RowActions` — KEEP (see §2)

Distinct role (`role=group` table-row actions); bypasses are inline `flex`
groups that lack the a11y contract.

---

## 4. Collision findings (summary)

| Collision group | Components | Resolution |
| --- | --- | --- |
| titled content containers | `PageSection`, `ContentCard`, `DataTableShell` | `PageSection` = content container (KEEP); `DataTableShell` = table container (KEEP, distinct body); `ContentCard` = DEMOTE (no role, 0 consumers) |
| stat / metric presentation | `StatsCard` + 3 bypass forms (Card/p/skeleton) | `StatsCard` = metric authority (EXTEND); bypasses migrate to it |
| toolbars | `ListToolbar`, `DataToolbar` | both KEEP with provisional boundary (list vs table); re-evaluate at pilot |
| confirmation dialogs | `ConfirmDialog`, `ConfirmActionDialog` | `ConfirmDialog` = authority (KEEP); `ConfirmActionDialog` = DEMOTE (0 consumers, no distinct role) |
| status presentation | `StatusBadge` + `eventToneClass`/`Badge` bypasses | `StatusBadge` + `statusMeta` = authority; categorical `Badge` (types/tags) is NOT a bypass |

---

## 5. Demoted / non-authority components

These remain in the codebase but are **not** visual-role authorities. They must
not be cited as the owner of any role, and new code must not depend on them as
authorities.

| Component | Status | Reason |
| --- | --- | --- |
| `ConfirmActionDialog` | DEMOTE (→ merge into `ConfirmDialog`) | 0 consumers; adds only `disabled` merging + label defaults over `ConfirmDialog`; no distinct semantic role. |
| `ContentCard` | DEMOTE | 0 consumers; thin `Card` wrapper with no title and no role beyond the shadcn `Card` primitive. |
| `ConnectionIndicator` | DEMOTE (orphan) | 0 consumers; the exam runtime renders its own connection UI. Not currently an authority for any role. (If a future connection-status role is needed, it should be rebuilt against `statusMeta`, not adopted as-is.) |

> DEMOTE means "loses authority status." It does **not** mean "delete in this
> task." Removal is explicitly out of scope for UI-COMP-1 (see §7).

---

## 6. Role → authority owner (quick reference)

```text
page header                          → PageHeader
domain status presentation           → StatusBadge (+ statusMeta.ts)
form field validation error          → FieldError
inline destructive error banner      → InlineErrorBanner
full-area loading placeholder        → LoadingState
empty-data placeholder               → EmptyState
full-area error placeholder          → ErrorState
generic confirmation dialog          → ConfirmDialog
metric / KPI presentation            → StatsCard (+ type-metric recipe)
content container (arbitrary body)   → PageSection
tabular-data container               → DataTableShell
data-table operation toolbar         → DataToolbar
list operation toolbar (search-first)→ ListToolbar (provisional)
data-table pagination                → DataTablePagination
table row action group               → RowActions
controlled search input              → SearchInput
form field layout                    → FieldGroup / Field / FieldRow / FieldStack / FormStack
top-level error boundary             → ErrorBoundary
```

Unowned / partially-owned roles observed (to be resolved in later vocabulary
work, **not** by adding components in this task):

```text
metadata / definition list (label:value) → currently inline grids; no component authority yet
read-only long-text answer panel         → currently inline (GradingDetailPage); no component yet
form section (titled form block)         → FormSection exists but low adoption; relationship to PageSection unresolved
```

---

## 7. Future migration notes

These are recorded as guidance for later tasks (UI-PILOT-1, UI-MIGRATE-N). They
are **not** executed here.

1. **Stat-card consolidation (STAT-CARD-DRIFT).** Migrate the four stat forms
   to `StatsCard`. Decide whether size is a `StatsCard` variant or stays at the
   call site (the `type-metric` recipe deliberately leaves size to layout). Add
   a skeleton/loading variant. Drop `shadow-sm` (elevation rule).
2. **Titled-container consolidation (SHELL-ADOPTION-DRIFT).** Migrate hand-rolled
   `<Card shadow-sm><CardHeader><CardTitle text-base>` blocks to `PageSection`
   (content) or `DataTableShell` (tables). Keep the body-treatment distinction.
   Drop the per-Card `shadow-sm`.
3. **Field-error adoption.** Migrate the same-role `text-sm/text-xs
   text-destructive` bypass sites to `FieldError`. The former
   `exam-ui/prefer-field-error` lint rule was retired in
   UI-FIELD-ERROR-AUTHORITY-CLOSURE-1 (its structural recipe could not
   deterministically distinguish FieldError ownership from other destructive-`<p>`
   roles); same-role adoption is now enforced by semantic migration review.
4. **Inline-error-banner adoption.** Migrate `ExamDetailPage`'s inline banner
   (and any like it) to `InlineErrorBanner`. Enforced today by
   `exam-ui/prefer-inline-error-banner`.
5. **Status-color consolidation (STATUS-COLOR-DRIFT).** Route domain-status
   presentation through `statusMeta` + `StatusBadge`. Do **not** touch
   categorical `<Badge>` usage (question type, tags) — those are not domain
   statuses.
6. **Toolbar boundary.** Validate the `ListToolbar` vs `DataToolbar` boundary
   on the pilot page; merge if the anatomies cannot be kept distinct.
7. **Confirmation dialog cleanup.** After confirming no hidden consumers,
   retire `ConfirmActionDialog` in favor of `ConfirmDialog`.
8. **`ContentCard` / `ConnectionIndicator`.** No role claimed; revisit when a
   genuine need appears. Do not adopt as authorities in the meantime.
9. **Form-section authority.** `FormSection` overlaps structurally with
   `PageSection` (both titled bordered blocks). Decide at pilot whether form
   sections are a distinct role or a `PageSection` variant.

### Typography integration

Components own **recipe selection**, not raw font properties. The current
mapping (already wired):

```text
PageHeader    → type-page-title, type-page-description
StatsCard     → type-secondary, type-metric, type-metadata
StatusBadge   → (no type-* recipe; status is a mapping authority)
FieldError    → (no type-* recipe; feedback component, critical color)
InlineErrorBanner → (no type-* recipe; destructive surface)
```

No component may re-pin `font-family` / `font-size` / `font-weight` /
`line-height` inside arbitrary Tailwind classes once a recipe owns that role.
Bypass sites above are the migration backlog.

---

## 8. Out of scope (explicit)

This task did **not**:

- create, delete, rename, merge, or migrate any component or consumer;
- change any visual styling, recipe, token, or CSS;
- add, remove, or change any lint rule;
- add any dependency;
- change any test or test coverage.

Only this documentation file was produced.

---

## 9. Verification

Verification for this task is documentation-only: confirm no production UI file
changed. The static gate is run to prove nothing was disturbed.

```bash
pnpm lint
pnpm verify:static
```

See the final report for results.
