# RBAC-POST-PR186-BASELINE-AUDIT-1

## A. Verdict

```
RBAC BASELINE:
RECONSTRUCTED
```

## B. Baseline commit

```
BASELINE COMMIT:
ae03750d008b2b489f619b093c96694572f5167b

WORKTREE:
CLEAN

PR186 PRESENT:
YES (merge commit ae03750, PR #186, branch fix/proctor-landing-workspace)

Current branch:
audit/rbac-error-cleanup (based on master)
```

## C. Gate inventory

### requireRole call sites (44 actual, 4 comment-only)

| File | Call Sites | Comment-Only |
|------|-----------|--------------|
| routes/attempts.candidate.ts | 10 | 0 |
| routes/email.ts | 1 | 1 (line 16) |
| routes/importLogs.ts | 1 | 0 |
| routes/candidate.ts | 3 | 0 |
| routes/exam.ts | 5 | 0 |
| routes/system.ts | 3 | 0 |
| routes/user.ts | 5 | 0 |
| routes/course.ts | 1 | 0 |
| routes/candidateField.ts | 5 | 0 |
| routes/audit.ts | 1 | 0 |
| routes/roleAssignments.ts | 5 | 1 (line 41) |
| routes/settings.ts | 3 | 0 |
| routes/export.ts | 1 | 0 |
| Test files | 0 | 2 |
| **Total** | **44** | **4** |

### requireCapability call sites (31)

| File | Call Sites |
|------|-----------|
| routes/attempts.admin.ts | 6 |
| routes/question.ts | 6 |
| routes/candidate.ts | 1 |
| routes/exam.ts | 9 |
| routes/scores.ts | 1 |
| routes/proctorMonitoring.ts | 1 |
| routes/course.ts | 4 |
| routes/gradingQueue.ts | 1 |

### requireScopedCapability call sites (5)

| File | Count | Resolver | Routes |
|------|-------|----------|--------|
| routes/proctorMonitoring.ts | 3 | exam ("examId"), attempt ("attemptId") x2 | GET /admin/exams/:examId/proctor/attempts, GET /admin/attempts/:attemptId/proctor-events, POST /admin/attempts/:attemptId/proctor-incident |
| routes/gradingQueue.ts | 2 | attempt ("attemptId") x2 | GET /admin/attempts/:attemptId/grading-details, POST /admin/attempts/:attemptId/grade-question |

### requireScoreCapability call sites (1)

| File | Route |
|------|-------|
| routes/scores.ts | GET /scores/attempts/:attemptId |
## D. Exact counts

```
requireRole call sites:
44 (actual preHandler gates) + 4 (comment-only references)

files containing requireRole:
13 (non-test route files)

requireCapability call sites:
31

requireScopedCapability call sites:
5

requireScoreCapability call sites:
1
```

### By route family

| Family | requireRole | requireCapability | requireScopedCapability | requireScoreCapability |
|--------|:-----------:|:-----------------:|:-----------------------:|:----------------------:|
| candidate runtime | 10 | 0 | 0 | 0 |
| exam | 5 | 9 | 0 | 0 |
| course | 1 | 4 | 0 | 0 |
| question | 0 | 6 | 0 | 0 |
| user | 5 | 0 | 0 | 0 |
| role assignment | 5 | 0 | 0 | 0 |
| candidate fields | 5 | 0 | 0 | 0 |
| settings | 3 | 0 | 0 | 0 |
| system | 3 | 0 | 0 | 0 |
| audit | 1 | 0 | 0 | 0 |
| email | 1 | 0 | 0 | 0 |
| export | 1 | 0 | 0 | 0 |
| import logs | 1 | 0 | 0 | 0 |
| scores | 0 | 1 | 0 | 1 |
| proctor | 0 | 1 | 3 | 0 |
| grading | 0 | 1 | 2 | 0 |
| attempts admin | 0 | 6 | 0 | 0 |

