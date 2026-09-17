import { describe, expect, it, vi } from "vitest";
import {
  classifyLoopStall,
  createOperabilityTransitionTracker,
  LOOP_STALL_FACTOR,
  loopStaleAfterMs,
  probeApplicationReadiness,
  READINESS_PROBE_BUDGET_MS,
  type LoopActivity,
  type ReadinessProbeDeps,
} from "./operabilityMonitor.js";

/**
 * #547 unit layer: the pure classification/transition semantics behind the
 * readiness gate and the bounded operability alerts. All time is explicit —
 * no sleeps (docs/standards/test-flakes.md).
 */

const T0 = new Date("2026-09-17T08:00:00Z");
const ms = (n: number) => new Date(T0.getTime() + n);

function activity(partial: Partial<LoopActivity> = {}): LoopActivity {
  return {
    startedAt: T0,
    lastStartedAt: null,
    lastSettledAt: null,
    activeSince: null,
    ...partial,
  };
}

function probeDeps(
  partial: Partial<ReadinessProbeDeps> = {},
): ReadinessProbeDeps {
  return {
    pingDb: async () => 1,
    redisRequired: false,
    redisUsable: () => true,
    ...partial,
  };
}

describe("probeApplicationReadiness — mandatory-dependency derivation", () => {
  it("ready when the database probe succeeds and Redis is not required", async () => {
    const result = await probeApplicationReadiness(probeDeps());
    expect(result).toEqual({
      ready: true,
      database: true,
      redis: null,
      failedComponent: null,
    });
  });

  it("not ready, component database, when the probe throws", async () => {
    const result = await probeApplicationReadiness(
      probeDeps({
        pingDb: async () => {
          throw new Error("connection refused");
        },
      }),
    );
    expect(result.ready).toBe(false);
    expect(result.database).toBe(false);
    expect(result.failedComponent).toBe("database");
  });

  it("not ready when the probe hangs past its budget (bounded, no unbounded await)", async () => {
    const result = await probeApplicationReadiness(
      probeDeps({ pingDb: () => new Promise<number>(() => {}) }),
      { budgetMs: 20 },
    );
    expect(result.ready).toBe(false);
    expect(result.failedComponent).toBe("database");
  });

  it("clears the budget timer once the probe settles (no stray rejection later)", async () => {
    const clearSpy = vi.spyOn(globalThis, "clearTimeout");
    try {
      await probeApplicationReadiness(probeDeps(), { budgetMs: 20 });
      expect(clearSpy).toHaveBeenCalledTimes(1);
    } finally {
      clearSpy.mockRestore();
    }
  });

  it("redis optional + unusable stays ready (degraded rate limiting, not readiness)", async () => {
    const result = await probeApplicationReadiness(
      probeDeps({ redisRequired: false, redisUsable: () => false }),
    );
    expect(result.ready).toBe(true);
    expect(result.redis).toBeNull();
  });

  it("redis required + unusable is not ready (mirrors the existing fail-closed authority)", async () => {
    const result = await probeApplicationReadiness(
      probeDeps({ redisRequired: true, redisUsable: () => false }),
    );
    expect(result.ready).toBe(false);
    expect(result.database).toBe(true);
    expect(result.redis).toBe(false);
    expect(result.failedComponent).toBe("redis");
  });

  it("redis required + usable is ready", async () => {
    const result = await probeApplicationReadiness(
      probeDeps({ redisRequired: true, redisUsable: () => true }),
    );
    expect(result.ready).toBe(true);
    expect(result.redis).toBe(true);
  });

  it("database is the first failed component when both mandatory legs fail", async () => {
    const result = await probeApplicationReadiness(
      probeDeps({
        pingDb: async () => {
          throw new Error("down");
        },
        redisRequired: true,
        redisUsable: () => false,
      }),
    );
    expect(result.failedComponent).toBe("database");
    expect(result.ready).toBe(false);
  });

  it("default budget is well under the Compose healthcheck timeout", () => {
    // 5s Docker probe timeout must dominate the in-app budget (01-semantics §4).
    expect(READINESS_PROBE_BUDGET_MS).toBeLessThan(5_000);
  });
});

