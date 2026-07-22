# UI System

> Current as-built constraints on the `apps/web` visual system. These constrain
> future development. For the frontend architecture, see
> [`docs/architecture/frontend.md`](../architecture/frontend.md). For open UI
> migration items, see [`docs/roadmap/ui-open-items.md`](../roadmap/ui-open-items.md).

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
(baseline empty). The shadcn `Card` primitive still carries `shadow-sm` by
default but lives in the excluded `components/ui/` scope.

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
| tabular-data container | `DataTableShell` |
| data-table operation toolbar | `DataToolbar` |
| list operation toolbar | `ListToolbar` (provisional) |
| data-table pagination | `DataTablePagination` |
| table row action group | `RowActions` |
| controlled search input | `SearchInput` |
| form field layout | `FieldGroup` / `Field` / `FieldRow` / `FieldStack` / `FormStack` |
| top-level error boundary | `ErrorBoundary` |

Components own recipe/surface selection, not raw font/surface properties.
`ConfirmActionDialog`, `ContentCard`, and `ConnectionIndicator` have no consumers
and no distinct role — they must not be cited as authority owners.

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
the border), optional title/description/`toolbar` slot, footer slot, an
`actionsDensity` prop (`"narrow"` default), and a scroll-overflow
`ResizeObserver` mechanism.

Column cell roles: **status** (StatusBadge), **date**, **duration**, **number**,
**score**, **actions** (RowActions), plus text roles **primary-text**,
**long-text**, **description**, **tag-list** (categorical `<Badge>`s). Headers
use `surface-subtle`; body rows use `surface`. Related: `DataTablePagination`,
`DataToolbar`, `DesktopDataTable` / `MobileRecordCard` / `MobileRecordList`
(responsive table variants).

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

## Forbidden dependencies

Ant Design, MUI, Chakra, Headless UI (and any other component framework) are
forbidden. Tailwind may not be replaced. Hand-writing complex interaction
primitives (DatePicker/Calendar, Dialog/Modal, Select, Combobox, DropdownMenu,
Popover, Tooltip, Tabs, Accordion, FocusTrap, Toast primitive) is forbidden —
these must come from shadcn/Radix/react-day-picker.

## Active `exam-ui/*` lint (wired as errors)

Five rules in `apps/web/eslint.config.ts`, all `"error"`, baseline empty:

| Rule | Enforces |
| --- | --- |
| `exam-ui/prefer-inline-error-banner` | a `<div role="alert">` with rounded + ≥2 destructive-surface families must use `InlineErrorBanner` |
| `exam-ui/no-business-shadow` | no `shadow-*` in ordinary business content (layout + ui excluded); variant-aware |
| `exam-ui/no-arbitrary-typography` | no arbitrary `text-[…]`/`leading-[…]`/`tracking-[…]`/`font-[…]` (excl. color) |
| `exam-ui/no-arbitrary-inline-typography` | no static one-off typography via inline `style` |
| `exam-ui/no-typography-authority-conflict` | a `type-*` recipe + a sibling self-target utility touching a recipe-owned property is a conflict |

Retired rules (ownership enforced by migration review + recipe/component
authority tests): `exam-ui/prefer-field-error`, `exam-ui/no-raw-typography`,
`exam-ui/no-raw-surface-recipe`.
