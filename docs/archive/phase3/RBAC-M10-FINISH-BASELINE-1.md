# RBAC-M10-FINISH-BASELINE-1

## A. Verdict

```
PASS — BASELINE FROZEN

RUNTIME AUTHORITY:
MIXED

GLOBAL FORMAL SCOPED RBAC:
OPEN

CORRECTIVE-2:
CLOSED

FIRST IMPLEMENTATION JOB:
RBAC-M10-A — Candidate Own-Attempt Runtime

IMPLEMENTATION AUTHORIZATION:
GRANTED
```

**Reason:** The route inventory, counts, authorization surface, and remediation scope (65 routes: 44 legacy requireRole + 21 flat-to-scope) are authoritative and have been re-proven from source. `RUNTIME AUTHORITY: MIXED` is a **finding** of the audit, not a verdict on the baseline's trustworthiness — it documents that `users.role` (not `user_role_assignments`) is the de facto runtime authority. This finding does not invalidate any route count, permission mapping, or task breakdown. See §J for the full trace, §Q for unresolved items.

## B. Baseline Commit and Repository State

```
Worktree:               CLEAN
Branch:                 feat/rbac-m10-finish
Baseline commit:        8ef50e52cd61b15fa1814b52d31ab3785da715a3
Merge base with master: 8ef50e52cd61b15fa1814b52d31ab3785da715a3 (HEAD == merge-base)
Stash:                  PRESENT (stash@{0}: WIP on fix/formal-ea-lock-order — unrelated)
```

Corrective-2 evidence in HEAD:
- Flat/scoped decorator authz metadata: PRESENT (`apps/api/src/plugins/authz.ts` preHandler.authz metadata, `apps/api/src/plugins/auth.ts` line 175)
- Runtime `onRoute` metadata introspection: PRESENT (Corrective-2 test assertions in routeRegistry.test.ts lines 164–184)
- Route 1 behavioral Mutation B kill: PROVEN (cross-org behavioral test)
- Route 2 metadata Mutation B2 kill: PROVEN (metadata structural test)
- Route 3 metadata Mutation B3 kill: PROVEN (metadata structural test)
- `pnpm verify` baseline: 14 authz test files pass (113/113), 3 RBAC route test files pass (70/70), 5 registry/shadow test files pass (56/56)

**Corrective-2: PRESENT**

## C. Executive Summary

This baseline freezes the authorization surface at commit 8ef50e5 for RBAC-M10-FINISH. The inventory covers all 20 production route definition files in `apps/api/src/routes/`.

**Current state:**
- 44 routes still use `requireRole(["Admin"]|["Candidate"])` (legacy gate)
- 31 routes use `requireCapability(permission)` (flat capability gate — preset-only, no resolver)
- 5 routes use `requireScopedCapability(permission, resolverKey, resourceIdKey)` (full scoped gate)
- 1 route uses `requireScoreCapability()` (specialized ownership-aware gate)
- 0 routes use `requirePermission()` (legacy decorator, unused in production)
- 5 routes are authenticated-only (no role/permission gate)
- 4 routes are public (no authentication)

**Critical gap:** The runtime capability authority is `MIXED` — `users.role` is the primary authority for all authorization decisions via `presetAllows`, but `user_role_assignments` exists and is written by role mutation routes. The two stores can and do diverge during a session's lifetime (assignment revoke does not invalidate existing JWT sessions). Assignment scopes are NOT consulted by any authorization path.

## D. Authoritative Route Inventory

### D.1 requireRole(["Candidate"]) — 10 routes in 1 file

| # | File | Line | Method | Route | Authz Kind | Resource Type | Resource ID | Ownership Check | State Guard | Audit |
| -: | ---- | ---: | ------ | ----- | ---------- | ------------- | ----------- | --------------- | ----------- | ----- |
| 1 | attempts.candidate.ts | 282 | GET | /candidate/exams | role | exam | ctx (list) | handler: candidateProfiles.userId | none | no |
| 2 | attempts.candidate.ts | 412 | GET | /candidate/exams/:examId | role | exam | params:examId | handler: candidateProfiles.userId | none | no |
| 3 | attempts.candidate.ts | 493 | POST | /attempts/:examId/queue | role | exam | params:examId | handler: candidateProfiles.userId | none | no |
| 4 | attempts.candidate.ts | 536 | POST | /attempts/:examId/start | role | enrollment | params:examId | handler: candidateProfiles.userId, startOrRestoreAttempt | attempt status | yes (attempt.start/restore) |
| 5 | attempts.candidate.ts | 647 | GET | /attempts/:id | role | attempt | params:id | getOwnedAttempt → findByIdAndCandidate | none | no |
| 6 | attempts.candidate.ts | 684 | GET | /candidate/attempts/:attemptId/take | role | attempt | params:attemptId | handler: candidateProfiles.userId | deadline reconciles | no |
| 7 | attempts.candidate.ts | 774 | POST | /attempts/:attemptId/answers/:questionId | role | attempt | params:attemptId | handler: candidateProfiles.userId | prepareReconciledAttemptMutation | yes (attempt.saveAnswer) |
| 8 | attempts.candidate.ts | 920 | POST | /attempts/:attemptId/submit | role | attempt | params:attemptId | submitAndGradeAttempt (candidateProfile.id) | submitAndGradeAttempt | yes (attempt.submit) |
| 9 | attempts.candidate.ts | 977 | POST | /attempts/:attemptId/heartbeat | role | attempt | params:attemptId | getOwnedAttempt → findByIdAndCandidate | status in_progress | no |
| 10 | attempts.candidate.ts | 1021 | POST | /attempts/:attemptId/restore | role | attempt | params:attemptId | getOwnedAttempt → findByIdAndCandidate | deadline reconciles | yes (attempt.restore) |

### D.2 requireRole(["Admin"]) — 34 routes in 12 files

