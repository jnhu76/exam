import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { createSystemStatsRepo } from "@exam/db/repository/systemStatsRepo";
import type { Database } from "@exam/db/types";
import { getRuntimeConfig } from "../config/runtimeConfig.js";
import { heartbeatMetrics } from "./heartbeat.js";
import { deadlineScannerMetrics } from "./deadlineScanner.js";
import {
  clientEventRetentionMetrics,
  CLIENT_EVENT_RETENTION_SWEEP_INTERVAL_MS,
} from "./clientEventRetention.js";

/**
 * #547 operability monitor — the single derivation behind the deployment
 * readiness gate and the bounded active-alert transitions.
 *
 * LAYER CONTRACT (docs/research/exam-547-readiness-alerting-1/01-semantics):
 * liveness (/api/health) stays dependency-blind; this module owns READINESS
 * (mandatory serving dependencies) and OPERABILITY transitions (critical
 * background-loop stall) — it never mutates business state, never restarts
 * anything, and its in-memory alert-dedupe state is NOT readiness truth, NOT
 * scanner truth, and NOT durable exam state.
 */

/**
 * In-app bound for one mandatory-dependency probe. Must stay well under the
 * Compose healthcheck `timeout: 5s` (Docker kills an over-running probe; the
 * app answers first). postgres.js has no per-query timeout and a 30s default
 * connect budget, so the race here is what bounds a hung probe.
 */
export const READINESS_PROBE_BUDGET_MS = 2_000;

/**
 * Monitor cadence. Faster than the Compose healthcheck interval (30s) so an
 * alert transition is observed before the deployment gate flips unhealthy;
 * slow enough that the added probe load is one trivial indexed query per 15s.
 * Compile-time policy — deliberately NOT an env knob (#547 brief §17).
 */
export const OPERABILITY_MONITOR_INTERVAL_MS = 15_000;

/** Stall threshold factor: staleAfter = LOOP_STALL_FACTOR × configured interval. */
export const LOOP_STALL_FACTOR = 4;

/**
 * #862 escalation threshold: consecutive SETTLED ticks whose business work
 * failed (failedCount > 0) before the persistent-business-failure alert
 * raises. Same 4×-one-window shape as the stall factor, but counted in loop
 * ticks, not milliseconds: a per-item failure is retried on the next cadence,
 * so only a run of consecutive failed ticks means the retry loop is NOT
 * converging. Compile-time policy — deliberately NOT an env knob (#547 brief
 * §17). A tick that THROWS (e.g. DB down) neither increments nor resets the
 * counter: a throw is not evidence about business work, and the throw run is
 * escalated separately as `operability.tick_failure` (#885, ADR-024). The same
 * 4-tick window drives both facts — both are counted in ticks of the same scan
 * cadence.
 */
export const BUSINESS_FAILURE_TICK_THRESHOLD = 4;

/** Derive the stall threshold from a loop's configured cadence. */
export function loopStaleAfterMs(intervalMs: number): number {
  return LOOP_STALL_FACTOR * intervalMs;
}

/**
 * #862/#885: whether a run of consecutive failed ticks has reached the
 * escalation window. Used for BOTH the business-failure run and the
 * tick-throw run — the predicate is about run length, not the failure kind.
 * Pure threshold predicate; the transition dedupe lives in the caller's
 * tracker.
 */
export function classifyPersistentBusinessFailure(
  consecutiveFailedTicks: number,
): boolean {
  return consecutiveFailedTicks >= BUSINESS_FAILURE_TICK_THRESHOLD;
}

// ── Readiness (L2) ─────────────────────────────────────────────────────────

/** Per-leg mandatory-dependency outcome of one readiness probe. */
export interface ApplicationReadiness {
  /** Deployment-gate answer: every mandatory dependency is currently usable. */
  ready: boolean;
  /** PostgreSQL reachable through the app's own pool (always mandatory). */
  database: boolean;
  /**
   * Redis usable, or `null` when Redis is not a mandatory dependency
   * (`REDIS_MODE=off|optional`). In `required` mode the existing rate-limit
   * fail-closed authority is `redisRuntime.shouldUseRedis()` — this probe
   * mirrors that exact condition; it does not invent a second Redis health
   * model (#554 owns any responsibility change).
   */
  redis: boolean | null;
  /** First failed mandatory leg in fixed order — the alert `component` field. */
  failedComponent: "database" | "redis" | null;
}

