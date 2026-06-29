# S6 — Current Audit / Monitoring Event Map

> **Date:** 2026-06-29
> **Branch:** `phase3/role-check-audit`
> **Purpose:** Audit every audit event and monitoring event today, map each to its source file, decide whether the two domains are actually separated, and prepare a fact base for M4 (Audit / Monitoring Event Expansion v0).

---

## TL;DR

- There are **two deliberately separated event channels**, but they are not labelled "audit" vs "monitoring" by name:
  - **`audit_logs`** — compliance records of actor actions on a target. Written **server-side only**. ~50 distinct `action` string literals (full enumeration in §2; the §2 tables are the source of truth). **No enum / no union / no constant file** — every call site hardcodes its own free-form string.
  - **`client_events`** — frontend observability telemetry. Written by the **browser** (via `POST /client-events`). Three `kind` values (`log` / `exam_telemetry` / `proctor`); ~27 distinct `name` literals emitted today.
- The proctor timeline **reads from both tables and merges them** — so an audit-log row and a client-event row are projected into one timeline shape. They are never written to the same table.
- **Redis / email / worker events do not exist today.** No email/outbox/worker infrastructure exists. Redis is connected but emits no events. The M4 monitoring events (`redis.unavailable`, `email.send_failed`, …) are all genuinely new.
- Naming is **inconsistent**: audit actions use `dot.case` (e.g. `attempt.forceSubmit`), client events use `snake_case` (e.g. `answer_autosave_failed`). M4 should pick one style per channel and document it; this doc must not silently "fix" it.

---

## 1. Two Event Channels — Schema Boundary

The codebase keeps compliance audit and frontend observability in **separate tables** on purpose. This is the single most important fact for M4.

### 1.1 `audit_logs` (compliance — server authoritative)

**Schema:** `packages/db/src/schema/pg.ts:417-437`

```ts
auditLogs = pgTable("audit_logs", {
  id, organizationId, actorId,
  action: text("action").notNull(),          // free-form string, NO enum
  targetType: text("target_type").notNull(),  // "exam" | "attempt" | "user" | ...
  targetId: text("target_id").notNull(),
  metadata: jsonb("metadata").notNull(),
  ipAddress, userAgent, createdAt,
})
```

- `action` is a plain `text` column. There is **no enum, no string union, no constants module, no Zod enum** constraining it anywhere in `packages/contracts` or `packages/domain`. Action strings are duplicated as literals at ~30 call sites.
- Single composite index: `(organizationId, createdAt)`.

### 1.2 `client_events` (observability — browser-reported)

**Schema:** `packages/db/src/schema/pg.ts:452-502`

```ts
clientEvents = pgTable("client_events", {
  id, organizationId, userId (nullable),
  attemptId, examId, questionId,           // nullable; telemetry handles only
  kind: text("kind").notNull(),            // "log" | "exam_telemetry" | "proctor"
  level: text("level").notNull(),          // "debug" | "info" | "warn" | "error"
  name: text("name").notNull(),            // free-form, regex-validated at ingest
  route, occurredAt, receivedAt, clientSessionId, metadata, userAgent,
})
```

**Schema comment (verbatim, `pg.ts:439-451`):**

> Deliberately separate from `auditLogs`: audit logs are compliance records of admin/actor actions; client events are best-effort frontend observability. The single-tenant boundary is enforced via `organizationId` on every row, populated server-side from the authenticated context.

- `kind` IS constrained: `ClientEventKindEnum = z.enum(["log", "exam_telemetry", "proctor"])` (`packages/contracts/src/clientEvent.ts:9`).
- `name` is NOT an enum — only a regex (`/^[a-z0-9][a-z0-9._-]{0,119}$/i`) and length cap (1–120) at ingest.
- 4 indexes (org+receivedAt; org+kind+receivedAt; org+attempt+receivedAt; org+exam+receivedAt).

### 1.3 Are they distinguished?

**Yes, at the storage and ingest layer; no, at the read/display layer.**

| Dimension | audit_logs | client_events |
|-----------|-----------|---------------|
| Who writes | Server only (route handlers + scanner plugins + scripts) | Browser only (`POST /client-events`) |
| Authority | PG (compliance record) | PG (best-effort telemetry) |
| `action`/`name` typed? | ❌ free-form `text` | ⚠️ regex only (no enum) |
| `kind` typed? | n/a (no kind column) | ✅ enum (`log`/`exam_telemetry`/`proctor`) |
| Read for display | Audit Log page + per-attempt timeline + proctor timeline | Proctor timeline + proctor status counts |
| Privacy posture | actor + target ids only (per call-site discipline) | server re-sanitized + allowlist projection |

