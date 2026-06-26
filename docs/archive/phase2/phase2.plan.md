# Phase 2 — Exam Operation Runtime

> Phase 2 is not a generic feature expansion phase.
> It is the exam operation runtime closure: closing the full loop from candidate execution, deadline correctness, attempt recovery, admin intervention, proctor runtime, grading, audit evidence, to operational export.
>
> Phase 2 does **not** implement multiTenant product paths, SuperAdmin product flows, tenant switcher, organizationSlug login, API keys, service tokens, webhooks, CAS/OAuth, or external integrations. Those belong to later platformization phases.
>
> Phase 2 also does **not** make Redis, MQ, WebSocket, or Electron mandatory. They may be introduced only as ADR / optional spike when a concrete pain point is proven, not as default dependencies.

---

## 0. Phase 2 Entry Criteria

Phase 2 starts only after Phase 1 baseline is stable enough to support runtime work.

### Required

| Criterion | Current State (from discovery) |
|-----------|-------------------------------|
| PostgreSQL is the only production/integration database path | ✅ `docker-compose.yml` uses PG 18; SQLite removed from prod path |
| PG migrations are clean | ✅ `pnpm db:migrate` passes |
| PG seed and demo seed are stable | ✅ `pnpm db:seed` + `pnpm db:seed:demo` work |
| Admin/Candidate RBAC baseline is complete | ✅ `packages/auth/src/rbac.ts` — Admin and Candidate roles enforced via `requireRole` |
| organization data boundary guard is complete for singleTenant mode | ✅ `packages/auth/src/tenantGuard.ts` — all repo methods receive `ctx` |
| server-side exam protocol is complete | ✅ answer save protocol with versioned conflict detection (`packages/exam-engine/src/answerProtocol.ts`) |
| submit flush is complete | ✅ `useSubmitFlush` hook — debounced save + flush before submit |
| save-answer conflict protocol is tested | ✅ `answerProtocol.test.ts`, `attempts.test.ts` |
| deadline rejection is enforced server-side | ✅ `processSaveAnswer` rejects when `now > deadlineAt` |
| audit baseline exists | ✅ 20+ audit actions logged across auth, CRUD, exam, attempt, submit, export |
| pnpm verify passes | Required before Phase 2 start |
| E2E happy path for candidate exam flow passes | ✅ `candidate-happy-path.spec.ts`, `submit-flush.spec.ts`, `resume-attempt.spec.ts` |

### Non-Entry Criteria (belong to Phase 2 security hardening, Phase 3, or Phase 4)

```txt
sessionVersion full revocation
logout server-side JWT invalidation
mustChangePassword
first-login password change
5 failed login lockout
SuperAdmin recovery
external auth integration
```

---

## 1. Phase 2 Goal & Runtime Decision Gate

### Goal

Phase 2 moves the system from:

```txt
can create exams and candidates can complete happy-path attempts
```

to:

```txt
a real LAN/on-premise exam operation runtime that is correct under deadline,
refresh, disconnection, duplicate actions, admin intervention, proctor operation,
grading, audit, and result publication.
```

### Principles

```txt
[ ] PostgreSQL remains the source of truth.
[ ] Attempt state changes must be transaction-safe.
[ ] Deadline correctness is enforced by the server, not only the browser.
[ ] Candidate answer saving remains HTTP-based.
[ ] Proctor visibility starts with HTTP polling; WebSocket/SSE is optional and only on ADR.
[ ] Redis/MQ/Job Queue are optional, not Phase 2 defaults.
[ ] Every new Phase 2 API has typed request/response schemas in OpenAPI.
[ ] E2E must cover abnormal exam flows, not only happy path.
```

### Runtime Decision Gate

Before closing Phase 2, every item must be answerable:

```txt
1. Can a candidate really complete a full exam from start to result?
2. Are disconnection, refresh, deadline, duplicate start, duplicate save, and duplicate submit safe?
3. Can an admin complete the full operation loop from exam creation to assignment, publish/open/close, grading, result, and export?
4. Does every frontend button have a backend route?
5. Does every backend API have a frontend entry or a documented reason for being backend-only?
6. Are docs, OpenAPI, code, and E2E aligned?
7. Is the state machine enforced by the server instead of relying on frontend behavior?
8. Are Redis, MQ, WebSocket, and Desktop solving real pain points, or are they premature complexity?
```

### Scope Boundary

```txt
[ ] Phase 2 does NOT implement multiTenant, SuperAdmin, tenant switcher, organizationSlug login
[ ] Phase 2 does NOT implement API key, service token, webhook, CAS/OAuth
[ ] Phase 2 does NOT default-introduce Redis, MQ, WebSocket, Electron
[ ] Phase 2 does NOT implement camera/screen proctoring, AI grading, Electron lockdown
[ ] Phase 2 does NOT implement mobile-specific UI or large-scale distributed deployment
```

---

## 2. Phase 2.0 — OpenAPI Contract Baseline & Runtime Gate

> **Priority**: P0 — must be completed before any Phase 2 feature work.
> **Rationale**: Discovery (03-openapi-contract-audit.md) found that most OpenAPI responses are generic `{}`. Phase 2 adds 15+ new APIs; without a full contract baseline, the spec becomes untrustworthy.

Goal: establish a complete, typed OpenAPI contract baseline for all implemented APIs before any Phase 2 runtime work begins.

### Scope of Allowed Changes

Phase 2.0 **may** modify:

