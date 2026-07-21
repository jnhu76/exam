# EXAM-INVARIANT-ENFORCEMENT-REVIEW-0 — Invariant Enforcement Reality Audit

**Date:** 2026-07-09
**HEAD:** `553add52f67d7cdb3943632a352cdb1d2fbdde38`
**Branch:** `fix/invariant-enforcement`
**Mode:** READ-ONLY (no production code, tests, docs, lint, or migration modified; no commit)

---

## 0. Git State

```
git status --short
  A  docs/audit/EXAM-STATIC-CAPABILITY-0.md
  A  docs/audit/exam-architecture-reconstruction.md
  A  docs/audit/protocol-semantic-boundary-review.md
  A  docs/audit/static-capability-audit.md

git branch --show-current
  fix/invariant-enforcement

git rev-parse HEAD
  553add52f67d7cdb3943632a352cdb1d2fbdde38

git log --oneline --decorate -5
  553add5 (HEAD -> fix/invariant-enforcement, origin/master, origin/HEAD, master) Merge pull request #177
  c56bae1 fix(formal): enforce enrollment-attempt lock order
  d28c3e8 fix(deadline): unify effective deadline authority
  b9125c8 fix(grading): unify terminal closure for manual results
  07a78cc Merge pull request #176 from jnhu76/fix/api-test-ci-regression
```

---

## 1. Skill Invocation Evidence

Skills invoked as required:
- **`audit-context-building`** — loaded via Skill tool; methodology applied to reconstruct authority topology and invariant owners.
- **`static-analysis`** — NOT in available-skills list; methodology applied manually from on-disk SKILL.md.
- **`variant-analysis`** — NOT in available-skills list; methodology applied manually via repo-wide search tasks.
- **`fp-check`** — NOT in available-skills list; verification methodology applied manually to each enforcement claim.

The required `semgrep-rule-creator` skill was NOT invoked (per §0: "Do NOT invoke semgrep-rule-creator in this review").

---

## 2. Prior Enforcement Claims Under Review

Extracted from `docs/audit/EXAM-STATIC-CAPABILITY-0.md` (the static capability audit, also referred to as "EXAM-STATIC-CAPABILITY-0") and `docs/audit/static-capability-audit.md`.

### Key Numerical Claims

The static-capability audit (`static-capability-audit.md` §N) states:

```
ALREADY_MACHINE_REJECTED          = 9   (#2,#5,#6,#8,#9,#10,#16,#17, partial #3/#13)
COULD_BE_MACHINE_REJECTED         = 2   (#18 via EXAM-SG-01/ESLint; #14 via contract parity test)
PARTIALLY_MACHINE_REJECTABLE      = 3   (#1, #11, #7)
FORMAL_OR_DYNAMIC_ONLY            = 3   (concurrency rows)
SEMANTIC_ONLY                     = 3   (#12, result-visibility, protocol-intent drift)
```

TOTAL_ACCEPTED_DEFECT_CLASSES = 18.

The static-capability audit (EXAM-STATIC-CAPABILITY-0.md) does NOT contain the `65%` or `78%` percentages. Those appear to come from the static-capability-audit in a different context. Let me compute: 9/18 = 50%.

### Claim Table

| Claim ID | Previous claim | Claimed mechanism | Source report | Verification target |
|----------|---------------|-------------------|---------------|-------------------|
| C-001 | 9/18 defect classes already machine-rejected | Structural tests, arch lint, DB constraints | static-capability-audit §N | Recalculate |
| C-002 | Structural tests are "better protected than tool inventory suggests" | Bespoke source-text scanner | static-capability-audit §A | Test strength |
| C-003 | TypeScript completely prevents LEA identity forgery | unique symbol branding | static-capability-audit §H | Verify type enforcement |
| C-004 | Clock authority is structurally locked | time-authority.structural.test.ts + allowlist | static-capability-audit §I (SA-06) | Verify complete coverage |
| C-005 | Lock order is structurally locked | lock-order.structural.test.ts (7 rules) + runtime assertCapabilityFor | static-capability-audit §L | Verify completeness |
| C-006 | Single grading authority is structurally locked | gradingArchitecture.structural.test.ts | static-capability-audit §L | Verify strength |
| C-007 | "AppError-only throws" is currently VIOLATED (22 plain Errors) | plain Error found in gradingWorkset.ts | static-capability-audit §I (SA-01) | Re-verify |
| C-008 | domain↔contracts enum parity has NO test | convention only | static-capability-audit §N | Re-verify |
| C-009 | submitAttempt is wrongfully claimed as "freeze barrier" implying immutability, but mutable answers continue to be written elsewhere | (implied claim) | — | Verify |
| C-010 | save route is only place outside engine writing protocol state | Engine leaves persist step to API | static-capability-audit §I (SA-02) | Verify |

---

## 3. Reconstructed Invariant Register

Independently reconstructed from production evidence. Each invariant is verified against current code, not inherited from prior audits.

