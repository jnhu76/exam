# UI System

> Current as-built constraints on the `apps/web` visual system. These constrain
> future development. For the frontend architecture, see
> [`docs/architecture/frontend.md`](../architecture/frontend.md). For open UI
> migration items, see [`archive/roadmap/ui-open-items.md`](../archive/roadmap/ui-open-items.md).

## Four-layer authority model

The visual authority chain is four layers, each consuming the one above:

```text
semantic tokens (apps/web/src/index.css :root)
    → semantic recipes (typography type-*, surface surface-*)
        → authoritative components (PageHeader, StatsCard, StatusBadge, …)
            → business pages
```

**Cascade policy (proven):** `type-*` and `surface-*` recipe classes are imported
as **plain (unlayered) CSS** via `main.tsx`. Tailwind v4 organizes into
`@layer utilities`. Unlayered styles win over all layered styles regardless of
source order — so recipe-owned properties *cannot* be overridden by business
utilities. This is enforced by the `exam-ui/no-typography-authority-conflict`
lint rule.

## Design tokens

The live token source is `apps/web/src/index.css` `:root`. Token domains:

- **Font roles:** `--font-ui` (self-hosted "Noto Sans CJK SC", first in stack),
  `--font-reading-stack`, `--font-serif-stack` ("Noto Serif SC"),
  `--font-mono-stack`; exposed via `@theme inline` as `--font-sans`,
  `--font-reading`, `--font-serif`, `--font-mono`.
- **Text (foreground) roles:** `--text`, `--text-secondary`, `--text-muted`,
  `--text-subtle`.
- **Surface roles:** `--bg` (canvas), `--surface`, `--surface-raised`,
  `--surface-subtle`/`--surface-soft`, `--surface-muted`, `--surface-hover`,
  `--surface-selected`.
- **Border roles:** `--border-control`, `--border-shell`, `--border-header`,
  `--border-raised`, `--border-divider`/`--border-row`, `--border-grid`,
  `--border` (= shell), `--border-strong` (= control).
- **Primary / accent:** `--primary`, `--primary-hover`, `--primary-active`,
  `--primary-soft`, `--primary-focus`.
- **Sidebar (navigation) roles:** `--sidebar-bg`, `--sidebar-active`,
  `--sidebar-active-soft`, `--sidebar-hover`, `--sidebar-text`, `--sidebar-muted`,
  `--sidebar-border`.
- **Status / feedback color:** `--danger`, `--success`, `--warning`, `--info`
  (+ `-hover`/`-soft`/`-border` variants); structured status triples
  `--status-{neutral,info,positive,caution,destructive}-*` (bg/text/border).
- **Geometry:** `--radius` (`0.5rem`).

Business pages must not depend on physical token identity where a semantic role
exists.

## Fonts

- **Self-hosted CJK sans:** "Noto Sans CJK SC" (regular/medium/bold woff2
  subsets, preloaded). It is **first** in `--font-ui` so the same typeface
  renders across Windows/macOS/Linux; OS CJK fonts are resilient fallbacks only.
- **Self-hosted serif:** "Noto Serif SC" (weights 400, 700 only) for sustained
  Chinese reading only — never applied to UI controls, status, scores, timers, or
  metadata. Consumers opt in via a reading recipe; serif is never applied by HTML
  tag alone.
- **Allowed weights:** only **400 (regular), 500 (medium), 700 (bold)** for the
  UI sans. **No 600 (semibold) face exists.** `font-synthesis: none` is set so
  missing weights never produce fuzzy synthetic bold. Base `h1/h2/h3` anchor at
  **500** (CJK 700 reads heavy at UI sizes); 700 is reserved for large numeric
  metrics. `font-light`/300 is unused.
- **Base:** `body { font-family: var(--font-ui); font-size: 14px; font-weight: 400 }`.

## Typography recipes

Source: `apps/web/src/typography/recipes.css` (unlayered CSS). The
machine-readable ownership registry is `apps/web/src/typography/recipeRegistry.ts`
(`RECIPE_REGISTRY`, single canonical source).

