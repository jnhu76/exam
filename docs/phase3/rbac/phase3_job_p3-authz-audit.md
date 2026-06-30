# Job Card — P3-AUTHZ-AUDIT

> **Type:** Audit / Design Fact Base
> **Phase:** Phase 3 Pre-Implementation
> **Branch:** `phase3/authz-framework-audit`
> **Expected output:** Documentation only
> **Business behavior change:** None
> **Code behavior change:** None, except optional test-only scripts if needed for evidence generation
> **Primary goal:** Decide exactly how to introduce an authorization framework and gradually add permission settings without breaking current Admin/Candidate behavior.

---

# 0. Context

The project currently has a partial permission system:

* `Role` and `Permission` exist in domain/auth packages.
* `requirePermission()` exists but is not used by routes.
* Actual route authorization is still mostly `requireRole(["Admin"])`, `requireRole(["Candidate"])`, or `requireRole(["Candidate", "Admin"])`.
* Some handler-level role checks still use hardcoded `"Admin"` / `"Candidate"` strings.
* Audit events exist but use free-form action strings.
* Client telemetry exists separately from audit logs.
* Grading details already expose candidate answers.
* Redis is optional infrastructure and must not become authoritative for permissions or business state.
* Candidate runtime state and answer protocol v2 are adjacent Large jobs and must not be accidentally solved inside the authorization audit.

This job must produce a **fact-based audit report** that can be used to write later implementation job cards.

---

# 1. Non-Goals

Do **not** implement the new permission system.

Do **not** replace `requireRole()` yet.

Do **not** introduce CASL, Casbin, Permify, Oso, or any other framework in this job.

Do **not** add permission management UI.

Do **not** change DB schema.

Do **not** change candidate runtime behavior.

Do **not** change answer save/submit protocol.

Do **not** change Redis adoption strategy.

Do **not** rename audit actions.

Do **not** add new audit/monitoring tables.

This is an audit and design-readiness job only.

---

# 2. Main Questions This Audit Must Answer

## 2.1 Authorization Model

1. What are all current role gates?
2. What are all current permission definitions?
3. Which permissions are unused, unassigned, or dangerous migration traps?
4. Which routes should eventually map to which permission?
5. Which routes need scope-aware authorization?
6. Which handler-level role checks exist outside route preHandlers?
7. Which frontend role checks exist?
8. Which test helpers or fixtures encode legacy/future roles?
9. What hardcoded role strings remain?
10. What should be migrated first without changing behavior?

## 2.2 Audit Registry Readiness

1. Which routes already write `audit_logs`?
2. Which sensitive routes do not write audit logs?
3. Which audit actions are free-form string literals?
4. Which audit actions collide with proposed future names?
5. Which audit actions should be constants before permission migration?
6. Which routes should be represented as:

```txt
route → permission → scope → auditAction
```

7. Which read-side operations need audit because they expose sensitive data?

Special focus:

```txt
GET /api/admin/attempts/:attemptId/grading-details
```

This returns candidate answers and should be treated as a sensitive read operation.

---

## 2.3 Monitoring / Telemetry Boundary

1. Which events belong to audit/compliance?
2. Which events belong to client telemetry?
3. Which events belong to infrastructure monitoring?
4. Are any monitoring events incorrectly proposed for `audit_logs` or `client_events`?
5. What future event registry shape should distinguish:

```txt
AuditAction
ClientEventName
MonitoringEventName
```

Do not decide the final storage table for monitoring events unless the existing code already makes the answer obvious. If not obvious, document options.

---

## 2.4 Grading / Candidate Answer Sensitivity

1. Which grading endpoints expose candidate answers?
2. Which roles currently can access them?
3. Which future permissions should protect them?
4. Should `VIEW_GRADING_DETAIL`, `VIEW_CANDIDATE_ANSWER`, and `GRADE_ANSWER` be separate?
5. What test gaps exist around candidate answer visibility?
6. Which E2E tests are skipped or insufficient?

---

## 2.5 Redis Boundary

