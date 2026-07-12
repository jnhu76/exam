# P3-UI-AGENT-1 — AI UI Construction Guide

> How a future human or AI agent constructs Exam frontend UI. This is the
> operational companion to the authority documents: it tells a builder **what
> to reach for** and **what is forbidden**, so that construction expresses
> semantic intent instead of hand-composing Tailwind visual primitives.
>
> Authority chain (each layer consumes the one above it; never skip a layer):
>
> ```text
> semantic tokens
>     ↓
> semantic recipes (typography type-*, surface surface-*)
>     ↓
> authoritative components (PageHeader, PageSection, StatsCard, ...)
>     ↓
> business pages
> ```
>
> Source documents: `AGENTS.md` (Frontend Visual Authority), the accepted audit
> `P3-UI-AUDIT-0-frontend-visual-language-audit.md`, the foundation plan
> `P3-UI-Foundation-plan.md`, the component authority
> `P3-UI-component-authority.md`, the surface vocabulary
> `P3-UI-surface-vocabulary.md`, the typography vocabulary
> `apps/web/src/typography/typography-vocabulary.md`, and the density
> vocabulary `P3-UI-density-vocabulary.md`.

---

## 1. The mental model

The final consumer should think:

```text
"I need a page section"
```

not:

```text
"I need bg-card + border + rounded-lg + p-5"
```

When you reach for a visual result, first name the **semantic role**. Then find
the authority that owns that role. Only use primitive Tailwind for **structure
and responsive layout** — never to recompose a governed appearance that an
authority already owns.

---

## 2. Construction decision tree

Before writing JSX, walk this tree. If your need matches a role, use the
authority. If it does not, see §5 (escalation).

### Page creation

```text
"What am I creating?"
```

| Need | Authority | Notes |
| --- | --- | --- |
| The single page title (+ description + status + actions) | `PageHeader` | Owns `type-page-title` + `type-page-description`. Pages must not emit a second `h1`. |
| Main readable content block (titled or untitled, arbitrary body) | `PageSection` | Selects `surface-content` + `density.default`. |
| Tabular data surface | `DataTableShell` | `surface-content` + `overflow-hidden` + flush body (table meets the border). Do NOT pad the body. |
| A form block (titled, grouped controls) | `FormSection` | `surface-content` + `density.default`. |
| Metric / KPI presentation (label + value + optional icon/trend) | `StatsCard` | `surface-content` + `density.comfortable` + `type-metric`. Does NOT own elevation. |
| Domain status presentation | `StatusBadge` (+ `statusMeta.ts`) | Domain status color flows ONLY through here. Categorical labels (type/tag badges) are NOT statuses. |
| Form field validation error | `FieldError` | `role=alert`; reuses critical color. Not a `type-*` recipe. |
| Inline destructive error banner (form/submit failure) | `InlineErrorBanner` | `surface-attention` + destructive color variant. |
| Full-area loading placeholder | `LoadingState` | `role=status` + `aria-busy`. |
| Empty-data placeholder | `EmptyState` | `surface-attention` (dashed). |
| Full-area error placeholder (failed load) | `ErrorState` | `surface-attention` (dashed destructive) + retry. |
| Generic confirmation dialog | `ConfirmDialog` | `surface-overlay` (shadow-lg via AlertDialog). |
| Data-table operation toolbar | `DataToolbar` | `surface-content` + `density.compact`. |
| List/card-list operation toolbar (search-first) | `ListToolbar` | `surface-content` + `density.compact`. |
| Table pagination | `DataTablePagination` | |
| Table row action group | `RowActions` | `role=group`. |
| Controlled search input | `SearchInput` | |
| Form field layout | `FieldGroup` / `Field` / `FieldRow` / `FieldStack` / `FormStack` | spacing/layout primitives. |

### PageSection vs FormSection — decision rule

Both render a titled bordered block over `surface-content`, so they look
alike. The distinction is **semantic, not visual**. Walk this rule before
picking one:

```text
Is this primarily a content / read-only region?
    → use PageSection
    (statistics, details, information blocks, read-only summaries)

Is this primarily an editable form grouping?
    → use FormSection
    (settings forms, configuration forms, grouped input controls)
```

- **`PageSection`** owns a *readable content region* — arbitrary view-oriented
  grouping (statistics, detail blocks, read-only information). Its body is
  padded arbitrary content (`density.default`).
- **`FormSection`** owns an *editable grouped-controls region* — form
  semantics and field organization. Its body is a form/grid
  (`density.default`, `grid gap-4`).

Do not create variants. Do not rename. Do not merge. If a block mixes the two,
choose by the **dominant** content: a read-only summary with one inline control
is a `PageSection`; a form with a read-only helper note is a `FormSection`.

### Typography

```text
"What text role is this?"
```

Reach for a `type-*` recipe, never a primitive `text-sm font-medium leading-5`
stack. Recipes: `type-page-title`, `type-page-description`, `type-section-title`,
`type-body`, `type-secondary`, `type-metadata`, `type-reading`,
`type-long-response`, `type-metric`, `type-numeric`, `type-code`. See
`apps/web/src/typography/typography-vocabulary.md`.

Note: `type-metric` owns weight + tabular-nums but **not** size — layout owns
size (`text-2xl`/`text-3xl`/`text-5xl` compose onto the recipe).

### Surface

```text
"What visual layer does this content belong to?"
```

Reach for a `surface-*` recipe, never a recomposed `bg-card border rounded-lg`
stack. Roles: `surface-page`, `surface-content`, `surface-subtle`,
`surface-navigation`, `surface-overlay`, `surface-attention`. See
`docs/frontend/P3-UI-surface-vocabulary.md`.

Usually you select a surface **through its owning component** (e.g.
`PageSection` already selects `surface-content`). You only reference a
`surface-*` class directly when building a new authoritative component or a
recipe implementation — not in business pages.

### Density

```text
"How tightly should this pack content?"
```

Density is a vocabulary (`compact` / `default` / `comfortable`), not a class.
The component owns the exact padding/gap within its density role. See
`docs/frontend/P3-UI-density-vocabulary.md`.

---

## 3. Forbidden patterns

### Do NOT create these when an authority applies

```text
a new <Card>
a new <Panel>
a new <Box>
a new <Container>
a universal <Surface variant="...">
```

These are not authorities. They are styling conveniences that reproduce a role
already owned by `PageSection` / `DataTableShell` / etc.

### Do NOT recompose a governed appearance from primitives

Forbidden in a business page when the semantic role already exists:

```tsx
<div className="bg-card border rounded-lg shadow-sm p-5">
```

This is `surface-content` (without the shadow). Use `PageSection` (or the
relevant authority) instead.

### Do NOT introduce elevation on ordinary content

Shadows are reserved for `surface-overlay` (dialogs/popovers/dropdowns/sheets)
and the sticky topbar. Ordinary content, metrics, banners, and placeholders
must NOT carry a `shadow-*` utility. Elevation in ordinary content must come
from an authoritative component primitive (e.g. the `Card` primitive, which
owns `shadow-sm`) or be absent when the surface is flat (`surface-content`).
Enforced by `exam-ui/no-business-shadow` — the baseline is **empty**
(UI-MIGRATE-N-W4B closed all registered debt; the detector is variant-aware,
so `hover:shadow-md`, `data-[state=open]:shadow-lg`, and `shadow-[…]` are
caught too).

### Do NOT invent page-local typography

- No page-local `font-family` stacks. Chinese font selection is centrally owned
  in `index.css` (`--font-ui` / `--font-reading` / `--font-serif`).
- No one-off `text-[...]` / `leading-[...]` / `tracking-[...]` arbitrary values
  (enforced by `exam-ui/no-arbitrary-typography`).
- No inventing new `type-*` recipes in pages. Reach for the confirmed recipe.

