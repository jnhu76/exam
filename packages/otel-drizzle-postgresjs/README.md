# @exam/otel-drizzle-postgresjs

Independent Drizzle/postgres.js DB telemetry plugin (#964 W2, ADR-028 D3 —
**PROPOSED**; acceptance and production enablement belong to the project
Owner). Implements the W2.1 probe's **option B**: the API/Drizzle logical
transaction layer (A) plus one verified driver statement boundary.

`@exam/db` stays SDK-independent: the only thing it knows is the
SDK-free observation seam in `@exam/db/observation`
(`setTransactionSeam`), shaped like the existing
`setTransactionRetryLogger`. This package is the sole production consumer of
that seam, and the API runtime loads it **only** behind the
telemetry-enabled gate (default-Off deployments never import it, so Off
installs nothing at all).

## Measurement points (no double counting)

| Layer | Point | Emits |
| --- | --- | --- |
| Driver statement | First thenable consumption of a postgres.js `Query` (`Query.prototype` patch) | 1 × `db.statement` CLIENT span per **actually submitted** statement; duration = submission → settle (the only window containing lock waits); 1 × `db.client.operation.duration` histogram record per settle |
| Logical transaction | `executeInTransaction` boundary (via the `@exam/db` seam) | 1 × `db.transaction` span per call; 1 × `db.transaction.attempt` span per `db.transaction` try; 1 × `transaction.retry` span event per classified retry |

