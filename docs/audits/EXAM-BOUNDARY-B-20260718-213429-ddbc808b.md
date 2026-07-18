# Exam Platform Parallel Boundary Audit — Agent B

## A. Identity

```
RUN_ID:       EXAM-BOUNDARY-B-20260718-213429-ddbc808b
AGENT_SLOT:   B
TIMESTAMP:    20260718-213429
BRANCH:       feat/exam-audit-0718
HEAD:         ddbc808b9c640584ece7690dd8aef681739081a5
SHORT_SHA:    ddbc808b
BASE/MAIN:    master
WORKTREE:     clean (no uncommitted changes)
AUDIT SCOPE:  AUTHORIZATION / RESOURCE RELATIONSHIPS / UI/API CONSISTENCY / E2E / UNSUPPORTED-FEATURE CONTAINMENT
```

### Repository baseline

```
REPOSITORY:       git@github.com:jnhu76/exam.git
TEST FRAMEWORK:   vitest (unit/integration), Playwright 1.61.0 (E2E)
E2E FRAMEWORK:    Playwright, Chromium only, serial per-file, 2 shards
DB TEST STRATEGY: worker-database isolation (exam_test), per-test truncate
RECENT PRS:       #190 RBAC-M10-B Single-Tenant Corrective, #189 fix/rbac-m10-a-review-corrective-1
```

---

## B. Verdict

```
SUPPORTED WITH BLOCKERS
```

The authorization architecture is well-designed with capability-based gates, scoped resolvers for attempt/exam, and strong anti-enumeration for Candidate ownership. Three significant issues block clean closure: (1) a Proctor UI button that always 403s, (2) org-wide resource access for Teacher/Proctor/Grader roles with no scoped assignment infrastructure, and (3) a dead proctor-incident endpoint. E2E coverage is strong for the core journey.

---

## C. Executive boundary map

### PROVEN SUPPORTED
- Authentication (JWT cookie, login/logout/me)
- Admin full management (users, candidates, courses, questions, exams, roles, settings, system)
- Candidate runtime authz (requireExamEligibility + requireOwnAttempt with anti-enumeration)
- Candidate attempt ownership: user → candidateProfile → enrollment → attempt → answer (full chain verified)
- Capability-based route gating (requireCapability) across courses, questions, exams, scores, exports, admin attempts, grading
- Proctor monitoring read-only (exam list, attempt status, timeline via requireScopedCapability)
- Force-submit, extend-time, misconduct-mark (admin/proctor runtime)
- Grading queue, grading detail, scoring (admin/grader)
- Result visibility modes (immediate/after_grading/manual)
- E2E: admin-flow, candidate-happy-path, resume, submit-flush, refresh-during-exam, deadline-crash, disconnect-restore, double-click-start, save-submit-race, result-publishing, manual-grading, multi-select, demo-seed-accounts, audit-log, proctor-runtime, proctor-monitoring-ui, proctor-landing
- Unauthenticated routes: login, public branding, system info, health

### PARTIALLY SUPPORTED
- Teacher as a Phase 1 role — has usable pages (exam list/create/edit, course/question CRUD, results) BUT has org-wide resource access (no Teacher→course scoping)
- Proctor as a Phase 1 role — has monitoring pages BUT "Proctor Dashboard" button on ExamDetailPage always 403s because Proctor lacks `ExamEnrollmentManage`
- Grader as a Phase 1 role — has grading queue and detail pages BUT no Grader-specific sidebar label or branding

### NOT SUPPORTED
- Teacher→course scoped assignment (no course_assignments table, no teacherId on courses)
- Proctor→exam scoped assignment (no exam_assignments table, no proctorId on exams)
- Grader→attempt scoped assignment (no graderId on attempts or grading entries)
- Organization-level role assignment UI beyond Admin (no multi-tenant)
- SuperAdmin product path (deferred to Phase 4)
- Organization slug login (deferred to Phase 4)
- Tenant switcher (deferred to Phase 4)
- Email invitation and password reset (deferred to Phase 3)
- Anonymous grading (no identity-hiding during grading)
- Multi-grader workflow (single-grader assumption)
- Full custom role management UI

### PRODUCT DECISION REQUIRED
- Whether Teacher, Proctor, Grader should have org-wide access (Phase 1 expediency) or require scoped assignment (Phase 3)
- Whether the Proctor Dashboard 403 is a bug (fix the endpoint gate) or a feature (remove the UI button)

### BLOCKED
- Proctor Dashboard API endpoint (`GET /admin/exams/:id/candidates/status`) — blocked by missing `ExamEnrollmentManage` from Proctor preset
- `POST /admin/attempts/:attemptId/proctor-incident` — dead route, never called by UI

---

## D. Route and Role Inventory — Complete

