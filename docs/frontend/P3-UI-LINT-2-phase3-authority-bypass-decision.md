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
| Audit-action / monitoring tone maps | — (distinct semantic domains) | **NOT A `statusMeta` BYPASS** | see §1: the audited sites that remain distinct map **different input domains** (audit actions, online-state, warning-level) that merely reuse the `StatusTone` *vocabulary*. They are not owned by `statusMeta`. No migration is owed. (The misconduct-severity and ExamMonitoring AttemptStatus-label sites were same-domain duplicates and have been repaired — see §1.1.) |
| Error — field | `FieldError` | **RETIRED (deterministic lint)** | `exam-ui/prefer-field-error` was retired in UI-FIELD-ERROR-AUTHORITY-CLOSURE-1 (§8): its structural recipe could not distinguish FieldError ownership from DOMAIN_WARNING / CONTROL_STATE_FEEDBACK / INLINE_OPERATION_ERROR roles (4/4 remaining hits were false-semantic-overlap). All known same-role bypasses have been migrated; ownership is now enforced by semantic migration review + authority component tests, not a structural lint proxy. |
| Error — inline banner | `InlineErrorBanner` | **ALREADY ACTIVE** (`exam-ui/prefer-inline-error-banner`, UI-LINT-1) | no new rule needed |
| Sections | `PageSection` / `FormSection` | **DEFERRED** | 38+ `<CardHeader>` bypasses; `PageSection` has only 2 consumers — migration blocked on UI-PILOT-1/UI-MIGRATE-N. |
| Metrics | `StatsCard` | **DEFERRED** | 20 metric bypasses; `StatsCard` has only 1 consumer (`shared.test.tsx`) — migration blocked on UI-MIGRATE-N. |

**Phase 3 activates zero new rules.** This is the correct outcome under the
brief's "only after migration evidence" + "do not over-enforce" constraints.
The two error sub-roles are already enforced; the status-color sub-role's
deterministic lint is deferred (data-flow bound); two same-domain duplicates
(misconduct severity, ExamMonitoring attempt-status label) were repaired in
UI-LINT-2-CORRECTIVE-2; the remaining audited tone-map sites are **not
bypasses at all** (distinct semantic domains); the remaining component
sub-roles are blocked on migration coverage.

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
| `ProctorDashboardPage` misconduct severity (REPAIRED) | **misconduct severity** (`MisconductSeverityEnum`: `warning`/`serious`) — same input domain `statusMeta` owns via `misconduct_warning`/`misconduct_serious` | was: `severity → variant destructive/secondary` (a **drift**: `warning → secondary`, canonical is `warning → warning tone`); now: `<StatusBadge status={`misconduct_${severity}`} />` | **YES** (corrected) | `statusMeta` owns the `MisconductSeverityEnum → presentation` decision (`misconduct_warning`/`misconduct_serious` keys), and `AttemptDetailPage` already routes the exact same domain through `StatusBadge`. The earlier draft classified this as a distinct "severity" domain — that was wrong: the severity *is* the status key suffix, and an active canonical consumer already existed. Repaired in UI-LINT-2-CORRECTIVE-2. |
| `ExamMonitoringPage` attempt-status label (REPAIRED) | **AttemptStatus** (`in_progress`/`disrupted`/`submitted`/`grading`/`graded`/`voided`) — same input domain `statusMeta` owns via its `labelKey` metadata | was: page-local `STATUS_LABEL_KEY` map (`status → admin.examMonitoring.statusLabels.*`); now: `t(statusLabelKey(getStatusMeta(a.status).labelKey))` | **YES** (corrected) | `statusMeta` owns the `AttemptStatus → labelKey` decision. The page rendered plain text (not a Badge), but the *label metadata* was a same-domain duplicate. Repaired in UI-LINT-2-CORRECTIVE-2 by routing the label key through the canonical owner while preserving the plain-text surface. |

