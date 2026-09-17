import { describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
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

describe("heartbeat plugin — #547 stall-fact bookkeeping", () => {
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

  it("a hung cycle keeps activeSince set and skips later ticks — the input the stall classifier consumes (B2)", async () => {
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
