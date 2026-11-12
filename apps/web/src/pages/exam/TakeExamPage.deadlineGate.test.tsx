import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TakeExamPage } from "./TakeExamPage";
import type { CandidateTakeSnapshot } from "@exam/contracts";
import { getBuffer, setBuffer } from "@/lib/logger";
import { __resetExamTelemetryForTest } from "@/lib/examTelemetry";
import {
  buildTakeSnapshot,
  installRecordingBuffer,
  singleChoiceQuestion,
  takeExamProviders,
  telemetryEvents,
} from "./TakeExamPage.testHarness";

/**
 * Client deadline trigger → server-authoritative submission gate (R-02/#961).
 *
 * The candidate page's deadline triggers (the 1s tick and ExamTimer.onTimeout
 * in timed_window mode) converge into one attempt-scoped episode. ADR-006
 * keeps the server as the sole time authority: the client's local expiry
 * belief — including ExamTimer's floored 00:00 display — is display-level
 * evidence only and must never execute the irreversible ordinary submit on
 * its own. The episode therefore flushes pending answers first (unchanged
 * flush-before-submit), then re-reads the authoritative /take snapshot:
 *   - frozen by the deadline (or already terminal) → the submit POST lands on
 *     an attempt the server already froze (reconciliation makes it idempotent
 *     and never records a manual submit);
 *   - still editable (client clock jumped ahead) → fail-closed: no submit,
 *     the episode re-arms and the next tick re-checks against the re-based
 *     server clock;
 *   - verification read unavailable → fail-closed, retry on the next tick.
 * Manual submits (submit dialog → handleSubmit) bypass this gate entirely and
 * keep their existing semantics, including the earliest-submit-time rule.
 *
 * The retry throttle between episodes is measured on the MONOTONIC clock
 * (performance.now), never the wall clock: an NTP/manual wall-clock rollback
 * after a failed verification must not suppress retries until the wall clock
 * catches back up to the old deferral instant.
 */

const T0 = new Date("2026-07-04T10:00:00.000Z");
const T0_ISO = T0.toISOString();
// timed_window so BOTH triggers exist: ExamTimer mounts and its onTimeout
// joins the page tick through the shared episode seam.
const NEAR_DEADLINE = new Date(T0.getTime() + 3_000).toISOString();

function editableSnapshot(
  overrides: Partial<CandidateTakeSnapshot> = {},
): CandidateTakeSnapshot {
  return buildTakeSnapshot({
    timingMode: "timed_window",
    questions: [singleChoiceQuestion("q1", { prompt: "选择一项" })],
    serverNow: T0_ISO,
    effectiveDeadline: NEAR_DEADLINE,
    ...overrides,
  });
}

/** The frozen view GET /take returns once the SERVER clock passes the deadline. */
function deadlineFrozenSnapshot(
  overrides: Partial<CandidateTakeSnapshot> = {},
): CandidateTakeSnapshot {
  return editableSnapshot({
    serverNow: new Date(T0.getTime() + 3_100).toISOString(),
    isEditable: false,
    canSave: false,
    canSubmit: false,
    lockReason: "deadline",
    attemptStatus: "submitted",
    submittedAt: new Date(T0.getTime() + 3_000).toISOString(),
    ...overrides,
  });
}

const { apiGet, apiPost, takeHandler } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  takeHandler: vi.fn(),
}));

vi.mock("@/lib/api", async () => {
  const { createTakeApiModuleMock, makeApiErrorStub } =
    await import("./TakeExamPage.apiMockHarness");
  return {
    ApiError: makeApiErrorStub(),
    ...createTakeApiModuleMock({ apiGet, apiPost, postMeta: null }),
  };
});

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="current-path">{location.pathname}</span>;
}

function renderPage() {
  return render(
    takeExamProviders({
      initialPath: "/exam/exam-1/take/att-1",
      children: (
        <>
          <LocationProbe />
          <Routes>
            <Route
              path="/exam/:examId/take/:attemptId"
              element={<TakeExamPage />}
            />
            <Route
              path="/exam/:attemptId/result"
              element={<span>结果页</span>}
            />
            <Route path="/exam/list" element={<span>列表页</span>} />
          </Routes>
        </>
      ),
    }),
  );
}

