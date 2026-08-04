import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useRecoveryQueueProjection,
  type QueuePageResult,
} from "./useRecoveryQueueProjection";

interface Item {
  id: string;
}

function page(items: Item[], nextCursor: string | null): QueuePageResult<Item> {
  return { items, nextCursor, snapshotAt: "2025-01-01T00:00:00Z" };
}

/**
 * Controllable loaders so tests resolve/reject each call explicitly and can
 * assert the shared single-flight slot (page-1 vs loadMore).
 */
function makeLoaders() {
  const page1Calls: {
    resolve: (v: QueuePageResult<Item>) => void;
    reject: (e: unknown) => void;
  }[] = [];
  const moreCalls: { resolve: (v: QueuePageResult<Item>) => void }[] = [];
  const loadPage1 = vi.fn(() => {
    return new Promise<QueuePageResult<Item>>((resolve, reject) => {
      page1Calls.push({ resolve, reject });
    });
  });
  const loadMorePage = vi.fn(() => {
    return new Promise<QueuePageResult<Item>>((resolve) => {
      moreCalls.push({ resolve });
    });
  });
  return { loadPage1, loadMorePage, page1Calls, moreCalls };
}

function flushMicros() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("useRecoveryQueueProjection", () => {
  it("page-1 refresh aborts an in-flight loadMore (shared single-flight slot)", async () => {
    const { loadPage1, loadMorePage, page1Calls, moreCalls } = makeLoaders();
    const { result } = renderHook(() =>
      useRecoveryQueueProjection<Item>({
        loadPage1,
        loadMorePage,
        pollIntervalMs: undefined,
      }),
    );

    // Resolve the initial page-1 (one item + a cursor so loadMore is enabled).
    await waitFor(() => expect(page1Calls.length).toBe(1));
    page1Calls[0]!.resolve(page([{ id: "a" }], "cursor-1"));
    await flushMicros();
    await waitFor(() => expect(result.current.items.length).toBe(1));
    expect(result.current.nextCursor).toBe("cursor-1");

    // Start loadMore (appends the next page). It is now in flight.
    act(() => {
      result.current.loadMore();
    });
    await waitFor(() => expect(moreCalls.length).toBe(1));

    // A page-1 refresh while loadMore is in flight MUST abort it (shared slot).
    act(() => {
      result.current.refresh();
    });
    await waitFor(() => expect(page1Calls.length).toBe(2));

    // The aborted loadMore must NOT commit even if it resolves late. Resolve
    // the page-1 refresh first and confirm it wins.
    page1Calls[1]!.resolve(page([{ id: "refreshed" }], null));
    await flushMicros();
    await waitFor(() =>
      expect(result.current.items.map((i) => i.id)).toEqual(["refreshed"]),
    );

    // Now resolve the orphaned loadMore — it must not append (it was aborted).
    moreCalls[0]!.resolve(page([{ id: "appended-late" }], null));
    await flushMicros();
    expect(result.current.items.map((i) => i.id)).toEqual(["refreshed"]);
  });

  it("isInitialLoading is true only before the first page-1 resolves, then false even for an empty result", async () => {
    const { loadPage1, loadMorePage, page1Calls } = makeLoaders();
    const { result } = renderHook(() =>
      useRecoveryQueueProjection<Item>({
        loadPage1,
        loadMorePage,
        pollIntervalMs: undefined,
      }),
    );

    await waitFor(() => expect(page1Calls.length).toBe(1));
    expect(result.current.isInitialLoading).toBe(true);

    // A successful EMPTY page must clear isInitialLoading (not show Loading).
    page1Calls[0]!.resolve(page([], null));
    await flushMicros();
    await waitFor(() => expect(result.current.isInitialLoading).toBe(false));
    expect(result.current.items).toEqual([]);
  });

  it("loadMore appends the cursor page and advances the cursor", async () => {
    const { loadPage1, loadMorePage, page1Calls, moreCalls } = makeLoaders();
    const { result } = renderHook(() =>
      useRecoveryQueueProjection<Item>({
        loadPage1,
        loadMorePage,
        pollIntervalMs: undefined,
      }),
    );

    await waitFor(() => expect(page1Calls.length).toBe(1));
    page1Calls[0]!.resolve(page([{ id: "a" }, { id: "b" }], "cursor-1"));
    await flushMicros();
    await waitFor(() => expect(result.current.items.length).toBe(2));

    act(() => {
      result.current.loadMore();
    });
    await waitFor(() => expect(moreCalls.length).toBe(1));
    moreCalls[0]!.resolve(page([{ id: "c" }], null));
    await flushMicros();
    await waitFor(() =>
      expect(result.current.items.map((i) => i.id)).toEqual(["a", "b", "c"]),
    );
    expect(result.current.nextCursor).toBeNull();
  });

  it("carries the server snapshotAt from the latest page-1 result", async () => {
    const { loadPage1, loadMorePage, page1Calls } = makeLoaders();
    const { result } = renderHook(() =>
      useRecoveryQueueProjection<Item>({
        loadPage1,
        loadMorePage,
        pollIntervalMs: undefined,
      }),
    );

    await waitFor(() => expect(page1Calls.length).toBe(1));
    page1Calls[0]!.resolve({
      items: [{ id: "a" }],
      nextCursor: null,
      snapshotAt: "2025-06-01T12:00:00Z",
    });
    await flushMicros();
    await waitFor(() =>
      expect(result.current.snapshotAt).toBe("2025-06-01T12:00:00Z"),
    );
  });
});

