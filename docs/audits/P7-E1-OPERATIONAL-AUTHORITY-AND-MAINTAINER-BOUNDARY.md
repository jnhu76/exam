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
   dashboard/email-test surface. Per the authority matrix (§10) observation is
   read-available to both Admin and Maintainer, so this is correct scoping, not
   a defect.
2. **Maintainer has no product identity at all.** The person who operates the
   deployment is a host/CLI operator. This is the correct minimal-security
   shape for a single-deployment LAN/on-premise product (§9.3): the product
   cannot perform infra execution, so no product role is needed to authorize
   infra execution, and creating one would create pressure for the very
   browser-destructive surfaces the program forbids.
3. **The real gap is evidence, not authority.** P7-C shipped mechanisms with
   zero durable, in-product records: "last successful backup", "last verified
   backup", "current RPO posture", "last failure", and "restore drill status"
   are **not answerable inside the product today**. That is the P7-E2 vertical
   slice (§17), and it is implementable without granting any new execution
   authority.

The program's three principles (least privilege, separation of duties,
authority follows responsibility) are **satisfied by the current boundary** —
the deliverable of E1 is to freeze that boundary in an authority contract
(§9), an ADR (ADR-017), and an honest trust-boundary statement (§15), then
gate E2 on human review.

Findings: **P0: 0, P1: 0, P2: 3, P3: 4** (§16). None blocks the authority
contract. Recommended next slice: **GO P7-E2 (conditional on human review of
this document)** — evidence-first backup run ledger (§17.3).

---

## 2. Mission

P7-E is not "build a Settings page". It is:

> Establish a clear **Operational Authority Model** that separates the Exam
> Product / Organization Owner (Admin) from the Deployment / Infrastructure
> Owner (Maintainer), then decide the minimal implementation slice.

Relationship to prior work:

| Program | Verdict | Authority |
| --- | --- | --- |
| P7-C (backup mechanics) | CLOSED — mechanisms shipped, drills deterministic | `docs/deployment/backup-and-recovery.md`, `docs/audits/P7-C-PORTABLE-BACKUP-RECOVERY-CLOSEOUT.md` |
| P7-E0 (configuration reality audit) | CLOSED — **no generic settings subsystem justified** | `docs/audits/P7-E0-CONFIGURATION-REALITY-AUDIT.md` |
| P7-M (exam modes) | FUNCTIONALLY COMPLETE | `docs/audits/P7-M-CONFIGURABLE-EXAM-MODES-CLOSEOUT.md` |
| **P7-E1 (this audit)** | Authority model + boundary contract | this document + ADR-017 |

P7-E0's verdict stands and is inherited: no generic settings store, no
`system_settings` JSON blob, no feature-flag framework (§18). The new P7-E
program is **orthogonal to E0's settings question**: E0 asked "which values
may an Admin edit online"; P7-E asks "which *authority* does the Admin role
and the deployment operator each hold". The two answers meet only in the
observation surface (Admin may *read* operational truth; neither may *edit*
deployment truth through the product).

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
- **Roles:** exactly six presets (`catalog.ts:176–183`,
  `presets.ts:213–308`): Admin, Teacher, Proctor, Grader, Candidate, System
  (non-login, non-assignable). No Maintainer role exists — and per §9.3 none
  is needed.

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

**Admin is the Exam Product / Organization Owner** — the person the
organization designates to run the exam business on the deployment:

- Business authority: users/roles, candidates, courses, questions, exams,
  profiles, publication, grading, scores, exports, Recovery Center business
  decisions (time grant, force submit, misconduct, incident resolve),
  organization branding.
- Operational observation (read-only): system health/dashboard/diagnostics,
  email test, audit log, backup status (future, E2), restore-drill evidence
  (future, E2).
- **Not:** PostgreSQL DBA, Docker/host operator, filesystem owner, secret
  owner, SMTP credential owner, Redis operator, PITR/destructive-restore
  operator. The Admin role must never be extended to grant those — including
  through a future "just a small button" UI (§18).

### 9.2 Who is Maintainer?

**Maintainer is the Deployment / Infrastructure / Operations Owner** — the
person (or function) with host access who:

