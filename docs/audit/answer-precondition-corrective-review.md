# EXAM-ANSWER-PRECONDITION-CORRECTIVE-REVIEW-0 — Final Adversarial Review

## 0. REVIEW BOUNDARY

This review examines `EXAM-ANSWER-PRECONDITION-CORRECTIVE-0` (commits `2186997..4d78bb9`) — the corrective that closes P1/P2/P3 save answer preconditions.

Reviewed: P1 local legality closure, P2 serialization evidence, P3 effective-deadline evidence, mutation-context provenance, dependency/cycle impact, semantic preservation.

Not reopened: AnswerState ownership closure, enum mirrors, candidate projection, grading architecture, terminal grading, global static analysis, INV-022.

---

## 1. BASELINE

```text
REVIEW_HEAD                    = 4d78bb9dc417319d0cd122e02ea103832331cc52
ANSWER_CLOSURE_COMMIT          = 2186997d402867889dbbdab3f02deaddfe6d3b13
PRECONDITION_CORRECTIVE_COMMIT = 4d78bb9dc417319d0cd122e02ea103832331cc52
PRECONDITION_CORRECTIVE_SUBJECT = "fix(exam-engine): seal answer mutation mint authority"
FILES_CHANGED                  = 7 files (+158/-159 lines)
  answer-protocol-ownership.structural.test.ts (+78/-43)
  answerPreconditions.test.ts (+1/-1 import path change)
  answerProtocol.ts (+2/-5 import change, use context.assertAttemptRepository)
  attemptMutationContext.ts (DELETED, -123 lines)
  deadlineReconciliation.ts (+95/-5, private mint + prepareReconciledAttemptMutation)
  index.ts (-1 line, barrel no longer re-exports attemptMutationContext)
  check-architecture.mjs (+4/-4, adds cast ban for ReconciledAttemptMutationContext)

UNRELATED_FILES_IN_CORRECTIVE_COMMIT = none
```

The full ANS patch from `2186997..4d78bb9` (the mint-authority seal) builds on top of the
closure patch `16d7d8e..2186997` (the P1/P2/P3 saveAnswer contract changes). The mint-authority
corrective moves the context type, brand, and private mint into `deadlineReconciliation.ts`
(the canonical preparation owner), deletes the standalone `attemptMutationContext.ts`, and
switches from an exported `assertMutationContextFor` to a closure-based
`mutationContext.assertAttemptRepository()`.

---

## 2. ACCEPTED PRE-CORRECTIVE FACTS (Defect Baseline)

Same as review spec §2 — these are the established defects this corrective closes.

---

## 3. NEW CALL GRAPH

```text
wire/auth
→ transaction
→ lockEnrollmentAndAttempt (Attempt FOR UPDATE acquired)
→ prepareReconciledAttemptMutation
    → assertCapabilityFor(capability, enrollmentRepo, attemptRepo)
    → ensureAttemptDeadlineReconciled(...) [freeze if expired, else unchanged]
    → examRepo.findById(attempt.examId)
    → computeEffectiveDeadline(exam, attempt)
    → mintReconciledAttemptMutationContext(attemptId, now, effectiveDeadline, attemptRepo)
    → returns { attempt, mutationContext }
→ candidate-ownership check (route-level)
→ saveAnswer(attemptRepo, mutationContext, request)
    → mutationContext.assertAttemptRepository(attemptRepo)  [P2]
    → request.attemptId === mutationContext.attemptId     [identity binding]
    → attemptRepo.findById(mutationContext.attemptId)
    → questionSnapshot.some(...)                           [P1 membership]
    → normalizePersistedAnswers + buildClientSeqMap
    → processSaveAnswer(state with deadlineAt=mutationContext.effectiveDeadline,
                         now=mutationContext.checkedAt)   [P3]
    → applyAcceptedResult
    → attemptRepo.update(attemptId, { answers, lastActivityAt })
```

### Responsibility Ownership Table

| Responsibility | Owner | Canonical symbol |
| -------------- | ----- | ---------------- |
| Row lock acquisition (Enrollment FOR UPDATE → Attempt FOR UPDATE) | `lockSeam.ts` | `lockEnrollmentAndAttempt` |
| EA lock-order proof | `lockSeam.ts` | `assertCapabilityFor` |
| Deadline reconciliation (freeze/grade) | `deadlineReconciliation.ts` | `ensureAttemptDeadlineReconciled` |
| Canonical effective-deadline derivation | `deadlineReconciliation.ts` | `computeEffectiveDeadline` (also through `isAttemptDeadlineExpired`) |
| Mutation-context mint | `deadlineReconciliation.ts` | `mintReconciledAttemptMutationContext` (PRIVATE) |
| Preparation seam (composes lock + reconciliation + mint) | `deadlineReconciliation.ts` | `prepareReconciledAttemptMutation` |
| Repo-affinity assertion | closure inside context | `mutationContext.assertAttemptRepository()` |
| Question-membership legality | `answerProtocol.ts` | inside `saveAnswer` |
| Answer decision | `answerProtocol.ts` | `processSaveAnswer` |
| Draft persistence | `answerProtocol.ts` | inside `saveAnswer` |
| Wire translation | `apps/api/src/routes/attempts.candidate.ts` | route handler |

---

## 4. MUTATION CONTEXT PROVENANCE — Primary Attack