describe("classifyLoopStall — WARMING/HEALTHY/ACTIVE/STALLED", () => {
  const interval = 30_000;
  const staleAfter = interval * LOOP_STALL_FACTOR;

  it("S1 normal progression settles into healthy between cycles", () => {
    const a = activity({
      lastStartedAt: ms(0),
      lastSettledAt: ms(1_000),
    });
    expect(classifyLoopStall(a, interval, ms(2_000))).toBe("healthy");
    expect(classifyLoopStall(a, interval, ms(staleAfter - 1))).toBe("healthy");
  });

  it("S2 bootstrap: nothing settled yet within grace is warming, never stalled", () => {
    const a = activity();
    expect(classifyLoopStall(a, interval, ms(interval))).toBe("warming");
    expect(classifyLoopStall(a, interval, ms(staleAfter - 1))).toBe("warming");
  });

  it("S3 hung cycle: activeSince past the threshold is stalled (B2 hang detection)", () => {
    const a = activity({
      lastStartedAt: ms(100_000),
      lastSettledAt: ms(90_000),
      activeSince: ms(100_000),
    });
    expect(classifyLoopStall(a, interval, ms(100_000 + staleAfter))).toBe(
      "stalled",
    );
  });

  it("S3 in-flight within the bound is active, not stalled (long legitimate cycle)", () => {
    const a = activity({
      lastStartedAt: ms(100_000),
      lastSettledAt: ms(90_000),
      activeSince: ms(100_000),
    });
    expect(classifyLoopStall(a, interval, ms(100_000 + staleAfter - 1))).toBe(
      "active",
    );
  });

  it("B3 timer dead: settled long ago with no new start is stalled", () => {
    const a = activity({
      lastStartedAt: ms(10_000),
      lastSettledAt: ms(11_000),
    });
    expect(classifyLoopStall(a, interval, ms(11_000 + staleAfter))).toBe(
      "stalled",
    );
  });

  it("timer never fired at all past the grace window is stalled", () => {
    const a = activity();
    expect(classifyLoopStall(a, interval, ms(staleAfter))).toBe("stalled");
  });

  it("a cycle that settles WITH an error is not stalled (settled ≠ success; readiness alert owns DB loss)", () => {
    // DB-down cycles throw every interval — they settle; stall means "never settles".
    const a = activity({
      lastStartedAt: ms(70_000),
      lastSettledAt: ms(70_500), // settled (with error) shortly after start
    });
    expect(classifyLoopStall(a, interval, ms(101_000))).toBe("healthy");
  });

  it("threshold derivation: staleAfter = 4 × configured interval", () => {
    expect(LOOP_STALL_FACTOR).toBe(4);
    expect(loopStaleAfterMs(30_000)).toBe(120_000);
  });
});

describe("createOperabilityTransitionTracker — bounded transition alerts", () => {
  it("first observation of a healthy state emits nothing", () => {
    const tracker = createOperabilityTransitionTracker();
    expect(tracker(false)).toBeNull();
  });

  it("A1/A3 entering failure emits exactly one raise_failure", () => {
    const tracker = createOperabilityTransitionTracker();
    expect(tracker(false)).toBeNull();
    expect(tracker(true)).toBe("raise_failure");
  });

  it("S4 repeated failed evaluations never re-emit (no log storm)", () => {
    const tracker = createOperabilityTransitionTracker();
    tracker(false);
    expect(tracker(true)).toBe("raise_failure");
    expect(tracker(true)).toBeNull();
    expect(tracker(true)).toBeNull();
  });

  it("A2/S5 recovery emits exactly one raise_recovery, then silence", () => {
    const tracker = createOperabilityTransitionTracker();
    tracker(true);
    expect(tracker(false)).toBe("raise_recovery");
    expect(tracker(false)).toBeNull();
  });

  it("restart semantics: a tracker that first observes failure re-emits the outage", () => {
    const tracker = createOperabilityTransitionTracker();
    expect(tracker(true)).toBe("raise_failure");
  });
});

import {
  evaluateOperabilityTick,
  type OperabilitySnapshotInput,
} from "./operabilityMonitor.js";

/**
 * F1 (adversarial review): the alert-emission glue itself. The catalogue in
 * 03-alert-contract.md — event / component / state / level per fact, the
 * tracker wiring (no swapped or inverted legs), and the bounded transition
 * behavior — is pinned HERE, not just the classifier inputs.
 */

function snapshotInput(
  partial: Partial<OperabilitySnapshotInput> = {},
): OperabilitySnapshotInput {
  const healthyActivity = {
    startedAt: T0,
    lastStartedAt: ms(-1_000),
    lastSettledAt: ms(-500),
    activeSince: null,
  };
  return {
    readiness: {
      ready: true,
      database: true,
      redis: null,
      failedComponent: null,
    },
    heartbeat: { ...healthyActivity },
    heartbeatIntervalMs: 30_000,
    deadline: { ...healthyActivity },
    deadlineIntervalMs: 30_000,
    now: ms(0),
    ...partial,
  };
}

function makeTrackers() {
  return {
    database: createOperabilityTransitionTracker(),
    redis: createOperabilityTransitionTracker(),
    heartbeat: createOperabilityTransitionTracker(),
    deadline_scanner: createOperabilityTransitionTracker(),
  };
}