- owns deployment, Compose, service lifecycle, restart;
- runs PostgreSQL itself, WAL archiving, backup destination, storage paths,
  capacity;
- executes backup, restore, PITR, retention/pruning, migration and rollback
  scripts;
- holds Redis/SMTP endpoints + credentials, TLS, secrets, bootstrap tokens;
- reads host/container logs and `pg_stat_archiver`-style infra truth.

Maintainer **does not** automatically hold any business authority: no
Candidate data access via product, no Exam content authority, no grade
mutation, no result publication, no Teacher assignment, no business recovery
judgments (force-submit / time-grant / incident resolve are Admin business
decisions, not infra actions).

### 9.3 Identity model — decision: Option B, Maintainer is a
deployment/operator identity, NOT a product DB role

Three options were compared (§ prompt §6):

| Option | Shape | Fit for this product |
| --- | --- | --- |
| **A** — Maintainer as a new product role in Exam RBAC | DB-seeded role preset + assignment + login | **Rejected for E1/E2.** A product role is only justified if there is a product surface it authorizes. The product has zero infra-execution surface, so a Maintainer role would authorize nothing real — while creating pressure to build "Maintainer UI buttons" for actions that must remain host-only (§8, §18), the exact dangerous coupling the program forbids. |
| **B** — Maintainer as pure deployment/operator identity outside RBAC | host/CLI/docker; no product account | **SELECTED (E1).** All infra execution already lives on the host; the runbook documents operator commands; no product credential can reach host authority. Least privilege is achieved by *absence of surface*, which cannot regress. |
| **C** — Hybrid (product observation capability + host execution) | a narrowly-scoped product capability for *reading* ops truth, granted to Admin today; a possible future observation-only role | **SELECTED as the E3 direction (deferred), not built now.** Observation via product is Admin-gated today (`SystemHealthView`/`SystemDiagnosticsView` — granted per the matrix). If a real deployment requirement emerges for a *separate* person to read ops status in-product without business authority, the minimal path is a new observation-only capability family (§13) + an optional "Maintainer" preset holding ONLY those capabilities — never business perms, never execution. That is a role *preset* change (data), not a new authority surface. |

**Consequences of the decision:**

1. **No schema change, no role seed, no login path for Maintainer in E1/E2.**
   The separation is enforced by surface absence + runbook discipline.
2. **Launchpad stays first-Admin-only** (§14) — the first Admin is a business
   bootstrap; the deployment owner is whoever holds host access, which is a
   host-level decision documented in the runbook, not a product record.
3. **Honest trust boundary** (§15): a host operator with root/docker access
   can technically read PGDATA (including candidate answers and exam content).
   Software RBAC cannot prevent root from reading disks. The separation
   guarantees that host authority does not translate into
   *application-authorized business action through the product* — the
   deployment must still choose whom to trust with host access. This is
   documented, not hidden.

### 9.4 What can each observe / mutate — authority matrix

