# P7-C0 — Durability / Persistence Reality Audit

> Repository: `jnhu76/exam`
> Mission: `P7-C0 — Durability / Persistence Reality Audit`
> Type: **AUDIT-ONLY**. No backup, restore, PITR, portable-deployment,
> configuration-control-plane, Admin backup UI, new worker, new Docker
> topology, or Desktop/offline-first implementation was made.
>
> Central question answered:
>
> > **If every disposable part of this machine disappears tonight, which exact
> > bytes must I still possess tomorrow for this to remain the same Exam system?**

---

## 1. Baseline

```text
Baseline SHA        : 4d0c052b863ba8070de01a9945ed50949eab1927
                      (origin/master, merge of PR #269 — P7-S2 runtime authority
                      hardening; HEAD == origin/master at audit start)
Current branch      : fix/p7-c0-durability-persistence-reality-audit
Working-tree status : 2 pre-existing STAGED files not touched by this audit:
                        A docs/adr/ADR-016-future-offline-resilient-client-data-and-recovery-model.md
                        M docs/adr/README.md
Node                : v24.15.0
pnpm                : 11.1.2
npm                 : 11.12.1
Docker              : 29.6.2 (build dfc4efb)
Docker Compose      : v5.3.1
PostgreSQL image    : postgres:18.4-bookworm (PG_VERSION 18.4-1.pgdg12+1)
Redis image         : redis:7-alpine (redis_version 7.4.9 running)
OS                  : Ubuntu 26.04 LTS on WSL2 (kernel 6.18.33.2-microsoft-standard-WSL2)
```

Host Docker state at audit start (existing, not created by this audit):

```text
exam-db-1     postgres:18.4-bookworm  Up 3 days (healthy)  0.0.0.0:15432->5432
exam-redis-1  redis:7-alpine          Up 3 days (healthy)  0.0.0.0:6379->6379
```

Repository guidance read before audit: `AGENTS.md`,
`docs/roadmap/current.md`, `docs/roadmap/P7-system-readiness-and-exam-modes.md`,
`docs/architecture/exam-system/state-and-authority.md`,
`docs/audits/P7-S2-RUNTIME-AUTHORITY-HARDENING-CLOSEOUT.md`,
`docs/adr/README.md`, ADR-001, ADR-005, ADR-006, ADR-007, ADR-011, ADR-012,
ADR-013, ADR-014, ADR-015, ADR-016 (boundary context only), and
`docs/deployment/mvp-deployment-runbook.md`.

> **ADR-016 review-cycle disclosure.** ADR-016 was authored before/during this
> C0 branch (`fix/p7-c0-durability-persistence-reality-audit`) and was **not**
> part of `origin/master` at the audit baseline (`4d0c052b`). ADR-016 and this
> P7-C0 audit are reviewed in the **same PR/review cycle** and MUST NOT be
> treated as independent baseline evidence for one another. The audit's
> reference to ADR-016 above is "boundary context only" precisely for this
> reason.

Evidence-tag legend used throughout:

```text
SOURCE FACT   — read from repository source/docs
RUNTIME PROOF — executed against a live process/DB/container
INFERENCE     — derived from SOURCE FACT(s)
TARGET DESIGN — aspirational, not implemented
UNKNOWN       — evidence insufficient
```

---

## 2. Scope / non-goals

### In scope

Establish, from the current repository and deterministic runtime evidence,
**what exact state must survive** for a single-node Exam deployment to remain
the same Exam system after container destruction, host relocation, or later
disaster recovery. This is discovery for P7-C1 (portable single-node
deployment) and P7-E0 (configuration/operations authority gate) before their
design begins.

### Explicit non-goals (NOT implemented, in line with the mission)

```text
new ./data layout               Compose volume migration
backup scripts                  restore scripts
pg_dump automation              pg_basebackup
WAL archiving                   PITR
ZFS/Btrfs integration           restic/borg integration
backup scheduler                backup worker
generic job queue               Admin backup UI
new backup permissions          configuration database tables
settings service                recoveryEpoch
Desktop client                  SQLite client storage
Syncular                        offline-first protocol
Redis responsibility expansion  Kubernetes / HA PostgreSQL / Patroni
generic reconciler
```

No unrelated code was refactored during this audit. One P3 data point found
during the audit (worker heartbeats omitted from the drizzle schema aggregate)
was **recorded, not fixed** (§20).

---

## 3. Executive verdict

- **PostgreSQL is the only authoritative durable store.** Every exam fact —
  attempts, answers, submitted snapshots, grading, results, interruptions,
  time adjustments, incidents, receipts, notifications, email outbox, audit —
  lives in PostgreSQL and nowhere else.
- **Redis owns no authority.** It holds only shared rate-limit counters with
  mandatory TTL. Loss of Redis changes nothing about Exam truth
  (SOURCE FACT + RUNTIME PROOF, §8).
- **No durable application state hides in a disposable container writable
  layer.** Repository-wide runtime-call-path/source inspection found no
  application durable file write path; isolated runtime observations were
  consistent with that result (STRONG SOURCE FACT + supporting runtime
  observation, §9).
- **Exact-history relocation has partial/proven building blocks, NOT a proven
  product-level clean-host relocation.** The §13 experiment proves container
  recreation and a same-PostgreSQL-major exact-byte PGDATA copy/transplant
  (isolated project, isolated host). It does **not** prove the full
  product-level property of taking only canonical deployment resources to a
  clean machine B and getting the same Exam deployment. Portable clean-host
  relocation is **PARTIAL / NOT_YET_PRODUCTIZED** and belongs to P7-C1 (§13).
- **Historical backup/restore is UNVALIDATED.** The only supported procedure
  is an operator-supplied `pg_dump` documented in the runbook (§17), which the
  P6 audit explicitly never executed/validated. There is no automated backup,
  no retention, no off-host copy, no restore drill, no Admin visibility.
- **PITR is NOT IMPLEMENTED.** The blocker is the missing WAL archive
  configuration (`archive_mode=off`, no `archive_command`, no WAL archive
  destination/retention, no base-backup/recovery procedure, no recovery drill),
  **not** `wal_level=replica` (which is already sufficient for continuous
  archiving/PITR) (§7, §16).
- **No P0/P1 findings.** P2 findings (P7 readiness blockers, none a
  supported-runtime data-loss defect), P3 findings (non-blocking debt).

> **Do not conflate these three operations** (kept distinct throughout this
> report): **relocation** (same authoritative history, same logical
> deployment, new container/host — partial/proven building blocks, §13),
> **historical restore** (replace current authority with an older known-good
> backup — UNVALIDATED, §16), and **PITR** (replace authority with history
> reconstructed to target time T — NOT IMPLEMENTED, §7). Relocation evidence
> must not be read as a proven recovery guarantee.

The desired future property (`compatible immutable images + deployment
configuration + canonical persistent local state = same Exam deployment`) is
**already true for the authoritative store at the building-block level**, with
two caveats: (a) the canonical persistent state is a Docker *named volume*
whose bytes live inside Docker's managed directory and whose raw PGDATA is
postgres-major version coupled (§15); and (b) the clean-host relocation proof
to a second machine is **not** part of this audit's evidence (§13, §22).

---

## 4. Current deployment topology

### 4.1 Production (bundled `docker-compose.yml`)

| Service | Image | Role | Persistence |
| --- | --- | --- | --- |
| `app` | built from `Dockerfile` (`node:24.15.0-bookworm-slim` base) | API + static web (`@fastify/static` from baked-in `public/`) + in-process heartbeat/deadline scanners | none (no volume; writable layer only) |
| `db` | `postgres:18.4-bookworm` | PostgreSQL authority | **named volume `pgdata` → `/var/lib/postgresql`** |
| `email-worker` | same built image, `entrypoint: ["node"]`, `command: [dist/workers/emailDeliveryWorker.js]` | drains `email_outbox` | none |
| `redis` | `redis:7-alpine` | shared rate limiter (P7) | **named volume `redisdata` → `/data`**, `--appendonly yes`, REQUIRED `REDIS_PASSWORD`; gated behind `profiles: ["redis"]` (not started by bare `up`) |

- Network `exam-net` (bridge); `restart: unless-stopped`; healthcheck chain
  `db → app → email-worker` serializes migrations (P6-009; the drizzle journal
  tracks state but is not a lock).
- Production requires `${POSTGRES_PASSWORD:?...}`, `${JWT_SECRET:?...}`,
  `${CORS_ORIGIN:?...}`, `${PUBLIC_WEB_ORIGIN:?...}` at Compose expansion
  (fail-fast, no functional default — P6-007).

### 4.2 Dev (`docker-compose.dev.yml`, what `pnpm db:up` runs)

- `db` + `redis` only. `db` has **no named data volume** — it relies on the
  image's `VOLUME /var/lib/postgresql` declaration, which creates an
  **anonymous volume**. The human's dev DB currently lives in anonymous
  volume `80e5f704…` (RUNTIME PROOF, `docker inspect`).
- `redis` runs with stock config (AOF off, default RDB snapshots) — no
  `--appendonly yes`.

### 4.3 Test / E2E

- `docker-compose.test.yml`: named volumes `pgdata` + `redisdata`,
  `RUN_SEED=e2e`, `APP_MODE=e2e`, DB name `exam_test`.
- `scripts/e2e/run-wsl.sh`: dedicated `exam_e2e` host DB, reseeded per run.

### 4.4 Web frontend

No separate web container in production. `apps/web/dist` is copied into the
image (`public/`) and served by the API (`apps/api/src/server.ts` static
plugin). The web app is therefore stateless at the server; the browser holds
only per-user `localStorage`/`sessionStorage` (§9).

---

## 5. Durability Authority Matrix

Class definitions per the mission (§3 of the prompt). "Container recreation"
= `docker compose up` after `down`; "host relocation" = moving the exact
durable state to a new host/project; "historical backup restore" = replacing
authority with an older known-good backup.