| Recipe | font-family | font-size | line-height | weight | letter-spacing | color | other |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `type-page-title` | `--font-ui` | 24px | 32px | 500 | -0.01em | `--text` | — |
| `type-page-description` | `--font-ui` | 14px | 22px | 400 | — | `--text-muted` | — |
| `type-section-title` | `--font-ui` | 16px | 24px | 500 | — | `--text` | — |
| `type-body` | `--font-ui` | 14px | 22px | 400 | — | `--text` | — |
| `type-secondary` | `--font-ui` | 14px | 22px | 400 | — | `--text-muted` | — |
| `type-metadata` | `--font-ui` | 12px | 18px | 400 | — | `--text-muted` | — |
| `type-reading` | `--font-reading` | 20px | 32px | 500 | — | `--text` | sustained reading |
| `type-long-response` | `--font-reading` | 14px | 26px | 400 | — | `--text` | `white-space: pre-wrap` owned |
| `type-metric` | `--font-ui` | layout-owned | layout-owned | 700 | — | `--text` | `font-variant-numeric: tabular-nums` |
| `type-metric-hero` | `--font-ui` | 48px | 1 | 700 | — | `--text` | `tabular-nums` (final-score emphasis) |
| `type-numeric` | layout-owned | layout-owned | layout-owned | layout-owned | — | — | `tabular-nums` (table/timer/counts) |
| `type-code` | `--font-mono` | 12px | 20px | 400 | — | — | `white-space: pre; overflow-x: auto` |

A recipe's `layoutOwnedProperties` (size/line-height for `metric`/`numeric`;
`min-height` for `long-response`) may be set by layout utilities (e.g.
`type-metric text-3xl` is valid). Owned properties cannot be overridden by
business utilities.

**Status and field-error are explicitly NOT `type-*` recipes** — status is a
component + mapping authority (`statusMeta` + `StatusBadge`); field errors are
owned by the `FieldError` component.

## Surface and elevation

Surface recipes live in `apps/web/src/surface/recipes.css` (unlayered CSS).
Confirmed surface roles:

| Surface | Owned | Consumers |
| --- | --- | --- |
| `surface-page` | background (canvas) + text contrast | `body`/`#root`, layout canvas |
| `surface-content` | background + border + radius; **NO shadow** | PageSection, DataTableShell, DataToolbar, StatsCard, exam question area |
| `surface-subtle` | background only; inherits border/radius | Table header/hover, read-only wells |
| `surface-navigation` | background + border + text | AppSidebar |
| `surface-overlay` | background + border + radius + **box-shadow** | Dialog/AlertDialog/Popover/DropdownMenu/Sheet/Select, ConfirmDialog |
| `surface-attention` | radius only; **NO shadow** — color owned by component | InlineErrorBanner, ErrorState, EmptyState |

**Elevation vocabulary (three roles):**

| Role | Resolves to | Owner |
| --- | --- | --- |
| `elevation.none` | no shadow | ordinary content (`surface-content`/`subtle`/`navigation`/`attention`) |
| `elevation.overlay` | `shadow-md`/`shadow-lg` | `surface-overlay` (dialogs, popovers, dropdowns, sheets) |
| `elevation.sticky` | `shadow-xs` | the sticky topbar (the only non-overlay elevation owner) |

**Ordinary business content has NO shadow.** Enforced by `exam-ui/no-business-shadow`
(baseline empty). The shadcn `Card` primitive is itself shadow-free (`border` +
`radius` only); the excluded `components/ui/` scope exists for the interaction
primitives, not for an elevation exception.

## Component authority

Per-component role ownership (from the component-authority record):

| Visual role | Authoritative component |
| --- | --- |
| page header (title + description + status + actions) | `PageHeader` |
| domain status presentation | `StatusBadge` (+ `statusMeta.ts`) |
| form field validation error | `FieldError` |
| inline destructive error banner | `InlineErrorBanner` |
| full-area loading placeholder | `LoadingState` |
| empty-data placeholder | `EmptyState` |
| full-area error placeholder | `ErrorState` |
| generic confirmation dialog | `ConfirmDialog` |
| metric / KPI presentation | `StatsCard` (+ `type-metric`) |
| content container (arbitrary body) | `PageSection` |
| titled form-field section | `FormSection` (composes `PageSection`; owns the form content grid) |
| tabular-data container | `DataTableShell` |
| list / data-table operation toolbar | `DataToolbar` (single toolbar authority; optional `search` slot) |
| data-table pagination | `DataTablePagination` |
| table row action group | `RowActions` |
| controlled search input | `SearchInput` |
| form field layout | `FieldGroup` / `Field` / `FieldRow` / `FieldStack` / `FormStack` |
| top-level error boundary | `ErrorBoundary` |