- `packages/contracts/*` — Zod schemas, DTO types
- `apps/api/src/openapi/*` — swagger generation, config, helpers
- Fastify route schema metadata: `schema.body`, `schema.params`, `schema.querystring`, `schema.response`
- OpenAPI generation helper and structural tests
- Documentation

Phase 2.0 **must not** modify:

- Runtime business behavior
- State-machine semantics
- DB write behavior
- Transaction semantics
- Permission boundary
- Frontend behavior
- E2E expectations

### Current State

- OpenAPI generated via `@fastify/swagger` in `apps/api/src/openapi/swagger.ts`
- 42 endpoints registered; 1 inline (`GET /api/health`) missing from spec
- Most 200/201 responses declared as `genericSuccessSchema` (`{ type: "object" }`) — no actual response shape
- Request body schemas use Zod for runtime validation but are not registered as Fastify `schema.body`
- Role requirements invisible in spec (no `security` or `x-role` annotations)
- Union responses (`SaveAnswer`) and conditional responses (`AttemptResultResponse`) have no `oneOf` representation

### Target State

```txt
[ ] All server-registered API routes appear in OpenAPI or are explicitly documented as intentionally hidden.
[ ] No implemented API route uses generic `{}` response schema.
[ ] All request bodies, query params, and path params are documented.
[ ] Runtime-critical attempt/candidate/score APIs have typed schemas.
[ ] SaveAnswer and AttemptResult union/conditional responses use oneOf.
[ ] Protected routes expose security/RBAC metadata.
[ ] Common error responses are standardized.
[ ] OpenAPI structural/snapshot tests prevent regression.
[ ] No runtime business behavior changed.
```

### Runtime-Critical APIs (highest priority within Phase 2.0)

```txt
GET  /api/candidate/exams
GET  /api/candidate/exams/:examId
POST /api/attempts/:examId/start
GET  /api/attempts/:id
POST /api/attempts/:attemptId/answers/:questionId
POST /api/attempts/:attemptId/submit
POST /api/attempts/:attemptId/heartbeat
POST /api/attempts/:attemptId/restore
GET  /api/scores/attempts/:attemptId
GET  /api/exams/:id/scores
GET  /api/exams/:id/export/scores
```

### Jobs

> **Job consolidation note**: The original 9 sub-tasks below are all absorbed into a single job **P2.0-J1 — OpenAPI Contract Baseline & Runtime Gate**. This is a mechanical, behavior-preserving job; splitting it further would fragment a single concern across multiple PRs. The sub-task list is retained as a checklist within P2.0-J1's job card.

| Job     | Name                                  | Description                                                                                                  | Discovery Ref |
| ------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------- |
| P2.0-J1 | OpenAPI Contract Baseline & Runtime Gate | Consolidated job covering all OpenAPI baseline work: route coverage, request/response schema registration, union/conditional modeling, RBAC metadata, error baseline, regression tests. No runtime behavior change. Absorbs former sub-tasks P2.0-J1 through P2.0-J9 listed below. | 03 §2–§6, 05 §E |

<details>
<summary>Original sub-task breakdown (absorbed by P2.0-J1, retained as checklist)</summary>

| Sub-task | Description | Discovery Ref |
| -------- | ----------- | ------------- |
| Route Coverage Baseline | Ensure all server-registered routes appear in OpenAPI, including `GET /api/health`, or are explicitly hidden | 03 §2 |
| Request Schema Registration | Register body, params, and query schemas for all implemented APIs | 03 §3 |
| Response Schema Registration | Replace generic `{}` responses with typed schemas for all implemented APIs | 03 §3, §4.3 |
| Union / Conditional Response Modeling | Model SaveAnswer and AttemptResult responses with `oneOf` | 03 §4.3 |
| Auth / RBAC Metadata | Add security and Admin/Candidate role metadata without changing runtime permissions | 03 §5 |
| Common Error Response Baseline | Standardize 400/401/403/404/409/429/500 response documentation | 03 §6 |
| CSV / Binary Response Documentation | Correctly document score CSV export response content type | 03 §4.3 |
| OpenAPI Regression Tests | Add structural/snapshot tests to prevent generic `{}` regression | 03 §6 |
| Runtime E2E Matrix Definition | Define abnormal runtime E2E scenarios for Phase 2A/2C (executed in P2A-J6) | 05 §E |

</details>

### Acceptance Criteria

```txt
[ ] All server-registered routes appear in OpenAPI or are explicitly hidden.
[ ] No implemented route uses generic `{}` response schema.
[ ] SaveAnswer accepted/rejected union is represented in OpenAPI oneOf.
[ ] AttemptResultResponse conditional response (showResultImmediately) is documented.
[ ] CandidateExamSummary and LoadAttemptResponse shapes are in OpenAPI.
[ ] GET /api/health appears in OpenAPI spec.
[ ] Protected routes expose role/security metadata.
[ ] Common error responses are standardized and documented.
[ ] OpenAPI structural/snapshot tests pass and prevent regression.
[ ] No runtime business behavior changed.
[ ] pnpm verify passes.
```

---

## 3. Phase 2A — Candidate Runtime

> **Priority**: P0 — blocking for any real exam usage.
> **Rationale**: Discovery (06-phase2-gap-analysis.md) found 5 P0 issues affecting whether a candidate can safely complete an exam.

Goal: ensure a candidate can safely complete a full exam from start to result, handling all edge cases server-side.

### Current State