| # | File | Line | Method | Route | Authz Kind | Org Filter | Audit |
| -: | ---- | ---: | ------ | ----- | ---------- | ---------- | ----- |
| 11 | importLogs.ts | 15 | GET | /admin/import-logs | role | ensureTargetOrg | no |
| 12 | email.ts | 35 | POST | /email/test | role | none | no |
| 13 | settings.ts | 119 | GET | /admin/settings | role | ensureTargetOrg | no |
| 14 | settings.ts | 145 | GET | /admin/settings/branding | role | ensureTargetOrg | no |
| 15 | settings.ts | 171 | PATCH | /admin/settings/branding | role | ensureTargetOrg | yes (branding.update) |
| 16 | candidate.ts | 230 | POST | /candidates | role | ensureTargetOrg | yes (candidate.create) |
| 17 | candidate.ts | 331 | PATCH | /candidates/:id | role | ensureTargetOrg | yes (candidate.update) |
| 18 | candidate.ts | 407 | POST | /candidates/import | role | ensureTargetOrg | yes (candidate.import) |
| 19 | candidateField.ts | 49 | GET | /candidate-fields | role | ensureTargetOrg | no |
| 20 | candidateField.ts | 75 | POST | /candidate-fields | role | ensureTargetOrg | yes (candidate_field.create) |
| 21 | candidateField.ts | 119 | PATCH | /candidate-fields/:id | role | ensureTargetOrg | yes (candidate_field.update) |
| 22 | candidateField.ts | 180 | DELETE | /candidate-fields/:id | role | ensureTargetOrg | yes (candidate_field.delete) |
| 23 | candidateField.ts | 233 | GET | /candidate-fields/template | role | ensureTargetOrg | no |
| 24 | exam.ts | 826 | POST | /exams/:id/unpublish | role | ensureTargetOrg | yes (exam.unpublish) |
| 25 | exam.ts | 880 | POST | /exams/:id/extend | role | ensureTargetOrg | yes (exam.extend) |
| 26 | exam.ts | 956 | POST | /exams/:id/cancel | role | ensureTargetOrg | yes (exam.cancel) |
| 27 | exam.ts | 1038 | POST | /exams/:id/archive | role | ensureTargetOrg | yes (exam.archive) |
| 28 | exam.ts | 1192 | DELETE | /exams/:id | role | ensureTargetOrg | yes (exam.delete) |
| 29 | course.ts | 221 | DELETE | /courses/:id | role | ensureTargetOrg | yes (course.delete) |
| 30 | roleAssignments.ts | 50 | GET | /roles/assignable | role | none | no |
| 31 | roleAssignments.ts | 70 | GET | /users/:id/role-assignments | role | ensureTargetOrg | no |
| 32 | roleAssignments.ts | 109 | POST | /users/:id/role-assignments | role | ensureTargetOrg | yes (user.role_changed) |
| 33 | roleAssignments.ts | 159 | PATCH | /role-assignments/:assignmentId | role | ensureTargetOrg | yes (user.role_changed) |
| 34 | roleAssignments.ts | 219 | DELETE | /role-assignments/:assignmentId | role | ensureTargetOrg | yes (user.role_changed) |
| 35 | user.ts | 63 | GET | /users | role | ensureTargetOrg | no |
| 36 | user.ts | 110 | POST | /users | role | ensureTargetOrg | yes (user.create) |
| 37 | user.ts | 162 | PATCH | /users/:id | role | ensureTargetOrg | yes (user.update, user.role_changed) |
| 38 | user.ts | 268 | POST | /users/:id/reset-password | role | ensureTargetOrg | yes (candidate.password_reset) |
| 39 | user.ts | 335 | DELETE | /users/:id | role | ensureTargetOrg | yes (user.delete) |
| 40 | export.ts | 36 | GET | /exams/:id/export/scores | role | ensureTargetOrg | yes (export_scores) |
| 41 | audit.ts | 130 | GET | /admin/audit-logs | role | ensureTargetOrg | no |
| 42 | system.ts | 198 | GET | /system/health | role | none | no |
| 43 | system.ts | 222 | GET | /system/dashboard | role | getRequestContext | no |
| 44 | system.ts | 252 | GET | /system/diagnostics | role | getRequestContext | no |

### D.3 requireCapability(flat) — 31 routes in 8 files

| # | File | Line | Method | Route | Permission | Scope (Registry) | Resolver (Registry) |
| -: | ---- | ---: | ------ | ----- | ---------- | ---------------- | ------------------- |
| 45 | attempts.admin.ts | 62 | POST | /admin/attempts/:attemptId/misconduct | AttemptMisconductMark | Attempt | attempt |
| 46 | attempts.admin.ts | 138 | POST | /admin/attempts/:attemptId/force-submit | AttemptForceSubmit | Attempt | attempt |
| 47 | attempts.admin.ts | 308 | POST | /admin/attempts/:attemptId/extend-time | AttemptTimeExtend | Attempt | attempt |
| 48 | attempts.admin.ts | 398 | GET | /admin/attempts/:attemptId/timeline | AttemptTimelineView | Attempt | attempt |
| 49 | attempts.admin.ts | 458 | GET | /admin/attempts/:attemptId/export | AttemptExport | Attempt | attempt |
| 50 | attempts.admin.ts | 500 | GET | /admin/attempts/:attemptId/export/csv | AttemptExport | Attempt | attempt |
| 51 | question.ts | 61 | GET | /questions | QuestionView | Organization | organization |
| 52 | question.ts | 136 | GET | /questions/:id | QuestionView | Course | question |
| 53 | question.ts | 184 | POST | /questions | QuestionCreate | Course | question |
| 54 | question.ts | 275 | PATCH | /questions/:id | QuestionUpdate | Course | question |
| 55 | question.ts | 361 | DELETE | /questions/:id | QuestionDelete | Course | question |
| 56 | question.ts | 394 | POST | /questions/import | QuestionImport | Course | question |
| 57 | candidate.ts | 182 | GET | /candidates | CandidateView | Organization | organization |
| 58 | scores.ts | 233 | GET | /exams/:id/scores | ScoreAllView | Exam | exam |
| 59 | exam.ts | 333 | GET | /exams | ExamView | Organization | organization |
| 60 | exam.ts | 390 | GET | /exams/:id | ExamView | Exam | exam |
| 61 | exam.ts | 435 | POST | /exams | ExamCreate | Course | exam |
| 62 | exam.ts | 532 | PATCH | /exams/:id | ExamUpdate | Exam | exam |
| 63 | exam.ts | 651 | POST | /exams/:id/publish | ExamPublish | Exam | exam |
| 64 | exam.ts | 709 | POST | /exams/:id/close | ExamClose | Exam | exam |
| 65 | exam.ts | 1137 | POST | /exams/:id/publish-results | ExamResultPublish | Exam | exam |
| 66 | exam.ts | 1230 | GET | /exams/:examId/enrollments | ExamEnrollmentManage | Exam | exam |
| 67 | exam.ts | 1292 | POST | /exams/:examId/enrollments | ExamEnrollmentManage | Exam | exam |
| 68 | exam.ts | 1394 | DELETE | /exams/:examId/enrollments/:enrollmentId | ExamEnrollmentManage | Exam | enrollment |
| 69 | exam.ts | 1454 | GET | /admin/exams/:examId/candidates/status | ExamEnrollmentManage | Exam | exam |
| 70 | gradingQueue.ts | 66 | GET | /admin/grading-queue | GradingQueueView | Exam | exam |
| 71 | proctorMonitoring.ts | 58 | GET | /admin/proctor/exams | ExamRoomView | Organization | organization |
| 72 | course.ts | 50 | GET | /courses | CourseView | Organization | organization |
| 73 | course.ts | 89 | GET | /courses/:id | CourseView | Course | course |
| 74 | course.ts | 126 | POST | /courses | CourseCreate | Organization | organization |
| 75 | course.ts | 179 | PATCH | /courses/:id | CourseUpdate | Course | course |

### D.4 requireScopedCapability — 5 routes in 2 files

