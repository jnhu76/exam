# P7-E1 — Operational Authority & Maintainer Boundary

**Status:** READY FOR HUMAN REVIEW
**Program:** P7-E — Operational authority separation (Admin ≠ Maintainer)
**Baseline (`origin/master`):** `e3eaaa4ce2116a756ad82aa8a209e249fe4466e1` (merge PR #279, clean tree)
**Tree at audit:** clean
**Code changes:** NONE (docs-only + ADR-017). No runtime code, no schema, no UI, no scripts.

---

## 1. Executive conclusion

The system **already enforces the hard part** of the Admin/Maintainer
separation, and it does so structurally rather than by convention:

> **There is no product surface — route, capability, or UI — that can perform
> infrastructure execution.** PostgreSQL backup, restore, PITR, WAL archiving,
> service restart, secret handling, and host paths are 100% host/CLI-operated
> (`scripts/backup/*`, operator CLI scripts, Compose). No HTTP route triggers
> any of them, and no permission in the catalog can gate them, because none
> exists.

The audit found **zero** places where an Admin identity can reach machine-,
database-, or secret-level authority through the product. The "Admin =
system operator" conflation the program was launched to remove is **not
present in the current tree**. What exists instead is:

1. **Admin holds operational *observation* capabilities** — `system.health.view`
   and `system.diagnostics.view` gate the read-only health/diagnostics/
   dashboard/email-test surface. Per the authority matrix (§10) observation
   is read-available to the business owner, so this is correct scoping, not
   a defect.
2. **The authority architecture recognizes the Maintainer as a distinct
   system role — the Hybrid Maintainer Model (Option C).** The Maintainer
   is two separate trust planes, possibly held by one person: an
   **Application Maintainer identity** (authenticated product operations
   viewer/controller with ONLY operational control-plane capabilities — a
   future capability-based preset, not implemented in E1) and a **Host
   Maintainer identity** (infrastructure execution on the deployment host —
   today's reality). E1 does not implement the application identity; it
   freezes the architecture so it can be materialized later (E2A) without
   granting Admin.
3. **The real gap is evidence, not authority.** P7-C shipped mechanisms with
   zero durable, in-product records: "last successful backup", "last verified
   backup", "current RPO posture", "last failure", and "restore drill status"
   are **not answerable inside the product today**. That is the P7-E2B
   vertical slice (§17), implementable without granting any new execution
   authority.

The program's three principles (least privilege, separation of duties,
authority follows responsibility) are **satisfied by the current boundary**
and the corrected target architecture — the deliverable of E1 is to freeze
the boundary and the architecture in an authority contract (§9), an ADR
(ADR-017), and an honest trust-boundary statement (§15), then gate E2 on
human review.

Findings: **P0: 0, P1: 0, P2: 3, P3: 4** (§16). None blocks the authority
contract. Recommended next slice: **GO P7-E2 (conditional on human review of
this document)** — authority-first sequencing: E2A Operational RBAC Boundary
→ E2B Backup Evidence Ledger → E2C Admin/Maintainer Views (§17).

---

## 2. Mission

P7-E is the **Operational Control Plane** of the platform. It is not "build a
Settings page", and not merely "audit configuration". It covers, as one
program:

```text
authority separation        Admin ≠ Maintainer — two distinct system roles
configuration ownership     who owns which configuration (P7-E0 taxonomy)
operational evidence        durable backup / restore-drill truth
operational policy          intent records (desired RPO etc.) — never infra binding
Admin / Maintainer views    business-owner summary vs detailed ops view
```

The phase shape (corrected — no duplicate E1 numbering, no "future E1
settings" naming conflict):

```text
P7-E0  configuration reality audit                 ✅ CLOSED (PR #276)
P7-E1  operational authority / role separation     🔵 THIS DOCUMENT —
       (Admin ≠ Maintainer, Hybrid Option C)         READY FOR HUMAN REVIEW
P7-E2  operational evidence + RBAC control-plane   ⬜ gated on E1 review
       foundation (E2A boundary → E2B evidence
       ledger → E2C views)
P7-E3  operational policy / UI closeout            ⬜ after E2
```

Relationship to prior work:

| Program | Verdict | Authority |
| --- | --- | --- |
| P7-C (backup mechanics) | CLOSED — mechanisms shipped, drills deterministic | `docs/deployment/backup-and-recovery.md`, `docs/audits/P7-C-PORTABLE-BACKUP-RECOVERY-CLOSEOUT.md` |
| P7-E0 (configuration reality audit) | CLOSED — **no generic settings subsystem justified** | `docs/audits/P7-E0-CONFIGURATION-REALITY-AUDIT.md` |
| P7-M (exam modes) | FUNCTIONALLY COMPLETE | `docs/audits/P7-M-CONFIGURABLE-EXAM-MODES-CLOSEOUT.md` |
| **P7-E1 (this audit)** | Authority model + boundary contract | this document + ADR-017 |

P7-E0's verdict stands and is inherited: no generic settings store, no
`system_settings` JSON blob, no feature-flag framework (§18). P7-E1 is the
authority dimension of the same program, distinct from E0's settings
question: E0 asked "which values may an Admin edit online"; P7-E asks
"which *authority* does the Admin role, the Application Maintainer role,
and the Host Maintainer each hold". The answers meet in the observation
surface (Admin reads the business-owner summary; the future Application
Maintainer reads detailed ops truth; neither edits deployment truth through
the product — the Host Maintainer edits it on the host).

---

## 3. Baseline and methodology

**Baseline SHA:** `e3eaaa4ce2116a756ad82aa8a209e249fe4466e1` (`origin/master`,
clean working tree, 2026-08-12).

**Method:** evidence-driven audit from current `master`. Three parallel passes:

1. **Permission model pass** — `packages/authz/src/catalog.ts`, `presets.ts`,
   `resolver.ts`, `systemActor.ts`, `legacyMap.ts`, `auditActions.ts`;
   `apps/api/src/plugins/auth.ts` + `authz.ts`;
   `apps/api/src/authz/assignmentAuthority.ts` + `routeRegistry.ts`;
   `docs/architecture/authorization.md`.
2. **Operational surface pass** — every route module in
   `apps/api/src/routes/registerApiRoutes.ts` (23 modules); the full
   `system.ts` diagnostics surface; settings, launchpad, email, audit,
   incidents.admin (Recovery Center), proctorAssignments.admin; web
   navigation (`AppSidebar.tsx`, `capabilities.ts`,
   `adminRouteCapabilities.ts`, `AdminLayout.tsx`).
3. **Infra-only surface pass** — `scripts/backup/*` (6 scripts),
   `docker-compose.yml`, `docker-entrypoint.sh`, `Dockerfile`,
   `docker/db/init/`, `apps/api/src/scripts/*` (operator CLI), `tests/deployment/*`
   (5 drills), `docs/deployment/*` (runbook + backup-and-recovery).

**Authority documents read:** `docs/SPEC.md` (§2.4, §3, §6), `AGENTS.md`,
`docs/roadmap/phase-roadmap.md`, `docs/roadmap/current.md`,
`docs/roadmap/P7-system-readiness-and-exam-modes.md`,
`docs/status/implementation-status.md`, ADR-001/006/010/011/013/014/015/016,
P7-C closeout, P7-E0 audit, `docs/architecture/authorization.md`.

---

## 4. Current reality — roles and permission model

### 4.1 Catalog

- **Permission catalog:** `packages/authz/src/catalog.ts` — closed dotted union
  `domain.resource.action` (lines 22–144), 11 domains. The only
  operational-observation permissions are in §4.9 (lines 116–129):
  `system.health.view`, `system.diagnostics.view`, `system.info.view`
  (**UNRESOLVED** — no route consumer; `GET /system/info` is public), plus
  three **System-actor-only** permissions (`system.auto_submit`,
  `system.heartbeat_scan`, `system.lifecycle_reconcile`) that are bound to
  synthetic actor identities and never reach the human assignment-authority
  path (`assignmentAuthority.ts:34–35`).
- **No backup, restore, infrastructure, secret, or execution permission
  exists anywhere in the catalog.** `grep` across `packages/authz`,
  `apps/api/src`, and `apps/web/src` for backup/restore/pitr/wal/secret
  capability keys returns zero matches.
- **Roles:** exactly six presets today (`catalog.ts:176–183`,
  `presets.ts:213–308`): Admin, Teacher, Proctor, Grader, Candidate, System
  (non-login, non-assignable). **No Maintainer role exists TODAY** —
  ADR-017 requires the Application Maintainer preset to be materialized in
  **P7-E2A** as a seventh built-in role (amending ADR-010's role preset
  set / closed union / seed contract; §9.3).

### 4.2 Admin preset (the "compatibility superset")

`ADMIN_PERMISSIONS` (`presets.ts:51–129`) bundles:

| Domain | Grants | Ops-relevant subset |
| --- | --- | --- |
| User / Organization | User.*, OrganizationView/Update, SettingsView/Update, AuditLogView | `settings.*` = org branding only |
| Candidate / Course / Question / Exam | full CRUD + lifecycle + publish + result publish | — (business) |
| Proctor runtime | ExamRoomView, AttemptStatus*, MisconductMark, TimeGrant, ForceSubmit, Export | — (business recovery) |
| Grading | Queue/Detail/Answer/ScoreWrite/Finalize/Identity | — (business) |
| Scores | ScoreAllView, ScoreExport | — (business) |
| **System / diagnostics** | **SystemHealthView, SystemDiagnosticsView** (`presets.ts:116–117`) | **operational observation** |
| Incident | Incident* + IncidentRecoveryView | Recovery Center read = business observation |
| Proctor assignments | ExamProctorAssignmentView/Manage | — (business) |

Admin's `sensitivePermissions` (`presets.ts:224–233`): UserRoleAssign,
AttemptForceSubmit, AttemptTimeGrant, AttemptMisconductMark, IncidentResolve,
GradingAnswerView, GradingScoreWrite, ScoreExport. All business-sensitive;
none is infra.

### 4.3 Enforcement mechanism

`preHandler: [fastify.authenticate, fastify.requireCapability(Perm.X)]` on
every gated route; `requireScopedCapability` for attempt/exam/incident
resource scope (`plugins/authz.ts:86`). `users.role` / JWT role are
**non-authoritative** projections (`auth.ts:117–119`; zero `requireRole`
consumers — Gate 0.5). Route→permission→scope registry is declarative
metadata (`authz/routeRegistry.ts`, non-enforcing, conformance-tested).

---

## 5. Current reality — operational endpoints inventory

| Path | File:line | Guard | Class |
| --- | --- | --- | --- |
| `GET /system/info` | `routes/system.ts:245` | **public** | version/uptime |
| `GET /system/public-config` | `system.ts:266` | **public** | non-sensitive deployment config (mode, apiReference) |
| `GET /system/health` | `system.ts:284` | authenticate + `SystemHealthView` | **Admin observation** (CPU/mem/DB latency) |
| `GET /system/dashboard` | `system.ts:311` | authenticate + `SystemHealthView` | **Admin observation** (business stats) |
| `GET /system/diagnostics` | `system.ts:344` | authenticate + `SystemDiagnosticsView` | **Admin observation** (DB latency, Redis runtime snapshot, heartbeat/deadline scanner status, email worker + outbox backlog, read-only integrity anomalies) |
| `POST /email/test` | `routes/email.ts:33` | authenticate + `SystemDiagnosticsView` | **Admin observation-action** (sends one test email; sanitized errors; no open relay) |
| `GET/PATCH /admin/settings[/branding]` | `routes/settings.ts:117/146/175` | `SettingsView` / `SettingsUpdate` | Admin business (org branding; audited `branding.update`) |
| `GET /admin/audit-logs`, `/admin/import-logs` | `audit.ts:50`, `importLogs.ts` | `AuditLogView` | Admin business observation |
| `GET /admin/recovery/*` | `incidents.admin.ts:1297+` | `IncidentRecoveryView` | Admin business observation (Recovery Center read) |
| `GET /launchpad/status`, `POST /launchpad/bootstrap` | `routes/launchpad.ts:81/104` | **public** + setup token | first-install bootstrap only |

**Every operational surface in the product is (a) read-only or single-test
email, (b) Admin-gated, and (c) free of secrets, host paths, and execution
controls.** Diagnostics is explicitly "detect, never repair"
(`system.ts:405`). There are **no** `POST /system/*` routes, **no**
backup/restore/PITR routes, **no** settings routes beyond org branding.

---

## 6. Current reality — infra-only actions (no product surface)

### 6.1 Backup / restore / PITR (P7-C, host CLI only)

| Script | Action | Host authority needed | Product entry |
| --- | --- | --- | --- |
| `scripts/backup/postgres-logical-backup.sh` | online `pg_dump -Fc` | docker CLI; PGPASSWORD from container env, never argv | **none** |
| `scripts/backup/postgres-logical-restore.sh` | clean `pg_restore` (DROP + template0) | docker CLI; header: "Restore is OPERATOR-ONLY. There is no browser restore button and there never will be" | **none** |
| `scripts/backup/pg-basebackup.sh` | online `pg_basebackup -X stream` + `pg_verifybackup` | docker CLI | **none** |
| `scripts/backup/postgres-enable-pitr.sh` | `ALTER SYSTEM` archive_* + archiver proof | docker CLI; restarts db | **none** |
| `scripts/backup/cold-filesystem-backup.sh` / `-restore.sh` | stopped PGDATA copy / restore | docker CLI; refuses live source / populated dest | **none** |

Verified: **zero** HTTP routes match backup|restore|pitr|wal|pg_* across all
23 route modules (`registerApiRoutes.ts`).

### 6.2 Operator CLI (`apps/api/src/scripts/`)

`bootstrap-admin.ts` (first Admin; shared mutation body with HTTP Launchpad),
`reset-admin-password.ts` (Admin-only password reset; audit
`admin.password_reset.local`), `migrate.ts`, `rollback-incident-tables.ts`,
`rollback-attempt-command-receipts.ts` (destructive, `--confirm` + DB-name
safety), `backfill-submitted-answers.ts`, seeds (dev/test only). All run via
`docker compose exec app node dist/scripts/*.js` — host operator authority.

### 6.3 Deployment topology

`docker-compose.yml` (ONE-COMPOSE model): host bind mounts
`${EXAM_DATA_ROOT}/postgres`, `${EXAM_WAL_ARCHIVE_HOST_PATH}`,
`${EXAM_DATA_ROOT}/redis`; secrets `POSTGRES_PASSWORD`, `JWT_SECRET`,
`REDIS_PASSWORD`, `SMTP_PASSWORD`, `LAUNCHPAD_SETUP_TOKEN` (Compose `:?`
required expansion; repo-contract guard). `docker-entrypoint.sh` runs
migrations + optional seed. All Class-A items are operator-owned (P7-E0 §5).

### 6.4 Drills

`tests/deployment/`: `compose-smoke.sh`, `launchpad-bootstrap.sh`,
`persistence-and-cold-restore.sh`, `logical-backup-restore.sh`, `pitr.sh` —
deterministic Docker drills; all operator/host executed; results exist only in
CI/terminal output today (no durable in-product record — §11/§17).

---

## 7. Current reality — secrets and topology boundary

P7-E0 §5/§13 remains the authority. Summary of the verified boundary:

- All secrets (`DATABASE_URL`, `POSTGRES_PASSWORD`, `JWT_SECRET`,
  `REDIS_PASSWORD`/`REDIS_URL`, `SMTP_PASSWORD`, `LAUNCHPAD_SETUP_TOKEN`,
  TLS/fs credentials if any) live in env/Compose/secret store. **None is
  stored in PostgreSQL, none is returned by any route, none is logged.**
  SMTP errors are scrubbed by `sanitizeEmailError`.
- The runtime config loader is single + memoized (`getRuntimeConfig()`);
  `buildPublicConfig()` exposes only `deploymentMode` + `apiReference` —
  never secrets, rate-limit internals, or `FEATURE_*`.
- Redis holds only ephemeral rate-limit counters (TTL-bounded,
  non-authoritative; P7-D1 boundary).
- The Admin UI shows only status-derived adjectives (configured / not
  configured / reachable / unreachable / healthy / degraded) for infra
  components, never values.

---

## 8. Does "Admin = system operator" hold today?

**No.** The audit found no functional conflation. The program's warning cases
checked:

| Conflation risk | Reality |
| --- | --- |
| Admin gets machine/DB/secret authority by holding the Admin role | **Not possible** — no capability, route, or UI reaches host/DB/secret level. |
| Admin can stop backups / modify WAL destination / delete backup files | **No surface exists** — backup scripts are host-only; no route, no `backup_*` table, no scheduler. |
| Admin can execute restore / PITR | **No** — restore is operator-owned, permanently (`postgres-logical-restore.sh` header; ADR-016 boundary; P7-E0 §23 anti-goal). |
| Admin can read SMTP password / DB password / JWT secret plaintext | **No** — secrets are env/Compose-only; no settings store, no display route. |
| Admin can restart services / modify DB endpoint / change Redis topology | **No** — Compose/env are operator-owned; `REDIS_MODE` is boot-validated env. |
| Admin can read Candidate answers mid-exam or tamper with grading evidence | **No** — submit freeze (ADR-008), snapshot discipline, audit ledger; business authority is Admin's *correct* domain, not a conflation. |
| Diagnostics leaks sensitive infra detail | **No** — diagnostics is read-only, Admin-gated, secret-free, and its infra block (latency/state) is observation, which the matrix grants Admin. |

The remaining nuance is **naming and grouping**, not authority: the Admin
"Management" nav group mixes org-business pages (users, candidates, settings)
with the infra-observation page (System diagnostics) under one admin console
(§16, P3-3). That is a UX presentation issue for E3, not an authority defect.

---

## 9. Authority decision (the contract)

### 9.1 Who is Admin?

**Admin is the Exam Product / Organization Business Owner** — the person the
organization designates to run the exam business on the deployment:

- Business authority: users/roles, candidates, courses, questions, exams,
  profiles, publication, grading, scores, exports, Recovery Center business
  decisions (time grant, force submit, misconduct, incident resolve),
  organization branding.
- Operational visibility (limited, read-only): the **business-owner
  summary** — system healthy?, backup healthy?, RPO satisfied?, last
  verified backup?, critical warning? (today realized as
  health/dashboard/diagnostics read + email test + audit log).
- **Admin MAY observe system health. Admin DOES NOT thereby become System
  Maintainer.**
- **Not:** PostgreSQL DBA, Docker/host operator, filesystem owner, secret
  owner, SMTP credential owner, Redis operator, PITR/destructive-restore
  operator, and — per the corrected architecture — not the operational
  control-plane operator either (that is the Application Maintainer's
  plane, §9.2). Admin's long-term ops read is the summary; the detailed
  diagnostics read belongs to the Maintainer role.

### 9.2 Who is Maintainer?

**Maintainer is the System Operations / Maintenance Owner.** The authority
decision is the **Hybrid Maintainer Model (Option C)**: one role concept,
two separate trust planes that may be held by the same person but are
architecturally distinct.

#### Plane 1 — Application Maintainer identity (product role concept, NOT implemented in E1)

An authenticated product identity that owns the **operational control-plane
authority**:

```text
system.health.view            system.backup.view
system.diagnostics.view       system.restore_readiness.view
system.ops.policy.view        (naming per repo convention; each
                               individually decision-gated)
```

- ONLY operational observation/control-plane capabilities; **zero business
  authority** (no `user.*`, `candidate.*`, `course.*`, `question.*`,
  `exam.*`, `grading.*`, `score.*`, no incident business mutation, no
  force-submit / time grant / misconduct, no result publish).
- NO destructive infrastructure execution authority (that is Plane 2).
- **E1 does not implement this identity.** The architecture explicitly
  recognizes it as the future operational role/preset: when E2/E3
  operational surfaces require it, it is provisioned through the existing
  capability-based RBAC (`user_role_assignments` + preset) or a separately
  reviewed operator onboarding path — **never by granting Admin**.
- Long-term read split: Maintainer sees detailed operational diagnostics
  (DB latency, Redis state, scanner/worker state, WAL status, backup
  history, storage pressure, technical failure detail); Admin sees the
  business-owner summary (§9.1). E1 does not build the split but the
  contract requires it (§13, ADR-017 D8).

#### Plane 2 — Host Maintainer identity (today's reality, unchanged)

An unauthenticated-in-product host identity that owns the **infrastructure
execution authority**:

```text
Docker / Compose        backup destination     restore
PostgreSQL              secret store           PITR
WAL archive             service lifecycle      PGDATA
filesystem              migration/rollback/backfill
```

These are **not product RBAC authority**. They are exercised on the host via
`scripts/backup/*`, operator CLI scripts, and Compose (§6). A Host Maintainer
automatically holds **no** application-authorized business action.

**Application Maintainer ≠ Host root.** One person may hold both planes, but
the architecture separates them: the application identity is an authenticated
product viewer/controller; the host identity is infrastructure execution.

### 9.3 Identity model — decision: Option C (Hybrid Maintainer Model)

Three options were compared:

| Option | Shape | Verdict |
| --- | --- | --- |
| **A** — Maintainer as a full product DB role, implemented now | seeded role + assignment + login + UI | **Rejected for E1**: do not implement the role before the authority contract is accepted — an implemented role with no surface would invite destructive UI before any surface exists, the exact coupling the program forbids. **E2A materializes only the application-side Maintainer preset defined by Hybrid Option C** (a capability bundle amending ADR-010's role set, not a full product role with UI). |
| **B** — Maintainer as pure host/operator identity, no product identity (previous PR #281 head) | host/CLI only | **Rejected (corrected in this revision).** It fails the program's core goal: Admin and Maintainer must be **two distinct system roles**. Under B the product had no application-side identity for a separate operations person, so "observation via product" would stay Admin-only forever, and any future ops viewer would require granting Admin. |
| **C** — Hybrid: application operational identity + host execution identity | product capability preset (future) + host/CLI (today) | **SELECTED.** Preserves least privilege (nothing implemented before a surface exists), satisfies the two-distinct-roles goal, and keeps the hard execution boundary (D4/ADR-017). The application-side preset is a **required** role (ADR-017 amends ADR-010), materialized in E2A. |

**Consequences of the decision:**

1. **No schema change, no role seed, no login path in E1** (before the E2A
   RBAC boundary is accepted and materialized). The separation today is
   enforced by surface absence + runbook discipline; the Maintainer
   *concept* — and its ADR-010 role-preset amendment — is frozen in
   ADR-017 so it cannot be back-filled as an Admin clone later.
2. **E2 starts with the RBAC boundary, not with more Admin-only surfaces.**
   E2A defines the Maintainer observation capability bundle and splits
   action-under-view capabilities before any new ops view ships (§17).
3. **Launchpad stays first-Admin-only** (§14) — the first Admin is a
   business bootstrap; a product-side Maintainer account, when required, is
   provisioned through the ordinary authenticated user/role-assignment path
   and must not inherit Admin capabilities.
4. **Honest trust boundary** (§15): a host operator with root/docker access
   can technically read PGDATA (including candidate answers and exam
   content). Software RBAC cannot prevent root from reading disks. The
   separation guarantees that host authority does not translate into
   *application-authorized business action through the product* — the
   deployment must still choose whom to trust with host access. This is
   documented, not hidden.

### 9.4 What can each observe / mutate — authority matrix

| # | Capability | Admin | Application Maintainer (future preset) | Host Maintainer | Where executed |
| --- | --- | --- | --- | --- | --- |
| 1 | View business-owner summary (healthy? backup ok? RPO satisfied? critical warning?) | **read** | read | read | product (E2C summary view) |
| 2 | View detailed ops diagnostics (DB latency, Redis/scanner/worker state, WAL status, backup history, storage pressure, failure detail) | **read — summary today; detailed read retained through E2A/E2C (migration contract §17.2), optional/read-only afterwards** | **read** | read | product (`/system/diagnostics` split per §13/D8) / host |
| 3 | View backup status, last success, last verified | **read** | **read** | read | product read view (E2B) / host scripts |
| 4 | View restore-readiness / drill evidence | **read** | **read** | read | product read view (E2B) / drill output |
| 5 | View operational policy (desired RPO/retention) | **read** | **read** | read | product (E3, typed policy records) / runbook |
| 6 | Set *desired* RPO / retention / drill cadence (intent — `system.ops.policy.manage`) | **write (intent only; sole owner)** | **no** (execution-side only: `backup.schedule.manage`, `backup.retention.manage` — decision-gated) | — | product (E3) — NEVER binds infra |
| 7 | Business authority (users, exams, profiles, grading, publication, recovery decisions, org settings) | **write** | **no** | **no** | product |
| 8 | View audit log | **read** | no (host logs) | no (host logs) | product |
| 9 | Backup *trigger* (typed, non-destructive) | **no** | **decision-gated** (D5/D6, not implemented) | **write** | host cron / CLI today |
| 10 | Backup schedule / retention / destination management | **no** | **decision-gated** (D5, not implemented) | **write** | host today |
| 11 | WAL archiving enablement / archive_command | **no** | **no** | **write** | `postgres-enable-pitr.sh` |
| 12 | Restore / PITR / destructive operations | **no** | **no** | **write** | host CLI (`*-restore.sh`, recovery procedure) — forever |
| 13 | Retention / pruning of backups + WAL | **no** | **decision-gated** (D5; fail-closed invariant) | **write** (manual today) | host |
| 14 | `POSTGRES_PASSWORD`, `JWT_SECRET`, `REDIS_*`, `SMTP_PASSWORD`, TLS keys, fs credentials | **no** | **no** | **write** | env/Compose/secret store |
| 15 | Service restart (API/db/worker/redis) | **no** | **decision-gated** (D5, not implemented) | **write** | host `docker compose` |
| 16 | DB endpoint / Redis URL / topology | **no** | **no** | **write** | env/Compose |
| 17 | Migration / rollback / backfill scripts | **no** | **no** | **write** | host CLI |
| 18 | View secret plaintext through product UI | **no** | **no** | **preferably never through product UI** | — |
| 19 | Exam content / Candidate identity / grades through product | **write (business)** | **no** | **no** | product |
| 20 | `POST /email/test` (side-effecting) | **read today via view capability (invariant violation, D7 — to be split in E2A)** | **no (until split into its own capability)** | n/a | product |

### 9.5 Which actions remain CLI/host-only (permanent)

Everything in §6.1–§6.2 (backup, restore, PITR, WAL enable, cold copy,
migrate, rollback, backfill, reset-admin-password, bootstrap CLI), plus
Compose lifecycle, secret management, and host log access. Restore/PITR and
raw secret/host authority are **permanently** host-only (ADR-017 D4). A
narrow class of *non-destructive* operational actions (backup trigger,
schedule/retention manage, service restart, ops policy manage) is
**decision-gated** — NOT implemented, host-owned today, and admitted to the
product control plane only under the D5 conditions (typed contract, least
privilege, audit, idempotency, failure semantics, non-secret abstraction).

### 9.6 Where do secrets live?

env + Compose + host secret store (P7-E0 §5/§13). Never PostgreSQL, never
product UI, never audit logs, never export/backup payloads (the P7-C dump
contains role definitions, not plaintext passwords). UI shows status
adjectives only.

### 9.7 Final authority model

```text
                         Exam Platform
                              │
                ┌─────────────┴─────────────┐
                │                           │
              Admin                     Maintainer
      Business / Org Owner          System Operations Owner
                │                           │
       users / exams /             health / diagnostics
       profiles / grading          backup evidence
       publication /               restore readiness
       recovery decisions          operational policy
                │                           │
                │                           │
         NO HOST AUTHORITY          Product control plane
                                            │
                                            │
                                  ┌─────────┴─────────┐
                                  │                   │
                         safe typed actions       host authority
                         decision-gated           Docker / PG
                                                  WAL / secrets
                                                  restore / PITR
```

---

## 10. Full permission matrix (Admin / Maintainer)

Current catalog (`catalog.ts`) — "Admin" = Admin preset grants
(`presets.ts:51–129`); "Application Maintainer" = the recognized-but-
**not-implemented** operational role concept (Hybrid Option C, §9.3),
recorded here as the future preset's capability contract; "Host Maintainer"
= infra execution (not RBAC authority).

| Permission key | Admin preset | Application Maintainer (future preset) | Host Maintainer | Notes |
| --- | --- | --- | --- | --- |
| `user.*` (view/create/update/delete/role.assign/password.reset) | ✅ | no | — (host only) | business |
| `organization.view` / `organization.update` | ✅ / ✅ (no route) | no | — | `organization.update` has no route (P3-2) |
| `settings.view` / `settings.update` | ✅ / ✅ | no | — | org branding only |
| `audit_log.view` | ✅ | no | — (host logs) | |
| `candidate.*`, `candidate_field.*` | ✅ | no | — | business |
| `course.*`, `question.*` | ✅ | no | — | business |
| `exam.*` (lifecycle, publish, result.publish, enrollment.manage) | ✅ | no | — | business |
| `exam.take`, `attempt.*` (own runtime) | Candidate-only | no | — | business |
| `exam_room.view`, `attempt.status.view`, `attempt.timeline.view` | ✅ | no | — | business observation |
| `attempt.misconduct.mark` / `attempt.time.grant` / `attempt.force_submit` / `attempt.export` | ✅ | no | — | business recovery (Admin-only per ADR-014/015) |
| `grading.*` (queue/detail/answer/score.write/finalize/identity) | ✅ | no | — | business |
| `score.all.view` / `score.export` | ✅ | no | — | business |
| **`system.health.view`** | ✅ | ✅ (proposed preset) | n/a (host) | observation — Admin keeps the summary read |
| **`system.diagnostics.view`** | ✅ (re-scoped to summary in E2A) | ✅ (proposed preset — detailed ops) | n/a (host) | observation; domain split per D8/P2-2 |
| `system.info.view` | (UNRESOLVED, no consumer) | — | n/a | P3-1 |
| `system.auto_submit` / `system.heartbeat_scan` / `system.lifecycle_reconcile` | System actor only | no | — | non-login, non-assignable |
| `incident.*` (view/create/investigate/resolve) | ✅ | no | — | resolve/dismiss Admin-only |
| `incident.recovery.view` | ✅ | no | — | Recovery Center read |
| `exam.proctor_assignment.view` / `.manage` | ✅ | no | — | Admin-only |
| **future: `system.backup.view` (E2B)** | ✅ (proposed) | ✅ (proposed) | read (host) | observation, read-only |
| **future: `system.restore_readiness.view` (E2B)** | ✅ (proposed) | ✅ (proposed) | read (host) | drill evidence, read-only |
| **future: `system.ops.policy.view` (E3)** | ✅ (proposed) | ✅ (proposed) | read (host) | observation (policy records are E3) |
| **future: `system.ops.policy.manage` (E3)** | Admin (intent only — sole owner) | **no** (execution-side only) | — | intent records, never binds infra; NOT a Maintainer capability |
| **decision-gated: `backup.trigger` / `backup.schedule.manage` / `backup.retention.manage` / `service.restart`** | ❌ (not Admin) | 🔒 decision-gated — NOT IMPLEMENTED, host-owned today, admitted only under ADR-017 D5 conditions | **write (host/CLI today)** | §13.4, ADR-017 D5 (`operational.policy.manage` deliberately absent — single intent owner is Admin, D9) |
| **permanently forbidden through product UI: `restore.execute`, `pitr.execute`, `pgdata.delete`, `database.destructive_recovery`, `secret.read_plaintext`, `secret.export`, `host.filesystem.raw_manage`, `db.endpoint.raw_manage`, `redis.credentials.read`** | ❌ | ❌ | host/CLI only | §13.5, ADR-017 D4 |

**Invariants:**

- Role presets are capability bundles. The future Maintainer preset contains
  **only** operational capabilities and zero business capabilities; the
  Admin preset keeps business + limited operational visibility; no preset
  ever contains a permanently-forbidden execution capability (§13.5).
- **VIEW CAPABILITY MUST NOT AUTHORIZE SIDE EFFECT** — `system.diagnostics.view`
  ≠ `email.test.execute`; the current `POST /email/test` gate is a known
  invariant violation and an E2A precondition (ADR-017 D7, §16 P2-1).
- Decision-gated capabilities are **not** Admin capabilities; they belong to
  the Maintainer control plane and each requires its own recorded decision.

---

## 11. Backup authority model — Admin intent / Maintainer execution / System evidence

```text
Admin intent                 Maintainer execution             System evidence
────────────────────────     ───────────────────────          ─────────────────────────
"at least one verified       cron-on-host schedule           durable backup_run records
 backup per day"             backup destination              (status, artifact, checksum,
                             WAL archive (enable-pitr.sh)    verification result, actor)
desired RPO / retention      retention/pruning (manual)      restore-drill records
drill cadence                restore / PITR (host CLI)       failure evidence
                             storage path / capacity
```

| Authority | Owns | Currently implemented? | E2 status |
| --- | --- | --- | --- |
| **Admin intent** | desired RPO, retention window, drill cadence — recorded as a **typed operational policy record** (domain-owned, audited, non-binding) | ❌ nothing exists | E3 (intent records + editable policy UI; §17) |
| **Maintainer execution** | schedule (cron-on-host), destination, WAL archive, retention, restore, PITR, restart — Host Maintainer plane | ✅ P7-C scripts + runbook | **unchanged — never moves into product** (only the non-destructive decision-gated subset could, under ADR-017 D5) |
| **System evidence** | durable, append-only records of runs + verification + failures + drills, from which Admin (summary) and Maintainer (detail) read truth | ❌ nothing exists | **E2B — the evidence ledger (§17)** |

**Truthfulness rules (inherited from P7-C and P7-E0):**

1. A backup is **SUCCESS** only when the artifact exists, is readable, and
   passed verification (§12.4). No evidence record may claim otherwise.
2. Admin policy is **intent, not capability**. When Admin selects
   `RPO target = 1 hour` but the infrastructure only delivers 24h, the product
   must render:
   ```text
   DESIRED RPO:       1 hour
   CURRENT CAPABILITY: 24 hours
   STATUS:            NOT SATISFIED
   ```
   A DB setting must never magically rewrite infrastructure.
3. Restore readiness display = evidence (last restore drill, backup
   inventory, operator runbook reference). **Restore itself stays
   Host Maintainer + CLI/runbook + host access** (hard boundary, §8/§9.5).
4. **Admin sets objectives; Maintainer decides implementation** (core P7-E
   principle, ADR-017 D9). Admin holds `system.ops.policy.manage` (desired
   objectives — intent only, sole owner); Maintainer holds execution-side
   policy (`backup.schedule.manage`, `backup.retention.manage`,
   decision-gated). `operational.policy.manage` is deliberately NOT a
   capability:

   ```text
   Admin:      what the system must achieve   (intent)
   Maintainer: how operations achieve it      (execution/control-plane)
   System:     whether reality satisfies it   (evidence/status)
   ```

---

## 12. Backup run execution model — candidate, NON-BINDING

Derived from the **actual P7-C execution semantics** (scripts + drills), not
adopted from the prompt's example list. **E1 freezes only the invariants**
(§12.5); everything in §12.1–§12.4 is a **candidate execution model** —
lease expiry, reconciler sweep, active-restore target record, operationId
format are **E2 adversarial-design space**, not commitments of this audit.

### 12.1 Candidate state machine (non-binding)

```text
        ┌─────────────────────────────────────────────────────────┐
        ▼                                                         │
scheduled ──► running ──► verifying ──► succeeded (terminal)      │
   │          │             │              │                      │
   │          │             │              └─► pruned (terminal, record-only)
   │          ▼             ▼
   └─► failed (terminal)  abandoned (terminal, lease-expired / no completion record)
```

| State | Meaning | Entered when | Exit when |
| --- | --- | --- | --- |
| `scheduled` | intent recorded (host cron fires; optional for manual runs) | run record created with `operationId` | execution starts (or lease expires → `abandoned`) |
| `running` | script executing (dump/basebackup/cold copy in progress) | script start (with lease) | artifact produced → `verifying`; error → `failed`; lease expiry → `abandoned` |
| `verifying` | artifact exists, verification in progress (`pg_verifybackup`, `pg_restore --list`, size+magic) | artifact completed | verification passed → `succeeded`; failed → `failed`; crash → lease expiry → `abandoned` |
| `succeeded` | **the only success state** (§12.8) | verification record committed atomically | retention prune → `pruned` (record-only) |
| `failed` | deterministic error (dump failed, verify rejected, restore refused) | script/verification error | none (terminal; evidence retains error kind) |
| `abandoned` | process died mid-run, or no completion record within lease | reconciler sweep (next run or scheduled reconciler) | none (terminal) |
| `pruned` | artifact deliberately removed by retention/prune | prune action recorded | none (record-only; keeps history truthful) |

Cold-filesystem runs have a wrinkle: PostgreSQL is **stopped** during the
copy, so no DB write is possible mid-run. The state machine handles it by
two records: `scheduled`/`running` intent written **before** the stop (or
sidecar file), and the completion record written **after** the restart.
A restart without a completion record → the run is `abandoned`/`failed` and
the operator is told to re-verify (§12.9).

### 12.2 Crash questions — candidate mechanisms

| Question | Candidate mechanism |
| --- | --- |
| Process dies while `running`? | Lease on the `running` record expires; the next run (or reconciler) marks it `abandoned`. The partial artifact is **never** promoted to success. |
| Same schedule triggered twice? | Host-side single-winner: `operationId` (per schedule-slot + timestamp) has a uniqueness constraint in the evidence store; the second trigger either observes the in-flight record and waits, or is rejected as duplicate (`409`-style no-op), never double-runs. |
| Backup bytes written but crash before verify? | State stays `running`→ lease expiry → `abandoned`; artifact without a verification record is **not** SUCCESS. Operator re-runs; the new run has a fresh `operationId`. |
| Verify succeeded but crash before evidence commit? | Evidence commit is **atomic** (single INSERT of the `succeeded` record carrying artifact fingerprint + verification result). Crash before commit ⇒ no record ⇒ run appears `running`/absent ⇒ reconciler marks `abandoned`; a re-run with the same `operationId` commits cleanly (idempotency). |
| Retention conflicts with a backup being restored? | **Fail closed**: pruning refuses any artifact referenced by an active restore target / evidence chain. Prune never races a restore. |
| Old backup deletion fails? | `prune_failed` evidence record + system warning. Retention drift becomes visible in the Admin read view; never silently ignored. |
| Can we say `SUCCESS`? | Only when ALL hold: artifact exists ∧ readable ∧ verification passed ∧ `succeeded` evidence committed ∧ (for PITR) the retained chain invariant holds (base backup precedes the earliest required WAL) — invariant §12.4. |

### 12.3 Idempotency

`operationId` = deterministic identity per logical run (e.g.
`<kind>:<schedule-slot>:<wallclock-slot>`). Re-execution of the same
operationId is a no-op or a resume, never a duplicate. Mirrors the
`operationId`-keyed idempotency already used for operator time grants
(REC-I4-I3B1) and command receipts (attempt_command_receipts).

> The exact derivation format is E2 design space; the **invariant** is
> "a duplicate logical run must not produce contradictory evidence".

### 12.4 SUCCESS definition (the invariant)

> **A backup is SUCCESS only when it is readable and verified, and the
> `succeeded` evidence record — carrying the artifact fingerprint and the
> verification result — is durably committed.**

This matches P7-C's acceptance signal ("a backup is not marked successful
until it is readable and validated") and P7-E0 §24's fail-closed prune rule.

### 12.5 What E1 freezes vs what it leaves open

**Frozen invariants (binding):**

```text
1. a backup must not become SUCCESS before verification
2. a duplicate logical run must not produce contradictory evidence
3. a crash before verified evidence must not claim success
4. pruning must fail closed when safety cannot be proven
```

**Left open for E2 adversarial design (NOT commitments of this audit):**

```text
lease-based abandoned transition        specific reconciler sweep
active_restore_target DB record         exact operationId derivation format
retention/prune conflict resolution     crash-after-verify recovery mechanics
```

**Open design question for E2 (explicitly unresolved in E1):** restore is
host-only — so product-side retention logic that "checks the active restore
target" requires a **cross-authority protocol** between the host-side
restore action and the product's evidence/retention records. E1 does not
assume this protocol exists; E2 must design it before any product-side
retention enforcement.

---

## 13. Capability family proposal (design direction — not implemented in E1)

### 13.1 Rule

No new capability is created in E1 because no new surface exists. Capabilities
are added **only** when the E2 slice introduces the surface they gate, and
they follow the existing dotted `domain.resource.action` convention (multi-
word resources use `_`, e.g. `restore_readiness`, matching `force_submit`).

### 13.2 Observation family (E2B/E2C candidates, read-only)

```text
system.backup.view             # backup inventory/status, last success, last verified
system.restore_readiness.view  # restore-readiness + drill evidence
system.ops.policy.view         # effective operational policy (desired RPO/retention)
```

Granted to the **Admin preset** (business-owner summary per §9.4) **and** the
future **Application Maintainer preset** (detailed ops truth per §9.2).
Read-only by construction: no write sibling is proposed for execution.

### 13.3 Intent family (E3 candidate, write but non-binding — Admin only)

```text
system.ops.policy.manage    # records desired RPO / retention / drill cadence
```

Writes **intent records only** — typed, audited, never bound to infra
execution, never capable of changing a schedule or destination. The
DESIRED-vs-CAPABILITY rendering (§11) is its only consumer. **Admin is the
sole owner** — this is the single intent capability for operational policy
(ADR-017 D9). Maintainer's policy authority is execution-side only
(`backup.schedule.manage`, `backup.retention.manage`, decision-gated
§13.4); `operational.policy.manage` is deliberately NOT a capability.

### 13.4 Decision-gated operational capabilities (NOT implemented, host-owned
today, future decision-gated)

```text
backup.trigger             backup.schedule.manage
backup.retention.manage    service.restart
```

These are **not** Admin capabilities and **not** permanently forbidden. They
are:

```text
NOT IMPLEMENTED
HOST-OWNED TODAY
FUTURE DECISION-GATED
```

Each may enter the product control plane only when all of the following hold
for that specific capability: **typed contract, least privilege, audit,
idempotency, explicit failure semantics, non-secret abstraction** (ADR-017
D5). Each admission needs its own recorded decision (P7-D1-style gate). This
audit neither promises nor forbids them.

`operational.policy.manage` is **deliberately absent**: operational-policy
intent has exactly ONE owner (Admin, §13.3); Maintainer's policy authority
is execution-side (`backup.schedule.manage`, `backup.retention.manage`) —
decision-gated here, not intent.

### 13.5 Permanently forbidden through normal product UI

```text
restore.execute / pitr.execute / pgdata.delete / database.destructive_recovery
secret.read_plaintext / secret.export / host.filesystem.raw_manage
db.endpoint.raw_manage / redis.credentials.read
```

Architecturally excluded (ADR-017 D4), not deferred:

> **Destructive history replacement / raw secret / raw host authority never
> enters the ordinary browser control plane.**

Infrastructure execution is performed by the Host Maintainer on the host; the
product has no permission that can represent it.

### 13.6 View capability must not authorize side effect (invariant)

```text
VIEW CAPABILITY MUST NOT AUTHORIZE SIDE EFFECT

system.diagnostics.view  ≠  email.test.execute
```

`POST /email/test` is currently gated by `system.diagnostics.view`
(`routes/email.ts:33`) although it is a side-effecting action. This violates
the invariant and is a **precondition for the Maintainer RBAC rollout
(E2A)**: before any operational view is granted to a non-Admin principal, the
action must be split into an independent capability (e.g. `system.email.test`,
per repo convention) with its own gate and audit. Not fixed in E1
(docs-only). See §16 P2-1.

### 13.7 Backup trigger abstraction (if ever built)

Backup ≠ Restore. A future product-side **backup trigger** is acceptable in
principle (decision-gated, §13.4) if and only if the product surface invokes a
**predefined, typed, non-destructive, audited, idempotent backup command** —
never raw paths, raw `pg_dump` arguments, shell, the DB password, or
filesystem credentials. Restore/PITR are outside this abstraction and stay
host-only. Nothing implemented in E1.

### 13.8 Role = capability bundle

The future **Application Maintainer preset** (E2A) holds the observation
family (§13.2) and **nothing else** — no `user.*`, no `candidate.*`, no
`course.*`, no `question.*`, no `exam.*`, no `grading.*`, no `score.*`, no
incident business mutation, no force-submit/time-grant/misconduct, no result
publish, no permanently-forbidden capability (§13.5). This is a preset data
change plus existing assignment machinery (`user_role_assignments`), or a
separately reviewed operator onboarding path; it is explicitly NOT part of
E1 scope.

---

## 14. Launchpad / bootstrap

| Question | Answer |
| --- | --- |
| Who is the deployment owner at first install? | The **host operator** who runs `docker compose` / `bootstrap-admin` / Launchpad. Deployment ownership is initially established **externally through host access**, not through a product record. |
| Is it necessary to create a Maintainer in the DB? | **No, not in E1.** The Maintainer application identity is a recognized role concept, not an implemented one (§9.2); no surface needs it yet. |
| Should Maintainer come from CLI/bootstrap? | No new bootstrap path. When E2/E3 operational surfaces require a product-side Maintainer account/preset, it must be provisioned through the **ordinary authenticated user/role-assignment path** or a separately reviewed operator onboarding path — it must **NOT inherit Admin capabilities**. |
| If Maintainer is only a host operator today, is no DB identity needed? | Correct — no DB identity is needed in E1. The Host Maintainer plane is host access, documented in the runbook. |
| How does a web ops surface authenticate, at minimum cost? | Today: the ops surface is Admin-gated observation; no new auth needed. When the Maintainer observation surface ships (E2A), reuse the existing user/role-assignment machinery with the observation-only preset (§13.8) — no new auth mechanism. |

Launchpad keeps bootstrapping the **first business Admin** only. There is no
"first Maintainer" bootstrap in this PR: introducing a bootstrap path for an
identity that no surface consumes yet would be over-engineering with
security-adjacent surface (a new login path) for zero capability. The ADR
records the provisioning rule for when that changes (ADR-017 D2).

---

## 15. Threat model

### 15.1 Compromised Admin (business account takeover)

The attacker holds the Admin product identity. Through the product they
**cannot**:

- obtain `DATABASE_URL` / `POSTGRES_PASSWORD` / `JWT_SECRET` /
  `REDIS_PASSWORD` / `SMTP_PASSWORD` (no secret surface; §7);
- stop, reschedule, or re-point backups (no backup surface; §6.1);
- modify WAL archive destination or archive_command (host-only script);
- execute restore or PITR (operator-only, permanent);
- read SMTP password or any credential plaintext (scrubbed, §7);
- modify DB endpoint / Redis topology / restart services (Compose/env-only);
- delete backup files or WAL segments (host filesystem);
- act through a Maintainer identity (none exists to take over; the future
  application Maintainer is a separate role that Admin must not inherit).

They **can** (as the business owner): publish results, change grades
(business authority), mark misconduct, force-submit, time-grant, read
candidate data, and observe the business-owner ops summary. Those are the
Admin role's intended authority — the blast radius is business damage, which
is precisely why Admin credentials are the deployment's most sensitive
product secret and why **Admin must not also hold host access** (the one
coupling that would defeat the separation: an Admin with host credentials
becomes a Host Maintainer by possession, not by role).

**Mitigations that exist:** HTTP-only cookie + JWT, argon2 hashing, rate
limits, audit ledger for mutations, fail-closed authorization, no
organization-scoped cross-tenant path. **Gap (accepted, E2A):** operational
observation reads (`system.*` GETs, `POST /email/test`) are not audited —
an attacker's diagnostics *reads* leave no audit trail, and the email-test
side effect rides a view capability (P2-1/P2-3).

### 15.2 Compromised Application Maintainer (future identity, E2A)

The attacker holds a future Maintainer product identity. Through the product
they **cannot** (by preset construction, ADR-017 D2):

- author or modify exams; publish exams or results;
- mutate candidates or their data;
- grade, view candidate answers, or write scores;
- assign Teacher/Proctor roles;
- force-submit, time-grant, mark misconduct, or resolve incidents (business
  recovery decisions stay Admin);
- reach any permanently-forbidden capability (restore/PITR/secrets/raw host,
  §13.5).

They **can** (by design): read operational diagnostics and backup evidence.
That is the plane's entire intended authority.

### 15.3 Compromised Host Maintainer (host credential theft)

A host operator with docker/root access **technically can** read PGDATA
(candidate answers, exam content, grades) and any backup artifact — software
RBAC cannot prevent root from reading disks. This is stated honestly, not
hidden: the product boundary guarantees only that host authority does **not**
automatically confer **application-authorized business action**:

- the Host Maintainer plane grants no product account by itself in E1/E2;
  after E2A the same real person may additionally hold an Application
  Maintainer account — but each plane is granted separately, and host
  authority DOES NOT IMPLY an Application Maintainer identity (ADR-017
  D12). Without such an account they cannot log in, publish, grade, or
  assign through the product;
- if E2A adds an Application Maintainer viewer identity, it grants
  observation only — and it is a separate plane from host access.

The document must therefore distinguish, as the program requires:

```text
technical infrastructure capability   (host/root — can read anything)
        vs
application-authorized business action (product RBAC — nothing granted)
```

The deployment's real control is **host trust selection** (who gets the
runbook + host access), documented in `docs/deployment/mvp-deployment-runbook.md`
— not a software boundary.

### 15.4 Additional notes

- `reset-admin-password` CLI is a host-operator action that resets an Admin
  password (audited `admin.password_reset.local`). It is an accepted
  bootstrap/break-glass path: host authority implies identity recovery
  authority. Documented in the runbook; not a product route.
- The `email-worker`, scanners, and seed paths are container-internal and
  carry no human authority.

---

## 16. Findings

Re-evaluated against the corrected authority model (Hybrid Option C, §9).
Counts were not carried over mechanically: P2-1 was reclassified from "UX
debt" to a formal **invariant violation + E2A precondition**; P2-2 gained an
explicit "must not be handed unchanged to Maintainer" constraint.

**P0 (blocks release / immediate authority-security-data-loss failure): 0.**

**P1 (ambiguous authority or mutation can violate correctness/security): 0.**
The boundary is structural: no route, capability, or UI reaches infra
execution; secrets are env/Compose-only; restore is operator-only by design.
No finding rises to a correctness or security violation of the separation.

**P2 (maintainability, drift, future-boundary hazards):**

- **P2-1 — View capability authorizes a side effect (invariant violation,
  E2A precondition).** `POST /email/test` is gated by `SystemDiagnosticsView`
  (`routes/email.ts:33`) although it is an *action with a side effect*
  (transmits an email through the configured SMTP channel). This violates
  the invariant **VIEW CAPABILITY MUST NOT AUTHORIZE SIDE EFFECT** (ADR-017
  D7). Safe today only because the sole holder is Admin. **Not ordinary UX
  debt**: it is a direct blocker for the Maintainer RBAC rollout — before
  any operational view is granted to a non-Admin principal (E2A), the action
  must be split into an independent capability (e.g. `system.email.test`,
  per repo convention) with its own gate and audit. Not fixed in E1
  (docs-only).
- **P2-2 — Diagnostics mixes infra observation with exam-domain integrity
  observation.** `GET /system/diagnostics` returns DB/Redis/worker infra
  status *and* the P7-S2 read-only integrity anomaly block
  (`system.ts:411–461`, submitted-not-terminalized / workset-mismatch).
  The former is operational diagnostics (Maintainer-visible per §9.2); the
  latter is *business-domain* integrity evidence (Admin-only). **The current
  diagnostics response must NOT be handed unchanged to a Maintainer
  viewer**; E2A must define the semantic split (ADR-017 D8). Safe today
  because both audiences are Admin.
- **P2-3 — Operational observation reads are not audited.** Health /
  dashboard / diagnostics GETs and `POST /email/test` emit no audit action;
  no `system.*_viewed` audit vocabulary exists (`auditActions.ts`). Acceptable
  for reads today; the email-test side effect should be audited (P2-1).
  Recorded for E2A; **not fixed in E1** (docs-only).

**P3 (naming, documentation, UX debt):**

- **P3-1 — `system.info.view` is an unresolved capability** (`catalog.ts:122`):
  `GET /system/info` is public, so no role needs the permission. Retain per
  P4-G-04 or remove with a recorded decision.
- **P3-2 — `organization.update` granted (catalog + Admin preset) but has no
  route** — org settings == branding settings (`routes/settings.ts`). Either
  add the route when a real org-settings requirement appears or drop the
  grant.
- **P3-3 — Admin "Management" nav group mixes business and ops pages.**
  `AppSidebar.tsx:170–206` renders users/candidates/importLogs/auditLogs/
  settings/candidateFields/system under one group gated by *any* management
  capability (`capabilities.ts:90–96`), with **no per-item capability gate**
  on the management items. Today only Admin holds these perms, so no dead
  nav appears; a future observation-only role would see dead items. E2A/E3
  should add per-item gates and consider an "Operations" group distinct from
  business management.
- **P3-4 — Documentation naming.** The product page at `/admin/system` is
  "System Diagnostics"; docs describe it as "diagnostics page (DB / Redis /
  scanner health)". With E2, introduce a stable "Operations" naming for the
  observation surface so Admin-vs-Maintainer pages are distinguishable
  (program requirement: "不要因为两个页面都属于'系统'就把按钮混在一起").

**P0–P3 recorded; none fixed in E1 (docs-only audit, per stop condition).**

---

## 17. Recommended next slice — GO / NO-GO P7-E2

### 17.1 Decision: **GO (conditional on human review of this document and
ADR-017).**