| State / artifact | Owner/component | Physical location | Logical authority | Persistence mechanism | Required after container recreation? | Required after host relocation? | Required after historical backup restore? | Safe to lose? | Safe to regenerate? | Secret? | Version-coupled? | Evidence | Classification | Notes / unresolved |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| PostgreSQL data dir (`pgdata` volume, `18/docker`) | `db` | named volume `pgdata` → `/var/lib/postgresql` (prod); anonymous volume (dev) | ALL Exam facts (see §6) | Docker named volume | **YES** | **YES** | **YES** (this IS the authority) | **NO** | **NO** | no | **YES — postgres 18 major** | RUNTIME PROOF (§13) | **A. AUTHORITATIVE_DURABLE** | Raw PGDATA major-version coupling NOT documented in repo (§15) |
| Drizzle migration journal + `drizzle.__drizzle_migrations` | `db` (schema `drizzle`) | inside PostgreSQL | migration version of the deployment | DB rows | yes | yes | yes (with restore) | no | no | no | yes | SOURCE FACT (§4 of runbook) | **A. AUTHORITATIVE_DURABLE** | Forward-only; no down migrations |
| Redis keyspace (`ratelimit:v1:*`) | `app` (rate-limit plugin) / `redis` | Redis `:0` | shared rate-limit counters | in-memory + optional AOF/RDB in `redisdata` | no | no | no | **YES** | yes | no | weak (Redis 7.x format) | RUNTIME PROOF (§8) | **F. EPHEMERAL** | Loss = counters reset; no Exam truth |
| Redis AOF/RDB files (`/data`) | `redis` | named volume `redisdata` | none (only rate-limit counters) | AOF (prod) / RDB default (dev) | no | no | no | yes | yes | no | Redis 7.x | RUNTIME PROOF | **F. EPHEMERAL** | Prod `--appendonly yes`; dev AOF off |
| Container writable layers (app/worker `/app`, `/app/data`, logs) | app/worker | Docker overlay fs | none — nothing writes durable files | writable layer (disposable) | no | no | no | yes | yes | no | no | RUNTIME PROOF (§9) | **F. EPHEMERAL / G. REGENERABLE** | `/app/data` created by Dockerfile, unused by any code; logs are stdout-only |
| `worker_heartbeats` rows | email-worker | PostgreSQL | worker liveness observability | DB upsert | no | no | no | yes | **YES — rewritten by worker each poll** | no | no | SOURCE FACT (ADR-011) | **E. RECOVERABLE_OPERATIONAL** | Stale rows harmless; `workerInstanceId` is per-process random |
| Browser `localStorage`/`sessionStorage` (`exam.pendingGrantAuthority:*`, `clientSessionId`, force-submit/misconduct pending authority) | web client | user agent | client-only recovery UX state | browser storage | n/a | n/a | n/a | yes (server-confirmed state unaffected) | yes | no | no | SOURCE FACT (§9.12) | **E. RECOVERABLE_OPERATIONAL** | Client-side; server truth in PostgreSQL |
| `.env` / deployment config | operator | host file next to compose | deployment identity + runtime policy | file | yes (config) | yes (config) | yes (config) | no (recreate) | no | partly | no | SOURCE FACT | **C. DEPLOYMENT_IDENTITY + D. SECRET** | See §10/§11 |
| `JWT_SECRET` | `app` | env | signs `auth-token` cookie JWT; HMAC domain-separation for rate-limit keys | env | yes | yes | yes | no — loss = forced re-login | rotatable (re-login only) | **YES** | no | SOURCE FACT (§10) | **D. SECRET + C. DEPLOYMENT_IDENTITY** | Loss changes logical deployment identity (all sessions die), NOT data authority |
| `POSTGRES_PASSWORD` / DB credentials | `db`, `app`, `worker` | env (compose) | DB access | env | yes | yes | yes | no | rotation requires coordinated database credential change + deployment secret update; changing `POSTGRES_PASSWORD` env alone does not rotate an initialized DB (runbook note) | **YES** | no | SOURCE FACT (compose comment) | **D. SECRET** | Composed into `DATABASE_URL` |
| SMTP credentials / sender config | worker | env | outbound Email | env | yes | yes | yes | no (Email stops) | rotatable | **YES** | no | SOURCE FACT | **D. SECRET** | External side-effect boundary below |
| SMTP-accepted email deliveries | external SMTP server | outside deployment | accepted delivery | external | n/a | n/a | n/a | cannot un-send | no | — | — | SOURCE FACT (ADR-011 / P7-S2-D) | **H. EXTERNAL_SIDE_EFFECT** | At-least-once; retry may duplicate; cannot be restored by restoring Exam |
| `PUBLIC_WEB_ORIGIN` / `CORS_ORIGIN` | app, worker | env | absolute Email links + browser allowlist | env | yes | yes | yes | no (misconfig) | change = links point elsewhere | no (not secret) | no | SOURCE FACT (compose requires) | **C. DEPLOYMENT_IDENTITY** | Origin assumptions must survive relocation |
| `openapi.json` | dev/CI tooling | repo (`apps/api/openapi.json`) | API reference | committed file | n/a | n/a | n/a | yes | **YES — regenerated by `api:openapi`** | no | no | SOURCE FACT | **G. REGENERABLE** | Not runtime state |
| e2e capture manifests / TLC `.work/` | dev tooling | host `/tmp`, repo `formal/.work` | dev artifacts | files | n/a | n/a | n/a | yes | yes | no | no | SOURCE FACT | **G. REGENERABLE** | Gitignored |
| Redis connection state / in-memory admission queue `examQueues` Map | app | process memory | queue admission (not production-wired) | memory | no | no | no | yes | yes | no | no | SOURCE FACT (ADR-001) | **F. EPHEMERAL** | `requireQueue` not operational in Phase 1 |

**Matrix summary:** exactly one authoritative store (PostgreSQL), one
ephemeral optional store (Redis), zero durable filesystem artifacts, and a
handful of deployment-identity/secret env values. No `I. UNKNOWN` entries
remain in this matrix.

---

## 6. PostgreSQL authority inventory

### 6.1 Authority families (current master)

29 public tables; each family classified against the mission vocabulary
(`authoritative? / projection? / receipt? / append-only evidence?
/reconstructable? / external-side-effect companion?`).

| Family | Tables | Role | Classification |
| --- | --- | --- | --- |
| Organizations / settings / identity | `organizations`, `organization_settings`, `candidate_fields`, `users`, `candidate_profiles`, `user_role_assignments` | tenant boundary, branding/display settings, login identity, candidate identity fields, role authority | **authoritative** (identity + config). `user_role_assignments` is the role-authority table (ADR-015); `users.role` is a compatibility cache |
| Courses / questions | `courses`, `questions` | question bank, rubric, attachments metadata (JSONB, not files) | **authoritative**; snapshot consumers |
| Exams | `exams` | lifecycle, timing, policy, question snapshot, result publication, interruption policy | **authoritative**; `question_snapshot` is a frozen projection of the bank at publish |
| Enrollments | `exam_enrollments` | qualification + attempt count + final score (scoreStrategy) | **authoritative** (projection of final result chosen by policy) |
| Attempts | `exam_attempts` | lifecycle, draft `answers` (versioned), `submitted_answers` (scoring authority after submit), deadline/heartbeat, interruption pointers | **authoritative**. `submitted_answers` = sole scoring authority after submission (ADR-008/012) |
| Draft answer versions | `exam_attempts.answers` | versioned draft state (clientSeq, baseVersion protocol) | **authoritative** until submission freeze; immutable after |
| Grading workset | `attempt_grading_entries` | materialized per-question grading workset | **authoritative** (single durable grading truth); `exam_attempts.grading_result` is a **denormalized projection** (P3-L0-2E comment) |
| Result publication | `exams.results_published_at` (+ audit) | first-publish instant | **authoritative, write-once, single-winner** (P7-S2-A) |
| Notifications / Inbox | `notifications` | Inbox rows, dedupe | **authoritative** in-product channel |
| Email outbox + worker evidence | `email_outbox`, `worker_heartbeats` | durable delivery queue, worker liveness | **authoritative** for delivery state; **at-least-once**; SMTP = external side-effect companion |
| Interruption episodes / events | `attempt_interruptions`, `attempt_interruption_events` | episode identity + append-only evidence ledger | **authoritative + append-only evidence** |
| Time adjustments | `attempt_time_adjustments` | append-only positive adjustment ledger | **authoritative + append-only evidence** |
| Incidents | `exam_incidents`, `exam_incident_events`, `exam_incident_actions`, `exam_incident_attempts`, `exam_incident_interruption_links` | operational case + append-only event history + action/attempt/interruption links | **authoritative + append-only evidence**; events = idempotency arbiter via `UNIQUE(org, operation_id)` |
| Proctor assignments | `exam_proctor_assignments`, `exam_proctor_assignment_events` | assignment episodes + append-only command receipts | **authoritative + receipt** (ADR-015) |
| Durable operation receipts | `attempt_command_receipts` | force_submit / misconduct_mark receipts | **receipt** (append-only; replay evidence; NOT a business authority — the committed fact is the attempt row) |
| Audit logs | `audit_logs` | atomic compliance evidence | **append-only evidence**; explicitly NOT an event store or idempotency arbiter (ADR-006/014/015). Atomic actions commit audit in the same transaction; best-effort observations are in-memory queued with a 10s drain on graceful shutdown (ADR-006) |
| Client events | `client_events` | best-effort browser telemetry | **append-only, non-authoritative** observational; **non-reconstructable** once lost (acceptable to lose for correctness, but destroys historical observational evidence that cannot be recovered from another authoritative source) |
| Import job logs | `import_job_logs` | import run summaries | **append-only, operational** |
| Migration state | `drizzle.__drizzle_migrations` | applied-migration journal | **authoritative** (forward-only, no down migrations) |

### 6.2 Cross-cutting classification

