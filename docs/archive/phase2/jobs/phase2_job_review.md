# Phase 2 SDD Job Review

> Review date: 2026-06-16
> Scope: `docs/phase2/phase2.plan.md`, `docs/phase2/jobs/phase2_job_index.md`, all `docs/phase2/jobs/*.md`, all `docs/phase2/discovery/*.md`.
> This is a documentation-only review. No production code was modified.

---

## 1. Discovery Gap Coverage

Source: `06-phase2-gap-analysis.md`, `04-state-machine-audit.md`, `01-frontend-inventory.md`, `05-user-flow-trace-map.md`.

| Gap | Source | Severity | Covered in Plan | Job ID | Verdict | Notes |
|-----|--------|----------|-----------------|--------|---------|-------|
| P0-1 No server-side auto-submit at deadline | 06 P0-1, 04 §6 | P0 | Yes | P2A-J2 | PASS | Card complete; disrupted-state policy underspecified |
| P0-2 startAttempt not atomic (double-click) | 06 P0-2, 04 §2 | P0 | Yes | P2A-J1 | PASS | Card solid; transaction + FOR UPDATE specified |
| P0-3 Exam status never transitions to open/closed | 06 P0-3, 04 §1 | P0 | Yes | P2A-J4 | PASS | Check-on-access pattern; no concurrency test required |
| P0-4 No timed_sync / deadline / untimed modes | 06 P0-4 | P0 | **No** | — | **BLOCKER** | Plan mentions Phase 1 only does `timed_window` but Phase 2 has no job for additional modes. Either add a job or explicitly defer to Phase 3 in plan §12 |
| P0-5 Client-side deadline awareness | 06 P0-5, 01 §4 | P0 | Yes | P2A-J3 | PASS | Clock drift acknowledged but unmitigated |
| Restore does not adjust deadlineAt | 04 §6 | P0 | Yes | P2A-J5 | NEEDS FIX | No transaction/lock on restoreAttempt — real race condition risk |
| P1-1 No proctor dashboard | 06 P1-1, 01 §9, 05 C1 | P1 | Yes | P2C-J5 | PASS | Creates both API and UI in one PR — consider split |
| P1-2 No force-submit API | 06 P1-2, 04 §2 | P1 | Yes | P2C-J2 | NEEDS FIX | Idempotent-vs-409 error semantics contradiction |
| P1-3 No extend-time API | 06 P1-3, 04 §2 | P1 | Yes | P2C-J3 | NEEDS FIX | No transaction/lock; deadlineAt may exceed exam.closeAt |
| P1-4 No misconduct flagging | 06 P1-4 | P1 | Yes | P2C-J4 | NEEDS FIX | Schema path `pg.ts` violates DB-agnostic rule; classification missing DB box |
| P1-5 Audit log viewer missing | 06 P1-5, 01 §9 | P1 | Yes | P2E-J1 | PASS | Clean frontend-only job |
| P1-6 No manual grading | 06 P1-6, 04 §5 | P1 | Yes | P2D-J2, P2D-J3, P2D-J4 | PASS | Model → API → UI pipeline correct; J2 unique-constraint checkbox bug |
| P1-7 Question random selection | 06 P1-7 | P1 | **No** | — | PARKED | Not in plan or index. Should be explicitly deferred in plan §12 |
| P1-8 Retake policy limited (daily/weekly) | 06 P1-8 | P1 | **No** | — | PARKED | Plan has no job. Should be explicitly deferred |
| P1-9 In-memory queue lost on restart | 06 P1-9 | P1 | Yes (ADR) | P2F-J1 | PASS | ADR-only is correct per plan §8 |
| P1-10 Heartbeat scanner not resilient | 06 P1-10, 04 §6 | P1 | Yes | P2C-J1 | NEEDS FIX | Classification should be DB/repository/transaction not API/route |
| P2-1 OpenAPI generic responses | 06 P2-1, 03 §3 | P2 | Yes | P2.0-J1 | PASS | Correctly elevated to P0 gate |
| P2-2 RBAC not in OpenAPI | 06 P2-2, 03 §5 | P2 | Yes | P2.0-J1 | PASS | |
| P2-3 PlaceholderPage cleanup | 06 P2-3 | P2 | **No** | — | PARKED | Cosmetic; acceptable to defer but should be noted |
| P2-4 PDF export | 06 P2-4 | P2 | Yes (deferred) | — | PASS | Correctly in plan §12 deferred list |
| P2-5 Email notifications | 06 P2-5 | P2 | Yes (deferred) | — | PASS | |
| P2-6 Batch operations | 06 P2-6 | P2 | **No** | — | PARKED | Not in plan or index. Should be noted |
| P2-7 Server-side pagination | 06 P2-7 | P2 | **No** | — | PARKED | Cosmetic |
| P2-8 Optimistic UI | 06 P2-8 | P2 | **No** | — | PARKED | Cosmetic |
| Heartbeat scan best-effort (no tx/retry) | 04 §6, 02 §16 | P1 | Yes | P2C-J1 | PASS | |
| Save/submit race not E2E tested | 05 §E | P1 | Yes | P2A-J6 | PASS | E2E matrix covers it |
| Server restart during attempt | 05 §E | P1 | **No** | — | PARKED | Not covered in any E2E job |
| IP restriction UI | 01 §9 | P2 | **No** | — | PARKED | controlFlags exists, no UI |
| Queue management UI | 01 §9 | P2 | **No** | — | PARKED | controlFlags exists, no UI. Plan says Phase 2 |

