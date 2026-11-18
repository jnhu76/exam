import { describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import { Buffer } from "node:buffer";
import { Writable } from "node:stream";
import { organizations, examAttempts } from "@exam/db/schema/pg";
import deadlineScannerPlugin, {
  deadlineScannerMetrics,
  scanDeadlineCandidates,
  type DeadlineCandidate,
} from "./deadlineScanner.js";
import { classifyLoopStall } from "./operabilityMonitor.js";

// Real-timer reference captured at module load, before any test activates
// vi.useFakeTimers() — used to cross REAL macrotask boundaries so Node's
// unhandled-rejection checkpoint fires deterministically inside fake-time
// tests.
const realSetImmediate = setImmediate;

function makeCandidate(
  overrides: Partial<DeadlineCandidate>,
): DeadlineCandidate {
  return {
    id: "att-1",
    status: "in_progress",
    organizationId: "org-1",
    ...overrides,
  };
}

// NOTE: there is deliberately NO "selectExpiredAttempts" / in-memory expiry
// filter test here. That function was removed — the DB query
// (listDeadlineCandidates) is the sole discovery authority, and the under-lock
// canonical recheck in autoSubmitAndGrade is the sole mutation authority.
// These tests cover ONLY the pure iterator contract of scanDeadlineCandidates.

describe("deadline scanner — scanDeadlineCandidates (iterator)", () => {
  it("invokes the callback for each candidate and returns submitted count", async () => {
    const now = new Date("2025-01-01T11:30:00Z");
    const submittedIds: string[] = [];
    const onCandidate = vi.fn(async (id: string) => {
      submittedIds.push(id);
    });

    const result = await scanDeadlineCandidates(
      [
        makeCandidate({ id: "exp-1" }),
        makeCandidate({ id: "exp-2", status: "disrupted" }),
      ],
      now,
      onCandidate,
    );

    expect(result.submittedCount).toBe(2);
    expect(submittedIds.sort()).toEqual(["exp-1", "exp-2"]);
    expect(onCandidate).toHaveBeenCalledTimes(2);
  });

  it("logs and continues when submit fails for one candidate (retry next scan)", async () => {
    const now = new Date("2025-01-01T11:30:00Z");
    const submittedIds: string[] = [];
    const onCandidate = vi.fn(async (id: string) => {
      if (id === "exp-fail") {
        throw new Error("transient db error");
      }
      submittedIds.push(id);
    });
    const onError = vi.fn();

    const result = await scanDeadlineCandidates(
      [makeCandidate({ id: "exp-fail" }), makeCandidate({ id: "exp-ok" })],
      now,
      onCandidate,
      { onError },
    );

    expect(submittedIds).toEqual(["exp-ok"]);
    expect(result.submittedCount).toBe(1);
    expect(result.failedCount).toBe(1);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]![0]).toBe("exp-fail");
  });

  it("returns zero counts when there are no candidates", async () => {
    const now = new Date("2025-01-01T11:00:00Z");
    const onCandidate = vi.fn();

    const result = await scanDeadlineCandidates([], now, onCandidate);

    expect(result.submittedCount).toBe(0);
    expect(result.failedCount).toBe(0);
    expect(onCandidate).not.toHaveBeenCalled();
  });

  it("does NOT increment submittedCount when onCandidate returns false (under-lock no-op)", async () => {
    // T7 contract at the iterator level: a candidate that returns false from
    // onCandidate (autoSubmitAndGrade found it not-expired under lock) must
    // not be counted as a submission. The authoritative skip happens inside
    // autoSubmitAndGrade; the DB-backed linearization regression is in the
    // integration test (deadline-authority.structural.test.ts).
    const now = new Date("2025-01-01T11:30:00Z");
    const onCandidate = vi.fn(async () => false);

    const result = await scanDeadlineCandidates(
      [
        makeCandidate({ id: "noop-1" }),
        makeCandidate({ id: "noop-2", status: "disrupted" }),
      ],
      now,
      onCandidate,
    );

    expect(result.submittedCount).toBe(0);
    expect(result.failedCount).toBe(0);
    expect(onCandidate).toHaveBeenCalledTimes(2);
  });

  it("increments submittedCount when onCandidate returns true or void", async () => {
    const now = new Date("2025-01-01T11:30:00Z");
    const onCandidate = vi.fn(async (id: string) => {
      if (id === "ret-true") return true;
      if (id === "ret-void") return undefined;
      return false;
    });

    const result = await scanDeadlineCandidates(
      [
        makeCandidate({ id: "ret-true" }),
        makeCandidate({ id: "ret-void" }),
        makeCandidate({ id: "ret-false" }),
      ],
      now,
      onCandidate,
    );

    expect(result.submittedCount).toBe(2);
    expect(result.failedCount).toBe(0);
  });
});

