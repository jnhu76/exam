# P3-UI-DENSITY-1 — Semantic Density Vocabulary

> Authority for the semantic **density** roles of the Exam frontend
> (UI-SURFACE-1 §6). Density is the information-density axis of the surface
> authority — the counterpart to surface (region appearance) and typography
> (character hierarchy). It describes **how tightly a region packs content**,
> not raw padding values.
>
> This is a **vocabulary + ownership definition** document. Density is a
> VOCABULARY of named roles and value ranges; it is intentionally NOT a set of
> CSS classes, because a density role legitimately spans a range of padding
> values that the owning component must choose by layout context.
>
> Source of evidence: the accepted surface vocabulary
> (`docs/frontend/P3-UI-surface-vocabulary.md` §6) and the observed padding/gap
> tiers across `apps/web/src`.

---

## Core principle

Density answers:

```text
"How tightly should this region pack its content?"
```

It does NOT answer:

```text
"What exact padding value is applied?"
```

A component owns a density **role**; the component's layout owns the exact
padding/gap value within that role's range. Naming the tiers lets a component
or recipe declare its density without a page hand-picking `p-5` each time, but
density is deliberately not a CSS class — a `.density-compact` class would
falsely pin a single value where `compact` legitimately resolves to `p-3` OR
`p-4` by context.

---

## Authority rules

1. A density role is authoritative only if it names a recurring, distinct
   information density. The three confirmed roles recur across the entire
   application.
2. Density does NOT own typography, surface color, border, radius, elevation,
   or component behavior — only the information-density intent.
3. Component layout owns the exact padding/gap within a density role's range.
   Pinning one value per role would be a false authority.
4. The brief is explicit: **do not abstract every padding value.** Finer tiers
   (`p-2` vs `p-3`, `p-5` vs `p-6`) are REJECTED — density names information
   density, not a padding step.

---

## Confirmed roles

| Role | Resolves to (padding/gap range) | Owner / usage |
| --- | --- | --- |
| `density.compact` | `p-3`/`p-4` (12–16px), `gap-2`/`gap-3` | dense data rows, table cells, toolbars, choice-option tiles, block feedback (`InlineErrorBanner`), metadata wells. |
| `density.default` | `p-5` (20px), `gap-4` | standard section body — `PageSection`/`DataTableShell` (header/footer)/`FormSection` body, exam question area. |
| `density.comfortable` | `p-6` (24px), `gap-4`/`gap-6` | prominent content tile — shadcn `Card` content, `StatsCard`. |

### Role detail

#### `density.compact` — CONFIRMED

- **Meaning:** dense information — data rows, interactive tiles, compact
  controls, block feedback. Content that is scanned, not read.
- **Range:** `p-3`/`p-4`, `gap-2`/`gap-3`. The component chooses the concrete
  value: a table cell uses `p-3`; a block feedback banner uses `p-4`.
- **Consumers:** shadcn `Table` cells, `DataToolbar`/`ListToolbar` (`p-3`),
  `InlineErrorBanner` (`p-4`), choice-option tiles, metadata wells.

#### `density.default` — CONFIRMED

- **Meaning:** the standard section density — readable grouped content.
- **Range:** `p-5`, `gap-4`.
- **Consumers:** `PageSection` body, `DataTableShell` header/footer,
  `FormSection` body, the exam question area.

#### `density.comfortable` — CONFIRMED

- **Meaning:** prominent, generous content — a KPI tile, a highlighted card.
- **Range:** `p-6`, `gap-4`/`gap-6`.
- **Consumers:** shadcn `Card` `CardContent`, `StatsCard`.

---

## Rejected candidates

| Candidate | Decision | Reason |
| --- | --- | --- |
| `density-p4` / `density-p5` | **REJECTED** | implementation names, not information densities. The brief forbade these explicitly. |
| `density-card` / `density-table` | **REJECTED** | component-named densities. Density is owned by semantic role, not by the component that renders it (same rule as borders/surfaces). |
| finer `p-2` vs `p-3` / `p-5` vs `p-6` tiers | **REJECTED** | "do not abstract every padding value." Density names information density; component layout owns the exact value. |
| density as a CSS class (`.density-*`) | **REJECTED (for now)** | a class would falsely pin one value where a role spans a range. Density is a vocabulary + value ranges; a future surface recipe MAY encode a density only when a single value is justified. |

---

## Component mapping

Components declare their density role; their layout owns the exact value.

```text
StatsCard              → density.comfortable   (p-6)
PageSection            → density.default       (p-5 body)
DataTableShell         → density.default       (p-5 header/footer; flush body)
FormSection            → density.default       (p-5 body, gap-4 grid)
DataToolbar            → density.compact       (p-3)
ListToolbar            → density.compact       (p-3)
InlineErrorBanner      → density.compact       (p-4)
EmptyState/ErrorState  → density.comfortable   (p-8 — generous placeholder)
```

---

## Machine-readable mirror

The vocabulary is mirrored in `apps/web/src/surface/density-vocabulary.ts`
(`CONFIRMED_DENSITIES`, `isConfirmedDensity`, `DENSITY_RANGES`) so future
tooling and audits can inspect the authority programmatically.

---

## Out of scope (explicit)

This document does not:

- create any CSS class, token, component, or lint rule;
- change any visual styling;
- migrate any page or component's padding.

It records the density vocabulary and its ownership boundary only.