1. Does any permission or state decision currently depend on Redis?
2. Could any planned authz design accidentally depend on Redis?
3. Which Redis behavior is optional enhancement only?
4. What Redis failure paths matter to monitoring but not permissions?
5. Confirm this invariant:

```txt
Redis must never grant, deny, or own business permissions.
PostgreSQL/JWT/RequestContext remain authoritative.
```

---

## 2.6 Candidate Runtime Boundary

1. Which frontend state variables affect whether candidate actions are clickable?
2. Which of those are authorization concerns?
3. Which are runtime-state concerns?
4. What should be modeled as permission?

Examples:

```txt
attempt.take
attempt.answer.save
attempt.submit
attempt.restore
attempt.heartbeat.send
score.own.view
```

5. What should remain runtime state?

Examples:

```txt
deadlinePassed
isSubmitting
isFlushing
isDisconnected
saveRejection
autoSubmitFailed
```

The audit must explicitly prevent permission design from absorbing runtime state-machine problems.

---

## 2.7 Answer Protocol Boundary

1. Which endpoints save answer payloads?
2. Which submit endpoints do not carry answer payloads?
3. Which paths submit/grade from persisted JSONB answers?
4. Which permissions should exist around answer save, submit, force-submit, auto-submit, and candidate-answer viewing?
5. Which future answer protocol v2 concerns must be kept out of this authz job?

Examples:

```txt
submitted answer snapshot
answer hash
canonicalization
submit-time payload
clientSeqHistory storage
attempt_answers table
```

---

# 3. Files and Areas to Inspect

## 3.1 Role / Permission / AuthZ

Inspect at minimum:

```txt
packages/domain/src/enums.ts
packages/domain/src/types.ts
packages/domain/src/errors.ts
packages/contracts/src/user.ts
packages/contracts/src/auth.ts
packages/auth/src/rbac.ts
packages/auth/src/session.ts
packages/auth/src/tenantGuard.ts
packages/db/src/schema/pg.ts
packages/db/src/repository/userRepo.ts
apps/api/src/plugins/auth.ts
apps/api/src/plugins/tenant.ts
apps/api/src/routes/**/*.ts
apps/api/src/scripts/*.ts
apps/web/src/**/*.tsx
apps/web/src/**/*.ts
apps/api/tests/**/*.ts
apps/e2e/**/*.ts
```

## 3.2 Audit / Monitoring / Events

Inspect at minimum:

```txt
packages/db/src/schema/pg.ts
packages/db/src/repository/auditLogRepo.ts
packages/db/src/repository/clientEventRepo.ts
packages/contracts/src/audit.ts
packages/contracts/src/clientEvent.ts
packages/contracts/src/proctorMonitoring.ts
apps/api/src/routes/audit.ts
apps/api/src/routes/clientEvents.ts
apps/api/src/routes/proctorMonitoring.ts
apps/api/src/lib/proctorMonitoringService.ts
apps/web/src/lib/logger.ts
apps/web/src/lib/examTelemetry.ts
apps/web/src/lib/clientEventBuffer.ts
apps/web/src/lib/sanitizeClientEvent.ts
apps/web/src/pages/exam/*.tsx
apps/web/src/pages/admin/*.tsx
```

## 3.3 Grading / Candidate Answer

Inspect at minimum:

```txt
apps/api/src/routes/gradingQueue.ts
packages/contracts/src/score.ts
packages/db/src/schema/pg.ts
packages/db/src/repository/attemptRepo.ts
packages/db/src/repository/manualGradingRepo.ts
packages/exam-engine/src/manualGrading.ts
packages/exam-engine/src/grading.ts
apps/web/src/pages/admin/GradingQueuePage.tsx
apps/web/src/pages/admin/GradingDetailPage.tsx
apps/api/src/routes/gradingQueue.test.ts
apps/web/src/pages/admin/GradingDetailPage.test.tsx
apps/e2e/e2e/manual-grading.spec.ts
apps/e2e/e2e/fill-blank-e2e.spec.ts
```

## 3.4 Redis

Inspect at minimum:

