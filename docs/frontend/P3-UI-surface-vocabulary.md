# P3-UI-SURFACE-1 — Semantic Surface Vocabulary

> Authority for the semantic **surface** roles of the Exam frontend
> (UI-SURFACE-1). This is the surface counterpart to the typography authority
> (`apps/web/src/typography/typography-vocabulary.md`): typography owns
> *character-level* visual hierarchy (family / size / weight / line-height);
> surface owns *region-level* visual hierarchy (background / border / radius /
> elevation / density).
>
> This is an **analysis + authority definition** document. No production code,
> component, styling, token, dependency, or lint rule was changed to produce
> it. The decisions here are the authority that future UI work must follow;
> the migrations themselves belong to later tasks (UI-PILOT-1, UI-MIGRATE-N).
>
> Source of evidence: line-by-line reading of every file in
> `apps/web/src/components/shared/`, representative `components/ui/` and
> `components/layout/`, `apps/web/src/index.css`, the existing `exam-ui/*`
> lint config + baseline (`eslint.config.ts`, `src/lint/exam-ui/baseline.json`),
> the accepted visual audit
> (`docs/frontend/P3-UI-AUDIT-0-frontend-visual-language-audit.md`), and
> quantitative surface-utility searches across the `apps/web/src` tree.

---

## Core principle

Surface is **semantic visual hierarchy**. A surface answers:

```text
"What visual layer does this content belong to?"
```

It does NOT answer:

```text
"What component renders it?"
```

Components **select** semantic surfaces. Surface recipes **own** the visual
implementation. Tailwind remains the implementation substrate — business pages
may still use structural Tailwind (flex / grid / width), but must not
recompose a governed surface appearance (bg + border + radius + shadow) from
primitive utilities once a surface role owns that combination.

This document extends the existing four-layer authority chain:

```text
semantic tokens
    ↓
semantic recipes   ← typography recipes exist; surface recipes defined HERE
    ↓
authoritative components
    ↓
business pages
```

---

## Authority rules

1. A surface role is **authoritative** only if it owns a stable visual
   meaning that recurs across the application and that a business page must
   not independently recompose from primitives.
2. Two roles must not claim the same visual layer without an explicit,
   documented distinction (the same rule the component authority applies).
3. A component may own a *surface selection* (e.g. `PageSection` selects
   `surface.content`) without owning the raw surface properties — those are
   owned by the surface role / recipe layer. This mirrors how components own
   *typography selection*, not raw font properties.
4. Surface roles are scoped to **region-level appearance**. They do not own
   layout, typography, component behavior, or accessibility contracts — those
   are owned elsewhere. Surface roles own **background, border, radius, and
   (where the role is an elevation owner) shadow**.
5. Surface does **not** replace the color authority. Domain-status color
   continues to flow through `statusMeta.ts` + `StatusBadge`; feedback color
   (destructive / success / warning / info) continues to flow through the
   `--danger` / `--success` / etc. tokens. Surface roles reference those
   tokens; they do not redefine them.

### Classification vocabulary

Every candidate surface role receives exactly one decision, matching the
typography and component authority documents:

| Decision | Meaning |
| --- | --- |
| **CONFIRMED** | Owns a stable, distinct surface layer. Authoritative. |
| **MERGED** | Same layer as another role; absorbed. |
| **DEFERRED** | Plausible role but insufficient migration benefit today. |
| **REJECTED** | Not a surface layer (belongs to a different authority). |

---

## 1. Audit of current surface language

The audit reconstructs the *de-facto* surface vocabulary from current Tailwind
usage, classified by semantic usage (not by class alone). Quantitative counts
are `apps/web/src/**/*.{ts,tsx}`.

### 1.1 Backgrounds