**Verdict:** of the audited sites, the misconduct-severity and ExamMonitoring
attempt-status-label sites **were** same-domain `statusMeta` duplicates and
have been repaired (UI-LINT-2-CORRECTIVE-2). The remaining sites (audit action
/ online-state / warning-level) map **distinct input semantic domains** that
`statusMeta` does not own. They reuse the `StatusTone` color vocabulary, which
is correct and expected — a shared color palette is not a shared authority.

### 1.2 Are these ungoverned authority candidates?

For the remaining distinct-domain sites, no migration is owed to `statusMeta`
(different input domain). The remaining question is whether each map is:

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
- `ProctorDashboardPage` severity `<Badge>`: **was a same-domain duplicate
  (REPAIRED).** `statusMeta` owns `misconduct_warning`/`misconduct_serious` and
  `AttemptDetailPage` already routed the same `MisconductSeverityEnum` through
  `StatusBadge`. The page-local `severity → variant` mapping was an authority
  drift (`warning → secondary` vs canonical `warning → warning tone`), not a
  distinct domain. Repaired in UI-LINT-2-CORRECTIVE-2 to
  `<StatusBadge status={`misconduct_${severity}`} />`.

None of the remaining distinct-domain sites is a duplicate of `statusMeta`, and none warrants a second
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

1. **Authority ownership:** `statusMeta` owns the *status* domain, including
   the misconduct-severity presentation (`misconduct_warning`/
   `misconduct_serious`) and the AttemptStatus label metadata. Two audited
   sites — `ProctorDashboardPage` misconduct severity and `ExamMonitoringPage`
   attempt-status label — were same-domain duplicates and have been repaired
   (UI-LINT-2-CORRECTIVE-2). The remaining audited sites map *non-status*
   domains (audit action, online-state, warning-level) and are **not**
   `statusMeta` bypasses; no migration is owed there. (Corrected from the
   original draft, which misclassified all four as distinct domains based on
   shared `StatusTone` keys.)
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

## 2. Error sub-roles

### Field error — `FieldError` (deterministic lint RETIRED)

`exam-ui/prefer-field-error` (UI-LINT-1) was **retired** in
UI-FIELD-ERROR-AUTHORITY-CLOSURE-1 (§8/§9). Its structural recipe
(`<p> + text-destructive + text-size`) could not deterministically distinguish
FieldError ownership from DOMAIN_WARNING, CONTROL_STATE_FEEDBACK, or
INLINE_OPERATION_ERROR — 4/4 remaining hits were false-semantic-overlap and no
sound NARROW detector existed. All known same-role bypasses
(`GradingDetailPage`, `ExamConfigForm` time/score, `SubjectiveAnswerInput`) have
been migrated to `FieldError`. The non-owner sites (DOMAIN_WARNING /
CONTROL_STATE_FEEDBACK / 2× INLINE_OPERATION_ERROR) are routed to their correct
roles. `FieldError` remains the canonical authority; ownership is enforced by
semantic migration review + `FieldError.test.tsx`, not a structural lint proxy.

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
`PageSection` has only **2 consumers** (committed `AttemptDetailPage`
result-summary section + `shared.test.tsx`). A single page-level consumer
plus a test is still insufficient coverage. Activating a "use PageSection instead of `<Card>`" rule
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
file changed. Verification confirms all static checks pass:

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

> **UI-LINT-2-CORRECTIVE-2 update:** the original Phase 3 document classified
> the `ProctorDashboardPage` misconduct-severity chip and the
> `ExamMonitoringPage` attempt-status label as distinct local domains. An
> adversarial clean-HEAD review found both were same-domain `statusMeta`
> duplicates (misconduct severity → `misconduct_warning`/`misconduct_serious`;
> AttemptStatus → `labelKey`). Both have been repaired at the source
> (`ProctorDashboardPage` now routes `<StatusBadge status={`misconduct_${severity}`} />`;
> `ExamMonitoringPage` now derives the label via
> `t(statusLabelKey(getStatusMeta(a.status).labelKey))`), with ownership-sensitive
> tests. This section's "no source file changed" claim held for the original
> Phase 3 decision; UI-LINT-2-CORRECTIVE-2 is a separate later corrective that
> did change those two pages and their tests.
