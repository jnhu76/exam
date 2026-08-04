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
  /** Bounded failure backoff for the automatic poll cadence. */
  backoff?: { initialMs: number; maxMs: number };
  /** Extra deps that, when changed, trigger an abort + page-1 reload. */
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
  /** Manual refresh — aborts any in-flight request and reloads page 1. */
  refresh: () => void;
  /** Appends the next cursor page. Mutually exclusive with refresh(). */
  loadMore: () => void;
}

export function useRecoveryQueueProjection<TItem>(
  options: UseRecoveryQueueProjectionOptions<TItem>,
): UseRecoveryQueueProjectionResult<TItem> {
  const {
    loadPage1,
    loadMorePage,
    pollIntervalMs,
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
  // True once the first page-1 load has resolved (success OR failure). This
  // distinguishes "first load still in flight" from "first load resolved with
  // an empty result" — without it a successful empty page would render the
  // full-screen LoadingState forever.
  const [hasResolved, setHasResolved] = useState(false);

  const seqRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const failureRef = useRef(0);
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

  const runPage1 = useCallback(
    async (trigger: "initial" | "manual" | "poll" | "visible" | "focus") => {
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
      const hasItems = items.length > 0;
      if (hasItems || trigger !== "initial") setIsRefreshing(true);
      setIsLoadingMore(false);
      try {
        const result = await loadPage1Ref.current({
          signal: controller.signal,
        });
        if (seq !== seqRef.current || controller.signal.aborted) return;
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
        setError(classifyRecoveryError(err));
        failureRef.current += 1;
      } finally {
        if (controllerRef.current === controller) controllerRef.current = null;
        if (seq === seqRef.current) {
          setIsRefreshing(false);
          setHasResolved(true);
        }
      }
    },
    [items.length],
  );

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
      if (seq === seqRef.current) setIsLoadingMore(false);
    }
  }, []);

  const refresh = useCallback(() => {
    clearPollTimer();
    void runPage1("manual");
  }, [runPage1, clearPollTimer]);

  const loadMore = useCallback(() => {
    void runLoadMore();
  }, [runLoadMore]);

  const depsKey = JSON.stringify(deps);
  useEffect(() => {
    void runPage1("initial");
    return () => {
      if (controllerRef.current) controllerRef.current.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depsKey]);

  // Recursive-timeout polling with bounded failure backoff.
  useEffect(() => {
    if (pollIntervalMs === undefined) return;
    const scheduleNext = () => {
      clearPollTimer();
      const fails = failureRef.current;
      let delay = pollIntervalMs;
      if (backoff && fails > 0) {
        const exponent = Math.min(fails, 10);
        delay = Math.min(backoff.initialMs * 2 ** exponent, backoff.maxMs);
      }
      pollTimerRef.current = setTimeout(() => {
        if (document.visibilityState === "visible") {
          void runPage1("poll");
        }
        scheduleNext();
      }, delay);
    };
    scheduleNext();
    return clearPollTimer;
  }, [pollIntervalMs, backoff, runPage1, clearPollTimer]);

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

  useEffect(() => {
    return () => {
      if (controllerRef.current) controllerRef.current.abort();
    };
  }, []);

  const isInitialLoading = useMemo(
    () => !hasResolved && error === null,
    [hasResolved, error],
  );

  return {
    items,
    nextCursor,
    error,
    isInitialLoading,
    isRefreshing,
    isLoadingMore,
    snapshotAt,
    lastUpdatedAt,
    refresh,
    loadMore,
  };
}
