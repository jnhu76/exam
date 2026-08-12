# ADR-017 — Operational Authority and Maintainer Boundary

## Status

* Status: **PROPOSED** (accepted when P7-E1 is reviewed by a human)
* Date: 2026-08-12
* Decision owners: project
* Supersedes: none
* Superseded by: none
* Related decisions:
  * ADR-001 — Post-MVP Decision (P7)
  * ADR-010 — Scoped RBAC Architecture
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
Organization Owner (Admin) and the Deployment / Infrastructure / Operations
Owner (Maintainer) for the single-deployment, single-organization,
LAN/on-premise product. It does **not** authorize any new UI, role, schema,
route, or infrastructure execution surface. It freezes what already holds
structurally in the current tree and prohibits specific future
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

Two questions must be answered once, durably:

1. **Does holding the product `Admin` role imply machine-, database-, or
   secret-level authority?** The program's answer is no; the audit verified
   the current tree already enforces this by surface absence (no route, no
   capability, no UI can perform infrastructure execution).
2. **Is the person who operates the deployment a product identity?** The
   program considered three options (product role / pure host identity /
   hybrid) and this ADR selects the minimal-security answer: the Maintainer
   is a **deployment/operator identity**, not a product DB role, for E1/E2.

Evidence for both answers is in the P7-E1 audit (§4–§9): the permission
catalog contains no backup/restore/infra/secret capability; every backup,
restore, PITR, and WAL script is host-CLI-only with zero HTTP entry point;
secrets are env/Compose-owned and never stored in PostgreSQL; the product's
operational surface is read-only observation gated by `system.health.view`
and `system.diagnostics.view`, both correctly granted to Admin.

---

## Decision

### D1. Admin is the Exam Product / Organization Owner

- Admin holds business capabilities plus **limited, read-only operational
  observation** (health, diagnostics, email test, audit log; backup/restore
  status read views if and when E2 ships them).
- Admin **never** holds infrastructure execution authority through the
  product: no backup trigger, no schedule mutation, no restore/PITR, no WAL
  or destination control, no service restart, no DB/Redis endpoint control,
  no secret access (read or write).

### D2. Maintainer is a deployment/operator identity, not a product DB role

- The Maintainer's authority is host access: docker/Compose lifecycle,
  `scripts/backup/*`, operator CLI scripts (`bootstrap-admin`,
  `reset-admin-password`, `migrate`, rollback, backfill), secret store,
  filesystem/WAL/backup destinations, host logs.
- No Maintainer role preset, no login path, no schema change is created in
  E1/E2. A product identity for Maintainer is justified **only** if a future
  slice needs an in-product *viewer* that Admin should not hold; that is an
  E3 question, and if built it must be an observation-only capability preset
  (never business capabilities, never execution capabilities).
- Launchpad keeps creating `role = Admin` only; there is no
  "first Maintainer" bootstrap.

### D3. Infrastructure execution is architecturally outside the product

The following are **permanently forbidden as product capabilities or
surfaces** (not deferred, not "future capabilities"):

```text
backup.execute / backup.schedule.manage / restore.* / pitr.* /
secret.* / infra.restart / db.endpoint.manage / redis.topology.manage
```

Restore and PITR remain Maintainer + CLI/runbook + host access, forever.
The browser must never perform restore, PITR, PGDATA deletion, or any
destructive DB control.

### D4. Admin policy is intent, not infrastructure capability

If/when an operational policy record exists (desired RPO, retention window,
drill cadence — an E2 question), it is a **typed, audited, domain-owned
intent record**. It never binds or rewrites infrastructure. The product
renders DESIRED vs CURRENT CAPABILITY vs STATUS (e.g. `NOT SATISFIED`) and
never lets a DB setting claim to change infrastructure.

### D5. Backup SUCCESS is evidence-defined

A backup is SUCCESS only when the artifact exists, is readable, and passed
verification, and a durable `succeeded` evidence record (artifact
fingerprint + verification result) is committed. Crash/lease/abandoned
semantics, idempotency (operationId), and the fail-closed prune rule are
specified in P7-E1 §12 and are requirements for any E2 evidence slice.

### D6. Secrets stay in deployment/secret configuration

`DATABASE_URL`, `POSTGRES_PASSWORD`, `JWT_SECRET`, `REDIS_PASSWORD` /
`REDIS_URL`, `SMTP_PASSWORD`, `LAUNCHPAD_SETUP_TOKEN`, TLS/fs credentials:
env/Compose/secret store only. Never PostgreSQL, never plaintext in UI,
never in audit logs, never exported. UI shows status adjectives only.

### D7. Honest trust boundary

A host operator with root/docker access can technically read PGDATA and
backup artifacts. Software RBAC cannot prevent root from reading disks. The
separation guarantees that host authority does not automatically confer
**application-authorized business action** (the Maintainer has no product
account in E1/E2, so cannot log in, publish, grade, or assign through the
product). Deployment selection of whom to trust with host access is a
documented operational decision, not a software guarantee.

---

## Consequences

Positive:

- The separation is enforced by surface absence, which cannot regress
  accidentally and needs no new machinery.
- Least privilege is preserved: no new login path, no new role, no new
  destructive surface.
- The E2 evidence slice can be built with zero new execution authority.

Negative:

- In-product operational *reading* stays Admin-gated; a deployment that
  wants a separate non-business person to read ops status in-product must
  wait for the E3 observation-only viewer (or grant host/CLI access).
- The Admin role remains the highest-value product account; deployments
  must not additionally grant Admin users host access (that coupling would
  defeat the separation by possession).
- Reads of operational observation are currently un-audited (P7-E1 P2-3);
  acceptable today, tracked for E3.

Risks:

- Scope creep: an "Admin backup button" or "Maintainer dashboard with
  actions" would violate D3. Any proposal must be reviewed against this ADR
  before design.

---

## Alternatives considered

1. **Option A — Maintainer as a product DB role.** Rejected: no product
   surface authorizes infra execution, so the role would authorize nothing
   while inviting destructive UI (the exact coupling the program forbids).
2. **Option B — pure deployment/operator identity.** **Selected** (D2).
3. **Option C — hybrid (product observation capability + host execution).**
   The observation half is already realized today (Admin-gated read surface);
   a separate observation-only *viewer* preset is deferred to E3 and must
   follow the capability rules in D2/D3.

---

## Migration / rollout

None required: this ADR is a boundary contract over the current tree; it
adds no schema, no code, no configuration. It takes effect as binding
authority on acceptance. Future work (E2 evidence slice, E3 UI) must
conform to D1–D7.