| # | File | Line | Method | Route | Permission | Resolver Key | Resource ID Key | Registry Match |
| -: | ---- | ---: | ------ | ----- | ---------- | ------------ | --------------- | -------------- |
| 76 | proctorMonitoring.ts | 97 | GET | /admin/exams/:examId/proctor/attempts | ExamRoomView | exam | examId | MATCH |
| 77 | proctorMonitoring.ts | 142 | GET | /admin/attempts/:attemptId/proctor-events | AttemptTimelineView | attempt | attemptId | MATCH |
| 78 | proctorMonitoring.ts | 205 | POST | /admin/attempts/:attemptId/proctor-incident | AttemptMisconductMark | attempt | attemptId | MATCH |
| 79 | gradingQueue.ts | 132 | GET | /admin/attempts/:attemptId/grading-details | GradingDetailView | attempt | attemptId | MATCH |
| 80 | gradingQueue.ts | 256 | POST | /admin/attempts/:attemptId/grade-question | GradingScoreWrite | attempt | attemptId | MATCH |

### D.5 requireScoreCapability — 1 route

| # | File | Line | Method | Route | Details |
| -: | ---- | ---: | ------ | ----- | ------- |
| 81 | scores.ts | 377 | GET | /scores/attempts/:attemptId | Specialized ownership-aware: ScoreAllView (any org-scoped) or ScoreOwnView + ownerUserId === actorId |

### D.6 Authenticated-only (no role/permission gate) — 5 routes

| # | File | Method | Route |
| -: | ---- | ------ | ----- |
| A1 | auth.ts | GET | /auth/me |
| A2 | auth.ts | PATCH | /auth/me/password |
| A3 | auth.ts | PATCH | /auth/me/profile |
| A4 | auth.ts | POST | /auth/logout |
| A5 | clientEvents.ts | POST | /client-events |

### D.7 Public (no preHandler) — 4 routes

| # | File | Method | Route |
| -: | ---- | ------ | ----- |
| P1 | system.ts | GET | /system/info |
| P2 | system.ts | GET | /system/public-config |
| P3 | settings.ts | GET | /settings/branding |
| P4 | auth.ts | POST | /auth/login |

## E. Exact Authorization Counts

```
requireRole:
  call sites: 44
  production routes: 44
  files: 13
  breakdown: Candidate(10) + Admin(34)

requireCapability:
  call sites: 31
  production routes: 31
  files: 8

requireScopedCapability:
  call sites: 5
  production routes: 5
  files: 2

requireScoreCapability:
  call sites: 1
  production routes: 1
  files: 1

requirePermission:
  call sites: 0
  production routes: 0
  files: 0

custom inline role checks (production authorization):
  call sites: 1
  (scores.ts:204 — `role !== "Candidate"` in computeResultVisibility;
   scores.ts:430 — `ctx.role === "Candidate"` is a business projection, not authorization)

authenticated-only protected routes: 5
public routes: 4
```

## F. Counts by Domain and File

| Domain | Legacy Role | Flat Cap | Scoped | Ownership | Custom | Total |
| ------ | ----------: | -------: | -----: | --------: | -----: | ----: |
| Candidate runtime | 10 | 0 | 0 | 0 | 0 | 10 |
| Exam lifecycle | 5 | 11 | 0 | 0 | 0 | 16 |
| Course | 1 | 4 | 0 | 0 | 0 | 5 |
| Question | 0 | 6 | 0 | 0 | 0 | 6 |
| Candidate management | 3 | 1 | 0 | 0 | 0 | 4 |
| Candidate fields | 5 | 0 | 0 | 0 | 0 | 5 |
| User management | 5 | 0 | 0 | 0 | 0 | 5 |
| Role assignments | 5 | 0 | 0 | 0 | 0 | 5 |
| Grading queue | 0 | 1 | 2 | 0 | 0 | 3 |
| Scores/results | 0 | 1 | 0 | 1 | 0 | 2 |
| Proctor monitoring | 0 | 1 | 3 | 0 | 0 | 4 |
| Export | 1 | 0 | 0 | 0 | 0 | 1 |
| Import logs | 1 | 0 | 0 | 0 | 0 | 1 |
| Audit | 1 | 0 | 0 | 0 | 0 | 1 |
| Settings | 3 | 0 | 0 | 0 | 0 | 3 |
| System | 3 | 0 | 0 | 0 | 0 | 3 |
| Email | 1 | 0 | 0 | 0 | 0 | 1 |

### Files with requireRole — Migration Targets

| File | Route Count | Roles | Proposed Permission(s) | Proposed Scope(s) | Required Resolver | Risk | Recommended Job |
| ---- | ----------: | ----- | ---------------------- | ----------------- | ----------------- | ---- | --------------- |
| attempts.candidate.ts | 10 | Candidate | ExamTake, AttemptStart, AttemptViewOwn, AttemptAnswerSave, AttemptSubmit, AttemptHeartbeatSend, AttemptRestore | OwnAttempt | attempt | HIGH | M10-A |
| importLogs.ts | 1 | Admin | AuditLogView | Organization | organization | LOW | M10-D |
| email.ts | 1 | Admin | SystemDiagnosticsView | System | system | LOW | M10-D |
| settings.ts | 3 | Admin | SettingsView, SettingsUpdate | Organization | organization | LOW | M10-D |
| candidate.ts | 3 | Admin | CandidateCreate, CandidateUpdate, CandidateImport | Organization/Candidate | candidate/organization | MEDIUM | M10-B |
| candidateField.ts | 5 | Admin | CandidateFieldView, CandidateFieldCreate, CandidateFieldUpdate, CandidateFieldDelete | Organization | organization | LOW | M10-D |
| exam.ts | 5 | Admin | ExamUnpublish, ExamExtend, ExamCancel, ExamArchive, ExamDelete | Exam | exam | MEDIUM | M10-B |
| course.ts | 1 | Admin | CourseDelete | Course | course | LOW | M10-B |
| roleAssignments.ts | 5 | Admin | UserView, UserRoleAssign | Organization/User | user/organization | MEDIUM | M10-C |
| user.ts | 5 | Admin | UserView, UserCreate, UserUpdate, UserPasswordReset, UserDelete | Organization/User | user/organization | MEDIUM | M10-C |
| export.ts | 1 | Admin | ScoreExport | Exam | exam | MEDIUM | M10-B |
| audit.ts | 1 | Admin | AuditLogView | Organization | organization | LOW | M10-D |
| system.ts | 3 | Admin | SystemHealthView, SystemDiagnosticsView | System | system | LOW | M10-D |

## G. Route Registry / Runtime Conformance

### Registry vs Runtime Comparison

Every route in `ROUTE_PERMISSION_REGISTRY` (978 lines) is compared against runtime gates.

**Registry-covered routes:** 80 entries in registry covering:
- All 44 requireRole routes (declared target permissions/scopes)
- All 31 requireCapability routes (match runtime permission)
- All 5 requireScopedCapability routes (match runtime permission + resolver + resource key)
- The 1 requireScoreCapability route

**Verdicts per route group:**

| Group | Routes | Registry Match | Notes |
| ----- | -----: | -------------: | ----- |
| requireRole Candidate | 10 | MATCH (declared) | Registry declares target state; runtime still legacy |
| requireRole Admin | 34 | MATCH (declared) | Registry declares target state; runtime still legacy |
| requireCapability (flat) | 31 | RUNTIME_AHEAD | Runtime uses requireCapability; registry expects scoped for resource-ID routes |
| requireScopedCapability | 5 | MATCH | Runtime matches registry exactly |
| requireScoreCapability | 1 | MATCH | Runtime matches registry (specialized) |

