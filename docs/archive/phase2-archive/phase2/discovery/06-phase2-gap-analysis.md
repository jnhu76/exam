# Phase 2 Gap Analysis — Based on Phase 1 Fact Tables

> Derived from code-level audit. Not based on documents — based on actual implementation.

## P0: Affects Candidate Exam Loop or Data Correctness

### P0-1. No Server-Side Auto-Submit at Deadline
- **Current**: If candidate's browser crashes at deadline, attempt stays `in_progress` → heartbeat scanner marks `disrupted` → never submitted → score never computed
- **Impact**: Candidate loses their answers and score permanently
- **Code gap**: `heartbeat.ts` only calls `markDisrupted()`, never `submitAttempt()`
- **Fix**: Add auto-submit logic in heartbeat scanner or a separate deadline scanner. When `now > deadlineAt` and status is `in_progress`, submit + grade.

### P0-2. startAttempt Not Atomic (Double-Click Race)
- **Current**: `startAttempt()` calls `findByEnrollment` then `create` without transaction or lock
- **Impact**: Two concurrent requests could create duplicate attempts for the same enrollment
- **Code gap**: `attemptCommands.ts:61-143` — no `executeInTransaction`, no `findByIdForUpdate`
- **Fix**: Wrap `startAttempt` in `executeInTransaction` with `SELECT ... FOR UPDATE` on enrollment row

### P0-3. Exam Status Never Transitions to `open` or `closed`
- **Current**: `openExam()` and `closeExam()` exist in code but no API or scheduler triggers them
- **Impact**: All exams stay `published` forever. The time-window gating works via candidate-level check (`now >= openAt && now < closeAt`), but exam status is misleading
- **Code gap**: No route or cron for `openExam`/`closeExam`
- **Fix (Phase 2)**: Add time-based status transition — either a scheduler or check-on-access pattern

### P0-4. No `timed_sync`, `deadline`, `untimed` Timing Modes
- **Current**: `publishExam` enforces `timingMode === "timed_window"`. Other modes are defined in enum but unsupported
- **Impact**: Feature gap for Phase 2 flexibility
- **Fix**: Implement each timing mode with appropriate timer logic

### P0-5. Save Answer Deadline Check Is Server-Only
- **Current**: Server rejects saves after deadline, but client continues showing questions and allowing edits until save fails
- **Impact**: User experience confusion — edits appear to succeed locally but fail on save
- **Fix**: Client should also check deadline and disable editing when deadline passed

## P1: Affects Admin Loop or Proctor Experience

### P1-1. No Proctor Dashboard / Real-Time Monitoring
- **Current**: Admin can see enrollment list in ExamDetailPage but no real-time candidate status
- **Impact**: Cannot monitor live exam, cannot force-submit, cannot extend time
- **Missing**: WebSocket/SSE for live status, candidate status cards, event stream

### P1-2. No Force Submit API
- **Current**: `submitAttempt()` works on disrupted attempts, but no admin-initiated endpoint
- **Impact**: Admin cannot force-submit a candidate who has abandoned the exam
- **Missing**: `POST /admin/attempts/:id/force-submit` with Admin role check

### P1-3. No Extend Time API
- **Current**: `deadlineAt` is set once at attempt creation. No mechanism to extend
- **Impact**: Admin cannot grant extra time for特殊情况
- **Missing**: `POST /admin/attempts/:id/extend-time` + DB update + client sync

### P1-4. No Misconduct Flagging
- **Current**: `MARK_MISCONDUCT` permission defined in RBAC, no API or UI
- **Impact**: Cannot flag or record exam misconduct incidents
- **Missing**: API + UI for misconduct events

### P1-5. Audit Log Viewer Missing from Frontend
- **Current**: `GET /api/admin/audit-logs` API exists, no frontend page
- **Impact**: Admin cannot browse audit trail in UI
- **Missing**: `/admin/audit-logs` page

### P1-6. No Manual / Subjective Grading
- **Current**: All grading is auto via `gradeAnswers()`. No interface for grading essay/subjective questions
- **Impact**: Questions without `standardAnswer` cannot be used in auto-graded exams
- **Missing**: Grading queue, manual score input, grading workflow

### P1-7. Question Random Selection Mode
- **Current**: `publishExam` enforces `questionSelectionMode === "manual"`
- **Impact**: Cannot create randomized exams from question pool
- **Missing**: Random selection logic, per-candidate question snapshot variation

### P1-8. Retake Policy Limited
- **Current**: Only `unlimited`, `max_attempts`, `pass_then_stop` supported
- **Impact**: `daily_limit` and `weekly_limit` not implemented
- **Missing**: Time-based retake counting logic

### P1-9. In-Memory Queue Lost on Restart
- **Current**: `examQueues` Map in `attempts.ts:83` — process-memory only
- **Impact**: Queue state lost on server restart. Candidates in queue lose position
- **Missing**: Persistent queue (Redis or DB-backed)