| Gap | Discovery Ref | Detail |
|-----|---------------|--------|
| No server-side auto-submit at deadline | 06 P0-1, 04 §6 | If browser crashes at deadline, attempt stays `in_progress` → heartbeat scanner marks `disrupted` → never submitted → score never computed. `heartbeat.ts` only calls `markDisrupted()`, never `submitAttempt()`. |
| startAttempt not atomic | 06 P0-2, 04 §2 | `startAttempt()` calls `findByEnrollment` then `create` without transaction or lock. Two concurrent requests could create duplicate attempts. |
| Exam status never transitions to `open`/`closed` | 06 P0-3, 04 §1 | `openExam()` and `closeExam()` exist in code but no API or scheduler calls them. Exams stay `published` forever. |
| No client-side deadline awareness | 06 P0-5, 01 §4 | Server rejects saves after deadline, but client continues showing questions and allowing edits until save fails. |
| No remaining-time adjustment on restore | 04 §6 | `restoreAttempt` sets `lastActivityAt = now` but does NOT adjust `deadlineAt`. Candidate loses time spent disconnected. |

### Target State

| Fix | Target |
|-----|--------|
| Auto-submit | Server-side deadline scanner auto-submits expired `in_progress` attempts and grades them |
| Atomic startAttempt | Wrapped in `executeInTransaction` with `SELECT ... FOR UPDATE` on enrollment row |
| Exam open/close | Check-on-access pattern: `startAttempt` and `candidateExamState` trigger status transition if `now >= openAt` or `now >= closeAt` |
| Client deadline awareness | `TakeExamPage` reads `deadlineAt` from server, disables editing and shows final state when deadline passes |
| Restore time adjustment | `restoreAttempt` preserves remaining time by adjusting `deadlineAt` to `originalDeadlineAt + timeSpentDisconnected` |

### Jobs

> **Numbering alignment note**: The job index (`phase2_job_index.md`) is the authoritative task list. The plan job table below has been aligned to match index IDs. Several stabilization-only sub-jobs from earlier drafts were dropped (see notes).

| Job    | Name                             | Description                                                               | Discovery Ref |
| ------ | -------------------------------- | ------------------------------------------------------------------------- | ------------- |
| P2A-J1 | Atomic startAttempt              | Make start attempt transaction-safe and enrollment-locked                 | 06 P0-2, 04 §2 |
| P2A-J2 | Server-Side Deadline Auto-Submit | Auto-submit expired attempts even if browser crashes                      | 06 P0-1, 04 §6 |
| P2A-J3 | Client Deadline Awareness        | Disable editing and show final state after deadline                       | 06 P0-5, 01 §4 |
| P2A-J4 | Exam Open/Close Semantics        | Make open/close status match openAt/closeAt                               | 06 P0-3, 04 §1 |
| P2A-J5 | Restore Runtime Semantics        | restoreAttempt preserves remaining time by adjusting deadlineAt; must be transaction-safe | 04 §6 |
| P2A-J6 | Candidate Runtime E2E            | Cover refresh, disconnect, double-click, deadline crash, save/submit race | 05 §E         |

<details>
<summary>Dropped / absorbed sub-jobs from earlier draft</summary>

| Former Job | Reason |
| ---------- | ------ |
| Start / Resume Runtime (normalize start behavior) | Absorbed into P2A-J1 (atomic start) and P2A-J5 (restore semantics). Normalization of the start path is implicitly covered by making startAttempt transaction-safe. |
| Save Answer Runtime (stabilization) | Dropped — no discovery gap exists. Existing save-answer versioning, idempotency, and conflict handling are already tested (`answerProtocol.test.ts`, `attempts.test.ts`, `submit-flush.spec.ts`). If regressions surface during P2A, a stabilization job can be added on demand. |
| Submit Runtime (stabilization) | Dropped — no discovery gap exists. Submit idempotency and save/submit race are already handled by `findByIdForUpdate` + status check. Covered by P2A-J6 E2E matrix. |
| Candidate Result Visibility | Absorbed into P2D-J5 (Result Publishing Policy). Candidate-facing result display verification is part of the result publication modes work. |

</details>

### Acceptance Criteria

```txt
[ ] Concurrent start requests cannot create duplicate active attempts.
[ ] Expired in_progress attempts are submitted and graded server-side within scan interval.
[ ] Expired disrupted attempts have deterministic behavior (submit or leave disrupted per policy).
[ ] Client disables editing after deadline before local edits appear successful.
[ ] Candidate result page shows submitted/graded/status-only states correctly.
[ ] Restore preserves remaining time (deadlineAt adjusted correctly).
[ ] Exam transitions to open/closed based on openAt/closeAt without manual admin action.
[ ] Tests cover browser crash at deadline.
[ ] Tests cover double-click start.
[ ] Tests cover save/submit race condition.
[ ] pnpm verify passes.
```

---

## 4. Phase 2B — Admin Operation

> **Priority**: P1 — core for real exam administration.
> **Rationale**: The admin must complete the full operation loop from setup to export. Existing CRUD works but the end-to-end flow has gaps.

Goal: ensure Admin can complete the full operation loop — user/candidate/course/question setup, exam setup, assignment, publish/open/close/archive, score overview, result/export entry.

### Current State

| Gap | Discovery Ref | Detail |
|-----|---------------|--------|
| Exam setup flow incomplete | 01 §3 (ExamCreatePage) | Exam creation works but publish→open→close lifecycle has no auto-transition |
| Assignment flow basic | 01 §3 (ExamDetailPage) | Enrollment add/remove works but no batch assignment validation |
| Publish/open/close/archive semantics mismatch | 04 §1 | `openExam()`/`closeExam()` exist but no route or scheduler calls them |
| Score overview entry exists | 01 §3 (ScoreListPage) | Score list and CSV export work; no attempt detail export |
| No audit log frontend | 06 P1-5, 01 §9 | `GET /api/admin/audit-logs` exists but no `/admin/audit-logs` page |