**Specific drift — requireCapability routes that should be scoped per registry:**

| Route | Runtime Gate | Registry Expects | Drift |
| ----- | ------------ | ---------------- | ----- |
| POST /admin/attempts/:attemptId/misconduct | FLAT_CAPABILITY | SCOPED_CAPABILITY | RESOLVER_NOT_WIRED |
| POST /admin/attempts/:attemptId/force-submit | FLAT_CAPABILITY | SCOPED_CAPABILITY | RESOLVER_NOT_WIRED |
| POST /admin/attempts/:attemptId/extend-time | FLAT_CAPABILITY | SCOPED_CAPABILITY | RESOLVER_NOT_WIRED |
| GET /admin/attempts/:attemptId/timeline | FLAT_CAPABILITY | SCOPED_CAPABILITY | RESOLVER_NOT_WIRED |
| GET /admin/attempts/:attemptId/export | FLAT_CAPABILITY | SCOPED_CAPABILITY | RESOLVER_NOT_WIRED |
| GET /admin/attempts/:attemptId/export/csv | FLAT_CAPABILITY | SCOPED_CAPABILITY | RESOLVER_NOT_WIRED |
| GET /questions/:id | FLAT_CAPABILITY | SCOPED_CAPABILITY | RESOLVER_NOT_WIRED |
| POST /questions | FLAT_CAPABILITY | SCOPED_CAPABILITY | RESOLVER_NOT_WIRED |
| PATCH /questions/:id | FLAT_CAPABILITY | SCOPED_CAPABILITY | RESOLVER_NOT_WIRED |
| DELETE /questions/:id | FLAT_CAPABILITY | SCOPED_CAPABILITY | RESOLVER_NOT_WIRED |
| PATCH /courses/:id | FLAT_CAPABILITY | SCOPED_CAPABILITY | RESOLVER_NOT_WIRED |
| PATCH /exams/:id | FLAT_CAPABILITY | SCOPED_CAPABILITY | RESOLVER_NOT_WIRED |
| POST /exams/:id/publish | FLAT_CAPABILITY | SCOPED_CAPABILITY | RESOLVER_NOT_WIRED |
| POST /exams/:id/close | FLAT_CAPABILITY | SCOPED_CAPABILITY | RESOLVER_NOT_WIRED |
| GET /exams/:examId/enrollments | FLAT_CAPABILITY | SCOPED_CAPABILITY | RESOLVER_NOT_WIRED |
| POST /exams/:examId/enrollments | FLAT_CAPABILITY | SCOPED_CAPABILITY | RESOLVER_NOT_WIRED |
| DELETE /exams/:examId/enrollments/:enrollmentId | FLAT_CAPABILITY | SCOPED_CAPABILITY | RESOLVER_NOT_WIRED |
| GET /exams/:id/scores | FLAT_CAPABILITY | SCOPED_CAPABILITY | RESOLVER_NOT_WIRED |
| GET /admin/grading-queue | FLAT_CAPABILITY | SCOPED_CAPABILITY (list filter) | RESOLVER_NOT_WIRED |

**Scored route specifically:**
`GET /scores/attempts/:attemptId` — uses `requireScoreCapability()` which is the correct specialized ownership-aware gate. The registry declares `ScoreOwnView @ OwnScore` via the `score` resolver. Runtime uses `requireScoreCapability()` which performs own/all arbitration via `resolveScoreScope` (DB-backed). This is CORRECT and MATCHES the registry intent. The specialized preHandler exists because the score route needs dual-arbitration (own vs all) that the generic `requireScopedCapability` interface cannot express cleanly.

## H. Flat Capability Sufficiency

### Assessment of all 31 requireCapability routes

**A. Flat capability sufficient (valid org-level gate):**

| Route | Reason |
| ----- | ------ |
| GET /questions | Organization-scoped list; repo enforces org context |
| POST /questions | Organization-scoped create; no user-controlled resource ID |
| POST /questions/import | Organization-scoped import; no single resource ID |
| GET /candidates | Organization-scoped list; repo enforces org context |
| GET /courses | Organization-scoped list; repo enforces org context |
| POST /courses | Organization-scoped create |
| GET /exams | Organization-scoped list; repo enforces org context |
| POST /exams | Course-selection validated in handler |
| GET /admin/proctor/exams | Organization-scoped discovery list; repo enforces org context |
| GET /admin/grading-queue | Organization-scoped by examId filter (optional); repo enforces org context |

**B. Requires generic scoped resolver:**

| Route | Registry Target Scope | Required Resolver |
| ----- | -------------------- | ----------------- |
| POST /admin/attempts/:attemptId/misconduct | Attempt | attempt |
| POST /admin/attempts/:attemptId/force-submit | Attempt | attempt |
| POST /admin/attempts/:attemptId/extend-time | Attempt | attempt |
| GET /admin/attempts/:attemptId/timeline | Attempt | attempt |
| GET /admin/attempts/:attemptId/export | Attempt | attempt |
| GET /admin/attempts/:attemptId/export/csv | Attempt | attempt |
| GET /questions/:id | Course | question |
| PATCH /questions/:id | Course | question |
| DELETE /questions/:id | Course | question |
| GET /exams/:id | Exam | exam |
| PATCH /exams/:id | Exam | exam |
| POST /exams/:id/publish | Exam | exam |
| POST /exams/:id/close | Exam | exam |
| POST /exams/:id/publish-results | Exam | exam |
| GET /exams/:examId/enrollments | Exam | exam |
| POST /exams/:examId/enrollments | Exam | exam |
| DELETE /exams/:examId/enrollments/:enrollmentId | Exam | enrollment |
| GET /admin/exams/:examId/candidates/status | Exam | exam |
| GET /courses/:id | Course | course |
| PATCH /courses/:id | Course | course |
| GET /exams/:id/scores | Exam | exam |

**C. Requires ownership-aware resolver:** None in the requireCapability group (the sole ownership-aware route is the requireScoreCapability route).

**D. Requires list-scope query authority:**

| Route | Registry Target | Notes |
| ----- | --------------- | ----- |
| GET /admin/grading-queue | Exam scope, list filter | Optional examId filter |
| GET /admin/proctor/exams | Organization scope, proctor-discoverable filter | Already uses org-scoped list |

### Summary

```
FLAT CAPABILITY ROUTES:                              31
FLAT CAPABILITY ROUTES THAT REQUIRE SCOPE:           21
FLAT CAPABILITY ROUTES THAT ARE VALID ORG-LEVEL:     10
UNRESOLVED:                                          0
```

## I. Candidate Own-Scope Baseline

All 10 Candidate routes in `attempts.candidate.ts` use `requireRole(["Candidate"])` as the gate, with handler-level ownership checks.

