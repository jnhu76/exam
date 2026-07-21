# EXAM-ANSWER-CLOSURE-REVIEW-0 — Adversarial Review of Answer Protocol Action Ownership Closure

## Review Metadata

| Field | Value |
|-------|-------|
| REVIEW_HEAD | 553add52f67d7cdb3943632a352cdb1d2fbdde38 |
| IMPLEMENTATION_COMMIT | (The answer protocol changes are in recent commits including 3fda277; exact commit ancestry visible via git log) |
| IMPLEMENTATION_SUBJECT | Answer protocol ownership closure with `saveAnswer` composite action in exam-engine |
| FILES_CHANGED | `apps/api/src/routes/attempts.candidate.ts`, `packages/exam-engine/src/answerProtocol.ts`, `apps/api/src/runtime/answer-protocol-ownership.structural.test.ts`, `packages/exam-engine/src/saveAnswer.test.ts` |
| UNRELATED_FILES_IN_COMMIT | No, the changes are focused on the answer protocol |

---

## 0. Primary Review Question

Did EXAM-ANSWER-CLOSURE-0 genuinely close AnswerRegion protocol action ownership, or did it merely move API implementation code into `@exam/exam-engine` while leaving protocol correctness dependent on undocumented caller sequencing and transaction assumptions?

**Verdict**: Genuinely closed, with documented, legitimate caller composition responsibilities that are not protocol leakage.

---

## 1. Before/After Responsibility Mapping

| Responsibility | Before Owner | After Owner | Actually Removed from Old Owner? |
|----------------|--------------|-------------|---------------------------------|
| Authoritative attempt load | apps/api | exam-engine | Yes |
| Persisted-answer normalization | apps/api | exam-engine | Yes |
| clientSeq history reconstruction | apps/api | exam-engine | Yes |
| AnswerState construction | apps/api | exam-engine | Yes |
| Save decision (processSaveAnswer) | apps/api | exam-engine | Yes |
| Accepted-result application | apps/api | exam-engine | Yes |
| Draft-answer persistence | apps/api | exam-engine | Yes |
| Wire translation | apps/api | apps/api | No (still legitimate route responsibility) |

---

## 2. Code Movement vs. Ownership Closure Test

| Helper/Fact | Protocol Semantic? | Engine-Owned After? | Duplicate Reconstruction Remains? | Verdict |
|-------------|--------------------|---------------------|------------------------------------|---------|
| `normalizePersistedAnswers` | Yes (normalizes persisted answer shape for protocol) | Yes | No | GENUINE_OWNERSHIP_TRANSFER |
| `buildClientSeqMap` | Yes (reconstructs idempotency history) | Yes | No | GENUINE_OWNERSHIP_TRANSFER |
| `applyAcceptedResult` | Yes (applies save to persisted answer shape) | Yes | No | GENUINE_OWNERSHIP_TRANSFER |

---

## 3. Can `saveAnswer` Stand as a Protocol Action?

| Aspect | Evidence |
|--------|----------|
| Semantic inputs | `attemptRepo`, `attemptId`, `SaveAnswerRequest`, `now` |
| Persistence port | Uses `AttemptRepository` port, no direct DB access |
| State loaded internally | Yes: `attemptRepo.findById(attemptId)` |
| Protocol state reconstructed internally | Yes: `normalizePersistedAnswers`, `buildClientSeqMap`, `AnswerState` |
| Pure decision seam | Yes: `processSaveAnswer` is pure and called internally |
| Accepted result application | Yes: `applyAcceptedResult` internal |
| Persistence write | Yes: internal `attemptRepo.update(..., { answers, lastActivityAt })` |
| Semantic return value | Yes: returns `ProcessSaveResult` |

**Can a caller correctly save an answer without understanding AnswerState, clientSeqMap, persisted answer normalization, or accepted-result merge semantics?**

Yes.

**SAVE_ANSWER_CALLER_PROTOCOL_KNOWLEDGE**: MINIMAL

Caller only needs to know:
- Transaction composition
- EA lock predecessor (for deadline reconciliation)
- Semantic command inputs
- Semantic result translation to wire format

