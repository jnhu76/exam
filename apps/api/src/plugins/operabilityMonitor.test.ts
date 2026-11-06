import { describe, expect, it, vi } from "vitest";
import {
  organizations,
  examAttempts,
  attemptInterruptionEvents,
} from "@exam/db/schema/pg";
import { resetRuntimeConfigForTest } from "../config/runtimeConfig.js";
import heartbeatPlugin from "./heartbeat.js";
import deadlineScannerPlugin from "./deadlineScanner.js";
import { clientEventRetentionMetrics } from "./clientEventRetention.js";
import {
  BUSINESS_FAILURE_TICK_THRESHOLD,
  classifyLoopStall,
  classifyPersistentBusinessFailure,
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
 * docs/operations/active-alerting.md — event / component / state / level per fact, the
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
    retention: { ...healthyActivity },
    retentionIntervalMs: 30_000,
    heartbeatConsecutiveFailedTicks: 0,
    deadlineConsecutiveFailedTicks: 0,
    retentionConsecutiveFailedTicks: 0,
    heartbeatConsecutiveThrowTicks: 0,
    deadlineConsecutiveThrowTicks: 0,
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
    client_event_retention: createOperabilityTransitionTracker(),
    business_failure: {
      heartbeat: createOperabilityTransitionTracker(),
      deadline_scanner: createOperabilityTransitionTracker(),
      client_event_retention: createOperabilityTransitionTracker(),
    },
    tick_failure: {
      heartbeat: createOperabilityTransitionTracker(),
      deadline_scanner: createOperabilityTransitionTracker(),
    },
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
    expect(alerts[0]).toMatchObject({
      event: "operability.background_loop",
      component: "deadline_scanner",
      state: "stalled",
      level: "error",
    });
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

  it("redis + deadline_scanner recovery legs emit their own recovered events (no shared shortcut)", () => {
    const trackers = makeTrackers();
    trackers.redis(true);
    trackers.deadline_scanner(true);

    // One evaluation over a fully-healthy required-mode snapshot settles
    // BOTH pending recoveries at once, each with its own
    // event/component/state/level — and the next is silent. (The snapshot
    // must carry redis:true: with redis:null the redis tracker is never
    // consulted, which is exactly the optional-mode contract.)
    const recoveries = evaluateOperabilityTick(
      snapshotInput({
        readiness: {
          ready: true,
          database: true,
          redis: true,
          failedComponent: null,
        },
      }),
      trackers,
    );
    expect(recoveries).toHaveLength(2);
    expect(recoveries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "operability.readiness",
          component: "redis",
          state: "recovered",
          level: "info",
        }),
        expect.objectContaining({
          event: "operability.background_loop",
          component: "deadline_scanner",
          state: "recovered",
          level: "info",
        }),
      ]),
    );
    expect(evaluateOperabilityTick(snapshotInput(), trackers)).toEqual([]);
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

// Issue #862 — persistent business-failure escalation. A loop whose ticks keep
// settling (fresh lastSettledAt → classifyLoopStall says healthy) while every
// business item fails must still escalate; the escalation input is the
// per-tick consecutive-failure counter the scanner plugins maintain, deduped
// through the SAME transition-tracker mechanism as every other fact.
describe("classifyPersistentBusinessFailure — threshold boundary (#862)", () => {
  it("threshold is compile-time policy (4 consecutive failed ticks), not an env knob", () => {
    expect(BUSINESS_FAILURE_TICK_THRESHOLD).toBe(4);
  });

  it("boundary: below the threshold is not failing; at and above the threshold is", () => {
    expect(
      classifyPersistentBusinessFailure(BUSINESS_FAILURE_TICK_THRESHOLD - 1),
    ).toBe(false);
    expect(
      classifyPersistentBusinessFailure(BUSINESS_FAILURE_TICK_THRESHOLD),
    ).toBe(true);
    expect(
      classifyPersistentBusinessFailure(BUSINESS_FAILURE_TICK_THRESHOLD + 10),
    ).toBe(true);
  });

  it("a fresh process (zero counter) and a single failing tick are not failing", () => {
    expect(classifyPersistentBusinessFailure(0)).toBe(false);
    expect(classifyPersistentBusinessFailure(1)).toBe(false);
  });
});