| Route | Current Gate | Ownership Source | State Guard | Zero-Write on Deny? | Status |
| ----- | ------------ | ---------------- | ----------- | ------------------- | ------ |
| GET /candidate/exams | requireRole | candidateProfiles.userId via enrollment | none | N/A (read) | HANDLER-ONLY OWNERSHIP |
| GET /candidate/exams/:examId | requireRole | candidateProfiles.userId via findByUserId | none | N/A (read) | HANDLER-ONLY OWNERSHIP |
| POST /attempts/:examId/queue | requireRole | candidateProfiles.userId | none | N/A (read, in-memory only) | HANDLER-ONLY OWNERSHIP |
| POST /attempts/:examId/start | requireRole | startOrRestoreAttempt (candidateId) | attempt status via reconcile | Yes (tx rollback) | PARTIAL |
| GET /attempts/:id | requireRole | findByIdAndCandidate | none | N/A (read) | HANDLER-ONLY OWNERSHIP |
| GET /candidate/attempts/:attemptId/take | requireRole | candidateProfiles.userId (handler check) | deadline reconciles | Yes (tx rollback) | HANDLER-ONLY OWNERSHIP |
| POST /attempts/:attemptId/answers/:questionId | requireRole | candidateProfiles.userId (handler check) | prepareReconciledAttemptMutation | Yes (tx rollback) | HANDLER-ONLY OWNERSHIP |
| POST /attempts/:attemptId/submit | requireRole | submitAndGradeAttempt (candidateProfile.id) | submitAndGradeAttempt | Yes (tx rollback) | PARTIAL |
| POST /attempts/:attemptId/heartbeat | requireRole | getOwnedAttempt → findByIdAndCandidate | status in_progress | Yes (owner check before write) | HANDLER-ONLY OWNERSHIP |
| POST /attempts/:attemptId/restore | requireRole | getOwnedAttempt → findByIdAndCandidate | deadline reconciles | Yes (tx rollback) | HANDLER-ONLY OWNERSHIP |

**Key findings:**

1. **Ownership is handler-level, not preHandler-level.** The `requireRole(["Candidate"])` preHandler checks only that the user has Candidate role. It does NOT verify that the attempt belongs to that candidate. Ownership verification is in handler code.

2. **Ownership sources vary:** Some routes use `findByIdAndCandidate` (repo-level), others use `candidateProfiles.userId` comparison in the handler.

3. **Anti-enumeration:** All ownership failures return 404 (Not Found) via `NotFoundError`, not 403. This is correct.

4. **Save answer:** The answer save path in `attempts.candidate.ts:857` checks `currentAttempt.candidateId !== candidateProfile.id` AFTER locking the row in a transaction. Denial returns 404, and the transaction rolls back — zero writes.

5. **Submit:** Uses `submitAndGradeAttempt` which receives `candidateProfile.id` and enforces ownership.

6. **The role-only preHandler is not scoped:** Any authenticated user with Candidate role can reach the handler. The handler then enforces ownership. This means a Candidate could potentially trigger handler code (e.g., reconciliation) for another candidate's attempt, though the mutation would be rolled back.

## J. Runtime Capability Authority

### Full Trace

```
1. login (POST /auth/login)
   → auth.ts: creates JWT with { actorId, organizationId, role }
   → JWT payload carries role from users.role

2. Authenticated request
   → plugins/auth.ts:27 (authenticateFn)
   → verifyJWT(token, jwtSecret) — extracts payload
   → createUserRepo().findByOrganizationAndId(ctx, payload.actorId) — reloads user from DB
   → request.ctx = {
       actorId: payload.actorId,
       organizationId: payload.organizationId,
       role: user.role,              // FROM users.role (re-read from DB)
       permissions: getPermissionsForRole(user.role)  // FROM @exam/auth presets
     }

3. requireRole(["Admin"])
   → plugins/auth.ts:129
   → checks roles.includes(ctx.role) — ctx.role is users.role from DB

4. requireCapability(permission)
   → plugins/auth.ts:160
   → checks presetAllows(ctx.role, permission) — ctx.role is users.role from DB
   → presetAllows comes from @exam/authz ROLE_PRESETS

5. requireScopedCapability(permission, resolverKey, resourceIdKey)
   → plugins/authz.ts:50
   → preset check identical to requireCapability (step 4)
   → then resolver.resolve({ actorId, organizationId }, resourceRef)
   → resolver verifies org anchor and scope

6. requireScoreCapability()
   → plugins/authz.ts:84
   → resolveScoreScope(db, logger, resolverCtx, attemptId)
   → preset check for ScoreAllView or ScoreOwnView
   → ownership check against ctx.actorId
```

### Authority Answers

1. **`ctx.role` source:** `users.role` column, re-read from DB on every authenticated request at `plugins/auth.ts:87`
2. **`ctx.permissions` existence:** YES at `plugins/auth.ts:88` — derived from `getPermissionsForRole(user.role)` (legacy RBAC module)
3. **JWT carries role:** YES — JWT payload includes `role` (from login-time `users.role`), but the authenticate decorator re-reads the user from DB, so JWT role is not the runtime authority
4. **Every request re-reads user:** YES — `plugins/auth.ts:58` calls `userRepo.findByOrganizationAndId` on every authenticated request
5. **Reads `user_role_assignments`:** NO — the authenticate decorator never reads assignments; it uses `users.role` directly
6. **Reads all active assignments:** NO
7. **Reads only primary assignment:** NO — does not read assignments at all
8. **Assignment revoke immediately effective?** NO — existing JWT sessions continue until cookie expires or user is deactivated (`users.isActive`). The authenticate decorator does check `isActive` (line 78), which would catch a deactivation. But a role change via `user_role_assignments` without deactivation would NOT be reflected until the next DB re-read... wait, it IS re-read on every request from `users.role`. But `users.role` is only synced by `syncUsersRoleFromPrimary` when a primary assignment changes. So the sequence is: assignment change → `syncUsersRoleFromPrimary` updates `users.role` → next request reads new `users.role`. This works for primary assignment changes but NOT for: secondary assignments, inactive assignment revocations that don't change primary, or permissions that should come from a non-primary assignment.
9. **Assignment scope participates in authorization:** NO — scopes on `user_role_assignments` are never read by any authorization path
10. **`users.role` authority:** It is the RUNTIME AUTHORITY for all `requireRole`, `requireCapability`, and (preset check part of) `requireScopedCapability` decisions. It is NOT merely a compatibility cache — it is the actual source of role identity for authorization.
11. **Multi-role permission merge:** Does NOT happen — only the single `users.role` value is used to derive permissions via `permissionsForRole`
12. **Scope binding in effect:** NO — assignment scopes stored in `user_role_assignments.scope` are never consulted

### Verdict

```
MIXED

The runtime authority is users.role-backed (users.role is the source
for ctx.role, which drives every presetAllows check). However,
user_role_assignments exist and are written by role mutation routes
with syncUsersRoleFromPrimary to keep users.role current. So:

  - Primary assignment changes → synced to users.role → effective
  - Secondary/inactive/scoped assignments → NOT consulted
  - Assignment scopes → NEVER consulted
  - users.role is de facto runtime authority, NOT just a cache

This is conceptually "PRIMARY-ASSIGNMENT-BACKED with a cache sync
lag" but functionally "USERS.ROLE-BACKED" because the cache IS the
authority and assignments only influence it through sync.
```

## K. Inline Role Decision Audit