### Do NOT map domain status to raw color

Domain status color must flow through `statusMeta.ts` + `StatusBadge`. Do not
hand-roll tone maps with `<Badge className={...}>` for a domain status.
(Categorical labels — question type, tags — are NOT statuses and may use
`<Badge>`.)

### Do NOT recreate field errors or inline banners

Use `FieldError` (per-field) and `InlineErrorBanner` (block-level / submit).
`InlineErrorBanner` is enforced today by `exam-ui/prefer-inline-error-banner`,
narrowed in UI-MIGRATE-N-W2 to require `role="alert"` on the matched `<div>`
(so destructive control-state/status surfaces that merely reuse the color are
not flagged).
`FieldError` ownership is enforced by semantic migration review + the authority
component tests (`FieldError.test.tsx`): the former `exam-ui/prefer-field-error`
rule was retired in UI-FIELD-ERROR-AUTHORITY-CLOSURE-1 because its structural
recipe could not distinguish FieldError ownership from other destructive-`<p>`
roles (DOMAIN_WARNING / CONTROL_STATE_FEEDBACK / INLINE_OPERATION_ERROR).

---

## 4. What Tailwind is still for

Business pages **may** use Tailwind freely for **structure and responsive
layout**:

```text
flex / grid / block / hidden
relative / absolute / fixed / sticky
items-* / justify-*
grid-cols-* / col-span-*
w-* / h-* / min-* / max-* / overflow-*
gap-* / space-*
responsive variants
```

Example of valid business-page Tailwind:

```tsx
<div className="grid gap-4 lg:grid-cols-4">
```

The boundary is: **do not recompose a governed appearance recipe** (typography,
surface, elevation, domain-status color) from primitive utilities when a
semantic authority owns that role. Structure is yours; governed appearance is
not.

---

## 5. Escalation rule — when no authority exists

If you need a visual result and **no** authority in §2 covers it:

1. **Identify the missing semantic role.** Name what you actually need (e.g.
   "a read-only long-text answer panel", "a metadata label:value list").
2. **Check whether it belongs to an existing role.** Many "new" needs are an
   existing component or recipe used differently. (Distinguish *component does
   not exist* from *component exists but appears insufficient* — the latter
   triggers extending the authority, not bypassing it.)
3. **Propose the authority addition.** Document the role, its owned properties,
   and its consumers. Do NOT implement silently.
4. **Wait for approval.** A vocabulary/authority change is a documented decision
   (a new vocabulary entry or component-authority update), not a local styling
   choice.

An agent must **never** silently create a local visual language to work around
a missing authority. That is exactly the drift this system exists to prevent.

---

## 6. Where the authorities live (quick reference)

```text
Typography recipes (CSS)        apps/web/src/typography/recipes.css
Typography vocabulary (TS)      apps/web/src/typography/typography-vocabulary.ts
Typography vocabulary (doc)     apps/web/src/typography/typography-vocabulary.md
Surface recipes (CSS)           apps/web/src/surface/recipes.css
Surface vocabulary (TS)         apps/web/src/surface/surface-vocabulary.ts
Surface vocabulary (doc)        docs/frontend/P3-UI-surface-vocabulary.md
Density vocabulary (TS)         apps/web/src/surface/density-vocabulary.ts
Density vocabulary (doc)        docs/frontend/P3-UI-density-vocabulary.md
Component authority (doc)       docs/frontend/P3-UI-component-authority.md
Status mapping                  apps/web/src/lib/statusMeta.ts
Status component                apps/web/src/components/shared/StatusBadge.tsx
Lint rules                      apps/web/src/lint/exam-ui/
```

Before creating or locally recreating a visual structure, inspect in order:

```text
apps/web/src/components/ui          # shadcn primitives (generated, do not hand-edit)
apps/web/src/components/shared      # authoritative shared business components
apps/web/src/typography             # type-* recipes
apps/web/src/surface                # surface-* recipes + density vocabulary
the role → owner table above
```

