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
must NOT carry a `shadow-*` utility. Enforced today by `exam-ui/no-business-shadow`.

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
Enforced today by `exam-ui/prefer-field-error` and
`exam-ui/prefer-inline-error-banner`.

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

## 7. Future lint (not yet active)

The following rules are **documented candidates**, activated only after
migration coverage exists (UI-LINT-2). Do not assume they are enforced today
beyond what `AGENTS.md` lists as active.

| Candidate rule | Would enforce | Prerequisite |
| --- | --- | --- |
| `exam-ui/no-raw-typography` | reject recomposing a `type-*` recipe from primitive text/font utilities in business pages | migration coverage of typography recipes |
| `exam-ui/no-raw-surface-recipe` | reject raw `bg-card` + `border` + `rounded-lg` (+ shadow) recomposition when `surface-content` exists | surface recipes exist (now landed) + migration coverage |
| `exam-ui/no-business-shadow` | **already active** — ordinary content cannot introduce shadow | existing; debt grandfathered by baseline |
| `exam-ui/no-authority-bypass` | reject bypassing an authoritative component for a role it owns | per-role migration coverage |

Principle (from the foundation plan): **do not prohibit a primitive utility
unless a semantic authority exists.** Prohibitions arrive in UI-LINT-2, gated on
valid semantic replacements.