### Auth routes (`/api/auth`)
| Method | Path | preHandler | AuthZ | State guard | Status |
|---|---|---|---|---|---|
| POST | /register | None | None (always 403) | None | **COMPLETE** |
| POST | /login | None | None (public) | Rate-limited 10/60s | **COMPLETE** |
| POST | /logout | None | None (public) | None | **COMPLETE** |
| GET | /me | authenticate | None (via ctx) | None | **COMPLETE** |
| PATCH | /me/password | authenticate | None (via ctx) | None | **COMPLETE** |
| PATCH | /me/profile | authenticate | None (via ctx) | None | **COMPLETE** |

### Management routes (Admin-only via requireRole(["Admin"]))
| Method | Path | Capability | Resource scope | State guard | Status |
|---|---|---|---|---|---|
| GET | /admin/settings | requireRole(["Admin"]) (LEGACY) | None | None | **LEGACY-ROLE-ONLY** |
| GET/PATCH | /admin/settings/branding | requireRole(["Admin"]) (LEGACY) | None | None | **LEGACY-ROLE-ONLY** |
| GET/POST/PATCH/DELETE | /candidate-fields[/:id] | requireRole(["Admin"]) (LEGACY) | None | None | **LEGACY-ROLE-ONLY** |
| GET/POST | /users[/:id] | requireRole(["Admin"]) (LEGACY) | None | None | **LEGACY-ROLE-ONLY** |
| PATCH/DELETE | /users/:id | requireRole(["Admin"]) (LEGACY) | None | None | **LEGACY-ROLE-ONLY** |
| POST | /users/:id/reset-password | requireRole(["Admin"]) (LEGACY) | None | None | **LEGACY-ROLE-ONLY** |
| GET/POST/PATCH/DELETE | /roles, /users/:id/role-assignments | requireRole(["Admin"]) (LEGACY) | None | None | **LEGACY-ROLE-ONLY** |
| POST | /candidates[/:id] | requireRole(["Admin"]) (LEGACY) | None | None | **LEGACY-ROLE-ONLY** |
| POST | /candidates/import | requireRole(["Admin"]) (LEGACY) | None | Rate-limited 10/60s | **LEGACY-ROLE-ONLY** |
| GET | /candidates | requireCapability(CandidateView) | None | None | **CAPABILITY-ONLY** |
| PATCH | /candidates/:id | requireRole(["Admin"]) (LEGACY) | None | None | **LEGACY-ROLE-ONLY** |

### Course routes
| Method | Path | Capability | Resource scope | State guard | Status |
|---|---|---|---|---|---|
| GET | /courses | CourseView | None (org-wide) | None | **CAPABILITY-ONLY** |
| GET | /courses/:id | CourseView | None (org-wide) | None | **CAPABILITY-ONLY** |
| POST | /courses | CourseCreate | None (org-wide) | None | **CAPABILITY-ONLY** |
| PATCH | /courses/:id | CourseUpdate | None (org-wide) | None | **CAPABILITY-ONLY** |
| DELETE | /courses/:id | CourseDelete | None (org-wide) | must have no questions | **CAPABILITY-ONLY** |

### Question routes
| Method | Path | Capability | Resource scope | State guard | Status |
|---|---|---|---|---|---|
| GET | /questions | QuestionView | None (org-wide) | None | **CAPABILITY-ONLY** |
| GET | /questions/:id | QuestionView | None (org-wide) | None | **CAPABILITY-ONLY** |
| POST | /questions | QuestionCreate | None (org-wide) | Validates courseId | **CAPABILITY-ONLY** |
| PATCH | /questions/:id | QuestionUpdate | None (org-wide) | None | **CAPABILITY-ONLY** |
| DELETE | /questions/:id | QuestionDelete | None (org-wide) | None | **CAPABILITY-ONLY** |
| POST | /questions/import | QuestionImport | None (org-wide) | Rate-limited 5/60s | **CAPABILITY-ONLY** |