### Summary

- **BLOCKER**: P0-4 (additional timing modes) is listed as P0 in discovery but has no job anywhere. The plan must either add a job or move it to §12 Deferred with explicit reasoning.
- **PARKED**: 8 gaps have no job and no explicit deferral. These should be documented in plan §12 as deferred to avoid ambiguity.
- **NEEDS FIX**: 6 gaps have jobs with state-machine or transaction correctness concerns.

---

## 2. Phase Plan Coverage

Source: `phase2.plan.md` §2–§8 vs `phase2_job_index.md`.

### 2.0 OpenAPI Contract Baseline

| Phase | Capability (plan) | Job ID | Missing? | Notes |
|-------|-------------------|--------|----------|-------|
| 2.0 | Route coverage baseline | P2.0-J1 | No | Index consolidated plan's 9 sub-jobs (J1–J9) into single mega-job. **Numbering conflict**: plan P2.0-J1 means "Route Coverage Baseline" but index P2.0-J1 means entire OpenAPI baseline. This is confusing but intentional consolidation. |
| 2.0 | Request schema registration | P2.0-J1 | No | Absorbed |
| 2.0 | Response schema registration | P2.0-J1 | No | Absorbed |
| 2.0 | Union/conditional response modeling | P2.0-J1 | No | Absorbed |
| 2.0 | Auth/RBAC metadata | P2.0-J1 | No | Absorbed |
| 2.0 | Common error response baseline | P2.0-J1 | No | Absorbed |
| 2.0 | CSV/binary response documentation | P2.0-J1 | No | Absorbed |
| 2.0 | OpenAPI regression tests | P2.0-J1 | No | Absorbed |
| 2.0 | Runtime E2E matrix definition | P2.0-J1 | **Partial** | Plan has this as P2.0-J9 but index P2.0-J1 scope does not mention E2E matrix definition. The actual E2E matrix execution is P2A-J6. Gap: the "definition" step is not clearly assigned. |

### 2A Candidate Runtime

| Phase | Capability (plan) | Job ID | Missing? | Notes |
|-------|-------------------|--------|----------|-------|
| 2A | Atomic startAttempt | P2A-J1 | No | Match |
| 2A | Start/Resume runtime normalization | — | **Yes** | Plan P2A-J2 "Start / Resume Runtime" has no index job. Partially covered by P2A-J5 (Restore Runtime Semantics) but plan J2 also included "normalize start behavior" |
| 2A | Save answer runtime stabilization | — | **Yes** | Plan P2A-J3 "Save Answer Runtime" dropped from index. Stabilization-only job; coverage partially assumed by existing tests |
| 2A | Submit runtime stabilization | — | **Yes** | Plan P2A-J4 "Submit Runtime" dropped from index. Stabilization-only job |
| 2A | Server-side deadline auto-submit | P2A-J2 | No | Plan J5 → index J2. Renumbered |
| 2A | Client deadline awareness | P2A-J3 | No | Plan J6 → index J3. Renumbered |
| 2A | Exam open/close semantics | P2A-J4 | No | Plan J7 → index J4. Renumbered |
| 2A | Candidate result visibility | — | **Yes** | Plan P2A-J8 "Candidate Result Visibility" dropped. Overlaps with P2D-J5 but P2D-J5 focuses on publication modes, not candidate-facing display verification |
| 2A | Candidate runtime E2E | P2A-J6 | No | Plan J9 → index J6. Renumbered |
| 2A | Restore runtime semantics | P2A-J5 | No | **Added in index, not in plan**. Covers discovery 04 §6 gap. Good addition but creates plan-index divergence |

### 2B Admin Operation

| Phase | Capability (plan) | Job ID | Missing? | Notes |
|-------|-------------------|--------|----------|-------|
| 2B | Admin flow audit | P2B-J1 | No | Match (partially — plan J1 is pure audit, index J1 is audit + E2E) |
| 2B | Exam setup hardening | P2B-J2 | No | **Absorbed into mega-job** |
| 2B | Assignment flow hardening | P2B-J2 | No | Absorbed |
| 2B | Publish/open/close/archive semantics | P2B-J2 | No | Absorbed |
| 2B | User/question/course management hardening | P2B-J2 | **Unclear** | Mega-job P2B-J2 scope is "setup/assignment validation" — management hardening may be silently dropped |
| 2B | Score overview entry | P2B-J2 | No | Absorbed |
| 2B | Admin operation E2E | P2B-J1 | No | Absorbed into J1 (which is now E2E + docs) |

### 2C Proctor Runtime

