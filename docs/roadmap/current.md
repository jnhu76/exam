# Current Roadmap

> What is implemented now, what is being planned next, and which work remains
> open. Phase scope authority remains
> [`docs/roadmap/phase-roadmap.md`](phase-roadmap.md). Detailed P7 planning is in
> [`P7-system-readiness-and-exam-modes.md`](P7-system-readiness-and-exam-modes.md).

## Status snapshot

| Phase / program | Status | Notes |
| --- | --- | --- |
| Phase 1 — Minimal Deliverable | ✅ COMPLETE | Admin + Candidate reliable exam loop. |
| Phase 2 — Exam Operation | ✅ GATE ITEMS IMPLEMENTED | `timed_sync` / `deadline` / `untimed` and queue admission remain open. |
| Phase 3 — Collaboration / Permissions | 🟡 PARTIALLY IMPLEMENTED | MVP role model and implemented product subset are closed; broader Phase 3 work remains. |
| P7 — System Readiness and Exam Modes | 🟡 IN PROGRESS | P7-D1 Redis decision accepted (2026-08-08); shared rate limit shipped (PR #265, P7-D2/D3). State/backup/config-control-plane/exam-modes/UI workstreams remain open. |
| Phase 4 — Platformization | ⬜ NOT STARTED | pass-to-proceed, service tokens, webhooks, optional multiTenant. |

See [`docs/status/implementation-status.md`](../status/implementation-status.md)
for the implemented/partial/limited breakdown and
[`docs/roadmap/phase3-open-items.md`](phase3-open-items.md) for open Phase 3
product work.

## Recently closed

### Phase 3 MVP sequence

```text
P4 (RBAC MVP role switch) ✅ CLOSED
  → P5-0 (Email delivery runtime hardening) ✅ CLOSED (2026-07-25, PR #210)
  → P3 (result publishing closeout) ✅ CLOSED (2026-07-25, PR #211)
  → P5-N1 (Inbox + result-published Email) ✅ CLOSED (2026-07-25, PR #213)
  → P6 (MVP ready closeout) ✅ CLOSED (2026-07-26, PR #215)
```

The supported LAN/on-premise, single-organization MVP subset is release-ready
within its documented boundary. P6 does **not** mean all Phase 3 product work or
all production-hardening work is complete.

### Recovery foundation

REC-I4-I1/I2/I3A/I3B1/I3B2 implemented the interruption policy
persistence/runtime, candidate-safe restore contract, immutable policy
snapshots, and the Admin operator time-grant product path (permission,
Attempt-scoped route, atomic audit, and Dashboard retry coordination).
REC-I6-R0 froze the exam incident authority in
[ADR-014](../adr/ADR-014-exam-incident-authority.md) (Status: ACCEPTED).
**J3 (`REC-I6-I1-INCIDENT-PERSISTENCE-COMMANDS`) is CLOSED following PR #242**
(merge commit `5b653c13`, 2026-08-01). The Admin Incident persistence,
commands, API, audit, and optional time-grant linkage paths are implemented on
`master`; see
[`docs/audits/REC-I6-I1-INCIDENT-RUNTIME-CLOSEOUT.md`](../audits/REC-I6-I1-INCIDENT-RUNTIME-CLOSEOUT.md).
The J4 design contract (`M11-R0-PROCTOR-EXAM-SCOPE-CONTRACT`) is **CLOSED**
as ADR-015 (**Accepted** 2026-08-02, PR #245) with its reality audit
([`M11-R0-PROCTOR-EXAM-SCOPE-REALITY-AUDIT.md`](../audits/M11-R0-PROCTOR-EXAM-SCOPE-REALITY-AUDIT.md)).
**J4-I1 (`M11-PROCTOR-EXAM-ASSIGNMENTS`) is CLOSED** (2026-08-02, PR #250): the
Proctor-to-Exam assignment persistence, commands, Admin assignment API,
resource-scope enforcement, and the minimum Proctor incident authority are
implemented per ADR-015 §23 (A → B → C → D); see
[`docs/audits/M11-I1-PROCTOR-EXAM-ASSIGNMENTS-CLOSEOUT.md`](../audits/M11-I1-PROCTOR-EXAM-ASSIGNMENTS-CLOSEOUT.md).
**J5 (`REC-OPS-ADMIN-RECOVERY-CENTER`) is CLOSED** (2026-08-08) — Admin
Recovery Center (contract R0 + queue/incident/attempt/exam pages, Operations
surfaces for time-grant/force-submit/misconduct/incident actions/proctor
assign, durable `attempt_command_receipts`, browser E2E + a11y closeout);
closeout: [`docs/audits/J5-ADMIN-RECOVERY-CENTER-CLOSEOUT.md`](../audits/J5-ADMIN-RECOVERY-CENTER-CLOSEOUT.md).
The job-by-job closure history is tracked in
[`recovery-operations-jobs.md`](recovery-operations-jobs.md).
Remaining recovery work — all explicitly NOT IMPLEMENTED: Proctor recovery
center (J6), system-generated incidents, and wider startup reconciliation.
Issue #263 (cross-tab force-submit authority) is a recorded P2 follow-up —
deliberately NOT built per the J5 mission scope.

### Plain-text subjective question loop

PRs #237 and #238 (2026-07-31) closed the plain-text `text_response` authoring,
answering, manual-grading, and result loop. Closeout evidence:
[`docs/audits/P2-TEXT-RESPONSE-AUTHORING-CLOSEOUT.md`](../audits/P2-TEXT-RESPONSE-AUTHORING-CLOSEOUT.md).
This does **not** close rich-text/WYSIWYG editing, nor the generic ADR-008
final-answer submit barrier; both remain open for all supported answer types.

## Current planning focus — P7

The project is moving from isolated feature completion to system-level
readiness. P7 is partially implemented: the **P7-D1 decision gate is
ACCEPTED** (2026-08-08) and the first adopted responsibility — **Redis-backed
shared rate limiting** (P7-D2/D3) — shipped on `master` via PR #265
(ADR-001 "Post-MVP Decision (P7)"). The remaining P7 workstreams
(state-machine/authority closeout, backup/restore, outage recovery,
configuration control plane, exam policy profiles, UI/ops closeout) are open.
P7 does not redefine M11; M11 remains resource-relationship authorization.

### P7 workstreams

1. **Reality and document reconciliation** ✅ CLOSED (post-MVP repository
   hygiene, 2026-08-09)
   - reconcile current/phase/status/open-items documents with current master;
   - update stale state-and-authority documentation;
   - remove completed `text_response` work from open lists.

2. **State-machine and authority closeout**
   - map every lifecycle/sub-process state and transition owner;
   - audit direct status writes, concurrency, idempotency, and crash points;
   - define startup reconciliation for recoverable partial work.

3. **Redis capability and adoption (decision-gated)**
   - recognize Redis capability beyond caching;
   - P7-D1 measured current single-instance limits and checked ADR-001 triggers
     — decision ACCEPTED (2026-08-08);
   - lifecycle hardening and `off | optional | required` modes for the adopted
     responsibility (shared rate limiting) are shipped (P7-D2/D3, PR #265);
   - further Redis responsibilities (admission queue, presence, Pub/Sub/Streams,
     worker use) remain decision-gated on explicit durability/failure contracts.

4. **Backup and restore (C-series)**
   - **P7-C0 persistence reality audit — CLOSED (PR #270)**;
   - **P7-C1 portable single-node deployment (relocation) — IMPLEMENTED
     (P7-C1)**: canonical bind-mounted data root (`${EXAM_DATA_ROOT:-./data}`),
     image-only Compose + `EXAM_IMAGE` identity, schema/image compatibility
     preflight (C0 P2-1), first-install launchpad (advisory-lock
     single-winner), Redis non-authority proof, clean-root + clean-host
     relocation drills (`pnpm drill:p7-c1-relocation` +
     `.github/workflows/p7-c1-relocation.yml`), operator guide
     `docs/deployment/portable-deployment.md`;
   - define supported RPO/RTO profiles (P7-C2/C3: logical backup +
     historical restore — NOT implemented);
   - automate PostgreSQL/files/settings backup and retention (P7-C4 —
     NOT implemented);
   - PITR via WAL archiving (P7-C5 — NOT implemented);
   - add validation, clean-host restore, and DR drills (P7-C6/C7);
   - provide CLI and Admin visibility.

5. **Crash and outage recovery**
   - define API/host/PostgreSQL/Redis/worker/scanner failure behavior;
   - make committed operations safely repeatable;
   - reconcile stuck grading, notifications, workers, interruptions, and jobs.

6. **Configuration control plane (P7-E series — the old P7-C1/C2/C3
   configuration-taxonomy IDs were reconciled to P7-E1/E2/E3 when the C
   series was re-assigned to durability/backup/recovery, so the repo has
   ONE "P7-C1")**
   - keep bootstrap endpoints and secrets in deployment/secret configuration;
   - move safe business and operational settings into versioned audited storage;
   - expose effective values, source layer, validation, restart requirement,
     preview, rollback, and import/export in Admin settings;
   - freeze resolved policies at publish/attempt creation.

7. **Configurable exam profiles**
   - model timing, admission, session/device, navigation, interruption,
     submission, randomization, result, monitoring, and audit as orthogonal
     policies;
   - provide minimal, standard, controlled, and strict templates over one engine;
   - reject conflicting combinations before publish.

8. **UI and operations closeout**
   - system status, settings, backup, recovery, and exam-profile workflows;
   - continue typography/StatsCard/PageSection/component-authority migration;
   - responsive/mobile and accessibility closeout.

Detailed scope, dependencies, and release gates:
[`P7-system-readiness-and-exam-modes.md`](P7-system-readiness-and-exam-modes.md).
Redis research:
[`docs/audits/P7-R0-REDIS-CAPABILITY-STUDY.md`](../audits/P7-R0-REDIS-CAPABILITY-STUDY.md).

## Proposed execution order

```text
P7-R0  reality + documentation reconciliation
  ├─ P7-S1  state-machine and authority audit
  └─ P7-D1  Redis adoption decision gate ✅ ACCEPTED (2026-08-08)

P7-S1 → crash recovery / startup reconciliation
P7-D1 (accepted: shared rate limit only)
  → Redis lifecycle hardening → shared rate limit ✅ SHIPPED (PR #265, P7-D2/D3)

P7-C0 → P7-C1  persistence reality audit ✅ → portable single-node deployment ✅
  → P7-C2/C3 logical backup + historical restore → P7-C4 off-host/retention
  → P7-C5 PITR → P7-C6 DR drills → P7-C7 closeout
backup design → backup/restore CLI → PITR/verification → Admin surface
configuration schema (P7-E1) → versioned service (P7-E2) → Admin settings UI (P7-E3)
                     → exam policy schema → profiles → creation wizard
UI pilot → controlled family-by-family UI closeout
```

Redis adoption is conditional on an accepted P7-D1 / ADR-001 decision — the
decision is recorded (2026-08-08) and the one approved responsibility
(shared rate limiting) is shipped; any further responsibility needs its own
recorded decision. Redis-backed admission implementation must wait for an
accepted admission state machine. Settings UI must wait for configuration
layering and snapshot semantics.

## Existing open work not erased by P7

### Phase 2+ / Phase 3 hardening

- `timed_sync`, `deadline`, and `untimed` timing modes;
- operational queue admission;
- REC-I6 incident persistence and commands (J3 — **CLOSED on master** via
  PR #242); recovery-center workflows:
  - J4 — Proctor-to-Exam resource scope (**CLOSED** 2026-08-02; J4-I1
    implemented per ADR-015 §23 — persistence, commands, Admin assignment
    API, resolver enforcement, minimum Proctor incident activation; see
    `docs/audits/M11-I1-PROCTOR-EXAM-ASSIGNMENTS-CLOSEOUT.md`);
  - J5 — Admin Recovery Center (**CLOSED** 2026-08-08 — see
    `docs/audits/J5-ADMIN-RECOVERY-CENTER-CLOSEOUT.md`; closure history:
    `recovery-operations-jobs.md`);
  - J6 — Proctor Recovery Center (NOT IMPLEMENTED);
  - system-generated incidents (NOT IMPLEMENTED);
- M11 Proctor-to-Exam resource scope before any Proctor time-grant activation;
- rich-text/WYSIWYG answering;
- generic ADR-008 final-answer submit barrier (all supported answer types).

### Collaboration and identity

- M11 resource-relationship authorization;
- scoped Teacher/Proctor/Grader assignments and product activation;
- custom roles;
- staff invitation, password reset, activation/deactivation, account recovery;
- permission audit UI;
- P5-N2 additional operational notification types;
- Email template engine and backend i18n.

### UI debt

See [`ui-open-items.md`](ui-open-items.md): typography recipes, StatsCard,
PageSection, component collisions, Card surface decision, broader authority lint,
metadata/read-only-long-answer components, responsive/accessibility migration.

## Gate status

- Gate 0.5 remains PASS; runtime route/capability inventory is reconciled.
- P6 MVP closeout is CLOSED for the supported deployment subset.
- P7 is partially implemented (P7-D1 decision accepted 2026-08-08; shared
  rate limit shipped via PR #265). The documentation-reconciliation
  workstream (P7-R0) is closed by the post-MVP repository hygiene cleanup.

## Out of scope until Phase 4

- pass-to-proceed API, service tokens / API keys, webhooks, and external
  integrations;
- optional multiTenant, SuperAdmin, tenant hierarchy/switcher,
  organizationSlug login, and cross-tenant audit;
- mandatory cloud runtime dependencies.
