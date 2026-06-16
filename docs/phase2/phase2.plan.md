# Phase 2 Plan — Exam Runtime Closure

> Phase 2 is not a generic feature expansion phase.
> It closes the full exam runtime loop: candidate execution, deadline correctness, attempt recovery, admin intervention, grading visibility, audit evidence, and operational export.
>
> Phase 2 does **not** implement multiTenant product paths, SuperAdmin product flows, tenant switcher, organizationSlug login, API keys, service tokens, webhooks, CAS/OAuth, or external integrations. Those belong to later platformization phases.
>
> Phase 2 also does **not** make Redis, MQ, WebSocket, or Electron mandatory. They may be introduced only when a concrete Phase 2 pain point requires them and only as ADR / optional spike, not as default dependencies.

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

## 1. Phase 2 Goal

Phase 2 moves the system from:

```txt
can create exams and candidates can complete happy-path attempts
```

to:

```txt
a real LAN/on-premise exam runtime that is correct under deadline,
refresh, disconnection, duplicate actions, admin intervention, and result publication.
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

### Scope Boundary

```txt
[ ] Phase 2 does NOT implement multiTenant, SuperAdmin, tenant switcher, organizationSlug login
[ ] Phase 2 does NOT implement API key, service token, webhook, CAS/OAuth
[ ] Phase 2 does NOT default-introduce Redis, MQ, WebSocket, Electron
[ ] Phase 2 does NOT implement camera/screen proctoring, AI grading, Electron lockdown
[ ] Phase 2 does NOT implement mobile-specific UI or large-scale distributed deployment
```

---

## 2. Phase 2.0 — Contract & Runtime Safety Gate

> **Priority**: P0 — must be completed before any Phase 2 feature work.
> **Rationale**: Discovery (03-openapi-contract-audit.md) found that most OpenAPI responses are generic `{}`. Phase 2 adds 15+ new APIs; without contract gate, the spec becomes untrustworthy.

Goal: prevent Phase 2 from adding more undocumented routes and unstable runtime behavior.

### Current State

- OpenAPI generated via `@fastify/swagger` in `apps/api/src/openapi/swagger.ts`
- 42 endpoints registered; 1 inline (`GET /api/health`) missing from spec
- Most 200/201 responses declared as `genericSuccessSchema` (`{ type: "object" }`) — no actual response shape
- Request body schemas use Zod for runtime validation but are not registered as Fastify `schema.body`
- Role requirements invisible in spec (no `security` or `x-role` annotations)
- Union responses (`SaveAnswer`) and conditional responses (`AttemptResultResponse`) have no `oneOf` representation

### Target State

- Every existing and new Phase 2 API has typed response schemas in OpenAPI
- Request body schemas registered as Fastify `schema.body` for auto-documentation
- Role metadata visible via `x-role` extension or `security` schemes
- Union/conditional responses represented with `oneOf`
- `GET /api/health` registered in swagger build

### Jobs

| Job     | Name                           | Description                                                                            | Discovery Ref |
| ------- | ------------------------------ | -------------------------------------------------------------------------------------- | ------------- |
| P2.0-J1 | Response Schema Registration   | Register Zod response schemas as Fastify `schema.response` for all existing endpoints  | 03 §3, §4.3   |
| P2.0-J2 | Request Body Schema Registration | Register Zod request schemas as Fastify `schema.body` for all endpoints with body     | 03 §3         |
| P2.0-J3 | RBAC Metadata in OpenAPI       | Add `x-role` or `security` metadata per route for Admin/Candidate role visibility       | 03 §5         |
| P2.0-J4 | Runtime Error Taxonomy         | Standardize deadline, submitted, conflict, forbidden, not found responses in OpenAPI   | 03 §6         |
| P2.0-J5 | Union/Conditional Response Fix | Add `oneOf` for `SaveAnswer` accepted/rejected and `AttemptResultResponse` two shapes  | 03 §4.3       |
| P2.0-J6 | Health Endpoint Registration   | Register `GET /api/health` in swagger build                                           | 03 §2         |
| P2.0-J7 | E2E Runtime Matrix Definition  | Define deadline, refresh, double-click, disrupted, force-submit, extend-time E2E cases | 05 §E         |

### Acceptance Criteria

```txt
[ ] SaveAnswer accepted/rejected union is represented in OpenAPI oneOf.
[ ] AttemptResultResponse conditional response (showResultImmediately) is documented.
[ ] CandidateExamSummary and LoadAttemptResponse shapes are in OpenAPI.
[ ] GET /api/health appears in OpenAPI spec.
[ ] Phase 2 APIs expose role/security metadata.
[ ] No new Phase 2 route returns generic `{}` in OpenAPI.
[ ] pnpm verify passes.
```

---

## 3. Phase 2A — Candidate Runtime Correctness

> **Priority**: P0 — blocking for any real exam usage.
> **Rationale**: Discovery (06-phase2-gap-analysis.md) found 5 P0 issues affecting whether a candidate can safely complete an exam.

Goal: fix all P0 issues that affect whether a candidate can safely complete an exam.

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

| Job    | Name                      | Description                                                                          | Discovery Ref |
| ------ | ------------------------- | ------------------------------------------------------------------------------------ | ------------- |
| P2A-J1 | Deadline Auto-Submit Scanner | Add server-side scanner: when `now > deadlineAt` and status is `in_progress`, submit + grade | 06 P0-1, 04 §6 |
| P2A-J2 | Atomic startAttempt       | Wrap `startAttempt` in `executeInTransaction` with `SELECT ... FOR UPDATE` on enrollment row | 06 P0-2, 04 §2 |
| P2A-J3 | Exam Open/Close Semantics | Implement check-on-access: `startAttempt` and `candidateExamState` trigger `openExam()`/`closeExam()` | 06 P0-3, 04 §1 |
| P2A-J4 | Client Deadline Awareness | `TakeExamPage` reads `deadlineAt`, disables editing, shows "已到截止时间" when deadline passed | 06 P0-5, 01 §4 |
| P2A-J5 | Restore Time Adjustment   | `restoreAttempt` adjusts `deadlineAt` to preserve remaining time                      | 04 §6         |
| P2A-J6 | Runtime Race Tests        | Add tests for double-click start, deadline crash, save/submit race, disrupted submit | 05 §E         |

### Acceptance Criteria

```txt
[ ] Concurrent start requests cannot create duplicate active attempts.
[ ] Expired in_progress attempts are submitted and graded server-side within scan interval.
[ ] Expired disrupted attempts have deterministic behavior (submit or leave disrupted per policy).
[ ] Client disables editing after deadline before local edits appear successful.
[ ] Candidate result page shows submitted/graded/status-only states correctly.
[ ] Restore preserves remaining time (deadlineAt adjusted correctly).
[ ] Tests cover browser crash at deadline.
[ ] Tests cover double-click start.
[ ] Tests cover save/submit race condition.
[ ] Exam transitions to open/closed based on openAt/closeAt without manual admin action.
[ ] pnpm verify passes.
```

---

## 4. Phase 2B — Admin / Proctor Operations

> **Priority**: P1 — core for real exam administration.
> **Rationale**: Discovery (01 §9, 06 P1-1 through P1-4) found no proctor UI, no force-submit, no extend-time, no misconduct flagging. All have backend infrastructure but zero frontend and no admin API.

Goal: allow Admin to monitor and intervene in live exam attempts without introducing new product roles yet.

### Current State

| Gap | Discovery Ref | Detail |
|-----|---------------|--------|
| No proctor dashboard | 01 §9, 05 C1 | No page, no route. Admin can see enrollment list in `ExamDetailPage` but no real-time candidate status. |
| No force-submit API | 06 P1-2, 04 §2 | `submitAttempt()` works on disrupted attempts, but no admin-initiated endpoint. |
| No extend-time API | 06 P1-3, 04 §2 | `deadlineAt` is set once at attempt creation. No mechanism to extend. |
| No misconduct flagging | 06 P1-4 | `MARK_MISCONDUCT` permission defined in RBAC, no API or UI. |
| Audit log API exists, no frontend | 06 P1-5, 01 §9 | `GET /api/admin/audit-logs` exists but no `/admin/audit-logs` page. |

### Target State

| Fix | Target |
|-----|--------|
| Proctor status API | `GET /admin/exams/:examId/proctor` — aggregated candidate status (active, disrupted, submitted, graded) |
| Polling proctor dashboard | `/admin/exams/:id/proctor` page with HTTP polling (no WebSocket dependency) |
| Force submit API + UI | `POST /admin/attempts/:attemptId/force-submit` — Admin can force-submit disrupted/in_progress attempts |
| Extend time API + UI | `POST /admin/attempts/:attemptId/extend-time` — Admin can extend `deadlineAt` with audit trail |
| Misconduct flag API + UI | `POST /admin/attempts/:attemptId/misconduct` — Admin can mark misconduct with notes |
| Audit log viewer | `/admin/audit-logs` page — search, filter, paginate existing audit logs |

### Jobs

| Job    | Name                      | Description                                                | Discovery Ref |
| ------ | ------------------------- | ---------------------------------------------------------- | ------------- |
| P2B-J1 | Proctor Status API        | Add exam attempt status summary API for Admin              | 06 P1-1, 05 C1 |
| P2B-J2 | Polling Proctor Dashboard | Add `/admin/exams/:id/proctor` page using HTTP polling first | 06 P1-1, 01 §9 |
| P2B-J3 | Force Submit API + UI     | Admin can force-submit in_progress/disrupted attempts      | 06 P1-2, 04 §2 |
| P2B-J4 | Extend Time API + UI      | Admin can extend deadlineAt with audit trail               | 06 P1-3, 04 §2 |
| P2B-J5 | Misconduct Flag API + UI  | Admin can mark misconduct and attach notes                 | 06 P1-4       |
| P2B-J6 | Audit Log Viewer          | Add `/admin/audit-logs` page using existing audit logs API | 06 P1-5, 01 §9 |
| P2B-J7 | Proctor Operation Tests   | Add route, domain, frontend, and E2E coverage              | 05 §E         |

### Non-Goals

```txt
[ ] No camera monitoring
[ ] No screen recording
[ ] No public internet remote proctoring
[ ] No independent Proctor role product path unless explicitly promoted later
[ ] No WebSocket dependency for proctor dashboard (HTTP polling first)
[ ] No real-time candidate status cards via WebSocket (polling is sufficient for Phase 2)
```

### Acceptance Criteria

```txt
[ ] Admin can see active, disrupted, submitted, graded candidates for an exam via polling.
[ ] Admin can force-submit an abandoned attempt; attempt transitions to submitted and is graded.
[ ] Admin can extend time; candidate UI reflects updated deadline within polling interval.
[ ] Admin can mark misconduct with audit metadata.
[ ] All proctor operations are audited (audit log entries created).
[ ] Polling dashboard works without WebSocket/SSE.
[ ] Audit log viewer page shows searchable, filterable audit trail.
[ ] pnpm verify passes.
```

---

## 5. Phase 2C — Timing & Paper Flexibility

> **Priority**: P1 — after runtime correctness and admin operations are stable.
> **Rationale**: Discovery (04 §1, 06 P0-4) found timing modes beyond `timed_window` are defined in enum but unsupported. Random selection is enforced as `manual` only.

Goal: implement exam modes and paper flexibility that are already modeled but not fully supported.

### Current State

| Gap | Discovery Ref | Detail |
|-----|---------------|--------|
| Only `timed_window` timing mode | 04 §1, 06 P0-4 | `publishExam` enforces `timingMode === "timed_window"`. `timed_sync`, `deadline`, `untimed` defined in enum but unsupported. |
| Only `manual` question selection | 06 P1-7 | `publishExam` enforces `questionSelectionMode === "manual"`. Random selection not implemented. |
| Limited retake policies | 06 P1-8 | Only `unlimited`, `max_attempts`, `pass_then_stop` supported. `daily_limit` and `weekly_limit` not implemented. |
| Score strategies not tested with retakes | 04 §3 | `highest`, `latest`, `first` exist but not verified with multiple attempts. |

### Target State

| Fix | Target |
|-----|--------|
| Timing modes | `timed_sync` (unified start/deadline), `deadline` (close-at only), `untimed` (no deadline) |
| Random paper builder | Question selection from pool rules → generated paper → frozen snapshot |
| Random snapshot freeze | Per-attempt question snapshot immutable after creation |
| Retake policies | `daily_limit`, `weekly_limit` with server-side counting |
| Score strategies | Verified with multiple retake attempts |

### Core Rule

```txt
selection rule → generated paper → frozen snapshot → attempt reads snapshot only
```

Random selection must never make attempts depend on mutable question-bank state.

### Jobs

| Job    | Name                      | Description                                                            | Discovery Ref |
| ------ | ------------------------- | ---------------------------------------------------------------------- | ------------- |
| P2C-J1 | Timing Mode Model Cleanup | Define exact semantics for `timed_window`, `timed_sync`, `deadline`, `untimed` | 04 §1, 06 P0-4 |
| P2C-J2 | timed_sync                | Unified start/deadline semantics for supervised exam sessions          | 06 P0-4       |
| P2C-J3 | deadline                  | Close-at only mode without per-attempt countdown                       | 06 P0-4       |
| P2C-J4 | untimed                   | Practice/simulation mode without deadline                              | 06 P0-4       |
| P2C-J5 | Random Paper Builder      | Build question snapshots from pool rules                               | 06 P1-7       |
| P2C-J6 | Random Snapshot Freeze    | Freeze per-attempt question snapshot                                   | 06 P1-7       |
| P2C-J7 | Retake Policies           | Implement `daily_limit` and `weekly_limit`                             | 06 P1-8       |
| P2C-J8 | Score Strategies          | Verify `highest`/`latest`/`first` with retake flows                   | 04 §3         |

### Acceptance Criteria

```txt
[ ] Each timing mode has backend tests and E2E coverage.
[ ] timed_sync: all candidates start at same time, deadline at same time.
[ ] deadline: exam closes at closeAt regardless of individual start time.
[ ] untimed: no deadline, candidate completes at own pace.
[ ] Random question selection creates immutable attempt snapshots.
[ ] Retake counting is based on persisted attempts, not frontend state.
[ ] daily_limit and weekly_limit are enforced server-side.
[ ] Score strategy is verified with multiple attempts.
[ ] pnpm verify passes.
```

---

## 6. Phase 2D — Grading & Results

> **Priority**: P1 — after timing and paper flexibility.
> **Rationale**: Discovery (04 §5, 06 P1-6) found all grading is auto; no interface for grading essay/subjective questions. Result publication has no policy control.

Goal: make scoring usable beyond fully automatic objective questions.

### Current State

| Gap | Discovery Ref | Detail |
|-----|---------------|--------|
| No manual grading | 04 §5, 06 P1-6 | All grading is auto via `gradeAnswers()`. Subjective questions (essay, code review) cannot be graded. |
| No partial grading | 04 §5 | Grading happens atomically on submit. No "grade some questions first" workflow. |
| No grading audit | 04 §5 | `gradingResult` is stored on attempt but individual grading decisions are not auditable. |
| No result publication policy | 04 §3 | `showResultImmediately` is per-exam; no after-grading or manual publish modes. |

### Target State

| Fix | Target |
|-----|--------|
| Manual grading model | Grading state for subjective/manual questions with per-question score entry |
| Grading queue | List attempts/questions requiring manual grading |
| Manual score UI | Admin enters scores and comments per question |
| Result publication policy | Immediate, after-grading, manual publish modes |
| Grading audit | Record grader, score changes, comments, timestamps |

### Jobs

| Job    | Name                      | Description                                           | Discovery Ref |
| ------ | ------------------------- | ----------------------------------------------------- | ------------- |
| P2D-J1 | Manual Grading Model      | Define grading state for subjective/manual questions  | 06 P1-6, 04 §5 |
| P2D-J2 | Grading Queue API         | List attempts/questions requiring manual grading      | 06 P1-6       |
| P2D-J3 | Manual Score UI           | Admin enters scores and comments                      | 06 P1-6       |
| P2D-J4 | Result Publication Policy | Define immediate, after-grading, manual publish modes | 04 §3         |
| P2D-J5 | Grading Audit             | Record grader, score changes, comments, timestamps    | 04 §5         |
| P2D-J6 | Score Visibility Tests    | Verify candidate/admin result shapes                  | 05 A8         |

### Acceptance Criteria

```txt
[ ] Auto-graded exams continue working without regression.
[ ] Manual questions do not incorrectly auto-complete as fully graded.
[ ] Candidate sees status-only result until grading is complete or published.
[ ] Admin can view and finalize grading via grading queue.
[ ] Score changes are auditable with grader identity and timestamps.
[ ] Result publication modes (immediate, after-grading, manual) work correctly.
[ ] pnpm verify passes.
```

---

## 7. Phase 2E — Operation Evidence & Export

> **Priority**: P2 — after core runtime, admin, timing, and grading are stable.
> **Rationale**: Discovery (01 §9, 06 P2-1 through P2-4) found audit log API exists but no frontend, no attempt timeline, CSV export is basic, no diagnostics page.

Goal: provide operational evidence for real exam administration.

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
| Attempt timeline | Show candidate attempt events: start, save, heartbeat, disrupt, restore, submit, grade |
| CSV hardening | Ensure large score CSV export is permission-checked and tested |
| Attempt detail export | Export answer details for one attempt |
| Import job logs | Persist candidate/question import summaries |
| Diagnostics page | Show runtime config, DB status, heartbeat scanner status, version info |

### Jobs

| Job    | Name                  | Description                                                                            | Discovery Ref |
| ------ | --------------------- | -------------------------------------------------------------------------------------- | ------------- |
| P2E-J1 | Audit Log UI          | Search/filter audit logs in admin UI                                                   | 06 P1-5, 01 §9 |
| P2E-J2 | Attempt Timeline      | Show candidate attempt events: start, save, heartbeat, disrupt, restore, submit, grade | 05 §D         |
| P2E-J3 | CSV Export Hardening  | Ensure large score CSV export is permission-checked and tested                         | 01 §3         |
| P2E-J4 | Attempt Detail Export | Export answer details for one attempt                                                  | 01 §3         |
| P2E-J5 | Import Job Logs       | Persist candidate/question import summaries                                            | 01 §9         |
| P2E-J6 | Diagnostics Page      | Show runtime config, DB status, heartbeat scanner status, version info                 | 01 §3         |

### Deferred

```txt
[ ] PDF export at scale
[ ] Email notification
[ ] Webhook
[ ] External integration
```

PDF export may be added only if it remains synchronous and small. Otherwise it requires a job queue decision.

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

## 8. Phase 2F — Infrastructure Decision Records

> **Priority**: ADR only — not implementation work.
> **Rationale**: Discovery (06 §Redis/MQ assessment) found no Phase 2 pain point requires Redis, MQ, or WebSocket as mandatory infrastructure.

Goal: avoid premature Redis/MQ complexity while leaving clear upgrade paths.

### Default Decision

```txt
[ ] PostgreSQL is the source of truth.
[ ] Redis is not required for Phase 2 single-instance LAN deployment.
[ ] MQ is not required for Phase 2 unless long-running async jobs are introduced.
[ ] Job Queue is not required unless PDF/email/bulk jobs become too slow for request lifecycle.
[ ] WebSocket/SSE is optional after polling dashboard works.
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
[ ] ADR-004: Electron shell (if lockdown browser needed)
```

---

## 9. Execution Order

```
Phase 2.0 Contract & Runtime Safety Gate          ← blocks all feature work
  ↓
