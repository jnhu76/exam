import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDataViewTextCommit } from "./useDataViewTextCommit";

/**
 * The text-commit owner's contract (issue 601 Phase F convergence): draft →
 * debounce → commit, blur/Enter flush, immediate clear, and the external-reset
 * rule that keeps a stale term from landing after the host cleared the field.
 */
describe("useDataViewTextCommit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function setup(initial = "", debounceMs = 300) {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    let value = initial;
    const view = renderHook(() =>
      useDataViewTextCommit({
        value,
        onChange: (next: string) => {
          value = next;
          onChange(next);
        },
        onCommit,
        debounceMs,
      }),
    );
    return { view, onChange, onCommit, setValue: (v: string) => (value = v) };
  }

  it("reflects every keystroke immediately but commits only after the debounce", () => {
    const { view, onChange, onCommit } = setup();

    act(() => view.result.current.change("a"));
    act(() => view.result.current.change("ab"));
    expect(onChange.mock.calls.map(([v]) => v)).toEqual(["a", "ab"]);
    expect(onCommit).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(onCommit).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("ab");
  });

  it("flushes a pending commit on blur/Enter and is a no-op when idle", () => {
    const { view, onCommit } = setup();
    act(() => view.result.current.change("exam-9"));

    act(() => view.result.current.flush());
    expect(onCommit).toHaveBeenCalledWith("exam-9");

    // A second blur with nothing pending must not re-fire the query.
    act(() => view.result.current.flush());
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("commits a clear immediately, without waiting for the debounce", () => {
    const { view, onChange, onCommit } = setup("exam-9");
    act(() => view.result.current.clear());
    expect(onChange).toHaveBeenCalledWith("");
    expect(onCommit).toHaveBeenCalledWith("");
  });

  it("cancels a pending commit when the host resets the value externally", () => {
    const { view, onCommit, setValue } = setup();
    act(() => view.result.current.change("stale"));
    // The host clears the field behind the control (clear-all-filters).
    setValue("");
    act(() => view.result.current.change("stale"));
    act(() => view.result.current.clear());
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    // Only the clear's own commit landed; the stale term never did.
    expect(onCommit.mock.calls.map(([v]) => v)).toEqual([""]);
  });

  it("keeps a pending term that the host has not moved (typing to empty commits)", () => {
    const { view, onCommit } = setup("seed");
    act(() => view.result.current.change(""));
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(onCommit).toHaveBeenCalledWith("");
  });

  it("cancels the pending commit on unmount", () => {
    const { view, onCommit } = setup();
    act(() => view.result.current.change("abandoned"));
    view.unmount();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onCommit).not.toHaveBeenCalled();
  });
});
