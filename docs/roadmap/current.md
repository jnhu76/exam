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
| P7 — System Readiness and Exam Modes | 🟡 IN PROGRESS | P7-D1 Redis decision accepted + shared rate limit shipped (PR #265). P7-C portable persistence + backup + PostgreSQL DR rebuilt & shipped (C1/C2/C3 + drills). P7-E1 operational-authority / Admin–Maintainer separation audit + authority contract **READY FOR HUMAN REVIEW** (docs-only PR #281, 2026-08-12; see [`docs/audits/P7-E1-OPERATIONAL-AUTHORITY-AND-MAINTAINER-BOUNDARY.md`](../audits/P7-E1-OPERATIONAL-AUTHORITY-AND-MAINTAINER-BOUNDARY.md) + [ADR-017](../adr/ADR-017-operational-authority-maintainer-boundary.md) — PROPOSED; P7-E2 gated on review). State-machine, config-control-plane, exam-modes, and UI workstreams remain open. |
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

4. **Backup and restore**
   - define supported RPO/RTO profiles;
   - automate PostgreSQL/files/settings backup and retention;
   - add validation, clean-host restore, and restore drills;
   - provide CLI and Admin visibility.

   > **P7-C rebuild status (2026-08-10):** the portable-persistence +
   > backup + PostgreSQL DR core is shipped (C1 cold path + Launchpad,
   > C2 logical, C3 physical + PITR), with deterministic drills. The
   > remaining items here (RPO/RTO profile automation, Admin backup
   > surface, settings/files backup beyond the PostgreSQL authority)
   > are P7-E control-plane work — the backup *evidence* ledger is the
   > planned P7-E2B slice (after the E2A RBAC boundary), NOT started
   > (see the P7-E1 audit below).

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

   > **P7-E0 status (2026-08-10):** the configuration reality audit is **CLOSED**
   > (merged via PR #276) — see
   > [`docs/audits/P7-E0-CONFIGURATION-REALITY-AUDIT.md`](../audits/P7-E0-CONFIGURATION-REALITY-AUDIT.md).
   > It inventories every configuration item, classifies it into the five
   > authority classes (deployment/secret, system operational, organization,
   > exam policy, code invariant), and records the snapshot/hazard map. Key
   > verdict: **no generic settings subsystem is justified by current evidence,
   > and no E1 settings slice is currently justified** — proceed to P7-M1
   > (exam policy resolution / freeze model), which is where the real
   > configuration pressure already exists (the profile-resolution freeze
   > hazard). A settings slice is triggered only by a confirmed near-term
   > requirement for Admin-editable operational settings; Email worker/retry
   > is a candidate under that gate, not preselected; backup automation/status
   > is the separate E2B operational capability. P7-E itself is **NOT**
   > complete.
   >
   > **P7-E1 status (2026-08-12):** P7-E is the **Operational Control Plane**
   > (authority separation + configuration ownership + operational evidence +
   > operational policy + Admin/Maintainer views). The P7-E1 reality audit +
   > authority contract is **READY FOR HUMAN REVIEW** (docs-only PR #281, no
   > code changes; see
   > [`docs/audits/P7-E1-OPERATIONAL-AUTHORITY-AND-MAINTAINER-BOUNDARY.md`](../audits/P7-E1-OPERATIONAL-AUTHORITY-AND-MAINTAINER-BOUNDARY.md)
   > and [ADR-017](../adr/ADR-017-operational-authority-maintainer-boundary.md)
   > — PROPOSED, rev 2). Verdict: the hard boundary (no product surface for
   > infra execution; no Admin capability reaches machine/DB/secret authority;
   > secrets stay env/Compose-owned; restore stays operator-owned) **already
   > holds structurally**. Authority model: **Hybrid Option C** — Admin is the
   > business owner; the Application Maintainer is a recognized (not yet
   > implemented) product role concept holding ONLY operational capabilities;
   > the Host Maintainer holds infrastructure execution (host/CLI). The real
   > gap is **evidence, not authority**: P7-C ships mechanisms with zero
   > durable in-product records, so "last successful/verified backup" and
   > "RPO posture" are unanswerable in-product today. Recommended next slice:
   > **GO P7-E2 (conditional on human review)** — authority-first:
   > E2A Operational RBAC Boundary (Maintainer observation bundle, split
   > action-under-view capabilities) → E2B Backup Evidence Ledger (typed
   > `backup_runs` evidence + script instrumentation + read projections) →
   > E2C Admin/Maintainer Operational Views. No scheduler, no retention
   > engine, no restore surface, no Maintainer role seed in E1; decision-gated
   > capabilities (backup.trigger etc.) stay host-owned pending their own
   > recorded decisions.

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

P7-C  portable persistence, backup, PostgreSQL DR ✅ REBUILT & SHIPPED
  (C0 reality audit closed; C1 portable bind-mounts + cold backup +
  Launchpad; C2 logical pg_dump + verified clean restore; C3 physical
  pg_basebackup + WAL archive + PITR; all backed by deterministic Docker
  drills). The Admin backup surface (formerly P7-B4) is explicitly OUT of
  scope here — restore is operator-owned; no browser restore button.

P7-E0  configuration reality audit  →  verdict: no settings control plane
       justified now; no E1 settings slice.
P7-E1  operational authority & Admin–Maintainer separation 🔵 AUDIT + DESIGN
       READY FOR HUMAN REVIEW (docs-only PR #281, 2026-08-12; ADR-017
       PROPOSED rev 2 — Hybrid Option C). Verdict: the Admin/Maintainer hard
       boundary already holds; Application Maintainer = recognized future
       product role (observation-only preset); Host Maintainer = host/CLI;
       the gap is durable backup evidence, not authority.
P7-M1  exam policy authority + canonical conflict validator ✅ CLOSED (PR #277)
       (one typed policy value + one validator; create/update/publish share it;
       publish revalidates whole policy; NO profile persistence, NO new DB cols)
P7-M2  profile templates + authoring-time resolution ✅ CLOSED
       (organization-owned exam policy profiles, copy-on-apply into typed
       Exam columns, no runtime profile dependency; see
       docs/audits/P7-M2-PROFILE-TEMPLATES-AND-RESOLUTION.md)
P7-M   configurable exam modes (product closeout) — FUNCTIONALLY COMPLETE;
       visual product closeout pending (multimodal visual review round)
       (profile management UI + exam creation wizard; two truthful starter
       recipes shipped; Controlled/Strict deferred to their owning subsystems;
       see docs/audits/P7-M-CONFIGURABLE-EXAM-MODES-CLOSEOUT.md)
Future P7-E2  (gated on human review of P7-E1) — authority-first sequence
       (ADR-017 D13; may merge into one or more PRs):
         E2A Operational RBAC Boundary — Maintainer observation capability
             bundle (amends ADR-010 role preset set; zero business perms);
             split action-under-view capabilities (email-test invariant);
             diagnostics domain split; no Admin visibility regression
             during migration
         E2B Backup Evidence Ledger — typed backup_run/restore_drill
             evidence written by the existing P7-C scripts at their natural
             checkpoints, truthful verification evidence, read projections
         E2C Admin/Maintainer Operational Views — VIEWS ONLY
             (business-owner summary vs detailed ops view)
       NO scheduler, NO retention engine, NO restore surface, NO Maintainer
       role seed in E1; backup.trigger etc. stay decision-gated (host-owned
       today); operational-policy intent has ONE owner (Admin,
       system.ops.policy.manage — E3).
Future P7-E3  operational policy records + editable policy UI — Admin
       records desired RPO/retention/drill cadence (intent, non-binding);
       includes the former "future E1 settings" item (renamed to avoid E1
       numbering conflict) — only if a confirmed Admin-editable
       operational-settings requirement emerges, identify ONE coherent
       first slice. Email worker/retry is a candidate under that gate;
       backup automation/status is the separate E2B operational capability
       above, not a settings slice.
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
