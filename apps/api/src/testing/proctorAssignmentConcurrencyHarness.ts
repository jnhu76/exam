/**
 * J4-I1A — Proctor-assignment concurrency test harness (test-only).
 *
 * This harness contains NO duplicate of the production assign/revoke/recovery
 * logic. The deterministic concurrency test drives the SAME production engine
 * commands (`assignProctorToExam` / `revokeProctorFromExam`) through the SAME
 * recovery wrapper (`withProctorAssignmentOperationRecovery`) that a route
 * would call. The engine commands are passed a repo decorated here so the test
 * controller can fix T1-before-T2 ordering via a barrier, and observe the real
 * in-transaction errors (the active-unique 23505 on `insertAssignment`, the
 * events operation-unique 23505 on `appendEvent`). The production recovery
 * wrapper itself is unchanged — the decoration lives entirely in the test.
 *
 * The two singletons that make this safe across `executeInTransaction`'s
 * 40001/40P01 auto-retry are {@link onceAsync} and the runner-level closure
 * (see the test's `raceRunner`): the repo is recreated inside `run(tx)` on each
 * attempt, so a one-shot flag inside the wrapper would reset per attempt. The
 * frozen one-shot wrappers are built once per racer, outside the transaction
 * callback, and survive retries.
 */

import type { ProctorAssignmentRepo } from "@exam/exam-engine";
import { createDeferred, type Deferred } from "./barrier.js";

// ── Hook plumbing ──────────────────────────────────────────────────────────

/**
 * Test hooks injected by decorating a {@link ProctorAssignmentRepo}. Each gate
 * (`afterOperationLookupAbsent`, `afterActiveLookupAbsent`,
 * `beforeResolveRevokeTarget`, `afterResolveRevokeTarget`) coordinates barrier
 * timing; each observer (`onInsertAssignmentError`, `onAppendEventError`)
 * surfaces the real caught error. All optional.
 */
export interface ProctorRaceHooks {
  /** Fires when the operationId pre-read returns absent (both assign & revoke entry gate). */
  afterOperationLookupAbsent?: () => Promise<void>;
  /** Fires when the active-episode lookup returns absent (different-opId assign gate). */
  afterActiveLookupAbsent?: () => Promise<void>;
  /** Fires before the revoke target's `SELECT ... FOR UPDATE` (revoke lock-race gate). */
  beforeResolveRevokeTarget?: () => Promise<void>;
  /** Fires after the revoke target's `SELECT ... FOR UPDATE` (T1 holds the lock, pauses here). */
  afterResolveRevokeTarget?: () => Promise<void>;
  /** Observes a real 23505 from `insertAssignment` (active-unique loser). */
  onInsertAssignmentError?: (error: unknown) => void;
  /** Observes a real 23505 from `appendEvent` (events operation-unique loser). */
  onAppendEventError?: (error: unknown) => void;
}

/**
 * Wraps a one-shot gate around an async hook: the FIRST call awaits `fn`, all
 * subsequent calls are no-ops. Critical for `executeInTransaction` retries —
 * the engine command's pre-reads re-run on each 40001/40P01 retry attempt, and
 * re-entering the barrier gate would deadlock. The returned wrapper MUST be
 * constructed once per racer (outside the transaction callback, in the runner
 * closure) so its `used` flag survives repo recreation across attempts.
 */
export function onceAsync<T extends unknown[]>(
  fn?: (...args: T) => Promise<void>,
): (...args: T) => Promise<void> {
  let used = false;
  return async (...args: T) => {
    if (used || !fn) return;
    used = true;
    await fn(...args);
  };
}

/**
 * Decorates a {@link ProctorAssignmentRepo} so the supplied hooks fire at the
 * race-relevant read/insert points. The wrapper passes every method through to
 * the real repo; it only intercepts the five methods that own a race gate or a
 * 23505 observation point. `hooks` should already be wrapped in {@link onceAsync}
 * by the caller when used as a gate, so retries do not re-gate.
 */