---

## 7. Lint enforcement (current state)

The `exam-ui/*` rules are wired as errors in `apps/web/eslint.config.ts` for
business / feature / layout source. The wired config is the implementation fact;
this section must match it. (See `AGENTS.md` → "Enforcement" for the canonical
active/deferred split.)

### Active enforcement

| Rule | Enforced semantic role (today) |
| --- | --- |
| `exam-ui/prefer-inline-error-banner` | a `<div role="alert">` with rounded + destructive-surface utilities must use `InlineErrorBanner` (narrowed to `role="alert"` in UI-MIGRATE-N-W2; baseline cleared 4→0) |
| `exam-ui/no-business-shadow` | no `shadow-*` in ordinary business content (baseline empty; cleared 7→0 in UI-MIGRATE-N-W4B; detector variant-aware — catches `hover:shadow-md`, `data-[state=open]:shadow-lg`, `shadow-[…]`) |
| `exam-ui/no-arbitrary-typography` | no new arbitrary `text-[…]` / `leading-[…]` / `tracking-[…]` |

### Retired enforcement

| Rule | Retired in | Reason |
| --- | --- | --- |
| `exam-ui/prefer-field-error` | UI-FIELD-ERROR-AUTHORITY-CLOSURE-1 §8 | structural recipe could not distinguish FieldError ownership from DOMAIN_WARNING / CONTROL_STATE_FEEDBACK / INLINE_OPERATION_ERROR roles |
| `exam-ui/no-raw-typography` | UI-MIGRATE-N-W3 §12 | structural recipe could not distinguish SECTION_TITLE ownership from TOPBAR / QUESTION / RUNTIME / OVERLAY title roles (4/4 remaining hits false-semantic-overlap; no sound NARROW AST boundary) |
| `exam-ui/no-raw-surface-recipe` | UI-MIGRATE-N-W3 §13 | structural recipe could not distinguish PAGE_CONTENT_SECTION ownership from a SIDEBAR_SURFACE (1/1 remaining hit false-semantic-overlap; the sidebar's `rounded-lg` could not be excluded by AST) |

Retired rules are removed from the plugin, the eslint config, and the baseline.
Their recipe/component authorities (`type-section-title`, `surface-content`,
`FieldError`) remain canonical — ownership is enforced by semantic migration
review and the recipe/component authority tests, not by a structural lint proxy.
Do **not** re-introduce a structural recipe lint rule without a proven
deterministic ownership detector (contrast `prefer-inline-error-banner`, which
narrows soundly on the authority-owned `role="alert"`).

### Deferred enforcement

Rules/roles **not** enforced today, and why:

| Role | Reason deferred |
| --- | --- |
| broader typography (`type-metric`, `type-body`, `type-secondary`, …) | authority exists, migration coverage does not (blocked on UI-PILOT-1 / UI-MIGRATE-N) |
| component-authority bypasses (`PageSection` vs `<Card><CardHeader>`, `StatsCard` vs `text-2xl font-bold`) | authority exists, migration coverage does not (blocked on UI-PILOT-1 / UI-MIGRATE-N) |
| domain-status-color authority | authority exists (`statusMeta` + `StatusBadge`), but the bypass is dynamic-`className` / data-flow, not statically token-detectable without false positives against categorical `<Badge>` labels; enforced by review and migration. The semantic-ownership boundary (which domains `statusMeta` owns vs. which merely reuse the `StatusTone` vocabulary) is recorded in `P3-UI-LINT-2-phase3-authority-bypass-decision.md` |
| `exam-ui/no-authority-bypass` (umbrella) | not implemented; per-role migration coverage not yet sufficient |

Principle (from the foundation plan): **do not prohibit a primitive utility
unless a semantic authority exists.** Prohibitions arrive gated on valid
semantic replacements. Deferred enforcement is split into "authority exists /
migration incomplete" vs. "authority exists / deterministic static detection
unavailable" — these are different reasons and must not be conflated.