Phase 2A Candidate Runtime Correctness            ← P0, blocking for real exam usage
  ↓
Phase 2B Admin / Proctor Operations (polling)     ← P1, core for exam administration
  ↓
Phase 2C Timing & Paper Flexibility               ← P1, after runtime correctness stable
  ↓
Phase 2D Grading & Results                        ← P1, after timing and paper flexibility
  ↓
Phase 2E Operation Evidence & Export              ← P2, after core runtime stable
  ↓
Phase 2F Infra ADR / optional spike              ← ADR only, no implementation unless triggered
```

**Hard rule**: Do not start WebSocket, Redis, MQ, PDF export, or Electron before Phase 2A P0 correctness is done.

**Dependency graph**:

```
P2.0 → P2A → P2B → P2C → P2D → P2E
                                   ↓
                                  P2F (ADR, not blocking)
```

P2B depends on P2A (force-submit requires atomic startAttempt and auto-submit to be stable).
P2C depends on P2A (timing modes depend on deadline correctness).
P2D depends on P2C (grading depends on attempt lifecycle being complete).
P2E depends on P2D (export depends on grading being complete).
P2F is independent and runs in parallel as ADR documentation.

---

## 10. Quality Gate

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
| P2B | 06-phase2-gap-analysis.md P1-1 through P1-5 | All P1 admin gaps closed with tests |
| P2C | 06-phase2-gap-analysis.md P0-4, P1-7, P1-8 | Timing modes and random selection working |
| P2D | 06-phase2-gap-analysis.md P1-6 | Manual grading workflow complete |
| P2E | 01-frontend-inventory.md §9, 05-user-flow-trace-map.md §D | Missing UIs implemented |

---

## 11. Deferred to Later Phases

```txt
[ ] MultiTenant product path                          (Phase 4)
[ ] SuperAdmin UI                                     (Phase 4)
[ ] Tenant switcher                                   (Phase 4)
[ ] organizationSlug login                            (Phase 4)
[ ] API Key / Service Token                           (Phase 4)
[ ] Webhooks                                          (Phase 4)
[ ] CAS/OAuth/SAML                                    (Phase 3)
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

