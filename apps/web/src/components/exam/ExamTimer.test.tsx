import { act, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExamTimer } from "./ExamTimer";

/**
 * Countdown display vs deadline-action separation (R-02, #961).
 *
 * The displayed MM:SS floors the remaining time, so a tick landing inside the
 * last second (D−999ms … D−1ms) legitimately shows 00:00. That display value
 * is a UI representation ONLY: onTimeout must fire from the UNROUNDED
 * server-adjusted time difference (adjustedNow >= deadlineAt), exactly once
 * per deadlineAt value, across interval delays, clock jumps, server-offset
 * updates, deadline changes, callback identity changes, and StrictMode
 * double-mounts. All expiry decisions here are arbitration-grade deterministic
 * fake-clock transitions — no sleeps, no retry loops.
 */

const T0 = new Date("2026-07-04T10:00:00.000Z");

/** ISO deadline at `offsetMs` after the fake-clock epoch T0. */
function deadlineAt(offsetMs: number): string {
  return new Date(T0.getTime() + offsetMs).toISOString();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
});

function renderTimer(
  deadline: string,
  onTimeout = vi.fn(),
  serverOffsetMs = 0,
) {
  render(
    <ExamTimer
      deadlineAt={deadline}
      onTimeout={onTimeout}
      serverOffsetMs={serverOffsetMs}
    />,
  );
  return onTimeout;
}

describe("display rounding never triggers the deadline action", () => {
  it("D−1000ms: alive; the tick landing exactly one second before the deadline does not fire", async () => {
    const onTimeout = renderTimer(deadlineAt(2_000));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000); // tick at D−1000ms
    });
    expect(onTimeout).not.toHaveBeenCalled();
    expect(screen.getByText("00:01")).toBeInTheDocument();
  });

  it("D−500ms: shows 00:00 (floor display) but does NOT fire — the R-02 defect", async () => {
    const onTimeout = renderTimer(deadlineAt(1_500));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000); // interval tick lands at D−500ms
    });
    // The floor display legitimately reads 00:00 with 500ms left…
    expect(screen.getByText("00:00")).toBeInTheDocument();
    // …but a display rounding must never auto-submit the attempt.
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("D−1ms: still not expired — only the unrounded difference decides", async () => {
    const onTimeout = renderTimer(deadlineAt(1_500));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_499); // last tick inside D−1ms
    });
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("D: the strict deadline comparison fires exactly at the boundary", async () => {
    const onTimeout = renderTimer(deadlineAt(2_000));

    // The 1s interval is phase-locked at mount, so a tick lands on D only
    // when D is a whole number of seconds away.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_999);
    });
    expect(onTimeout).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1); // now == deadline
    });
    expect(onTimeout).toHaveBeenCalledExactlyOnceWith();
  });

  it("D+1ms: expired on the first tick past the deadline", async () => {
    const onTimeout = renderTimer(deadlineAt(1_000));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_001);
    });
    expect(onTimeout).toHaveBeenCalledExactlyOnceWith();
  });
});

describe("interval delay, piled-up ticks, and background restore", () => {
  it("a long throttled gap (background tab) fires exactly once on the first tick past the deadline", async () => {
    const onTimeout = renderTimer(deadlineAt(1_500));

    // One 60s jump models a throttled background interval: the first tick
    // that runs is already far past the deadline.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(onTimeout).toHaveBeenCalledExactlyOnceWith();
    expect(screen.getByText("00:00")).toBeInTheDocument();
  });

  it("ticks that run after expiry never re-fire the same deadline", async () => {
    const onTimeout = renderTimer(deadlineAt(1_000));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(onTimeout).toHaveBeenCalledExactlyOnceWith();
  });
});

describe("server clock offset updates", () => {
  it("a positive server offset (server ahead) expires immediately on re-bind", async () => {
    const onTimeout = vi.fn();
    const { rerender } = render(
      <ExamTimer deadlineAt={deadlineAt(5_000)} onTimeout={onTimeout} />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000); // local D−4000ms: alive
    });
    expect(onTimeout).not.toHaveBeenCalled();

    // applySnapshot re-basing pushes the server-adjusted clock past D; the
    // re-bound effect must re-evaluate expiry immediately, not after 1s.
    await act(async () => {
      rerender(
        <ExamTimer
          deadlineAt={deadlineAt(5_000)}
          onTimeout={onTimeout}
          serverOffsetMs={5_500}
        />,
      );
    });
    expect(onTimeout).toHaveBeenCalledExactlyOnceWith();
  });

  it("a negative server offset (server behind) keeps the timer alive", async () => {
    const onTimeout = renderTimer(deadlineAt(500), vi.fn(), -1_000);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000); // local past D, server-adjusted D+500ms
    });
    expect(onTimeout).not.toHaveBeenCalled();
    expect(screen.getByText("00:00")).toBeInTheDocument(); // 500ms floored
  });
});