### Identity

```text
MUTATION_CONTEXT_TYPE = ReconciledAttemptMutationContext
MUTATION_CONTEXT_MODULE = deadlineReconciliation.ts
PROVENANCE_SYMBOL = MUTATION_CONTEXT_BRAND (unique symbol, module-private const)
AFFINITY_SYMBOL = (closure capture — assertAttemptRepository)
MINT_FUNCTION = mintReconciledAttemptMutationContext (function, NOT exported)
ASSERT_FUNCTION = mutationContext.assertAttemptRepository() (closure method)
```

### Forgery Attack Table

| Forgery shape | Type rejects | Arch/structural guard rejects | Runtime rejects |
| ------------- | -----------: | ----------------------------: | --------------: |
| `{ attemptId, checkedAt, effectiveDeadline }` as `ReconciledAttemptMutationContext` | YES — brand symbol is missing, property `MUTATION_CONTEXT_BRAND` + `assertAttemptRepository` missing | YES — `lint:arch` bans `as ReconciledAttemptMutationContext` in production | N/A — type rejects before runtime |
| `{} as ReconciledAttemptMutationContext` | NO (TypeScript allows structurally incompatible `as` casts) | YES — `lint:arch` regex `/as ReconciledAttemptMutationContext\b/` rejects in production | N/A — arch lint fails |
| `unknownValue as ReconciledAttemptMutationContext` | NO (same `as` shape) | YES — arch lint | N/A |
| `import { mintReconciledAttemptMutationContext } from "./deadlineReconciliation"` | N/A | YES — mint is NOT exported (structural test confirms `not.toMatch(/export function mint/)`) | YES — module-private, import resolves to nothing |
| Calling `prepareReconciledAttemptMutation` directly | Allowed (it is exported) | YES — but this IS the canonical path, no forgery | N/A — this is the legitimate producer |
| Calling `prepareReconciledAttemptMutation` with a wrong `now` or arbitrary `attempt` | NO — still goes through canonical `computeEffectiveDeadline` | YES — must pass valid repos + capability | YES — `assertCapabilityFor` rejects wrong repos |

### Verdict

```text
MUTATION_CONTEXT_PROVENANCE = STRONG
```

**Justification:** The brand symbol `MUTATION_CONTEXT_BRAND` is a `unique symbol` — TypeScript's
unforgeable brand pattern. The mint function is NOT exported. The standalone authority module
(`attemptMutationContext.ts`) is deleted. The type still carries the hidden brand property
`[MUTATION_CONTEXT_BRAND]: true`. Normal external TypeScript code cannot object-literal-construct
the context because the brand property is inaccessible (`unique symbol` not importable); any
attempt to `as`-cast is blocked by the architecture lint regex `\bas\s+ReconciledAttemptMutationContext\b`
in both `packages/exam-engine/src/` and `apps/api/src/`.

There are two nuances to evaluate:

1. **`as const` on the brand value**: The mint uses `[MUTATION_CONTEXT_BRAND]: true as const`.
   This means an external caller who observed an existing context object (e.g. via a debugger)
   could infer that the brand property value is `true`, but they still cannot set the
   symbol-keyed property from outside the module.

2. **`prepareReconciledAttemptMutation` is exported**: This is intentional — the legitimate
   canonical preparation path. It is not a forgery vector because it validates the EA capability,
   runs reconciliation, computes the deadline via `computeEffectiveDeadline`, and only then mints.

---

## 5. Does the Mint Actually Prove P2?

### Provenance Chain

```text
context mint (deadlineReconciliation.ts:395-400)
  ← multiple assertions:
    ← assertCapabilityFor(capability, enrollmentRepo, attemptRepo)  [deadlineReconciliation.ts:369]
      ← capability minted by lockEnrollmentAndAttempt [lockSeam.ts:68-120]
        ← Enrollment FOR UPDATE  [lockSeam.ts:81-88]
        ← Attempt FOR UPDATE     [lockSeam.ts:99-102]
        ← mint capability with hidden { enrollmentRepo, attemptRepo } affinity
```

### Required Answers

```text
MINT_REQUIRES_EA_CAPABILITY = YES
  — deadlineReconciliation.ts:369 calls assertCapabilityFor(...) BEFORE minting

MINT_ASSERTS_EA_CAPABILITY_FOR_EXACT_REPOS = YES
  — assertCapabilityFor checks reference identity (===) of both enrollmentRepo and attemptRepo

ATTEMPT_ROW_LOCK_IS_ESTABLISHED_BEFORE_MINT = YES
  — lockEnrollmentAndAttempt acquires Attempt FOR UPDATE at lockSeam.ts:99
  — assertCapabilityFor proves this exact lock was acquired against these exact repos

CONTEXT_STORES_ATTEMPT_REPO_AFFINITY = YES
  — the closure assertAttemptRepository captures the exact attemptRepo reference at mint time

SAVE_ANSWER_ASSERTS_EXACT_ATTEMPT_REPO_AFFINITY = YES
  — answerProtocol.ts:385: mutationContext.assertAttemptRepository(attemptRepo)
  — this is reference identity comparison (===)
```

### Repo A / Repo B Attack

```text
Repo A:
  lock + mint context
Repo B:
  saveAnswer(repoB, context, request)
```

```text
REJECT_BEFORE_WRITE
```