describe("evaluateOperabilityTick — persistent business-failure legs (#862)", () => {
  it("settling loop with per-tick failures BELOW the threshold emits nothing (no noise)", () => {
    const trackers = makeTrackers();
    const input = snapshotInput({
      heartbeatConsecutiveFailedTicks: BUSINESS_FAILURE_TICK_THRESHOLD - 1,
      deadlineConsecutiveFailedTicks: BUSINESS_FAILURE_TICK_THRESHOLD - 1,
    });
    expect(evaluateOperabilityTick(input, trackers)).toEqual([]);
  });

  it("at threshold BOTH legs raise their OWN operability.business_failure failing ERROR (the #862 gap: stall facts alone stayed healthy here)", () => {
    const trackers = makeTrackers();
    const input = snapshotInput({
      heartbeatConsecutiveFailedTicks: BUSINESS_FAILURE_TICK_THRESHOLD,
      deadlineConsecutiveFailedTicks: BUSINESS_FAILURE_TICK_THRESHOLD,
    });
    const alerts = evaluateOperabilityTick(input, trackers);
    expect(alerts).toHaveLength(2);
    expect(alerts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "operability.business_failure",
          component: "heartbeat",
          state: "failing",
          level: "error",
        }),
        expect.objectContaining({
          event: "operability.business_failure",
          component: "deadline_scanner",
          state: "failing",
          level: "error",
        }),
      ]),
    );
  });

  it("messages are the documented catalogue wording; failing carries the live tick count, recovered is info", () => {
    const trackers = makeTrackers();
    const failing = evaluateOperabilityTick(
      snapshotInput({
        heartbeatConsecutiveFailedTicks: BUSINESS_FAILURE_TICK_THRESHOLD,
      }),
      trackers,
    );
    expect(failing).toHaveLength(1);
    expect(failing[0]!.message).toBe(
      "Critical background loop persistently failing: heartbeat (4 consecutive ticks with business failures)",
    );

    const recovered = evaluateOperabilityTick(
      snapshotInput({ heartbeatConsecutiveFailedTicks: 0 }),
      trackers,
    );
    expect(recovered).toHaveLength(1);
    expect(recovered[0]).toMatchObject({
      event: "operability.business_failure",
      component: "heartbeat",
      state: "recovered",
      level: "info",
    });
    expect(recovered[0]!.message).toBe(
      "Critical background loop business failures cleared: heartbeat",
    );
  });

  it("S4: repeated failing evaluations never re-emit (no storm); the first zero-failure tick — idle or successful — recovers exactly once", () => {
    const trackers = makeTrackers();
    const failingInput = snapshotInput({
      deadlineConsecutiveFailedTicks: BUSINESS_FAILURE_TICK_THRESHOLD + 2,
    });
    expect(evaluateOperabilityTick(failingInput, trackers)).toHaveLength(1);
    expect(evaluateOperabilityTick(failingInput, trackers)).toEqual([]);
    expect(evaluateOperabilityTick(failingInput, trackers)).toEqual([]);

    const cleanInput = snapshotInput();
    const recovery = evaluateOperabilityTick(cleanInput, trackers);
    expect(recovery).toHaveLength(1);
    expect(recovery[0]).toMatchObject({
      event: "operability.business_failure",
      component: "deadline_scanner",
      state: "recovered",
      level: "info",
    });
    expect(evaluateOperabilityTick(cleanInput, trackers)).toEqual([]);
  });

  it("#871: a never-fired or hung retention sweep goes STALLED on its own component — no longer log-dark", () => {
    const trackers = makeTrackers();
    // Registration long ago, nothing ever settled, no start in flight: the
    // timer never fired (or a pass hung and cleared) — stalled by absence.
    const alerts = evaluateOperabilityTick(
      snapshotInput({
        retention: {
          // Five daily windows ago: stalled by absence under the RETENTION
          // cadence (not the 30s heartbeat/deadline cadence).
          startedAt: ms(-5 * 86_400_000),
          lastStartedAt: null,
          lastSettledAt: null,
          activeSince: null,
        },
        retentionIntervalMs: 86_400_000,
      }),
      trackers,
    );
    expect(alerts).toEqual([
      expect.objectContaining({
        event: "operability.background_loop",
        component: "client_event_retention",
        state: "stalled",
        level: "error",
        // Operator-facing threshold must use the RETENTION interval: 4 days.
        message:
          "Critical background loop stalled: client_event_retention (no settled cycle within 345600s)",
      }),
    ]);
    expect(evaluateOperabilityTick(snapshotInput(), trackers)).toEqual([
      expect.objectContaining({
        event: "operability.background_loop",
        component: "client_event_retention",
        state: "recovered",
      }),
    ]);
  });

  it("#871: persistent retention pass failures raise operability.business_failure; a clean pass (even with zero deletions) recovers", () => {
    const trackers = makeTrackers();
    const failing = snapshotInput({ retentionConsecutiveFailedTicks: 4 });
    const alerts = evaluateOperabilityTick(failing, trackers);
    expect(alerts).toEqual([
      expect.objectContaining({
        event: "operability.business_failure",
        component: "client_event_retention",
        state: "failing",
        level: "error",
      }),
    ]);
    expect(evaluateOperabilityTick(failing, trackers)).toEqual([]);
    // Zero-deleted but zero-failed is a CLEAN pass — recovery, not silence:
    // the counter tracks the run of failed passes, not deletions.
    const recovered = evaluateOperabilityTick(snapshotInput(), trackers);
    expect(recovered).toEqual([
      expect.objectContaining({
        event: "operability.business_failure",
        component: "client_event_retention",
        state: "recovered",
      }),
    ]);
  });

  it("restart semantics: a restarted process (fresh trackers, zeroed counters) carries no failing state and no carry-over recovery; the failure must be re-observed before it is re-claimed", () => {
    // Process 1: the failure accumulates to the threshold and is claimed.
    const before = makeTrackers();
    expect(
      evaluateOperabilityTick(
        snapshotInput({
          deadlineConsecutiveFailedTicks: BUSINESS_FAILURE_TICK_THRESHOLD,
        }),
        before,
      ),
    ).toHaveLength(1);

    // Process 2 (restart): trackers and the escalation counters are
    // process-local and start fresh. A healthy first tick emits nothing —
    // no spurious failing claim, and no spurious recovery for the
    // pre-restart state either.
    const after = makeTrackers();
    expect(evaluateOperabilityTick(snapshotInput(), after)).toEqual([]);

    // The failure must climb back to the threshold before the restarted
    // process claims it again (docs/operations/active-alerting.md §1).
    expect(
      evaluateOperabilityTick(
        snapshotInput({
          deadlineConsecutiveFailedTicks: BUSINESS_FAILURE_TICK_THRESHOLD - 1,
        }),
        after,
      ),
    ).toEqual([]);
    expect(
      evaluateOperabilityTick(
        snapshotInput({
          deadlineConsecutiveFailedTicks: BUSINESS_FAILURE_TICK_THRESHOLD,
        }),
        after,
      ),
    ).toHaveLength(1);
  });

  it("stall and persistent business failure are independent facts — a stalled AND persistently-failing loop emits both, on distinct (event, component) keys", () => {
    const trackers = makeTrackers();
    const alerts = evaluateOperabilityTick(
      snapshotInput({
        heartbeat: {
          startedAt: T0,
          lastStartedAt: ms(-300_000),
          lastSettledAt: ms(-310_000),
          activeSince: ms(-300_000),
        },
        heartbeatConsecutiveFailedTicks: BUSINESS_FAILURE_TICK_THRESHOLD,
      }),
      trackers,
    );
    expect(
      alerts.map((a) => `${a.event}/${a.component}/${a.state}`).sort(),
    ).toEqual([
      "operability.background_loop/heartbeat/stalled",
      "operability.business_failure/heartbeat/failing",
    ]);
  });
});

