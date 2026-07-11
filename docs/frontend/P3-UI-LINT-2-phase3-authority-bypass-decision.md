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
| Status (domain lifecycle) | `StatusBadge` + `statusMeta` | **DEFERRED (deterministic lint)** | genuine status-color bypasses are dynamic-`className` / data-flow, not statically token-detectable; categorical `<Badge>` is explicitly allowed and would false-positive. Enforced by review and migration. |
| Audit-action / monitoring / severity tone maps | — (distinct semantic domains) | **NOT A `statusMeta` BYPASS** | see §1: the three audited sites map **different input domains** (audit actions, online-state, warning-level, misconduct severity) that merely reuse the `StatusTone` *vocabulary*. They are not owned by `statusMeta`. No migration is owed. |
| Error — field | `FieldError` | **ALREADY ACTIVE** (`exam-ui/prefer-field-error`, UI-LINT-1) | no new rule needed |
| Error — inline banner | `InlineErrorBanner` | **ALREADY ACTIVE** (`exam-ui/prefer-inline-error-banner`, UI-LINT-1) | no new rule needed |
| Sections | `PageSection` / `FormSection` | **DEFERRED** | 38+ `<CardHeader>` bypasses; `PageSection` has only 2 consumers — migration blocked on UI-PILOT-1/UI-MIGRATE-N. |
| Metrics | `StatsCard` | **DEFERRED** | 20 metric bypasses; `StatsCard` has only 1 consumer (`shared.test.tsx`) — migration blocked on UI-MIGRATE-N. |

**Phase 3 activates zero new rules.** This is the correct outcome under the
brief's "only after migration evidence" + "do not over-enforce" constraints.
The two error sub-roles are already enforced; the status-color sub-role's
deterministic lint is deferred (data-flow bound); the audited tone-map sites
are **not bypasses at all** (distinct semantic domains); the remaining
component sub-roles are blocked on migration coverage.

---

## 1. Status sub-role — semantic-ownership audit then DEFERRED

### 1.0 Authority model — `statusMeta` owns the *status* domain only

`statusMeta.ts` maps **domain lifecycle / diagnostic statuses** to display
metadata (i18n label key + `StatusTone` + icon). Its keys are statuses:
exam lifecycle (`draft`/`published`/`open`/`closed`/…), enrollment
(`assigned`/`started`/`completed`/…), attempt lifecycle
(`not_started`/`queued`/`in_progress`/`disrupted`/`submitted`/`grading`/`graded`/`voided`),
save state, connection diagnostics, health, infra, result, grading, and
misconduct **status** keys. The union it owns is "a domain status → its
presentation".

The shared `StatusTone` union (`primary`/`secondary`/`success`/`warning`/
`destructive`/`info`/`muted`) is a **color vocabulary** — an *output type*
that any semantic domain may reuse. Two mappings that both return `StatusTone`
are **not** thereby the same authority. Authority is determined by the
**input semantic domain** and **who owns the domain → presentation decision**,
not by output-type coincidence. (This is the error the original draft of this
section made: it treated shared `StatusTone` keys as proof that audit-action
and monitoring-condition maps belonged to `statusMeta`.)

### 1.1 Site audit — input domain vs. authority ownership

| Site | Input semantic domain | Current mapping | `statusMeta` owns it? | Why |
| --- | --- | --- | --- | --- |
| `AttemptDetailPage` `EVENT_META` + `eventToneClass` | **audit actions** (`attempt.start`, `attempt.saveAnswer`, `attempt.disrupted`, `attempt.restore`, `attempt.submit`, `attempt.autoSubmit`, `attempt.forceSubmit`, `attempt.extendTime`, `attempt.misconductFlagged`, `grading.score_entered`, `grading.finalized`) | `action → {labelKey, tone, icon}` then `EventTone → bg-*-soft text-*` | **NO** | An audit *action* is not a status. The component itself documents this (L96-97): "Audit *actions* are a distinct vocabulary from lifecycle *statuses*, so this lives here rather than in statusMeta.ts." `statusMeta` has no action keys. |
| `ExamMonitoringPage` `ONLINE_COLOR` | **connectivity classification** (`OnlineStateEnum`: `online`/`stale`/`offline`), heartbeat-freshness-derived | `onlineState → bg-success/warning/destructive` | **NO** | `OnlineState` is a server-derived connectivity classification, not a domain status. `statusMeta` has `connected`/`degraded`/`offline` keys but those model *system connection diagnostics* (a different domain); `OnlineState` models per-attempt heartbeat freshness. Different input domain. |
| `ExamMonitoringPage` `WARNING_COLOR` | **monitoring signal** (`WarningLevelEnum`: `normal`/`warning`/`critical`) | `warningLevel → bg-*/10 text-*` | **NO** | Per the contract (`proctorMonitoring.ts`): `WarningLevel` is "a monitoring signal, NOT a cheating verdict". It is a derived health hint, not a lifecycle status. `statusMeta` has no `normal`/`critical`-as-monitoring keys. |
| `ProctorDashboardPage` misconduct `<Badge variant>` | **misconduct severity** (`MisconductSeverityEnum`: `warning`/`serious`) | `severity → variant destructive/secondary` | **NO** | Severity is a severity enum, not a status. Note the page *does* route the candidate's **status** through `StatusBadge` correctly (`<StatusBadge status={candidate.status} />`). Only the severity chip uses `<Badge>`. |