**Proof:** `mutationContext.assertAttemptRepository(repoB)` at `answerProtocol.ts:385`
will throw `"transaction-affinity violation"` because the closure captured the reference
to repo A and compares with `!==` against repo B. The error is thrown BEFORE any
`attemptRepo.findById()` call (line 395), so no read, no mutation, no write occurs.

### Verdict

```text
P2_SERIALIZATION_EVIDENCE = PROVEN
```

**Rationale:** The mint function runs inside a function that first calls `assertCapabilityFor`,
which requires the exact repo objects that the capability was minted against. This proves
the Attempt row lock is held. The context closure captures the exact attemptRepo reference.
`saveAnswer` asserts repo identity against that reference. Any repo mismatch is rejected
before any DB access. The evidence proves "this exact saveAnswer repository is the locked
transaction-scoped repository."

---

## 6. Does the Mint Actually Prove P3?

### Trace

```text
prepareReconciledAttemptMutation:
  1. ensureAttemptDeadlineReconciled (reconciliation/freeze)
  2. examRepo.findById(attempt.examId)
  3. computeEffectiveDeadline(exam, attempt)     ← CANONICAL authority
  4. mintReconciledAttemptMutationContext(...,
       effectiveDeadline,                          ← output of step 3
       ...)

saveAnswer:
  5. processSaveAnswer({ deadlineAt: mutationContext.effectiveDeadline })
     ← uses the canonical value, NOT attempt.deadlineAt
  6. condition: state.deadlineAt && now.getTime() >= state.deadlineAt.getTime()
```

### Required Answers

```text
Is computeEffectiveDeadline the exact existing canonical function? YES
  — deadlineReconciliation.ts:157-174, unchanged

Is its result used directly in the context? YES
  — deadlineReconciliation.ts:390: const effectiveDeadline = computeEffectiveDeadline(exam, attempt)
  — same value passed to mint at line 395

Can caller supply or override effectiveDeadline? NO
  — the mint function receives it as a param but is PRIVATE
  — the public API prepareReconciledAttemptMutation COMPUTES it, never accepts it

Can mint accept a caller-provided raw deadline? YES, but mint is private
  — mintReconciledAttemptMutationContext(effectiveDeadline) takes effectiveDeadline as param
  — but the only call site is prepareReconciledAttemptMutation which passes the computed value

Is attempt.deadlineAt still passed to processSaveAnswer? NO
  — answerProtocol.ts:432: deadlineAt: mutationContext.effectiveDeadline

Does saveAnswer load Exam independently? NO
  — not in saveAnswer's code path; the exam is loaded by prepareReconciledAttemptMutation

Does saveAnswer duplicate min(exam.closeAt, attempt.deadlineAt)? NO
  — saveAnswer trusts the context value; no re-derivation
```

### Verdict

```text
P3_EFFECTIVE_DEADLINE_EVIDENCE = CANONICAL_PROVENANCE
```

**Rationale:** The effective deadline in the context is produced by `computeEffectiveDeadline(exam, attempt)`
inside `prepareReconciledAttemptMutation`. The mint function is private and cannot be called
with a caller-supplied value. `saveAnswer` passes `mutationContext.effectiveDeadline` to
`processSaveAnswer`. There is no way for a caller to supply or override the effective deadline.

---

## 7. P3 Counterexample Replay

### Input

```text
exam.openAt         = 09:00
exam.closeAt        = 10:00
duration            = 90 minutes
candidate starts    = 09:55
attempt.deadlineAt  = 11:25
now                 = 10:10
attempt.status       = in_progress
```

### Trace

| Step | State/Result |
| ---- | ------------ |
| EA lock | `lockEnrollmentAndAttempt` → Enrollment FOR UPDATE + Attempt FOR UPDATE |
| assemble repos + capability | pass to `prepareReconciledAttemptMutation` |
| assertCapabilityFor | OK (same repos) |
| ensureAttemptDeadlineReconciled | Loads exam (closeAt=10:00), calls `isAttemptDeadlineExpired(exam, attempt, 10:10)` = `10:10 >= min(10:00, 11:25)=10:00` = **true** |
| freeze | `submitAttempt` with `submissionReason='deadline'` and `effectiveDeadline=10:00` |
| post-freeze attempt.status | `submitted` (if auto-grading completes) or `grading`/`pending_manual` |
| context minted with effectiveDeadline | `computeEffectiveDeadline(exam, frozenAttempt)` = `10:00` |
| saveAnswer called | `mutationContext.effectiveDeadline` = `10:00`, checkedAt = `10:10` |
| P2 affinity check | OK (same repo) |
| P1 membership | OK (valid question) |
| processSaveAnswer | attempt status is submitted → `ATTEMPT_ALREADY_SUBMITTED` rejection |
| attempt.answers write | **NO** — `draftAnswerWriteCount() = 0` |

```text
LATE_START_COUNTEREXAMPLE_CLOSED = YES
```

### Direct Typed Save Without Preparation

```text
DIRECT_TYPED_SAVE_WITHOUT_PREPARATION = TYPE_REJECTED
```

