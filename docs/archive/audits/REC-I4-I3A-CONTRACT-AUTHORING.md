# REC-I4-I3A — Public Contract and Authoring Surface

## Status

`REC-I4-I3A IMPLEMENTED — READY FOR HUMAN REVIEW`

The public contract and authoring surface for ADR-013 interruption recovery is
implemented. All monorepo typechecks pass. `pnpm verify:static` and the full
`pnpm verify` gate (workspace coverage + build) pass.

## Base HEAD

```text
BASE_HEAD = a0c8b4dd34dbaba67196fcf5cc782a2d4f2eb20d
branch    = feat/rec-i4-i3a-contract-authoring
```

`a0c8b4dd` is the merge commit of PR #224 (REC-I4-I2 Engine Policy Seam),
which is the explicit starting point requested for this Job.

## Authority

1. `docs/adr/ADR-013-interruption-time-compensation-policy.md`
2. `docs/audits/REC-I4-R0-INTERRUPTION-TIME-POLICY.md`
3. `docs/audits/REC-I4-I1-DOMAIN-PERSISTENCE.md`
4. `docs/audits/REC-I4-I2-ENGINE-POLICY-SEAM.md`
5. Repository contract, testing, and code-quality standards

## Scope

This Job is the **contract + authoring** slice of REC-I4-I3. It freezes the
candidate-facing restore HTTP response contract, exposes the interruption
policy through Exam create/update authoring, enforces draft-only mutation and
ADR-013 cross-field validation, confirms attempt-snapshot immutability, removes
the last legacy restore/compensation test dependencies, and adds structural
regression tests.

## Files changed

### Contracts (`packages/contracts/src/`)

| File | Change |
|------|--------|
| `attempt.ts` | **EDITED** — added `RestoreLifecycleOutcomeEnum` and the frozen `RestoreAttemptResponseSchema` (`lifecycle` + candidate-safe `compensation` {policy, addedSeconds} + nested candidate-safe `attempt`); imports `InterruptionTimePolicySchema` |
| `exam.ts` | **EDITED** — `ExamSchema` DTO exposes `interruptionTimePolicy` + nullable caps; `CreateExamRequestBaseSchema` / `UpdateExamRequestBaseSchema` accept optional interruption authoring fields |
| `__tests__/contracts.test.ts` | **EDITED** — new tests covering Exam interruption authoring (strict/bounded_grace/operator_incident defaults + cross-field), `normalizeInterruptionPolicyConfiguration`, ExamSchema DTO projection, and the frozen `RestoreAttemptResponseSchema` (accept/reject/no-leak, including nested-compensation evidence stripping) |

### API (`apps/api/src/`)

| File | Change |
|------|--------|
| `routes/attempts.candidate.ts` | **EDITED** — restore route returns `RestoreAttemptResponseSchema`; projects `lifecycle` + `compensation.{policy, addedSeconds}` + nested candidate-safe attempt; does not project internal evidence |
| `routes/exam.ts` | **EDITED** — create route resolves interruption policy via `normalizeInterruptionPolicyConfiguration`; update route merges partial input with the existing exam policy and re-validates (draft-only); `toExamResponse` exposes the resolved fields |
| `routes/exam.test.ts` | **EDITED** — 7 new tests: default strict, explicit bounded_grace, cross-field rejection, draft update, published rejection (draft-only), partial-update cross-field merge |
| `routes/attempts/candidate-save-submit.test.ts` | **EDITED** — replaced the legacy "adjusted for disconnected time" test with ADR-013 bounded_grace per-incident-cap semantics + a strict zero-grant test; both use the new response contract |
| `runtime/interruption-recovery.structural.test.ts` | **EDITED** — new `REC-I4-I3A` describe block: frozen restore contract wiring, no-evidence-leak boundary, RestoreAttemptResponseSchema field shape, attempt-snapshot immutability (no update payload carries snapshot keys), Exam authoring field exposure, and a stronger legacy `restoreAttempt` / `disconnectedDuration` regression that scans production TypeScript only |

### Docs