| Phase | Capability (plan) | Job ID | Missing? | Notes |
|-------|-------------------|--------|----------|-------|
| 2C | Heartbeat runtime | P2C-J1 | No | Merged with plan J2 |
| 2C | Disrupted detection | P2C-J1 | No | Merged into J1 |
| 2C | Polling proctor dashboard | P2C-J5 | No | Plan J3 → index J5. Renumbered |
| 2C | Force submit | P2C-J2 | No | Plan J4 → index J2. Renumbered |
| 2C | Extend time | P2C-J3 | No | Plan J5 → index J3. Renumbered |
| 2C | Misconduct flag | P2C-J4 | No | Plan J6 → index J4. Renumbered |
| 2C | Attempt timeline | P2E-J2 | No | **Moved to Phase 2E**. Good cross-phase migration |
| 2C | Proctor runtime E2E | P2C-J8 | No | Match (number gap: J6, J7 skipped in index) |

### 2D Grading & Result

| Phase | Capability (plan) | Job ID | Missing? | Notes |
|-------|-------------------|--------|----------|-------|
| 2D | Objective grading stabilization | P2D-J1 | No | Match |
| 2D | Manual grading model | P2D-J2 | No | Match |
| 2D | Grading queue API | P2D-J3 | No | Match |
| 2D | Manual score UI | P2D-J4 | No | Match |
| 2D | Score policy | P2D-J5 | **Partial** | Merged into P2D-J5 "Result Publishing Policy". Score strategy verification and retake interactions may be silently dropped |
| 2D | Result publishing policy | P2D-J5 | No | Merged with plan J5 |
| 2D | Result visibility | — | **Yes** | Plan P2D-J7 "Result Visibility" dropped. Partially overlaps P2D-J5 but J5 focuses on policy, not visibility state verification |
| 2D | Grading audit | P2D-J6 | No | Plan J8 → index J6. Renumbered |

### 2E Operation Evidence & Export

| Phase | Capability (plan) | Job ID | Missing? | Notes |
|-------|-------------------|--------|----------|-------|
| 2E | All 6 jobs | P2E-J1 through P2E-J6 | No | Full match |

### Summary

The index made deliberate consolidation and renumbering choices. This is acceptable **if documented**. Currently the plan uses one numbering scheme and the index uses another — this is a **consistency blocker** that must be resolved before construction.

| Issue | Count | Verdict |
|-------|-------|---------|
| Plan jobs dropped without explicit deferral | 5 (P2A-J2, J3, J4, J8; P2D-J7) | NEEDS FIX |
| Plan sub-jobs consolidated into mega-jobs | 3 clusters (P2.0, P2B, P2D-J5+J6) | NEEDS FIX |
| Plan/index numbering divergence | All P2A, P2C, P2D jobs | NEEDS FIX |
| Added jobs not in plan | 1 (P2A-J5 Restore) | Acceptable — from discovery gap |

---

## 3. Job Index Integrity

### 3.1 Job ID Uniqueness

All 30 Job IDs in the index are unique. **PASS**.

### 3.2 Dependency Cycle Check

Dependency graph traced manually. No circular dependencies detected:

```
P2-PLAN-J1 → P2.0-J1 → P2A-J1 → {P2A-J2, P2A-J3, P2A-J4, P2A-J5} → P2A-J6
  → P2B-J1 → P2B-J2 → {P2C-J1, P2C-J5} → {P2C-J2, P2C-J3, P2C-J4} → P2C-J5 → P2C-J8
  → P2D-J1 → P2D-J2 → P2D-J3 → P2D-J4 → P2D-J6
  → P2D-J5 → P2D-J6 → P2E-{J1..J6}
```

P2F-J1 is independent. **PASS**.

### 3.3 P2A-J6 Double-Listed in Execution Order

The index execution order diagram lists `P2A-J6` twice (line 55 and 57). P2A-J6 depends on P2A-J3 **and** P2A-J4/P2A-J5, but the diagram shows it as both parallel and serial. This is a diagram ambiguity, not a logical error. **NEEDS FIX** — clean up the ASCII diagram.

### 3.4 P2C-J5 Dependency on P2C-J2/J3/J4

Index line 26: `P2C-J5` Blocks field says `P2C-J8`. But Depends on says `P2C-J1, P2B-J2`. The job card says it depends on P2C-J2/J3/J4 (it wires their action buttons). The index under-declares the dependency.

| Job ID | Issue | Severity | Recommendation |
|--------|-------|----------|----------------|
| P2C-J5 | Index omits dependency on P2C-J2/J3/J4 | NEEDS FIX | Add P2C-J2, P2C-J3, P2C-J4 to Depends on |
| P2D-J6 | Depends on P2D-J4 (frontend) for audit instrumentation | NEEDS FIX | Audit logging is backend; dependency on P2D-J4 (frontend) is over-serialized. Should depend on P2D-J3 (API) + P2D-J5 (publish API) only |
| P2E-J5 | Depends on P2B-J2 but should also depend on nothing in P2D | PASS | Independent of grading — correct |
| P2E-J6 | Depends on P2B-J2 but reads heartbeat scanner status from P2C-J1 | NEEDS FIX | Should depend on P2C-J1 or specify that scanner metrics are read from memory |

### 3.5 Missing Job Number Sequences