| Class / token | Count | Semantic usage |
| --- | ---: | --- |
| `bg-background` (`--bg` `#f7f8fb`) | 22 | **page background** — the application canvas behind all content (`body`/`#root`, exam runtime). |
| `bg-card` (`--surface` `#fff`) | 19 | **content surface** — the raised white surface of sections, cards, shells, the sticky topbar, exam question area. |
| `bg-muted` (`--surface-muted` `#f9fafb`) | 32 | **subtle surface** — table headers/footers, zebra rows, metadata strips, read-only text wells (`type-long-response` uses `bg-muted/30`). |
| `bg-muted/30` | 2 | **read-only well** — candidate-answer box (`GradingDetailPage`), zebra hover (`ExamMonitoringPage`). |
| `bg-muted/50` | 7 | table header/footer + row hover/selected (shadcn `Table`). |
| `bg-sidebar-*` (dark set `#102a43`) | — | **navigation surface** — the dark sidebar; a deliberately distinct region from the page canvas. |
| `bg-primary` / `bg-primary-soft` (`#eff6ff`) | 28 / 3 | **status accent** — selected/hoverable interactive surfaces, status-tone soft fills (`StatusBadge`, `AttemptDetailPage` tone map, `AuditLogPage`). |
| `bg-destructive/10` (`--danger-soft` `#fef3f2`) | 18 | **feedback / destructive surface** — `InlineErrorBanner`, `ErrorState`, `SaveIndicator` error, field-error soft fills. |
| `bg-success/10` | — | feedback / success surface (`SaveIndicator` saved). |
| `bg-primary/10` | 6 | selected/hoverable choice tiles (`SingleChoice`/`MultipleChoice`/`TrueFalse` selected option, `StatsCard` icon tile, `SaveIndicator` saving, `BrandMark`). |

**Finding:** background usage is *already largely semantic* — `bg-background`
= canvas, `bg-card` = raised content, `bg-muted` = subtle/recycled, sidebar =
distinct dark set. The drift is not in which backgrounds are used, but that
pages freely *combine* `bg-card` + `border` + `rounded-lg` + `shadow-sm` by
hand instead of selecting a named surface. The vocabulary names what is
already (mostly) happening; it does not invent new colors.

### 1.2 Borders

| Class / token | Count | Semantic usage |
| --- | ---: | --- |
| `border` (`--border` `#e5e7eb`) | 206 | **default border** — nearly every panel, section, card, table cell divider. Single tier dominates. |
| `border-border` (explicit) | 7 | equivalent to `border`; explicit form. |
| `border-input` (`--border-strong` `#d1d5db`) | 6 | **input border** — form controls; the only place the stronger tier is wired. |
| `border-destructive` (`--danger-border` `#fecdca`) | 28 | **critical border** — `InlineErrorBanner`, `ErrorState`, invalid controls (`aria-invalid:border-destructive`), `SaveIndicator` error. |
| `border-primary` | — | **interactive/selected border** — selected choice tiles, `SaveIndicator` saving. |
| `border-dashed` | — | placeholder surfaces — `EmptyState`, `ErrorState` panels. |
| `border-sidebar-border` | — | navigation surface divider (dark set). |

**Finding:** there are effectively **two physical tiers** (`--border` default,
`--border-strong` input-only) plus the critical (`--danger-border`) and
interactive (`--primary`) accent borders. The audit flagged "no weak/strong
border narrative" (smell #10) — `--border-strong` is almost only used on
inputs. Border hierarchy is *implied* by color (critical / interactive /
default) rather than by weight.

### 1.3 Radius

| Class | Count | Semantic usage |
| --- | ---: | --- |
| `rounded` (default `--radius` `0.5rem`) | 138 | **content radius** — the dominant tier; sections, cards, shells, inputs. |
| `rounded-md` | 54 | **control radius** — inputs, buttons, small tiles, banners, the sidebar links. |
| `rounded-lg` | 35 | **panel radius** — `PageSection`/`DataTableShell`/`FormSection`/`ContentCard`/toolbars/exam question area. (Overlaps with `rounded` because shadcn `Card` uses `rounded-xl` and pages re-override.) |
| `rounded-xl` | 1 | shadcn `Card` only (`components/ui/card.tsx`). |
| `rounded-sm` | 8 | small affordances. |
| `rounded-full` | 10 | avatars, status dots, pills. |

**Finding:** radius is **already converged** around `--radius: 0.5rem`. The
audit's "RADIUS-DRIFT" (smell #9) is mild in practice — `rounded`/`rounded-lg`
both resolve near `0.5rem` and `rounded-md` (`0.375rem`) serves controls. No
new radius role is needed; the surface vocabulary records the existing
two-tier convention (controls = md, panels = lg/base).

### 1.4 Elevation (shadows)