| File | Change |
|------|--------|
| `docs/roadmap/current.md` | **EDITED** — REC-I4-I3A status |
| `docs/status/implementation-status.md` | **EDITED** — REC-I4-I3A contract + authoring surface |
| `docs/contracts/api-reference.md` | **EDITED** — restore endpoint contract + Exam interruption authoring fields; corrected stale "restore UI not productized" note |
| `docs/audits/REC-I4-I3A-CONTRACT-AUTHORING.md` | **NEW** — this closeout |

## 1. Frozen candidate restore HTTP response contract

ADR-013 §6 owns the domain contract; REC-I4-I3A owns the wire DTO. The frozen
contract is `RestoreAttemptResponseSchema`:

```ts
{
  lifecycle: "restored" | "already_in_progress" | "terminal",
  compensation: {
    policy: "strict" | "bounded_grace" | "operator_incident",
    addedSeconds: number, // integer >= 0
  },
  attempt: LoadAttemptResponse, // candidate-safe (standardAnswer/rubric stripped)
}
```

Design decisions:

- **Command acknowledgement, not page authority.** The candidate client
  re-reads the authoritative `CandidateTakeSnapshot` via GET after this returns
  (ADR-012 / REC-I3, preserved in `useAttemptRestore.ts:214-228`). The restore
  POST response is therefore a thin acknowledgement, which made changing its
  shape safe for the existing frontend.
- **`terminal` is a legitimate 200 lifecycle outcome.** When the attempt is
  already terminal on entry, or when deadline reconciliation submits the
  attempt during the restore transaction, the engine returns
  `lifecycle: "terminal"` as a normal result (not a thrown error). The
  response contract therefore includes `"terminal"` in the lifecycle enum
  and returns 200 with the terminal attempt state. The client re-reads the
  authoritative snapshot via GET (which confirms the terminal state).
- **No internal evidence leak.** The compensation object exposes only `policy`
  and `addedSeconds`. It deliberately omits the interruption episode id,
  detected-event evidence, adjustment-ledger row id, `eligibleSeconds`,
  before/after deadline, and `reasonCode`. A contract test asserts a payload
  carrying those keys is stripped on parse.

## 2. Exam interruption policy authoring surface

The interruption policy is now an authoring field on Exam create/update,
reusing the I1 `normalizeInterruptionPolicyConfiguration` for ADR-013
cross-field validation:

- `strict` / `operator_incident` ⇒ both caps null;
- `bounded_grace` ⇒ both caps present, positive integers, `perIncident <= perAttempt`;
- omitted ⇒ `strict` with null caps.

The `ExamSchema` DTO exposes the resolved `interruptionTimePolicy` (NOT NULL,
`strict` default) and nullable caps. The create route resolves and persists;
the update route merges the partial input with the existing exam's resolved
policy and re-validates.

## 3. Draft-only mutation

Interruption policy is a substantive authoring field. The existing ADR-005
Slice 2 §3.7 published-state guard already rejects any non-schedule field on a
published exam (`ExamUpdateNotAllowedError`); the interruption fields are not
in the schedule allow-list, so a published-exam update carrying them is
rejected. An integration test locks this in. Draft exams accept full edits.

## 4. Attempt policy snapshot immutability

Confirmed by source inspection and a structural regression test: the
`interruptionTimingPolicySnapshot` is written **only** at attempt creation
(`startOrRestoreAttempt`'s `attemptRepo.create` call,
`attemptCommands.ts:260`). None of the 8 `attemptRepo.update` call sites in
the engine carry any snapshot key — they touch only `status`, `deadlineAt`,
`lastActivityAt`, `currentInterruptionId`, `interruptedAt`,
`submittedAnswers`, `submissionReason`, `gradingStatus`, `misconduct`, and
grading fields. A structural test scans every `update()` payload in
`attemptCommands.ts` and `restoreInterruption.ts` and fails if any snapshot
key appears. ADR-013 §3: existing attempts must not change behavior when an
administrator later changes the Exam row.

## 5. No internal evidence / adjustment ledger in candidate responses