| # | Capability | Admin | Maintainer | Where executed |
| --- | --- | --- | --- | --- |
| 1 | View whether system is healthy (CPU/mem/DB latency) | **read** | read | product (`/system/health`) / host |
| 2 | View DB / Redis / scanner / email-worker status | **read** | read | product (`/system/diagnostics`) / host (`pg_stat_*`, logs) |
| 3 | View backup status, last success, last verified | **read** (E2) | read | product read view (E2) / host scripts |
| 4 | View restore-drill status / evidence | **read** (E2) | read | product read view (E2) / drill output |
| 5 | View storage capacity / WAL archive health | read (E2, if exposed) | read | product read view (E2) / host |
| 6 | View operational policy (desired RPO/retention) | **read** (E2.2) | read | product (E2.2, typed policy record) / runbook |
| 7 | Set *desired* RPO / retention / drill cadence (intent) | **write (intent only)** (E2.2) | maybe | product (E2.2) — NEVER binds infra |
| 8 | Edit Exam Profiles / publish exams / manage candidates / grading | **write** | **no** | product |
| 9 | Business recovery decisions (time grant, force submit, misconduct, incident resolve) | **write** | **no** | product (Recovery Center) |
| 10 | Modify org branding | **write** | **no** | product |
| 11 | View audit log | **read** | no (host logs) | product |
| 12 | Backup *execution* (schedule trigger, destination) | **no** | **write** | host cron / CLI |
| 13 | WAL archiving enablement / archive_command | **no** | **write** | `postgres-enable-pitr.sh` |
| 14 | Restore / PITR / destructive operations | **no** | **write** | host CLI (`*-restore.sh`, recovery procedure) |
| 15 | Retention / pruning of backups + WAL | **no** | **write** (manual today; fail-closed rule §12.7) | host |
| 16 | `POSTGRES_PASSWORD`, `JWT_SECRET`, `REDIS_*`, `SMTP_PASSWORD`, TLS keys, fs credentials | **no** | **write** | env/Compose/secret store |
| 17 | Service restart (API/db/worker/redis) | **no** | **write** | host `docker compose` |
| 18 | DB endpoint / Redis URL / topology | **no** | **write** | env/Compose |
| 19 | Migration / rollback / backfill scripts | **no** | **write** | host CLI (`docker compose exec app …`) |
| 20 | View secret plaintext through product UI | **no** | **preferably never through product UI** | — |
| 21 | Exam content / Candidate identity / grades through product | **write (business)** | **no** | product |

### 9.5 Which actions remain CLI/host-only (permanent)

Everything in §6.1–§6.2 (backup, restore, PITR, WAL enable, cold copy,
migrate, rollback, backfill, reset-admin-password, bootstrap CLI), plus
Compose lifecycle, secret management, and host log access. **No future slice
may move any of these into the product** (§18 anti-goals; ADR-017).

### 9.6 Where do secrets live?

env + Compose + host secret store (P7-E0 §5/§13). Never PostgreSQL, never
product UI, never audit logs, never export/backup payloads (the P7-C dump
contains role definitions, not plaintext passwords). UI shows status
adjectives only.

---

## 10. Full permission matrix (Admin / Maintainer)

Current catalog (`catalog.ts`) — "Admin" = Admin preset grants
(`presets.ts:51–129`); "Maintainer" = **no product role (Option B)**; the
column records what a Maintainer would hold if the deferred E3 observation
role is ever built (marked "E3?").

| Permission key | Admin preset | Maintainer (host) | E3 observation role? | Notes |
| --- | --- | --- | --- | --- |
| `user.*` (view/create/update/delete/role.assign/password.reset) | ✅ | — (host only) | no | business |
| `organization.view` / `organization.update` | ✅ / ✅ (no route) | — | no | `organization.update` has no route (P3-2) |
| `settings.view` / `settings.update` | ✅ / ✅ | — | no | org branding only |
| `audit_log.view` | ✅ | — (host logs) | no | |
| `candidate.*`, `candidate_field.*` | ✅ | — | no | business |
| `course.*`, `question.*` | ✅ | — | no | business |
| `exam.*` (lifecycle, publish, result.publish, enrollment.manage) | ✅ | — | no | business |
| `exam.take`, `attempt.*` (own runtime) | Candidate-only | — | no | business |
| `exam_room.view`, `attempt.status.view`, `attempt.timeline.view` | ✅ | — | no | business observation |
| `attempt.misconduct.mark` / `attempt.time.grant` / `attempt.force_submit` / `attempt.export` | ✅ | — | no | business recovery (Admin-only per ADR-014/015) |
| `grading.*` (queue/detail/answer/score.write/finalize/identity) | ✅ | — | no | business |
| `score.all.view` / `score.export` | ✅ | — | no | business |
| **`system.health.view`** | ✅ | n/a (host) | **yes** | observation |
| **`system.diagnostics.view`** | ✅ | n/a (host) | **yes** | observation |
| `system.info.view` | (UNRESOLVED, no consumer) | n/a | — | P3-1 |
| `system.auto_submit` / `system.heartbeat_scan` / `system.lifecycle_reconcile` | System actor only | — | no | non-login, non-assignable |
| `incident.*` (view/create/investigate/resolve) | ✅ | — | no | resolve/dismiss Admin-only |
| `incident.recovery.view` | ✅ | — | no | Recovery Center read |
| `exam.proctor_assignment.view` / `.manage` | ✅ | — | no | Admin-only |
| **future: `system.backup.view` (E2)** | ✅ (proposed) | n/a | yes | observation, read-only |
| **future: `system.ops.policy.view` (E2.2)** | ✅ (proposed) | n/a | yes | observation |
| **future: `system.ops.policy.manage` (E2.2)** | Admin only (intent) | n/a | no | intent records, never binds infra |
| **forbidden forever: `backup.execute`, `restore.*`, `pitr.*`, `secret.*`, `infra.restart`** | ❌ | host/CLI only | ❌ | §13.3, §18 |

