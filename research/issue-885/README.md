# Issue #885 — research evidence package

Fault-injection study behind
[Issue #885](https://github.com/jnhu76/exam/issues/885) and
[ADR-024](../../docs/adr/ADR-024-tick-level-throw-escalation.md): a background
loop that **settles but throws on every tick** produced no escalation event.

Baseline: `f2d44b78136cda1358148dbce891590975d4c88f` (2026-11-05).
Research verdict: **GO_C (CONDITIONAL)**. Implementation: this branch.

## Read in this order

| File | What it holds |
| --- | --- |
| [`RESULTS.md`](RESULTS.md) | Condensed findings: root cause, reproduction, matrix, verdict |
| [`SOURCE_MAP.md`](SOURCE_MAP.md) | Call DAG with `file:line` for every node + the 8 source-verified facts |
| [`EXPERIMENTS.md`](EXPERIMENTS.md) | All 20 scenarios: injection seam, counts, expected vs actual |
| [`ALERT_SEMANTICS.md`](ALERT_SEMANTICS.md) | The four fact states and the nine semantic questions, defined before any field name |
| [`DECISION.md`](DECISION.md) | A/B/C/D adjudication, 13-dimension matrix, change package, binding conditions |
| [`REPRO.md`](REPRO.md) | Environment, commands, exit codes, timestamps, SHA256 manifest, clean-room recipe |
| [`POSTFIX_VALIDATION.md`](POSTFIX_VALIDATION.md) | The implemented leg replayed through the same 20 scenarios vs. the prediction |
| [`harness/`](harness) | `experiments.test.ts` (recorder, zero assertions), `smoke.test.ts`, `analyze.mjs`, `vitest.config.ts` (bundle-owned runner) |
| [`results/`](results) | `experiments.json` (step-level observations), `analysis.json` (derived), transcripts |

Evidence classes are marked throughout: **MEASURED** / **SOURCE_VERIFIED** /
**INFERRED** / **UNKNOWN**. Plain ERROR logs are never treated as delivered
alerts; no operator-delivery latency is claimed (the repository contains no
watcher implementation).

## Reproduce

`REPRO.md` §5 has the full clean-room recipe. Short form, from the repo root:

```bash
apps/api/node_modules/.bin/vitest run --config research/issue-885/harness/vitest.config.ts \
  research/issue-885/harness/                      # 2/2 study matrix (-t smoke for smoke only)
node research/issue-885/harness/analyze.mjs        # derives analysis.json
apps/api/node_modules/.bin/vitest run --config research/issue-885/harness/vitest.config.ts \
  apps/api/src/plugins/heartbeat.test.ts apps/api/src/plugins/deadlineScanner.test.ts \
  apps/api/src/plugins/operabilityMonitor.test.ts  # 67/67 BASE control
```

The bundle-owned runner is research-only: **no `globalSetup`, no PostgreSQL** —
the fake `fastify.db` reproduces the real drizzle chain shapes, and faults enter
through the real scanner tick entry. `fileParallelism: false`, fake timers,
fixed 15 s steps: no sleeps, no retries, no network.

## Provenance and integrity

`REPRO.md` §4 is the SHA256 manifest of the study as it was run (17 artifacts,
all verified). Those hashes cover **this package's files unchanged**, which is
why they still verify in this tree.

> **On the "NON-PERSISTENCE NOTICE" inside `RESULTS.md` and `REPRO.md`:** those
> paragraphs describe the study's state while it lived in a detached worktree
> and had not been committed. They are accurate history and are deliberately
> left byte-identical so the manifest keeps verifying. The package is now
> committed for traceability; the durable record remains the
> [Issue #885 comment](https://github.com/jnhu76/exam/issues/885#issuecomment-6660017391).

`POSTFIX_VALIDATION.md` documents the one post-fix replay and the harness
restart-scaffold artifact it exposed; the committed harness is unchanged.