---

## 12. Modification Summary

This plan was rewritten from the original feature-list style to a discovery-backed Phase 2 Runtime Closure plan. Key changes:

1. **Section numbering aligned**: Sections 0-11 now match the required structure exactly (Entry Criteria → Goal → Contract Gate → 2A-2F → Execution Order → Quality Gate → Deferred).

2. **Discovery references added**: Every gap, job, and acceptance criterion references specific discovery documents (01-frontend-inventory, 02-backend-api-inventory, 03-openapi-contract-audit, 04-state-machine-audit, 05-user-flow-trace-map, 06-phase2-gap-analysis) with section/paragraph citations.

3. **Current / Target / Acceptance Criteria structure**: Each phase now explicitly states what exists today (Current), what it should become (Target), and how to verify (Acceptance Criteria) — no unverified claims.

4. **OpenAPI promoted to P2.0**: Moved from P2 nice-to-have (old §2) to P2.0 Contract Gate with 7 concrete jobs backed by discovery 03 findings (generic `{}` responses, missing health endpoint, no RBAC metadata).

5. **Proctor Panel = HTTP polling first**: Old plan mentioned polling but didn't enforce it. New plan explicitly states WebSocket is not a Phase 2 dependency; polling dashboard must work before any real-time consideration.

6. **Admin/Proctor operations expanded**: Added explicit jobs for proctor status API, force submit, extend time, misconduct flag, audit log viewer — all backed by discovery 06 P1-1 through P1-5.

7. **Timing/Flexibility reordered**: Moved after runtime correctness and admin operations, reflecting dependency reality (P2C depends on P2A deadline correctness).

8. **Grading/Results separated**: Dedicated Phase 2D with explicit manual grading model, grading queue, manual score UI, result publication policy, and grading audit — backed by discovery 04 §5 and 06 P1-6.

9. **Operation Export moved to last**: Phase 2E now explicitly depends on P2D being complete.

10. **Redis/MQ/WebSocket governance tightened**: Phase 2F now requires ADRs before any spike; revisit triggers are backed by discovery 06 Redis/MQ assessment table.

11. **Execution order hardened**: Added dependency graph and hard rule — no WebSocket/Redis/MQ/PDF/Electron before P2A P0 correctness.

12. **Quality gate enhanced**: Added discovery-backed verification table mapping each phase to its source discovery document.
