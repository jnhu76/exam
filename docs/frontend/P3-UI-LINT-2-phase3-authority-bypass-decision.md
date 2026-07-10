# P3-UI-LINT-2 Phase 3 — Authority-Bypass Rule Decision

> Phase 3 decision record for UI-LINT-2 `exam-ui/no-authority-bypass`.
>
> This is an **analysis + decision** document. Phase 3 of the UI-LINT-2 brief
> asked to "protect" four sub-roles (Status, Error, Sections, Metrics), each
> "only after migration evidence" and with the explicit instruction
> **"Do not over-enforce."** This document records, per sub-role, whether a
> rule is activated, grandfathered-and-activated, or deferred — with the
> repository evidence that justifies each decision.
>
> No rule is added in this document. Where a sub-role was already enforced by
> UI-LINT-1, that enforcement stands. Where a sub-role is deferred, the
> migration owner (UI-PILOT-1 / UI-MIGRATE-N) is recorded.

---

## Summary

| Sub-role | Authority | Decision | Reason |
| --- | --- | --- | --- |
| Status | `StatusBadge` + `statusMeta` | **DEFERRED** | bypass is dynamic-`className` / data-flow, not statically token-detectable; categorical `<Badge>` is explicitly allowed and would false-positive. |
| Error — field | `FieldError` | **ALREADY ACTIVE** (`exam-ui/prefer-field-error`, UI-LINT-1) | no new rule needed |
| Error — inline banner | `InlineErrorBanner` | **ALREADY ACTIVE** (`exam-ui/prefer-inline-error-banner`, UI-LINT-1) | no new rule needed |
| Sections | `PageSection` / `FormSection` | **DEFERRED** | 38+ `<CardHeader>` bypasses; `PageSection` has only 2 consumers — migration blocked on UI-PILOT-1/UI-MIGRATE-N. |
| Metrics | `StatsCard` | **DEFERRED** | 20 metric bypasses; `StatsCard` has only 1 consumer (`shared.test.tsx`) — migration blocked on UI-MIGRATE-N. |

**Phase 3 activates zero new rules.** This is the correct outcome under the
brief's "only after migration evidence" + "do not over-enforce" constraints.
The two error sub-roles are already enforced; the other three are blocked on
migration coverage or are not statically detectable.

---

## 1. Status sub-role — DEFERRED

### The documented bypass

`AttemptDetailPage.tsx:158-166` defines a parallel tone map:

```ts
const eventToneClass: Record<EventTone, string> = {
  primary: "bg-primary-soft text-primary-soft-foreground",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  destructive: "bg-destructive-soft text-destructive",
  info: "bg-info-soft text-info",
  ...
};
```

…and renders it via `<Badge variant="secondary" className={eventToneClass[meta.tone]}>`
(line 370). The `success`/`warning`/`destructive`/`info`/`muted` keys are exactly
the `StatusTone` union owned by `statusMeta.ts`. This is a domain-status
presentation built by hand instead of through `statusMeta` + `StatusBadge` — the
bypass the brief targets.

### Why no static rule is activated

The bypass is consumed as a **dynamic `className`** —
`className={eventToneClass[meta.tone]}`. A token-based static lint rule cannot
resolve the referenced variable; it can only see the literal `variant="secondary"`
on the `<Badge>`. The same dynamic-`className` shape recurs at every other
status-bypass site:

```text
ExamMonitoringPage.tsx:269  className={ONLINE_COLOR[a.onlineState]}
ExamMonitoringPage.tsx:299  className={WARNING_COLOR[a.warningLevel]}
ExamMonitoringPage.tsx:424  className={`shrink-0 ${color}`}     (color computed)
ProctorDashboardPage.tsx:476 variant={... === "serious" ? "destructive" : "secondary"}
```

A rule that flags these would have to do data-flow analysis (recognize that
`eventToneClass`/`ONLINE_COLOR`/`WARNING_COLOR` are tone maps) — fragile, and
not a high-confidence boundary. The two static-detection alternatives are both
rejected:

- **Flag every `<Badge>` with a non-`outline` variant:** ~16 of 21 `<Badge>`
  uses in business scope are categorical labels (question type via
  `TYPE_VARIANT`, tags, best-score, import-log rows). The component authority
  is explicit: "Categorical labels (question type, tags) are NOT statuses and
  may use `<Badge>`." This rule would mass-false-positive.