### CALL SITES vs ROUTES

The 44 requireRole call sites correspond to 44 routes (1:1 mapping, each is a preHandler entry). The 31 requireCapability call sites also correspond to 31 routes (1:1). The 5 requireScopedCapability call sites correspond to 5 routes (3 proctor + 2 grading).

Total gates: 44 + 31 + 5 + 1 = 81 routes with authorization gates.

## E. Route registry drift

### Corrective-1 routes

| Route | Runtime Gate | Permission Match | Resolver Match | Verdict |
|-------|-------------|:----------------:|:--------------:|---------|
| GET /scores/attempts/:attemptId | requireScoreCapability | YES | YES (score) | **MATCH** |
| GET /admin/exams/:examId/proctor/attempts | requireScopedCapability(ExamRoomView, "exam", "examId") | YES | YES (exam) | **MATCH** |
| GET /admin/attempts/:attemptId/proctor-events | requireScopedCapability(AttemptTimelineView, "attempt", "attemptId") | YES | YES (attempt) | **MATCH** |
| POST /admin/attempts/:attemptId/proctor-incident | requireScopedCapability(AttemptMisconductMark, "attempt", "attemptId") | YES | YES (attempt) | **MATCH** |

### Registry conformance test certification

The routeRegistry.test.ts "corrective-1 migrated-route registry declarations" tests are **static registry self-assertions** — they assert that the registry constant has the expected values. They do NOT observe runtime middleware, do NOT register routes, and do NOT call Fastify. They are tautological: changing the registry constant changes both the test and the source simultaneously.

**The registry test is TAUTOLOGICAL — it does not prove runtime conformance.**

No drift between registry and runtime for the migrated routes. The registry is ahead of runtime for the 44 requireRole routes (they exist in registry but runtime still uses legacy gates).

## F. Runtime capability authority

### Questions answered

1. **ctx.role source**: From JWT claims (set at login, decoded from auth-token cookie by authenticate plugin).
2. **Login-time DB query or JWT claim?**: JWT claim. The role is stored in the token at login time.
3. **user_role_assignments participation**: **NO.** The user_role_assignments table exists, but it is NOT consulted during runtime authorization. The authenticate plugin reads users.role from the JWT.
4. **users.role is still authority?**: **YES.** The role from JWT (which was read from users.role at login) is the sole input to presetAllows().
5. **Multiple active assignments merged?**: **N/A.** Assignments are not read at runtime.
6. **Revoked/inactive assignment effect on current session?**: **NONE.** Token carries the role from login; assignment changes require re-login.
7. **Assignment scope in resolver comparison?**: **N/A.** Scope resolvers compare against ctx.organizationId (from JWT), not against assignment scopes.
8. **Token old role expiry?**: When users.role is changed, the existing JWT remains valid until expiry. No server-side invalidation.

### Conclusion

```
CAPABILITY AUTHORITY:
ROLE-PRESET-ONLY
```

The runtime authorization chain is:

request -> authenticate (JWT decode) -> request.ctx -> ctx.role (from JWT claim) -> presetAllows(ctx.role, permission) [static role->permission map] -> [optional] scoped resolver (exam/attempt DB lookup, org anchor check)

Neither user_role_assignments table nor assignment scope participates in any runtime decision. The users.role column is the authority.
## G. Scoped coverage gaps

### Flat capability routes that may require scope migration