Rationale:

- The authority contract is now frozen and verified against current master
  (§4–§9); the boundary cannot regress accidentally because it is enforced by
  surface absence.
- There is a **concrete, evidence-backed gap**: P7-C ships mechanisms with
  zero durable in-product records; "last successful backup", "last verified
  backup", "current RPO posture", "last failure", and "restore drill status"
  are unanswerable in-product today (§11). P7-C's own handoff lists "Admin
  backup visibility surface" as P7-E territory.
- The evidence slice needs **no new execution authority**: evidence
  collection is performed by the *existing* P7-C scripts at their natural
  checkpoints; the product only records and reads truth.
- The program's own framing makes backup/DR authority "本轮 P7-E 最重要的
  真实 vertical slice" of the mission.
- The corrected authority model makes E2 **authority-first**: the RBAC
  boundary precedes any new operations surface, so the Maintainer role is
  never an afterthought (ADR-017 D13).

**Gate:** E2 implementation must not begin until a human reviews and accepts
E1 (this document + ADR-017). This report is the review artifact.

### 17.2 E2 scope — authority-first sequence (corrected)

```text
P7-E2A  Operational RBAC Boundary
          define/implement the Maintainer observation capability bundle
          (observation family §13.2; zero business permissions — hard
          constraint) — amends the ADR-010 role preset set (seventh
          built-in role; §9.3, ADR-017 D2)
          split dangerous action-under-view capabilities (D7 / P2-1:
          POST /email/test → its own capability + audit)
          split the operational-vs-business diagnostics domains (D8 / P2-2)
          MIGRATION CONTRACT: split authority WITHOUT breaking existing
          Admin visibility — during migration Admin temporarily retains
          both summary + detailed read; Maintainer receives ONLY
          operational diagnostics, never business-integrity diagnostics
          → no new Admin-only operations surface may ship before this

P7-E2B  Backup Evidence Ledger
          typed backup_runs / backup_run_events (NOT a generic settings
          store; P7-E0 §22 Option A/C)
          script instrumentation at natural checkpoints (start / artifact
          done / verified / failed) — PGPASSWORD-never-argv discipline,
          evidence writes fail loudly
          truthful verification evidence per the §12 invariants
          read projections (summary + detail) — no POST
          restore-drill evidence records
          crash/idempotency tests (all §12.2 cases)

P7-E2C  Admin / Maintainer Operational Views (VIEWS ONLY)
          Admin gets the business-owner summary UI (D1): system healthy?,
          backup healthy?, RPO satisfied?, last verified backup?,
          critical warning?
          Maintainer gets the detailed operations UI (D2/D8): DB latency,
          Redis state, scanner/worker state, WAL status, backup history,
          storage pressure, technical failure detail
          operational policy intent records + editable policy UI are
          P7-E3, NOT E2C
          only after E2C is usable may detailed Admin visibility be
          removed, if the product still wants that restriction
```

