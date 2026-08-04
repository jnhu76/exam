# Task List: J5 Recovery Center — Backend Closeout + Read Model + UI

## Phase 1: J5-I1A Closeout + Contract Amendment

- [x] **Task 1:** J5-I1A1/A2 Closeout Documentation
  - Close A1/A2, set A3 NEXT, keep I1A IN PROGRESS
  - Update `current.md` (A2 no longer IN REVIEW)
  - XS · 3 files · docs only

- [x] **Task 2:** Amend J5-R0 for I1A3
  - Freeze endpoint, projection, auth, ordering, snapshot, allowedActions semantics
  - S · 1-2 files · contract amendment

## Phase 2: J5-I1A3 — Attempt Operations Read Model

- [x] **Task 3:** A3 contracts + repository method
  - Wire schemas in `packages/contracts`, repo internal type, `getAttemptOperationsContext()`
  - TDD: integration tests first
  - L · 5-8 files

- [x] **Task 4:** A3 API route + route registry
  - `GET /admin/recovery/attempts/:attemptId`
  - Use authoritative `AttemptIdParamsSchema`, not inline UUID
  - M · 3-5 files

- [x] **Task 4 closeout:** J5-I1A final closure
  - I1A3 CLOSED, I1A CLOSED, I1B NEXT
  - XS · 2 files · docs only

### Checkpoint: After Task 4 closeout
- [x] `pnpm test` + `pnpm verify` pass
- [x] Three recovery read-model endpoints complete
- [x] J5-I1A CLOSED, J5-I1B NEXT

## Phase 3: A2 Field Audit

- [x] **Task 7:** Strict A2 wire field mapping (+ Task 7a additive A2 projection)
  - Audit every UI field in Task 8 against A2 wire contract
  - Gap → additive A2 PR before Task 8 (`attemptSummaries[].score`,
    `timeAdjustmentSummaries[]` policy/source/before/after/actor)
  - S-M · 1-5 files

## Phase 4: J5-I1B — Read-only UI

- [x] **Task 5/6:** J5-I1B1 — Recovery Queue infrastructure + Queue page
  - Routes, sidebar, capabilities, i18n + functional queue page (single PR)
  - Filters → URL, cursor → component state
  - Polling: 30s visible, pause hidden, immediate on focus, single-flight, reset to page 1
  - L · 8+ files

- [x] **Task 8:** J5-I1B2 — Recovery Incident Detail page
  - Only fields confirmed in A2 wire (Task 7 mapping)
  - No action buttons in read-only phase
  - L · 5-8 files

- [x] **Task 9:** J5-I1B3 — Attempt Operations Context page
  - Consumes new A3 endpoint
  - Full adjustment ledger, interruption episodes, timeline
  - L · 5-8 files

- [x] **Task 10:** J5-I1B4 — Exam Recovery Detail page
  - Decision: NEW aggregate `GET /admin/recovery/exams/:examId` (§6.5) —
    composition rejected (counts + attempt distribution have no server source)
  - M-L · 3-8 files

### Checkpoint: After Task 10
- [x] All tests pass, `pnpm verify` passes
- [x] Four Recovery UI pages navigable with cross-links
- [x] J5-I1B ready for review (J5-I1B CLOSED on the branch; J5-I1C NEXT)