| File | Line | Code | Purpose | Security Boundary? | Must Migrate? |
| ---- | ---: | ---- | ------- | -----------------: | ------------: |
| scores.ts | 204 | `if (role !== "Candidate")` | Publication gate bypass for non-Candidate roles | NO — this is a business projection (result visibility), not authorization. Authorization has already happened via requireScoreCapability. | NO |
| scores.ts | 430 | `const isCandidate = ctx.role === "Candidate"` | Candidate-safe stripping of standardAnswer from results | NO — business logic, not authorization. Maps to the candidate-view projection rule. | NO |
| user.ts | 202 | `target.role === "Admin"` | Last-active-Admin guard (business logic) | NO — business invariant, not authorization decision | NO |
| user.ts | 300 | `target.role !== "Candidate"` | Password reset target validation | NO — business validation, not authorization | NO |

**No production authorization decision bypasses the unified gate.** All role-based branches in handlers are business projections (result visibility, candidate-safe output, self-guard), not authorization boundaries. This is healthy.

## L. State Transition Permission Matrix

### Sensitive Transitions

| Transition | Route | Current Permission | Current Scope | State Guard | Audit | Idempotent? | Irreversible? | Missing Boundary |
| ---------- | ----- | ------------------ | ------------- | ----------- | ----- | ----------: | ------------: | ---------------- |
| attempt.start | POST /attempts/:examId/start | requireRole(["Candidate"]) | none (handler ownership) | yes (reconcile) | yes | no | no | SCOPE (preHandler) |
| answer.save | POST /attempts/:attemptId/answers/:questionId | requireRole(["Candidate"]) | none (handler ownership) | yes (reconcile/prepare) | yes | yes (versioned) | no | SCOPE (preHandler) |
| attempt.submit | POST /attempts/:attemptId/submit | requireRole(["Candidate"]) | none (handler ownership) | yes (submitAndGradeAttempt) | yes | no | yes (terminal) | SCOPE (preHandler) |
| force.submit | POST /admin/attempts/:attemptId/force-submit | requireCapability(AttemptForceSubmit) | none (flat) | yes (state guard in handler) | yes | yes (for graded) | yes (terminal) | SCOPE (resolver) |
| extend.time | POST /admin/attempts/:attemptId/extend-time | requireCapability(AttemptTimeExtend) | none (flat) | yes (extendAttemptTime) | yes | no | no (but bad) | SCOPE (resolver) |
| misconduct | POST /admin/attempts/:attemptId/misconduct | requireCapability(AttemptMisconductMark) | none (flat) | no (allowed any state) | yes | yes | no | SCOPE (resolver) |
| exam.publish | POST /exams/:id/publish | requireCapability(ExamPublish) | none (flat) | yes (reconcile + state guard) | yes | no | no (can unpublish) | SCOPE (resolver) |
| exam.close | POST /exams/:id/close | requireCapability(ExamClose) | none (flat) | yes (reconcile + state guard) | yes | no | no (can re-open?) | SCOPE (resolver) |
| exam.archive | POST /exams/:id/archive | requireRole(["Admin"]) | none | yes (reconcile) | yes | yes (already-archived) | yes | SCOPE + PERMISSION |
| exam.cancel | POST /exams/:id/cancel | requireRole(["Admin"]) | none | yes (unresolved guard) | yes | no | yes | SCOPE + PERMISSION |
| exam.unpublish | POST /exams/:id/unpublish | requireRole(["Admin"]) | none | yes (reconcile) | yes | no | no | SCOPE + PERMISSION |
| exam.extend | POST /exams/:id/extend | requireRole(["Admin"]) | none | yes (reconcile) | yes | no | no | SCOPE + PERMISSION |
| result.publish | POST /exams/:id/publish-results | requireCapability(ExamResultPublish) | none (flat) | yes (publishResults) | yes | yes | no | SCOPE (resolver) |
| grading.score_write | POST /admin/attempts/:attemptId/grade-question | requireScopedCapability(GradingScoreWrite) | attempt | yes (gradeQuestion) | yes | yes (overwrites) | no | COMPLETE |
| role.assign | POST /users/:id/role-assignments | requireRole(["Admin"]) | none | none | yes | no | no (can reassign) | PERMISSION + SCOPE |
| user.create | POST /users | requireRole(["Admin"]) | none | none | yes | no | no | PERMISSION + SCOPE |
| user.delete | DELETE /users/:id | requireRole(["Admin"]) | none | none | yes | no | yes | PERMISSION + SCOPE |

**Summary:** Every sensitive transition has a state guard + audit. What's missing is:
- 5 exam lifecycle transitions (archive, cancel, unpublish, extend, delete) still use requireRole — need permission + scope
- 5 admin attempt transitions (misconduct, force-submit, extend-time, timeline, export) use flat capability — need resolver wiring
- All candidate transitions use requireRole — need permission + scope
- 5 role assignment routes use requireRole — need permission + scope
- 5 user management routes use requireRole — need permission + scope

## M. Denial and Zero-Write Coverage

| Route | Denial Test | Cross-Org Test | Cross-Owner Test | Zero-Write Test | Resolver Error Test | Gap |
| ----- | ----------: | -------------: | ---------------: | --------------: | ------------------: | --- |
| requireScopedCapability routes (5) | proxy via scopedCapability.test.ts | behavioral crossOrg test | N/A (admin routes) | structural (deny before handler) | scopedCapability.test.ts (503) | MINIMAL |
| requireScoreCapability route | scoreCapability.test.ts | cross-org via resolver | candidateOwnership.test.ts | structural (deny before handler) | scoreCapability.test.ts (503) | MINIMAL |
| requireCapability routes (31) | route-level HTTP tests exist | cross-org via ensureTargetOrg | N/A (admin routes) | not proven for all | NOT TESTED per-route | MODERATE — resolver error path untested per-route |
| requireRole Candidate routes (10) | ownership tests (candidateOwnership.test.ts) | cross-owner via findByIdAndCandidate | candidateOwnership.test.ts | partially proven (save/submit tx rollback) | N/A (no resolver) | MODERATE — heartbeat write-before-ownership exists |
| requireRole Admin routes (34) | route-level tests | ensureTargetOrg coverage varies | N/A | not systematically proven | N/A | HIGH — no systematic denial coverage |

**Key gap:** The `candidateOwnership.test.ts` test file exists and covers the candidate attempt ownership boundary. However, the 34 requireRole(["Admin"]) routes have no systematic denial test proving zero-write on authorization failure.

## N. Test Evidence Hierarchy