```text
authoritative facts        : organizations/users/roles/settings, courses/questions,
                             exams, enrollments, attempts, drafts, submitted
                             snapshots, grading entries, results, incidents,
                             proctor assignments
append-only evidence       : interruption events, time adjustments, incident
                             events, proctor assignment events, audit logs
receipts                   : attempt_command_receipts, incident action links,
                             proctor assignment events (idempotency arbiters)
projections                : exam_attempts.grading_result (derived from
                             attempt_grading_entries), exam.question_snapshot
                             (frozen at publish), exam_enrollments.final_score
                             (selected by scoreStrategy), users.role (role-assignment cache)
external-side-effect companion: email_outbox → SMTP (at-least-once)
regenerable liveness       : worker_heartbeats (rewritten by the worker each poll;
                             stale rows harmless; workerInstanceId is per-process random)
non-authoritative,
non-reconstructable
telemetry                  : client_events (best-effort browser telemetry;
                             append-only and observational; once lost it cannot
                             generally be rebuilt from another authoritative
                             source — losing it destroys historical observational
                             evidence, but does not affect Exam correctness)
```

> **Do not group `client_events` with `worker_heartbeats` as "reconstructable".**
> `worker_heartbeats` is regenerable operational liveness state (the worker
> rewrites it each poll). `client_events` is non-authoritative but
> **non-reconstructable** historical telemetry: it is acceptable to lose for
> Exam correctness, but its loss destroys observational evidence that cannot be
> recovered from any other authoritative source.

**No current-runtime committed-partial state requires startup reconciliation**
(no general startup reconciler — P7-S2 Phase 5, re-verified in the closeout
doc; crash-atomicity proven for all irreversible mutations).

---

## 7. PostgreSQL physical persistence

| Question | Answer | Evidence |
| --- | --- | --- |
| Image/version | `postgres:18.4-bookworm` | `docker-compose.yml:75`, `docker-compose.dev.yml:3` |
| Major version pinned? | **YES — full `18.4` patch pin** | SOURCE FACT |
| `latest` used anywhere? | **NO** for Postgres; Redis uses `7-alpine` (minor-floating, see §15) | SOURCE FACT |
| PGDATA path | `/var/lib/postgresql/18/docker` | RUNTIME PROOF (`docker exec exam-db-1 sh -c 'echo $PGDATA'`) |
| Named volume or bind mount? | Production/test: **named volume** `pgdata` → `/var/lib/postgresql`. Dev: **anonymous volume** (image `VOLUME /var/lib/postgresql`) | SOURCE FACT + RUNTIME PROOF (`docker inspect` mount list) |
| Filesystem ownership | `pgdata` volume owned by postgres uid 999 (`drwxrwxrwt 3 999 …` observed in relocation copy); container entrypoint runs as root and chowns on start | RUNTIME PROOF |
| `docker compose down` | containers + network removed; **`pgdata` retained** | RUNTIME PROOF (§13) |
| `docker compose down -v` | **`pgdata` + `redisdata` removed — data destroyed** | documented (runbook §12); NOT executed on shared state |
| Container deleted and recreated | data persists (same named volume) | **RUNTIME PROOF** (§13 E) |
| Operator can identify persistent state without Docker archaeology? | Production: **YES** (`docker volume ls` shows `exam_pgdata`; compose references it by name). Dev: **NO** — anonymous volume hash must be correlated by mount inspection | RUNTIME PROOF |
| Host relocation depends on Docker volume internals? | **PARTIAL** — bytes are a plain directory tree copyable with `cp -a` (PROVEN), but they live under Docker's managed volume dir (`/var/lib/docker/volumes/…` on Linux, Docker Desktop VM on Windows/macOS), not at an operator-chosen host path | RUNTIME PROOF (§13 F–H) |
| Repo documents raw-PGDATA version coupling? | **NO** — runbook documents `pg_dump` restore and the "different password ⇒ supply it or recreate volume" note, but never states that raw PGDATA is tied to the Postgres major version | SOURCE FACT (gap) |

**Distinguished operations (do not conflate):**

```text
container recreation              → same volume bytes, same process; PROVEN safe
host relocation (exact PGDATA)    → copy one directory tree; PROVEN safe at the
                                     same PostgreSQL major (§13). The full
                                     clean-host (machine B) product-level
                                     relocation is NOT proven here (§22).
logical backup restore            → pg_dump → psql; documented-only, NOT validated
                                     (§16); exact historical replacement NOT proven
physical backup restore           → raw PGDATA copy; version-coupled to postgres 18
PITR                              → NOT IMPLEMENTED today — missing WAL archiving
                                     config (see below); wal_level is NOT the blocker
```

RUNTIME PROOF of the no-archiving baseline:

```text
SHOW archive_mode;      → off
SHOW archive_command;   → (disabled)
SHOW wal_level;         → replica
SHOW max_wal_senders;   → 10
SHOW fsync;             → on
SHOW full_page_writes;  → on
```

**PITR correctness clarification.** `wal_level=replica` is **already
sufficient** for continuous archiving / PITR (PostgreSQL requires `replica` or
higher; only `minimal` blocks it). The current PITR blockers are therefore
**not** `wal_level`; they are:

```text
archive_mode=off
archive_command not configured
no WAL archive destination / retention contract
no base-backup / PITR recovery procedure
no recovery drill
```

A future P7-C PITR design MUST NOT be recommended to raise `wal_level` to
`logical` merely to "enable" PITR — that would add WAL overhead without
addressing the real (missing archiving) blocker.

---

## 8. Redis durability classification

### 8.1 What Redis currently owns

- **One** adopted responsibility (P7-D1 ACCEPTED, ADR-001): the
  **shared/global rate limiter** — atomic fixed-window counters via one Lua
  script (`apps/api/src/redis/rateLimitStores.ts`), keyspace
  `ratelimit:v1:<HMAC-SHA256(ip, JWT_SECRET)>`, **mandatory TTL = the window**
  (nothing accumulates).
- The baseline plugin also runs `PING` diagnostics. No other keyspace exists
  (no presence, no queue, no session, no cache, no pub/sub — all decision-gated
  and unimplemented).

### 8.2 Runtime proof (this audit)

```text
running dev redis (redis:7-alpine → 7.4.9):
  DBSIZE 0                      → zero keys in the current dev deployment
  appendonly no / save "3600 1 300 100 60 10000"  → dev: RDB-defaults, AOF off
production compose redis:       → `--appendonly yes` + requirepass, redisdata:/data
isolated discard experiment (§24-1):
  SET probe:key → SAVE → remove container + volume → fresh start
  → key gone; no error; no impact on PostgreSQL
```

Answers to the mission questions:

| Question | Answer |
| --- | --- |
| What business responsibility uses Redis? | Shared rate limiting only (ADR-001 P7 decision) |
| What keys/state exist? | `ratelimit:v1:*` fixed-window counters, TTL-bounded |
| Is any Redis state authoritative? | **NO** — rate-limit coordination only |
| What if Redis starts completely empty? | Rate-limit windows reset; no Exam behavior change |
| Does loss of Redis change Exam business truth? | **NO** (RUNTIME PROOF) |
| Does loss merely reset rate-limit history? | **YES** |
| Persistence settings? | Prod compose: AOF on; dev: RDB defaults, AOF off |
| Does Compose persist Redis today? | Named volume `redisdata` (prod/test); anonymous (dev) |
| Would restoring stale Redis create correctness problems? | **NO** — stale counters are window-bounded (TTL) and only ever cause brief over-limiting; never under-limiting an irreversible fact. **Evidence level for this specific claim = INFERENCE** from the current TTL-bounded rate-limit-only responsibility (see label note below). |

**Evidence-level note for the Redis claims.** Distinguish the two claims:

```text
Loss of Redis does not remove PostgreSQL Exam authority
    → SOURCE FACT + RUNTIME PROOF
       (DBSIZE=0 baseline observed; isolated discard experiment in §24-1
        confirmed a discarded probe key does not return; PostgreSQL was
        untouched)

Restoring stale Redis cannot create durable Exam corruption
    → INFERENCE from the current TTL-bounded rate-limit-only responsibility
       (stale counters are window-bounded by TTL and only ever cause brief
        over-limiting; the audit did NOT execute a stale-restore-then-trigger
        rate-limit path, so this correctness claim is not RUNTIME PROOF)
```

**Redis loss breaking authoritative Exam behavior would be a major finding —
it is disproven by source and experiment for the "loss removes authority"
claim.** Redis is classified **F. EPHEMERAL**.

---

## 9. Filesystem / application durable-state audit

Comprehensive scan of `apps/`, `packages/`, `scripts/`, root files for
`fs.writeFile*`, `appendFile`, `createWriteStream`, `mkdir`, `rename`,
`copyFile`, `unlink`, `rm`, `os.tmpdir`, `data/`, `upload`, `attachment`,
`export`, `storage`, SQLite, and disk-persisting libraries.

### 9.1 Result: NO durable runtime state outside PostgreSQL

All filesystem writes found are **dev/CI tooling, never part of the container
runtime call graph**:

| Write path | File | Classification |
| --- | --- | --- |
| `apps/api/openapi.json` (OpenAPI export) | `apps/api/src/openapi/export.ts` | G. REGENERABLE — dev/CI command only, dead at runtime |
| `/tmp/ui-question-dataview/*`, `measurements.json`, `runtime.json` | `apps/e2e/scripts/capture-*.mjs` | G. REGENERABLE — host screenshot tooling |
| `formal/.work/{recovery,operator-grant}/*` | `scripts/formal/run-*-tlc.mjs` | G. REGENERABLE — TLC model-checker artifacts, gitignored |
| browser `localStorage`/`sessionStorage` (`exam.pendingGrantAuthority:*`, `clientSessionId`, pending force-submit/misconduct authority) | `apps/web/src/features/…`, `lib/clientSessionId.ts` | E. RECOVERABLE_OPERATIONAL — client-side UX recovery, server truth in PostgreSQL |

### 9.2 Specific answers

- **Uploads / attachments**: none — `questions.attachments` is JSONB metadata,
  no file storage, no multipart middleware.
- **Generated exports**: CSV is built in memory and streamed as an HTTP
  response (`apps/api/src/routes/export.ts`); no temp/report file.