### Target State

| Fix | Target |
|-----|--------|
| Admin flow audit | Verify complete admin path: setup → assignment → publish → result → export |
| Exam setup hardening | Improve exam setup and validation flow |
| Assignment flow hardening | Make enrollment/assignment flow reliable and testable |
| Publish/open/close/archive semantics | Align admin operations with exam state machine |
| User/question/course management hardening | Fix gaps in existing management flows without rewriting CRUD |
| Score overview entry | Ensure admin can navigate from exam to scores/results |

### Jobs

> **SPLIT BEFORE CONSTRUCTION**: P2B-J2 absorbs 5 capabilities from earlier drafts. Before construction, it must be split into:
> - **P2B-J2a** — Publish/Open/Close/Archive Alignment
> - **P2B-J2b** — Exam Setup + Assignment Validation
> - **P2B-J2c** — Management Hardening + Score Overview Navigation

| Job    | Name                                      | Description                                                  | Discovery Ref |
| ------ | ----------------------------------------- | ------------------------------------------------------------ | ------------- |
| P2B-J1 | Admin Operation Flow Audit                | Verify admin setup → assignment → publish → result path end-to-end; identify gaps for P2B-J2 | 05 B7-B9, 05 §E |
| P2B-J2 | Admin Operation Hardening (SPLIT BEFORE CONSTRUCTION) | Absorbs exam setup, assignment, publish/open/close/archive, management hardening, and score overview. Must be split before construction (see note above). Depends on P2A-J4 for open/close semantics. | 01 §3, 04 §1 |

### Acceptance Criteria

```txt
[ ] Admin can complete full setup → assignment → publish → score → export flow.
[ ] Exam publish/open/close/archive transitions are correct and audited.
[ ] Enrollment add/remove works reliably with validation.
[ ] Score overview is accessible from exam detail.
[ ] Existing management flows (user, question, course) have no regressions.
[ ] pnpm verify passes.
```

---

## 5. Phase 2C — Proctor Runtime

> **Priority**: P1 — after Admin Operation is stable.
> **Rationale**: Discovery (01 §9, 05 C1, 06 P1-1 through P1-4) found no proctor UI, no force-submit, no extend-time, no misconduct flagging. All have backend infrastructure but zero frontend and no admin API.

Goal: during live exams, Admin can monitor, intervene, and leave audit trails. HTTP polling first; no WebSocket dependency.

### Current State

| Gap | Discovery Ref | Detail |
|-----|---------------|--------|
| No proctor dashboard | 01 §9, 05 C1 | No page, no route. Admin can see enrollment list in `ExamDetailPage` but no real-time candidate status. |
| No force-submit API | 06 P1-2, 04 §2 | `submitAttempt()` works on disrupted attempts, but no admin-initiated endpoint. |
| No extend-time API | 06 P1-3, 04 §2 | `deadlineAt` is set once at attempt creation. No mechanism to extend. |
| No misconduct flagging | 06 P1-4 | `MARK_MISCONDUCT` permission defined in RBAC, no API or UI. |
| Heartbeat scanner best-effort | 04 §6 | No transaction, no retry, no dead-letter. A failed `markDisrupted` is logged and skipped. |

### Target State

| Fix | Target |
|-----|--------|
| Heartbeat runtime | Stabilize heartbeat update and scan behavior |
| Disrupted detection | Detect and mark disrupted attempts deterministically |
| Polling proctor dashboard | Admin-operated proctor dashboard using HTTP polling |
| Force submit | Admin force-submit API/UI with audit |
| Extend time | Deadline extension API/UI with candidate sync |
| Misconduct flag | Misconduct flag API/UI with notes and audit |
| Attempt timeline | Surface attempt events for proctor/admin diagnosis |

### Non-Goals

```txt
[ ] No camera monitoring
[ ] No screen recording
[ ] No public internet remote proctoring
[ ] No independent Proctor role product path (Admin operates proctor functions in Phase 2)
[ ] No WebSocket dependency for proctor dashboard (HTTP polling first)
[ ] No real-time candidate status cards via WebSocket (polling is sufficient for Phase 2)
```

### Jobs

> **Numbering alignment note**: The job index is authoritative. Heartbeat runtime and disrupted detection have been merged into P2C-J1. Attempt timeline has been moved to Phase 2E (P2E-J2). The table below matches the index.

| Job    | Name                                    | Description                                             | Discovery Ref |
| ------ | --------------------------------------- | ------------------------------------------------------- | ------------- |
| P2C-J1 | Heartbeat and Disrupted Detection Hardening | Stabilize heartbeat scanner + disrupted detection (transaction, audit, retry) | 04 §6 |
| P2C-J2 | Force Submit                            | Add Admin force-submit API/UI with audit                | 06 P1-2, 04 §2 |
| P2C-J3 | Extend Time                             | Add deadline extension API/UI with candidate sync       | 06 P1-3, 04 §2 |
| P2C-J4 | Misconduct Flag                         | Add misconduct flag API/UI with notes and audit         | 06 P1-4       |
| P2C-J5 | Polling Proctor Dashboard               | Add Admin-operated proctor dashboard using HTTP polling | 06 P1-1, 01 §9 |
| P2C-J8 | Proctor Runtime E2E                     | Cover disrupted, force submit, extend time, misconduct  | 05 §E         |