/** Injected probe legs — the route, the monitor, and tests share one wiring. */
export interface ReadinessProbeDeps {
  pingDb(): Promise<unknown>;
  redisRequired: boolean;
  redisUsable(): boolean;
}

class ReadinessProbeTimeout extends Error {
  constructor() {
    super("readiness probe budget exceeded");
  }
}

/**
 * The single mandatory-dependency derivation (#547 "no second authority"):
 * the readiness route, the Compose gate (via the route), and the readiness
 * alert transitions all consume this function. A probe that throws, hangs
 * past `budgetMs`, or (Redis/required) reports an unusable runtime makes the
 * instance not ready.
 */
export async function probeApplicationReadiness(
  deps: ReadinessProbeDeps,
  options: { budgetMs?: number } = {},
): Promise<ApplicationReadiness> {
  const budgetMs = options.budgetMs ?? READINESS_PROBE_BUDGET_MS;

  let database = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // A losing (timed-out) ping keeps running server-side; it is one trivial
    // indexed query and settles on its own — the budget race is only to bound
    // THIS caller. The timer is unref'd and ALWAYS cleared once the race
    // settles, so a fast ping never leaves a stray rejection behind.
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new ReadinessProbeTimeout()), budgetMs);
      timer.unref();
    });
    try {
      await Promise.race([deps.pingDb(), timeout]);
      database = true;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  } catch {
    database = false;
  }

  const redis = deps.redisRequired ? deps.redisUsable() : null;

  const failedComponent: ApplicationReadiness["failedComponent"] = !database
    ? "database"
    : redis === false
      ? "redis"
      : null;

  return { ready: failedComponent === null, database, redis, failedComponent };
}

/** Server wiring for {@link probeApplicationReadiness} against a Fastify app. */
export function buildReadinessProbeDeps(fastify: {
  db: Database;
  redisRuntime?: { shouldUseRedis(): boolean };
}): ReadinessProbeDeps {
  const config = getRuntimeConfig();
  return {
    pingDb: () => createSystemStatsRepo(fastify.db).pingDb(),
    redisRequired: config.redis.mode === "required",
    redisUsable: () => fastify.redisRuntime?.shouldUseRedis() ?? false,
  };
}

// ── Critical background-loop stall classification ──────────────────────────

/**
 * Per-loop progress facts recorded by the scanner plugins. `lastSettledAt`
 * means the tick body SETTLED (success OR error): a cycle that throws every
 * interval is NOT stalled — it escalates as `operability.tick_failure` (#885)
 * and, for DB loss, as `operability.readiness`. STALLED means no observable
 * progress: a hung in-flight cycle (`activeSince` past the threshold) or a
 * dead timer (nothing settled or started recently).
 */
export interface LoopActivity {
  /** Plugin registration time — the WARMING grace origin. */
  startedAt: Date | null;
  lastStartedAt: Date | null;
  lastSettledAt: Date | null;
  activeSince: Date | null;
}

export type LoopStallState = "warming" | "healthy" | "active" | "stalled";

/**
 * Classify one loop's progress at an explicit `now`. Boundary is inclusive:
 * reaching the threshold is STALLED.
 */
export function classifyLoopStall(
  activity: LoopActivity,
  intervalMs: number,
  now: Date,
): LoopStallState {
  const staleAfter = loopStaleAfterMs(intervalMs);
  const age = (from: Date | null) =>
    from === null ? null : now.getTime() - from.getTime();

  const activeAge = age(activity.activeSince);
  if (activeAge !== null && activeAge >= staleAfter) return "stalled";

  if (activity.activeSince !== null) return "active";

  const settledAge = age(activity.lastSettledAt);
  if (settledAge !== null && settledAge >= staleAfter) return "stalled";

  if (settledAge === null) {
    // No settled evidence yet: within the grace window this is WARMING (first
    // tick fires at +interval; S2 — bootstrap must never read as stalled).
    // Past the grace with no settle at all it is a hang of the FIRST cycle or
    // a timer that never fired — STALLED either way.
    const base = activity.lastStartedAt ?? activity.startedAt;
    const baseAge = age(base);
    if (baseAge === null || baseAge >= staleAfter) return "stalled";
    return "warming";
  }

  return "healthy";
}

// ── Alert transition dedupe (L4) ───────────────────────────────────────────

export type AlertTransition = "raise_failure" | "raise_recovery" | null;