// Issue #547.
describe("deadline scanner plugin — stall-fact bookkeeping", () => {
  // Module-level singleton: reset the stall facts to fresh-process state.
  function resetStallFacts() {
    deadlineScannerMetrics.startedAt = null;
    deadlineScannerMetrics.lastStartedAt = null;
    deadlineScannerMetrics.lastSettledAt = null;
    deadlineScannerMetrics.activeSince = null;
  }

  function buildApp(db: unknown) {
    const clock = { current: new Date("2026-09-17T08:00:00Z") };
    const app = Fastify({ logger: false });
    app.decorate<unknown>("db", db as never);
    app.decorate("now", () => clock.current);
    return { app, clock };
  }

  it("records startedAt at registration; a throwing cycle settles (settled != success)", async () => {
    vi.useFakeTimers();
    const { app, clock } = buildApp({
      select: () => {
        throw new Error("forced scan failure");
      },
    });
    resetStallFacts();
    await app.register(deadlineScannerPlugin);
    await app.ready();

    try {
      expect(deadlineScannerMetrics.startedAt).toEqual(clock.current);
      expect(deadlineScannerMetrics.lastSettledAt).toBeNull();

      clock.current = new Date(clock.current.getTime() + 30_000);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(deadlineScannerMetrics.lastStartedAt).not.toBeNull();
      expect(deadlineScannerMetrics.lastSettledAt?.getTime()).toBe(
        clock.current.getTime(),
      );
      expect(deadlineScannerMetrics.activeSince).toBeNull();
    } finally {
      await app.close();
      vi.useRealTimers();
    }
  });

  it("a hung cycle holds activeSince and skips later ticks — classifier reads STALLED", async () => {
    vi.useFakeTimers();
    // Deferred hang: teardown rejects it so the in-flight cycle settles
    // and the plugin's awaited onClose can complete (no dangling close).
    let releaseHang: (err: Error) => void = () => {};
    const hang = new Promise<never>((_, reject) => {
      releaseHang = reject;
    });
    const { app, clock } = buildApp({
      select: () => ({ from: () => hang }),
    });
    resetStallFacts();
    await app.register(deadlineScannerPlugin);
    await app.ready();

    try {
      clock.current = new Date(clock.current.getTime() + 30_000);
      await vi.advanceTimersByTimeAsync(30_000);
      const hangStart = deadlineScannerMetrics.lastStartedAt;
      expect(hangStart).not.toBeNull();
      expect(deadlineScannerMetrics.activeSince).toEqual(hangStart);

      clock.current = new Date(clock.current.getTime() + 10 * 30_000);
      await vi.advanceTimersByTimeAsync(10 * 30_000);
      expect(deadlineScannerMetrics.lastStartedAt).toEqual(hangStart);
      expect(deadlineScannerMetrics.lastSettledAt).toBeNull();

      expect(
        classifyLoopStall(
          deadlineScannerMetrics,
          30_000,
          new Date(hangStart!.getTime() + 4 * 30_000),
        ),
      ).toBe("stalled");
    } finally {
      releaseHang(new Error("test teardown"));
      await app.close();
      vi.useRealTimers();
    }
    expect(deadlineScannerMetrics.lastSettledAt).not.toBeNull();
    expect(deadlineScannerMetrics.activeSince).toBeNull();
  });
});

