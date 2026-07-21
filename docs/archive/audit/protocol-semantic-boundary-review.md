# EXAM-BOUNDARY-REVIEW-0 — Protocol Semantic Ownership and Cross-Package Boundary Audit

**Date:** 2026-07-09
**HEAD:** `553add52f67d7cdb3943632a352cdb1d2fbdde38`
**Branch:** `master`
**Mode:** READ-ONLY (no production code, tests, docs, manifests, lint, or migrations modified; no commit)

---

## Preface — What this audit challenges

`EXAM-ARCH-RECON-0` established that the **package dependency graph** is clean: `exam-engine → domain only`, `contracts → domain only` (declared), clean leaf, clean adapter seam, no EA cast forgery. That conclusion is **correct and re-verified below**.

This audit challenges a *different* claim that the reconstruction's one-line mental model implies but never proves:

> Clean package dependency boundaries ⇒ clean semantic ownership.

The evidence below shows the package topology is clean **but the semantic ownership is only PARTIAL**. Many protocol facts have **one normative owner**; several do not. The central result:

- The **package graph** is clean (`CURRENT_PACKAGE_BOUNDARIES_CLEAN = YES`).
- The **semantic ownership** is partial (`CURRENT_SEMANTIC_OWNERSHIP_CLEAN = PARTIAL`).
- The engine is a **PROTOCOL_KERNEL**, but it is **shallow in two flows** (answer save, candidate result projection) where the API layer owns protocol-semantic mapping that the engine does not.
- The codebase carries a broad class of **manual enum mirrors** (contracts re-typing domain values by hand) with **zero mechanical equality proof**, a textbook semantic-shotgun-surgery risk that has already fired twice in git history.

---

# 0. HARD RULES — compliance

| Rule | Status |
|------|--------|
| 0.1 READ ONLY — no production/test/doc/manifest/lint/migration edits, no commit | COMPLIED |
| 0.2 Current code is authority (production > DB > structural tests > contracts tests > protocol docs > historical audits) | COMPLIED — `EXAM-ARCH-RECON-0` broad claims were re-verified and two were corrected (see §1, §9) |
| 0.3 Do not optimize the dependency graph — audit is about semantic ownership | COMPLIED — no `engine→contracts` / `engine→db` recommendation is made as an "improvement"; where coupling is discussed it is *semantic*, not topological |
| 0.4 One semantic fact → one authority; other representations must be DERIVED_VIEW / WIRE_TRANSLATION / PERSISTENCE_ENCODING / MATERIALIZED_PROJECTION / MECHANICALLY_CHECKED_MIRROR | Used as the classification axis throughout |

Exactly one file created: `docs/audit/protocol-semantic-boundary-review.md`.

---

# 1. RECONSTRUCTION BASELINE

### Repository state

```
git status --short
  ?? .mimocode/
  ?? docs/audit/exam-architecture-reconstruction.md   (EXAM-ARCH-RECON-0)
  (this report is new, untracked)

git branch --show-current   master
git rev-parse HEAD          553add52f67d7cdb3943632a352cdb1d2fbdde38
```

### Re-verified dependency graph (from actual `import` statements, not just manifests)

The package manifests and the *actual* `import` statements were both scanned. Two manifest/runtime divergences exist that the prior audit's mermaid graph glossed over:

| Package | Manifest declares `@exam/*` deps | **Actual** `@exam/*` imports in `src/` | Note |
|---------|----------------------------------|------------------------------------------|------|
| `@exam/domain` | (none) | none | leaf — **verified** |
| `@exam/contracts` | `@exam/domain` | **NONE** (only `zod` + `vitest`) | contracts `src/` does **not** import domain at all — the manifest dependency is *unused in production source* |
| `@exam/db` | `@exam/domain`, `@exam/auth` | `@exam/domain` only | the `@exam/auth` dep is exercised **only** by `seed.ts` / `*.seed.test.ts` via deep `@exam/auth/src/password.js` import (test/seed path, not runtime) |
| `@exam/exam-engine` | `@exam/domain` | `@exam/domain` only | **verified** — 50 imports, all `@exam/domain` |
| `@exam/auth` | `@exam/domain`, `@exam/contracts` | (not audited in depth) | — |
| `@exam/api` | engine+contracts+db+domain+auth+authz+import-export | all of those | **verified** |
| `@exam/web` | contracts, domain | contracts (37), domain (4) | **verified** |

### Corrected dependency table

| Package | Direct internal dependencies (actual runtime `src/`) | Semantic responsibility |
| ------- | ---------------------------------------------------- | ----------------------- |
| `domain` | (none — leaf) | Canonical **semantic vocabulary**: all status/enum/policy `as const` objects + type interfaces + pure `gradingEngine` math + error classes |
| `contracts` | **`zod` only** (manifest lists `@exam/domain` but `src/` does not import it) | Wire schemas (Zod) + DTO types + i18n message registry. **Independently re-declares most domain enums as Zod enums** (see §2, §8) |
| `db` | `@exam/domain` (auth dep is seed/test-only) | Drizzle schema + repositories; JSONB shape narrowing via `.$type<domain.Type>()`; enum values stored as **unconstrained `text`** except 3 columns with CHECK |
| `exam-engine` | `@exam/domain` | Protocol kernel: FSMs, submit-freeze, grading authority, deadline authority, lock seam, capability. **Defines its own port interfaces** (`ExamRepository` etc.) that `apps/api` adapts |
| `api` | engine + contracts + db + domain + auth + authz + import-export | HTTP transport + transaction composition + repo adapters + **protocol-to-wire semantic mapping** (result visibility, lock-reason, answer-source, queue admission) |
| `web` | contracts + domain | UI; consumes wire types |

### Verification of the topology questions posed

```
exam-engine → domain only?   YES  (50 imports, all @exam/domain; 0 contracts, 0 db)
contracts   → domain only?   NO — contracts src/ imports NOTHING from domain.
                                 The "contracts → domain" edge in the prior
                                 audit's graph exists in package.json only;
                                 production source does not use it. This is
                                 WHY contracts re-declares enums by hand (§8).
db          → domain only?   YES for runtime src/ (auth is seed/test-only)
api         → engine+contracts+db?  YES (+domain, auth, authz, import-export)
web         → contracts+domain?     YES
```

**Corrections to `EXAM-ARCH-RECON-0`:**
1. The prior audit's dependency graph shows an edge `contracts → domain`. In production `src/` this edge is **not exercised** — contracts re-implements the vocabulary rather than importing it (§8). This is the single most important fact in this whole report and is invisible if you only read `package.json`.
2. The prior audit omits the `db → auth` manifest edge. It is real but seed/test-only; not a semantic concern.

---

# 2. SEMANTIC FACT INVENTORY

Each fact was traced to actual producers (who writes the value) and consumers (who reads/branches on it), not just to names.

