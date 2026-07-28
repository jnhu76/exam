# Formal Model Agent Rules

These rules are **binding** for any change to `formal/`. They exist to keep
the formal model an honest executable consistency check, not a second
architecture document or a vendor of binaries.

## Never

- **Never commit generated state.** TLC state directories, traces,
  checkpoints, dumps, and any `formal/.work/` content stay git-ignored.
  See `formal/.gitignore`.
- **Never vendor `tla2tools.jar`** or any Java/TLA+ binary, Toolbox
  archive, or runtime. The runner reads `TLA2TOOLS_JAR` from the
  environment.
- **Never broaden a model silently** to make a property pass. Any new
  state variable, action, or constant requires a state-space justification
  recorded in the model README and the closeout audit.
- **Never weaken a required invariant** to obtain a green result. If a
  required target invariant fails, that is a finding — record it, do not
  relax the invariant inside an unattended run.
- **Never delete an expected-counterexample configuration.** The negative
  configs under `tla/recovery/counterexamples/` are load-bearing evidence
  that the model actually exercises the bug classes it claims to catch.
- **Never treat random simulation as exhaustive verification.** A
  simulation-only run is explicitly labeled as such; the committed target
  safety model is exhaustively checked by TLC BFS.
- **Never invent a checksum.** Toolchain checksums in `TOOLCHAIN.md` must
  match an official published value or be explicitly labeled
  locally-computed.

## Always

- **Use official TLA+ documentation** for TLC behavior, option semantics,
  config-file format, liveness checking, and toolchain distribution. See
  `tla/TOOLCHAIN.md` for the consulted sources. Do not guess TLC option
  behavior from memory.
- **Keep constants finite.** The model uses small finite sets
  (`Attempts = {A, B}`, finite generations, finite request ids, finite
  network outcomes). Unbounded integers, timestamps, queues, or request-id
  spaces are out of scope for this model.
- **Separate safety from liveness.** Safety invariants are checked in
  `RecoveryProtocolSafety.cfg`; temporal properties and fairness live in
  `RecoveryProtocolLiveness.cfg`. A single config that mixes them obscures
  which property class failed.
- **Make fairness assumptions explicit.** Any liveness result is only as
  strong as its fairness assumptions. Document them in the model README and
  the closeout audit (network eventually up, server eventually processes,
  environment eventually delivers, user stays on route).
- **Preserve expected-negative counterexamples.** When changing an action,
  re-run the counterexample suite and confirm each negative config still
  produces the intended named violation.
- **Update architecture links when the modeled protocol changes.** If the
  ADR or the recovery architecture doc changes the protocol, the model must
  be reconciled and the mismatch recorded.
- **Record runtime/model mismatches honestly.** Where the current runtime
  still differs from the target model (e.g. REC-I4 time-compensation), say
  so in the model README and the closeout audit — do not distort the model
  to match a known defect.

## Production-code boundary

REC-F1 and follow-up formal-model Jobs **must not modify production
behavior**. Allowed change scope:

```text
formal/**
scripts/formal/**
package.json            (scripts only — no new dependencies, no lockfile change)
docs/README.md
docs/architecture/exam-system/candidate-recovery.md
docs/audits/REC-F1-*.md
```

Not allowed:

```text
apps/**
packages/**
database schema, API routes, contracts
production recovery or time-compensation behavior
runtime tests
```

If the model reveals a defect in the current implementation:

```text
- preserve the counterexample;
- record it in the closeout audit;
- identify the affected invariant;
- recommend a focused follow-up fix (separate PR);
- do not silently repair production code inside a formal-model PR.
```

## Research before toolchain changes

Docker, pnpm, Node module resolution, CI, Java, and TLC toolchain changes
require official documentation + local verification before editing. Do not
guess JVM or TLC option behavior from memory. Consult the sources listed in
`tla/TOOLCHAIN.md`.