### P1-10. Heartbeat Scanner Not Resilient
- **Current**: `scanRunning` flag prevents overlap, but long scans could miss beats
- **Impact**: If scan takes > interval, candidates' disruptions are delayed
- **Missing**: More robust scanning (distributed lock or queue-based)

## P2: Experience Optimization, Refactoring, Documentation

### P2-1. OpenAPI Response Schemas Are Generic
- **Current**: Most responses declared as `{ type: "object" }` — no typed schemas
- **Impact**: API consumers cannot generate typed clients
- **Fix**: Register Zod schemas as Fastify `schema.response` or write explicit JSON Schema

### P2-2. RBAC Not Reflected in OpenAPI
- **Current**: Role requirements are code-level only, not in spec
- **Impact**: API docs don't show which roles can call which endpoints
- **Fix**: Add `security` schemes or `x-role` extensions

### P2-3. Frontend `PlaceholderPage` for Unknown Routes
- **Current**: `/admin/*` and `/exam/*` catch-all routes show placeholder
- **Impact**: Dead UI for unmatched routes
- **Fix**: Remove or replace with proper 404 pages

### P2-4. No PDF Export
- **Current**: Only CSV export exists
- **Fix**: Add PDF generation for score reports

### P2-5. No Email Notifications
- **Current**: No email system
- **Fix**: Add email for exam invitations, results, password reset (Phase 3)

### P2-6. No Batch Operations on Candidates/Exams
- **Current**: Individual CRUD only (except import)
- **Fix**: Batch status changes, batch enrollment, batch delete

### P2-7. Client-Side Pagination for Some Lists
- **Current**: Some lists load all then paginate client-side (e.g., question filters in exam create)
- **Fix**: Move to server-side pagination consistently

### P2-8. No Optimistic UI Updates
- **Current**: Most mutations wait for server response before updating UI
- **Fix**: Add optimistic updates for better perceived performance

## Redis / MQ / Job Queue Assessment

### Current Pain Points That Might Need Infrastructure

| Pain Point | Current Solution | Scalability Concern | Need Redis/MQ? |
|-----------|-----------------|-------------------|----------------|
| **In-memory queue** (`examQueues` Map) | Process-memory Map | Lost on restart, single-instance only | **Yes — for multi-instance queue** |
| **Heartbeat scanner** (`setInterval`) | Process-level timer | Works for single instance, no distribution | **No — single instance is fine for Phase 2** |
| **Session/JWT** | Cookie + JWT in memory | Stateless, no server-side session store needed | **No** |
| **Rate limiting** | In-memory rate limiter | Lost on restart, single-instance only | **Maybe — if multi-instance needed** |
| **Exam status transitions** | Check-on-access pattern | Works without scheduler | **No — check-on-access is sufficient** |
| **Background grading** | Inline in submit request | Synchronous, blocks response | **Maybe — if grading becomes slow** |
| **Export generation** | Synchronous CSV | Fine for small datasets | **No — CSV is lightweight** |

### Recommendation

| Item | Decision | Rationale |
|------|----------|-----------|
| **Redis** | **Not needed for Phase 2** unless multi-instance deployment is planned | Single-instance LAN deployment. In-memory queue is acceptable. If multi-instance, use Redis for queue + rate limiting + session. |
| **MQ (Message Queue)** | **Not needed for Phase 2** | No async jobs currently. Grading is synchronous and fast. If subjective grading or batch operations are added, reconsider. |
| **Job Queue** | **Not needed for Phase 2** | All operations complete within request lifecycle. No long-running tasks. If PDF export or email is added, consider. |

### When to Revisit

| Trigger | Action |
|---------|--------|
| Multi-instance deployment needed | Add Redis for queue + rate limiting |
| Subjective/manual grading added | Add job queue for grading workflow |
| Email notifications added | Add job queue for email sending |
| PDF export at scale | Add job queue for async generation |
| 1000+ concurrent candidates per exam | Evaluate heartbeat scanner distribution |

## Summary: Phase 2 Priority Map

```
P0 (Must Fix Before Phase 2 Release):
  ├── P0-1  Auto-submit at deadline
  ├── P0-2  Atomic startAttempt
  ├── P0-3  Exam status transitions (open/close)
  ├── P0-4  Additional timing modes
  └── P0-5  Client-side deadline awareness

P1 (Should Fix for Phase 2 Core):
  ├── P1-1  Proctor dashboard (real-time)
  ├── P1-2  Force submit API
  ├── P1-3  Extend time API
  ├── P1-4  Misconduct flagging
  ├── P1-5  Audit log viewer
  ├── P1-6  Manual grading
  ├── P1-7  Random question selection
  ├── P1-8  Additional retake policies
  ├── P1-9  Persistent queue
  └── P1-10 Resilient heartbeat scanner

P2 (Nice to Have / Deferred):
  ├── P2-1  OpenAPI typed schemas
  ├── P2-2  RBAC in OpenAPI
  ├── P2-3  Remove placeholder pages
  ├── P2-4  PDF export
  ├── P2-5  Email notifications
  ├── P2-6  Batch operations
  ├── P2-7  Server-side pagination
  └── P2-8  Optimistic UI updates
```