The **proctor timeline merges both** into one shape (`ProctorAttemptEventSchema`), tagging each row with `source: "client_event" | "audit_log"` so a reader can tell them apart. That is the only place the boundary blurs — it is a read-time projection, not a write-time merge.

---

## 2. Audit Events — Complete Catalog

All rows below are written to `audit_logs`. The single helper is `recordAudit()` (`apps/api/src/routes/audit.ts:25-63`) — **fire-and-forget** (failures are logged, never thrown). A minority of call sites bypass it and call `createAuditLogRepo(...).create(...)` directly (awaited, best-effort) — those are marked `direct`.

### 2.1 Auth / Session

| Action | targetType | Source | Notes |
|--------|-----------|--------|-------|
| `login.success` | `user` | `apps/api/src/routes/auth.ts:217` | metadata `{ username }` |
| `login.failure` | `login` | `apps/api/src/routes/auth.ts:138, 165` | two paths: `invalid_credentials`, `unsupported_phase1_role` |
| `logout` | `user` | `apps/api/src/routes/auth.ts:270` | |
| `auth.profile_update` | `user` | `apps/api/src/routes/auth.ts:430` | self profile rename |

### 2.2 User / Admin (admin-managed accounts)

| Action | targetType | Source | Notes |
|--------|-----------|--------|-------|
| `user.create` | `user` | `apps/api/src/routes/user.ts:133` | |
| `user.update` | `user` | `apps/api/src/routes/user.ts:213` | |
| `user.delete` | `user` | `apps/api/src/routes/user.ts:321` | |
| `candidate.password_reset` | `user` | `apps/api/src/routes/user.ts:281` | admin resets a candidate's password |
| `admin.bootstrap` | `user` | `apps/api/src/scripts/bootstrap-admin.ts:86` | boot script, `actorId: "system"` |
| `admin.password_reset.local` | `user` | `apps/api/src/scripts/reset-admin-password.ts:72` | reset script, `actorId: "system"` |

### 2.3 Candidate (examinee identity) & Candidate Field

| Action | targetType | Source | Notes |
|--------|-----------|--------|-------|
| `candidate.create` | `candidate` | `apps/api/src/routes/candidate.ts:304` | |
| `candidate.update` | `candidate` | `apps/api/src/routes/candidate.ts:384` | |
| `candidate.import` | `organization` | `apps/api/src/routes/candidate.ts:526` | metadata `{ total, created, updated, errors }` |
| `candidate_field.create` | `candidate_field` | `apps/api/src/routes/candidateField.ts:101` | |
| `candidate_field.update` | `candidate_field` | `apps/api/src/routes/candidateField.ts:165` | |
| `candidate_field.delete` | `candidate_field` | `apps/api/src/routes/candidateField.ts:218` | |

### 2.4 Course & Question

| Action | targetType | Source | Notes |
|--------|-----------|--------|-------|
| `course.create` | `course` | `apps/api/src/routes/course.ts:151` | |
| `course.update` | `course` | `apps/api/src/routes/course.ts:192` | |
| `course.delete` | `course` | `apps/api/src/routes/course.ts:247` | |
| `question.create` | `question` | `apps/api/src/routes/question.ts:219` | |
| `question.update` | `question` | `apps/api/src/routes/question.ts:309` | |
| `question.delete` | `question` | `apps/api/src/routes/question.ts:354` | |
| `question.import` | `course` | `apps/api/src/routes/question.ts:493` | metadata `{ total, valid, errors }` |

### 2.5 Exam lifecycle (admin)