<details>
<summary>Moved / merged sub-jobs</summary>

| Former Job | Status |
| ---------- | ------ |
| Heartbeat Runtime (P2C-J1) + Disrupted Detection (P2C-J2) | Merged into P2C-J1 — heartbeat scanner and disrupted detection are tightly coupled |
| Attempt Timeline (P2C-J7) | Moved to P2E-J2 — it is an operation evidence/audit concern, not a live proctor action |

</details>

### Acceptance Criteria

```txt
[ ] Admin can see active, disrupted, submitted, graded candidates for an exam via polling.
[ ] Admin can force-submit an abandoned attempt; attempt transitions to submitted and is graded.
[ ] Admin can extend time; candidate UI reflects updated deadline within polling interval.
[ ] Admin can mark misconduct with audit metadata.
[ ] All proctor operations are audited (audit log entries created).
[ ] Polling dashboard works without WebSocket/SSE.
[ ] Heartbeat scanner correctly detects and marks disrupted attempts.
[ ] pnpm verify passes.
```

---

## 6. Phase 2D — Grading & Result

> **Priority**: P1 — after Candidate Runtime and Proctor Runtime are stable.
> **Rationale**: Discovery (04 §5, 06 P1-6) found all grading is auto; no interface for grading essay/subjective questions. Result publication has no policy control.

Goal: make scoring usable beyond fully automatic objective questions; establish result publication policy.

### Current State

| Gap | Discovery Ref | Detail |
|-----|---------------|--------|
| All grading is auto | 04 §5, 06 P1-6 | `gradeAnswers()` handles single_choice, multiple_choice, true_false, fill_blank. No manual grading. |
| No partial grading | 04 §5 | Grading happens atomically on submit. No "grade some questions first" workflow. |
| No grading audit | 04 §5 | `gradingResult` is stored on attempt but individual grading decisions are not auditable. |
| No result publication policy | 04 §3 | `showResultImmediately` is per-exam; no after-grading or manual publish modes. |

### Target State

| Fix | Target |
|-----|--------|
| Objective grading stabilization | Keep current auto-grading behavior stable and well-tested |
| Manual grading model | Grading state for subjective/manual questions with per-question score entry |
| Grading queue | List attempts/questions requiring manual grading |
| Manual score UI | Admin enters scores and comments per question |
| Score policy | Verify score strategy and retake interactions |
| Result publication policy | Immediate, after-grading, manual publish modes |
| Result visibility | Verify candidate/admin result shapes |
| Grading audit | Record grader, score changes, comments, timestamps |

### Jobs

> **Numbering alignment note**: The job index is authoritative. Score policy and result publishing policy have been merged into P2D-J5. Result visibility has been absorbed into P2D-J5 (result publication modes govern candidate visibility). Grading audit renumbered from J8 to J6.
>
> **SPLIT BEFORE CONSTRUCTION**: P2D-J5 spans 5 layers (contract, domain, DB, API, frontend) with a breaking migration. Before construction, it must be split into:
> - **P2D-J5a** — Result Publishing Model + Migration + Backend API
> - **P2D-J5b** — Candidate ResultPage Visibility
> - **P2D-J5c** — Admin ExamCreatePage Mode Selector

| Job    | Name                                          | Description                                              | Discovery Ref |
| ------ | --------------------------------------------- | -------------------------------------------------------- | ------------- |
| P2D-J1 | Objective Grading Stabilization               | Keep current auto-grading behavior stable with regression tests | 04 §5 |
| P2D-J2 | Manual Grading Model                          | Define manual grading state and per-question score model | 06 P1-6, 04 §5 |
| P2D-J3 | Grading Queue API                             | List attempts/questions requiring manual grading         | 06 P1-6       |
| P2D-J4 | Manual Grading UI                             | Admin enters scores/comments                             | 06 P1-6       |
| P2D-J5 | Result Publishing Policy (SPLIT BEFORE CONSTRUCTION) | Absorbs score policy verification + result publication modes (immediate / after-grading / manual) + candidate/admin result visibility. Breaking migration: `showResultImmediately` → `resultPublicationMode` enum. Must be split before construction (see note above). | 04 §3, 05 A8 |
| P2D-J6 | Grading Audit                                 | Audit score changes and grader identity                  | 04 §5         |

<details>
<summary>Moved / merged sub-jobs</summary>

| Former Job | Status |
| ---------- | ------ |
| Score Policy (P2D-J5) + Result Publishing Policy (P2D-J6) | Merged into P2D-J5 — score strategy verification and result publication modes are the same concern |
| Result Visibility (P2D-J7) | Absorbed into P2D-J5 — result visibility is governed by publication mode |

</details>

### Acceptance Criteria

```txt
[ ] Auto-graded exams continue working without regression.
[ ] Manual questions do not incorrectly auto-complete as fully graded.
[ ] Candidate sees status-only result until grading is complete or published.
[ ] Admin can view and finalize grading via grading queue.
[ ] Score changes are auditable with grader identity and timestamps.
[ ] Result publication modes (immediate, after-grading, manual) work correctly.
[ ] Score strategy is verified with multiple attempts.
[ ] pnpm verify passes.
```

---

## 7. Phase 2E — Operation Evidence & Export

> **Priority**: P2 — after core runtime, admin, proctor, and grading are stable.
> **Rationale**: Discovery (01 §9, 06 P2-1 through P2-4) found audit log API exists but no frontend, no attempt timeline, CSV export is basic, no diagnostics page.