| Class | Scope | Semantic usage |
| --- | --- | --- |
| `shadow-lg` | `components/ui/{dialog,alert-dialog,dropdown-menu,sheet}` | **overlay elevation** — dialogs, sheets, floating menus. Legitimate. |
| `shadow-md` | `components/ui/{popover,dropdown-menu(sub),select}` | **overlay elevation** — popovers, select content, submenus. Legitimate. |
| `shadow-xs` | `components/layout/AdminLayout` (sticky topbar) | **sticky elevation** — the topbar; excluded from lint by config. Legitimate. |
| `shadow-sm` | `components/ui/{card,tabs}`, `components/shared/StatsCard`, **8 business pages** | **business-content elevation (FORBIDDEN forward)** — the audit's "SHADOW-EVERYTHING / shadow-sm×62" debt. Grandfathered by `baseline.json` for 8 files; the shadcn `Card` primitive carries it by default. |
| `shadow` (bare) | 141 occurrences | **most are false hits** — substring of `shadow-sm`/`shadow-lg`/`shadow-md`/`shadow-xs`/`shadow-none` in `index.css`/lint/util strings. No `shadow` (bare `0 1px ...`) usage found in business `.tsx`. |

**Elevation is the most important surface authority finding.** See §4.

### 1.5 Density (padding / gap)

| Pattern | Where | Semantic density |
| --- | --- | --- |
| `p-6` (24px) content | shadcn `Card` `CardContent`, `StatsCard` | **comfortable** — KPI / prominent content tile. |
| `p-5` (20px) content | `PageSection`/`DataTableShell`(header/footer)/`FormSection`/`ContentCard`/`TakeExamPage` question area | **default** — the standard section body density. |
| `p-4` (16px) | `InlineErrorBanner`, form groups, detail rows | **compact** — block feedback, grouped fields. |
| `p-3` (12px) | choice-option tiles, `ListToolbar`, metadata wells, table cells | **compact** — dense interactive / data rows. |
| `gap-6` / `gap-4` / `gap-3` / `gap-2` | section stacks, form fields, action rows | matches the density tiers above. |

**Finding:** density is **already tiered** at ~12px / 16px / 20px / 24px. The
audit's "SPACING-DRIFT" is not a spacing-value problem; it is that pages
*hand-pick* the tier per block. The vocabulary names the three information
densities (compact / default / comfortable) so a recipe/component can own the
choice.

---

## 2. Confirmed surface roles

| Role | Decision | Purpose | Owned properties | Primary consumer |
| --- | --- | --- | --- | --- |
| `surface.page` | **CONFIRMED** | The application/page canvas behind all content. | background (`--bg`), base text contrast | `body`/`#root`; `ExamLayout`/`AdminLayout` canvas |
| `surface.content` | **CONFIRMED** | Primary readable content region — a titled/untitled bordered block of arbitrary page content. | background (`--surface`), border (`--border`), radius (lg/base) | `PageSection`, `DataTableShell`, `FormSection`, exam question area |
| `surface.subtle` | **CONFIRMED** | A recycled/secondary region visually subordinate to content — table headers, zebra rows, metadata strips, read-only wells. | background (`--surface-muted` / alpha), no independent border/radius (inherits container) | shadcn `Table` header/footer/hover, `type-long-response` well |
| `surface.navigation` | **CONFIRMED** | The persistent navigation region — deliberately a distinct dark set from the page canvas. | background (dark `--sidebar-bg` set), border (`--sidebar-border`) | `AppSidebar` |
| `surface.overlay` | **CONFIRMED** | Floating elements above normal content. The main legitimate **elevation** owner. | background (`--surface`/`--bg`), border, radius, **shadow (md/lg)**, z-index relationship | shadcn `Dialog`/`AlertDialog`/`Popover`/`DropdownMenu`/`Sheet`/`Select`; `ConfirmDialog` |
| `surface.attention` | **CONFIRMED** | A non-overlay region that demands attention by color rather than elevation — block error/success notice, empty/error placeholder. | background (feedback soft `--danger-soft`/`--success-soft`), border (critical/interactive), radius; **no shadow** | `InlineErrorBanner`, `ErrorState`, `EmptyState`(dashed), `SaveIndicator` |

### 2.1 Role detail — confirmed

#### `surface.page` — CONFIRMED

- **Purpose:** the application canvas. The lowest visual layer; everything
  else sits on it.
- **Owned:** background color (`--bg` `#f7f8fb`), base text contrast.
- **Not owned:** padding, layout, container width, content radius, border.
- **Consumers:** `body`/`#root` (`html,body,#root { @apply bg-background }`),
  `AdminLayout`/`ExamLayout` canvas, exam runtime background.