| Action | targetType | Source | Notes |
|--------|-----------|--------|-------|
| `exam.create` | `exam` | `apps/api/src/routes/exam.ts:511` | |
| `exam.update` | `exam` | `apps/api/src/routes/exam.ts:628` | |
| `exam.publish` | `exam` | `apps/api/src/routes/exam.ts:670` | |
| `exam.unpublish` | `exam` | `apps/api/src/routes/exam.ts:843` | metadata `{ fromStatus }` |
| `exam.close` | `exam` | `apps/api/src/routes/exam.ts:778` | metadata `{ reason }` |
| `exam.cancel` | `exam` | `apps/api/src/routes/exam.ts:1006` | metadata `{ reason }` |
| `exam.archive` | `exam` | `apps/api/src/routes/exam.ts:1082` | metadata `{ fromStatus }` |
| `exam.extend` | `exam` | `apps/api/src/routes/exam.ts:908` | metadata `{ extendMinutes }` — exam-level extend |
| `exam.publish_results` | `exam` | `apps/api/src/routes/exam.ts:1155` | metadata `{ alreadyPublished }` |
| `exam.delete` | `exam` | `apps/api/src/routes/exam.ts:1198` | |
| `exam.<transition>` | `exam` | `apps/api/src/routes/reconciliation.ts:51` | **dynamic**: `exam.${transition}` e.g. `exam.open`, `exam.closed`; double-transition emits both (`exam.open` + `exam.closed`) |

### 2.6 Enrollment

| Action | targetType | Source | Notes |
|--------|-----------|--------|-------|
| `enrollment.add` | `enrollment` | `apps/api/src/routes/exam.ts:1331` | metadata `{ examId, candidateId }` |
| `enrollment.remove` | `enrollment` | `apps/api/src/routes/exam.ts:1397` | metadata `{ examId, candidateId }` |

### 2.7 Attempt — candidate self-service

| Action | targetType | Source | Notes |
|--------|-----------|--------|-------|
| `attempt.start` | `attempt` | `apps/api/src/routes/attempts.candidate.ts:678` | `recordAudit`; isNew branch |
| `attempt.restore` | `attempt` | `apps/api/src/routes/attempts.candidate.ts:678, 1048` | two sites (start else-branch + resume) |
| `attempt.saveAnswer` | `attempt` | `apps/api/src/routes/attempts.candidate.ts:872` | only when `result.accepted` |
| `attempt.submit` | `attempt` | `apps/api/src/routes/attempts.candidate.ts:948` | |

> **Naming note:** these use `attempt.<verb>` camelCase, consistent with §2.8's admin/scanner attempt actions. Across the whole `audit_logs` table the action style is overwhelmingly `dot.case` (see §6) — the only non-conforming literals are `export_scores`, `login.success`, and `login.failure`. `client_events.name`, by contrast, is `snake_case`. M4 should preserve `dot.case` for new audit actions.

### 2.8 Attempt — admin / system (proctor-like compliance)

All four are **direct** `createAuditLogRepo(...).create()` calls (awaited, best-effort), not `recordAudit`. They are the rows the proctor timeline (`TIMELINE_AUDIT_ACTIONS`) projects.

| Action | targetType | Source | Notes |
|--------|-----------|--------|-------|
| `attempt.forceSubmit` | `attempt` | `apps/api/src/routes/attempts.admin.ts:240` (direct) | only on real transition; idempotent no-op skips audit |
| `attempt.misconductFlagged` | `attempt` | `apps/api/src/routes/attempts.admin.ts:98` (direct) | metadata `{ severity, notes }` |
| `attempt.extendTime` | `attempt` | `apps/api/src/routes/attempts.admin.ts:329` (direct) | metadata `{ additionalMinutes }` — per-attempt extend |
| `attempt.autoSubmit` | `attempt` | `apps/api/src/plugins/deadlineScanner.ts:143` (direct) | `actorId: SYSTEM_ACTOR_ID`, metadata `{ source: "deadline-scanner" }` |
| `attempt.disrupted` | `attempt` | `apps/api/src/plugins/heartbeat.ts:144` (direct) | `actorId: SYSTEM_ACTOR_ID`, metadata `{ source: "heartbeat-scanner" }` |
| `attempt.exported` | `attempt` | `apps/api/src/routes/attempts.admin.ts:579` (direct) | metadata `{ format }` — single-attempt answer export |

### 2.9 Grading

| Action | targetType | Source | Notes |
|--------|-----------|--------|-------|
| `grading.score_entered` | `attempt` | `apps/api/src/routes/gradingQueue.ts:278` (direct) | metadata `{ questionId, score, maxScore, previousScore, graderId }` |
| `grading.finalized` | `attempt` | `apps/api/src/routes/gradingQueue.ts:307` (direct) | only when attempt becomes `fully_graded`; metadata `{ gradingStatus, graderId }` |