E2A–E2C may be merged into one or more PRs; the ordering constraint is what
binds. The previous "E2.1 evidence-first" recommendation is superseded:
**no further Admin-only operations surface may be added before the
Maintainer RBAC boundary exists.**

Conservative read rule: Admin's summary read is **guaranteed**; Admin's
detailed diagnostics read is **optional/read-only** afterwards — the
separation that matters is that Admin cannot **OPERATE** infrastructure, not
that Admin must be blind to infrastructure details (ADR-017 D13).

### 17.3 Explicitly NOT in E2 (per stop condition and anti-goals)

```text
NO scheduler in the product (host cron stays the scheduler)
NO retention engine (manual + fail-closed invariant; cross-authority
   protocol is an open E2 design question, §12.5)
NO browser restore / PITR / destructive controls (forever, ADR-017 D4)
NO Maintainer role seed / login path beyond E2A's capability-bundle
   definition (E2A defines the preset contract + ADR-010 amendment;
   provisioning follows D2)
NO decision-gated capabilities (backup.trigger etc.) admitted without
   their own recorded decision (ADR-017 D5)
NO operational policy intent records / editable policy UI (E3, §17.4)
NO secrets handling changes
```

### 17.4 E3 (only after E2 is accepted and reviewed)

Operational policy records + editable policy UI + UI closeout:

- `system.ops.policy.manage` — Admin records desired RPO / retention /
  drill cadence (intent, non-binding; DESIRED vs CURRENT CAPABILITY vs
  STATUS rendering, §11 rule 4);
- Admin Operations View (business-owner summary) vs Maintainer Operations
  View (detailed ops) — "不要因为两个页面都属于'系统'就把按钮混在一起";
- the former "future E1 settings" slice (confirmed Admin-editable
  operational settings, Email worker/retry candidate) merges here — E3, not
  a separate E1 numbering.

---

## 18. Anti-goals (inherited + this program)

- NO generic key/value settings registry; NO `system_settings` JSON blob
  (P7-E0).
- NO SuperAdmin; NO multi-tenant redesign; NO feature-flag framework
  (AGENTS.md, Phase 4 only).
- NO secret management platform; NO secrets in PostgreSQL; NO secret
  plaintext in UI/audit/export (§7).
- NO rewrite of P7-C scripts (mechanisms are shipped and drilled); NO new
  backup format.
- **NO browser destructive restore button; NO browser PITR button; NO
  browser delete-PGDATA control** — permanent (ADR-017 D4), along with the
  whole permanently-forbidden capability list (§13.5).
- NO backup scheduler inside the product (host cron is the scheduler);
  NO retention engine that can race a restore (fail-closed invariant; the
  cross-authority protocol is an open E2 design question, §12.5).