Retries surface as **sibling attempt spans under the same logical parent**
plus a controlled event on the logical span. The pre-existing
`transactionRetryLogger` stdout contract (#800 PR-B) is untouched — the
seam's `retry()` fires *next to* the warn, never instead of it. Transaction
statements (commit/rollback/savepoint/`set transaction`) run on
`sql.begin`'s scoped connection closures and are **invisible to any root
`sql.unsafe` wrapper** (W2.1 §2.3); the prototype patch sees them all
because every Query shares one module-level prototype.

## Span and attribute vocabulary (W2 initial set — W4 freezes)

Closed set, defined in `src/vocabulary.ts`:

- Span names: `db.statement`, `db.transaction`, `db.transaction.attempt`;
  event `transaction.retry`.
- Metric: `db.client.operation.duration` (histogram, unit `s`, explicit
  SemConv-style buckets).
- Attributes: `db.system=postgresql`, `db.response.status_code` (SQLSTATE,
  or the fixed category `UNCLASSIFIED`), `exam.db.connection.role`
  (`root` | `transaction`), `exam.db.outcome` (`success` | `error`),
  `exam.db.tx.attempt`, `exam.db.tx.isolation_level`,
  `exam.db.tx.retry.failed_attempt`.

**Never emitted**: statement text, bind parameters, connection URLs,
credentials, business payload, error messages. Span status carries no
message. SQLSTATE is read from the error's `cause` chain with
`findPostgresSqlState` from `@exam/db/types` — the authoritative walk
(`hasPostgresErrorCode`) shares its single traversal implementation. The
seam never reads `q.strings`/`q.args` (W2.1 §5 constraint 5), which is why
statement spans carry no operation verb — adding one means a bounded
first-keyword whitelist decision for the vocabulary freeze, not a silent
extension.

## API

```ts
import { installOtelDbTelemetry } from "@exam/otel-drizzle-postgresjs";

const handle = installOtelDbTelemetry();     // one decision per process; idempotent
handle.registerRootConnection(sql);          // tag a root pool (lazy marker query, executes nothing)
setTransactionSeam(handle.transactionSeam);  // hand the @exam/db seam over (API runtime does this)
handle.disable(); handle.enable();           // stop/resume recording; patch stays, inert
handle.diagnostics();                        // raw counters (benchmark evidence)
```

`tracer`/`meter` options exist for tests; defaults are the global OTel API
providers (no-op proxies when no SDK is registered — install stays safe in
any process).

## Lifecycle and safety contracts

- **One-way install** (W2.1 §5 constraint 1): the prototype patch is
  installed once per process and is irreversible, the same one-decision
  shape as the OTel API's `registerGlobal`. Enable/disable only swap the
  recording observer; the inert patch is a pure forwarder. Off deployments
  never import the module (the structural test in `apps/api` pins the
  dynamic-import boundary).
- **Measurement neutrality** (W2.1 §5 constraint 2): patched methods
  forward the original return value and error identity unchanged; the
  settle watch is promise multiplexing on the already-submitted Query
  (multi-consumer single-count, probe S10). Pinned by real-PG tests:
  sentinel error identity through the seam, ghost (unconsumed) Query
  executes nothing, `Promise.resolve(q)` adoption submits exactly once.
- **Containment** (ADR-028 D1): a throwing observer, a broken tracer, or a
  failing meter never changes a statement result or a transaction outcome —
  the degraded path runs unobserved. A settle-watch callback can never
  become an unhandled rejection.
- **Async context**: statement spans are created synchronously inside the
  consuming call frame, before `handle()`'s microtask hop, so they parent
  to the ambient span (request span, or the `db.transaction.attempt` span
  for transaction bodies).

## Declared coverage boundary (W2.1 §5 constraint 3)

Production statement paths in this repository are `await`/`.then`
consumption (drizzle session, repositories, scripts) and the `.execute()`
calls inside `sql.begin` — both patched and fixture-covered on real
PostgreSQL. `forEach` is patched at its submission point and exercised by a
fixture. `cursor()` reaches the seam only via `execute()` on its first
`next()`; chunk-level cursor semantics have **no production caller and no
fixture** — adding one requires extending the fixture contract first, never
a silent pass-through.

## Compatibility matrix (W2 as-built)

| Component | Version | Status | Basis |
| --- | --- | --- | --- |
| postgres.js | 3.4.9 (lockfile) | instrumented target | `Query extends Promise`, lazy thenable, `sql.begin` scoped closures — W2.1 probe + 3.4.9 source (`src/query.js`, `src/index.js`) |
| drizzle-orm | 0.45.2 (lockfile) | consumer of the seam via `executeInTransaction`; NO direct instrumentation | drizzle's built-in OTel tracing is dead code in 0.45.2 (`tracing.js` never assigns `otel`; upstream release note: "disabled … literally does nothing") — W2.1 finding F1; its `drizzle.query.params` attribute would violate attribute safety if ever activated upstream (upgrade checklist item) |
| @opentelemetry/api | 1.10.0 (pinned, single instance with apps/api) | span/metric emission | API facade only; no SDK dependency in this package |
| @opentelemetry/instrumentation-pg | — | **not applicable, never introduced** | targets `pg`/`pg-pool`, not `postgres` (W0.2/W2.1) |
| Node | ≥22 (workspace runtime: 24.x) | supported | plain ESM; no loader hooks |
| Isolation levels | READ COMMITTED, REPEATABLE READ | fixture-covered on real PG | attempt span carries `exam.db.tx.isolation_level`; 40001/40P01 retry fixtures reuse the proven schedules |
| pool reuse | max ≥1 pools | fixture-covered | sequential backend-pid stability under the patch; search_path must ride the startup parameter (`options.connection`), never a pool-level `SET` (W2.1 F5) |

## Benchmark

```bash
pnpm db:up                                            # exam-dev stack (testing.md §2.8 ownership)
pnpm --filter @exam/otel-drizzle-postgresjs bench     # writes one JSONL line per phase
```

One process: **phase A baseline (no install) → phase B enabled** — the
one-way patch forces this order. Fixed workload (400 selects + 40
transactions × 6 statements), per-phase p50/p95/mean/max, and the raw count
cross-check (phase B submissions = the workload's exact statement count).
Output goes to `out/otel-w964/W2.2/artifacts/benchmark.jsonl` by default,
overridable via `EXAM_DB_TELEMETRY_BENCH_OUT`. CPU/p99 budgets are W7.2's
measured acceptance on the integrated candidate — this entry records
evidence, it does not assert budgets.

## Tests

Real PostgreSQL (per-file schema harness, testing.md §2.8; the suite
self-skips when the dev stack is down):

```bash
pnpm --filter @exam/otel-drizzle-postgresjs test
```

Files: `otelDbTelemetry.test.ts` (lifecycle, statement semantics,
attribution, attribute safety, rollback, READ COMMITTED, failure
isolation, forEach boundary), `otelDbTelemetryRetry.test.ts` (real 40001 +
real 40P01 retry observability), `offNoSideEffects.test.ts` (import ≠
patch; install is the single decision), `benchmark.test.ts` (guarded
entry).
