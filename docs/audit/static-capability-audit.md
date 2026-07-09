# EXAM-STATIC-CAPABILITY-0 — Protocol Invariant Static Enforcement Audit

**Date:** 2026-07-09
**HEAD:** `553add52f67d7cdb3943632a352cdb1d2fbdde38`
**Branch:** `master`
**Mode:** READ-ONLY (HR-1: no production/test/schema/CI/lint/Semgrep-rule/CodeQL-query/doc edits; no commit). Temporary scan artifacts written only to `/tmp`.

---

# A. Verdict

```
EXAM-STATIC-CAPABILITY-0: PASS
```

The audit **completed** through all phases. "PASS" means the audit ran to completion and produced the Invariant Compilation Matrix — it does **not** mean EXAM is defect-free. The central, perhaps counterintuitive, finding is stated up front because it shapes every section below:

> **The EXAM repo enforces its protocol invariants with a bespoke source-text structural-test framework (`apps/api/src/runtime/*.structural.test.ts`) rather than with ESLint or Semgrep.** It has *no ESLint config at all* and runs *no Semgrep in CI*. The four structural tests use function-body extraction, writer-inventory allowlists, comment-stripping, and positive field-set locks to enforce invariants that are *richer than what Semgrep can express* and *more project-specific than any typed-ESLint rule*. The result: the repo is **better protected than its tool inventory suggests**, but the protection is **hand-rolled and self-administered** — it discovers nothing it was not explicitly told to look for, and it has one confirmed internal inconsistency (22 `throw new Error` in exam-engine) that no rule currently catches.

---

# B. Skill Invocation Evidence