**Proof:** `saveAnswer`'s signature is `(attemptRepo, mutationContext, request)`. The second
parameter is `ReconciledAttemptMutationContext`, which cannot be object-literal-constructed
(brand symbol is unaddressable). Casting is blocked by arch lint. The old 4-arg shape
`saveAnswer(repo, attemptId, request, now)` is rejected at compile time because `string` is
not assignable to `ReconciledAttemptMutationContext`. The type-level test at
`answerPreconditions.test.ts:416-453` explicitly verifies this with `@ts-expect-error`
guards that would produce unused-error TS2578 if the old shape became valid again.

---

## 8. Exact Deadline Boundary

```text
PURE_SAVE_EXPIRY_OPERATOR =
  >=
  (answerProtocol.ts:122)

DEADLINE_EXCEEDED
NO DRAFT WRITE

isAttemptDeadlineExpired uses >=
  (deadlineReconciliation.ts:192)

DEADLINE_BOUNDARY_ALIGNED = YES
```

The corrective changed `>` to `>=` in `processSaveAnswer`, aligning it with `isAttemptDeadlineExpired`.
Both now use `now >= deadline`. The test `"rejects save when now equals deadline exactly"` in
`answerProtocol.test.ts` verifies this boundary. The composition test `4.3` in
`answerPreconditions.test.ts` verifies the seam freezes at equality.

---

## 9. P1 Question Membership

### Trace

```text
saveAnswer with:
  valid attempt (questionSnapshot contains q1)
  valid context
  valid deadline
  questionId = "q-NOT-IN-SNAPSHOT" (not in attempt.questionSnapshot)
```

```text
P1_NONMEMBER_RESULT = REJECT (ValidationError thrown BEFORE any write)
```

**Proof:** `answerProtocol.ts:406-411` — `isMember` check returns false → throws `ValidationError`.
The negative proof test at `answerPreconditions.test.ts:31-57` confirms:
- `draftAnswerWriteCount() = 0`
- `attempt.answers` identity unchanged

Error type matches the old route's `ValidationError`, preserving the HTTP contract.

```text
P1_LOCAL_LEGALITY_CLOSED = YES
```

---

## 10. Context Identity and Time Binding

```text
CONTEXT_BOUND_TO_ATTEMPT = YES
  — context.attemptId is set at mint time; saveAnswer asserts request.attemptId === context.attemptId

CONTEXT_BOUND_TO_CHECKED_AT = YES
  — context.checkedAt is the `now` passed to prepareReconciledAttemptMutation; used as the single
    time authority for deadline decision, savedAt, and lastActivityAt

CONTEXT_BOUND_TO_EFFECTIVE_DEADLINE = YES
  — context.effectiveDeadline is computed by computeEffectiveDeadline

CONTEXT_BOUND_TO_ATTEMPT_REPO = YES
  — closure capture of attemptRepo at mint time; runtime assertion at save

SECOND_CALLER_NOW_PARAMETER_EXISTS = NO
  — saveAnswer no longer has a `now` parameter. All time flows through context.checkedAt
```

### Time Snapshot Unity

The same `now` passed to `prepareReconciledAttemptMutation` is used as:
- `context.checkedAt` (immutable time snapshot)
- `context.checkedAt` → `processSaveAnswer.now` → deadline decision
- `context.checkedAt` → `savedAt` (via `now.toISOString()` inside pure core)
- `context.checkedAt` → `lastActivityAt` (on accepted write)

No second wall-clock read in `saveAnswer`.

---

## 11. Capability Scope Review

### Fields Carried vs Needed

| Fact | Carried in context | Needed by | Overbroad? |
| ---- | ------------------ | --------- | ---------: |
| attemptId | yes | identity binding | NO |
| checkedAt | yes | time authority | NO |
| effectiveDeadline | yes | P3 precondition | NO |
| MUTATION_CONTEXT_BRAND | yes (symbol key) | provenance | NO |
| `assertAttemptRepository` closure | yes (method) | repo affinity | NO |
| Enrollment object | NO | — | — |
| EnrollmentRepository | NO | — | — |
| Grading state | NO | — | — |
| GradingWorksetRepository | NO | — | — |
| Authorization decision | NO | — | — |
| Actor identity | NO | — | — |

```text
MUTATION_CONTEXT_SCOPE = NARROW
```

### Additional Checks

```text
SAVE_ANSWER_ACCEPTS_EA_CAPABILITY = NO
SAVE_ANSWER_LOADS_EXAM = NO
SAVE_ANSWER_RUNS_RECONCILIATION = NO
SAVE_ANSWER_ACQUIRES_LOCK = NO
```

All verified by reading `saveAnswer`'s code (lines 376–454):
- No `LockedEnrollmentAttemptIdentity` parameter
- No `examRepo.findById` call
- No `ensureAttemptDeadlineReconciled` call
- No `findByIdForUpdate` call (uses `findById`)

---

## 12. Deadline Reconciliation Remains Cross-Region

```text
CROSS_REGION_RECONCILIATION_BOUNDARY_PRESERVED = YES
```

**Proof:**
- `ensureAttemptDeadlineReconciled`, `submitAttempt`, `readGradingSnapshot`, `finalizeGrading`
  all remain in `deadlineReconciliation.ts` (called by `prepareReconciledAttemptMutation`)
- `saveAnswer` does NOT contain any freeze/submit/grading code
- `saveAnswer` does not import `ensureAttemptDeadlineReconciled`, `submitAttempt`,
  `readGradingSnapshot`, or `finalizeGrading`