- **Email artifacts**: none — outbox is a DB table; worker logs to stdout.
- **Avatars / branding**: none — org branding is DB rows.
- **Runtime-generated config / certificates / keys**: none.
- **Local queues / caches**: in-process only (`presetCache.ts` Map,
  `LocalRateLimitStore`, `examQueues` Map); the admission queue is not
  production-wired.
- **Logs required for audit**: **NO** — pino JSON to stdout only; `docker
  logs`/json-file driver holds them in container/daemon storage, not mounted,
  not backed up. Audit trail is PostgreSQL `audit_logs`.
- **Migration state outside PostgreSQL**: none — drizzle journal lives in the
  DB (`drizzle.__drizzle_migrations`).
- **SQLite**: none anywhere.

### 9.3 Critical invariant

> **No durable application state remains hidden inside a disposable container
> writable layer.**

Repository-wide runtime-call-path/source inspection found no application
durable file write path: the Dockerfile creates `/app/data` (`Dockerfile:65`)
but **no code writes to it**, and the `app` and `email-worker` services mount
no volumes. Isolated runtime observations (§13/§24) were consistent with that
source result — no durable file surfaced across the relocation experiments.

**Evidence level = STRONG SOURCE FACT + supporting runtime observation**, not
exhaustive runtime proof. The source scan covered `apps/`, `packages/`,
`scripts/`, root files for the durable-write API surface
(`fs.writeFile*`, `appendFile`, `createWriteStream`, `mkdir`, `rename`,
`copyFile`, `unlink`, `rm`, `os.tmpdir`, `data/`, `upload`, `attachment`,
`export`, `storage`, SQLite, and disk-persisting libraries) and found only
dev/CI-tooling writes (§9.1). This does not mathematically prove that no
latent transitive-dependency code path can ever write a file at runtime; it
proves that no application durable file write path exists in the audited
source, and the runtime observations were consistent with that. **No P7-C1
blocker of this class exists.**

---

## 10. Deployment identity / secret inventory

| Value | Class | Loss/change consequence | Rotatable? | Evidence |
| --- | --- | --- | --- | --- |
| `JWT_SECRET` | SECRET + DEPLOYMENT_IDENTITY | All sessions invalid → forced re-login; rate-limit key derivation (HMAC domain) changes → counters orphan (TTL-expire). **No data authority affected** (password hashes are argon2, independent of JWT) | YES (safe; re-login only) | `apps/api/src/plugins/auth.ts`, `rateLimitKey.ts` |
| `POSTGRES_PASSWORD` (+ `POSTGRES_USER`/`POSTGRES_DB`) | SECRET | Compose fails to expand → service down; if the pgdata volume was initialized with a different password the runbook requires supplying it or recreating the volume | Careful — volume-initialized credential | compose `:?` guard + runbook note |
| `REDIS_PASSWORD` | SECRET | Redis profile refuses to start (startup guard) | YES | `docker-compose.yml` redis guard |
| `SMTP_PASSWORD` / SMTP config | SECRET | Email delivery stops; outbox keeps rows (safe) | YES | runbook |
| `PUBLIC_WEB_ORIGIN` | DEPLOYMENT_IDENTITY | Email action links point at wrong origin; runtimeConfig fails fast if invalid | Change = links change | compose `:?` guard |
| `CORS_ORIGIN` | DEPLOYMENT_IDENTITY | Browser allowlist changes | YES | compose `:?` guard |
| `DEPLOYMENT_MODE` | DEPLOYMENT_IDENTITY | `multiTenant` rejected at boot (Phase 4 rule) | fixed | runtimeConfig |
| `APP_TIMEZONE` / `TZ` | RUNTIME_OPERATIONAL_POLICY | display/log only (ADR-006) | YES | runtimeConfig |
| stable deployment/instance ID | — | **DOES NOT EXIST** | — | §18 |

Classification per the mission's provisional categories:

```text
SECRET                    : JWT_SECRET, POSTGRES_PASSWORD, REDIS_PASSWORD, SMTP_PASSWORD
DEPLOYMENT_IDENTITY       : JWT_SECRET (sessions), PUBLIC_WEB_ORIGIN, CORS_ORIGIN,
                            DEPLOYMENT_MODE, POSTGRES_USER/DB (naming)
PHYSICAL_RESOURCE_BINDING : DATABASE_URL/TEST_DATABASE_URL (mode-resolved),
                            bind host/port, APP_PORT
RUNTIME_OPERATIONAL_POLICY: HEARTBEAT_*, DEADLINE_SCAN_INTERVAL_MS, RATE_LIMIT_*,
                            EMAIL_* / SMTP_* (timeouts, retry, poll), REDIS_MODE
BUSINESS_POLICY           : (none currently env-held that is a business fact; org
                            settings are DB rows: organization_settings)
BOOTSTRAP_TOPOLOGY        : compose service set, profiles, volumes
DERIVED_RUNTIME_STATE      : none (no cached/derived durable state)
```

**No value required to recover authoritative data exists outside PostgreSQL
except the Postgres access credential itself.** Everything else is either
service-resume, identity, or policy.

---

## 11. Current configuration-source inventory (input table for P7-E0)

`Setting | Current source | Current default | Sensitive? | Restart required? | Physical resource? | Safe business/ops policy? | Could plausibly move to settings layer? | Must remain deployment/secret backed? | Evidence | Unresolved`

| Setting | Current source | Current default | Sensitive | Restart | Physical | Ops-policy | Movable to settings layer? | Must stay deployment/secret? | Unresolved |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `DATABASE_URL` / `TEST_DATABASE_URL` | env (compose-composed; mode-resolved) | required / test-required | yes (creds) | yes | **yes** | no | NO | **YES** | P7-E0_DECISION_REQUIRED — how far Admin surfaces may *reference* it |
| `JWT_SECRET` | env | required in prod | yes | yes | no | no | NO | **YES** | — |
| `POSTGRES_PASSWORD`/`USER`/`DB` | env (compose) | required | yes | yes | **yes** | no | NO | **YES** | volume-initialized credential caveat |
| `REDIS_URL` / `REDIS_PASSWORD` / `REDIS_MODE` | env | off/optional | yes (password) | yes | **yes** | no | NO | **YES** | P7-E0_DECISION_REQUIRED |
| `PUBLIC_WEB_ORIGIN` | env | required prod | no | yes | no | policy | maybe (origin is identity) | **YES** (deployment identity) | — |
| `CORS_ORIGIN` | env | required prod | no | yes | no | policy | maybe | **YES** (identity) | — |
| `COOKIE_SECURE` | env | false (auto-true prod) | no | yes | no | yes | yes | no | — |
| `HOST` / `APP_PORT` | env | 0.0.0.0 / 3000 | no | yes | **yes** | no | NO | YES | — |
| `HEARTBEAT_SCAN_INTERVAL_MS` / `HEARTBEAT_TIMEOUT_MS` / `DEADLINE_SCAN_INTERVAL_MS` | env | 30000/60000/inherit | no | yes | no | **yes** | yes | no | — |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_DISABLED` | env | 100/60000/false | no | yes | no | **yes** | yes | no | P7-E0_DECISION_REQUIRED — runtime vs policy |
| `EMAIL_ENABLED` / `EMAIL_TRANSPORT` / `EMAIL_FROM*` | env | false/fake | no | yes | no | **yes** | yes | no | — |
| `EMAIL_MAX_ATTEMPTS` / `EMAIL_RETRY_BASE_SECONDS` / `EMAIL_WORKER_*` | env | 3/60/… | no | yes | no | **yes** | yes | no | — |
| `SMTP_*` | env | empty/587/… | password yes | yes | **yes** (endpoint) | yes | endpoint maybe; creds NO | creds YES | — |
| `APP_TIMEZONE` / `TZ` | env | Asia/Shanghai | no | yes | no | yes | yes | no | — |
| `DEPLOYMENT_MODE` | env | singleTenant | no | yes | no | identity | NO | YES | Phase 4 gate |
| `FEATURE_*` flags | env | false | no | yes | no | yes | yes | no | P7-E0_DECISION_REQUIRED — feature activation |
| `APP_MODE` / `NODE_ENV` | env | development | no | yes | no | identity | NO | YES | gate semantics |
| `RUN_SEED` / `SEED_*` | env | empty | seed password sensitive | yes | no | dev-only | NO | dev-only | seed refuses production |

---

## 12. Portable deployment reality

Desired property under evaluation:

```text
compatible immutable images + deployment configuration + canonical persistent local state
    = same Exam deployment
```

### 12.1 Assessed components

| Component | Current reality | Portable? |
| --- | --- | --- |
| Application image | `Dockerfile` multi-stage from pinned `node:24.15.0-bookworm-slim`; `pnpm --prod deploy` to `/out`; web `dist` baked into `public/`. **No tag/digest pinning in compose** — `build: .` rebuilds from whatever source is checked out | Image build is reproducible from source; compose does not pin an image tag/digest |
| Postgres image | `postgres:18.4-bookworm` — **full patch pin** | YES (pull-consistent) |
| Redis image | `redis:7-alpine` — **minor-floating tag** | Pull could advance 7.x patch |
| Deployment configuration | `.env` + compose (requires 4 production values) | YES (plain files) |
| Canonical persistent state | **one** named volume `pgdata` | YES — single directory tree (PROVEN §13) |
| Startup | `docker-entrypoint.sh`: fail if `JWT_SECRET` unset → `node dist/scripts/migrate.js` → optional seed → `node dist/server.js` | No source checkout, no pnpm/npm at runtime, no Internet at runtime (Internet needed at build time: npm/pnpm registries configured to npmmirror in the Dockerfile) |
| Startup migrations | **auto-run at every app boot** (idempotent via journal) | Yes, but see §15.3 risk |
| Healthchecks | db `pg_isready`; app HTTP `/api/health`; redis `PING` | — |

### 12.2 Answers to the mission portability questions

```text
Can an existing deployment be recreated after deleting only containers?      YES — PROVEN (§13 E)
Can it be recreated after deleting images and re-pulling same versions?       YES for db/redis tags;
                                                                            app image must be rebuilt from source
