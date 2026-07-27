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
    const { result } = renderHook(() => useSubmitFlush("att-1"));

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
    const { result } = renderHook(() => useSubmitFlush("att-1"));

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
    const { result } = renderHook(() => useSubmitFlush("att-1"));

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
    const { result } = renderHook(() => useSubmitFlush("att-1"));

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
    const { result } = renderHook(() => useSubmitFlush("att-1"));

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
    const { result } = renderHook(() => useSubmitFlush("att-1"));

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

    const { result } = renderHook(() => useSubmitFlush("att-1"));

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
    const { result, unmount } = renderHook(() => useSubmitFlush("att-1"));

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
    const { result } = renderHook(() => useSubmitFlush("att-1"));

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
            hook = useSubmitFlush("att-1");
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
    const { result } = renderHook(() => useSubmitFlush("att-1"));

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
    const { result } = renderHook(() => useSubmitFlush("att-1"));

    act(() => {
      result.current.scheduleSave("q1", save);
    });

    await act(async () => {
      await result.current.flush();
    });

    expect(vi.getTimerCount()).toBe(0);
  });

  // ====== Scope isolation: cross-attempt save queue ======

  it("scope change cancels pending saves of the previous scope", async () => {
    const saveA = vi.fn().mockResolvedValue(undefined);
    const { result, rerender } = renderHook(
      ({ scope }: { scope: string }) => useSubmitFlush(scope),
      { initialProps: { scope: "att-old" } },
    );

    act(() => {
      result.current.scheduleSave("q1", saveA);
    });
    // q1 is pending under att-old (debounce timer armed, not yet fired).
    expect(result.current.getQuestionStatus("q1")).toBe("pending");
    expect(saveA).not.toHaveBeenCalled();

    // Switch scope to att-new. The layout effect cancels att-old's pending
    // timer and installs a fresh, empty scope.
    rerender({ scope: "att-new" });

    // Advance PAST the debounce window. saveA must NOT fire — its timer was
    // cleared, and even if it had fired it would only touch the old scope.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(saveA).not.toHaveBeenCalled();

    // The new scope starts clean: q1 is unknown (idle), not inherited.
    expect(result.current.getQuestionStatus("q1")).toBe("idle");
  });

  it("scope change isolates inflight saves — same questionId does not queue behind the old scope", async () => {
    // Both scopes use questionId "q-shared". The critical race: att-old's
    // q-shared save is inflight and pending; att-new's q-shared save must
    // fire IMMEDIATELY (not serialized behind att-old) and att-old's late
    // resolution must not mark att-new's q-shared as saved/failed.
    let resolveOld!: () => void;
    let resolveNew!: () => void;
    const saveOld = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveOld = resolve;
        }),
    );
    // saveNew is ALSO deferred: its inflight status must be observable both
    // before and after att-old's stale save resolves, so the test can prove
    // att-old's late settle does not flip att-new's status. If saveNew
    // resolved immediately, the status would already be "saved" before
    // resolveOld ran and the isolation assertion would prove nothing.
    const saveNew = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveNew = resolve;
        }),
    );

    const { result, rerender } = renderHook(
      ({ scope }: { scope: string }) => useSubmitFlush(scope),
      { initialProps: { scope: "att-old" } },
    );

    act(() => {
      result.current.scheduleSave("q-shared", saveOld);
    });
    // Fire the debounce so saveOld is inflight (pending on resolveOld).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(saveOld).toHaveBeenCalledTimes(1);
    expect(result.current.getQuestionStatus("q-shared")).toBe("inflight");

    // Switch scope to att-new and schedule its q-shared save.
    rerender({ scope: "att-new" });
    act(() => {
      result.current.scheduleSave("q-shared", saveNew);
    });

    // KEY: att-new's q-shared fires without waiting for att-old's inflight
    // save to settle. If the scopes shared one inflight map, att-new would
    // queue behind att-old and saveNew would not yet have run here.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(saveNew).toHaveBeenCalledTimes(1);
    // att-new's save is inflight (pending on resolveNew).
    expect(result.current.getQuestionStatus("q-shared")).toBe("inflight");

    // Now resolve att-old's stale inflight save. It must NOT overwrite
    // att-new's status for q-shared (would otherwise flip it). att-new's
    // status stays "inflight" — att-old's settle wrote only to att-old's
    // (now-unreachable) scope.
    await act(async () => {
      resolveOld();
      await Promise.resolve();
    });
    expect(result.current.getQuestionStatus("q-shared")).toBe("inflight");

    // Resolve att-new's own save; now its status becomes "saved".
    await act(async () => {
      resolveNew();
      await Promise.resolve();
    });
    expect(result.current.getQuestionStatus("q-shared")).toBe("saved");
  });

  it("an old-scope flush does not consume, await, or count the new scope's work", async () => {
    // att-old starts a flush that is awaiting its inflight save. While it
    // waits, the scope switches to att-new and att-new schedules a save.
    // att-old's flush must NOT drain/await/count att-new's save — it only
    // ever sees its own (captured) scope.
    let resolveOld!: () => void;
    const saveOld = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveOld = resolve;
        }),
    );
    const saveNew = vi.fn().mockResolvedValue(undefined);

    const { result, rerender } = renderHook(
      ({ scope }: { scope: string }) => useSubmitFlush(scope),
      { initialProps: { scope: "att-old" } },
    );

    act(() => {
      result.current.scheduleSave("q1", saveOld);
    });
    let flushPromise!: ReturnType<typeof result.current.flush>;
    act(() => {
      flushPromise = result.current.flush();
    });
    // Flush has drained q1 (saveOld now inflight, awaiting resolveOld).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(saveOld).toHaveBeenCalledTimes(1);

    // Switch scope and schedule a NEW save under att-new while att-old's
    // flush is still awaiting.
    rerender({ scope: "att-new" });
    act(() => {
      result.current.scheduleSave("q2", saveNew);
    });

    // Resolve att-old's inflight save so its flush can complete.
    let flushResult!: Awaited<ReturnType<typeof result.current.flush>>;
    await act(async () => {
      resolveOld();
      flushResult = await flushPromise;
    });

    // att-old's flush saw ONLY att-old's q1 — it never drained att-new's q2.
    // saveNew has not been force-fired by the old flush (it is still pending
    // under att-new's own debounce timer, untouched).
    expect(saveNew).not.toHaveBeenCalled();
    // And the old flush's result reflects only att-old's work (q1 saved).
    expect(flushResult.failedQuestionIds).toEqual([]);
    expect(flushResult.pendingCount).toBe(0);

    // Let att-new's pending timer settle so the test tears down cleanly.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(saveNew).toHaveBeenCalledTimes(1);
  });
});