| Phase | Index Job IDs | Missing Numbers | Impact |
|-------|---------------|-----------------|--------|
| P2C | J1, J2, J3, J4, J5, J8 | J6, J7 | Gaps from consolidation. Not harmful but confusing |
| P2D | J1, J2, J3, J4, J5, J6 | J7, J8 | Same |

### 3.6 Mega PR Risk

| Job ID | PR Size Est. | Actual Scope | Verdict | Notes |
|--------|-------------|--------------|---------|-------|
| P2.0-J1 | L | 42 routes schema metadata | SPLIT LATER | Acceptable as single PR if purely mechanical, but 42 routes is large. Should be split by domain: auth/user/candidate first, then exam/attempt/score |
| P2B-J2 | M | Absorbs plan J2–J6 (5 capabilities) | NEEDS FIX | "Admin Operation Hardening" is too broad. At minimum split into: (a) publish/open/close alignment, (b) setup/assignment validation, (c) management hardening |
| P2D-J5 | M | 5 layers, 7 files, breaking migration | SPLIT LATER | See §6 for detailed split recommendation |
| P2E-J5 | M | 4 categories, 6 files, new table + new page | PASS | Coherent single feature; can split if needed but acceptable |
| P2C-J5 | M | New API + new page + integration of 3 action APIs | PASS | Heavy but coherent; status API and dashboard UI could be split if review burden is high |

### 3.7 Classification Errors

| Job ID | Issue | Severity | Recommendation |
|--------|-------|----------|----------------|
| P2B-J1 | Marked `docs-only planning job` but §8 Scope modifies `apps/e2e/e2e/admin-flow.spec.ts` (non-doc file) | NEEDS FIX | Remove `docs-only` classification; this is an `E2E / regression job` + `planning job` |
| P2C-J1 | Marked `backend API / route job` but is an internal plugin with no public route; real change is transactional repo access | NEEDS FIX | Reclassify as `DB / repository / transaction job` |
| P2C-J4 | Missing `DB / repository / transaction job` checkbox despite requiring migration | NEEDS FIX | Add DB classification |
| P2D-J1 | Marked `backend state-machine job` but §15 says "N/A — no state machine change" | NEEDS FIX | Remove state-machine classification; this is purely `E2E / regression job` |
| P2E-J3 | Marked `E2E / regression job` but §21 says demo seed update with 1000+ records | NEEDS FIX | Demo seed modification is inappropriate; see §6 |

---

## 4. Job Card Completeness

All 29 job cards follow the same 29-section template. Below is the field-by-field audit.

### 4.1 Section Coverage Matrix

| Section | P2-PLAN-J1 | P2.0-J1 | P2A-J1 | P2A-J2 | P2A-J3 | P2A-J4 | P2A-J5 | P2A-J6 | P2B-J1 | P2B-J2 | P2C-J1 | P2C-J2 | P2C-J3 | P2C-J4 | P2C-J5 | P2C-J8 | P2D-J1 | P2D-J2 | P2D-J3 | P2D-J4 | P2D-J5 | P2D-J6 | P2E-J1 | P2E-J2 | P2E-J3 | P2E-J4 | P2E-J5 | P2E-J6 | P2F-J1 |
|---------|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Summary | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| Scope | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| Non-Scope | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| Dependencies | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | wk | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| Construction Locations | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | wk | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| Backend Contract Trace | ok | ok | ok | ok | n/a | ok | ok | n/a | n/a | ok | ok | ok | ok | ok | ok | n/a | n/a | ok | ok | n/a | ok | ok | n/a | ok | ok | ok | ok | ok | n/a |
| API / Contract Changes | ok | ok | ok | ok | n/a | ok | ok | n/a | n/a | ok | n/a | ok | ok | ok | ok | n/a | n/a | ok | ok | n/a | ok | n/a | n/a | ok | ok | ok | ok | n/a | n/a |
| State Machine Contract | ok | n/a | ok | ok | n/a | ok | ok | n/a | n/a | ok | ok | ok | n/a | n/a | n/a | n/a | wk | ok | ok | n/a | wk | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| DB / Transaction / Locking | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | wk | wk | ok | ok | ok | wk | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| Tests | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| Acceptance Criteria | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| Review Guardrails | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |

Legend: `ok` = present and adequate, `wk` = present but weak/underspecified, `n/a` = not applicable.

### 4.2 Cards with Weak or Missing Sections