Per the Skill Invocation Protocol (and this environment's own rule: *"Only invoke a skill that appears in the available-skills list… Never guess or invent a skill name"*), every required skill was checked for **runtime** availability, not just disk presence.

The 7 referenced skills exist as `SKILL.md` files at `/home/hoo/.config/skillshare/skills/` but are **NOT in the runtime available-skills list** (the system-reminder enumerates ~75 skills; none of the 7 below appear). The Skill tool cannot load unregistered skills. Therefore they were **not invoked**; their `SKILL.md` files were **read as methodology documents** (allowed — they are on-disk docs) and their workflows applied manually.

| Skill | Invocation method | Status | Result actually used | Blocker |
| ----- | ----------------- | ------ | -------------------- | ------- |
| `audit-context-building` | Skill tool (attempted) | **NOT_AVAILABLE** | Methodology read from SKILL.md; line-by-line / writer-reader / seam analysis applied manually in Phases 1-3 | Not in runtime available-skills list |
| `static-analysis` | Skill tool (attempted) | **NOT_AVAILABLE** | Methodology applied manually: inventories TS/ESLint/Semgrep/CodeQL; ran advisory Semgrep scan (`/tmp/semgrep-engine.json`) | Not registered as invocable skill |
| `sharp-edges` | Skill tool (attempted) | **NOT_AVAILABLE** | 4-phase methodology (Surface/Edge/Threat/Validate) applied manually in Phase 9 to protocol-mutation APIs | Not registered as invocable skill |
| `differential-review` | Skill tool (attempted) | **NOT_AVAILABLE** | Risk-first diff methodology applied manually to 3 corrective commits in Phase 10 | Not registered as invocable skill |
| `fp-check` | Skill tool (attempted) | **NOT_AVAILABLE** | Standard-verification route applied manually to the `throw new Error` finding + structural-test-bypass candidates in Phase 11 | Not registered as invocable skill |
| `variant-analysis` | Skill tool (attempted) | **NOT_AVAILABLE** | 5-step generalize-from-seed methodology applied manually in Phase 12 | Not registered as invocable skill |
| `semgrep-rule-creator` (a.k.a. `semgrep-rule-variant-creator`) | Skill tool (attempted) | **NOT_AVAILABLE** | Feasibility analysis done manually in Phase 7A; no rules persisted | Not registered; HR-1 forbids persisting rules anyway |

**Compliance note:** The protocol says "DO NOT PRETEND TO USE IT." I did not. The `RESULT_USED` column records that the *methodology* (read from disk) informed the manual analysis; the *skill invocation itself* did not occur. Every Phase 9-12 finding is reproducible from the production evidence cited, independent of any skill claim.

---

# C. Environment Capability Matrix

| tool | version | availability | actually exercised | blocking issue |
| ---- | ------- | ------------ | ------------------ | -------------- |
| node | v24.15.0 | yes | yes | — |
| pnpm | 11.1.2 | yes | yes (scripts inspected) | — |
| typescript / tsc | 5.9.3 | yes | yes (tsconfig.base.json read) | — |
| eslint | v10.6.0 (binary) | yes | **NO — no eslint config exists in repo** | `pnpm lint` runs `check-code-quality.mjs` (console-log regex), not ESLint |
| typescript-eslint | installed (dep) | yes | NO — unused without an eslint config | no flat/eslintrc file anywhere in repo |
| semgrep | 1.168.0 (global) | yes | YES — advisory scan ran (`/tmp/semgrep-engine.json`) | not in CI; not in any package.json |
| codeql | NOT FOUND | **no** | NO | `CODEQL_NOT_EXECUTED` (Phase 8) — no binary, no DB, private repo licensing unverified |
| python3 | 3.14.4 | yes | yes (json parsing) | — |
| rg | 13.0.0 | yes | yes (heavily) | — |
| jq | 1.8.1 | yes | yes | — |
| git | 2.53.0 | yes | yes (history mining) | — |

### Project configuration inspected

| config | finding |
|--------|---------|
| `tsconfig.base.json` | **strict** + `strictNullChecks` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` + `noFallthroughCasesInSwitch` + `noImplicitReturns` — a **maximally strict** TS config |
| eslint config | **ABSENT** — no `eslint.config.*` / `.eslintrc*` at root or in any package |
| turbo config | present (`turbo` workspace); `verify` orchestrates format/lint/arch/typecheck/coverage/build |
| package scripts | `lint` = `check-code-quality.mjs`; `lint:arch` = `check-architecture.mjs`; `lint:copy/db-config` = domain regex scripts; **no `semgrep`/`eslint`/`codeql` script** |
| architecture tests | **4 custom structural tests** in `apps/api/src/runtime/` (the real enforcement layer) |
| contract tests | `packages/contracts/src/__tests__/` + `apps/api/src/openapi/openapi.structural.test.ts` |
| database tests | `packages/db` worker-DB-isolated vitest suite |
| formal artifacts | **NONE** — no TLA+/Alloy/Promela/FSpec files anywhere |

---

# D. Repository Authority Topology

Re-verified from actual `import` statements (HR-2: production is authority; manifests alone are insufficient).

| Module | Authoritative responsibility | Owned facts | Allowed dependencies | Actual dependencies | Drift |
|---|---|---|---|---|---|
| `domain` | canonical **semantic vocabulary** (`as const` enums) + entity interfaces + pure grading math + error classes | all status/reason/policy enums, entity shapes, `AppError` hierarchy | (leaf) | none | none — leaf, lint:arch-enforced |
| `contracts` | wire schemas (Zod) + DTOs + i18n `messageRegistry` | Zod wire shapes, `ErrorCode` closed union, `HiddenReasonEnum`, Phase-1 subsets | `@exam/domain` (declared) | **`zod` only — domain NOT imported in src/** | enum values **re-typed by hand** (not derived from domain) |
| `db` | Drizzle schema + repositories | row shapes, `.$type<>()` narrowing, 3 CHECK constraints | `@exam/domain`, `@exam/auth` | domain only (auth is seed/test-only) | status/policy columns unconstrained `text` accept wider vocabulary than TS |
| `exam-engine` | **protocol kernel**: FSMs, submit-freeze, terminal aggregation, deadline, lock seam, capability | protocol decisions; defines its own repo **port interfaces** | `@exam/domain` | domain only | clean — but `gradingWorkset.ts` throws plain `Error` (22 sites) vs `AppError` elsewhere (88 sites) |
| `api` | HTTP transport + tx composition + repo adapters + **protocol→wire semantic mapping** | result-visibility rule, lockReason/answerSource derivation, queue admission | engine+contracts+db+domain+auth+authz+import-export | all of those | owns protocol semantics the engine does not (result visibility, take-snapshot projection) |
| `web` | UI | (consumer) | contracts, domain | contracts (37), domain (4) | none |
| `auth` / `authz` | password hashing, JWT, RBAC | — | domain (+contracts for auth) | — | — |
| `import-export` | CSV/Excel/PDF | — | (none internal) | none | — |

### Topology answers (HR Phase 1)

- **Does exam-engine own a narrow protocol transition domain, or has it become a de-facto global protocol authority?** — It is a **PROTOCOL_KERNEL**: it owns transitions, freeze, grading authority, deadline, and locking; it does *not* own transaction composition or the candidate-projection/visibility mapping (those live in `apps/api`). So: **wider than "narrow transition domain", narrower than "global authority".**
- **Are protocol invariants distributed across modules?** — **Yes.** The *vocabulary* is centralized in `domain`, but the *visibility/lockReason/answerSource* derivation is in `apps/api`, the *enum wire vocabulary* is independently maintained in `contracts`, and the *persistence encoding* is in `db`. One fact (e.g. an AttemptStatus value) is known by 4 packages.
- **Are there multiple independently-evolving representations of the same fact?** — **Yes, extensively.** `ConflictReason` (domain) and `SaveAnswerRejectReason` (contracts) are one 5-value fact under two names; QuestionType is inlined 6× in contracts; `GradingEntryMode` (domain) / `GradingModeEnum` (contracts) / `isManualGradedQuestion` (engine) are three representations of one classification. (Carried forward from EXAM-BOUNDARY-REVIEW-0; not re-litigated here.)

---

# E. Protocol Authority Map

Built from manual reconstruction (the unavailable `audit-context-building` skill's purpose), validated against production.

| Domain | Authoritative production fact | Representation | Writers | Readers | Canonical seam | Transaction boundary |
| ------ | ----------------------------- | -------------- | ------- | ------- | -------------- | -------------------- |
| attempt lifecycle status | `exam_attempts.status` | text (unconstrained) | `submitAttempt`/`startOrRestoreAttempt`/`restoreAttempt`/`finalizeTerminalGrading` | FSM, routes, projections | `attemptStateMachine.transition` | caller tx (`executeInTransaction`) |
| start | new attempt row | row insert | `startOrRestoreAttempt` | candidate routes | `startOrRestoreAttempt` | tx (Enrollment FOR UPDATE → attempt create) |
| resume/restore | `deadlineAt` adjust + status flip | row update | `restoreAttempt` | candidate restore route | `restoreAttempt` | tx (EA capability) |
| heartbeat | `lastActivityAt` | row update | heartbeat route (NO engine call) | disrupted-scanner (not impl in P1) | route-direct repo update | none (best-effort) |
| save | `attempt.answers` (jsonb) | row update | **save route (NOT engine)** — engine only decides | submit snapshot builder | `processSaveAnswer` (decision) + route (persist) | tx (EA capability) |
| submit | freeze `submittedAnswers` + materialize entries | row update | `submitAttempt` | grading | `submitAttempt` | tx (attempt FOR UPDATE) |
| force submit | reuse submit + idempotent grade | row update | admin route → `submitAttempt`+`gradeAttemptIdempotent` | — | route composition | tx (EA capability) |
| deadline | `min(exam.closeAt, attempt.deadlineAt)` | derived | `startOrRestore`/`restore`/`extendAttemptTime` write `deadlineAt` | `computeEffectiveDeadline` | `isAttemptDeadlineExpired` | n/a (pure) |
| deadline extension | `attempt.deadlineAt` | row update | `extendAttemptTime` (REJECTS beyond closeAt) | deadline helpers | `extendAttemptTime` | tx (attempt FOR UPDATE) |
| disruption | `status=disrupted` | row update | `markDisrupted` (**no production caller — dead**) | — | `markDisrupted` | n/a |
| grading workset | `attempt_grading_entries` rows | rows | `materializeGradingWorkset` (exclusively) | aggregation | `materializeGradingWorkset` | tx (inside submit) |
| grading entry | entry `status`/`earnedScore` | row update | `materializeGradingWorkset` (auto) / `gradeQuestion` (manual) | aggregation | `gradeQuestion` | tx (EA capability) |
| manual grading | entry `pending_manual→completed_manual` | row update | `gradeQuestion` | grading queue | `gradeQuestion` | tx (EA capability) |
| grading aggregation | terminal score | derived | `aggregateGradingEntries` (exclusively) | terminal closure | `aggregateGradingEntries` | n/a (pure) |
| terminal score | `attempt.score/passed/gradingResult` | row update (PROJECTION) | `finalizeTerminalGrading` (exclusively) | candidate/export routes | `finalizeTerminalGrading` | tx (EA capability) |
| passed result | `enrollment.finalScore/finalPassed/finalAttemptId` | row update (PROJECTION) | `finalizeTerminalGrading` (exclusively) | candidate summary | `finalizeTerminalGrading` | tx (EA capability) |
| assignment/eligibility | `exam_enrollments` row | row | enroll route | `startOrRestore` | route + repo | tx |
| exam publication/closure | `exam.status` | text (unconstrained) | `publishExam`/`openExam`/`closeExam`/… | candidate summary, guards | `examStateMachine` + commands | tx-optional |
| result visibility | derived | derived (wire only) | **`computeResultVisibility` (apps/api)** | candidate take snapshot | **NO engine seam** | n/a |
| presence/audit | `audit_logs` rows | row insert | routes (post-commit) | — | `recordAudit` | post-tx |
| outbox | `email_outbox` rows | row insert | `EmailOutboxService` | worker | service | tx |
| background jobs | deadline scanner | in-memory loop | `deadlineScanner.scanDatabaseForExpiredAttempts` | — | scanner → `autoSubmitAndGrade` | per-candidate tx |

**Separation enforced:** every PROJECTION (attempt.score, enrollment.finalScore, gradingResult) is written by exactly one seam (`finalizeTerminalGrading`), structurally locked. `resultVisibility` is the one business-rule DERIVED PROJECTION whose authority is in `apps/api`, not the engine — flagged in section I.

---

# F. Current Invariant Register

Derived from production. Each is one falsifiable statement.

| ID | Statement | Production evidence | Authoritative writer | Authoritative reader | Canonical seam | Historical defect relation |
|----|-----------|---------------------|----------------------|----------------------|----------------|----------------------------|
| EXAM-INV-001 | `materializeGradingWorkset` is defined in exactly one production file and invoked from exactly one production function (`submitAttempt`). | `gradingWorkset.ts:182`; `attemptCommands.ts` | `submitAttempt` | aggregator | `materializeGradingWorkset` | #6 (single workset authority) |
| EXAM-INV-002 | `aggregateGradingEntries` is the sole terminal score authority and is invoked from exactly one production file (`grading.ts`). | `gradingWorkset.ts:405`; called only in `grading.ts` | `finalizeTerminalGrading` | terminal closure | `aggregateGradingEntries` | #5, #9 |
| EXAM-INV-003 | `aggregateGradingEntries` body never reads `attempt.answers`, `.submittedAnswers`, or `.gradingResult`; reads only `{id, questionSnapshot}`. | function-body scan locks field set | — | — | aggregator body | #5 (gradingResult-as-input) |
| EXAM-INV-004 | `finalizeTerminalGrading` is the single production writer of enrollment terminal projection (`finalScore/finalPassed/finalAttemptId`). | writer-inventory == `{grading.ts}` | `finalizeTerminalGrading` | candidate summary | terminal closure | #8 (terminal mutation ownership) |
| EXAM-INV-005 | No production source uses an `as LockedEnrollmentAttemptIdentity` cast, nor a type-predicate narrowing to it, nor exports `LOCK_TOKEN`/`TX_AFFINITY_TOKEN`. | `lock-order.structural.test.ts` rules 1-3 | `lockEnrollmentAndAttempt` | `assertCapabilityFor` | lock seam | #17 (lock order) |
| EXAM-INV-006 | All EA-sensitive entry points (exactly 7) mint the capability via `lockEnrollmentAndAttempt` before any repo op. | `lock-order.structural.test.ts` rule 6 (entry-point count == 7) | routes/orchestrators | consumers | lock seam | #17 |
| EXAM-INV-007 | `computeEffectiveDeadline` and `isAttemptDeadlineExpired` are each defined in exactly one file (`deadlineReconciliation.ts`). | `deadline-authority.structural.test.ts` | engine | scanner + inline | deadline seam | #2, #10 |
| EXAM-INV-008 | The deadline scanner rechecks expiry via the canonical `isAttemptDeadlineExpired` (not a re-derived `closeAt <= now`). | scanner references canonical recheck | scanner | — | canonical recheck | #10 (scanner divergence) |
| EXAM-INV-009 | No raw wall-clock (`new Date()`, `Date.now()`, SQL `now()`/`CURRENT_TIMESTAMP`/`clock_timestamp`/`transaction_timestamp`/`statement_timestamp`) in business paths outside the 12-entry reason-documented allowlist. | `time-authority.structural.test.ts` | `fastify.now()` | business paths | `now.ts` | #16 (clock authority) |
| EXAM-INV-010 | `gradingResult` is a terminal projection only — never consumed as a scoring input. | INV-003 (body never reads it) | `finalizeTerminalGrading` | export/display only | terminal closure | #5 |
| EXAM-INV-011 | A protocol-reachable active attempt (`in_progress`/`disrupted`) created by an ordinary path has a non-null `deadlineAt`. | `ACTIVE-DEADLINE-001` in `deadlineReconciliation.ts:41`; reachability audit `1a85e49` | `startOrRestore`/`restore`/`extendAttemptTime` | deadline helpers | creation paths | #1 (reachability vs NULL recovery) |
| EXAM-INV-012 | NULL `attempt.deadlineAt` is reachable-but-protocol-unreachable; defensive recovery falls back to `exam.closeAt` (NOT a valid protocol timing state). | `computeEffectiveDeadline` + `deadline-authority` header | (recovery) | deadline helpers | defensive fallback | #1 |
| EXAM-INV-013 | A `pending_manual` attempt may only be terminally closed by `gradeQuestion` (completing the last pending entry); `finalizeGrading` rejects `pending_manual`. | `grading.ts:397-402` throws | `gradeQuestion` | — | manual closure | #4 (transition bypass) |
| EXAM-INV-014 | Manual grading entry completion is one-way pending-only (`pending_manual → completed_manual`); re-grading a completed entry is rejected. | `manualGrading.ts` lifecycle guard; `attemptGradingEntryRepo` pending-guard | `gradeQuestion` | — | `gradeQuestion` | #7 (manual re-entry) |
| EXAM-INV-015 | `ConflictReason` (domain) and `SaveAnswerRejectReasonEnum` (contracts) denote the same 5-value set. | `enums.ts:248`; `attempt.ts:36` | domain (producer) / contracts (wire) | save route | `processSaveAnswer` | #14 (contract/impl drift) — **NOT mechanically checked** |
| EXAM-INV-016 | Exam-business errors thrown from exam-engine use `AppError` subclasses (carrying a stable `code`), not plain `Error`. | `errors.ts` hierarchy; 88 AppError throws | engine | `normalizeErrorCode` → registry | error hierarchy | #18 (error-code drift) — **VIOLATED: 22 plain `throw new Error` in `gradingWorkset.ts`** |
| EXAM-INV-017 | The EA capability proves repo-reference affinity (same repo objects at mint and consume). | `assertCapabilityFor` ref `===` | `lockEnrollmentAndAttempt` | consumers | runtime check | #17 |
| EXAM-INV-018 | Domain is a leaf package (no internal imports). | `check-architecture.mjs` | — | — | arch lint | #13 (boundary) |

---

# G. Historical Defect Taxonomy

Mined from git history (26 commits inspected). Status per HR-4 classification.

| Defect / corrective | Root semantic error | Violated invariant | Why previous review missed it | Current protection |
| ------------------- | ------------------- | ------------------ | ----------------------------- | ------------------ |
| #1 deadlineAt reachability vs NULL recovery (`1a85e49`) | a prior fix conflated schema-admissible NULL, protocol-reachable non-NULL, and defensive recovery into one "liveness gap" | INV-011/012 | the conflation was conceptual (reachability vs recovery), not a code bug — easy to miss by reading code alone | reachability audit in commit msg; `deadline-authority` header; **no runtime test of the boundary** |
| #2 active-attempt deadline semantics (`d28c3e8`,`e29be53`) | two expiry authorities diverged (inline `computeEffectiveDeadline` vs scanner `deadlineAt <= now`) | INV-007/008 | the divergence lived across two modules (engine + db query); a single-module review could not see it | **deadline-authority.structural.test.ts** (MULTIPLE) |
| #3 attempt status direct mutation | none discrete — guarded from foundation | INV (FSM) | n/a | attemptStateMachine tests + transition table |
| #4 state transition bypass (`cb562a2`) | manual-graded attempts jumped `in_progress→submitted→graded`, never holding at `submitted+pending_manual` | INV-013 | the "hold" requirement was a protocol-spec rule, not locally visible | engine `finalizeGrading` pending_manual guard (runtime) |
| #5 gradingResult as scoring source (`220bc18`) | `attempt.gradingResult` was read back as scoring input | INV-003/010 | the read looked innocent locally; only the authority graph exposed it | **gradingArchitecture.structural.test.ts (body never reads .gradingResult)** |
| #6 attempt_grading_entries as authority (`3ad9615`,`220bc18`,`f89162c`) | scoring derived from reconciliation of mixed sources, not one durable workset | INV-001/002 | multiple "scoring" call sites each looked defensible | **gradingArchitecture.structural.test.ts (single def + single caller)** |
| #7 manual grading re-entry (`7af5d13`,`b9125c8`) | completed entry could be re-graded/double-counted | INV-014 | one-way completion was a convention, not enforced | repo pending-guard + `manualGrading` lifecycle (runtime) |
| #8 terminal grading mutation ownership (`b9125c8`) | `gradeQuestion` terminal branch wrote attempt score but not enrollment projection → divergent answers for manual exams | INV-004 | the divergence was across two projections (attempt vs enrollment) | **gradingArchitecture.structural.test.ts (writer-inventory == {grading.ts})** |
| #9 grading aggregation seam (`b9125c8`,`220bc18`) | aggregator had two direct call sites | INV-002 | two callers each looked correct | **gradingArchitecture.structural.test.ts (caller file == {grading.ts})** |
| #10 deadline scanner divergence (`d28c3e8`) | scanner re-derived expiry ignoring `exam.closeAt` | INV-008 | cross-module (engine vs scanner) | **deadline-authority.structural.test.ts** |
| #11 force-submit audit (`307398c`,`a580344`) | audit row emitted on idempotent no-op; audit bypassed `recordAudit` | — | idempotency edge case | idempotency tests + 403 schema |
| #12 resume/restore asymmetry (`5ca4258`) | extend REJECTS beyond closeAt; restore CLAMPS — intentional but divergent | — | spec-documented divergence | **DOCUMENTED_RISK — no dedicated unit test pins it** |
| #13 state-machine drift | none discrete | — | n/a | attemptStateMachine tests |
| #14 contract/impl enum drift (`6b45eb4`,`91f36a7`) | proctor silent `as` casts; QuestionType widened required 6 hand-edits | INV-015 | enum parity rested on convention | proctor `safeParse`; contracts enum rejection test; **NO domain↔contracts parity test** |
| #15 dist staleness (`2b1c542`) | web coverage ran vitest directly, bypassing turbo `^build` | — | build-graph ordering | **CI script line only — no structural guard** |
| #16 clock authority (`56366a2`) | raw `new Date()`/`Date.now()`/SQL `now()` in business paths | INV-009 | locally each read looked fine | **time-authority.structural.test.ts** |
| #17 lock order (`c56bae1`,`9a6fb0b`,`ce275d2`,`36321af`) | no canonical EA seam → enrollment read without lock → last-writer-wins on finalScore | INV-005/006/017 | the race required concurrency reasoning, not code reading | **lock-order.structural.test.ts (7 rules) + gradingConcurrency.test.ts + runtime assertCapabilityFor** |
| #18 error-code drift (`c37bb34`,`7923941`) | legacy ad-hoc error bodies in `course.ts` bypass envelope | INV-016 | error taxonomy fragmentation risk | OpenAPI drift test + `api:openapi:check` CI; **course.ts ad-hoc bodies STILL OPEN; INV-016 currently violated by gradingWorkset** |

> **Key question (HR-4):** Which previously-accepted defect classes still require the next agent to rediscover the rule from natural language?
> **Answer:** #1 (reachability boundary — no runtime/structural test of the conceptual distinction), #12 (restore/extend asymmetry — no pinning test), #14 (domain↔contracts enum parity — convention only), #15 (dist staleness — CI-script-only), #18 (error-code drift — INV-016 violated, course.ts still open).

---

# H. TypeScript and Typed ESLint Verdict

### TypeScript type-system value

The config is **maximally strict** (`strict`, `strictNullChecks`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noFallthroughCasesInSwitch`, `noImplicitReturns`). This is above industry baseline.

