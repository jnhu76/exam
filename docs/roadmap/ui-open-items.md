# UI Open Items

> Unfinished frontend visual-authority migration work. The authority (recipes,
> components, lint) exists; migration coverage does not. For the as-built UI
> system, see [`docs/standards/ui-system.md`](../standards/ui-system.md); for
> the frontend architecture, see [`docs/architecture/frontend.md`](../architecture/frontend.md).

These items are blocked on representative page migration (UI-PILOT-1) and
controlled family-by-family migration (UI-MIGRATE-N). A lint rule cannot be
activated for a role until proven migration exists — otherwise the rule creates
violations with no migrated target.

## 1. Broader typography recipe migration (~20+ sites unmigrated)

- **Authority exists:** `type-body`, `type-secondary`, `type-metadata`,
  `type-reading`, `type-long-response`, `type-numeric`, `type-code` recipes.
- **Migration incomplete:** most call sites still use raw primitives (`text-sm`,
  `text-xs`, `font-medium`, `text-lg`). Only ~18 semantic recipe uses exist in
  business scope today. `type-numeric`/`type-code` have zero migrated consumers.
- **Not activatable as lint:** a broad recipe-bypass rule has unacceptable
  false-positive risk until pages migrate. Blocked on UI-PILOT-1 / UI-MIGRATE-N.

## 2. StatsCard metric migration (STAT-CARD-DRIFT)

- **Authority exists:** `StatsCard` (+ `type-metric`); today `StatsCard` selects
  `surface-content` and is deliberately flat.
- **Migration incomplete:** ~20 metric bypasses across 5 pages
  (`ScoreListPage`, `ExamDetailPage`, `SystemDiagnosticsPage`,
  `AttemptDetailPage`, `ResultPage`) use raw `text-{2xl,3xl,4xl,5xl} font-bold`
  instead of `StatsCard`. `StatsCard` has only 1 business consumer.
- **Blocked on:** UI-MIGRATE-N.

## 3. PageSection adoption (SHELL-ADOPTION-DRIFT)

- **Authority exists:** `PageSection` (content container).
- **Migration incomplete:** ~38 `<CardHeader>` bypasses across ≥10 business files
  hand-roll `<Card><CardHeader><CardTitle>` as titled content containers instead
  of `PageSection`. `PageSection` has only 2 consumers.
- **Blocked on:** UI-PILOT-1 / UI-MIGRATE-N.

## 4. Component collision reconciliation (validate at pilot)

- **FormSection vs PageSection:** both render a titled bordered block over
  `surface-content`; the distinction is semantic (read-only content vs editable
  form grouping). Re-validate at UI-PILOT-1; merge if anatomies cannot be kept distinct.
- **ListToolbar vs DataToolbar:** provisional boundary (ListToolbar = search-first
  list surface at `lg`; DataToolbar = free-children tabular toolbar at `sm`). Too
  subtle to be a reliable authority boundary; re-evaluate at UI-PILOT-1 and merge
  if anatomies cannot be kept distinct.

## 5. shadcn `Card` primitive default-shadow reconciliation

- The `Card` primitive (`components/ui/card.tsx`) still carries `shadow-sm` by
  default and lives in excluded lint scope. Whether `Card` stays shadowed or goes
  flat as the content-surface primitive is **unresolved forward debt** affecting
  every `Card` consumer.

## 6. Component-authority bypass lint (umbrella rule)

- `exam-ui/no-authority-bypass` (the umbrella component-bypass rule) is **not
  implemented** — per-role migration coverage is not yet sufficient. The 5 active
  `exam-ui/*` rules are the only wired enforcement; broader component-authority
  bypasses (PageSection, StatsCard) are review-enforced only.

## 7. Unowned roles

- **metadata / definition list (label:value):** currently inline grids; no
  component authority.
- **read-only long-text answer panel:** currently inline (`GradingDetailPage`);
  no component yet.
- **`ConnectionIndicator`:** orphan (0 consumers); if a connection-status role is
  needed, rebuild against `statusMeta`, not as-is.
