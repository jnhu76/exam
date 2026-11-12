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