/**
 * Process-local transition tracker for ONE monitored fact. Emits only on
 * state CHANGE: exactly one failure signal per outage, exactly one recovery
 * signal per recovery, silence otherwise (S4 — no log storm). A process
 * restart may re-emit a current outage; that is allowed and is the whole
 * durable state this feature has (no table, no Redis, no ledger).
 */
export function createOperabilityTransitionTracker(): (
  failed: boolean,
) => AlertTransition {
  let lastFailed: boolean | null = null;
  return (failed: boolean): AlertTransition => {
    const transition: AlertTransition =
      lastFailed === null
        ? failed
          ? "raise_failure"
          : null
        : failed === lastFailed
          ? null
          : failed
            ? "raise_failure"
            : "raise_recovery";
    lastFailed = failed;
    return transition;
  };
}

/** One monitor tick's classification inputs, gathered for testability. */
export interface OperabilitySnapshotInput {
  readiness: ApplicationReadiness;
  heartbeat: LoopActivity;
  heartbeatIntervalMs: number;
  deadline: LoopActivity;
  deadlineIntervalMs: number;
  /** #871: the client-event retention loop reuses the same two facts. */
  retention: LoopActivity;
  retentionIntervalMs: number;
  /**
   * #862 escalation input: consecutive SETTLED heartbeat ticks whose business
   * work failed, reset by the first clean settle (maintained by the heartbeat
   * plugin; process-local, reset on restart).
   */
  heartbeatConsecutiveFailedTicks: number;
  /** Same escalation input for the deadline scanner. */
  deadlineConsecutiveFailedTicks: number;
  /** #871: same escalation input for the client-event retention loop. */
  retentionConsecutiveFailedTicks: number;
  /**
   * #885 escalation input: consecutive heartbeat ticks whose body THREW,
   * reset by the first tick that settles without throwing (maintained by the
   * heartbeat plugin; process-local, reset on restart).
   */
  heartbeatConsecutiveThrowTicks: number;
  /** Same escalation input for the deadline scanner. */
  deadlineConsecutiveThrowTicks: number;
  now: Date;
}

/** Emitted alert fields — the external hook contract (docs/operations/active-alerting.md). */
export interface OperabilityAlert {
  event:
    | "operability.readiness"
    | "operability.background_loop"
    | "operability.business_failure"
    | "operability.tick_failure";
  component:
    | "database"
    | "redis"
    | "heartbeat"
    | "deadline_scanner"
    | "client_event_retention";
  state: "unavailable" | "recovered" | "stalled" | "failing";
  level: "error" | "info";
  message: string;
}

/**
 * Per-fact transition trackers. One tracker per (event, component) key — a
 * loop can be stalled AND persistently failing at once, and those are distinct
 * alert keys in the external hook contract (docs/operations/active-alerting.md
 * §3), never folded into one.
 */
export interface OperabilityTickTrackers {
  database: (failed: boolean) => AlertTransition;
  redis: (failed: boolean) => AlertTransition;
  heartbeat: (failed: boolean) => AlertTransition;
  deadline_scanner: (failed: boolean) => AlertTransition;
  client_event_retention: (failed: boolean) => AlertTransition;
  business_failure: {
    heartbeat: (failed: boolean) => AlertTransition;
    deadline_scanner: (failed: boolean) => AlertTransition;
    client_event_retention: (failed: boolean) => AlertTransition;
  };
  /** #885: the throw-run fact, separate from every business/stall/liveness fact. */
  tick_failure: {
    heartbeat: (failed: boolean) => AlertTransition;
    deadline_scanner: (failed: boolean) => AlertTransition;
  };
}

/**
 * Pure evaluation of one monitor tick against per-fact transition trackers:
 * returns the alerts to emit (bounded by construction — at most one per fact
 * per transition). Trackers are passed in (not created here) so tests drive
 * repeated evaluations deterministically.
 */