- **Flag the `bg-{tone}-soft text-{tone}` token stack:** the same stack
  legitimately appears on categorical/feedback labels (e.g. `SaveIndicator`
  state map, which is a feedback component, not a status). False positives.

### Decision

**DEFERRED.** Status-color authority is real (`statusMeta` + `StatusBadge`),
but the bypass is semantic/data-flow, not token-based. A deterministic lint
rule cannot enforce it without unacceptable false positives. This sub-role is
enforced **by review and migration** (route the `eventToneClass` map through
`statusMeta` at UI-MIGRATE-N), not by lint. The brief's "do not over-enforce"
instruction directly applies.

---

## 2. Error sub-roles — ALREADY ACTIVE

### Field error — `FieldError`

`exam-ui/prefer-field-error` (UI-LINT-1) already detects the
`<p text-{sm,xs} text-destructive>` recipe and points to `FieldError`. Current
baseline: 6 grandfathered files. **No new rule.**

### Inline error banner — `InlineErrorBanner`

`exam-ui/prefer-inline-error-banner` (UI-LINT-1) already detects the
`<div rounded + destructive-surface>` recipe and points to `InlineErrorBanner`.
Current baseline: 4 grandfathered files. **No new rule.**

---

## 3. Sections sub-role — DEFERRED

### The bypass

The `<Card><CardHeader><CardTitle>` stack is used as a titled content container
in ≥10 business files (38+ `<CardHeader>` uses: `ExamDetailPage` 10,
`SystemDiagnosticsPage` 8, `ScoreListPage` 6, `ExamConfigForm` 5, …). Per the
component authority, these are **`PageSection` bypasses** (titled content
containers with arbitrary content).

### Why no rule is activated

The authority (`PageSection`) exists, but **migration coverage does not**:
`PageSection` has only **2 business consumers** (`AttemptDetailPage` in-flight +
`shared.test.tsx`). Activating a "use PageSection instead of `<Card>`" rule
would create 38+ violations with no migrated target — the pages have not been
migrated yet, and `<Card>` is a legitimate low-level primitive (the shadcn
`Card` carries `rounded-xl border bg-card ... shadow-sm` and is used in 48
business sites). Forcing migration via lint before the migration task
(UI-PILOT-1 / UI-MIGRATE-N) is backwards: lint follows proven migration, it
does not lead it.

### Decision

**DEFERRED to UI-PILOT-1 / UI-MIGRATE-N.** Revisit after the pilot page and
admin-detail migrations establish real `PageSection` coverage. The
`<CardHeader>` count is the migration backlog signal, not a lint target today.

---

## 4. Metrics sub-role — DEFERRED

### The bypass

20 occurrences of `text-{2xl,3xl,4xl,5xl} font-bold (+ tabular-nums)` across
5 pages reproduce the `type-metric` recipe owned by `StatsCard`:

```text
ScoreListPage        text-2xl font-bold ×5
ExamDetailPage       text-2xl font-bold ×6
SystemDiagnosticsPage text-3xl font-bold
AttemptDetailPage    text-3xl font-bold tabular-nums ×3
ResultPage           text-5xl font-bold
```

### Why no rule is activated

`StatsCard` (the metric authority) has **only 1 business consumer**
(`shared.test.tsx`). The 20 bypass call sites have not migrated. A metric rule
would create 20 violations with no migrated target — the same backwards-lint
problem as the Sections sub-role. (This is also why UI-LINT-2 Phase 1
deliberately deferred the metric-size + bold typography pattern.)

### Decision

**DEFERRED to UI-MIGRATE-N (STAT-CARD-DRIFT).** Revisit after `StatsCard`
migration establishes real metric coverage.

---

## 5. Verification

Phase 3 is a decision document; no rule, baseline, recipe, component, or source
file changed. The static gate confirms nothing was disturbed:

```bash
pnpm lint:eslint
pnpm verify:static
```

---

## 6. Out of scope (explicit)

This document did **not**:

- add, remove, or change any lint rule or baseline entry;
- migrate any component, page, or consumer;
- change any test or test coverage.

Only this documentation file was produced.
