# Observability Contract

> Phase G of Phase 2 收口. Define the **minimum** observability contract for
> maintenance, troubleshooting, and test diagnostics before Phase 3. This is a
> contract definition, not a full OpenTelemetry rollout. It aligns what already
> exists (pino logs, audit_logs, diagnostics, requestId) into a documented
> shape.

## Purpose

Give operators and maintainers a consistent, non-leaking trail for: request
tracing, state transitions, audit, background-job diagnostics, and test
failure diagnosis — using the infrastructure already in place (pino logger,
`audit_logs` table, `/system/diagnostics`, `request.id`). No new heavy
dependency is introduced.

## Non-goals

- No OpenTelemetry / distributed-tracing stack (no collector, no exporters).
- No metrics aggregation system (Prometheus/Grafana) — `/system/health` and
  `/system/diagnostics` suffice for Phase 2 single-instance LAN.
- No log shipping/centralization — pino writes to stdout (Docker/compose
  captures it). Operators retain logs per their deployment policy.
- No PII or answer content in logs (see Redaction policy).

## Request trace fields

Every request has a correlation id. The minimum traceable shape:

| Field | Source | Example | Notes |
|---|---|---|---|
| requestId | `request.id` (Fastify default genReqId) | `"abc123"` | surfaced in error envelope `error.requestId`; thread through logs |
| method | HTTP method | `POST` | pino default request log |
| path / route | request path | `/api/attempts/:id/submit` | pino default |
| statusCode | reply status | `200` | pino onResponse log |
| durationMs | response time | `42` | pino onResponse log |
| timestamp | pino `time` | ISO | pino default |
| actorId | `ctx.actorId` | user id | only when authenticated; include in business log lines |
| actorRole | `ctx.role` | `Admin`/`Candidate` | include in business log lines |
| organizationId | `ctx.organizationId` | org id | tenant scoping for log search |
| errorCode | normalized code | `EXAM_NOT_OPEN` | only on error responses |

> Implementation status: requestId/method/path/statusCode/durationMs/timestamp
> are already produced by Fastify's pino integration. actorId/actorRole/
> organizationId/errorCode are available via `ctx` and the error handler; they
> are included in error envelopes and audit rows, and SHOULD be added to
> business-specific log statements where troubleshooting value is high.

## State transition log fields

State transitions (exam/attempt/enrollment) already emit **audit** rows. The
contract for a transition event:

| Field | Source | Notes |
|---|---|---|
| organizationId | ctx | tenant scoping |
| actorId | ctx | who/what triggered (userId, or `system`/`deadline_scanner`) |
| action | e.g. `exam.close`, `attempt.submit` | the audit action string |
| targetType | `exam` / `attempt` / `enrollment` | |
| targetId | the entity id | |
| stateBefore | previous status | add to audit `metadata` for lifecycle actions |
| stateAfter | new status | add to audit `metadata` |
| metadata | jsonb | transition reason, extendMinutes, source (`candidate`/`proctor`/`deadline_scanner`) |
| timestamp | audit_logs.createdAt | |

> Implementation status: audit rows already carry organizationId, actorId,
> action, targetType, targetId, metadata, createdAt. stateBefore/stateAfter
> and `source` are partially in metadata (e.g. reconciliation records
> fromStatus/toStatus in `reconciliation.ts`). The contract is to **standardize**
> these into `metadata.stateBefore`/`metadata.stateAfter`/`metadata.source`
> going forward (SHOULD FIX incrementally, not a 收口 blocker).

## Audit log fields

Already the canonical, append-only record. Contract (matches `audit_logs`
table):

| Field | Type | Notes |
|---|---|---|
| id | text | PK |
| organizationId | text | tenant boundary |
| actorId | text | who acted |
| action | text | e.g. `exam.publish`, `attempt.forceSubmit`, `login.success` |
| targetType | text | `exam`/`attempt`/`enrollment`/`user`/`candidate`/`organization` |
| targetId | text | entity id |
| metadata | jsonb | structured details (stateBefore/After, reason, source) |
| ipAddress | text? | request IP |
| userAgent | text? | request UA |
| createdAt | timestamptz | immutable |

> Implementation status: complete. `GET /api/admin/audit-logs` exposes it
> (action/targetType/date filter). No change needed.

## Background job log fields

The background scanners (heartbeat, deadline) are the only background jobs in
Phase 2 (in-process `setInterval`). Their diagnostics contract:

| Field | Source | Notes |
|---|---|---|
| job | `heartbeat` / `deadline_scanner` | |
| scanIntervalMs | runtimeConfig / scannerMetrics | |
| lastScanAt | scannerMetrics | surfaced in `/system/diagnostics` |
| disruptedCount / autoSubmitCount | scannerMetrics | surfaced in diagnostics |
| failedCount | scanner error log | pino `logger.error` on failed auto-submit |
| organizationId | ctx of the scanned attempt | tenant scoping |
| attemptId | the scanned row | for incident correlation |

