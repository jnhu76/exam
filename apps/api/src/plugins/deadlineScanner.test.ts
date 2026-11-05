import { describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import { Writable } from "node:stream";
import { organizations, examAttempts } from "@exam/db/schema/pg";
import deadlineScannerPlugin, {
  deadlineScannerMetrics,
  scanDeadlineCandidates,
  type DeadlineCandidate,
} from "./deadlineScanner.js";
import { classifyLoopStall } from "./operabilityMonitor.js";

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
      // advanced (a thrown cycle is owned by the readiness facts).
      orgDiscoveryThrows = true;
      await runTick(clock);
      expect(deadlineScannerMetrics.lastSettledAt).not.toBeNull();
      expect(deadlineScannerMetrics.consecutiveFailedTicks).toBe(1);

      // CONTINUOUS tick-level throws (DB readiness normal throughout): every
      // thrown cycle settles, so the loop is not stalled, the readiness
      // probe is the monitor's separate fact, and the business-failure
      // counter stays frozen below the threshold indefinitely — the per-tick
      // ERROR logs are the only signal for this shape, by ownership design.
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
});
