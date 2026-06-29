# Phase 2 Job Index

> Generated from `docs/phase2/phase2.plan.md` and discovery documents.
> This index is the authoritative task list for Phase 2 — Exam Operation Runtime.

---

## Overview

| Job ID | Name | Phase | Type | Depends on | Blocks | Scope | Risk | Estimated PR Size |
| ------ | ---- | ----- | ---- | ---------- | ------ | ----- | ---- | ----------------- |
| P2-PLAN-J1 | Phase 2 Plan Finalization | PLAN | docs-only planning job | — | P2.0-J1 | Align plan with discovery, no code | Low | S |
| P2.0-J1 | OpenAPI Contract Baseline & Runtime Gate | 2.0 | OpenAPI / contract job | P2-PLAN-J1 | P2A-J1, P2A-J6, P2B-J1, P2C-J1, P2D-J1, P2E-J1 | Full OpenAPI contract repair for all 42 routes; no behavior change | Medium | L |
| P2A-J1 | Atomic startAttempt | 2A | backend state-machine job, DB / repository / transaction job | P2.0-J1 | P2A-J2, P2A-J6 | Transaction + lock around startAttempt; prevent duplicate attempts | High | S |
| P2A-J2 | Server-Side Deadline Auto-Submit | 2A | backend API / route job, backend state-machine job | P2A-J1 | P2A-J6, P2C-J2 | Scanner submits + grades expired in_progress attempts | High | M |
| P2A-J3 | Client Deadline Awareness | 2A | frontend UI job | P2A-J2 | P2A-J6 | TakeExamPage disables editing at deadline; shows final state | Medium | S |
| P2A-J4 | Exam Open/Close Semantics | 2A | backend state-machine job | P2A-J1 | P2A-J6, P2B-J2 | Check-on-access auto-transition published to open to closed | Medium | S |
| P2A-J5 | Restore Runtime Semantics | 2A | backend state-machine job | P2A-J1 | P2A-J6 | restoreAttempt preserves remaining time by adjusting deadlineAt | Medium | S |
| P2A-J6 | Candidate Runtime E2E Matrix | 2A | E2E / regression job | P2A-J1, P2A-J2, P2A-J3, P2A-J4, P2A-J5 | P2B-J1, P2C-J8 | Abnormal path E2E: refresh, disconnect, double-click, deadline crash, race | High | M |
| P2B-J0 | Exam Operation State Baseline (ADR) | 2B | docs-only planning job, infra ADR job | P2B-J1, P2A-J4 | P2B-J2a | ADR-005 (Rev 2): three-axis state model, mandatory lock-reconcile-assert-mutate rule, close active-attempt policy, stale-state protection, runtime timing policy, submitAttempt guard ordering. Sliced 1–4. Design only — no production code. | Low | S |
| P2B-J1 | Admin Operation Flow Audit | 2B | E2E / regression job, planning / audit job | P2A-J6, P2B-J0 | P2B-J2a | Verify end-to-end admin loop; identify gaps | Low | S |
| P2B-J2a | Exam Op Slice 1 — Close Baseline | 2B | backend API / route job, backend state-machine job, frontend UI job | P2B-J0, P2B-J1, P2A-J4 | P2B-J2b, P2C-J1, P2C-J5 | POST /exams/:id/close with lock-reconcile-assert-mutate + active-attempt guard (ACTIVE_ATTEMPTS_EXIST). Scores/export also require no unfinalized attempts. Unblocks P2B-J1 E2E; removes endingSoonSec workaround. | High | M |
| P2B-J2b | Exam Op Slice 2 — Unpublish / Schedule / Extend | 2B | backend API / route job, frontend UI job | P2B-J2a | P2B-J2c | POST /exams/:id/unpublish (stale-guarded), /extend (stale-guarded); PATCH published schedule-only (openAt/closeAt). | Medium | M |
| P2B-J2c | Exam Op Slice 3 — Timing Policy | 2B | backend API / route job, DB / repository / transaction job | P2B-J2b | P2C-J2 | latestStartOffsetMinutes + minSubmitAfterStartMinutes (DB/schema/contracts/OpenAPI); late-entry cutoff (new start only); min-submit guard with idempotent-first ordering; SubmitSource discriminator. | High | M |
| P2B-J2d | Exam Op Slice 4 — Cancel (likely deferred) | 2B | backend API / route job | P2B-J2c | — | canceled state + POST /exams/:id/cancel + cancellation export marker. Deferred unless voiding/marker semantics decided; amend ADR-005 first. | Low | M |
| P2C-J1 | Heartbeat and Disrupted Detection Hardening | 2C | DB / repository / transaction job | P2A-J2, P2B-J2 | P2C-J2, P2C-J3, P2C-J4, P2C-J5 | Stabilize scanner; add transaction; audit log disruptions | Medium | S |
| P2C-J2 | Force Submit | 2C | backend API / route job, frontend UI job | P2C-J1 | P2C-J8 | Admin force-submits attempt; state transition + audit | Medium | M |
| P2C-J3 | Extend Time | 2C | backend API / route job, frontend UI job | P2C-J1 | P2C-J8 | Admin extends deadline; candidate sync contract | Medium | M |
| P2C-J4 | Misconduct Flag | 2C | backend API / route job, DB / repository / transaction job, frontend UI job | P2C-J1 | P2C-J8 | Flag misconduct with notes; audit; migration needed | Low | M |
| P2C-J5 | Polling Proctor Dashboard | 2C | frontend UI job, backend API / route job | P2C-J1, P2B-J2, P2C-J2, P2C-J3, P2C-J4 | P2C-J8 | HTTP polling dashboard; candidate status cards; action buttons wired to J2/J3/J4 APIs | Medium | M |
| P2C-J8 | Proctor Runtime E2E | 2C | E2E / regression job | P2C-J2, P2C-J3, P2C-J4, P2C-J5 | P2D-J1 | E2E for disrupted, force submit, extend time, misconduct | Medium | M |
| P2D-J1 | Objective Grading Stabilization | 2D | E2E / regression job | P2A-J6, P2C-J8 | P2D-J2, P2D-J3, P2D-J4, P2D-J5, P2D-J6 | Keep auto-grading stable; add regression tests | Low | S |
| P2D-J2 | Manual Grading Model | 2D | backend state-machine job, DB / repository / transaction job, OpenAPI / contract job | P2D-J1 | P2D-J3, P2D-J4 | Domain model for manual scores; per-question grading state | Medium | M |
| P2D-J3 | Grading Queue API | 2D | backend API / route job, OpenAPI / contract job | P2D-J2 | P2D-J4, P2D-J6 | List attempts/questions needing manual grading | Medium | M |
| P2D-J4 | Manual Grading UI | 2D | frontend UI job | P2D-J3 | P2D-J6 | Admin score input per question; comments | Medium | M |
| P2D-J5 | Result Publishing Policy (SPLIT BEFORE CONSTRUCTION) | 2D | backend state-machine job, backend API / route job, DB / repository / transaction job, OpenAPI / contract job, frontend UI job | P2D-J1 | P2D-J6 | Immediate / after-grading / manual publish modes + score policy verification + candidate/admin result visibility. Breaking migration: showResultImmediately → resultPublicationMode. Split into P2D-J5a/J5b/J5c before construction. | Medium | M |
| P2D-J6 | Grading Audit | 2D | backend API / route job | P2D-J3, P2D-J5 | P2E-J1 | Record grader, score changes, timestamps | Low | S |
| P2E-J1 | Audit Log Viewer | 2E | frontend UI job | P2D-J6 | — | Searchable/filterable audit log UI | Low | M |
| P2E-J2 | Attempt Timeline | 2E | backend API / route job, frontend UI job | P2D-J6 | — | Show attempt lifecycle events chronologically | Low | M |
| P2E-J3 | Score CSV Hardening | 2E | backend API / route job, E2E / regression job | P2D-J6 | — | Permission, size, correctness tests for CSV export | Low | S |
| P2E-J4 | Attempt Detail Export | 2E | backend API / route job, frontend UI job | P2D-J6 | — | Export answers/results for one attempt | Low | M |
| P2E-J5 | Import Job Logs | 2E | backend API / route job, DB / repository / transaction job, frontend UI job | P2B-J2 | — | Persist candidate/question import summaries | Low | M |
| P2E-J6 | Diagnostics Page | 2E | frontend UI job | P2B-J2 | — | Runtime config, DB status, heartbeat scanner status | Low | S |
| P2F-J1 | Infra ADRs | 2F | infra ADR job, docs-only planning job | — | — | Redis, Job Queue, WebSocket/SSE, Desktop/Electron ADRs | Low | S |

