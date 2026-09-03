# UI Open Items

> **Status: superseded as an executable backlog (2026-08-14).** The unfinished
> frontend visual-authority migration work is now tracked by GitHub Issues —
> see [`post-mvp-issues.md`](post-mvp-issues.md) (UI section). For the as-built
> UI system, see [`docs/standards/ui-system.md`](../standards/ui-system.md);
> for the frontend architecture, see
> [`docs/architecture/frontend.md`](../architecture/frontend.md).

| Workstream | Issue | Notes |
| --- | --- | --- |
| UI design-system migration completion (typography recipes, StatsCard, PageSection, component collisions, Card shadow decision, authority lint, remaining admin form/modal i18n copy) | #305 | Covers the former items 1–6 below; sequencing preserves UI-PILOT-1 → UI-MIGRATE-N. |
| Responsive + mobile closeout (390px baseline) | #306 | — |
| Accessibility closeout (product-wide baseline) | #307 | Builds on the J5-I1D a11y closeout. |
| Long-text answer + metadata/definition-list components (+ `ConnectionIndicator` fate) | #308 | Former item 7 (unowned roles). |

## Historical inventory (superseded — see issues above)

The former items are retained here only as the migration inventory that the
issues were built from:

1. **Broader typography recipe migration (~20+ sites unmigrated)** → #305 —
   `type-body`, `type-secondary`, `type-metadata`, `type-reading`,
   `type-long-response`, `type-numeric`, `type-code` recipes exist; most call
   sites still use raw primitives. Not activatable as lint until migration
   exists (UI-PILOT-1 / UI-MIGRATE-N).
2. **StatsCard metric migration (STAT-CARD-DRIFT)** → #305 — ~20 metric
   bypasses across 5 pages (`ScoreListPage`, `ExamDetailPage`,
   `SystemDiagnosticsPage`, `AttemptDetailPage`, `ResultPage`) use raw
   `text-{2xl,3xl,4xl,5xl} font-bold` instead of `StatsCard`.
3. **PageSection adoption (SHELL-ADOPTION-DRIFT)** → #305 — ~38 `<CardHeader>`
   bypasses across ≥10 business files hand-roll
   `<Card><CardHeader><CardTitle>` instead of `PageSection`.
4. **Component collision reconciliation** → #305 — FormSection vs PageSection;
   ListToolbar vs DataToolbar (re-validate at UI-PILOT-1; merge if anatomies
   cannot be kept distinct).
5. **shadcn `Card` primitive default-shadow reconciliation** → #305 — whether
   `Card` stays shadowed or goes flat as the content-surface primitive is
   unresolved forward debt.
6. **Component-authority bypass lint (umbrella rule)** → #305 —
   `exam-ui/no-authority-bypass` is not implemented; the 5 active `exam-ui/*`
   rules are the only wired enforcement.
7. **Unowned roles** → #308 — metadata/definition list (inline grids), read-only
   long-text answer panel (inline on `GradingDetailPage`), `ConnectionIndicator`
   (orphan; rebuild against `statusMeta` if the role is ever needed).
