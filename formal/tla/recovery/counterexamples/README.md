# Expected-Counterexample Configurations

Each `.cfg` in this directory enables exactly one legacy-defect flag and
points TLC at the invariant that defect would violate. The target
configurations (`RecoveryProtocolSafety.cfg`, `RecoveryProtocolLiveness.cfg`)
set every legacy flag to `FALSE`; these configs set exactly one to `TRUE`.

Run them via:

```bash
TLA2TOOLS_JAR=/path/to/tla2tools.jar pnpm formal:recovery:counterexamples
```

## Evidence policy (binding)

The runner (`scripts/formal/run-recovery-tlc.mjs`) treats each
counterexample result as exactly one of:

- **EXPECTED_VIOLATION** — TLC reports the *expected* named invariant
  violated. The counterexample is reproduced. (suite: ok)
- **NOT_REPRODUCED** — TLC reports no violation under the finite model.
  This is a **documented gap**, reported plainly, NOT a silent success.
  (suite: ok — but flagged for human review)
- **FAILED** — TLC reports a *different* invariant violated, or a tool error
  (syntax / Java / OOM / unexpected exception). This is a **hard failure**;
  the runner never masks it as expected. (suite: fail)

An arbitrary non-zero TLC exit is **never** treated as expected success.

## Current status: NOT REPRODUCED (documented finite-model gap)

All four counterexamples currently return NOT_REPRODUCED. The reason is a
**deliberate state-space constraint**, not a missing defect:

- The cross-attempt counterexamples (`LegacyWrongAttemptRestore`,
  `LegacyGlobalInFlight`, `LegacyStalePageLoad`) require a route change to
  produce the mismatched-attempt / stale-generation state.
- `NavigateTo` is excluded from the safety `Next` because including it
  caused the state space to exceed 10^6 distinct states within seconds
  (even with stale requests and deliveries cleared on navigation).
- Without `NavigateTo`, the cross-attempt race is unreachable, so enabling
  the legacy flag alone does not produce the violation.

The `LegacyNoReloadAfterPostFailure` counterexample additionally requires
the model to encode the *buggy* transition (the legacy client selecting
page state directly from the POST outcome). The current model only models
the TARGET behavior and uses the flag to *bypass* the target guard; it
does not add the buggy transition. That is a modeling gap, recorded here.

These configs are preserved as expected-negative models so that a future
state-space optimization (TLC symmetry sets over `Attempts`, a bounded
`NavigateTo` variant, or direct buggy-transition modeling) can reproduce
them without redesigning the configuration surface.

## Per-defect record

### LegacyWrongAttemptRestore.cfg

- **Legacy flag**: `LegacyWrongAttemptCapability = TRUE`
- **Expected violated property**: `NoWrongAttemptRestore`
- **Why it is a real bug class**: a restore command for attempt B must
  never be initiated from a snapshot/capability belonging to attempt A.
  The REC-I3 implementation guards this via `clientSnapshotAttempt =
  routeAttempt` in `useAttemptRestore.ts`.
- **Runtime coverage**: `TakeExamPage.restore.test.tsx` Case 8 (real router
  navigation — stale att-old restore does not affect att-new page).

Intended normalized trace:

```text
route = B
client snapshot belongs to A
restore is sent to B using A's capability
→ NoWrongAttemptRestore violated (snapshotAttempt # attemptId)
```

### LegacyGlobalInFlight.cfg

- **Legacy flag**: `LegacyGlobalInFlight = TRUE`
- **Expected violated property**: `NoCrossAttemptRestoreBlocking`
- **Why it is a real bug class**: the PR #219 review found that a shared
  global `cancelledRef`/in-flight boolean could let an in-flight restore
  for A block a legal restore for B. The fix is the per-attempt guard
  (`RestoreInFlightForRoute` keys on `r.attemptId = routeAttempt`).
- **Runtime coverage**: `TakeExamPage.restore.test.tsx` Case 8; the
  generation-token fix in `useAttemptRestore.ts`.

Intended normalized trace:

```text
A restore remains in flight for A
route changes to resumable B
B cannot begin restore (legacy global in-flight bit blocks it)
```

### LegacyStalePageLoad.cfg

- **Legacy flag**: `LegacyApplyStalePageLoad = TRUE`
- **Expected violated property**: `NoStalePageLoadApply`
- **Why it is a real bug class**: a page-load response from an older route
  generation must never replace the snapshot for the current route. The
  REC-I3 fix is the generation-token check at apply time
  (`ApplyAuthoritativeReload` gates on `IsCurrent(d)`).
- **Runtime coverage**: partial — Case 8 covers the cross-attempt restore
  chain; a dedicated late-old-page-GET test is a recommended follow-up.

Intended normalized trace:

```text
A page GET starts for attempt A
route changes to B
B response is applied
late A response arrives
A response overwrites or invalidates B
```

### LegacyNoReloadAfterPostFailure.cfg

- **Legacy flag**: `LegacySkipReloadAfterPostFailure = TRUE`
- **Expected violated property**: `PostOutcomeIsNotPageAuthority`
- **Why it is a real bug class**: a POST success, 409-like result, timeout,
  or lost response cannot directly select editable/terminal page state.
  REC-I3 always re-reads the authoritative snapshot after the POST
  (`useAttemptRestore.ts` performs the GET regardless of POST outcome).
- **Runtime coverage**: `TakeExamPage.restore.test.tsx` Cases 11 (409) and
  12 (lost POST response — GET in_progress wins).

Intended normalized trace:

```text
server processes restore or terminal reconciliation
POST response is lost / ambiguous
client fails without an authoritative GET
→ page state selected directly from POST outcome
```

## Recommended follow-up

To reproduce these counterexamples mechanically, the model needs one of:

1. a **bounded `NavigateTo`** with TLC symmetry sets over `Attempts` (the two
   attempts are interchangeable), reducing the cross-attempt state graph; or
2. **direct buggy-transition modeling** behind each legacy flag (e.g., a
   `LegacyApplyPostOutcome` action that sets `uiState` directly when
   `LegacySkipReloadAfterPostFailure` is TRUE); or
3. a separate, smaller **counterexample-only model** that includes
   `NavigateTo` and runs each negative config in isolation.

Until then, the counterexample suite reports NOT_REPRODUCED plainly, and
the runtime tests listed above remain the binding evidence that the bug
classes are guarded in the implementation.

## Do not commit raw TLC work directories

The runner writes all TLC state under `formal/.work/recovery/ce_<config>/`,
which is git-ignored. Counterexample traces (state sequences) are evidence
of the model's behavior at a point in time, not source authority — they are
not committed. The normalized trace above is the canonical record.