### Exam routes (Admin/Teacher)
| Method | Path | Capability | Resource scope | State guard | Status |
|---|---|---|---|---|---|
| GET | /exams | ExamView | None (org-wide) | None | **CAPABILITY-ONLY** |
| GET | /exams/:id | ExamView | None (org-wide) | None (reconcile applied) | **CAPABILITY-ONLY** |
| POST | /exams | ExamCreate | None (org-wide) | Validates courseId, questionIds | **CAPABILITY-ONLY** |
| PATCH | /exams/:id | ExamUpdate | None (org-wide) | draft=full, published=schedule only | **CAPABILITY-ONLY** |
| POST | /exams/:id/publish | ExamPublish | None (org-wide) | 12 publish guards | **CAPABILITY-ONLY** |
| POST | /exams/:id/unpublish | ExamUnpublish | None (org-wide) | Reconciled status must be published | **CAPABILITY-ONLY** |
| POST | /exams/:id/close | ExamClose | None (org-wide) | Unresolved attempts=0 | **CAPABILITY-ONLY** |
| POST | /exams/:id/extend | ExamExtend | None (org-wide) | Must be open; reconcile | **CAPABILITY-ONLY** |
| POST | /exams/:id/cancel | ExamCancel | None (org-wide) | Unresolved attempts=0 | **CAPABILITY-ONLY** |
| POST | /exams/:id/archive | ExamArchive | None (org-wide) | Must be closed/canceled | **CAPABILITY-ONLY** |
| POST | /exams/:id/publish-results | ExamResultPublish | None (org-wide) | Status in {published,open,closed} | **CAPABILITY-ONLY** |
| DELETE | /exams/:id | ExamDelete | None (org-wide) | Must be draft | **CAPABILITY-ONLY** |
| GET/POST/DELETE | /exams/:examId/enrollments | ExamEnrollmentManage | None (org-wide) | None | **CAPABILITY-ONLY** |

### Candidate exam routes (anti-enumeration applied)
| Method | Path | Capability | Resource scope | State guard | Status |
|---|---|---|---|---|---|
| GET | /candidate/exams | ExamTake | Own candidate profile | None | **COMPLETE** |
| GET | /candidate/exams/:examId | ExamTake | Own enrollment (404 if not) | Eligibility check | **COMPLETE** |
| POST | /attempts/:examId/queue | AttemptStart | Own enrollment (404 if not) | None (Phase 2) | **COMPLETE** |
| POST | /attempts/:examId/start | AttemptStart | Own enrollment (404 if not) | Exam open, retake policy, etc. | **COMPLETE** |
| GET | /attempts/:id | AttemptViewOwn | Own attempt (404 if not) | None | **COMPLETE** |
| GET | /candidate/attempts/:attemptId/take | AttemptViewOwn | Own attempt (404 if not) | None | **COMPLETE** |
| POST | /attempts/:attemptId/answers/:questionId | AttemptAnswerSave | Own attempt (404 if not) | Status guard (submitted→reject) | **COMPLETE** |
| POST | /attempts/:attemptId/submit | AttemptSubmit | Own attempt (404 if not) | Min duration, deadline | **COMPLETE** |
| POST | /attempts/:attemptId/heartbeat | AttemptHeartbeatSend | Own attempt (404 if not) | Status guard | **COMPLETE** |
| POST | /attempts/:attemptId/restore | AttemptRestore | Own attempt (404 if not) | Disrupted only | **COMPLETE** |

### Admin attempt routes
| Method | Path | Capability | Resource scope | State guard | Status |
|---|---|---|---|---|---|
| POST | /admin/attempts/:attemptId/misconduct | AttemptMisconductMark | None (org-wide) | Any status accepted | **CAPABILITY-ONLY** |
| POST | /admin/attempts/:attemptId/force-submit | AttemptForceSubmit | None (org-wide) | Must be in_progress/disrupted | **CAPABILITY-ONLY** |
| POST | /admin/attempts/:attemptId/extend-time | AttemptTimeExtend | None (org-wide) | Must be in_progress/disrupted | **CAPABILITY-ONLY** |
| GET | /admin/attempts/:attemptId/timeline | AttemptTimelineView | None (org-wide) | None | **CAPABILITY-ONLY** |
| GET | /admin/attempts/:attemptId/export[/csv] | AttemptExport | None (org-wide) | None | **CAPABILITY-ONLY** |

### Grading routes
| Method | Path | Capability | Resource scope | State guard | Status |
|---|---|---|---|---|---|
| GET | /admin/grading-queue | GradingQueueView | None (org-wide) | Filters pending_manual only | **CAPABILITY-ONLY** |
| GET | /admin/attempts/:attemptId/grading-details | GradingDetailView | attempt (scoped: attempt→exam→course→org) | None | **COMPLETE** |
| POST | /admin/attempts/:attemptId/grade-question | GradingScoreWrite | attempt (scoped) | Must be pending_manual | **COMPLETE** |

### Scores/Export
| Method | Path | Capability | Resource scope | State guard | Status |
|---|---|---|---|---|---|
| GET | /exams/:id/scores | ScoreAllView | None (org-wide) | Rejects canceled/unresolved | **CAPABILITY-ONLY** |
| GET | /scores/attempts/:attemptId | ScoreAllView / ScoreOwnView | Own attempt (candidate) or org-wide (admin) | P2D-J5a visibility logic | **COMPLETE** |
| GET | /exams/:id/export/scores | ScoreExport | None (org-wide) | None | **CAPABILITY-ONLY** |