- NO implementation of the Maintainer application identity in E1 — the
  role concept is recognized (Option C, §9.3) but must NOT be seeded,
  schemed, or given a login path in this PR; E2A defines the preset
  contract, provisioning follows ADR-017 D2 and never inherits Admin.
- NO decision-gated capability (backup.trigger, schedule/retention manage,
  service.restart, ops policy manage) admitted to the product control
  plane without its own recorded decision meeting ADR-017 D5 conditions.
- NO Exam/Profile policy changes; NO changes to P7-M authority.
- NO generic workflow engine; NO Kubernetes/Patroni/HA.
- NO operational policy that binds or rewrites infrastructure (intent only).
- NO new bootstrap identity path (Launchpad stays first-Admin-only; a
  future Maintainer account uses the ordinary user/role-assignment path).
- NO expansion of Admin into execution or control-plane mutation: adding
  an Admin capability for any infra action, or letting Admin inherit
  Maintainer observation *beyond the business-owner summary*, is a
  violation of ADR-017, regardless of UI convenience.
- NO view capability that authorizes a side effect (D7 invariant; the
  current `POST /email/test` gate is a known violation to be split in
  E2A, not a pattern to copy).

---

## 19. Adversarial questions — answered

1. **Is Admin a superuser today?** No. Admin is the business superset plus
   read-only business-owner observation; no execution surface exists
   (§4, §8).