| Protocol fact | Current TS representation | Invalid state representable? | Type-system candidate | Value |
| ------------- | ------------------------- | ---------------------------- | --------------------- | ----- |
| attempt status | `AttemptStatus` literal union | YES — any status value is assignable to a bare `string` field on the DB row; the FSM transition legality is runtime, not type | branded status-per-state | TYPE_PARTIAL |
| grading status | `GradingStatus` literal union | YES — nullable (`gradingStatus?`); nullable + `submitted` is representable but means "pre-migration" | non-nullable after submit | TYPE_PARTIAL |
| grading entry status | `GradingEntryStatus` union | partial — DB CHECK + `.$type<>()` narrow on read | (already strongest in repo) | TYPE_STRONG (read-side) |
| deadline nullability | `deadlineAt?: Date` | YES — `in_progress` with null deadlineAt is type-representable but protocol-unreachable (INV-011) | branded "ActiveAttempt" with non-null deadline | **TYPE_WEAK** — the central representable-invalid-state |
| result projection | `score?/passed?/gradingResult?` | YES — graded attempt with null score is representable | required-after-grade phantom | TYPE_PARTIAL |
| terminal state | `status: 'graded'` xor others | NO enforcement that graded ⇒ score present | discriminated union by status | TYPE_WEAK |
| resume/restore distinction | two fns, same types | YES — nothing prevents calling `restoreAttempt` on an `in_progress` (it would no-op) | (runtime guards exist) | TYPE_PARTIAL |
| command result/error variants | `AppError` subclasses; but `throw new Error` also possible | YES — plain Error escapes the typed hierarchy (INV-016) | enforce AppError-only throws | TYPE_PARTIAL |
| EA capability | branded opaque type | NO — private Symbol brands + arch-lint cast ban | (already implemented) | TYPE_STRONG |
| answer-save result | `ProcessSaveResult` union | partial — `accepted:true` without `newAnswer` is representable | discriminated union refinement | TYPE_PARTIAL |