### Proctor routes
| Method | Path | Capability | Resource scope | State guard | Status |
|---|---|---|---|---|---|
| GET | /admin/proctor/exams | ExamRoomView | None (org-wide) | Filters open exams | **CAPABILITY-ONLY** |
| GET | /admin/exams/:examId/proctor/attempts | ExamRoomView | exam (scoped) | Filters active attempts | **COMPLETE** |
| GET | /admin/attempts/:attemptId/proctor-events | AttemptTimelineView | attempt (scoped) | None | **COMPLETE** |
| POST | /admin/attempts/:attemptId/proctor-incident | AttemptMisconductMark | attempt (scoped) | Any status | **DEAD ROUTE** |
| GET | /admin/exams/:examId/candidates/status | ExamEnrollmentManage | None (org-wide) | None | **UI 403 HOLE** |

### System
| Method | Path | preHandler | Status |
|---|---|---|---|
| GET | /system/info | None (public) | **COMPLETE** |
| GET | /system/public-config | None (public) | **COMPLETE** |
| GET | /system/health | requireRole(["Admin"]) | **LEGACY-ROLE-ONLY** |
| GET | /system/dashboard | requireRole(["Admin"]) | **LEGACY-ROLE-ONLY** |
| GET | /system/diagnostics | requireRole(["Admin"]) | **LEGACY-ROLE-ONLY** |
| GET | /admin/audit-logs | requireRole(["Admin"]) | **LEGACY-ROLE-ONLY** |
| GET | /admin/import-logs | requireRole(["Admin"]) | **LEGACY-ROLE-ONLY** |
| POST | /email/test | requireRole(["Admin"]) | **LEGACY-ROLE-ONLY** |
| POST | /client-events | authenticate only | **COMPLETE** |

---

## E. Role-Boundary Matrix

| Route family | Unauthenticated | Admin | Teacher | Proctor | Grader | Candidate |
|---|---|---|---|---|---|---|
| Auth (login) | 2xx | 2xx | 2xx | 2xx | 2xx | 2xx |
| Auth (register) | 403 | — | — | — | — | — |
| Settings | — | 2xx | 403 | 403 | 403 | 403 |
| CandidateFields | — | 2xx | 403 | 403 | 403 | 403 |
| Users | — | 2xx | 403 | 403 | 403 | 403 |
| RoleAssignments | — | 2xx | 403 | 403 | 403 | 403 |
| Candidates (list) | — | 2xx | 2xx (org-wide) | 403 | 403 | 403 |
| Candidates (write) | — | 2xx | 403 | 403 | 403 | 403 |
| Courses | — | 2xx | 2xx (org-wide) | 403 | 403 | 403 |
| Questions | — | 2xx | 2xx (org-wide) | 403 | 403 | 403 |
| Exams (read) | — | 2xx | 2xx (org-wide) | 403 | 403 | 403 |
| Exams (create/update) | — | 2xx | 2xx (org-wide) | 403 | 403 | 403 |
| Exams (publish/close) | — | 2xx | 2xx (org-wide) | 403 | 403 | 403 |
| Exams (unpublish/extend/cancel/delete) | — | 2xx | 403 | 403 | 403 | 403 |
| Exam enrollments | — | 2xx | 2xx (org-wide) | 403 | 403 | 403 |
| Publish results | — | 2xx | 2xx (org-wide) | 403 | 403 | 403 |
| Candidate/exams | — | 403 | 403 | 403 | 403 | 2xx (own) |
| Attempt start/answer/submit | — | 403 | 403 | 403 | 403 | 2xx (own attempt) |
| Admin attempt (misconduct/force/extend) | — | 2xx | 403 | 2xx (via perm) | 403 | 403 |
| Admin attempt (export) | — | 2xx | 403 | 403 | 403 | 403 |
| Proctor monitoring (exams) | — | 2xx | 403 | 2xx (org-wide) | 403 | 403 |
| Proctor monitoring (attempts) | — | 2xx | 403 | 2xx (scoped) | 403 | 403 |
| Proctor dashboard (candidates/status) | — | 2xx | 403 | **403** | 403 | 403 |
| Grading queue | — | 2xx | 403 | 403 | 2xx (org-wide) | 403 |
| Grading detail | — | 2xx | 403 | 403 | 2xx (scoped) | 403 |
| Grade question | — | 2xx | 403 | 403 | 2xx (scoped) | 403 |
| Scores (exam) | — | 2xx | 2xx (org-wide) | 403 | 403 | 403 |
| Scores (attempt) | — | 2xx | 2xx | 403 | 403 | 2xx (own) |
| Export scores | — | 2xx | 403 | 403 | 403 | 403 |
| System health/dashboard/diagnostics | — | 2xx | 403 | 403 | 403 | 403 |
| Audit logs | — | 2xx | 403 | 403 | 403 | 403 |
| Client events | — | 2xx | 2xx | 2xx | 2xx | 2xx |