describe("evaluateOperabilityTick — tick-level throw legs (#885)", () => {
  it("below the threshold emits nothing; at the threshold BOTH loops raise their own operability.tick_failure failing ERROR", () => {
    const below = makeTrackers();
    expect(
      evaluateOperabilityTick(
        snapshotInput({
          heartbeatConsecutiveThrowTicks: BUSINESS_FAILURE_TICK_THRESHOLD - 1,
          deadlineConsecutiveThrowTicks: BUSINESS_FAILURE_TICK_THRESHOLD - 1,
        }),
        below,
      ),
    ).toEqual([]);

    const at = makeTrackers();
    expect(
      evaluateOperabilityTick(
        snapshotInput({
          heartbeatConsecutiveThrowTicks: BUSINESS_FAILURE_TICK_THRESHOLD,
          deadlineConsecutiveThrowTicks: BUSINESS_FAILURE_TICK_THRESHOLD,
        }),
        at,
      ),
    ).toEqual([
      {
        event: "operability.tick_failure",
        component: "heartbeat",
        state: "failing",
        level: "error",
        // The message states the run of throws and NOTHING about its cause.
        message:
          "Critical background loop tick exceptions: heartbeat (4 consecutive ticks threw; root cause unknown)",
      },
      {
        event: "operability.tick_failure",
        component: "deadline_scanner",
        state: "failing",
        level: "error",
        message:
          "Critical background loop tick exceptions: deadline_scanner (4 consecutive ticks threw; root cause unknown)",
      },
    ]);
  });

  it("throw runs are their own fact: business-failure-only and stall-only inputs emit ZERO tick_failure lines", () => {
    const business = makeTrackers();
    const businessAlerts = evaluateOperabilityTick(
      snapshotInput({
        heartbeatConsecutiveFailedTicks: BUSINESS_FAILURE_TICK_THRESHOLD,
        deadlineConsecutiveFailedTicks: BUSINESS_FAILURE_TICK_THRESHOLD,
      }),
      business,
    );
    expect(businessAlerts.map((a) => a.event)).toEqual([
      "operability.business_failure",
      "operability.business_failure",
    ]);

    const stalled = makeTrackers();
    const stalledAlerts = evaluateOperabilityTick(
      snapshotInput({
        heartbeat: {
          startedAt: T0,
          lastStartedAt: ms(-300_000),
          lastSettledAt: ms(-310_000),
          activeSince: ms(-300_000),
        },
      }),
      stalled,
    );
    expect(stalledAlerts).toEqual([
      expect.objectContaining({
        event: "operability.background_loop",
        component: "heartbeat",
        state: "stalled",
      }),
    ]);
  });

  it("S4: one line per transition, the recovery claims only that exceptions cleared, and a new run must reach the threshold again", () => {
    const trackers = makeTrackers();
    const throwing = snapshotInput({
      heartbeatConsecutiveThrowTicks: BUSINESS_FAILURE_TICK_THRESHOLD,
    });
    expect(evaluateOperabilityTick(throwing, trackers)).toHaveLength(1);
    expect(evaluateOperabilityTick(throwing, trackers)).toEqual([]);
    expect(evaluateOperabilityTick(throwing, trackers)).toEqual([]);

    const clean = snapshotInput();
    expect(evaluateOperabilityTick(clean, trackers)).toEqual([
      {
        event: "operability.tick_failure",
        component: "heartbeat",
        state: "recovered",
        level: "info",
        // "exceptions cleared" — explicitly NOT "business recovered", and
        // "a settled tick interrupted the run" — NOT "the last tick was clean"
        // (the monitor observes the counter, not every tick).
        message:
          "Critical background loop tick exceptions cleared: heartbeat (a settled tick without a throw interrupted the run; business restoration unknown)",
      },
    ]);
    expect(evaluateOperabilityTick(clean, trackers)).toEqual([]);

    // 4 → clean → 4: after the recovery a new run below the window stays
    // silent and must reach the threshold again before re-raising. A monitor
    // observes the counter only at its actual read points; the scheduling
    // boundaries (including the default 15s/30s configuration) are covered by
    // the real-scanner tests in the sampling-boundary describe below.
    expect(
      evaluateOperabilityTick(
        snapshotInput({ heartbeatConsecutiveThrowTicks: 3 }),
        trackers,
      ),
    ).toEqual([]);
    expect(
      evaluateOperabilityTick(
        snapshotInput({ heartbeatConsecutiveThrowTicks: 4 }),
        trackers,
      ),
    ).toHaveLength(1);
    // A second recovery is emitted once, then the state is quiet again.
    expect(evaluateOperabilityTick(clean, trackers)).toHaveLength(1);
    expect(evaluateOperabilityTick(clean, trackers)).toEqual([]);
  });

  it("restart: a fresh process claims nothing and carries no recovery across processes (process-local state)", () => {
    const before = makeTrackers();
    expect(
      evaluateOperabilityTick(
        snapshotInput({ deadlineConsecutiveThrowTicks: 4 }),
        before,
      ),
    ).toHaveLength(1);

    const after = makeTrackers();
    expect(evaluateOperabilityTick(snapshotInput(), after)).toEqual([]);
    expect(
      evaluateOperabilityTick(
        snapshotInput({ deadlineConsecutiveThrowTicks: 3 }),
        after,
      ),
    ).toEqual([]);
    expect(
      evaluateOperabilityTick(
        snapshotInput({ deadlineConsecutiveThrowTicks: 4 }),
        after,
      ),
    ).toHaveLength(1);
  });

  it("coexisting facts keep their own keys: DB outage + throw run + a stale business_failure are three true lines, never folded into one", () => {
    const trackers = makeTrackers();
    const alerts = evaluateOperabilityTick(
      snapshotInput({
        readiness: {
          ready: false,
          database: false,
          redis: null,
          failedComponent: "database",
        },
        // #862 counter frozen from before the throws started (E10).
        heartbeatConsecutiveFailedTicks: BUSINESS_FAILURE_TICK_THRESHOLD,
        heartbeatConsecutiveThrowTicks: BUSINESS_FAILURE_TICK_THRESHOLD,
        deadlineConsecutiveThrowTicks: BUSINESS_FAILURE_TICK_THRESHOLD,
      }),
      trackers,
    );
    expect(
      alerts.map((a) => `${a.event}/${a.component}/${a.state}`).sort(),
    ).toEqual([
      "operability.business_failure/heartbeat/failing",
      "operability.readiness/database/unavailable",
      "operability.tick_failure/deadline_scanner/failing",
      "operability.tick_failure/heartbeat/failing",
    ]);
  });
});