| Semantic fact | Domain representation | Contract representation | Engine representation | DB representation | API knowledge | Web knowledge |
| ------------- | --------------------- | ----------------------- | --------------------- | ----------------- | ------------- | ------------- |
| `ExamStatus` (6) | `enums.ts:164` authority | `exam.ts:5` `ExamStatusEnum` **re-typed** | consumed (`examStateMachine.ts`) | `text("status")` unconstrained (`pg.ts:211`) | consumed | consumed (via DTO) |
| `EnrollmentStatus` (4) | `enums.ts:149` authority | inline `z.enum` in `exam.ts:176` (re-typed) | consumed | `text` unconstrained (`pg.ts:276`) | consumed | consumed |
| `AttemptStatus` (8) | `enums.ts:91` authority | `attempt.ts:21` **re-typed** + inlined 3× more (`score.ts:236`, `attempt.ts:589`, `candidate.ts:67`) | consumed (`attemptStateMachine`) | `text("status")` unconstrained (`pg.ts:308`) | branched on (orchestrator, scanner) | consumed |
| `GradingStatus` (3) | `enums.ts:114` authority | `score.ts:29` `GradingStatusEnum` **re-typed** | produced (`submitAttempt`), branched (`finalizeGrading`) | `text.$type<>()` default `auto_graded` (`pg.ts:328`) | branched (`submitAndGradeAttempt:165`, `attempts.shared.ts:54`) | consumed |
| `QuestionType` (5) | `enums.ts:75` authority | inlined **≥6×** as Zod `z.enum([...])` (`question.ts:5`, `attempt.ts:53,526`, `score.ts:99,197`) | consumed (`gradingWorkset` via `isManualGradedQuestion`) | `text("type")` unconstrained (`pg.ts:172`) | branched (`getInputMode`) | consumed |
| manual-grading classification | `gradingEngine.ts:192/211` (`requiresManualGrading`/`isManualGradedQuestion`) authority | `question.ts:41` **comments** the rule; `attempt.ts:494` defines a parallel `GradingModeEnum` | consumes domain fn | none (derived) | re-derives (`getInputMode`) | — |
| `ConflictReason` (5) | `enums.ts:248` authority | `attempt.ts:36` `SaveAnswerRejectReasonEnum` **re-typed** (same 5 values) | **produced** (`processSaveAnswer:90-160`) | not persisted (JSON only) | maps reason→wire (`attempts.candidate.ts:1046`) | consumed |
| `SaveAnswerRejectReason` (5) | (none — see note) | `attempt.ts:45` type | (none) | — | consumed | consumed |
| `SubmissionReason` ("manual"/"deadline") | inlined union in `types.ts:348` | (none) | produced (`attemptCommands.ts:354`), inlined again | `text` unconstrained nullable (`pg.ts:341`) | produced (scanner `:203`) | — |
| `scoreStrategy` (3) | `enums.ts:200` authority | `exam.ts:20` **re-typed** | consumed (`shouldSelectAttempt`) | `text` unconstrained (`pg.ts:231`) | consumed | consumed |
| `retakePolicy` (5) | `enums.ts:212` authority | `exam.ts:21` re-typed + Phase-1 subset `:30` | consumed (`startOrRestoreAttempt`) | `text` unconstrained (`pg.ts:230`) | consumed | consumed |
| `timingMode` (4) | `enums.ts:183` authority | `exam.ts:13` re-typed + Phase-1 literal `:28` | (implicit: only timed_window in P1) | `text` unconstrained (`pg.ts:212`) | consumed | consumed |
| deadline semantics | `computeEffectiveDeadline` (engine) authority | (none) | produced+consumed (`deadlineReconciliation.ts`) | `text` nullable (`pg.ts:341` submissionReason); `deadlineAt` timestamp | consumed (scanner re-encodes SQL mirror) | — |
| grading entry status (3) | `types.ts:471` authority | (none in wire) | produced (`materializeGradingWorkset`/`gradeQuestion`), consumed (`aggregateGradingEntries`) | `text.$type<>()` **+ CHECK** (`pg.ts:379,408`) | — | — |
| grading mode (auto/manual) | `types.ts:452` `GradingEntryMode` authority; `attempt.ts:494` `GradingModeEnum` **parallel** | `attempt.ts:494` (contracts) | derived from QuestionType | `text.$type<>()` **+ CHECK** (`pg.ts:378,404`) | derived again (`getInputMode`) | consumed |
| candidate exam availability (9) | (none) | `candidate.ts:10` `candidateExamAvailabilityStatuses` | `candidateExamSummary.ts:4` `AvailabilityStatus` **parallel type** | none | bridges the two | consumed |
| candidate primary action (5) | (none) | `candidate.ts:26` `candidateExamPrimaryActions` | `candidateExamSummary.ts:16` `PrimaryAction` **parallel type** | none | bridges | consumed |
| error code (registry) | `errors.ts:5` `AppError.code: string` (open) | `messageRegistry.ts:25` `errorMessages` — **closed ErrorCode union authority** | throws `AppError` w/ code (`grading.ts`) OR plain `Error` (`gradingWorkset.ts`) | — | maps `code→ErrorCode` (`errorResponse.ts`) | consumed |
| HTTP error mapping | (none) | (none) | (none) | — | `errors.ts`/`errorResponse.ts` authority | consumed |

### Required additional fields

| Fact | Normative owner | Other copies are | Drift mechanically detected? | Drift failure mode |
| ---- | --------------- | ---------------- | ---------------------------: | ------------------ |
| ExamStatus | domain | contracts Zod enum (manual) | NO | new value → wire accepts it, TS-cast hides mismatch; obsolete value → wire rejects valid DB row |
| EnrollmentStatus | domain | contracts inline enum (manual) | NO | same |
| AttemptStatus | domain | contracts Zod enum (manual) + 3 inline arrays | NO | same; **`attemptRepo.ts` inArray subsets drift silently** (§10) |
| GradingStatus | domain | contracts Zod enum (manual) | NO | a 4th value added to domain would not propagate; a typo in contracts passes CI |
| QuestionType | domain | contracts inline ×6 | NO | **already fired** — `text_response` added in commit `91f36a7` required editing all 6 sites by hand |
| manual-grading classifier | domain (`isManualGradedQuestion`) | contracts `GradingModeEnum` (parallel enum, not linked) | NO | if a 2nd manual type is added, contracts `GradingModeEnum` and `getInputMode` must both be hand-updated |
| ConflictReason vs SaveAnswerRejectReason | domain (`ConflictReason`) | contracts (`SaveAnswerRejectReason`) | NO | **two names for ONE fact** — see box below |
| SubmissionReason | domain inline union | engine inline literal | NO | a 3rd reason requires editing both inline unions |
| scoreStrategy / retakePolicy / timingMode | domain | contracts re-typed (+ Phase-1 literals) | NO | standard enum-mirror drift |
| grading entry status / mode | domain | DB CHECK literals (manual) | NO | rename a value → CHECK rejects valid writes until hand-edited |
| availability / primary-action | **SPLIT — engine type + contracts enum** | each other | NO | rename a value in one → type error only if a bridge site breaks |
| error code registry | contracts (`messageRegistry`) | engine throws code strings | NO | engine can throw a code not in the registry (`normalizeErrorCode` silently falls back) |
| HTTP error mapping | api (`errorResponse.ts`) | — | n/a | — |

> **ConflictReason vs SaveAnswerRejectReason — are these genuinely different vocabularies?**
>
> Tracing producers/consumers (NOT names): `processSaveAnswer` (`answerProtocol.ts:78-181`) **produces** values from the *domain* `ConflictReason` set (`{reason:"ATTEMPT_CLOSED"}`, `"ATTEMPT_ALREADY_SUBMITTED"`, `"DEADLINE_EXCEEDED"`, `"STALE_VERSION"`, `"CONFLICTING_PAYLOAD"`). The save route (`attempts.candidate.ts:1019-1049`) reads `saveResult.conflict.reason` and returns it verbatim in the wire `SaveAnswerRejectedSchema.reason`, whose Zod type is the *contracts* `SaveAnswerRejectReasonEnum` — the **same 5 literals**.
>
> These are **two names for ONE protocol fact**. Domain owns the producer vocabulary; contracts owns the wire vocabulary; the values must be identical; nothing checks they are. The contracts test (`contracts.test.ts:690-700`) even hard-codes the 5 literals in the assertion rather than referencing `ConflictReason`. **Verdict: COMPETING_AUTHORITY** (manual mirror disguised as two vocabularies).

---

# 3. INTERNAL MODEL vs WIRE MODEL

Trace of the boundary `domain/engine result → api translation → contracts wire result`.

| Flow | Engine/internal result | Route translation | Contract/wire result | Semantic transformation? |
| ---- | ---------------------- | ----------------- | -------------------- | ------------------------ |
| save answer | `ProcessSaveResult` (`answerProtocol.ts`) | route normalizes stored answers, builds `clientSeqMap`, constructs `AnswerState`, calls `processSaveAnswer`, **interprets** accepted/rejected, **reconstructs** `clientSeqHistory`, **writes** `attempt.answers` (`attempts.candidate.ts:958-1013`) | `SaveAnswerResponseDTO` | **PROTOCOL_SEMANTIC_MAPPING** — the route owns the persist step the engine does not (§5) |
| start attempt | `StartAttemptResult` | none (delegated) | `AttemptDTO` | SHAPE_ONLY |
| submit attempt | `submitAttempt` result + `finalizeGrading` | orchestrator branches on status/gradingStatus (`submitAndGradeAttempt.ts:86-198`) | `AttemptDTO` | PROTOCOL_SEMANTIC_MAPPING (orchestrator knows the freeze→grade sequence) |
| candidate take snapshot | `ensureAttemptDeadlineReconciled` returns attempt | `buildCandidateTakeSnapshot` (`attempts.shared.ts:139`) derives lockReason, capabilities, answerSource, resultVisibility | `CandidateTakeSnapshot` | **PROTOCOL_SEMANTIC_MAPPING** — heavy protocol→wire mapping in API (§3 box) |
| manual grading | `gradeQuestion` result | response shaping only (`gradingQueue.ts`) | `GradeQuestionResponse` | SHAPE_ONLY (cleanest delegation) |
| score/result publication | `finalizeTerminalGrading` writes projection | response shaping | `ScoreResultDTO` / `AttemptResultResponse` | SHAPE_ONLY |
| deadline rejection | `isAttemptDeadlineExpired` predicate | scanner branch (`deadlineScanner.ts:185-191`) | (none — side effect) | PROTOCOL_SEQUENCE (scanner knows expired→submit→grade) |

### Protocol-semantic mappings the API layer contains (knowledge that is NOT in the engine)

Every one of these is an `if state X → expose field/action Y` rule living in `apps/api`, not in `exam-engine`:

1. **`computeResultVisibility`** (`attempts.shared.ts:44-70`) — implements the *entire* `resultPublicationMode × gradingStatus × resultsPublishedAt` visibility rule. This is a **business rule** (when may a candidate see their result?) living in the API, with **no engine counterpart**. The engine owns *whether grading is terminal*; the API owns *whether the result is visible*.
2. **`lockReason` derivation** (`attempts.shared.ts:170-185`) — `status ∈ {submitted,grading,graded} → "submitted"`, `voided → "voided"`, `disrupted → "disrupted"`, expired → `"deadline"`. Protocol-state-to-wire-reason mapping in the API.
3. **`answerSource` routing** (`attempts.shared.ts:220-249`) — `status ∈ {in_progress,disrupted} → draft`, `{submitted,grading,graded} → submitted`, else `none`. Protocol-state-to-answer-column routing in the API.
4. **`getInputMode`** (`attempts.shared.ts:14-30`) — QuestionType → InputMode derivation, parallel to the engine's QuestionType → GradingMode derivation.
5. **queue admission** (`attempts.candidate.ts:118-174`) — in-memory batch-release admission (`requireQueue`/`batchSize`/`batchInterval`) entirely in the API. (Phase 2 feature surfaced early; acceptable.)
6. **`submitAndGradeAttempt` status branching** (`:86,93,114,128,138,165`) — 6 protocol branches reconstructing the freeze→grade sequence.

### Critical question for §3

> Does the route merely serialize an engine result, or must the route understand protocol meaning to produce the correct contract?

**Answer: it depends on the flow.** `start`, `restore`, `grade-question`, `extend-time`, `force-submit` (mostly), and `score publication` are **legitimate boundary translation** (SHAPE_ONLY / SECURITY_REDACTION). **`save answer`** and **`candidate take snapshot`** are **PROTOCOL_SEMANTIC_MAPPING**: the route must understand protocol meaning (which answer column, which lock reason, which visibility) that no engine function encodes.

---

# 4. PROTOCOL ACTION OWNERSHIP

Reconstructed action sequences (current production order).

| Protocol action | Engine knows | API knows | DB repo knows | Contract knows |
| --------------- | ------------ | --------- | ------------- | -------------- |
| START_ATTEMPT | full (`startOrRestoreAttempt`: window, enrollment lock, retake, late-entry, create) | ownership check, queue admission, tx | row shapes | request/response shape |
| TAKE_ATTEMPT | lock + deadline reconcile (`lockEnrollmentAndAttempt`+`ensureAttemptDeadlineReconciled`) | **+ full take-snapshot derivation** (visibility, lockReason, answerSource) | row shapes | take-snapshot shape |
| SAVE_ANSWER | **decision only** (`processSaveAnswer` returns accept/reject + candidate `newAnswer`) | **+ full persist**: normalize, build clientSeqMap, interpret result, reconstruct history, write `attempt.answers` | write | request/response shape |
| RESTORE_ATTEMPT | full (`restoreAttempt`: deadline adjust, status flip) | ownership, tx | row shapes | request shape |
| SUBMIT_ATTEMPT | freeze+materialize (`submitAttempt`); **grading-closure sequencing is API's** | **+ the reconcile→submit→finalize sequence + pending_manual branch** (`submitAndGradeAttempt`) | row shapes | request shape |
| DEADLINE_RECONCILE | `isAttemptDeadlineExpired`, `submitAttempt`, `gradeAttemptIdempotent` (primitives) | **+ the expired→submit→grade sequence + status gate** (`deadlineScanner.ts:171,185,201,209`) | candidate-discovery SQL (mirrors expiry) | — |
| FORCE_SUBMIT | `submitAttempt`, `gradeAttemptIdempotent` (primitives) | **+ voided gate + needsSubmit branch + status gate** (`attempts.admin.ts:205,214,244`) | row shapes | request shape |
| GRADE_QUESTION | full (`gradeQuestion`: validate, complete entry, terminal detect, closure) | tx + audit only | row shapes | request/response shape |
| FINALIZE_GRADING | full (`finalizeTerminalGrading`: aggregate, project attempt+enrollment) | (called via engine) | row shapes | — |
| PUBLISH_RESULTS | `publishResults` (idempotent flag set) | route gate (exam status) | row shapes | request shape |

### Which layer knows the COMPLETE action?

- **Engine-owned complete actions:** START_ATTEMPT, RESTORE_ATTEMPT, GRADE_QUESTION, FINALIZE_GRADING, PUBLISH_RESULTS.
- **Split-ownership actions:** TAKE_ATTEMPT (engine locks/reconciles; **API derives the entire projection**), SAVE_ANSWER (engine decides; **API persists**), SUBMIT_ATTEMPT/DEADLINE_RECONCILE/FORCE_SUBMIT (engine provides primitives; **API owns the multi-step sequence + pending_manual branching**).

### Classification

```
START_ATTEMPT        ENGINE_OWNED_ACTION
TAKE_ATTEMPT         SPLIT_OWNERSHIP      (engine: lock+reconcile; api: projection)
SAVE_ANSWER          SPLIT_OWNERSHIP      (engine: decision; api: persist)
RESTORE_ATTEMPT      ENGINE_OWNED_ACTION
SUBMIT_ATTEMPT       API_COMPOSED_ENGINE_ACTION  (sequence + pending_manual branch)
DEADLINE_RECONCILE   API_COMPOSED_ENGINE_ACTION  (sequence + status gate)
FORCE_SUBMIT         API_COMPOSED_ENGINE_ACTION  (voided gate + needsSubmit branch)
GRADE_QUESTION       ENGINE_OWNED_ACTION
FINALIZE_GRADING     ENGINE_OWNED_ACTION
PUBLISH_RESULTS      ENGINE_OWNED_ACTION
```

### TRANSACTION_MECHANICS vs PROTOCOL_SEQUENCE_KNOWLEDGE

- `executeInTransaction(...)` + serialization/unique retry (`submitAndGradeAttempt.ts`, `errors.ts:54`) = **TRANSACTION_MECHANICS** — legitimate API ownership, not leakage.
- `deadline reconcile → submit → inspect gradingStatus → choose manual/auto path → terminal closure` (in `submitAndGradeAttempt` and `deadlineScanner`) = **PROTOCOL_SEQUENCE_KNOWLEDGE** — the caller must know that `pending_manual` means "do NOT call finalizeGrading" and that `submitted` requires the finalize call. This is the protocol leaking into the composition layer.

---

# 5. API ORCHESTRATION DEPTH REVIEW

Counts are for the transaction body (the `executeInTransaction` callback).

| Entry point | Engine calls | Direct repo operations | Status branches | Protocol sequencing knowledge | Assessment |
| ----------- | -----------: | ---------------------: | --------------: | ----------------------------- | ---------- |
| `POST /attempts/:examId/start` (`attempts.candidate.ts:663`) | 1 | 0 / 0 | 0 | none | **THIN_COMPOSITION** |
| `GET /candidate/attempts/:id/take` (`:791`) | 2 | 1 read | 0 (engine owns) | none in tx; **take-snapshot derivation post-tx** | THIN_COMPOSITION (tx) / **PROTOCOL_ORCHESTRATION (projection)** |
| `POST /attempts/:id/answers/:qid` (`:892`) | 3 | 2 read / **1 write** | 5 | **full answer pipeline** (normalize, clientSeqMap, AnswerState, interpret, write `attempt.answers`) | **PROTOCOL_LEAK** |
| `POST /attempts/:id/restore` (`:1183`) | 3 | 0 / 0 | 0 | none | THIN_COMPOSITION |
| `submitAndGradeAttempt` orchestrator (`:55`) | 5 | 3 read / 0 | 6 | reconcile→submit→readSnapshot→finalize + pending_manual branch | **PROTOCOL_ORCHESTRATION** |
| `POST /admin/attempts/:id/force-submit` (`attempts.admin.ts:179`) | 3 | 1 read / 0 | 3 | voided gate, needsSubmit, status gate | PROTOCOL_ORCHESTRATION |
| `POST /admin/attempts/:id/grade-question` (`gradingQueue.ts:307`) | 2 | 0 / 0 | 1 (audit only) | none — **cleanest** | **THIN_COMPOSITION** |
| `POST /admin/attempts/:id/extend-time` (`:340`) | 1 | 0 / 0 | 0 | none | THIN_COMPOSITION |
| `POST /admin/attempts/:id/misconduct` (`:90`) | 1 | 0 / 1 (audit) | 0 | none | THIN_COMPOSITION |
| `autoSubmitAndGrade` scanner (`deadlineScanner.ts:147`) | 4 | 2 read / 0 | 4 | status gate + expired→submit→grade sequence | PROTOCOL_ORCHESTRATION |

### SAVE_ANSWER deep-dive (the protocol-leak outlier)

The save route **does not delegate answer handling to an engine function for the persist step**. Verified by reading the route body (`attempts.candidate.ts:892-1017`):