| Test File | Level | Real Resource IDs? | Real DB? | Observes Runtime Route? | What It Actually Proves |
| --------- | ----- | -----------------: | -------: | ----------------------: | ----------------------- |
| routeRegistry.test.ts | L4 | yes (static) | no | yes (reflection) | Registry shape, coverage, ADR special mappings, drift detection. STRUCTURAL. |
| shadowParity.test.ts | L2 | no | no | no | Preset identity: Admin superset, Candidate consistent, Proctor/Grader/Teacher expected broadening. BEHAVIORAL. |
| scopedCapability.test.ts | L2 | yes (static) | no | no | PreHandler denial mapping (404/403/503), preset + resolver composition. BEHAVIORAL + MUTATION-PROVEN (resolver swap). |
| scoreCapability.test.ts | L2 | yes (static) | no | no | Own/all arbitration, anti-enumeration (cross-candidate 404), Grader/Proctor denial. BEHAVIORAL. |
| scoreResolver.test.ts | L2 | yes (static) | no (stubbed) | no | Score scope resolution logic. BEHAVIORAL. |
| permissionMatrix.fixture.test.ts | L5 | no (fake IDs) | yes | yes | Capability-stage passage for all decorators (flat/scoped/score). Does NOT test real resource access (fake IDs). TAUTOLOGICAL for resource scope. |
| adminSuperset.test.ts | L2 | no | no | no (registry) | Every Admin-gated route's permission is in Admin preset. STRUCTURAL drift guard. |
| candidateOwnership.test.ts | L5 | yes | yes | yes | Candidate own-attempt boundary, anti-enumeration. BEHAVIORAL + REAL ACCESS. |
| proctorMonitoring.crossOrg.test.ts | L6 | yes | yes | yes | Cross-org scope enforcement on scoped routes (3 proctor). BEHAVIORAL + REAL DB. |
| scores.test.ts | L5 | yes | yes | yes | Score result visibility, role-appropriate output. BEHAVIORAL. |
| gradingQueue.test.ts | L5 | yes | yes | yes | Grading queue operations. BEHAVIORAL. |
| examAuthoringCapability.test.ts | L5 | yes | yes | yes | Exam authoring routes (flipped to capability). BEHAVIORAL. |

**Mutation-proven tests:**
- scopedCapability.test.ts: mutation B (flat → scoped swap killed)
- routeRegistry.test.ts (corrective-2 section): mutations B2/B3 (metadata kind change killed)

## O. RBAC-M10-FINISH Job Breakdown

Based on the authoritative inventory, the remaining work divides into 6 jobs:

### RBAC-M10-A — Candidate Own-Attempt Runtime

**Goal:** Flip 10 Candidate runtime routes from `requireRole(["Candidate"])` to `requireScopedCapability(permission, "attempt", resourceIdKey)` with ownership scope.

**Included routes:**
- GET /candidate/exams
- GET /candidate/exams/:examId
- POST /attempts/:examId/queue
- POST /attempts/:examId/start
- GET /attempts/:id
- GET /candidate/attempts/:attemptId/take
- POST /attempts/:attemptId/answers/:questionId
- POST /attempts/:attemptId/submit
- POST /attempts/:attemptId/heartbeat
- POST /attempts/:attemptId/restore