**Invariant:** role presets are capability bundles; the future Maintainer
preset (if E3 builds it) contains **only** observation capabilities and zero
business capabilities; the Admin preset keeps business + limited observation;
no preset ever contains execution capabilities (§13.4).

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
| **Admin intent** | desired RPO, retention window, drill cadence — recorded as a **typed operational policy record** (domain-owned, audited, non-binding) | ❌ nothing exists | E2.2 (deferred within E2; §17.3) |
| **Maintainer execution** | schedule (cron-on-host), destination, WAL archive, retention, restore, PITR, restart | ✅ P7-C scripts + runbook | **unchanged — never moves into product** |
| **System evidence** | durable, append-only records of runs + verification + failures + drills, from which Admin reads truth | ❌ nothing exists | **E2.1 — the first vertical slice (§17.3)** |

**Truthfulness rules (inherited from P7-C and P7-E0):**

1. A backup is **SUCCESS** only when the artifact exists, is readable, and
   passed verification (§12.8). No evidence record may claim otherwise.
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
   Maintainer + CLI/runbook + host access** (hard boundary, §8/§9.5).

---

## 12. Backup run state machine (derived from execution semantics)

Derived from the **actual P7-C execution semantics** (scripts + drills), not
adopted from the prompt's example list. States are chosen so that every
crash question below has one answer.

### 12.1 States

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

### 12.2 Crash questions — answers

| Question | Answer |
| --- | --- |
| Process dies while `running`? | Lease on the `running` record expires; the next run (or reconciler) marks it `abandoned`. The partial artifact is **never** promoted to success. |
| Same schedule triggered twice? | Host-side single-winner: `operationId` (per schedule-slot + timestamp) has a uniqueness constraint in the evidence store; the second trigger either observes the in-flight record and waits, or is rejected as duplicate (`409`-style no-op), never double-runs. |
| Backup bytes written but crash before verify? | State stays `running`→ lease expiry → `abandoned`; artifact without a verification record is **not** SUCCESS. Operator re-runs; the new run has a fresh `operationId`. |
| Verify succeeded but crash before evidence commit? | Evidence commit is **atomic** (single INSERT of the `succeeded` record carrying artifact fingerprint + verification result). Crash before commit ⇒ no record ⇒ run appears `running`/absent ⇒ reconciler marks `abandoned`; a re-run with the same `operationId` commits cleanly (idempotency). |
| Retention conflicts with a backup being restored? | **Fail closed**: pruning refuses any artifact referenced by an active restore target / evidence chain. Prune never races a restore. |
| Old backup deletion fails? | `prune_failed` evidence record + system warning. Retention drift becomes visible in the Admin read view; never silently ignored. |
| Can we say `SUCCESS`? | Only when ALL hold: artifact exists ∧ readable ∧ verification passed ∧ `succeeded` evidence committed ∧ (for PITR) the retained chain invariant holds (base backup precedes the earliest required WAL) — §12.8. |

### 12.3 Idempotency

`operationId` = deterministic identity per logical run (e.g.
`<kind>:<schedule-slot>:<wallclock-slot>`). Re-execution of the same
operationId is a no-op or a resume, never a duplicate. Mirrors the
`operationId`-keyed idempotency already used for operator time grants
(REC-I4-I3B1) and command receipts (attempt_command_receipts).

### 12.4 SUCCESS definition (the invariant)

> **A backup is SUCCESS only when it is readable and verified, and the
> `succeeded` evidence record — carrying the artifact fingerprint and the
> verification result — is durably committed.**

