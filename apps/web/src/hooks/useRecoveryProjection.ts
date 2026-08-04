import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  classifyRecoveryError,
  type ClassifiedRecoveryError,
} from "@/lib/recoveryErrors";

/**
 * J5-I1B Recovery Center — shared projection loader (P1-3 / P1-4 / P2-1).
 *
 * One hook backing the four Recovery surfaces (Queue, Incident detail,
 * Attempt operations, Exam context). It owns the J5-R0 §9 refresh model:
 *
 *   - single-flight + real abort: a manual refresh / filter change / route
 *     change ABORTS the in-flight controller and supersedes it; a scheduled
 *     poll tick is DROPPED while a request is running; a focus/visibility
 *     trigger is dropped if a request is active, else fires immediately.
 *     No concurrently owned client requests; aborted/superseded responses
 *     cannot commit (sequence check).
 *   - resource switches are RESET: when the caller's `deps` change (route id,
 *     filter query), the previous resource's data/error/snapshot state is
 *     cleared synchronously BEFORE the new resource loads, so the old
 *     resource can never be shown (or mistaken for a background refresh)
 *     while the new one is in flight.
 *   - staleness is anchored to the SERVER snapshot time (`getSnapshotAt`), not
 *     the client receive time — so a slow request or a cached older snapshot
 *     is reported accurately. A 10s `now`-tick drives re-render so the stale
 *     flag actually flips as wall-clock advances.
 *   - recursive `setTimeout` backoff is scheduled on REQUEST COMPLETION: each
 *     finished request (initial / manual / poll / focus / visible, success or
 *     failure) computes the next poll delay (double on failure to
 *     `backoff.maxMs`, reset on success) and arms the timer — the poll cadence
 *     never depends on data identity, so a manual refresh or a failed
 *     background refresh can not silently stop polling. Manual / focus /
 *     visible refresh BYPASS backoff (immediate). Hidden tab schedules
 *     nothing; regaining visibility loads immediately and restores the
 *     cadence. AbortError does NOT bump failure count or backoff.
 *   - initial vs background loading: `isInitialLoading` is true only when
 *     there is no data yet; a background refresh exposes `isRefreshing` so the
 *     page keeps readable data (a background failure keeps old data + marks it
 *     stale + an inline warning, NOT a full-screen ErrorState — the page
 *     decides that via `error && !data`).
 *
 * Concurrency promise (review amendment #4): no concurrently owned client
 * requests; aborted/superseded responses cannot commit. Server-side
 * instantaneous overlap cannot be absolutely prevented (a request may already
 * have arrived before abort propagates) — the client never commits such a
 * response.
 */

type Trigger = "initial" | "manual" | "poll" | "visible" | "focus";

export interface UseRecoveryProjectionOptions<T> {
  /**
   * Loads the projection. Receives an `AbortSignal`; a loader that forwards it
   * to `api.get(path, { signal })` gets real cancellation. The loader MUST
   * treat an `AbortError` as intentional (it will be re-thrown unchanged by
   * the hook, never surfaced as an error state).
   */
  load: (opts: { signal: AbortSignal }) => Promise<T>;
  /** Extracts the server RR snapshot timestamp from a successful result. */
  getSnapshotAt: (data: T) => string;
  /** Polling interval in ms. `undefined` ⇒ no polling (detail pages). */
  pollIntervalMs?: number;
  /** A result whose server snapshot is older than this is `isStale`. */
  staleAfterMs?: number;
  /** Refresh on window focus (default: polling surfaces only). */
  refreshOnFocus?: boolean;
  /** Refresh on tab visibility regain (default: polling surfaces only). */
  refreshOnVisible?: boolean;
  /** Bounded failure backoff for the automatic poll cadence. */
  backoff?: { initialMs: number; maxMs: number };
  /** Extra deps that, when changed, trigger an abort + reset + supersede. */
  deps?: readonly unknown[];
}

