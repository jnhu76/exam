# Operator Grant Counterexamples

REC-I4-F1 expected-counterexample configurations.

Each config enables exactly one legacy-defect flag and checks exactly one
target invariant. The runner accepts only the named violation. Pass, a wrong
violation, temporal/deadlock failure, spawn failure, or tool error is failure.

## Server counterexamples

| Config | Legacy flag | Expected violation |
| --- | --- | --- |
| `ServerLegacyDuplicateEffect.cfg` | `LegacyDuplicateEffect` | `AtMostOneLedgerPerOperation` |
| `ServerLegacyPartialCommit.cfg` | `LegacyLedgerOnlyCommit` | `LedgerImpliesExactlyOneEffect` |
| `ServerLegacyDeadlineOnlyCommit.cfg` | `LegacyDeadlineOnlyCommit` | `EffectImpliesExactlyOneLedger` |
| `ServerLegacyWrongConflictOutcome.cfg` | `LegacyWrongConflictOutcome` | `DifferentCommandReturnsIdempotencyConflict` |
| `ServerLegacyTerminalGrant.cfg` | `LegacyTerminalGrant` | `TerminalAttemptNeverGranted` |
| `ServerLegacyRetryDuplicateApply.cfg` | `LegacyRetryDuplicateApply` | `RetryDoesNotApplyAgain` |

The duplicate action inserts a real second ledger fact. The two partial-commit
configs cover both ledger-only and deadline-only directions. The retry defect
increments one Attempt's application count from `1` to `2`.

## Client counterexamples

| Config | Legacy flag | Expected violation |
| --- | --- | --- |
| `ClientLegacyPerTabPending.cfg` | `LegacyPerTabPending` | `AtMostOneUnresolvedCommandPerWorkflow` |
| `ClientLegacyNewIdentityAfterLoss.cfg` | `LegacyNewIdentityAfterLoss` | `IndeterminatePreservesCommandIdentity` |
| `ClientLegacyMutableRetry.cfg` | `LegacyMutableRetry` | `FrozenCommandImmutable` |
| `ClientLegacyTerminalAsGranted.cfg` | `LegacyTerminalAsGranted` | `TerminalNeverReportedAsGranted` |

`LegacyMutableRetry` preserves operationId and changes payload. The terminal
defect sets authoritative `serverOutcome[t] = "terminal"` while projecting
`"granted"`.

## Rules

- Legacy flags change actions only; properties never reference them.
- Each config checks one invariant to produce a focused trace.
- Absence of the named violation is failure.
- Temporal, deadlock, parse, semantic, JVM, spawn, and undefined-symbol errors
  are never accepted as expected counterexamples.