```
919  const cap = await lockEnrollmentAndAttempt(...)        // engine: lock
936  const reconciled = await ensureAttemptDeadlineReconciled(... cap ...)  // engine: reconcile
958  const storedAnswers = normalizeAnswers(currentAttempt.answers ...)     // ROUTE: normalize
961  const clientSeqMap = buildClientSeqMap(storedAnswers)                 // ROUTE: build map
963  const saveResult = processSaveAnswer({...state}, {...request})        // engine: DECIDE only
983  if (saveResult.accepted && saveResult.newAnswer) {                    // ROUTE: interpret
998    const storedNewAnswer = { ...saveResult.newAnswer, clientSeq, clientSeqHistory } // ROUTE: reconstruct
1010   await txRepo.update(ctx, attemptId, { answers: newAnswers, lastActivityAt: now }) // ROUTE: write
```

`processSaveAnswer` (`answerProtocol.ts:78-181`) is **pure**: zero IO, zero mutation. It returns `{accepted, newAnswer?, newClientSeqMap?}`. The route performs **every** persistence-shaping step.

> Is `processSaveAnswer` a complete protocol action or only a decision core?
>
> **Only a decision core.** Despite its name ("process"), it does not process (persist). The route owns: normalize → clientSeqMap → interpret → reconstruct history → write. The answer-write authority is **split**: engine decides + proposes; API persists. This is the **only** place in the API layer where `attempt.answers` is written outside an engine function.

---

# 6. EXAM-ENGINE API DEPTH

For every exported symbol (full table; depth per §13 definitions).

| Export | Current depth | Caller knowledge required | Safe primitive? | Misleading as public API? |
| ------ | ------------- | ------------------------- | --------------: | ------------------------: |
| `processSaveAnswer` | PURE_DECISION_CORE | must build AnswerState, mint cap, reconcile deadline, interpret result, persist | yes (pure) | **YES** — name implies action, body only decides |
| `buildSubmittedAnswersSnapshot` | UTILITY | none (called by submitAttempt) | yes | no |
| `submitAttempt` | COMPOSITE_PROTOCOL_ACTION | if `pending_manual` do NOT finalize; else caller should finalize | yes (atomic freeze) | no |
| `restoreAttempt` | SEMANTIC_LEAF_ACTION | none | yes | no |
| `startOrRestoreAttempt` | COMPOSITE_PROTOCOL_ACTION | none | yes | no |
| `flagMisconduct` | SEMANTIC_LEAF_ACTION | none | yes | no |
| `extendAttemptTime` | SEMANTIC_LEAF_ACTION | none | yes | no |
| `markDisrupted` | SEMANTIC_LEAF_ACTION | none | (no production callers — dead) | no |
| `ensureAttemptDeadlineReconciled` | **FULL_USE_CASE** (inline submit+grade) | cap + lock predecessor | yes | no |
| `computeEffectiveDeadline` | PURE_DECISION_CORE | none | yes | no |
| `isAttemptDeadlineExpired` | PREDICATE | none | yes | no |
| `readGradingSnapshot` | (read; not a decision) | feeds finalize | yes | no |
| `computeGradingResult` | PURE_DECISION_CORE | **display-only** — NOT the score authority | yes | **YES** — name implies authority it no longer holds |
| `finalizeTerminalGrading` | COMPOSITE_PROTOCOL_ACTION | cap + workset terminal | yes | no |
| `finalizeGrading` | COMPOSITE_PROTOCOL_ACTION (auto gate) | cap; **must NOT be called on pending_manual** | yes | no |
| `gradeAttempt` | FULL_USE_CASE | cap | (test-compat only) | minor |
| `gradeAttemptIdempotent` | FULL_USE_CASE | cap | yes | no |
| `gradeQuestion` (engine) | COMPOSITE_PROTOCOL_ACTION | cap, submitted+pending_manual, entry exists | yes | no (name collides with domain `gradeQuestion`) |
| `materializeGradingWorkset` | SEMANTIC_LEAF_ACTION | fresh-submit precondition | yes | no |
| `computeExpectedGradingEntries` | PURE_DECISION_CORE | none | yes | no |
| `validateGradingWorksetConsistency` | PREDICATE (throwing) | none | yes | no |
| `aggregateGradingEntries` | PURE_DECISION_CORE | workset fully terminal | yes | no |
| `lockEnrollmentAndAttempt` | CONCURRENCY_SEAM | same repo refs to consumer | yes | no |
| `assertCapabilityFor` | CONCURRENCY_SEAM | none | yes | no |
| `shouldSelectAttempt` / `shouldEnrollmentComplete` | PREDICATE | none | yes | no |
| `deriveCandidateExamState` / `pickDisplayAttempt` | PURE_DECISION_CORE | none | yes | no |
| `publishExam`/`openExam`/…/`publishResults` | COMPOSITE/SEMANTIC_LEAF | route reconciles status by-now | yes | no |
| `checkAndUpdateExamStatus` | COMPOSITE_PROTOCOL_ACTION | none | yes | no |
| `calculateDeadlineAt`/`getRemainingSeconds` | UTILITY | none | yes | no |
| `computeStatus` | PREDICATE | none | yes | no |
| FSM `transition`/`canTransition`/`assertTransition` (×3) | PREDICATE | none | yes | no |

### Required-predecessor / required-successor table

| Function | Required predecessor | Required successor | Branching rule known by caller | Mechanically enforced? |
| -------- | -------------------- | ------------------ | ------------------------------ | ---------------------- |
| `processSaveAnswer` | lockEnrollmentAndAttempt, ensureAttemptDeadlineReconciled, build AnswerState | if accepted → persist newAnswer + lastActivityAt | map conflict.reason to wire | NO |
| `submitAttempt` | (lock) | if `!pending_manual` → finalize | pending_manual → do NOT finalize | NO |
| `finalizeGrading` | cap minted | — | reject pending_manual (throws) | runtime (throws) |
| `finalizeTerminalGrading` | cap minted, workset terminal | — | none (mode-agnostic) | runtime (aggregate throws) |
| `gradeAttemptIdempotent` | cap minted | — | handles graded/pending_manual/submitted internally | internal |
| `gradeQuestion` | cap minted, submitted+pending_manual | — | fullyGraded branch | internal |
| `ensureAttemptDeadlineReconciled` | cap + lock | — | none (inline) | runtime (cap) |
| `lockEnrollmentAndAttempt` | — | pass cap + SAME repo refs to consumer | repo-ref identity | **YES** (`assertCapabilityFor`) |
| `materializeGradingWorkset` | fresh-submit (no pre-existing entries) | — | none | NO (caller owns precondition) |

### Protocol instruction sets (low-level exports callers must compose in one exact sequence)

1. **Answer-save instruction set** (the route composes): `lockEnrollmentAndAttempt` → `ensureAttemptDeadlineReconciled` → [build AnswerState] → `processSaveAnswer` → [persist if accepted]. Five steps, two of which are caller-owned glue.
2. **Submit-and-grade instruction set** (`submitAndGradeAttempt`, `deadlineScanner`): `lockEnrollmentAndAttempt` → (reconcile) → `submitAttempt` → branch on gradingStatus → `readGradingSnapshot` → `finalizeGrading`. The `pending_manual` branch is the critical fork.
3. **Manual-grade instruction set**: `lockEnrollmentAndAttempt` → `gradeQuestion` (which internally calls `finalizeTerminalGrading` when terminal). This one is a clean single composite — the model the others should approach.

---

# 7. CONCURRENCY CALLING-CONVENTION LEAKAGE

Audit of the EA capability surface.

| Fact a correct API caller must know | Classification |
|-------------------------------------|----------------|
| `lockEnrollmentAndAttempt` must be called first, inside the tx, before any status read | TYPE_DISCOVERABLE (signature) + DOCUMENTED_ONLY (tx requirement) |
| The SAME repo object references passed to the consumer must be `===` those passed to the mint | **MECHANICALLY_ENFORCED** (`assertCapabilityFor` ref comparison, `lockSeam.ts:142`) |
| Which actions require the capability (finalizeGrading/finalizeTerminalGrading/gradeAttemptIdempotent/gradeQuestion/ensureAttemptDeadlineReconciled) | TYPE_DISCOVERABLE (param type) |
| Single-lock paths must NOT use the capability (startOrRestoreAttempt, extendAttemptTime, flagMisconduct) | **CALLER_CONVENTION** — nothing prevents a caller from minting a cap and then calling a single-lock path; the cap is simply unused |
| `executeInTransaction` retry wraps serialization/unique violations (40001/23505) | DOCUMENTED_ONLY |
| The capability proves repo affinity, NOT tx-session liveness (tx-bound repos enforce liveness) | DOCUMENTED_ONLY |

### Verdict

> Is the capability an internal protocol implementation detail that has escaped into the application layer?

**PARTIAL — the mechanism is correct but the API exposes too many protocol internals.** Specifically:

- The capability **object itself** is opaque and correctly minted/consumed — good.
- But the **calling convention** ("mint cap → reconcile → primitive → primitive → branch on pending_manual") is repeated **verbatim in 5 places** (`submitAndGradeAttempt`, `deadlineScanner.autoSubmitAndGrade`, and the take/save/restore candidate routes share the lock+reconcile prefix). The seam is correct; the *composition knowledge* above the seam has leaked into every caller.
- `ensureAttemptDeadlineReconciled` is the one function that already bundles cap+reconcile+submit+grade into a FULL_USE_CASE — but it is only used on the candidate read paths, not on submit/force-submit/scanner, which re-compose the same sequence by hand.

No fix proposed (per §0.3 / §7 instructions). The finding is that the capability mechanism is not the leak; the leak is the repeated composition pattern the capability enables.

---

# 8. CONTRACT SEMANTIC OWNERSHIP

`packages/contracts` advertises itself as "Zod schemas + DTOs, wire-only." Audited against the four questions.

| Contract rule | Wire-only? | Domain/engine equivalent | Same semantics? | Drift risk |
| ------------- | ---------: | ------------------------ | --------------: | ---------- |
| `ExamStatusEnum` (`exam.ts:5`) | enum mirror | `domain/enums.ts:164` | yes (manual) | HIGH — no check |
| `TimingModeEnum` + `Phase1TimingModeEnum` (`exam.ts:13,28`) | enum mirror + Phase-1 subset | `domain/enums.ts:183` | yes (manual) | HIGH |
| `ScoreStrategyEnum` (`exam.ts:20`) | enum mirror | `domain/enums.ts:200` | yes (manual) | HIGH |
| `RetakePolicyEnum` + `Phase1RetakePolicyEnum` (`exam.ts:21,30`) | enum mirror + subset | `domain/enums.ts:212` | yes (manual) | HIGH |
| `ResultPublicationModeEnum` (`exam.ts:37`) | enum mirror | `domain/enums.ts:135` | yes (manual) | HIGH |
| `AttemptStatusEnum` (`attempt.ts:21`) | enum mirror | `domain/enums.ts:91` | yes (manual) | HIGH — re-typed 3 more times |
| `GradingStatusEnum` (`score.ts:29`) | enum mirror | `domain/enums.ts:114` | yes (manual) | HIGH |
| `SaveAnswerRejectReasonEnum` (`attempt.ts:36`) | enum mirror | `domain/enums.ts:248` (`ConflictReason`) | yes (manual) | **HIGHEST** — two names, one fact, zero link (§2 box) |
| `MisconductSeverityEnum` (`attempt.ts:7`) | enum mirror | `domain/enums.ts:264` | yes (manual) | HIGH |
| `QuestionType` inlined ×6 | enum mirror | `domain/enums.ts:75` | yes (manual) | **already fired** (`91f36a7`) |
| `GradingModeEnum` (`attempt.ts:494`) | **derived enum, parallel to engine derivation** | `domain GradingEntryMode` + engine `isManualGradedQuestion` | same concept, **not linked** | HIGH — 3rd representation |
| `InputModeEnum` (`attempt.ts:483`) | derived enum | api `getInputMode` | same concept, **not linked** | MEDIUM |
| `candidateExamAvailabilityStatuses` (`candidate.ts:10`) | **enum, parallel to engine type** | `engine candidateExamSummary.ts:4` | yes (manual) | HIGH — split authority |
| `candidateExamPrimaryActions` (`candidate.ts:26`) | enum, parallel to engine type | `engine candidateExamSummary.ts:16` | yes (manual) | HIGH — split authority |
| `HiddenReasonEnum` (`score.ts:220`) | **wire-only business rule** | none in engine | **contracts is the only owner** | LOW (single owner) but notable |
| `errorMessages` / `ErrorCode` (`messageRegistry.ts:25`) | **closed error-code registry** | engine throws codes as strings | yes (manual) | HIGH — `normalizeErrorCode` silently falls back |
| `saveAnswerMessages` (`messageRegistry.ts:131`) keyed by `SaveAnswerRejectReason` | i18n | domain `ConflictReason` | yes (manual) | HIGH |
| `ControlFlagsSchema` (`exam.ts:43`) | shape mirror | `domain/types.ts:202` | yes (manual) | MEDIUM |
| `QuestionSnapshotSchema` + `CandidateQuestionSnapshotSchema` (`attempt.ts:51,97`) | shape mirror + security-redaction omit | `domain/types.ts:160` | yes (manual) | MEDIUM — redaction rule lives only here |

### Explicitly inspected items (required)

- **`SaveAnswerRejectReasonEnum`** — manual mirror of domain `ConflictReason`; **two names, one fact** (§2 box).
- **`ConflictReason`** — domain-owned producer vocabulary; contracts does not reference it.
- **`AttemptStatus` / `GradingStatus`** — both manually mirrored; `GradingStatusEnum` test (`contracts.test.ts:918`) even asserts rejection of `"graded"` (a value that *is* a valid `AttemptStatus`) — proving the two vocabularies are easy to confuse.
- **QuestionType manual-grading classification** — engine derives from `isManualGradedQuestion`; contracts has a *parallel* `GradingModeEnum` (`attempt.ts:494`) that is not linked to the derivation.
- **`scoreStrategy` / `retakePolicy` / `timingMode`** — all mirrored, plus Phase-1 subset literals that are a *third* representation.
- **`messageRegistry`** — the `ErrorCode` closed union is the authoritative error vocabulary, but it lives in **contracts**, while the *throwers* (engine) live in a different package and are not constrained to it.

### Answer

> Does contracts currently contain protocol vocabulary without owning protocol semantics?

**YES, extensively.** Contracts contains ~10 enum vocabularies (status/reason/policy/type/availability/action) whose **semantics** are owned by domain or engine, reproduced as independent Zod enums with **no derivation from the source**. It also contains one *genuine* business rule (`HiddenReasonEnum` / result-visibility classification) that is wire-only by necessity.

> Is that legitimate wire vocabulary or manual semantic mirroring?

**Mostly manual semantic mirroring.** The legitimate wire-vocabulary cases (shapes that must be projected/redacted for the client, e.g. `CandidateQuestionSnapshotSchema`) are a minority. The enum mirrors are **not** wire translation — they are the same values, needed because contracts does not (and, given the package graph, cannot cheaply) import domain's `as const` objects into a `z.enum([...Object.values(X)])`.

---

# 9. DOMAIN ROLE REVIEW

Inventory of `domain` exports consumed across the system.

| Domain export | Consumers | Semantic role | Normative authority? |
| ------------- | --------- | ------------- | -------------------- |
| `enums.ts` (all `as const` objects) | contracts (re-typed, not imported), db (`.$type<>()`), engine, api, web | semantic vocabulary | **YES — de facto** |
| `types.ts` (interfaces) | db, engine, api | entity shapes | YES |
| `errors.ts` (`AppError` + subclasses) | engine, api | error types | YES (but `code: string` is open) |
| `gradingEngine.ts` (`gradeQuestion`, `gradeAnswers`, `requiresManualGrading`, `isManualGradedQuestion`, `hasSubjectiveQuestions`) | engine | pure policy library | YES |
| `email.ts` | api | utility | n/a |

### Classification

`domain` is a **HYBRID**: it is simultaneously
- a **SHARED_TYPES_PACKAGE** (interfaces consumed by db/engine/api),
- the **SEMANTIC_VOCABULARY** (the `as const` enum objects), and
- a **PURE_POLICY_LIBRARY** (gradingEngine pure math).

It is NOT a DOMAIN_MODEL in the full sense — it has no aggregates, no invariants enforcement, no command functions. It is the leaf vocabulary + pure policy.

### Answers

> Is domain the canonical semantic vocabulary of the system?

**YES — de facto.** Every status/reason/policy/type enum that the system branches on originates in `domain/enums.ts`. Engine, db, api, and web all ultimately branch on these values.

> Why do semantically equivalent enums exist independently in contracts?

Because contracts `src/` does **not import domain** (verified §1). Zod needs the literal list at schema-definition time; without importing domain's `as const` object, contracts must re-type the literals. This is the root cause of the entire §2/§8 mirror class. The dependency *exists in `package.json`* but is *unused in production source* — so the mirror is a choice, not a hard constraint.

> If NO: what is the actual canonical semantic vocabulary?

N/A — domain IS canonical. But note: **`messageRegistry.ErrorCode`** (in contracts) is the canonical *error* vocabulary, and it is NOT in domain. So the error-code vocabulary has a *second* canonical home.

---

# 10. PERSISTENCE ENCODING REVIEW

`pgEnum` is used **zero times** (deliberate ADR convention, per `contracts/score.ts:26` comment). All status/policy columns are `text`; only **3 columns** have a DB CHECK constraint.

