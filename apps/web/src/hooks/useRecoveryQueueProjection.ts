import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  classifyRecoveryError,
  type ClassifiedRecoveryError,
} from "@/lib/recoveryErrors";

/**
 * J5-I1B Recovery Center — Queue-specific projection coordinator (P1-4).
 *
 * The generic {@link useRecoveryProjection} is a detail-page primitive. The
 * Queue page additionally paginates (keyset cursor) and must coordinate a
 * page-1 refresh with a loadMore append so the two can NEVER run concurrently.
 * Rather than bend the generic hook into a pagination framework, this
 * coordinator composes the same abort/sequence/backoff primitives but exposes
 * BOTH `refresh()` (page-1, replaces items + resets the cursor chain) and
 * `loadMore()` (appends the next cursor page), sharing ONE in-flight slot.
 *
 * Shared-slot rule (review amendment #3): a page-1 refresh aborts an in-flight
 * loadMore (and vice-versa); a scheduled poll is dropped while either runs.
 * The Queue keeps its current items during a background refresh (no full-screen
 * loading on poll/focus) — `isInitialLoading` is true only on the first load
 * with no items yet.
 *
 * Filter changes (`deps`) RESET the projection synchronously (items, cursor,
 * snapshot, error, resolved flag) before the new query loads — the previous
 * filter's rows can never be shown while the new query is in flight.
 *
 * Staleness mirrors the generic hook: `isStale` is computed from the SERVER
 * `snapshotAt` of the latest page-1 result against `staleAfterMs`, driven by a
 * 10s wall-clock tick.
 *
 * Poll cadence is scheduled on REQUEST COMPLETION (page-1 OR loadMore), so a
 * manual refresh — even one that returns the same item count, or one that
 * fails — re-arms the timer and polling never silently stops.
 */

export interface QueuePageResult<TItem> {
  items: TItem[];
  nextCursor: string | null;
  snapshotAt: string;
}

export interface UseRecoveryQueueProjectionOptions<TItem> {
  /** Loads page 1 (replaces items). Receives an AbortSignal. */
  loadPage1: (opts: { signal: AbortSignal }) => Promise<QueuePageResult<TItem>>;
  /** Loads the next cursor page (appends). Receives an AbortSignal. */
  loadMorePage: (
    cursor: string,
    opts: { signal: AbortSignal },
  ) => Promise<QueuePageResult<TItem>>;
  /** Polling interval in ms. */
  pollIntervalMs?: number;
  /** A server snapshot older than this is `isStale`. */
  staleAfterMs?: number;
  /** Bounded failure backoff for the automatic poll cadence. */
  backoff?: { initialMs: number; maxMs: number };
  /** Extra deps that, when changed, trigger an abort + reset + page-1 reload. */
  deps?: readonly unknown[];
}

export interface UseRecoveryQueueProjectionResult<TItem> {
  items: TItem[];
  nextCursor: string | null;
  error: ClassifiedRecoveryError | null;
  /** True only on the first load with no items yet. */
  isInitialLoading: boolean;
  /** True during a background page-1 refresh or a loadMore append. */
  isRefreshing: boolean;
  /** True while the next cursor page is being appended. */
  isLoadingMore: boolean;
  /** Server RR snapshot timestamp (from the latest page-1 result). */
  snapshotAt: string | null;
  /** Client receive time of the last successful page-1 load (diagnostic). */
  lastUpdatedAt: Date | null;
  /** Server-snapshot-based staleness (true when older than `staleAfterMs`). */
  isStale: boolean;
  /** Manual refresh — aborts any in-flight request and reloads page 1. */
  refresh: () => void;
  /** Appends the next cursor page. Mutually exclusive with refresh(). */
  loadMore: () => void;
}

type Page1Trigger = "initial" | "manual" | "poll" | "visible" | "focus";

const STALE_CLOCK_TICK_MS = 10_000;

