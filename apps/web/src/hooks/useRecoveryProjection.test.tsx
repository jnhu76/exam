import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRecoveryProjection } from "./useRecoveryProjection";

interface TestPayload {
  value: string;
  snapshotAt: string;
}

/**
 * A controllable loader: each call returns a promise the test resolves/rejects
 * explicitly, and records the AbortSignal so supersede/abort can be asserted.
 */
function makeControllableLoader() {
  const calls: {
    signal: AbortSignal;
    resolve: (v: TestPayload) => void;
    reject: (e: unknown) => void;
  }[] = [];
  const loader = vi.fn(({ signal }: { signal: AbortSignal }) => {
    return new Promise<TestPayload>((resolve, reject) => {
      calls.push({ signal, resolve, reject });
    });
  });
  return { loader, calls };
}

/**
 * Flushes pending microtasks so the hook's async work settles. With REAL
 * timers, a resolved/rejected controllable-loader promise needs a microtask
 * flush + a waitFor on the hook output.
 */
function flushMicros() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("useRecoveryProjection (promise flow — real timers)", () => {
  it("isInitialLoading is true until the first load resolves, then false", async () => {
    const { loader, calls } = makeControllableLoader();
    const { result } = renderHook(() =>
      useRecoveryProjection<TestPayload>({
        load: loader,
        getSnapshotAt: (d) => d.snapshotAt,
        staleAfterMs: 60_000,
      }),
    );

    // Mount effect fires the initial request.
    await waitFor(() => expect(calls.length).toBe(1));
    expect(result.current.isInitialLoading).toBe(true);
    expect(result.current.data).toBeNull();

    calls[0]!.resolve({ value: "first", snapshotAt: "2025-01-01T00:00:00Z" });
    await flushMicros();

    await waitFor(() => expect(result.current.data?.value).toBe("first"));
    expect(result.current.isInitialLoading).toBe(false);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("manual refresh aborts + supersedes an in-flight request: the old signal is aborted", async () => {
    const { loader, calls } = makeControllableLoader();
    const { result } = renderHook(() =>
      useRecoveryProjection<TestPayload>({
        load: loader,
        getSnapshotAt: (d) => d.snapshotAt,
      }),
    );

    // Initial request is pending (not yet resolved).
    await waitFor(() => expect(calls.length).toBe(1));

    // Manual refresh while the initial request is STILL in flight: it aborts
    // the in-flight controller and starts a new request.
    act(() => {
      result.current.refresh();
    });
    await waitFor(() => expect(calls.length).toBe(2));
    expect(calls[0]!.signal.aborted).toBe(true);

    // The new (owning) request commits; the aborted one cannot.
    calls[1]!.resolve({ value: "second", snapshotAt: "2025-01-02T00:00:00Z" });
    await flushMicros();
    await waitFor(() => expect(result.current.data?.value).toBe("second"));
  });

  it("a background-refresh failure keeps existing data (no full-screen error)", async () => {
    const { loader, calls } = makeControllableLoader();
    const { result } = renderHook(() =>
      useRecoveryProjection<TestPayload>({
        load: loader,
        getSnapshotAt: (d) => d.snapshotAt,
        staleAfterMs: 60_000,
      }),
    );

    await waitFor(() => expect(calls.length).toBe(1));
    calls[0]!.resolve({ value: "first", snapshotAt: "2025-01-01T00:00:00Z" });
    await flushMicros();
    await waitFor(() => expect(result.current.data?.value).toBe("first"));

    act(() => {
      result.current.refresh();
    });
    await waitFor(() => expect(calls.length).toBe(2));
    calls[1]!.reject(new Error("boom"));
    await flushMicros();

    await waitFor(() => expect(result.current.error).not.toBeNull());
    // Data preserved on a background failure.
    expect(result.current.data?.value).toBe("first");
  });
});

describe("useRecoveryProjection (timer flow — fake timers)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("single-flight: a scheduled poll tick while a request is in flight is dropped (P1-3 race)", async () => {
    const { loader, calls } = makeControllableLoader();
    renderHook(() =>
      useRecoveryProjection<TestPayload>({
        load: loader,
        getSnapshotAt: (d) => d.snapshotAt,
        pollIntervalMs: 30_000,
      }),
    );

    // Initial request is pending (mount effect).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(calls.length).toBe(1);

    // Advance into the polling window while the initial request is STILL
    // pending. The scheduled poll tick MUST be dropped (no second request).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(loader).toHaveBeenCalledTimes(1);

    // Initial request resolves — the response commits.
    calls[0]!.resolve({ value: "first", snapshotAt: "2025-01-01T00:00:00Z" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("stale flag is based on the SERVER snapshotAt, not client receive time", async () => {
    const { loader, calls } = makeControllableLoader();
    // System clock starts at T0; the server snapshot is also T0, so the result
    // is fresh at resolve time. Wall-clock then advances past the threshold.
    vi.setSystemTime(new Date("2025-01-01T00:00:00Z"));

    const { result } = renderHook(() =>
      useRecoveryProjection<TestPayload>({
        load: loader,
        getSnapshotAt: (d) => d.snapshotAt,
        staleAfterMs: 60_000,
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    calls[0]!.resolve({ value: "v", snapshotAt: "2025-01-01T00:00:00Z" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    // Fresh right after resolve.
    expect(result.current.isStale).toBe(false);

    // Advance wall-clock well past the staleness threshold. The 10s stale-tick
    // recomputes `now`, so isStale flips true — driven by the SERVER snapshot
    // age (snapshotAt), not the client receive time.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(90_000);
    });
    expect(result.current.isStale).toBe(true);
  });

  it("bounded failure backoff: the NEXT poll is scheduled from THIS completion's failure count", async () => {
    const { loader, calls } = makeControllableLoader();
    renderHook(() =>
      useRecoveryProjection<TestPayload>({
        load: loader,
        getSnapshotAt: (d) => d.snapshotAt,
        pollIntervalMs: 5_000,
        backoff: { initialMs: 5_000, maxMs: 20_000 },
      }),
    );

    // Initial request (mount) fails → the NEXT poll is scheduled at the
    // backed-off delay (1 failure → 5s * 2^1 = 10s), not the base interval.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(calls.length).toBe(1);
    calls[0]!.reject(new Error("boom"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(calls.length).toBe(1);

    // Advance only to the base interval (5s): no second request yet.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(calls.length).toBe(1);

    // Advance to the backed-off mark (10s total): the delayed poll fires.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(calls.length).toBe(2);
    calls[1]!.reject(new Error("boom"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // Two consecutive failures → next delay 5s * 2^2 = 20s (capped at maxMs).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(calls.length).toBe(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(16_000);
    });
    expect(calls.length).toBe(3);
  });

  it("resource switch (deps change) resets the projection: the previous resource is never shown (P1-1)", async () => {
    const { loader, calls } = makeControllableLoader();
    const { result, rerender } = renderHook(
      ({ id }: { id: string }) =>
        useRecoveryProjection<TestPayload>({
          load: loader,
          getSnapshotAt: (d) => d.snapshotAt,
          deps: [id],
        }),
      { initialProps: { id: "A" } },
    );

    // Resource A loads successfully.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    calls[0]!.resolve({ value: "A-data", snapshotAt: "2025-01-01T00:00:00Z" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.data?.value).toBe("A-data");

    // Navigate to resource B (same route component, params change): the
    // projection is reset synchronously — A must NOT stay on screen, and the
    // B load is an initial load (full-screen loading), not a background
    // refresh.
    rerender({ id: "B" });
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.isInitialLoading).toBe(true);
    expect(result.current.isRefreshing).toBe(false);
    expect(calls.length).toBe(2);

    // Only B's response commits.
    calls[1]!.resolve({ value: "B-data", snapshotAt: "2025-01-02T00:00:00Z" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.data?.value).toBe("B-data");
    expect(result.current.isInitialLoading).toBe(false);
  });

  it("a manual refresh with an unchanged result still re-arms polling (P1-4)", async () => {
    const { loader, calls } = makeControllableLoader();
    const { result } = renderHook(() =>
      useRecoveryProjection<TestPayload>({
        load: loader,
        getSnapshotAt: (d) => d.snapshotAt,
        pollIntervalMs: 30_000,
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    calls[0]!.resolve({ value: "v", snapshotAt: "2025-01-01T00:00:00Z" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(loader).toHaveBeenCalledTimes(1);

    // Manual refresh clears the pending timer and runs immediately; it
    // returns the SAME result (data identity unchanged).
    act(() => {
      result.current.refresh();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(loader).toHaveBeenCalledTimes(2);
    calls[1]!.resolve({ value: "v", snapshotAt: "2025-01-01T00:00:00Z" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // The manual completion must have re-armed the cadence: the poll fires
    // one interval later even though `data` never changed identity.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(loader).toHaveBeenCalledTimes(3);
  });

  it("a FAILED manual refresh keeps data and still re-arms polling with backoff (P1-4)", async () => {
    const { loader, calls } = makeControllableLoader();
    const { result } = renderHook(() =>
      useRecoveryProjection<TestPayload>({
        load: loader,
        getSnapshotAt: (d) => d.snapshotAt,
        pollIntervalMs: 5_000,
        backoff: { initialMs: 5_000, maxMs: 20_000 },
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    calls[0]!.resolve({ value: "v", snapshotAt: "2025-01-01T00:00:00Z" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    act(() => {
      result.current.refresh();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(loader).toHaveBeenCalledTimes(2);
    calls[1]!.reject(new Error("boom"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // Old data preserved + error recorded (background failure).
    expect(result.current.data?.value).toBe("v");
    expect(result.current.error).not.toBeNull();

    // The failed manual completion re-armed the cadence at the BACKED-OFF
    // delay (1 failure → 10s): nothing at 5s, poll fires at 10s.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(loader).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(loader).toHaveBeenCalledTimes(3);
  });
});