| Route | Current Gate | Flat Gate Sufficient? | Risk |
|-------|-------------|---------------------:|------|
| GET /exams | requireCapability(ExamView) | Organization-scoped list query | Low |
| GET /exams/:id | requireCapability(ExamView) | **Flat gate insufficient** | **Medium** |
| POST /exams | requireCapability(ExamCreate) | Organization-scoped create | Low |
| PATCH /exams/:id | requireCapability(ExamUpdate) | **Flat gate insufficient** | **Medium** |
| POST /exams/:id/publish | requireCapability(ExamPublish) | **Flat gate insufficient** | **Medium** |
| POST /exams/:id/close | requireCapability(ExamClose) | **Flat gate insufficient** | **Medium** |
| POST /exams/:id/publish-results | requireCapability(ExamResultPublish) | **Flat gate insufficient** | **Medium** |
| GET /exams/:examId/enrollments | requireCapability(ExamEnrollmentManage) | **Flat gate insufficient** | **Medium** |
| POST /exams/:examId/enrollments | requireCapability(ExamEnrollmentManage) | **Flat gate insufficient** | **Medium** |
| DELETE /exams/:examId/enrollments/:enrollmentId | requireCapability(ExamEnrollmentManage) | **Flat gate insufficient** | **Medium** |
| GET /questions/:id | requireCapability(QuestionView) | **Flat gate insufficient** | **Medium** |
| PATCH /questions/:id | requireCapability(QuestionUpdate) | **Flat gate insufficient** | **Medium** |
| DELETE /questions/:id | requireCapability(QuestionDelete) | **Flat gate insufficient** | **Medium** |
| PATCH /courses/:id | requireCapability(CourseUpdate) | **Flat gate insufficient** | **Medium** |
| DELETE /courses/:id | requireCapability(CourseDelete) | **Flat gate insufficient** | **Medium** |
| POST /admin/attempts/:attemptId/misconduct | requireCapability(AttemptMisconductMark) | **Flat gate insufficient** | **Medium** |
| POST /admin/attempts/:attemptId/force-submit | requireCapability(AttemptForceSubmit) | **Flat gate insufficient** | **Medium** |
| POST /admin/attempts/:attemptId/extend-time | requireCapability(AttemptTimeExtend) | **Flat gate insufficient** | **Medium** |
| GET /admin/attempts/:attemptId/timeline | requireCapability(AttemptTimelineView) | **Flat gate insufficient** | **Medium** |
| GET /admin/attempts/:attemptId/export | requireCapability(AttemptExport) | **Flat gate insufficient** | **Medium** |
| GET /admin/attempts/:attemptId/export/csv | requireCapability(AttemptExport) | **Flat gate insufficient** | **Medium** |
| GET /exams/:id/scores | requireCapability(ScoreAllView) | **Flat gate insufficient** | **Medium** |

```
FLAT CAPABILITY ROUTES REQUIRING SCOPE MIGRATION:
~22 routes (single-resource with :id, not yet scoped-gated)
```

## H. Candidate own-scope status

```
CANDIDATE OWN-SCOPE:
LEGACY
```

The candidate runtime routes (10 routes in attempts.candidate.ts) all use requireRole(["Candidate"]) — the legacy role-string gate. There is NO capability-backed authorization, no scoped resolver, and no ownership proof beyond the handler-level defense-in-depth.

| Route | Gate | Ownership Proof |
|-------|------|----------------|
| GET /candidate/exams | requireRole(["Candidate"]) | Repo findByCandidate uses profile from actor |
| GET /candidate/exams/:examId | requireRole(["Candidate"]) | Handler-level enrollment check |
| POST /attempts/:examId/queue | requireRole(["Candidate"]) | Handler-level |
| POST /attempts/:examId/start | requireRole(["Candidate"]) | Handler-level enrollment check |
| GET /attempts/:id | requireRole(["Candidate"]) | Repo findByIdAndCandidate |
| GET /candidate/attempts/:attemptId/take | requireRole(["Candidate"]) | Repo findByIdAndCandidate |
| POST /attempts/:attemptId/answers/:questionId | requireRole(["Candidate"]) | Handler-level |
| POST /attempts/:attemptId/submit | requireRole(["Candidate"]) | Handler-level |
| POST /attempts/:attemptId/heartbeat | requireRole(["Candidate"]) | Handler-level |
| POST /attempts/:attemptId/restore | requireRole(["Candidate"]) | Handler-level |