import Fastify from "fastify";
import { Writable } from "node:stream";
import operabilityMonitorPlugin, {
  OPERABILITY_MONITOR_INTERVAL_MS,
} from "./operabilityMonitor.js";
import { heartbeatMetrics } from "./heartbeat.js";
import { deadlineScannerMetrics } from "./deadlineScanner.js";

function tickFailureLines(lines: string[]): string[] {
  return lines
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((entry) => entry.event === "operability.tick_failure")
    .map(
      (entry) =>
        `${String(entry.event)}/${String(entry.component)}/${String(entry.state)}/${String(entry.level)}`,
    );
}

/**
 * #885 wiring: the pure leg above is fed by hand-built snapshots, so a swapped
 * counter pair would pass every one of those tests. This registers the REAL
 * plugin and reads the REAL metric singletons, pinning the snapshot wiring and
 * the emitted stdout fields end to end.
 */
/**
 * Characterization of the sampling boundary, not a promise that all finite
 * runs are reported. These tests use the REAL scanner and monitor plugins with
 * controlled fake timers, deferred database work and a delayed readiness
 * probe. They pin the current contract; changing them to "make everything
 * alert" would be a different design decision (ADR-024).
 */
describe("ADR-024 sampling boundary — real scanner + monitor execution order", () => {
  const ORG = { id: "org-1" };
  const T0_MS = T0.getTime();

  function resetBoundaryMetrics(): void {
    for (const m of [
      heartbeatMetrics,
      deadlineScannerMetrics,
      clientEventRetentionMetrics,
    ]) {
      m.startedAt = null;
      m.lastStartedAt = null;
      m.lastSettledAt = null;
      m.activeSince = null;
      m.consecutiveFailedTicks = 0;
    }
    heartbeatMetrics.consecutiveThrowTicks = 0;
    deadlineScannerMetrics.consecutiveThrowTicks = 0;
    // The retention loop is not under study. Keep its four-day staleness
    // threshold healthy so it cannot add a confounder alert.
    clientEventRetentionMetrics.startedAt = new Date(T0);
    clientEventRetentionMetrics.lastStartedAt = new Date(T0);
    clientEventRetentionMetrics.lastSettledAt = new Date(T0);
    clientEventRetentionMetrics.activeSince = null;
    clientEventRetentionMetrics.scanIntervalMs = 86_400_000;
  }

  function makeBoundaryApp(lines: string[], db: unknown) {
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        lines.push(chunk.toString());
        callback();
      },
    });
    const app = Fastify({ logger: { level: "info", stream } });
    app.decorate<unknown>("db", db as never);
    app.decorate("now", () => new Date(Date.now()));
    return app;
  }

  it("default 30s/15s: a 4th throw settling at 149s, a clean settle at 150.1s and a readiness-delayed read at 151s produce no failing event", async () => {
    vi.useFakeTimers({ now: T0 });
    const lines: string[] = [];
    const pingReadsMs: number[] = [];
    const db = {
      select: (...args: unknown[]) => ({
        from: (table: unknown) => {
          if (table === organizations) {
            if (args.length > 0) {
              // readiness pingDb(): record the ACTUAL read point (after the
              // probe resolves), not the monitor timer trigger. The 150s probe
              // resolves at 151s.
              const recordRead = () => {
                pingReadsMs.push(Date.now() - T0_MS);
                return [ORG];
              };
              if (Date.now() === T0_MS + 150_000) {
                return {
                  limit: () =>
                    new Promise((resolve) =>
                      setTimeout(() => resolve(recordRead()), 1_000),
                    ),
                };
              }
              return { limit: () => Promise.resolve().then(recordRead) };
            }
            const now = Date.now();
            if (now < T0_MS + 120_000) {
              throw new Error("scheduled scanner discovery throw");
            }
            if (now === T0_MS + 120_000) {
              // Fourth scanner tick starts at 120s and throws only at 149s.
              return new Promise((_resolve, reject) => {
                setTimeout(
                  () => reject(new Error("slow scanner discovery throw")),
                  29_000,
                );
              });
            }
            if (now === T0_MS + 150_000) {
              // Next tick starts at 150s and clean-settles at 150.1s.
              return new Promise((resolve) => {
                setTimeout(() => resolve([ORG]), 100);
              });
            }
            return Promise.resolve([ORG]);
          }
          if (table === examAttempts) {
            if (args.length > 0) {
              return {
                innerJoin: () => ({
                  where: () => Promise.resolve([]),
                }),
              };
            }
            return { where: () => Promise.resolve([]) };
          }
          if (table === attemptInterruptionEvents) {
            const chain = {
              innerJoin: () => chain,
              where: () => chain,
              orderBy: () => Promise.resolve([]),
              limit: () => Promise.resolve([]),
            };
            return chain;
          }
          // Incident arbiter / other discovery tables: an empty drizzle-like
          // chain that supports the builder methods the repositories call.
          const empty = Promise.resolve([]) as unknown as Promise<unknown[]> & {
            innerJoin: () => unknown;
            where: () => unknown;
            orderBy: () => unknown;
            limit: () => unknown;
          };
          empty.innerJoin = () => empty;
          empty.where = () => empty;
          empty.orderBy = () => empty;
          empty.limit = () => empty;
          return empty;
        },
      }),
    };
    const app = makeBoundaryApp(lines, db);
    resetBoundaryMetrics();
    try {
      await app.register(heartbeatPlugin);
      await app.register(deadlineScannerPlugin);
      await app.register(operabilityMonitorPlugin);
      await app.ready();

      // Three immediate throws at 30/60/90; the fourth starts at 120.
      await vi.advanceTimersByTimeAsync(120_000);
      expect(heartbeatMetrics.consecutiveThrowTicks).toBe(3);

      // Monitor reads C=3 at 135; the fourth throw settles at 149.
      await vi.advanceTimersByTimeAsync(29_000);
      expect(heartbeatMetrics.consecutiveThrowTicks).toBe(4);
      expect(pingReadsMs).toContain(135_000);
      expect(tickFailureLines(lines)).toEqual([]);

      // At 150 the monitor starts but awaits readiness until 151; the
      // scanner clean-settles at 150.1 and resets the counter before the read.
      await vi.advanceTimersByTimeAsync(2_000);
      expect(heartbeatMetrics.consecutiveThrowTicks).toBe(0);
      expect(pingReadsMs).toContain(151_000);
      expect(tickFailureLines(lines)).toEqual([]);
    } finally {
      await app.close();
      vi.useRealTimers();
    }
  });

  it("scanner S=1s, monitor M=15s: a 4-throw run ending at 5s is fully reset before the first 15s read, so no failing is emitted", async () => {
    vi.useFakeTimers({ now: T0 });
    process.env.HEARTBEAT_SCAN_INTERVAL_MS = "1000";
    process.env.DEADLINE_SCAN_INTERVAL_MS = "30000";
    resetRuntimeConfigForTest();
    const lines: string[] = [];
    const db = {
      select: (...args: unknown[]) => ({
        from: (table: unknown) => {
          if (table === organizations) {
            if (args.length > 0) {
              return { limit: () => Promise.resolve([ORG]) };
            }
            if (Date.now() <= T0_MS + 4_000) {
              throw new Error("scheduled fast-scanner throw");
            }
            return Promise.resolve([ORG]);
          }
          if (table === examAttempts)
            return { where: () => Promise.resolve([]) };
          return Promise.resolve([]);
        },
      }),
    };
    const app = makeBoundaryApp(lines, db);
    resetBoundaryMetrics();
    try {
      await app.register(heartbeatPlugin);
      await app.register(operabilityMonitorPlugin);
      await app.ready();

      // Ticks at 1/2/3/4s throw; the 5s tick settles cleanly.
      await vi.advanceTimersByTimeAsync(4_000);
      expect(heartbeatMetrics.consecutiveThrowTicks).toBe(4);
      await vi.advanceTimersByTimeAsync(11_000);
      expect(heartbeatMetrics.consecutiveThrowTicks).toBe(0);
      expect(tickFailureLines(lines)).toEqual([]);
    } finally {
      await app.close();
      delete process.env.HEARTBEAT_SCAN_INTERVAL_MS;
      delete process.env.DEADLINE_SCAN_INTERVAL_MS;
      resetRuntimeConfigForTest();
      vi.useRealTimers();
    }
  });

  it("narrow recovery: sample 4 → clean → 3 throws → sample 3 emits recovered without claiming the latest tick was clean", () => {
    const trackers = makeTrackers();
    const failing = snapshotInput({ heartbeatConsecutiveThrowTicks: 4 });
    expect(evaluateOperabilityTick(failing, trackers)).toHaveLength(1);

    const recovery = evaluateOperabilityTick(snapshotInput(), trackers);
    expect(recovery).toHaveLength(1);
    expect(recovery[0]!.message).toBe(
      "Critical background loop tick exceptions cleared: heartbeat (a settled tick without a throw interrupted the run; business restoration unknown)",
    );
    expect(recovery[0]!.message).not.toContain("last settled tick");

    // A new run reaches 3 throws before the next sample; the sampled value is
    // below the window, so no new failing is claimed — and the recovery above
    // still does not assert that the latest tick was clean.
    for (const count of [1, 2, 3]) {
      expect(
        evaluateOperabilityTick(
          snapshotInput({ heartbeatConsecutiveThrowTicks: count }),
          trackers,
        ),
      ).toEqual([]);
    }
  });
});