export function useRecoveryQueueProjection<TItem>(
  options: UseRecoveryQueueProjectionOptions<TItem>,
): UseRecoveryQueueProjectionResult<TItem> {
  const {
    loadPage1,
    loadMorePage,
    pollIntervalMs,
    staleAfterMs,
    backoff,
    deps = [],
  } = options;

  const [items, setItems] = useState<TItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<ClassifiedRecoveryError | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [snapshotAt, setSnapshotAt] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());
  // True once the first page-1 load has resolved (success OR failure). This
  // distinguishes "first load still in flight" from "first load resolved with
  // an empty result" — without it a successful empty page would render the
  // full-screen LoadingState forever. Reset on deps change (new filter).
  const [hasResolved, setHasResolved] = useState(false);

  const seqRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const failureRef = useRef(0);
  const hasItemsRef = useRef(false);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nextCursorRef = useRef<string | null>(null);
  nextCursorRef.current = nextCursor;

  const loadPage1Ref = useRef(loadPage1);
  loadPage1Ref.current = loadPage1;
  const loadMorePageRef = useRef(loadMorePage);
  loadMorePageRef.current = loadMorePage;

  const clearPollTimer = useCallback(() => {
    if (pollTimerRef.current !== null) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const runPage1Ref = useRef<(trigger: Page1Trigger) => Promise<void>>(
    async () => {},
  );
  const scheduleNextPoll = useCallback(() => {
    clearPollTimer();
    if (pollIntervalMs === undefined) return;
    if (document.visibilityState !== "visible") return;
    const fails = failureRef.current;
    let delay = pollIntervalMs;
    if (backoff && fails > 0) {
      const exponent = Math.min(fails, 10);
      delay = Math.min(backoff.initialMs * 2 ** exponent, backoff.maxMs);
    }
    pollTimerRef.current = setTimeout(() => {
      if (document.visibilityState !== "visible") return;
      void runPage1Ref.current("poll");
    }, delay);
  }, [pollIntervalMs, backoff, clearPollTimer]);

  const runPage1 = useCallback(
    async (trigger: Page1Trigger) => {
      // loadMore shares the slot: abort it on manual/initial; drop poll/
      // visible/focus if a request is active.
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
      if (hasItemsRef.current || trigger !== "initial") setIsRefreshing(true);
      setIsLoadingMore(false);
      try {
        const result = await loadPage1Ref.current({
          signal: controller.signal,
        });
        if (seq !== seqRef.current || controller.signal.aborted) return;
        hasItemsRef.current = result.items.length > 0;
        setItems(result.items);
        setNextCursor(result.nextCursor);
        setSnapshotAt(result.snapshotAt);
        setError(null);
        setLastUpdatedAt(new Date());
        failureRef.current = 0;
      } catch (err) {
        if (
          err instanceof DOMException &&
          err.name === "AbortError" &&
          (controller.signal.aborted || seq !== seqRef.current)
        ) {
          return;
        }
        if (seq !== seqRef.current) return;
        if (!hasItemsRef.current) setItems([]);
        setError(classifyRecoveryError(err));
        failureRef.current += 1;
      } finally {
        if (controllerRef.current === controller) controllerRef.current = null;
        if (seq === seqRef.current) {
          setIsRefreshing(false);
          setHasResolved(true);
          // Re-arm the cadence from THIS completion (see P1-4): a manual
          // refresh with an unchanged item count, or a failed background
          // refresh, must not stop polling.
          scheduleNextPoll();
        }
      }
    },
    [scheduleNextPoll],
  );
  runPage1Ref.current = runPage1;

  const runLoadMore = useCallback(async () => {
    const cursor = nextCursorRef.current;
    if (!cursor) return;
    // Mutually exclusive with page-1: abort any in-flight request first.
    if (controllerRef.current !== null) {
      controllerRef.current.abort();
    }
    const controller = new AbortController();
    controllerRef.current = controller;
    const seq = ++seqRef.current;
    setIsLoadingMore(true);
    try {
      const result = await loadMorePageRef.current(cursor, {
        signal: controller.signal,
      });
      if (seq !== seqRef.current || controller.signal.aborted) return;
      setItems((prev) => [...prev, ...result.items]);
      setNextCursor(result.nextCursor);
      hasItemsRef.current = true;
      failureRef.current = 0;
    } catch (err) {
      if (
        err instanceof DOMException &&
        err.name === "AbortError" &&
        (controller.signal.aborted || seq !== seqRef.current)
      ) {
        return;
      }
      if (seq !== seqRef.current) return;
      setError(classifyRecoveryError(err));
      failureRef.current += 1;
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
      if (seq === seqRef.current) {
        setIsLoadingMore(false);
        // A poll tick may have been dropped while this append ran — restore
        // the cadence from this completion.
        scheduleNextPoll();
      }
    }
  }, [scheduleNextPoll]);

  const refresh = useCallback(() => {
    clearPollTimer();
    void runPage1("manual");
  }, [runPage1, clearPollTimer]);

  const loadMore = useCallback(() => {
    void runLoadMore();
  }, [runLoadMore]);

  const depsKey = JSON.stringify(deps);
  useEffect(() => {
    // Filter change: reset the WHOLE projection synchronously so the previous
    // filter's rows/cursor/snapshot can never be shown while the new query
    // loads, and the new first load is treated as initial (full-screen).
    controllerRef.current?.abort();
    seqRef.current += 1;
    hasItemsRef.current = false;
    failureRef.current = 0;
    clearPollTimer();
    setItems([]);
    setNextCursor(null);
    setSnapshotAt(null);
    setError(null);
    setLastUpdatedAt(null);
    setIsRefreshing(false);
    setIsLoadingMore(false);
    setHasResolved(false);
    void runPage1("initial");
    return () => {
      if (controllerRef.current) controllerRef.current.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depsKey]);

  // Focus / visibility — immediate page-1 refresh, dropped if a request is
  // active.
  useEffect(() => {
    if (pollIntervalMs === undefined) return;
    const onVisibility = () => {
      if (document.visibilityState === "visible") void runPage1("visible");
    };
    const onFocus = () => void runPage1("focus");
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
    };
  }, [pollIntervalMs, runPage1]);

  // Stale clock — a periodic `now` tick so `isStale` recomputes as wall-clock
  // advances (mirrors the generic detail hook).
  useEffect(() => {
    if (staleAfterMs === undefined) return;
    const id = setInterval(() => setNowTick(Date.now()), STALE_CLOCK_TICK_MS);
    return () => clearInterval(id);
  }, [staleAfterMs]);

  useEffect(() => {
    return () => {
      if (controllerRef.current) controllerRef.current.abort();
    };
  }, []);

  const isInitialLoading = useMemo(
    () => !hasResolved && error === null,
    [hasResolved, error],
  );

  const isStale =
    staleAfterMs !== undefined &&
    snapshotAt !== null &&
    nowTick - new Date(snapshotAt).getTime() > staleAfterMs;

  return {
    items,
    nextCursor,
    error,
    isInitialLoading,
    isRefreshing,
    isLoadingMore,
    snapshotAt,
    lastUpdatedAt,
    isStale,
    refresh,
    loadMore,
  };
}