| Semantic fact | Domain | Engine | Contract | DB encoding | Mechanical equality proof? |
| ------------- | ------ | ------ | -------- | ----------- | -------------------------- |
| AttemptStatus | `enums.ts:91` | consumed | `attempt.ts:21` mirror | `text("status")` unconstrained (`pg.ts:308`) | **NO** |
| EnrollmentStatus | `enums.ts:149` | consumed | inline mirror | `text` unconstrained (`pg.ts:276`) | NO |
| ExamStatus | `enums.ts:164` | consumed | `exam.ts:5` mirror | `text` unconstrained (`pg.ts:211`) | NO |
| GradingStatus | `enums.ts:114` | produced | `score.ts:29` mirror | `text.$type<>().default("auto_graded")` (`pg.ts:328`) | NO (TS-narrow on read only) |
| QuestionType | `enums.ts:75` | consumed | inlined ×6 | `text("type")` unconstrained (`pg.ts:172`) | NO |
| grading_entry.status | `types.ts:471` | produced/consumed | (none) | `text.$type<>()` **+ CHECK** (`pg.ts:379,408`) | partial (CHECK literals independent of enum) |
| grading_entry.gradingMode | `types.ts:452` | derived | `attempt.ts:494` parallel | `text.$type<>()` **+ CHECK** (`pg.ts:378,404`) | partial |
| submissionReason | `types.ts:348` inline | produced (`attemptCommands.ts:354`) | (none) | `text` unconstrained nullable (`pg.ts:341`) | NO |
| ConflictReason | `enums.ts:248` | produced | `attempt.ts:36` mirror | not persisted | NO |
| answers | `types.ts:381` | builder (`answerProtocol`) | `attempt.ts:102` mirror | `jsonb.$type<AnswerRecord[]>()` (`pg.ts:312`) | NO |
| submittedAnswers | `types.ts:357` | builder + 2 readers | **no Zod schema** | `jsonb.$type<SubmittedAnswersSnapshot|null>()` (`pg.ts:335`) | NO |
| gradingResult | `types.ts:436` | projection writer | `score.ts:8` + `:197` mirrors | `jsonb.$type<QuestionScoreResult[]>()` (`pg.ts:313`) | NO |
| questionSnapshot | `types.ts:160` | 2 readers | `attempt.ts:51` + `:97` mirrors | `jsonb.$type<QuestionSnapshot[]>()` (`pg.ts:226,309`) | NO |
| scoreStrategy/retakePolicy/timingMode | `enums.ts` | consumed | mirrors | `text` unconstrained (`pg.ts:212,230,231`) | NO |
| role | `enums.ts:15` | — | (separate `AssignableRole` in `pg.ts:623`) | `text.$type<>().**+CHECK**` (`pg.ts:654,666`) | NO — **3 independent copies** (`pg.ts:630` comment admits it) |

### Places where PostgreSQL accepts a wider vocabulary than TypeScript believes

**Every unconstrained `text` status/policy column** (`exam_attempts.status`, `exam_enrollments.status`, `exams.status`, `exams.timing_mode`, `exams.score_strategy`, `exams.retake_policy`, `questions.type`, `exam_attempts.submission_reason`). A raw `UPDATE` or migration can write `"foobar"` into any of these and nothing at the DB layer rejects it; the `.$type<>()` only narrows on the *read* path. `attempt_grading_entries.status`/`.grading_mode` and `user_role_assignments.role` are the only columns with a CHECK.

### JSONB schema knowledge outside its protocol owner

| JSONB field | Protocol owner | Duplicated-knowledge locations |
|-------------|----------------|--------------------------------|
| `answers` | domain `AnswerRecord` | contracts `attempt.ts:102`; engine `answerProtocol.ts:20` (re-implements structural equality traversal) |
| `submittedAnswers` | domain `SubmittedAnswersSnapshot` | engine builder `answerProtocol.ts:198`; engine readers `grading.ts:145`, `gradingWorkset.ts:109`; **no Zod schema anywhere** — `schemaVersion:1` set once, checked zero times |
| `gradingResult` | domain `QuestionScoreResult` | contracts `score.ts:8`, `score.ts:197`; engine writer `gradingWorkset.ts:504` (a *projection* with 3 copies) |
| `questionSnapshot` | domain `QuestionSnapshot` | contracts `attempt.ts:51` (+ omit variant `:97` carrying the redaction rule); engine readers `gradingWorkset.ts:134`, `grading.ts:270` |
| `questions.options` | domain `Option` | `pg.ts:173` **inlines** `{id,content,isCorrect?}` instead of importing `Option` (contrast `questions.gradingRule` at `pg.ts:191` which correctly imports `GradingRule`) |

The `questionSnapshot` shape is known in **5 independent places**; its legacy-JSONB `rubric` normalization transform (`attempt.ts:85`) lives only in contracts.

---

# 11. CROSS-PACKAGE CHANGE BLAST RADIUS

12 protocol-changing commits inspected via `git show --stat`.

| Semantic change | Packages touched | Why each package changed | Legitimate vertical slice? | Duplicate semantic maintenance? |
| --------------- | ---------------- | ------------------------ | -------------------------: | ------------------------------: |
| `9a6fb0b` remove redundant FOR UPDATE after lock seam | api, engine (2) | api: swap 4 call-sites to non-locking read; engine: same swap in deadline/manualGrading | YES | no |
| `c56bae1` enforce enrollment-attempt lock order | api, engine (2) | api: 7 entry points → canonical seam; engine: new lockSeam + threading | YES (new invariant) | no |
| `1a85e49` separate reachability from null recovery | api, db, engine (3) | comment-only corrective across all three | YES | no |
| `e29be53` close nullable deadline semantics | api, db, engine (3) | NULL-deadline recovery + tests in all three | YES | no |
| `d28c3e8` unify effective deadline authority | api, db, engine (3) | api: consolidate expiry; db: candidate query; engine: canonical fn | YES | **YES — `attemptRepo.listDeadlineCandidates` SQL re-encodes the expiry predicate the engine owns** (comment admits "DERIVED, NOT AUTHORITY") |
| `b9125c8` unify terminal closure for manual | api, engine (2) | engine: extract `finalizeTerminalGrading`; api: route + test | YES | no |
| `91f36a7` feat: text_response + submitted_answers freeze | **domain, contracts, engine, db, web (5)** | domain: new enum/type; contracts: **QuestionType widened in ≥4 Zod sites by hand**; engine: builder/freeze; db: migration; web: locale | partial | **YES — textbook shotgun: one enum value edited in 6+ contracts sites** |
| `6507a35` feat: CandidateTakeSnapshot + GradingStatus fix | contracts, api (2) | contracts: new schema; api: endpoint + tests | YES | no |
| `0874959` docs: submitted_answers rename | docs only (0) | — | n/a | no |
| `7af5d13` enforce pending-only manual grading completion | api, db, engine (3) | engine: guard; db: repo guard; api: test | YES | **partial — `grading_mode='manual' AND status='pending_manual'` predicate now in SQL (repo) AND TS (engine) with no shared constant** |
| `f89162c` drive manual grading queue from grading entries | **domain, contracts, engine, db, api (5)** | domain: type reorientation; contracts: DTO removed; engine: 204-line rewrite; db: table+repo+migration; api: rewire | YES (table replacement) | partial |
| `3ad9615` materialize grading workset at submit freeze | api, engine, db (3) | engine: new gradingWorkset.ts; api: 4 submit paths; db: testCleanup | YES | no |

```
MEDIAN_PROTOCOL_CHANGE_PACKAGE_COUNT = 3
MAX_PROTOCOL_CHANGE_PACKAGE_COUNT   = 5
```

### Interpretation

A median of 3 is **expected and healthy** for a layered system (authority changes → wire translation changes → persistence encoding changes → tests change). The **MAX=5** commits (`91f36a7`, `f89162c`) are the concern: both are **semantic shotgun surgery** where the *same* rule (a QuestionType value; a grading-pending predicate) was renamed/added in multiple packages by hand because no mechanical link exists. The package count is not itself the problem; the *absence of a single authority* for the changed fact is.

---

# 12. NEGATIVE DELETION TEST

| Deleted package/layer | Semantic facts lost | Facts already duplicated elsewhere | Reconstruction difficulty |
| --------------------- | ------------------- | --------------------------------- | ------------------------ |
| **contracts** | Zod wire schemas, DTO shapes, i18n message registry, `ErrorCode` closed union, `HiddenReasonEnum` visibility rule, Phase-1 subset literals | enum *values* are duplicated in domain; entity *shapes* in domain types | **MEDIUM** — schemas could be partly derived from domain types via `zod-from-domain` patterns, but the i18n registry, visibility rule, and Phase-1 subsets are genuinely wire-only knowledge that would need a new home |
| **exam-engine** | FSM transition tables, submit-freeze barrier, terminal aggregation, deadline computation, lock seam, capability, retake/late-entry/start logic, manual-grading completion | **NONE** — the API has *composition* of engine primitives but does not contain the primitives themselves | **HIGH** — routes would have to reconstruct FSMs, freeze atomicity, workset aggregation, and lock order from scratch |
| **domain** | the canonical `as const` vocabulary + entity interfaces + pure grading math + error classes | enum *values* are re-typed in contracts; entity shapes mirrored in contracts/db `.$type<>()` | **HIGH but not catastrophic** — contracts + db + engine each carry *partial* copies (which is itself the drift risk); grading math would need rewriting |
| **repoAdapters** (apps/api) | the bridge from DB row shapes → engine port interfaces, RequestContext binding | none | **MEDIUM** — engine ports would have to be implemented inline in each route, spreading DB-shape mapping knowledge into routes |