**Invalid-state representability summary:** the type system prevents *gross* mis-assignment but does **not** encode state/field coupling (graded ⇒ score; in_progress ⇒ deadlineAt). The most consequential representable-invalid-state is **`deadlineAt` nullability** (INV-011/012) — exactly the defect class that caused historical bugs #1/#2.

### Typed ESLint status

```
TYPED_LINT_FULL    : no
TYPED_LINT_PARTIAL : no
UNTYPED_ONLY       : no
ESLINT_NOT_EFFECTIVE: YES  — no eslint config exists anywhere in the repo
```

`pnpm lint` runs `check-code-quality.mjs`, which is a **single regex** banning `console.log/error`. `typescript-eslint` is an installed dependency but is **never configured or invoked**. There is no type-aware linting at all.

### Typed-lint candidate protections (if a config were added)

| Defect class | Relevant production seam | typed ESLint capability | FP risk | Recommendation |
| ------------ | ------------------------ | ----------------------- | ------- | -------------- |
| floating/misused promises in routes | async route handlers | `no-floating-promises`, `await-thenable` | LOW | high value — routes are async-heavy |
| unsafe `any` propagation | adapter `as Exam` casts (`repoAdapters.ts`) | `no-unsafe-assignment`, `no-explicit-any` | MEDIUM (adapters legitimately cast) | medium — adapters need allowlist |
| `throw new Error` in engine (INV-016) | `gradingWorkset.ts` (22 sites) | `no-throw-literal` (fails on non-Error; needs custom for non-AppError) | LOW | **HIGH value — the confirmed violation** |
| switch exhaustiveness over status unions | status branches in orchestrator | `switch-exhaustiveness-check` | LOW | medium — would catch missing status cases |
| `as LockedEnrollmentAttemptIdentity` forgery | (already arch-lint banned) | redundant | — | already covered better |