> **M4 naming note:** the job card proposes `grading.score_submitted`, but code already writes `grading.score_entered`. See §8.4 — M4 must reconcile, not duplicate.

### 2.10 Export (bulk) & Branding

| Action | targetType | Source | Notes |
|--------|-----------|--------|-------|
| `export_scores` | `exam` | `apps/api/src/routes/export.ts:133` | metadata `{ format, rowCount }` — bulk scores CSV |
| `branding.update` | `organization` | `apps/api/src/routes/settings.ts:196` | org display-name / product title |

### 2.11 Audit action count

**~50 distinct `action` literals** across the codebase (~49 static literals enumerated in §2.1–2.10, plus the dynamic `exam.<transition>` family in §2.5 which emits e.g. `exam.open` / `exam.closed`). The §2 tables are the authoritative enumeration; this count is approximate and must not be trusted over the tables.

---

## 3. Monitoring / Telemetry Events — `client_events`

Written **only by the browser** through two APIs:

- **`logger.*`** (`apps/web/src/lib/logger.ts`) — `kind: "log"`. Generic admin-page observability.
- **`trackExamEvent()`** (`apps/web/src/lib/examTelemetry.ts`) — `kind: "exam_telemetry"`. Candidate exam-runtime flow. Dual-emits `warn`/`error` into the `log` channel too.

Both push into one shared `ClientEventBuffer` (`apps/web/src/lib/clientEventBuffer.ts`) → batched `POST /api/client-events`. There is **no server-side writer of `client_events`** (only the ingest route).

### 3.1 `exam_telemetry` events (candidate runtime) — emitted by `trackExamEvent`

| Name | Emitted at | Level | Notes |
|------|-----------|-------|-------|
| `exam_started` | `StartExamPage.tsx:67` | info | |
| `exam_start_failed` | `StartExamPage.tsx:70` | — | failure |
| `attempt_resume_requested` | `StartExamPage.tsx:104` | info | |
| `exam_page_loaded` | `TakeExamPage.tsx:148, 179` | info | throttled via coalesce? no — emitted on load |
| `exam_page_unloaded` | `TakeExamPage.tsx:201` | info | |
| `question_viewed` | `TakeExamPage.tsx:224` | info | **coalesced** (5s window) |
| `answer_autosave_started` | `TakeExamPage.tsx:257` | info | |
| `answer_autosave_success` | `TakeExamPage.tsx:281, 305` | info | **coalesced** (5s window) |
| `answer_autosave_failed` | `TakeExamPage.tsx:319, 333` | warn/error | dual-emitted to `log` |
| `submit_requested` | `TakeExamPage.tsx:353` | info | |
| `submit_success` | `TakeExamPage.tsx:356` | info | |
| `submit_failed` | `TakeExamPage.tsx:361` | error | dual-emitted; allowlisted metadata `{ durationMs, errorCode }` |
| `submit_clicked` | `TakeExamPage.tsx:385` | info | |
| `submit_confirm_opened` | `TakeExamPage.tsx:387` | info | |
| `submit_confirm_cancelled` | `TakeExamPage.tsx:394` | info | |
| `heartbeat_restored` | `TakeExamPage.tsx:457` | — | |
| `heartbeat_failed` | `TakeExamPage.tsx:475` | — | |
| `browser_offline` | `TakeExamPage.tsx:497` | — | |
| `browser_online` | `TakeExamPage.tsx:499` | — | |
| `visibility_lost` | `TakeExamPage.tsx:506` | — | |
| `visibility_restored` | `TakeExamPage.tsx:510` | — | |
| `deadline_auto_submit_started` | `TakeExamPage.tsx:545` | — | |
| `deadline_auto_submit_success` | `TakeExamPage.tsx:558` | — | |
| `deadline_auto_submit_failed` | `TakeExamPage.tsx:549, 560` | error | dual-emitted; allowlisted `{ durationMs, errorCode }` |

### 3.2 `log` events (admin pages) — emitted by `logger.*`

| Name | Emitted at | Level |
|------|-----------|-------|
| `system_diagnostics.refreshed` | `SystemDiagnosticsPage.tsx:100, 127` | debug |
| `system_diagnostics.poll_failed` | `SystemDiagnosticsPage.tsx:106, 136` | warn |
| `monitoring.poll_failed` | `ExamMonitoringPage.tsx:116` | warn |
| `monitoring.timeline_load_failed` | `ExamMonitoringPage.tsx:134` | warn |