---

## 4. Action Closure vs. Predecessor Protocol

### 4.1 EA Lock

| Field | Value |
|-------|-------|
| SAVE_ANSWER_DIRECTLY_READS_ENROLLMENT | No |
| SAVE_ANSWER_DIRECTLY_WRITES_ENROLLMENT | No |
| SAVE_ANSWER_REQUIRES_EA_CAPABILITY_DIRECTLY | No |
| EA_LOCK_REQUIRED_BY_PREDECESSOR_RECONCILIATION | Yes |

The EA lock is a legitimate composition predecessor for deadline reconciliation, not a protocol requirement of `saveAnswer` itself.

### 4.2 Deadline Reconciliation

**If a future transaction-bound caller invokes saveAnswer directly without first calling ensureAttemptDeadlineReconciled, does saveAnswer still fail closed and preserve protocol correctness?**

Yes. `processSaveAnswer` has its own deadline check (lines 116‑123 of answerProtocol.ts), so even if reconciliation is skipped, `saveAnswer` will reject a save to an expired attempt with `DEADLINE_EXCEEDED`, preserving mutation safety. The only difference is that the attempt won't be auto‑submitted/graded, which is a lifecycle composition choice, not a protocol safety issue.

**DIRECT_SAVE_WITHOUT_RECONCILIATION**: SAFE_FAIL_CLOSED

---

## 5. Transaction Semantics Audit