| Job ID | Missing / Weak Section | Severity | Recommendation |
|--------|----------------------|----------|----------------|
| P2A-J2 | Disrupted-state auto-submit policy undefined ("per policy" with no policy) | NEEDS FIX | Define: does disrupted+expired → auto-submit, or stay disrupted? |
| P2A-J5 | DB §17 says no transaction, no lock, but claims idempotency — race condition | NEEDS FIX | Wrap restoreAttempt in transaction with FOR UPDATE |
| P2A-J6 | No strategy for deterministic timing in E2E (clock injection, near-zero deadlines) | NEEDS FIX | Specify how to make server-side deadline/disconnect deterministic in browser E2E |
| P2C-J2 | Error contract says 409 ALREADY_GRADED but state machine says idempotent return | NEEDS FIX | Pick one: 200 with graded result (idempotent) or 409 (conflict). Recommend 200 |
| P2C-J3 | No transaction/lock; deadlineAt may exceed exam.closeAt | NEEDS FIX | Add transaction + FOR UPDATE; clamp or reject extension beyond closeAt |
| P2C-J3 | Scope omits `attemptCommands.ts` but §16 declares new command `extendAttemptTime` | NEEDS FIX | Add engine file to Scope |
| P2C-J4 | Schema path `pg.ts` is Postgres-specific; violates DB-agnostic rule | NEEDS FIX | Use `schema.ts`; use JSON column not JSONB for SQLite parity |
| P2C-J4 | Response shape ambiguous: `{ ok: true }` vs `LoadAttemptResponse` | NEEDS FIX | Pick one — recommend returning updated attempt |
| P2D-J1 | Classified as state-machine job but no state machine change | NEEDS FIX | Remove state-machine checkbox |
| P2D-J2 | Unique constraint checkbox unchecked but text says "yes" | NEEDS FIX | Check the box |
| P2D-J2 | Migration backfill for existing attempts unspecified | NEEDS FIX | Specify default gradingStatus for existing auto-graded attempts |
| P2D-J5 | State Machine §15 says "N/A" but result visibility IS a state transition | NEEDS FIX | Model as Result Visibility state entity |
| P2D-J5 | `showResultImmediately` → `resultPublicationMode` migration SQL unspecified | NEEDS FIX | Document backfill: `CASE WHEN showResultImmediately THEN 'immediate' ELSE 'manual' END` |
| P2E-J3 | Demo seed update for 1000+ records is inappropriate | NEEDS FIX | Remove demo seed change; generate load test data in test fixture |
| P2E-J5 | Import response shape change is breaking | NEEDS FIX | Ensure frontend change lands in same PR or response is backward compatible |
| P2E-J6 | Scanner status metrics source unspecified | NEEDS FIX | Specify where heartbeat/deadline scanner metrics are collected and exposed |

### 4.3 Systematic Template Issues

1. **All acceptance criteria are pre-checked `[x]`** at planning time. This is a convention but makes cards read as "already complete." Reviewers should treat as checklist to validate, not completion proof.
2. **Several cards reference `schema/pg.ts`** (P2C-J4, P2D-J2, P2D-J5, P2E-J5). AGENTS.md references `schema.ts`. Need to verify actual file structure and standardize references.
3. **`gradedBy` field** in manual grading (P2D-J2) references a grader identity, but Phase 1 has no Grader role — only Admin. Model should clarify `gradedBy = Admin userId` for Phase 2.

---

## 5. State Machine / Backend Contract Review

### P2A-J1 — Atomic startAttempt

| Aspect | Detail |
|--------|--------|
| State Machine Concern | Same transition (`published/open → startAttempt → in_progress`), now transaction-safe. No new transition. Clean. |
| Backend Contract Concern | `enrollmentRepo.findByExamAndCandidateForUpdate` + `executeInTransaction`. Lock on enrollment row serializes concurrent starts. Audit: `attempt.start` (existing). |
| Verdict | **PASS** |

### P2A-J2 — Deadline Auto-Submit

| Aspect | Detail |
|--------|--------|
| State Machine Concern | New transition: `in_progress → submitted → graded` when `now >= deadlineAt`. Also: `disrupted → ?` — policy undefined. Card says "deterministic (submit or leave disrupted per policy)" but no policy documented. |
| Backend Contract Concern | New `attemptRepo.listInProgressByDeadline(ctx, beforeNow)`. Submit + grade inside transaction with `findByIdForUpdate`. New audit action `attempt.autoSubmit`. Scanner is internal (no public API). |
| Verdict | **NEEDS FIX** — Define disrupted+expired policy: auto-submit disrupted attempts or leave them disrupted? |

### P2A-J4 — Exam Open/Close Semantics

| Aspect | Detail |
|--------|--------|
| State Machine Concern | `published → open` (check-on-access when `now >= openAt`), `open → closed` (check-on-access when `now >= closeAt`). Lazy evaluation — status may be stale in DB if no one accesses after `closeAt`. No concurrency protection (no lock). Two concurrent candidate starts both trying `published→open` — idempotent update but no test proves it. |
| Backend Contract Concern | `openExam`/`closeExam` (existing commands) called on access. No transaction, no lock. New audit: `exam.open`, `exam.close`. |
| Verdict | **NEEDS FIX** — Add concurrency test for parallel `published→open`. Document that stale status is acceptable for Phase 2 (correct-at-access-time). |

### P2A-J5 — Restore Runtime Semantics

| Aspect | Detail |
|--------|--------|
| State Machine Concern | `disrupted → restore → in_progress` with `deadlineAt` adjustment. Formula: `newDeadlineAt = originalDeadlineAt + (now - lastActivityAt)`, capped at `exam.closeAt`. |
| Backend Contract Concern | **No transaction, no lock** (`Transaction: No`, `Lock: No`). Card claims idempotency but two concurrent restore calls would both read old `lastActivityAt` and double-apply the adjustment. This is a real TOCTOU race condition. |
| Verdict | **NEEDS FIX** — Wrap `restoreAttempt` in `executeInTransaction` + `findByIdForUpdate`. This is the same pattern used by saveAnswer and submitAttempt; restoreAttempt should follow the same discipline. |