---

## 13. Module Graph / Cycle Review

### Runtime Import Graph (exact edges)

```text
deadlineReconciliation.ts
  → import { submitAttempt } from "./attemptCommands.js"
  → import { readGradingSnapshot, finalizeGrading } from "./grading.js"
  → import { assertCapabilityFor, type LockedEnrollmentAttemptIdentity } from "./lockSeam.js"
  → import type { AttemptRepository, EnrollmentRepository } from "./attemptCommands.js"  (type-only)
  → import type { ExamRepository } from "./examCommands.js"                                (type-only)
  → import type { GradingWorksetRepository } from "./gradingWorkset.js"                    (type-only)

answerProtocol.ts:
  → import type { ReconciledAttemptMutationContext } from "./deadlineReconciliation.js"     (TYPE-ONLY)
  → import type { AttemptRepository } from "./attemptCommands.js"                          (type-only)

NO import from answerProtocol.ts → deadlineReconciliation.ts (runtime)
NO import from deadlineReconciliation.ts → answerProtocol.ts (any)
NO import from lockSeam.ts → deadlineReconciliation.ts
NO import from deadlineReconciliation.ts → lockSeam.ts (runtime) — done via type-only
```

```text
RUNTIME_IMPORT_CYCLE_INTRODUCED = NO

ANSWER_PROTOCOL_RUNTIME_DEPENDS_ON_DEADLINE_RECONCILIATION = NO
  — answerProtocol.ts only imports the TYPE ReconciledAttemptMutationContext (type-only import).
    At runtime, this import is erased by TypeScript. There is no runtime dependency edge
    from answerProtocol.ts to deadlineReconciliation.ts.

MUTATION_CONTEXT_MODULE_RUNTIME_DEPS = <same as deadlineReconciliation.ts's deps>
  — submitAttempt (runtime) in attemptCommands.ts
  — readGradingSnapshot, finalizeGrading in grading.ts (runtime)
  — assertCapabilityFor in lockSeam.ts (runtime)
  — type-only imports: AttemptRepository, EnrollmentRepository, ExamRepository, GradingWorkset

TYPE_ONLY_CYCLES = NONE
```

### Verification

The closure approach (`mutationContext.assertAttemptRepository`) was chosen specifically to
break a potential cycle. With the old `assertMutationContextFor` function, `answerProtocol.ts`
would import from `attemptMutationContext.ts`, which was fine because it was a leaf. But after
moving the context into `deadlineReconciliation.ts`, a direct runtime import from
`answerProtocol.ts` to `deadlineReconciliation.ts` would create a cycle since
`deadlineReconciliation.ts` imports from other engine modules that may transitively reach
`answerProtocol.ts`. The closure approach avoids the need for `answerProtocol.ts` to import
`assertMutationContextFor` as a runtime symbol — the assertion is already baked into the
closure at mint time.

```text
MODULE_GRAPH_CLEAN = YES
```

### Exam-engine Import Rules

```text
exam-engine still imports neither contracts nor db:
  — Verified: no "from '@exam/contracts'" or "from '@exam/db'" in any exam-engine file
  — The old attemptMutationContext.ts had no such imports; the replacement inside
    deadlineReconciliation.ts also has none
```

---

## 14. Semantic Preservation

### Behavior Comparison Table

| Behavior | Pre-corrective | Current | Verdict |
| --------- | ------------- | ------- | ------- |
| Accepted save (valid attempt, in_progress, before deadline, member question) | `saveAnswer(repo, id, request, now)` → accepted | `saveAnswer(repo, ctx, request)` → accepted | **PRESERVED** |
| Version increments (1, 2, 3) | Yes | Yes | **PRESERVED** |
| Stale version rejection | Yes (STALE_VERSION) | Yes (STALE_VERSION) | **PRESERVED** |
| Idempotent replay (no write, original savedAt) | Yes | Yes | **PRESERVED** |
| Conflicting payload rejection | Yes (CONFLICTING_PAYLOAD) | Yes (CONFLICTING_PAYLOAD) | **PRESERVED** |
| Submitted/terminal rejection | Yes (ATTEMPT_ALREADY_SUBMITTED) | Yes (ATTEMPT_ALREADY_SUBMITTED) | **PRESERVED** |
| clientSeq history durability | Yes | Yes | **PRESERVED** |
| lastActivityAt | `now` parameter | `mutationContext.checkedAt` (same server-time value) | **PRESERVED** |
| savedAt authoritative time | `now.toISOString()` inside pure core | `mutationContext.checkedAt.toISOString()` (same value) | **PRESERVED** |
| Exact-deadline behavior | `>` → accepted at equality | `>=` → rejected at equality | **INTENTIONAL_CANONICAL_ALIGNMENT** |
| Accepted write count (per call) | 1 | 1 | **PRESERVED** |
| Rejection write count | 0 | 0 | **PRESERVED** |

---

## 15. Route Knowledge Delta

