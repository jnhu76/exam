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
| P7 — System Readiness and Exam Modes | 🟣 PLANNING | Redis adoption, state authority, backup/restore, outage recovery, settings control plane, policy profiles, UI closeout. |
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
Remaining recovery work begins with the REC-I6 incident authority, M11 Proctor
resource scope, dedicated recovery centers, and wider startup reconciliation.

### Plain-text subjective question loop

PRs #237 and #238 (2026-07-31) closed the plain-text `text_response` authoring,
answering, manual-grading, and result loop. Closeout evidence:
[`docs/audits/P2-TEXT-RESPONSE-AUTHORING-CLOSEOUT.md`](../audits/P2-TEXT-RESPONSE-AUTHORING-CLOSEOUT.md).
This does **not** close rich-text/WYSIWYG editing, nor the generic ADR-008
final-answer submit barrier; both remain open for all supported answer types.

## Current planning focus — P7

The project is moving from isolated feature completion to system-level
readiness. P7 is accepted for planning as the next program and does not
redefine M11. M11 remains resource-relationship authorization. Acceptance of
the P7 plan does not authorize Redis adoption; every Redis item is conditional
on the P7-D1 decision gate and an ADR-001 update.

### P7 workstreams

1. **Reality and document reconciliation**
   - reconcile current/phase/status/open-items documents with current master;
   - update stale state-and-authority documentation;
   - remove completed `text_response` work from open lists.

2. **State-machine and authority closeout**
   - map every lifecycle/sub-process state and transition owner;
   - audit direct status writes, concurrency, idempotency, and crash points;
   - define startup reconciliation for recoverable partial work.

3. **Redis capability and adoption (decision-gated)**
   - recognize Redis capability beyond caching;
   - P7-D1 measures current single-instance limits and checks ADR-001 triggers
     before any adoption;
   - harden lifecycle and `off | optional | required` modes only for approved
     responsibilities;
   - if a trigger is met, adopt one real shared capability, beginning with
     global rate limiting; if not, record evidence and re-evaluation
     conditions in ADR-001;
   - design admission queue, presence, Pub/Sub/Streams, and worker use from
     explicit durability/failure contracts.

4. **Backup and restore**
   - define supported RPO/RTO profiles;
   - automate PostgreSQL/files/settings backup and retention;
   - add validation, clean-host restore, and restore drills;
   - provide CLI and Admin visibility.

5. **Crash and outage recovery**
   - define API/host/PostgreSQL/Redis/worker/scanner failure behavior;
   - make committed operations safely repeatable;
   - reconcile stuck grading, notifications, workers, interruptions, and jobs.

6. **Configuration control plane**
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
  └─ P7-D1  Redis adoption decision gate (measure → triggers → ADR-001 update)

P7-S1 → crash recovery / startup reconciliation
P7-D1 (accepted decision only; declined ⇒ Redis items not scheduled)
  → Redis lifecycle hardening → shared rate limit

backup design → backup/restore CLI → PITR/verification → Admin surface
configuration schema → versioned service → Admin settings UI
                     → exam policy schema → profiles → creation wizard
UI pilot → controlled family-by-family UI closeout
```

Redis adoption is conditional on an accepted P7-D1 / ADR-001 decision.
Redis-backed admission implementation must wait for an accepted admission state
machine. Settings UI must wait for configuration layering and snapshot semantics.

## Existing open work not erased by P7

### Phase 2+ / Phase 3 hardening

- `timed_sync`, `deadline`, and `untimed` timing modes;
- operational queue admission;
- REC-I6 incident model and Admin/Proctor recovery-center workflows;
- M11 Proctor-to-Exam resource scope before any Proctor time-grant activation;
- fill-blank runtime/E2E reality re-audit;
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
- P7 has not started implementation; Gate P7-0 is the truthful-plan and
  documentation-reconciliation gate.

## Out of scope until Phase 4

- pass-to-proceed API, service tokens / API keys, webhooks, and external
  integrations;
- optional multiTenant, SuperAdmin, tenant hierarchy/switcher,
  organizationSlug login, and cross-tenant audit;
- mandatory cloud runtime dependencies.