### Key insight

The deletion test confirms the asymmetry: **exam-engine is the least substitutable** (its knowledge is unique), **domain is partially substitutable** (its vocabulary is duplicated, which is precisely the §2/§8 drift risk), and **contracts carries genuine wire-only knowledge** (i18n, visibility rule, Phase-1 subsets) that is *not* mere duplication.

---

# 13. CENTRAL QUESTION — IS EXAM-ENGINE DEEP ENOUGH?

Definitions applied:
- **NARROW DECISION LIBRARY** — predicates + pure decisions; caller reconstructs state/sequence/persistence.
- **PROTOCOL PRIMITIVE LIBRARY** — correct leaf/composite actions; caller must know required order of several.
- **PROTOCOL KERNEL** — owns invariants + major composite actions; application owns tx composition + external translation.
- **USE-CASE KERNEL** — caller invokes one semantic action (`saveAnswer`, `submitAttempt`, …) with no internal sequencing knowledge.

### Primary classification

```
CURRENT_ENGINE_DEPTH = PROTOCOL_KERNEL
```

The engine owns: the three FSMs, the submit-freeze barrier, terminal aggregation, the canonical terminal closure, effective-deadline authority, the lock seam + capability, retake/late-entry/start logic, and manual-grading completion. The application layer owns transaction composition and external translation. This is the textbook PROTOCOL_KERNEL shape.

### Per-flow scoring (the engine is NOT uniformly deep)

| Flow | Engine depth |
| ---- | ------------ |
| start | PROTOCOL_KERNEL (full `startOrRestoreAttempt`) |
| take | **NARROW** (engine locks + reconciles; **API owns the entire take-snapshot projection** incl. visibility/lockReason/answerSource) |
| save answer | **NARROW_DECISION_LIBRARY** (`processSaveAnswer` decides only; **API owns normalize/clientSeqMap/interpret/persist**) |
| submit | PROTOCOL_PRIMITIVE_LIBRARY (engine owns freeze; **API owns the freeze→finalize sequence + pending_manual branch**) |
| deadline | PROTOCOL_PRIMITIVE_LIBRARY (engine owns expiry+freeze+finalize primitives; **API/scanner own the reconcile→submit→grade sequence**) |
| force submit | PROTOCOL_PRIMITIVE_LIBRARY (engine owns primitives; **API owns voided/needsSubmit/status gates**) |
| manual grading | **USE-CASE_KERNEL** (`gradeQuestion` is a complete composite; route is thin) |
| terminal grading | PROTOCOL_KERNEL (`finalizeTerminalGrading` is the canonical closure) |

**The engine is deep in grading (manual + terminal) and shallow in answer-save and candidate-projection.** Forcing one global label onto it would hide the answer-save shallowness, which is the single most actionable finding.

---

# 14. FINDING CLASSIFICATION

Every finding uses exactly one classification from the required set.

| ID | Semantic fact/action | Current owners | Problem | Classification | Severity |
| -- | -------------------- | -------------- | ------- | -------------- | -------- |
| F01 | `ConflictReason` (domain) vs `SaveAnswerRejectReason` (contracts) | domain + contracts | two names, one 5-value fact, zero mechanical link; test hard-codes literals | **EXPLICIT_MAPPING** needed (or MECHANICALLY_CHECK) | HIGH |
| F02 | QuestionType enum (5 values) | domain + contracts (inlined ×6) | adding a value requires editing 6+ sites by hand; **already fired** (`91f36a7`) | **GENERATE_DERIVED_VIEW** (contracts from domain) | HIGH |
| F03 | AttemptStatus / GradingStatus / ExamStatus / EnrollmentStatus enums | domain + contracts + db | mirrored with no check; DB accepts wider vocabulary than TS | **MECHANICALLY_CHECK** | HIGH |
| F04 | `processSaveAnswer` persist step | engine (decide) + api (persist) | engine name implies action; route owns normalize/clientSeqMap/history/write | **MOVE_TO_ENGINE** (semantic conclusion; not permission) | HIGH |
| F05 | candidate take-snapshot projection (lockReason, answerSource, capabilities) | api (`attempts.shared.ts`) | protocol→wire mapping in API, no engine counterpart | **MOVE_TO_ENGINE** (projection derivation) | MEDIUM |
| F06 | result-visibility rule (`resultPublicationMode × gradingStatus × resultsPublishedAt`) | api (`computeResultVisibility`) + contracts (`HiddenReasonEnum`) | a business rule split between API (logic) and contracts (reason enum), absent from engine | **MOVE_TO_ENGINE** | MEDIUM |
| F07 | availability / primary-action (9 + 5 values) | engine (type) + contracts (enum) | two parallel declarations, hand-synced | **GENERATE_DERIVED_VIEW** | MEDIUM |
| F08 | submit→finalize sequence + pending_manual branch | engine (primitives) + api (sequence) | repeated verbatim in 3 callers; caller must know pending_manual fork | **MOVE_TO_ENGINE** (composite) | MEDIUM |
| F09 | `GradingModeEnum` (contracts) vs `GradingEntryMode` (domain) vs `isManualGradedQuestion` (engine) | 3 representations | parallel enums not linked to the derivation | **GENERATE_DERIVED_VIEW** | MEDIUM |
| F10 | error-code registry (`messageRegistry.ErrorCode`) vs engine `AppError.code: string` | contracts (closed union) + engine (open string) | engine can throw a code not in registry; `normalizeErrorCode` silently falls back | **MOVE_TO_DOMAIN** (canonical codes) or MECHANICALLY_CHECK | MEDIUM |
| F11 | `submissionReason` ("manual"/"deadline") | domain inline union + engine inline literal + api literal | 3 inline copies of a 2-value fact | **MOVE_TO_DOMAIN** (named const) | LOW |
| F12 | `gradingResult` projection shape | domain + contracts ×2 + engine writer | a *non-authoritative* projection with 3 shape copies | **GENERATE_DERIVED_VIEW** | LOW |
| F13 | `submittedAnswers` JSONB shape (incl. `schemaVersion`) | domain + engine builder + 2 engine readers; **no Zod schema** | frozen-truth field has no API-boundary validation; `schemaVersion` set once, checked nowhere | **MECHANICALLY_CHECK** (add schema or version check) | MEDIUM |
| F14 | `attemptRepo.listDeadlineCandidates` SQL expiry predicate | db (SQL) mirrors engine (`computeEffectiveDeadline`) | hand-maintained mirror; comment admits "DERIVED, NOT AUTHORITY" | **MECHANICALLY_CHECK** (test asserting parity) | MEDIUM |
| F15 | `questions.options` inlined shape in `pg.ts` vs domain `Option` | db + domain | inline anonymous type instead of importing domain type (contrast `gradingRule` which imports correctly) | **MOVE_TO_DOMAIN** (use the import) | LOW |
| F16 | `AssignableRole` triple-copy (domain `Role` + db `ASSIGNABLE_ROLES` + CHECK literals + contracts) | 3–4 sites | `pg.ts:630` comment admits structural identity "by design" | **MECHANICALLY_CHECK** | LOW |
| F17 | `computeGradingResult` display-only function kept in engine | engine | name implies authority it no longer holds (prior audit noted) | **KEEP_SPLIT** (display-only is fine) + rename | INFO |
| F18 | `markDisrupted` dead export (no production callers) | engine | dead code | KEEP_SPLIT (Phase-2 placeholder) | INFO |
| F19 | `gradeQuestion` name collision (domain pure vs engine command) | domain + engine | confusion (prior audit noted) | KEEP_SPLIT + rename | INFO |
| F20 | queue admission logic in api (in-memory) | api | Phase-2 feature surfaced early | KEEP_SPLIT | INFO |

> Reminder (per §14): a `MOVE_TO_*` classification is an **audit conclusion about semantic ownership**, NOT permission to modify code. This is a read-only report.

---

# 15. SEMANTIC FRAGMENTATION HEAT MAP

Cell values: **A**=authority, **T**=translation, **P**=persistence encoding, **O**=orchestration, **M**=manual mirror, **C**=consumer only, **-**=no semantic knowledge.
**Highlighted** rows contain more than one `A` or any `M`.