function submitPostCount(): number {
  return apiPost.mock.calls.filter(
    ([p]) => typeof p === "string" && p.includes("/submit"),
  ).length;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushTelemetry(): Promise<void> {
  await getBuffer().flush();
}

beforeEach(() => {
  apiGet.mockReset();
  apiPost.mockReset();
  takeHandler.mockReset();
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});

afterEach(() => {
  setBuffer(null);
  __resetExamTelemetryForTest();
  vi.useRealTimers();
});

describe("deadline auto-submit server-authority gate", () => {
  it("client clock jumped past the deadline while the server clock has not: shows 00:00, submits NOTHING, re-arms", async () => {
    const send = installRecordingBuffer();
    // Every /take read returns the same authoritative truth: the server
    // clock still sits at T0, three seconds before the deadline. The client
    // wall clock is the anomaly (jumped ahead below).
    apiGet.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.includes("/candidate/attempts/")) {
        takeHandler(path);
        return editableSnapshot();
      }
      throw new Error(`unexpected GET ${path}`);
    });
    apiPost.mockResolvedValue({ ok: true, serverNow: T0_ISO });

    renderPage();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0); // initial load
    });

    // Local wall clock jumps ~51 minutes ahead (client anomaly). Every local
    // deadline trigger now believes the attempt is expired (the component
    // level pins that this floors to a 00:00 display), but the episode must
    // verify with the server before ANY submit.
    await act(async () => {
      vi.setSystemTime(new Date(T0.getTime() + 3_100 + 3_000_000));
      await vi.advanceTimersByTimeAsync(1_000);
    });

    // The verification re-read reports the attempt still editable, so the
    // irreversible ordinary submit must not run.
    expect(submitPostCount()).toBe(0);
    await flushTelemetry();
    expect(telemetryEvents(send, "deadline_auto_submit_success")).toHaveLength(
      0,
    );
    expect(telemetryEvents(send, "deadline_auto_submit_deferred")).toHaveLength(
      1,
    );
    expect(
      (
        telemetryEvents(send, "deadline_auto_submit_deferred")[0]?.metadata as {
          reason?: string;
        }
      ).reason,
    ).toBe("server_deadline_not_reached");
    // The exam surface stays editable — no deadline lock, no retry overlay.
    expect(screen.queryByTestId("deadline-overlay")).not.toBeInTheDocument();
    expect(screen.getByTestId("take-submit-btn")).toBeEnabled();

    // The offset re-base from the verification read pulls the client's
    // server-adjusted clock back to the server's T0: no polling storm of
    // extra verification reads while the corrected clock stays before the
    // deadline. The timer display is reconstructed from the corrected clock.
    expect(screen.getByText("00:03")).toBeInTheDocument();
    const readsAfterFirstVerification = takeHandler.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(takeHandler.mock.calls.length).toBe(readsAfterFirstVerification);
    expect(submitPostCount()).toBe(0);
  });

  it("server confirms the deadline passed: exactly one submit, result navigation, no manual-path double submit", async () => {
    installRecordingBuffer();
    // GET sequence: editable on load; frozen once the server clock is asked
    // after the client's deadline passed (the GET itself reconciles).
    apiGet.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.includes("/candidate/attempts/")) {
        takeHandler(path);
        return takeHandler.mock.calls.length <= 1
          ? editableSnapshot()
          : deadlineFrozenSnapshot();
      }
      throw new Error(`unexpected GET ${path}`);
    });
    apiPost.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.includes("/submit")) {
        return { ok: true, attemptId: "att-1", status: "submitted" };
      }
      return { ok: true, serverNow: T0_ISO };
    });

    renderPage();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0); // initial load
    });

    // Local clock crosses the deadline; the server agrees.
    await act(async () => {
      vi.setSystemTime(new Date(T0.getTime() + 3_100));
      await vi.advanceTimersByTimeAsync(1_000);
    });

    expect(submitPostCount()).toBe(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    // No duplicate episode on later ticks.
    expect(submitPostCount()).toBe(1);
    expect(screen.getByTestId("current-path")).toHaveTextContent("/result");
  });

  it("verification read fails: fail-closed (no submit), the episode retries and converges once the read succeeds", async () => {
    const send = installRecordingBuffer();
    let takeCalls = 0;
    apiGet.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.includes("/candidate/attempts/")) {
        takeHandler(path);
        takeCalls += 1;
        if (takeCalls === 2) {
          // The verification re-read fails (transport fault).
          throw new Error("verification read unavailable");
        }
        return takeCalls <= 1 ? editableSnapshot() : deadlineFrozenSnapshot();
      }
      throw new Error(`unexpected GET ${path}`);
    });
    apiPost.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.includes("/submit")) {
        return { ok: true, attemptId: "att-1", status: "submitted" };
      }
      return { ok: true, serverNow: T0_ISO };
    });

    renderPage();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0); // initial load (call 1)
    });

    await act(async () => {
      vi.setSystemTime(new Date(T0.getTime() + 3_100));
      await vi.advanceTimersByTimeAsync(1_000); // tick → verification (call 2) fails
    });

    // Fail-closed: the unverified local clock never executes the submit.
    expect(submitPostCount()).toBe(0);
    await flushTelemetry();
    const deferred = telemetryEvents(send, "deadline_auto_submit_deferred");
    expect(deferred).toHaveLength(1);
    expect((deferred[0]!.metadata as { reason?: string }).reason).toBe(
      "server_state_unavailable",
    );

    // Next tick retries the gate; the read now succeeds (call 3, frozen).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(submitPostCount()).toBe(1);
    await flushTelemetry();
    expect(telemetryEvents(send, "deadline_auto_submit_success")).toHaveLength(
      1,
    );
    expect(screen.getByTestId("current-path")).toHaveTextContent("/result");
  });

  it("manual submit before the deadline is not gated: the dialog path still POSTs directly", async () => {
    installRecordingBuffer();
    apiGet.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.includes("/candidate/attempts/")) {
        takeHandler(path);
        return editableSnapshot();
      }
      throw new Error(`unexpected GET ${path}`);
    });
    apiPost.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.includes("/submit")) {
        return { ok: true, attemptId: "att-1", status: "submitted" };
      }
      return { ok: true, serverNow: T0_ISO };
    });

    renderPage();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0); // initial load
    });

    // Well before the deadline: the candidate submits deliberately.
    fireEvent.click(screen.getByTestId("take-submit-btn"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    fireEvent.click(
      within(screen.getByRole("dialog")).getByTestId("confirm-submit-btn"),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(submitPostCount()).toBe(1);
    expect(screen.getByTestId("current-path")).toHaveTextContent("/result");
  });
});