describe("evaluateOperabilityTick — the alert catalogue, wired end to end", () => {
  it("healthy everything → no alerts at all", () => {
    const trackers = makeTrackers();
    const alerts = evaluateOperabilityTick(snapshotInput(), trackers);
    expect(alerts).toEqual([]);
  });

  it("database loss → exactly one operability.readiness unavailable ERROR with the documented fields", () => {
    const trackers = makeTrackers();
    const input = snapshotInput({
      readiness: {
        ready: false,
        database: false,
        redis: null,
        failedComponent: "database",
      },
    });
    const alerts = evaluateOperabilityTick(input, trackers);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      event: "operability.readiness",
      component: "database",
      state: "unavailable",
      level: "error",
    });
  });

  it("database recovery → exactly one operability.readiness recovered INFO", () => {
    const trackers = makeTrackers();
    trackers.database(true); // outage already raised
    const input = snapshotInput({
      readiness: {
        ready: true,
        database: true,
        redis: null,
        failedComponent: null,
      },
    });
    const alerts = evaluateOperabilityTick(input, trackers);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      event: "operability.readiness",
      component: "database",
      state: "recovered",
      level: "info",
    });
  });

  it("required-mode Redis loss emits its OWN component — not folded into database", () => {
    const trackers = makeTrackers();
    const input = snapshotInput({
      readiness: {
        ready: false,
        database: true,
        redis: false,
        failedComponent: "redis",
      },
    });
    const alerts = evaluateOperabilityTick(input, trackers);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      event: "operability.readiness",
      component: "redis",
      state: "unavailable",
      level: "error",
    });
  });

  it("redis optional (redis: null) never emits a redis alert", () => {
    const trackers = makeTrackers();
    const input = snapshotInput({
      readiness: {
        ready: false,
        database: false,
        redis: null,
        failedComponent: "database",
      },
    });
    const alerts = evaluateOperabilityTick(input, trackers);
    expect(alerts.map((a) => a.component)).toEqual(["database"]);
  });

  it("hung heartbeat (S3) → operability.background_loop heartbeat STALLED error; wiring is not swapped", () => {
    const trackers = makeTrackers();
    const input = snapshotInput({
      heartbeat: {
        startedAt: T0,
        lastStartedAt: ms(-300_000),
        lastSettledAt: ms(-310_000),
        activeSince: ms(-300_000), // hung for 10 intervals
      },
    });
    const alerts = evaluateOperabilityTick(input, trackers);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      event: "operability.background_loop",
      component: "heartbeat",
      state: "stalled",
      level: "error",
    });
  });

  it("hung deadline scanner → component deadline_scanner (not heartbeat)", () => {
    const trackers = makeTrackers();
    const input = snapshotInput({
      deadline: {
        startedAt: T0,
        lastStartedAt: ms(-300_000),
        lastSettledAt: ms(-310_000),
        activeSince: ms(-300_000),
      },
    });
    const alerts = evaluateOperabilityTick(input, trackers);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.component).toBe("deadline_scanner");
    expect(alerts[0]!.event).toBe("operability.background_loop");
  });

  it("S4: repeated STALLED evaluations never re-emit (no storm); recovery emits exactly one recovered", () => {
    const trackers = makeTrackers();
    const stalledInput = snapshotInput({
      heartbeat: {
        startedAt: T0,
        lastStartedAt: ms(-300_000),
        lastSettledAt: ms(-310_000),
        activeSince: ms(-300_000),
      },
    });
    expect(evaluateOperabilityTick(stalledInput, trackers)).toHaveLength(1);
    expect(evaluateOperabilityTick(stalledInput, trackers)).toEqual([]);
    expect(evaluateOperabilityTick(stalledInput, trackers)).toEqual([]);

    const healthyInput = snapshotInput();
    const recovery = evaluateOperabilityTick(healthyInput, trackers);
    expect(recovery).toHaveLength(1);
    expect(recovery[0]).toMatchObject({
      event: "operability.background_loop",
      component: "heartbeat",
      state: "recovered",
      level: "info",
    });
    expect(evaluateOperabilityTick(healthyInput, trackers)).toEqual([]);
  });

  it("both loops stalled at once → two independent alerts (per-fact bounding)", () => {
    const trackers = makeTrackers();
    const stalled = {
      startedAt: T0,
      lastStartedAt: ms(-300_000),
      lastSettledAt: ms(-310_000),
      activeSince: ms(-300_000),
    };
    const alerts = evaluateOperabilityTick(
      snapshotInput({ heartbeat: { ...stalled }, deadline: { ...stalled } }),
      trackers,
    );
    expect(alerts.map((a) => a.component).sort()).toEqual([
      "deadline_scanner",
      "heartbeat",
    ]);
  });

  it("DB loss AND a stalled loop at once → readiness + loop alerts together (independent facts)", () => {
    const trackers = makeTrackers();
    const input = snapshotInput({
      readiness: {
        ready: false,
        database: false,
        redis: null,
        failedComponent: "database",
      },
      heartbeat: {
        startedAt: T0,
        lastStartedAt: ms(-300_000),
        lastSettledAt: ms(-310_000),
        activeSince: ms(-300_000),
      },
    });
    const alerts = evaluateOperabilityTick(input, trackers);
    expect(
      alerts.map((a) => `${a.event}/${a.component}/${a.state}`).sort(),
    ).toEqual([
      "operability.background_loop/heartbeat/stalled",
      "operability.readiness/database/unavailable",
    ]);
  });
});