Are image versions sufficiently pinned?                                       PARTLY — postgres+node pinned,
                                                                            redis:7-alpine floating minor,
                                                                            app image has no tag/digest contract
Could the deployment accidentally pull incompatible future images?            Redis: yes (minor-floating).
                                                                            Postgres: no (patch-pinned).
                                                                            App: rebuild-from-source can drift
What exact local resources must be retained?                                  pgdata volume bytes + .env + the
                                                                            source tree to rebuild the image
Can those resources be copied without Docker-specific volume tooling?         At byte level:
                                                                                YES — PGDATA is an ordinary
                                                                                directory tree once exposed (cp -a,
                                                                                proven §13 F–H).
                                                                              At current operator/product level:
                                                                                NO — the named volume is under Docker's
                                                                                managed directory; accessing it still
                                                                                requires Docker volume/daemon knowledge
                                                                                or a helper container (§13.3). This is
                                                                                the gap P7-C1 is meant to close.
Does startup require source checkout?                                         NO (image contains built dist)
Does startup require pnpm/npm/bun?                                            NO
Does startup require Internet access?                                         NO (runtime); build does
Does startup run migrations automatically?                                    YES (entrypoint migrate.js)
Could startup against an older raw PGDATA mutate it before compatibility check? YES — migrate.js runs
                                                                            unconditionally; see §15.3
```

---

## 13. Cold relocation experiment (isolated, deterministic)

Per mission discipline: temporary directory, unique Compose project names,
test-only DB/ports/credentials, explicit cleanup, no shared dev volume touched,
no `docker system prune`.

> **Scope of what this experiment proves.** It proves three building blocks:
> (a) **container recreation** (same volume bytes, same project); (b) a
> **same-host / isolated-project exact PGDATA copy** via a plain `cp -a`; and
> (c) **same-PostgreSQL-major raw-PGDATA cold transplantability**. It does
> **not** prove the full product-level clean-host relocation property of
> taking only canonical deployment resources to a **clean machine B** and
> getting the same Exam deployment (no source-build surprise, no Docker-volume
> archaeology, `docker compose up` → same deployment). That clean-host/machine-B
> proof belongs to **P7-C1** and was **not** rerun here. The final
> classification is therefore PARTIAL / NOT_YET_PRODUCTIZED for portable
> clean-host relocation (§17, §22).

### 13.1 Phase 1 — PostgreSQL data-dir portability (no app image needed)

```text
A. start isolated deployment     project p7c0reloc1, volume p7c0reloc_pgdata, port 15440
B. create representative state   table reloc_probe: ('exam-1', …), ('attempt-42', …)
C. record invariant              md5(string_agg(id|label)) = f4c2b2ef48df6c0419ae4cd06679c7d3
D. stop services cleanly         docker compose down  → containers removed, volume retained
E. identify ONLY the required state  → one named volume (46.3 MB)
F. remove/recreate disposable containers
G. start again (same project)
H. verify                         rows present; md5 identical → CONTAINER RECREATION: PROVEN
```

Then the stronger same-host exact-PGDATA copy simulation **without changing
repository code**:

```text
old project (p7c0reloc1)  →  down
copy ONLY identified state →  docker run -v p7c0reloc_pgdata:/from -v pgcopy:/to alpine
                               cp -a /from/. /to/   (plain file copy, no volume tooling)
new project (p7c0reloc2)  →  bind mount ./pgcopy:/var/lib/postgresql, NEW project name
start                     →  rows present; md5 identical
                               → SAME-HOST/SAME-MAJOR EXACT-PGDATA COPY: PROVEN
                               (NOT the same as a clean-machine-B product-level relocation)
```

### 13.2 Phase 2 — full-stack relocation with the real application image

Built `exam-p7c0-probe:latest` from **current master** (audit baseline), then:

```text
A. full isolated deployment      project p7c0full1: app + db + email-worker,
                                 volume p7c0full_pgdata, DB name exam_e2e
B. representative durable state  canonical E2E seed (RUN_SEED=e2e) →
                                 1 org, 6 users, 3 courses, 10 questions,
                                 4 exams, 8 enrollments, 8 attempts,
                                 8 attempts with answers, 6 submitted,
                                 29 migrations applied
C. record invariants             exams|4  attempts|8  answers_present|8  submitted|6
D. stop cleanly                  docker compose down (volume retained)
E/F. copy ONLY pgdata            cp -a p7c0full_pgdata → fullcopy (48.8 MB)
G. start NEW project p7c0full2   bind mount ./fullcopy:/var/lib/postgresql,
                                 RUN_SEED unset (migration-only, like production restart)
H. verify                        app healthy; invariants identical (exams|4 attempts|8
                                 answers_present|8 submitted|6 migrations|29);
                                 GET /api/health ok; seeded admin login returns valid JWT;
                                 GET /api/system/health → {"status":"ok"}
```

**Verdict (corrected evidence strength).** The experiment proves: (a) container
recreation; (b) a same-host/isolated-project exact PGDATA copy with a plain
`cp -a`; and (c) same-PostgreSQL-major raw-PGDATA cold transplantability — all
with the real image and real authority families. It does **not** prove the full
product-level portable clean-host (machine A → clean machine B) relocation;
that is PARTIAL / NOT_YET_PRODUCTIZED and is the job of P7-C1 (§22). "Exact
durable-state relocation requires no application-specific restore procedure
today" holds **for the proven building blocks at the same PostgreSQL major**,
not as a clean-machine-B recovery guarantee.

### 13.3 Named-volume caveat (recorded, not redesigned)

The current topology keeps `pgdata` in a Docker named volume. Its bytes are
portable (proven at the same major), but an operator relocating must either
know the volume's location (`/var/lib/docker/volumes/<name>/_data` on Linux)
or use `cp -a` via a helper container. There is no bind-mount / operator-chosen
host path today. This is a P3 portability ergonomics finding (P7-C1 may
evaluate a bind mount — **not implemented here**).

---

## 14. Destructive-loss attack matrix

Using isolated test state only (§13). Classification per the mission.

| Removed | Result | Classification | Evidence |
| --- | --- | --- | --- |
| Containers lost, persistent storage retained | `down` → `up` recovers all state | **SAFE_RECREATE** | RUNTIME PROOF (§13.1/13.2) |
| API container writable layer lost | no state in it; recreate | **SAFE_RECREATE** | SOURCE FACT (§9) |
| web container writable layer lost | no web container; static files in image | **SAFE_RECREATE** | SOURCE FACT (§4.4) |
| email-worker container writable layer lost | outbox in PostgreSQL; worker re-recovers abandoned rows | **SAFE_RECREATE** | SOURCE FACT (ADR-011) |
| Redis state lost | rate-limit counters reset; no Exam truth change | **LOSS_OF_EPHEMERAL_STATE** | RUNTIME PROOF (§8) |
| PostgreSQL state lost | **nothing left to restore from** (only documented path is operator pg_dump) | **LOSS_OF_AUTHORITY** | SOURCE FACT (§16) |
| application durable-file directory lost | N/A — no such directory exists | **SAFE_RECREATE** | STRONG SOURCE FACT + supporting runtime observation (§9) |
| deployment `.env` missing | Compose fails at `${VAR:?...}`; data intact; reconfigure → recovers | **SAFE_WITH_RECONFIGURATION** | SOURCE FACT (compose guards) |
| `JWT_SECRET` rotated/missing | all sessions invalid → re-login; data intact | **LOSS_OF_SERVICE_ONLY** (identity break for sessions, not data) | SOURCE FACT (§10) |
| `POSTGRES_PASSWORD` changed | Compose/container cannot authenticate; volume-initialized password caveat (runbook) | **SAFE_WITH_RECONFIGURATION** (or volume recreation) | SOURCE FACT (runbook) |
| `PUBLIC_WEB_ORIGIN` changed | Email links point elsewhere; no data loss | **SAFE_WITH_RECONFIGURATION** | SOURCE FACT |
| image tag/version changed | Postgres: pinned; Redis: minor-floating; app: rebuild drift + forward migrations on next boot | **VERSION_INCOMPATIBLE risk (bounded)** | §15 |
| host path changes | bind mounts are operator-defined; named-volume path is Docker-managed | **SAFE_WITH_RECONFIGURATION** (same-major relocation proven; clean-host not yet productized) | §13.3 |
| named volume unavailable (deleted/evicted) | data inaccessible → same as LOSS_OF_AUTHORITY | **LOSS_OF_AUTHORITY** | INFERENCE (no other store) |

**No destructive experiment touched normal development data.** Dev volumes
(`80e5f704…`, `fa640f9f…`) were verified intact after cleanup.

---

## 15. Image/version compatibility findings

### 15.1 Stateful images

| Image | Tag in repo | Pinning | Persistent format version-coupled? |
| --- | --- | --- | --- |
| PostgreSQL | `postgres:18.4-bookworm` | **full 18.4 patch** | **YES** — raw PGDATA is tied to Postgres major 18; a 17- or 19-era data dir will not start cleanly under `postgres:18.4` |
| Redis | `redis:7-alpine` | minor-floating (`7.x` latest) | Redis 7.x RDB/AOF format stable across 7.x in practice; not guaranteed by tag alone |
| Node base (app image) | `node:24.15.0-bookworm-slim` | full patch | n/a (no persistent format) |
| App image | `build: .` (compose) | **no tag/digest pinning** | n/a — but rebuilds re-run forward migrations at next boot |
| E2E playwright | `mcr.microsoft.com/playwright:v1.61.0-noble` | minor pin | n/a |

### 15.2 Explicit record

> **Raw PostgreSQL data-directory portability is not the same thing as a
> version-independent historical backup.** The §13 proof relocates the *exact
> same bytes* at the *same postgres major version*. A `pg_dump` restore is
> portable across majors; a raw-PGDATA copy is not. The repo documents the
> former procedure (runbook §17) but never states the latter coupling (§7).

Two independent compatibility layers must be distinguished:

```text
PostgreSQL major-version compatibility
    Can postgres:18.4 even open the raw PGDATA? (A 17- or 19-era data dir
    will not start cleanly under 18.4.) If PostgreSQL cannot open the raw
    PGDATA due to a major mismatch, the app migration phase is NOT the first
    authority acting on that state.