| Subsystem | domain | contracts | exam-engine | db | api | web |
|-----------|:------:|:---------:|:-----------:|:--:|:---:|:---:|
| **Exam lifecycle** | A | M | C | P | O | C |
| **Enrollment lifecycle** | A | M | C | P | C | C |
| **Attempt lifecycle** | A | M | A | P | O | C |
| **Answer save** | C | M | A(decide) | P | **A(persist)+O** | C |
| **Submit freeze** | C | - | A | P | O | - |
| **Deadline** | - | - | A | **M**(SQL mirror) | O | - |
| **Auto grading** | A(math) | - | A | P | O | - |
| **Manual grading** | A(math) | - | A | P | O | - |
| **Terminal grading** | C | - | A | P | O | - |
| **Result selection / visibility** | A(policy) | A(reason enum) | A(score select) | P | **A(visibility rule)** | C |
| **Authz** | A | - | - | P/M | O | C |
| **Audit** | - | - | - | P | O | - |
| **Candidate projection** | - | A(enum) | A(derive) | - | **A(snapshot builder)** | C |

### Highlighted rows (fragmentation)

- **Attempt lifecycle**: domain=authority, contracts=manual mirror, engine=authority (FSM), api=orchestration. Two authorities (domain enum + engine FSM) + one manual mirror.
- **Answer save**: engine=authority(decide), api=**authority(persist)**, contracts=manual mirror. **Split authority** — the only subsystem where persistence authority is outside the engine.
- **Deadline**: engine=authority, db=**manual mirror** (SQL re-encodes the expiry predicate).
- **Result selection/visibility**: domain=authority(policy enum), contracts=**authority**(reason enum), engine=authority(score selection), api=**authority**(visibility rule). **Four authorities** for one subsystem — the most fragmented row.
- **Candidate projection**: contracts=**authority**(enum), engine=authority(derive), api=**authority**(snapshot builder). **Three authorities**.

---

# 16. REQUIRED ARCHITECTURE VERDICT

```
CURRENT_PACKAGE_BOUNDARIES_CLEAN              = YES

CURRENT_SEMANTIC_OWNERSHIP_CLEAN              = PARTIAL

EXAM_ENGINE_DEPTH                             = PROTOCOL_KERNEL

EXAM_ENGINE_DEPENDS_ON_TOO_FEW_PACKAGES       = NO

EXAM_ENGINE_SHOULD_IMPORT_CONTRACTS           = UNRESOLVED

API_OWNS_TOO_MUCH_PROTOCOL_SEQUENCE_KNOWLEDGE = PARTIAL

CONTRACTS_CONTAINS_MANUAL_PROTOCOL_MIRRORS    = YES

DOMAIN_IS_CANONICAL_SEMANTIC_VOCABULARY       = YES

SEMANTIC_SHOTGUN_SURGERY_PRESENT              = YES

BOUNDARY_REDESIGN_REQUIRED                    = NO

TARGETED_BOUNDARY_DEEPENING_REQUIRED          = YES
```

### Verdict rationale (one line each)

- **PACKAGE_BOUNDARIES_CLEAN = YES** — re-verified: domain leaf, engine→domain only, clean adapter seam, no EA cast forgery, no `db.select` in routes, lint:arch enforces. The graph is clean.
- **SEMANTIC_OWNERSHIP_CLEAN = PARTIAL** — ~10 enum vocabularies are manually mirrored (contracts↔domain), 2 subsystems have split authority (answer-save persist, result-visibility), `ConflictReason`/`SaveAnswerRejectReason` are one fact under two names, and there is **zero mechanical equality proof** anywhere in the system.
- **ENGINE_DEPTH = PROTOCOL_KERNEL** — owns invariants + major composite actions; app owns tx + translation. (Per-flow: deep in grading, shallow in answer-save/projection.)
- **ENGINE_DEPENDS_ON_TOO_FEW_PACKAGES = NO** — the engine's isolation from contracts/db is *correct* (it defines its own ports). Adding deps would harm, not help (§0.3).
- **ENGINE_SHOULD_IMPORT_CONTRACTS = UNRESOLVED** — this audit explicitly declines the topological question (§0.3). The *semantic* answer is that enum drift would be better solved by contracts deriving from domain, not by engine importing contracts.
- **API_OWNS_TOO_MUCH_PROTOCOL_SEQUENCE_KNOWLEDGE = PARTIAL** — most routes are thin; but save-answer (persist), submit/force-submit/deadline (freeze→finalize sequence + pending_manual branch), and take-snapshot projection carry protocol semantics the engine does not.
- **CONTRACTS_CONTAINS_MANUAL_PROTOCOL_MIRRORS = YES** — confirmed for every status/reason/policy/type/availability/action enum; root cause is contracts not importing domain in `src/`.
- **DOMAIN_IS_CANONICAL_SEMANTIC_VOCABULARY = YES** — de facto; every branch in the system ultimately keys off domain enum values.
- **SEMANTIC_SHOTGUN_SURGERY_PRESENT = YES** — commits `91f36a7` (QuestionType ×6) and the standing `ConflictReason`/`SaveAnswerRejectReason` duplication.
- **BOUNDARY_REDESIGN_REQUIRED = NO** — the package topology is sound; no package should be merged or split.
- **TARGETED_BOUNDARY_DEEPENING_REQUIRED = YES** — answer-save persist and candidate-projection should move into the engine; enum mirrors should become mechanically derived.

### TOP_5_SEMANTIC_FRAGMENTATION_POINTS

1. **Answer-save persist authority split** (F04) — engine decides, API persists; `processSaveAnswer` is a decision core named like an action.
2. **`ConflictReason` ↔ `SaveAnswerRejectReason`** (F01) — one 5-value protocol fact under two names across two packages, zero link.
3. **QuestionType enum inlined ×6 in contracts** (F02) — already caused shotgun surgery once.
4. **Result-visibility rule ownership** (F06) — a business rule with four authorities (domain policy enum, contracts reason enum, engine score-selection, api visibility logic).
5. **Candidate-projection ownership** (F05/F07) — lockReason/answerSource/visibility derived in API; availability/primary-action declared in both engine and contracts.

### TOP_5_BOUNDARIES_THAT_SHOULD_NOT_CHANGE

1. **domain is the leaf** — vocabulary + pure policy; nothing should depend upward from it.
2. **exam-engine defines its own repository ports** (no db/contracts dep) — the port/adapter seam is the cleanest part of the system.
3. **EA capability mechanism** (`lockSeam.ts`) — the mint/consume/ref-identity pattern is correct and mechanically enforced; only the *composition above it* leaks.
4. **API owns transaction composition** (`executeInTransaction` + retry) — this is legitimate TRANSACTION_MECHANICS, not protocol leakage.
5. **`finalizeTerminalGrading` as the single canonical terminal closure** — provenance-agnostic, mode-free; both auto and manual converge here. Do not split.

### TOP_5_ENGINE_ACTIONS_THAT_ARE_TOO_SHALLOW

1. **`processSaveAnswer`** — decision core masquerading as an action; should own the persist.
2. **`deriveCandidateExamState`** — produces availability/action but the *full* take-snapshot projection (lockReason, answerSource, visibility) is re-derived in API.
3. **submit→finalize is not an engine composite** — `submitAndGradeAttempt`/`deadlineScanner` re-compose the freeze→finalize sequence + pending_manual branch by hand.
4. **`readGradingSnapshot` + `finalizeGrading` are always called as a fixed pair** by the API — the pairing is protocol knowledge the caller re-encodes.
5. **(no engine function owns result visibility)** — the `resultPublicationMode` visibility rule has no engine home at all.

### TOP_5_MANUAL_MIRRORS THAT NEED ONE OWNER OR A MECHANICAL CHECK

1. **`ConflictReason` ↔ `SaveAnswerRejectReason`** (F01) — single owner or a `z.enum([...Object.values(ConflictReason)])` derivation + a parity test.
2. **QuestionType ×6 in contracts** (F02) — derive from domain.
3. **AttemptStatus/GradingStatus/ExamStatus/EnrollmentStatus** (F03) — derive contracts enums from domain + (optionally) add DB CHECKs generated from domain.
4. **`attemptRepo.listDeadlineCandidates` SQL expiry** (F14) — a parity test asserting the SQL mirrors `computeEffectiveDeadline`.
5. **`submittedAnswers` JSONB shape** (F13) — add a Zod schema (contracts) or a version check, so the frozen-truth field is validated at the boundary.

### Final question

> If only ONE architectural boundary could be deepened, which boundary would remove the most caller knowledge without creating package coupling?

**Deepen the answer-save boundary: make `processSaveAnswer` (or a new `saveAnswer` composite) own the full action — lock, reconcile, decide, persist — behind the EA capability, exactly as `gradeQuestion` already owns the full manual-grade action.** This removes the most caller knowledge (normalize, clientSeqMap, AnswerState construction, history reconstruction, the `attempt.answers` write — five steps currently in the route), it requires **no new package dependency** (the engine already defines its `AttemptRepository` port with `update`), and it eliminates the only place in the system where `attempt.answers` is written outside the engine. It is the single highest-leverage, lowest-coupling deepening available.

---

*End of EXAM-BOUNDARY-REVIEW-0. READ-ONLY; one report file created; no commit.*