// Issue #862 — the persistent business-failure escalation input the operability
// monitor consumes. A tick whose candidates ALL fail still SETTLES
// (classifyLoopStall stays healthy — settled ≠ success); the escalation signal
// is carried by the per-tick consecutive-failure counter instead, deduped by
// the monitor's transition trackers.
describe("deadline scanner plugin — persistent business-failure escalation input (#862)", () => {
  const ORG = { id: "org-1" };
  const FAILING_CANDIDATE_ROW = {
    attempt: { id: "att-fail", status: "in_progress", organizationId: "org-1" },
  };

  function resetEscalationFacts() {
    deadlineScannerMetrics.startedAt = null;
    deadlineScannerMetrics.lastStartedAt = null;
    deadlineScannerMetrics.lastSettledAt = null;
    deadlineScannerMetrics.activeSince = null;
    deadlineScannerMetrics.autoSubmitCount = 0;
    deadlineScannerMetrics.failedCount = 0;
    deadlineScannerMetrics.consecutiveFailedTicks = 0;
    deadlineScannerMetrics.consecutiveThrowTicks = 0;
  }

  function buildApp(db: unknown, lines: string[]) {
    const clock = { current: new Date("2026-09-17T08:00:00Z") };
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        lines.push(chunk.toString());
        callback();
      },
    });
    const app = Fastify({ logger: { level: "info", stream } });
    app.decorate<unknown>("db", db as never);
    app.decorate("now", () => clock.current);
    return { app, clock };
  }

  /**
   * Fake db routing by drizzle table identity (same pattern as the heartbeat
   * #800 fakes): organization discovery resolves one org (or THROWS while
   * `orgDiscoveryThrows()` — a tick-level throw, not a business failure);
   * listDeadlineCandidates resolves ONE candidate while `discoveryFails()`,
   * else zero; every per-candidate transaction rejects — so the tick settles
   * with failedCount=1 per failing tick (business work failing, not a stall).
   */
  function buildDb(legs: {
    discoveryFails: () => boolean;
    orgDiscoveryThrows?: () => boolean;
  }): unknown {
    return {
      select: () => ({
        from: (table: unknown) => {
          if (table === organizations) {
            if (legs.orgDiscoveryThrows?.()) {
              throw new Error("forced org discovery failure");
            }
            return Promise.resolve([ORG]);
          }
          if (table === examAttempts) {
            return {
              innerJoin: () => ({
                where: () =>
                  Promise.resolve(
                    legs.discoveryFails() ? [FAILING_CANDIDATE_ROW] : [],
                  ),
              }),
            };
          }
          throw new Error("unexpected table in deadline scanner fake db");
        },
      }),
      // autoSubmitAndGrade → executeInTransaction → db.transaction: a plain
      // non-retryable Error, thrown once per candidate.
      transaction: async () => {
        throw new Error("forced auto-submit failure");
      },
    };
  }

  async function runTick(clock: { current: Date }) {
    clock.current = new Date(clock.current.getTime() + 30_000);
    await vi.advanceTimersByTimeAsync(30_000);
  }

  it("GAP PIN: every candidate failing every tick still settles — stallState stays healthy and the plugin emits only ERROR failure logs, zero operability.* events", async () => {
    vi.useFakeTimers();
    const lines: string[] = [];
    let discoveryFails = true;
    const { app, clock } = buildApp(
      buildDb({ discoveryFails: () => discoveryFails }),
      lines,
    );
    resetEscalationFacts();
    await app.register(deadlineScannerPlugin);
    await app.ready();

    try {
      for (let i = 0; i < 4; i++) await runTick(clock);

      // Settled every tick, nothing in flight — the loop is NOT stalled.
      expect(deadlineScannerMetrics.lastSettledAt).not.toBeNull();
      expect(deadlineScannerMetrics.activeSince).toBeNull();
      expect(
        classifyLoopStall(deadlineScannerMetrics, 30_000, clock.current),
      ).toBe("healthy");

      const parsed = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
      // The scanner itself never emits an operability.* event; the per-item
      // ERROR log is the only immediate signal (the escalation alert is the
      // monitor's job — asserted at the monitor layer).
      expect(
        parsed.filter((l) => String(l.event ?? "").startsWith("operability.")),
      ).toEqual([]);
      expect(
        parsed.filter((l) => l.msg === "Failed to auto-submit expired attempt"),
      ).toHaveLength(4);
    } finally {
      await app.close();
      vi.useRealTimers();
    }
  });

  it("REGRESSION: consecutiveFailedTicks increments per settled-with-failure tick; the first zero-failure settle — idle OR successful — resets it (the monitor's escalation input)", async () => {
    vi.useFakeTimers();
    const lines: string[] = [];
    let discoveryFails = true;
    const { app, clock } = buildApp(
      buildDb({ discoveryFails: () => discoveryFails }),
      lines,
    );
    resetEscalationFacts();
    await app.register(deadlineScannerPlugin);
    await app.ready();

    try {
      await runTick(clock);
      expect(deadlineScannerMetrics.consecutiveFailedTicks).toBe(1);
      await runTick(clock);
      await runTick(clock);
      expect(deadlineScannerMetrics.consecutiveFailedTicks).toBe(3);

      // The counter is a run-length of FAILED ticks; the update rule reads
      // failedCount only. This tick exercises the idle shape (discovery
      // returns no candidates → zero failures). The successful shape
      // (candidates present, every auto-submit succeeds → submittedCount > 0,
      // failedCount === 0 — pinned by the scanDeadlineCandidates tests above)
      // feeds the same rule and resets identically: for this state-condition
      // alert, "no failing work observed" and "failures cleared" are one fact
      // (docs/operations/active-alerting.md §1 recovery semantics).
      discoveryFails = false;
      await runTick(clock);
      expect(deadlineScannerMetrics.consecutiveFailedTicks).toBe(0);
    } finally {
      await app.close();
      vi.useRealTimers();
    }
  });

  it("REGRESSION: a tick-level THROW freezes the counter — neither resets nor advances it (the documented readiness-ownership boundary)", async () => {
    vi.useFakeTimers();
    const lines: string[] = [];
    let discoveryFails = true;
    let orgDiscoveryThrows = false;
    const { app, clock } = buildApp(
      buildDb({
        discoveryFails: () => discoveryFails,
        orgDiscoveryThrows: () => orgDiscoveryThrows,
      }),
      lines,
    );
    resetEscalationFacts();
    await app.register(deadlineScannerPlugin);
    await app.ready();

    try {
      await runTick(clock);
      expect(deadlineScannerMetrics.consecutiveFailedTicks).toBe(1);

      // A tick whose org discovery THROWS settles via the catch path but
      // carries NO business-failure evidence: the counter must stay exactly
      // where it was — not reset to 0 (a throw is not recovery), not
      // advanced (a thrown cycle is escalated separately as
      // operability.tick_failure, ADR-024).
      orgDiscoveryThrows = true;
      await runTick(clock);
      expect(deadlineScannerMetrics.lastSettledAt).not.toBeNull();
      expect(deadlineScannerMetrics.consecutiveFailedTicks).toBe(1);

      // CONTINUOUS tick-level throws (DB readiness normal throughout): every
      // thrown cycle settles, so the loop is not stalled, and the
      // business-failure counter stays frozen below the threshold
      // indefinitely. This plugin keeps its per-tick ERROR log; the throw run
      // itself escalates through the monitor's operability.tick_failure.
      for (let i = 0; i < 3; i++) {
        await runTick(clock);
        expect(deadlineScannerMetrics.consecutiveFailedTicks).toBe(1);
      }
      expect(
        classifyLoopStall(deadlineScannerMetrics, 30_000, clock.current),
      ).toBe("healthy");
      expect(
        lines
          .map((l) => JSON.parse(l) as Record<string, unknown>)
          .filter((l) => String(l.event ?? "").startsWith("operability.")),
      ).toEqual([]);

      // The frozen run continues from where it froze.
      orgDiscoveryThrows = false;
      await runTick(clock);
      expect(deadlineScannerMetrics.consecutiveFailedTicks).toBe(2);

      // And the first clean settle still resets.
      discoveryFails = false;
      await runTick(clock);
      expect(deadlineScannerMetrics.consecutiveFailedTicks).toBe(0);
    } finally {
      await app.close();
      vi.useRealTimers();
    }
  });

  it("#885: throw ticks are counted in their OWN run-length counter — incremented by a throw, reset by a clean settle, never conflated with business failures", async () => {
    vi.useFakeTimers();
    const lines: string[] = [];
    let discoveryFails = true;
    let orgDiscoveryThrows = false;
    const { app, clock } = buildApp(
      buildDb({
        discoveryFails: () => discoveryFails,
        orgDiscoveryThrows: () => orgDiscoveryThrows,
      }),
      lines,
    );
    resetEscalationFacts();
    await app.register(deadlineScannerPlugin);
    await app.ready();

    try {
      // Settled ticks with candidate business failures: the #862 counter runs,
      // the throw counter does not move.
      await runTick(clock);
      await runTick(clock);
      expect(deadlineScannerMetrics.consecutiveFailedTicks).toBe(2);
      expect(deadlineScannerMetrics.consecutiveThrowTicks).toBe(0);

      // Three throwing ticks: the throw run climbs, the business counter stays
      // frozen, and the tick still settles.
      orgDiscoveryThrows = true;
      for (let i = 0; i < 3; i++) await runTick(clock);
      expect(deadlineScannerMetrics.consecutiveThrowTicks).toBe(3);
      expect(deadlineScannerMetrics.consecutiveFailedTicks).toBe(2);
      expect(deadlineScannerMetrics.lastSettledAt).not.toBeNull();
      expect(lines.join("")).toContain("Error scanning for expired attempts");

      // The first settled tick without a throw ends the run...
      orgDiscoveryThrows = false;
      await runTick(clock);
      expect(deadlineScannerMetrics.consecutiveThrowTicks).toBe(0);
      // ...and business evidence resumes where its own counter left off.
      expect(deadlineScannerMetrics.consecutiveFailedTicks).toBe(3);
    } finally {
      await app.close();
      vi.useRealTimers();
    }
  });
});