- **Decision rationale:** distinct layer, universally applied, already
  centralized in `index.css`. Naming it makes the contract explicit.

#### `surface.content` — CONFIRMED

- **Purpose:** primary readable content region — the raised white block that
  holds a section's body.
- **Owned:** background (`--surface`), border (`--border`), radius (`rounded-lg`/
  base `--radius`).
- **Not owned:** elevation/shadow, typography, layout, component behavior.
  **Usually no elevation** (see §4).
- **Consumers:** `PageSection`, `DataTableShell`, `FormSection`, `ContentCard`,
  `TakeExamPage` question area (`rounded-lg border bg-card p-5`).
- **Decision rationale:** the audit's "30+ titled content containers" +
  "`rounded-lg border bg-card p-5` ×8" is exactly this role. Naming it lets
  the container components select one surface instead of each recomposing
  `rounded-lg border bg-card`.

#### `surface.subtle` — CONFIRMED

- **Purpose:** a region visually subordinate to content — recycled/stripe
  backgrounds, read-only text wells, metadata strips. Communicates
  "secondary/structural, not primary content."
- **Owned:** background (`--surface-muted` `#f9fafb`, or alpha `/30`/`/50`).
- **Not owned:** independent border/radius — a subtle surface is usually a
  *region inside* a content surface and inherits its border/radius. (The
  `type-long-response` read-only well is the exception and owns its own small
  border/radius as a nested well.)
- **Consumers:** shadcn `Table` header/footer/hover/selected, `ExamMonitoringPage`
  thead/zebra, `type-long-response` answer well (`bg-muted/30`).
- **Decision rationale:** distinct semantic ("subordinate region"), already
  tokenized as `--surface-muted`. Naming it prevents pages from inventing ad-hoc
  gray fills.

#### `surface.navigation` — CONFIRMED

- **Purpose:** the persistent navigation region — intentionally a *distinct
  dark surface set* from the page canvas, signaling "structural chrome, not
  content."
- **Owned:** background (`--sidebar-bg` `#102a43` + `--sidebar-hover`/`--sidebar-active`),
  border (`--sidebar-border`), and its own text scale (`--sidebar-text`/`--sidebar-muted`).
- **Not owned:** page content appearance.
- **Consumers:** `AppSidebar`.
- **Decision rationale:** the sidebar is the only region that uses the dark
  token set. It is a distinct surface region, not a content variant. Naming
  it documents why `bg-sidebar-*` is separate from `bg-card`.

#### `surface.overlay` — CONFIRMED (the elevation owner)

- **Purpose:** floating elements above normal content. **This is the main
  legitimate elevation owner.**
- **Owned:** background (`--surface`/`--bg`), border, radius, **shadow (md/lg)**,
  z-index relationship, contrast.
- **Consumers:** shadcn `Dialog`, `AlertDialog`, `Popover`, `DropdownMenu`,
  `Sheet`, `Select` content; `ConfirmDialog` (built on `AlertDialog`).
- **Decision rationale:** overlays are the only role whose *visual meaning*
  is "elevated above the page." This is the structural justification for the
  forward elevation rule (§4).

#### `surface.attention` — CONFIRMED

- **Purpose:** a non-overlay region that demands attention **by color, not by
  elevation** — block-level error/success notices, empty/error placeholders.
- **Owned:** background (feedback soft fills `--danger-soft`/`--success-soft`/`--primary-soft`),
  border (critical `--danger-border` / interactive `--primary` / dashed), radius
  (md/lg). **No shadow.**
- **Consumers:** `InlineErrorBanner`, `ErrorState`(dashed destructive),
  `EmptyState`(dashed), `SaveIndicator` (border+soft-fill per state).
- **Decision rationale:** these are *in-flow* attention regions (not
  overlays), so they must NOT use elevation — they use color contrast
  instead. Naming the role prevents the temptation to add `shadow` to make a
  banner "pop." Distinguished from `surface.overlay` (which floats) and from
  status presentation (which is owned by `StatusBadge` + `statusMeta`).

---

## 3. Deferred / merged / rejected roles