| Caller knowledge | Classification | Legitimate? |
| ---------------- | -------------- | ----------: |
| `transaction` lifecycle | `TRANSACTION_MECHANICS` | YES |
| `lockEnrollmentAndAttempt` | `CROSS_REGION_PROTOCOL` | YES |
| `prepareReconciledAttemptMutation` | `CROSS_REGION_PROTOCOL` | YES |
| Candidate-ownership check | `APPLICATION_COMPOSITION` | YES |
| `saveAnswer(repo, mutationContext, request)` | `APPLICATION_COMPOSITION` | YES |
| Result → wire mapping | `WIRE` | YES |
| Question membership legality | OWNED BY saveAnswer | NO — removed from route |
| `attempt.deadlineAt` for save legality | OWNED BY context | NO — removed from route |
| `AnswerState` construction | ENGINE-INTERNAL | NO — verified absent by structural test |
| `buildClientSeqMap` | ENGINE-INTERNAL | NO — verified absent by structural test |
| `attempt.answers` write | ENGINE-INTERNAL | NO — verified absent by structural test |

```text
SAVE_ANSWER_CALLER_PROTOCOL_KNOWLEDGE = MINIMAL
```

The route composes: transaction → EA lock → preparation seam → ownership check →
saveAnswer → wire translation. It does not independently know any answer protocol detail.

---

## 16. Structural / Anti-Forgery Guard Review

### Guard Classification

| Guard | Type | Scope |
| ----- | ---- | ----- |
| `unique symbol` brand | `SEMANTIC` | `ReconciledAttemptMutationContext` interface has private `[MUTATION_CONTEXT_BRAND]: true` |
| `as ReconciledAttemptMutationContext` cast ban | `TEXTUAL_STRONG` | `scripts/check-architecture.mjs` — production code only (test helpers exempt) |
| `@ts-expect-error` compile-time guards | `SEMANTIC` + `AST_STRUCTURAL` | `answerPreconditions.test.ts` — verifies object-literal construction and old-signature both fail typecheck |
| Mint is private (not exported) | `AST_STRUCTURAL` | `function mintReconciledAttemptMutationContext` — no `export` keyword |
| Barrel export removed | `TEXTUAL_NARROW` | `index.ts` no longer re-exports `attemptMutationContext` |
| Standalone module deleted | `TEXTUAL_STRONG` | `attemptMutationContext.ts` is deleted; test verifies file doesn't exist |

### Verdicts

```text
NORMAL_CONSTRUCTION_MECHANICALLY_BLOCKED = YES
  — unique symbol brand is inaccessible outside the module
  — object-literal construction fails at typecheck (missing brand + assertAttemptRepository)

PRODUCTION_CAST_FORGERY_GUARDED = YES
  — `as ReconciledAttemptMutationContext` banned by arch lint in both exam-engine and apps/api
  — testHelpers.ts exemption is correct (tests need in-memory setup; the testHelpers use the
    canonical prepare() function, not direct minting)

WRONG_REPO_CONTEXT_RUNTIME_REJECTED = YES
  — closure `assertAttemptRepository` uses reference identity (===)
  — attested by test 4.4: "P2 — mutation context used with a different AttemptRepository
    object rejects at runtime"
```

---

## 17. Test Quality

### Coverage Table

| Test | Property | Production behavior asserted | Quality |
| ---- | -------- | ---------------------------- | ------- |
| 4.1 P1 — non-member question rejection | P1 | Zero writes, ValidationError thrown | **STRONG** |
| 4.2 P3 — late-start effective deadline | P3 | Seam freezes attempt, canonical deadline = exam.closeAt, zero draft writes | **STRONG** |
| 4.3 exact boundary — now === effectiveDeadline | P3 | Seam freezes at equality, zero draft writes | **STRONG** |
| 4.4 P2 — wrong repo affinity rejection | P2 | Error thrown, zero writes on wrong repo | **STRONG** |
| 4.5 type-level — saveAnswer requires context | Architectural | Signature requires mutation context, old 4-arg shape rejected | **STRONG** (compile-time) |
| context identity mismatch — wrong attemptId | Identity | Error thrown, zero writes | **STRONG** |
| Regression — accepted save | Closure | One write, correct version, correct lastActivityAt | **STRONG** |
| Regression — stale version | Semantic | Rejected, zero writes | **STRONG** |
| Regression — idempotent replay | Semantic | Accepted, zero writes, original savedAt returned | **STRONG** |
| Regression — conflicting payload | Semantic | Rejected, zero writes, latestAnswer in conflict | **STRONG** |
| Regression — accepted save stamps lastActivityAt | Semantic | Uses context checkedAt | **STRONG** |
| Regression — clientSeq history | Semantic | Idempotent replay across saves works | **STRONG** |
| Structural — route delegates to preparation seam | P0 | Route calls `prepareReconciledAttemptMutation` | **STRONG** |
| Structural — route does not own membership legality | P1 | Route has no `questionSnapshot.some` | **STRONG** |
| Structural — arch lint bans cast | Forgery | Arch lint has regex ban | **STRONG** |
| Structural — mint is private | Provenance | No `export function mintReconciled` | **STRONG** |
| Structural — barrel doesn't re-export | Provenance | No `export * from "./attemptMutationContext"` | **STRONG** |
| Type opacity — object-literal rejection | Forgery | @ts-expect-error at typecheck | **STRONG** |
| Old 4-arg call rejection | Signature | @ts-expect-error at typecheck | **STRONG** |

### Missing Coverage Assessment