This matches P7-C's acceptance signal ("a backup is not marked successful
until it is readable and validated") and P7-E0 §24's fail-closed prune rule.

---

## 13. Capability family proposal (design direction — not implemented in E1)

### 13.1 Rule

No new capability is created in E1 because no new surface exists. Capabilities
are added **only** when the E2 slice introduces the surface they gate, and
they follow the existing dotted convention.

### 13.2 Observation family (E2/E3 candidates, read-only)

```text
system.backup.view          # backup inventory/status, last success, last verified
system.ops.policy.view      # effective operational policy (desired RPO/retention)
system.restore.view         # restore-readiness + drill evidence (E2 drill records)
```

All granted to the **Admin preset** (observation is Admin-available per §9.4).
Read-only by construction: no write sibling is proposed for execution.

### 13.3 Intent family (E2.2 candidate, write but non-binding)

```text
system.ops.policy.manage    # Admin records desired RPO / retention / drill cadence
```

Writes **intent records only** — typed, audited, never bound to infra
execution, never capable of changing a schedule or destination. The
DESIRED-vs-CAPABILITY rendering (§11) is its only consumer.

### 13.4 Forbidden capabilities (forever)

```text
backup.execute / backup.schedule.manage / restore.* / pitr.* /
secret.* / infra.restart / db.endpoint.manage / redis.topology.manage
```

These are **not** "deferred" capabilities — they are architecturally excluded
(ADR-017). Infrastructure execution is performed by the Maintainer on the
host; the product has no permission that can represent it.

### 13.5 Role = capability bundle

If E3 ever needs a separate in-product Maintainer *viewer*, it is a new
preset holding `system.health.view` + `system.diagnostics.view` +
`system.backup.view` (+ future observation keys) and **nothing else** —
no `user.*`, no `candidate.*`, no `exam.*`, no `grading.*`. This is a preset
data change plus existing assignment machinery; it is explicitly NOT part of
E1/E2 scope.

---

## 14. Launchpad / bootstrap

| Question | Answer |
| --- | --- |
| Who is the deployment owner at first install? | The **host operator** who runs `docker compose` / `bootstrap-admin` / Launchpad. This is a host-level fact, not a product record. |
| Is it necessary to create a Maintainer in the DB? | **No** (Option B, §9.3). No product surface needs the identity. |
| Should Maintainer come from CLI/bootstrap? | Maintainer identity is host access, not a DB row. The runbook documents who may hold host access; the product does not model it. |
| If Maintainer is only a host operator, is no DB identity needed? | Correct — **no DB identity needed** in E1/E2. |
| How does a web ops surface authenticate, at minimum cost? | Today: the ops surface **is** Admin-gated observation; no new auth needed. If a separate viewer is later required (E3), reuse the existing user/role-assignment machinery with an observation-only preset (§13.5) — no new auth mechanism. |

Launchpad keeps creating `role = Admin` only. There is no
"first Maintainer" bootstrap, and there must not be one: introducing a
bootstrap path for an identity that authorizes nothing would be
over-engineering with security-adjacent surface (a new login path) for zero
capability.

---

## 15. Threat model

### 15.1 Compromised Admin (account takeover)

The attacker holds the Admin product identity. Through the product they
**cannot**:

- obtain `DATABASE_URL` / `POSTGRES_PASSWORD` / `JWT_SECRET` /
  `REDIS_PASSWORD` / `SMTP_PASSWORD` (no secret surface; §7);
- stop, reschedule, or re-point backups (no backup surface; §6.1);
- modify WAL archive destination or archive_command (host-only script);
- execute restore or PITR (operator-only, permanent);
- read SMTP password or any credential plaintext (scrubbed, §7);
- modify DB endpoint / Redis topology / restart services (Compose/env-only);
- delete backup files or WAL segments (host filesystem).

They **can** (as the business owner): publish results, change grades
(business authority), mark misconduct, force-submit, time-grant, read
candidate data, and observe infra health (read-only). Those are the Admin
role's intended authority — the blast radius is business damage, which is
precisely why Admin credentials are the deployment's most sensitive product
secret and why **Admin must not also hold host access** (the one coupling
that would defeat the separation: an Admin with host credentials becomes a
Maintainer by possession, not by role).