Goal: provide operational evidence for real exam administration — audit trail, attempt timeline, export, diagnostics.

### Current State

| Gap | Discovery Ref | Detail |
|-----|---------------|--------|
| Audit log API exists, no frontend | 06 P1-5, 01 §9 | `GET /api/admin/audit-logs` exists but no `/admin/audit-logs` page. |
| No attempt timeline | 05 §D | Audit trail exists but no visual timeline of attempt events. |
| Basic CSV export | 01 §3 (ScoreListPage) | `GET /api/exams/:id/export/scores` — permission-checked but limited. |
| No attempt detail export | 01 §3 (AttemptDetailPage) | View-only, no export per attempt. |
| No import job logs | 01 §9 | Candidate/question import summaries not persisted. |
| No diagnostics page | 01 §3 (SystemHealthPage) | Basic health check exists but no runtime config/heartbeat scanner status. |

### Target State

| Fix | Target |
|-----|--------|
| Audit log UI | `/admin/audit-logs` — search, filter, paginate existing audit logs |
| Attempt timeline view | Show candidate attempt events: start, save, heartbeat, disrupt, restore, submit, grade |
| CSV hardening | Ensure large score CSV export is permission-checked and tested |
| Attempt detail export | Export answer details for one attempt |
| Import job logs | Persist candidate/question import summaries |
| Diagnostics page | Show runtime config, DB status, heartbeat scanner status, version info |

### Jobs

| Job    | Name                  | Description                                                | Discovery Ref |
| ------ | --------------------- | ---------------------------------------------------------- | ------------- |
| P2E-J1 | Audit Log Viewer      | Add searchable/filterable audit log UI                     | 06 P1-5, 01 §9 |
| P2E-J2 | Attempt Timeline View | Show attempt lifecycle events chronologically              | 05 §D         |
| P2E-J3 | Score CSV Hardening   | Harden CSV export for permission, size, and correctness    | 01 §3         |
| P2E-J4 | Attempt Detail Export | Export answers/results for one attempt                     | 01 §3         |
| P2E-J5 | Import Job Logs       | Persist candidate/question import summaries                | 01 §9         |
| P2E-J6 | Diagnostics Page      | Show config, DB, heartbeat scanner, version/runtime status | 01 §3         |

### Deferred

```txt
[ ] PDF export at scale
[ ] Email notification
[ ] Webhook
[ ] External integration
```

PDF export may be added only if it remains synchronous and small. Otherwise it requires a job queue ADR.

### Acceptance Criteria

```txt
[ ] Admin can search and filter audit logs in UI.
[ ] Attempt timeline shows all key events chronologically.
[ ] Large CSV export is permission-checked and tested with 1000+ records.
[ ] Attempt detail export produces per-attempt answer data.
[ ] Import job summaries are persisted and viewable.
[ ] Diagnostics page shows runtime config, DB latency, heartbeat scanner status.
[ ] pnpm verify passes.
```

---

## 8. Phase 2F — Infra ADR / Optional Upgrade

> **Priority**: ADR only — not implementation work.
> **Rationale**: Discovery (06 §Redis/MQ assessment) found no Phase 2 pain point requires Redis, MQ, or WebSocket as mandatory infrastructure.

Goal: avoid premature infrastructure complexity while leaving clear, documented upgrade paths.

### Default Decision

```txt
[ ] PostgreSQL remains the source of truth.
[ ] Redis is not required for Phase 2 single-instance LAN deployment.
[ ] MQ is not required unless long-running async jobs are introduced.
[ ] Job Queue is not required unless export/import/email/auto-submit becomes too slow for request lifecycle.
[ ] WebSocket/SSE is optional after polling dashboard works.
[ ] Desktop/Electron is deferred to a future phase.
```

### Revisit Triggers

| Trigger                              | Decision to Revisit                   | Discovery Ref |
| ------------------------------------ | ------------------------------------- | ------------- |
| Multi-instance app deployment        | Redis for queue/rate-limit/presence   | 06 §Redis     |
| 1000+ concurrent candidates per exam | Distributed heartbeat/presence design | 06 §Redis     |
| Persistent admission queue required  | Redis or DB-backed queue              | 06 P1-9       |
| Large PDF/export jobs                | Job queue                             | 06 §Redis     |
| Email notification                   | Job queue                             | 06 §Redis     |
| Slow/manual grading workflow         | Job queue or background workflow      | 06 P1-6       |
| Real-time proctor UX required        | SSE/WebSocket                         | 06 P1-1       |

### ADR Required Before Any Spike

```txt
[ ] ADR-001: Redis introduction (if multi-instance needed)
[ ] ADR-002: WebSocket/SSE introduction (if real-time proctor required)
[ ] ADR-003: Job queue introduction (if async jobs needed)
[ ] ADR-004: Desktop/Electron shell (if lockdown browser needed)
```

---

## 9. Future Phase — Desktop Exam Runtime

> This section is preserved for future reference. Desktop/Electron implementation is **not** part of Phase 2.

### Scope (future, Phase 3+)

Desktop exam runtime may include:

- Electron shell wrapping the web exam UI
- Secure preload / IPC boundary
- Lockdown mode (restrict clipboard, screen capture, tab switch)
- Local answer cache for offline resilience
- Endpoint discovery for LAN server
- Auto-update and code signing
- Device diagnostics reporting

### Constraints

