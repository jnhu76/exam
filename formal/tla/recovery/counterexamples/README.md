# Expected-Counterexample Configurations

Each `.cfg` in this directory enables exactly one legacy-defect flag and
points TLC at the invariant/property that the defect violates. The target
configurations set every legacy flag to `FALSE`; these configs set exactly
one to `TRUE`.

**All four reproduce the named violation** under the committed runner. The
legacy flag changes ACTION behavior only — it never appears in a property.

Run via:

```bash
TLA2TOOLS_JAR=/path/to/tla2tools.jar pnpm formal:recovery:counterexamples
```

## Evidence policy (binding)

The runner treats each counterexample result as exactly one of:

- **EXPECTED_VIOLATION** — TLC reports the *expected* named violation. The
  counterexample is reproduced. (suite: ok)
- **FAILED** — TLC reports no violation, a DIFFERENT violation, or a tool
  error. This is a **hard failure** (runner exits non-zero). An expected-
  negative config MUST produce the named violation; absence is failure.

An arbitrary non-zero TLC exit is **never** treated as expected success.

## Per-defect record

### LegacyWrongAttemptRestore.cfg

- **Spec**: `RouteSwitchSpec` (cross-attempt; NavigateTo enabled)
- **Legacy flag**: `LegacyWrongAttemptCapability = TRUE`
- **Buggy action**: `StartRestore` skips the `clientSnapshotAttempt = routeAttempt`
  capability gate, so a restore for B can be initiated from A's applied snapshot.
- **Caught by**: `NoWrongAttemptRestore` (INVARIANT)
- **Runtime coverage**: `TakeExamPage.restore.test.tsx` Case 8.

Intended normalized trace:

```text
route = A; clientSnapshotAttempt = A (applied)
NavigateTo(B)
StartRestore with LegacyWrongAttemptCapability → snapshotAttempt = A, attemptId = B
→ NoWrongAttemptRestore violated (r.snapshotAttempt # r.attemptId)
```

### LegacyGlobalInFlight.cfg

- **Spec**: `RouteSwitchSpec`
- **Legacy flag**: `LegacyGlobalInFlight = TRUE`
- **Buggy action**: `StartRestore` uses `RestoreStartGuard = ~AnyRestoreInFlight`
  (global) instead of `~RestoreInFlightForRoute` (per-attempt). An in-flight
  restore for A blocks a legal restore for B.
- **Caught by**: `NoCrossAttemptRestoreBlocking` (INVARIANT — enabledness safety)
- **Runtime coverage**: `TakeExamPage.restore.test.tsx` Case 8 + the
  generation-token fix in `useAttemptRestore.ts`.

Intended normalized trace:

```text
route = A; StartRestore for A (request r0 in restoreRequests)
NavigateTo(B)  [restoreRequests preserved: {r0, attemptId=A, gen=old}]
B is resumable; page load for B applied; clientSnapshotAttempt = B
RestoreStartBaseConditions holds for B:
  ~RestoreInFlightForRoute = TRUE (r0 has attemptId=A, gen=old ≠ current)
But ENABLED StartRestore = FALSE:
  legacy guard ~AnyRestoreInFlight = FALSE (r0 still in restoreRequests)
→ NoCrossAttemptRestoreBlocking violated (invariant fails at this state)
```

Note: NavigateTo preserves `restoreRequests` in BOTH target and legacy modes.
The A/B comparison is clean: same reachable state, only the guard differs.
Under target, `~RestoreInFlightForRoute = TRUE` → StartRestore ENABLED → PASS.

### LegacyStalePageLoad.cfg

- **Spec**: `RouteSwitchSpec`
- **Legacy flag**: `LegacyApplyStalePageLoad = TRUE`
- **Buggy action**: `ApplyAuthoritativeReload` skips the `IsCurrent(d)` gate,
  so a stale (old route/generation) delivery becomes the applied snapshot.
- **Caught by**: `NoStalePageLoadApply` / `NoStaleRestoreApply` (INVARIANTs)
- **Runtime coverage**: Case 8 covers the cross-attempt restore chain; a
  dedicated late-old-page-GET test is a recommended follow-up.

Intended normalized trace:

```text
page GET for A in flight; response frozen with A's state
NavigateTo(B)
A's late delivery applied (IsCurrent gate skipped under legacy flag)
clientSnapshotAttempt = A, routeAttempt = B
→ NoStalePageLoadApply violated (applied snapshot # current route)
```

### LegacyNoReloadAfterPostFailure.cfg

- **Spec**: `CoreSpec`
- **Legacy flag**: `LegacySkipReloadAfterPostFailure = TRUE`
- **Buggy action**: the flag adds `LegacyApplyPostOutcome` — when the
  authoritative GET is skipped, the POST restore ack alone drives the UI to
  editable (`lastSnapshotViaGet' = FALSE`).
- **Caught by**: `PostOutcomeIsNotPageAuthority` (INVARIANT)
- **Runtime coverage**: `TakeExamPage.restore.test.tsx` Cases 11 (409) and
  12 (lost POST → GET wins).

Intended normalized trace:

```text
StartRestore; ProcessRestore; uiState = "restoring"
reload skipped (LegacySkipReloadAfterPostFailure)
LegacyApplyPostOutcome consumes the restore delivery, sets uiState = "editable",
lastSnapshotViaGet' = FALSE
→ PostOutcomeIsNotPageAuthority violated (editable without lastSnapshotViaGet)
```

## Do not commit raw TLC work directories

The runner writes all TLC state under `formal/.work/recovery/ce_<config>/`,
which is git-ignored. Counterexample traces are evidence of the model's
behavior at a point in time, not source authority — they are not committed.
The normalized trace above is the canonical record.