**Mitigations that exist:** HTTP-only cookie + JWT, argon2 hashing, rate
limits, audit ledger for mutations, fail-closed authorization, no
organization-scoped cross-tenant path. **Gap (accepted, E3?):** operational
observation reads (`system.*` GETs, `POST /email/test`) are not audited —
an attacker's diagnostics *reads* leave no audit trail (P2-3).

### 15.2 Compromised Maintainer (host credential theft)

A host operator with docker/root access **technically can** read PGDATA
(candidate answers, exam content, grades) and any backup artifact — software
RBAC cannot prevent root from reading disks. This is stated honestly, not
hidden: the product boundary guarantees only that host authority does **not**
automatically confer **application-authorized business action**:

- the Maintainer has no product account in E1/E2 (Option B) — they cannot
  log in, publish, grade, or assign through the product;
- if E3 adds an observation-only viewer identity, it grants reads only.

The document must therefore distinguish, as the program requires:

```text
technical infrastructure capability   (host/root — can read anything)
        vs
application-authorized business action (product RBAC — nothing granted)
```

The deployment's real control is **host trust selection** (who gets the
runbook + host access), documented in `docs/deployment/mvp-deployment-runbook.md`
— not a software boundary.

### 15.3 Additional notes

- `reset-admin-password` CLI is a host-operator action that resets an Admin
  password (audited `admin.password_reset.local`). It is an accepted
  bootstrap/break-glass path: host authority implies identity recovery
  authority. Documented in the runbook; not a product route.
- The `email-worker`, scanners, and seed paths are container-internal and
  carry no human authority.

---

## 16. Findings

**P0 (blocks release / immediate authority-security-data-loss failure): 0.**

**P1 (ambiguous authority or mutation can violate correctness/security): 0.**
The boundary is structural: no route, capability, or UI reaches infra
execution; secrets are env/Compose-only; restore is operator-only by design.
No finding rises to a correctness or security violation of the separation.

**P2 (maintainability, drift, future-boundary hazards):**

- **P2-1 — Action under a view capability.** `POST /email/test` is gated by
  `SystemDiagnosticsView` (`routes/email.ts:33`), but it is an *action with a
  side effect* (transmits an email through the configured SMTP channel), not
  a read. Today the only holder is Admin, so the risk is nil; but if E3 ever
  introduces an observation-only viewer (Option C), the email-test action
  must not ride on the view capability. **Fix direction (E3):** either give
  the action its own capability or scope it to Admin explicitly; also audit
  the action (it is currently un-audited).
- **P2-2 — Diagnostics mixes infra observation with exam-domain integrity
  observation.** `GET /system/diagnostics` returns DB/Redis/worker infra
  status *and* the P7-S2 read-only integrity anomaly block
  (`system.ts:411–461`, submitted-not-terminalized / workset-mismatch).
  The former is ops observation (Admin read per matrix); the latter is
  *business-domain* integrity evidence (Admin should see it; a future
  observation-only Maintainer viewer arguably should NOT). When E3 splits
  the surface, separate the two blocks semantically; today the conflation is
  safe because both audiences are Admin.
- **P2-3 — Operational observation reads are not audited.** Health /
  dashboard / diagnostics GETs and `POST /email/test` emit no audit action;
  no `system.*_viewed` audit vocabulary exists (`auditActions.ts`). Acceptable
  for reads today; the email-test side effect should be audited (P2-1).
  Recorded for E3; **not fixed in E1** (docs-only).

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
  nav appears; a future observation-only role would see dead items. E3
  should add per-item gates and consider grouping the System page under an
  "Operations" group.
- **P3-4 — Documentation naming.** The product page at `/admin/system` is
  "System Diagnostics"; docs describe it as "diagnostics page (DB / Redis /
  scanner health)". With E2/E3, introduce a stable "Operations" naming for
  the observation surface so Admin-vs-Maintainer pages are distinguishable
  (prompt §10: "不要因为两个页面都属于'系统'就把按钮混在一起").

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
- The first slice needs **no new execution authority**: evidence collection
  is performed by the *existing* P7-C scripts at their natural checkpoints;
  the product only records and reads truth.