2. **Is a Maintainer product role needed?** As an *implemented* role: not in
   E1 — no product surface authorizes infra execution yet. As a *recognized
   architecture*: yes — the Hybrid Option C model (§9.3) defines the future
   Application Maintainer preset so a separate operations person never needs
   Admin. Implementation is E2A.
3. **Can Admin stop/alter backups?** No surface exists; E2 adds only
   *evidence reading* (§11, §17).
4. **Can Admin restore/PITR?** Never through the product (hard boundary §8,
   ADR-017 D4).
5. **Can Admin read secrets?** No; env/Compose-only, scrubbed (§7).
6. **What happens if a backup process dies mid-run?** Under the proposed
   mechanism: lease expiry → `abandoned`; artifact never promoted to success
   (invariant 3, §12.2/§12.5).
7. **When is a backup SUCCESS?** Readable + verified + committed evidence —
   the frozen invariant (§12.4).
8. **Same schedule fired twice?** Invariant: "a duplicate logical run must
   not produce contradictory evidence"; the mechanism (operationId
   uniqueness + host single-winner) is E2 design space (§12.5).
9. **Retention vs in-restore conflict?** Invariant: pruning must fail closed
   when safety cannot be proven; the cross-authority protocol to *know* an
   active restore target is an open E2 design question (§12.5).