---

## F. Findings

### P0 Findings

None identified. The Candidate ownership chain has no authorization bypass. All candidate routes enforce anti-enumeration (404 for cross-candidate probes). The attempt state machine prevents unauthorized submissions.

### P1 Findings

#### P1-1: Proctor Dashboard 403 Hole (UI implies functionality, API rejects)
**SEVERITY**: P1
**TITLE**: Proctor "Proctor" button on ExamDetailPage always 403s
**PRODUCT IMPACT**: Proctor logged into the system clicks the "Proctor" button on ExamDetailPage → lands on ProctorDashboardPage → API call to `GET /api/admin/exams/:id/candidates/status` returns 403. The page shows an error state. Proctor cannot use the advertised feature.
**PRECONDITION**: User with Proctor role navigates to `/admin/exams/:id`
**REPRODUCTION**: 
1. Log in as Proctor
2. Navigate to any open exam detail page
3. Click the "Proctor" button
4. Observe the page loads but API returns 403
**EXPECTED**: Either the button should be hidden (matching actual API gate), or the API gate should admit Proctor (matching UI permission).
**ACTUAL**: Button shown (UI gate: `maySeeProctor` checks `ExamRoomView` which Proctor has). API rejects (backend gate: `requireCapability(Permission.ExamEnrollmentManage)` which Proctor lacks).
**SOURCE EVIDENCE**: 
- `ExamDetailPage.tsx:455-461` — `maySeeProctor` gate uses `Permission.ExamRoomView`
- `exam.ts:1469` — route handler uses `requireCapability(Permission.ExamEnrollmentManage)`
- `presets.ts` — Proctor preset includes `ExamRoomView` but NOT `ExamEnrollmentManage`
**TEST/BROWSER EVIDENCE**: Proctor-landing E2E spec tests Proctor workspace; does NOT test ExamDetailPage navigation path
**CONFIDENCE**: HIGH — source-proven
**RECOMMENDED DISPOSITION**: Either (a) re-gate the API endpoint to `ExamRoomView` (matching UI assumption), or (b) remove the button from ExamDetailPage for Proctor role (fix UI to match backend).

#### P1-2: Teacher/Proctor/Grader Org-Wide Resource Access
**SEVERITY**: P1
**TITLE**: Teacher, Proctor, Grader have unrestricted organization-wide access to all resources of their domain
**PRODUCT IMPACT**: A Teacher can view/edit ALL courses and exams in the organization. A Proctor can monitor ALL exams. A Grader can grade ALL attempts. No scoping infrastructure exists.
**PRECONDITION**: User has Teacher/Proctor/Grader role assigned at organization level
**REPRODUCTION**: 
1. Teacher A creates Course 1
2. Teacher B logs in and can view/edit Course 1 even though never assigned to it
**EXPECTED**: Scoped access: Teacher@course1 should not see Teacher@course2's exams (per ADR intent)
**ACTUAL**: All courses/exams visible to any Teacher in the org
**SOURCE EVIDENCE**: 
- No `teacherId`/`proctorId`/`graderId` column on any table
- `user_role_assignments` has no `resourceId`/`resourceType` columns
- `presets.ts` line 5-7: "scoped assignment narrows them per resource at assignment time (RBAC-M8), not here" — documents future intent
**TEST/BROWSER EVIDENCE**: All API tests use `requireCapability()` with flat permission checks; no scoped resolver for Teacher→course exists
**CONFIDENCE**: HIGH — source-proven
**RECOMMENDED DISPOSITION**: This is a known architectural gap documented in ADR and presets. Requires product decision: (a) accept org-wide access as Phase 1/2 expediency, or (b) implement resource-assignment infrastructure (Phase 3/4).

#### P1-3: Duplicate Misconduct Endpoint (Dead Route)
**SEVERITY**: P1
**TITLE**: `POST /admin/attempts/:attemptId/proctor-incident` is never called by the UI
**PRODUCT IMPACT**: A complete API route exists for recording proctor incident observations with scoped capability gating, but the UI never calls it. The UI calls `POST /admin/attempts/:attemptId/misconduct` instead, which uses a different route with different authorization (flat requireCapability, no scoping). The dead route represents unreachable functionality and potential maintenance confusion.
**PRECONDITION**: URL is directly accessible
**REPRODUCTION**: 
1. Check all frontend API call code for `/proctor-incident` — none found
2. Check all frontend API call code for `/misconduct` — found in ProctorDashboardPage.tsx:189
**EXPECTED**: Either one endpoint should serve both admin and proctor misconduct recording, or each should be explicitly wired
**ACTUAL**: Two routes, same semantic purpose, one dead
**SOURCE EVIDENCE**: 
- `proctorMonitoring.ts:200` — POST /admin/attempts/:attemptId/proctor-incident (requireScopedCapability)
- `attempts.admin.ts:117` — POST /admin/attempts/:attemptId/misconduct (requireCapability)
- `ProctorDashboardPage.tsx:189` — calls `/misconduct` not `/proctor-incident`
**CONFIDENCE**: HIGH — source-proven
**RECOMMENDED DISPOSITION**: Remove the dead route or wire the UI to use it.