| Case | Classification | Notes |
| ---- | ------------- | ----- |
| Non-member question no-write | **COVERED** (4.1) | — |
| Late-start effective deadline | **COVERED** (4.2) | — |
| Deadline equality | **COVERED** (4.3 + pure test) | — |
| Wrong repo affinity | **COVERED** (4.4) | — |
| Attempt identity mismatch | **COVERED** ("context is bound" test) | — |
| Raw direct call type rejection | **COVERED** (@ts-expect-error) | Compile-time guard |
| Context forgery | **COVERED** (structual + arch lint) | Multiple guard layers |
| Accepted save regression | **COVERED** (multiple tests) | — |
| Idempotency regression | **COVERED** | — |

```text
No BLOCKING missing coverage.
```

---

## 18. Verify Current HEAD

### Test Results

```text
pnpm --filter @exam/exam-engine test   → 402 tests passed (23 files)
pnpm --filter @exam/api test            → 146 tests passed (6 files) [structural tests]
pnpm typecheck                          → PASS (17 tasks cached)
pnpm lint:arch                          → Architecture checks passed
pnpm lint:copy                          → No hardcoded business copy found
pnpm lint                               → Code quality checks passed
```

All tests run on committed HEAD `4d78bb9`. No test artifacts from previous runs.

---

## 19. Findings

| ID | Finding | Classification | Severity | Evidence |
| -- | ------- | -------------- | -------- | -------- |
| F0 | Save Answer composite action is sealed: context type, brand, and private mint co-located under the canonical preparation owner | **PASS_CONFIRMED** | INFO | `deadlineReconciliation.ts:32-113` — brand is module-private, mint is not exported, standalone module deleted |
| F1 | P1 membership legality enforced inside saveAnswer | **PASS_CONFIRMED** | — | `answerProtocol.ts:406-411` — `questionSnapshot.some(originalQuestionId === request.questionId)` |
| F2 | P2 serialization established: mint requires EA capability, asserts repo affinity, saveAnswer asserts exact repo identity | **PASS_CONFIRMED** | — | Full chain verified in §5 |
| F3 | P3 effective deadline canonical provenance: computed by `computeEffectiveDeadline` in prep seam, mint is private, saveAnswer uses context value | **PASS_CONFIRMED** | — | Full chain verified in §6 |
| F4 | Late-start counterexample closed: reconciliation freezes attempt at effective deadline before saveAnswer runs | **PASS_CONFIRMED** | — | Verified in §7 |
| F5 | Exact deadline boundary aligned to `>=` | **PASS_CONFIRMED** | — | `answerProtocol.ts:122` matches `deadlineReconciliation.ts:192` |
| F6 | NORMAL_CONSTRUCTION_MECHANICALLY_BLOCKED = YES | **PASS_CONFIRMED** | — | unique symbol + arch lint ban + compile-time tests |
| F7 | Module graph clean: no runtime import cycle | **PASS_CONFIRMED** | — | Verified in §13 |
| F8 | `prepareReconciledAttemptMutation` is exported | **NON_ISSUE** | INFO | Intentional — it is the canonical preparation seam. Any caller must pass valid EA capability, which is then asserted via `assertCapabilityFor`. This is not a forge vector. |
| F9 | `computeEffectiveDeadline` is exported through barrel | **NON_ISSUE** | INFO | Still exported for display/presentation use by API layer. A caller cannot use it to forge a context because the mint is private. |

No CRITICAL, HIGH, or MEDIUM findings discovered.

---

## 20. Pass Criteria

| # | Criterion | Result |
| - | --------- | ------ |
| 1 | P1 membership legality enforced inside saveAnswer | YES |
| 2 | Non-member question cannot be persisted | YES |
| 3 | saveAnswer requires narrow opaque mutation evidence | YES |
| 4 | Normal typed code cannot call saveAnswer with only raw attemptId/request/now | YES (TYPE_REJECTED) |
| 5 | Mutation evidence provenance ultimately depends on canonical EA lock seam | YES |
| 6 | Mint path asserts EA capability against exact repo objects | YES |
| 7 | Mutation context bound to exact AttemptRepository object | YES (closure capture) |
| 8 | saveAnswer runtime-asserts exact AttemptRepository affinity | YES |
| 9 | Context bound to attempt identity | YES |
| 10 | Context bound to one authoritative checkedAt snapshot | YES |
| 11 | Effective deadline comes from `computeEffectiveDeadline` authority | YES |
| 12 | Caller cannot supply or override raw effective deadline | YES (mint private) |
| 13 | saveAnswer passes canonical effective deadline into pure decision | YES |
| 14 | Pure expiry uses canonical `>=` boundary | YES |
| 15 | Late-start counterexample closed | YES |
| 16 | saveAnswer does not accept EA capability directly | YES |
| 17 | saveAnswer does not load Exam | YES |
| 18 | saveAnswer does not execute reconciliation | YES |
| 19 | saveAnswer does not acquire another row lock | YES (uses findById, not findByIdForUpdate) |
| 20 | Deadline reconciliation remains cross-region composition | YES |
| 21 | No new runtime import cycle exists | YES |
| 22 | exam-engine still imports neither contracts nor db | YES |
| 23 | Transaction ownership remains in apps/api | YES |
| 24 | Normal draft-answer writer count remains one | YES (saveAnswer in answerProtocol.ts) |
| 25 | Semantic Save Answer behavior preserved except exact-deadline alignment | YES |
| 26 | pnpm verify passes | YES (typecheck, lint:arch, lint:copy, lint all pass; 402 engine tests pass) |