describe("operability monitor plugin — #885 wiring (real metrics → real stdout)", () => {
  it("each scanner's throw counter drives its OWN component, in both directions", async () => {
    vi.useFakeTimers({ now: T0 });
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        lines.push(chunk.toString());
        callback();
      },
    });
    const app = Fastify({ logger: { level: "info", stream } });
    // The only db access in this test is the readiness probe:
    // SELECT id FROM organizations LIMIT 1.
    app.decorate<unknown>("db", {
      select: () => ({
        from: () => ({ limit: () => Promise.resolve([{ id: "org-1" }]) }),
      }),
    } as never);
    app.decorate("now", () => new Date(T0));

    heartbeatMetrics.consecutiveThrowTicks = 0;
    deadlineScannerMetrics.consecutiveThrowTicks = 0;
    try {
      await app.register(operabilityMonitorPlugin);
      await app.ready();

      heartbeatMetrics.consecutiveThrowTicks = BUSINESS_FAILURE_TICK_THRESHOLD;
      await vi.advanceTimersByTimeAsync(OPERABILITY_MONITOR_INTERVAL_MS);
      // Pino emits the NUMERIC level (50 = error, 30 = info); the §3 external
      // hook pages on `level >= 50`, so these are the numbers that matter.
      expect(tickFailureLines(lines)).toEqual([
        "operability.tick_failure/heartbeat/failing/50",
      ]);

      // The heartbeat run clears while the deadline scanner enters one: a
      // swapped pair (or a shared tracker) would not produce this shape.
      heartbeatMetrics.consecutiveThrowTicks = 0;
      deadlineScannerMetrics.consecutiveThrowTicks =
        BUSINESS_FAILURE_TICK_THRESHOLD;
      await vi.advanceTimersByTimeAsync(OPERABILITY_MONITOR_INTERVAL_MS);
      expect(tickFailureLines(lines).slice(1)).toEqual([
        "operability.tick_failure/heartbeat/recovered/30",
        "operability.tick_failure/deadline_scanner/failing/50",
      ]);
    } finally {
      await app.close();
      heartbeatMetrics.consecutiveThrowTicks = 0;
      deadlineScannerMetrics.consecutiveThrowTicks = 0;
      vi.useRealTimers();
    }
  });
});
