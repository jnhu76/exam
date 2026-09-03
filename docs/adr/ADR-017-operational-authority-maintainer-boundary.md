# ADR-017 — Operational Authority and Maintainer Boundary

## Status

* Status: **ACCEPTED through revision 4** (2026-08-14 — P7 final program
  closeout, [`docs/archive/audits/P7-FINAL-PROGRAM-CLOSEOUT.md`](../archive/audits/P7-FINAL-PROGRAM-CLOSEOUT.md);
  the runtime already implements the rev-4 model — verified in that closeout).
  Revision 4 was proposed 2026-08-13 (P7-RBAC-ROLE-REALITY-AUDIT remediation)
  and accepted by the P7 final program closeout after the code/runtime
  boundary check (Maintainer = read-only Operational Observer; zero business
  and zero write permissions; Admin ↔ Maintainer mutual exclusion D14
  enforced on every assignment path).
* Date: 2026-08-12 (rev 1–3); 2026-08-13 (rev 4 proposed); 2026-08-14 (rev 4 accepted)
* Revision: 4 (2026-08-14, **ACCEPTED**) — narrows/clarifies the
  **Application Maintainer model** from the revision-2 "viewer/controller"
  wording to a **read-only operational observability identity** ("Exam gives
  the Maintainer a window, not a hand"). Revision 4 does NOT change the
  Admin/Maintainer mutual exclusion (D14), the host execution boundary (D4),
  the restore/PITR prohibition, Admin business authority (D1), or the System
  synthetic authority. It corrects the Maintainer framing (D2/D5/D9), states
  explicitly that **no "Configurer" persona exists**, reframes operational
  policy as a **reliability objective**, and tightens D5's default stance on
  Maintainer write capabilities. See **§Revision 4** below for the binding
  corrections. **Revision 4 is the governing contract since acceptance
  (2026-08-14).**
* Earlier revisions: revision 2 corrected the model to the **Hybrid
  Maintainer Model (Option C)**; revision 3 froze the **Admin ↔ Maintainer
  mutual-exclusion invariant** (D14) and folded it into the E2A scope.
  Revision 1's Option B decision was superseded by revision 2. Rev 3 accepted
  with P7-E1 (2026-08-12, PR #281).
* Decision owners: project
* Supersedes: none
* Superseded by: none
* Related decisions:
  * ADR-001 — Post-MVP Decision (P7)
  * ADR-010 — Scoped RBAC Architecture (**amended by this ADR** — role
    preset set / role closed union / role_presets seed contract; see D2)
  * ADR-014 — Exam Incident Authority
  * ADR-015 — Proctor Exam Scope Authority
  * ADR-016 — Future Offline-Resilient Client Data and Recovery Model
  * ADR-018 — Operational Observability Window (future runtime-data contract;
    added by rev 4 — see §Revision 4)
  * P7-C portable persistence / backup / PostgreSQL DR (closeout)
  * P7-E0 Configuration Reality Audit (verdict: no generic settings subsystem)

> Review-cycle disclosure: ADR-017 is authored in the same cycle as the
> P7-E1 audit (`docs/archive/audits/P7-E1-OPERATIONAL-AUTHORITY-AND-MAINTAINER-BOUNDARY.md`).
> The audit is the evidence base for this ADR; the ADR is the binding
> boundary contract. They MUST be reviewed together and MUST NOT be treated
> as independent baseline evidence for one another.

This ADR records the **authority boundary** between the Exam Product /
Organization Business Owner (Admin) and the System Operations / Maintenance
Owner (Maintainer) for the single-deployment, single-organization,
LAN/on-premise product. It does **not** authorize any new UI, role, schema,
route, or infrastructure execution surface in E1. It freezes the authority
**architecture** the product must grow into, and prohibits specific future
regressions.

---

## Revision 4 (ACCEPTED) — Maintainer Observability Boundary

> **Status: ACCEPTED (2026-08-14 — P7 final program closeout).** This section
> narrows and clarifies the revision-2 Application Maintainer model. Where
> rev-2/3 wording conflicts with rev 4, **rev 4 governs**.

### R4-1. The corrected principle: a window, not a hand

```text
VIEW / SEARCH / FILTER / CORRELATE / DIAGNOSE   ≠
MUTATE / EXECUTE / CONFIGURE / RESTART / RESTORE
```

**Exam gives the Maintainer a window, not a hand.** Future operational data —
logs, metrics, events, diagnostic materials, backup/recovery evidence, runtime
state — may all be presented through that window. But the Application
Maintainer **never** mutates, executes, configures infrastructure, restarts
services, or restores through the Exam product. Real infrastructure maintenance
happens **outside** the Exam boundary (Host Operator — see R4-3).

### R4-2. Corrected role model

Revision 2 described the Application Maintainer identity as a
**"viewer/controller"** (D2). **Revision 4 corrects this:** the application-side
Maintainer is an **Operational Observer**, not a controller. There is no
control-plane write authority in the current Maintainer model.

```text
                          Exam
                           │
             ┌─────────────┴─────────────┐
             │                           │
           Admin                     Maintainer
     考试管理员                     系统运维
   (Exam Administrator)        (System Operations Observer)
             │                           │
      manages the Exam            reads runtime evidence
        product plane             through the Exam window
             │                           │
             └─────────────┬─────────────┘
                           │
                      Exam boundary
───────────────────────────┼────────────────────────────────
                           │
                    Host Operator
                  (NOT Exam RBAC)
                           │
               SSH / Docker / PostgreSQL
               WAL / backup / restore / PITR
               filesystem / secrets / systemd
```

| Identity | What it is | Authority |
| --- | --- | --- |
| **Admin** (考试管理员) | Exam application administrator / business owner | Business plane + application settings + **reliability-objective** authority (desired RPO / retention / drill cadence). Observes operational summary. **Never** infrastructure execution. |
| **Application Maintainer** (系统运维) | Read-only operational observability identity | **Observation only:** view / search / filter / inspect / correlate / diagnose runtime evidence. **Zero** business permissions, **zero** write permissions. |
| **System** | Synthetic non-human actor | Produces / evaluates runtime evidence (deadline auto-submit, heartbeat scan, reconcile). Non-login, non-assignable. |
| **Host Operator / Host Maintainer** | Real infrastructure execution identity | Docker/Compose, PostgreSQL, WAL, backup destination, secrets, restore/PITR, service lifecycle, filesystem. **NOT Exam RBAC** — granted by host/CLI access, independently of any Exam account. |
| **Configurer** | **DOES NOT EXIST** | There is no separate Configurer persona, and no role named Configurer / Configuration Manager / System Administrator / Ops Admin / Backup Admin / Platform Admin may be invented to solve configuration ownership. |

**No human actor may hold active Admin + Maintainer assignments simultaneously**
(D14, unchanged). Host access is not an RBAC assignment and is unaffected (D12).

### R4-3. "Configurer" does not exist — configuration is owned, not persona'd

There is **no separate Configurer persona**. Configuration ownership is a
resource-authority question, classified into three categories:

| Category | Examples | Owner |
| --- | --- | --- |
| **A. Exam business configuration** | exam duration, question policy, grading rules, candidate identity fields, branding, organization/application settings | **Admin** |
| **B. Reliability objectives / desired operational outcomes** | desired RPO, desired retention objective, desired restore-drill cadence | **Admin** (intent only — never binds infrastructure) |
| **C. Infrastructure / runtime configuration** | cron schedule, `postgres.conf`, backup destination, WAL archive configuration, Docker/Compose, secrets | **Host Operator** — **outside Exam RBAC** |

The Maintainer **may view** relevant status/evidence for category C, but does
**not own** those settings inside Exam. This is why the product exposes
category B as an **intent record** (Admin sets the objective; the System
evaluates whether observed evidence satisfies it) and never as infrastructure
configuration.

### R4-4. Operational policy = reliability objective (D9 reframe)

`system.ops.policy.*` is **not** infrastructure configuration. It is a
**Reliability Objective / Desired Operational Outcome**. The mental model:

```text
Admin:      "I require RPO <= 1h."            (intent / objective)
Maintainer: "The system currently does / does not meet it."  (observe + compare)
System:     "Observed evidence says SATISFIED / NOT SATISFIED." (evaluate)
Host Op:    "I decide how backups are actually scheduled and configured." (execute)
```

The Admin owns the **intent** (`system.ops.policy.manage`, the sole intent
owner). The Maintainer **views** the intent and the DESIRED-vs-OBSERVED
compliance projection (`system.ops.policy.view`). The product renders truth
(SATISFIED / NOT_SATISFIED / UNKNOWN / NOT_CONFIGURED) and **never** lets a DB
setting claim to change infrastructure. UI copy should read **可靠性目标**
(reliability objective), not "运维策略配置" (which is easy to misread as
infrastructure configuration). Persistence names (`system.ops.policy.*`) are
**not** renamed in rev 4 — the reframe is semantic/docs only (no migration
churn); the meaning is made explicit here.

### R4-5. D5 default stance tightened — write capabilities are NOT part of the current Maintainer model

Revision 2 listed `backup.trigger`, `backup.schedule.manage`,
`backup.retention.manage`, and `service.restart` as "decision-gated" future
possibilities. **Revision 4 tightens the default stance:** under the
observability-window model these are **NOT PART OF THE CURRENT APPLICATION
MAINTAINER MODEL.** No such write capability may be introduced merely because a
Maintainer role exists. Each requires a **future independent ADR** proving, for
the specific capability: why it belongs inside Exam rather than host tooling; a
typed, safe abstraction; no shell / raw path / raw secret exposure;
idempotency; audit; explicit failure semantics; least privilege; and
rollback/recovery behavior. **None is implemented now.** Restore/PITR remain
**permanently host-only** (D4).

The Maintainer permission set is frozen at exactly five **read** capabilities
(`system.health.view`, `system.diagnostics.view`, `system.backup.view`,
`system.restore_readiness.view`, `system.ops.policy.view`): business
permission count = 0, write permission count = 0.

### R4-6. What revision 4 does NOT change

- **D1** — Admin remains the Exam business owner (plus operational
  **observation** summary + reliability-objective intent). Admin **never**
  receives infrastructure execution authority.
- **D4** — restore/PITR/PGDATA/raw-secret/raw-host authority remain
  permanently excluded from the ordinary browser control plane.
- **D12** — host authority does not imply or auto-grant an Application
  Maintainer identity (and vice versa).
- **D14** — Admin ∩ Maintainer = ∅ at the active-assignment level, enforced
  transactionally. The reason is now sharper: Admin **manages** the Exam;
  Maintainer **observes** system operations — one product identity must not
  silently recombine both personas.
- The System synthetic actor and its closed, non-login, non-assignable nature.
- The hybrid model's recognition of a future application-side Maintainer
  **read-only** preset (implemented E2A, unchanged).

### R4-7. Authority precedence (unchanged)

```text
human-approved correction in this task
> ADR-017 revision 4 (governing since acceptance)
> ADR-017 revisions 1–3
> ADR-010 (as amended)
> code reality
> old roadmap prose
```

### R4-8. Related: F-04 (Teacher course-scope) is an explicit deferral

The P7-RBAC-ROLE-REALITY-AUDIT finding **F-04** (Teacher@Course scope declared
but not enforced — current runtime is org-wide) is **CONFIRMED and EXPLICITLY
DEFERRED to a dedicated scoped-RBAC milestone**, not silently into P7-F. The
target model remains Teacher@Course; the gap (no persisted scope carrier, no
resolver family, no scoped route gates, no LIST filtering) is documented in
`packages/authz/src/presets.ts` and the remediation report. Durable tracking:
**issue #286 — Enforce Teacher@Course scoped authority (F-04)**.
**P7-F is not globally blocked by F-04, but P7-F MUST NOT claim or depend on
Teacher course isolation** until that milestone closes it.

### R4-9. Related: the Observability Window (ADR-018)

The read-only product boundary future runtime data plugs into is defined in
**ADR-018 — Operational Observability Window** (read-only, redacted,
domain-separated, bounded, source-aware, truthful; Metrics / Logs / Events /
Materials taxonomy). ADR-017 rev 4 defines *who* (Maintainer observes);
ADR-018 defines *what may flow through the window and under what contract*.

---

## Context

The exam platform's `Admin` role is the product's business-owner superset
(user/role management, candidates, courses, questions, exams, profiles,
publication, grading, scores, exports, Recovery Center business decisions,
organization branding). The platform also ships operator mechanisms —
PostgreSQL backup (logical/physical/cold), WAL archiving / PITR, restore
scripts, migration/rollback/backfill CLIs, Compose lifecycle — that are
executed by a deployment operator on the host.

The audit verified that the current tree enforces the hard part structurally:
no route, capability, or UI can perform infrastructure execution; no Admin
capability reaches machine-, database-, or secret-level authority; secrets
are env/Compose-owned; restore is operator-owned permanently (evidence:
P7-E1 audit §4–§8).

The remaining question is the **target architecture**: is the Maintainer a
product identity, a host identity, or both? The program's core goal is that
Admin and Maintainer are **two distinct system roles with different
responsibilities**. A pure host identity (Option B) fails that goal in one
direction: the product would have no way to grant a separate operations
person *application-side* access (observation / control-plane) without giving
them Admin. This revision therefore selects the **Hybrid Maintainer Model**.

---

## Decision

### D1. Admin is the Exam Product / Organization Business Owner

- Admin holds business capabilities (users, roles, candidates, courses,
  questions, exam profiles, exam authoring/publish, grading, result publish,
  business recovery decisions, organization settings) **plus limited
  operational visibility** — a business-owner summary:
  `system healthy? / backup healthy? / RPO satisfied? / last verified backup?
  / critical warning?`.
- **Admin MAY observe system health. Admin DOES NOT thereby become System
  Maintainer.** Observation does not imply control-plane or execution
  authority.
- Admin **never** holds infrastructure execution authority through the
  product: no backup trigger, no schedule mutation, no restore/PITR, no WAL
  or destination control, no service restart, no DB/Redis endpoint control,
  no secret access (read or write).

### D2. Maintainer is the System Operations / Maintenance Owner — Hybrid model (Option C)

> **Revision 4 (ACCEPTED) correction:** the "viewer/controller" wording below
> is **superseded** by R4-2. The application-side Maintainer is a **read-only
> Operational Observer**, not a controller. The hybrid (application identity +
> host identity) structure and the Admin↔Maintainer exclusion are unchanged.

Maintainer authority spans **two separate trust planes**. They may be held by
the same person in reality, but architecturally they are distinct and must
never be conflated:

```text
Application Maintainer identity         Host Maintainer identity
──────────────────────────────          ──────────────────────────
authenticated product operations        infrastructure execution
viewer/controller                       Docker / Compose
                                        PostgreSQL / WAL archive
ONLY operational observation /          filesystem / backup destination
control-plane capabilities              secret store / service lifecycle
                                        restore / PITR / PGDATA
NO business authority                   migration / rollback / backfill
NO destructive infrastructure           ──────────────────────────
execution authority                     NOT product RBAC authority
```

1. **Application Maintainer identity** — an authenticated product role
   concept (capability bundle). When the product needs to give an
   independent maintainer an operational UI, it must be built with the
   existing capability-based RBAC as a **Maintainer preset** — never by
   granting Admin. Future Maintainer preset principles:
   - ONLY operational capabilities:
     `system.health.view`, `system.diagnostics.view`, `system.backup.view`,
     `system.restore_readiness.view`, `system.ops.policy.view`
     (naming per repo `domain.resource.action` convention; each is
     individually decision-gated when introduced).
   - Explicitly NOT granted, ever: `user.*`, `candidate.*`, `course.*`,
     `question.*`, `exam.*`, `grading.*`, `score.*`, incident business
     mutation, attempt force-submit, time grant, misconduct marking,
     result publish.
   - **E1 does not implement this identity.** The architecture explicitly
     recognizes it as the future operational role/preset. It is
     provisioned, when E2/E3 operational surfaces require it, through the
     ordinary authenticated user/role-assignment path or a separately
     reviewed operator onboarding path — it must NOT inherit Admin
     capabilities.

   **This ADR AMENDS ADR-010 (Role Presets / closed union / seed contract).**
   The Maintainer is a future **built-in** role of the RBAC architecture,
   not a Phase-4 custom role:

   ```text
   ADR-010 Role Presets — amended by ADR-017:

   Built-in assignable human roles:
     Admin
     Teacher
     Proctor
     Grader
     Candidate
     Maintainer    <-- P7-E2A adds this to the code-constant union
                          (packages/authz Role enum) and the
                          role_presets seed rows

   System remains synthetic / non-login / non-assignable.
   Unknown role strings remain a load-time error (unchanged).
   Custom roles remain Phase 4 (unchanged).
   ```

   The amendment covers ADR-010's **role preset set**, **role closed
   union**, and **role_presets seed contract** only. Everything else in
   ADR-010 (scope model, capability catalog, resolver semantics) is
   unchanged and NOT superseded. E2A materializes the Maintainer preset;
   this ADR does not.
2. **Host Maintainer identity** — infrastructure execution authority on the
   deployment host. These are **not** product RBAC authority: they are
   docker/CLI/host facts (see the audit's infra-only inventory, §6).

### D3. Three authority planes

| Plane | Owner | Examples |
| --- | --- | --- |
| **A. Business authority** | Admin only (Maintainer default none) | users, roles, candidates, courses, questions, exam profiles, exam authoring, exam publish, grading, result publish, business recovery decisions (force-submit / time-grant / misconduct / incident resolve), organization settings |
| **B. Operational control-plane authority** | Application Maintainer (future preset) — Admin holds the observation subset today | `system.health.view`, `system.diagnostics.view`, `system.backup.view`, `system.restore_readiness.view`, `system.ops.policy.view`; decision-gated mutations (`backup.trigger`, `backup.schedule.manage`, `backup.retention.manage`, `service.restart`) only under D5 — intent (`system.ops.policy.manage`) is Admin-only (D9). *(Rev 4, ACCEPTED: current-model row B is **observation only** — the decision-gated mutations are future-only per R4-5.)* |
| **C. Infrastructure execution authority** | Host Maintainer (host/CLI) | Docker/Compose, PostgreSQL, WAL archive, filesystem, backup destination, secret store, service lifecycle, restore, PITR, PGDATA, migration/rollback/backfill |

### D4. Permanently forbidden through normal product UI

The following are **architecturally excluded** from the ordinary browser
control plane — not deferred, not "future capabilities":

```text
restore.execute
pitr.execute
pgdata.delete
database.destructive_recovery
secret.read_plaintext
secret.export
host.filesystem.raw_manage
db.endpoint.raw_manage
redis.credentials.read
```

Core principle:

> **Destructive history replacement / raw secret / raw host authority never
> enters the ordinary browser control plane.**

Restore and PITR remain Host Maintainer + CLI/runbook + host access, forever.

### D5. Decision-gated operational capabilities

> **Revision 4 (ACCEPTED) tightening:** under the observability-window model
> (R4-5), the capabilities listed below are **NOT part of the current
> Application Maintainer model**. The "decision-gated" framing is retained only
> as a high bar — each requires a future independent ADR; none is implemented,
> and no write capability is granted merely because a Maintainer role exists.

The following are **NOT permanently forbidden**:

```text
backup.trigger
backup.schedule.manage
backup.retention.manage
service.restart
```

Today they are:

```text
NOT IMPLEMENTED
HOST-OWNED TODAY
FUTURE DECISION-GATED
```

They may enter the product control plane **only** when all of the following
hold for the specific capability: a typed contract, least privilege, audit,
idempotency, explicit failure semantics, and a non-secret abstraction. This
ADR neither promises to implement them nor permanently forbids them; each
requires its own recorded decision (following the P7-D1 decision-gate
pattern).

`operational.policy.manage` is **deliberately absent** from this list:
operational policy has exactly ONE intent owner (Admin, D9). Maintainer's
policy authority is execution-side only (`backup.schedule.manage`,
`backup.retention.manage`), not intent management.

### D6. Backup trigger abstraction (if ever built)

Backup and Restore have different risk levels and must be treated
differently. A future product-side **backup trigger** is acceptable in
principle:

```text
Maintainer → Trigger verified logical backup
≠
Maintainer → choose arbitrary shell command
```

If ever implemented, the product surface must invoke only a **predefined,
typed, non-destructive, audited, idempotent backup command** — and must
never expose raw paths, raw `pg_dump` arguments, shell, the DB password, or
filesystem credentials. Restore/PITR are not part of this abstraction and
stay host-only. Nothing is implemented in E1; this paragraph only freezes
the architecture boundary.

### D7. View capability must not authorize side effect (invariant)

```text
VIEW CAPABILITY MUST NOT AUTHORIZE SIDE EFFECT

system.diagnostics.view  ≠  system.email.test
```

`POST /email/test` is a side-effecting action (transmits an email through the
SMTP channel). **It is gated by the dedicated `system.email.test`
(`SystemEmailTest`) capability** (`apps/api/src/routes/email.ts`), granted to
the **Admin preset only** — it is NOT part of the Maintainer preset, and
`system.diagnostics.view` never authorizes it. The invariant is enforced in
the current runtime; the Maintainer receives the five read capabilities
(`R4-5`) and zero side-effect capabilities.

> History: revisions 1–3 of this ADR recorded the pre-E2A state, where the
> route was gated by `system.diagnostics.view` (safe only because Admin alone
> held the view). P7-E2A (rev 4, ACCEPTED) resolved it by splitting
> `system.email.test` out of the diagnostics view. The split is implemented
> in the runtime and reflected in `packages/authz/src/catalog.ts` +
> `packages/authz/src/presets.ts`.

### D8. Diagnostics authority-domain split (future requirement)

`GET /system/diagnostics` currently mixes two domains:

```text
Operational diagnostics        vs   Business integrity / recovery diagnostics
DB latency                           submitted-not-terminalized anomalies
Redis state                          workset-mismatch anomalies
scanner state                        attempt/candidate/exam-level integrity detail
worker state
```

A future Application Maintainer must see **operational diagnostics** but
must **not automatically** see business-domain integrity details that involve
attempts/candidates/exams. E1 does not change the route, but the current
`/system/diagnostics` response must **not** be handed unchanged to a
Maintainer viewer; E2A must define the semantic split.

### D9. Admin sets objectives; Maintainer observes compliance

> **Revision 4 (ACCEPTED) correction:** under the observability-window model
> (R4-4/R4-5) the Maintainer **observes** intent and the desired-vs-observed
> compliance projection; the "execution / control-plane" framing below is
> **superseded** — execution-side policy authority (`backup.schedule.manage`,
> `backup.retention.manage`) is future-only (D5), not part of the current
> Maintainer model.

Operational policy has exactly **one intent owner**. Admin holds
`system.ops.policy.manage` — the **desired operational objective** (RPO
target, retention objective, drill objective) — recorded as a **typed,
audited, domain-owned intent record**. It never binds or rewrites
infrastructure. Maintainer holds **no** intent capability; under the rev-4
model its policy authority is **observation of intent + compliance
projection only** (`system.ops.policy.view`). The product renders DESIRED vs
CURRENT CAPABILITY vs STATUS (e.g. `NOT SATISFIED`) and never lets a DB
setting claim to change infrastructure.

This is a **core P7-E principle**:

```text
Admin:      what the system must achieve   (intent)
Maintainer: whether observed evidence meets it (observe + compare)
System:     whether reality satisfies it   (evidence/status)
```

### D10. Backup SUCCESS is evidence-defined — invariants only

E1 freezes the **invariants**:

```text
1. a backup must not become SUCCESS before verification
2. a duplicate logical run must not produce contradictory evidence
3. a crash before verified evidence must not claim success
4. pruning must fail closed when safety cannot be proven
```

E1 does **not** freeze mechanisms: lease-based abandoned transitions, a
specific reconciler, an `active_restore_target` DB record, or an exact
`operationId` derivation format are **E2 adversarial-design space**, not
commitments of this audit.

Open design question for E2 (explicitly unresolved here): restore is
host-only, so product-side retention logic "checking the active restore
target" requires a **cross-authority protocol** between the host-side
restore action and the product's evidence/retention records. E1 does not
assume this protocol exists.

### D11. Secrets stay in deployment/secret configuration

`DATABASE_URL`, `POSTGRES_PASSWORD`, `JWT_SECRET`, `REDIS_PASSWORD` /
`REDIS_URL`, `SMTP_PASSWORD`, `LAUNCHPAD_SETUP_TOKEN`, TLS/fs credentials:
env/Compose/secret store only. Never PostgreSQL, never plaintext in UI,
never in audit logs, never exported. UI shows status adjectives only.

### D12. Honest trust boundary

A host operator with root/docker access can technically read PGDATA and
backup artifacts. Software RBAC cannot prevent root from reading disks. The
separation guarantees that host authority does not automatically confer
**application-authorized business action** — and, precisely: **host
authority DOES NOT IMPLY or automatically grant an Application Maintainer
identity**. The same real person may hold both planes after E2A (an
Application Maintainer account plus host access), but each plane is granted
separately; a future Application Maintainer preset grants observation only.
Deployment selection of whom to trust with host access is a documented
operational decision, not a software guarantee.

### D13. E2 sequencing (authority first)

No further **Admin-only** operations surface may be added before the
operational RBAC boundary exists. The E2 order is:

```text
P7-E2A  Operational RBAC Boundary
          define/implement the Maintainer observation capability bundle
          (amends ADR-010 role preset set — D2)
          split dangerous action-under-view capabilities (D7)
          split diagnostics domains (D8)
          ensure Maintainer has zero business permissions
          enforce Admin ↔ Maintainer mutual exclusion (D14) — a
          server-side invariant across every active-assignment path
          MIGRATION CONTRACT: split authority WITHOUT breaking existing
          Admin visibility — during migration Admin temporarily retains
          both summary + detailed read; Maintainer receives ONLY
          operational diagnostics, never business-integrity diagnostics
P7-E2B  Backup Evidence Ledger
          backup_runs / backup_run_events
          script instrumentation at natural checkpoints
          truthful verification evidence (D10 invariants)
          read projections
P7-E2C  Admin / Maintainer Operational Views (VIEWS ONLY)
          Admin gets the business-owner summary UI (D1)
          Maintainer gets the detailed operations UI (D2/D8)
          operational policy intent records + editable policy UI are
          P7-E3, NOT E2C
          only after E2C is usable may detailed Admin visibility be
          removed, if the product still wants that restriction
```

E2A–E2C may be merged into one or more PRs; the ordering constraint is what
binds.

Conservative read rule: Admin's summary read is **guaranteed**; Admin's
detailed diagnostics read is **optional/read-only** afterwards. The
separation that matters is that Admin cannot **OPERATE** infrastructure —
not that Admin must be blind to infrastructure details. Do not manufacture
read denial for role-differentness.

### D14. Admin ↔ Maintainer mutual exclusion (invariant)

The runtime authority kernel resolves a human actor's effective authority
as the **union of every active role assignment's preset permissions**
(`apps/api/src/authz/assignmentAuthority.ts`) — one actor holding two active
assignments holds both capability sets. Adding the Maintainer preset (E2A)
without an exclusion would therefore let a user holding Admin + Maintainer
recombine, through the assignment back door, the two roles this ADR exists
to separate.

```text
ADMIN / MAINTAINER MUTUAL EXCLUSION

No human actor may hold active Admin and Maintainer assignments
at the same time.

Admin ∩ Maintainer = ∅
at the effective-authority / active-assignment level.
```

Committed state must never contain active Admin + active Maintainer for the
same human actor. This is the assignment-level expression of the program's
core goal — "Admin and Maintainer are not the same person" — and it is a
**server-side authority invariant, not a UI rule**.

Scope:

- **Forbidden:** active Admin + active Maintainer, same actor.
- **Not prohibited:** Maintainer + any other role (e.g. Teacher) — left open
  for a later decision. Host Maintainer access is not an RBAC assignment at
  all (D12) and is unaffected.

E2A must enforce the invariant on **every path that produces an active
assignment**: create assignment, activate assignment, replace primary role,
promote secondary → primary, user creation / role change, and seed /
migration / backfill. The check + mutation must run **in the same
transaction under an explicit concurrency fence** — two concurrent
transactions must not each insert one of the two roles for the same actor
(write-skew). Pattern: the existing last-effective-Admin serialized
invariant (`mutateWithEffectiveAdminPostcondition`,
`apps/api/src/authz/adminInvariant.ts` — organization advisory lock +
post-condition). The DB per-row CHECK constraint (`ASSIGNABLE_ROLES`,
`packages/db/src/schema/pg.ts`) is per-row and cannot express cross-row
exclusivity, so the invariant lives in the transactional command layer, not
the schema. The exact mechanism is E2A adversarial-design space; this ADR
freezes only the invariant.

---

## Consequences

Positive:

- Admin and Maintainer become **two distinct system roles** as the program
  requires, while the current tree needs no schema/role/UI change in E1.
- The hard execution boundary (D4) is enforced by surface absence and cannot
  regress accidentally.
- The E2 path is authority-first: the RBAC boundary (E2A) precedes any new
  operations surface (E2B/E2C), so Maintainer is never an afterthought.
- The Admin ↔ Maintainer mutual-exclusion invariant (D14) closes the
  multi-assignment union back door: the two roles can never recombine for
  one actor, no matter which assignment path was used.
- Decision-gated capabilities (D5) leave room for safe future control-plane
  actions (e.g. a typed backup trigger, D6) without committing to them.

Negative:

- The Application Maintainer identity is a *concept* until E2A — in-product
  operational reading stays Admin-gated in the meantime; a deployment that
  wants a separate non-business ops viewer must wait for E2A (or use
  host/CLI access).
- (Resolved in E2A / rev 4, ACCEPTED) the pre-E2A `POST /email/test` view-capability
  gate described in D7 history was a known invariant violation; the runtime now
  gates it on the separate Admin-only `system.email.test` capability.
- The Admin role remains the highest-value product account; deployments
  must not additionally grant Admin users host access (that coupling would
  defeat the separation by possession).

Risks:

- Scope creep: an "Admin backup button" or "Maintainer dashboard with raw
  actions" would violate D4/D5. Any proposal must be reviewed against this
  ADR before design.
- E2A must resist the temptation to seed a Maintainer preset with any
  business capability; the preset principle (D2) is a hard constraint.
- E2A must implement D14 transactionally with a concurrency fence — a
  UI-only or best-effort mutual-exclusion check would be an invariant
  regression.

---

## Alternatives considered

1. **Option A — Maintainer as a product DB role, implemented now.**
   Rejected **for E1**: do not implement the role before the authority
   contract is accepted — an implemented role with no surface would
   authorize nothing while inviting destructive UI (the exact coupling the
   program forbids). **E2A materializes only the application-side
   Maintainer preset** defined by Hybrid Option C — a capability bundle
   amending ADR-010's role set (D2), not a full product role with UI.
2. **Option B — pure deployment/operator identity (revision 1 of this
   ADR).** Rejected in revision 2: it fails the program's core goal that
   Admin and Maintainer are **two distinct system roles** — the product
   would have no application-side identity for a separate operations person,
   forcing "observation via product" to remain Admin-only forever, and any
   future ops viewer would require granting Admin.
3. **Option C — Hybrid (application operational identity + host execution
   identity).** **Selected** (D2). The application half is recognized now,
   implemented later (E2A) through the existing capability RBAC; the host
   half is today's reality.

---

## Migration / rollout

None required for this revision: it is a boundary contract over the current
tree; it adds no schema, no code, no configuration. It takes effect as
binding authority on acceptance. Future work (E2A/E2B/E2C) must conform to
D1–D14.