> Implementation status: scanIntervalMs, lastScanAt, disruptedCount,
> autoSubmitCount are surfaced via `/system/diagnostics` and the
> `heartbeatMetrics`/`deadlineScannerMetrics` objects. Failed auto-submits are
> logged via `logger.error` (deadlineScanner.ts:192). No structured-job-log
> table exists; this is intentional for Phase 2 (no queue/worker). Redis
> diagnostics are also surfaced in diagnostics (`redisStatus`).

## Test diagnostics fields

For test failure diagnosis (BUG-FLAKE-001 etc.), the contract is captured in
`docs/standards/test-flakes.md` + `docs/archive/dev/adr-isolation-audit.md`. Minimum fields
a flake record carries:

| Field | Notes |
|---|---|
| date | observation date |
| jobContext | `pnpm verify`, `test:api`, CI shard |
| failingTest | file:line |
| errorSnippet | the failure output |
| rootCauseHypothesis | state-leak / I/O-contention / auth-amplification / env-missing |
| currentMitigation | serial containment, advisory lock, etc. |
| recurrenceCount | upgrade threshold ≥3 |

> Implementation status: this format is already followed by test-flakes.md.

## Redaction policy

Logs must NEVER contain (enforced by `apps/api/src/lib/logRedaction.ts`
`SENSITIVE_LOG_PATHS`, applied via pino `redact: { remove: true }`):

- passwords (`password`, `newPassword`, `currentPassword`, `passwordHash`)
- tokens (`token`, `accessToken`, `refreshToken`, `authorization`, `auth-token`)
- cookies (`req.headers.cookie`) and auth headers (`req.headers.authorization`)
- `standardAnswer` (answer key) from question payloads

Additional rules (policy, partially enforced):
- **No raw answer content** in logs except in explicit security-audit paths,
  and only sanitized. Answer bodies flow to PostgreSQL, not logs.
- **No full request body** in routine logs (redact removes credential fields;
  do not log full bodies for answer-save/submit).
- **No secrets/env** (JWT_SECRET, DB passwords) — never logged.
- PII (candidate field values) must not be logged at info level; audit rows
  store only ids + structured metadata, not free-form PII.

> Implementation status: the pino redact list covers the credential/token/
> cookie/auth/standardAnswer cases with `remove: true`. The policy rules above
> are the standing guideline for any new log statement.

## Examples

Request trace (pino, error path):
```json
{"level":"info","time":1730000000000,"req":{"method":"POST","url":"/api/attempts/a1/submit"},"reqId":"r1"}
{"level":"error","time":1730000000042,"reqId":"r1","msg":"attempt submit failed","actorId":"u7","organizationId":"org1","errorCode":"ATTEMPT_CLOSED"}
{"level":"info","time":1730000000042,"res":{"statusCode":409},"reqId":"r1","responseTime":42}
```

Audit row (exam close):
```json
{"action":"exam.close","actorId":"u1","organizationId":"org1","targetType":"exam","targetId":"e3","metadata":{"stateBefore":"open","stateAfter":"closed","reason":"manual"},"createdAt":"2026-06-24T05:00:00Z"}
```

Diagnostics snapshot (background + redis):
```json
{"redisStatus":{"connected":true,"latencyMs":3},"heartbeatStatus":{"interval":30000,"lastScanAt":"...","disruptedCount":0},"deadlineScannerStatus":{"interval":30000,"lastScanAt":"...","autoSubmitCount":0}}
```

## Implementation status

| Area | Current status | Gap | Priority |
|---|---|---|---|
| Request trace (requestId/method/status/duration) | Done (pino default) | — | — |
| requestId in error envelope | Done | — | — |
| actorId/role/orgId in business logs | Available via ctx; included in audit + errors | Standardize in business log statements | SHOULD FIX (incremental) |
| State transition audit rows | Done (action/target/metadata/createdAt) | Standardize `metadata.stateBefore/stateAfter/source` | SHOULD FIX (incremental) |
| Background job diagnostics | Done via `/system/diagnostics` + scannerMetrics | — | — |
| Redis diagnostics | Done (`redisStatus` in diagnostics, Phase C) | — | — |
| Pino redaction (creds/tokens/cookies/auth/standardAnswer) | Done | — | — |
| No answer-content / full-body logging | Policy (manual discipline) | Add a lint/test guard if abuse appears | DEFER |
| Distributed tracing (OTel) | Not present | Out of Phase 2 scope | PHASE 3+ |
| Centralized metrics (Prometheus) | Not present | Out of Phase 2 scope | PHASE 3+ |
