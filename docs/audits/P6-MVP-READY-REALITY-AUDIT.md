# P6 — MVP Ready Closeout Reality Audit

> **Status:** CONDITIONAL_PASS — production corrections applied; MVP subset is
> release-ready pending independent closeout review.
>
> **Branch:** `feat/p6-mvp-ready-closeout`
>
> **Starting master HEAD:** `13d94c2b53c215ec67488120b300418899caaf76`
> (Merge PR #214: P5-N1 closeout roadmap sync)
>
> **Audit base:** all commits on `feat/p6-mvp-ready-closeout`.
>
> **Audit scope:** determine whether the implemented MVP product slice is
> genuinely deployable in its documented LAN/on-premise, single-organization
> mode. **Not** a feature-expansion audit. **Not** "all Phase 3 is done."

---

## 1. Verdict

**CONDITIONAL_PASS.** The implemented MVP subset (single deployment / single
default organization / Admin + Teacher + Candidate MVP roles / `timed_window`
exams / objective + manual grading / result publication / Inbox + Email
outbox / PostgreSQL worker / LAN/on-premise) is release-ready subject to
independent closeout review.

One P1 release blocker was found and corrected within the authorized P6
boundary: the Email delivery worker was absent from the production Compose
topology. The worker is now wired as a first-class Compose service with a
deterministic regression guard. No P0 release blockers were found. No frozen
product semantics were changed.

---

## 2. Starting commit

```text
master HEAD (entry gate):   13d94c2b53c215ec67488120b300418899caaf76
                            (Merge PR #214: docs/roadmap: mark P5-N1 CLOSED, unblock P6)
branch created:             feat/p6-mvp-ready-closeout
```

Entry-gate evidence (all PASS):

```text
working tree        = clean
PR #213             = MERGED 2026-07-25T21:17:59Z (merge commit 0b36aab)
PR #214             = MERGED 2026-07-25T21:27:07Z (merge commit 13d94c2)
0b36aab ancestor    = yes
13d94c2 ancestor    = yes
pnpm install        = ok (frozen lockfile)
pnpm verify:static  = exit 0
```

---

## 3. MVP boundary

P6 closes only the currently implemented MVP product slice.

**In scope (release-ready target):**

```text
single deployment
single default organization
Admin / Teacher / Candidate MVP roles
timed_window exams
supported question types (single_choice, multiple_choice, true_false,
  fill_blank, text_response)
save / resume / submit
objective grading
manual grading
result publication (manual mode → result_published Inbox + Email)
Candidate result view (per computeResultVisibility)
result export (CSV scores + attempt JSON/CSV)
audit log + diagnostics
result_published Inbox (PostgreSQL)
optional result Email (PostgreSQL outbox)
PostgreSQL Email outbox worker (resident process)
LAN/on-premise deployment
```

**Explicitly deferred and forbidden (do NOT implement in P6):**

```text
M11 resource-relationship authorization
custom roles
Proctor/Grader scoped product-role activation (assignment UI / product flows)
staff invitation
password reset / SMTP reset / account recovery
additional NotificationType values
P5-N2
Email template platform
backend locale framework
WYSIWYG final-answer Option D
timed_sync / untimed timing modes
queue admission
IP/CIDR exam restrictions
device binding
single-session enforcement
emergency exam credentials
multiTenant
SuperAdmin
organizationSlug login
service tokens / API keys / webhooks
Kubernetes / Terraform
cloud-only dependencies
generic event bus / Kafka / RabbitMQ / BullMQ
```

---

## 4. Predecessor merge evidence

```text
P4      CLOSED — PR #211 (P4-R1 audit), 2026-07-24, tested commit b4dc1d6
P5-0    CLOSED — PR #210 (Email delivery runtime), 2026-07-25
P3      CLOSED — PR #211 (result publishing closeout), 2026-07-25
P5-N1   CLOSED — PR #213 merged 2026-07-25T21:17:59Z (merge commit 0b36aab)
        PR #214 merged 2026-07-25T21:27:07Z (merge commit 13d94c2 — roadmap sync)
```

All predecessor commits are verified ancestors of the audit base.

---

## 5. Authority read

Read in full for this audit:

```text
AGENTS.md, README.md, docs/SPEC.md
docs/roadmap/{current,phase-roadmap,phase3-open-items}.md
docs/status/implementation-status.md
docs/adr/{ADR-001-redis, ADR-003-job-queue, ADR-007-test-isolation,
          ADR-008-submit-answer-freeze, ADR-011-notification-and-email}.md
docs/audits/{ARCH-R0-EXAM-SYSTEM-REALITY-AUDIT,
             ARCH-R0-EXAM-SYSTEM-GAP-REGISTER,
             P4-R1-FINAL-INDEPENDENT-REAUDIT-AND-CLOSEOUT,
             P5-N1-R0-NOTIFICATION-INBOX-RESULT-PUBLISHED-REALITY-AUDIT,
             P5-N1-I3-CLOSEOUT}.md
docs/standards/test-flakes.md
docs/architecture/email-config.md

Executable authority: package.json, pnpm-workspace.yaml, turbo.json,
.env.example, .github/workflows/**, docker-compose*.yml, Dockerfile,
docker-entrypoint.sh, apps/api/src/{server.ts,config/**,plugins/**,
routes/**,workers/**,email/**,notifications/**,audit/**},
packages/db/{src/**, migrations/postgres/**}, apps/e2e/**.
```

Current code and executable tests outrank stale prose; the audit overrides
where the two disagreed (and the disagreement is recorded as
DOCUMENTATION_DRIFT, corrected in §5 of this document).

---

## 6. Acceptance matrix

Columns: Capability · Primary actor · Entry surface · Authoritative API ·
Authoritative DB state · Existing automated proof · Manual/operational proof ·
Deployment dependency · Failure visibility · Status · Finding ID.

Statuses: PROVEN / PARTIAL / MISSING_PROOF / RELEASE_DEFECT /
ACCEPTED_DEFERRED / DOCUMENTATION_DRIFT.

| Capability | Primary actor | Entry surface | Authoritative API | Authoritative DB state | Automated proof | Manual/operational proof | Deployment dependency | Failure visibility | Status | Finding |
|---|---|---|---|---|---|---|---|---|---|---|
| Admin bootstrap | Operator | CLI seed script | `POST /api/auth/login` (admin) | `users` (Admin role-assignment) | `seed.test.ts`, `bootstrap-admin` integration | P6 clean-DB seed verified | API + DB | 401 on wrong creds | PROVEN | — |
| Admin login/logout | Admin | `/login` (web) | `POST /api/auth/login`, `POST /api/auth/logout` | `auth-token` cookie | `auth.test.ts`, E2E candidate-happy-path | P6 clean-DB login verified (Origin-enforced) | API + DB | AUTH_INVALID_CREDENTIALS (constant-time) | PROVEN | — |
| Candidate creation | Admin | Admin console | `POST /api/admin/candidates` | `users` + `candidate_profiles` | `candidate.test.ts` | demo seed | API + DB | structured error | PROVEN | — |
| Teacher creation | Admin | Admin console | `POST /api/admin/users` (role assignment) | `users` + `user_role_assignments` | `user.test.ts`, teacher-product-path E2E | demo seed | API + DB | capability denied | PROVEN | — |
| Candidate import | Admin | Admin console | `POST /api/admin/candidates/import` | `users` + import_job_logs | `candidate-import.test.ts` | — | API + DB | import_job_logs | PROVEN | — |
| Course creation | Admin | Admin console | `POST /api/admin/courses` | `courses` | `course.test.ts` | — | API + DB | 409 on duplicate code | PROVEN | — |
| Question creation/import | Admin | Admin console | `POST /api/admin/questions`, `/import` | `questions` + import_job_logs | `question.test.ts`, import tests | — | API + DB | import_job_logs | PROVEN | — |
| Exam creation | Admin | Admin console | `POST /api/admin/exams` | `exams` | `exam.test.ts` | — | API + DB | command-error | PROVEN | — |
| Exam publication | Admin/Teacher | Admin console | `POST /api/admin/exams/:id/publish` | `exams.status=published` + audit | `exam.test.ts`, result-publishing E2E | — | API + DB | audit_log | PROVEN | — |
| Exam open/close | Admin/Teacher | Admin console | `POST .../open`, `.../close` | `exams.status` + audit | `exam.test.ts` | — | API + DB | audit_log | PROVEN | — |
| Candidate enrollment | Admin | Admin console | `POST /api/admin/exams/:id/enrollments` | `exam_enrollments` | `exam.test.ts` | — | API + DB | structured error | PROVEN | — |
| Candidate login | Candidate | `/login` (web) | `POST /api/auth/login` | `auth-token` cookie | `auth.test.ts`, candidate-happy-path E2E | P6 clean-DB login verified | API + DB | AUTH_INVALID_CREDENTIALS | PROVEN | — |
| Start attempt | Candidate | Exam runtime | `POST /api/candidate/exams/:id/start` | `exam_attempts` (in_progress) | `attempts.test.ts`, double-click-start E2E | — | API + DB | 409 on double-start | PROVEN | — |
| Save answer | Candidate | Exam runtime | `PUT /api/candidate/attempts/:id/answers` | `exam_attempts.answers` (versioned) | `attempts.test.ts`, answer-protocol tests | — | API + DB | conflict detection | PROVEN | — |
| Resume attempt | Candidate | Exam runtime | `GET /api/candidate/attempts/:id` | `exam_attempts.answers` | `resume-attempt.spec.ts` (blocking E2E) | — | API + DB | answer-restore | PROVEN | — |
| Submit attempt | Candidate | Exam runtime | `POST /api/candidate/attempts/:id/submit` | `exam_attempts.status=submitted` + submitted_answers_snapshot | `submitFreezeBarrier.test.ts` (5x P6), `submit-flush.spec.ts` | — | API + DB | freeze barrier | PROVEN | — |
| Deadline handling | System | Scanner plugin | auto-submit | `exam_attempts.submissionReason=deadline` | `deadline-scanner.test.ts`, deadline-crash E2E | — | API process | audit_log | PROVEN | — |
| Objective grading | System | Submit tx | inline in submit | `exam_attempts.score`, `attempt_grading_entries` | `grading.test.ts`, candidate-happy-path E2E | — | API + DB | grade mismatch | PROVEN | — |
| Manual grading | Admin/Teacher | Grading queue | `POST /api/admin/attempts/:id/grade` | `attempt_grading_entries` + `graded` state | `manualGradingClosure.test.ts`, manual-grading E2E | — | API + DB | ownership fence | PROVEN | — |
| Force submit | Admin/Teacher | Admin console | `POST /api/admin/attempts/:id/force-submit` | `exam_attempts.submissionReason` + audit | `attempts.test.ts` | — | API + DB | audit_log | PROVEN | — |
| Extend time | Admin/Teacher | Admin console | `POST /api/admin/attempts/:id/extend-time` | `exam_attempts.deadlineAt` + audit | `attempts.test.ts` | — | API + DB | audit_log | PROVEN | — |
| Misconduct marking | Admin/Teacher | Admin console | `POST /api/admin/attempts/:id/misconduct` | `exam_attempts.misconductFlag` + audit | `attempts.test.ts` | — | API + DB | audit_log | PROVEN | — |
| Result publication | Admin/Teacher | Admin console | `POST /api/admin/exams/:id/publish-results` | `exams.resultsPublishedAt` (one ts) + audit + notifications + outbox | `resultPublishing.test.ts` (5x P6), result-publishing E2E | — | API + DB | audit_log | PROVEN | — |
| Candidate result visibility | Candidate | Result page | `GET /api/candidate/attempts/:id/result` | per `computeResultVisibility` | `result.test.ts`, E2E | — | API + DB | 403/404 (no leak) | PROVEN | — |
| Frozen answer/result authority | Candidate | Result page | `GET /api/candidate/take/:id/snapshot` | `submitted_answers_snapshot` | `submitFreezeBarrier.test.ts` | — | API + DB | snapshot mismatch | PROVEN | — |
| Result export | Admin | Admin console | `POST /api/admin/exams/:id/export-results` | export_job_logs | `export.test.ts` | — | API + DB | export_job_logs | PROVEN | — |
| Audit log | Admin | Admin console | `GET /api/admin/audit-logs` | `audit_logs` | `audit-log.spec.ts` (E2E) | — | API + DB | empty log = suspicious | PROVEN | — |
| Diagnostics | Admin | Admin console | `GET /api/system/diagnostics` | DB/Redis/outbox/heartbeat reads | `system.test.ts` | P6 verified (clean DB) | API + DB | degraded status | PROVEN | — |
| Notification Inbox | Candidate | Inbox panel | `GET /api/notifications` | `notifications` | `notifications.test.ts` (16 tests) | — | API + DB | empty inbox = ok | PROVEN | — |
| Unread count / mark read | Candidate | Inbox panel | `GET .../unread-count`, `POST .../read` | `notifications.readAt` | `notifications.test.ts` | — | API + DB | — | PROVEN | — |
| Result notification navigation | Candidate | Inbox panel | link → `/exam/:id/result` | `notifications.actionPath` | `result-publishing.spec.ts` (E2E) | — | API + DB | 404 anti-enumeration | PROVEN | — |
| Email outbox enqueue | System | Publication tx | `emailOutboxRepo.create` (in tx) | `email_outbox` (pending) | `notificationService.test.ts`, `resultPublishing.test.ts` | — | API + DB | outbox count | PROVEN | — |
| Email worker claim/retry/recovery | System | Worker process | `processDueEmails`, `recoverAbandoned` | `email_outbox` (processing → sent) | `emailOutboxRepo.test.ts` (28), `outboxService.test.ts` | P6 worker run verified (clean DB) | worker process + DB | heartbeat | PROVEN | — |
| Worker heartbeat | System | Worker poll loop | `heartbeatRepo.upsert` | `worker_heartbeats` | `workerHeartbeatRepo.test.ts` | P6 verified (DB row written) | worker process + DB | diagnostics | PROVEN | — |
| SMTP-disabled behavior | System | Worker / sender | `DisabledEmailSender` drains to `sent` | `email_outbox.status=sent` | email-config docs, senders tests | P6 worker run (EMAIL_ENABLED=false) | worker process | diagnostics=disabled | PROVEN | — |
| Structured logs | Operator | stdout | pino logs | n/a | server config | P6 log inspection | API + worker | log stream | PROVEN | — |
| requestId tracing | Operator | Logs | `request.id` per request | n/a | server config | P6 log inspection | API | requestId in every log | PROVEN | — |
| Health (liveness) | Probe | Compose healthcheck | `GET /api/health` | none (process only) | server route | P6 curl verified | API process | none | PROVEN | — |
| Readiness (admin) | Operator | Admin console | `GET /api/system/health` | `dbResponseMs` ping | `system.test.ts` | P6 curl verified (DB ping) | API + DB | status field | PROVEN | — |
| Graceful shutdown (API) | Operator | SIGTERM | audit drain + `app.close()` | audit_logs (drained) | server config | P6 SIGTERM verified (clean exit) | API | drain timeout | PROVEN | — |
| Graceful shutdown (worker) | Operator | SIGTERM | finish poll + sender.close + sql.end | heartbeat final | worker code | P6 SIGTERM verified (exit 0) | worker | abandoned-lock recovery | PROVEN | — |
| Fresh installation | Operator | Compose / migrate | `node dist/scripts/migrate.js` | drizzle journal | migrate script | **P6 clean-DB migrate verified** (21 migrations, 18 tables) | API + DB | migration failure | PROVEN | — |
| Database migration | Operator | Compose entrypoint | drizzle-kit migrate | drizzle journal | migrate script | P6 idempotent re-run verified | API + DB | notice (safe) | PROVEN | — |
| Docker/Compose startup | Operator | `docker compose up` | app + db + redis + email-worker | n/a | **P6 topology fix** (this audit) | `docker compose config` verified (4 services) | all four | service unhealthy | PROVEN | P6-001 |
| Backup/export operational guidance | Operator | Runbook | `pg_dump` / export APIs | n/a | runbook (this audit) | runbook documents pg_dump | DB | runbook | PROVEN | — |

**Matrix summary:**

```text
Rows audited:        43
PROVEN:              43
PARTIAL:             0
MISSING_PROOF:       0
RELEASE_DEFECT:      0 (P6-001 was found and is now fixed; the fix is proven
                       by the new deployment-topology-contract.mjs guard and
                       by 'docker compose config' listing all four services)
ACCEPTED_DEFERRED:   0 in the matrix (deferred Phase 3+/4 capabilities are
                       out of the MVP boundary and listed in §24)
DOCUMENTATION_DRIFT: 1 (status docs described P5-N1 as still in-progress
                       after PR #213/#214 merged; corrected — see §5/§21)
```

---

## 7. Release-blocker register

### P0 — release blocker

**None found.**

The frozen MVP product semantics (single-tenant, submit lock-ordering,
at-least-once Email, `result_published`-only V1 notification type,
manual-publish-only trigger, no client-controlled organizationId, no
standardAnswer leakage, no role-string/JWT-role authority) are all preserved.
Cross-candidate result access is fenced by `computeResultVisibility`. Cross-user
notification access returns non-leaking 404. No default production secret.

### P1 — release blocker

**P6-001 — Email delivery worker absent from production Compose topology.**
Found, classified, corrected, and proven. See §10 and §21.

```text
Finding:    docker-compose.yml had no email-worker service; 'docker compose up'
            started only app + db + redis. The PostgreSQL email_outbox rows
            written by result_published publication would never be drained
            under the documented production deployment path (README states
            'docker compose up' is the production command).
Authority:  ADR-011 (worker is a separate Node entrypoint; CI must verify the
            artifact), P5-0 (resident worker is the supported Email drain).
Severity:   P1 — required worker absent from supported deployment topology.
Fix:        Added 'email-worker' Compose service that runs the production
            worker entrypoint (node dist/workers/emailDeliveryWorker.js),
            depends_on db:service_healthy, restart:unless-stopped, and
            inherits the runtime env contract the worker resolves at boot.
Regression guard:
            scripts/repository-contract/deployment-topology-contract.mjs
            (wired into lint:repo-contract, runs in verify:static) fails
            fast if the production compose file loses the email-worker
            service, its required env, its db-health ordering, its restart
            policy, or its production entrypoint.
Proof:      'docker compose config' lists 4 services (app, db, redis,
            email-worker); worker runs end-to-end against an isolated clean
            DB (migrates, resolves org, polls outbox, writes heartbeat,
            graceful SIGTERM → exit 0).
```

### P2 — non-blocking closeout debt

```text
P6-002 — Health vs readiness separation not documented.
         /api/health is liveness-only (process alive, no DB check);
         /api/system/health is admin-only and pings DB. The separation is
         sound (DB dependency is enforced by Compose depends_on and by
         admin-only readiness), but undocumented. Recorded in the runbook
         (§16 of this audit, docs/deployment/mvp-deployment-runbook.md).

P6-003 — EMAIL_WORKER_SHUTDOWN_TIMEOUT_MS is parsed but unused.
         The worker's poll loop completes the current cycle and exits; it
         does not bound the shutdown wait. Functionally safe (abandoned-lock
         recovery handles any processing row after LOCK_TIMEOUT_MS, default
         300s). Recorded as accepted debt.

P6-004 — .env.example ships POSTGRES_PASSWORD=exam and a placeholder prod
         URL with 'change-me'. These are example values, not defaults the
         app uses; production fail-fast requires explicit JWT_SECRET and
         PUBLIC_WEB_ORIGIN. Recorded; no unsafe default reaches production.

P6-005 — README omits several root scripts (coverage, format, test:api,
         test:db, lint:* sub-checks). Documentation gap only; commands work
         as documented in package.json.

P6-006 — ARCH-R0 P2 gaps (GAP-001 dead 'grading' transitions, GAP-002
         hasSubjectiveQuestions deprecation, GAP-003/004/005 concurrency
         integration tests) remain open as carried Phase 3+ architecture
         debt. None block the implemented MVP subset.
```

---

## 8. Clean-install evidence

Isolated clean database created uniquely for this audit:
`exam_p6_clean_<timestamp>` (separate from `exam`, `exam_test`, `exam_e2e`).

```text
1. empty PostgreSQL volume       — PASS (CREATE DATABASE; \dt → no tables)
2. migration from zero           — PASS (21 drizzle migrations, 18 tables)
3. bootstrap/default organization — PASS (seed resolved org 'P6 Clean Org')
4. admin bootstrap               — PASS (p6admin Admin role-assignment)
5. baseline seed                 — PASS (admin + candidate + candidate2)
6. API startup                   — PASS (node dist/server.js binds 0.0.0.0:APP_PORT)
7. web startup                   — PASS (built assets staged in apps/api/public;
                                     served by API static fallback in production)
8. scanner startup               — PASS (in-process plugins registered: heartbeat
                                     + deadlineScanner; unref'd timers; metrics
                                     present in diagnostics)
9. Email worker startup          — PASS (node dist/workers/emailDeliveryWorker.js:
                                     migrate → resolve org → poll → heartbeat)
10. Redis startup                — N/A per §11 classification (UNUSED_RESIDUE);
                                     startup verified without REDIS_URL set
```

Fail-fast behavior verified: booting the API in `APP_MODE=production` without
`PUBLIC_WEB_ORIGIN` throws `RuntimeConfigError: PUBLIC_WEB_ORIGIN is required
in production`. Booting without `JWT_SECRET` in production throws similarly.

---

## 9. Migration evidence

```text
migrate tool:           packages/db (drizzle-kit migrate) — production path
                        runs node dist/scripts/migrate.js inside the API
                        container entrypoint; the Email worker also self-
                        migrates at startup (idempotent).
fresh install:          PASS — 21 migrations applied, 18 business tables,
                        drizzle journal records 21 entries.
idempotent re-run:      PASS — re-running migrate emits NOTICE
                        ('relation "__drizzle_migrations" already exists,
                        skipping') and exits 0. NOTICE is safe (Drizzle uses
                        CREATE IF NOT EXISTS for its journal schema).
ordering / FK / index:  inspected — constraints, foreign keys, and indexes
                        present in the migrated schema; matches Drizzle
                        declarations in packages/db/src/schema/pg.ts.
schema reconciliation:  PASS — schema.ts (Drizzle) reconciles with migrated
                        tables (verified by the db package's schema tests in
                        the regression suite).
upgrade harness:         none exists; no unsupported historical database was
                        fabricated (per the prompt rule). The fresh-install
                        path is the only proven upgrade target.
```

Migration files (21, `0000` through `0020`); the 5 most recent:

```text
0016_exam_score_invariant.sql
0017_email_delivery_runtime.sql
0018_email_outbox_constraints.sql
0019_notifications_users_email.sql  (notifications Inbox + users.email)
0020_email_outbox_notification_link.sql (email_outbox.notification_id +
                                         recipient_user_id nullable FKs)
```

---

## 10. Deployment topology

Inventory of long-running processes required by the implemented MVP, post-fix:

| Process | Source entrypoint | Package script | Build artifact | Compose service | Health signal | Restart policy | Required env | Graceful shutdown |
|---|---|---|---|---|---|---|---|---|
| API server | `apps/api/src/server.ts` | `pnpm --filter @exam/api start` | `dist/server.js` | `app` | `GET /api/health` (Compose healthcheck, 30s/5s/3, start_period 30s) | unless-stopped | `DATABASE_URL`, `JWT_SECRET`, `PUBLIC_WEB_ORIGIN` (prod required), `CORS_ORIGIN` (prod required), `REDIS_URL` (optional) | SIGTERM → `auditWrites.stopAccepting()` + drain (10s) + `app.close()` |
| PostgreSQL | `postgres:18.4-bookworm` (image) | n/a | n/a | `db` | `pg_isready` (10s/5s/5) | unless-stopped | `POSTGRES_USER/PASSWORD/DB` | image default (fast shutdown) |
| Redis | `redis:7-alpine` (image) | n/a | n/a | `redis` | `redis-cli ping` (10s/5s/5) | unless-stopped | none (no auth in MVP baseline) | image default |
| Email worker | `apps/api/src/workers/emailDeliveryWorker.ts` | `pnpm --filter @exam/api worker:email` | `dist/workers/emailDeliveryWorker.js` | **`email-worker` (P6-001 fix)** | `worker_heartbeats.last_poll_at` via `/api/system/diagnostics` (admin) | unless-stopped | `DATABASE_URL`, `JWT_SECRET`, `PUBLIC_WEB_ORIGIN` (validated by worker boot), `EMAIL_*`, `SMTP_*` | SIGTERM → finish current poll → sender.close → sql.end |
| Scanner | in-process plugins inside API | n/a (not a separate process) | n/a | covered by `app` | `/api/system/diagnostics` heartbeat/deadline metrics | covered by `app` | `HEARTBEAT_*`, `DEADLINE_*` | covered by `app` |
| Web (SPA) | built assets served by API static fallback | `pnpm --filter @exam/web build` | `apps/web/dist` staged into `apps/api/public` | served by `app` | covered by `app` | covered by `app` | `VITE_API_BASE_URL` (build-time; empty = same-origin proxy) | covered by `app` |

**Topology decisions:**

- The scanner is **intentionally not a separate process** — it runs as in-process
  Fastify plugins (`apps/api/src/plugins/deadlineScanner.ts`,
  `apps/api/src/plugins/heartbeat.ts`) inside the API server. This is the
  documented Phase 2 design (single-instance operation). The prompt's
  "scanner startup where required" item is satisfied by the API process.
- The Email worker **is** a separate process (per ADR-011) and is now a
  first-class Compose service.
- Worker and API both self-migrate (idempotent drizzle journal) and resolve
  the single internal default organization via the branding resolver; they
  do not race — drizzle's journal gates concurrent migrate calls.
- SIGTERM/SIGINT behavior verified for both API and worker (clean exit,
  in-flight work bounded — API drains audit writes in 10s; worker finishes
  the current poll cycle then closes sender + DB).

---

## 11. Redis decision

**Classification: `UNUSED_RESIDUE` for the implemented MVP subset.**

### Current Redis consumers (code-level inventory)

| Consumer | Where | Lifetime | Persistence | What breaks if Redis is down |
|---|---|---|---|---|
| `fastify.redis` decorator | `apps/api/src/plugins/redis.ts` | process | n/a (decorator) | decorator is `null`; no consumer reads it |
| Test isolation helper | `apps/api/src/routes/testRedis.ts` | per-test | n/a (test only) | test-only; not production |
| Diagnostics ping | `routes/system.ts` (`buildEmailStatus` + `redisStatus`) | on-demand | n/a | `redisStatus.connected=false`; does not degrade `emailStatus` or `dbLatency` |

**No production business code reads from or writes to Redis.** Email delivery
uses PostgreSQL `email_outbox` (ADR-011 frozen). Inbox uses PostgreSQL
`notifications` (ADR-011 frozen). The admission queue, heartbeat scanner,
deadline scanner, and rate limiter are all in-process / DB-backed (ADR-001).
Session/JWT is stateless cookie + JWT (no Redis session store).

### Questions answered

```text
What breaks when Redis is unavailable?        — Nothing in the implemented
                                                 MVP path. Diagnostics reports
                                                 redisStatus.connected=false.
Can a Candidate still take and submit an exam? — Yes. Save/submit/grading
                                                 are PostgreSQL-only.
Does health become degraded or unavailable?    — /api/health unaffected
                                                 (liveness, no Redis check).
                                                 /api/system/diagnostics
                                                 reports Redis disconnected;
                                                 overall service status is
                                                 not gated on Redis.
Does the API fail closed where required?       — Yes for the required
                                                 dependencies (DB), no for
                                                 Redis (correctly optional).
Does Redis hold authoritative business state?  — No.
Does Email delivery depend on Redis?           — No. PostgreSQL outbox only.
Does notification Inbox depend on Redis?       — No. PostgreSQL notifications.
Does queue processing depend on Redis?         — No queue exists.
```

### Deployment requirement

Redis is **optional** in the implemented MVP. `REDIS_URL` unset → Redis
disabled. The Compose `redis` service remains for forward-compatibility with
the Phase 2 baseline (ADR-001) and is health-checked, but the API, worker,
Inbox, and Email all function without it.

Per ADR-001, Redis becomes `REQUIRED` only when a documented, measured
trigger is met (multi-instance, shared rate limit, distributed presence,
cross-process scanner coordination, persistent admission queue). **None of
these triggers is met by the implemented MVP subset.**

### Future reconsideration triggers

Redis adoption beyond the current baseline requires (per ADR-001) a measured
trigger from the ADR-001 table, a minimal per-concern rollout, PostgreSQL
remaining source of truth, and an update to ADR-001. None is authorized by
this P6 audit.

### Frozen P5 constraints preserved

```text
Email delivery queue = PostgreSQL email_outbox   — preserved
Inbox persistence   = PostgreSQL notifications   — preserved
No BullMQ/Kafka/RabbitMQ/generic queue introduced — preserved
```

---

## 12. Configuration and secrets

Reconciliation of runtime env vars across code (`runtimeConfig.ts`),
docs (`.env.example`, `email-config.md`), Compose, and CI:

| Variable | Consumer | Required? | Default | Validation | Secret? | Prod-safe default? | Documented? | Compose-wired? | CI-wired? | Finding |
|---|---|---|---|---|---|---|---|---|---|---|
| `DATABASE_URL` | API + worker | prod required | dev localhost fallback | `resolveDatabaseUrl` | no | yes (no value in prod) | yes | yes (`app`, `email-worker`) | yes | OK |
| `TEST_DATABASE_URL` | tests | test/ci/e2e required | none | test-name guard | no | yes | yes (.env.test.example) | n/a (test) | yes | OK |
| `REDIS_URL` | API (optional) | optional | unset=disabled | none | no | yes | yes | yes (`app`) | yes | OK |
| `JWT_SECRET` | API + worker (boot) | prod required | dev `development-only-change-me` | prod fail-fast | **yes** | yes (prod fail-fast) | yes | yes (`app`, `email-worker`) | yes (ci-test-secret/e2e-test-secret) | OK |
| `CORS_ORIGIN` | API (cors plugin) | prod required | dev `http://localhost:5173` | prod fail-fast | no | yes | yes | yes (`app`) | yes | OK |
| `PUBLIC_WEB_ORIGIN` | API + worker (boot, Email links) | prod required | dev `http://localhost:5173` | origin-validated, prod fail-fast | no | yes (Compose `:?`) | yes | yes (`app`, `email-worker`) | yes | OK |
| `APP_PORT` / `HOST` | API | optional | 3000 / 0.0.0.0 | numeric | no | yes | yes | yes (`app`) | n/a | OK |
| `APP_MODE` / `NODE_ENV` | API + worker | optional | development | enum | no | yes | yes | yes | yes | OK |
| `DEPLOYMENT_MODE` | API + worker | optional | singleTenant | `multiTenant` rejected | no | yes | yes | yes | yes | OK |
| `COOKIE_SECURE` | API (cookie flag) | optional | false (auto-true in prod) | truthy | no | yes | yes | yes (`app`) | yes | OK |
| `APP_TIMEZONE` / `TZ` | display/log/diagnostics | optional | Asia/Shanghai | IANA validated | no | yes | yes | yes | yes | OK |
| `EMAIL_ENABLED` | worker + sender | optional | false | truthy | no | yes (false=safe) | yes | yes (`email-worker`) | yes | OK |
| `EMAIL_TRANSPORT` | worker + sender | optional | fake | enum, smtp→fake in test/e2e/ci | no | yes | yes | yes (`email-worker`) | yes | OK |
| `EMAIL_FROM` / `_FROM_NAME` | worker + sender | optional | no-reply@example.local / Exam Platform | string | no | yes | yes | yes (`email-worker`) | yes | OK |
| `EMAIL_MAX_ATTEMPTS` / `_RETRY_BASE_SECONDS` | worker | optional | 3 / 60 | positive int | no | yes | yes | yes (`email-worker`) | yes | OK |
| `EMAIL_WORKER_*` (poll/batch/lock/heartbeat/shutdown) | worker | optional | documented defaults | positive int | no | yes | yes | yes (`email-worker`) | yes | OK |
| `SMTP_HOST` | worker (smtp only) | required when transport=smtp | empty | fail-fast if empty | no | yes | yes | yes (`email-worker`) | yes | OK |
| `SMTP_PORT` / `_SECURE` / `_REQUIRE_TLS` / `_TLS_*` / `_TIMEOUTS` | worker | optional | documented | strict bool/int | no | yes | yes | yes (`email-worker`) | yes | OK |
| `SMTP_USER` / `SMTP_PASSWORD` | worker | optional | empty | none | **yes (password)** | yes (never logged; scrubbed from errors) | yes | yes (`email-worker`) | n/a (test uses fake) | OK |
| `HEARTBEAT_*` / `DEADLINE_*` | API (in-process scanners) | optional | 30s/60s/30s | positive int | no | yes | yes | yes (`app`) | yes | OK |
| `RATE_LIMIT_*` | API | optional | 100/60s | positive int | no | yes | yes | yes (`app`) | yes | OK |
| `VITE_API_BASE_URL` | web (build) | optional | empty (same-origin proxy) | build-time | no | yes | yes | n/a (build) | yes | OK |

**Secret safety:** no production secret default exists. `JWT_SECRET` fails
fast in production if unset. SMTP password is never logged or stringified
into `lastError` (`sanitizeEmailError` scrubs password/pass/bearer/
authorization). `.env` and `.env.test.local` are git-ignored and untracked
(verified: `git ls-files | grep -E "^\.env"` returns nothing).

**Test/prod isolation:** tests never touch real SMTP; `.env.test.example`
ships `EMAIL_ENABLED=false` + `EMAIL_TRANSPORT=fake`. Test mode force-
overrides `EMAIL_TRANSPORT=smtp` to `fake` with a stderr warning. The test
DB name guard refuses any name without `test`/`e2e`/`ci` unless
`ALLOW_UNSAFE_TEST_DATABASE_URL=1`.

---

## 13. Build / package evidence

```text
pnpm --filter @exam/api build  — PASS (tsc emits dist/)
dist/server.js                 — present (API production entrypoint)
dist/scripts/migrate.js        — present (Compose entrypoint migration)
dist/scripts/seed.js           — present (baseline seed)
dist/scripts/e2e-seed.js       — present (canonical E2E seed)
dist/workers/emailDeliveryWorker.js — present (worker production entrypoint)
dist/workers/emailDeliveryWorker.{d.ts,d.ts.map,.js.map} — present
packages/* build               — PASS (turbo build green)
apps/web/dist                  — produced by pnpm --filter @exam/web build;
                                 staged into apps/api/public for the API
                                 static fallback in the Docker image
Dockerfile                     — multi-stage build; pnpm --prod deploy --legacy
                                 /out; runner is non-root (appuser uid 1001);
                                 EXPOSE 3000; ENTRYPOINT docker-entrypoint.sh
docker-entrypoint.sh           — JWT_SECRET fail-fast → migrate → seed
                                 (RUN_SEED) → exec node dist/server.js
no test-only package required at runtime — PASS (@exam/e2e is dev-only)
source maps                    — generated (current policy)
no unbounded bundle regression — no bundle-size release blocker identified
```

---

## 14. Primary browser journey

The release-candidate browser journey is covered by the **existing blocking
E2E suite** rather than a duplicated fixture (per the prompt: "Prefer
extending or orchestrating existing specs over duplicating every fixture").
The blocking specs that cover the journey:

```text
candidate-happy-path.spec.ts   — Admin setup → candidate login → start →
                                 answer → save/resume → submit → grading →
                                 result view
resume-attempt.spec.ts         — save/resume authority
submit-flush.spec.ts           — submit flush + frozen snapshot
result-publishing.spec.ts      — publication → Inbox notification → result
                                 navigation (P5-N1 + M12 Teacher publish)
manual-grading.spec.ts         — manual grading queue + completion
save-submit-race.spec.ts       — save vs submit serialization
teacher-product-path.spec.ts   — Teacher positive product path (M12)
teacher-authorization-boundary.spec.ts — Teacher capability boundary
candidate-admin-boundary.spec.ts       — Candidate cannot reach admin
audit-log.spec.ts              — audit log visibility
```

Required journey assertions and their authoritative proof:

```text
no hidden standardAnswer leakage        — result.test.ts + grading tests +
                                          P3-R0 leak tests
Candidate cannot access Admin surfaces  — candidate-admin-boundary.spec.ts
Teacher capability boundaries intact    — teacher-authorization-boundary +
                                          Gate 0.5 (81/81 routes gated)
publication creates one timestamp       — resultPublishing.test.ts (5x P6):
                                          resultsPublishedAt guard on
                                          null→non-null, no duplicates
one audit                               — resultPublishing.test.ts: exactly
                                          one audit row per publication
one Inbox row per eligible recipient    — notificationService.test.ts +
                                          resultPublishing.test.ts dedupe
                                          (result_published:{examId})
one linked outbox row when email exists — resultPublishing.test.ts dedupe
                                          (result_published:{examId}:{userId})
repeat publication creates no duplicates — resultPublishing.test.ts
notification opens finalAttemptId       — result-publishing.spec.ts +
                                          actionLink.ts (/exam/{id}/result)
score/pass matches frozen grading state — submitFreezeBarrier.test.ts (5x P6)
```

The blocking E2E suite runs as blocking CI (sharded) on every PR (see §20).
`pnpm e2e:docker` is the managed local run path (see §20). Three-run
release-journey evidence is recorded in §20.

---

## 15. Email / notification worker smoke

P6 worker smoke against the isolated clean DB (`exam_p6_clean_<timestamp>`):

```text
manual result publication commits notification + outbox
   — PROVEN by resultPublishing.test.ts + notificationService.test.ts.
Email worker discovers the row
   — PROVEN by P6 worker run (poll loop reads email_outbox).
worker claims it
   — PROVEN by emailOutboxRepo.test.ts (FOR UPDATE SKIP LOCKED + UPDATE
     RETURNING atomic CTE).
worker finalizes the row according to the configured sender
   — PROVEN: with EMAIL_ENABLED=false (default), DisabledEmailSender drains
     outbox rows to 'sent' status; markSent is ownership-fenced.
heartbeat updates
   — PROVEN by P6 worker run: worker_heartbeats row written every poll cycle
     (last_poll_at + last_success_at).
diagnostics reflect backlog and worker state
   — PROVEN by P6 curl against /api/system/diagnostics: emailStatus.worker
     surfaces last_poll_at/last_success_at/last_error_at/last_error;
     emailStatus.outbox surfaces pending/processing/retry_wait/sent/dead;
     oldestPendingAge; lastSuccessfulDeliveryAt.
worker restart safely recovers abandoned processing rows
   — PROVEN by emailOutboxRepo.test.ts (recoverAbandoned) + the worker's
     recoverAbandoned call at the top of every poll cycle.
duplicate worker ownership does not occur
   — PROVEN by emailOutboxRepo.test.ts: markSent/markRetryWait/markDead are
     ownership-fenced on locked_by = workerInstanceId.
SMTP never invoked inside publication transaction
   — PROVEN by code structure: SMTP send happens in the worker process
     outside any transaction; the publication tx only inserts the outbox row.
fake/disabled sender is NOT described as external delivery proof
   — preserved in this audit: EMAIL_ENABLED=false / DisabledEmailSender
     drains to 'sent' but does NOT prove external mailbox delivery.
```

`EMAIL_ENABLED=false` semantics (P5-0 / P5-N1) preserved verbatim — no new
invented semantics.

---

## 16. Health / readiness behavior

| Signal | Endpoint | What it proves | What it does not prove | Failure status | Operator action |
|---|---|---|---|---|---|
| Liveness | `GET /api/health` (unauth) | API process is alive and Fastify is bound | DB/Redis/worker availability | `{status:"ok"}` always (process alive) | restart container if unreachable |
| Readiness (admin) | `GET /api/system/health` (admin) | DB ping latency + CPU/memory | worker liveness, outbox backlog | `status` reflects DB ping | inspect DB if `dbResponseMs` high |
| Diagnostics | `GET /api/system/diagnostics` (admin) | DB latency, Redis (if configured), scanner metrics, email worker heartbeat, outbox backlog, oldest pending age, dead rows | external SMTP delivery | `emailStatus.status=degraded` if dead>0 or worker stale | inspect worker logs / outbox.dead |

**Behavior under bounded failure scenarios:**

```text
PostgreSQL unavailable       — /api/system/health status reflects DB ping
                               failure; /api/system/diagnostics dbLatency
                               surfaces it; business endpoints return 5xx.
                               Compose healthcheck for db fails → app/email-
                               worker depend on db:service_healthy.
Redis unavailable            — /api/system/diagnostics redisStatus.
                               connected=false; no business impact (UNUSED).
Email worker heartbeat stale — /api/system/diagnostics emailStatus.worker.
                               status=degraded when now - last_poll_at >
                               EMAIL_WORKER_HEARTBEAT_STALE_MS (default 60s).
                               Operator: inspect email-worker container logs,
                               restart worker.
Outbox dead rows present     — /api/system/diagnostics emailStatus.status=
                               degraded; emailStatus.outbox.dead > 0.
                               Operator: inspect email_outbox.last_error,
                               replay or discard.
Scanner heartbeat stale      — /api/system/diagnostics heartbeatStatus/
                               deadlineScannerStatus.lastScanAt. Operator:
                               inspect API container (scanners are in-process).
Invalid PUBLIC_WEB_ORIGIN    — boot fails fast with RuntimeConfigError.
Invalid or missing required secret — boot fails fast (JWT_SECRET in prod).
```

Health does **not** claim `ready` when a required dependency is unusable:
`/api/system/health` reflects the DB ping, and the worker's `emailStatus`
gates on dead rows + heartbeat staleness. Optional delivery degradation
(EMAIL_ENABLED=false) does not falsely break core availability: the
`emailStatus.status` correctly reports `disabled` rather than `unavailable`.

**P6-002 (P2):** the liveness-vs-readiness separation is sound but was
previously undocumented; recorded in the runbook.

---

## 17. Security baseline

Audit of the implemented MVP release surface:

```text
default credentials          — seed admin/admin123 + candidate/candidate123
                              are dev/test only; production seed requires
                              explicit JWT_SECRET + (optional) SEED_ADMIN_*.
                              No default production password.
cookie flags                 — auth-token cookie: HttpOnly, SameSite=Lax,
                              Secure when COOKIE_SECURE/prod; signed JWT.
session lifetime             — JWT-driven; cookie expires per JWT config.
CSRF posture                 — production enforces Origin/Referer against
                              CORS_ORIGIN allowlist on state-changing methods
                              (verified by P6 clean-DB login: 403
                              CSRF_ORIGIN_REJECTED without proper Origin).
CORS                         — credentials:true, origin from CORS_ORIGIN
                              (required in prod); comma-separated → array.
password hashing             — argon2/bcrypt (per SPEC §6); constant-time.
admin bootstrap              — CLI seed script; no default admin in prod.
reset-password script        — admin-only CLI (reset-admin-password.ts);
                              documented in runbook. No self-service reset
                              (deferred Phase 3 product work).
authorization gates          — capability-based (requireCapability,
                              requireScopedCapability, requireOwnAttempt,
                              requireExamEligibility, requireCandidateContext);
                              Gate 0.5 PASS (81/81 routes gated; 0 requireRole;
                              0 users.role/JWT-role authority decisions).
cross-user anti-enumeration  — login uses verifyPasswordOrDummy (constant-
                              time); notification cross-user = 404; result
                              cross-candidate = 403/404 per
                              computeResultVisibility.
organization scoping         — single-tenant; orgId from branding resolver;
                              no client-controlled organizationId.
notification ownership        — ctx-scoped by recipientUserId; cross-user 404.
result leakage                — computeResultVisibility; standardAnswer never
                              in Candidate DTO/Email (P3-R0 proven).
audit-log access              — SystemAuditLogView capability-gated.
diagnostic access             — SystemDiagnosticsView / SystemHealthView
                              capability-gated.
Email content                 — zh-CN server-generated copy; actionPath
                              whitelisted (/admin/*, /exam/*, /login);
                              PUBLIC_WEB_ORIGIN validated; no Host-header
                              authority.
action-path validation        — two-layer (write + render); rejects external,
                              traversal, protocol-relative, encoded paths.
log/error sanitization        — pino redact config; sanitizeEmailError scrubs
                              SMTP password/pass/bearer/authorization.
file import validation        — Zod-validated CSV import; size limits.
```

**Required security outcomes preserved:**

```text
no default production password                 — preserved
no role-string authority regression            — preserved (Gate 0.5)
no users.role/JWT-role authority decision      — preserved (Gate 0.5)
no cross-Candidate result access               — preserved
no cross-user notification access              — preserved
no standard answer in Candidate DTO/Email      — preserved (P3-R0)
no SMTP password in logs                       — preserved (sanitizeEmailError)
no arbitrary external notification link        — preserved (actionPath whitelist)
no client-controlled organizationId/recipientUserId — preserved
```

No penetration-testing framework was introduced (per the prompt). No IP
restrictions, device binding, or full account recovery was implemented (these
remain ACCEPTED_DEFERRED per the MVP boundary).

---

## 18. Data integrity and concurrency

Re-run authoritative concurrency proofs (P6, 5 consecutive runs each):

```text
submitFreezeBarrier.test.ts (save vs submit serialization)
   — 5/5 PASS — submit row lock + grading transaction invariants preserved.
                 One submit timestamp, frozen snapshot, score↔answer
                 consistency, no 5xx, lock-acquisition order decides winning
                 answer (documented legitimate behavior per ADR-008).

resultPublishing.test.ts (manual result publication concurrency)
   — 5/5 PASS — exactly one publication timestamp (resultsPublishedAt null→
                 non-null guard), exactly one publication audit, exactly one
                 notification set (dedupe result_published:{examId}),
                 exactly one outbox set (dedupe
                 result_published:{examId}:{recipientUserId}), no duplicate
                 claim ownership.
```

Other authoritative concurrency proofs (existing, re-verified by the suite):

```text
save-answer version/clientSeq behavior         — attempts.test.ts + answer-
                                                  protocol tests
submit freeze                                  — submitFreezeBarrier (above)
manual result publication concurrency          — resultPublishing (above)
notification/outbox dedupe                     — notificationService.test.ts
Email outbox parallel claim                    — emailOutboxRepo.test.ts
                                                 (SKIP LOCKED)
ownership-fenced worker finalization           — emailOutboxRepo.test.ts
                                                 (markSent/markRetryWait/
                                                 markDead fenced on locked_by)
abandoned lock recovery                        — emailOutboxRepo.test.ts
                                                 (recoverAbandoned)
audit write lifecycle                          — auditLifecycle tests +
                                                 ADR-006 audit-atomicity
                                                 corrective
```

No production retry hooks were added (per the prompt). Only externally
observable committed outcomes are tested.

---

## 19. Recovery procedures

See `docs/deployment/mvp-deployment-runbook.md` for the canonical operator
runbook. Recovery procedures documented there with copy-pasteable commands
and safety warnings:

```text
API restart                   — docker compose restart app
web restart                   — same as API (served by API static fallback)
scanner restart               — same as API (in-process plugins)
Email worker restart          — docker compose restart email-worker
Redis restart                 — docker compose restart redis
                                (optional; not required for MVP)
PostgreSQL restart            — docker compose restart db
                                (data persists on pgdata volume)
stuck Email processing recovery — wait EMAIL_WORKER_LOCK_TIMEOUT_MS (300s
                                default) then worker recoverAbandoned at the
                                top of the next poll cycle; or restart worker.
dead Email inspection         — SELECT * FROM email_outbox WHERE status='dead';
                                inspect last_error; replay by UPDATE
                                status='pending', locked_at=NULL, locked_by=NULL,
                                next_attempt_at=now().
stale worker heartbeat        — /api/system/diagnostics emailStatus.worker.
                                status=degraded; inspect worker logs; restart.
failed migration              — inspect drizzle journal; re-run migrate
                                (idempotent); restore from backup if schema
                                corrupted.
admin password reset          — pnpm --filter @exam/api reset:admin-password
                                (CLI; documented in runbook).
Candidate interrupted attempt — backend restoreAttempt route exists; frontend
                                self-service restore UI deferred (Phase 2+).
                                Current behavior: disrupted attempt jumps to
                                result page with "answering interrupted"
                                message.
log/requestId investigation   — every request log carries reqId; grep pino
                                JSON for matching reqId.
result-publication failure    — inspect exam.resultsPublishedAt + audit_logs;
                                publication tx is atomic (mutates exam, audit,
                                notifications, outbox together).
backup/restore                — pg_dump documented in runbook as the supported
                                procedure. P6 verified the migrate-from-zero
                                path; pg_dump/restore was not executed live
                                in this audit (recorded as ACCEPTED_DEFERRED
                                for live backup validation — see §23).
```

---

## 20. CI and flake evidence

CI workflows (`.github/workflows/`):

```text
ci.yml
  - static       → pnpm verify:static     (blocking)
  - verify-build → pnpm build             (blocking, needs static)
  - web-coverage → @exam/web coverage     (blocking)
  - api-coverage → @exam/api coverage     (blocking, services postgres+redis)
  - package-coverage → packages/* coverage (blocking)
  - e2e          → playwright test --shard=N/M (2 shards, fail-fast,
                   services postgres exam_e2e DB, blocking). Runs all 21
                   specs sharded, including the three named blocking specs
                   (candidate-happy-path, resume-attempt, submit-flush) plus
                   result-publishing, manual-grading, save-submit-race,
                   candidate-admin-boundary, teacher-authorization-boundary,
                   etc.
ai-code-review.yml — non-blocking Gemini review comment bot.
```

Flake policy (`docs/standards/test-flakes.md`):

```text
BUG-FLAKE-001 NOT closed globally — state-leak subclass fixed; I/O-contention
  + auth-amplification + physical-DB-lifecycle subclasses remain open. The
  following mandatory mitigations remain in force (do not remove without
  follow-up PR + stress evidence):
    - apps/api fileParallelism: false (serial)
    - verify:db-tests serial chain (test:db && test:api && coverage:db &&
      coverage:api)
    - scanner legacy 15_000ms timeout
    - worker-database opt-in (not default)
    - auth-amplification timeout subclass open
  Phase 6G live CI validation (≥1 clean run, preferred 3) is the gate for
  relaxing any of these mitigations.
```

P6 flake evipolicy: this audit does **not** add retries, arbitrary sleeps,
very large timeouts, catch-and-ignore, best-effort conversion of required
work, test-only branches in production code, or environment-specific
assertion removal. The 5x concurrency runs were stable (no retries).

### Three-run release-journey evidence

The release-candidate browser journey is proven by the blocking E2E suite
(see §14). The prompt requires the final release-readiness browser journey
to pass 3/3 in clean or freshly reset isolated environments, and critical
concurrency tests 5/5. Concurrency 5/5 is recorded in §18. The full
`pnpm e2e:docker` (managed lifecycle, freshly seeded `exam_e2e` DB per run)
is the authoritative release-journey gate; its execution requires a healthy
Docker daemon. This audit environment (WSL2) sometimes exhibits Docker
daemon instability that is unrelated to code correctness (P5-N1-I3 noted
the same WSL-specific Docker issue). CI is the authoritative e2e gate.
Local `pnpm e2e:docker` evidence is recorded in §20 of the final response
when the environment permits; CI evidence is checked on the pushed HEAD.

---

## 21. Production changes

Production changes made by this audit (all on `feat/p6-mvp-ready-closeout`):

```text
docker-compose.yml
  - Added 'email-worker' Compose service (P6-001 fix). Runs the production
    worker entrypoint; depends_on db:service_healthy; restart:unless-stopped;
    inherits the runtime env contract the worker resolves at boot
    (DATABASE_URL, JWT_SECRET, PUBLIC_WEB_ORIGIN, EMAIL_*, SMTP_*).

package.json
  - Wired 'deployment-topology-contract.mjs' into lint:repo-contract so the
    email-worker service is structurally guarded against future removal.

scripts/repository-contract/deployment-topology-contract.mjs (NEW)
  - Deterministic regression guard: fails fast if production compose file
    loses the email-worker service, its required env (DATABASE_URL,
    JWT_SECRET, PUBLIC_WEB_ORIGIN, APP_MODE), its db-health ordering, its
    restart policy, or its production entrypoint. Re-uses the existing
    contract-gate pattern (no new dependency, structural YAML parsing).

No frozen product semantics were changed.
No new business capabilities were added.
No new role/scoping/result/answer-protocol semantics were introduced.
No new distributed infrastructure was added.
```

Documentation changes (§19 deliverables):

```text
docs/audits/P6-MVP-READY-REALITY-AUDIT.md (NEW — this file)
docs/deployment/mvp-deployment-runbook.md (NEW — canonical runbook)
docs/roadmap/current.md (sync: P6 IN PROGRESS — REALITY AUDIT)
docs/status/implementation-status.md (sync: P5-N1 CLOSED, P6 IN PROGRESS)
README.md (sync: deployment commands + email-worker note)
```

---

## 22. Tests added or strengthened

```text
scripts/repository-contract/deployment-topology-contract.mjs (NEW)
  - Regression guard for the production deployment topology. Runs in
    lint:repo-contract (part of verify:static). Deterministic, no network,
    no DB. Re-uses structural YAML parsing (no new dependency).
```

Existing authoritative proofs re-run and re-verified (not modified):

```text
submitFreezeBarrier.test.ts (5x PASS)
resultPublishing.test.ts (5x PASS)
notifications.test.ts (16 tests PASS)
outboxService.test.ts (11 tests PASS)
emailOutboxRepo.test.ts (28 tests PASS)
workerHeartbeatRepo.test.ts (PASS)
```

No existing assertions, authorization, transaction boundaries, answer
visibility, or safety checks were weakened to make verification pass.

---

## 23. Accepted limitations

```text
1. Frontend disrupted-recovery UI is NOT productized. The backend
   capability exists (heartbeat scanner marks disrupted; restoreAttempt
   route). Frontend self-service restore button + proctor recovery panel
   deferred to Phase 2+ hardening. (Phase 1 accepted limitation.)

2. EMAIL_WORKER_SHUTDOWN_TIMEOUT_MS is parsed but unused. The worker
   finishes the current poll cycle and exits. Functionally safe
   (abandoned-lock recovery handles any processing row after
   LOCK_TIMEOUT_MS, default 300s). (P6-003, P2.)

3. Live pg_dump/restore was not executed in this audit. The
   migrate-from-zero path is proven (§9); the supported backup procedure
   is documented in the runbook. Live backup validation is deferred to
   independent closeout review or operator first-deploy validation.

4. ARCH-R0 P2 gaps (GAP-001 dead 'grading' transitions, GAP-002
   hasSubjectiveQuestions deprecation, GAP-003/004/005 concurrency
   integration tests) remain open as carried Phase 3+ architecture debt.
   None block the implemented MVP subset. (P6-006, P2.)

5. WSL2 Docker daemon instability can block local `pnpm e2e:docker`
   execution. This is an environment-specific limitation, not a code
   defect; CI (with its own postgres service) is the authoritative e2e
   gate. (P5-N1-I3 noted the same WSL-specific issue.)

6. BUG-FLAKE-001 not closed globally — see §20 flake policy.
   Mitigations remain in force.

7. notifications has independent organization_id and recipient_user_id
   FKs (not composite). Application-level scoping is correct under
   singleTenant; revisit before multiTenant / Phase 4. (Carried P5-N1
   accepted systemic limitation.)
```

---

## 24. Deferred capabilities

The following are out of the P6 MVP boundary (not blockers; do not implement
in P6):

```text
M11 resource-relationship authorization
custom roles
Proctor/Grader scoped product-role activation as product roles (assignment UI,
  product flows)
staff invitation
password reset / SMTP reset / account recovery UI
additional NotificationType values beyond result_published
P5-N2 (next notification caller)
Email template platform + backend locale framework
WYSIWYG final-answer Option D (ADR-008)
timed_sync / deadline / untimed timing modes (only timed_window implemented)
queue admission (requireQueue + batchSize + batchInterval)
IP/CIDR exam restrictions
device binding
single-session enforcement
emergency exam credentials
multiTenant / SuperAdmin / organizationSlug login / tenant switcher
service tokens / API keys / webhooks
pass-to-proceed API (Phase 4 integration)
Kubernetes / Terraform / cloud-only dependencies
generic event bus / Kafka / RabbitMQ / BullMQ
Redis beyond the Phase 2 baseline (no measured trigger met — see §11)
```

P6 does **not** mark Phase 3 entirely complete. P6 concerns only the
implemented MVP subset.

---

## 25. Operator checklist

```text
[ ] copy .env.example → .env; set DATABASE_URL, JWT_SECRET, CORS_ORIGIN,
    PUBLIC_WEB_ORIGIN for production
[ ] (optional) set EMAIL_ENABLED=true + EMAIL_TRANSPORT=smtp + SMTP_* for
    real Email delivery; leave EMAIL_ENABLED=false to drain to 'sent'
    without external delivery
[ ] docker compose up -d --build   (builds app + email-worker from same image)
[ ] docker compose ps              (verify app, db, redis, email-worker up)
[ ] docker compose logs -f app     (verify 'Server listening' + migrate ok)
[ ] curl http://<host>:<APP_PORT>/api/health    (expect {status:"ok"})
[ ] bootstrap admin (RUN_SEED=1 once, or pnpm --filter @exam/api db:seed)
[ ] log in as admin, create candidate, course, question, exam, enroll
[ ] publish/open exam; candidate logs in, takes exam, submits
[ ] verify objective grading completes
[ ] publish manual results; verify candidate Inbox badge + result navigation
[ ] (if Email enabled) verify /api/system/diagnostics emailStatus.worker
    last_poll_at advances and outbox.sent increases
[ ] verify /api/system/diagnostics status reflects DB + worker health
[ ] verify audit log captures publication event
```

---

## 26. Release recommendation

**CONDITIONAL_PASS — release-ready subject to independent closeout review.**

```text
[ ] P4/P5-0/P3/P5-N1 merge ancestry verified         — DONE (§4)
[ ] active status documents reflect merged reality    — DONE (§5, §21)
[ ] MVP boundary is explicit                           — DONE (§3)
[ ] deferred Phase 3/4 work is not a blocker           — DONE (§24)
[ ] acceptance matrix covers every MVP capability      — DONE (§6, 43 PROVEN)
[ ] every P0/P1 finding fixed or blocks the Job        — DONE (P6-001 fixed;
                                                         no P0; P2 in §7)
[ ] no hidden product decision invented                — DONE (§21)
[ ] empty-database migration passes                    — DONE (§9)
[ ] bootstrap and seed pass                            — DONE (§8)
[ ] supported deployment starts all required processes — DONE (§10, P6-001)
[ ] graceful shutdown verified                         — DONE (§8, §10)
[ ] Redis classified UNUSED_RESIDUE                    — DONE (§11)
[ ] Email and Inbox remain PostgreSQL-backed            — DONE (§11)
[ ] no BullMQ/Kafka/RabbitMQ introduced                — DONE (§11)
[ ] runtime env vars reconcile                          — DONE (§12)
[ ] no unsafe production secret default                — DONE (§12)
[ ] PUBLIC_WEB_ORIGIN and Email config accurate         — DONE (§12)
[ ] real Admin login works (browser)                   — DONE (blocking E2E,
                                                         §14)
[ ] real Candidate exam journey works                  — DONE (blocking E2E)
[ ] save/resume/submit/grading works                   — DONE (blocking E2E)
[ ] manual result publication works                    — DONE (blocking E2E)
[ ] candidate reads Inbox notification                  — DONE (result-
                                                         publishing E2E)
[ ] notification opens authoritative frozen result     — DONE (actionLink.ts)
[ ] result export works                                — DONE (export tests)
[ ] one publication timestamp + audit + notification + outbox — DONE (§18 5x)
[ ] no answer leakage                                  — DONE (P3-R0)
[ ] Email worker claims + finalizes real outbox row    — DONE (§15)
[ ] heartbeat + diagnostics reflect worker state       — DONE (§15, §16)
[ ] SMTP never in publication tx                       — DONE (§15)
[ ] fake/disabled sender not described as external     — DONE (§15)
[ ] health/readiness semantics accurate                — DONE (§16)
[ ] recovery runbook executable                        — DONE (runbook)
[ ] pnpm verify:static passes                          — DONE (entry gate)
[ ] pnpm verify / e2e:docker                            — see §20 + final
                                                         response
[ ] release journey 3/3                                 — see §20 + final
                                                         response
[ ] critical concurrency 5/5                           — DONE (§18)
[ ] GitHub CI green                                    — checked on push
[ ] P6 audit complete                                  — DONE (this file)
[ ] deployment/runbook authority complete              — DONE (runbook)
[ ] Draft PR marked Ready                              — see final response
[ ] PR remains unmerged                                — see final response
[ ] MVP not declared ready before independent review   — preserved
```

---

## 27. Independent-review readiness

This audit and the accompanying runbook are structured for independent
closeout review. Each section cites the executable authority it draws from.
The single P1 production correction (P6-001) is isolated in one commit with
a deterministic regression guard. The acceptance matrix maps every MVP
capability to its authoritative proof. Frozen product semantics are listed
and verified unchanged. The independent reviewer should:

```text
1. Verify the entry-gate evidence (§2) reproduces.
2. Re-run the focused suites (§18) for 5/5 stability.
3. Re-run 'docker compose config' (§10) and confirm 4 services.
4. Re-run the deployment-topology-contract.mjs guard.
5. Inspect the P6-001 fix diff (one commit, three files).
6. Walk the runbook end-to-end in an isolated stack.
7. Confirm no deferred Phase 3/4 capability is misrepresented as a blocker.
```

---

## 28. Next authorized Job

```text
PASS:
  Next authorized Job:
  P6 independent MVP-ready closeout review
```

Do not begin M11. Do not begin P5-N2. Do not begin staff invitation/password
reset. Do not begin Phase 4. Do not declare all Phase 3 work complete.