### P2C-J2 — Force Submit

| Aspect | Detail |
|--------|--------|
| State Machine Concern | `in_progress | disrupted → submit → grade → graded`. Reuses existing `submitAttempt` + `gradeAttempt`. Idempotent on `submitted`/`graded` (returns same result). `voided` rejected. |
| Backend Contract Concern | `POST /admin/attempts/:attemptId/force-submit`. Transaction + `findByIdForUpdate`. Audit: `attempt.forceSubmit`. Error contract contradiction: §14 says `409 ALREADY_GRADED` but §15/§16 say idempotent return. |
| Verdict | **NEEDS FIX** — Reconcile error semantics: idempotent graded should return `200` with result, not `409`. Also: lock ordering with P2C-J1 scanner must be specified to prevent deadlock. |

### P2C-J3 — Extend Time

| Aspect | Detail |
|--------|--------|
| State Machine Concern | No state transition — only `deadlineAt` field update. Allowed states: `in_progress`, `disrupted`. Rejected: `submitted`, `graded`, `voided`. |
| Backend Contract Concern | `POST /admin/attempts/:attemptId/extend-time`. **No transaction, no lock** — same race risk as P2A-J5. Admin extends while candidate is mid-save: both write to `exam_attempts` row without coordination. `deadlineAt` may exceed `exam.closeAt` — card §24 admits this but no validation enforces the bound. |
| Verdict | **NEEDS FIX** — Add `executeInTransaction` + `findByIdForUpdate`. Clamp or reject `deadlineAt > exam.closeAt`. Add `attemptCommands.ts` to scope (new command `extendAttemptTime` declared in §16 but missing from §8). |

### P2D-J2 — Manual Grading Model

| Aspect | Detail |
|--------|--------|
| State Machine Concern | New grading state: `submitted → pending_manual → fully_graded` (mixed exams). `submitted → fully_graded` (all-auto exams). New `gradingStatus` enum on `exam_attempts`. |
| Backend Contract Concern | New table `manual_grading_entries` with unique constraint `(attemptId, questionId)`. Unique constraint checkbox is unchecked but text says "yes." Migration backfill for existing attempts unspecified. `gradedBy` = Admin userId (no Grader role in Phase 2). |
| Verdict | **NEEDS FIX** — Fix checkbox. Specify migration backfill default. Clarify `gradedBy` = Admin. Verify `schema/pg.ts` vs `schema.ts` path. |

### P2D-J5 — Result Publishing Policy

| Aspect | Detail |
|--------|--------|
| State Machine Concern | §15 says "N/A — no attempt state change" but result visibility IS a state: `hidden → visible`. Exam gains `resultsPublishedAt`. Candidate sees status-only response until published. This should be modeled as a Result Visibility state entity. |
| Backend Contract Concern | Breaking migration: `showResultImmediately` (boolean) → `resultPublicationMode` (enum: `immediate | after_grading | manual`). Migration SQL backfill not specified. New `POST /admin/exams/:id/publish-results`. Conditional response on `GET /scores/attempts/:id`. |
| Verdict | **NEEDS FIX** — Model result visibility as state. Specify migration backfill SQL. This job is too large — see §6 for split recommendation. |

---

## 6. PR Boundary Review

### P2D-J5 — Result Publishing Policy

| Aspect | Detail |
|--------|--------|
| Verdict | **SPLIT LATER** |
| Reason | Spans 5 layers (contract, domain, DB, 2 API routes, 2 frontend pages) with a breaking boolean→enum migration. Combines: new enum + breaking migration + score visibility logic change + new admin endpoint + candidate ResultPage changes + ExamCreatePage form changes. |
| Suggested Split | **P2D-J5a**: Backend model + migration + API (contract, domain, schema, `scores.ts`, `exam.ts`). Includes `showResultImmediately → resultPublicationMode` migration with backfill.<br>**P2D-J5b**: Frontend ResultPage conditional display (candidate-facing visibility logic).<br>**P2D-J5c**: Frontend ExamCreatePage mode selector (admin form change). |

### P2B-J2 — Admin Operation Hardening

| Aspect | Detail |
|--------|--------|
| Verdict | **SPLIT LATER** |
| Reason | Absorbs 5 plan capabilities: exam setup validation, assignment hardening, publish/open/close alignment, management hardening, score overview entry. These are independent concerns that could land separately. |
| Suggested Split | **P2B-J2a**: Publish/open/close/archive alignment (state machine + routes).<br>**P2B-J2b**: Setup + assignment validation (form + enrollment).<br>**P2B-J2c**: Management hardening (user/question/course gaps) + score overview navigation. |

### P2E-J5 — Import Job Logs

| Aspect | Detail |
|--------|--------|
| Verdict | **PASS** (with caveat) |
| Reason | Coherent single feature spanning 4 categories, but the import response shape change is breaking. Frontend must land in same PR. |
| Suggested Split | Optional: P2E-J5a (backend: table + repo + API), P2E-J5b (frontend: page). Not strictly required. |

### P2E-J3 — Score CSV Hardening

