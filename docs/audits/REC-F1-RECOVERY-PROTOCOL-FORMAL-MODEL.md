# REC-F1 — Recovery Protocol Formal Model (Implementation Closeout)

Authority: `docs/adr/ADR-012-candidate-recovery-contract.md` (binding).
Model: [`formal/tla/recovery/RecoveryProtocol.tla`](../../formal/tla/recovery/RecoveryProtocol.tla).
Runner: [`scripts/formal/run-recovery-tlc.mjs`](../../scripts/formal/run-recovery-tlc.mjs).

## Status

`REC-F1 MODEL CHECKED — READY FOR HUMAN REVIEW` (revised after PR #220 review)

The model was rewritten to address the review's blocking findings. The
current state:

- **Safety**: the three split target configs (`CoreSpec`, `RouteSwitchSpec`,
  `SubmissionSpec`) all PASS exhaustively. Properties are real cross-state
  constraints (no tautologies, no legacy-flag exemptions). `NavigateTo` IS
  in the route-switch Next (the cross-attempt race is exercised). Delivery
  records freeze server state at response time.
- **Counterexamples**: all 4 expected-negative configs reproduce the NAMED
  violation (legacy flags affect actions only; the buggy action violates
  the TARGET property).
- **Liveness**: PARTIAL (failed). The runner reports this as a FAILURE
  (exit non-zero); it is NOT wrapped as success. `formal:recovery:explore`
  provides a non-gated run.

This is the "READY FOR HUMAN REVIEW" form, not "COMPLETE" — liveness is
still PARTIAL, which disqualifies the strict "COMPLETE" bar.

## Stacked-PR context

```text
Stacked base branch : feat/rec-i3-disrupted-restore-ux
Stacked base HEAD   : 9c955dd821da0ca16ff2a847e97800b74972dc30
REC-F1 branch       : formal/rec-f1-recovery-protocol
PR base branch      : feat/rec-i3-disrupted-restore-ux  (NOT master — stacked on PR #219)
Dependency          : PR #219 (REC-I3) must merge first
Required post-merge : rebase REC-F1 onto master and change the PR base to master
Merge status        : NOT MERGED — STACKED ON PR #219
```

This is a **stacked PR** on top of PR #219 (REC-I3). Review only the
formal-model changes relative to `feat/rec-i3-disrupted-restore-ux`. After
PR #219 merges, this branch must be rebased onto the latest `master` and
the PR base changed to `master` before REC-F1 is merged.

## Base HEAD and branch

```text
BASE_BRANCH = feat/rec-i3-disrupted-restore-ux
BASE_HEAD   = 9c955dd821da0ca16ff2a847e97800b74972dc30
branch      = formal/rec-f1-recovery-protocol
```

## Purpose

Introduce a small, executable TLA+ model of the candidate recovery protocol
frozen by ADR-012 and implemented by REC-I3. The model is an executable
consistency check over selected concurrency, route-binding, snapshot-
authority, and terminal-monotonicity properties. It does NOT mechanically
verify that the TypeScript implementation is a refinement.

## Storage-location decision

```text
formal/                     executable specifications and model-checking inputs
formal/tla/recovery/        the recovery model + safety/liveness/counterexample .cfg
scripts/formal/             execution adapter (the runner)
docs/audits/REC-F1-*.md     this closeout
docs/architecture/exam-system/candidate-recovery.md  small link added
docs/README.md              Formal Models entry added
```

Rationale (recorded in `formal/README.md`): `formal/` holds executable
artifacts; `docs/` holds prose authority; `scripts/formal/` holds execution
adapters only; `apps/` and `packages/` hold production code; generated TLC
artifacts are never source authority and never committed. The TLA+ JAR is
never vendored — the runner reads `TLA2TOOLS_JAR` from the environment.

## Files inspected

```text
docs/adr/ADR-012-candidate-recovery-contract.md
docs/architecture/exam-system/candidate-recovery.md
docs/architecture/exam-system/state-and-authority.md
docs/audits/REC-R1-REALITY-AND-CONTRACT.md
docs/audits/REC-I3-IMPLEMENTATION.md

apps/web/src/exam/useAttemptRestore.ts
apps/web/src/exam/deriveTakeExamView.ts
apps/web/src/pages/exam/TakeExamPage.tsx
apps/web/src/pages/exam/TakeExamPage.restore.test.tsx
apps/api/src/routes/attempts.candidate.ts
packages/exam-engine/src/attemptCommands.ts
packages/exam-engine/src/attemptStateMachine.ts
packages/exam-engine/src/deadlineReconciliation.ts
packages/exam-engine/src/answerProtocol.ts
```

## Official sources consulted

- TLA+ tools and Toolbox repository: `https://github.com/tlaplus/tlaplus`
- v1.7.4 "The Xenophanes release" (latest stable; v1.8.0 is a pre-release):
  `https://github.com/tlaplus/tlaplus/releases/tag/v1.7.4`
- TLC option list, config-file format, exit-status semantics, fairness:
  Context7 `/tlaplus/tlaplus` (High reputation, authoritative). Confirmed
  `-config`/`-metadir`/`-workers`/`-deadlock`/`-cleanup`/`-difftrace`/
  `-nowarning`; non-zero exit on property violation; `.cfg` `INVARIANT`
  must reference a defined predicate name (not an expression); `CONSTANT`
  set assignment via `Name = {model values}`.
- TLA+ language reference (Leslie Lamport; `docs.tlapl.us`): record types,
  `SUBSET`, `[S -> T]` function sets, `WF_vars(Action)` fairness,
  `[][Next]_vars` stuttering.

## Context7 topics consulted

- TLA+ tools and Toolbox (`/tlaplus/tlaplus`): TLC CLI, config files,
  invariants, liveness, PlusCal, fairness options, exit status. Used as
  authoritative supporting evidence for TLC behavior.
- TLA+ (`/websites/lamport_azurewebsites_net_tla`), Learn TLA+
  (`/websites/learntla`), TLA+ Examples (`/tlaplus/examples`): consulted
  for idiom confirmation (record types, fairness, finite modeling).
- Node.js `child_process` `spawn` / `spawnSync`: confirmed argument-array
  form avoids shell interpolation; `close` event delivers exit code;
  streaming stdout/stderr via `'data'` listeners.

`CONTEXT7_NO_TLAPLUS_COVERAGE` was NOT recorded — Context7 provided
authoritative TLA+ coverage via `/tlaplus/tlaplus`.

## Toolchain version and checksum

| Field | Value |
|---|---|
| Release | The Xenophanes release, tag `v1.7.4` |
| TLC version | `TLC2 Version 2.19 of 08 August 2024 (rev 5a47802)` |
| Asset | `tla2tools.jar`, 2,274,532 bytes |
| Official SHA-1 (publisher-authenticated) | `bee4a54f3ee3d4afc347c3240ec2d9e93b075104` |
| Local SHA-1 (verified — matches published) | `bee4a54f3ee3d4afc347c3240ec2d9e93b075104` |
| Local SHA-256 (traceability only — NOT publisher-authenticated) | `936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88` |
| Java | OpenJDK 25.0.3 (TLA+ v1.7.4 supports Java 8 through 25) |
| Verification date | 2026-07-27 |

The official v1.7.4 release publishes a SHA-1 only; the SHA-256 is locally
computed for traceability and is explicitly NOT represented as publisher-
authenticated. See `formal/tla/TOOLCHAIN.md`.

## Model participants

Client, Server, Environment (see `formal/tla/recovery/README.md`).

## Variables

See `formal/tla/recovery/README.md` §Variables. The model captures the
required state: `serverStatus`, `serverVersion`, `submittedSnapshot`,
`routeAttempt`, `clientGeneration`, `clientSnapshot{Attempt,Gen,Editable}`,
`pageLoadRequests`, `restoreRequests`, `snapshotReloadRequests`,
`pendingDeliveries`, `uiState`, `networkUp`, `deadlinePassed`, `timeGrant`,
plus a `disruptedOnce` bound. A request record carries `requestId`,
`attemptId`, `generation`, `requestKind`, and `snapshotAttempt` (creation-
time binding). There is no single anonymous global `inFlight` bit.

## Actions

See `formal/tla/recovery/README.md` §Actions. The required client/navigation,
server, and environment actions are defined. Several are excluded from `Next`
for state-space finiteness (NavigateTo, MarkDisrupted, GrantExtension,
DelayResponse, DeliverResponse, NetworkDown/NetworkUp, Unmount) with the
rationale recorded in the `Next` comment and the model README. Out-of-order
delivery is exercised by `ApplyAuthoritativeReload` choosing any pending
delivery; loss is exercised by `LoseResponse`.

## Finite bounds

```text
Attempts      = {A, B}
Generations   = {g0, g1}
RequestIds    = {r0, r1, r2}
NetOutcomes   = {acknowledged, lost}   (defined in module, not cfg-assigned)
AnswerValues  = {ans0, ans1}
MAX_VERSION   = 3
MAX_GRANT     = 1
MarkDisrupted = once per attempt
```

No unbounded integers, timestamps, queues, or request-id spaces.

## Safety properties checked

```text
TypeOK
NoWrongAttemptRestore
NoStalePageLoadApply
NoStaleRestoreApply
EditableRequiresCurrentAuthoritativeSnapshot
TerminalNeverResurrects
SubmittedSnapshotImmutable
ServerVersionNeverDecreases
NoCrossAttemptRestoreBlocking
RestoreDoesNotDirectlyChangeDeadline
PostOutcomeIsNotPageAuthority
```

## Safety result

`MODEL_CHECKED` — three split target configs, all exhaustively verified.

```text
CoreSpec        (RecoveryProtocolSafety.cfg)             :   4,679 distinct, depth 25 — PASS
RouteSwitchSpec (RecoveryProtocolRouteSwitchSafety.cfg)  :  20,796 distinct, depth 26 — PASS (NavigateTo enabled)
SubmissionSpec  (RecoveryProtocolSubmissionSafety.cfg)   :  88,936 distinct, depth 26 — PASS
```

Properties are real cross-state constraints:

- `TerminalNeverResurrects`, `SubmittedSnapshotImmutable`,
  `ServerVersionNeverDecreases`, `TimeGrantNeverDecreases` are PROPERTYs
  (transition constraints `[][...]_vars`), not state predicates — they
  verify future behavior, not just the current state.
- `NoCrossAttemptRestoreBlocking` is an enabledness INVARIANT checked in
  the route-switch safety config: when per-route base conditions hold,
  `StartRestore` must be `ENABLED`. No fairness needed.
- `PostOutcomeIsNotPageAuthority` uses a `lastSnapshotViaGet` history
  variable so it actually distinguishes "editable via GET" from "editable
  via POST ack".
- No property references a legacy flag.

## Liveness properties checked

```text
CurrentResumableAttemptEventuallyProgresses
```

## Fairness assumptions

```text
WF_vars(StartPageLoad)
WF_vars(StartRestore)
WF_vars(ServerReturnSnapshot)
WF_vars(ProcessRestore)
WF_vars(RejectRestoreDeadlineWon)
WF_vars(StartAuthoritativeReload)
WF_vars(ApplyAnyAuthoritativeReload)
```

Plus the explicitly-documented environmental assumptions: network eventually
stays available (`networkUp = TRUE`, NetworkDown/Up excluded); user does not
navigate away (NavigateTo excluded from liveness Next); user does not unmount
(Unmount excluded); environment eventually delivers a non-lost authoritative
response (LoseResponse excluded from liveness Next — loss still verified for
safety).

## Liveness result

`PARTIAL` — `FAILED` (runner exit non-zero).

The runner reports liveness violation as FAILURE (not wrapped as success).
Under the current fairness TLC finds a counterexample. Use
`pnpm formal:recovery:explore` for a non-gated run.

```text
Liveness run: 14,653 distinct states — temporal property violated.
```

## State-space statistics

See "Safety result" and "Liveness result" above. Recorded: states generated,
distinct states, queue depth (0 at completion for safety), diameter (43 for
safety), runtime (~30s safety, ~3s liveness), worker count (1 liveness, 2
safety default), configuration (target safety/liveness .cfg), tool version
(TLC v2.19 / TLA+ v1.7.4).

## Expected-counterexample results

All four reproduce the named violation:

```text
LegacyWrongAttemptRestore       —  6 distinct — NoWrongAttemptRestore violated        ✓
LegacyGlobalInFlight            — 985 distinct — NoCrossAttemptRestoreBlocking violated (INVARIANT) ✓
LegacyStalePageLoad             — 44 distinct — NoStalePageLoadApply violated          ✓
LegacyNoReloadAfterPostFailure — 92 distinct — PostOutcomeIsNotPageAuthority violated ✓
```

Each legacy flag changes ACTION behavior only (never a property). The buggy
action it enables produces a state that violates the TARGET property. See
`formal/tla/recovery/counterexamples/README.md` for the per-defect record
and normalized traces.

## Counterexample summaries

See `formal/tla/recovery/counterexamples/README.md` for the per-defect
record (flag, expected violated property, normalized trace, why it is a real
bug class, runtime coverage). No raw TLC work directories are committed.

## Trace-to-runtime-test mapping

| Formal property / trace | Runtime evidence | Label |
| --- | --- | --- |
| NoWrongAttemptRestore | `TakeExamPage.restore.test.tsx` Case 8 (real router navigation — stale att-old restore does not affect att-new page) | TEST_PRESENT |
| NoStaleRestoreApply | `TakeExamPage.restore.test.tsx` Case 8 (cross-attempt stale restore isolation) | TEST_PRESENT |
| NoStalePageLoadApply | Case 8 covers the cross-attempt chain; a dedicated late-old-page-GET test is a recommended follow-up | TEST_MISSING |
| NoCrossAttemptRestoreBlocking | `TakeExamPage.restore.test.tsx` Case 8 + the generation-token fix in `useAttemptRestore.ts` | TEST_PRESENT |
| PostOutcomeIsNotPageAuthority | `TakeExamPage.restore.test.tsx` Cases 11 (409) and 12 (lost POST → GET wins) | TEST_PRESENT |
| TerminalNeverResurrects | `TakeExamPage.restore.test.tsx` Case 6 (deadline wins → terminal snapshot honored) | TEST_PRESENT |
| SubmittedSnapshotImmutable | ADR-008 engine tests (`submitAttempt` freeze barrier; `exam-engine` suite) | TEST_PRESENT_NOT_EXECUTED (not run in this PR — production code unchanged) |
| RestoreDoesNotDirectlyChangeDeadline | REC-I4 target; runtime mismatch documented below | RUNTIME_MISMATCH / TARGET_ONLY |

No tests were invented.

## Current runtime/model mismatches

1. **REC-I4 (time compensation) — RUNTIME_MISMATCH / TARGET_ONLY.** The
   current `restoreAttempt` (`packages/exam-engine/src/attemptCommands.ts`)
   computes `disconnectedDuration` and adjusts `deadlineAt` inside the
   restore command. The TARGET model separates `ProcessRestore` (lifecycle
   only) from `GrantExtension` (time); `TimeGrantNeverDecreases` plus the
   action model imply `ProcessRestore` does not change `timeGrant`. The
   current runtime violates this. This is the REC-I4 boundary, NOT a REC-F1
   finding and NOT fixed here (production code is out of scope).
2. **Liveness PARTIAL — OPEN_QUESTION.** See "Liveness result".

NavigateTo IS now in the route-switch Next (the prior "NavigateTo excluded"
abstraction has been removed). Counterexamples now reproduce.

## Limitations

- The model is an executable consistency check, not a refinement proof.
- Safety is exhaustively checked over a small finite domain; liveness is
  PARTIAL; counterexamples are not mechanically reproduced.
- The fingerprint collision probability for safety (5.3E-7 optimistic) is
  non-zero but well below the threshold where undetected state collisions
  would plausibly mask a violation.
- Integration/E2E (`pnpm test:integration`, `pnpm test:e2e`, `pnpm verify`)
  were NOT executed — production code is unchanged; the formal check is
  not part of the default `pnpm verify` or CI in REC-F1.

## Commands executed

```bash
git status --short
git branch --show-current
git rev-parse HEAD
git log -12 --oneline
git switch -c formal/rec-f1-recovery-protocol

# Toolchain download + verify (proxy http://127.0.0.1:7897):
https_proxy=http://127.0.0.1:7897 curl -L -o tla2tools.jar \
  https://github.com/tlaplus/tlaplus/releases/download/v1.7.4/tla2tools.jar
sha1sum tla2tools.jar    # bee4a54f3ee3d4afc347c3240ec2d9e93b075104

# Formal checks via the committed runner:
TLA2TOOLS_JAR=… pnpm formal:recovery:safety         # PASS
TLA2TOOLS_JAR=… pnpm formal:recovery:liveness       # PARTIAL
TLA2TOOLS_JAR=… pnpm formal:recovery:counterexamples # 4 × NOT_REPRODUCED (documented)

# Static validation:
pnpm format:check
pnpm lint:md (changed files)
git diff --check
git status --short
```

## Validation results

- `pnpm formal:recovery:safety` — PASS (exit 0; CoreSpec).
- `pnpm formal:recovery:safety:route` — PASS (exit 0; RouteSwitchSpec, NavigateTo enabled).
- `pnpm formal:recovery:safety:submission` — PASS (exit 0; SubmissionSpec).
- `pnpm formal:recovery:counterexamples` — PASS (exit 0; 4/4 EXPECTED_VIOLATION).
- `pnpm formal:recovery:liveness` — FAILED (exit 1; PARTIAL — property violated,
  reported as failure, NOT wrapped as success).
- `pnpm formal:recovery:explore` — exit 0 (non-gated; for inspecting PARTIAL).
- `pnpm format:check`, `pnpm lint:md` on changed files, `git diff --check`:
  see "Static validation" below.

### Runner exit-code policy (revised after PR #220 review)

```text
formal:recovery:safety / :safety:route / :safety:submission
  target config pass                → 0
  target config violation / tool err → non-zero
formal:recovery:liveness
  property holds                    → 0
  property violated (PARTIAL)       → non-zero
formal:recovery:counterexamples
  every config reproduces the named → 0
  any config missing/wrong violation → non-zero
formal:recovery
  any required check unsatisfied    → non-zero
formal:recovery:explore
  non-gated                         → always 0
```

Failures are never wrapped as success.

## Deferred work

1. Refine the deadline/restore UI interaction so liveness holds under
   fairness (make `RejectRestoreDeadlineWon` transition `uiState` to a
   state from which the reload GET provably fires; bound
   `DeadlineReconcile` against repeated re-freezing).
2. Reproduce the expected counterexamples mechanically — requires a bounded
   `NavigateTo` (TLC symmetry sets over `Attempts`) or direct buggy-
   transition modeling behind each legacy flag, or a separate smaller
   counterexample-only model.
3. Consider adding the formal check to CI as a follow-up decision after the
   liveness and counterexample gaps are addressed.

## Next recommended Job

REC-I4 (Interruption and time-compensation policy) remains the next
runtime-authority Job. It is technically independent of REC-F1 and would
close the `RestoreDoesNotDirectlyChangeDeadline` RUNTIME_MISMATCH documented
above. A separate, smaller formal follow-up could address the liveness
PARTIAL result and the counterexample reproduction gap; it should NOT be
combined with REC-I4 (formal modeling and runtime remediation remain
separate).

## Explicit non-goals (REC-F1)

```text
mechanically verify the TypeScript implementation is a refinement of the model
modify apps/**, packages/**, database schema, API routes, contracts
modify REC-I3 runtime tests or restore/time-compensation behavior
add the formal check to pnpm verify or GitHub Actions (separate decision)
vendor tla2tools.jar or any Java/TLA+ binary
fix production code if the model reveals a defect (record + recommend only)
```

## Evidence labels used

`SOURCE_PROVEN` (toolchain SHA-1 vs published), `MODEL_CHECKED` (safety),
`PARTIAL` (liveness), `EXPECTED_COUNTEREXAMPLE` (configs, intended), `TEST_PRESENT`,
`TEST_MISSING`, `TEST_PRESENT_NOT_EXECUTED`, `RUNTIME_MISMATCH`, `TARGET_ONLY`,
`TARGET_INVARIANT`, `OPEN_QUESTION` (liveness), `BLOCKED_BY_ENVIRONMENT`
(counterexample reproduction). `RUNTIME_VERIFIED` is NOT used for anything
established only by TLC.