describe("wall-clock anomalies", () => {
  it("a forward clock jump past the deadline fires on the next tick, exactly once", async () => {
    const onTimeout = renderTimer(deadlineAt(3_000));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(onTimeout).not.toHaveBeenCalled();

    // NTP correction / wall-clock jump far past the deadline.
    await act(async () => {
      vi.setSystemTime(new Date(T0.getTime() + 35_000));
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(onTimeout).toHaveBeenCalledExactlyOnceWith();
  });

  it("a backward clock jump re-arms the display without firing", async () => {
    const onTimeout = renderTimer(deadlineAt(5_000));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_400); // alive at D−3600ms
    });
    expect(onTimeout).not.toHaveBeenCalled();

    // Clock corrected backwards to T0: the displayed remainder grows again…
    await act(async () => {
      vi.setSystemTime(T0);
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(onTimeout).not.toHaveBeenCalled();
    expect(screen.getByText("00:04")).toBeInTheDocument();

    // …and the (still pending) deadline fires once the corrected clock has
    // passed it (the interval schedule itself is not re-phased by a clock
    // correction, so a full second-granularity window is advanced).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(onTimeout).toHaveBeenCalledExactlyOnceWith();
  });
});

describe("deadline and callback changes", () => {
  it("a deadline extension re-arms: the old deadline no longer fires, the new one does", async () => {
    const onTimeout = vi.fn();
    const { rerender } = render(
      <ExamTimer deadlineAt={deadlineAt(1_000)} onTimeout={onTimeout} />,
    );

    await act(async () => {
      rerender(
        <ExamTimer deadlineAt={deadlineAt(5_000)} onTimeout={onTimeout} />,
      );
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000); // past the ORIGINAL deadline
    });
    expect(onTimeout).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000); // new deadline reached
    });
    expect(onTimeout).toHaveBeenCalledExactlyOnceWith();
  });

  it("a shortened deadline that is already past fires for that deadline value", async () => {
    const onTimeout = vi.fn();
    const { rerender } = render(
      <ExamTimer deadlineAt={deadlineAt(30_000)} onTimeout={onTimeout} />,
    );

    await act(async () => {
      rerender(
        <ExamTimer deadlineAt={deadlineAt(500)} onTimeout={onTimeout} />,
      );
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(onTimeout).toHaveBeenCalledExactlyOnceWith();
  });

  it("an onTimeout identity change after expiry does not re-fire the same deadline", async () => {
    const first = vi.fn();
    const { rerender } = render(
      <ExamTimer deadlineAt={deadlineAt(1_000)} onTimeout={first} />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(first).toHaveBeenCalledExactlyOnceWith();

    // Parent rerender hands the same deadline a NEW callback identity
    // (unstable useCallback deps). The re-bind flushes in its own act so the
    // re-bound effect's ticks are deterministic; the already-reported
    // deadline stays reported — no duplicate episode from either the
    // re-bound effect's immediate check or its later ticks.
    const second = vi.fn();
    await act(async () => {
      rerender(<ExamTimer deadlineAt={deadlineAt(1_000)} onTimeout={second} />);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(first).toHaveBeenCalledExactlyOnceWith();
    expect(second).not.toHaveBeenCalled();
  });
});

describe("StrictMode / remount", () => {
  it("double-mounted (StrictMode) expired timer fires exactly once per deadline", async () => {
    const onTimeout = vi.fn();
    render(
      <StrictMode>
        <ExamTimer deadlineAt={deadlineAt(-1_000)} onTimeout={onTimeout} />
      </StrictMode>,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(onTimeout).toHaveBeenCalledExactlyOnceWith();
  });

  it("an expired timer reports promptly on bind instead of waiting a full interval", async () => {
    const onTimeout = renderTimer(deadlineAt(-1_000));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(onTimeout).toHaveBeenCalledExactlyOnceWith();
  });
});