```txt
apps/api/src/plugins/redis.ts
apps/api/src/plugins/rateLimit.ts
apps/api/src/plugins/heartbeat.ts
apps/api/src/plugins/deadlineScanner.ts
apps/api/src/routes/system.ts
apps/api/src/config/runtimeConfig.ts
apps/api/src/server.ts
apps/api/src/routes/redis.test.ts
apps/api/src/routes/testRedis.ts
docker-compose.yml
docker-compose.dev.yml
docker-compose.test.yml
.github/workflows/ci.yml
docs/adr/ADR-001-redis.md
```

## 3.5 Candidate Runtime / Answer Protocol

Inspect at minimum:

```txt
apps/web/src/pages/exam/StartExamPage.tsx
apps/web/src/pages/exam/TakeExamPage.tsx
apps/web/src/pages/exam/ResultPage.tsx
apps/web/src/hooks/useSubmitFlush.ts
apps/web/src/components/exam/ExamTimer.tsx
apps/web/src/components/exam/SaveIndicator.tsx
apps/web/src/components/exam/QuestionNavigator.tsx
packages/contracts/src/attempt.ts
packages/domain/src/types.ts
packages/exam-engine/src/answerProtocol.ts
packages/exam-engine/src/grading.ts
packages/exam-engine/src/attemptCommands.ts
apps/api/src/routes/attempts.candidate.ts
apps/api/src/routes/attempts.admin.ts
apps/api/src/orchestrators/submitAndGradeAttempt.ts
apps/api/src/plugins/deadlineScanner.ts
apps/e2e/e2e/save-submit-race.spec.ts
apps/e2e/e2e/submit-flush.spec.ts
apps/e2e/e2e/deadline-crash.spec.ts
apps/e2e/e2e/disconnect-restore.spec.ts
```

---

# 4. Required Deliverables

Create the following document:

```txt
docs/phase3/rbac/audit-authz-framework-readiness.md
```

The document must contain these sections.

## 4.1 Executive Summary

Include:

* Current authorization model.
* Whether a framework should be introduced.
* Whether current code is ready for permission enforcement.
* Top 5 blockers.
* Top 5 safe first steps.

## 4.2 Current Authorization Inventory

Produce tables for:

### Route Gates

| Route | Method | File | Current Gate | Handler-Level Role Logic? | Suggested Permission | Scope Needed? | Notes |

### Handler-Level Role Checks

| File | Line | Logic | Risk | Suggested Replacement |

### Frontend Role Checks

| File | Line | Logic | Current UX Behavior | Suggested Future Permission |

### Hardcoded Role Strings

| File | Line | String | Should Use | Risk |

## 4.3 Permission Inventory

| Permission | Defined? | Assigned to Admin? | Assigned to Candidate? | Used by Route? | Future Route Mapping | Risk |

Explicitly call out:

```txt
MANAGE_ORGANIZATION
VIEW_EXAM_ROOM
EXTEND_TIME
MARK_MISCONDUCT
FORCE_SUBMIT
TAKE_EXAM
VIEW_OWN_SCORE
VIEW_ALL_SCORES
EXPORT_SCORES
VIEW_SYSTEM_HEALTH
```

## 4.4 Proposed Permission Groups

Draft a proposed permission taxonomy.

Minimum groups:

```txt
users / organization
course / question
exam lifecycle
candidate runtime
answer protocol
proctor runtime
grading
score / result
audit / system
settings
system actor
```

## 4.5 Scope Model Readiness

Propose initial scope enum:

```txt
organization
course
exam
attempt
candidate
own_attempt
own_score
system
```

Do not implement.

## 4.6 Route → Permission → Audit Registry Draft

Draft a future registry shape across route families:

```txt
auth
users
candidates
candidate fields
courses
questions
exams
enrollments
attempt candidate runtime
attempt admin/proctor operations
grading queue/detail/grade
scores/result publishing
exports
audit logs
settings
system diagnostics
client events
proctor monitoring
```

## 4.7 Audit / Monitoring Boundary

### AuditAction Inventory

| Existing Action | Source File | Target Type | Should Become Constant? | Rename? | Notes |