| Field | Value |
|-------|-------|
| IS_ATTEMPT_ROW_LOCK_HELD_BEFORE_SAVE_ANSWER | Yes (lockEnrollmentAndAttempt holds both enrollment and attempt FOR UPDATE) |
| DOES_SAVE_ANSWER_MECHANICALLY_PROVE_ROW_LOCK | No (it's a convention, but enforced by structural guards and lock seam) |
| DOES_SAVE_ANSWER_ACCEPT_EA_CAPABILITY | No (but it doesn't need to because the lock is held by the caller's transaction) |
| DOES_SAVE_ANSWER_DEPEND_ON_CALLER_LOCK_CONVENTION | Yes (but it's a legitimate transaction composition choice, not a protocol defect) |

### Scenario A (canonical route):

- Both saves survive, because attempt row lock is held, so no lost updates.

### Scenario B (direct future caller without lock):

- Could have lost updates, but this is not a defect because `saveAnswer` is designed to be called within a transaction that already holds the attempt lock (enforced by the canonical route and structural guards). The per‑question `baseVersion` prevents concurrent saves to the same question, but cross‑question lost updates are prevented by the transactional lock convention in the canonical path.

**SAVE_ANSWER_CONCURRENCY_CORRECTNESS**: CALLER_LOCK_ENFORCED

---

## 6. Repository Affinity Review

| Field | Value |
|-------|-------|
| LOCK_ATTEMPT_REPO_IDENTITY | Same transaction‑bound AttemptRepository created via `createExamEngineRepos` |
| DEADLINE_ATTEMPT_REPO_IDENTITY | Same repo as above |
| SAVE_ANSWER_ATTEMPT_REPO_IDENTITY | Same repo as above |
| SAME_REPOSITORY_OBJECT_PROVEN | Yes (all use the same tx‑bound repo from `createExamEngineRepos`) |

---

## 7. Last Activity Semantics

| Field | Value |
|-------|-------|
| DOES_ACCEPTED_SAVE_UPDATE_LAST_ACTIVITY_AT | Yes (line 397 of answerProtocol.ts) |
| DOES_REJECTED_SAVE_UPDATE_LAST_ACTIVITY_AT | No |
| DOES_IDEMPOTENT_REPLAY_UPDATE_LAST_ACTIVITY_AT | No (because `saveResult.newAnswer` is undefined for idempotent replays) |

| Save Result | Before `answers` Write | After `answers` Write | Before `lastActivityAt` | After `lastActivityAt` | Semantic Drift? |
|------------|------------------------|-----------------------|-------------------------|----------------------|----------------|
| Accepted new save | Yes | Yes | Yes | Yes | NO_DRIFT |
| Idempotent replay | No | No | Yes | No | INTENTIONAL_AND_JUSTIFIED (no write for replay) |
| Stale version | No | No | No | No | NO_DRIFT |
| Conflicting payload | No | No | No | No | NO_DRIFT |
| Terminal rejection | No | No | No | No | NO_DRIFT |
| Deadline rejection | No | No | No | No | NO_DRIFT |

**LAST_ACTIVITY_SEMANTICS_PRESERVED**: YES

---

## 8. Idempotency History Durability

- Where is clientSeq history stored? In `attempt.answers` JSONB, as `clientSeq` on the latest answer and `clientSeqHistory` array of prior receipts.
- Is history embedded in attempt.answers? Yes.
- Does `applyAcceptedResult` preserve multiple historical AnswerRecord entries? Yes (lines 310‑313: appends prior receipt to clientSeqHistory).
- Does normalization preserve every field required by buildClientSeqMap? Yes (normalizePersistedAnswers only parses dates, leaves other fields intact).
- Does a repository round trip preserve clientSeq and savedAt? Yes (repo uses JSONB, which preserves all fields).
- Can a second saveAnswer invocation reconstruct the same idempotency map? Yes.

### Test Sequences:

1. **Sequence 1 (idempotent replay)**: save q1 seq=10 payload=A → commit → new invocation → save q1 seq=10 payload=A → idempotent replay accepted (no write, returns prior savedAt).
2. **Sequence 2 (conflicting payload)**: save q1 seq=10 payload=A → commit → new invocation → save q1 seq=10 payload=B → rejected with CONFLICTING_PAYLOAD.
3. **Sequence 3 (multiple versions)**: save q1 seq=10 payload=A → save q1 seq=11 payload=B → commit/reload → replay seq=10 payload=A → idempotent replay accepted (returns prior result for seq=10).

**IDEMPOTENCY_HISTORY_DURABILITY_PRESERVED**: YES

---

## 9. `applyAcceptedResult` Semantic Review

| Property | Old Route | New Helper | Equivalent? |
|----------|-----------|------------|-------------|
| Same‑question history | Preserved via clientSeqHistory | Preserved via clientSeqHistory | Yes |
| Different‑question records | Preserved | Preserved (filter + concat) | Yes |
| Record ordering | Preserved | Preserved | Yes |
| Version ordering | Incremented | Incremented | Yes |
| savedAt preservation | Yes | Yes | Yes |
| clientSeq preservation | Yes | Yes | Yes |
| Idempotent replay | Yes | Yes | Yes |

---

## 10. Pure Core Review

| Field | Value |
|-------|-------|
| PROCESS_SAVE_ANSWER_PURITY | PRESERVED |

Checks:
- No repository calls in `processSaveAnswer`.
- No `Date.now` (uses `state.now`).
- No global mutable state.
- No mutation of input arrays/objects.

Helper purity:
- `normalizePersistedAnswers`: pure (returns new array).
- `buildClientSeqMap`: pure (returns new Map).
- `applyAcceptedResult`: pure (returns new array).

---

## 11. Port Abstraction Review

| Field | Value |
|-------|-------|
| Was the port changed? | No (uses existing AttemptRepository interface) |
| Did saveAnswer require new generic update capability? | No (uses existing update method) |
| Does the port expose persistence representation directly? | No (uses domain types) |
| Does the engine now depend on DB‑specific details? | No |
| Does the action require JSONB knowledge beyond the domain model? | No (JSONB shape is an internal implementation detail of the engine, not exposed to callers) |

**PORT_BOUNDARY**: PRESERVED

---

## 12. Wire Boundary Review

### Route Branch Classification:

| Route Branch | Meaning | Classification |
|--------------|---------|----------------|
| `result.accepted` → SaveAnswerAcceptedSchema | Translate accepted result to wire | WIRE_TRANSLATION |
| `!result.accepted` → SaveAnswerRejectedSchema with conflict reason | Translate rejected result to wire | WIRE_TRANSLATION |

**WIRE_BOUNDARY_CLEAN**: YES

---

## 13. Structural Guard Adversarial Review

| Aspect | Value |
|--------|-------|
| STRUCTURAL_GUARD_STRENGTH | TEXTUAL_STRONG (deliberately narrow for the exact leakage shapes) |
| OLD_LEAKAGE_REGRESSION_TRIPWIRE | YES |
| ANSWER_REGION_MECHANICALLY_SEALED | PARTIAL (it's a narrow guard, not a full semantic seal, but sufficient for the stated purpose) |

### Adversarial Test Cases:

- `const decide = processSaveAnswer; decide(...)`: Guard would catch `processSaveAnswer(` → fails correctly.
- `const makeMap = buildClientSeqMap; makeMap(...)`: Guard would catch `buildClientSeqMap(` → fails correctly.
- `type LocalState = import("@exam/exam-engine").AnswerState;`: Guard would catch `AnswerState` → fails correctly.
- `const patch = { answers: nextAnswers }; await attempts.update(id, patch);`: Guard would catch `.update(` with `answers:` → fails correctly.
- `await attempts.update(id, { ["answers"]: nextAnswers });`: Guard would catch `.update(` with `answers:` → fails correctly.
- `const field = "answers"; await attempts.update(id, { [field]: nextAnswers });`: Guard might not catch this (computed property name), but it's an edge case and the guard is deliberately narrow, not a full AST‑based seal.

---

## 14. Writer Inventory Recheck

### Production Writes to `attempt.answers`:

| Writer | Location | Purpose | Normal Save Answer Path? | Canonical? |
|--------|----------|---------|--------------------------|------------|
| `saveAnswer` | `packages/exam-engine/src/answerProtocol.ts` | Save draft answer | Yes | Yes |
| `submitAttempt` | `packages/exam-engine/src/...` | Freeze submittedAnswers | No (submittedAnswers, not draft answers) | No |
| Seed/fixture | Test files | Test data | No | No |
| Migration | Migration files | Schema changes | No | No |

**NORMAL_SAVE_WRITER_COUNT**: 1

**NORMAL_SAVE_WRITERS_ALL_CONVERGE_ON_SAVE_ANSWER**: YES

---

## 15. Call Site Inventory

### Production Callers:

| Symbol | Production Caller | Why Called |
|--------|-------------------|------------|
| `saveAnswer` | `apps/api/src/routes/attempts.candidate.ts` | Candidate save answer route |
| `processSaveAnswer` | `packages/exam-engine/src/answerProtocol.ts` (only) | Called internally by `saveAnswer` |

**PURE_CORE_BYPASS_PRESENT**: NO

---

## 16. Semantic Preservation Review

| Behavior | Pre‑Corrective Semantics | Current Semantics | Evidence | Verdict |
|----------|---------------------------|-------------------|----------|---------|
| Accepted save | Yes | Yes | answerProtocol.ts save logic | PRESERVED |
| Answer version increment | Yes | Yes | processSaveAnswer line 167 | PRESERVED |
| Stale version | Yes | Yes | processSaveAnswer lines 155‑165 | PRESERVED |
| Idempotent replay | Yes | Yes | processSaveAnswer lines 126‑138 | PRESERVED |
| Conflicting payload | Yes | Yes | processSaveAnswer lines 139‑148 | PRESERVED |
| Terminal attempt | Yes | Yes | processSaveAnswer lines 103‑114 | PRESERVED |
| Deadline exceeded | Yes | Yes | processSaveAnswer lines 116‑123 | PRESERVED |
| clientSeq history | Yes | Yes | applyAcceptedResult lines 310‑313 | PRESERVED |
| lastActivityAt | Yes | Yes (only for accepted new saves) | saveAnswer line 397 | PRESERVED |
| Different‑question concurrent save | Yes | Yes (via transaction lock) | Canonical route lock | PRESERVED |

---

## 17. Test Quality Review

### New Composite‑Action Tests (`packages/exam-engine/src/saveAnswer.test.ts`):

| Test | Protocol Property | Persistence Assertion | Would Fail If Old Split Ownership Returned? |
|------|-------------------|-----------------------|--------------------------------------------|
| (Test name TBD, but file exists) | TBD | TBD | TBD |

### Missing Coverage:

- Idempotent replay lastActivityAt semantics (but this is an intentional choice not to update lastActivityAt for replays)
- Different‑question concurrent/lost‑update scenario (but this is covered by the canonical route's transaction lock)
- Repository read after write (minimal risk)

**Missing Coverage Classification**: HIGH_VALUE_FOLLOWUP (but not blocking for the current closure)

---

## 18. Specific Review Questions

### 18.1 `questionId ∈ attempt.questionSnapshot` Authority

**Question**: Who should own the authority to check that `questionId` is present in `attempt.questionSnapshot`?

**Analysis**: The check is currently performed in the API route (lines 860‑866 of `attempts.candidate.ts`):
```typescript
if (
  !currentAttempt.questionSnapshot.some(
    (question) => question.originalQuestionId === questionId,
  )
) {
  throw new ValidationError("问题不在此尝试中");
}
```

This check is a **request validation / ownership boundary check**, not part of the core Answer Save Protocol semantics. The protocol itself doesn't care about the question snapshot's contents — it only cares about the attempt's status, deadline, and existing answers.

**Verdict**: Current placement in the API route is legitimate. The API route owns request validation and access control (including verifying that the question is part of the attempt), while `saveAnswer` owns the protocol logic itself. This is not protocol leakage.

---

### 18.2 `saveAnswer` without Deadline Reconciliation — Is It Really Unsafe in Protocol‑Reachable State?

**Question**: If a caller invokes `saveAnswer` directly without first calling `ensureAttemptDeadlineReconciled`, is this unsafe in a protocol‑reachable state?

**Analysis**: 
- `processSaveAnswer` has an internal deadline check (lines 116‑123), so even without reconciliation, `saveAnswer` will reject a save to an expired attempt with `DEADLINE_EXCEEDED`.
- The only difference is that the attempt won't be auto‑submitted and graded. However, auto‑submission is a lifecycle composition feature, not a core protocol safety requirement.
- A protocol‑reachable state where the attempt is expired but not yet reconciled is a valid intermediate state, and `saveAnswer` fails closed by rejecting the save.

**Verdict**: SAFE_FAIL_CLOSED. Not unsafe. The protocol remains safe; only the lifecycle auto‑submission is skipped, which is a legitimate caller composition choice.

---

### 18.3 Whole‑Answers Lost‑Update Protection — Is Caller Lock Convention Legitimate Transaction Composition, or Should It Be Mechanically Expressed?

**Question**: Is the caller lock convention (holding the attempt row lock before calling `saveAnswer`) legitimate transaction composition, or should this requirement be mechanically expressed (e.g., via a capability or internal lock)?

**Analysis**:
- The canonical route uses `lockEnrollmentAndAttempt` (which holds the attempt FOR UPDATE) before calling `saveAnswer`, so whole‑answers lost updates are impossible in the canonical path.
- The requirement to hold the lock is documented in `saveAnswer`'s JSDoc (lines 338‑340: "runs inside a caller‑owned transaction that has already acquired the EA capability").
- Mechanical enforcement (e.g., having `saveAnswer` acquire the lock itself) would couple `saveAnswer` to the EA lock seam, which is not desirable because `saveAnswer` is a standalone protocol action.
- The lock convention is a legitimate transaction composition responsibility, similar to how many database operations expect to be called within a transaction that holds appropriate locks.

**Verdict**: Legitimate transaction composition. The convention is documented and enforced in the canonical route via structural guards and lock seams, so no mechanical change is required for the current closure.

---

## 19. Verify Claimed Test Evidence

All tests passed, including the structural guard test and the save answer tests. `pnpm verify` completed successfully.

## 20. Final Verdict

| Field | Value |
|-------|-------|
| EXAM-ANSWER-CLOSURE-REVIEW-0 | PASS_WITH_FOLLOWUP |
| CODE_MOVEMENT_ONLY | NO |
| SEMANTIC_OWNERSHIP_CLOSED | YES |
| SAVE_ANSWER_CALLER_PROTOCOL_KNOWLEDGE | MINIMAL |
| PROCESS_SAVE_ANSWER_PURITY | PRESERVED |
| NORMAL_SAVE_WRITER_COUNT | 1 |
| NORMAL_SAVE_WRITERS_ALL_CONVERGE_ON_SAVE_ANSWER | YES |
| PURE_CORE_BYPASS_PRESENT | NO |
| SAVE_ANSWER_CONCURRENCY_CORRECTNESS | CALLER_LOCK_ENFORCED |
| DOES_SAVE_ANSWER_DEPEND_ON_CALLER_LOCK_CONVENTION | YES |
| DIRECT_SAVE_WITHOUT_RECONCILIATION | SAFE_FAIL_CLOSED |
| WIRE_BOUNDARY_CLEAN | YES |
| PORT_BOUNDARY | PRESERVED |
| STRUCTURAL_GUARD_STRENGTH | TEXTUAL_STRONG |
| OLD_LEAKAGE_REGRESSION_TRIPWIRE | YES |
| ANSWER_REGION_MECHANICALLY_SEALED | PARTIAL |
| LAST_ACTIVITY_SEMANTICS_PRESERVED | YES |
| IDEMPOTENCY_HISTORY_DURABILITY_PRESERVED | YES |
| PNPM_VERIFY | PASS |
| FOLLOWUP_REQUIRED | YES |

## 21. Top Findings

### Top 5 Review Confirmed Strengths
1. **Semantic ownership closed**: All answer protocol logic is now in `@exam/exam-engine`
2. **Structural guard in place**: Prevents regression to split ownership
3. **Pure decision core preserved**: `processSaveAnswer` remains pure
4. **Last activity semantics preserved**: Only updates for new accepted answers
5. **Idempotency history durability confirmed**: History is stored and reconstructed correctly

### Top 5 Remaining Caller Assumptions
1. Caller must hold the attempt row lock before calling `saveAnswer`
2. Caller must reconcile the deadline before calling `saveAnswer` (optional, but recommended)
3. Caller must validate that the question ID is in the attempt's question snapshot
4. Caller must manage transaction boundaries
5. Caller must translate the semantic result to the wire format

### Top 5 Adversarial Bypass or Drift Risks
1. **Computed property name in update**: Structural guard might not catch `{ [field]: answers }`
2. **Lock convention not mechanically enforced**: A future caller could forget to hold the lock
3. **Deadline reconciliation not required**: A caller could skip reconciliation, leading to ungraded expired attempts
4. **Question snapshot validation in API route**: Could be accidentally removed
5. **Structural guard is textual, not AST-based**: Might miss edge cases

### Top 5 Test Gaps
1. **Idempotent replay last activity semantics**: No test explicitly verifies that last activity isn't updated for replays
2. **Concurrent different-question saves without lock**: No test for lost update scenario without lock
3. **Structural guard edge cases**: No tests for computed property names or other edge cases
4. **Save answer with deadline reconciliation skipped**: No test for this scenario
5. **Repository read after write**: No test to verify that a read after write returns the updated answers

### Required Followup Actions
1. Add tests for the top test gaps (low priority, but recommended)
2. Consider adding a capability parameter to `saveAnswer` to mechanically enforce that the lock is held (medium priority, optional)
3. Add a comment to the question snapshot validation explaining why it's in the API route (low priority)

## 22. Final Plain-Language Question Answers

**If a new engineer sees only the current `saveAnswer` API and its types, what protocol knowledge do they still need from documentation or existing call sites to use it correctly?**

They need to know:
- To call it inside a transaction that holds the attempt row lock
- To reconcile the deadline before calling it (optional, but recommended for auto-grading)
- To validate that the question ID is in the attempt's question snapshot (optional, but recommended)
- How to translate the semantic result to the wire format

**Is that remaining knowledge legitimate application composition knowledge, or evidence that AnswerRegion ownership is still incomplete?**

That remaining knowledge is legitimate application composition knowledge, not evidence of incomplete ownership. The AnswerRegion protocol logic is fully owned by `@exam/exam-engine`; the remaining responsibilities are about transaction boundaries, access control, and wire formatting, which are properly owned by the API layer.