The registry declares these as Scope.OwnAttempt with resolver: "attempt", but the runtime enforcement is still requireRole(["Candidate"]) + handler-level defense-in-depth.

## I. Proctor Corrective-2 gap

### Existing test coverage

| Route | Unit | Component | HTTP+DB | Cross-Org (Real) | Mutation-Killable |
|-------|:----:|:---------:|:-------:|:----------------:|:-----------------:|
| GET /admin/exams/:examId/proctor/attempts | NO | YES | YES | **NO** | **NO** |
| GET /admin/attempts/:attemptId/proctor-events | NO | YES | YES | **NO** (fake UUID -> 404) | **NO** |
| POST /admin/attempts/:attemptId/proctor-incident | NO | YES | YES | **NO** (fake UUID -> 404) | **NO** |

### Gap analysis

1. **No real cross-org integration test**: The existing "cross-org" test for proctor-events uses a fake UUID. It proves only that a nonexistent attempt returns 404 — it does NOT prove that a real Org B attempt is denied to an Org A Proctor.

2. **No real cross-org exam test**: GET /admin/exams/:examId/proctor/attempts has no cross-org test at all.

3. **No zero-write proof for POST**: The proctor-incident test does not verify that incident records, audit records, attempt state, and client events are unchanged when the request is denied.

4. **No resolver error test**: No test simulates a repository/DB error to prove 503 AUTHZ_UNAVAILABLE.

5. **No broken parent chain test**: No test creates an attempt with a missing/mismatched examId to prove the resolver fails closed.

6. **Mutation B not killable by existing tests**: Reverting requireScopedCapability to requireCapability on any of the three routes would not cause any existing test to fail.

7. **The permission matrix test uses fake IDs** (00000000-...) which don't exist, so the resolver returns resource_not_found -> 404. The "passed" verdict for Admin/Proctor is actually the 404 from the resolver, not from the handler — this is a tautological test.

## J. RBAC-M10-finish revised scope

```
GLOBAL SCOPED RBAC:
NOT CLOSED
```

The remaining work for RBAC-M10-finish:

1. **Corrective-2 (this task)**: 3 Proctor routes — add real cross-org HTTP+DB integration tests, Mutation B kill, runtime/registry conformance, broken chain, resolver error, zero-write proof.

2. **Candidate own-scope migration (10 routes)**: Flip requireRole(["Candidate"]) to capability-backed gates with own-attempt resolvers. High priority.

3. **Flat capability -> scoped capability (~22 routes)**: Add requireScopedCapability to all single-resource routes currently using requireCapability. Medium priority.

4. **Legacy requireRole -> requireCapability (44 routes)**: The remaining Admin-only routes. Lower risk (role gate is functionally equivalent to capability gate for Admin-only surfaces).

## K. Blocking uncertainties

```
[x] PR #186 merge baseline confirmed
[x] exact requireRole count confirmed (44)
[x] exact scoped route count confirmed (5)
[x] three Proctor routes confirmed in runtime
[ ] existing cross-org test gap reproduced
[ ] Mutation B expected behavior defined
[ ] Corrective-2 file scope fixed
```

## L. Recommended next jobs

1. **RBAC-SCOPED-AUTHORIZATION-CORRECTIVE-2** — Close the 3 Proctor route gaps with real cross-org HTTP+DB tests, Mutation B, runtime/registry conformance.
2. **RBAC-M10-A — Candidate own-attempt runtime** — Migrate 10 candidate routes to capability-backed scoped gates.
3. **RBAC-M10-B — Admin flat->scoped upgrade** — Migrate ~22 flat capability routes to scoped capability.
4. **RBAC-M10-C — Legacy role migration** — Migrate remaining 44 requireRole routes to requireCapability.

```
CORRECTIVE-2 SCOPE:
NOT READY — requires Phase B implementation
```