The frozen contract (§1) and a contract test enforce this. Internal
interruption evidence (episode id, detected event, adjustment ledger rows,
`eligibleSeconds`, `reasonCode`, operator/system-incident attribution) remains
server-side authority. The operator grant route, `Permission.AttemptTimeGrant`,
and the system incident model are explicit non-goals (REC-I4-I3B / REC-I6).

## 6. Legacy restoreAttempt / disconnectedDuration removal

The production legacy `restoreAttempt` function and `disconnectedDuration`
compensation were already removed in REC-I4-I2 (the I2 audit noted the legacy
function was retained for reference, but no production route imported it; the
merged PR #224 removed it entirely — only historical comments remain). This
Job removes the last **test** dependency on legacy behavior:

- `candidate-save-submit.test.ts` "restores with deadlineAt adjusted for
  disconnected time" asserted the pre-ADR-013 full-gap extension. It is
  replaced with an ADR-013 bounded_grace per-incident-cap test (grant capped
  at the snapshot's perIncident cap, not the full disconnected duration) and a
  strict zero-grant test, both using the new response contract.

## 7. Structural regression tests

The `REC-I4-I3A` describe block in
`interruption-recovery.structural.test.ts` adds 7 guards:

1. restore route returns `RestoreAttemptResponseSchema` as the 200 response;
2. restore route projects `compensation.{policy, addedSeconds}` only (no
   evidence leak);
3. `RestoreAttemptResponseSchema` compensation object omits internal fields;
4. attempt timing-policy snapshot is never in an `update()` payload;
5. Exam create/update contracts expose interruption authoring fields;
6. exam create/update routes normalize interruption policy;
7. no production code reintroduces legacy `function restoreAttempt` or
   `disconnectedDuration` (broader than the I2 guard: scans production `.ts`
   across engine, api, contracts, db, and domain).

## Non-goals reaffirmed

- No operator grant route.
- No `Permission.AttemptTimeGrant`.
- No system incident model (`incidentId` remains nullable/reserved).
- No Redis.
- No proctor recovery UI.
- No broad frontend redesign (the restore hook already treats the POST as a
  command acknowledgement and re-reads via GET, so the contract change is
  transparent to it).

## Verification

```text
pnpm --filter @exam/contracts build
pnpm --filter @exam/contracts typecheck
pnpm --filter @exam/api typecheck
pnpm --filter @exam/web typecheck
pnpm typecheck
pnpm --filter @exam/contracts test -- contracts.test.ts
pnpm --filter @exam/exam-engine test -- restoreInterruption.test.ts interruptionPolicy.test.ts
pnpm --filter @exam/api test -- candidate-save-submit.test.ts interruption-recovery.structural.test.ts exam.test.ts
pnpm format:check
pnpm lint
pnpm lint:eslint
pnpm lint:arch
pnpm lint:copy
pnpm verify:static
pnpm verify
```

Focused-test results at audit time (totals reflect the full `@exam/contracts`
and `@exam/api` suites run with the focused files above; the per-file
`contracts.test.ts` run is 127 passed):

- contracts (`@exam/contracts`): 292 passed
- exam-engine (`restoreInterruption.test.ts` + `interruptionPolicy.test.ts`): 443 passed
- api (`candidate-save-submit.test.ts` + `interruption-recovery.structural.test.ts` + `exam.test.ts`, full suite): 1645 passed | 5 skipped

The authoritative result for any future re-run is the CI summary
(`pnpm verify:static` / `pnpm verify`); per-file "N new" breakdowns are not
maintained here because they rot between commits.

## Known limitations

1. The operator grant route, `Permission.AttemptTimeGrant`, and the system
   incident model remain deferred (REC-I4-I3B / REC-I6). Candidate restore
   under `operator_incident` grants zero seconds; an authorized operator grant
   is a separate future command.
2. The Exam authoring UI for interruption policy is not built (the API
   authoring surface is; a broad frontend redesign is an explicit non-goal).
3. PostgreSQL concurrency closeout (REC-I4-V1) remains the final verification
   Job for the runtime paths this contract surfaces.

## Next Job

`REC-I4-I3B` (operator grant route + `Permission.AttemptTimeGrant`) or
`REC-I4-V1` (PostgreSQL concurrency closeout), per the roadmap.