- Desktop must reuse the server-side exam protocol (answer save protocol, heartbeat, submit).
- Desktop must not create a separate answer-save truth source.
- PostgreSQL / server remains the single source of truth.
- Desktop is an optional client, not a required runtime component.

### ADR

- ADR-004 (Desktop/Electron) must be written before any implementation spike.

---

## 10. Execution Order

```
Phase 2.0 OpenAPI Contract Baseline & Runtime Gate          ← blocks all feature work
  ↓
Phase 2A Candidate Runtime                                  ← P0, blocking for real exam usage
  ↓
Phase 2B Admin Operation                                    ← P1, core for exam administration
  ↓
Phase 2C Proctor Runtime                                    ← P1, after admin operation stable
  ↓
Phase 2D Grading & Result                                   ← P1, after candidate + proctor stable
  ↓
Phase 2E Operation Evidence & Export                        ← P2, after core runtime stable
  ↓
Phase 2F Infra ADR / Optional Upgrade                       ← ADR only, no implementation unless triggered
  ↓
Future Phase Desktop Exam Runtime                           ← not in Phase 2 scope
```

**Hard rule**: Do not start Redis, MQ, WebSocket/SSE, PDF export at scale, or Electron implementation before Phase 2A Candidate Runtime P0 correctness is complete.

**Dependency graph**:

```
P2.0 → P2A → P2B → P2C → P2D → P2E
                                   ↓
                                  P2F (ADR, not blocking)
                                   ↓
                                  Future: Desktop
```

- P2B depends on P2A (admin operations require stable candidate runtime).
- P2C depends on P2B (proctor runtime requires admin operation loop to be complete).
- P2D depends on P2A (grading depends on attempt lifecycle being complete).
- P2E depends on P2D (export depends on grading being complete).
- P2F is independent and runs in parallel as ADR documentation.

---

## 11. Quality Gate

### Per-Job Checklist

Every Phase 2 job must answer:

```txt
[ ] Which user flow does this close?
[ ] Which route/API does this add or modify?
[ ] Which contract schema changed?
[ ] Which state transition changed?
[ ] Which DB transaction/lock protects correctness?
[ ] Which audit event is recorded?
[ ] Which frontend page/component changed?
[ ] Which E2E scenario proves the flow?
[ ] Does this close one of the 8 Runtime Decision Gate questions?
[ ] Does this change a state machine transition?
[ ] Is the state machine enforced server-side?
[ ] Does OpenAPI match runtime contract?
[ ] Does E2E cover the abnormal path?
[ ] Does this introduce infrastructure dependency? If yes, where is the ADR?
[ ] Does this require Redis/MQ/WebSocket, or can it work with PG + HTTP?
```

### Mandatory Verification

```txt
[ ] pnpm format:check
[ ] pnpm lint
[ ] pnpm typecheck
[ ] pnpm test
[ ] pnpm verify
[ ] PG integration tests (pnpm test:pg)
[ ] E2E tests for touched runtime flow
```

### Discovery-Backed Verification

For each phase, verify against the specific discovery findings:

| Phase | Discovery Doc | Verification |
|-------|--------------|--------------|
| P2.0 | 03-openapi-contract-audit.md | OpenAPI spec no longer has generic `{}` for touched routes |
| P2A | 06-phase2-gap-analysis.md P0 | All P0 gaps closed with tests |
| P2B | 05-user-flow-trace-map.md §B | Admin operation loop complete end-to-end |
| P2C | 06-phase2-gap-analysis.md P1-1 through P1-5 | All proctor gaps closed with tests |
| P2D | 06-phase2-gap-analysis.md P1-6 | Manual grading workflow complete |
| P2E | 01-frontend-inventory.md §9, 05-user-flow-trace-map.md §D | Missing UIs implemented |

---

## 12. Deferred Items

### 12.1 Platform Deferred (Cross-Phase)

```txt
[ ] MultiTenant product path                          (Phase 4)
[ ] SuperAdmin UI                                     (Phase 4)
[ ] Tenant switcher                                   (Phase 4)
[ ] organizationSlug login                            (Phase 4)
[ ] API Key / Service Token                           (Phase 4)
[ ] Webhooks                                          (Phase 4)
[ ] CAS/OAuth/SAML                                    (Phase 3)
[ ] Electron implementation                           (Phase 3+, requires ADR-004)
[ ] Electron lockdown client                          (Phase 3+)
[ ] Camera / screen proctoring                        (Phase 3+)
[ ] AI-assisted grading                               (Phase 3+)
[ ] Programming / file-upload / drawing questions     (Phase 3+)
[ ] Mobile-specific UI                                (Phase 3+)
[ ] Large-scale distributed deployment                (Phase 4)
[ ] Email notifications                               (Phase 3)
[ ] PDF export at scale                               (Phase 3, requires job queue ADR)
[ ] Real-time WebSocket proctor dashboard             (Phase 3, requires ADR-002)
```

### 12.2 Phase 2 Parked Gaps (Discovery-Identified, Not in Phase 2 Job Scope)

> These gaps were identified in discovery docs `01`–`06` but are intentionally not assigned Phase 2 jobs. Each has a documented deferral reason. They must not silently disappear — if a later phase picks them up, the job card must reference the discovery source.