10. **Who sees backup status?** Admin reads the business-owner summary;
    the future Application Maintainer reads detailed evidence; the Host
    Maintainer reads host/CLI truth (§9.4 rows 1–4).
11. **Is Admin's diagnostics read a conflation?** Observation is
    Admin-available, but the infra block vs business-integrity block must be
    semantically split before any Maintainer viewer exists — the current
    `/system/diagnostics` must not be handed unchanged to Maintainer (P2-2,
    ADR-017 D8).
12. **Can a compromised Admin damage infrastructure?** No product path
    (§15.1). The residual risk is Admin+host-access coupling, which is a
    deployment choice, documented.
13. **Can a compromised Application Maintainer damage the business?** No —
    the future preset holds observation capabilities only (§15.2).
    **Can a compromised Host Maintainer?** Through the product: no account
    ⇒ no authorized business action; through the host: yes, technically —
    trust boundary stated honestly (§15.3).
14. **Does E2 need a scheduler?** No — host cron continues; schedule
    *evidence* is recorded when runs happen (E2B); a product scheduler is
    never planned (§17.3 "Explicitly NOT in E2").
15. **Is a generic settings store justified?** No (P7-E0 verdict inherited;
    §1, §18).
16. **Launchpad creates only Admin?** Yes, unchanged — it bootstraps the
    first business Admin. A product-side Maintainer account, when E2/E3
    surfaces require it, is provisioned through the ordinary
    user/role-assignment path and must NOT inherit Admin capabilities (§14).
