# P7-E0 Configuration Reality Audit

**Status:** CLOSED (merged via PR #276, 2026-08-10)
**Program:** P7-E — Configuration control plane (pre-implementation audit)
**Baseline (`origin/master`):** `b4e18b2bf0390e717edd54ec9467a27ac2d19a8a`
**Tree at audit:** clean
**Code changes:** NONE (docs-only). No runtime code, no schema, no settings UI.

---

## 1. Executive conclusion

The exam platform's configuration is **already meaningfully layered**, and most of
that layering is **correct for a single-tenant LAN/on-premise product**. The
eight-layer taxonomy proposed by the P7-E program exists in part today, and the
parts that do not exist are deliberately deferred, not accidentally missing.

The single most important structural fact for P7-E is:

> **There is no generic settings subsystem, and the current evidence does not
> justify building one.**

Configuration is partitioned along authority lines that already work:

| Class | Where it lives today | Count (meaningful items) |
| --- | --- | --- |
| A — Deployment / secret / topology | env + Docker Compose + secret store | ~16 |
| B — System operational policy | env (boot-validated, restart-required) | ~10 |
| C — Organization-owned configuration | `organization_settings` (5 cols) + `candidate_fields` table | ~6 concepts |
| D — Exam policy | `exams` columns + `control_flags` jsonb + frozen snapshots | ~20 |
| E — Code-owned invariants / engineering constants | source literals | ~25 |

Exam policy (Class D) is the deepest and most hazard-sensitive layer. Its freeze
discipline is real, but it is **two different mechanisms that must not be
conflated** (see §12):

1. **True snapshots** — copied immutable data: `question_snapshot` (built at
   publish, copied to each attempt), interruption-policy snapshot + deadline +
   submitted answers (frozen at attempt creation).
2. **Published-row immutability** — `result_publication_mode`, `retake_policy`,
   `score_strategy`, `passing_score`, `control_flags` are **not** copied into a
   per-attempt snapshot; they are read live from the published exam row. They are
   safe today **only** because the published-edit route guard
   (`exam.ts:631`) makes those columns immutable post-publish. The runtime
   live-reads an already-frozen authority; it does not snapshot it.

Both mechanisms are correct today, but they are **not the same thing**. This
distinction is the single most important input P7-M1 inherits (P2-M1, §12).

**No P7-E1 implementation is currently justified.** The current evidence does not
identify a confirmed, near-term product requirement for Admin-editable
deployment-wide operational policy. Email worker/retry policy is a **candidate**,
not a preselected E1 — and backup-status visibility is a separate future
operational capability, not a settings slice (§21). A valid E0 outcome is:
**close E0 with "no settings control plane justified now"; proceed to P7-M1**
(exam policy resolution / freeze model), which is where the real configuration
pressure already exists. A future E1 is triggered only by a concrete
operator/product requirement, not by roadmap inertia.

No P0 or P1 configuration authority defects were found. The findings are P2
(four concept/boundary refinements) and P3 (naming/docs).

---

## 2. Baseline and methodology

**Baseline SHA:** `b4e18b2bf0390e717edd54ec9467a27ac2d19a8a` (origin/master,
clean tree).

**Method:** evidence-driven inventory from current `master`, not from prior P7
planning text. Three parallel evidence passes covered (a) the runtime config
loader and every `process.env`/`import.meta.env` read, (b) every
`.env`/Compose/Dockerfile/entrypoint/backup-script configuration surface, and
(c) every DB column that functions as configuration or frozen snapshot. Each
configuration value was then followed from **definition → parse/validation →
source → consumer → business effect**, and classified into exactly one primary
class plus a mutation-lifecycle tag.

**Authority documents read:** `AGENTS.md`, `docs/roadmap/current.md`,
`docs/roadmap/P7-system-readiness-and-exam-modes.md` (Workstream E + Gate P7-4),
`docs/architecture/exam-system/state-and-authority.md`,
`docs/deployment/mvp-deployment-runbook.md`, `docs/deployment/backup-and-recovery.md`
(via the P7-C closeout), `docs/architecture/email-config.md`,
ADR-001 / ADR-006 / ADR-008 / ADR-011 / ADR-014 / ADR-015 / ADR-016, and the
P7-C portable-backup-recovery closeout.

### Configuration-layer model under investigation

```text
code defaults
    ↓
deployment bootstrap / secrets
    ↓
system operational settings      ← layer gap: no DB-backed system settings store today
    ↓
organization settings            ← exists: organization_settings (branding/locale only)
    ↓
exam policy profile              ← layer gap: no profile/template layer; exams carry policy directly
    ↓
per-exam overrides               ← exists: exams.* columns + control_flags
    ↓
publish snapshot                 ← exists: exams.question_snapshot (frozen at publish)
    ↓
attempt execution snapshot       ← exists: attempt question snapshot + interruption policy snapshot + deadline + submitted answers
```

Status per layer (P7-E §2 taxonomy):

| Layer | Status | Evidence |
| --- | --- | --- |
| code defaults | IMPLEMENTED | `runtimeConfig.ts` defaults; DB column `default(...)`; repo fallback constants |
| deployment bootstrap / secrets | IMPLEMENTED | `.env` + Compose `${VAR:?…}` + entrypoint; Launchpad first-install |
| system operational settings | NOT IMPLEMENTED | currently env-only (Class B). See §6. |
| organization settings | PARTIAL | branding + `timezone` only (Class C). No defaults/locale/notification prefs. |
| exam policy profile | NOT IMPLEMENTED | P7-M1 territory; explicitly out of E0 scope |
| per-exam overrides | IMPLEMENTED | `exams.*` columns + `control_flags` jsonb |
| publish question snapshot | IMPLEMENTED | `exams.question_snapshot` (built & frozen at publish; true immutable copy) |
| published policy freeze | IMPLEMENTED | published-edit route guard (`exam.ts:631`) makes `result_publication_mode` / `retake_policy` / `score_strategy` / `passing_score` / `control_flags` immutable post-publish — **row immutability, not a snapshot** (§12) |
| full resolved policy snapshot | NOT IMPLEMENTED | no profile→exam resolution step yet; deferred to P7-M1 design (§12, P2-M1) |
| attempt execution snapshot | PARTIAL | true snapshots at attempt start: question snapshot (copy), interruption-policy snapshot, deadline, submitted answers. Exam-level policy is **not** copied per-attempt — read live from the immutable published row (§12) |

---

## 3. Current configuration architecture

```text
                    ┌─────────────────────────────────────────────┐
  process.env       │  .env / .env.test.local  (gitignored)        │
   (shell wins)     │  .env.example / .env.test.example (tracked)  │
        │           └─────────────────────────────────────────────┘
        ▼
  loadRootEnv()  ── dotenv, NO override (process.env wins) ─────────►
        │
        ▼
  ┌──────────────────────────────────────────────────────────────┐
  │ apps/api/src/config/runtimeConfig.ts                          │
  │  getRuntimeConfig()  ← validated ONCE at boot, memoized       │
  │  loadRuntimeConfig(env) → AppRuntimeConfig                    │
  │  delegates APP_MODE + DATABASE_URL to @exam/db/databaseUrl.ts │
  └──────────────────────────────────────────────────────────────┘
        │
        ├──► consumers: server.ts, plugins, routes, worker, seed
        │
        └──► buildPublicConfig()  (non-sensitive subset to web)
                  • deploymentMode, apiReference only
                  • NEVER secrets, rate-limit internals, or FEATURE_* flags

  PostgreSQL authority store:
   organizations / organization_settings  (branding, timezone, candidate_fields)
   exams  (exam policy: timing, control_flags, retake, score strategy, result publication…)
   exam_attempts  (frozen snapshots + deadline + interruption policy snapshot)
   audit_logs / *_events / *_receipts  (append-only evidence; NOT a settings store)
```

The canonical loader is **single and memoized** — `getRuntimeConfig()` validates
once at boot and caches. This is the correct shape. The hazard is not the loader;
it is the **handful of legitimate bypasses** (§11) and the **system-operational
tuning knobs that are env-only today** (§6).

---

## 4. Complete configuration inventory

The table below inventories every meaningful configuration item. "Source" is the
**current** source. The full column set required by P7-E §4 is condensed here for
readability; per-item detail lives in the class sections (§5–§9) and the
precedence (§10), bypass (§11), hazard (§12), secrets (§13), and boundary
sections (§14–§18).

Legend — **Class**: A=deployment/secret, B=system operational, C=organization,
D=exam policy, E=code/invariant. **Lifecycle**: BOOT=read at boot,
RESTART=editable but restart-required, DYNAMIC=safe to hot-change,
FUTURE=affects new entities only, PUBLISH_FROZEN, ATTEMPT_FROZEN,
IMMUTABLE=install/bootstrap-only, CODE=not configurable.

### A. Deployment / secret / topology (env + Compose; remain operator-owned)

| ID | Name | Source | Secret? | Topology? | Restart? | Lifecycle |
| --- | --- | --- | --- | --- | --- | --- |
| A01 | `POSTGRES_PASSWORD` | Compose `${VAR:?}` | yes | yes | yes | BOOT / IMMUTABLE-ish |
| A02 | `DATABASE_URL` | Compose-composed from `POSTGRES_*` | yes (embeds pw) | yes | yes | BOOT |
| A03 | `TEST_DATABASE_URL` | `.env.test.local` | yes | yes (test) | n/a (test) | BOOT (test only) |
| A04 | `JWT_SECRET` | env; required in prod | yes | no | yes | BOOT |
| A05 | `REDIS_URL` (embeds `REDIS_PASSWORD`) | env + Compose | yes (when set) | yes | yes | BOOT |
| A06 | `REDIS_PASSWORD` | Compose redis profile | yes | yes | yes | BOOT |
| A07 | `SMTP_PASSWORD` | env; smtp only | yes | no | yes | BOOT |
| A08 | `SMTP_USER` | env; smtp only | sensitive | no | yes | BOOT |
| A09 | `SMTP_HOST` / `SMTP_PORT` | env; smtp only | no | yes (mail relay) | yes | BOOT |
| A10 | `CORS_ORIGIN` | env; required in prod | no | yes (allowed origins) | yes | BOOT |
| A11 | `PUBLIC_WEB_ORIGIN` | env; required in prod | no | yes (origin) | yes | BOOT |
| A12 | `APP_PORT` / `HOST` | env + Dockerfile `ENV` | no | yes (bind) | yes | BOOT |
| A13 | `EXAM_DATA_ROOT` | Compose host bind-mount root | no | yes (host path) | yes | BOOT |
| A14 | `EXAM_WAL_ARCHIVE_HOST_PATH` | Compose WAL mount | no | yes (host path) | yes | BOOT |
| A15 | `LAUNCHPAD_SETUP_TOKEN` | env | yes (bootstrap secret) | no | yes (boot-once) | IMMUTABLE-after-init |
| A16 | `APP_MODE` / `NODE_ENV` | env; Dockerfile `ENV` | no | yes (mode) | yes | BOOT / IMMUTABLE |

### B. System operational policy (env, boot-validated, restart-required)

| ID | Name | Default | Definition | Restart? | Lifecycle |
| --- | --- | --- | --- | --- | --- |
| B01 | `HEARTBEAT_SCAN_INTERVAL_MS` | 30000 | `runtimeConfig.ts:831` | yes | RESTART |
| B02 | `HEARTBEAT_TIMEOUT_MS` | 60000 | `runtimeConfig.ts:834` (must be multiple of 1000) | yes | RESTART |
| B03 | `DEADLINE_SCAN_INTERVAL_MS` | inherits 30000 | `deadlineScanner.ts:336` (direct read; bypasses loader) | yes | RESTART |
| B04 | `RATE_LIMIT_MAX` | 100 | `runtimeConfig.ts:887` | yes | RESTART |
| B05 | `RATE_LIMIT_WINDOW_MS` | 60000 | `runtimeConfig.ts:888` | yes | RESTART |
| B06 | `RATE_LIMIT_DISABLED` | false (auto in e2e) | `runtimeConfig.ts:886` | yes | RESTART |
| B07 | `REDIS_MODE` | `optional` if URL else `off` | `runtimeConfig.ts:537` | yes | RESTART |
| B08 | `REDIS_*_TIMEOUT_MS` (connect/command/startup) | 2000/1000/8000 | `runtimeConfig.ts:599-601` | yes | RESTART |
| B09 | `EMAIL_WORKER_POLL_INTERVAL_MS` | 5000 | `runtimeConfig.ts` worker resolver | yes | RESTART |
| B10 | `EMAIL_WORKER_BATCH_SIZE` | 20 | same | yes | RESTART |
| B11 | `EMAIL_WORKER_LOCK_TIMEOUT_MS` | 300000 | same (lease sanity guard vs SMTP timeouts) | yes | RESTART |
| B12 | `EMAIL_WORKER_HEARTBEAT_STALE_MS` | 60000 | same | yes | RESTART |
| B13 | `EMAIL_MAX_ATTEMPTS` | 3 | `runtimeConfig.ts:667` | yes | RESTART |
| B14 | `EMAIL_RETRY_BASE_SECONDS` | 60 | `runtimeConfig.ts:669` | yes | RESTART |
| B15 | `APP_TIMEZONE` / `TZ` / `PGTZ` | Asia/Shanghai | `runtimeConfig.ts:255` + Compose | yes | RESTART (display only — ADR-006) |

> Note: `LOG_LEVEL` is referenced in `.env.example`/docs but is **not read in
> source** — the logger hardcodes `level: "info"` (`server.ts:108`). `JWT_EXPIRES_IN`
> does not exist — TTL is hardcoded `"24h"` (`packages/auth/src/session.ts:40`).
> `PORT` is not read — the loader reads `APP_PORT`. See §11 / §25.

### C. Organization settings (DB: `organization_settings`)

| ID | Column | Default | Effect | Lifecycle |
| --- | --- | --- | --- | --- |
| C01 | `product_name` | fallback `"LAN Exam Platform"` (`settingsRepo.ts:99`) | branding title | DYNAMIC (org-admin) |
| C02 | `product_subtitle` | none | branding subtitle | DYNAMIC |
| C03 | `footer_text` | none | branding footer | DYNAMIC |
| C04 | `organization_display_name` | fallback `organizations.display_name` | branding org name | DYNAMIC |
| C05 | `timezone` | none (nullable) | stored but **display only**; ADR-006 forbids it changing business-time semantics | DYNAMIC (display) |
| C06 | `candidate_fields` (table) | seeded per-org | configurable examinee identity schema | FUTURE (new candidates) |

> `organization_settings` is the **only** real settings table. It is branding +
> locale only. There is **no** `systemSettings`, no notification-preference table,
> no email-event-config table. Org-level defaults for exam policy do not exist
> (there is no "defaults → org → exam" resolver for policy; only branding merges,
> in `getPublicBranding`).

### D. Exam policy (`exams` columns + `control_flags` jsonb + snapshots)

| ID | Field | Type / default | Freeze point | Lifecycle |
| --- | --- | --- | --- | --- |
| D01 | `timing_mode` | text (`timed_window` only in Phase 1) | publish | PUBLISH_FROZEN (via published-edit guard) |
| D02 | `duration_minutes` | int | **attempt creation** (→ `attempt.deadline_at`) | ATTEMPT_FROZEN |
| D03 | `open_at` / `close_at` | timestamptz | publish (editable post-publish — schedule only) | PUBLISH_FROZEN-ish (schedule mutable) |
| D04 | `passing_score` / `total_score` | double | publish | PUBLISH_FROZEN |
| D05 | `question_selection_mode` | `manual`/`random` | publish | PUBLISH_FROZEN |
| D06 | `question_ids` | jsonb | publish | PUBLISH_FROZEN |
| D07 | `question_snapshot` | jsonb `QuestionSnapshot[]` | **built & frozen at publish** (`examCommands.ts:127`) | PUBLISH_FROZEN (immutable) |
| D08 | `control_flags` (jsonb) | shuffle/detectTabSwitch/disableCopyPaste/requireQueue+batchSize+batchInterval/restrictIp/requireLockdown | publish | PUBLISH_FROZEN |
| D09 | `retake_policy` | `unlimited`/`max_attempts`/`daily_limit`/`weekly_limit`/`pass_then_stop` | publish; **read LIVE** at attempt/grading time (not per-attempt snapshot) | PUBLISH_FROZEN / live-read |
| D10 | `score_strategy` | `highest`/`latest`/`first` | publish; **read LIVE** at grading/finalization (`grading.ts:324`) | PUBLISH_FROZEN / live-read |
| D11 | `max_attempts` | int | publish | PUBLISH_FROZEN |
| D12 | `latest_start_offset_minutes` | nullable | publish | PUBLISH_FROZEN |
| D13 | `min_submit_after_start_minutes` | nullable | publish | PUBLISH_FROZEN |
| D14 | `result_publication_mode` | `immediate` (default) / `after_grading` / `manual` | publish; **read LIVE** at view time (`scores.ts:216`) | PUBLISH_FROZEN / live-read |
| D15 | `results_published_at` | nullable, write-once | set by `publishResults()` (single-winner, P7-S2-A) | IMMUTABLE-after-set |
| D16 | `interruption_time_policy` | `strict` (default) / `bounded_grace` / `operator_incident` | publish; **frozen into attempt snapshot** at attempt creation | PUBLISH_FROZEN + ATTEMPT_FROZEN |
| D17 | `interruption_grace_per_incident_seconds` / `_per_attempt_seconds` | nullable | publish; **frozen into attempt snapshot** | PUBLISH_FROZEN + ATTEMPT_FROZEN |
| D18 | per-question `grading_rule` (`multiSelectScoring`, `fillBlankMatchMode`, `fillBlankCaseSensitive`) | jsonb on `questions` | **frozen into QuestionSnapshot.gradingRule** at publish | PUBLISH_FROZEN (immutable in attempt) |

Attempt-execution snapshot columns (`exam_attempts`):

| ID | Field | Frozen at | Authority |
| --- | --- | --- | --- |
| D19 | `question_snapshot` (attempt copy) | attempt start (`attemptCommands.ts:255`) | immutable for that attempt |
| D20 | `deadline_at` | attempt start; updated only by operator grant / restore | attempt-level |
| D21 | `interruption_policy_snapshot_*` (4 cols) | attempt start (`interruptionPolicy.ts:41-126`) | immutable for that attempt |
| D22 | `submitted_answers` | submit (`attemptCommands.ts:307+`) | immutable after submit |
| D23 | `started_at` / `submitted_at` / `graded_at` | write-once at each transition | fact timestamps |
| D24 | `last_activity_at` | heartbeat | runtime authority for disconnect detection |

### E. Code-owned invariants / engineering constants (NOT configuration)

| ID | Constant | Where | Why it must stay code |
| --- | --- | --- | --- |
| E01 | JWT TTL `24h` | `packages/auth/src/session.ts:40` | security invariant |
| E02 | `DEFAULT_JWT_SECRET` (dev only) | `runtimeConfig.ts:248` | dev-only; required in prod |
| E03 | `DEFAULT_APP_TIMEZONE` | `runtimeConfig.ts:255` | display default |
| E04 | `RATE_LIMIT_NAMESPACE` / digest context | `redis/rateLimitStores.ts`, `rateLimitKey.ts` | protocol constant |
| E05 | audit field length limits | `audit/auditPolicy.ts:34-39` | hard protocol/security limits |
| E06 | `POSTGRES_INTEGER_MAX` | `contracts`/`exam-engine` (3 places) | DB integer bound |
| E07 | `EMAIL_MAX_LENGTH = 320` | `contracts/emailField.ts:23` | RFC bound |
| E08 | `CLIENT_EVENT_*` limits | `contracts/clientEvent.ts` | protocol limits |
| E09 | `MONITORING_*_THRESHOLD_MS` | `contracts/proctorMonitoring.ts` | derived operational threshold |
| E10 | `MAX_RETRIES = 3` (pg) | `packages/db/src/types.ts:92` | DB driver retry |
| E11 | audit `REDACT_CONFIG` paths | `lib/logRedaction.ts` | security redaction |
| E12 | RBAC `ROLE_PRESETS` / route registry | `authz` | role semantics (invariant) |
| E13 | state-machine transition tables | `examStateMachine.ts` etc. | correctness invariant |
| E14 | `SYSTEM_ACTOR_IDS` | `authz/systemActor.ts` | command ownership |
| E15 | `AUDIT_DRAIN_TIMEOUT_MS = 10_000` | `plugins/auditLifecycle.ts` | shutdown invariant |
| E16 | `DEFAULT_PASSWORD_POLICY` | `contracts/passwordPolicy.ts` | security invariant |
| E17 | `DEFAULT_LOCALE`/`SUPPORTED_LOCALES` | `contracts/messageRegistry.ts` | i18n (zh-CN only) |
| E18 | scanner `DEFAULT_*_MS` (heartbeat/deadline) | `plugins/heartbeat.ts`, `deadlineScanner.ts` | code fallbacks for B01-B03 |
| E19 | seed credentials / org slug/name | `db/src/seed.ts`, `bootstrap-admin.ts` | dev/test/install only |
| E20 | `tenancy`/`auth.exposeSuperAdmin` hardcoded `false` | `runtimeConfig.ts:872-884` | Phase-1 invariant |
| E21 | `security.cspEnabled = true` | `runtimeConfig.ts:891` | security invariant |
| E22 | feature flags (`FEATURE_*`) | `runtimeConfig.ts:860-863` | see §6 (server-side, not in public config) |
| E23 | `apiReference` paths/CSP | `runtimeConfig.ts:866-871` | dev surface |
| E24 | redis `DEFAULT_CLOSE/PROBE_MS` | `redis/redisRuntime.ts` | lifecycle constants |
| E25 | Dockerfile pinned images / pnpm / registries | `Dockerfile` | build reproducibility |

---

## 5. Deployment / secrets (Class A detail)

Every Class-A item is **correctly** operator-owned today. Evidence that the
secret boundary is sound:

- **Compose required-expansion** (`${POSTGRES_PASSWORD:?…}`, `${JWT_SECRET:?…}`,
  `${CORS_ORIGIN:?…}`, `${PUBLIC_WEB_ORIGIN:?…}`) makes Compose itself fail to
  start if a production-required secret/origin is unset. Enforced by the repo
  contract test `scripts/repository-contract/deployment-topology-contract.mjs`
  (rejects `${POSTGRES_PASSWORD:-…}` fallback in production compose).
- **`POSTGRES_PASSWORD` and `REDIS_PASSWORD` have NO source read** — they exist
  only to compose `DATABASE_URL`/`REDIS_URL` and to authenticate the db/redis
  containers. The runtime sees only the composed URL.
- **`JWT_SECRET`** has a dev default `"development-only-change-me"` but is
  **required in production** (throws at boot). The `@exam/auth` package
  independently re-resolves the same JWT config (same default, same prod-required
  throw) — duplicated **resolution authority**, not just a duplicated literal
  (P2-3, §11).
- **`SMTP_PASSWORD`** is scrubbed from logs/errors by `sanitizeEmailError` and
  is never logged. See §13 / §15.
- **`LAUNCHPAD_SETUP_TOKEN`** is a bootstrap secret: empty disables the
  first-install endpoint; once the first Admin exists, `/launchpad` returns 409
  and never reopens (verified by `launchpad-bootstrap.sh` drill).

**Boundary verdict:** secrets must **not** become ordinary versioned DB
settings. If a future setting needs to reference a secret (e.g. "which SMTP
credential set to use"), it must be an **opaque reference** to a
deployment-managed secret, never the plaintext value. This is a hard rule for
P7-E (§22).

---

## 6. System operational settings (Class B detail) — the E1 question

Class B is the **only** layer where a future DB-backed audited settings store
could add value, and even here the evidence is weak. Today every Class-B item is
**env-only, validated once at boot, and restart-required**. That is a
deliberate, defensible posture for a LAN/on-premise single-deployment product:
the operator edits `.env` and restarts.

The genuine E1 candidates (settings an Admin might reasonably want to change
**without a container restart**, where a wrong value is recoverable and does not
mutate exam/attempt semantics):

1. **Email retry/worker policy** — `EMAIL_MAX_ATTEMPTS`, `EMAIL_RETRY_BASE_SECONDS`,
   `EMAIL_WORKER_POLL_INTERVAL_MS`, `EMAIL_WORKER_BATCH_SIZE`. These tune an
   operational side-effect channel (outbox delivery). Changing them affects
   future outbox processing only, never an exam/attempt fact. Restart-coupling
   is friction without safety benefit.
2. **Backup schedule / retention policy** — today there is **no** scheduler and
   **no** retention engine (P7-C explicitly shipped neither; §14). If a future
   E1 introduces cron-on-host scheduling, the schedule + retention window are
   natural system-operational settings — but only if/when that scheduler exists.

Candidates that **look** like system settings but should **not** become dynamic
DB settings (defer or reject):

| Candidate | Why NOT an E1 setting |
| --- | --- |
| `HEARTBEAT_*_MS`, `DEADLINE_SCAN_INTERVAL_MS` | Affects active-attempt disruption detection. Changing mid-run could alter which attempts get marked `disrupted`. RESTART_REQUIRED is the safe lifecycle. (§12) |
| `RATE_LIMIT_*` | Tied to Redis mode/topology; wrong value = 503 outage or open flood. Keep operator-owned. |
| `REDIS_MODE` / `REDIS_*_TIMEOUT_MS` | Topology. Class A-adjacent. |
| `APP_TIMEZONE` / `TZ` | Display only (ADR-006); changing it must never reinterpret stored instants. Keep env. |
| Feature flags (`FEATURE_*`) | Server-side only; not in public config. Keep env until a real feature-flag need is measured. |

**Verdict on Class B:** no Class-B item is a confirmed, near-term
Admin-editable operational requirement today. **Class B correctly stays
env-only.** A future E1 is triggered only by a concrete operator/product
requirement (generic decision gate, §21) — Email worker/retry policy is a
**candidate** under that gate, not a preselected first slice.

---

## 7. Organization-owned configuration (Class C detail)

Organization-owned configuration spans **two** tables, not one. `organization_settings`
carries 5 setting columns (branding + timezone); `candidate_fields` is the
configurable examinee-identity schema (org-owned). Together that is ~6
organization-owned configuration concepts — but the headline "~6" must not be
read as "`organization_settings` has 6 columns."

| Table | Columns functioning as config |
| --- | --- |
| `organization_settings` | `product_name`, `product_subtitle`, `footer_text`, `organization_display_name`, `timezone` (5) |
| `candidate_fields` | per-org candidate-identity field schema (`name`/`label`/`fieldType`/`required`/`unique`/`sortOrder`) |

`organization_settings` is branding + timezone only. It is the right shape and
the right scope for Phase 1 single-tenant. Findings:

- **`organization_settings.timezone` is stored but effectively display-only.**
  ADR-006 makes business-time semantics independent of timezone; `APP_TIMEZONE`
  (env) is the authoritative display/log zone, and there is no resolver that
  feeds `organization_settings.timezone` into business decisions. It is
  round-tripped through the settings API (`settings.ts:220`) but not consumed by
  the exam engine. This is **ambiguous authority** (§20) — two timezone sources,
  one (env) consumed, one (DB) stored-but-unused. P3.
- **No org-level exam-policy defaults exist.** Each exam carries its policy
  directly on its row; there is no "org default → exam override" merge. This is
  fine for Phase 1 but is the gap P7-M1 (exam policy profiles) would fill —
  profiles are templates, not org settings.
- **No notification-preference or email-event-config table.** Notification
  recipients are derived from `users.email`; the single V1 NotificationType is
  `result_published`. Event policy is code, not config.

**Verdict:** Class C is correctly scoped. Do **not** expand it into a generic
org-defaults/settings grab-bag in E1.

---

## 8. Exam-policy settings (Class D detail) — defer to P7-M1

Class D is the deepest layer and the most hazard-sensitive. Two structural
facts dominate:

1. **Publish freezes policy.** Once an exam is `published`, the update route
   (`exam.ts:631`) rejects every field except `openAt`/`closeAt` (schedule).
   `question_snapshot` is built and frozen at publish (`examCommands.ts:127`).
   Per-question `grading_rule` is frozen into the snapshot. This is correct and
   must be preserved.
2. **Attempt creation freezes a subset — but not all — of policy.** Frozen at
   attempt start: question snapshot (copied), `deadline_at` (computed),
   interruption-policy snapshot (4 columns). **Not** frozen per-attempt (read
   live from the exam row at the relevant transition): `result_publication_mode`,
   `retake_policy`, `score_strategy`. See §12 for the hazard analysis.

Class D is **P7-M1 territory** (exam policy schema + conflict validator +
profiles + snapshot resolution). P7-E0 explicitly does **not** implement it.
The E0 contribution here is to record **exactly what is frozen where** so that
P7-M1 inherits a correct snapshot map rather than re-deriving it.

**Conflict-validation examples already enforced** (DB CHECK constraints on
`exams`): `passing_score <= total_score`; interruption policy caps consistency
(strict/operator_incident ⇒ caps NULL; bounded_grace ⇒ caps NOT NULL, `> 0`,
per-incident ≤ per-attempt); `latest_start_offset_minutes >= 0`;
`min_submit_after_start_minutes >= 0`. These are the seed of P7-M1's conflict
validator.

---

## 9. Code-owned constants (Class E detail)

Class E is large (~25 items) and is deliberately **not** configuration. The
P7-E program must not let a settings UI reach into these. Highlights:

- **Security invariants:** JWT TTL, password policy, CSP enablement, audit
  field limits, redaction paths, role presets, state-machine tables.
- **Protocol constants:** rate-limit namespace/digest, client-event limits,
  email length bound, postgres integer bound.
- **Phase-1 invariants:** `tenancy.exposeTenantSwitcher=false`,
  `auth.exposeSuperAdmin=false`, `DEPLOYMENT_MODE=multiTenant` rejected at boot.
- **Build reproducibility:** pinned base images, pnpm version, registries in
  the Dockerfile.

Making any of these "configurable" would increase risk more than value. They
stay code. See §18 (non-configurable invariants) and §22 (anti-goals).

---

## 10. Current precedence and effective-value flows

| Value | Current precedence (authoritative → fallback) | Notes |
| --- | --- | --- |
| `DATABASE_URL` | `TEST_DATABASE_URL` (test-like modes) → `DATABASE_URL` → dev fallback; **never** cross-fallback | `databaseUrl.ts`; name-safety guard refuses non-`test`/`e2e`/`ci` names |
| `JWT_SECRET` | env (required prod) → dev default `development-only-change-me` | duplicated config-resolution authority in `@exam/auth` (§11, P2-3) |
| `APP_MODE` | `APP_MODE` → `NODE_ENV` → `development` | `databaseUrl.ts:45` |
| `APP_TIMEZONE` | env `APP_TIMEZONE` → `Asia/Shanghai` | display only (ADR-006) |
| `REDIS_MODE` | explicit `REDIS_MODE` → (`optional` if `REDIS_URL` else `off`) | fail-fast if mode≠off without URL |
| `COOKIE_SECURE` | `true` in production → env `COOKIE_SECURE` | forced in prod |
| `API_DOCS_ENABLED` | `false` in production → env | forced false in prod |
| `EMAIL_TRANSPORT` | `smtp` force→`fake` in test-like modes → env | test isolation |
| Branding (product name etc.) | `organization_settings` → `organizations.display_name` → `"LAN Exam Platform"` | `getPublicBranding` — the only layered resolver |
| Exam policy | read directly off the `exams` row; **no** org-default merge | (gap P7-M1 would fill) |
| Exam `result_publication_mode` | DB default `immediate` at insert → explicit value | read LIVE (§12) |

**Precedence problems identified (E0 identifies, does not solve):**

- **P2-PREcedence-1:** `DEADLINE_SCAN_INTERVAL_MS` is read at plugin-registration
  time directly from env (`deadlineScanner.ts:336`), bypassing the canonical
  loader. It overlaps `HEARTBEAT_SCAN_INTERVAL_MS` semantically but is a
  separate var. Same value (30000) duplicated as two `DEFAULT_SCAN_INTERVAL_MS`
  constants. (§11, §17.)
- **P3-PREcedence-2:** Two timezone sources (`APP_TIMEZONE` env vs
  `organization_settings.timezone` DB) with ambiguous authority; only the env
  one is consumed. (§7, §20.)

---

## 11. Direct `process.env` / authority bypasses

The canonical loader is `getRuntimeConfig()` (memoized) +
`@exam/db/databaseUrl.ts` (APP_MODE + DB URL). Direct reads outside it:

| Bypass | Location | Verdict |
| --- | --- | --- |
| `DEADLINE_SCAN_INTERVAL_MS` | `plugins/deadlineScanner.ts:336` (own `readPositiveInteger`) | **DEBT** — should flow through loader; overlaps `HEARTBEAT_SCAN_INTERVAL_MS`. P2. |
| `APP_MODE` / `NODE_ENV` / `JWT_SECRET` | `packages/auth/src/session.ts:12-30` | **P2 — duplicated config-resolution authority.** `@exam/auth` is a leaf package and cannot import the API config layer, so it re-implements the *whole* JWT config-resolution path (mode resolution + secret resolution + dev fallback + prod-required throw) independently of `runtimeConfig`. The duplicated default literal `"development-only-change-me"` is one *symptom*; the real issue is two independent resolution authorities whose semantics happen to coincide today. Track as P2-3; a future fix must reconcile the authority (e.g. pass the resolved secret in), not merely extract a shared constant. |
| `NODE_ENV` | `packages/db/src/demo-seed.ts:103` (prod guard) | **JUSTIFIED** — seed guard. Canonical `seed.ts` uses `parseAppMode`. |
| `SEED_*` | `packages/db/src/seed.ts`, `e2eSeedOrchestrator.ts` | **JUSTIFIED** — dev/test/install seed infra, not runtime config. |
| `npm_package_version` | `routes/system.ts:254,453` | **JUSTIFIED** — informational version string, not config. |
| Test-infra (`TEST_DB_*`, `API_TEST_MAX_WORKERS`, `CI`) | vitest configs, `testIsolation.ts` | **JUSTIFIED** — test runner config, not product runtime. |
| `import.meta.env` (`VITE_API_BASE_URL`, `VITE_APP_TIMEZONE`) | `apps/web` | **JUSTIFIED** — Vite client-side; `VITE_APP_TIMEZONE` has no default and falls through to a browser-default chain. |
| E2E harness (`E2E_*`, `PLAYWRIGHT_*`) | `apps/e2e` | **JUSTIFIED** — test harness only. |

**Canonical runtime-config consumers:** `server.ts`, plugins (`heartbeat`,
`deadlineScanner`, `redis`, `email`, `audit`), routes (via `getRuntimeConfig()`
or `fastify` decorations), the resident email worker, and the seed entry
scripts. **No route reads `process.env` directly for business config** — the
repository-pattern and command-function constraints hold.

**Stale/unused env vars (P3):**

- `LOG_LEVEL` — declared in `.env.example`/docs, **never read**; logger
  hardcodes `level: "info"`.
- `TZ` — declared in `.env.example`/Compose, **never read in source**; relies on
  Node's implicit TZ handling from the OS/container. (Functional but
  undocumented-as-mechanism.)
- `PORT` — operators may set `PORT` expecting it to work; the loader reads
  **`APP_PORT`**. `PORT` is silently ignored.

---

## 12. Mutability and snapshot hazards (one of the most important outputs)

The central question: **can changing a configuration value alter an already
published exam or an already started attempt?**

### What IS correctly frozen

Freeze happens through **two mechanisms** (detailed in the next subsection) —
true snapshots and published-row immutability. Both are correct today:

| Mechanism | Examples | Frozen at | Source-of-truth later? |
| --- | --- | --- | --- |
| True snapshot | `question_snapshot` (publish + attempt copy), interruption-policy snapshot, deadline, submitted answers | publish / attempt start / submit | immutable copies; source-row edits don't affect them |
| Published-row immutability | `result_publication_mode`, `retake_policy`, `score_strategy`, `passing_score`, `control_flags` | publish (route guard) | runtime live-reads the immutable published row |

Plus fact timestamps (`startedAt`, `submittedAt`, `gradedAt`,
`resultsPublishedAt`) which are write-once columns at each transition.

This freeze discipline is **correct and must be preserved** in any future
control plane. "A future template edit must not change a published exam or
active attempt" (P7 §9 important rule) is **already true** — but it is enforced
by **two** mechanisms, and conflating them risks misdesigning P7-M1 (see the
next subsection).

### Two distinct freeze mechanisms — do NOT conflate (P2-M1 framing)

The current audit initially labeled the publish layer "IMPLEMENTED (`question_snapshot`)."
That conflates two different mechanisms. The accurate picture:

**A. True snapshots** — copied immutable data, decoupled from the source row:

| Snapshot | Built at | Stored where | Decoupled from later source edits? |
| --- | --- | --- | --- |
| `question_snapshot` (questions/options-no-isCorrect/standardAnswer/score/gradingRule/rubric) | publish | `exams.question_snapshot` | yes — QuestionBank edits don't affect published exam |
| question snapshot (attempt copy) | attempt start | `exam_attempts.question_snapshot` | yes |
| interruption-policy snapshot (4 cols) | attempt start | `exam_attempts.interruption_*_snapshot` | yes — ADR-013 |
| deadline | attempt start | `exam_attempts.deadline_at` | yes (updated only by canonical grant/restore) |
| submitted answers | submit | `exam_attempts.submitted_answers` | yes — ADR-008 |

**B. Published-row immutability** — fields read live from the published exam
row, safe because the row is immutable post-publish (route guard at
`exam.ts:631`: published exams reject every field except `openAt`/`closeAt`):

| Field (live-read from published row) | Read live at | Why safe today |
| --- | --- | --- |
| `result_publication_mode` | candidate result view (`scores.ts:216`, `attempts.shared.ts:60`) | published-edit guard |
| `retake_policy` | attempt eligibility (`attemptCommands.ts:219`), grading finalization (`grading.ts:68`), candidate summary | published-edit guard |
| `score_strategy` | grading finalization (`grading.ts:324`) | published-edit guard |
| `passing_score` / `control_flags` / timing mode | grading / runtime | published-edit guard |

These three Exam-level fields (`result_publication_mode`, `retake_policy`,
`score_strategy`) are **Exam-/Enrollment-level semantics**: result mode is an
Exam-level publication policy; `retake_policy` governs Exam/Enrollment attempts;
`score_strategy` aggregates across multiple attempts into one Enrollment final
score. They do **not** naturally belong on a single Attempt.

### The future profile-resolution hazard (P2-M1)

**Today there is no drift**, because there is no profile/template layer: the
published exam row is the sole authority and it is immutable. The runtime
live-reads an already-frozen authority.

The hazard materializes the moment P7-M1 introduces **editable profiles /
templates**. The correct resolution model is:

```text
Profile Template
      ↓ publish-resolve (one-time copy into Exam-owned published policy)
Published Exam Policy (immutable published row)
      ↓ runtime live-read
Enrollment / Attempt decisions
```

**NOT** this (anti-pattern):

```text
Profile
  ↓
Exam (live-references mutable template)
  ↓
Attempt copies everything again (snapshot of a snapshot)
```

So P7-M1 must:

1. ensure future profile/template edits are **resolved/copied into Exam-owned
   published policy at publish time**, not live-referenced from mutable
   templates (a published exam must never silently follow a later template edit);
2. decide, per field, the correct freeze locus — Exam-level fields stay on the
   immutable published row; do **not** reflexively copy Exam-/Enrollment-level
   policy into a per-Attempt snapshot just because "snapshot" sounds safer.

This is a **P2 finding for P7-M1**, not a P7-E1 setting. It does not block E0
or E1. It is recorded here so P7-M1 inherits the precise freeze map and does
not mistake "published-row immutability" for "snapshot."

### Other mutability notes

- **`open_at`/`close_at` are editable post-publish** (schedule only, audited as
  `exam.published_schedule_updated`). This is intentional and correct: the
  schedule is the one policy dimension an admin may legitimately adjust. It
  does affect the exam window (`close_at` is the hard upper bound for operator
  time grants), but it does not alter a frozen attempt snapshot.
- **`unpublish` (published → draft)** is a legal transition
  (`examStateMachine.ts:7`, `unpublishExam` at `examCommands.ts:266`). After
  unpublish, the exam is editable again, then re-publishable. This is a
  legitimate authoring flow; the question snapshot is rebuilt at re-publish.
- **No dynamic setting today can mutate an active attempt.** The live-read
  Exam-level fields are guarded by published-row immutability; all attempt-local
  policy is a true snapshot.

---

## 13. Secrets boundary

| Secret | Source | Consumer | Logging exposure | Audit exposure | Admin UI? | Backup inclusion? |
| --- | --- | --- | --- | --- | --- | --- |
| `POSTGRES_PASSWORD` | Compose/secret store | composed into `DATABASE_URL`; db container auth | not logged | not in audit_logs | NO | only via DB dump (Postgres does not store the superuser password in a recoverable form; the dump contains role definitions, not plaintext) |
| `JWT_SECRET` | env | `runtimeConfig.authSecret.jwtSecret`; `@exam/auth` bypass | not logged | not in audit | NO | NO (env-only) |
| `REDIS_PASSWORD` | Compose redis profile | redis container `requirepass`; composed into `REDIS_URL` | not logged | not in audit | NO | NO (Redis is non-authoritative; rate-limit counters only) |
| `SMTP_PASSWORD` / `SMTP_USER` | env | `SmtpEmailSender` only when transport=smtp | **scrubbed** by `sanitizeEmailError`; never in transporter stringification | not in audit | NO | NO (env-only) |
| `LAUNCHPAD_SETUP_TOKEN` | env | launchpad bootstrap adapter | not logged | audit records `source: "launchpad"\|"local_script"`, NOT the token | NO (first-install only) | NO |

**Hard rule (§22 anti-goal):** raw secrets must NOT become ordinary versioned
application settings. The current boundary is correct: all secrets are
deployment/env-owned; no secret is stored in PostgreSQL. If a future setting
must reference a secret (e.g. "active SMTP credential set"), it must be an
opaque reference to a deployment-managed secret, not the plaintext.

---

## 14. Backup / PITR policy boundary (post-P7-C)

P7-C is CLOSED. The mechanism (C1 cold / C2 logical / C3 physical+PITR) is
shipped and drill-verified. E0 inventories only the **policy** layer around it,
per P7-E §11.

| Item | Mechanism config (operator) | Policy (candidate system setting?) |
| --- | --- | --- |
| WAL archive location | `EXAM_WAL_ARCHIVE_HOST_PATH` (Class A host path) | NO — topology |
| `archive_mode` / `archive_command` / `archive_timeout=60s` | `postgres-enable-pitr.sh` (ALTER SYSTEM) | NO — mechanism |
| Backup schedule | **none** (cron-on-host, operator-supplied) | **candidate** — only if a scheduler is built |
| Retention window/count | **none** (manual; §8.5 of backup-and-recovery.md) | **candidate** — only if a retention engine is built |
| RPO/RTO target | documented profiles (small/standard/high-stakes), not automated | **candidate** — only if profile automation is built |
| Last backup status / verified restore evidence | none in-product | **candidate** — Admin visibility (read-only), restore stays operator-owned |
| Restore action | operator-run scripts (`*-restore.sh`) | **NO** — operator-owned command, never a setting, never an Admin button |

**Boundary (preserved from P7-C):** NO restore button, NO retention engine, NO
backup job scheduler exists today. Each is a **possible** P7-E capability
extension, explicitly not started. If E1 touches this area at all, the only
defensible slice is a **read-only Admin backup-status surface** (last backup,
last verified restore) — restore itself must remain an operator command. See
§22.

---

## 15. Email configuration boundary

Email is the cleanest separated boundary in the system. ADR-011 + the
`email-config.md` guide are authoritative. The split:

| Concern | Layer | Items |
| --- | --- | --- |
| SMTP transport / credentials | **Class A (deployment)** | `SMTP_HOST/PORT/SECURE/USER/PASSWORD/REQUIRE_TLS/TLS_*` |
| Email master switch + transport selection | **Class A/B boundary (env, boot)** | `EMAIL_ENABLED`, `EMAIL_TRANSPORT`, `EMAIL_FAKE_MODE` |
| Sender display | **Class B (system operational)** today (env); **Class C candidate** (org branding) | `EMAIL_FROM`, `EMAIL_FROM_NAME` |
| Retry/delivery policy | **Class B (system operational)** today (env) | `EMAIL_MAX_ATTEMPTS`, `EMAIL_RETRY_BASE_SECONDS`, `EMAIL_WORKER_*` |
| Which events produce Email | **code** (single V1 event: `result_published`) | not configurable |

**Findings:**

- **Secret safety is sound.** SMTP password is env-only, scrubbed from
  logs/errors, never in audit. `email-config.md` §8 explicitly decided "no DB
  config table for Phase 1" on secret-safety + no-consumer-yet grounds.
- **`EMAIL_WORKER_*` tuning knobs are undocumented in `.env.example`.**
  `EMAIL_WORKER_POLL_INTERVAL_MS`, `EMAIL_WORKER_BATCH_SIZE`,
  `EMAIL_WORKER_LOCK_TIMEOUT_MS`, `EMAIL_WORKER_HEARTBEAT_STALE_MS` appear in
  `docker-compose.yml` and the runbook but **not** in `.env.example`. P3
  documentation gap.
- **`EMAIL_WORKER_CONCURRENCY` is hardcoded `1`** (no env var). Intentional
  (single-worker ownership model); should stay code unless multi-instance
  workers are designed.
- **Which events produce Email is code, not config** — correct. An event-policy
  toggle layer would be over-engineering for V1's single event.

---

## 16. Redis configuration boundary

P7-D1 (ACCEPTED 2026-08-08) approved Redis for **one** responsibility: shared
rate limiting. That boundary is preserved and must not expand without a new
ADR.

| Concern | Layer | Items |
| --- | --- | --- |
| Redis connection / lifecycle / topology | **Class A (deployment)** | `REDIS_URL`, `REDIS_PASSWORD`, `REDIS_MODE`, `REDIS_*_TIMEOUT_MS`, `REDIS_KEY_PREFIX` |
| Rate-limit policy (max/window) | **Class B (system operational)** today (env) | `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_DISABLED` |
| Rate-limit namespace/digest | **Class E (code)** | `RATE_LIMIT_NAMESPACE`, digest context |
| Admission queue / presence / streams / sessions | **NOT IMPLEMENTED** — decision-gated | n/a |

**Findings:**

- Redis holds **only** ephemeral rate-limit counters (TTL-bounded,
  non-authoritative). PostgreSQL remains the exam fact authority. This is
  correct.
- `REDIS_MODE=required` fails **closed** (503 `RATE_LIMIT_UNAVAILABLE`); `optional`
  degrades to per-process in-memory best-effort; `off` disables. This
  fail-open/fail-closed policy is correctly encoded in code, not config.
- **No Redis responsibility expansion in E1.** Admission queue, presence,
  Pub/Sub/Streams, worker use remain decision-gated (§22 anti-goal).

---

## 17. Duplicate / ambiguous configuration

| Duplicate | Classification | Action |
| --- | --- | --- |
| JWT default `"development-only-change-me"` in `runtimeConfig.ts:248` AND `packages/auth/src/session.ts:29` | **STALE DUPLICATION (drift risk)** — the duplicated literal is one symptom of the deeper issue: `@exam/auth` runs an independent JWT config-resolution authority (P2-3). | Track; a fix must reconcile the *authority* (e.g. `@exam/auth` receives the resolved secret), not just extract a shared constant. |
| `DEFAULT_SCAN_INTERVAL_MS = 30_000` in both `heartbeat.ts:19` and `deadlineScanner.ts:29` | **STALE DUPLICATION** — same value, separate declarations; `DEADLINE_SCAN_INTERVAL_MS` shadows `HEARTBEAT_SCAN_INTERVAL_MS` semantics. P2/P3. | Track; consolidate through the loader. |
| `APP_TIMEZONE` (env, consumed) vs `organization_settings.timezone` (DB, stored-but-unused) | **AMBIGUOUS AUTHORITY** — two timezone sources, one consumed. P3. | Track; either consume the org tz for display or drop the column. |
| `PORT` (operators may set it) vs `APP_PORT` (the actual var) | **AMBIGUOUS** — `PORT` is silently ignored. P3. | Document or accept `PORT` as an alias. |
| `LOG_LEVEL` declared in `.env.example` but not read | **STALE** — dead var. P3. | Remove from `.env.example` or implement. |
| Compose value + code default for the same env var (e.g. `HEARTBEAT_*`, `RATE_LIMIT_*`, Email defaults) | **INTENTIONAL LAYERING** — Compose provides the operator default, code provides the fail-safe. | No action. |
| Exam policy (exam row) + attempt snapshot (frozen copy) for interruption/question | **INTENTIONAL SNAPSHOT** — the whole point of freeze semantics. | No action; preserve in P7-M1. |

---

## 18. Non-configurable invariants

The configuration control plane must **not** allow operators to toggle these.
They are correctness/security invariants, not settings:

- **PostgreSQL is the sole authoritative store.** Redis is non-authoritative
  (P7-C0/P7-S2). No setting can move exam-fact authority to Redis/filesystem.
- **Server is the time authority** (ADR-006). `fastify.now()` is the one clock;
  DB `now()`/client time must not drive exam business-time decisions. No setting
  can change this. `APP_TIMEZONE` is display-only and must never reinterpret
  stored instants.
- **State-machine transitions** (exam/attempt/enrollment/outbox) are owned by
  canonical commands. No setting can enable direct status mutation.
- **Canonical command ownership** for irreversible transitions (publish, submit,
  force-submit, misconduct, result-publish, operator grant, bootstrap). One
  owner each, idempotent, audited.
- **Role semantics / RBAC presets.** Admin/Candidate are Phase-1 product roles;
  Teacher/Proctor/Grader are future role bundles; SuperAdmin/multiTenant are
  Phase 4. `DEPLOYMENT_MODE=multiTenant` is **rejected at boot**. No setting can
  enable Phase-4 modes in Phase 1.
- **Single-tenant data boundary.** All repo methods receive `ctx`; `organizationId`
  is enforced. No setting can disable the tenant boundary.
- **Answer Save Protocol** (versioned, idempotent, conflict-detected) and
  **submit freeze** (ADR-008) are invariants.
- **Audit durability contract** (atomic vs best-effort vs domain-history,
  ADR-006 corrective). The durability classification of each action is code.
- **Security constants:** password policy, CSP enablement, JWT TTL, audit field
  limits, redaction paths, `COOKIE_SECURE` forced true in production.
- **Hard protocol limits:** client-event batch/size/depth, email length,
  postgres integer bound, monitoring thresholds.

---

## 19. Bootstrap / Launchpad boundary

| Item | Classification | Rationale |
| --- | --- | --- |
| `LAUNCHPAD_SETUP_TOKEN` | **Class A — deployment bootstrap secret** | empty disables; first-install only |
| First-organization / first-Admin initialized state | **durable application fact** (not config) | `organizations.slug="default"` existence; `audit_logs action=admin.bootstrap` |
| Admin password reset (`reset-admin-password.js`) | **operator action** (not a setting) | CLI command |
| Second-Admin guard (`--force`) | **invariant** | bootstrap refuses a second active Admin |

**Boundary:** Launchpad is first-install-only and shares the canonical
`bootstrapAdminOnFreshDb` mutation with the CLI (both serialize on the same
`pg_advisory_xact_lock`; HTTP race loser gets 409, never 500). The token is a
bootstrap secret, **not** an Admin setting. Once initialized, `/launchpad`
redirects to `/login` and never reopens. This is correct and must not become a
settings-managed value.

---

## 20. Existing DB-owned configuration

Domain-owned configuration that correctly stays domain-owned (do **not** fold
into a generic settings table):

- **`organizations` / `organization_settings`** — branding + locale (Class C).
- **`candidate_fields`** — configurable examinee identity schema (org-owned).
- **`exams.*` + `control_flags`** — exam policy (Class D; P7-M1).
- **`exam_attempts` snapshot columns** — frozen policy (Class D).
- **`attempt_time_adjustments` / `attempt_interruption_events` / `exam_incidents`** —
  operational ledgers (not config; they are durable facts).
- **`audit_logs` / `client_events` / `*_receipts`** — evidence (not config).

The one existing generic-ish settings table is `organization_settings`, and it
is correctly scoped to branding. **No generic `system_settings` table exists.**
The E0 recommendation (§22) is that none should be created unless a concrete E1
slice justifies it.

---

## 21. Minimum viable P7-E1 recommendation

**There is no confirmed, near-term product requirement for Admin-editable
deployment-wide operational policy.** Therefore **no P7-E1 implementation is
currently justified.** The E0 recommendation is to close E0 with this finding
and proceed to **P7-M1** (exam policy resolution / freeze model), which is where
the real configuration pressure already exists (P2-M1).

Applying the simplicity gate (P7-E §29) to the candidates surfaced by the
inventory:

| Candidate | Admin needs to change it online? | Needs versioning? | Affects exam/attempt? | Verdict |
| --- | --- | --- | --- | --- |
| Scanner intervals (`HEARTBEAT_*`, `DEADLINE_SCAN_*`) | no (active-attempt hazard) | no | **yes** (disruption) | **reject — keep env/RESTART** |
| Rate-limit policy | no (topology-coupled) | no | no (but outage risk) | reject — keep env |
| Redis mode/timeouts | no (topology) | no | no | reject — Class A |
| Timezone | no (display only; ADR-006) | no | must not | reject — keep env |
| Feature flags (`FEATURE_*`) | no (no measured need) | no | varies | reject — keep env |
| Org branding | yes (already DB-backed) | optional | no | **already done** (Class C) |
| Exam policy | n/a | n/a | yes | **P7-M1, not E1** |
| Email retry/worker policy | unconfirmed | nice-to-have | no | **candidate** under the gate below — not preselected |
| Backup schedule/retention | only if a scheduler is built | yes (RPO/RTO) | no | **separate future ops capability** (§14), not an E1 settings slice |
| Backup-status visibility | unconfirmed | no | no | **separate future ops capability** (no evidence source exists today) |

### The E1 decision gate (generic — do NOT preselect a domain)

```text
Human decision gate:

  Is there a confirmed, near-term product requirement for
  Admin-editable SYSTEM OPERATIONAL SETTINGS (view or change,
  deployment-wide, online without restart)?

  NO
    → no P7-E1 now
    → close E0; proceed to P7-M1
  YES
    → identify exactly ONE coherent first vertical slice (one domain)
    → design that slice as P7-E1 (typed, audited, no secrets, no
      exam/attempt semantics)
```

Email worker/retry policy is a **candidate** under this gate. It is **not** the
preselected E1 product — preselecting it would let roadmap inertia turn a
candidate into a task without a confirmed requirement.

### Why backup-status is NOT bundled into an E1 settings slice

Backup-status visibility looks small but is a **different domain** from
operational settings, and it has no evidence source today:

- Email settings = **configuration authority** (typed values → effective
  resolution → restart/dynamic semantics).
- Backup status = **backup execution** (durable evidence → verification record →
  history/status projection).

P7-C shipped only **operator mechanisms** (`pg_dump`, `pg_basebackup`, PITR,
drills). There is **no** `backup_run` / `backup_job` / `backup_evidence`
authoritative runtime store. So "read-only backup-status" cannot be a thin slice
— its first question is "status from where?", and answering it would force E1 to
also build a backup execution model + history persistence + scheduler
integration, i.e. scope creep into a separate workstream.

**Recommendation:** keep backup automation/status as a **separate future
operational capability** (`policy → execution → evidence → visibility`), not
part of a settings E1.

**E0 conclusion:** do not build a settings control plane now. A future E1 is
triggered only by the concrete gate above. **Do not force a settings system into
existence.**

---

## 22. Persistence-model options (recommendation only; NO implementation)

These options apply **only if** the §21 gate later returns YES and a specific
E1 slice is chosen. They are recorded here so a future E1 does not start from a
blank page, not to justify building one now.

Evaluate against the chosen slice's actual (small) inventory:

| Option | Fit | Over-engineering risk |
| --- | --- | --- |
| **A — typed columns / one-row `system_settings` table** | Good: a few typed columns, clear schema, trivial migration. | Low for a small slice. |
| **B — versioned typed document (`system_setting_versions`)** | Adds version/audit/rollback for free. | Medium — justified only if rollback is a real operator need. |
| **C — domain-owned settings (no generic table)** | Best if the setting stays in its domain (e.g. email config in an email-config row). | Low; matches the existing `organization_settings` pattern. |
| **D — hybrid (small system store + domain-owned)** | Reasonable if both system and domain settings coexist. | Medium. |

**Recommendation:** prefer **Option A or C** (typed, not generic JSON). Type
safety, migration clarity, and human comprehensibility win; the
AI-generated-code risk and over-engineering risk of a generic JSON key/value
registry are unnecessary for a small slice. Versioning/rollback (Option B) is
worth it **only** if an operator rollback workflow is a confirmed requirement —
otherwise it is speculative machinery.

Regardless of option, the effective-value API needs at most: **effective value +
last-changed-by + last-changed-at**. Preview/diff, import/export,
source-visualization, and pending-restart are **not** justified for a handful of
operational knobs — they must follow real use cases, not the full
Workstream-E wishlist.

---

## 23. E1 anti-goals

Explicit anti-goals for any P7-E1 implementation (adjust only with evidence):

- NO generic arbitrary key/value settings registry.
- NO plaintext secrets in PostgreSQL (opaque reference only).
- NO moving host paths (`EXAM_DATA_ROOT`, `EXAM_WAL_ARCHIVE_HOST_PATH`) into DB.
- NO PostgreSQL connection config (`DATABASE_URL`, `POSTGRES_*`) in DB.
- NO config event bus.
- NO generic hot-reload subsystem (settings are read-once-at-boot today; a
  targeted reload for the chosen few is enough).
- NO config inheritance framework beyond proven layers (branding merge is the
  only one today; exam-policy layering is P7-M1).
- NO feature-flag platform (3 server-side flags today; no measured need).
- NO arbitrary JSON schema engine / policy DSL.
- NO dynamic modification of active-attempt semantics (scanner intervals,
  result visibility, retake, score strategy must remain restart-required or
  publish-frozen).
- NO backup restore through Admin UI (restore is operator-owned, permanently).
- NO Redis responsibility expansion (admission/presence/streams remain gated).
- NO multiTenant / SuperAdmin / tenant-switcher enablement (Phase 4 only).
- NO moving `APP_TIMEZONE` semantics into a mutable business-time setting
  (ADR-006).

---

## 24. Risk matrix (illustrative — applies only if a future E1 is triggered)

No E1 is recommended now (§21). This matrix is a **template** for evaluating
whatever single slice a future YES-gate identifies, not a preselected backlog.
The rows are illustrative candidates, not commitments.

| Setting (illustrative) | Wrong-value impact | Scope | Change timing | Snapshot? | Audit? | Restart? | Rollback safe? | Fail mode |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Email retry/worker policy (candidate) | stuck/dead mail, slow delivery | system | any time | no | yes | configurable | yes (re-edit) | fail-open (mail dead-letters) |
| Backup schedule (separate ops capability) | missed backups, RPO breach | system | any time | no | yes | no (if cron-driven) | yes | fail-silent → monitor |
| Retention window (separate ops capability) | data loss (over-prune) or storage growth | system | any time | no | yes | no | conditional (chain invariant) | fail-closed (refuse to prune) |

(The live-read exam-policy fields — `result_publication_mode`, `retake_policy`,
`score_strategy` — are deliberately **excluded**: they must **not** become E1
settings; their freeze boundary is a P7-M1 design concern, §12/P2-M1.)

---

## 25. Findings (P0 / P1 / P2 / P3)

**P0 (blocks release / immediate authority-security-data-loss failure):** 0.

**P1 (ambiguous authority or mutation can violate correctness/security):** 0.
The publish guard + snapshot discipline currently protect exam/attempt
semantics. No env var or DB value can today mutate an active attempt's frozen
state.

**P2 (maintainability, drift, unsafe future configurability, inconsistent
defaults):**

- **P2-1 → P2-M1 (future profile-resolution hazard):** Three Exam-/Enrollment-
  level fields — `result_publication_mode` (Exam publication policy),
  `retake_policy` (Exam/Enrollment attempts), `score_strategy` (Enrollment
  aggregation across attempts) — are read **live from the published exam row**,
  not copied into a per-attempt snapshot. This is **not a bug today**: the
  published-edit route guard (`exam.ts:631`) makes those columns immutable
  post-publish, so the runtime live-reads an already-frozen authority
  (published-row immutability, distinct from a true snapshot — §12). **No drift
  is possible today** because there is no profile/template layer. The hazard
  materializes when P7-M1 introduces editable profiles: a profile edit must be
  **resolved/copied into Exam-owned published policy at publish time**, never
  live-referenced from a mutable template. P7-M1 should decide the correct
  freeze locus per field — do **not** reflexively copy these Exam-level fields
  into a per-Attempt snapshot; several of them are Enrollment-level, not
  Attempt-level. (Evidence: `scores.ts:216`, `grading.ts:324,68`,
  `attemptCommands.ts:219`; guard at `exam.ts:631`.) This is a P7-M1 design
  input, not an E0/E1 implementation bug — **do not fix it in E1.**
- **P2-2 (bypass / drift):** `DEADLINE_SCAN_INTERVAL_MS` is read directly from
  env at plugin-registration (`deadlineScanner.ts:336`), bypassing the
  canonical loader, and overlaps `HEARTBEAT_SCAN_INTERVAL_MS`. Two independent
  `DEFAULT_SCAN_INTERVAL_MS = 30_000` constants. Consolidate through the loader.
  (Recorded for a small future config-hygiene PR; **not fixed in E0**.)
- **P2-3 (duplicated config-resolution authority):** `@exam/auth/session.ts`
  runs an **independent** JWT config-resolution path (mode + secret + dev
  fallback + prod-required throw), separate from `runtimeConfig`. The duplicated
  default literal `"development-only-change-me"` (`runtimeConfig.ts:248` vs
  `session.ts:29`) is one symptom; the real issue is two resolution authorities
  whose semantics happen to coincide today. A future fix must reconcile the
  **authority** (e.g. `@exam/auth` receives the resolved secret rather than
  re-resolving), not merely extract a shared constant. (`@exam/auth` is a leaf
  package and cannot import the API config layer.) Recorded; **not fixed in E0.**

**P3 (naming, documentation, minor cleanup):**

- **P3-1:** `LOG_LEVEL` is declared in `.env.example`/docs but never read
  (logger hardcodes `info`). Remove or implement.
- **P3-2:** `PORT` is silently ignored; the loader reads `APP_PORT`. Operators
  may be surprised. Document or accept `PORT` as an alias.
- **P3-3:** `TZ` is declared but never read in source (relies on Node implicit
  handling). Document the mechanism.
- **P3-4:** `EMAIL_WORKER_*` tuning knobs are in Compose + runbook but missing
  from `.env.example`.
- **P3-5:** `DEADLINE_SCAN_INTERVAL_MS` and `FORCE_APP_MODE` are read by source
  but not documented in `.env.example`.
- **P3-6:** Ambiguous timezone authority: `APP_TIMEZONE` (env, consumed) vs
  `organization_settings.timezone` (DB, stored-but-unused).
- **P3-7:** `docker-compose.test.yml` declares a `redisdata` named volume that
  is never mounted (dead declaration).
- **P3-8:** db helper scripts (`scripts/db/*.sh`, `scripts/test/*.sh`) default
  to port 5432 while dev compose maps host 15432 — running them without an
  explicit `DATABASE_URL` fails against the default dev compose.

**P0–P3 recorded; none fixed in E0 (docs-only audit, per §26).**

---

## 26. Recommended execution sequence

```text
P7-E0  Configuration Reality Audit                       ✅ THIS DOCUMENT (READY FOR REVIEW)
  │
  └─ E0 conclusion: no P7-E1 implementation currently justified.
     No confirmed near-term requirement for Admin-editable operational settings.

P7-M1  Exam policy resolution / freeze model  ← NEXT (real configuration pressure)
        - profile/template → published-exam policy resolution (one-time copy)
        - published-row immutability vs true snapshot, per field
        - conflict validator; P2-M1 freeze-locus decisions
P7-M2  Profile templates
P7-M3  Exam creation wizard

Future P7-E1  (triggered ONLY by the §21 gate returning YES):
        identify ONE coherent first vertical slice; design it (typed, audited,
        no secrets, no exam/attempt semantics). Email worker/retry is a
        candidate, not preselected.

Separate future capability (NOT a settings E1):
        Backup automation / status — policy → execution → evidence → visibility.
```

**Sequencing rules:**

- P7-M1 must enforce "profile/template edits resolve into Exam-owned published
  policy at publish time; a published exam never follows a later template edit"
  and resolve P2-M1 before editable profiles ship.
- A future P7-E1 (if triggered) must not touch Class A (deployment/secrets),
  Class D (exam policy), or the scanner/rate-limit/timezone/Redis env vars.
- No settings UI begins before a concrete E1 slice is accepted (consistent with
  P7 §11 "Admin settings UI must wait for configuration layering and snapshot
  semantics").

---

## 27. Adversarial questions — answered

1. **Which env vars are secrets?** `POSTGRES_PASSWORD`, `DATABASE_URL` (embeds
   pw), `JWT_SECRET`, `REDIS_PASSWORD` (in `REDIS_URL`), `SMTP_PASSWORD`,
   `LAUNCHPAD_SETUP_TOKEN`. `SMTP_USER` is sensitive. (§5, §13.)
2. **Which describe deployment topology?** `DATABASE_URL`, `REDIS_URL`/`MODE`,
   `APP_PORT`/`HOST`, `CORS_ORIGIN`, `PUBLIC_WEB_ORIGIN`, `EXAM_DATA_ROOT`,
   `EXAM_WAL_ARCHIVE_HOST_PATH`, `SMTP_HOST`/`PORT`, `APP_MODE`/`NODE_ENV`. (§5.)
3. **Which are business/operational policy in disguise?** Scanner intervals,
   rate-limit max/window, Email retry/worker policy, backup schedule (if built).
   (§6.)
4. **Which must never move into PostgreSQL?** All secrets (§13/§22); host paths
   (`EXAM_DATA_ROOT`, WAL path); `DATABASE_URL`/`POSTGRES_*`; `APP_TIMEZONE`
   business semantics (display-only). (§18, §22.)
5. **Which should Admins genuinely change?** Today: org branding (already
   DB-backed). No other system-operational setting has a confirmed near-term
   Admin-edit requirement. Email worker/retry is a **candidate** under the §21
   gate, not preselected; backup-status is a separate operational capability.
   (§21.)
6. **Which require restart?** Effectively all Class A + B (boot-validated,
   memoized loader). The only DYNAMIC setting today is `organization_settings`
   branding. (§3, §6.)
7. **Which can safely hot-change?** Org branding only, today. (§7.)
8. **Which must only affect future Exams?** All exam policy — enforced by
   publish-freeze (true snapshots + published-row immutability). (§8, §12.)
9. **Frozen at publish?** Two mechanisms: (a) true snapshot =
   questions/options/standardAnswer/score/gradingRule/rubric
   (`question_snapshot`); (b) published-row immutability = timing mode,
   control_flags, passing/total score, retake/score-strategy/result-mode (route
   guard). **Both are freeze; they are not the same mechanism.** (§8, §12.)
10. **Frozen at attempt creation?** True snapshots at attempt start: question
    snapshot (copy), deadline, interruption-policy snapshot (4 cols). Exam-level
    policy (result mode/retake/score strategy) is **not** copied per-attempt —
    read live from the **immutable published row** (safe via route guard, not via
    snapshot). These are Exam-/Enrollment-level and should NOT be reflexively
    copied into Attempt snapshots (P2-M1). (§12.)
11. **Already have snapshot semantics?** Yes — true snapshots (question +
    interruption + deadline + submitted answers) AND published-row immutability.
    Distinguish them. (§4, §12.)
12. **Duplicated authority?** JWT **config-resolution authority** (not just a
    duplicated literal) across `runtimeConfig` and `@exam/auth`; scanner interval
    defaults; timezone (env vs DB). (§17.)
13. **Direct `process.env` bypasses?** `DEADLINE_SCAN_INTERVAL_MS` (debt);
    `@exam/auth` JWT/mode (P2-3 duplicated authority, leaf-package constraint);
    seed/E2E/test harness (justified). (§11.)
14. **Defaults duplicated Compose/code/docs?** Intentional layering for env
    defaults; some drift (`EMAIL_WORKER_*` missing from `.env.example`). (§17.)
15. **Need audit history?** Org branding (today: `branding.update` best-effort).
    Any future E1 setting should be audited. Exam policy changes already emit
    `exam.update` / `exam.published_schedule_updated`. (§8.)
16. **Need rollback?** Exam policy: no (publish-freeze). A future E1 setting:
    conditional on operator workflow. (§22, §24.)
17. **Domain-owned vs generic settings?** Domain-owned wins for exam policy,
    candidate fields, branding. A generic system-settings table is justified only
    if the §21 gate returns YES, and even then for one small typed slice. (§20,
    §22.)
18. **Smallest useful E1?** **None currently justified.** Close E0; proceed to
    P7-M1. A future E1 is triggered only by the §21 gate; if triggered, exactly
    ONE coherent first slice (Email worker/retry is a candidate, not
    preselected); backup-status is a separate workstream. (§21.)
19. **What should NOT be built in E1?** Generic JSON registry, config event bus,
    hot-reload framework, feature-flag platform, exam-policy mutation, restore
    button, Redis expansion, multiTenant — and Email+backup bundled as one E1.
    (§22, §23.)
20. **Is a generic settings subsystem justified by current evidence?** **No.**
    No E1 is currently justified; close E0 and proceed to P7-M1. (§1, §21.)

---

## 28. P7-E0 verdict

```text
P7-E0 verdict:

Deployment/secrets (Class A):
  ~16 items
  remain operator-owned (env + Compose + secret store). Correct today.

System operational setting candidates (Class B):
  ~15 env-only items today; NONE is a confirmed near-term Admin-editable
  requirement. Email worker/retry is a candidate under the §21 gate, not
  preselected. Class B correctly stays env-only.

Organization-owned configuration (Class C):
  ~6 concepts across organization_settings (5 cols) + candidate_fields;
  already DB-backed and correctly scoped.

Exam-policy candidates (Class D):
  defer to P7-M1. ~20 fields. Freeze discipline is real but TWO mechanisms:
    - true snapshots (question/interruption/deadline/submitted answers)
    - published-row immutability (result mode/retake/score strategy/passing/
      control_flags — live-read, safe via route guard)
  These must not be conflated. P2-M1 (profile-resolution hazard) is the key
  P7-M1 design input.

Code-owned/non-configurable (Class E):
  ~25 items. Must stay code.

Direct env/config authority issues:
  DEADLINE_SCAN_INTERVAL_MS bypass (P2-2); JWT config-resolution authority
  duplicated across runtimeConfig and @exam/auth (P2-3); several P3 doc/naming
  gaps. None fixed in E0.

Snapshot / freeze hazards:
  Two distinct mechanisms (§12). No drift today. P2-M1 = future
  profile-resolution hazard: profile edits must resolve into Exam-owned
  published policy, not live-reference mutable templates. Do NOT reflexively
  copy Exam-/Enrollment-level policy into per-Attempt snapshots.

Secret-boundary findings:
  sound — all secrets env/Compose-owned; none in PostgreSQL; SMTP scrubbed.

Backup/PITR findings:
  P7-C mechanism closed; no scheduler/retention/Admin-visibility today.
  Backup automation/status is a SEPARATE future operational capability
  (policy → execution → evidence → visibility), NOT a settings E1 slice.

Email findings:
  cleanest boundary; secret-safe; EMAIL_WORKER_* undocumented in .env.example (P3).

Redis findings:
  one approved responsibility (shared rate-limit); no expansion in E1.

Timezone findings:
  ADR-006 sound; env vs DB authority ambiguous (P3); display-only.

Launchpad/bootstrap findings:
  first-install-only bootstrap secret; correct; not a setting.

P0: 0
P1: 0
P2: 3 (P2-M1 profile-resolution hazard; P2-2 scanner bypass;
       P2-3 JWT config-resolution authority duplication)
P3: 8 (doc/naming/dead-declaration gaps)

Minimum recommended P7-E1:
  NONE currently justified. Close E0; proceed to P7-M1.
  A future E1 is triggered ONLY by the §21 gate (a confirmed near-term
  requirement for Admin-editable operational settings). When triggered,
  identify exactly ONE coherent first slice; Email worker/retry is a candidate,
  not preselected. Backup automation/status is a separate workstream.

Persistence-model recommendation (only if a future E1 is triggered):
  typed columns / domain-owned (Option A or C). No generic JSON registry.
  Versioning only if rollback is a confirmed operator need.

Explicit anti-goals:
  see §23.

Explicitly deferred:
  P7-M1 exam policy resolution/freeze model (owns Class D + P2-M1);
  backup automation/status (separate future ops capability); Redis expansion;
  Phase 4 multiTenant/SuperAdmin; feature-flag platform; generic hot-reload.

Explicitly prohibited:
  plaintext secrets in DB; host paths / DB connection config in DB; restore
  button; bundling Email settings + backup-status into one E1; dynamic
  active-attempt semantics; Redis responsibility expansion without ADR;
  Phase-4 modes in Phase 1; reflexively copying Exam-level policy into
  per-Attempt snapshots.
```

**Recommended sequence:**

```text
P7-E0  close (this audit)
P7-M1  exam policy resolution / freeze model   ← NEXT
P7-M2  profile templates
P7-M3  exam creation wizard
Future P7-E1  (only if §21 gate returns YES): one coherent first slice
Separate:     backup automation/status workstream
```

---

P7-E0 CONFIGURATION REALITY AUDIT — CLOSED (PR #276)