- The prompt's own framing makes backup/DR authority "本轮 P7-E 最重要的真实
  vertical slice" (§5 of the mission).

**Gate:** E2 implementation must not begin until a human reviews and accepts
E1 (this document + ADR-017). This report is the review artifact.

### 17.2 E2 scope (full program, after acceptance)

```text
typed operational policy (desired RPO/retention/drill cadence — intent records)
backup scheduling          (host cron integration + schedule evidence; NOT a
                            product scheduler)
run ownership              (actor = host CLI/operator identity)
durable backup evidence    (backup_runs ledger)
verification state         (verifying → succeeded only after verification)
failure state              (failed/abandoned + error kind)
retention                  (fail-closed prune rule + prune evidence; manual
                            execution stays host-side)
crash/restart behavior     (lease + reconciler sweep)
idempotency                (operationId uniqueness)
```

### 17.3 Minimal E2 vertical slice (E2.1 — evidence-first backup run ledger)

1. **Typed persistence (NOT a generic settings store):** `backup_runs` table
   (id, operationId unique, kind `cold|logical|physical`, status per §12.1,
   artifact_path, artifact_size, verification result, started/finished at,
   lease_expires_at, actor, error kind/detail) + append-only
   `backup_run_events`; domain types in `packages/domain`, Drizzle schema +
   migration, repository methods with `ctx`. No `system_settings` table, no
   JSON registry (P7-E0 §22: Option A/C typed).
2. **Script instrumentation:** the existing P7-C online scripts
   (`postgres-logical-backup.sh`, `pg-basebackup.sh`, and the cold pair with
   the intent-before-stop / completion-after-restart pattern §12.1) write
   evidence at their natural checkpoints (start / artifact done / verified /
   failed). Same PGPASSWORD-never-argv discipline; evidence writes fail the
   script loudly, never silently.
3. **Read API + Admin view:** `GET /admin/backups` (summary: last success,
   last verified, last failure, RPO posture, retention summary, warnings)
   gated by a **new** `system.backup.view` capability granted to the Admin
   preset (§13.2). Read-only; no POST.
4. **Restore-drill evidence:** the drill scripts
   (`tests/deployment/pitr.sh`, `logical-backup-restore.sh`) record their
   outcome (`restore_drill` records) so "restore readiness" is evidence-based.
5. **Tests:** state-machine unit tests (all §12.2 crash cases), integration
   tests for the evidence repo, and an extension of the deployment drills
   asserting evidence rows exist with truthful status.
6. **Explicitly NOT in E2.1:** scheduler (stays host cron), retention
   automation (manual + fail-closed rule), Admin intent/policy records
   (E2.2), Maintainer role/UI (E3), browser restore (forever), secrets
   handling (unchanged).

### 17.4 E3 (only after E2 is accepted and reviewed)

Admin Operations View (read-only backup/ops status) vs Maintainer Operations
View (if a separate viewer is required: observation-only preset §13.5) —
"不要因为两个页面都属于'系统'就把按钮混在一起".

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
  browser delete-PGDATA control** — permanent, ADR-017.
- NO backup scheduler inside the product (host cron is the scheduler);
  NO retention engine that can race a restore (fail-closed if ever built).
- NO Maintainer product role in E1/E2 (Option B; E3 re-evaluates for a
  read-only viewer only).
- NO Exam/Profile policy changes; NO changes to P7-M authority.
- NO generic workflow engine; NO Kubernetes/Patroni/HA.
- NO operational policy that binds or rewrites infrastructure (intent only).
- NO new bootstrap identity path (Launchpad stays first-Admin-only).
- NO expansion of Admin into execution: adding an Admin capability for any
  infra action is a violation of ADR-017, regardless of UI convenience.

---

## 19. Adversarial questions — answered

1. **Is Admin a superuser today?** No. Admin is the business superset plus
   read-only observation; no execution surface exists (§4, §8).
2. **Is a Maintainer product role needed?** No (Option B, §9.3) — no product
   surface authorizes infra execution; a role would authorize nothing while
   inviting dangerous UI.
