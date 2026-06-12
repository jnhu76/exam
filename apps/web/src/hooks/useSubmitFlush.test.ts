import { act, renderHook } from "@testing-library/react";
import { createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSubmitFlush, type UseSubmitFlush } from "./useSubmitFlush";

describe("useSubmitFlush", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("flush() forces a pending debounced save to fire BEFORE the debounce window elapses", async () => {
    const callOrder: string[] = [];
    const save = vi.fn().mockImplementation(async () => {
      callOrder.push("save");
    });
    const { result } = renderHook(() => useSubmitFlush());

    act(() => {
      result.current.scheduleSave("q1", save);
    });

    callOrder.push("before-flush");
    expect(save).not.toHaveBeenCalled();

    let flushPromise!: Promise<unknown>;
    act(() => {
      flushPromise = result.current.flush();
    });
    callOrder.push("flush-returned");

    await act(async () => {
      await flushPromise;
    });
    callOrder.push("flush-resolved");

    expect(save).toHaveBeenCalledTimes(1);
    // save() is invoked synchronously inside flush() before flush() returns its Promise.
    expect(callOrder).toEqual([
      "before-flush",
      "save",
      "flush-returned",
      "flush-resolved",
    ]);
  });

  it("flush() returns three independent buckets when all saves succeed", async () => {
    const saveA = vi.fn().mockResolvedValue(undefined);
    const saveB = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useSubmitFlush());

    act(() => {
      result.current.scheduleSave("q1", saveA);
      result.current.scheduleSave("q2", saveB);
    });

    let flushResult!: Awaited<ReturnType<typeof result.current.flush>>;
    await act(async () => {
      flushResult = await result.current.flush();
    });

    expect(flushResult).toEqual({
      pendingCount: 0,
      failedQuestionIds: [],
      timedOut: false,
    });
  });

  it("flush() reports failed question ids separately from pendingCount", async () => {
    const saveOk = vi.fn().mockResolvedValue(undefined);
    const saveFail = vi.fn().mockRejectedValue(new Error("network"));
    const { result } = renderHook(() => useSubmitFlush());

    act(() => {
      result.current.scheduleSave("q1", saveOk);
      result.current.scheduleSave("q2", saveFail);
    });

    let flushResult!: Awaited<ReturnType<typeof result.current.flush>>;
    await act(async () => {
      flushResult = await result.current.flush();
    });

    expect(flushResult.failedQuestionIds).toEqual(["q2"]);
    expect(flushResult.pendingCount).toBe(0);
    expect(flushResult.timedOut).toBe(false);
  });

  it("flush() times out at 10s, marks unfinished saves as pendingCount, not failed", async () => {
    const slowSave = vi.fn(
      () => new Promise<void>((resolve) => setTimeout(resolve, 30_000)),
    );
    const { result } = renderHook(() => useSubmitFlush());

    act(() => {
      result.current.scheduleSave("q1", slowSave);
    });

    let flushPromise!: Promise<
      Awaited<ReturnType<typeof result.current.flush>>
    >;
    act(() => {
      flushPromise = result.current.flush();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    const flushResult = await flushPromise;
    expect(flushResult.timedOut).toBe(true);
    expect(flushResult.pendingCount).toBe(1);
    expect(flushResult.failedQuestionIds).toEqual([]);
  });

  it("scheduleSave debounces rapid changes to the same question", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useSubmitFlush());

    act(() => {
      result.current.scheduleSave("q1", save);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    act(() => {
      result.current.scheduleSave("q1", save);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(save).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(save).toHaveBeenCalledTimes(1);
  });

  it("getQuestionStatus reflects pending → inflight → saved transitions", async () => {
    let resolveSave!: () => void;
    const save = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSave = resolve;
        }),
    );
    const { result } = renderHook(() => useSubmitFlush());

    act(() => {
      result.current.scheduleSave("q1", save);
    });
    expect(result.current.getQuestionStatus("q1")).toBe("pending");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(result.current.getQuestionStatus("q1")).toBe("inflight");

    await act(async () => {
      resolveSave();
      await Promise.resolve();
    });
    expect(result.current.getQuestionStatus("q1")).toBe("saved");
  });

  // ====== Reviewer C1 (Critical) ======
  it("flush() drains scheduleSave calls made WHILE flush is awaiting in-flight saves", async () => {
    let resolveFirst!: () => void;
    const firstSave = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveFirst = resolve;
        }),
    );
    const lateSave = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() => useSubmitFlush());

    act(() => {
      result.current.scheduleSave("q1", firstSave);
    });

    let flushPromise!: Promise<
      Awaited<ReturnType<typeof result.current.flush>>
    >;
    act(() => {
      flushPromise = result.current.flush();
    });

    // Flush has snapshotted q1 as inflight. Now schedule q2 while flush awaits.
    act(() => {
      result.current.scheduleSave("q2", lateSave);
    });

    // Resolve q1 so the first inflight settles, but q2's debounce timer hasn't fired yet.
    await act(async () => {
      resolveFirst();
      await Promise.resolve();
    });

    // Advance enough to let q2's debounce + its save() resolve.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    const flushResult = await flushPromise;

    expect(lateSave).toHaveBeenCalledTimes(1);
    expect(flushResult.pendingCount).toBe(0);
    expect(flushResult.failedQuestionIds).toEqual([]);
  });

  // ====== Reviewer C2 (Critical) ======
  it("on unmount, pending debounced timers do NOT fire save()", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result, unmount } = renderHook(() => useSubmitFlush());

    act(() => {
      result.current.scheduleSave("q1", save);
    });

    unmount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(save).not.toHaveBeenCalled();
  });

  // ====== Reviewer I2: ordering-strict assertion (already covered above by callOrder; this is a complement) ======
  it("flush() does not return until every forced save has settled", async () => {
    const settledOrder: string[] = [];
    let resolveSave!: () => void;
    const save = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSave = () => {
            settledOrder.push("save-settled");
            resolve();
          };
        }),
    );
    const { result } = renderHook(() => useSubmitFlush());

    act(() => {
      result.current.scheduleSave("q1", save);
    });

    let flushPromise!: Promise<unknown>;
    act(() => {
      flushPromise = result.current.flush();
    });

    void flushPromise.then(() => settledOrder.push("flush-settled"));

    // Force the pending timer to fire, but save is still inflight.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(settledOrder).toEqual([]);

    await act(async () => {
      resolveSave();
      await flushPromise;
    });

    expect(settledOrder).toEqual(["save-settled", "flush-settled"]);
  });

  it("continues saving after the StrictMode setup-cleanup-setup cycle", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const container = document.createElement("div");
    const root = createRoot(container);
    let hook: UseSubmitFlush | undefined;

    act(() => {
      root.render(
        createElement(
          StrictMode,
          null,
          createElement(() => {
            hook = useSubmitFlush();
            return null;
          }),
        ),
      );
    });

    act(() => {
      hook?.scheduleSave("q1", save);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });

    expect(save).toHaveBeenCalledTimes(1);
    expect(hook?.getQuestionStatus("q1")).toBe("saved");

    act(() => {
      root.unmount();
    });
  });

  it("serializes saves for the same question", async () => {
    let resolveFirst!: () => void;
    let resolveSecond!: () => void;
    const firstSave = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveFirst = resolve;
        }),
    );
    const secondSave = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSecond = resolve;
        }),
    );
    const { result } = renderHook(() => useSubmitFlush());

    act(() => {
      result.current.scheduleSave("q1", firstSave);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });

    act(() => {
      result.current.scheduleSave("q1", secondSave);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });

    expect(firstSave).toHaveBeenCalledTimes(1);
    expect(secondSave).not.toHaveBeenCalled();

    let flushPromise!: Promise<
      Awaited<ReturnType<typeof result.current.flush>>
    >;
    act(() => {
      flushPromise = result.current.flush();
    });

    await act(async () => {
      resolveFirst();
      await Promise.resolve();
    });
    expect(secondSave).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveSecond();
      await flushPromise;
    });

    await expect(flushPromise).resolves.toEqual({
      pendingCount: 0,
      failedQuestionIds: [],
      timedOut: false,
    });
  });

  it("clears the flush timeout when saves settle first", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useSubmitFlush());

    act(() => {
      result.current.scheduleSave("q1", save);
    });

    await act(async () => {
      await result.current.flush();
    });

    expect(vi.getTimerCount()).toBe(0);
  });
});