### P2 Findings

#### P2-1: `requireRole(["Admin"])` Legacy Gates on 5 Route Families
**SEVERITY**: P2
**TITLE**: Settings, candidate creation, users, role assignments, system diagnostics still use legacy `requireRole(["Admin"])` instead of capability gates
**PRODUCT IMPACT**: These routes cannot be delegated to Teacher/Proctor/Grader through capability assignment. Inconsistent with the rest of the codebase which uses `requireCapability()`.
**SOURCE EVIDENCE**: `requireRole(["Admin"])` decorator on settings.ts, candidateField.ts, user.ts, roleAssignments.ts, system.ts routes
**CONFIDENCE**: HIGH
**RECOMMENDED DISPOSITION**: Migrate to `requireCapability()` equivalents once Phase 3 capability model is stable.

#### P2-2: `x-role` Documentation Mismatch on Grading Routes
**SEVERITY**: P2
**TITLE**: Grading queue routes declare `x-role: ["Admin"]` but Grader role also has the underlying capabilities
**PRODUCT IMPACT**: OpenAPI/Swagger docs under-report allowed roles. Grader can functionally use these routes but the documentation says Admin-only.
**SOURCE EVIDENCE**: `gradingQueue.ts` route annotations; `presets.ts` Grader capabilities
**CONFIDENCE**: HIGH
**RECOMMENDED DISPOSITION**: Update `x-role` annotations to include `"Grader"`.

#### P2-3: Unattached Export Routes
**SEVERITY**: P2
**TITLE**: `GET /admin/attempts/:attemptId/export[/csv]` have no UI trigger
**PRODUCT IMPACT**: Per-attempt JSON and CSV export endpoints exist but cannot be reached through the UI. Admin must manually construct URLs.
**SOURCE EVIDENCE**: `attempts.admin.ts:453,495` — export routes with no corresponding UI button
**CONFIDENCE**: HIGH
**RECOMMENDED DISPOSITION**: Add export buttons to AttemptDetailPage or remove the routes.

### P3 Findings

#### P3-1: Sidebar visibility is UX-only (accepted design)
**SEVERITY**: P3
**TITLE**: Direct URL access to hidden sidebar pages works (gets 403, page loads with errors)
**PRODUCT IMPACT**: A Teacher visiting `/admin/users` sees a broken page with 403 errors instead of a clean redirect. This is by design (documented in capabilities.ts:12-16) but creates poor UX.
**CONFIDENCE**: HIGH
**RECOMMENDED DISPOSITION**: Accept; or add URL-level redirects for known-inaccessible pages per role.

#### P3-2: No Grader `x-role` annotation anywhere
**SEVERITY**: P3
**TITLE**: Grader role absent from all API route `x-role` metadata
**PRODUCT IMPACT**: Grader is functionally supported but invisible to documentation consumers
**CONFIDENCE**: HIGH
**RECOMMENDED DISPOSITION**: Audit all route annotations and add Grader where applicable.

---

## G. Unsatisfied-Feature Containment

### Rich text
- **No rich-text editor library** exists in the project dependencies
- **No `dangerouslySetInnerHTML`** anywhere in application code (confirmed via grep)
- **No Markdown renderer** or parser
- **Answer content is always plain text** — React's default JSX escaping provides XSS safety
- **Verdict**: CLEARLY BLOCKED — the product correctly limits to plain text. No misleading UI.

### Images in answers
- `QuestionSnapshot.attachments` field exists for question-level images only
- `TakeExamPage` hardcodes `attachments: []` when building question render data
- No file input or image upload in candidate answer UI
- **Verdict**: CLEARLY BLOCKED — no UI implies image upload exists.

### Tables, formulas
- No table or formula editor
- No LaTeX/MathJax support
- **Verdict**: CLEARLY BLOCKED.

### Toolbar controls
- No formatting toolbar in the answer textarea
- `SubjectiveAnswerInput.tsx` is a bare `<textarea>` with character count only
- **Verdict**: CLEARLY BLOCKED.

### Markdown, code blocks
- No Markdown rendering dependency
- No code block support
- **Verdict**: CLEARLY BLOCKED.