Components own recipe/surface selection, not raw font/surface properties.
Former wrapper components with no distinct role (`ConfirmActionDialog`,
`ContentCard`, `ConnectionIndicator`, `DataView`, `ListToolbar`,
`SubmitConfirmDialog`, `ExamTopbar`, `RuntimeActionBar`, `AnswerPanel`) have
been deleted; do not resurrect single-role wrappers over an existing authority.

## Spatial governance boundary

The closed rule for who owns spatial semantics (frozen, issue #445 P3 §H):

1. Business pages may own one-off structural composition.
2. Business pages may not redefine spatial semantics already owned by an
   archetype, authoritative component contract, or shared mechanism.
3. Promote behavior to a shared owner when the same semantics, same failure
   mode, and same policy recur in at least two consumers, or when one observed
   failure already proves that a shared policy is required.

**What page-local structure still means (legal):** one-off grid/flex
composition (`grid gap-4 md:grid-cols-2`, `flex flex-col gap-6`), local
section ordering, a local narrow inner readability constraint
(`<form className="max-w-sm">`), business-specific master/detail composition,
and business-specific content grouping — as long as they do not redefine a
shared spatial semantic. Page-root width is not page-local: see §Page
geometry.

**What a page may not redefine (illegal):** its own page-root max-width; a
private action-column, status, or filter width; a private breakpoint; a
page-local mobile card field map; a duplicated overflow/ResizeObserver
measurement; a silent truncation contrary to the column's role contract. The
distinction is semantic, not a regex ban — review judges ownership, not byte
patterns.

**Promotion precedent** (the recurrence rule in practice): the V1 action
collision became `RowActions` + the actions-column authority (not a UsersPage
width patch); the V3 long-token collision became column overflow/content
semantics (not a CandidatesPage truncate patch); duplicated overflow observers
became the shared `useOverflowObservation`; QuestionPage mobile cards plus the
management-list recurrence became the shared `MobileRecordList` mechanism. An
observed systemic failure justifies promotion even before a second consumer
exists.

## Page geometry (Model A)

`PageContainer` owns all page-root widths. The page declares its container
role explicitly; layouts own only the responsive gutter and never infer a
container role from the URL. The role vocabulary is closed:

| Role | Maximum | Use |
| --- | --- | --- |
| `auth` | 448px | authentication |
| `form` | 896px | create/edit and focused forms |
| `admin-standard` | 1280px | dashboards and ordinary admin pages |
| `admin-wide` | 1536px | diagnostics and genuinely wide data |
| `candidate` | 896px | candidate-facing list, detail, and result pages |
| `exam-runtime` | 1280px | task-focused candidate runtime |

The former `admin-sparse` (1024) role is **retired** (merged into
`admin-standard`); re-adding a seventh role is a vocabulary-authority
decision, not a page-local width. Page-root width ≠ local inner-content
width: a narrower inner constraint (`max-w-sm` form, readability column)
inside a declared-role page stays legal page-local composition.

## Tailwind boundary

Business pages **may** use Tailwind freely for **structure and responsive
layout**:

- **Allowed:** `flex`/`grid`/`block`/`hidden`; `relative`/`absolute`/`fixed`/`sticky`;
  `items-*`/`justify-*`; `grid-cols-*`/`col-span-*`; `w-*`/`h-*`/`min-*`/`max-*`/
  `overflow-*`; `gap-*`/`space-*`; responsive variants. Example:
  `<div className="grid gap-4 lg:grid-cols-4">` is valid.

**Governed domains that must use recipes/components, not primitive recomposition:**

- **Typography** (family/size/weight/line-height/letter-spacing/color when a
  recipe owns it).
- **Surface** (background + border + radius + shadow as a region-level appearance).
- **Elevation** (no `shadow-*` in ordinary content).
- **Domain status color** (flows through `statusMeta` + `StatusBadge`).

The boundary: **structure is yours; governed appearance is not.**

## Status color

- **`statusMeta.ts`** (`apps/web/src/lib/statusMeta.ts`) is the authority for the
  **domain status → presentation** decision. Keys: exam lifecycle, enrollment,
  attempt lifecycle, save state, connection diagnostics, health, infra, result,
  grading, misconduct, lifecycle, account, and an `unknown` fallback.
- **`StatusTone`** (`primary` | `secondary` | `success` | `warning` |
  `destructive` | `info` | `muted`) is a **color vocabulary** — an output type
  any domain may reuse. Two mappings returning the same `StatusTone` are not the
  same authority; authority is determined by the input semantic domain.
- **Semantic-ownership boundary:** `statusMeta` owns **DOMAIN STATUS only**. It
  does **not** own audit actions, connectivity classification, monitoring
  signals, or generic feedback/error color (those use `--danger`/`--success`/
  `--warning` tokens and feedback components).
- **`StatusBadge`** is the single presentation component over `statusMeta`
  (`<span data-status-tone>` → icon + i18n label; `showIcon` boolean). Categorical
  labels (question type, tags) are **not** statuses and may use plain `<Badge>`.
- **Enforcement:** genuine status-color bypasses are data-flow-bound (dynamic
  `className`) and collide with categorical `<Badge>` — not statically
  enforceable; enforced by review + migration.

## Icons

`AppIcon` (`apps/web/src/components/shared/AppIcon.tsx`) is the single governed
entry point for Lucide icons. It is the **size/stroke authority**: callers pick
an `AppIconSize` role (`badge`/`inline`/`nav`/`metric`/`large`/`state`/`hero`)
and must **not** pass their own `size-*`/`width`/`height`/`strokeWidth`. Size
config: `badge`/`inline` = 16px stroke 1.5; `nav`/`metric` = 20px stroke 2;
`large` = 24px; `state` = 32px; `hero` = 40px. `absoluteStrokeWidth` always on.
`AppIcon` is decorative (`aria-hidden="true"`) or semantic (`decorative: false`
with `label` → `role="img"`).

## Tables

`DataTableShell` is the mandatory shell for equivalent management tables. It owns
the complete outer boundary (`overflow-hidden` + flush body so `<Table>` meets
the border), optional title/description/`toolbar` slot, footer slot, the
archetype-driven tier negotiation, and the shared overflow
observation. `DataWorkbench` (toolbar → table → footer as one continuous
surface) shares every semantic authority with `DataTableShell` — archetype,
column semantics, tier negotiation, overflow observation, responsive
representation, mobile derivation — and differs only in visual composition;
the two surfaces must never fork a semantic policy. Implementation ownership:
[`docs/architecture/frontend.md`](../architecture/frontend.md).

### Table archetypes (closed vocabulary)

The page declares one archetype on the shell; the vocabulary is closed:

| Archetype | Desktop | Viewport < lg | Container pressure |
| --- | --- | --- | --- |
| `management-list` | semantic table, container-driven tier negotiation | shared mobile cards (`MobileRecordList`) | tier degradation → local scroll |
| `log-diagnostic` | table | **table** (never cards) | local horizontal scroll |
| `detail-comparison` | table, sticky first context column | **table** (never cards) | local horizontal scroll |
| `embedded-picker` | embedded/dialog authority, auto layout (no tier attribute) | unchanged | scrolls inside its dialog surface |

Do not add an archetype. The mobile card slot is a `management-list`
mechanism only — a DEV contract throw guards the shell against an illegal
combination, and only a management-list with an explicit mobile slot
participates in the viewport switch (production-safe fallback: desktop/scroll
at every width).

### Three independent signals

Three signals stay independent; conflating any two is the historical root of
the mobile-card and tier defects:

- **viewport** → representation (`ResponsiveRepresentation`: < lg cards for
  management-list, ≥ lg table);
- **container width** → table tier / local scroll (`negotiateTier` from the
  archetype's min/max tier bounds; fixed layout + col min-width enforce
  `renderedTableMin = max(tierMin, contentMin)` physically);
- **column priority** → mobile information selection only (never desktop tier
  logic).

Therefore a desktop viewport with a narrow content box degrades the **tier**
(local scroll) — it never swaps to mobile cards. Measurement order is fixed:
representation first, then table measurement — **mobile cards never
participate in table overflow/tier measurement** (the desktop branch owns
`useOverflowObservation`; the mobile branch is its sibling, not a descendant).

### Column contract

Column cell roles (closed set in `DataTableContract`): **status**
(StatusBadge), **date**, **date-range**, **duration**, **number**, **score**,
**short-id**, **type**, **actions** (RowActions), plus text roles
**primary-text**, **secondary-text**, **long-text**, **description**,
**tag-list** (categorical `<Badge>`s). Headers use `surface-subtle`; body
rows use `surface`.

A column declaration carries three separate dimensions — they are not
interchangeable:

- **role** — what kind of content this is (`primary-text`, `status`,
  `score`, `actions`, … closed set in `DataTableContract`);
- **overflow** — how the content physically behaves (closed vocabulary
  `nowrap` / `wrap` / `break-token` / `truncate` / `truncate-middle` /
  `line-clamp-2`, per-role allowed domains; truncation never happens silently
  at the cell — presenter policies keep the full value accessible);
- **priority** — whether/how the column participates in the mobile card
  summary. Frozen vocabulary: `high` / `normal` / `low` — no additions. The
  priority→slot mapping is frozen: `high` renders in the card header (or as
  primary content for `primary-text`/`long-text`), `normal` as a labeled meta
  line, `low` is omitted, `actions` becomes the card actions slot. Declaration
  order is preserved; pages must not keep a second page-local mobile field
  map — both representations derive from the same `DataViewColumnDef[]`.

Physical widths are recipes (`apps/web/src/table/recipes.css`); the normative
anchors: status column **8.5rem** (vocabulary-bound, derived from the
statusMeta × supported-locale fixture), actions column **6rem** fine /
**7.5rem** coarse pointer.

### Row actions

`RowActions` owns representation; the page declares action intent (typed
declarations); the table recipe owns physical capacity. Representation is a
pure function of the declaration count: N ≤ 2 → inline icon buttons;
N > 2 → exactly one primary inline + one kebab (label lives in menu text).
The inline bound (two icon buttons) is what the actions-column width is
derived from — do not invent new action density policy.

### Status capacity

`statusMeta` owns the semantic status vocabulary/labels, `StatusBadge` owns
rendering (§Status color), and the table status **role** owns physical
capacity: the frozen 8.5rem column fits the widest legal badge across every
status × supported locale (`apps/web/src/table/statusFixture.ts` re-derives
that universe automatically; a new status or locale grows the fixture and
reds the guard until the token is revisited). Do not document the historical
7rem as current.

## Dialogs

`DialogContent` carries the closed size vocabulary `sm` 384 / `md` 512 /
`lg` 672 (`size` prop). `xl` (896) is a documented extension rule only —
added only when real content cannot avoid illegal horizontal scroll inside
`lg`; it is not a runtime authority, and page-local `max-w-*` overrides are
never legal. The dialog content column is capped at `max-h-[85dvh]`; header
and footer stay fixed in the composition and the region marked
`data-slot="dialog-body"` is the single vertical scroll owner (CSS
convention in `surface/recipes.css`). Dialog-level horizontal scrolling is
never legal. Radix owns focus trap/Escape/stacking; pages use the controlled
`open`/`onOpenChange` pattern.

## Form field layout

`FormSection` is a titled `PageSection` whose content grid hosts the field
primitives; it has no `columns` prop. `FieldRow` is the only multi-column
form primitive (two columns at `sm+`, one-column stack below); a single
full-span field declares `col-span-full`. `FieldGroup`/`Field`/`FieldStack`/
`FormStack` own the remaining single-column field composition. Errors flow
through `FieldError`; pages do not hand-roll field grids with bespoke
breakpoints.

## Toolbar filters

`DataToolbar` is the single toolbar authority. `ToolbarFilter` widths are
frozen: `narrow` **9rem** (short closed enums), `wide` **11.25rem** (entity
selectors and free text), both full-width below `sm`; the search input is
toolbar-owned. Do not introduce new filter widths.

## Accessibility

- **`InlineErrorBanner`** owns `role="alert"` (assertive) + destructive surface.
- **`FieldError`** owns `role="alert"` + `text-destructive`; renders nothing when empty.
- **`LoadingState`** owns `role="status"` + `aria-busy="true"`.
- **`ErrorState`** owns `role="alert"` + retry affordance.
- **`RowActions`** owns `role="group"` + `aria-label`; **`DataToolbar`** owns `role="toolbar`.
- **Focus management** is owned by Radix primitives (Dialog/Popover/Select/
  DropdownMenu/Sheet own focus traps, escape handling, keyboard nav, outside-click,
  portal stacking). Pages must never hand-write focus traps / escape-key handlers.
  The controlled-dialog pattern (page holds `useState<boolean>` open state, passes
  `open`/`onOpenChange` to the shadcn primitive) is the approved interaction boundary.
- **Testing:** page tests query by role/label/placeholder/visible text/`data-testid`
  — never by `className` or Radix portal internals; every `userEvent` call is awaited.

### Accessibility baseline checklist

Product baseline, not WCAG certification. Automated gate:
`apps/e2e/e2e/a11y-baseline.spec.ts` (axe, zero critical/serious on
representative surfaces: login, candidate exam list, take-exam runtime +
submit dialog, one admin form, one admin table). Manual checks for changes
touching the surfaces below:

| Area | Check |
| --- | --- |
| Keyboard | primary actions reachable by Tab; no keyboard-only dead end; logical tab order |
| Dialogs | Radix owns trap/Escape/restore (controlled `open`/`onOpenChange`); confirm buttons carry the operation name; closing restores focus to the trigger |
| Forms | `Label` associated (`htmlFor`); errors via `FieldError` (`role="alert"`); required/disabled semantics from the field contract |
| Icon-only buttons | `aria-label` required (tooltip alone is not a name); `AppIcon` stays decorative unless it carries the label |
| Status | domain status flows through `StatusBadge`/`statusMeta` (text + tone); color never the sole carrier; live regions only for save/error/save-state changes |
| Timer | exam countdown keeps `role="timer"` + accessible name; per-second ticks are not announced |
| Contrast | tokens already meet ≥4.5:1 for text roles; never fix contrast with page-local colors — fix the token/recipe owner |
| Candidate runtime at 390px | timer/save/submit visible; answer input usable; navigator and footer actions reachable; no document-level horizontal overflow (`candidate-responsive.spec.ts`) |

## Forbidden dependencies

Ant Design, MUI, Chakra, Headless UI (and any other component framework) are
forbidden. Tailwind may not be replaced. Hand-writing complex interaction
primitives (DatePicker/Calendar, Dialog/Modal, Select, Combobox, DropdownMenu,
Popover, Tooltip, Tabs, Accordion, FocusTrap, Toast primitive) is forbidden —
these must come from shadcn/Radix/react-day-picker.

## Active `exam-ui/*` lint (wired as errors)

Six rules in `apps/web/eslint.config.ts`, all `"error"`, baseline empty:

| Rule | Enforces |
| --- | --- |
| `exam-ui/prefer-inline-error-banner` | a `<div role="alert">` with rounded + ≥2 destructive-surface families must use `InlineErrorBanner` |
| `exam-ui/no-business-shadow` | no `shadow-*` in ordinary business content (layout + ui excluded); variant-aware |
| `exam-ui/no-arbitrary-typography` | no arbitrary `text-[…]`/`leading-[…]`/`tracking-[…]`/`font-[…]` (excl. color) |
| `exam-ui/no-arbitrary-inline-typography` | no static one-off typography via inline `style` |
| `exam-ui/no-typography-authority-conflict` | a `type-*` recipe + a sibling self-target utility touching a recipe-owned property is a conflict |
| `exam-ui/no-recipe-recomposition` | the byte-exact raw stacks `text-sm text-muted-foreground` (→ `type-secondary`), `text-xs text-muted-foreground` (→ `type-metadata`), and bare `tabular-nums` (→ `type-numeric`); weight-emphasized and variant-prefixed stacks are deliberate local roles and stay legal |

Retired rules (ownership enforced by migration review + recipe/component
authority tests): `exam-ui/prefer-field-error`, `exam-ui/no-raw-typography`,
`exam-ui/no-raw-surface-recipe`.