// Issue #1009 — tick settlement emission. A settled NON-EMPTY tick emits
// exactly ONE `scanner.tick.completed` line (outcome ∈ {no_op, acted,
// partial_failure}); empty discovery stays silent (frozen blindspot — no
// `empty` outcome); a thrown tick keeps the error path and never emits a
// fabricated settlement; per-candidate error lines carry the tick's `tickId`
// as the join key (one randomUUID per tick, never an HTTP requestId).
describe("deadline scanner plugin — tick settlement emission (#1009)", () => {
  const ORG = { id: "org-1" };
  const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

  type TickTxOutcome = "true" | "false" | "throw";

  function resetSettlementFacts() {
    deadlineScannerMetrics.startedAt = null;
    deadlineScannerMetrics.lastStartedAt = null;
    deadlineScannerMetrics.lastSettledAt = null;
    deadlineScannerMetrics.activeSince = null;
    deadlineScannerMetrics.lastScanAt = null;
    deadlineScannerMetrics.autoSubmitCount = 0;
    deadlineScannerMetrics.failedCount = 0;
    deadlineScannerMetrics.consecutiveFailedTicks = 0;
    deadlineScannerMetrics.consecutiveThrowTicks = 0;
  }

  function buildApp(db: unknown, lines: string[]) {
    const clock = { current: new Date("2026-11-18T08:00:00Z") };
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        lines.push(chunk.toString());
        callback();
      },
    });
    const app = Fastify({ logger: { level: "info", stream } });
    app.decorate<unknown>("db", db as never);
    app.decorate("now", () => clock.current);
    return { app, clock };
  }

  /**
   * Fake drizzle edge (outermost architecture boundary): org discovery
   * resolves ONE org (or throws while `orgDiscoveryThrows()` — the tick-level
   * throw path); candidate discovery resolves `candidates()` rows;
   * `db.transaction` resolves the next outcome from `txOutcomes()` in order
   * (clamped to the last element), so `autoSubmitAndGrade`'s stateChanged
   * guard turns "false" into an under-lock no-op without running any
   * transaction-body query.
   */
  function buildSettlementDb(legs: {
    candidates: () => number;
    txOutcomes: () => TickTxOutcome[];
    orgDiscoveryThrows?: () => boolean;
  }): unknown {
    let txCalls = 0;
    return {
      select: () => ({
        from: (table: unknown) => {
          if (table === organizations) {
            if (legs.orgDiscoveryThrows?.()) {
              throw new Error("forced org discovery failure");
            }
            return Promise.resolve([ORG]);
          }
          if (table === examAttempts) {
            return {
              innerJoin: () => ({
                where: () =>
                  Promise.resolve(
                    Array.from({ length: legs.candidates() }, (_, i) => ({
                      attempt: {
                        id: `att-${i + 1}`,
                        status: "in_progress",
                        organizationId: ORG.id,
                      },
                    })),
                  ),
              }),
            };
          }
          throw new Error("unexpected table in deadline scanner fake db");
        },
      }),
      transaction: async () => {
        const outcomes = legs.txOutcomes();
        const outcome = outcomes[Math.min(txCalls, outcomes.length - 1)];
        txCalls += 1;
        if (outcome === "throw") {
          throw new Error("forced auto-submit failure");
        }
        return outcome === "true";
      },
    };
  }

  async function runTick(clock: { current: Date }) {
    clock.current = new Date(clock.current.getTime() + 30_000);
    await vi.advanceTimersByTimeAsync(30_000);
  }

  function parseLines(lines: string[]): Array<Record<string, unknown>> {
    return lines.map((l) => JSON.parse(l) as Record<string, unknown>);
  }

  // Raw (unparsed) settlement lines, for byte-budget assertions on the
  // COMPLETE pino JSON line.
  function settlementRawLines(lines: string[]): string[] {
    return lines.filter(
      (l) =>
        (JSON.parse(l) as Record<string, unknown>).event ===
        "scanner.tick.completed",
    );
  }

  // #1009 byte budget unit: UTF-8 byte length of ONE complete pino line,
  // trailing newline excluded. Measured baseline at #1029: 254B (no_op),
  // 254B (acted), 264B (partial_failure); pid/hostname/time widths vary by
  // environment, so the regression pins the ≤512B budget, not exact bytes.
  function lineBytes(line: string): number {
    return Buffer.byteLength(line.endsWith("\n") ? line.slice(0, -1) : line);
  }

  it("emits exactly one scanner.tick.completed with outcome no_op per non-empty all-no-op tick, with a distinct per-tick tickId", async () => {
    vi.useFakeTimers();
    const lines: string[] = [];
    const { app, clock } = buildApp(
      buildSettlementDb({ candidates: () => 3, txOutcomes: () => ["false"] }),
      lines,
    );
    resetSettlementFacts();
    await app.register(deadlineScannerPlugin);
    await app.ready();

    try {
      await runTick(clock);
      await runTick(clock);

      const completed = parseLines(lines).filter(
        (l) => l.event === "scanner.tick.completed",
      );
      expect(completed).toHaveLength(2);

      const first = completed[0]!;
      expect(first.scanner).toBe("deadline");
      expect(first.outcome).toBe("no_op");
      expect(first.discoveredCount).toBe(3);
      expect(first.noOpCount).toBe(3);
      expect(first.submittedCount).toBe(0);
      expect(first.failedCount).toBe(0);
      expect(typeof first.tickId).toBe("string");
      expect(UUID_RE.test(String(first.tickId))).toBe(true);

      const second = completed[1]!;
      expect(second.tickId).not.toBe(first.tickId);

      // Byte budget (#1009): every emitted no_op settlement line stays
      // within the 512B contract budget.
      for (const raw of settlementRawLines(lines)) {
        expect(lineBytes(raw)).toBeLessThanOrEqual(512);
      }
    } finally {
      await app.close();
      vi.useRealTimers();
    }
  });

  it("keeps empty discovery ticks silent — zero lines of any kind (frozen blindspot, no empty outcome)", async () => {
    vi.useFakeTimers();
    const lines: string[] = [];
    const { app, clock } = buildApp(
      buildSettlementDb({ candidates: () => 0, txOutcomes: () => ["true"] }),
      lines,
    );
    resetSettlementFacts();
    await app.register(deadlineScannerPlugin);
    await app.ready();

    try {
      await runTick(clock);

      expect(deadlineScannerMetrics.lastSettledAt).not.toBeNull();
      expect(lines).toEqual([]);
    } finally {
      await app.close();
      vi.useRealTimers();
    }
  });

  it("maps an all-submitted tick to exactly one settlement line with outcome acted, replacing the count-gated summary 1:1", async () => {
    vi.useFakeTimers();
    const lines: string[] = [];
    const { app, clock } = buildApp(
      buildSettlementDb({ candidates: () => 2, txOutcomes: () => ["true"] }),
      lines,
    );
    resetSettlementFacts();
    await app.register(deadlineScannerPlugin);
    await app.ready();

    try {
      await runTick(clock);

      const parsed = parseLines(lines);
      const completed = parsed.filter(
        (l) => l.event === "scanner.tick.completed",
      );
      expect(completed).toHaveLength(1);
      // 1:1 replacement: the settlement line is the ONLY line the tick emits.
      expect(parsed).toHaveLength(1);
      expect(completed[0]!.outcome).toBe("acted");
      expect(completed[0]!.submittedCount).toBe(2);
      expect(completed[0]!.failedCount).toBe(0);
      expect(completed[0]!.discoveredCount).toBe(2);
      expect(completed[0]!.noOpCount).toBe(0);
      expect(completed[0]!.scanner).toBe("deadline");
      expect(UUID_RE.test(String(completed[0]!.tickId))).toBe(true);

      // Byte budget (#1009): the acted settlement line stays within the
      // 512B contract budget.
      for (const raw of settlementRawLines(lines)) {
        expect(lineBytes(raw)).toBeLessThanOrEqual(512);
      }
    } finally {
      await app.close();
      vi.useRealTimers();
    }
  });

  it("maps a partial tick (one commit, one candidate throw) to outcome partial_failure and joins the per-candidate error line to the same tickId", async () => {
    vi.useFakeTimers();
    const lines: string[] = [];
    const { app, clock } = buildApp(
      buildSettlementDb({
        candidates: () => 2,
        txOutcomes: () => ["true", "throw"],
      }),
      lines,
    );
    resetSettlementFacts();
    await app.register(deadlineScannerPlugin);
    await app.ready();

    try {
      await runTick(clock);

      const parsed = parseLines(lines);
      const completed = parsed.filter(
        (l) => l.event === "scanner.tick.completed",
      );
      expect(completed).toHaveLength(1);
      expect(completed[0]!.outcome).toBe("partial_failure");
      expect(completed[0]!.submittedCount).toBe(1);
      expect(completed[0]!.failedCount).toBe(1);
      expect(completed[0]!.discoveredCount).toBe(2);
      expect(completed[0]!.noOpCount).toBe(0);

      const candidateErrors = parsed.filter(
        (l) => l.msg === "Failed to auto-submit expired attempt",
      );
      expect(candidateErrors).toHaveLength(1);
      expect(candidateErrors[0]!.tickId).toBe(completed[0]!.tickId);
      expect(candidateErrors[0]!.attemptId).toBe("att-2");
      expect(candidateErrors[0]!.organizationId).toBe(ORG.id);

      // Byte budget (#1009): the partial_failure settlement line (not the
      // per-candidate error line) stays within the 512B contract budget.
      for (const raw of settlementRawLines(lines)) {
        expect(lineBytes(raw)).toBeLessThanOrEqual(512);
      }
    } finally {
      await app.close();
      vi.useRealTimers();
    }
  });

  it("keeps thrown ticks on the error path — error line + consecutiveThrowTicks, never a completed settlement", async () => {
    vi.useFakeTimers();
    const lines: string[] = [];
    const { app, clock } = buildApp(
      buildSettlementDb({
        candidates: () => 1,
        txOutcomes: () => ["true"],
        orgDiscoveryThrows: () => true,
      }),
      lines,
    );
    resetSettlementFacts();
    await app.register(deadlineScannerPlugin);
    await app.ready();

    try {
      await runTick(clock);

      const parsed = parseLines(lines);
      expect(
        parsed.filter((l) => l.msg === "Error scanning for expired attempts"),
      ).toHaveLength(1);
      expect(
        parsed.filter((l) => l.event === "scanner.tick.completed"),
      ).toEqual([]);
      expect(deadlineScannerMetrics.consecutiveThrowTicks).toBe(1);
    } finally {
      await app.close();
      vi.useRealTimers();
    }
  });

  it("REGRESSION (review): the tick-level error line carries its tick's own tickId — a valid UUID, distinct across consecutive thrown ticks", async () => {
    vi.useFakeTimers();
    const lines: string[] = [];
    const { app, clock } = buildApp(
      buildSettlementDb({
        candidates: () => 1,
        txOutcomes: () => ["true"],
        orgDiscoveryThrows: () => true,
      }),
      lines,
    );
    resetSettlementFacts();
    await app.register(deadlineScannerPlugin);
    await app.ready();

    try {
      await runTick(clock);
      await runTick(clock);

      const tickErrors = parseLines(lines).filter(
        (l) => l.msg === "Error scanning for expired attempts",
      );
      expect(tickErrors).toHaveLength(2);
      expect(UUID_RE.test(String(tickErrors[0]!.tickId))).toBe(true);
      expect(UUID_RE.test(String(tickErrors[1]!.tickId))).toBe(true);
      expect(tickErrors[0]!.tickId).not.toBe(tickErrors[1]!.tickId);
    } finally {
      await app.close();
      vi.useRealTimers();
    }
  });

  it("REGRESSION (review): a settlement-emission sink failure is NOT a scan throw — four healthy no_op ticks with a synchronously throwing log.info keep consecutiveThrowTicks at 0 (no false operability.tick_failure)", async () => {
    vi.useFakeTimers();
    const lines: string[] = [];
    const { app, clock } = buildApp(
      buildSettlementDb({ candidates: () => 3, txOutcomes: () => ["false"] }),
      lines,
    );
    resetSettlementFacts();
    await app.register(deadlineScannerPlugin);
    await app.ready();
    const infoSpy = vi.spyOn(app.log, "info").mockImplementation(() => {
      throw new Error("forced settlement sink failure");
    });

    try {
      await runTick(clock);
      await runTick(clock);
      await runTick(clock);
      await runTick(clock);

      // Four scans completed with all-no-op outcomes; only their settlement
      // line could not be written. Scan health must reflect exactly that:
      // zero throws (the monitor's tick_failure escalation input) and four
      // settled ticks — the emission loss must not be reclassified.
      expect(deadlineScannerMetrics.consecutiveThrowTicks).toBe(0);
      expect(deadlineScannerMetrics.consecutiveFailedTicks).toBe(0);
      expect(deadlineScannerMetrics.lastSettledAt).not.toBeNull();
      const parsed = parseLines(lines);
      expect(
        parsed.filter((l) => l.event === "scanner.tick.completed"),
      ).toEqual([]);
      expect(
        parsed.filter((l) => l.msg === "Error scanning for expired attempts"),
      ).toEqual([]);
    } finally {
      infoSpy.mockRestore();
      await app.close();
      vi.useRealTimers();
    }
  });

  // Selective log-sink fault injection: ONLY the named line's emit throws
  // synchronously; every other log call keeps writing through the real
  // logger. This isolates exactly ONE emission point per test, so a failure
  // identifies the un-isolated emit rather than "logging is broken".
  function throwOnMsg(
    app: ReturnType<typeof buildApp>["app"],
    msg: string,
    cause: string,
  ) {
    const originalError = app.log.error.bind(app.log);
    return vi.spyOn(app.log, "error").mockImplementation(((
      ...args: unknown[]
    ) => {
      if (args[1] === msg) {
        throw new Error(cause);
      }
      return (originalError as (...a: unknown[]) => void)(...args);
    }) as never);
  }

  it("REGRESSION (review): a per-candidate error-line sink throw neither aborts the remaining candidates nor reclassifies the tick — the tick settles partial_failure with business counters, zero tick throws", async () => {
    vi.useFakeTimers();
    const lines: string[] = [];
    const { app, clock } = buildApp(
      buildSettlementDb({
        candidates: () => 2,
        txOutcomes: () => ["throw", "true"],
      }),
      lines,
    );
    resetSettlementFacts();
    await app.register(deadlineScannerPlugin);
    await app.ready();
    const errorSpy = throwOnMsg(
      app,
      "Failed to auto-submit expired attempt",
      "forced per-candidate sink failure",
    );

    try {
      await runTick(clock);

      // Candidate 1 failed (its error line was lost with the sink — accepted);
      // candidate 2 was STILL processed and submitted. The tick must settle
      // as a normal partial_failure business outcome: exactly one settlement
      // line, business counters advanced, NO tick throw — a failing log sink
      // must never be counted as a scan throw (operability.tick_failure).
      const parsed = parseLines(lines);
      const completed = parsed.filter(
        (l) => l.event === "scanner.tick.completed",
      );
      expect(completed).toHaveLength(1);
      expect(completed[0]!.outcome).toBe("partial_failure");
      expect(completed[0]!.submittedCount).toBe(1);
      expect(completed[0]!.failedCount).toBe(1);
      expect(completed[0]!.discoveredCount).toBe(2);
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(deadlineScannerMetrics.consecutiveFailedTicks).toBe(1);
      expect(deadlineScannerMetrics.consecutiveThrowTicks).toBe(0);
      expect(deadlineScannerMetrics.autoSubmitCount).toBe(1);
      expect(deadlineScannerMetrics.failedCount).toBe(1);
    } finally {
      errorSpy.mockRestore();
      await app.close();
      vi.useRealTimers();
    }
  });

  it("REGRESSION (review): a tick-level error-line sink throw stays inside the tick body — the tick settles as a throw and no unhandled rejection escapes activeScan", async () => {
    vi.useFakeTimers();
    const lines: string[] = [];
    const { app, clock } = buildApp(
      buildSettlementDb({
        candidates: () => 1,
        txOutcomes: () => ["true"],
        orgDiscoveryThrows: () => true,
      }),
      lines,
    );
    resetSettlementFacts();
    await app.register(deadlineScannerPlugin);
    await app.ready();
    const errorSpy = throwOnMsg(
      app,
      "Error scanning for expired attempts",
      "forced tick-level sink failure",
    );
    const unhandled: unknown[] = [];
    const onUnhandled = (err: unknown) => {
      unhandled.push(err);
    };
    process.on("unhandledRejection", onUnhandled);

    try {
      await runTick(clock);

      // Settle bookkeeping is unchanged by the sink failure: the tick counts
      // as a throw; its only record was lost with the sink (accepted — the
      // sink that just threw is not a channel to report the loss on).
      expect(deadlineScannerMetrics.consecutiveThrowTicks).toBe(1);
      expect(deadlineScannerMetrics.lastSettledAt).not.toBeNull();

      // The contract under fix: the sink throw must not escape the tick
      // body. Cross REAL macrotask boundaries (fake timers are active, so
      // use the module-load reference) to let Node's unhandled-rejection
      // checkpoint run — an escaped tick-body rejection (process-fatal
      // under Node's default policy) must be observable here, and there
      // must be none.
      await new Promise<void>((resolve) =>
        realSetImmediate(() => realSetImmediate(resolve)),
      );
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
      errorSpy.mockRestore();
      await app.close();
      vi.useRealTimers();
    }
  });
});
