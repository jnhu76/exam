# P7 — System Readiness and Configurable Exam Modes

> **Current status (2026-08-13):**
> **P7-F COMPLETE — P7 REMAINS OPEN.**
>
> Shipped/closed:
> - P7-D2/D3 Redis shared rate limit
> - P7-S2 state/authority hardening
> - P7-C portable backup/DR
> - P7-E Operational Control Plane
> - P7-M Configurable Exam Modes
> - P7 RBAC remediation
> - P7-F readiness closeout
>
> Remaining P7 release-gate gaps:
> - P7-3a RTO not declared/tested
> - P7-3b retention not operational
>
> ADR-017 rev4 / ADR-018 and Teacher@Course disposition remain recorded
> human decisions.
>
> Older workstream sections below retain historical planning/design
> context. Where an old execution-status statement conflicts with this
> block or
> [`docs/audits/P7-F-FINAL-SYSTEM-READINESS-CLOSEOUT.md`](../audits/P7-F-FINAL-SYSTEM-READINESS-CLOSEOUT.md),
> the current-status block is authoritative.

> Status: ACCEPTED FOR PLANNING (2026-07-31, docs-only PR)
> Implementation status: **superseded by the "Current status" overlay above**
> (2026-08-13). Historical: PARTIALLY IMPLEMENTED — P7-D1 decision gate
> ACCEPTED 2026-08-08; P7-D2/D3 — Redis lifecycle hardening + shared rate
> limit — shipped on master via PR #265 (see ADR-001 "Post-MVP Decision (P7)")
> Phase: Phase 3 hardening, after P6 MVP closeout
> Scope: single-deployment, single-organization, LAN/on-premise
> Does not redefine M11; M11 remains resource-relationship authorization
>
> The P7-D1 decision gate (Workstream B) is the authority for Redis adoption:
> it is ACCEPTED (2026-08-08) for ONE bounded responsibility (shared rate
> limiting). Any further Redis business responsibility requires its own
> recorded decision updating or superseding ADR-001.

## 1. Why P7 exists

The implemented MVP can complete the supported Admin/Teacher/Candidate exam
loop, but the next bottleneck is no longer an isolated product feature. The
project now needs to turn implemented components into a coherent, operable,
recoverable, configurable system.

P7 groups eight concerns that otherwise risk being implemented independently:

1. Redis has a baseline; the **shared rate limiter is its first adopted
   business path** (P7-D2/D3, PR #265); further responsibilities remain
   decision-gated.
2. State-machine and authority documentation needs a current whole-system audit.
3. Backup exists only as an operator-supplied procedure, not a complete
   recovery product.
4. Process, host, database, Redis, and worker failures need explicit recovery
   behavior.
5. Exam behavior must scale from minimal information collection to strict
   controlled examination.
6. Business and operational configuration must move from hidden environment
   variables into an audited Admin control plane where appropriate.
7. UI authority exists, but broad migration and operational surfaces remain
   incomplete.
8. "Simple" and "strict" exams must be policy profiles over one engine, not
   separate products or scattered `if (mode === ...)` branches.

## 2. Current-tree reality

### 2.1 Completed foundations

- Phase 1 reliable Admin + Candidate loop is complete.
- Phase 2 gate items are implemented for the supported `timed_window` path.
- Phase 3 MVP subset is release-ready for the documented LAN/on-premise
  topology.
- capability-based RBAC infrastructure and Admin/Teacher/Candidate MVP roles
  are active.
- result publishing, Inbox notification, Email outbox, and resident Email
  worker are implemented.
- candidate recovery has durable interruption episodes, adjustment ledgers,
  policy snapshots, and composed restore semantics.
- plain-text `text_response` authoring, candidate answering, snapshot freeze,
  grading-queue discovery, manual grading, and result flow are closed.
- PostgreSQL concurrency, row-lock, idempotency, and authoritative snapshot
  mechanisms exist for critical exam flows.
- Redis connection/config/diagnostics/test-isolation baseline exists.
- frontend visual authority, semantic recipes, lint rules, and shared
  components exist.

### 2.2 Open or partial work already recorded

The open-work inventory is owned by the canonical current-state documents,
not re-enumerated here (they drift independently):

- **Implemented now:** [`docs/status/implementation-status.md`](../status/implementation-status.md)
  — the single "status = what exists" authority (Phase 3 partial
  implementation, P4 role switch, P5-0/P5-N1, J3/J4-I1/J5 recovery runtime,
  Redis shared rate limiting).
- **Open Phase 3 product work:** [`docs/roadmap/phase3-open-items.md`](../roadmap/phase3-open-items.md)
  (staff invitation, SMTP reset, account lifecycle, scoped role bundles,
  custom roles, WYSIWYG submit, generic submit barrier, i18n page copy).
- **Recovery/operations job tracker:** [`docs/roadmap/recovery-operations-jobs.md`](../roadmap/recovery-operations-jobs.md)
  (J6 Proctor Recovery Center, system-generated incidents, startup
  reconciliation — the J1–J5 closures are recorded there).
- **P7 workstreams:** shipped since this inventory was written —
  state-machine/authority closeout (P7-S2, PR #269), portable backup/DR
  (P7-C, 2026-08-10), operational control plane (P7-E, PR #282), exam policy
  profiles (P7-M1/M2/M, PRs #277/#279, **CLOSED** 2026-08-13), RBAC
  remediation (PR #284). Still open: **RTO declaration/test** and
  **retention automation** (Gate P7-3 bullets; see the Current status overlay
  and the P7-F closeout).

Redis status as of the P7-D1 decision: the shared rate limiter uses Redis
when the runtime is `ready` (P7-D2/D3, PR #265); admission queue, presence,
scanner coordination, cache, stream, Pub/Sub, and sessions remain
decision-gated.

### 2.3 Documentation drift discovered

The current roadmap set contains stale statements:

- `docs/roadmap/current.md` still says the former P2-1 authoring flow was
  removed, although the plain-text `text_response` authoring loop was
  subsequently closed by PRs #237/#238.
- `docs/roadmap/phase3-open-items.md` still presents P6 as next in one section
  although P6 is closed.
- `docs/status/implementation-status.md` still lists `text_response` authoring
  UI as remaining work.
- `docs/architecture/exam-system/state-and-authority.md` contains a historical
  runtime baseline and statements that predate REC-I4 and P5-N1.

P7-R0 must reconcile these documents against the current tree before
implementation work begins.

## 3. Program principles

### 3.1 Capability is not authority

A component may be technically capable of holding durable or authoritative
data while the product deliberately assigns authority elsewhere. Redis can
persist queues, streams, sessions, and application state. PostgreSQL remains
the current Exam authority for irreversible facts because the existing
transaction and recovery protocols are there.

Any authority change requires an explicit ADR and migration/recovery plan.

### 3.2 One state change, one command owner

Each irreversible transition must have:

- one canonical command;
- explicit actor/capability;
- preconditions;
- transaction and lock ordering;
- idempotency key or deterministic no-op behavior;
- audit/evidence output;
- crash-recovery behavior;
- tests for concurrent and repeated execution.

### 3.3 Configuration must be layered and frozen

```text
code defaults
  → deployment bootstrap/secrets
  → system settings
  → organization settings
  → exam policy profile
  → per-exam overrides
  → publish snapshot
  → attempt execution snapshot
```

Settings must not mutate active attempts accidentally.

### 3.4 UI is part of operations

A feature is not operationally complete when it only has an API or environment
variable. Administrators need status, validation, audit, safe mutation,
rollback, and recovery surfaces.

### 3.5 Simple and strict exams share one engine

Exam modes are named profiles over orthogonal policy dimensions. A profile
selects defaults; the engine executes frozen policies. Avoid mode-specific
duplicate code paths.

## 4. Workstream A — State-machine and authority closeout

> **Status (2026-08-13): CLOSED.** The state/authority closeout shipped on
> master (P7-S2, PR #269); Gate P7-1 is PASS per the P7-F closeout (no
> general reconciler — evidence-based formulation). The scope below is the
> audit record.

### Goal

Produce a current, executable map of every state dimension, transition owner,
authority, side effect, and recovery path.

### Audit scope

| Domain | State dimensions to verify |
| --- | --- |
| Exam | lifecycle, publication, schedule, cancellation/archive |
| Enrollment | assignment, started/completed/blocked, retake eligibility |
| Attempt | lifecycle, deadline, interruption, device/session ownership |
| Answer | draft versions, frozen submitted answer, final-answer barrier |
| Grading | workset entries, manual progress, terminal grading, publication |
| Notification | Inbox unread/read, dedupe, event policy |
| Email | outbox state, claim ownership, retries, dead-letter handling |
| Admission | waiting, admitted, abandoned, canceled, expired |
| Background work | pending, claimed, active, retry, failed, completed |
| Backup | scheduled, running, verified, failed, retained, restored |
| Configuration | draft, active version, pending restart, superseded, rolled back |

### Required outputs

- updated `docs/architecture/exam-system/state-and-authority.md` verified
  against current master;
- transition inventory generated or structurally tested from code;
- direct status writes outside canonical commands listed and removed or
  justified;
- unreachable enum states resolved or explicitly retained as target states;
- cross-domain transaction boundaries documented;
- recovery table for "process dies after step N."

### Acceptance

- every reachable transition has one owner;
- every irreversible transition is idempotent or safely repeatable;
- no route/repository invents a second authority decision;
- documentation and executable transition tables agree.

## 5. Workstream B — Redis adoption

Detailed study: [`docs/audits/P7-R0-REDIS-CAPABILITY-STUDY.md`](../audits/P7-R0-REDIS-CAPABILITY-STUDY.md).

### Goal

Resolve, from measured evidence, whether any Redis responsibility should be
adopted. If measurement meets an ADR-001 trigger, adopt exactly that concern
deliberately (one at a time, PostgreSQL remains source of truth). If it does
not, record the measurement evidence and re-evaluation conditions instead — a
decision either way is a valid P7 outcome.

### Capability classes

| Class | Candidate responsibilities |
| --- | --- |
| Ephemeral | cache, rate limits, presence, session/device registry, dedupe windows |
| Coordination | scanner lease, singleton jobs, admission ownership, cache invalidation |
| Durable jobs/events | delayed work, retries, streams, generic workers |

### P7-D1 — Adoption decision gate (mandatory, blocks all Redis adoption)

P7-D1 is a decision gate, not a milestone on a fixed adoption path. It produces
a documented decision before any Redis business responsibility is introduced:

1. measure current single-instance limits (rate limiter, admission queue,
   heartbeat/deadline scanners, presence) and record the measured headroom;
2. confirm whether any ADR-001 trigger is concretely met by a measured limit —
   speculative triggers are not enough;
3. for each candidate Redis capability, state its benefit, failure model,
   durability/RPO needs, and rollback path;
4. update or supersede ADR-001 with the decision (adopt a concern, or decline
   and record re-evaluation conditions).

**P7-D1 is ACCEPTED (2026-08-08):** Redis is adopted for ONE bounded
responsibility — the **shared/global rate limiter** — with lifecycle
hardening and `off | optional | required` operating modes (P7-D2/D3,
PR #265). ADR-001 carries the decision record. Until a further decision is
recorded, Redis stays limited to that responsibility; the baseline plugin,
Compose service, diagnostics PING, and test-prefix isolation are not
adoption.

### Adoption sequence (conditional on accepted P7-D1 / ADR decision)

Only approved responsibilities are sequenced. The tentative order for a
multi-instance trigger is:

1. Redis lifecycle hardening and `off | optional | required` operating modes.
   ✅ SHIPPED (P7-D2, PR #265)
2. global rate limit shared across API instances. ✅ SHIPPED (P7-D3, PR #265)
3. admission queue state-machine design.
4. Redis-backed admission queue with persistence and observability.
5. presence and live dashboard projection.
6. evaluate Streams/generic job queue/cache only from measured need.

If a later P7-D1 re-evaluation concludes no further adoption is warranted,
items 3–6 are not scheduled and Gate P7-2 is satisfied by the recorded
decision.

### Non-dogmatic authority rule

Redis is technically capable of durable state. For P7, Exam retains PostgreSQL
authority for attempts, answers, grading, audit, and business configuration.
Moving one of those responsibilities is possible but requires a separate
accepted ADR.

## 6. Workstream C — Portable persistence, backup, and PostgreSQL DR

> **Rebuilt 2026-08-10 (P7-C).** This workstream was rebuilt from a
> config-taxonomy framing to the as-shipped portable-persistence + backup +
> PostgreSQL disaster-recovery program. The current authority is
> `docs/deployment/backup-and-recovery.md` and the closeout
> `docs/audits/P7-C-PORTABLE-BACKUP-RECOVERY-CLOSEOUT.md`. The phase shape
> is:
>
> - **C0** reality audit (CLOSED) — PostgreSQL is the sole authoritative
>   store; Redis is non-authoritative; app filesystem has no durable
>   writes.
> - **C1** portable persistence — bind-mount `${EXAM_DATA_ROOT}/postgres`
>   (operator-visible, relocatable), cold-filesystem backup/restore, and
>   the Launchpad first-install surface.
> - **C2** logical backup — online `pg_dump -Fc` + verified clean restore
>   (`DROP DATABASE` + `template0` + `pg_restore --no-owner
>   --exit-on-error`), no `--clean --if-exists` into a dirty DB.
> - **C3** physical backup + PITR — `pg_basebackup -X stream` +
>   `pg_verifybackup` manifest, PostgreSQL-native WAL continuous
>   archiving (`archive_mode=on`, non-overwriting `archive_command`), and
>   PITR to an explicit `recovery_target_lsn`/`time`/`xid`.
>
> All four phases are backed by deterministic Docker suites under
> `tests/deployment/` (`compose-smoke.sh`, `launchpad-bootstrap.sh`,
> `persistence-and-cold-restore.sh`, `logical-backup-restore.sh`,
> `pitr.sh`). Scope discipline:
> NO Admin restore button, NO retention engine, NO Desktop recoveryEpoch,
> NO schema change for history-replacement marking (see ADR-016). The
> former "future P7-E control plane" SHIPPED as the operational control
> plane (PR #282: E2A Maintainer RBAC boundary, E2B backup evidence ledger,
> E2C operations views, E3 operational policy intent — RPO-only). Still
> open (Gate P7-3): **RTO declaration/test** and **retention automation**
> (host-side cron/systemd + WAL-G/pgBackRest is the P7-E3-recorded
> recommendation).

### Current gap (post-rebuild)

The rebuilt C0–C3 covers the PostgreSQL authority end-to-end. Remaining
work is explicitly P7-E control-plane territory:

- RPO/RTO profile automation and scheduling (cron-only today);
- Admin backup visibility surface (restore stays operator-owned);
- backup of files/settings beyond the PostgreSQL authority (attachments,
  exports, organization settings are in-DB today; a separate
  files/settings backup is future).

> **Status (2026-08-13):** the P7-E control plane SHIPPED via PR #282 —
> backup evidence ledger (`backup_runs`/`backup_run_events`/
> `restore_drill_runs`), operations views, and RPO-only policy intent
> (`desiredRpoSeconds`; **no typed RTO authority**). Still open:
> **RTO declaration/test** (P7-3a) and **retention automation** (P7-3b;
> host-side cron/systemd + WAL-G/pgBackRest is the P7-E3-recorded
> recommendation).

### Recovery objectives

Before choosing tooling, define deployment profiles:

| Profile | Example target RPO | Example target RTO | Notes |
| --- | --- | --- | --- |
| Small internal | 24h | 4h | nightly backup, manual restore |
| Standard operation | 1h | 1h | frequent backups/WAL archive, scripted restore |
| High-stakes exam | minutes | <30m | PITR, standby/failover, rehearsed runbook |

Exact supported values must be decided and tested; the table is a planning
frame, not a current guarantee.

### Backup set

- PostgreSQL data and migration metadata;
- uploaded attachments and generated exports that must survive;
- organization/system settings;
- secrets/key escrow procedure without embedding secrets in backups casually;
- application version, image digest, and migration version;
- optional Redis persistence files only for Redis workloads whose recovery
  contract requires them.

### Required capabilities

- full database backup command;
- WAL/PITR design for higher profiles;
- encrypted backup storage;
- retention and pruning;
- checksums and restore verification;
- clean-host restore procedure;
- migration compatibility check;
- scheduled restore drill;
- Admin visibility for status/history;
- CLI that still works when the web UI or database is unavailable.

### Acceptance

- a backup is not marked successful until it is readable and validated;
- a documented clean-volume restore completes within the declared RTO;
- post-restore invariants verify attempts, answers, snapshots, grading,
  Inbox/outbox, role assignments, and settings;
- restore drills produce durable evidence and alerts.

## 7. Workstream D — Crash and outage recovery

> **Status (2026-08-13):** recovery runtime shipped — durable interruption
> episodes, J3/J4/J5 recovery workflows, and the state/authority closeout
> (P7-S2, PR #269). A general startup reconciler is deliberately NOT built;
> Gate P7-1 is PASS on the evidence-based formulation (P7-F closeout). The
> matrix below is the failure-behavior design record.

### Failure matrix

| Failure | Required behavior |
| --- | --- |
| API process crash | restart without losing committed state; retry-safe client commands |
| host/power loss | recover from PostgreSQL/Redis persistence according to RPO |
| PostgreSQL unavailable | fail authoritative writes clearly; no fake local success |
| Redis unavailable | behavior follows feature-specific optional/required and fail-open/fail-closed policy |
| Email worker crash | abandoned claim recovery and retry |
| generic worker crash | stalled-job recovery and idempotent re-execution |
| scanner crash | next scanner cycle/reconciler completes missed work |
| submit response lost | repeated submit returns the committed result, not a duplicate mutation |
| grading crash | workset resumes without double scoring or double publication |
| configuration rollout interrupted | active version remains coherent; pending version is recoverable/rollbackable |

### Startup reconciliation

The system should explicitly scan for recoverable inconsistencies such as:

- expired attempts still active;
- submitted attempts missing grading worksets;
- complete worksets not terminally finalized;
- result-published state missing required notification/outbox records;
- processing Email/jobs with expired ownership;
- active interruption pointers without matching unresolved episodes;
- backup jobs stuck in running state;
- settings versions left pending after restart.

Reconciliation must invoke canonical commands or repair procedures, not ad-hoc
SQL status updates.

## 8. Workstream E — Configuration control plane

> **Program scope (2026-08-12, P7-E1):** P7-E is the **Operational Control
> Plane** — authority separation (Admin ≠ Maintainer), configuration
> ownership, operational evidence, operational policy, and Admin/Maintainer
> views. The P7-E1 reality audit + authority contract is **ACCEPTED**
> (docs-only PR #281 merged 2026-08-12; see
> [`docs/audits/P7-E1-OPERATIONAL-AUTHORITY-AND-MAINTAINER-BOUNDARY.md`](../audits/P7-E1-OPERATIONAL-AUTHORITY-AND-MAINTAINER-BOUNDARY.md)
> and [ADR-017](../adr/ADR-017-operational-authority-maintainer-boundary.md)
> — ACCEPTED, rev 3). Verdict: the hard boundary (no product surface for
> infrastructure execution; no Admin capability reaches machine/DB/secret
> authority; secrets env/Compose-only; restore operator-owned forever)
> **already holds structurally**. Authority model: **Hybrid Option C** —
> Admin = business owner (business capabilities + business-owner ops
> summary); Application Maintainer = recognized (not yet implemented)
> product role concept holding ONLY operational control-plane capabilities,
> zero business permissions; Host Maintainer = infrastructure execution
> (host/CLI, not product RBAC). The real gap is durable backup *evidence*
> (P7-C ships mechanisms with zero in-product records). Recommended next
> slice: **GO P7-E2** (review gate satisfied 2026-08-12) — authority-first:
> E2A Operational RBAC Boundary (Maintainer observation bundle — amends
> ADR-010's role preset set; split action-under-view capabilities;
> diagnostics domain split; Admin ↔ Maintainer mutual exclusion; no Admin
> visibility regression during migration) → E2B Backup Evidence Ledger (typed `backup_runs` + script
> instrumentation + truthful verification evidence + read projections) →
> E2C Admin/Maintainer Operational Views (views only). No scheduler, no
> retention engine, no restore surface, no Maintainer role seed in E1;
> decision-gated capabilities (backup.trigger etc.) stay host-owned
> pending their own recorded decisions; operational-policy intent has ONE
> owner (Admin, `system.ops.policy.manage` — E3).
>
> **P7-E status (2026-08-12, closeout):** E2A (Maintainer RBAC boundary +
> Admin ↔ Maintainer mutual exclusion), E2B (backup evidence ledger), E2C
> (Admin/Maintainer operations views), and E3 (operational policy intent)
> are **IMPLEMENTED** — FUNCTIONALLY COMPLETE, READY FOR HUMAN REVIEW
> ([`docs/audits/P7-E-OPERATIONAL-CONTROL-PLANE-CLOSEOUT.md`](../audits/P7-E-OPERATIONAL-CONTROL-PLANE-CLOSEOUT.md)).
> Decision-gated capabilities (backup.trigger / schedule / retention /
> service.restart) are **DEFERRED (NO-GO)** with recorded rationale
> ([`docs/audits/P7-E3-DECISION-GATES.md`](../audits/P7-E3-DECISION-GATES.md)).
>
> **P7-E0 status (2026-08-10):** the configuration reality audit is **CLOSED**
> (merged via PR #276) — see
> [`docs/audits/P7-E0-CONFIGURATION-REALITY-AUDIT.md`](../audits/P7-E0-CONFIGURATION-REALITY-AUDIT.md).
> It inventories every configuration item from current `master`, classifies
> each into the five authority classes (deployment/secret, system operational,
> organization, exam policy, code invariant), and records the precedence,
> bypass, secrets, snapshot-hazard, and non-configurable-invariant maps. Key
> verdict: **no generic settings subsystem is justified by current evidence,
> and no E1 settings slice is currently justified** — proceed to P7-M1
> (exam policy resolution / freeze model). The audit distinguishes two freeze
> mechanisms (true snapshots vs published-row immutability) and records the
> future profile-resolution hazard (P2-M1) as the key P7-M1 design input. A
> settings slice (P7-E3, the former "future E1 settings" item — renamed to
> avoid E1 numbering conflict) is triggered only by a confirmed near-term
> requirement for Admin-editable operational settings (Email worker/retry is
> a candidate under that gate, not preselected; backup automation/status is
> the separate operational capability owned by the P7-E2B evidence slice
> above). P7-E itself is NOT complete; the E0 settings question is distinct
> from the P7-E1 authority contract.

### Configuration classification

#### Deployment-only / secret-backed

Remain outside normal Admin settings:

- database endpoints and credentials;
- Redis endpoints and credentials;
- JWT/encryption master secrets;
- SMTP password/private keys;
- bind address/port and container topology;
- filesystem/object-storage credentials;
- TLS private keys.

These may be referenced and tested by the Admin UI, but not exposed as
plaintext editable values.

#### Runtime operational settings — ownership map (P7-E closeout)

The historical "move to audited database-backed settings" list below is
**superseded** by the P7-E0 verdict (no generic settings subsystem) and the
P7-E implementation. Every configuration item has exactly one typed owner:

| Item class | Owner (authority) | Mechanism |
| --- | --- | --- |
| Deployment / secrets (DB/Redis/SMTP/JWT/TLS, ports, topology) | Host Maintainer | env / Compose / secret store (P7-E0 §5) |
| Organization settings (branding) | Admin | existing typed DB authority (`organization_settings`) |
| Exam policy (timing/admission/save/submit/retake/score) | Admin (authoring) | Exam + P7-M profile authority (copy-on-apply snapshots) |
| Operational evidence (backup runs, restore drills) | System (evidence) | P7-E typed evidence ledger (`backup_runs` / `restore_drill_runs`) |
| Operational policy INTENT (desired RPO / retention / drill cadence) | Admin (sole intent owner, ADR-017 D9) | P7-E typed domain policy (`backup_operational_policy`, versioned + audited) |
| Code invariants (answer save protocol, submit freeze, …) | Code | code (no runtime knob) |
| Worker intervals / email retry / rate limits | Host Maintainer (deployment) | env + restart-required (P7-E3 decision record) |

**There is NO generic key/value settings registry, no `system_settings` JSON
blob, no precedence engine, and no feature-flag platform.** The historical
items below (rate limits, email retry, worker intervals, backup schedule,
data retention, notification toggles, feature activation) remain
**env/Compose-owned and restart-required** unless a confirmed near-term
online-edit requirement appears — none exists today (P7-E3 decision gate).

#### Exam and attempt policies

Stored on Exam/template and frozen into snapshots:

- timing model;
- admission policy;
- navigation policy;
- save/submit policy;
- interruption/time-compensation policy;
- device/session policy;
- randomization;
- result/answer visibility;
- monitoring/audit level;
- retake and score strategy.

### Settings requirements — as satisfied by P7-E (no generic registry)

The historical generic "settings requirements" list (version/rollback/
import/export/preview) is **superseded**. The only database-backed
operational configuration that P7-E ships is the **operational policy
intent** (`backup_operational_policy`), and it satisfies the requirements
that actually apply to an intent record:

- typed schema and safe-range validation (Zod + DB CHECKs);
- version + optimistic concurrency (CAS on every write);
- actor / time / reason audit (atomic `ops.policy.updated` audit);
- capability-gated access (`system.ops.policy.view` / `.manage`);
- restart-required marker: N/A — intent is read live and never affects
  process configuration;
- rollback: version history is preserved by the audit ledger; no generic
  import/export is offered (intent is 3 numbers + reason);
- health warning when runtime env overrides a database setting: N/A —
  there are no runtime-overridable DB settings; env is the only runtime
  source.

Backup schedule / retention / destination remain **host-owned** (host cron
+ scripts + operator); the product reads EVIDENCE of them and renders
DESIRED vs OBSERVED vs STATUS. There is deliberately no product-side
scheduler, retention engine, restore surface, or settings import/export
(ADR-017 D4/D5; P7-E3 decision record).

## 9. Workstream F — Exam policy profiles

> **Status (2026-08-13): SHIPPED — CLOSED (P7-M1/M2/M, PRs #277/#279).**
> Two truthful starter recipes (`basic_quiz`, `standard_online`) ship over
> one engine; `Controlled`/`Strict` are deferred to their owning subsystems
> (truthfulness gate). See the P7-M closeout. The dimensions below are the
> design record.

### Policy dimensions

| Dimension | Example values |
| --- | --- |
| Identity | anonymous link, account, account + secondary verification |
| Timing | untimed, individual window, synchronized start, hard deadline |
| Admission | direct, password/code, queue, operator approval |
| Session/device | multiple sessions, single active session, device binding |
| Client | mobile allowed, desktop preferred, managed desktop required |
| Navigation | free navigation, ordered, no return |
| Save | manual, autosave, submit-time final payload barrier |
| Interruption | strict, bounded grace, operator incident |
| Submission | manual, deadline auto-submit, force-submit policy |
| Randomization | none, question order, option order, question pool |
| Result | immediate, after grading, manual publication |
| Answer visibility | hidden, score only, permitted answer review |
| Monitoring | none, event logging, proctor dashboard, controlled client |
| Audit | minimal, operational, high-assurance |

### Named profiles

#### Profile A — Minimal collection / qualification check

- mobile and desktop allowed;
- minimal identity;
- untimed or generous individual window;
- free navigation;
- autosave;
- no queue or proctoring;
- simple submit and result policy.

#### Profile B — Standard online exam

- account login;
- individual timed window;
- autosave and deadline submit;
- single active attempt;
- recoverable interruption policy;
- manual grading where required;
- normal audit.

#### Profile C — Controlled exam

- synchronized or tightly bounded window;
- single session/device policy;
- admission code or queue;
- randomization;
- delayed/manual result publication;
- proctor dashboard and incident evidence;
- stricter recovery and operator controls.

#### Profile D — Strict/high-assurance exam

- strong identity and managed client policy;
- explicit admission and operator readiness checks;
- device/session binding;
- full monitoring/incident workflow;
- strict or operator-incident interruption policy;
- high-assurance audit and retention;
- results and answer review tightly controlled.

### Important rule

Profiles are editable templates. The stored execution authority is the
resolved policy snapshot, not the profile name. A future template edit must
not change a published exam or active attempt.

### Conflict validation examples

- `untimed` cannot require deadline auto-submit.
- `mobile allowed` conflicts with `managed desktop required`.
- `anonymous identity` conflicts with named Candidate enrollment and retake
  history.
- `no monitoring` conflicts with a required proctor incident workflow.
- `free multi-session` conflicts with single-device enforcement.
- `immediate result` may conflict with pending manual grading unless partial
  results are explicitly supported.

## 10. Workstream G — UI and operator experience

> **Status (2026-08-13):** the exam-profile UI (list/create/edit) and the
> 5-step exam wizard shipped and CLOSED with P7-M (multimodal visual review
> performed by P7-F, 0px page overflow measured, no blocking defect). The
> remaining surfaces below (status/settings/recovery centers) remain
> governed by [`docs/roadmap/ui-open-items.md`](ui-open-items.md).

### Required new surfaces

#### System status center

- PostgreSQL, Redis, Email worker, scanners, storage, backups;
- active Redis role/store and degraded state;
- worker backlog, stalled/retry/dead counts;
- recovery/reconciliation findings;
- configuration version and pending restart.

#### Settings center

- system/organization defaults;
- exam profiles;
- notification/Email settings;
- backup/retention;
- rate limits;
- feature activation;
- audit history and rollback.

#### Exam creation wizard

```text
choose profile
  → review resolved policies
  → customize allowed dimensions
  → validate conflicts
  → preview candidate/operator behavior
  → create draft (publishing stays on the exam detail page)
```

#### Recovery center

- disrupted attempts and operator grant flow;
- incomplete/stuck background work;
- dead Email/jobs;
- backup failures and restore drills;
- reconciliation actions with audit evidence.

### Existing UI migration debt

Continue [`docs/roadmap/ui-open-items.md`](ui-open-items.md):

- typography recipes;
- StatsCard migration;
- PageSection adoption;
- component collision cleanup;
- Card surface/shadow decision;
- authority-bypass lint;
- long-text answer and metadata components;
- responsive/mobile and accessibility passes.

## 11. Execution order

```text
P7-R0  Reality + documentation reconciliation ✅ (P7-F reconciliation 2026-08-13)
  ├─ P7-S1  State-machine and authority audit ✅ CLOSED (P7-S2, PR #269)
  └─ P7-D1  Redis adoption decision gate (measure → triggers → ADR-001 update)

P7-S1
  → P7-RC1  Crash-recovery and startup reconciliation
  → P7-Q1   Admission queue state-machine design

P7-D1 (accepted decision only; declined ⇒ D2/D3/Q2/P1 not scheduled)
  → P7-D2  Redis runtime lifecycle hardening
  → P7-D3  Global Redis-backed rate limit
  → P7-Q2  Redis-backed admission queue
  → P7-P1  Presence/live operational projection

P7-B1  Backup/RPO/RTO design
  → P7-B2  Backup + restore CLI
  → P7-B3  PITR/retention/verification
  → P7-B4  Admin backup surface + restore drill evidence

P7-C  Portable persistence, backup, PostgreSQL DR ✅ REBUILT & SHIPPED
  (C0 reality audit closed → C1 portable + cold + Launchpad → C2 logical →
  C3 physical + PITR; deterministic drills; ADR-016 boundary). The
  pre-rebuild C1=config-taxonomy / C2=settings-service / C3=settings-UI
  framing is superseded; those config-control-plane items shipped under
  Workstream E (PR #282).
  → P7-E  Operational control plane ✅ SHIPPED (PR #282: E2A Maintainer
         RBAC boundary + mutual exclusion, E2B backup evidence ledger, E2C
         operations views, E3 operational policy intent — RPO-only, no
         typed RTO authority). RTO + retention automation remain OPEN
         (Gate P7-3).
  → P7-M1  Exam policy schema + conflict validator ✅ SHIPPED
  → P7-M2  Profile templates + snapshot resolution ✅ SHIPPED
  → P7-M   Configurable exam modes ✅ CLOSED (2026-08-13, P7-F multimodal
         visual review: profile management UI + exam creation wizard +
         truthful starter recipes; no blocking defect; see
         docs/audits/P7-M-CONFIGURABLE-EXAM-MODES-CLOSEOUT.md)

P7-U1  UI pilot migration
  → P7-U2+ family-by-family UI closeout
```

Parallelism is allowed only where authority boundaries are already frozen.
P7-D2/D3/Q2/P1 are conditional on an accepted P7-D1 / ADR-001 decision. Redis
queue implementation must not begin before admission state semantics are
accepted. Admin settings UI must not begin before configuration layering and
snapshot semantics are accepted.

## 12. P7 release gates

> **Current verdicts (2026-08-13, P7-F closeout):** P7-0 PASS · P7-1 PASS ·
> P7-2 PASS · **P7-3 NOT PASS — HUMAN_DECISION_REQUIRED (two bullets: RTO +
> retention)** · P7-4 PASS · P7-5 PASS · P7-6 PASS. The gate definitions
> below are the contract; the P7-F closeout holds the evidence matrix.

### Gate P7-0 — Truthful plan

- current, phase, status, and open-items documents agree;
- M11 retains its existing meaning;
- completed plain-text `text_response` work is no longer listed as open;
- every P7 job has dependency and acceptance boundaries.

### Gate P7-1 — Recoverable authority

- state/authority map matches runtime;
- canonical commands own irreversible transitions;
- startup reconciliation has integration tests;
- process-crash simulations prove idempotent completion.

### Gate P7-2 — Redis decision is recorded and approved responsibilities are real

If P7-D1 accepted one or more Redis responsibilities:

- Redis lifecycle is safe and observable;
- each approved responsibility has a real business caller, an explicit failure
  policy, and tested failure semantics;
- multi-instance test proves shared behavior;
- persistence/eviction/topology matches the workload.

If P7-D1 concluded that no Redis adoption is warranted:

- the measurement evidence and re-evaluation conditions are recorded in
  ADR-001;
- Gate P7-2 is satisfied by that recorded decision — it does not require a
  forced Redis business integration.

### Gate P7-3 — Restore is proven

- declared RPO/RTO profile exists;
- backup automation and retention are operational;
- clean-host restore drill passes;
- post-restore invariant suite passes.

> **Status (2026-08-13): NOT PASS — HUMAN_DECISION_REQUIRED.** Evidence
> ledger, verified drills, and RPO intent (`desiredRpoSeconds`) pass; two
> bullets are not met: **RTO** (no typed authority / declared value /
> restore-within-RTO acceptance) and **retention** (host-owned,
> `NOT_ENFORCED`; host-side cron/systemd + WAL-G/pgBackRest is the
> P7-E3-recorded recommendation). See the P7-F closeout.

### Gate P7-4 — Configuration is controlled

- business settings are database-backed, versioned, audited, and rollbackable;
- secrets remain protected;
- active Exam/Attempt behavior is snapshot-frozen;
- Admin can inspect effective configuration and source.

### Gate P7-5 — Exam profiles are coherent

- the shipped minimal/standard-equivalent recipes (`basic_quiz`,
  `standard_online`) resolve to one policy schema; the deferred
  `Controlled` / `Strict` classes are excluded from this gate until their
  owning subsystems land (see note below);
- invalid combinations fail before publish;
- profile edits do not mutate published exams;
- each shipped recipe has API and representative browser E2E proof.

> **Revised (2026-08-11, P7-M closeout):** `Controlled` / `Strict` are
> DEFERRED — their promised capabilities (queue admission, device binding,
> lockdown, IP restriction, randomization, continuous monitoring) are
> unimplemented, so those two classes have no API/E2E proof and must not be
> shipped or claimed (truthfulness gate; P7-M closeout §10). Gate P7-5's
> E2E-proof bullet therefore applies to the shipped minimal/standard-
> equivalent recipes (`basic_quiz`, `standard_online`); the Controlled/Strict
> classes are re-validated against this gate when their owning subsystems
> land. The multimodal visual review round was performed by P7-F
> (2026-08-13) — P7-M closeout is **CLOSED** (no blocking defect; see the
> closeout's "Visual review closeout (P7-F round)" section).

### Gate P7-6 — UI closeout

- settings, status, recovery, backup, and profile workflows are usable through
  real UI;
- mobile/responsive and accessibility baselines pass;
- UI authority migration debt is reduced with enforceable lint coverage.

## 13. Relationship to existing roadmap items

| Existing item | P7 relationship |
| --- | --- |
| M11 resource-relationship authorization | remains separate; may consume Settings/UI foundations later |
| `timed_sync` / `untimed` | incorporated into policy schema and profiles |
| queue admission | becomes P7-Q1/Q2 |
| REC-I4-I3B2 | CLOSED: Admin route/permission/product path; does not activate Proctor |
| REC-I6 / M11 / REC-OPS | REC-I6-R0 incident authority is accepted (ADR-014 ACCEPTED); the J3 Admin incident runtime is CLOSED on master (PR #242). M11 Proctor-to-Exam scope and REC-OPS (J5/J6 recovery-center UI, J7 closeout) remain in state/recovery planning and must not be silently declared complete |
| P5-N2 notifications | may use configuration and Redis fan-out, but keeps PostgreSQL transaction/dedupe authority unless changed by ADR |
| invitation/password reset | benefits from global rate limit, Email templates, settings, and recovery |
| rich text / WYSIWYG answering | remains a separate answer-authority feature; the generic final-answer submit barrier (ADR-008 Option D) is independent of answer type and stays open for all supported answer types |
| Phase 4 integrations/multiTenant | remain Phase 4 and are not pulled into P7 |

## 14. Explicit non-goals

- no mandatory cloud service;
- no forced multiTenant conversion;
- no rewrite of the exam engine merely to adopt Redis;
- no replacement of PostgreSQL authority without an ADR;
- no single `mode` flag controlling scattered behavior;
- no secret values stored or returned in plaintext through Admin settings;
- no backup success claim without a restore proof;
- no UI-only setting that the runtime does not actually consume;
- no "Redis connected" claim when only diagnostics `PING` uses it.
