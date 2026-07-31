# P7 — System Readiness and Configurable Exam Modes

> Status: PROPOSED — planning authority candidate
> Date: 2026-07-31
> Phase: Phase 3 hardening, after P6 MVP closeout
> Scope: single-deployment, single-organization, LAN/on-premise
> Does not redefine M11; M11 remains resource-relationship authorization

## 1. Why P7 exists

The implemented MVP can complete the supported Admin/Teacher/Candidate exam
loop, but the next bottleneck is no longer an isolated product feature. The
project now needs to turn implemented components into a coherent, operable,
recoverable, configurable system.

P7 groups eight concerns that otherwise risk being implemented independently:

1. Redis has a baseline but is not adopted by business paths.
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

- `timed_sync`, `deadline`, and `untimed` timing modes are not operationally
  complete.
- queue admission is not operationally wired.
- M11 resource-relationship authorization is not implemented.
- staff invitation, password reset, activation/deactivation, and account
  recovery are not implemented.
- P5-N2 additional operational notification types are deferred.
- backend Email templates/i18n are not implemented.
- rich-text/WYSIWYG answering and ADR-008 final-answer barrier are not
  implemented.
- fill-blank full runtime/E2E status remains an open roadmap item and must be
  re-audited.
- operator grant route, permission, incident model, and dedicated recovery UI
  remain deferred.
- broad UI component-authority migration remains incomplete.
- automated backup, PITR, restore verification, and recovery drills are not
  productized.
- Redis is not used by rate limit, queue, presence, scanner coordination,
  cache, stream, Pub/Sub, or sessions.

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

Move Redis from optional diagnostics-only infrastructure to deliberately
adopted runtime responsibilities.

### Capability classes

| Class | Candidate responsibilities |
| --- | --- |
| Ephemeral | cache, rate limits, presence, session/device registry, dedupe windows |
| Coordination | scanner lease, singleton jobs, admission ownership, cache invalidation |
| Durable jobs/events | delayed work, retries, streams, generic workers |

### First implementation sequence

1. Redis lifecycle hardening and `off | optional | required` operating modes.
2. global rate limit shared across API instances.
3. admission queue state-machine design.
4. Redis-backed admission queue with persistence and observability.
5. presence and live dashboard projection.
6. evaluate Streams/generic job queue/cache only from measured need.

### Non-dogmatic authority rule

Redis is technically capable of durable state. For P7, Exam retains PostgreSQL
authority for attempts, answers, grading, audit, and business configuration.
Moving one of those responsibilities is possible but requires a separate
accepted ADR.

## 6. Workstream C — Backup and restore

### Current gap

The MVP runbook delegates backups to an operator-supplied `pg_dump` schedule.
That is a minimum deployment note, not a complete backup/recovery capability.

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

#### Runtime operational settings

Move to audited database-backed settings where safe:

- default rate limits and route policies;
- Email sender display settings and retry policy;
- worker intervals/batch sizes within validated limits;
- backup schedule, retention, and destination reference;
- data-retention policy;
- default exam policy profile;
- notification policy toggles;
- UI branding and organization display settings;
- feature activation that does not alter bootstrap topology.

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

### Settings requirements

- typed schema and range validation;
- version and optimistic concurrency;
- actor/time/reason audit;
- current effective value and source layer;
- restart-required marker;
- preview/diff before activation;
- rollback to a previous version;
- import/export with secret redaction;
- capability-gated access;
- safe defaults and migration/backfill;
- health warning when runtime env overrides a database setting.

## 9. Workstream F — Exam policy profiles

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
  → publish and freeze
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
P7-R0  Reality + documentation reconciliation
  ├─ P7-S1  State-machine and authority audit
  └─ P7-D1  Redis capability/adoption decision

P7-S1
  → P7-RC1  Crash-recovery and startup reconciliation
  → P7-Q1   Admission queue state-machine design

P7-D1
  → P7-D2  Redis runtime lifecycle hardening
  → P7-D3  Global Redis-backed rate limit
  → P7-Q2  Redis-backed admission queue
  → P7-P1  Presence/live operational projection

P7-B1  Backup/RPO/RTO design
  → P7-B2  Backup + restore CLI
  → P7-B3  PITR/retention/verification
  → P7-B4  Admin backup surface + restore drill evidence

P7-C1  Configuration taxonomy + schema
  → P7-C2  Settings service/version/audit
  → P7-C3  Admin settings UI
  → P7-M1  Exam policy schema + conflict validator
  → P7-M2  Profile templates + snapshot resolution
  → P7-M3  Exam creation wizard

P7-U1  UI pilot migration
  → P7-U2+ family-by-family UI closeout
```

Parallelism is allowed only where authority boundaries are already frozen.
Redis queue implementation must not begin before admission state semantics are
accepted. Admin settings UI must not begin before configuration layering and
snapshot semantics are accepted.

## 12. P7 release gates

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

### Gate P7-2 — Redis is operationally real

- Redis lifecycle is safe and observable;
- at least one real business capability uses Redis;
- multi-instance test proves shared behavior;
- failure policy is explicit and tested;
- persistence/eviction/topology matches the workload.

### Gate P7-3 — Restore is proven

- declared RPO/RTO profile exists;
- backup automation and retention are operational;
- clean-host restore drill passes;
- post-restore invariant suite passes.

### Gate P7-4 — Configuration is controlled

- business settings are database-backed, versioned, audited, and rollbackable;
- secrets remain protected;
- active Exam/Attempt behavior is snapshot-frozen;
- Admin can inspect effective configuration and source.

### Gate P7-5 — Exam profiles are coherent

- minimal, standard, controlled, and strict profiles resolve to one policy
  schema;
- invalid combinations fail before publish;
- profile edits do not mutate published exams;
- each profile has API and representative browser E2E proof.

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
| REC-I4-I3B2 / REC-I6 | included in state/recovery UI planning, not silently declared complete |
| P5-N2 notifications | may use configuration and Redis fan-out, but keeps PostgreSQL transaction/dedupe authority unless changed by ADR |
| invitation/password reset | benefits from global rate limit, Email templates, settings, and recovery |
| rich text / WYSIWYG barrier | remains a separate answer-authority feature under the policy/config framework |
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