**All 26 criteria met.**

---

## 21. Final Verdict

```text
EXAM-ANSWER-PRECONDITION-CORRECTIVE-REVIEW-0:
  PASS

P1_LOCAL_LEGALITY_CLOSED =
  YES

P2_SERIALIZATION_EVIDENCE =
  PROVEN

P3_EFFECTIVE_DEADLINE_EVIDENCE =
  CANONICAL_PROVENANCE

MUTATION_CONTEXT_PROVENANCE =
  STRONG

MUTATION_CONTEXT_SCOPE =
  NARROW

NORMAL_CONSTRUCTION_MECHANICALLY_BLOCKED =
  YES

PRODUCTION_CAST_FORGERY_GUARDED =
  YES

WRONG_REPO_CONTEXT_RUNTIME_REJECTED =
  YES

LATE_START_COUNTEREXAMPLE_CLOSED =
  YES

DEADLINE_BOUNDARY_ALIGNED =
  YES

DIRECT_TYPED_SAVE_WITHOUT_PREPARATION =
  TYPE_REJECTED

SAVE_ANSWER_ACCEPTS_EA_CAPABILITY =
  NO

SAVE_ANSWER_LOADS_EXAM =
  NO

SAVE_ANSWER_RUNS_RECONCILIATION =
  NO

SAVE_ANSWER_ACQUIRES_LOCK =
  NO

CROSS_REGION_RECONCILIATION_BOUNDARY_PRESERVED =
  YES

RUNTIME_IMPORT_CYCLE_INTRODUCED =
  NO

MODULE_GRAPH_CLEAN =
  YES

NORMAL_DRAFT_ANSWER_WRITER_COUNT =
  1

SAVE_ANSWER_CALLER_PROTOCOL_KNOWLEDGE =
  MINIMAL

PNPM_VERIFY =
  PASS

FINAL_ANSWER_REGION_STATUS =
  CLOSED

TASK_CLOSED =
  YES
```

---

## 22. Final Architecture Questions

### What exact fact does the mutation context prove?

The `ReconciledAttemptMutationContext` proves that the canonical preparation seam
(`prepareReconciledAttemptMutation`) ran on the current transaction's scope, which means:

1. The EA lock seam (`lockEnrollmentAndAttempt + assertCapabilityFor`) acquired the
   Enrollment and Attempt row locks against the exact repo objects being used.
2. The Attempt row is serialized under the Attempt FOR UPDATE lock.
3. Canonical deadline reconciliation (`ensureAttemptDeadlineReconciled`) has been executed
   (the attempt may be frozen if expired).
4. The canonical effective deadline is `computeEffectiveDeadline(exam, attempt)` — the single
   authority — captured at mint time.
5. The context is bound to the exact AttemptRepository reference, proving the same tx-scoped
   repo.
6. The context is bound to the exact attempt identity and authoritative time snapshot.

### Could a future AI agent remove deadline reconciliation from the Save Answer path and still obtain valid mutation evidence?

Yes. `prepareReconciledAttemptMutation` is the only mint authority. Any agent that removes
`ensureAttemptDeadlineReconciled` from it would still get a context — but one whose
post-reconciliation attempt state and effective deadline are wrong. This would be a
correctness regression introduced by modifying `prepareReconciledAttemptMutation`,
not a forge bypass.

### Could a future AI agent call `saveAnswer` on an unlocked Attempt row without forging the context?

No. The context is minted only by `prepareReconciledAttemptMutation`, which calls
`assertCapabilityFor` (proving the lock was acquired). Without a valid context, the call to
`saveAnswer` fails at typecheck (missing brand) or, if cast-forced, fails at arch lint.
Even if the arch lint were removed and a cast slipped through, the runtime affinity assertion
in the closure would fail because the mint-time AttemptRepository reference would be from a
different (unlocked) object. The nuance: if someone constructed a same-repo in-memory fake
across the same locked session, the reference-identity check would pass — but they would need
to bypass both TypeScript, arch lint, and still have access to the exact repo reference, which
requires being inside the locked transaction where `prepareReconciledAttemptMutation` is
available anyway. The seal is effective.

### Does `saveAnswer` now own all local Answer command legality while remaining ignorant of Exam/Enrollment/Grading orchestration?

Yes. `saveAnswer` owns:
- P1 question membership legality (`questionSnapshot.some(...)`)
- P2 repo-affinity assertion via context method
- P3 acceptance of canonical effective deadline from context
- AnswerState reconstruction (normalize + clientSeqMap)
- Pure decision (`processSaveAnswer`)
- Apply and persist (draft `answers` write + `lastActivityAt` heartbeat)

It does NOT own:
- Exam loading
- Enrollment loading
- Grading
- Deadline reconciliation/freeze
- Row lock acquisition
- Transaction lifecycle

### Is there any remaining correctness reason to continue modifying AnswerRegion in this audit chain?

**NO.**

All 26 pass criteria are met. P1, P2, and P3 preconditions are closed with mechanical
enforcement. The mutation context provenance is STRONG. The scope is NARROW. The module graph
is clean. Semantic behavior is preserved. The answer region is fully sealed.

---

## 23. Output

Written to `docs/audit/answer-precondition-corrective-review.md`.