### Anonymous grading
- `gradedBy` on grading entries records the grader identity
- No option to hide identity from grader
- **Verdict**: NOT SUPPORTED — no misleading UI.

### Multi-grader workflow
- Manual grading has no assignment or routing infrastructure
- Single-grader assumption: the first grader to score a question "wins"
- **Verdict**: NOT SUPPORTED — no misleading UI.

### Assigned-resource access (Teacher/Proctor/Grader)
- UI implies scoped access via role naming conventions ("Teacher for Course")
- But backend grants org-wide access
- **Verdict**: MISLEADING — the role names imply scoped access but no scoping exists.

---

## H. UI/API Boundary Consistency Summary

| # | Issue | Type | Severity |
|---|---|---|---|
| 1 | Proctor button → 403 (ExamEnrollmentManage missing) | UI shows → API rejects | P1 |
| 2 | proctor-incident route dead | Dead API route | P1 |
| 3 | Grading routes x-role mismatch | Documentation bug | P2 |
| 4 | Teacher publish-results scope over-grant | Scope over-grant (flat perm) | P2 |
| 5 | Export routes with no UI | Orphaned API routes | P2 |
| 6 | Legacy requireRole gates on 5 families | Inconsistent authorization | P2 |
| 7 | Sidebar UX-only gating | Accepted design, poor UX | P3 |
| 8 | Grader absent from all x-role docs | Documentation gap | P3 |

---

## I. E2E Assessment

### Active test coverage (17 of 18 spec files active):

| Test file | Coverage scope | Status |
|---|---|---|
| candidate-happy-path.spec.ts | Core candidate flow (login → answer → submit → result) | **PASS** |
| resume-attempt.spec.ts | Answer persistence across reload | **PASS** |
| submit-flush.spec.ts | Pending save flush on submit | **PASS** |
| refresh-during-exam.spec.ts | clientSeq rehydration across reloads | **PASS** |
| deadline-crash.spec.ts | Server auto-submit on deadline | **PASS** |
| disconnect-restore.spec.ts | Heartbeat → disrupted → restore | **PASS** |
| double-click-start.spec.ts | Atomic start attempt protection | **PASS** |
| save-submit-race.spec.ts | Concurrent save+submit integrity | **PASS** |
| admin-flow.spec.ts | Admin CRUD + exam lifecycle + CSV export | **PASS** |
| result-publishing.spec.ts | All 3 result visibility modes | **PASS** |
| manual-grading.spec.ts | Complete text_response grading workflow | **PASS** |
| multi-select-e2e.spec.ts | Multiple choice scoring (all_correct_full) | **PASS** |
| demo-seed-accounts.spec.ts | Seed data verification + max_attempts | **PASS** |
| audit-log.spec.ts | Audit log viewer and filters | **PASS** |
| proctor-runtime.spec.ts | Force submit, extend time, misconduct flag | **PASS** |
| proctor-monitoring-ui.spec.ts | Real-time monitoring UI | **PASS** |
| proctor-landing.spec.ts | Proctor workspace login and navigation | **PASS** |

### Skipped:
| Test file | Reason |
|---|---|
| fill-blank-e2e.spec.ts | "Phase 3 pending: fill-blank runtime/answer-protocol/auto-grading/result rendering are not part of Phase 2 baseline" |

### Test quality:
- **Strong**: `save-submit-race`, `deadline-crash`, `manual-grading`, `result-publishing` — each tests real concurrency or multi-step workflows with API state verification
- **Weak**: None identified as weak; all tests make specific assertions
- **Vacuous**: None identified
- **Missing negative controls**: No E2E test verifies that a Teacher cannot access another Teacher's course (because no scoping exists to test against); no E2E verifies fill_blank rejection (test is skipped entirely)

---

## J. Cross-Boundary Observations

### CROSS-BOUNDARY-HANDOFF-1: fill_blank is deferred
**Suggested owner**: Agent A
**Reason**: The fill_blank question type has full domain model, grading engine, and admin UI but its candidate runtime and E2E are skipped (Phase 3 pending). This affects the overall "proven supported" classification.
**Evidence**: fill-blank-e2e.spec.ts lines 11-21; docs/phase-roadmap.md lines 159,171,195-196.

### CROSS-BOUNDARY-HANDOFF-2: text_response is PLAIN-TEXT COMPLETE
**Suggested owner**: Agent A
**Reason**: The subjective text_response type has a complete P3-MOD path with manual grading E2E. No rich-text capability exists. Answer rendering is XSS-safe via React's default escaping.
**Evidence**: manual-grading.spec.ts (active E2E); GradingDetailPage.tsx; no dangerouslySetInnerHTML anywhere.