3. **Can Admin stop/alter backups?** No surface exists; E2 adds only
   *evidence reading* (§11, §17).
4. **Can Admin restore/PITR?** Never through the product (hard boundary §8).
5. **Can Admin read secrets?** No; env/Compose-only, scrubbed (§7).
6. **What happens if a backup process dies mid-run?** Lease expiry →
   `abandoned`; artifact never promoted to success (§12.2).
7. **When is a backup SUCCESS?** Readable + verified + committed evidence
   (§12.4, §12.8).
8. **Same schedule fired twice?** operationId uniqueness + host single-winner
   (§12.2).
9. **Retention vs in-restore conflict?** Fail closed; prune refuses (§12.2).
10. **Who sees backup status?** Admin (read) via evidence; Maintainer (host).
    Both read per matrix (§9.4 rows 3–4).
11. **Is Admin's diagnostics read a conflation?** No — observation is
    Admin-available; but infra block vs integrity block should be separated
    when a second audience appears (P2-2).
12. **Can a compromised Admin damage infrastructure?** No product path
    (§15.1). The residual risk is Admin+host-access coupling, which is a
    deployment choice, documented.
13. **Can a compromised Maintainer damage the business?** Through the
    product: no account ⇒ no authorized business action (§15.2). Through the
    host: yes, technically — trust boundary stated honestly.
14. **Does E2 need a scheduler?** No — E2.1 is evidence-first; host cron
    continues; schedule *evidence* is recorded when runs happen.
15. **Is a generic settings store justified?** No (P7-E0 verdict inherited;
    §1, §18).
16. **Launchpad creates only Admin?** Yes, unchanged; no Maintainer bootstrap
    (§14).
17. **What capability family is proposed?** Observation read-only
    (`system.backup.view`, `system.ops.policy.view`, `system.restore.view`),
    intent-write (`system.ops.policy.manage`), forbidden-forever execution
    keys (§13).
18. **Do we need an ADR?** Yes — ADR-017 freezes the boundary (§9, §18).

---

## 20. Verdict

```text
P7-E1 OPERATIONAL AUTHORITY / ADMIN-MAINTAINER SEPARATION

Baseline:        e3eaaa4ce2116a756ad82aa8a209e249fe4466e1 (clean tree)
Code changes:    NONE (docs + ADR only)

Authority decision:
  Admin       = Exam Product / Organization Owner
                business capabilities + limited operational observation
  Maintainer  = Deployment / Infrastructure / Ops Owner
                host/CLI identity (Option B — NOT a product DB role in
                E1/E2; E3 may add an observation-only viewer if a real
                requirement appears)

The hard boundary already holds:
  - zero product surface for infra execution (backup/restore/PITR/WAL/
    restart/secrets/host paths)
  - zero Admin capability that reaches machine/DB/secret authority
  - secrets env/Compose-only; restore operator-owned permanently
  - Admin observation (health/diagnostics) is read-only and correctly scoped

The real gap is evidence, not authority:
  - no durable backup_run / restore_drill records exist in-product
  - "last successful/verified backup", "RPO posture", "last failure" are
    unanswerable in-product today

Recommended next slice:  GO P7-E2 (conditional on human review)
  E2.1 minimal slice: evidence-first backup run ledger (typed backup_runs +
  backup_run_events, script instrumentation at natural checkpoints,
  read-only /admin/backups gated by system.backup.view, restore-drill
  evidence, crash/idempotency tests). NO scheduler, NO retention engine,
  NO restore surface, NO Maintainer role, NO policy intent records (E2.2).

Findings:  P0: 0 | P1: 0 | P2: 3 (P2-1 action-under-view-capability,
           P2-2 diagnostics infra/integrity conflation, P2-3 observation
           reads un-audited) | P3: 4 (naming/UX/grant hygiene)

Stop condition:  P7-E1 READY FOR HUMAN REVIEW — waiting for review before
                 any E2 implementation begins.
```

---

P7-E1 OPERATIONAL AUTHORITY / ADMIN-MAINTAINER SEPARATION — READY FOR HUMAN REVIEW
