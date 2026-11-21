import type { FastifyInstance } from "fastify";

/**
 * Bounded shutdown for background-loop onClose hooks (#1055 / #1047 R-T1-3).
 *
 * WHY one shared window: Fastify awaits onClose hooks SERIALLY. A per-loop
 * budget would multiply the #351 shutdown contract — four loop hooks each
 * waiting their own 8s while a tick is hung on a DB lock, plus the email
 * outbox's separate 8s, audit 10s, DB end 10s and exit assist 2s, exceeds
 * the 45s compose stop grace (docker-compose.yml `stop_grace_period`) and
 * turns a graceful stop into SIGKILL (exit 137). EVERY loop hook that
 * abandons in-flight work on close — the email outbox and the four scanners
 * (deadlineScanner, heartbeat, clientEventRetention, operabilityMonitor) —
 * therefore draws from ONE window anchored at the first one to run. The
 * email loop's effective bound is the smaller of its configured
 * EMAIL_WORKER_SHUTDOWN_TIMEOUT_MS and the remaining window, so the serial
 * worst case stays at loops 8s shared + audit 10s + DB end 10s + exit assist
 * 2s = 30s < 45s.
 *
 * WHY Date.now(): this is a process-level shutdown bound, like the #351 exit
 * assist it feeds. It must keep advancing even when a test-controlled
 * `fastify.now()` clock is frozen — a frozen clock would make the window
 * never expire.
 *
 * OWNERSHIP: the deadline is per Fastify instance (WeakMap keyed by the root
 * instance all fp-registered loop plugins share), so app instances created
 * in one test process never share or exhaust each other's window.
 */
export const LOOP_SHUTDOWN_BUDGET_MS = 8_000;

const deadlines = new WeakMap<object, number>();

/**
 * Milliseconds left in this app instance's shared loop-shutdown window. The
 * first call anchors the window; an exhausted window returns 0, which races
 * a 0ms timer — a still-in-flight tick is then abandoned on the next
 * event-loop turn.
 */
export function remainingLoopShutdownBudgetMs(app: object): number {
  const now = Date.now();
  const deadline = deadlines.get(app) ?? now + LOOP_SHUTDOWN_BUDGET_MS;
  deadlines.set(app, deadline);
  return Math.max(0, deadline - now);
}

/** Per-loop log lines for the two race outcomes (clean settle / abandoned). */
export interface LoopShutdownMessages {
  /** The in-flight tick settled within the budget. */
  clean: string;
  /** The in-flight tick rejected while shutting down (defensive). */
  failed: string;
  /** The budget expired first; the tick keeps running under its own owner. */
  abandoned: string;
}

export interface LoopShutdownRace {
  fastify: FastifyInstance;
  /** The loop's in-flight tick, or null when the loop is idle. */
  inFlight: Promise<unknown> | null;
  messages: LoopShutdownMessages;
  /** Extra fields for the abandoned-path warn (e.g. the abandoned tick's id). */
  abandonedFields?: Record<string, unknown>;
}

/**
 * Closes one background loop within the shared shutdown window.
 *
 * The timer is the same pattern as the email outbox loop (emailOutboxLoop.ts
 * onClose): unref'd, so it can never hold the event loop open by itself —
 * #351 liveness comes from unref, not from clearing. `finally clearTimeout`
 * is still required hygiene: it releases the handle and guarantees a stale
 * callback cannot outlive this hook, so a long serial close chain does not
 * accumulate expired timers.
 *
 * A tick that loses the race keeps running; its transaction is still owned
 * by executeInTransaction and finishes (or is rolled back with its
 * connection) after the DB unlocks — the DB pool's bounded `sql.end` is the
 * final backstop.
 */
export async function raceLoopShutdown(race: LoopShutdownRace): Promise<void> {
  const budgetMs = remainingLoopShutdownBudgetMs(race.fastify);
  let timedOut = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<void>((resolve) => {
    timeout = setTimeout(() => {
      timedOut = true;
      resolve();
    }, budgetMs);
    timeout.unref();
  });

  // Attach the rejection handler on the tick itself so a late failure after
  // the race is abandoned still counts as handled (never an unhandled
  // rejection during process shutdown).
  const settled = Promise.resolve(race.inFlight).then(
    () => true,
    (err: unknown) => {
      race.fastify.log.error({ err }, race.messages.failed);
      return true;
    },
  );

  let drained: boolean;
  try {
    drained = await Promise.race([settled, timeoutPromise.then(() => false)]);
  } finally {
    clearTimeout(timeout);
  }

  if (drained && !timedOut) {
    race.fastify.log.info(race.messages.clean);
  } else {
    race.fastify.log.warn(
      { ...race.abandonedFields, budgetMs },
      race.messages.abandoned,
    );
  }
}
