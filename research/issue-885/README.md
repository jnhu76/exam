# Issue #885 — research evidence package

Fault-injection study behind
[Issue #885](https://github.com/jnhu76/exam/issues/885) and
[ADR-024](../../docs/adr/ADR-024-tick-level-throw-escalation.md): a background
loop that **settles but throws on every tick** produced no escalation event.

- Frozen baseline: `f2d44b78136cda1358148dbce891590975d4c88f` (2026-11-05).
- Research verdict: **GO_C (CONDITIONAL)**.
- Implementation: this branch.
- Current replay subject: `40b859d12e6ce991cbe80f099a4cfd845e23414a`, clean
  worktree, instrument `issue-885-instrument-v2`.
- Current replay result: **20/20 scenarios, 38/38 expected tuples, diff 0**;
  baseline control **20 scenarios, 0 tick_failure events**.

The original study's `105 s` / `15 s` latency labels are historical and were
measured from phase observation markers. The corrected episode-level timestamps
and the committed E7 reset instrument are in
[`POSTFIX_VALIDATION.md`](POSTFIX_VALIDATION.md).

## Read in this order

| File | What it holds |
| --- | --- |
| [`RESULTS.md`](RESULTS.md) | Condensed findings: root cause, reproduction, matrix, verdict; replay errata at top |
| [`SOURCE_MAP.md`](SOURCE_MAP.md) | Call DAG with `file:line` for every node + source-verified facts |
| [`EXPERIMENTS.md`](EXPERIMENTS.md) | Historical 20-scenario matrix; replay errata at top |
| [`ALERT_SEMANTICS.md`](ALERT_SEMANTICS.md) | Fact states and semantic answers; replay errata at top |
| [`DECISION.md`](DECISION.md) | A/B/C/D adjudication, change package, binding conditions; replay errata at top |
| [`REPRO.md`](REPRO.md) | Historical receipts, old→new mapping, current path-independent clean-room recipe |
| [`POSTFIX_VALIDATION.md`](POSTFIX_VALIDATION.md) | Current implemented replay, E7 proof, corrected timestamps, negative control |
| [`harness/`](harness) | Recorder, expected-event table, comparator, baseline control, analyzer, bundle-owned runner, instrument manifest |
| `results/` | **Not committed**: regenerable observations/transcripts, ignored by Git; receipt hashes and current run metadata live in `REPRO.md`/`POSTFIX_VALIDATION.md` |

Evidence classes are marked throughout: **MEASURED** / **SOURCE_VERIFIED** /
**INFERRED** / **UNKNOWN**. Plain ERROR logs are never treated as delivered
alerts; no operator-delivery latency is claimed (the repository contains no
watcher implementation). E3's `42703` is a simulated PostgreSQL-shaped fake-db
error, not a real database fault.

## Reproduce

The full path-independent recipe is [`REPRO.md`](REPRO.md) §5. Short form from
the current subject checkout:

```bash
apps/api/node_modules/.bin/vitest run --config research/issue-885/harness/vitest.config.ts \
  research/issue-885/harness/                      # recorder: 2/2, not the 20/20 comparison
node research/issue-885/harness/analyze.mjs
node research/issue-885/harness/compare.mjs        # 20/20, 38/38, diff 0
apps/api/node_modules/.bin/vitest run --config research/issue-885/harness/vitest.config.ts \
  apps/api/src/plugins/heartbeat.test.ts apps/api/src/plugins/deadlineScanner.test.ts \
  apps/api/src/plugins/operabilityMonitor.test.ts  # 78/78 on the subject
```

The bundle-owned runner is research-only: **no `globalSetup`, no PostgreSQL** —
the fake `fastify.db` reproduces the real drizzle chain shapes, and faults enter
through the real scanner tick entry. `fileParallelism: false`, fake timers,
fixed 15 s steps: no sleeps, no retries, no network.

## Provenance and integrity

[`harness/instrument-manifest.json`](harness/instrument-manifest.json) is the
authoritative current instrument manifest; it hashes the harness sources,
expected table, comparator, baseline control, analyzer, runner and fingerprint
generator, and does not hash itself. Historical SHA256 receipts and their
old→new mapping are preserved in `REPRO.md` §2 and §4. `experiments.json` records
the actual `subjectSha`, dirty state, product-module paths and file hashes; no
post-fix artifact is labelled with the frozen baseline SHA.

> **On the “NON-PERSISTENCE NOTICE” inside `RESULTS.md` and `REPRO.md`:** those
> paragraphs describe the study while it lived in a detached worktree and had
> not been committed. They are accurate history and are deliberately left
> intact so the historical manifest still verifies. The package is now
> committed for traceability; the durable record remains the
> [Issue #885 comment](https://github.com/jnhu76/exam/issues/885#issuecomment-6660017391).

`POSTFIX_VALIDATION.md` documents the current committed replay, the E7 reset
proof, the 19/20 historical instrument artifact, and the corrected timestamps.