17. **What capability family is proposed?** Observation read-only
    (`system.backup.view`, `system.restore_readiness.view`,
    `system.ops.policy.view`), intent-write (`system.ops.policy.manage` —
    E3, Admin-only, non-binding), decision-gated operations (backup.trigger
    / schedule / retention / service.restart — D5 conditions;
    `operational.policy.manage` deliberately absent), permanently-forbidden
    execution keys (§13).
18. **Do we need an ADR?** Yes — ADR-017 (PROPOSED, rev 2) freezes the
    boundary and the Hybrid model (§9, §18).
19. **What is decision-gated vs permanently forbidden?** Decision-gated
    (future, each with its own recorded decision): `backup.trigger`,
    `backup.schedule.manage`, `backup.retention.manage`, `service.restart`
    (`operational.policy.manage` deliberately absent — intent has one
    owner, Admin). Permanently forbidden through product UI:
    restore/PITR/PGDATA-delete/destructive-recovery, raw secret read/export,
    raw host/filesystem/db-endpoint/redis-credential access (§13.4/§13.5).

---

## 20. Verdict

```text
P7-E1 OPERATIONAL AUTHORITY / ADMIN-MAINTAINER SEPARATION

Baseline:        e3eaaa4ce2116a756ad82aa8a209e249fe4466e1 (clean tree)
Code changes:    NONE (docs + ADR only)
ADR-017:         PROPOSED (rev 2 — Hybrid Maintainer Model, Option C)

Authority decision:
  Admin                  = Exam Product / Organization Business Owner
                           business capabilities + limited operational
                           visibility (business-owner summary)
  Application Maintainer = System Operations Owner (product role concept,
                           NOT implemented in E1; future preset with ONLY
                           operational capabilities, zero business perms)
  Host Maintainer        = System Operations Owner (host/CLI identity:
                           Docker / PG / WAL / backup / restore / PITR /
                           secrets / lifecycle — not product RBAC)

  Application Maintainer ≠ Host root: two trust planes, possibly one person.

The hard boundary already holds:
  - zero product surface for infra execution (backup/restore/PITR/WAL/
    restart/secrets/host paths)
  - zero Admin capability that reaches machine/DB/secret authority
  - secrets env/Compose-only; restore operator-owned permanently
  - Admin observation is read-only and correctly scoped to the business
    owner; detailed ops reading is the future Maintainer plane

The real gap is evidence, not authority:
  - no durable backup_run / restore_drill records exist in-product
  - "last successful/verified backup", "RPO posture", "last failure" are
    unanswerable in-product today

Recommended next slice:  GO P7-E2 (conditional on human review)
  authority-first sequence (ADR-017 D13):
    E2A Operational RBAC Boundary — Maintainer observation capability
        bundle (amends ADR-010 role preset set — seventh built-in role);
        split action-under-view capabilities (email-test invariant D7);
        diagnostics domain split (D8); zero business perms; migration
        contract: no Admin visibility regression during the split
    E2B Backup Evidence Ledger — typed backup_runs/events, script
        instrumentation, truthful verification evidence, read projections
    E2C Admin/Maintainer Operational Views — VIEWS ONLY (business-owner
        summary vs detailed ops); policy records + editable policy UI
        are E3
  NO scheduler, NO retention engine, NO restore surface, NO Maintainer
  role seed in E1; decision-gated capabilities (backup.trigger etc.) stay
  host-owned pending their own recorded decisions (D5); operational-policy
  intent has ONE owner (Admin, system.ops.policy.manage — E3)

Findings (re-evaluated):  P0: 0 | P1: 0 | P2: 3 (P2-1 view-capability
  side-effect invariant violation → E2A precondition; P2-2 diagnostics
  infra/integrity conflation → must not be handed unchanged to Maintainer;
  P2-3 observation reads un-audited) | P3: 4 (naming/UX/grant hygiene)

Open design questions for E2:  cross-authority retention/restore protocol
  (§12.5); backup state-machine mechanisms (lease/reconciler/operationId —
  invariants frozen, mechanisms not).

Stop condition:  P7-E1 READY FOR HUMAN REVIEW — waiting for review before
                 any E2 implementation begins.
```

---

P7-E1 OPERATIONAL AUTHORITY / ADMIN-MAINTAINER SEPARATION — READY FOR HUMAN REVIEW
