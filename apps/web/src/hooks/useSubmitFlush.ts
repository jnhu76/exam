import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

/** Debounce delay before a pending save is sent to the server. */
const DEBOUNCE_MS = 1500;
/** Maximum time to wait for all in-flight saves during flush. */
const FLUSH_TIMEOUT_MS = 10_000;

/** Lifecycle status of a per-question save operation. */
export type SaveStatus = "idle" | "pending" | "inflight" | "saved" | "failed";

/** Result returned by the flush method after draining all pending saves. */
export interface FlushResult {
  pendingCount: number;
  failedQuestionIds: string[];
  timedOut: boolean;
}

/** Internal entry tracking a debounced save timer and its save function. */
interface PendingEntry {
  timer: ReturnType<typeof setTimeout>;
  save: () => Promise<void>;
  questionGeneration: number;
}

/**
 * A fully isolated per-scope container. Each scope (e.g. one attemptId) owns
 * its OWN pending/inflight/status/generation maps — they are NEVER shared
 * across scopes, even when two scopes happen to use the same questionId.
 *
 * On a scope change the previous scope object is retained (not mutated) so
 * its already-started inflight saves can settle naturally; only its pending
 * timers are cleared. The new scope gets fresh, empty maps.
 */
interface SaveScopeState {
  key: string | undefined;
  /** Monotonic across the lifetime of the component, even as scopes change. */
  generation: number;
  pending: Map<string, PendingEntry>;
  inflight: Map<string, Promise<void>>;
  statuses: Map<string, SaveStatus>;
  questionGenerations: Map<string, number>;
}

function createScopeState(
  key: string | undefined,
  generation: number,
): SaveScopeState {
  return {
    key,
    generation,
    pending: new Map(),
    inflight: new Map(),
    statuses: new Map(),
    questionGenerations: new Map(),
  };
}

/** Public interface of the useSubmitFlush hook. */
export interface UseSubmitFlush {
  scheduleSave: (questionId: string, save: () => Promise<void>) => void;
  flush: () => Promise<FlushResult>;
  getQuestionStatus: (questionId: string) => SaveStatus;
  /** Monotonic scope-generation token. Bumps on every real scope change. */
  getScopeGeneration: () => number;
  failedQuestionIds: string[];
}

/**
 * Manages debounced, per-question answer saves with generation-based
 * cancellation, status tracking, and a flush-all method for exam submission.
 *
 * `scopeKey` isolates the entire save queue (pending timers, inflight
 * promises, statuses, per-question generations) per scope — typically the
 * route `attemptId`. When `scopeKey` changes, the previous scope's pending
 * timers are cancelled and a brand-new set of empty maps is created for the
 * new scope; the previous scope's already-inflight saves are allowed to
 * settle but can no longer write status. This is what makes the save queue
 * safe when `TakeExamPage` reuses one component instance across attempts.
 */