| ID | Exact invariant | Protocol or architecture | Normative owner |
|----|----------------|------------------------|----------------|
| EXAM-INV-001 | active attempt has deadlineAt reachable (in_progress/disrupted → deadlineAt IS NOT NULL in protocol) | Protocol | `startOrRestoreAttempt`, `restoreAttempt`, `extendAttemptTime` |
| EXAM-INV-002 | grading workset materialized exactly once at submit (atomic with submittedAnswers freeze) | Protocol | `submitAttempt` |
| EXAM-INV-003 | grading entries are the exclusive terminal scoring input (aggregateGradingEntries is sole scorer) | Protocol | `aggregateGradingEntries` |
| EXAM-INV-004 | submittedAnswers is frozen after submit, never mutated | Protocol | `submitAttempt` |
| EXAM-INV-005 | attempt transitions use canonical FSM (no direct status mutation outside engine commands) | Protocol | `attemptStateMachine` + command functions |
| EXAM-INV-006 | manual grading only accepts pending_manual entries (no re-grading completed) | Protocol | `gradeQuestion` (exam-engine) |
| EXAM-INV-007 | Enrollment FOR UPDATE before Attempt FOR UPDATE (EA lock order) | Protocol | `lockEnrollmentAndAttempt` |
| EXAM-INV-008 | server clock (fastify.now()) is the sole time authority for business decisions | Architecture | `now.ts` plugin + time-authority structural test |
| EXAM-INV-009 | grading workset is fully terminal before aggregation (all entries completed_auto/completed_manual) | Protocol | `aggregateGradingEntries` (validates) |
| EXAM-INV-010 | questionSnapshot is frozen at attempt creation, never mutated | Protocol | `startOrRestoreAttempt` |
| EXAM-INV-011 | enrollment finalScore/finalPassed/finalAttemptId are PROJECTIONS, selected by scoreStrategy from attempt.score | Protocol | `finalizeTerminalGrading` (via `shouldSelectAttempt`) |
| EXAM-INV-012 | answer save is versioned/idempotent with conflict detection | Protocol | `processSaveAnswer` |
| EXAM-INV-013 | routes must use repositories (no bare db queries) | Architecture | `check-architecture.mjs` |
| EXAM-INV-014 | domain is an internal-dependency leaf (no @exam/*, fastify, react, drizzle-orm) | Architecture | `check-architecture.mjs` |
| EXAM-INV-015 | contracts cannot depend on fastify | Architecture | `check-architecture.mjs` |
| EXAM-INV-016 | exam-engine cannot depend on fastify | Architecture | `check-architecture.mjs` |
| EXAM-INV-017 | web cannot import @exam/db | Architecture | `check-architecture.mjs` |
| EXAM-INV-018 | authz is a constrained leaf (no fastify/React/Drizzle, only @exam/domain) | Architecture | `check-architecture.mjs` |
| EXAM-INV-019 | LockedEnrollmentAttemptIdentity cannot be forged (opaque symbol brand) | Protocol/Type | `lockSeam.ts` unique symbol + arch lint cast ban |
| EXAM-INV-020 | gradingResult is a terminal PROJECTION only, never scoring input | Protocol | `aggregateGradingEntries` (body reads only attempt.id + questionSnapshot) |
| EXAM-INV-021 | Domain↔contracts enum values are structurally identical (no drift) | Convention | (no mechanical check) |
| EXAM-INV-022 | engine errors use AppError subclasses (not plain Error) | Convention | **VIOLATED**: 22 `throw new Error` in gradingWorkset.ts |
| EXAM-INV-023 | attempt.score/passed/gradingResult written only by finalizeTerminalGrading (exclusive projection writer) | Protocol | `finalizeTerminalGrading` |
| EXAM-INV-024 | enrollment terminal projection written only by finalizeTerminalGrading | Protocol | `finalizeTerminalGrading` |
| EXAM-INV-025 | Deadline candidate discovery in scanner uses canonical isAttemptDeadlineExpired (no competing authority) | Protocol | `deadline-authority.structural.test.ts` + engine |
| EXAM-INV-026 | Exam status transitions use canonical FSM | Protocol | `examStateMachine` + `examCommands` |
| EXAM-INV-027 | Enrollment status transitions use canonical FSM | Protocol | `enrollmentStateMachine` + commands |
| EXAM-INV-028 | Heartbeat writes only lastActivityAt (never protocol state) | Protocol | heartbeat route |
| EXAM-INV-029 | grades cannot exceed maxScore (earnedScore <= maxScore) | DB | CHECK constraint on attempt_grading_entries |
| EXAM-INV-030 | grading entries have unique (attempt_id, question_id) — one entry per work item | DB | UNIQUE constraint on attempt_grading_entries |

### Corrections from Prior Audit Register

- **INV-005** from prior audit (FSM bypass) is now INV-005 — clarified as "attempt transitions use canonical FSM, not TypeScript enforced"
- **INV-001** from prior audit (materializeGradingWorkset) merged into INV-002
- **INV-003** from prior audit (aggregator field set) merged into INV-003
- **INV-004** from prior audit (single terminal writer) is now INV-023/INV-024
- **Split INV-011**: prior audit combined "deadline reachability" and "NULL recovery" — now INV-001 (active→non-null deadline)
- **INV-013** from prior audit (pending_manual closure) merged into INV-006
- **INV-015** from prior audit (ConflictReason/SaveAnswerRejectReason) merged into INV-021
- **INV-016** from prior audit (AppError throws) is now INV-022
- **INV-009** from prior audit (clock authority) is now INV-008

---

## 4. Writer / Reader / Bypass Inventory

| Invariant | State/fact | Canonical seam | Current writers | Current readers | Bypass shape |
|-----------|-----------|----------------|----------------|----------------|-------------|
| INV-001 | attempt.deadlineAt | startOrRestoreAttempt, restoreAttempt, extendAttemptTime | start/restore/extend engine commands | computeEffectiveDeadline, scanner | Direct `attemptRepo.update(..., {deadlineAt: ...})` compiles; no structural test prevents | 
| INV-002 | attempt_grading_entries rows | materializeGradingWorkset (called only from submitAttempt) | submitAttempt (exactly 1 caller) | aggregateGradingEntries, gradeQuestion | gradArch structural test locks caller file; direct `gradingWorksetRepo.bulkCreate(...)` from a route would fail file-allowlist check |
| INV-003 | graded score/passed | aggregateGradingEntries (called only from grading.ts) | finalizeTerminalGrading | candidate routes, export | New scorer calling gradingWorksetRepo reads directly compiles; no type guard |
| INV-004 | attempt.submittedAnswers | submitAttempt (freeze barrier) | submitAttempt | grading, gradingWorkset | Direct write `attemptRepo.update(..., {submittedAnswers: ...})` compiles |
| INV-005 | attempt.status | submitAttempt, markDisrupted, restoreAttempt, finalizeTerminalGrading | 4 engine commands | FSM, routes, grading | `attemptRepo.update(..., {status: "graded"})` compiles cleanly |
| INV-006 | grading_entry.status | gradeQuestion (engine) | materializeGradingWorkset (auto), gradeQuestion (manual) | aggregateGradingEntries, gradeQuestion (precondition) | Direct `gradingWorksetRepo.updateEntry(..., {status: "completed_manual"})` compiles |
| INV-007 | lock order (E before A) | lockEnrollmentAndAttempt | lockEnrollmentAndAttempt (7 entry points) | assertCapabilityFor (consumers) | Calling `enrollmentRepo.findByExamAndCandidateForUpdate` + `attemptRepo.findByIdForUpdate` in wrong order compiles; structural test locks 7 entry points but not arbitrary new paths |
| INV-008 | now for business decisions | fastify.now() via now.ts | now.ts only | all business paths | `new Date()` or `Date.now()` in new files outside allowlist would fail time-authority structural test |
| INV-009 | workset terminality | aggregateGradingEntries (validates internally) | auto: materialize; manual: gradeQuestion | aggregateGradingEntries | Calling aggregateGradingEntries with non-terminal entries compiles; runtime throws |
| INV-010 | attempt.questionSnapshot | startOrRestoreAttempt | startOrRestoreAttempt | grading, gradingWorkset | Direct write compiles |
| INV-011 | enrollment.finalScore/etc. | finalizeTerminalGrading (exclusive) | finalizeTerminalGrading | candidate routes | `enrollmentRepo.update(..., {finalScore: ...})` compiles; structural test locks writer file = {grading.ts} |
| INV-012 | answers save protocol | processSaveAnswer (pure) + save route (persist) | save route (validated via processSaveAnswer) | submitAttempt (draft source) | Direct `attemptRepo.update(..., {answers: ...})` compiles; architectural convention requires going through processSaveAnswer |
| INV-013 | no bare db queries in routes | repository pattern | — | — | `db.select(...)` in routes fails arch lint regex |
| INV-014 | domain leaf | — | — | — | `from "@exam/..."` in domain fails arch lint |
| INV-015 | contracts no fastify | — | — | — | `from "fastify"` in contracts fails arch lint |
| INV-016 | exam-engine no fastify | — | — | — | `from "fastify"` in exam-engine fails arch lint |
| INV-017 | web no @exam/db | — | — | — | `from "@exam/db"` in web fails arch lint |
| INV-018 | authz leaf | — | — | — | authz import violations fail arch lint |
| INV-019 | LEA identity forgery | lockSeam.ts (mint only) | lockSeam.ts (mint) | assertCapabilityFor | `as LockedEnrollmentAttemptIdentity` fails arch lint regex; structural test verifies no export alias; type system rejects missing brand properties |
| INV-020 | gradingResult never scoring input | aggregateGradingEntries body lock | finalizeTerminalGrading (writes) | export/display only | Reading `attempt.gradingResult` in a new scorer compiles with zero errors |
| INV-021 | enum parity | (none) | domain (authority) + contracts (mirror) | wire consumers | Adding a value to a domain enum without updating contracts compiles; CI does not catch drift |
| INV-022 | AppError-only throws | (none) | engine code | normalizeErrorCode → registry | `throw new Error(...)` compiles; no rule catches it; **currently VIOLATED** in gradingWorkset.ts (22 sites) |
| INV-023 | attempt.score/passed/gradingResult writer | finalizeTerminalGrading | finalizeTerminalGrading | routes | Direct write via `attemptRepo.update` compiles; structural test locks writer-inventory but only for enrollment projection (attempt not checked) |
| INV-024 | enrollment final projection writer | finalizeTerminalGrading | finalizeTerminalGrading | candidate routes | Direct write compiles; structural test locks writer-inventory = {grading.ts} |
| INV-025 | deadline authority | isAttemptDeadlineExpired | computeEffectiveDeadline (pure) | deadline reconciliation, scanner | Inlining `deadlineAt <= now` or `closeAt <= now` without going through canonical function would fail deadline-authority structural test |
| INV-026 | exam FSM | assertExamTransition | examCommands | examCommands | Direct `examRepo.update(..., {status: "open"})` without FSM check compiles |
| INV-027 | enrollment FSM | assertEnrollmentTransition | attemptCommands, finalizeTerminalGrading | — | Direct `enrollmentRepo.update(..., {status: "completed"})` compiles |
| INV-028 | heartbeat | heartbeat route (direct repo) | heartbeat route | (none) | N/A — intentional direct-write |
| INV-029 | earnedScore <= maxScore | (DB constraint) | materialize/gradeQuestion | aggregateGradingEntries | DB CHECK rejects violation at persistence |
| INV-030 | (attempt_id, question_id) unique | (DB constraint) | materialize | aggregateGradingEntries | DB UNIQUE constraint rejects duplicates |

---

## 5. Canonical Seam → Enforcement Review

### submitAttempt

| Question | Answer |
|----------|--------|
| What invariant does the seam establish? | INV-002 (workset materialized once), INV-004 (submittedAnswers frozen), INV-005 (status→submitted) |
| All current production paths using it? | Yes: every production caller goes through `submitAttempt` |
| Can future production code bypass it while compiling? | **YES** — `attemptRepo.update(..., {status:"submitted", submittedAnswers:..., submissionReason:...})` compiles |
| Would lint reject the bypass? | Partial — gradingArchitecture structural test would catch a second `materializeGradingWorkset` caller but NOT catch a direct `status` write |
| Would static analysis reject the bypass? | NO — no Semgrep/ESLint rule exists |
| Would DB reject the resulting state? | NO — `text("status")` accepts any string; no CHECK |
| Would runtime code detect the invalid state later? | PARTIAL — a status set directly would be accepted downstream; subsequent grading might fail on null `submittedAnswers` |
| Would tests likely detect it? | PARTIAL — existing integration tests exercise the happy path; a new bypass path in production code (not test) may not be covered |

### aggregateGradingEntries

| Question | Answer |
|----------|--------|
| What invariant does the seam establish? | INV-003 (exclusive scoring authority), INV-020 (never reads gradingResult) |
| All current production paths using it? | Yes: called only from grading.ts |
| Can future production code bypass it while compiling? | **YES** — a new function can type-correctly sum `earnedScore` from grading entries directly |
| Would lint reject the bypass? | gradingArchitecture structural test locks caller-file set for aggregateGradingEntries (must be {grading.ts}) |
| Would static analysis reject the bypass? | NO |
| Would DB reject the resulting state? | NO |
| Would runtime code detect the invalid state later? | NO — single scorer bypass produces correct-looking grades |
| Would tests likely detect it? | LOW_PROBABILITY — unless tests specifically assert scoring singleness |

### finalizeTerminalGrading

| Question | Answer |
|----------|--------|
| What invariant does the seam establish? | INV-023/INV-024 (exclusive projection writer) |
| All current production paths using it? | Yes: called from finalizeGrading and gradeQuestion |
| Can future production code bypass it while compiling? | **YES** — `attemptRepo.update(..., {score: ..., passed: ..., gradingResult: ...})` compiles |
| Would lint reject the bypass? | gradingArchitecture structural test locks enrollment projection writes to writer-inventory={grading.ts}. But attempt score/passed/gradingResult writes are NOT locked by the structural test — it only checks enrollment finalScore/finalPassed/finalAttemptId |
| Would DB reject the resulting state? | NO — all score-related columns are nullable text/jsonb |
| Would runtime code detect the invalid state later? | NO — scores written directly look consistent |
| Would tests likely detect it? | LOW_PROBABILITY |

### lockEnrollmentAndAttempt

| Question | Answer |
|----------|--------|
| What invariant does the seam establish? | INV-007 (lock order), INV-019 (identity forging) |
| All current production paths using it? | Yes: 7 EA entry points all go through the seam |
| Can future production code bypass it while compiling? | **YES** — calling `enrollmentRepo.findByExamAndCandidateForUpdate` + `attemptRepo.findByIdForUpdate` in any order compiles |
| Would lint reject the bypass? | lock-order structural test locks the 7 known entry points but cannot discover new ones; the test asserts entry-point count == 7, so adding a new one would fail, but removing a check from an existing route would not |
| Would DB reject the resulting state? | NO |
| Would runtime code detect the invalid state later? | Only if the runtime path calls `assertCapabilityFor` — a direct-lock path that doesn't mint a capability would not be detected |
| Would tests likely detect it? | Only if the new path produces incorrect enrollment scores concurrently |

### gradeQuestion (exam-engine)

| Question | Answer |
|----------|--------|
| What invariant does the seam establish? | INV-006 (pending_manual only), INV-009 (workset terminality) |
| All current production paths using it? | Yes: single caller (grading queue route) |
| Can future production code bypass it while compiling? | **YES** — `gradingWorksetRepo.updateEntry(..., {status: "completed_manual", earnedScore: ...})` from a new grading path compiles |
| Would lint reject the bypass? | NO structural test locks gradingWorksetRepo.updateEntry usage |
| Would DB reject the resulting state? | PARTIAL — CHECK constraint on status (accepts `completed_manual`) but does NOT distinguish between `pending_manual→completed_manual` transitions vs direct writes |
| Would runtime code detect the invalid state later? | NO — the entry looks terminal |
| Would tests likely detect it? | LOW_PROBABILITY |

### isAttemptDeadlineExpired / computeEffectiveDeadline

| Question | Answer |
|----------|--------|
| What invariant does the seam establish? | INV-025 (single deadline authority) |
| All current production paths using it? | Yes |
| Can future production code bypass it while compiling? | **YES** — inlining `deadlineAt <= now && ...` compiles |
| Would lint reject the bypass? | deadline-authority structural test detects `closeAt <= now` patterns in scanner code and `selectExpiredAttempts` function name |
| Would DB reject the resulting state? | NO |
| Would runtime code detect the invalid state later? | Only if the scanner's autoSubmitAndGrade rechecks via canonical function |
| Would tests likely detect it? | PARTIAL — deadline scanner tests exercise the canonical path |

### Classification Summary

| Seam | Current convergence | Compile-time bypass possible? | Structural bypass rejected? | DB rejection? | Runtime later detects? |
| ---- | ------------------- | ----------------------------: | --------------------------: | -------------: | ---------------------: |
| submitAttempt | All current | YES | PARTIAL (workset callers locked, not status writes) | NO | PARTIAL |
| aggregateGradingEntries | All current | YES | YES (caller file locked) | NO | NO |
| finalizeTerminalGrading | All current | YES | PARTIAL (enrollment projection writer locked; attempt projection not locked) | NO | NO |
| lockEnrollmentAndAttempt | 7 entry points | YES | PARTIAL (known entry points counted; new ones detected by count mismatch) | NO | PARTIAL (assertCapabilityFor) |
| gradeQuestion (engine) | Single caller | YES | NO | PARTIAL (CHECK only) | NO |
| isAttemptDeadlineExpired | All current | YES | PARTIAL (closeAt/now patterns scanned) | NO | PARTIAL |
| processSaveAnswer | Single caller | YES | NO | NO | NO (pure decision) |
| materializeGradingWorkset | Single caller | YES | YES (caller=submitAttempt) | NO | NO |

Seam classifications:
- **SEALED**: (none)
- **STRUCTURALLY_GUARDED**: aggregateGradingEntries, materializeGradingWorkset (caller file must be specific)
- **RUNTIME_GUARDED**: lockEnrollmentAndAttempt (assertCapabilityFor), gradeQuestion (pending_manual check), finalizeGrading (rejects pending_manual)
- **TEST_GUARDED**: submitAttempt, finalizeTerminalGrading, isAttemptDeadlineExpired
- **CONVENTION_ONLY**: processSaveAnswer (callers expected to use it; no mechanical lock)

---

## 6. Type System Reality Check

### ENUM AND UNION TYPES

| Claimed type invariant | Type-correct violating implementation possible? | Evidence | Verdict |
| ---------------------- | ----------------------------------------------: | -------- | ------- |
| AttemptStatus is type-enforced for FSM transitions | YES — `attemptRepo.update(id, {status: "graded"})` compiles; AttemptStatus is a plain string union, Partial\<ExamAttempt\> accepts any value | domain types.ts line 310; attemptRepo.update signature accepts Partial | NOT_TYPE_ENFORCED |
| GradingEntryStatus prevents manual re-entry | YES — `gradingWorksetRepo.updateEntry(id, {status: "completed_manual"})` compiles; status is plain string union | domain types.ts line 471-477 | NOT_TYPE_ENFORCED |
| LockedEnrollmentAttemptIdentity cannot be forged externally | NO — type system genuinely rejects missing brand properties; `@ts-expect-error` test confirms; arch lint bans `as` casts | lockSeam.ts lines 20-21, 37-45; lockSeam.test.ts lines 22-30; arch lint rule 4b/5 | **TYPE_ENFORCED** |
| GradingResult is never scoring input (type-enforced) | YES — `attempt.gradingResult?.find(q => ...)` compiles cleanly; gradingResult is plain `QuestionScoreResult[]` | domain types.ts line 313, 436-443 | NOT_TYPE_ENFORCED |
| Contracts cannot drift from domain enums | YES — contracts src/ imports NOTHING from domain; Zod enums are hand-typed strings with no derivation | contracts/src/ has zero `@exam/domain` imports | NOT_TYPE_ENFORCED |
| AppError-only throws in engine | YES — `throw new Error(...)` compiles; plain Error is a subtype of Error, no type rule prevents it | gradingWorkset.ts (22 sites) | NOT_TYPE_ENFORCED |
| Server clock authority | YES — `new Date()` compiles anywhere; only structural test prevents | answerProtocol.ts line 87 (`state.now ?? new Date()`) | NOT_TYPE_ENFORCED |

### Verdict Summary

- **TYPE_ENFORCED**: INV-019 (LEA identity) — genuinely prevented by TypeScript + arch lint
- **TYPE_ASSISTED**: INV-029/INV-030 (grading entry constraints via DB types + CHECK), INV-014 (package boundary via arch lint regex)
- **NOT_TYPE_ENFORCED**: INV-001, INV-003, INV-004, INV-005, INV-006, INV-011, INV-020, INV-021, INV-022, INV-023, INV-024, INV-025, INV-026, INV-027

---

## 7. Architecture Lint Reality Check

### check-architecture.mjs Rule Inventory

| Rule ID | Pattern | Scope | Rejected construct | Semantic invariant actually protected |
| ------- | ------- | ----- | ------------------ | ------------------------------------- |
| ARCH-01 | `/from ["'](?:fastify\|react\|drizzle-orm\|@exam\/)/` | `packages/domain/src` | Any import of prohibited packages | INV-014: domain is leaf |
| ARCH-02a | `/from ["'](?:fastify\|react\|drizzle-orm)/` | `packages/authz/src` | Framework imports | INV-018: authz framework-independent |
| ARCH-02b | `/from ["']@exam\/(?:db\|contracts\|auth\|exam-engine\|import-export)\//` | `packages/authz/src` | @exam/* other than domain | INV-018: authz depends only on domain |
| ARCH-03 | `/from ["']fastify/` | `packages/contracts/src` | fastify import | INV-015: contracts no fastify |
| ARCH-04a | `/from ["']fastify/` | `packages/exam-engine/src` | fastify import | INV-016: engine no fastify |
| ARCH-04b | `/\bas\s+LockedEnrollmentAttemptIdentity\b/` | `packages/exam-engine/src` | as cast to LEA | INV-019: no LEA forgery |
| ARCH-05 | `/\bas\s+LockedEnrollmentAttemptIdentity\b/` | `apps/api/src` | as cast to LEA | INV-019: no LEA forgery |
| ARCH-06 | `/from ["']@exam\/db/` | `apps/web/src` | @exam/db import | INV-017: web no db |
| ARCH-07a | `/\bdb\.(?:select\|insert\|update\|delete)\s*\(/` | `apps/api/src/routes` | bare db calls | INV-013: routes use repos |
| ARCH-07b | `/from ["']drizzle-orm/` | `apps/api/src/routes` | drizzle-orm import | INV-013: no direct ORM |
| ARCH-07c | `/from ["']@exam\/db\/src\/schema\//` | `apps/api/src/routes` | schema import | INV-013: no schema leak |

### Guard Strength Classification

| Rule | Classification | Rationale |
| ---- | -------------- | --------- |
| ARCH-01 | TEXTUAL_STRONG | Simple regex on import strings; domain has very few imports |
| ARCH-02a/b | TEXTUAL_STRONG | Same pattern; authz is tiny |
| ARCH-03 | TEXTUAL_STRONG | `from "fastify"` is an exact string match |
| ARCH-04a | TEXTUAL_STRONG | Same |
| ARCH-04b | TEXTUAL_NARROW | Catches `as LockedEnrollmentAttemptIdentity` but not `as unknown as LockedEnrollmentAttemptIdentity` or `x as LockedEnrollmentAttemptIdentity as Y` |
| ARCH-05 | TEXTUAL_NARROW | Same as 04b |
| ARCH-06 | TEXTUAL_STRONG | Simple import string |
| ARCH-07a | TEXTUAL_NARROW | `db.select(` is caught, but `const db = getDB(); db.select(` or `db["select"]` would be missed |
| ARCH-07b | TEXTUAL_STRONG | Import string |
| ARCH-07c | TEXTUAL_STRONG | Import string path |

### Bypass Detection

| Bypass method | ARCH-07a detection? |
| --- | --- |
| `db.select(` | CAUGHT |
| `const database = db; database.select(` | **MISSED** — no pattern for renamed references |
| `db["select"](` | **MISSED** — bracket notation doesn't match regex |
| `someHelper(db)` | **MISSED** — passing db to a helper outside routes |
| `(tx ?? db).select(` | **MISSED** — `?` breaks the word boundary pattern |

The arch lint is TEXTUAL_NARROW for protocol-relevant rules and TEXTUAL_STRONG for import-layer rules. It provides genuine protection for INV-013 through INV-018, but all patterns are bypassable by determined contributors.

---

## 8. Static Analysis Reality Check

| Tool | Installed | Rules/config present | Relevant protocol rule | Verify integrated | CI integrated |
| ---- | --------: | -------------------: | ---------------------- | ----------------: | ------------: |
| TypeScript (tsc) | YES (5.9.3) | YES (tsconfig.base.json strict) | None (no protocol encoding) | YES (via typecheck) | YES (CI verify:static) |
| ESLint | YES (v10.6) | **NO** — no eslint config anywhere | None | NO | NO |
| typescript-eslint | YES (installed dep) | **NO** — never configured or invoked | None | NO | NO |
| Semgrep | YES (1.168.0) | **NO** — no rules, no config, not in CI | None | NO | NO |
| CodeQL | **NO** (not found) | NO | N/A | NO | NO |
| Custom scripts | YES | YES | ARCH rules (see §7) + structural tests (see §5) | YES | YES (verify chain) |
| Prettier | YES | YES | None (formatting only) | YES | YES |

**Critical finding:** An installed static analyzer with zero repository rules provides ZERO protocol-invariant enforcement. This applies to Semgrep, ESLint, and typescript-eslint — all are installed but none are configured.

The only effective static analysis for protocol invariants comes from:
1. The 4 structural tests (source-text scanners in apps/api/src/runtime/) — **bespoke, project-specific**
2. The architecture lint script — **textual regex, not semantic**
3. TypeScript strict mode — **class-level only, no protocol encoding**

---

## 9. DB Enforcement Reality Check

| Field | TS type | PostgreSQL type | CHECK/constraint | Invalid value DB accepts? |
| ----- | ------- | --------------- | ---------------- | ------------------------: |
| `exams.status` | `ExamStatus` | `text` (no $type) | NONE | **YES** — any string |
| `exams.timing_mode` | `TimingMode` | `text` (no $type) | NONE | **YES** — any string |
| `exams.score_strategy` | `ScoreStrategy` | `text` (no $type) | NONE | **YES** — any string |
| `exams.retake_policy` | `RetakePolicy` | `text` (no $type) | NONE | **YES** — any string |
| `exam_enrollments.status` | `EnrollmentStatus` | `text` (no $type) | NONE | **YES** — any string |
| `exam_attempts.status` | `AttemptStatus` | `text` (no $type) | NONE | **YES** — any string |
| `exam_attempts.grading_status` | `GradingStatus` | `text` WITH `.$type()` | NONE | **YES** — `.$type()` is TS-only, PG accepts any text |
| `exam_attempts.deadline_at` | `timestamp` | `timestamp with tz` | NONE | **YES** — nullable, any timestamp accepted |
| `exam_attempts.submitted_answers` | `SubmittedAnswersSnapshot` | `jsonb` WITH `.$type()` | NONE | **YES** — any JSON |
| `exam_attempts.grading_result` | `QuestionScoreResult[]` | `jsonb` WITH `.$type()` | NONE | **YES** — any JSON |
| `exam_attempts.score` | `number` | `double precision` | NONE | **YES** — any numeric value (including negative) |
| `exam_attempts.submission_reason` | `"manual"\|"deadline"` | `text` (no $type) | NONE | **YES** — any string |
| `questions.type` | `QuestionType` | `text` (no $type) | NONE | **YES** — any string |
| `grading_entries.status` | `GradingEntryStatus` | `text` WITH `.$type()` + CHECK | **CHECK** IN ('completed_auto','pending_manual','completed_manual') | NO at PG level |
| `grading_entries.grading_mode` | `GradingEntryMode` | `text` WITH `.$type()` + CHECK | **CHECK** IN ('auto','manual') | NO at PG level |
| `grading_entries.earned_score` | `number?` | `double precision` | CHECK >= 0 AND <= max_score | **YES** beyond range — but CHECK catches |
| `enrollment.final_score` | `number?` | `double precision` | NONE | **YES** — any numeric, even negative |

### Cross-Column Invariants the DB Does NOT Enforce

| Potential constraint | Currently enforced? |
| ------------------- | ------------------ |
| `status = 'graded'` ⇒ `score IS NOT NULL` | **NO** |
| `status = 'graded'` ⇒ `gradingResult IS NOT NULL` | **NO** |
| `status = 'graded'` ⇒ `gradedAt IS NOT NULL` | **NO** |
| `status = 'submitted'` ⇒ `submittedAnswers IS NOT NULL` | **NO** |
| `status IN ('in_progress','disrupted')` ⇒ `deadlineAt IS NOT NULL` | **NO** |
| `gradingStatus = 'pending_manual'` ⇒ `status = 'submitted'` | **NO** |
| `submissionReason IS NOT NULL` ⇒ `submittedAt IS NOT NULL` | **NO** |

---

## 10. Runtime Guard Coverage

| Invariant | Runtime guard | Entry points covered | Known bypass path | Coverage |
| --------- | ------------- | -------------------- | ----------------- | -------- |
| INV-005 (FSM) | `assertAttemptTransition` in command functions | All 5 attemptCommands functions | Direct `attemptRepo.update({status})` bypasses FSM entirely | LOCAL_ONLY |
| INV-006 (pending-only) | `entry.status !== "pending_manual" → throw` in gradeQuestion | gradeQuestion only | Direct `gradingWorksetRepo.updateEntry({status:"completed_manual"})` bypasses | LOCAL_ONLY |
| INV-007 (lock order) | lockSeam.ts enforces Enrollment→Attempt; `assertCapabilityFor` ref-identity check | All 7 EA entry points via `lockEnrollmentAndAttempt` | Calling repos directly without the seam | COMPLETE_CURRENT_TOPOLOGY |
| INV-009 (terminality) | `aggregateGradingEntries` validates all entries terminal before proceeding | Called from finalizeTerminalGrading only | Direct write of score without aggregation | LOCAL_ONLY |
| INV-013 (repository pattern) | (arch lint, not runtime) | — | — | N/A (not runtime) |

Coverage:
- **COMPLETE_CURRENT_TOPOLOGY**: INV-007 (lock order) — all 7 current EA paths converge on the seam
- **COMPLETE_CURRENT_TOPOLOGY**: INV-019 (LEA identity) — arch lint + structural test + TypeScript all prevent forgery
- **PARTIAL**: INV-005 (FSM) — runtime guards exist only in engine commands, bypassable outside them
- **LOCAL_ONLY**: INV-006 (pending-only), INV-009 (terminality) — guard exists only inside specific function

---

## 11. Test Coverage Is Not Enforcement

| Invariant | Test files | Negative test? | Regression test? | Structural test? | Concurrent test? |
| --------- | ---------- | -------------: | ---------------: | ---------------: | ---------------: |
| INV-001 (deadline non-null) | deadline-scanner.test.ts, grading.test.ts | YES | YES | NO | PARTIAL |
| INV-002 (workset once) | gradingArchitecture.structural.test.ts, candidate-save-submit.test.ts | YES | YES | **YES** | NO |
| INV-003 (aggregator sole) | gradingArchitecture.structural.test.ts, gradingAggregation.test.ts | NO | YES | **YES** | NO |
| INV-004 (answers frozen) | candidate-save-submit.test.ts | YES | YES | NO | NO |
| INV-005 (FSM) | attemptStateMachine tests | YES | YES | NO | NO |
| INV-006 (pending-only) | manualGradingClosure.test.ts, gradingQueue.test.ts | YES | YES | NO | NO |
| INV-007 (lock order) | lock-order.structural.test.ts, gradingConcurrency.test.ts | YES | YES | **YES** | **YES** |
| INV-008 (clock auth) | time-authority.structural.test.ts | YES | YES | **YES** | NO |
| INV-019 (LEA identity) | lockSeam.test.ts (compile test), lock-order.structural.test.ts | YES | YES | **YES** | NO |
| INV-020 (gradingResult non-input) | gradingArchitecture.structural.test.ts, gradingAggregation.test.ts, gradingPoison.test.ts | **YES** (poison test) | YES | **YES** | NO |
| INV-021 (enum parity) | (none) | NO | NO | NO | NO |
| INV-022 (AppError-only) | (none) | NO | NO | NO | NO |
| INV-029/030 (DB constraints) | (tested implicitly via INTEGRATION tests that violate constraints) | YES | YES | NO | NO |

### Would a new violating implementation make an existing test fail?

| Invariant | Probability | Rationale |
| --------- | ----------- | --------- |
| INV-002 (workset once) | HIGH_PROBABILITY | structural test explicitly locks single caller |
| INV-003 (aggregator sole) | HIGH_PROBABILITY | structural test explicitly locks caller file set |
| INV-007 (lock order) | HIGH_PROBABILITY | structural test + Idempotency tests cover all 7 entry points |
| INV-008 (clock auth) | HIGH_PROBABILITY | structural test scans all business files for wall-clock reads |
| INV-019 (LEA identity) | HIGH_PROBABILITY | compile test + structural test + arch lint |
| INV-020 (gradingResult non-input) | HIGH_PROBABILITY | structural test locks aggregator body field access |
| INV-025 (deadline authority) | HIGH_PROBABILITY | structural test locks canonical function |
| INV-001 (deadline non-null) | PARTIAL | deadline scanner tests exercise the canonical path but don't prevent a new write path |
| INV-005 (FSM) | PARTIAL | no structural lock on status mutation; only integration tests exercise the happy path |
| INV-006 (pending-only) | PARTIAL | manual grading tests cover the runtime guard but a bypass would not be detected |
| INV-021 (enum parity) | LOW_PROBABILITY | no parity test at all |
| INV-022 (AppError-only) | LOW_PROBABILITY | no rule or test catches plain Errors |
| INV-023/024 (exclusive writer) | PARTIAL | structural test locks enrollment projection; but NOT attempt projection |

---

## 12. Formal Artifact Reality Check

| Artifact | Type | Executable model? | Model checked? | Production refinement map? |
| -------- | ---- | ----------------: | -------------: | -------------------------: |
| docs/SPEC.md | Specification document | NO | NO | NO |
| docs/phase-roadmap.md | Roadmap document | NO | NO | NO |
| docs/audit/exam-architecture-reconstruction.md | Architecture reconstruction | NO | NO | NO |
| docs/audit/protocol-semantic-boundary-review.md | Semantic boundary audit | NO | NO | NO |
| docs/audit/static-capability-audit.md | Static capability inventory | NO | NO | NO |
| docs/audit/EXAM-STATIC-CAPABILITY-0.md | Static analysis tool inventory | NO | NO | NO |

```
EXECUTABLE_FORMAL_MODEL_FOUND = NO
FORMAL_AUDIT_AND_TOPOLOGY_ARTIFACTS_FOUND = YES (4 audit reports, SPEC.md, phase-roadmap.md)
MODEL_CHECKED_PROTOCOL_INVARIANTS = 0
```

No TLA+, PlusCal, Alloy, Promela, F*, or refinement map exists anywhere in the repository. The prior audit correctly identified this. The structural tests and architecture scripts are source-text scanners, not formal models.

---

## 13. Reaudit Historical Defect Taxonomy

Reconstructed from git history (26 commits) and prior audit defect taxonomy.

| Defect class | Compile today? | Arch reject | Static reject | DB reject | Runtime reject | Tests | Formal |
| ------------ | -------------: | ----------: | ------------: | --------: | -------------: | ----- | ------ |
| #1 deadlineAt reachability vs NULL recovery | YES | NO | NO | NO | PARTIAL (defensive fallback) | PARTIAL | NO |
| #2 active-attempt deadline semantics divergence | YES | NO | NO | NO | Runtime (via canonical function) | PARTIAL | NO |
| #3 attempt status direct mutation | YES | NO | NO | NO | ONLY via engine commands that call FSM | PARTIAL | NO |
| #4 state transition bypass (pending_manual skipped) | YES | NO | NO | NO | YES (finalizeGrading rejects) | YES | NO |
| #5 gradingResult as scoring source | YES | NO | NO | NO | NO (aggregator body avoids it) | YES (structural+poison) | NO |
| #6 single workset authority | YES | PARTIAL (gradingArch structural test) | NO | NO | NO | YES | NO |
| #7 manual grading re-entry | YES | NO | NO | PARTIAL (CHECK accepts completed_manual) | YES (gradeQuestion guard) | YES | NO |
| #8 terminal grading mutation ownership (enrollment projection) | YES | PARTIAL (gradingArch structural test) | NO | NO | NO | YES | NO |
| #9 grading aggregation seam | YES | PARTIAL (gradingArch structural test) | NO | NO | NO | YES | NO |
| #10 deadline scanner divergence | YES | NO | NO | NO | PARTIAL (must recheck via canonical) | PARTIAL | NO |
| #11 force-submit audit | YES | NO | NO | NO | NO | YES | NO |
| #12 resume/restore asymmetry | YES | NO | NO | NO | NO | NO (DOCUMENTED_RISK) | NO |
| #13 state-machine drift (FSM table) | YES | NO | NO | NO | Runtime (FSM assertions in commands) | PARTIAL | NO |
| #14 contract/impl enum drift | YES | NO | NO | NO | NO | NO (no parity test) | NO |
| #15 dist staleness | YES | NO | NO | NO | NO | PARTIAL (CI script) | NO |
| #16 clock authority / wall-clock bypass | YES | NO | NO | NO | NO (answerProtocol has fallback) | YES (structural test) | NO |
| #17 lock order | YES | PARTIAL (arch lint cast ban) | NO | NO | YES (assertCapabilityFor) | YES (structural+concurrency) | NO |
| #18 error-code drift (plain Error) | YES | NO | NO | NO | NO (normalizeErrorCode fallback) | NO | NO |

### Classification

| Defect class | Verdict |
| ------------ | ------- |
| #1 deadlineAt reachability | STILL_REPRODUCIBLE_CLASS — no structural test locks deadlineAt write; CANONICAL_CODE=CORRECT |
| #2 active deadline semantics divergence | CURRENTLY_CONVERGED — single canonical function exists; scanner must recheck |
| #3 status direct mutation | STILL_REPRODUCIBLE_CLASS — `attemptRepo.update({status})` compiles; no structural lock |
| #4 transition bypass | RUNTIME_REJECTED — finalizeGrading throws on pending_manual |
| #5 gradingResult as scoring | STRUCTURALLY_REJECTED (aggregator body scan) + TEST_DETECTED (poison test) |
| #6 workset authority | STRUCTURALLY_REJECTED (single caller lock) |
| #7 manual re-entry | RUNTIME_REJECTED (gradeQuestion guard) |
| #8 enrollment projection ownership | STRUCTURALLY_REJECTED (writer-inventory lock) |
| #9 aggregation seam | STRUCTURALLY_REJECTED (caller file lock) |
| #10 deadline scanner divergence | RUNTIME_REJECTED (scanner must recheck via canonical function) |
| #11 force-submit audit | CURRENTLY_CONVERGED — tests cover idempotency path |
| #12 restore/extend asymmetry | STILL_REPRODUCIBLE_CLASS — documented spec divergence, no test or guard |
| #13 FSM drift | STILL_REPRODUCIBLE_CLASS — FSM table exists but a new command could side-step it |
| #14 enum drift | STILL_REPRODUCIBLE_CLASS — no parity test; adding a value requires 6+ manual edits |
| #15 dist staleness | STILL_REPRODUCIBLE_CLASS — CI script only, no structural guard |
| #16 clock authority | STRUCTURALLY_REJECTED (time-authority structural test) |
| #17 lock order | STRUCTURALLY_REJECTED (lock-order test) + RUNTIME_REJECTED (assertCapabilityFor) |
| #18 error-code drift | STILL_REPRODUCIBLE_CLASS — 22 plain Errors currently in engine; no rule catches more |

---

## 14. Enforcement Matrix

| ID | Invariant | Currently true | Canonical seam | Type | DB | Arch lint | Static analysis | Runtime | Tests | Formal | Convention |
| -- | --------- | -------------: | -------------: | ---- | -- | --------- | --------------- | ------- | ----- | ------ | ---------- |
| INV-001 | active attempt deadline non-null | YES | YES | NO | NO | NO | NO | PARTIAL | PARTIAL | NO | YES |
| INV-002 | workset materialized once | YES | YES | NO | NO | YES | NO | NO | YES | NO | NO |
| INV-003 | entries exclusive scoring input | YES | YES | NO | NO | YES | NO | NO | YES | NO | NO |
| INV-004 | submittedAnswers frozen | YES | YES | NO | NO | NO | NO | NO | PARTIAL | NO | YES |
| INV-005 | attempt FSM transitions | YES | YES | NO | NO | NO | NO | PARTIAL | PARTIAL | NO | YES |
| INV-006 | pending-only manual grading | YES | YES | NO | PARTIAL | NO | NO | YES | YES | NO | NO |
| INV-007 | EA lock order | YES | YES | NO | NO | YES | NO | YES | YES | NO | NO |
| INV-008 | server clock authority | YES | YES | NO | NO | NO | NO | NO | YES | NO | NO |
| INV-009 | workset terminal before aggregation | YES | YES | NO | NO | NO | NO | YES | PARTIAL | NO | NO |
| INV-010 | questionSnapshot frozen | YES | YES | NO | NO | NO | NO | NO | PARTIAL | NO | YES |
| INV-011 | enrollment projection via scoreStrategy | YES | YES | NO | NO | YES | NO | NO | YES | NO | NO |
| INV-012 | answer save versioned/idempotent | YES | YES | NO | NO | NO | NO | PARTIAL | YES | NO | NO |
| INV-013 | routes use repos (no bare db) | YES | N/A | NO | NO | YES | NO | N/A | NO | NO | NO |
| INV-014 | domain leaf | YES | N/A | NO | NO | YES | NO | N/A | NO | NO | NO |
| INV-015 | contracts no fastify | YES | N/A | NO | NO | YES | NO | N/A | NO | NO | NO |
| INV-016 | engine no fastify | YES | N/A | NO | NO | YES | NO | N/A | NO | NO | NO |
| INV-017 | web no @exam/db | YES | N/A | NO | NO | YES | NO | N/A | NO | NO | NO |
| INV-018 | authz leaf | YES | N/A | NO | NO | YES | NO | N/A | NO | NO | NO |
| INV-019 | LEA identity unforgeable | YES | YES | YES | NO | YES | NO | YES | YES | NO | NO |
| INV-020 | gradingResult not scoring input | YES | YES | NO | NO | NO | NO | NO | YES | NO | NO |
| INV-021 | enum parity (domain=contracts) | YES | NO | NO | NO | NO | NO | NO | NO | NO | YES |
| INV-022 | AppError-only throws in engine | **NO** (VIOLATED) | NO | NO | NO | NO | NO | NO | NO | NO | YES |
| INV-023 | attempt score/passed exclusive writer | YES | YES | NO | NO | NO | NO | NO | PARTIAL | NO | YES |
| INV-024 | enrollment projection exclusive writer | YES | YES | NO | NO | YES | NO | NO | YES | NO | NO |
| INV-025 | deadline authority | YES | YES | NO | NO | NO | NO | PARTIAL | YES | NO | NO |
| INV-026 | exam FSM | YES | YES | NO | NO | NO | NO | PARTIAL | PARTIAL | NO | YES |
| INV-027 | enrollment FSM | YES | YES | NO | NO | NO | NO | PARTIAL | PARTIAL | NO | YES |
| INV-028 | heartbeat writes only lastActivityAt | YES | YES | NO | NO | NO | NO | NO | NO | NO | YES |
| INV-029 | earnedScore <= maxScore | YES | N/A | NO | YES | NO | NO | N/A | YES | NO | NO |
| INV-030 | (attempt_id, question_id) unique | YES | N/A | NO | YES | NO | NO | N/A | YES | NO | NO |

---

## 15. Enforcement Strength

| Invariant | Primary level | Secondary protections | Why not one level higher? |
| --------- | ------------- | --------------------- | ------------------------- |
| INV-001 | L0_CONVENTION | L2_RUNTIME (defensive fallback in computeEffectiveDeadline) | No arch/static rule prevents writing null deadlineAt directly; no DB CHECK |
| INV-002 | L3_STRUCTURALLY_REJECTED | L1_TEST_OBSERVED | gradingArchitecture structural test locks single caller; no type/DB guard on workset writes |
| INV-003 | L3_STRUCTURALLY_REJECTED | L1_TEST_OBSERVED | gradingArchitecture structural test locks caller file + field set; new scorer still compiles |
| INV-004 | L0_CONVENTION | L1_TEST_OBSERVED | No structural test locks submittedAnswers writes; only test coverage |
| INV-005 | L1_TEST_OBSERVED | L2_RUNTIME (FSM in commands) | No arch/static rule prevents `attemptRepo.update({status})`; FSM assertions exist only in engine commands |
| INV-006 | L2_RUNTIME_REJECTED | L1_TEST_OBSERVED | gradeQuestion runtime guard + repo pending-guard; no type prevents re-entry |
| INV-007 | L3_STRUCTURALLY_REJECTED | L2_RUNTIME (assertCapabilityFor) + L1_TEST | lock-order structural test locks 7 entry points; concurrency tests exist |
| INV-008 | L3_STRUCTURALLY_REJECTED | L1_TEST_OBSERVED | time-authority structural test scans all business files; allowlist with liveness check |
| INV-009 | L2_RUNTIME_REJECTED | — | aggregateGradingEntries throws on non-terminal entries; no structural guard on the precondition |
| INV-010 | L0_CONVENTION | L1_TEST_OBSERVED | No lock on questionSnapshot writes |
| INV-011 | L3_STRUCTURALLY_REJECTED | L1_TEST_OBSERVED | gradingArchitecture locks enrollment projection writer-inventory |
| INV-012 | L1_TEST_OBSERVED | L0_CONVENTION | processSaveAnswer is pure; the recomended composite doesn't exist |
| INV-013 | L3_STRUCTURALLY_REJECTED | — | arch lint regex catches `db.select(` in routes; bypassable with aliases |
| INV-014 | L3_STRUCTURALLY_REJECTED | — | arch lint regex; domain has near-zero imports |
| INV-015 | L3_STRUCTURALLY_REJECTED | — | arch lint regex |
| INV-016 | L3_STRUCTURALLY_REJECTED | — | arch lint regex |
| INV-017 | L3_STRUCTURALLY_REJECTED | — | arch lint regex |
| INV-018 | L3_STRUCTURALLY_REJECTED | — | arch lint regex |
| INV-019 | L4_TYPE_OR_DB_REJECTED | L3_STRUCTURALLY (arch lint cast ban) + L2_RUNTIME (assertCapabilityFor) | unique symbol brand + arch lint + compile test — genuinely type-enforced |
| INV-020 | L1_TEST_OBSERVED | L0_CONVENTION (documentation in aggregator) | aggregator body avoids gradingResult by DOCUMENTED convention; no type/arch prevents reading it |
| INV-021 | L0_CONVENTION | — | No test, no type, no arch guard; parity relies on contributor knowledge |
| INV-022 | L0_CONVENTION | — | **CURRENTLY VIOLATED**; no rule catches throw new Error; convention says "use AppError" |
| INV-023 | L0_CONVENTION | L1_TEST_OBSERVED | gradingArchitecture locks enrollment projection but NOT attempt score/passed/gradingResult |
| INV-024 | L3_STRUCTURALLY_REJECTED | L1_TEST_OBSERVED | gradingArchitecture locks enrollment projection writer-inventory |
| INV-025 | L1_TEST_OBSERVED | L3_PARTIAL (deadline-authority structural test) | Structural test detects `closeAt <= now` patterns but not arbitrary inlined re-derivations |
| INV-026 | L1_TEST_OBSERVED | L2_RUNTIME (assertExamTransition) | FSM exists but command caller could skip assertion |
| INV-027 | L1_TEST_OBSERVED | L2_RUNTIME (assertEnrollmentTransition) | Same as INV-026 |
| INV-028 | L0_CONVENTION | — | Heartbeat route is intentionally direct; no guard prevents writing other fields |
| INV-029 | L4_TYPE_OR_DB_REJECTED | — | PostgreSQL CHECK constraint |
| INV-030 | L4_TYPE_OR_DB_REJECTED | — | PostgreSQL UNIQUE constraint |

---

## 16. Machine Rejection Coverage Recalculation

### 16.1 Invariant Coverage

```
MECHANICALLY_REJECTED_INVARIANTS =
count(primary level >= L3)
/
total invariants

L3+ invariants: INV-002, INV-003, INV-007, INV-008, INV-011, INV-013, INV-014, INV-015, INV-016, INV-017, INV-018, INV-019, INV-024, INV-029, INV-030
= 15

MECHANICALLY_REJECTED_INVARIANTS = 15 / 30 = 50.0%
```

### 16.2 Historical Defect-Class Coverage

```
MECHANICALLY_REJECTED_DEFECT_CLASSES = 
historical defect classes classified MECHANICALLY_REJECTED
/
total historical defect classes

MECHANICALLY_REJECTED: #5 (gradingResult), #6 (workset), #8 (enrollment projection), #9 (aggregation), #16 (clock), #17 (lock order)
= 6

RUNTIME_REJECTED: #4, #7, #10
= 3

STRUCTURALLY_REJECTED (subset of mechanical): #5, #6, #8, #9, #16, #17
= 6

MECHANICALLY_REJECTED_DEFECT_CLASSES = 6 / 18 = 33.3%
```

### Comparison with Previous Claims

| Previous metric/claim | Previous value | Recomputed value | Verdict | Root cause of discrepancy |
| --------------------- | -------------: | ---------------: | ------- | ------------------------- |
| ALREADY_MACHINE_REJECTED | 9/18 (50%) | 6/18 (33.3%) | **OVERSTATED** | Prior audit counted runtime guards, test coverage, and structural tests as "machine rejected". Strict definition (MACHINE_REJECTED = reject before normal execution) excludes runtime guards and tests. Only arch lint, DB constraints, and type system count. #4, #7, #10 are runtime-rejected but not machine-rejected. |
| "better protected than tool inventory suggests" | Claimed strength | PARTIALLY CONFIRMED | **PARTIALLY_CONFIRMED** | The 4 structural tests are genuine protection for 5 defect classes (#5, #6, #8, #9, #17), but they are source-text scanners, not formal proofs. They do not prevent bypass — they detect divergence in known patterns. |
| "65%"/"78%" | Unclear source | 33.3%/50% | **NOT_COMPARABLE** | No 65%/78% claim found in the three source audits. These percentages may originate from a different document or were hallucinated in this review's prompt. |

---

## 17. Identified Enforcement Gaps

| Gap ID | Invariant/defect class | Current strength | Reintroduction path | Blast radius | Priority |
| ------ | ---------------------- | ---------------- | ------------------- | ------------ | -------- |
| GAP-01 | INV-022 (22 plain Errors in engine) | L0_CONVENTION (VIOLATED) | `throw new Error(...)` in engine already exists; new violations undetected | Medium (error code drift, 500 errors) | **P0** |
| GAP-02 | INV-021 (enum parity) | L0_CONVENTION | Adding QuestionType value requires 6+ hand edits; CI misses drift | High (semantic shotgun surgery, already fired) | **P0** |
| GAP-03 | INV-020 (gradingResult as scoring input) | L1_TEST_OBSERVED | New scorer reading `attempt.gradingResult` compiles | High (incorrect grades if stale data read) | **P0** |
| GAP-04 | INV-023 (attempt score/passed write outside canonical seam) | L0_CONVENTION | `attemptRepo.update(..., {score:..., passed:...})` compiles | High (wrong scores, stale projections) | **P0** |
| GAP-05 | INV-005 (FSM bypass via direct status mutation) | L1_TEST_OBSERVED | `attemptRepo.update(..., {status:"graded"})` compiles; no arch guard | High (state machine inconsistency) | **P0** |
| GAP-06 | INV-001 (deadlineAt null writes on active attempt) | L0_CONVENTION | `attemptRepo.update(..., {deadlineAt: null})` compiles | Medium (deadline bypass, null recovery) | **P1** |
| GAP-07 | INV-004 (submittedAnswers direct mutation) | L0_CONVENTION | `attemptRepo.update(..., {submittedAnswers: newSnapshot})` compiles | High (violates freeze invariant) | **P1** |
| GAP-08 | INV-026/027 (exam/enrollment FSM bypass) | L1_TEST | `examRepo.update(..., {status:"open"})` without FSM compiles | Medium (status inconsistency) | **P1** |
| GAP-09 | INV-012 (answer persist outside engine) | L1_TEST | Direct `attemptRepo.update(..., {answers: ...})` compiles; arch convention only | Medium (answer protocol bypass) | **P2** |
| GAP-10 | INV-028 (heartbeat writing arbitrary fields) | L0_CONVENTION | Heartbeat route could write `status` or other fields | Low (heartbeat path not used for protocol writes) | **P2** |
| GAP-11 | #12 restore/extend asymmetry | L0_CONVENTION | New restore path could diverge from documented semantics | Low (documented behavior) | **P2** |
| GAP-12 | #15 dist staleness | L0_CONVENTION | CI script line only; no structural guard | Low (build ordering issue) | **P2** |

---

## 18. Invariants That Should NOT Be Forced Into Static Enforcement

| Invariant | Why runtime enforcement is natural |
| --------- | --------------------------------- |
| INV-001 (deadline expiry) | `now >= effectiveDeadline` is inherently a runtime computation; server clock + current state + exam params combine dynamically. A DB CHECK cannot express this; a type can't either. The canonical function + runtime reconciliation is correct. |
| INV-011 (enrollment selection by scoreStrategy) | `shouldSelectAttempt` evaluates `scoreStrategy` against current enrollment state to decide whether to select. This is a runtime policy decision that depends on enrollment history. Forcing it into static/type enforcement would require encoding score strategies into types, causing state explosion. |
| INV-009 (workset terminal before aggregation) | The predicate "are all entries terminal?" depends on the actual count and status of grading entries at aggregation time. This is inherently dynamic. The runtime check inside `aggregateGradingEntries` is correct. |
| INV-012 (answer save protocol) | Version/idempotency conflict detection requires runtime comparison of `baseVersion` vs `currentVersion` and `clientSeqHistory` entries. This is a algorithmic protocol check, not a type or DB constraint. |
| INV-029/030 (grading entry constraints) | Already enforced at DB level (CHECK + UNIQUE). Moving them to type level would duplicate what PostgreSQL already does correctly. |

---

## 19. Highest-Leverage Mechanization Candidates

| Gap | Best mechanism candidate | Why | Expected defect class blocked | False-positive risk |
| --- | ------------------------ | --- | ----------------------------- | ------------------- |
| GAP-01 (22 plain Errors) | **SEMGREP** or typescript-eslint custom rule | Clean syntactic match: `throw new Error` in engine; clear allowlist for test/seed files | #18 (error-code drift) | LOW — `throw new Error` pattern is unambiguous |
| GAP-02 (enum parity) | **GENERATED_VOCABULARY** (derive Zod enums from domain as-const) | Contracts already has @exam/domain in package.json; using `z.enum(Object.values(DomainEnum))` once in contracts would eliminate all manual mirrors; a parity test is a cheap fallback | #14 (semantic shotgun surgery when adding QuestionType) | LOW — derivation would be exact |
| GAP-03 (gradingResult as input) | **SEMGREP** (scope: scoring functions must not read `attempt.gradingResult`) | Pattern: `.gradingResult` access inside functions that compute scores | #5 (gradingResult-as-input return) | LOW — scope to aggregator-like function files |
| GAP-04 (attempt score write outside seam) | **ARCH_LINT** (writer-inventory for attempt score/passed/gradingResult) | Extend gradingArchitecture structural test to lock attempt projection writes (similar to enrollment projection lock) | #8 (terminal grading mutation bypass on attempt) | LOW — structural test already exists for enrollment; same pattern for attempt |
| GAP-05 (FSM bypass) | **DB_CONSTRAINT** (CHECK on attempt.status IN domain values) | Adding CHECK constraint matching domain AttemptStatus would at least prevent arbitrary string values | #3 (status mutation to illegal values) | LOW — CHECK matches domain values |
| GAP-07 (submittedAnswers freeze) | **ARCH_LINT** or SEMGREP | Lock submittedAnswers writes to submitAttempt only; structural test already locks materialize but not submittedAnswers | #4 freeze bypass | LOW |
| GAP-06 (deadline null) | **DB_CONSTRAINT** (partial CHECK: when status IN active → deadlineAt NOT NULL) | Partial index or CHECK expressing the protocol invariant | #1 deadline null bypass | **MEDIUM** — must handle disrupted/restore edge cases; careful design needed |
| GAP-02 (alternative) | **PARITY_TEST** (contracts vitest test comparing Zod enum options to domain values) | Simple: `expect(z.enum.options).toEqual(Object.values(domain.Enum))` | #14 drift detection (not prevention) | LOW — test only, no production risk |

---

## 20. Final Verdict

```
CURRENT_PRODUCTION_INVARIANTS_COHERENT = PARTIAL
  (INV-022 is VIOLATED — 22 plain Error throws in gradingWorkset.ts;
   all other invariants hold in current production code)

PREVIOUS_MACHINE_REJECTION_CLAIMS_ACCURATE = PARTIAL
  (Prior claim of 50% machine-rejected is overstated.
   With strict MACHINE_REJECTED = YES only for L3+,
   the true rates are 33.3% defect classes, 50% invariants.
   The structural tests are genuine but limited —
   they detect, they do not prevent.)

MECHANICALLY_REJECTED_INVARIANTS = 15/30 (50.0%)

MECHANICALLY_REJECTED_HISTORICAL_DEFECT_CLASSES = 6/18 (33.3%)

CANONICAL_SEAMS_EXIST = YES
  (submitAttempt, aggregateGradingEntries, finalizeTerminalGrading,
   gradeQuestion, lockEnrollmentAndAttempt, isAttemptDeadlineExpired,
   processSaveAnswer — all present and converged)

CANONICAL_SEAMS_ARE_MECHANICALLY_SEALED = NO
  (Every seam can be bypassed by type-correct code.
   The most sealed is aggregateGradingEntries (caller file locked)
   and lockEnrollmentAndAttempt (entry-point count locked).
   But none are truly prevented at type/DB/arch level.)

TYPE_SYSTEM_PROTOCOL_ENFORCEMENT = LOW
  (Only LEA identity is genuinely type-enforced.
   All protocol state fields are plain unions that accept any value.
   FSM transitions, grading entry status, score writes — all bypassable.)

DB_PROTOCOL_ENFORCEMENT = LOW
  (Only grading_entries.status/mode have CHECK constraints.
   All exam, enrollment, attempt, question status/policy columns
   are unconstrained text. Most cross-row invariants have no DB guard.)

ARCHITECTURE_GUARD_ENFORCEMENT = MEDIUM
  (Arch lint provides real protection for 6 invariants (INV-013–018),
   plus LEA cast ban. But all guards are TEXTUAL_NARROW regex,
   bypassable with aliasing, bracket notation, or test-like filenames.)

STATIC_ANALYSIS_PROTOCOL_ENFORCEMENT = LOW
  (No ESLint config exists. No Semgrep rules exist.
   typescript-eslint is installed but never invoked.
   The only effective protection is the bespoke structural tests —
   which detect divergence but do not prevent it.)

RUNTIME_PROTOCOL_ENFORCEMENT = MEDIUM
  (Strong for: lock order (assertCapabilityFor), grading entry state
   (pending_manual guard), FSM (assertTransition in commands),
   terminality (aggregateGradingEntries validates).
   Weak for: deadline state, submittedAnswers, score writes —
   once past the seam, no runtime check catches misuse.)

TEST_PROTOCOL_COVERAGE = MEDIUM
  (Strong for: grading architecture, lock order, clock authority.
   Weak for: enum parity, error codes, deadlineAt null on active attempts,
   direct score writes outside canonical seam.
   4 structural tests provide the strongest test-level coverage.)

EXECUTABLE_FORMAL_MODEL_FOUND = NO

FORMAL_AUDIT_AND_TOPOLOGY_ARTIFACTS_FOUND = YES
  (4 audit reports + SPEC.md + phase-roadmap.md)

STATIC_ENFORCEMENT_PROGRAM_REQUIRED = YES
  (Zero ESLint/Semgrep rules exist.
   The only protocol-invariant guards are the 4 structural tests,
   which are source-text scanners — not a program.)

TARGETED_MECHANIZATION_REQUIRED = YES
  (See §19: 5 high-leverage mechanization candidates identified)
```

### TOP_5_INVARIANTS_ALREADY_STRONGLY_ENFORCED

1. **INV-019 (LEA identity unforgeable)** — Type-enforced (unique symbol brand), arch lint (cast ban), structural test (no export alias), compile test (`@ts-expect-error` confirms). **L4.**
2. **INV-029 (earnedScore <= maxScore)** — PostgreSQL CHECK constraint. **L4.**
3. **INV-030 ((attempt_id, question_id) unique)** — PostgreSQL UNIQUE constraint. **L4.**
4. **INV-007 (EA lock order)** — structural test locks 7 entry points + runtime assertCapabilityFor + concurrency tests. **L3 + L2.**
5. **INV-008 (server clock authority)** — structural test scans all business files with liveness-checked allowlist. **L3.**

### TOP_5_CANONICAL_SEAMS_THAT_ARE_NOT_MECHANICALLY_SEALED

1. **submitAttempt** — can bypass by writing `status`, `submittedAnswers`, `submissionReason`, `gradingStatus` directly via `attemptRepo.update(...)`. No type/DB guard. Only gradingArchitectural structural test locks `materializeGradingWorkset` caller.
2. **finalizeTerminalGrading** — can bypass by writing `score`, `passed`, `gradingResult` directly. Structural test locks enrollment projection only; attempt projection is unprotected.
3. **gradeQuestion (engine)** — can bypass by writing `gradingWorksetRepo.updateEntry({status: "completed_manual"})` directly. Only runtime guard on pending status.
4. **processSaveAnswer** — is a pure decision core (not a composite action). The persist step lives in the route. The engine could own the full save action.
5. **isAttemptDeadlineExpired** — can bypass by inlining `deadlineAt <= now` in a new function. Structural test detects `closeAt <= now` patterns but not arbitrary re-derivations.

### TOP_5_HISTORICAL_DEFECT_CLASSES_STILL_REINTRODUCIBLE

1. **#1 (deadlineAt reachability vs NULL recovery)** — no structural test locks deadlineAt writes; a contributor can set `deadlineAt: null` on an active attempt with compiling code.
2. **#3 (status direct mutation)** — `attemptRepo.update({status: "graded"})` compiles; no structural test locks status writes; FSM assertions exist only in engine commands.
3. **#14 (contract/impl enum drift)** — adding a value to a domain enum requires 6+ hand edits in contracts; no test catches a missed site. Already fired once (`91f36a7`).
4. **#5 (gradingResult-as-input)** — aggregator body correctly avoids reading gradingResult, but a NEW scoring function elsewhere could read `attempt.gradingResult` with zero type errors. No structural test locks all scoring functions.
5. **#18 (error-code drift)** — 22 `throw new Error` already exist in gradingWorkset.ts; a contributor adding more plain Error throws would violate INV-022 with no detection.

### TOP_5_HIGHEST_LEVERAGE_MECHANIZATION_TARGETS

1. **Close INV-022** — add Semgrep/ESLint rule banning `throw new Error` in exam-engine. Blocks defect class #18. Lowest FP risk (clean syntactic match). **Expected: SEMGREP.**
2. **Close INV-021** — derive contracts Zod enums from domain `as const` objects (or add a parity test). Eliminates 6+ site hand-edits for adding a value. Blocks defect class #14 shotgun surgery. **Expected: GENERATED_VOCABULARY or PARITY_TEST.**
3. **Close INV-020** — add structural test or Semgrep rule locking all scoring functions against reading `attempt.gradingResult`. Protects #5 from returning in new code. **Expected: SEMGREP (scope: scoring context).**
4. **Close INV-023** — extend gradingArchitecture structural test to lock attempt score/passed/gradingResult writer-inventory (currently only enrollment projection is locked). Protects #8 for attempt projection. **Expected: ARCH_LINT (structural test extension).**
5. **Close INV-005** — add DB CHECK constraint on `attempt.status` matching domain values. This prevents arbitrary string values even if bypassable by route-level code. Combined with structural test, provides defense in depth. **Expected: DB_CONSTRAINT.**

### TOP_5_INVARIANTS_THAT_SHOULD_REMAIN_RUNTIME_ENFORCED

1. **INV-009 (workset terminal before aggregation)** — inherently dynamic predicate.
2. **INV-001 (deadline expiry)** — inherently time-dependent runtime decision.
3. **INV-011 (enrollment selection by scoreStrategy)** — policy decision depending on enrollment history and score strategy.
4. **INV-012 (answer save idempotency)** — algorithmic protocol requiring version comparison.
5. **INV-006 (pending-only manual grading)** — current runtime guard is correct; a type-level guard would not add significant value over the existing runtime check.

---

## 21. Summary for AI Agent Modification Risk

> If an AI coding agent starts modifying this repository tomorrow, which five old mistake classes can the repository itself actually stop, and which five still depend on the agent understanding the architecture?

### Five the Repository Can Stop Mechanically

1. **#16 (clock authority bypass)** — `time-authority.structural.test.ts` will fail if the agent writes `new Date()` or `Date.now()` in a business-path file outside the allowlist.
2. **#17 (lock order violation)** — `lock-order.structural.test.ts` will fail if the agent adds a 8th EA entry point without calling `lockEnrollmentAndAttempt` or if it uses an `as LockedEnrollmentAttemptIdentity` cast.
3. **#6 (workset authority split)** — `gradingArchitecture.structural.test.ts` will fail if the agent calls `materializeGradingWorkset` from any file other than `submitAttempt`'s file.
4. **#9 (aggregation seam split)** — same structural test will fail if `aggregateGradingEntries` is called from any file other than `grading.ts`.
5. **#5 (gradingResult-as-input defect)** — the aggregate body scan and poison test will catch this defect if introduced inside the aggregator. However, a NEW scoring function outside the aggregator is NOT caught.

### Five That Still Depend on Agent Understanding

1. **#1 (deadlineAt reachability)** — the agent must understand that `in_progress` attempts must have non-null `deadlineAt`. The repository has no structural/DB guard. A null-deadline write compiles cleanly.
2. **#14 (enum mirror drift)** — the agent must understand that adding a value to a domain `QuestionType` requires editing 6+ `z.enum([...])` literals in contracts. No test catches a missed site.
3. **#3 (status direct mutation)** — the agent must understand to use `submitAttempt` or `finalizeTerminalGrading` instead of writing `status: "graded"` directly. Neither type system nor arch lint catches a direct write.
4. **#5 (gradingResult-as-input new function)** — while the aggregator body is locked, an agent creating an entirely new scoring function elsewhere would need to know not to read `attempt.gradingResult` as input. No mechanical guard covers new scoring contexts.
5. **#18 (error-code drift)** — the agent must understand to use `AppError` subclasses, not `throw new Error(...)`. There are already 22 violations in the engine. No rule prevents adding more.

---

*End of EXAM-INVARIANT-ENFORCEMENT-REVIEW-0. READ-ONLY; one report file created; no commit.*