---

## Execution Order

```
P2-PLAN-J1  ->  P2.0-J1
                     |
                P2A-J1
                     |
       +-------------+-------------+
       |             |             |
    P2A-J2       P2A-J4        P2A-J5
       |             |             |
    P2A-J3           |             |
       |             |             |
       +-------------+-------------+
                     |
                P2A-J6 (completes 2A)
                     |
    P2B-J0 -> P2B-J1 -> P2B-J2 (SPLIT BEFORE CONSTRUCTION: J2a/J2b/J2c)
                     |
    P2C-J1 -> P2C-J2 / P2C-J3 / P2C-J4 (parallel)
                     |
    P2C-J5 (needs P2C-J1 + P2B-J2 + P2C-J2 + P2C-J3 + P2C-J4)
                     |
    P2C-J8
                     |
    P2D-J1 -> P2D-J2 -> P2D-J3 -> P2D-J4
                     |
    P2D-J5 (SPLIT BEFORE CONSTRUCTION: J5a/J5b/J5c) -> P2D-J6
                     |
    P2E-J1 / P2E-J2 / P2E-J3 / P2E-J4 / P2E-J5 / P2E-J6 (parallel after P2D-J6 + P2B-J2)

P2F-J1 runs in parallel with everything (ADR only, no code)
```