**Verdict:** ESLint is the **most underutilized tool** in this repo. A flat config enabling `typescript-eslint` recommended-type-checked + `no-floating-promises` + a custom `no-throw-non-apperror` rule would be the single highest-value static addition. (Recommendation only — HR-1 forbids adding it here.)

---

# I. Static Analysis Findings

Applying `fp-check` methodology (standard route: restate claim → trace source→sink → devil's advocate) to each candidate.

| ID | Finding | Category | Evidence |
|----|---------|----------|---------|
| SA-01 | `gradingWorkset.ts` throws plain `Error` (22 sites: L112,223,233,240,248,257,264,276,284,292,299,312,415,429,444,456,465,475,485,495) + `lockSeam.ts:147` + `attemptCommands.ts:328`, while the rest of exam-engine throws `AppError` subclasses (88 sites). These workset-invariant violations surface as 500 `INTERNAL_ERROR` (via `normalizeErrorCode` fallback) instead of a protocol-meaningful code. | **CONFIRMED_DEFECT** (INV-016 violation) | grep-verified counts; `errors.ts` exports the hierarchy; `errors.ts`/`errorResponse.ts` normalizeErrorCode fallback path confirmed |
| SA-02 | `save` route writes `attempt.answers` directly (`attempts.candidate.ts:1010`) outside any engine function — the only place a protocol-owned field is persisted outside the engine. `processSaveAnswer` is a decision core, not a complete action. | **DESIGN_SHARP_EDGE** (not a runtime bug; an authority split) | route body read; engine function body is pure (no IO) — carried from EXAM-BOUNDARY-REVIEW-0, re-verified |
| SA-03 | `resultPublicationMode` visibility rule lives in `apps/api/attempts.shared.ts:computeResultVisibility`, with no engine counterpart; `HiddenReasonEnum` lives in contracts. A business rule with authority split across api+contracts, absent from engine. | **ARCHITECTURE_DRIFT** | `computeResultVisibility` body; grep confirms no engine visibility fn |
| SA-04 | `ConflictReason` (domain) and `SaveAnswerRejectReason` (contracts) are one 5-value fact under two names; no parity test links them. | **PLAUSIBLE_DEFECT_NEEDS_DYNAMIC_PROOF** (drift risk, not current divergence) | both sets read; `contracts.test.ts:690` hardcodes literals rather than referencing domain |
| SA-05 | `attempt_grading_entries` repo write-method surface (`attemptGradingEntryRepo.update` from `repoAdapters.ts`) is not exhaustively locked to the two canonical seams by the structural tests (they lock `materializeGradingWorkset`/`aggregateGradingEntries` callers, not all repo writes). | **INSUFFICIENT_EVIDENCE** — would need call-graph trace to confirm exposure | partial trace done; not exhaustively proven |
| SA-06 | Raw wall-clock reads: 0 violations (INV-009 clean) | **KNOWN_ACCEPTED_BEHAVIOR** (clean) | `time-authority.structural.test.ts` passes |
| SA-07 | EA capability cast forgery: 0 (INV-005 clean) | **KNOWN_ACCEPTED_BEHAVIOR** (clean) | `lock-order.structural.test.ts` + grep |
| SA-08 | Redis as consistency authority: NOT_PRESENT — Redis is optional (disabled by default), used only for `system.ts` health ping | **FALSE_POSITIVE** (the class doesn't apply) | `runtimeConfig.ts:386`; `system.ts:267` |

**Note:** No finding enters CONFIRMED_DEFECT without production-path verification. SA-01 is the sole confirmed defect; it is low-severity (defensive invariant-violation paths, not reachable by normal input) but real and currently uncaught by any rule.

---

# J. Semgrep Candidate Rule Matrix

From Phase 7 feasibility (+ Phase 7A manual feasibility, since `semgrep-rule-creator` was NOT_AVAILABLE). Advisory scan: `semgrep scan --config auto packages/exam-engine/src` → **0 findings** (210 rules, 37 files, network available) — generic registry produces zero signal on pure business logic.

| Candidate Rule ID | Forbidden pattern | Allowed seam | Historical relation | Expected FP risk | Semgrep value | Rank |
| ----------------- | ----------------- | ------------ | ------------------- | ---------------- | ------------- | ---- |
| EXAM-SG-01 | `throw new Error(...)` in `packages/exam-engine/src/**` | `AppError` subclasses from `@exam/domain` | #18 error-code drift | LOW (clean syntactic match) | **SEMGREP_STRONG** | **P0** |
| EXAM-SG-02 | raw `new Date()`/`Date.now()`/SQL `now()` in business paths | 12-entry allowlist | #16 clock authority | LOW | SEMGREP_STRONG but **redundant** — `time-authority.structural.test.ts` already richer | P2 |
| EXAM-SG-03 | `as LockedEnrollmentAttemptIdentity` cast | none (mint only) | #17 lock order | NONE | NOT_SEMGREP — `lock-order.structural.test.ts` already locks it | REJECT |
| EXAM-SG-04 | `attempt.gradingResult` read as score input | projection-only reads | #5 gradingResult-as-input | HIGH (can't scope to function body) | NOT_SEMGREP — `gradingArchitecture` body-scan is strictly stronger | REJECT |
| EXAM-SG-05 | second `aggregateGradingEntries`/`materializeGradingWorkset` caller | the one canonical caller | #6/#9 | needs caller-file allowlist | NOT_SEMGREP — writer-inventory test is exact | REJECT |
| EXAM-SG-06 | `z.object`/`z.enum` domain schemas redefined in `apps/api/src/routes` | import from `@exam/contracts` | #14 contract drift | MEDIUM (route wrappers are legit) | SEMGREP_PARTIAL — modest niche, no structural test covers | P1 |
| EXAM-SG-07 | cross-layer import (web→db, db→apps) | documented DAG | boundary | LOW | SEMGREP_STRONG but **ESLint `no-restricted-imports` is cheaper** — `check-architecture.mjs` already does regex version | P2 |
| EXAM-SG-08 | `attempt_grading_entries` repo writes outside 2 canonical seams | materialize/gradeQuestion | #6 | MEDIUM (needs call-site context) | SEMGREP_PARTIAL — small uncovered niche | P1 |
| EXAM-SG-09 | Redis read influencing protocol decision | (none) | (none historical) | — | NOT_SEMGREP — Redis non-authoritative; pattern absent | REJECT |

**Bottom line:** Of 9 candidates, only **EXAM-SG-01 (`throw new Error` ban)** is a clear P0 — it targets a real current violation (SA-01) that no other mechanism catches. EXAM-SG-06 and EXAM-SG-08 are P1 niches. **Everything else is already enforced better by the structural tests** (the bespoke framework out-classes Semgrep on this codebase's invariants). Rules NOT persisted (HR-1).

---

# K. Interprocedural Analysis Matrix

```
CODEQL_NOT_EXECUTED
```

CodeQL binary absent; no database; private-repository licensing not verified (HR: do not circumvent license). Conceptual query classes identified regardless.

| Query ID | Question | Required analysis | Semgrep sufficient? | Interprocedural value |
| -------- | -------- | ----------------- | ------------------- | --------------------- |
| IA-01 | all writers reaching `attempt.status` persistence | call-graph to repo update | NO (Semgrep can't trace) | MEDIUM |
| IA-02 | all paths transitioning into active attempt states | call-graph + FSM | NO | MEDIUM |
| IA-03 | all active-state paths consuming `deadlineAt` | dataflow | NO | **HIGH** (would prove INV-011 reachability) |
| IA-04 | all readers of `attempt.gradingResult` | dataflow | partial | MEDIUM (structural test covers the aggregator; other readers not exhaustively mapped) |
| IA-05 | all callers reaching `aggregateGradingEntries` | call-graph | NO (but structural test already locks caller-file set) | LOW (already covered) |
| IA-06 | all manual-grading mutation paths | call-graph | partial | MEDIUM |
| IA-07 | all paths persisting `gradingResult` | dataflow | NO | LOW (single writer, structurally locked) |
| IA-08 | all force-submit paths | call-graph | NO | LOW (single route) |
| IA-09 | all deadline-triggered terminal paths | call-graph | NO | MEDIUM |
| IA-10 | all protocol writes bypassing exam-engine | call-graph to repo | NO | **HIGH** (would prove SA-02/SA-05 — the only authority-split risk) |
| IA-11 | all Redis reads influencing protocol | dataflow | NO | NONE (Redis non-authoritative) |
| IA-12 | all direct contract-shape duplication | syntactic | YES | LOW |

**Verdict:** The highest-value interprocedural queries (IA-03 deadline reachability proof, IA-10 protocol-write bypass proof) target the *exact* residual risks the structural tests cannot express (they lock known seams; they cannot prove no *other* write path exists). CodeQL would add genuine value for those two, but is not operationally available here.

---

# L. Architecture / Contract / Database Enforcement Matrix

| Invariant | Architecture | Contract | Database | Gap |
| --------- | ------------ | -------- | -------- | --- |
| domain is leaf (INV-018) | `check-architecture.mjs` regex — STRUCTURAL_STRONG | — | — | none |
| exam-engine no fastify / no EA cast | `check-architecture.mjs` — STRUCTURAL_STRONG | — | — | none |
| no db.select in routes | `check-architecture.mjs` — STRUCTURAL_STRONG | — | — | none |
| web no db | `check-architecture.mjs` — STRUCTURAL_STRONG | — | — | none |
| single workset materializer (INV-001) | `gradingArchitecture.structural.test.ts` — STRUCTURAL_STRONG | — | — | none |
| single aggregator (INV-002) | `gradingArchitecture.structural.test.ts` — STRUCTURAL_STRONG | — | — | none |
| aggregator field-set lock (INV-003) | `gradingArchitecture.structural.test.ts` — STRUCTURAL_STRONG | — | — | none |
| single terminal-projection writer (INV-004) | `gradingArchitecture.structural.test.ts` — STRUCTURAL_STRONG | — | — | none |
| EA lock order (INV-005/006/017) | `lock-order.structural.test.ts` + runtime `assertCapabilityFor` — STRUCTURAL_STRONG | — | — | none |
| single deadline authority (INV-007/008) | `deadline-authority.structural.test.ts` — STRUCTURAL_STRONG | — | — | none |
| clock authority (INV-009) | `time-authority.structural.test.ts` — STRUCTURAL_STRONG | — | — | none |
| response shape | — | OpenAPI structural test + `api:openapi:check` CI — STRUCTURAL_PARTIAL | — | contract shape proven; **protocol semantics not** |
| error-code envelope (INV-016) | — | `messageRegistry` + `normalizeErrorCode` | — | **VIOLATED** (SA-01: engine throws plain Error) |
| domain↔contracts enum parity (INV-015) | — | contracts enum rejection test only | — | **NO parity test** (convention only) |
| `attempt_grading_entries.(attempt_id,question_id)` uniqueness | — | — | UNIQUE constraint — STRUCTURAL_STRONG | none |
| `exam_enrollments.(exam_id,candidate_id)` uniqueness | — | — | UNIQUE — STRUCTURAL_STRONG | none |
| grading_entry status ∈ valid set | — | — | CHECK + `.$type<>()` — STRUCTURAL_STRONG | none |
| grading_entry mode ∈ {auto,manual} | — | — | CHECK + `.$type<>()` — STRUCTURAL_STRONG | none |
| **all other status/policy columns** (attempt/exam/enrollment status, QuestionType, scoreStrategy, retakePolicy, timingMode, submissionReason) | — | — | **unconstrained `text`** — UNENFORCED | DB accepts wider vocabulary than TS believes |
| EA lock order (runtime) | — | — | n/a | runtime `assertCapabilityFor` (repo-ref affinity) — but does NOT prove tx-session liveness (tx-bound repos do) |
| submit-freeze atomicity | — | — | transaction (caller-owned) | DOCUMENTED_ONLY — no DB-level guard; relies on tx convention |
| one grading entry per work item | — | — | UNIQUE(attempt_id, question_id) — STRUCTURAL_STRONG | none |
| dist freshness (INV — build graph) | CI script line only | — | — | **UNENFORCED structurally** (editing CI could regress #15) |

**Architecture-test caveat (HR Phase 13):** the structural tests are source-text scanners; they are best-effort against adversarial obfuscation (dynamic dispatch / computed member access). The codebase does not use such patterns today, and the tests explicitly state this limitation. They do **not** prove runtime protocol correctness — they prove *source-text invariants about who writes what*.

---

# M. Invariant Compilation Matrix (PRIMARY OUTPUT)

Cell values: **PRIMARY** (recommended cheapest reliable enforcement) / SECONDARY / PARTIAL / NO.

| Invariant / defect class | TS type system | typed ESLint | Semgrep | Interprocedural static | Architecture | Contract | Database | Formal | Dynamic | Agent semantic |
|--------------------------|----------------|--------------|---------|------------------------|--------------|----------|----------|--------|---------|----------------|
| domain leaf boundary (INV-018) | NO | NO | PARTIAL | NO | **PRIMARY** | NO | NO | NO | NO | NO |
| EA lock order (INV-005/006/017) | SECONDARY | NO | NO | NO | **PRIMARY** | NO | NO | NO | SECONDARY (concurrency test) | NO |
| single workset materializer (INV-001) | NO | NO | NO | PARTIAL | **PRIMARY** | NO | NO | NO | NO | NO |
| single aggregator + field-set (INV-002/003) | NO | NO | NO | PARTIAL | **PRIMARY** | NO | NO | NO | NO | NO |
| single terminal-projection writer (INV-004) | NO | NO | NO | PARTIAL | **PRIMARY** | NO | NO | NO | NO | NO |
| single deadline authority (INV-007/008) | NO | NO | NO | NO | **PRIMARY** | NO | NO | NO | NO | NO |
| clock authority (INV-009) | NO | NO | SECONDARY | NO | **PRIMARY** | NO | NO | NO | NO | NO |
| AppError-only throws (INV-016) | PARTIAL | **PRIMARY** | SECONDARY | NO | NO | NO | NO | NO | NO | NO |
| domain↔contracts enum parity (INV-015) | NO | NO | NO | NO | PARTIAL | **PRIMARY** | NO | NO | NO | SECONDARY |
| status/policy value validity | PARTIAL | NO | NO | NO | NO | PARTIAL | **PRIMARY** (CHECK/`.$type`) | NO | NO | SECONDARY |
| `attempt_grading_entries` uniqueness | NO | NO | NO | NO | NO | NO | **PRIMARY** (UNIQUE) | NO | NO | NO |
| submit-freeze atomicity | NO | NO | NO | NO | NO | NO | SECONDARY (tx) | **PRIMARY** (model check) | SECONDARY (concurrency) | NO |
| deadline reachability INV-011 (no active+null deadline) | PARTIAL | NO | NO | **PRIMARY** (IA-03) | NO | NO | NO | SECONDARY | SECONDARY | SECONDARY |
| protocol-write bypass (SA-02: save route writes answers) | NO | NO | NO | **PRIMARY** (IA-10) | PARTIAL | NO | NO | NO | SECONDARY | SECONDARY |
| result-visibility rule authority (SA-03) | NO | NO | NO | NO | NO | NO | NO | NO | NO | **PRIMARY** |
| concurrent save vs submit | NO | NO | NO | NO | NO | NO | SECONDARY | **PRIMARY** | SECONDARY | NO |
| force-submit race | NO | NO | NO | NO | NO | NO | SECONDARY | **PRIMARY** | SECONDARY | NO |
| restore/resume race | NO | NO | NO | NO | NO | NO | SECONDARY | **PRIMARY** | SECONDARY | NO |
| manual grading concurrency | NO | NO | NO | NO | NO | NO | SECONDARY | **PRIMARY** | SECONDARY | NO |
| protocol intent drift / authority conflict | NO | NO | NO | NO | NO | NO | NO | NO | NO | **PRIMARY** |

**Rows with two PRIMARY** (complementary proof inherently required): submit-freeze atomicity, deadline reachability, protocol-write bypass, all concurrency rows — these need a static/structural proof *plus* a dynamic/formal proof because static analysis cannot reason about interleavings or reachability. Explained per-row.

---

# N. Machine-Rejectable Historical Defects

```
TOTAL_ACCEPTED_DEFECT_CLASSES     = 18
ALREADY_MACHINE_REJECTED          = 9   (#2,#5,#6,#8,#9,#10,#16,#17, partial #3/#13)
COULD_BE_MACHINE_REJECTED         = 2   (#18 via EXAM-SG-01/ESLint; #14 via contract parity test)
PARTIALLY_MACHINE_REJECTABLE      = 3   (#1 reachability boundary; #11 force-submit idempotency; #7 manual re-entry runtime guard)
FORMAL_OR_DYNAMIC_ONLY            = 3   (concurrency rows: save-vs-submit, force-submit race, restore race, manual-grading concurrency)
SEMANTIC_ONLY                     = 3   (#12 restore/extend asymmetry; result-visibility authority; protocol-intent drift)
```

### Which historical corrective classes should no longer consume first-pass agent reasoning?

These 9 are already machine-rejected by structural/architecture/DB tests and need **not** be re-derived by an agent from natural language:

1. **gradingResult-as-scoring-input (#5)** — `gradingArchitecture` body-scan locks it.
2. **single workset authority (#6)** — `gradingArchitecture` single-def/single-caller.
3. **single terminal-projection writer (#8)** — writer-inventory == {grading.ts}.
4. **single aggregation seam (#9)** — caller-file == {grading.ts}.
5. **deadline scanner divergence (#10)** — `deadline-authority` locks canonical recheck.
6. **clock authority / raw wall-clock (#16)** — `time-authority` allowlist scan.
7. **EA lock order (#17)** — `lock-order` 7 rules + runtime `assertCapabilityFor`.
8. **active-deadline divergence (#2)** — folded into #10's structural test.
9. **status/FSM transition legality (#3/#13)** — FSM table + tests.

### Which still require agent reasoning?

- **#1 (reachability vs NULL recovery)** — conceptual distinction, no test pins the boundary.
- **#12 (restore clamps vs extend rejects)** — spec-documented divergence, no pinning test.
- **#14 (domain↔contracts enum parity)** — convention only; a parity test is a cheap fix.
- **#15 (dist staleness)** — CI-script-only, not structurally guarded.
- **#18 (error-code drift / INV-016)** — **currently violated** by `gradingWorkset.ts`; cheaply fixable by ESLint/Semgrep rule EXAM-SG-01.

---

# O. Agent Review Residual Domain

After all cheap mechanical enforcement is hypothetically in place, the following remain appropriate for **agent semantic review** (not machine-rejectable):

1. **Protocol intent drift** — does a new field/route still match `docs/SPEC.md` intent? (No machine knows the spec's meaning.)
2. **Authority conflict** — when a new projection is added, does it duplicate an existing authority? (The structural tests lock *known* authorities; they cannot anticipate new ones.)
3. **Incorrect reachability assumptions** — e.g. "is this code path reachable with a NULL deadlineAt?" (IA-03 could help, but the *assumption* is semantic.)
4. **Recovery semantics** — defensive fallback paths (NULL deadline → closeAt) are correct-by-judgment, not by construction.
5. **Two individually-correct modules with incompatible models** — e.g. the save-route/engine authority split (SA-02); each piece is locally correct.
6. **Documentation authority conflict** — when `SPEC.md`, job cards, and code disagree (HR-2 precedence).
7. **Result-visibility rule placement** (SA-03) — a business rule whose *correct home* (engine vs api) is a design judgment.
8. **Semantic equivalence between implementation and any formal model** — no formal model exists; if one is added, equivalence is semantic.

> **What should the agent review after machines have rejected everything cheaper?**
> *New* authorities/projections/reachability paths, recovery-path correctness, cross-module model compatibility, and spec-intent alignment. The machine layer (structural tests) protects the *accepted* graph; the agent protects against *new* divergence.

---

# P. Recommended EXAM Review Pipeline

Derived from evidence — **not** the generic template. The ordering reflects (a) what actually exists and runs in this repo, (b) what catches the most before agent review, (c) the two cheap additions justified by evidence.

```
tsc (strict, already in verify)
  ↓   [catches gross type errors; does NOT encode state/field coupling]
check-architecture.mjs + 4× *.structural.test.ts + check-*-copy/db-config
  ↓   [THE primary enforcement layer today — bespoke, project-specific,
  ↓    richer than Semgrep on these invariants; runs in verify via turbo test]
api:openapi:check + contracts tests
  ↓   [shape parity; does NOT prove protocol semantics]
DB constraints (UNIQUE/CHECK/.$type) + integration tests
  ↓   [uniqueness, grading-entry status/mode validity; concurrency races via
  ↓    gradingConcurrency.test.ts]
─── ABOVE: already in CI (pnpm verify) ───
─── BELOW: evidence-justified additions (not yet present) ───
typed ESLint flat config (NEW — highest-value gap)
  ↓   [no-floating-promises + custom no-throw-non-AppError → catches SA-01]
Semgrep EXAM-SG-01 rule (NEW — overlaps ESLint option, alternative seam)
  ↓   [if ESLint route not taken; bans throw new Error in exam-engine]
domain↔contracts enum parity test (NEW — closes INV-015/#14)
  ↓   [asserts Zod enum set == domain as-const set]
differential-review (on corrective ranges) + variant-analysis (from seeds)
  ↓   [catches new variants of accepted defect classes]
agent semantic review (residual — see section O)
  ↓
STOP
```

**Why this differs from the generic template:** Semgrep and CodeQL are **demoted** here. Semgrep's generic registry returns 0 signal on this codebase, and the bespoke structural tests already express the project-specific invariants better than Semgrep can. CodeQL is unavailable. The genuine gaps are (1) no ESLint at all, and (2) enum-parity + the `throw-Error` inconsistency — both cheaply closable.

---

# Q. Proposed Follow-Up Job Cards

Maximum 6; each evidence-justified.

| ID | goal | exact enforcement layer | production changes allowed? | expected artifact | dependency |
|----|------|-------------------------|----------------------------|-------------------|------------|
| EXAM-STATIC-1 | Add a typed ESLint flat config (`typescript-eslint` recommended-type-checked + `no-floating-promises` + `await-thenable`) wired into `pnpm lint` | typed ESLint | **YES** (config + fix existing violations) | `eslint.config.mjs`; clean `pnpm lint` | none |
| EXAM-STATIC-2 | Close INV-016: replace the 22 `throw new Error` in `gradingWorkset.ts` (+2 elsewhere in engine) with appropriate `AppError` subclasses, then add `no-throw-literal`/custom rule to lock it | typed ESLint rule OR Semgrep EXAM-SG-01 | YES (engine error throws) | zero plain-Error throws in engine; stable error codes reach the registry | EXAM-STATIC-1 (if ESLint route) |
| EXAM-STATIC-3 | Add a domain↔contracts enum parity test (closes INV-015 / #14): assert each Zod enum's option set equals the corresponding domain `as const` value set | contract test (vitest) | YES (test only) | new parity test in `packages/contracts/src/__tests__/` | none |
| EXAM-STATIC-4 | Add a pinning test for the restore-clamps-vs-extend-rejects deadline asymmetry (#12), and a reachability test for INV-011 (no active attempt with null deadlineAt reachable via ordinary paths) | unit/integration test | YES (test only) | 2 new tests | none |
| EXAM-STATIC-5 | Structural guard for dist freshness (#15): a CI/test assertion that `packages/*/dist` is current vs source before web coverage runs (so editing CI cannot silently regress) | architecture test | YES (test only) | new structural test or turbo task dependency | none |
| EXAM-STATIC-6 | Document the bespoke structural-test framework as the repo's invariant-enforcement authority (so the next agent does not assume ESLint/Semgrep is the primary layer and propose redundant tooling) | documentation | YES (docs only) | section in `docs/code-quality.md` | none |

---

# Stop Condition Compliance

- Sections A through Q: produced.
- No production code modified.
- No tests modified.
- No DB schema modified.
- No CI modified.
- No ESLint config added (none exists; HR-1 forbids adding).
- No Semgrep rules persisted (temp files in `/tmp` only).
- No CodeQL queries added (CodeQL not executed).
- No protocol documentation updated.
- No commit created.
- Tracked repository state unchanged (verified below).

```
NEXT_RECOMMENDED_JOB: EXAM-STATIC-1
```

Rationale: EXAM-STATIC-1 (typed ESLint baseline) is the highest-leverage, lowest-risk addition — it closes the repo's largest tooling gap (no ESLint at all) and is the prerequisite for EXAM-STATIC-2, which closes the one confirmed defect (SA-01 / INV-016). EXAM-STATIC-3 and EXAM-STATIC-4 are independent, cheap, and close documented risks (#14, #12, INV-011) without touching production behavior.