/**
 * Regression for the external review of PR #967: the retry throttle MUST be
 * monotonic. A wall-clock rollback after a deferred verification made
 * `Date.now() - deferredAt` negative for as long as the rollback lasted, so
 * the page stopped re-verifying even after the heartbeat re-based the server
 * offset and the server-adjusted clock (the trigger authority) was past the
 * deadline. The server scanner still freezes the attempt, but the page's
 * retry/convergence promise breaks.
 */
describe("deadline verification throttle is monotonic, not wall-clock bound", () => {
  /** Heartbeat re-bases the offset onto a server clock already past the deadline. */
  function mockRuntimeApi(
    take: (calls: number) => Promise<CandidateTakeSnapshot>,
  ) {
    let takeCalls = 0;
    apiGet.mockImplementation((path: string) => {
      if (typeof path === "string" && path.includes("/candidate/attempts/")) {
        takeHandler(path);
        takeCalls += 1;
        return take(takeCalls);
      }
      return Promise.reject(new Error(`unexpected GET ${path}`));
    });
    apiPost.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.includes("/heartbeat")) {
        return {
          ok: true,
          serverNow: new Date(T0.getTime() + 4_000).toISOString(),
        };
      }
      if (typeof path === "string" && path.includes("/submit")) {
        return { ok: true, attemptId: "att-1", status: "submitted" };
      }
      return { ok: true, serverNow: T0_ISO };
    });
    return () => takeCalls;
  }

  async function loadAndDeferOnce(): Promise<void> {
    renderPage();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0); // initial load
    });
    // The client clock jumps past the deadline: the deadline triggers fire,
    // but the first verification read fails (server state unavailable).
    await act(async () => {
      vi.setSystemTime(new Date(T0.getTime() + 3_100));
      await vi.advanceTimersByTimeAsync(1_000);
    });
  }

  it("wall clock rolled back 1h: heartbeat offset re-calibration re-arms expiry and the next tick retries verification", async () => {
    installRecordingBuffer();
    const retry = deferred<CandidateTakeSnapshot>();
    const takeCalls = mockRuntimeApi((calls) => {
      if (calls === 1) return Promise.resolve(editableSnapshot());
      if (calls === 2) {
        return Promise.reject(new Error("verification read unavailable"));
      }
      return retry.promise;
    });

    await loadAndDeferOnce();
    // Load + one failed verification; the episode deferred.
    expect(takeCalls()).toBe(2);

    // Wall clock is rolled back one hour (NTP/manual correction). The old
    // wall-clock throttle compared against the pre-rollback instant, so the
    // difference stayed ~-1h and every retry was suppressed.
    await act(async () => {
      vi.setSystemTime(new Date(T0.getTime() + 3_100 - 3_600_000));
    });

    // 30s heartbeat re-bases the offset onto the server clock, which is past
    // the deadline, so the 1s expiry tick fires again. Monotonic elapsed is
    // ~30s: the next tick MUST retry verification.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(32_000);
    });
    expect(takeCalls()).toBe(3);

    // The retry is a real re-read, not a submit: settle it as editable truth.
    await act(async () => {
      retry.resolve(editableSnapshot());
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(submitPostCount()).toBe(0);
  });

  it("a second expiry trigger less than 1000ms (monotonic) after the deferral is still throttled", async () => {
    installRecordingBuffer();
    const takeCalls = mockRuntimeApi((calls) => {
      if (calls === 1) return Promise.resolve(editableSnapshot());
      if (calls === 2) {
        // Slow transport: the verification read fails 500ms after the tick.
        return new Promise<CandidateTakeSnapshot>((_resolve, reject) => {
          setTimeout(
            () => reject(new Error("verification read unavailable")),
            500,
          );
        });
      }
      return Promise.resolve(editableSnapshot());
    });

    await loadAndDeferOnce();
    expect(takeCalls()).toBe(2);

    // Let the in-flight verification fail: the deferral is recorded at
    // monotonic t≈1500ms.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    // Next expiry tick at t=2000ms: only 500ms of monotonic time since the
    // deferral — the same-window guard keeps it to one verification attempt.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(takeCalls()).toBe(2);

    // t=3000ms is 1500ms after the deferral: the retry is allowed again.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(takeCalls()).toBe(3);
  });

  it("after the rollback and offset re-calibration, a deadline-frozen server snapshot converges through handleSubmit", async () => {
    const send = installRecordingBuffer();
    const takeCalls = mockRuntimeApi((calls) => {
      if (calls === 1) return Promise.resolve(editableSnapshot());
      if (calls === 2) {
        return Promise.reject(new Error("verification read unavailable"));
      }
      // The retry (call 3) and the post-submit reload (call 4) both observe
      // the server's frozen truth.
      return Promise.resolve(deadlineFrozenSnapshot());
    });

    await loadAndDeferOnce();
    expect(takeCalls()).toBe(2);
    expect(submitPostCount()).toBe(0);

    await act(async () => {
      vi.setSystemTime(new Date(T0.getTime() + 3_100 - 3_600_000));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(32_000);
    });

    // The retried verification confirms deadline-frozen → the ordinary submit
    // runs exactly once and the page converges on the result route.
    expect(takeCalls()).toBeGreaterThanOrEqual(3);
    expect(submitPostCount()).toBe(1);
    expect(screen.getByTestId("current-path")).toHaveTextContent("/result");
    await flushTelemetry();
    expect(telemetryEvents(send, "deadline_auto_submit_success")).toHaveLength(
      1,
    );
  });
});