Exam application migration-history compatibility
    Does the drizzle journal in the DB match the image's migration set
    (prefix / exact / ahead / divergent)? See §15.3.
```

### 15.3 Startup migration risk

`docker-entrypoint.sh` runs `node dist/scripts/migrate.js` **unconditionally
at every app boot**, and the email worker re-runs `migratePostgres` at startup.
Drizzle migrations are **forward-only** (no down migrations; rollback is
"restore the DB").

There is no pre-migration compatibility check today: the entrypoint does not
compare the image's expected migration set against the DB journal's applied
set before running. The desired future compatibility contract (NOT implemented
here — see P2-1 in §20) should be described conceptually as:

```text
DB migration history == image history
    → normal start

DB migration history is a valid prefix of image history
    → legitimate forward upgrade path
    → may run pending migrations under the documented upgrade contract
    (ordinary documented forward migration itself is NOT a defect)

DB contains migrations ahead of the image
    → downgrade / stale-image condition
    → should refuse before unsafe app startup

DB/image migration histories diverge
    → incompatible history
    → refuse / require operator intervention

different logical deployment with the same migration history
    → the migration journal alone cannot detect this
    → requires deployment identity / manifest design (P7-E0)
```

Severity: **P2** — the gap is the **absent schema/image compatibility
contract**, not ordinary forward migrations. No evidence shows that an ordinary
documented forward upgrade (DB history is a valid prefix of image history)
corrupts authoritative state; under documented operation the bundled postgres
image is patch-pinned and forward migrations are the intended upgrade path. A
future gate should refuse the *unsafe* conditions (DB ahead of image;
divergence) without blocking the legitimate forward-upgrade condition.

### 15.4 Floating tag severity

`redis:7-alpine` (P3): consequence = a `docker compose pull` may fetch a newer
7.x patch; Redis holds only ephemeral rate-limit state with TTL, so a format
or behavior drift cannot corrupt Exam truth. Bounded and non-authoritative.

---

## 16. Existing backup / restore reality

Search across `apps/ packages/ scripts/ docker/ .github/ Dockerfile compose`
for `pg_dump | pg_restore | pg_basebackup | archive_command | restic | borg |
WAL | PITR | backup | retention`:

| Capability | Reality |
| --- | --- |
| Logical backup (`pg_dump`) | **documented-only** — runbook §17 documents the command; the P6 audit explicitly states it was **never executed/validated** ("Validate the backup/restore procedure on first production deploy before relying on it") |
| Physical backup (`pg_basebackup`) | **mentioned only** as a runbook suggestion ("For larger deployments, consider…") |
| PITR / WAL archiving | **not present** — blockers are `archive_mode=off`, `archive_command` not configured, no WAL archive destination/retention, no base-backup/PITR recovery procedure, no recovery drill. **`wal_level=replica` is already sufficient** for continuous archiving and is NOT a blocker (RUNTIME PROOF, §7) |
| Off-host copy | not present |
| Retention | not present |
| Verification | not present |
| Restore drill | not present |
| Admin visibility | not present |
| Scheduler | not present ("Schedule backups via cron on the Docker host — the MVP does not ship a backup scheduler") |
| Any implementation in code | **NONE** — the only `pg_dump`/`backup` hits in code are an unrelated frontend comment |

Backup reality = **operator-supplied, documented-only, UNVALIDATED**. The
catastrophic recovery path is unvalidated and MUST NOT be represented as a
proven recovery guarantee. This is the single largest P7 disaster-readiness
gap; it does not affect the *relocation* answer (§13), only the
*historical-restore* answer.

### 16.1 Exact historical replacement is NOT proven (additional limitation)

The runbook's documented restore path approximately performs:

```text
pg_dump --clean --if-exists
    ↓
psql into the existing target database
```

**Exact historical state replacement is not proven.** Restoring an older dump
into an already-newer database may leave database objects that do not exist in
the historical dump unless the target database is recreated/cleaned under an
explicit restore contract. `--clean --if-exists` drops objects present in the
dump, but objects that exist in the target DB yet are absent from the older
dump are not removed by it. A future exact-restore contract therefore needs an
explicit target-recreate/clean step; this is NOT implemented here and belongs
to P7-C restore drills.

---

## 17. Relocation vs historical restore vs PITR boundary

| Operation | Meaning | Supported today? | Evidence |
| --- | --- | --- | --- |
| **CONTAINER RECREATION** | same volume bytes, same project, down → up | **PROVEN** (§13.1 H) | same named volume, no restore procedure |
| **SAME-MAJOR RAW PGDATA TRANSPLANT** | exact-byte copy of the PGDATA tree to a new isolated project/host at the same PostgreSQL major | **PROVEN** (§13.1, §13.2) | plain `cp -a`, same compatible image; NOT a clean-machine-B product-level proof |
| **PORTABLE CLEAN-HOST RELOCATION** | machine A → retain only canonical deployment resources → clean machine B → `docker compose up` → same Exam deployment | **PARTIAL / NOT_YET_PRODUCTIZED** | building blocks proven (§13), but the full clean-host/machine-B proof is the job of P7-C1 (§22); not rerun here |
| **HISTORICAL RESTORE** | replace current authority with an older known-good backup | **DOCUMENTED-ONLY, UNVALIDATED** (§16) | operator `pg_dump` + `psql`; live cycle never run; exact historical replacement NOT proven (§16.1) |
| **PITR** | replace authority with history reconstructed to target time T | **NOT IMPLEMENTED** — missing WAL archiving config | `archive_mode=off`, no `archive_command`, no WAL archive destination/retention, no base-backup/recovery procedure (RUNTIME PROOF, §7); `wal_level=replica` is NOT the blocker |

These have different correctness and future client-reconciliation semantics.
This report never uses "restore" where only relocation building blocks are
proven, and never uses "end-to-end recovery" wording for raw-PGDATA copying.
For a future authoritative history-generation / incarnation protocol
(ADR-016 binding requirement; non-binding illustration in the companion
architecture note), container recreation / same-history relocation are
history-stable; historical restore / PITR are history-changing.

---

## 18. Authoritative history generation / incarnation discovery

**Discovery only — nothing implemented. No concrete representation is frozen.**

Audit result: **no stable server-history generation / incarnation identifier
currently exists** that would let a future client distinguish ordinary server
restart / history continuation from authoritative history replacement
(historical restore or PITR).

```text
RUNTIME PROOF of absence:
  workerInstanceId = `${hostname()}-${process.pid}-${randomUUID()}`   → per-process random,
    apps/api/src/workers/emailDeliveryWorker.ts:162                    never stable across restarts
  no deployment/instance/history-generation table or env value exists
    (grep for instanceId/deploymentId/recoveryEpoch/historyGeneration
     across apps/api + packages/db)
  PostgreSQL exposes no app-reachable deployment identifier
```

Recorded input for P7-C1 / future client protocol design:

```text
AUTHORITATIVE_HISTORY_GENERATION_REQUIRED_FOR_FUTURE_CLIENT_PROTOCOL
  (binding requirement recorded in ADR-016; exact representation deferred;
   non-binding illustration, including the placeholder name recoveryEpoch,
   lives in docs/architecture/future-offline-resilient-client.md)
```

This is discovery only and must not become Desktop/offline scope creep, and
must not freeze a concrete schema/protocol representation in this PR.

---

## 19. Inputs required by P7-E0

Surfaces P7-E0 must decide (inventory only; no roles/capabilities created):

| Backup/authority concern | Kind of authority required |
| --- | --- |
| Locate/copy `pgdata` | **requires host filesystem access** (or Docker control to copy the named volume) |
| Logical backup (`pg_dump`) | requires DB access; safe as **service/worker or operator** execution; not a business route |
| Physical backup / PITR / WAL archiving | **requires PostgreSQL superuser/replication rights** + host filesystem + operator-only |
| Backup encryption | **requires an encryption secret** (escrow/rotation procedure) |
| Backup schedule/retention config | safe as **application-level setting** (P7 workstream C/E) |
| Backup status/history | safe as **Admin-visible status** |
| Trigger a backup | safe as **Admin-triggered command** (gated) |
| Verify/prune | safe as **service/worker execution** + operator oversight |
| Historical restore / PITR | **requires operator-only execution** (never Admin UI in Phase 1) |
| Operate while the API is unavailable | depends on PostgreSQL availability — see the three-condition split below |

Do **not** create roles/capabilities here — this list is the P7-E0 input.

### 19.1 Operations under partial unavailability — three distinct conditions

> Correction: a prior draft of this handoff stated "backup CLI already ships in
> the image". That is **false**. Exam ships **no dedicated backup CLI**;
> operators can invoke PostgreSQL tooling such as `pg_dump` through the DB
> container / PostgreSQL toolchain. `bootstrap-admin` and `reset-admin-password`
> are DB-dependent application CLIs, **not** DB-unavailable recovery tools.
> Which operations can work while the API or PostgreSQL is unavailable splits
> into three distinct conditions:

```text
A. API unavailable, PostgreSQL available
   → operator PostgreSQL tooling (pg_dump etc.) may still run via the DB
     container / PostgreSQL toolchain
   → backup / export may be possible
   → DB-dependent application CLIs (bootstrap-admin, reset-admin-password)
     may still work because the DB is available

B. PostgreSQL service unavailable, PGDATA still exists
   → application DB-dependent CLIs do NOT work
   → host / storage / PostgreSQL recovery tooling is required to restore the
     service before any application CLI can run

C. PostgreSQL authoritative data is lost or replaced (historical restore / PITR)
   → historical restore / PITR tooling must operate INDEPENDENTLY of the
     running application API
   → recovery cannot depend solely on configuration stored inside the DB
     being recovered
