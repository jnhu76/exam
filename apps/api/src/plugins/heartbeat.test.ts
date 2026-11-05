import { describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import { Writable } from "node:stream";
import {
  organizations,
  examAttempts,
  attemptInterruptionEvents,
} from "@exam/db/schema/pg";
import heartbeatPlugin, {
  heartbeatMetrics,
  scanForDisruptedAttempts,
} from "./heartbeat.js";
import { classifyLoopStall } from "./operabilityMonitor.js";

describe("heartbeat plugin", () => {
  describe("scanForDisruptedAttempts", () => {
    it("marks attempts as disrupted when heartbeat timeout exceeded", async () => {
      const now = new Date("2025-01-01T11:00:00Z");
      const timeoutMs = 60_000;
      const markedIds: string[] = [];

      const scanResult = await scanForDisruptedAttempts(
        [
          {
            id: "att-1",
            status: "in_progress",
            lastActivityAt: new Date("2025-01-01T10:59:00Z"),
          },
          {
            id: "att-2",
            status: "in_progress",
            lastActivityAt: new Date("2025-01-01T10:59:30Z"),
          },
          {
            id: "att-3",
            status: "in_progress",
            lastActivityAt: new Date("2025-01-01T10:58:00Z"),
          },
        ],
        now,
        timeoutMs,
        async (id) => {
          markedIds.push(id);
          return true;
        },
      );

      expect(scanResult.markedCount).toBe(2);
      expect(markedIds).toContain("att-1");
      expect(markedIds).toContain("att-3");
      expect(markedIds).not.toContain("att-2");
    });

    it("returns 0 markedCount when no attempts need marking", async () => {
      const now = new Date("2025-01-01T11:00:00Z");
      const timeoutMs = 60_000;

      const scanResult = await scanForDisruptedAttempts(
        [
          {
            id: "att-1",
            status: "in_progress",
            lastActivityAt: new Date("2025-01-01T10:59:30Z"),
          },
        ],
        now,
        timeoutMs,
        async () => true,
      );

      expect(scanResult.markedCount).toBe(0);
    });

    it("skips non in_progress attempts", async () => {
      const now = new Date("2025-01-01T11:00:00Z");
      const timeoutMs = 60_000;
      const markedIds: string[] = [];

      const scanResult = await scanForDisruptedAttempts(
        [
          {
            id: "att-1",
            status: "submitted",
            lastActivityAt: new Date("2025-01-01T10:00:00Z"),
          },
          {
            id: "att-2",
            status: "disrupted",
            lastActivityAt: new Date("2025-01-01T10:00:00Z"),
          },
        ],
        now,
        timeoutMs,
        async (id) => {
          markedIds.push(id);
          return true;
        },
      );

      expect(scanResult.markedCount).toBe(0);
    });

    it("does not count a no-op race (onDisrupted returns false) in markedCount", async () => {
      const now = new Date("2025-01-01T11:00:00Z");
      const timeoutMs = 60_000;
      const onDisrupted = vi.fn(async () => false);

      const scanResult = await scanForDisruptedAttempts(
        [
          {
            id: "noop-1",
            status: "in_progress",
            lastActivityAt: new Date("2025-01-01T10:00:00Z"),
          },
        ],
        now,
        timeoutMs,
        onDisrupted,
      );

      expect(onDisrupted).toHaveBeenCalledTimes(1);
      expect(scanResult.markedCount).toBe(0);
    });

    it("counts a state change when onDisrupted returns true or void", async () => {
      const now = new Date("2025-01-01T11:00:00Z");
      const timeoutMs = 60_000;
      const onDisrupted = vi.fn(async (id: string) => {
        if (id === "ret-true") return true;
        if (id === "ret-void") return undefined;
        return false;
      });

      const scanResult = await scanForDisruptedAttempts(
        [
          {
            id: "ret-true",
            status: "in_progress",
            lastActivityAt: new Date("2025-01-01T10:00:00Z"),
          },
          {
            id: "ret-void",
            status: "in_progress",
            lastActivityAt: new Date("2025-01-01T10:00:00Z"),
          },
          {
            id: "ret-false",
            status: "in_progress",
            lastActivityAt: new Date("2025-01-01T10:00:00Z"),
          },
        ],
        now,
        timeoutMs,
        onDisrupted,
      );

      expect(scanResult.markedCount).toBe(2);
    });

    it("records failedCount and invokes onError when onDisrupted throws (retry next scan)", async () => {
      const now = new Date("2025-01-01T11:00:00Z");
      const timeoutMs = 60_000;
      const markedIds: string[] = [];
      const onDisrupted = vi.fn(async (id: string) => {
        if (id === "fail-1") {
          throw new Error("transient db error");
        }
        markedIds.push(id);
        return true;
      });
      const onError = vi.fn();

      const scanResult = await scanForDisruptedAttempts(
        [
          {
            id: "fail-1",
            status: "in_progress",
            lastActivityAt: new Date("2025-01-01T10:00:00Z"),
          },
          {
            id: "ok-1",
            status: "in_progress",
            lastActivityAt: new Date("2025-01-01T10:00:00Z"),
          },
        ],
        now,
        timeoutMs,
        onDisrupted,
        { onError },
      );

      expect(markedIds).toEqual(["ok-1"]);
      expect(scanResult.markedCount).toBe(1);
      expect(scanResult.failedCount).toBe(1);
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError.mock.calls[0]![0]).toBe("fail-1");
    });

    it("continues scanning remaining attempts when onError itself throws", async () => {
      const now = new Date("2025-01-01T11:00:00Z");
      const timeoutMs = 60_000;
      const visitedIds: string[] = [];
      const onDisrupted = vi.fn(async (id: string) => {
        visitedIds.push(id);
        throw new Error("transient db error");
      });
      // A misbehaving error callback that throws must NOT abort the scan loop.
      const throwingOnError = vi.fn(() => {
        throw new Error("buggy error reporter");
      });

      const scanResult = await scanForDisruptedAttempts(
        [
          {
            id: "att-1",
            status: "in_progress",
            lastActivityAt: new Date("2025-01-01T10:00:00Z"),
          },
          {
            id: "att-2",
            status: "in_progress",
            lastActivityAt: new Date("2025-01-01T10:00:00Z"),
          },
        ],
        now,
        timeoutMs,
        onDisrupted,
        { onError: throwingOnError },
      );

      // Both attempts were visited despite onError throwing for the first.
      expect(visitedIds).toEqual(["att-1", "att-2"]);
      expect(scanResult.failedCount).toBe(2);
      expect(scanResult.markedCount).toBe(0);
      expect(throwingOnError).toHaveBeenCalledTimes(2);
    });
  });
});