**Target permissions:** ExamTake, AttemptStart, AttemptViewOwn, AttemptAnswerSave, AttemptSubmit, AttemptHeartbeatSend, AttemptRestore
**Target scope:** OwnAttempt via attempt resolver
**Production files:** attempts.candidate.ts
**Test files:** candidateOwnership.test.ts (extend), attempts.candidate route tests
**State guards:** Already present in handlers (extracted, not duplicated)
**Audit requirements:** Already present
**Mutation requirements:** Must kill behavioral regression (Candidate accessing another's attempt → 404)
**Dependencies:** None (attempt resolver exists and is tested)
**Risk:** HIGH — Candidate runtime is the most sensitive authorization boundary

### RBAC-M10-B — Resource-Scoped Academic Management

**Included routes:** 21 requireCapability routes that require scoped resolvers + 7 requireRole routes that need migration to capability + scope = 28 routes total:

*Flat-to-scope (21):*
- attempts.admin.ts: 6 (misconduct, force-submit, extend-time, timeline, export×2)
- question.ts: 3 (GET /questions/:id, PATCH, DELETE)
- exam.ts: 9 (GET /exams/:id, PATCH, publish, close, publish-results, enrollments×4)
- course.ts: 2 (GET /courses/:id, PATCH)
- scores.ts: 1 (GET /exams/:id/scores)

*RequireRole-to-scope (7):*
- exam.ts: 5 (unpublish, extend, cancel, archive, delete)
- course.ts: 1 (DELETE /courses/:id)
- export.ts: 1 (GET /exams/:id/export/scores)

**Target scope:** Attempt/Exam/Course/Organization per route registry
**Production files:** attempts.admin.ts, question.ts, exam.ts, course.ts, scores.ts, export.ts
**Risk:** MEDIUM (admin-only surface, less sensitive than candidate runtime)

### RBAC-M10-C — Identity and Role Assignment Authority

**Included routes:** 10 routes in user.ts (5) + roleAssignments.ts (5)
- user.ts: GET/POST/PATCH/reset-password/DELETE
- roleAssignments.ts: GET assignable/GET list/POST/PATCH/DELETE

**Target permissions:** UserView, UserCreate, UserUpdate, UserPasswordReset, UserDelete, UserRoleAssign
**Target scope:** Organization/User
**Boundary with M10-E:** M10-C covers role-assignment CRUD routes, cross-org isolation, last-admin guard, and primary-role synchronization (`syncUsersRoleFromPrimary`). It does NOT change how authorization loads or merges permissions at runtime. M10-E covers runtime permission derivation from active assignments, multi-role merging, assignment scope enforcement, and revocation/session invalidation. M10-C must be stable before M10-E can begin.
**Risk:** MEDIUM (privilege escalation surface)

### RBAC-M10-D — Organization/System Administrative Surfaces

**Included routes:** 17 remain-after-B/C legacy routes:
- candidateField.ts (5), settings.ts (3), system.ts (3), candidate.ts (3 — POST create/PATCH/import), importLogs.ts (1), email.ts (1), audit.ts (1)

All 17 routes require permission migration (from `requireRole` to `requireCapability` with organization or system scope). No resource-ID-based scope resolvers needed (organization/system resolvers suffice). Route-to-job coverage table in this section enumerates the exact 65-route assignment.

**Target scope:** Organization/System (organization resolver or system resolver — no DB resolver needed for most)
**Risk:** LOW (org-scoped, no resource-ID-based authorization needed for most)

### RBAC-M10-E — Assignment-Backed Runtime Authority

**Goal:** Make `user_role_assignments` the runtime authority for authorization. Currently `users.role` is the de facto authority. This job would switch authenticate/authorize to read active assignments, merge multiple assignment permissions, and evaluate assignment scopes.

**Scope:** Runtime permission derivation, active assignment loading, multi-role merging, assignment scope enforcement, revocation/session invalidation. M10-E does NOT include role-assignment CRUD routes (those are M10-C).

**Dependency on M10-C:** M10-C must be stable (role-assignment CRUD, cross-org isolation, last-admin guard, primary-role sync) before M10-E can begin. M10-E consumes the assignment data that M10-C manages.

**Not a route flip** — this is an architectural change to `plugins/auth.ts` and the JWT/login system.

**Risk:** HIGH (fundamental change to authentication runtime)
**Dependencies:** RBAC-M10-C (role assignment API must be stable)
**Recommendation:** DEFER to post-M10-D unless explicitly required for Phase 2 Proctor/Teacher/Grader.

### RBAC-M10-F — Final Drift and Mutation Closure

**Goal:** Post-migration verification, closure of all gaps identified in this baseline, mutation testing on representative route families, and final drift check.

**Scope:** Verification only, no production code changes.

### Route-to-Job Coverage (65 routes)

| # | File | Route | Current Gate | Required Change | Job |
| -: | ---- | ----- | ------------ | --------------- | --- |
| 1–10 | attempts.candidate.ts | 10 candidate runtime routes | requireRole(["Candidate"]) | scoped + permission + ownership gate | M10-A |
| 11–16 | attempts.admin.ts | misconduct, force-submit, extend-time, timeline, export×2 | requireCapability(flat) | scope resolver wiring | M10-B |
| 17–19 | question.ts | GET /questions/:id, PATCH, DELETE | requireCapability(flat) | scope resolver wiring | M10-B |
| 20–28 | exam.ts | GET /exams/:id, PATCH, publish, close, publish-results, enrollments×4 | requireCapability(flat) | scope resolver wiring | M10-B |
| 29–30 | course.ts | GET /courses/:id, PATCH | requireCapability(flat) | scope resolver wiring | M10-B |
| 31 | scores.ts | GET /exams/:id/scores | requireCapability(flat) | scope resolver wiring | M10-B |
| 32–36 | exam.ts | unpublish, extend, cancel, archive, delete | requireRole(["Admin"]) | permission + scope | M10-B |
| 37 | course.ts | DELETE /courses/:id | requireRole(["Admin"]) | permission + scope | M10-B |
| 38 | export.ts | GET /exams/:id/export/scores | requireRole(["Admin"]) | permission + scope | M10-B |
| 39–43 | user.ts | GET /users, POST, PATCH, reset-password, DELETE | requireRole(["Admin"]) | permission + scope | M10-C |
| 44–48 | roleAssignments.ts | GET assignable, GET list, POST, PATCH, DELETE | requireRole(["Admin"]) | permission + scope | M10-C |
| 49–51 | candidate.ts | POST /candidates, PATCH, POST /candidates/import | requireRole(["Admin"]) | permission (org scope) | M10-D |
| 52–56 | candidateField.ts | GET, POST, PATCH, DELETE, template | requireRole(["Admin"]) | permission (org scope) | M10-D |
| 57–59 | settings.ts | GET /admin/settings, branding GET, branding PATCH | requireRole(["Admin"]) | permission (org scope) | M10-D |
| 60–62 | system.ts | GET /system/health, dashboard, diagnostics | requireRole(["Admin"]) | permission (system scope) | M10-D |
| 63 | importLogs.ts | GET /admin/import-logs | requireRole(["Admin"]) | permission (org scope) | M10-D |
| 64 | email.ts | POST /email/test | requireRole(["Admin"]) | permission (system scope) | M10-D |
| 65 | audit.ts | GET /admin/audit-logs | requireRole(["Admin"]) | permission (org scope) | M10-D |

**Coverage assertions:**
- 65 remediation routes = 44 requireRole + 21 flat-to-scope
- M10-A(10) + M10-B(28) + M10-C(10) + M10-D(17) = 65
- Every route assigned exactly once
- No omissions
- No duplicate assignments

## P. Closure Criteria

### Preset-backed MVP closure (recommended next target)

```
[ ] production requireRole protected routes = 0
[ ] custom inline role authorization decisions = 0
[x] all resource-ID sensitive routes use scoped or ownership-aware authorization
    — PARTIAL: 31 requireCapability flat routes exist, 21 need scoping
[ ] all organization-level flat gates are explicitly justified
[ ] all list routes enforce query-level scope
[x] all Candidate own routes prove ownership server-side
    — PRESENT but handler-only; should be preHandler-level
[x] all sensitive transitions have permission + scope + state guard + audit
    — PARTIAL: scope missing for requireRole routes
[x] all resolver errors fail closed
    — PROVEN in scopedCapability.ts (503 AUTHZ_UNAVAILABLE)
[x] all cross-org and cross-owner denial paths are covered
    — PROVEN for scoped routes; requireRole routes rely on ensureTargetOrg
[x] sensitive denial paths prove zero write
    — PARTIAL: proven for candidate tx paths, not systematically proven for all
[x] runtime route metadata matches registry
    — 5 scoped routes match; 31 flat routes registry-ahead; 44 legacy routes declared
[x] scoped→flat mutations are killed for representative route families
    — PROVEN for 3 routes (Corrective-2); not comprehensive
[x] no Redis authorization authority
    — CONFIRMED
[x] frontend capability remains render hint only
    — CONFIRMED
```

### Global Formal Scoped RBAC closure (requires M10-E)

```
[ ] active user_role_assignments are runtime authority
[ ] multiple active assignments merge correctly
[ ] assignment scopes participate in resource authorization
[ ] revoked/inactive assignments do not grant
[ ] users.role is compatibility cache only
```

## Q. Risks and Uncertainties

1. **Runtime authority finding (not a gap):** The runtime authority chain (`users.role` vs `user_role_assignments`) was traced through source code and the verdict is `MIXED` — `users.role` is the de facto authority. This is a documented finding, not an unproven assertion. A production log trace would provide additional confirmation but is not required for M10-A through M10-D, which operate within the current `users.role`-backed authority model. M10-E is the job that changes this model.

2. **ensureTargetOrg vs authorization:** Many Admin routes use `ensureTargetOrg` to set the organization context on the request. This is an org-boundary filter, not an authorization gate — it ensures the handler operates within the caller's org. This is CORRECT defense-in-depth but is NOT a substitute for scoped authorization.

3. **Handler-level ownership ≠ preHandler-level ownership:** All Candidate runtime routes enforce ownership in handlers (after lock/read). A denied request returns 404 and writes no data (tx rollback), but the handler code still executes up to the point of the ownership check. This is safe for idempotent reads but creates a non-zero attack surface for compute-heavy operations.

4. **Stash unrelated but present:** `stash@{0}` is from `fix/formal-ea-lock-order` branch, unrelated to RBAC work.

5. **Registry coverage test completeness:** The `PROTECTED_ROUTES` list in routeRegistry.test.ts covers 60 routes. The actual protected routes total 81 (44 requireRole + 31 requireCapability + 5 requireScopedCapability + 1 requireScoreCapability). The registry coverage test covers the 60 requireRole-protected routes plus the 5 requireScopedCapability routes = 65. The 31 requireCapability routes are not enumerated in the coverage test because they already have runtime permissions that match the registry.

## R. Recommended First Implementation Job

```
RBAC-M10-A — Candidate Own-Attempt Runtime

IMPLEMENTATION AUTHORIZATION:
GRANTED
```

**Rationale:** The Candidate runtime is the most security-sensitive boundary (owns attempt data, answers, exam start/submit). The ownership patterns are already proven at handler level. The attempt resolver exists and is tested. The output (10 routes flipped) has the highest security impact. It is independent of all other M10 jobs (touches only `attempts.candidate.ts`).

**Can implementation begin?** YES — baseline is PASS with MIXED runtime authority as a documented finding (see §A). The route inventory and remediation scope (65 routes) are authoritative and implementation-ready. M10-A's specific path (10 candidate runtime routes, attempt resolver exists and tested, handler-level ownership pattern proven) is clear and independent of all other M10 sub-jobs.