**Verdict:** none of the audited sites is a `statusMeta` bypass. Each maps a
**distinct input semantic domain** (audit action / online-state / warning-level
/ misconduct severity) that `statusMeta` does not own. The fact that all four
reuse the `StatusTone` color vocabulary is correct and expected — a shared
color palette is not a shared authority.

### 1.2 Are these ungoverned authority candidates?

No migration is owed to `statusMeta` (different input domain). The remaining
question is whether each map is:

- **legitimate local presentation policy**, or
- an **ungoverned authority candidate** (a new domain → presentation mapping
  that should be centralized), or
- a **duplicate of another existing authority**.

Assessment:

- `AttemptDetailPage` `EVENT_META`: **legitimate local presentation policy.**
  The action → labelKey/icon/tone mapping is page-specific presentation of an
  audit trail. There is no second consumer and no cross-page consistency
  requirement. If a second audit-trail consumer appears, it becomes an
  authority candidate (a future `eventMeta` registry), not a `statusMeta`
  migration.
- `ExamMonitoringPage` `ONLINE_COLOR` / `WARNING_COLOR`: **legitimate local
  presentation policy**, *with a note*. They are currently single-consumer.
  The `OnlineState` / `WarningLevel` enums already live in `@exam/contracts`,
  so the *vocabulary* is centralized; only the *color* mapping is local. If a
  second monitoring consumer appears, the color mapping is an authority
  candidate (a monitoring-presentation registry). Today it is not a bypass.
- `ProctorDashboardPage` severity `<Badge>`: **legitimate local presentation
  policy.** Single consumer; severity → destructive/secondary is a one-line
  chip variant, not a registry-worthy mapping.

None of these is a duplicate of `statusMeta`, and none warrants a second
wrapper authority today.

### 1.3 Genuine status-color bypasses (still data-flow-bound)

Separately from the audited sites, a **genuine** status-color bypass would be:
a component hand-rolls a `<Badge>`/`<span>` color for a value that **is** a
`statusMeta` key (an attempt/exam/enrollment lifecycle status, an infra/health
status, etc.) instead of using `<StatusBadge status={…} />`. That bypass shape
is real and remains enforced **by review and migration**, not by deterministic
lint, because:

- it is consumed as a **dynamic `className`** (`className={someMap[value]}`) or
  a computed `variant` (`variant={cond ? "destructive" : "secondary"}`); a
  token-based static rule cannot resolve the referenced variable;
- the two static-detection alternatives are both rejected:
  - **flag every `<Badge>` with a non-`outline` variant** — ~16 of 21 `<Badge>`
    uses in business scope are categorical labels (question type via
    `TYPE_VARIANT`, tags, best-score, import-log rows); the component authority
    is explicit that categorical labels are NOT statuses and may use `<Badge>`;
    mass false positive;
  - **flag the `bg-{tone}-soft text-{tone}` token stack** — the same stack
    legitimately appears on categorical/feedback labels (e.g. `SaveIndicator`
    state map, a feedback component, not a status); false positive.

### 1.4 Decision

**Two separate facts, not to be conflated:**

1. **Authority ownership:** `statusMeta` owns the *status* domain. The three
   audited sites map *non-status* domains (audit action, online-state,
   warning-level, severity) and are **not** `statusMeta` bypasses. No migration
   is owed. (Corrected from the original draft, which misclassified them as
   bypasses based on shared `StatusTone` keys.)
2. **Deterministic static detection:** even for genuine status-color bypasses,
   a deterministic lint rule cannot enforce the authority without unacceptable
   false positives (data-flow / dynamic-`className`; categorical-`Badge`
   collision). That enforcement remains **deferred** — by review and migration,
   not by lint.

These are distinct: fact (1) is an authority-boundary conclusion; fact (2) is
a detection-limitation conclusion. The original draft merged them under a
single "DEFERRED — dynamic className is hard to lint" statement, which
substituted detection difficulty for authority analysis. This section now
answers "who owns this presentation decision?" first, then "can that ownership
be statically enforced today?" separately.

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