export function useSubmitFlush(scopeKey?: string): UseSubmitFlush {
  // The currently-active scope. Replaced (not mutated) on a scope change.
  const activeScopeRef = useRef<SaveScopeState>(createScopeState(scopeKey, 0));
  const mountedRef = useRef(true);
  const [failedQuestionIds, setFailedQuestionIds] = useState<string[]>([]);
  const [, forceTick] = useState(0);

  const tick = useCallback(() => {
    if (!mountedRef.current) return;
    forceTick((n) => n + 1);
  }, []);

  /**
   * Sets a question's status within a SPECIFIC scope. A status write is only
   * applied when the scope is still current — a stale scope's inflight save
   * that settles after a scope change must not pollute the new scope's
   * status map or the public failedQuestionIds list.
   */
  const setStatus = useCallback(
    (scope: SaveScopeState, questionId: string, status: SaveStatus) => {
      scope.statuses.set(questionId, status);
      if (!mountedRef.current) return;
      // Only the ACTIVE scope may mutate the public failedQuestionIds state.
      // A settling stale scope's status write is recorded on its own map
      // (harmless; the map is unreachable once superseded) but does not leak
      // to the new scope's UI.
      if (activeScopeRef.current !== scope) return;
      if (status === "failed") {
        setFailedQuestionIds((prev) =>
          prev.includes(questionId) ? prev : [...prev, questionId],
        );
      } else {
        setFailedQuestionIds((prev) => prev.filter((id) => id !== questionId));
      }
      tick();
    },
    [tick],
  );

  /**
   * Runs a save against a SPECIFIC scope's inflight queue. Same-question
   * serialization is per-scope: scope B/q1 never waits behind scope A/q1,
   * because each scope has its own inflight map.
   */
  const runSave = useCallback(
    (
      scope: SaveScopeState,
      questionId: string,
      save: () => Promise<void>,
      questionGeneration: number,
    ): Promise<void> => {
      const previous = scope.inflight.get(questionId);
      const execute = () => {
        if (scope.questionGenerations.get(questionId) === questionGeneration) {
          setStatus(scope, questionId, "inflight");
        }
        try {
          return save();
        } catch (error) {
          return Promise.reject(error);
        }
      };
      const operation = previous ? previous.then(execute) : execute();
      const promise = operation
        .then(() => {
          if (
            scope.questionGenerations.get(questionId) === questionGeneration
          ) {
            setStatus(scope, questionId, "saved");
          }
        })
        .catch(() => {
          if (
            scope.questionGenerations.get(questionId) === questionGeneration
          ) {
            setStatus(scope, questionId, "failed");
          }
        })
        .finally(() => {
          if (scope.inflight.get(questionId) === promise) {
            scope.inflight.delete(questionId);
          }
        });
      scope.inflight.set(questionId, promise);
      return promise;
    },
    [setStatus],
  );

  const drainPending = useCallback(
    (scope: SaveScopeState) => {
      for (const [questionId, entry] of scope.pending.entries()) {
        clearTimeout(entry.timer);
        scope.pending.delete(questionId);
        void runSave(scope, questionId, entry.save, entry.questionGeneration);
      }
    },
    [runSave],
  );

  const scheduleSave = useCallback(
    (questionId: string, save: () => Promise<void>) => {
      // Capture the ACTIVE scope at schedule time. A late-firing timer reads
      // only this captured scope — never a scope that became active later.
      const scope = activeScopeRef.current;
      const existing = scope.pending.get(questionId);
      if (existing) clearTimeout(existing.timer);

      const questionGeneration =
        (scope.questionGenerations.get(questionId) ?? 0) + 1;
      scope.questionGenerations.set(questionId, questionGeneration);
      setStatus(scope, questionId, "pending");

      const timer = setTimeout(() => {
        if (!mountedRef.current) return;
        scope.pending.delete(questionId);
        void runSave(scope, questionId, save, questionGeneration);
      }, DEBOUNCE_MS);

      scope.pending.set(questionId, {
        timer,
        save,
        questionGeneration,
      });
    },
    [runSave, setStatus],
  );

  /**
   * Flushes the save queue. The scope is captured at call time and the entire
   * flush lifecycle reads ONLY that scope — an old-scope flush that is still
   * awaiting when the scope changes cannot drain, await, or count the new
   * scope's work.
   */
  const flush = useCallback(async (): Promise<FlushResult> => {
    const scope = activeScopeRef.current;
    const start = Date.now();
    let timedOut = false;

    while (true) {
      drainPending(scope);

      if (scope.inflight.size === 0 && scope.pending.size === 0) {
        break;
      }

      const remaining = FLUSH_TIMEOUT_MS - (Date.now() - start);
      if (remaining <= 0) {
        timedOut = true;
        break;
      }

      const inflightPromises = Array.from(scope.inflight.values());
      const settledRound = Promise.allSettled(inflightPromises);
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<"timeout">((resolve) => {
        timeoutId = setTimeout(() => resolve("timeout"), remaining);
      });

      const winner = await Promise.race([
        settledRound.then(() => "settled" as const),
        timeout,
      ]);
      if (timeoutId) clearTimeout(timeoutId);

      if (winner === "timeout") {
        timedOut = true;
        break;
      }
    }

    const failed: string[] = [];
    let pendingCount = 0;
    const allTouchedIds = new Set<string>([
      ...scope.statuses.keys(),
      ...scope.inflight.keys(),
      ...scope.pending.keys(),
    ]);
    for (const id of allTouchedIds) {
      const status = scope.statuses.get(id);
      if (status === "failed") {
        failed.push(id);
      } else if (status === "inflight" || status === "pending") {
        pendingCount += 1;
      }
    }

    return { pendingCount, failedQuestionIds: failed, timedOut };
  }, [drainPending]);

  const getQuestionStatus = useCallback(
    (questionId: string): SaveStatus =>
      activeScopeRef.current.statuses.get(questionId) ?? "idle",
    [],
  );

  const getScopeGeneration = useCallback(
    () => activeScopeRef.current.generation,
    [],
  );

  // Scope switch. useLayoutEffect (not useEffect): runs synchronously before
  // paint, closing the narrow window where an old debounce timer could fire
  // between commit and a passive effect cleanup. On a real scope change we
  // (1) clear the old scope's pending timers, (2) retain the old scope object
  // so its inflight saves settle without writing status, and (3) install a
  // brand-new scope with empty maps for the new scope's exclusive use.
  useLayoutEffect(() => {
    const oldScope = activeScopeRef.current;
    if (oldScope.key === scopeKey) {
      return;
    }
    for (const entry of oldScope.pending.values()) {
      clearTimeout(entry.timer);
    }
    oldScope.pending.clear();

    activeScopeRef.current = createScopeState(
      scopeKey,
      oldScope.generation + 1,
    );

    setFailedQuestionIds([]);
    tick();
  }, [scopeKey, tick]);

  // Mount flag + unmount cleanup: clear the active scope's pending timers.
  // The scope is read INSIDE the returned cleanup (not captured at mount) so
  // that if the scope changed during the component's life, unmount clears the
  // CURRENTLY-active scope's timers, not the original one.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const scope = activeScopeRef.current;
      for (const entry of scope.pending.values()) clearTimeout(entry.timer);
      scope.pending.clear();
    };
  }, []);

  return {
    scheduleSave,
    flush,
    getQuestionStatus,
    getScopeGeneration,
    failedQuestionIds,
  };
}