| Aspect | Detail |
|--------|--------|
| Verdict | **NEEDS FIX** |
| Reason | §21 Seed Impact says "demo seed update (1000+ graded attempts for load test)." This is inappropriate — demo seed should represent a realistic-but-small dataset. 1000+ attempts would bloat every dev/CI startup. |
| Suggested Split | No split needed. Change seed impact to `[x] no seed change` and generate load test data programmatically in test fixture (`beforeAll` or test factory). |

### P2B-J1 — Admin Operation Flow Audit

| Aspect | Detail |
|--------|--------|
| Verdict | **NEEDS FIX** |
| Reason | Marked `docs-only planning job` but §8 Scope modifies `apps/e2e/e2e/admin-flow.spec.ts` — a non-doc file. This is not docs-only. |
| Recommendation | Remove `docs-only` classification. This is a `planning job` + `E2E / regression job`. |

### Other Mega PR Risks

| Job ID | Verdict | Reason | Action |
|--------|---------|--------|--------|
| P2.0-J1 | PASS | 42 routes is large but mechanical (schema metadata only, no behavior change). Acceptable as single PR if review is staged by domain. | Split optional |
| P2C-J5 | PASS | New API + new page + integration in one PR. Heavy but coherent. | Split optional |
| P2D-J6 | PASS | Cross-cutting audit instrumentation across multiple routes. Single PR is correct — splitting would fragment the audit concern. | No split |

---

## 7. Recommended Execution

### First 5 PRs (in order)

| # | Job ID | Name | Why First |
|---|--------|------|-----------|
| 1 | **P2-PLAN-J1** | Phase 2 Plan Finalization | Aligns plan with discovery; resolves numbering inconsistencies; unblocks all downstream work. Pure docs, quick win. |
| 2 | **P2.0-J1** | OpenAPI Contract Baseline | Blocks all feature work. No behavior change, high ROI. All Phase 2 APIs need this baseline. |
| 3 | **P2A-J1** | Atomic startAttempt | Smallest P0 backend fix. Prevents duplicate attempts. Unblocks candidate runtime track. |
| 4 | **P2A-J2** | Deadline Auto-Submit | Fixes the most dangerous data-loss scenario (browser crash at deadline). Depends on J1. |
| 5 | **P2A-J4** | Exam Open/Close Semantics | Unblocks admin operation hardening (P2B-J2 depends on it). Can run in parallel with P2A-J2. |

Alternative for #5: **P2A-J5** (Restore Runtime Semantics) if restore correctness is higher priority than exam open/close. But J4 unblocks more downstream jobs.

### Jobs to Park (do not start now)

| Job ID | Reason |
|--------|--------|
| P2F-J1 | ADR-only, no implementation trigger yet. Can run in parallel at any time but has no urgency. |
| P2E-* (all) | P2 priority. Wait until P2A–P2D are stable. |
| P2D-J5 | Must be split before construction (see §6). Park until split is approved. |
| P2B-J2 | Must be split before construction (see §6). Park until split is approved. |

---

## Summary

### 1. Can we start P2.0-J1?

**Yes, after P2-PLAN-J1 is completed.** P2.0-J1 is well-scoped: schema metadata only, no behavior change. The job card is complete and acceptance criteria are clear. The only prerequisite is that P2-PLAN-J1 resolves the plan/index numbering inconsistencies so that downstream jobs reference the correct IDs.

### 2. Which documentation problems must be fixed first?

| # | Problem | Must Fix Before | Fix |
|---|---------|-----------------|-----|
| 1 | Plan and index use different job numbering (all P2A, P2C, P2D) | P2-PLAN-J1 merge | Align plan job IDs to match index, or vice versa. Add a mapping table if both are kept. |
| 2 | P0-4 (additional timing modes) has no job and no deferral | P2-PLAN-J1 merge | Either add a job or move to plan §12 Deferred with explicit reasoning |
| 3 | 8 discovery gaps (P1-7, P1-8, P2-3, P2-6, P2-7, P2-8, IP UI, Queue UI) have no job and no explicit deferral | P2-PLAN-J1 merge | Add to plan §12 Deferred list |
| 4 | P2A-J5 restoreAttempt has no transaction/lock — real race condition | P2A-J5 construction | Add `executeInTransaction` + `findByIdForUpdate` to spec |
| 5 | P2C-J3 extend-time has no transaction/lock and no closeAt clamp | P2C-J3 construction | Add transaction + lock; add closeAt validation |
| 6 | P2C-J2 force-submit error semantics contradiction (409 vs idempotent 200) | P2C-J2 construction | Pick 200 idempotent return |
| 7 | P2A-J2 disrupted+expired auto-submit policy undefined | P2A-J2 construction | Define policy in card |
| 8 | P2E-J3 demo seed modification for 1000+ records is inappropriate | P2E-J3 construction | Remove seed change; use test fixture |
| 9 | P2B-J1 misclassified as docs-only | P2-PLAN-J1 merge | Fix classification |

### 3. Which jobs should be split before construction?