// Issue #547.
describe("heartbeat plugin — stall-fact bookkeeping", () => {
  // The `now` decoration below is a manually-advanced controlled clock (the
  // operation time authority for the plugin); vi's fake timers advance only
  // the interval. Advancing both together keeps every stamp deterministic.
  // Module-level singleton: reset the stall facts to fresh-process state.
  function resetStallFacts() {
    heartbeatMetrics.startedAt = null;
    heartbeatMetrics.lastStartedAt = null;
    heartbeatMetrics.lastSettledAt = null;
    heartbeatMetrics.activeSince = null;
  }

  function buildApp(db: unknown) {
    const clock = { current: new Date("2026-09-17T08:00:00Z") };
    const app = Fastify({ logger: false });
    app.decorate<unknown>("db", db as never);
    app.decorate("now", () => clock.current);
    return { app, clock };
  }

  it("records startedAt at registration and stamps start/settle facts per tick; a throwing cycle still settles", async () => {
    vi.useFakeTimers();
    // Outer-boundary fake: the first drizzle entry point throws — the cycle
    // must fail loudly AND still settle (settled != success).
    const { app, clock } = buildApp({
      select: () => {
        throw new Error("forced scan failure");
      },
    });
    resetStallFacts();
    await app.register(heartbeatPlugin);
    await app.ready();

    try {
      expect(heartbeatMetrics.startedAt).toEqual(clock.current);
      expect(heartbeatMetrics.lastSettledAt).toBeNull();

      clock.current = new Date(clock.current.getTime() + 30_000);
      await vi.advanceTimersByTimeAsync(30_000);

      expect(heartbeatMetrics.lastStartedAt).not.toBeNull();
      expect(heartbeatMetrics.lastSettledAt).not.toBeNull();
      expect(heartbeatMetrics.activeSince).toBeNull();
      // The settling stamp is on the operation clock.
      expect(heartbeatMetrics.lastSettledAt?.getTime()).toBe(
        clock.current.getTime(),
      );
    } finally {
      await app.close();
      vi.useRealTimers();
    }
  });

  it("a hung cycle keeps activeSince set and skips later ticks — the input the stall classifier consumes", async () => {
    vi.useFakeTimers();
    // Deferred hang: teardown rejects it so the in-flight cycle settles
    // and the plugin's awaited onClose can complete (no dangling close).
    let releaseHang: (err: Error) => void = () => {};
    const hang = new Promise<never>((_, reject) => {
      releaseHang = reject;
    });
    const { app, clock } = buildApp({
      // organizationRepo.list() = select().from(...) — the from() leg hangs.
      select: () => ({ from: () => hang }),
    });
    resetStallFacts();
    await app.register(heartbeatPlugin);
    await app.ready();

    try {
      clock.current = new Date(clock.current.getTime() + 30_000);
      await vi.advanceTimersByTimeAsync(30_000);
      const hangStart = heartbeatMetrics.lastStartedAt;
      expect(hangStart).not.toBeNull();
      expect(heartbeatMetrics.activeSince).toEqual(hangStart);

      // Many more intervals fire; the guard skips them all — no new starts.
      clock.current = new Date(clock.current.getTime() + 10 * 30_000);
      await vi.advanceTimersByTimeAsync(10 * 30_000);
      expect(heartbeatMetrics.lastStartedAt).toEqual(hangStart);
      expect(heartbeatMetrics.activeSince).toEqual(hangStart);
      expect(heartbeatMetrics.lastSettledAt).toBeNull();

      // And the classifier reads exactly this as STALLED at 4x interval
      // (inclusive boundary), ACTIVE one tick before it.
      expect(
        classifyLoopStall(
          heartbeatMetrics,
          30_000,
          new Date(hangStart!.getTime() + 4 * 30_000),
        ),
      ).toBe("stalled");
      expect(
        classifyLoopStall(
          heartbeatMetrics,
          30_000,
          new Date(hangStart!.getTime() + 4 * 30_000 - 1),
        ),
      ).toBe("active");
    } finally {
      releaseHang(new Error("test teardown"));
      await app.close();
      vi.useRealTimers();
    }
    // The released cycle settles — recovery input for the classifier.
    expect(heartbeatMetrics.lastSettledAt).not.toBeNull();
    expect(heartbeatMetrics.activeSince).toBeNull();
  });
});