### 3.3 `proctor` kind — **never emitted today**

`ClientEventKindEnum` reserves `kind: "proctor"` so the schema need not break later, but **no code emits a `proctor` client event**. The contract comment (`clientEvent.ts:4-8`) calls it "reserved for future Phase 2+ runtime instrumentation." M9 (Proctor Incident Event Logging v0) is the likely first consumer, and it is planned to write to **`audit_logs`**, not `client_events`.

### 3.4 Whitelist vs reality — the `paste_detected` ghost

The proctor timeline metadata allowlist (`apps/api/src/lib/proctorMonitoringService.ts:111-138`) lists **`paste_detected`** and **`answer_manual_save_failed`** as projected event names. Neither is **emitted** anywhere in `apps/web/src` today (grep confirms zero `trackExamEvent("paste_detected")` / `"answer_manual_save_failed"` sources). They are forward-looking allowlist entries, not live events. M4 / M9 should decide whether to wire them or prune the allowlist.

---

## 4. Proctor Monitoring — Read-Only Aggregation

**Files:** `apps/api/src/routes/proctorMonitoring.ts`, `apps/api/src/lib/proctorMonitoringService.ts`, `packages/contracts/src/proctorMonitoring.ts`

Monitoring performs **no invasive collection and writes nothing**. It reads three sources and projects them:

| Endpoint | Reads | Output |
|----------|-------|--------|
| `GET /admin/exams/:examId/proctor/attempts` | `exam_attempts.lastActivityAt` (heartbeat freshness) + `client_events` counts | `ProctorAttemptStatus[]` (onlineState, warningLevel, failure counts) |
| `GET /admin/attempts/:attemptId/proctor-events` | `client_events` + `audit_logs` for the attempt | merged `ProctorAttemptEvent[]` timeline, newest-first, with `source` tag |

**Privacy invariant (the whole point of the design):**

- `warningLevel` ∈ `normal | warning | critical` is a **status hint derived from observable flow** (offline, save/submit failures, visibility loss). There is deliberately **no `cheating_*` level, no camera/mic/clipboard/keystroke data, no cheating verdict.**
- Timeline `metadata` is **never the raw blob**: `projectSafeMetadata(name, raw)` keeps only per-event-name allowlisted keys (`questionId`, `durationMs`, `errorCode`, counts). Default-deny for unknown names.
- The three audit actions surfaced in the timeline are mapped to snake_case display names:
  `attempt.forceSubmit` → `force_submit`, `attempt.misconductFlagged` → `mark_misconduct`, `attempt.extendTime` → `extend_time` (`proctorMonitoringService.ts:100-108`).

**Counted event names** that feed the status table (`COUNTED_EVENT_NAMES`, `proctorMonitoringService.ts:83-90`): `visibility_lost`, `browser_offline`, `answer_autosave_failed`, `answer_manual_save_failed`, `submit_failed`, `deadline_auto_submit_failed`.

---

## 5. Diagnostics — Read-Only Health Snapshot

**Endpoint:** `GET /system/diagnostics` (`apps/api/src/routes/system.ts:184-238`)
**Contract:** `DiagnosticsResponseSchema` (`packages/contracts/src/system.ts:56-80`)
**Admin-only.**

Returns a point-in-time snapshot — **writes no event of any kind.** It is the *closest thing* to a monitoring surface, but it is poll-only:

```ts
{
  version, uptime, dbLatency,
  redisStatus: { connected, latencyMs },        // try/catch around redis.ping()
  heartbeatStatus: { interval, timeout, lastScanAt, disruptedCount },
  deadlineScannerStatus: { interval, lastScanAt, autoSubmitCount },
  config: { heartbeatInterval, heartbeatTimeout, deadlineScanInterval }
}
```

- Redis status is computed live (`fastify.redis.ping()` with try/catch → `connected:false` on failure). **No `diagnostics.health_checked` event is emitted** despite M4 proposing one.
- Scanner metrics (`heartbeatMetrics`, `deadlineScannerMetrics`) are in-memory module-level counters, reset on restart — not persisted, not evented.
- Companion endpoints: `GET /system/health` (cpu/memory/db status `ok|degraded|critical`) and `GET /system/dashboard` (aggregate counts). Neither emits events.

---

## 6. Event Naming & Typing — Current State