export interface UseRecoveryProjectionResult<T> {
  data: T | null;
  error: ClassifiedRecoveryError | null;
  /** True only when there is no data yet (first load). Full-screen LoadingState. */
  isInitialLoading: boolean;
  /** True while a background refresh runs with existing data kept on screen. */
  isRefreshing: boolean;
  /** Server-snapshot-based staleness (true when older than `staleAfterMs`). */
  isStale: boolean;
  /** Server snapshot timestamp string (null until first successful load). */
  snapshotAt: string | null;
  /** Client receive time of the last successful load (diagnostic). */
  lastUpdatedAt: Date | null;
  /** Manual refresh — aborts any in-flight request and supersedes it. */
  refresh: () => void;
}

const STALE_CLOCK_TICK_MS = 10_000;

export function useRecoveryProjection<T>(
  options: UseRecoveryProjectionOptions<T>,
): UseRecoveryProjectionResult<T> {
  const {
    load,
    getSnapshotAt,
    pollIntervalMs,
    staleAfterMs,
    refreshOnFocus = pollIntervalMs !== undefined,
    refreshOnVisible = pollIntervalMs !== undefined,
    backoff,
    deps = [],
  } = options;

  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ClassifiedRecoveryError | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());

  // Single-flight ownership. `seqRef` is a monotonic token; only the latest
  // owner may commit (a stale/aborted response is dropped by sequence check).
  // `controllerRef` holds the in-flight AbortController so a superseding
  // trigger can abort it. `failureRef` drives the completion-time backoff.
  // `hasDataRef` tracks whether the CURRENT resource has any loaded data —
  // it is reset on deps change so a new resource's first load is treated as
  // initial (full-screen loading, not a background refresh).
  const seqRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const failureRef = useRef(0);
  const hasDataRef = useRef(false);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const disposedRef = useRef(false);

  // Keep `load`/`getSnapshotAt` refs so the in-flight closure always calls the
  // latest without re-triggering the deps effect per render.
  const loadRef = useRef(load);
  loadRef.current = load;
  const getSnapshotAtRef = useRef(getSnapshotAt);
  getSnapshotAtRef.current = getSnapshotAt;

  const clearPollTimer = useCallback(() => {
    if (pollTimerRef.current !== null) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  // `runRef` breaks the run ↔ schedule cycle: the timer fires through the
  // latest `run` while `run` schedules through `scheduleNextPoll`.
  const runRef = useRef<(trigger: Trigger) => Promise<void>>(async () => {});
  const scheduleNextPoll = useCallback(() => {
    clearPollTimer();
    if (disposedRef.current) return;
    if (pollIntervalMs === undefined) return;
    if (document.visibilityState !== "visible") return;
    const fails = failureRef.current;
    let delay = pollIntervalMs;
    if (backoff && fails > 0) {
      const exponent = Math.min(fails, 10); // cap exponent to avoid overflow
      delay = Math.min(backoff.initialMs * 2 ** exponent, backoff.maxMs);
    }
    pollTimerRef.current = setTimeout(() => {
      // Hidden at fire time: run nothing; the visibility handler restores the
      // cadence (immediate load + schedule) on the next visible transition.
      if (document.visibilityState !== "visible") return;
      void runRef.current("poll");
    }, delay);
  }, [pollIntervalMs, backoff, clearPollTimer]);

  /** Core loader. `trigger` controls single-flight/backoff semantics. */
  const run = useCallback(
    async (trigger: Trigger) => {
      if (disposedRef.current) return;
      // Scheduled poll: drop the tick while a request is running (the in-flight
      // request re-arms the timer on completion). Focus/visibility: drop if a
      // request is active; else fire immediately. Manual / initial / deps:
      // abort + supersede.
      if (controllerRef.current !== null) {
        if (
          trigger === "poll" ||
          trigger === "visible" ||
          trigger === "focus"
        ) {
          return;
        }
        controllerRef.current.abort();
      }
      const controller = new AbortController();
      controllerRef.current = controller;
      const seq = ++seqRef.current;
      if (hasDataRef.current || trigger !== "initial") {
        setIsRefreshing(true);
      }
      try {
        const result = await loadRef.current({ signal: controller.signal });
        if (seq !== seqRef.current || controller.signal.aborted) return;
        hasDataRef.current = true;
        setData(result);
        setError(null);
        setLastUpdatedAt(new Date());
        failureRef.current = 0;
      } catch (err) {
        // AbortError: intentional supersession — no error state, no backoff,
        // existing data preserved.
        if (
          err instanceof DOMException &&
          err.name === "AbortError" &&
          (controller.signal.aborted || seq !== seqRef.current)
        ) {
          return;
        }
        if (seq !== seqRef.current) return;
        const classified = classifyRecoveryError(err);
        // A background-refresh failure keeps the old data and marks it stale;
        // only a first-load failure (no data for THIS resource) produces the
        // full-screen error state.
        if (!hasDataRef.current) setData(null);
        setError(classified);
        failureRef.current += 1;
      } finally {
        if (controllerRef.current === controller) {
          controllerRef.current = null;
        }
        if (seq === seqRef.current && !disposedRef.current) {
          setIsRefreshing(false);
          // Schedule the NEXT poll from THIS completion's failure count — the
          // cadence is restored even after a manual refresh or a failed
          // background refresh (it never depends on data identity).
          scheduleNextPoll();
        }
      }
    },
    [scheduleNextPoll],
  );
  runRef.current = run;

  /** Manual refresh — always aborts + supersedes, bypasses backoff. */
  const refresh = useCallback(() => {
    clearPollTimer();
    void run("manual");
  }, [run, clearPollTimer]);

  // (Re)load on mount and whenever the caller's extra deps change (route /
  // resource id / filter). A dep change ABORTS + RESETS + supersedes: the
  // previous resource's data/error/snapshot state is cleared synchronously so
  // the old resource can never render (or be read as a background refresh)
  // while the new resource loads.
  const depsKey = JSON.stringify(deps);
  const activeKeyRef = useRef(depsKey);
  const keyChanged = activeKeyRef.current !== depsKey;
  useEffect(() => {
    disposedRef.current = false;
    controllerRef.current?.abort();
    seqRef.current += 1;
    hasDataRef.current = false;
    failureRef.current = 0;
    clearPollTimer();
    setData(null);
    setError(null);
    setLastUpdatedAt(null);
    setIsRefreshing(false);
    activeKeyRef.current = depsKey;
    void run("initial");
    return () => {
      disposedRef.current = true;
      seqRef.current += 1;
      controllerRef.current?.abort();
      controllerRef.current = null;
      clearPollTimer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depsKey]);

  // Focus / visibility — immediate refresh, dropped if a request is active.
  useEffect(() => {
    if (!refreshOnFocus && !refreshOnVisible) return;
    const onVisibility = () => {
      if (refreshOnVisible && document.visibilityState === "visible") {
        void run("visible");
      }
    };
    const onFocus = () => {
      if (refreshOnFocus) void run("focus");
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
    };
  }, [refreshOnFocus, refreshOnVisible, run]);

  // Stale clock — a periodic `now` tick so `isStale` recomputes and re-renders
  // as wall-clock advances (the page's static comparison never self-updated).
  useEffect(() => {
    if (staleAfterMs === undefined) return;
    const id = setInterval(() => setNowTick(Date.now()), STALE_CLOCK_TICK_MS);
    return () => clearInterval(id);
  }, [staleAfterMs]);

  const snapshotAt = useMemo(() => {
    if (!data) return null;
    try {
      return getSnapshotAtRef.current(data);
    } catch {
      return null;
    }
  }, [data]);

  const isStale =
    staleAfterMs !== undefined &&
    snapshotAt !== null &&
    nowTick - new Date(snapshotAt).getTime() > staleAfterMs;

  if (keyChanged) {
    return {
      data: null,
      error: null,
      isInitialLoading: true,
      isRefreshing: false,
      isStale: false,
      snapshotAt: null,
      lastUpdatedAt: null,
      refresh,
    };
  }

  return {
    data,
    error,
    isInitialLoading: data === null && error === null,
    isRefreshing,
    isStale,
    snapshotAt,
    lastUpdatedAt,
    refresh,
  };
}
