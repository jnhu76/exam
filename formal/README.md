# Formal Models

This directory holds **executable formal specifications** (TLA+) and their
model-checking inputs for selected exam-platform protocols.

It is intentionally kept **outside `docs/`** because these are executable
artifacts, not prose authority. See "Storage rationale" below.

---

## What belongs here

```text
formal/
├── README.md                  (this file)
├── AGENTS.md                  (agent rules — binding for any model edit)
├── .gitignore                 (generated TLC artifacts are never committed)
└── tla/
    ├── TOOLCHAIN.md           (pinned TLA+ version + checksum + repro evidence)
    ├── recovery/
    │   ├── README.md          (model scope, variables, actions, invariants)
    │   ├── RecoveryProtocol.tla
    │   ├── RecoveryProtocolSafety.cfg
    │   ├── RecoveryProtocolLiveness.cfg
    │   └── counterexamples/
    │       └── README.md      (expected-negative configs + normalized traces)
    └── operator-grant/
        ├── README.md          (model scope, variables, actions, invariants)
        ├── OperatorGrantServer.tla
        ├── OperatorGrantServerSafety.cfg
        ├── OperatorGrantClient.tla
        ├── OperatorGrantClientSafety.cfg
        └── counterexamples/
            └── README.md      (expected-negative configs)
```

Execution adapters live under `scripts/formal/` (repository root), not here.

## What does NOT belong here

- `tla2tools.jar` or any Java/TLA+ binary — never vendored.
- Generated TLC state directories, traces, checkpoints, dumps.
- Prose architecture authority — that lives in `docs/`.
- Production runtime code — that lives in `apps/` and `packages/`.

## Authority relationship

```text
Accepted ADRs (docs/adr/)            — architectural authority (binding)
docs/architecture/exam-system/...    — descriptive architecture
apps/ + packages/                    — production runtime (TypeScript)
formal/tla/                          — executable consistency check
```

Accepted ADRs remain the architectural authority. The TLA+ model is an
**executable consistency check** over selected protocol semantics —
concurrency, route binding, restore authority, snapshot immutability.

**A passing model does not prove the TypeScript implementation conforms.**
The model is an abstract protocol specification checked with TLC over a
small finite domain. It does not mechanically verify the React/Fastify/
PostgreSQL implementation. The gap between model and implementation is
documented per-model (see `tla/recovery/README.md` §"Known runtime/model
mismatches") and in the closeout audit (`docs/archive/audits/REC-F1-*.md`).

## How formal models are reviewed

1. The ADR that freezes the modeled protocol is the binding authority —
   the model must not silently redefine it.
2. A model change is reviewed for: faithfulness to the ADR, finite bounds,
   explicit fairness, and preserved expected-negative counterexamples.
3. The committed runner is the reproducible verification path
   (`pnpm formal:recovery:safety`, etc.). A change that only passes under
   ad-hoc manual invocation is not verified.

## Generated-artifact policy

All TLC state, traces, checkpoints, coverage, dumps, and temporaries go
under `formal/.work/` (git-ignored). See `.gitignore`. The runner points
TLC's `-metadir` at `formal/.work/recovery/<mode>/` or
`formal/.work/operator-grant/<mode>/`.

Never committed: `tla2tools.jar`, TLA+ Toolbox archives, Java runtimes, TLC
state directories, raw multi-megabyte traces, downloaded binaries,
editor-specific model directories.

## Toolchain policy

The committed repository **does not contain** the TLA+ JAR. The runner
obtains the JAR path from the `TLA2TOOLS_JAR` environment variable.

```bash
TLA2TOOLS_JAR=/absolute/path/to/tla2tools.jar \
  pnpm formal:recovery:safety
```

Exact pinned version, official source, published checksum, locally verified
checksum, and verification date are recorded in
[`tla/TOOLCHAIN.md`](tla/TOOLCHAIN.md).

## Storage rationale

```text
formal/        executable specifications and model-checking inputs
docs/          prose authority, architecture, contracts, status, audit reports
scripts/formal/  execution adapters only (the runner)
apps/, packages/  production runtime code
```

Generated TLC artifacts are never source authority and are never committed.

This separation prevents three failure modes:

1. Treating a TLC trace as architectural authority (it is evidence, not
   contract — the ADR is the contract).
2. Letting the formal model drift into a second prose specification.
3. Vendoring binaries or generated state into version control.

## How to run all formal checks

```bash
# Recovery protocol (target safety + liveness + expected counterexamples):
TLA2TOOLS_JAR=/path/to/tla2tools.jar pnpm formal:recovery

# Operator grant (server/client safety + reachability + counterexamples):
TLA2TOOLS_JAR=/path/to/tla2tools.jar pnpm formal:operator-grant

# Individually:
TLA2TOOLS_JAR=/path/to/tla2tools.jar pnpm formal:recovery:safety
TLA2TOOLS_JAR=/path/to/tla2tools.jar pnpm formal:recovery:liveness
TLA2TOOLS_JAR=/path/to/tla2tools.jar pnpm formal:recovery:counterexamples
TLA2TOOLS_JAR=/path/to/tla2tools.jar pnpm formal:operator-grant:server
TLA2TOOLS_JAR=/path/to/tla2tools.jar pnpm formal:operator-grant:client
TLA2TOOLS_JAR=/path/to/tla2tools.jar pnpm formal:operator-grant:witnesses
TLA2TOOLS_JAR=/path/to/tla2tools.jar pnpm formal:operator-grant:counterexamples
pnpm formal:operator-grant:runner-test
```

The runner fails clearly if `TLA2TOOLS_JAR` is unset, the path is not a
regular file, or Java is unavailable. See the recovery and operator-grant
runners in `scripts/formal/`.

Formal checks are **not** part of the default `pnpm verify` or CI in
REC-F1. CI integration is a separate follow-up decision after model runtime
and stability are known.