| Channel | Style | Example | Typed? |
|---------|-------|---------|--------|
| `audit_logs.action` | `dot.case` (mostly camelCase verb) | `attempt.forceSubmit`, `exam.publish_results`, `grading.score_entered` | ❌ free-form `text` |
| `audit_logs.action` | snake_case outlier | `export_scores`, `login.failure/success` | ❌ |
| `client_events.name` | `snake_case` | `answer_autosave_failed`, `system_diagnostics.refreshed` | ⚠️ regex only |
| `client_events.kind` | enum | `log` / `exam_telemetry` / `proctor` | ✅ Zod enum |
| `client_events.level` | enum | `debug` / `info` / `warn` / `error` | ✅ Zod enum |
| Proctor timeline display name | `snake_case` | `force_submit`, `mark_misconduct` | ❌ derived map |

**There is no central event registry.** Adding a new audit action means inventing a new literal at the call site; nothing checks it is spelt consistently. This is the single biggest M4 input — see §8.

---

## 7. Missing Events (gaps M4 is meant to fill)

### 7.1 Audit events that do not exist today

| M4-proposed | Status | Closest existing |
|-------------|--------|------------------|
| `grading.detail_viewed` | ❌ missing — the `GET …/grading-details` route writes no audit | `grading.score_entered` (write-side only) |
| `grading.score_submitted` | ⚠️ **naming collision** — `grading.score_entered` already does this | `grading.score_entered` |
| `attempt.force_submitted` | ⚠️ **already exists as `attempt.forceSubmit`** | `attempt.forceSubmit` |
| `proctor.incident_marked` | ⚠️ partial — `attempt.misconductFlagged` is the current incident record | `attempt.misconductFlagged` |
| `email.outbox_created` | ❌ missing — no email infra exists | none |

### 7.2 Monitoring events that do not exist today (none of these are emitted)

| M4-proposed | Why missing |
|-------------|-------------|
| `redis.unavailable` | Redis plugin has no `"error"`/`"close"` listener; diagnostics is poll-only |
| `redis.recovered` | same |
| `email.send_failed` | no email sender exists |
| `email.send_retried` | no email worker exists |
| `email.worker_unavailable` | no email worker exists |
| `diagnostics.health_checked` | diagnostics route writes nothing |

### 7.3 Structural gaps (not in M4 scope, flagged for L9)

- **No event for: candidate login-disabled / locked-out, exam results viewed by candidate, grading detail export, question bank bulk delete, organization settings changes** beyond branding.
- **No monitoring event when the heartbeat scanner or deadline scanner itself errors** — they only `fastify.log.error(...)`.
- **No server-side client-event writer** — backend-observable incidents (e.g. a forced reconnect) cannot currently produce a `client_events` row; they go to logs or `audit_logs` only.

---

## 8. M4 First-Batch Recommendations

M4's job-card proposes a fixed list. After this audit, several proposed names **collide with existing actions**. The recommendation is: **do not duplicate — alias/reconcile, and decide the channel first.**

### 8.1 Channel discipline (decide before naming anything)

| Need | Channel | Why |
|------|---------|-----|
| "Who did what to which entity, for compliance" | `audit_logs` | server-authoritative, actor-bound |
| "Is infra up? Did a background job fail?" | **new monitoring surface** (see 8.5) | not actor-bound, may be infra-originated |
| "What did the candidate's browser observe?" | `client_events` | already the channel; browser-only |

M4 must NOT start writing infra health into `audit_logs` (no actor, pollutes compliance) NOR into `client_events` (browser-only by design). See 8.5.

### 8.2 Audit events — reconcile, don't duplicate

| M4 proposal | Recommendation |
|-------------|----------------|
| `grading.detail_viewed` | ✅ **Add new.** Genuine gap. Write at `gradingQueue.ts` GET grading-details. Keep `dot.case` to match the table. |
| `grading.score_submitted` | ⚠️ **Do NOT add as new.** `grading.score_entered` already exists. Either (a) keep `score_entered` and document it, or (b) rename existing to `score_submitted` in one migration of all read/write/test sites. Pick one; do not keep both. |
| `attempt.force_submitted` | ❌ **Already exists as `attempt.forceSubmit`.** Do not add. (M4 card used snake_case by mistake.) |
| `proctor.incident_marked` | ⚠️ Reconcile with `attempt.misconductFlagged`. Recommendation: keep `attempt.misconductFlagged` (more specific — it is misconduct, not a generic incident) and treat M9's `suspicious_behavior_marked` / `network_issue_marked` / `identity_check_failed` / `manual_note_added` as **new** misconduct sub-reasons in metadata, not new top-level actions. |
| `email.outbox_created` | ✅ **Add new** (blocks on M3 existing first). |