```

This three-way split is a direct input to P7-E0's future authority distinction
between Admin authority, service/executor authority, and deployment/operator
authority — but those roles are NOT designed here.

---

## 20. Findings by severity

> One primary severity per finding. Severity is not escalated to P1: no evidence
> shows that an ordinary supported runtime corrupts authoritative state. These
> are P7 readiness / disaster-readiness blockers, not supported-runtime
> data-loss defects.

### P0

```text
None.
```

### P1

```text
None.
```

### P2 (P7 readiness / disaster-readiness blockers)

```text
P2-1  Schema / image compatibility contract is ABSENT. docker-entrypoint.sh
      runs node dist/scripts/migrate.js unconditionally at every app boot
      (worker re-runs migratePostgres) with NO pre-migration journal/version
      check against the mounted raw PGDATA. The desired future contract is
      described in §15.3 (DB history == image → normal; DB history is a valid
      prefix of image → legitimate forward upgrade; DB ahead of image → refuse;
      histories diverge → refuse; same history but different logical deployment
      → migration journal alone cannot detect). Ordinary documented forward
      migration is NOT itself the defect; the defect is the absent gate for the
      unsafe conditions (DB ahead / divergence). Evidence: docker-entrypoint.sh,
      packages/db/src/postgres.ts. PostgreSQL-major compatibility (§15.2) is a
      separate, lower layer. Suggested P7-C1: a compatibility gate, NOT a blanket
      refusal of prefix==forward. This is NOT a backup implementation.

P2-2  Historical backup / restore path is UNVALIDATED. The only recovery path
      after authoritative loss is an operator-supplied pg_dump that the P6 audit
      never executed or validated (§16). The catastrophic recovery path is
      unvalidated and MUST NOT be represented as a proven recovery guarantee.
      This is a serious disaster-readiness blocker, NOT evidence that ordinary
      supported runtime corrupts authority — hence P2, not P1. Blocks Gate P7-3.

P2-3  Exact historical replacement semantics are UNPROVEN. The runbook's
      pg_dump --clean --if-exists → psql-into-existing-DB path does not prove
      exact historical state replacement: restoring an older dump into an
      already-newer database may leave objects absent from the dump unless the
      target is recreated/cleaned under an explicit restore contract (§16.1).
      A future exact-restore contract needs an explicit target-recreate/clean
      step. Belongs to P7-C restore drills; NOT implemented here.

P2-4  Portable clean-host relocation is NOT YET PRODUCTIZED/PROVEN. The §13
      experiment proves container recreation and same-PostgreSQL-major
      exact-byte PGDATA transplant (isolated project/host), but does NOT prove
      the full machine-A → clean-machine-B product-level relocation. Raw PGDATA
      major-version coupling is also undocumented in the repo. Relocation works
      when exact bytes + same major are preserved, but nothing in the repo says
      so, and the clean-host proof is P7-C1's job. Evidence: §7, §13, §15.2.

P2-5  Image / deployment version identity contract is INCOMPLETE. App image has
      no tag/digest pinning (compose `build: .`); redis:7-alpine is
      minor-floating. Combined with P2-1, a rebuilt/different image set is a
      realistic incompatible-restart vector. Postgres + node bases are fully
      pinned (bounded, but recorded). "Same images" is not decidable today.
```

### P3 (non-blocking debt / drift / ergonomics / hardening)

```text
P3-1  Dev DB (docker-compose.dev.yml) uses an anonymous volume; `pnpm db:reset`
      (`down -v`) silently destroys the human's dev data; identifying the
      volume requires Docker archaeology. Dev-only, documented hazard.
P3-2  `workerHeartbeats` is defined in the schema but OMITTED from the drizzle
      `schema` aggregate export (packages/db/src/schema/pg.ts:1069 vs 1770-1798);
      it still works via direct import (workerHeartbeatRepo). Recorded; not fixed.
P3-3  Runtime image ships compiled test artifacts (`dist/**/*.test.js`,
      `*.test.d.ts`) and the destructive rollback scripts
      (`dist/scripts/rollback-incident-tables.js`,
      `rollback-attempt-command-receipts.js`). Image hygiene / accidental
      invocation risk. Not a durability defect.
P3-4  `docker-compose.dev.yml` redis runs without auth and with AOF off — dev-only
      divergence from the production (requirepass + appendonly) contract.
P3-5  Re-running the E2E seed (`RUN_SEED=e2e`) against a non-fresh DB is
      undefined/non-idempotent (entrypoint runs it whenever RUN_SEED=e2e);
      production is protected by APP_MODE refusal, dev/e2e only. Recorded.
P3-6  Best-effort audit observations are in-memory queued (10s graceful drain);
      SIGKILL drops un-drained observations (ADR-006 documented behavior).
```

> Note on consolidation: the prior draft double-counted the raw-PGDATA
> version-coupling and named-volume-ergonomics facts as both P2-3 and P3-5/P3-6.
> They are consolidated under P2-4 above (the version-coupling fact feeds the
> clean-host relocation gap; the named-volume ergonomics is the same
> relocation-readiness concern). P3 now lists only genuinely non-blocking
> debt.

---

## 21. Unknowns / evidence gaps

```text
UNKNOWN-1  Live pg_dump/restore cycle has never been run (P6 audit admission).
           The §16 "documented-only" classification is the honest state; a
           restore drill is required to close this — but it belongs to the
           Backup / Historical Restore track, NOT to P7-C1 (§22 scope note).
UNKNOWN-2  Whether a postgres-17-era raw PGDATA would be mutated by
           postgres:18.4 startup before refusing (major mismatch handling).
           Not tested — refused to test destructively against a real older
           volume; the image pins 18.4 so the risk is operator-created.
UNKNOWN-3  Redis 7.x future patch behavior under `redis:7-alpine` (e.g. a
           hypothetical 7.6 release changing RDB/AOF semantics). Impact
           bounded to rate-limit counters; unverifiable without a future image.
UNKNOWN-4  Whether `docker compose down -v` on the DEV project would be the only
           thing protecting/breaking dev data (documented; not executed on the
           shared dev volume).
```

No `UNKNOWN` hides authoritative state loss: the authoritative store is
exhaustively enumerated (§5/§6), its physical form verified (§7), and its
container-recreation + same-major exact-PGDATA-transplant building blocks
proven (§13). The clean-host/machine-B relocation, historical restore, and
PITR are explicitly NOT in the proven set (§17).

---

## 22. Recommended P7-C1 entry contract

What P7-C1 must prove (recommendation only — NOT implemented here):

```text
1. A pre-migration COMPATIBILITY GATE (not a blanket refuse-on-mismatch):
   - DB history == image history                          → normal start
   - DB history is a valid PREFIX of image history        → legitimate forward
                                                            upgrade; may run pending
                                                            migrations under the
                                                            documented upgrade contract
   - DB contains migrations AHEAD of the image            → stale-image/downgrade;
                                                            refuse before unsafe startup
   - DB/image histories DIVERGE                           → incompatible; refuse /
                                                            require operator intervention
   - same history but different logical deployment        → migration journal alone
                                                            cannot detect; requires
                                                            deployment identity/manifest
   AND refuse if the postgres major differs from the raw PGDATA's major.
   Ordinary documented forward migration must NOT be blocked (§15.3).

2. A CLEAN-HOST RELOCATION proof (machine A → clean machine B), retaining only
   canonical deployment resources, with no source-build surprise and no
   Docker-volume archaeology. The §13 experiment proved the building blocks
   (container recreation, same-major exact PGDATA transplant) on an isolated
   host; the clean-machine-B proof is P7-C1's job and was NOT rerun here.

3. An operator-transparent canonical state location (evaluate bind mount or
   documented named-volume procedure) so relocation does not depend on
   Docker-internal archaeology.

4. An image version contract: pin app image by tag/digest and redis by patch
   (or record the accepted drift), so "same images" is decidable.

5. Document raw-PGDATA major-version coupling next to the relocation procedure.

6. Confirm the §13 building-block invariants remain true after any of the above.
```

**Scope discipline — what P7-C1 is NOT.** P7-C1 is **portable single-node
deployment** only (canonical data root, compatible/pinned image, machine A →
clean machine B, ordinary `docker compose up`). It does **not** include a
backup/restore drill. The C0 boundary (§17) deliberately separates these:

```text
P7-C1  Portable Single-Node Deployment (relocation, same authoritative history)
    → canonical data root
    → compatible/pinned image
    → machine A → clean machine B
    → ordinary docker compose up

Later  Backup / Historical Restore (C2/C3, history-changing)
    → backup artifact
    → clean-target restore
    → restore verification

Later  PITR (history-changing)
```

A validated `pg_dump → recreate/clean target → restore → post-restore invariant`
drill, including the exact historical replacement semantics of §16.1, belongs
to the **Backup / Historical Restore** track — it is recorded as P2-2/P2-3 and
left out of P7-C1's acceptance on purpose. Folding it into C1 would re-couple
relocation and backup, which C0 just separated. Do **not** re-add it to C1's
acceptance list.

Candidate invariant for P7-C1 (refined to match the corrected evidence):

> For the supported single-node deployment, exact durable-state relocation
> should require no application-specific restore procedure: compatible images
> plus deployment configuration plus canonical persistent state should be
> sufficient to recreate the same Exam deployment — **proven so far for
> container recreation and same-PostgreSQL-major exact-byte PGDATA transplant
> on an isolated host; the clean-machine-B product-level proof is P7-C1's
> remaining work.**

Not "feasible today" as a clean-host claim — feasible today only at the
building-block level proven in §13.

---

## 23. Recommended P7-E0 questions

Handoff to the next configuration/operations authority gate (inventory only;
not answered beyond current evidence):

```text
1.  Which values are physical deployment bindings?     → DATABASE_URL, REDIS_URL,
    HOST/PORT, compose topology, volume layout
2.  Which are secrets?                                  → POSTGRES_PASSWORD, JWT_SECRET,
    REDIS_PASSWORD, SMTP_PASSWORD, seed passwords
3.  Which values identify the deployment and must survive relocation?
                                                        → JWT_SECRET (sessions), PUBLIC_WEB_ORIGIN,
    CORS_ORIGIN, DEPLOYMENT_MODE, POSTGRES_USER/DB naming
