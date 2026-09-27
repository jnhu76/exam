# ADR-021 — Exam Semantic Authority Adoption

## Status

**Accepted (2026-09-27).** This ADR adopts
[`docs/architecture/exam-semantic-boundaries.md`](../architecture/exam-semantic-boundaries.md)
as the normative body for cross-boundary Exam semantics and records the precise
supersession of stale assertions. It does not choose new semantics and does not
supersede any mechanism ADR as a whole.

## Context

Issues [#640](https://github.com/jnhu76/exam/issues/640) (architecture audit)
and [#641](https://github.com/jnhu76/exam/issues/641) (semantic inventory)
surfaced recurring cross-boundary questions — question mutability after publish,
snapshot authority transfer, unpublish residue, candidate secret boundaries,
identity liveness, stored-vs-effective status, representable-vs-supported
capabilities, and the correctness-authority of `options.isCorrect`. A final
semantic closure review (2026-09-27, baseline
`347d3a44a0b60c833cf7b7f08768979b01972b9d`) resolved all seven decision areas
(D1–D7) with zero remaining product decisions and zero remaining semantic
ambiguities, and concluded `READY_TO_FREEZE_EXAM_SEMANTICS = YES`.

Before this adoption those decisions existed only in the issue bodies and the
closure report. Issues and reviews are evidence, not a resident normative
root: a future maintainer had no navigable in-repo authority answering "who
owns the fact, when does it freeze, what may a Candidate observe". That gap
is what allowed documentation drift (stale command names, reserved values
presented as wired, phase-specific implementation statements in ADR-008) to
accumulate.

## Decision

1. **Adopt the semantic-boundaries document as the normative body.**
   `docs/architecture/exam-semantic-boundaries.md` is the single canonical
   carrier of the frozen cross-boundary Exam semantics. Its EXSEM-001..020
   clauses are the current frozen semantics for fact ownership, authority
   transfer and freeze points, legitimately live facts, non-authoritative
   residue, candidate-observable boundaries, effective-state determination,
   and the supported-capability definition.
2. **D1–D7 are resolved.** The seven decision areas from the closure review
   (question mutability and snapshot authority; unpublish residue; candidate
   secret boundary and gradingRule visibility; identity liveness; stored vs
   effective status; representability vs support; correctness authority) are
   settled. Their frozen forms are recorded in the boundaries document §4;
   this ADR does not restate them.
3. **Evidence roles.** Issues #640/#641, the 2026-09-27 closure report, prior
   audits, and archive material are decision history and evidence. They are
   not normative authority and must not be cited as such; the boundaries
   document and the ADR/contract/doc corpus are.
4. **Supersession rule.** Changing a frozen EXSEM clause requires an explicit
   superseding architecture decision that names the affected clauses, defines
   the replacement meaning, states compatibility/migration impact, and
   identifies exactly what is superseded; unnamed clauses remain in force.
   Code, tests, comments, schema representability, and stored reserved values
   cannot silently redefine frozen semantics. The full rule lives in the
   boundaries document §6; it introduces no new approval bureaucracy.
5. **Division of authority.** Mechanism ADRs (ADR-005 reconcile-under-lock,
   ADR-006 time authority, ADR-008 submit serialization, ADR-012 recovery,
   ADR-013 compensation, ADR-014 incidents, …) keep their specific decisions
   except where precisely superseded below. `exam-runtime.md` remains the
   runtime command/state authority; SPEC, contracts, and OpenAPI remain the
   product/API format authorities. Navigation is registered in
   [`docs/README.md`](../README.md).

## Precisely superseded assertions

| Superseded assertion | Where it lived | Superseded by |
| --- | --- | --- |
| Phase-2 scope statements: no submitted-answer snapshot column is needed because `answers` is immutable post-submit; terminal grading directly consumes the locked draft answers (the rejected `submittedAnswerSnapshot` row's "redundant" rationale and the J1 scope text) | [ADR-008](ADR-008-submit-answer-freeze.md) Decision/Rejected-alternatives | EXSEM-008..010: submit freezes `submitted_answers` and materializes `attempt_grading_entries`; terminal aggregation consumes entries. Scoped note added to ADR-008; its still-valid save/submit concurrency, single-transaction, and no-final-input-barrier semantics remain in force |
| `voidAttempt` presented as a current command / `attempt.voided` as a currently produced audit event | `exam-runtime.md` §3.4/§11, `CONTEXT.md` | EXSEM-019: `voided` is reserved vocabulary with no production writer |
| Stale attempt command names (`startAttempt`, `resumeAttempt`, `restoreAttempt`, legacy `gradeAttempt`) presented as current | `SPEC.md` §2.2/§3.3, `exam-runtime.md` §3.4 | Current engine commands (`startOrRestoreAttempt`, `restoreAttemptState`/`restoreInterruptedAttempt`, `submitAttempt`, `saveAnswer`, `markDisrupted`, `gradeQuestion`); see `exam-runtime.md` §3.4 |
| Save rejected outside `in_progress` with `ATTEMPT_NOT_EDITABLE`; submit precondition `in_progress` only | `exam-runtime.md` §3.4/§4.3 | As-built save/submit guards: `voided`→`ATTEMPT_CLOSED`, `submitted`/`graded`→`ATTEMPT_ALREADY_SUBMITTED`, deadline→`DEADLINE_EXCEEDED`; submit accepts `in_progress`/`disrupted` (EXSEM-007; UI editability remains governed by isEditable/ADR-012) |
| `QuestionSnapshot` documented without `contentDocument`/`answerMode`/`rubric` | `SPEC.md` §3.6 | As-built snapshot fields (EXSEM-005; `packages/domain` `QuestionSnapshot`) |
| `random` selection described as "Phase 2 planned"; `queued` presented as a wired state | `exam-system/domain-model.md`, `exam-runtime.md` §3.1 | EXSEM-019: publish gate requires `questionSelectionMode=manual`; `queued` has no writer, admission is modeled by `exam_admissions` |

Not superseded by this ADR: the D3b contract repair (narrowing candidate
`gradingRule` output, an intentional external response change) and the other
conformance repairs authorized by the closure review. `GRADING_RULE_VISIBILITY
= HIDDEN_ON_ALL_CURRENT_CANDIDATE_QUESTION_SURFACES` is the adopted semantic;
aligning the load-path implementation to it is deferred conformance work, not
a semantic question.

## Consequences

- A future maintainer or coding agent can answer "where is the cross-boundary
  Exam semantic authority?" from `docs/README.md` without searching #640/#641.
- Documentation must conform to EXSEM clauses and link to them rather than
  duplicating them; the living-doc repairs listed above land in the same
  change as this adoption.
- Post-adoption drift is a defect: implementation behavior changes no longer
  silently redefine semantics, and reserved values cannot become active
  without an explicit superseding decision.
- No production behavior is changed by this ADR itself.

## Evidence

- Decision history: Issue [#640](https://github.com/jnhu76/exam/issues/640),
  Issue [#641](https://github.com/jnhu76/exam/issues/641), and the 2026-09-27
  semantic closure decision report they produced (CONDITIONAL_PASS,
  D1–D7 resolved, EXSEM-001..020 frozen).
- Normative body:
  [`docs/architecture/exam-semantic-boundaries.md`](../architecture/exam-semantic-boundaries.md).
- Scoped ADR-008 supersession note:
  [ADR-008](ADR-008-submit-answer-freeze.md) Status section.