---

## Jobs by Phase

| Phase | Jobs | Priority | Risk Profile |
|-------|------|----------|--------------|
| PLAN | P2-PLAN-J1 | — | Low |
| 2.0 | P2.0-J1 | P0 gate | Medium |
| 2A | P2A-J1, P2A-J2, P2A-J3, P2A-J4, P2A-J5, P2A-J6 | P0 | High (J1, J2, J6) |
| 2B | P2B-J1, P2B-J2 | P1 | Medium |
| 2C | P2C-J1, P2C-J2, P2C-J3, P2C-J4, P2C-J5, P2C-J8 | P1 | Medium |
| 2D | P2D-J1, P2D-J2, P2D-J3, P2D-J4, P2D-J5, P2D-J6 | P1 | Medium |
| 2E | P2E-J1, P2E-J2, P2E-J3, P2E-J4, P2E-J5, P2E-J6 | P2 | Low |
| 2F | P2F-J1 | ADR | Low |

---

## High-Risk Jobs

| Job ID | Risk | Reason |
|--------|------|--------|
| P2A-J1 | High | Race condition fix; transaction boundary change; must not break existing start flow |
| P2A-J2 | High | Deadline scanner touches grading pipeline; must be idempotent; browser-crash E2E is hard |
| P2A-J6 | High | E2E matrix covers abnormal paths; flaky if not deterministic |
| P2.0-J1 | Medium | Large surface area (42 routes); mechanical but easy to miss one route; must not change behavior |

---

## Jobs Requiring Migration

| Job ID | Migration Needed | Tables / Columns |
|--------|------------------|------------------|
| P2A-J2 | Maybe | exam_attempts (if adding deadline scanner tracking) |
| P2D-J2 | Yes | New table or columns for manual grading state |
| P2D-J5 | Yes | exams: add resultPublicationMode enum, resultsPublishedAt timestamp; backfill from showResultImmediately |
| P2E-J2 | Maybe | audit_logs or new attempt_events table |
| P2E-J5 | Yes | New import_job_logs table |

Note: Maybe means the job spec should evaluate during planning whether a migration is truly required.

---

## Jobs Requiring E2E

| Job ID | E2E Scope |
|--------|-----------|
| P2A-J6 | Refresh, disconnect, double-click start, deadline crash, save/submit race |
| P2B-J1 | Admin setup -> assignment -> publish -> score -> export loop |
| P2C-J8 | Disrupted detection, force submit, extend time, misconduct flag |
| P2D-J4 | Manual grading workflow |
| P2D-J5 | Result publication modes |
| P2E-J3 | Large CSV export |

---