### Sensitive Missing Audit Events

Must include `grading.detail_viewed`.

### Monitoring Event Boundary

Compare options A / B / C:

```txt
A. monitoring_events table
B. client_events kind = infra
C. structured logs only
```

## 4.8 Grading / Candidate Answer Sensitivity

Required conclusion: `VIEW_GRADING_DETAIL`, `VIEW_CANDIDATE_ANSWER`, and `GRADE_ANSWER` should be modeled separately.

## 4.9 Redis Boundary

State explicitly: `Redis must not be used as the source of truth for authorization.`

## 4.10 Candidate Runtime Boundary

Required conclusion:

```txt
Permission determines whether an actor may perform an action.
Runtime state determines whether the UI is currently in a legal phase to trigger it.
Do not merge these two concerns.
```

## 4.11 Answer Protocol Boundary

Required conclusion:

```txt
Answer Protocol v2 is a separate Large job.
AuthZ may define capabilities around save/submit/view/grade, but must not implement submit payload, answer snapshot, hash, canonicalization, or storage migration in this job.
```

## 4.12 Recommended Migration Plan

Staged plan: Stage 0–7 (Audit Baseline → Advanced Permission Overrides).

## 4.13 Job Card Suggestions

Minimum:

```txt
AUTHZ-S1 — Role String Cleanup
AUTHZ-S2 — RBAC Mapping Reconcile
AUTHZ-M1 — AuthZ Package Skeleton
AUTHZ-M2 — Route Permission Registry
AUTHZ-M3 — Shadow Permission Mode
EVENT-S1 — AuditAction Constants
EVENT-M1 — Monitoring Event Storage Decision
GRADING-S1 — Candidate Answer Visibility Test Coverage
REDIS-S1 — Redis Graceful Degradation
RUNTIME-L1 — Candidate Runtime State Machine Grillme
ANSWER-L1 — Answer Protocol v2 Grillme
```

---

# 5. Required Evidence Quality

Every claim must include at least one of:

1. File path and line number.
2. `rg` command output excerpt.
3. Test name and assertion.
4. Contract/schema reference.
5. Existing documentation reference.

Avoid unsupported claims. Do not say "probably", "seems", or "likely" unless explicitly marked as hypothesis. If evidence is ambiguous, write: `Finding is inconclusive because ...`

---

# 6. Commands to Run

Run at least `pnpm lint`, `pnpm typecheck`, `pnpm test -- --runInBand` (or repo equivalents). Also run the evidence-gathering `rg` searches from §3.

---

# 7. Acceptance Criteria

This job is complete only if:

* `docs/phase3/rbac/audit-authz-framework-readiness.md` exists.
* The document includes all sections from §4.
* The current role/permission model is fully inventoried.
* The current audit/client-event/monitoring boundary is explained.
* Grading candidate-answer sensitivity is explicitly handled.
* Redis is explicitly ruled out as authorization authority.
* Candidate runtime state is separated from authorization.
* Answer Protocol v2 is separated from authorization.
* A route → permission → scope → audit registry draft is included.
* A staged migration plan is included.
* Next job cards are proposed.
* No production behavior is changed.
* If any tests or commands fail, the failure is documented with exact command and error summary.

---

# 8. Review Checklist

Verify no implementation slipped in: no permission library, no DB migration, no route behavior change, no audit action rename, no client event change, no candidate runtime change, no answer protocol change. Claims backed by file evidence. Migration plan incremental and safe. First implementation jobs small enough to review independently.

---

# 9. Expected Final Summary Format

```txt
Done:
- Created docs/phase3/rbac/audit-authz-framework-readiness.md
- Inventoried N route gates
- Inventoried N handler-level role checks
- Inventoried N frontend role checks
- Inventoried N audit actions
- Identified N sensitive missing audit events
- Proposed N permission groups
- Proposed N staged follow-up jobs

Behavior changes:
- None

Tests/commands:
- <command>: pass/fail

Top risks:
1. ...

Recommended next job:
- AUTHZ-S1 — Role String Cleanup
```