| Candidate | Decision | Reason |
| --- | --- | --- |
| `surface.panel` | **MERGED into `surface.content`** | The task brief asked to determine whether `surface.panel` (settings groups, summary blocks, supporting info) overlaps `surface.content`. Evidence: all observed "panel" usage (`PageSection`/`FormSection`/settings groups/summary blocks) is *primary readable content* — the same border+bg+radius recipe. There is no observed semantic distinction between "content" and "panel." Creating a second near-identical surface would reproduce the `PageSection`/`ContentCard`/`DataTableShell` collision the component authority already had to reconcile. **One content surface.** |
| `surface.interactive` | **DEFERRED** | The task brief asked whether a hoverable/selectable surface role is needed. Evidence: interactive surfaces today are *state modifications* of an existing surface — selected choice tiles (`border-primary bg-primary/10` on a `surface.content`/`surface.subtle` base), table row hover (`hover:bg-muted/50`), sidebar active (`bg-sidebar-accent`). Interaction is owned by **component state** + the status/feedback color authorities, not by a distinct surface role. A standalone `surface.interactive` would either duplicate content/subtle or duplicate status color. Revisit only if a genuinely interactive region with no underlying content/subtle role appears. |
| `surface.work` | **DEFERRED** | Listed in the plan's token candidates but with no current consumer distinct from `surface.content`. The exam question area uses `surface.content` (`rounded-lg border bg-card p-5`). Keep the candidate name reserved in the plan; do not instantiate without evidence. |
| `surface.card` / `surface.box` / `surface.stat` | **REJECTED** | Implementation names, not semantic layers. The brief explicitly forbade `border-card`/`border-section`/`border-box`/`border-stat`; the same applies to surfaces. A "stat" surface is `surface.content` consumed by `StatsCard`; a "box" surface is `surface.content` or `surface.subtle` depending on role. |

---

## 4. Elevation vocabulary

Elevation is the surface property with the **strongest forward rule** and the
clearest existing enforcement. The audit ranked "SHADOW-EVERYTHING" as smell
#7 (`shadow-sm`×62, almost every `<Card>` manually given `shadow-sm`).

### 4.1 Elevation roles

| Role | Resolves to | Owner |
| --- | --- | --- |
| `elevation.none` | no shadow | ordinary content (`surface.content`/`surface.subtle`/`surface.navigation`/`surface.attention`) |
| `elevation.overlay` | `shadow-md` / `shadow-lg` | `surface.overlay` (dialogs, popovers, dropdowns, sheets, select content) |
| `elevation.sticky` | `shadow-xs` | the sticky topbar (`AdminLayout` header) — the only non-overlay elevation owner |