describe("useRecoveryQueueProjection (timer flow — fake timers)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("stale flag is based on the SERVER snapshotAt and self-updates (P1-3)", async () => {
    const { loadPage1, loadMorePage, page1Calls } = makeLoaders();
    // System clock starts at T0; the server snapshot is also T0, so the queue
    // is fresh at resolve time. Wall-clock then advances past the threshold.
    vi.setSystemTime(new Date("2025-01-01T00:00:00Z"));

    const { result } = renderHook(() =>
      useRecoveryQueueProjection<Item>({
        loadPage1,
        loadMorePage,
        pollIntervalMs: undefined,
        staleAfterMs: 60_000,
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    page1Calls[0]!.resolve(page([{ id: "a" }], null));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.isStale).toBe(false);

    // Advance wall-clock well past the staleness threshold; the 10s stale
    // tick recomputes `now` so isStale flips — driven by the SERVER snapshot
    // age (snapshotAt), not the client receive time.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(90_000);
    });
    expect(result.current.isStale).toBe(true);
  });

  it("filter change (deps) resets the projection: the previous filter's rows are never shown (P1-1)", async () => {
    const { loadPage1, loadMorePage, page1Calls } = makeLoaders();
    const { result, rerender } = renderHook(
      ({ q }: { q: string }) =>
        useRecoveryQueueProjection<Item>({
          loadPage1,
          loadMorePage,
          pollIntervalMs: undefined,
          deps: [q],
        }),
      { initialProps: { q: "exam=A" } },
    );

    // Filter A loads one row.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    page1Calls[0]!.resolve(page([{ id: "a" }], null));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.items.map((i) => i.id)).toEqual(["a"]);

    // Filter changes: rows/cursor/snapshot reset synchronously; the new load
    // is initial (full-screen loading), not a background refresh.
    rerender({ q: "exam=B" });
    expect(result.current.items).toEqual([]);
    expect(result.current.snapshotAt).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.isInitialLoading).toBe(true);
    expect(result.current.isRefreshing).toBe(false);
    expect(page1Calls.length).toBe(2);

    // Only B's response commits.
    page1Calls[1]!.resolve(page([{ id: "b" }], null));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.items.map((i) => i.id)).toEqual(["b"]);
    expect(result.current.isInitialLoading).toBe(false);
  });

  it("a manual refresh returning the SAME item count still re-arms polling (P1-4)", async () => {
    const { loadPage1, loadMorePage, page1Calls } = makeLoaders();
    const { result } = renderHook(() =>
      useRecoveryQueueProjection<Item>({
        loadPage1,
        loadMorePage,
        pollIntervalMs: 30_000,
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    page1Calls[0]!.resolve(page([{ id: "a" }], null));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.items.length).toBe(1);

    // Manual refresh clears the timer, runs immediately, returns the SAME
    // item count (items identity unchanged).
    act(() => {
      result.current.refresh();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(page1Calls.length).toBe(2);
    page1Calls[1]!.resolve(page([{ id: "a" }], null));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.items.length).toBe(1);

    // The manual completion re-armed the cadence: the poll fires one interval
    // later even though the item count never changed.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(loadPage1).toHaveBeenCalledTimes(3);
  });

  it("a FAILED manual refresh keeps items and still re-arms polling with backoff (P1-4)", async () => {
    const { loadPage1, loadMorePage, page1Calls } = makeLoaders();
    const { result } = renderHook(() =>
      useRecoveryQueueProjection<Item>({
        loadPage1,
        loadMorePage,
        pollIntervalMs: 5_000,
        backoff: { initialMs: 5_000, maxMs: 20_000 },
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    page1Calls[0]!.resolve(page([{ id: "a" }], null));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    act(() => {
      result.current.refresh();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(page1Calls.length).toBe(2);
    page1Calls[1]!.reject(new Error("boom"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // Old items preserved + error recorded (background failure).
    expect(result.current.items.map((i) => i.id)).toEqual(["a"]);
    expect(result.current.error).not.toBeNull();

    // The failed manual completion re-armed the cadence at the BACKED-OFF
    // delay (1 failure → 10s): nothing at 5s, poll fires at 10s.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(loadPage1).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(loadPage1).toHaveBeenCalledTimes(3);
  });
});