### CROSS-BOUNDARY-HANDOFF-3: Legacy requireRole(["Admin"]) gates
**Suggested owner**: Agent B (self-contained)
**Reason**: 5 route families still use Phase 1 legacy role gates. These should be migrated to capability gates Phase 3.
**Evidence**: Detailed in Finding P2-1.

---

## K. Evidence Executed

All evidence is SOURCE-PROVEN via direct file inspection:

| Evidence | Source |
|---|---|
| Route registry | apps/api/src/routes/registerApiRoutes.ts |
| Auth plugin (requireCapability/requireRole) | apps/api/src/plugins/auth.ts |
| Authz plugin (requireScopedCapability) | apps/api/src/plugins/authz.ts |
| Scoped resolvers (attempt, exam) | apps/api/src/authz/resolvers/ |
| Role presets (permission→role mapping) | packages/authz/src/presets.ts |
| Permission catalog | packages/authz/src/catalog.ts |
| UI capability gates | apps/web/src/lib/capabilities.ts |
| Admin sidebar navigation | apps/web/src/components/layout/AppSidebar.tsx |
| Role landing paths | apps/web/src/lib/auth.ts |
| Exam detail page (Proctor button) | apps/web/src/pages/admin/ExamDetailPage.tsx:455-461 |
| Proctor dashboard page | apps/web/src/pages/admin/ProctorDashboardPage.tsx |
| Grading queue route annotations | apps/api/src/routes/gradingQueue.ts |
| Proctor incident dead route | apps/api/src/routes/proctorMonitoring.ts:200 |
| Legacy requireRole routes | settings.ts, candidateField.ts, user.ts, roleAssignments.ts, system.ts |
| E2E test listing | apps/e2e/e2e/ directory (18 spec files) |
| E2E seed helpers | apps/e2e/lib/seed.ts, flow.ts |
| Fill-blank E2E skip | apps/e2e/e2e/fill-blank-e2e.spec.ts:11-21 |
| Manual grading E2E | apps/e2e/e2e/manual-grading.spec.ts (251 lines, active) |
| XSS safety (no dangerouslySetInnerHTML) | grep across all source; QuestionRenderer.test.tsx; GradingDetailPage.test.tsx |
| No rich-text editor libraries | grep across all package.json files |

---

## L. Recommended Closure Plan

### MUST FIX BEFORE BASIC PRODUCT CLOSURE:
1. **Fix Proctor Dashboard 403** — either regate the API endpoint to `ExamRoomView` or hide the UI button for Proctor (P1)
2. **Teacher/Proctor/Grader org-wide access** — make a product decision and document it (P1)
3. **Resolve duplicate misconduct endpoints** — remove the dead route or wire the UI to it (P1)
4. **Migrate legacy `requireRole(["Admin"])` gates** to capability-based gates (P2)

### CAN DEFER:
1. Add export UI buttons for per-attempt JSON/CSV (P2) → Phase 3
2. Update `x-role` documentation annotations (P2/P3) → Phase 3
3. Add URL-level redirects for known-inaccessible pages (P3) → Phase 3

### REQUIRES PRODUCT DECISION:
1. Teacher scope: org-wide vs course-scoped
2. Proctor scope: org-wide vs exam-scoped
3. Grader scope: org-wide vs exam-scoped
4. Proctor Dashboard 403: fix route gate or remove UI element

### RICH-TEXT FOLLOW-UP:
- No action needed. Plain-text boundaries are correctly maintained.

### RESOURCE-AUTHORIZATION FOLLOW-UP:
- Must be addressed alongside Teacher/Proctor/Grader scoping decisions.

---

## M. Final Machine-Readable Summary

```
RUN_ID=EXAM-BOUNDARY-B-20260718-213429-ddbc808b
AGENT_SLOT=B
P0=0
P1=3
P2=3
P3=2
PROVEN_SUPPORTED=admin_authz,candidate_ownership_chain,capability_gating,exam_lifecycle_enforcement,scoped_resolvers,proctor_monitoring_read,grading_queue,manual_grading,result_publishing,e2e_core_journey,attempt_concurrency,heartbeat_disrupted
PARTIAL=teacher_ui_access,proctor_ui_access,grader_ui_access
UNSUPPORTED=teacher_course_scoping,proctor_exam_scoping,grader_attempt_scoping,anonymous_grading,multi_grader,rich_text,image_answers,registration,organization_slug,super_admin,tenant_switcher
DECISIONS_REQUIRED=teacher_proctor_grader_scope,proctor_dashboard_403
BASIC_PRODUCT_CLOSURE=CONDITIONAL
```

Conditional on:
1. Fix Proctor Dashboard 403 (P1)
2. Product decision on Teacher/Proctor/Grader org-wide vs scoped access (P1)
3. Resolve duplicate misconduct endpoints (P1)