This is deliberately a **two-tier** (plus sticky) vocabulary, matching the
foundation plan §3.2 ("the initial elevation vocabulary should remain
deliberately small: `elevation.none`, `elevation.overlay`"). `elevation.sticky`
is added because the sticky topbar is a real, lint-acknowledged elevation
owner distinct from overlays.

### 4.2 Allowed elevation owners

```text
Dialog / AlertDialog / Sheet           → shadow-lg   (surface.overlay)
Popover / DropdownMenu / Select content→ shadow-md   (surface.overlay)
sticky topbar (AdminLayout header)     → shadow-xs   (elevation.sticky)
```

These are the **only** roles permitted to introduce shadow.

### 4.3 Forbidden / suspicious elevation (migration candidates)

The forward rule: **ordinary business content must not own elevation.** This
is the surface-level expression of the existing `exam-ui/no-business-shadow`
lint rule. Current debt (all grandfathered in `baseline.json`):

| Bypass | Count | Status |
| --- | ---: | --- |
| `<Card className="shadow-sm">` in business pages | 27 instances across 8 files (`ExamDetailPage` 10×, `SystemDiagnosticsPage` 8×, `ScoreListPage` 7×, `ProctorDashboardPage` 1×, `DashboardPage` 1×, `ExamListPage` 1×) | grandfathered; migration target = drop `shadow-sm`, rely on `surface.content` border |
| `TakeExamPage` question area `shadow-sm` | 1 | grandfathered; migration target = drop, it is already `surface.content` |
| `StatsCard` `shadow-sm` | 1 | grandfathered; component-authority EXTEND already records "drop the shadow, rely on border/surface" |
| shadcn `Card` primitive `shadow-sm` (default) | 1 (the primitive itself) | generated, **not linted** by exam-ui; forward debt to reconcile at migration: decide whether `Card` keeps a default shadow or goes flat. Affects all `Card` consumers. |

**Migration guidance (for UI-MIGRATE-N, not this task):** elevation is removed
from content, not "redistributed." A `surface.content` block does not get a
stronger border to compensate — the audit showed hierarchy already comes from
typography + spacing + the page/content/subtle background tiers. Shadow was
decorative weight, not structural signal.

---

## 5. Border vocabulary

| Role | Resolves to | Owner / usage |
| --- | --- | --- |
| `border.default` | `--border` `#e5e7eb` (`border`) | nearly every panel, section, card, table divider. The dominant tier. |
| `border.strong` | `--border-strong` `#d1d5db` (`border-input`) | form controls / inputs only. |
| `border.critical` | `--danger-border` `#fecdca` (`border-destructive`) | `surface.attention` destructive surfaces (`InlineErrorBanner`, `ErrorState`, invalid controls). |
| `border.interactive` | `--primary` (`border-primary`) | selected / active interactive regions (selected choice tile, `SaveIndicator` saving). |
| `border.placeholder` | dashed (`border-dashed`) | placeholder surfaces (`EmptyState`, `ErrorState` panel). |
| `border.navigation` | `--sidebar-border` (dark set) | `surface.navigation` dividers. |

### Decisions

| Candidate | Decision | Reason |
| --- | --- | --- |
| `border.default` | **CONFIRMED** | the single dominant tier; already tokenized `--border`. |
| `border.strong` | **CONFIRMED** | distinct tier, already tokenized `--border-strong`, used for inputs. Keep scoped to controls. |
| `border.critical` | **CONFIRMED** | distinct semantic (destructive), already tokenized `--danger-border`. Owned by `surface.attention` destructive members. |
| `border.interactive` | **CONFIRMED** | distinct semantic (selected/active), resolves to `--primary`. Not a new token — names the existing `border-primary` usage. |
| `border.subtle` | **DEFERRED** | the plan listed `border.subtle` as a candidate, but no current consumer needs a tier *weaker* than `--border`. `--text-subtle` is already an unwired orphan token (audit §6); inventing a weak border with no consumer repeats that mistake. Defer until evidence appears. |
| `border-card` / `border-section` / `border-box` / `border-stat` | **REJECTED** | implementation names (brief explicitly forbade these). Borders are owned by semantic role (default/strong/critical/interactive), not by the component that renders them. |

**Forward note:** border *weight* is not a current axis — the existing two
physical tiers (`--border` / `--border-strong`) plus color accents (critical /
interactive) carry the hierarchy. Do not introduce border-weight tokens
(thin/medium/thick) without evidence; the audit showed hierarchy relies on
background tier + typography, not border weight (smell #10).

---

## 6. Density vocabulary

Density describes **information density** (how tightly a region packs
content), not raw padding values. The existing tiers:

| Role | Resolves to (padding/gap) | Owner / usage |
| --- | --- | --- |
| `density.compact` | `p-3`/`p-4` (12–16px), `gap-2`/`gap-3` | dense data rows, table cells, toolbars, choice-option tiles, block feedback (`InlineErrorBanner`), metadata wells. |
| `density.default` | `p-5` (20px), `gap-4` | standard section body — `PageSection`/`DataTableShell`(header/footer)/`FormSection` body, exam question area. |
| `density.comfortable` | `p-6` (24px), `gap-4`/`gap-6` | prominent content tile — shadcn `Card` content, `StatsCard`. |

### Decisions

| Candidate | Decision | Reason |
| --- | --- | --- |
| `density.compact` | **CONFIRMED** | distinct information density (dense data / interactive rows); already the de-facto `p-3`/`p-4` tier. |
| `density.default` | **CONFIRMED** | the standard section density; already the de-facto `p-5` tier across all section components. |
| `density.comfortable` | **CONFIRMED** | the prominent/KPI density (`StatsCard`, shadcn `Card`); already the de-facto `p-6` tier. |
| finer tiers (`p-2` vs `p-3`, `p-5` vs `p-6`) | **REJECTED** | the brief explicitly said "do not abstract every padding value." Density names information density, not `p-4` vs `p-5`. Component layout owns the exact value within its density role. |

**Reasoning:** density is the *least* broken surface axis — the tiers already
exist and are consistent. Naming them lets a recipe/component select a density
without a page hand-picking `p-5` each time, but no migration urgency exists.
Density is recorded so future surface recipes (e.g. a `.surface-content`
recipe) can encode the density alongside bg/border/radius if justified.

---

## 7. Component mapping

Components own **surface selection**, not raw surface properties — mirroring
how they own typography *selection*, not raw font properties. The mapping
extends the component authority (`P3-UI-component-authority.md`):

```text
PageSection            → surface.content        (bg-card + border + rounded-lg, no elevation)
DataTableShell         → surface.content        + table-specific overflow-hidden / flush body
FormSection            → surface.content        (titled form block — same surface as PageSection)
ContentCard            → surface.content        (DEMOTE per component authority; thin Card wrapper)
StatsCard              → surface.content        + density.comfortable; elevation NONE (drop shadow-sm)
DataToolbar            → surface.content        (compact toolbar shell)
ListToolbar            → surface.content        (compact toolbar shell)
EmptyState             → surface.attention      (dashed placeholder, no elevation)
ErrorState             → surface.attention      (dashed destructive placeholder, no elevation)
InlineErrorBanner      → surface.attention      (destructive soft fill, no elevation)
SaveIndicator          → surface.attention      (per-state soft fill, no elevation)
ConfirmDialog          → surface.overlay        (shadow-lg via AlertDialog)
shadcn Dialog/Sheet    → surface.overlay        (shadow-lg)
shadcn Popover/Dropdown/Select content → surface.overlay (shadow-md)
AppSidebar             → surface.navigation     (dark sidebar set)
AdminLayout header     → elevation.sticky       (shadow-xs, the only non-overlay shadow)
body / #root / layout canvas → surface.page     (--bg canvas)
```

### Component-specific notes

#### `PageSection` → `surface.content`

Expected mapping, confirmed. Currently recomposes `rounded-lg border bg-card`
inline. Migration target: select `surface.content` (via a recipe or the
existing class set centralized once). Body treatment (padded `p-5`) stays
distinct from `DataTableShell`.

#### `DataTableShell` → `surface.content` + table behavior

Confirmed. Same surface as `PageSection` (`rounded-lg border bg-card`) **plus**
table-specific `overflow-hidden` + flush body (no body padding, so `<Table>`
meets the border). The component authority already ruled: **do not merge**
`PageSection` and `DataTableShell`; the body treatment differs. The surface is
shared; the anatomy is not.

#### `StatsCard` → `surface.content` + `density.comfortable`, elevation NONE

The task brief flagged: "StatsCard should not automatically own shadow because
metric presentation and elevation are different concerns." **Confirmed.**
`StatsCard` currently carries `shadow-sm` (grandfathered). Per the component
authority (EXTEND) and the elevation rule (§4), migration drops the shadow.
StatsCard selects `surface.content` at `density.comfortable`; its distinct
concern is **metric typography** (`type-metric`), not elevation. A metric and a
shadow are orthogonal.

#### Dialog components → `surface.overlay`

Confirmed. `ConfirmDialog` (and the demoted `ConfirmActionDialog`) render via
shadcn `AlertDialog`, which owns `shadow-lg`. This is the canonical elevation
owner. No change needed; recorded so future dialogs inherit the overlay
surface rather than recomposing `shadow-lg` by hand.

---

## 8. Implementation rules

This task establishes **vocabulary and ownership only**. Implementation
primitives are added **only if justified** by a migration; none are added in
this task.

### Preferred mechanism

When implementation is justified, prefer:

```text
CSS variables + Tailwind v4 semantic utilities / custom utilities
```

Example forward shape (NOT created in this task — recorded as the target):

```css
.surface-content  { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); }
.elevation-overlay { /* shadow-md/lg, owned by overlay primitives already */ }
```

Or as Tailwind v4 `@utility` recipes, consistent with how `type-*` recipes are
implemented in `apps/web/src/typography/recipes.css`.

### Do NOT create

```text
<Surface variant="content">     /* a universal Surface React component */
<Panel>
<Box>
<Container>
a new Card variant
```

The brief and the component authority are explicit: no new Card-like or
universal-surface components. Existing authoritative components (`PageSection`,
`DataTableShell`, etc.) select the surface; they do not get a new peer.

### Migration order (for UI-PILOT-1 / UI-MIGRATE-N, not this task)

1. Drop business-page `shadow-sm` (elevation rule) — grandfathered debt.
2. Reconcile shadcn `Card` default shadow at the content-surface level.
3. Centralize `surface.content` selection in `PageSection`/`DataTableShell`/
   `FormSection` (recipe or shared class), removing per-call recomposition.
4. Route `surface.attention` feedback through `InlineErrorBanner`/`ErrorState`/
   `EmptyState` (already components — adoption only).

---

## 9. Future lint preparation

This task does **not** implement new lint. It records the future boundaries so
`UI-LINT-2` can enforce them once migrations exist:

| Future rule | Would enforce | Prerequisite |
| --- | --- | --- |
| `exam-ui/no-business-shadow` | **already active** — business pages cannot introduce elevation (shadow-*). Overlay/topbar excluded. | Existing; debt grandfathered by `baseline.json`. |
| ~~`exam-ui/no-raw-surface-recipe`~~ | ~~reject raw `bg-card` + `border` + `rounded-lg` + (shadow) recomposition in business pages when `surface.content` exists.~~ | **Retired (UI-MIGRATE-N-W3 §13)** — proven same-role sites migrated; the remaining hit (a SIDEBAR_SURFACE) was false-semantic-overlap that no sound AST boundary could exclude. `surface-content` authority retained, enforced by migration review + recipe authority tests. |
| `exam-ui/no-raw-surface` | reject raw bg/border/shadow combinations that recreate a governed surface role. | Requires the surface recipes from §8. |

These arrive in `UI-LINT-2`, gated on the existence of valid semantic
replacements — the same principle as the typography lint ("do not prohibit a
primitive utility unless a semantic authority exists").

---

## 10. Deferred decisions

| Decision | Why deferred |
| --- | --- |
| `surface.interactive` | interaction is owned by component state + status/feedback color today; no standalone interactive surface region exists. Revisit at pilot if one appears. |
| `surface.work` | reserved name in the plan with no current distinct consumer. The exam question area uses `surface.content`. |
| `border.subtle` | no current consumer needs a tier weaker than `--border`; avoids repeating the `--text-subtle` orphan-token mistake. |
| Surface **recipe implementation** (`.surface-content` CSS) | vocabulary + ownership first; recipe primitives are added only when a migration justifies them (UI-RECIPE-1 surface follow-on). |
| shadcn `Card` default-shadow reconciliation | affects every `Card` consumer; decide at migration whether `Card` stays shadowed or goes flat as the content-surface primitive. |
| Form-section surface vs PageSection | `FormSection` uses the same `surface.content` recipe; the component authority records the FormSection-vs-PageSection structural question for pilot. No surface distinction needed. |

---

## 11. Migration notes

These are recorded as guidance for later tasks (UI-PILOT-1, UI-MIGRATE-N). They
are **not** executed here.

1. **Elevation removal (highest signal).** Drop `shadow-sm` from the 8
   grandfathered business pages + `StatsCard`. The `exam-ui/no-business-shadow`
   rule already prevents *new* violations; the grandfathered `baseline.json`
   entries shrink as each file migrates. Do not add stronger borders to
   compensate — hierarchy comes from background tier + typography.
2. **`surface.content` centralization.** Once `PageSection`/`DataTableShell`/
   `FormSection` select a shared content-surface recipe (or shared class set),
   the hand-rolled `<Card className="shadow-sm">` blocks migrate to
   `PageSection` (content) or `DataTableShell` (table), per the component
   authority's SHELL-ADOPTION-DRIFT guidance.
3. **`surface.attention` adoption.** `ExamDetailPage`'s inline destructive
   banner migrates to `InlineErrorBanner` (already enforced by
   `exam-ui/prefer-inline-error-banner`).
4. **Sidebar / overlay / page surfaces.** Already centralized via tokens; no
   migration work — naming them here is documentation, not a task.
5. **Do not** perform a repo-wide mechanical Tailwind surface replacement.
   Migrate by visual-semantic family, same as typography.

---

## 12. Out of scope (explicit)

This task did **not**:

- create, delete, rename, merge, or migrate any component or consumer;
- change any visual styling, recipe, token, CSS, or shadow;
- add, remove, or change any lint rule or baseline entry;
- add any dependency;
- change any test or test coverage;
- create a universal `<Surface>` component, `Panel`, `Box`, or `Container`;
- replace shadcn `Card`;
- migrate any page.

Only this documentation file was produced.

---

## 13. Verification

Verification for this task is documentation-only: confirm no production UI file
changed. The static gate is run to prove nothing was disturbed.

```bash
pnpm lint
pnpm verify:static
```

See the final report for results.