### 8.3 Monitoring events — all genuinely new, but pick a home

All six M4 monitoring events (`redis.unavailable`, `redis.recovered`, `email.send_failed`, `email.send_retried`, `email.worker_unavailable`, `diagnostics.health_checked`) are **correctly identified as missing.** Open question for M4: where do they live?

### 8.4 Naming-style decision M4 must make

Three styles coexist (`dot.case` audit, `snake_case` telemetry, `snake_case` proctor display). M4 should **document the rule, not silently add more mixed literals**:

- Recommended: audit actions stay `dot.case` (`entity.verb`); monitoring/infra events use `snake_case` (`redis.unavailable`) to match the existing `client_events.name` convention and the proctor timeline; the timeline's `auditActionToEventName` map already bridges the two for display.

### 8.5 Open design question for M4 (escalate, do not decide silently)

Monitoring events have **no natural table today.** Options:

- **A. New `monitoring_events` table** — cleanest separation (compliance / telemetry / infra each distinct), but adds a 3rd event surface and a repo.
- **B. Reuse `client_events` with a new `kind: "infra"`** — reuses ingest/storage, but `client_events` is documented as *browser-reported*; server-originated rows would contradict the schema comment.
- **C. Structured `pino` logs only** — no table; relies on log aggregation. Cheapest, but not queryable from the admin UI and conflicts with M5's "diagnostics page shows infra status" goal.

This is a real decision; M4's card says "根据现有代码结构决定使用 enum、string union、schema 或常量文件" but does not pick the table. **Recommend M4 produce a one-paragraph decision (likely A or B) before implementing**, and keep full taxonomy for L9.

---

## 9. Risk Points

### R1 — No audit action enum
`action` is free-form `text`. A typo (`atempt.submit`) would silently create an unfilterable orphan row. M4 (or L9) should introduce a Zod enum / constants module and validate at the `recordAudit` boundary.

### R2 — Two write paths to `audit_logs`
`recordAudit()` (fire-and-forget) vs direct `createAuditLogRepo().create()` (awaited). The direct path exists for rows that must commit before the response (force-submit, grading, scanners). M4 must not add a third path; new audit writes should pick one of these two deliberately.

### R3 — Naming collision risk in M4
`grading.score_submitted` vs `grading.score_entered`, `attempt.force_submitted` vs `attempt.forceSubmit`. If M4 adds the proposed names verbatim, the audit log will have two actions for one event, splitting filters and counts. §8.2 lists the reconciliation.

### R4 — Monitoring events have no home
See §8.5. Writing infra events into `audit_logs` or `client_events` would violate the documented purpose of both tables.

### R5 — Ghost allowlist entries
`paste_detected` and `answer_manual_save_failed` are in the timeline metadata allowlist but never emitted. Either wire them (M9) or prune, to avoid implying monitoring coverage that does not exist.

### R6 — Scanner errors are log-only
When `heartbeat.ts` / `deadlineScanner.ts` catch an error, they `fastify.log.error(...)` and continue. There is no persisted signal that a scanner is failing. Under M4/M5 this should become a monitoring event.

### R7 — `proctor` kind reserved but unused
The `proctor` client-event kind is schema-accepted but never emitted. M9 plans proctor incidents to go to `audit_logs` instead. M4 should clarify which channel proctor-domain events use, or the reserved kind stays dead.

---

## 10. File Inventory

### Audit (`audit_logs`)

