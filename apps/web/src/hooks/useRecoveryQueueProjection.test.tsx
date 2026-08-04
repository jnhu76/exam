import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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
  const page1Calls: { resolve: (v: QueuePageResult<Item>) => void }[] = [];
  const moreCalls: { resolve: (v: QueuePageResult<Item>) => void }[] = [];
  const loadPage1 = vi.fn(() => {
    return new Promise<QueuePageResult<Item>>((resolve) => {
      page1Calls.push({ resolve });
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