export function wrapRepoForRace(
  repo: ProctorAssignmentRepo,
  hooks: ProctorRaceHooks,
): ProctorAssignmentRepo {
  return {
    ...repo,
    findEventByOperationId: async (...args) => {
      const result = await repo.findEventByOperationId(...args);
      if (result === null) {
        await hooks.afterOperationLookupAbsent?.();
      }
      return result;
    },
    findActiveByExamAndProctor: async (...args) => {
      const result = await repo.findActiveByExamAndProctor(...args);
      if (result === null) {
        await hooks.afterActiveLookupAbsent?.();
      }
      return result;
    },
    resolveRevokeTarget: async (...args) => {
      await hooks.beforeResolveRevokeTarget?.();
      const result = await repo.resolveRevokeTarget(...args);
      await hooks.afterResolveRevokeTarget?.();
      return result;
    },
    insertAssignment: async (...args) => {
      try {
        return await repo.insertAssignment(...args);
      } catch (error) {
        hooks.onInsertAssignmentError?.(error);
        throw error;
      }
    },
    appendEvent: async (...args) => {
      try {
        return await repo.appendEvent(...args);
      } catch (error) {
        hooks.onAppendEventError?.(error);
        throw error;
      }
    },
  };
}

// ── Barrier ────────────────────────────────────────────────────────────────

/** Observation recorded when a racer's operationId pre-read returns absent. */
export interface OpAbsentObservation {
  label: "T1" | "T2";
  operationId: string;
}

/** Observation recorded when a racer hits a 23505 on the active-unique. */
export interface ActiveUniqueViolationObservation {
  label: "T1" | "T2";
  error: unknown;
}

/** Observation recorded when a racer hits a 23505 on the events operation-unique. */
export interface EventUniqueViolationObservation {
  label: "T1" | "T2";
  error: unknown;
}

/**
 * Barrier for the deterministic proctor-assignment races. Two racers (T1, T2)
 * each pass through their operationId-absent gate; the controller fixes
 * T1-before-T2 ordering. Separate deferreds cover the active-unique loser
 * (different-opId assign), the events operation-unique loser (same-opId), and
 * the revoke FOR-UPDATE lock race.
 *
 * `dispose()` settles every outstanding deferred (resolves, not rejects, so an
 * unawaited deferred can never surface a timeout into the worker). Call from
 * the test's `finally`.
 */
export interface ProctorRaceBarrier {
  /** Fired when T1's operationId pre-read returns absent. */
  t1OpAbsent: Deferred<OpAbsentObservation>;
  /** Fired when T2's operationId pre-read returns absent. */
  t2OpAbsent: Deferred<OpAbsentObservation>;
  /** Resolved by the controller to release T1 past its operationId-absent gate. */
  releaseT1: Deferred<void>;
  /** Resolved by the controller to release T2 past its operationId-absent gate. */
  releaseT2: Deferred<void>;
  /** Fired after T1's `resolveRevokeTarget` (T1 holds the FOR UPDATE lock, pauses here). */
  t1HoldingLock: Deferred<void>;
  /** Fired when T2 enters its `resolveRevokeTarget` (about to block on FOR UPDATE). */
  t2LockStarted: Deferred<void>;
  /** Resolved by the controller to release T1 past its holding-lock pause (lets T1 commit). */
  releaseT1Lock: Deferred<void>;
  /** Fired when a racer's `insertAssignment` throws (the active-unique loser evidence). */
  activeUniqueViolation: Deferred<ActiveUniqueViolationObservation>;
  /** Fired when a racer's `appendEvent` throws (the events operation-unique loser evidence). */
  eventUniqueViolation: Deferred<EventUniqueViolationObservation>;
  /** Settle every outstanding deferred and clear every timer. */
  dispose(reason?: string): void;
}

/** Creates a fresh {@link ProctorRaceBarrier} with all deferreds initialized. */
export function createProctorRaceBarrier(): ProctorRaceBarrier {
  const deferreds = {
    t1OpAbsent: createDeferred<OpAbsentObservation>("T1 op absent"),
    t2OpAbsent: createDeferred<OpAbsentObservation>("T2 op absent"),
    releaseT1: createDeferred<void>("release T1"),
    releaseT2: createDeferred<void>("release T2"),
    t1HoldingLock: createDeferred<void>("T1 holding lock"),
    t2LockStarted: createDeferred<void>("T2 lock started"),
    releaseT1Lock: createDeferred<void>("release T1 lock"),
    activeUniqueViolation: createDeferred<ActiveUniqueViolationObservation>(
      "active-unique violation",
    ),
    eventUniqueViolation: createDeferred<EventUniqueViolationObservation>(
      "event-unique violation",
    ),
  };

  return {
    ...deferreds,
    dispose(reason = "barrier disposed") {
      for (const d of Object.values(deferreds)) {
        if (!d.isSettled()) {
          // Resolve (not reject) so an unawaited promise can never surface a
          // timeout error into the worker.
          d.resolve(reason as never);
        }
      }
    },
  };
}