| Gap | Discovery Source | Deferral Reason |
|-----|-----------------|-----------------|
| **P0-4 Additional timing modes** (`timed_sync`, `deadline`, `untimed`) | 06 P0-4 | Phase 2 first stabilizes the existing `timed_window` operation runtime. Timing mode expansion is a later capability and must not block P2.0 OpenAPI baseline or P2A Candidate Runtime correctness. Revisit after P2A-J6 E2E matrix proves `timed_window` is correct under start, resume, save, submit, deadline, disruption, and result visibility. |
| **P1-7 Question random selection** (`questionSelectionMode !== "manual"`) | 06 P1-7 | Random selection requires per-candidate question snapshot variation and randomization algorithm. Not blocking for Phase 2 runtime correctness. Deferred to a post-Phase-2 capability spike. |
| **P1-8 Retake policy expansion** (`daily_limit`, `weekly_limit`) | 06 P1-8 | Current `unlimited`, `max_attempts`, `pass_then_stop` cover Phase 2 scenarios. Time-based retake counting requires time-window query logic that can be added without breaking existing flows. Deferred. |
| **P2-3 PlaceholderPage cleanup** | 06 P2-3 | Cosmetic. `/admin/*` and `/exam/*` catch-all routes show placeholder. Can be replaced with proper 404 pages in a UI polish pass. Not blocking. |
| **P2-6 Batch operations** | 06 P2-6 | Individual CRUD is sufficient for Phase 2 cohort sizes. Batch status changes and batch enrollment can be added without schema changes. Deferred. |
| **P2-7 Server-side pagination consistency** | 06 P2-7 | Some lists load all then paginate client-side (e.g., question filters in exam create). Acceptable for Phase 2 data volumes. Move to server-side pagination when data growth requires it. |
| **P2-8 Optimistic UI updates** | 06 P2-8 | Most mutations wait for server response. Optimistic updates are a perceived-performance enhancement, not a correctness requirement. Deferred. |
| **Server restart during attempt** | 05 §E | E2E not covering server restart mid-attempt. In-memory queue (P1-9) is already addressed via ADR (P2F-J1). Attempt persistence across restart is handled by DB-backed attempt state. Not blocking. |
| **IP restriction UI** | 01 §9 | `controlFlags.restrictIp` exists in schema but no admin UI to configure. Backend enforcement is also not implemented. Full feature requires IP-range validation logic + UI. Deferred to Phase 3 exam operation hardening. |
| **Queue management UI** | 01 §9 | `controlFlags.requireQueue` exists in schema but no UI. Queue is in-memory (P1-9). Full queue management requires persistent queue (Redis or DB-backed) which is ADR-dependent (P2F-J1 / ADR-003). Deferred. |

Desktop/Electron may have an ADR in Phase 2F, but implementation is deferred.

---

## 13. Modification Summary

### Original (pre-P2-PLAN-J1)

1. **Title changed**: From "Exam Runtime Closure" to "Exam Operation Runtime" — reflects that Phase 2 is about the complete operation loop, not just closing gaps.
2. **Runtime Decision Gate added**: 8 questions that every Phase 2 item must answer before the phase is considered complete.
3. **OpenAPI elevated to full Contract Baseline Gate**: Phase 2.0 now explicitly defines allowed/disallowed change scope.
4. **Admin Operation and Proctor Runtime split**: Old "Admin / Proctor Operations" is now two independent phases.
5. **Candidate Runtime focused on P0 correctness**: Jobs restructured to cover the full candidate lifecycle.
6. **Grading & Result independent**: Dedicated Phase 2D.
7. **Operation Evidence & Export independent**: Dedicated Phase 2E.
8. **Infra改为 ADR / Optional Upgrade**: Phase 2F produces ADRs only.
9. **Desktop Exam Runtime preserved as future phase**.
10. **README not modified**.
11. **No production code, tests, or discovery documents modified**.

### P2-PLAN-J1 Review Repair

12. **Job ID numbering aligned**: All plan job tables now match `phase2_job_index.md` as the authoritative task list. Former plan sub-jobs that were consolidated are documented with absorption notes.
13. **P0-4 timing modes explicitly deferred**: Added to §12.2 Parked Gaps with reasoning.
14. **All PARKED gaps documented**: 10 discovery gaps without jobs are now listed in §12.2 with deferral reasons.
15. **P2B-J2 and P2D-J5 marked SPLIT BEFORE CONSTRUCTION**: Mega-jobs that must be split before implementation begins.
16. **P2A-J2 disrupted+expired policy defined**: Auto-submit policy for disrupted+expired attempts explicit in job card.
17. **P2A-J5 restore transaction/lock explicit**: restoreAttempt must run in executeInTransaction with findByIdForUpdate.
18. **P2C-J2 error semantics unified**: Force-submit idempotent on submitted/graded (200), rejected on voided (409 INVALID_STATE).
19. **P2C-J3 transaction/lock and closeAt validation**: extendAttemptTime runs in transaction with FOR UPDATE; rejects extension beyond exam.closeAt.
20. **P2D-J1 classification fixed**: Removed state-machine classification (no state machine change).
21. **P2D-J2 unique constraint and migration backfill**: Unique constraint (attemptId, questionId) confirmed; migration backfill specified; gradedBy = Admin userId.
22. **P2D-J5 Result Visibility modeled as state**: Added Result Visibility state entity and migration backfill SQL.
23. **P2E-J3 seed impact fixed**: No demo seed change; large test data generated in test factory.
24. **P2E-J5 backward compatibility**: Existing import response fields preserved; logId added in backward-compatible way.
25. **P2E-J6 scanner metrics source documented**: In-memory counters with single-instance limitation.
26. **P2B-J1 classification fixed**: Removed docs-only; marked as E2E/regression job + planning/audit job.
27. **No production code, tests, or discovery documents modified**.