export function evaluateOperabilityTick(
  input: OperabilitySnapshotInput,
  trackers: OperabilityTickTrackers,
): OperabilityAlert[] {
  const alerts: OperabilityAlert[] = [];

  const readinessFailure = (
    component: "database" | "redis",
    failed: boolean,
    transition: AlertTransition,
  ) => {
    if (transition === "raise_failure") {
      alerts.push({
        event: "operability.readiness",
        component,
        state: "unavailable",
        level: "error",
        message: `Mandatory dependency unavailable: ${component} — instance not ready for exam traffic`,
      });
    } else if (transition === "raise_recovery") {
      alerts.push({
        event: "operability.readiness",
        component,
        state: "recovered",
        level: "info",
        message: `Mandatory dependency recovered: ${component}`,
      });
    }
  };

  readinessFailure(
    "database",
    !input.readiness.database,
    trackers.database(!input.readiness.database),
  );
  if (input.readiness.redis !== null) {
    readinessFailure(
      "redis",
      !input.readiness.redis,
      trackers.redis(!input.readiness.redis),
    );
  }

  const loopFailure = (
    component: "heartbeat" | "deadline_scanner" | "client_event_retention",
    stalled: boolean,
    transition: AlertTransition,
    // The OPERATOR-FACING threshold must be the same interval the
    // classification used; deriving it from a component ternary silently
    // mislabels any new loop (#871 review).
    staleAfterMs: number,
  ) => {
    if (transition === "raise_failure") {
      alerts.push({
        event: "operability.background_loop",
        component,
        state: "stalled",
        level: "error",
        message: `Critical background loop stalled: ${component} (no settled cycle within ${staleAfterMs / 1000}s)`,
      });
    } else if (transition === "raise_recovery") {
      alerts.push({
        event: "operability.background_loop",
        component,
        state: "recovered",
        level: "info",
        message: `Critical background loop recovered: ${component}`,
      });
    }
  };

  const heartbeatStalled =
    classifyLoopStall(input.heartbeat, input.heartbeatIntervalMs, input.now) ===
    "stalled";
  loopFailure(
    "heartbeat",
    heartbeatStalled,
    trackers.heartbeat(heartbeatStalled),
    loopStaleAfterMs(input.heartbeatIntervalMs),
  );

  const deadlineStalled =
    classifyLoopStall(input.deadline, input.deadlineIntervalMs, input.now) ===
    "stalled";
  loopFailure(
    "deadline_scanner",
    deadlineStalled,
    trackers.deadline_scanner(deadlineStalled),
    loopStaleAfterMs(input.deadlineIntervalMs),
  );

  // #871: the retention loop is a third consumer of the SAME stall fact —
  // a never-fired or hung sweep becomes observable instead of log-dark.
  const retentionStalled =
    classifyLoopStall(input.retention, input.retentionIntervalMs, input.now) ===
    "stalled";
  loopFailure(
    "client_event_retention",
    retentionStalled,
    trackers.client_event_retention(retentionStalled),
    loopStaleAfterMs(input.retentionIntervalMs),
  );

  // #862: persistent business failure — the loop keeps settling (so the stall
  // facts above stay healthy) while its business work keeps failing. Distinct
  // fact, distinct (event, component) alert key, same transition dedupe.
  const businessFailure = (
    component: "heartbeat" | "deadline_scanner" | "client_event_retention",
    consecutiveFailedTicks: number,
    transition: AlertTransition,
  ) => {
    if (transition === "raise_failure") {
      alerts.push({
        event: "operability.business_failure",
        component,
        state: "failing",
        level: "error",
        message: `Critical background loop persistently failing: ${component} (${consecutiveFailedTicks} consecutive ticks with business failures)`,
      });
    } else if (transition === "raise_recovery") {
      alerts.push({
        event: "operability.business_failure",
        component,
        state: "recovered",
        level: "info",
        message: `Critical background loop business failures cleared: ${component}`,
      });
    }
  };

  const heartbeatFailing = classifyPersistentBusinessFailure(
    input.heartbeatConsecutiveFailedTicks,
  );
  businessFailure(
    "heartbeat",
    input.heartbeatConsecutiveFailedTicks,
    trackers.business_failure.heartbeat(heartbeatFailing),
  );

  const deadlineFailing = classifyPersistentBusinessFailure(
    input.deadlineConsecutiveFailedTicks,
  );
  businessFailure(
    "deadline_scanner",
    input.deadlineConsecutiveFailedTicks,
    trackers.business_failure.deadline_scanner(deadlineFailing),
  );

  // #871: retention passes are daily, so the threshold counts consecutive
  // failed DAYS — the loop retries every pass, non-convergence is the alert.
  const retentionFailing = classifyPersistentBusinessFailure(
    input.retentionConsecutiveFailedTicks,
  );
  businessFailure(
    "client_event_retention",
    input.retentionConsecutiveFailedTicks,
    trackers.business_failure.client_event_retention(retentionFailing),
  );

  // #885: a tick that THROWS still SETTLES (so the stall facts above stay
  // healthy) and does not advance the business-failure counter (so #862 stays
  // silent) — without this leg a loop that throws every tick escalates
  // nothing. The fact asserted is only the run of throws: root cause, business
  // outcome and backlog state stay UNKNOWN. Throws share the #862 window
  // (both are counted in ticks of the same configured scan cadence), so the
  // existing predicate is reused deliberately (ADR-024).
  const tickFailure = (
    component: "heartbeat" | "deadline_scanner",
    consecutiveThrowTicks: number,
    transition: AlertTransition,
  ) => {
    if (transition === "raise_failure") {
      alerts.push({
        event: "operability.tick_failure",
        component,
        state: "failing",
        level: "error",
        message: `Critical background loop tick exceptions: ${component} (${consecutiveThrowTicks} consecutive ticks threw; root cause unknown)`,
      });
    } else if (transition === "raise_recovery") {
      alerts.push({
        event: "operability.tick_failure",
        component,
        state: "recovered",
        level: "info",
        message: `Critical background loop tick exceptions cleared: ${component} (a settled tick without a throw interrupted the run; business restoration unknown)`,
      });
    }
  };

  const heartbeatTickFailing = classifyPersistentBusinessFailure(
    input.heartbeatConsecutiveThrowTicks,
  );
  tickFailure(
    "heartbeat",
    input.heartbeatConsecutiveThrowTicks,
    trackers.tick_failure.heartbeat(heartbeatTickFailing),
  );

  const deadlineTickFailing = classifyPersistentBusinessFailure(
    input.deadlineConsecutiveThrowTicks,
  );
  tickFailure(
    "deadline_scanner",
    input.deadlineConsecutiveThrowTicks,
    trackers.tick_failure.deadline_scanner(deadlineTickFailing),
  );

  return alerts;
}

