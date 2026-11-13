/**
 * Driver statement seam: postgres.js `Query.prototype` thenable-consumption
 * patch (#964 W2, implementing the B decision of the W2.1 real-PG probe —
 * out/otel-w964/W2.1/db-seam-probe.md §5).
 *
 * WHY THIS SEAM (probe-measured, W2.1 §2/§5): postgres.js v3 `Query extends
 * Promise` is a LAZY thenable — creation never submits; the FIRST
 * thenable-consuming call (`then`/`catch`/`finally`/`execute`/`forEach`)
 * flips `executed` and hands the query to its connection handler one
 * microtask later. That first consumption is the ONLY process-internal point
 * that (a) distinguishes actual execution from mere arrival (un-awaited
 * Queries and drizzle query builders produce no signal), (b) covers
 * transaction sub-connections (`sql.begin` reserves on the root sql and runs
 * the body through a NEW scoped `Sql(handler)` closure — commit/rollback/
 * savepoint/tx statements are structurally invisible to any root `sql.unsafe`
 * property wrapper, but every Query shares ONE module-level prototype), and
 * (c) keeps the consumer's async context alive for span parenting (the patch
 * runs synchronously in the consuming call frame, before `handle()`'s
 * microtask hop).
 *
 * LIFECYCLE CONTRACT (W2.1 §5 constraint 1): the prototype patch is installed
 * ONCE per process and is IRREVERSIBLE — the same one-decision shape as the
 * OTel API `registerGlobal` the W1.2 runtime builds on. Enable/disable only
 * swaps the OBSERVER: with no observer the patched methods are pure
 * forwarders, so a mid-process disable stops recording without touching
 * query behavior. A process that never installs (telemetry Off — the API
 * runtime imports this module behind the enabled gate) never runs this code.
 *
 * MEASUREMENT NEUTRALITY (W2.1 §5 constraint 2): every patched method only
 * (1) consults the observer BEFORE forwarding — synchronously, in the same
 * call frame, guarded by its own containment — and (2) forwards the original
 * method's return value and error untouched. The observer's settle watch is
 * promise MULTIPLEXING on the already-submitted Query (native reaction
 * attached after `executed` flipped; the probe's S10 proved multi-consumer
 * single-count), so results and error identity reach the original consumer
 * unchanged.
 *
 * COVERAGE BOUNDARY (W2.1 §5 constraint 3, declared — not silent): the
 * production statement paths of this repository are `await`/`.then`
 * consumption (drizzle session + every repository) and the `.execute()` calls
 * inside `sql.begin`; both are patched. `cursor()` reaches the seam only via
 * `execute()` on its first `next()` (one submission record), and chunk-level
 * cursor semantics have NO production caller and NO fixture here. `forEach`
 * is patched at its submission point but never exercised by the suite for the
 * same reason. Adding a production cursor/forEach consumer requires extending
 * the fixture contract first.
 */
import postgres from "postgres";

/**
 * Structural view of the fields the seam may touch on a Query instance.
 * Deliberately NOT the statement text (`strings`) or bind values (`args`) —
 * the seam never reads them (W2.1 §5 constraint 5).
 */
export interface InstrumentedQuery {
  readonly executed: boolean;
  /** The per-Sql-instance handler closure — the sub-connection identity signal. */
  readonly handler: unknown;
}

/**
 * Observer invoked synchronously at the FIRST consumption of a not-yet-
 * executed Query. MUST NOT throw (the patch contains it) and MUST NOT touch
 * the query's thenable surface beyond attaching a native settle reaction to
 * the instance itself (`Promise.prototype.then.call`), which multiplexes
 * without re-submitting.
 */
export type StatementSeamObserver = (query: InstrumentedQuery) => void;

let patched = false;
let observer: StatementSeamObserver | null = null;

/** Whether this process has the one-way prototype patch installed. */
export function isStatementSeamPatched(): boolean {
  return patched;
}

/** Swaps the recording observer (null = inert pure-forwarding patch). */
export function setStatementSeamObserver(
  next: StatementSeamObserver | null,
): void {
  observer = next;
}

type QueryProto = Record<
  "then" | "catch" | "finally" | "execute" | "forEach",
  (...args: unknown[]) => unknown
>;

/**
 * Installs the prototype patch (idempotent — later calls are no-ops). The
 * prototype is reached through a NEVER-CONNECTED marker client, the W2.1
 * probe's proven zero-network shape: `postgres()` opens nothing until the
 * first statement is handled, the marker Query is created but never consumed
 * (lazy — creation is not submission), and the client is ended with
 * `timeout: 0` before anything could dial.
 */
export function installStatementSeam(): void {
  if (patched) return;

  const markerClient = postgres("postgres://127.0.0.1:1/none");
  const marker = markerClient.unsafe("select 1");
  const proto = Object.getPrototypeOf(marker) as unknown as QueryProto;
  markerClient.end({ timeout: 0 });

  const orig = {
    then: proto.then,
    catch: proto.catch,
    finally: proto.finally,
    execute: proto.execute,
    forEach: proto.forEach,
  };

  // Containment (ADR-028 D1): an observer bug degrades to no-telemetry. It
  // must never reach the query path — neither synchronously here, nor as an
  // unhandled rejection from the observer's own settle reactions (the
  // observer wraps those itself).
  const consult = (query: InstrumentedQuery): void => {
    if (!observer) return;
    try {
      observer(query);
    } catch {
      // Telemetry-internal failure; the statement proceeds unobserved.
    }
  };

  proto.then = function (this: InstrumentedQuery, ...args: unknown[]) {
    if (!this.executed) consult(this);
    return orig.then.apply(this, args);
  };
  proto.catch = function (this: InstrumentedQuery, ...args: unknown[]) {
    if (!this.executed) consult(this);
    return orig.catch.apply(this, args);
  };
  proto.finally = function (this: InstrumentedQuery, ...args: unknown[]) {
    if (!this.executed) consult(this);
    return orig.finally.apply(this, args);
  };
  proto.execute = function (this: InstrumentedQuery) {
    if (!this.executed) consult(this);
    return orig.execute.call(this);
  };
  proto.forEach = function (this: InstrumentedQuery, fn: unknown) {
    if (!this.executed) consult(this);
    return orig.forEach.call(this, fn);
  };

  patched = true;
}