4.  Which operational policies can safely move from env to versioned DB settings?
                                                        → rate limits, scanner intervals, email
    retry/poll, timezone, feature flags (see §11 column 7)
5.  Which backup settings should be Admin-editable?     → schedule, retention, destination reference,
    verification cadence (NOT the credentials)
6.  Which values may only be referenced by Admin but resolved by deployment config?
                                                        → DB/Redis/SMTP endpoints + credentials
7.  Who may request a backup?                           → P7-E0 to decide (operator/Admin/worker)
8.  Who executes a backup?                              → operator or worker (Postgres access required)
9.  Who verifies/prunes it?                             → operator + worker/CLI
10. Who may inspect backup history?                     → Admin (read-only status)
11. Who can perform historical restore?                 → operator-only (never Admin UI in Phase 1)
12. Who can perform PITR?                               → operator-only (requires superuser/replication)
13. Which operations must still work when the API or PostgreSQL is unavailable?
                                                        → split into three conditions (§19.1):
                                                          A. API down, PostgreSQL up → operator
                                                             PostgreSQL tooling (pg_dump etc.) and
                                                             DB-dependent app CLIs (bootstrap-admin,
                                                             reset-admin-password) may work
                                                          B. PostgreSQL service down, PGDATA exists →
                                                             app CLIs do NOT work; host/storage/PG
                                                             recovery tooling required
                                                          C. PostgreSQL authority lost/replaced →
                                                             historical restore/PITR tooling must run
                                                             INDEPENDENTLY of the running API
                                                        → NOTE: Exam ships NO dedicated backup CLI; the
                                                          only PG-side tooling is operator-invoked
                                                          pg_dump via the DB container. P7-E0 must
                                                          decide whether a backup CLI is in scope.
```

---

## 24. Exact commands / runtime evidence

### 24-1. Redis isolated discard experiment

```bash
docker run -d --name p7c0-redis-probe -v p7c0-probe-vol:/data redis:7-alpine
docker exec p7c0-redis-probe redis-cli SET probe:key hello
docker exec p7c0-redis-probe redis-cli SAVE
# key before discard: hello ; appendonly=no save="3600 1 300 100 60 10000"
docker rm -f p7c0-redis-probe && docker volume rm p7c0-probe-vol
docker run -d --name p7c0-redis-probe redis:7-alpine
docker exec p7c0-redis-probe redis-cli GET probe:key   # → '' (empty)
docker rm -f p7c0-redis-probe
```

### 24-2. PostgreSQL container-recreation + same-host exact-PGDATA-copy probe

```bash
# isolated compose (temp dir, unique project, ports 15440/15441/15442)
docker compose -p p7c0reloc1 up -d            # create table reloc_probe + 2 rows
docker compose -p p7c0reloc1 down             # containers removed, volume kept
docker compose -p p7c0reloc1 up -d            # rows + md5 unchanged   → CONTAINER RECREATION: PROVEN
docker run --rm -v p7c0reloc_pgdata:/from -v ./pgcopy:/to alpine \
  sh -c 'cp -a /from/. /to/'                  # plain file copy, no volume tooling
docker compose -p p7c0reloc2 up -d            # bind mount ./pgcopy → rows + md5 unchanged

# Observed invariant (recorded, not rerun for this corrective pass):
#   md5(string_agg(id|label)) = f4c2b2ef48df6c0419ae4cd06679c7d3
#   identical before down, after recreate (p7c0reloc1 up), and after
#   same-host exact copy into new project (p7c0reloc2 up).
#   named volume size: 46.3 MB
# Classification: CONTAINER RECREATION PROVEN; SAME-HOST/SAME-MAJOR EXACT-PGDATA
#   COPY PROVEN. This is NOT a clean-machine-B product-level relocation proof.
```

### 24-3. Full-stack cold relocation with the real image (current master)

```bash
docker build -t exam-p7c0-probe:latest .      # from baseline SHA
# project p7c0full1: app + db + email-worker, volume p7c0full_pgdata, RUN_SEED=e2e
# seed produced: orgs|1 users|6 courses|3 questions|10 exams|4 enrollments|8 attempts|8
docker compose -p p7c0full1 down
docker run --rm -v p7c0full_pgdata:/from -v ./fullcopy:/to alpine sh -c 'cp -a /from/. /to/'
docker compose -p p7c0full2 up -d             # bind mount ./fullcopy, RUN_SEED unset
# relocated: app healthy; exams|4 attempts|8 answers_present|8 submitted|6 migrations|29
#            GET /api/health ok; admin login ok; GET /api/system/health {"status":"ok"}
```

### 24-4. Physical persistence runtime evidence

```bash
docker inspect exam-db-1   # anonymous volume 80e5f704… @ /var/lib/postgresql (dev)
docker exec exam-db-1 sh -c 'echo $PGDATA'    # /var/lib/postgresql/18/docker
docker image inspect postgres:18.4-bookworm --format '{{json .Config.Volumes}}'
# {"/var/lib/postgresql":{}}  ← postgres 18 VOLUME moved to the parent dir
SHOW archive_mode; SHOW archive_command; SHOW wal_level; SHOW max_wal_senders;
SHOW fsync; SHOW full_page_writes;
# off / (disabled) / replica / 10 / on / on
```

### 24-5. Cleanup (isolated resources only; shared dev volumes verified intact)

```bash
docker compose -p p7c0reloc1 down -v; docker compose -p p7c0reloc2 down
docker compose -p p7c0full1 down -v; docker compose -p p7c0full2 down
docker volume rm p7c0reloc_pgdata p7c0full_pgdata
# verified: exam-db-1 / exam-redis-1 and their volumes (80e5f704…, fa640f9f…) untouched;
# dev DB exams count unchanged
```

---

## 25. Answer to the central question

> **If every disposable part of this machine disappears tonight, which exact
> bytes must I still possess tomorrow for this to remain the same Exam
> system?**

```text
1.  The PostgreSQL data-directory tree behind the `pgdata` named volume
    (PGDATA /var/lib/postgresql/18/docker) — the ONLY authoritative store.
2.  The deployment configuration (.env / compose): POSTGRES_* credentials,
    JWT_SECRET, CORS_ORIGIN, PUBLIC_WEB_ORIGIN, and any Email/Redis policy —
    required to resume as the same logical deployment.
3.  A compatible app image (rebuildable from the pinned source tree) and the
    pinned postgres:18.4 image.

Everything else — Redis, container writable layers, /app/data, logs,
worker heartbeats, browser storage, generated files — is disposable.
```

The §13 experiments prove — **at the building-block level** — that bytes (1)
alone, moved with a plain `cp -a` and restarted with (2)+(3), reproduce the
same Exam deployment with all authoritative invariants intact, for container
recreation and same-PostgreSQL-major exact-byte PGDATA transplant on an
isolated host. They do **not** prove the clean-machine-B product-level
relocation (§17, §22).

---

## 26. Final verdict

```text
P7-C0 DURABILITY REALITY AUDIT READY FOR HUMAN REVIEW
```

```text
P0: none
P1: none
P2: 5 (P2-1 schema/image compatibility contract absent; P2-2 historical
       backup/restore path UNVALIDATED; P2-3 exact historical replacement
       semantics UNPROVEN; P2-4 portable clean-host relocation NOT YET
       PRODUCTIZED/PROVEN; P2-5 image/deployment version identity contract
       incomplete)
P3: 6 (dev anonymous volume; workerHeartbeats schema-aggregate omission;
       test artifacts + rollback scripts in image; dev redis divergence;
       E2E seed non-idempotency; best-effort audit drain window)

Container recreation:                        PROVEN
Same-major raw PGDATA cold transplant:       PROVEN  (isolated host)
Portable clean-host relocation:              PARTIAL / NOT_YET_PRODUCTIZED
Historical backup/restore:                   DOCUMENTED-ONLY, UNVALIDATED
Exact historical replacement semantics:      UNPROVEN (§16.1)
PITR:                                        NOT IMPLEMENTED (missing WAL
                                             archiving config; wal_level=replica
                                             is NOT the blocker)

Authoritative durable stores:
  [ PostgreSQL (pgdata named volume; 29 tables; drizzle journal in-DB) ]

Durable non-DB artifacts:
  [ none — /app/data unused (STRONG SOURCE FACT + supporting runtime
    observation); logs stdout-only; CSV export in-memory;
    no uploads/attachments/files on disk ]

Ephemeral stores:
  [ Redis (rate-limit counters, TTL-bounded; AOF/RDB irrelevant to authority),
    container writable layers, in-process maps (admission queue, preset
    cache, best-effort audit queue), browser localStorage/sessionStorage ]

Non-authoritative, non-reconstructable telemetry:
  [ client_events — acceptable to lose for Exam correctness, but its loss
    destroys historical observational evidence that cannot be recovered from
    another authoritative source ]

Deployment-identity dependencies:
  [ JWT_SECRET (sessions), PUBLIC_WEB_ORIGIN, CORS_ORIGIN, DEPLOYMENT_MODE,
    POSTGRES_USER/DB naming; no stable server-history generation/incarnation
    ID exists ]

Unknown persistence surfaces:
  [ none for authoritative state; UNKNOWN-1..4 are documented non-authority
    or untested-drill gaps (§21) ]

P7-C1 blockers:
  [ clean-host/machine-B relocation proof NOT yet done (P2-4);
    pre-migration compatibility gate required (P2-1) — must refuse DB-ahead /
    divergent histories WITHOUT blocking legitimate forward upgrade ]
Backup / Historical Restore blockers (NOT P7-C1 — see §22 scope note):
  [ validated backup/restore drill required for Gate P7-3 (P2-2);
    exact historical replacement contract required (P2-3) ]

P7-E0 decision inputs:
  [ §11 configuration-source inventory (19 settings classified),
    §19 authority-surface inventory + three-condition unavailability split
    (§19.1), §23 question list ]
```

**STOP. Audit complete — no P7-C1 or P7-E0 implementation was started, and no
finding was fixed. No production/runtime source, Compose topology, migration,
or backup implementation was changed in this corrective pass.**