// ── Plugin: one unref'd timer, same lifecycle shape as the scanners ────────

/**
 * Owns the operability monitor cadence. Registered AFTER the scanner plugins
 * (it reads their metrics objects) and after db/redis. The tick probes
 * readiness once and classifies both critical loops; emitted alerts go to the
 * structured log with stable `operability.*` event fields.
 */
const operabilityMonitorPlugin: FastifyPluginAsync = async (fastify) => {
  const config = getRuntimeConfig();
  const probeDeps = buildReadinessProbeDeps(fastify);

  const trackers = {
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

  let activeTick: Promise<void> | null = null;
  let closing = false;

  const runTick = () => {
    if (closing || activeTick) return;
    activeTick = (async () => {
      try {
        const readiness = await probeApplicationReadiness(probeDeps);
        const now = fastify.now();
        const alerts = evaluateOperabilityTick(
          {
            readiness,
            heartbeat: heartbeatMetrics,
            heartbeatIntervalMs: config.heartbeat.scanIntervalMs,
            deadline: deadlineScannerMetrics,
            deadlineIntervalMs: config.heartbeat.deadlineScanIntervalMs,
            retention: clientEventRetentionMetrics,
            retentionIntervalMs: CLIENT_EVENT_RETENTION_SWEEP_INTERVAL_MS,
            heartbeatConsecutiveFailedTicks:
              heartbeatMetrics.consecutiveFailedTicks,
            deadlineConsecutiveFailedTicks:
              deadlineScannerMetrics.consecutiveFailedTicks,
            retentionConsecutiveFailedTicks:
              clientEventRetentionMetrics.consecutiveFailedTicks,
            heartbeatConsecutiveThrowTicks:
              heartbeatMetrics.consecutiveThrowTicks,
            deadlineConsecutiveThrowTicks:
              deadlineScannerMetrics.consecutiveThrowTicks,
            now,
          },
          trackers,
        );
        for (const alert of alerts) {
          fastify.log[alert.level](
            {
              event: alert.event,
              component: alert.component,
              state: alert.state,
            },
            alert.message,
          );
        }
      } catch (err) {
        // The monitor must never become its own incident source: a tick that
        // itself throws is retried on the next cadence. Readiness probe errors
        // are already classified inside probeApplicationReadiness.
        fastify.log.warn({ err }, "Operability monitor tick failed");
      }
    })().finally(() => {
      activeTick = null;
    });
  };

  const interval = setInterval(runTick, OPERABILITY_MONITOR_INTERVAL_MS);
  interval.unref();

  fastify.addHook("onClose", async () => {
    closing = true;
    clearInterval(interval);
    await activeTick;
  });
};

export default fp(operabilityMonitorPlugin);
