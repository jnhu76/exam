# ADR-017 — Operational Authority and Maintainer Boundary

## Status

* Status: **PROPOSED** (accepted when P7-E1 is reviewed by a human)
* Date: 2026-08-12
* Revision: 2 (2026-08-12) — corrected from "Maintainer = pure host/operator
  identity" (Option B, previous PR #281 head) to the **Hybrid Maintainer
  Model (Option C)**. Both revisions belong to the same review cycle of PR
  #281; revision 1's Option B decision is superseded by this revision.
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
  * P7-C portable persistence / backup / PostgreSQL DR (closeout)
  * P7-E0 Configuration Reality Audit (verdict: no generic settings subsystem)

> Review-cycle disclosure: ADR-017 is authored in the same cycle as the
> P7-E1 audit (`docs/audits/P7-E1-OPERATIONAL-AUTHORITY-AND-MAINTAINER-BOUNDARY.md`).
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
| **B. Operational control-plane authority** | Application Maintainer (future preset) — Admin holds the observation subset today | `system.health.view`, `system.diagnostics.view`, `system.backup.view`, `system.restore_readiness.view`, `system.ops.policy.view`; decision-gated mutations (`backup.trigger`, `backup.schedule.manage`, `backup.retention.manage`, `service.restart`) only under D5 — intent (`system.ops.policy.manage`) is Admin-only (D9) |
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

system.diagnostics.view  ≠  email.test.execute
```

`POST /email/test` is currently gated by `system.diagnostics.view`
(`apps/api/src/routes/email.ts:33`) although it is a side-effecting action
(transmits an email through the SMTP channel). The invariant is violated
today. This is not ordinary UX debt: it is a **precondition for the
Maintainer RBAC rollout (P7-E2A)** — when an operational view is granted to
a non-Admin principal, the action must be split into an independent
capability (e.g. `system.email.test`, named per the repo permission
convention) with its own gate and audit. E1 is docs-only; the route is not
changed in this PR.

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

### D9. Admin sets objectives; Maintainer decides implementation

Operational policy has exactly **one intent owner**. Admin holds
`system.ops.policy.manage` — the **desired operational objective** (RPO
target, retention objective, drill objective) — recorded as a **typed,
audited, domain-owned intent record**. It never binds or rewrites
infrastructure. Maintainer holds **no** intent capability; its policy
authority is execution-side only (`backup.schedule.manage`,
`backup.retention.manage`, D5). The product renders DESIRED vs CURRENT
CAPABILITY vs STATUS (e.g. `NOT SATISFIED`) and never lets a DB setting
claim to change infrastructure.

This is a **core P7-E principle**:

```text
Admin:      what the system must achieve   (intent)
Maintainer: how operations achieve it      (execution/control-plane)
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

---

## Consequences

Positive:

- Admin and Maintainer become **two distinct system roles** as the program
  requires, while the current tree needs no schema/role/UI change in E1.
- The hard execution boundary (D4) is enforced by surface absence and cannot
  regress accidentally.
- The E2 path is authority-first: the RBAC boundary (E2A) precedes any new
  operations surface (E2B/E2C), so Maintainer is never an afterthought.
- Decision-gated capabilities (D5) leave room for safe future control-plane
  actions (e.g. a typed backup trigger, D6) without committing to them.

Negative:

- The Application Maintainer identity is a *concept* until E2A — in-product
  operational reading stays Admin-gated in the meantime; a deployment that
  wants a separate non-business ops viewer must wait for E2A (or use
  host/CLI access).
- `POST /email/test` remains gated by a view capability until E2A (D7) —
  safe today because only Admin holds it, but a known invariant violation.
- The Admin role remains the highest-value product account; deployments
  must not additionally grant Admin users host access (that coupling would
  defeat the separation by possession).

Risks:

- Scope creep: an "Admin backup button" or "Maintainer dashboard with raw
  actions" would violate D4/D5. Any proposal must be reviewed against this
  ADR before design.
- E2A must resist the temptation to seed a Maintainer preset with any
  business capability; the preset principle (D2) is a hard constraint.

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
D1–D13.
