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
    await vi.advanceTimersByTimeAsync(0);
    expect(calls.length).toBe(1);

    // Advance into the polling window while the initial request is STILL
    // pending. The scheduled poll tick MUST be dropped (no second request).
    await vi.advanceTimersByTimeAsync(30_000);
    expect(loader).toHaveBeenCalledTimes(1);

    // Initial request resolves — the response commits.
    calls[0]!.resolve({ value: "first", snapshotAt: "2025-01-01T00:00:00Z" });
    await vi.advanceTimersByTimeAsync(0);
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

    await vi.advanceTimersByTimeAsync(0);
    calls[0]!.resolve({ value: "v", snapshotAt: "2025-01-01T00:00:00Z" });
    await vi.advanceTimersByTimeAsync(0);
    // Fresh right after resolve.
    expect(result.current.isStale).toBe(false);

    // Advance wall-clock well past the staleness threshold. The 10s stale-tick
    // recomputes `now`, so isStale flips true — driven by the SERVER snapshot
    // age (snapshotAt), not the client receive time.
    await vi.advanceTimersByTimeAsync(90_000);
    expect(result.current.isStale).toBe(true);
  });

  it("bounded failure backoff: a failure delays the next poll beyond the base interval", async () => {
    const { loader, calls } = makeControllableLoader();
    renderHook(() =>
      useRecoveryProjection<TestPayload>({
        load: loader,
        getSnapshotAt: (d) => d.snapshotAt,
        pollIntervalMs: 5_000,
        backoff: { initialMs: 5_000, maxMs: 20_000 },
      }),
    );

    // Initial request (mount) fails.
    await vi.advanceTimersByTimeAsync(0);
    expect(calls.length).toBe(1);
    calls[0]!.reject(new Error("boom"));
    await vi.advanceTimersByTimeAsync(0);
    // failureRef is now 1.

    // The first scheduled poll fires at the BASE interval (5s): it was
    // scheduled at mount (fails=0). It also fails, bumping failureRef to 2.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(calls.length).toBe(2);
    calls[1]!.reject(new Error("boom"));
    await vi.advanceTimersByTimeAsync(0);

    // The NEXT poll is scheduled at the BACKED-OFF delay (fails=2 →
    // 5s * 2^2 = 20s, capped at maxMs=20s). Advance only to 5s past the last
    // poll and confirm no third request fires yet.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(calls.length).toBe(2);

    // Advance to the backed-off mark; the delayed poll fires.
    await vi.advanceTimersByTimeAsync(16_000);
    expect(calls.length).toBe(3);
  });
});