| Job ID | Current Size | Split Into |
|--------|-------------|------------|
| P2D-J5 | 5 layers, 7 files, breaking migration | P2D-J5a (backend model + migration + API), P2D-J5b (frontend ResultPage), P2D-J5c (frontend ExamCreatePage) |
| P2B-J2 | 5 absorbed capabilities | P2B-J2a (publish/open/close alignment), P2B-J2b (setup/assignment validation), P2B-J2c (management hardening) |
| P2.0-J1 | 42 routes | Optional: split by domain cluster (auth/user → exam/attempt → score/export). Not required if purely mechanical. |

### 4. Which jobs should NOT be worked on now?

| Job ID | Reason |
|--------|--------|
| All P2E-* | P2 priority — wait until P2A–P2D stable. P2E-J3 and P2E-J5 have issues that must be fixed before their respective phases. |
| P2F-J1 | ADR-only, no implementation trigger. Can be drafted in parallel but has no urgency. |
| P2D-J5 | Must be split first (see §3 above). |
| P2B-J2 | Must be split first (see §3 above). |
| P2D-J4 | Blocked by P2D-J3, which is blocked by P2D-J2, which is blocked by P2D-J1. Entire P2D chain is far from starting. |
| P2C-J5 | Depends on P2C-J2/J3/J4 which all need fixes first. |

---

## Appendix: Full Gap-to-Job Traceability

| Discovery Gap | Discovery Source | Plan Section | Job Index Job | Job Card | Verdict |
|---------------|-----------------|--------------|---------------|----------|---------|
| No auto-submit at deadline | 06 P0-1, 04 §6 | §3 P2A-J5 | P2A-J2 | P2A-J2 | PASS (policy gap) |
| startAttempt not atomic | 06 P0-2, 04 §2 | §3 P2A-J1 | P2A-J1 | P2A-J1 | PASS |
| Exam status never transitions | 06 P0-3, 04 §1 | §3 P2A-J7 | P2A-J4 | P2A-J4 | PASS (concurrency gap) |
| No other timing modes | 06 P0-4 | — | — | — | **BLOCKER** |
| Client deadline awareness | 06 P0-5, 01 §4 | §3 P2A-J6 | P2A-J3 | P2A-J3 | PASS |
| Restore no time adjustment | 04 §6 | §3 (added) | P2A-J5 | P2A-J5 | NEEDS FIX (race) |
| No proctor dashboard | 06 P1-1, 01 §9 | §5 P2C-J3 | P2C-J5 | P2C-J5 | PASS |
| No force-submit | 06 P1-2, 04 §2 | §5 P2C-J4 | P2C-J2 | P2C-J2 | NEEDS FIX (error semantics) |
| No extend-time | 06 P1-3, 04 §2 | §5 P2C-J5 | P2C-J3 | P2C-J3 | NEEDS FIX (race + clamp) |
| No misconduct | 06 P1-4 | §5 P2C-J6 | P2C-J4 | P2C-J4 | NEEDS FIX (schema path) |
| Audit log viewer | 06 P1-5, 01 §9 | §7 P2E-J1 | P2E-J1 | P2E-J1 | PASS |
| No manual grading | 06 P1-6, 04 §5 | §6 P2D-J2/3/4 | P2D-J2/3/4 | P2D-J2/3/4 | PASS (J2 checkbox bug) |
| Random selection | 06 P1-7 | — | — | — | PARKED |
| Retake policy | 06 P1-8 | — | — | — | PARKED |
| In-memory queue | 06 P1-9 | §8 (ADR) | P2F-J1 | P2F-J1 | PASS |
| Heartbeat resilience | 06 P1-10, 04 §6 | §5 P2C-J1 | P2C-J1 | P2C-J1 | PASS (classification fix) |
| OpenAPI schemas | 06 P2-1, 03 §3 | §2 | P2.0-J1 | P2.0-J1 | PASS |
| RBAC in OpenAPI | 06 P2-2, 03 §5 | §2 | P2.0-J1 | P2.0-J1 | PASS |
| PlaceholderPage | 06 P2-3 | — | — | — | PARKED |
| PDF export | 06 P2-4 | §12 Deferred | — | — | PASS |
| Email | 06 P2-5 | §12 Deferred | — | — | PASS |
| Batch operations | 06 P2-6 | — | — | — | PARKED |
| Server-side pagination | 06 P2-7 | — | — | — | PARKED |
| Optimistic UI | 06 P2-8 | — | — | — | PARKED |
| Attempt timeline | 05 §D | §5 P2C-J7 | P2E-J2 | P2E-J2 | PASS |
| IP restriction UI | 01 §9 | — | — | — | PARKED |
| Queue management UI | 01 §9 | — | — | — | PARKED |
| Diagnostics page | 01 §3 | §7 P2E-J6 | P2E-J6 | P2E-J6 | PASS (metrics source gap) |
| Import job logs | 01 §9 | §7 P2E-J5 | P2E-J5 | P2E-J5 | PASS (breaking change gap) |
| Grading audit | 04 §5 | §6 P2D-J8 | P2D-J6 | P2D-J6 | PASS |
| Result publishing | 04 §3 | §6 P2D-J6 | P2D-J5 | P2D-J5 | NEEDS FIX (too large) |
| Attempt detail export | 01 §3 | §7 P2E-J4 | P2E-J4 | P2E-J4 | PASS |