## Jobs Requiring OpenAPI / Contract Changes

| Job ID | Contract Scope |
|--------|----------------|
| P2.0-J1 | All 42 routes — baseline repair |
| P2A-J1 | StartAttempt request/response (if adding fields) |
| P2A-J2 | New scanner internals may not need API; document if adding admin status endpoint |
| P2A-J4 | Exam status transitions in candidate responses |
| P2A-J5 | Restore response (deadlineAt adjustment visible) |
| P2C-J2 | Force Submit API |
| P2C-J3 | Extend Time API |
| P2C-J4 | Misconduct Flag API |
| P2C-J5 | Proctor dashboard polling API |
| P2D-J2 | Manual grading model contracts |
| P2D-J3 | Grading Queue API |
| P2D-J5 | Result publishing policy contracts |
| P2E-J2 | Attempt timeline API |
| P2E-J4 | Attempt detail export API |
| P2E-J5 | Import job logs API |

---

## Jobs Requiring ADR

| Job ID | ADR Scope |
|--------|-----------|
| P2F-J1 | ADR-001 Redis, ADR-002 WebSocket/SSE, ADR-003 Job Queue, ADR-004 Desktop/Electron |

---

## Recommended First 3 PRs

1. **P2-PLAN-J1** — Phase 2 Plan Finalization (docs only; quick win; aligns team)
2. **P2.0-J1** — OpenAPI Contract Baseline (blocks all feature work; high ROI)
3. **P2A-J1** — Atomic startAttempt (smallest P0 backend fix; unblocks candidate runtime)

---

## Ambiguity / Missing Source Information

1. OpenAPI generation mechanism: The swagger build uses a separate Fastify instance with no-op decorators. Some route metadata may need to be registered differently for OpenAPI vs runtime. Exact registration pattern needs confirmation during P2.0-J1.
2. Frontend component inventory depth: `01-frontend-inventory.md` lists pages and APIs but does not list all internal component props. Jobs touching frontend may need additional component-level discovery.
3. Demo seed data for abnormal paths: E2E jobs (P2A-J6, P2C-J8) require seed data for disrupted attempts, expired attempts, etc. Exact seed file locations and factory patterns need confirmation.
4. Manual grading DB schema: No prior schema exists for subjective/manual question grading. P2D-J2 must design from scratch.
5. Import job log persistence: Current import endpoints return summaries but do not persist them. P2E-J5 must design a new persistence model.
6. Attempt timeline data source: Audit logs exist but are not structured as a timeline. P2E-J2 must decide whether to query audit_logs or create a dedicated event stream.
7. Result publishing policy field: P2D-J5 will replace `showResultImmediately` (boolean) with `resultPublicationMode` (enum: `immediate | after_grading | manual`). Migration backfill: `CASE WHEN showResultImmediately THEN 'immediate' ELSE 'manual' END`.
8. Schema file path: Job cards reference `packages/db/src/schema/pg.ts` for construction locations. This is the actual schema definition file; `packages/db/src/schema.ts` is a barrel re-export (`export { schema } from "./schema/pg.js"`). Both paths are valid — `schema/pg.ts` is the edit location, `schema.ts` is the import path. No SQLite schema file exists (Phase 1 J9 switched prod default to PostgreSQL; SQLite is dev/CI only and shares the same Drizzle schema).
9. JSONB columns: `schema/pg.ts` uses PostgreSQL `jsonb` column type. SQLite (dev/CI) maps `jsonb` to `text` via Drizzle's dialect abstraction. This is acceptable as long as no raw `jsonb`-specific SQL is written outside the schema layer.

---

## Jobs Marked SPLIT BEFORE CONSTRUCTION

| Job ID | Split Into | Reason |
|--------|------------|--------|
| P2B-J2 | P2B-J2a (Publish/Open/Close/Archive Alignment), P2B-J2b (Exam Setup + Assignment Validation), P2B-J2c (Management Hardening + Score Overview) | Absorbs 5 independent capabilities; too broad for single PR |
| P2D-J5 | P2D-J5a (Backend Model + Migration + API), P2D-J5b (Candidate ResultPage Visibility), P2D-J5c (Admin ExamCreatePage Mode Selector) | 5 layers, 7 files, breaking boolean→enum migration |
