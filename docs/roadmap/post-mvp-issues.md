# Post-MVP Work Index

> **GitHub Issues are the authority for executable future work.** This index
> links Issues only — it does not duplicate their specifications. A roadmap
> may summarize an Issue; no Issue means the work is not scheduled.
> Historical milestone evidence lives in `docs/audits/`; the P7 program
> closure is recorded in
> [`docs/audits/P7-FINAL-PROGRAM-CLOSEOUT.md`](../audits/P7-FINAL-PROGRAM-CLOSEOUT.md).

## Phase 2+ Exam Operation

- #291 Additional exam timing modes (`timed_sync`, `deadline`, `untimed`)
- #292 Operational admission queue (`requireQueue`; Redis-backed execution decision-gated)
- #293 Controlled / Strict high-assurance exam profiles (queue admission, session/device binding, stronger identity)
- #294 Question / option randomization
- #295 Managed desktop lockdown client (Electron)

## Phase 3 Collaboration / Permissions

- #286 Teacher@Course scoped authority (F-04)
- #296 Grader@Exam scoped authority and assignment flow
- #297 Staff invitation + Email password reset + account lifecycle
- #298 Permission registry + permission audit + audit-log search/export UI
- #299 Additional operational notifications (P5-N2)
- #300 Email template engine + backend i18n

## Answering / Grading

- #301 Rich-text / WYSIWYG authoring and answering protocol
- #302 Generic final-answer submit barrier (ADR-008 Option D)

## Recovery / Operations

- #303 Proctor Recovery Center (REC-OPS J6)
- #304 System-generated incidents

## UI

- #305 UI design-system migration completion (recipes, StatsCard, PageSection, collisions, lint; incl. remaining admin form/modal i18n copy)
- #306 Responsive + mobile closeout (390px baseline)
- #307 Accessibility closeout (product-wide baseline)
- #308 Long-text answer + metadata/definition-list components

## Phase 4 Platformization

- #309 Pass-to-proceed API + service tokens / API keys
- #310 Webhooks (signed, retryable, audited)
- #311 Optional multiTenant platformization (SuperAdmin, tenant hierarchy, cross-tenant audit)
- #312 External log shipping (syslog / OTLP export per ADR-018)
- #313 Custom roles from the capability catalog

## Decision-gated (no Issue — recorded in ADR-001)

Redis responsibilities beyond the shared rate limiter (admission-queue
execution, presence, Streams / Pub/Sub / generic workers) are
**DECISION_GATED**: each requires its own accepted ADR-001 decision with a
measured trigger before implementation.
