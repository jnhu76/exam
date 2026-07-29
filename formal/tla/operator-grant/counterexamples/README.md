# Operator Grant Counterexamples

REC-I4-F1 expected-counterexample configurations.

Each config enables exactly ONE legacy-defect flag and checks exactly ONE
target invariant. The runner (`scripts/formal/run-operator-grant-tlc.mjs
counterexamples`) verifies that TLC reports the named violation — any other
outcome (pass, wrong violation, tool error) is treated as failure.

## Server counterexamples (OperatorGrantServer.tla)

| Config | Legacy flag | Expected violation |
| --- | --- | --- |
| ServerLegacyDuplicateEffect.cfg | LegacyDuplicateEffect | AtMostOneDeadlineEffectPerOperation |
| ServerLegacyPartialCommit.cfg | LegacyPartialCommit | LedgerAndDeadlineCommitAtomically |
| ServerLegacyWrongConflictOutcome.cfg | LegacyWrongConflictOutcome | DifferentCommandReturnsIdempotencyConflict |
| ServerLegacyTerminalGrant.cfg | LegacyTerminalGrant | TerminalAttemptNeverGranted |

## Client counterexamples (OperatorGrantClient.tla)

| Config | Legacy flag | Expected violation |
| --- | --- | --- |
| ClientLegacyPerTabPending.cfg | LegacyPerTabPending | AtMostOneUnresolvedCommandPerWorkflow |
| ClientLegacyNewIdentityAfterLoss.cfg | LegacyNewIdentityAfterLoss | IndeterminatePreservesCommandIdentity |
| ClientLegacyMutableRetry.cfg | LegacyMutableRetry | FrozenCommandImmutable |
| ClientLegacyTerminalAsGranted.cfg | LegacyTerminalAsGranted | TerminalNeverReportedAsGranted |

## Rules

- Legacy flags change ACTION behavior only — they NEVER appear in properties.
- Each config checks a single invariant to produce a focused trace.
- A counterexample that does NOT reproduce the named violation is a failure.
- Parse/semantic/OOM/undefined-symbol errors are never masked as expected.