| File | Role |
|------|------|
| `packages/db/src/schema/pg.ts:417` | `audit_logs` table |
| `packages/db/src/repository/auditLogRepo.ts` | CRUD + `listPaginatedFiltered` + `listByTarget` |
| `packages/contracts/src/audit.ts` | query/response schemas, `AttemptTimelineEventSchema` |
| `apps/api/src/routes/audit.ts` | `recordAudit()` helper + `GET /admin/audit-logs` |
| `apps/api/src/routes/{auth,user,candidate,candidateField,course,question,exam,settings,export}.ts` | `recordAudit` call sites (§2.1–2.6, 2.10) |
| `apps/api/src/routes/attempts.candidate.ts` | candidate attempt audits (§2.7) |
| `apps/api/src/routes/attempts.admin.ts` | force-submit / misconduct / extend-time / exported (§2.8, direct) |
| `apps/api/src/routes/gradingQueue.ts` | `grading.score_entered` / `grading.finalized` (§2.9, direct) |
| `apps/api/src/routes/reconciliation.ts` | dynamic `exam.<transition>` (§2.5) |
| `apps/api/src/plugins/deadlineScanner.ts` | `attempt.autoSubmit` (§2.8, direct, system actor) |
| `apps/api/src/plugins/heartbeat.ts` | `attempt.disrupted` (§2.8, direct, system actor) |
| `apps/api/src/scripts/{bootstrap-admin,reset-admin-password}.ts` | `admin.bootstrap` / `admin.password_reset.local` (§2.2, system actor) |

### Monitoring / Telemetry (`client_events`)

| File | Role |
|------|------|
| `packages/db/src/schema/pg.ts:452` | `client_events` table |
| `packages/db/src/repository/clientEventRepo.ts` | `createMany` + `listForTimeline` + `countByAttemptAndName` |
| `packages/contracts/src/clientEvent.ts` | `ClientEventSchema`, kind/level enums, size/depth caps |
| `apps/api/src/routes/clientEvents.ts` | `POST /client-events` ingest (server re-sanitizes) |
| `apps/web/src/lib/logger.ts` | `logger.*` → `kind: "log"` |
| `apps/web/src/lib/examTelemetry.ts` | `trackExamEvent()` → `kind: "exam_telemetry"`, coalescing |
| `apps/web/src/lib/clientEventBuffer.ts` | shared batch buffer + flush |
| `apps/web/src/lib/sanitizeClientEvent.ts` | client-side redaction (answer/content/token keys) |
| `apps/web/src/pages/exam/{StartExamPage,TakeExamPage}.tsx` | exam_telemetry emit sites (§3.1) |
| `apps/web/src/pages/admin/{SystemDiagnosticsPage,ExamMonitoringPage}.tsx` | log emit sites (§3.2) |

### Proctor monitoring (read-only)

| File | Role |
|------|------|
| `apps/api/src/routes/proctorMonitoring.ts` | `GET /proctor/attempts` + `GET /proctor-events` |
| `apps/api/src/lib/proctorMonitoringService.ts` | status build, timeline merge, allowlist projection |
| `packages/contracts/src/proctorMonitoring.ts` | status + event schemas, thresholds, warningLevel |

### Diagnostics (read-only)

| File | Role |
|------|------|
| `apps/api/src/routes/system.ts:184` | `GET /system/diagnostics` (+ `/health`, `/dashboard`) |
| `packages/contracts/src/system.ts:56` | `DiagnosticsResponseSchema` |

### Tests

| File | Lines | Covers |
|------|------:|--------|
| `apps/api/src/routes/audit.test.ts` | 713 | audit list/filter/pagination |
| `apps/api/src/routes/clientEvents.test.ts` | 199 | ingest validation, sanitize, batch cap |
| `apps/api/src/routes/proctorMonitoring.test.ts` | 264 | status classification, timeline merge, allowlist |
| `apps/api/src/routes/gradingQueue.test.ts` | 789 | `grading.score_entered` / `grading.finalized` assertions |
| `apps/api/src/routes/attempts/timeline.test.ts` | 377 | audit-log timeline read |
| `apps/e2e/e2e/audit-log.spec.ts` | 182 | E2E audit log page |

---

## 11. Documentation References

| Doc | Content |
|-----|---------|
| `docs/phase3/job-cards.md` §M4 | The event-expansion job this audit feeds (proposed event list) |
| `docs/phase3/plan.md` | Lists S6 (this doc) and M4; flags L9 "Audit / Monitoring Full Event Taxonomy" as deferred Large |
| `docs/phase3/audit-current-redis.md` §R6 | Notes `redis.unavailable` / `redis.recovered` are planned but unemitted (cross-ref for §7.2) |
| `packages/db/src/schema/pg.ts:439-451` | The verbatim design comment separating `audit_logs` from `client_events` |
| `packages/contracts/src/proctorMonitoring.ts` | "proctor = monitoring DOMAIN, not a role" naming note relevant to §8.2 |