// #800 PR-D (A4-F2 + A4-F3): per-leg in-memory failure counters and the
// aggregation-log contract for all-failure ticks. The fake db routes by
// drizzle table identity: organization discovery returns one org,
// listInProgress returns one stale in_progress attempt, every transaction
// rejects (disruption-leg failure), and the incident leg's first query
// rejects (reconciliation-leg failure) — so the tick produces
// markedCount=0/createdCount=0 with failedCount=1 on BOTH legs.
describe("heartbeat plugin — failure counters and all-failure aggregation log", () => {
  const ORG = { id: "org-1" };
  const STALE_ATTEMPT = {
    id: "att-fail",
    status: "in_progress",
    lastActivityAt: new Date("2026-09-17T07:00:00Z"),
  };

  function buildAllFailingDb(): unknown {
    return {
      select: () => ({
        from: (table: unknown) => {
          if (table === organizations) return Promise.resolve([ORG]);
          if (table === examAttempts) {
            return { where: () => Promise.resolve([STALE_ATTEMPT]) };
          }
          throw new Error("unexpected table in heartbeat fake db");
        },
      }),
      transaction: async () => {
        throw new Error("forced disruption failure");
      },
    };
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

  function resetCounters() {
    heartbeatMetrics.startedAt = null;
    heartbeatMetrics.lastStartedAt = null;
    heartbeatMetrics.lastSettledAt = null;
    heartbeatMetrics.activeSince = null;
    heartbeatMetrics.disruptedCount = 0;
    heartbeatMetrics.disruptionFailedCount = 0;
    heartbeatMetrics.systemIncidentsCreated = 0;
    heartbeatMetrics.systemIncidentConflicts = 0;
    heartbeatMetrics.incidentReconciliationFailedCount = 0;
  }

  it("accumulates per-leg failure counters and emits aggregation rows for an all-failure tick", async () => {
    vi.useFakeTimers();
    const lines: string[] = [];
    const { app, clock } = buildApp(buildAllFailingDb(), lines);
    resetCounters();
    await app.register(heartbeatPlugin);
    await app.ready();

    try {
      clock.current = new Date(clock.current.getTime() + 30_000);
      await vi.advanceTimersByTimeAsync(30_000);

      // A4-F2: each leg accumulates its own in-memory failure counter
      // (single-instance, reset on restart — never persisted).
      expect(heartbeatMetrics.disruptedCount).toBe(0);
      expect(heartbeatMetrics.disruptionFailedCount).toBe(1);
      expect(heartbeatMetrics.systemIncidentsCreated).toBe(0);
      expect(heartbeatMetrics.incidentReconciliationFailedCount).toBe(1);

      // A4-F3: a tick with zero successes but failures must still emit the
      // aggregation info rows — same grep contract as the deadline scanner's
      // `submittedCount > 0 || failedCount > 0` condition.
      const parsed = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
      const disruptionRow = parsed.find(
        (l) => l.msg === "Marked stale exam attempts as disrupted",
      );
      expect(disruptionRow).toBeDefined();
      expect(disruptionRow!.markedCount).toBe(0);
      expect(disruptionRow!.failedCount).toBe(1);

      const incidentRow = parsed.find(
        (l) => l.msg === "Created System incidents from heartbeat episodes",
      );
      expect(incidentRow).toBeDefined();
      expect(incidentRow!.createdCount).toBe(0);
      expect(incidentRow!.failedCount).toBe(1);
    } finally {
      await app.close();
      vi.useRealTimers();
    }
  });

  it("a fully successful quiet tick (no marks, no failures) emits no aggregation row", async () => {
    vi.useFakeTimers();
    const lines: string[] = [];
    // Zero-episode discovery chain: select(...).from(...).innerJoin(...)…
    // resolves to []; with no episodes the arbiter probe short-circuits, so
    // BOTH legs finish quiet.
    const emptyEpisodeChain = {
      innerJoin: () => emptyEpisodeChain,
      where: () => emptyEpisodeChain,
      orderBy: () => Promise.resolve([]),
    };
    const quietDb = {
      select: () => ({
        from: (table: unknown) => {
          if (table === organizations) return Promise.resolve([ORG]);
          if (table === examAttempts) {
            return { where: () => Promise.resolve([]) };
          }
          if (table === attemptInterruptionEvents) return emptyEpisodeChain;
          throw new Error("unexpected table in heartbeat fake db");
        },
      }),
    };
    const { app, clock } = buildApp(quietDb, lines);
    resetCounters();
    await app.register(heartbeatPlugin);
    await app.ready();

    try {
      clock.current = new Date(clock.current.getTime() + 30_000);
      await vi.advanceTimersByTimeAsync(30_000);

      expect(heartbeatMetrics.disruptionFailedCount).toBe(0);
      expect(heartbeatMetrics.incidentReconciliationFailedCount).toBe(0);

      const parsed = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
      expect(
        parsed.find((l) => l.msg === "Marked stale exam attempts as disrupted"),
      ).toBeUndefined();
      expect(
        parsed.find(
          (l) => l.msg === "Created System incidents from heartbeat episodes",
        ),
      ).toBeUndefined();
    } finally {
      await app.close();
      vi.useRealTimers();
    }
  });
});

// Issue #862 — the persistent business-failure escalation input the operability
// monitor consumes. The heartbeat tick settles even when BOTH legs (disruption
// + incident reconciliation) fail every cycle; the escalation signal is the
// per-tick consecutive-failure counter, reset by the first clean settle.
describe("heartbeat plugin — persistent business-failure escalation input (#862)", () => {
  const ORG = { id: "org-1" };
  const STALE_ATTEMPT = {
    id: "att-fail",
    status: "in_progress",
    lastActivityAt: new Date("2026-09-17T07:00:00Z"),
  };

  function buildAllFailingDb(
    orgDiscoveryThrows: () => boolean = () => false,
  ): unknown {
    return {
      select: () => ({
        from: (table: unknown) => {
          if (table === organizations) {
            if (orgDiscoveryThrows()) {
              throw new Error("forced org discovery failure");
            }
            return Promise.resolve([ORG]);
          }
          if (table === examAttempts) {
            return { where: () => Promise.resolve([STALE_ATTEMPT]) };
          }
          // The incident leg's first query hits an unhandled table → throws →
          // reconciliation-leg failure (discovery-level catch).
          throw new Error("unexpected table in heartbeat fake db");
        },
      }),
      transaction: async () => {
        throw new Error("forced disruption failure");
      },
    };
  }

  function buildQuietDb(): unknown {
    const emptyEpisodeChain = {
      innerJoin: () => emptyEpisodeChain,
      where: () => emptyEpisodeChain,
      orderBy: () => Promise.resolve([]),
    };
    return {
      select: () => ({
        from: (table: unknown) => {
          if (table === organizations) return Promise.resolve([ORG]);
          if (table === examAttempts) {
            return { where: () => Promise.resolve([]) };
          }
          if (table === attemptInterruptionEvents) return emptyEpisodeChain;
          throw new Error("unexpected table in heartbeat fake db");
        },
      }),
    };
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

  function resetEscalationFacts() {
    heartbeatMetrics.startedAt = null;
    heartbeatMetrics.lastStartedAt = null;
    heartbeatMetrics.lastSettledAt = null;
    heartbeatMetrics.activeSince = null;
    heartbeatMetrics.disruptedCount = 0;
    heartbeatMetrics.disruptionFailedCount = 0;
    heartbeatMetrics.systemIncidentsCreated = 0;
    heartbeatMetrics.systemIncidentConflicts = 0;
    heartbeatMetrics.incidentReconciliationFailedCount = 0;
    heartbeatMetrics.consecutiveFailedTicks = 0;
  }

  async function runTick(clock: { current: Date }) {
    clock.current = new Date(clock.current.getTime() + 30_000);
    await vi.advanceTimersByTimeAsync(30_000);
  }

  it("REGRESSION: both legs failing every settled tick increments consecutiveFailedTicks; the first clean tick resets it — the monitor's escalation input", async () => {
    vi.useFakeTimers();
    const lines: string[] = [];
    const failing = buildApp(buildAllFailingDb(), lines);
    resetEscalationFacts();
    await failing.app.register(heartbeatPlugin);
    await failing.app.ready();

    try {
      for (let i = 0; i < 4; i++) await runTick(failing.clock);

      expect(heartbeatMetrics.consecutiveFailedTicks).toBe(4);
      // Settling-with-failures is not a stall: the stall classifier stays
      // healthy on the very input the escalation counter is climbing on.
      expect(
        classifyLoopStall(
          heartbeatMetrics,
          30_000,
          heartbeatMetrics.lastSettledAt!,
        ),
      ).toBe("healthy");
    } finally {
      await failing.app.close();
    }

    // The first zero-failure settle resets the run. This tick exercises the
    // idle shape (no marks, no failures on either leg). The successful shape
    // (disruptions marked / incidents created, zero failures — pinned by the
    // scanForDisruptedAttempts tests above) feeds the same failedCount-only
    // rule and resets identically: "no failing work observed" and "failures
    // cleared" are one fact for this state-condition alert
    // (docs/operations/active-alerting.md §1 recovery semantics).
    const quiet = buildApp(buildQuietDb(), lines);
    await quiet.app.register(heartbeatPlugin);
    await quiet.app.ready();
    try {
      await runTick(quiet.clock);
      expect(heartbeatMetrics.consecutiveFailedTicks).toBe(0);
    } finally {
      await quiet.app.close();
      vi.useRealTimers();
    }
  });

  it("REGRESSION: a tick-level THROW freezes the counter — neither resets nor advances it (the documented readiness-ownership boundary)", async () => {
    vi.useFakeTimers();
    const lines: string[] = [];
    let orgDiscoveryThrows = false;
    const mixed = buildApp(
      buildAllFailingDb(() => orgDiscoveryThrows),
      lines,
    );
    resetEscalationFacts();
    await mixed.app.register(heartbeatPlugin);
    await mixed.app.ready();

    try {
      await runTick(mixed.clock);
      expect(heartbeatMetrics.consecutiveFailedTicks).toBe(1);

      // A tick whose org discovery THROWS settles via the catch path but
      // carries NO business-failure evidence: the counter must stay exactly
      // where it was — not reset to 0 (a throw is not recovery), not
      // advanced (a thrown cycle is owned by the readiness facts).
      orgDiscoveryThrows = true;
      await runTick(mixed.clock);
      expect(heartbeatMetrics.lastSettledAt).not.toBeNull();
      expect(heartbeatMetrics.consecutiveFailedTicks).toBe(1);

      // CONTINUOUS tick-level throws (DB readiness normal throughout): every
      // thrown cycle settles (not stalled), and the business-failure counter
      // stays frozen — a thrown cycle carries no business-failure evidence in
      // either direction; the readiness facts own it.
      for (let i = 0; i < 3; i++) {
        await runTick(mixed.clock);
        expect(heartbeatMetrics.consecutiveFailedTicks).toBe(1);
      }

      // The frozen run continues from where it froze.
      orgDiscoveryThrows = false;
      await runTick(mixed.clock);
      expect(heartbeatMetrics.consecutiveFailedTicks).toBe(2);
    } finally {
      await mixed.app.close();
      vi.useRealTimers();
    }
  });
});
