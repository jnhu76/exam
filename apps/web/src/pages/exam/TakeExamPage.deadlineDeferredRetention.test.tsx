import { act, fireEvent, render, screen } from "@testing-library/react";
import { Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TakeExamPage } from "./TakeExamPage";
import { ApiError } from "@/lib/api";
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
 * R-T4-2 (#1051): the deadline gate's editable-defer branch must keep the
 * candidate's unacknowledged edits.
 *
 * The deadline episode's authoritative /take re-read serves two distinct
 * duties: re-basing the server clock offset (always applicable — ADR-006
 * keeps the server the time authority) and rebuilding business state from
 * the server draft (correct only for a terminal/frozen verdict — the B17
 * frozen-answer-wins contract). When the verdict is "still editable" (the
 * client clock jumped ahead of the server clock), the server draft has no
 * write authority over questions with local unacknowledged input: the
 * candidate's failed save means the server never saw the latest edit, so
 * applying the draft rolls the editor back to a stale value — and the
 * failed-save retry (window online / heartbeat recovery) then re-POSTs
 * that stale value, persisting the loss.
 *
 * Main interleaving under fake timers, with every /take read returning the
 * SAME editable truth (server clock 3s before the deadline; q1's confirmed
 * server draft is opt-a):
 *
 *   1. the candidate switches q1 to opt-b; the debounced save dies with an
 *      HTTP 500 → q1 joins the failed-save retry set;
 *   2. the wall clock jumps ~50min ahead → the deadline episode verifies;
 *      the server truth is "still editable" → defer (no submit);
 *   3. WITNESS 1 — the editor must still show opt-b (the unconfirmed
 *      edit), not the server draft opt-a;
 *   4. window "online" fires → retryFailedSaves re-POSTs q1;
 *      WITNESS 2 — the retry POST body must carry opt-b (the candidate's
 *      last input) on the same versioned sequence (baseVersion 1,
 *      clientSeq 2), not the replaced draft opt-a. A retried opt-a that
 *      succeeds would permanently persist the rollback.
 *
 * The two counterfactual tests pin the boundary of the preservation rule
 * through the SAME convergence seam:
 *   - a deadline-FROZEN verdict still rebuilds business state wholesale —
 *     the frozen server answer wins over the same unacknowledged local
 *     edit (B17 unchanged);
 *   - an ACKNOWLEDGED edit (save accepted) gets no preservation — an
 *     editable re-read still converges the editor to the server draft,
 *     exactly like a page reload would.
 */

const T0 = new Date("2026-07-04T10:00:00.000Z");
const T0_ISO = T0.toISOString();
const NEAR_DEADLINE = new Date(T0.getTime() + 3_000).toISOString();

/**
 * The server truth every /take read returns while the attempt is editable:
 * still editable, and q1's confirmed draft is opt-a. When the candidate's
 * opt-b save FAILED, the draft lags the editor (draftVersion stays at the
 * load-time 1); the counterfactuals move the draft forward explicitly.
 */
function editableDraftSnapshot({
  draftAnswer = "opt-a",
  draftVersion = 1,
}: {
  draftAnswer?: string;
  draftVersion?: number;
} = {}): CandidateTakeSnapshot {
  return buildTakeSnapshot({
    timingMode: "timed_window",
    questions: [
      {
        ...singleChoiceQuestion("q1", { prompt: "选择一项" }),
        answerValue: draftAnswer,
        answerSource: "draft",
        currentVersion: draftVersion,
        currentClientSeq: 1,
      },
    ],
    serverNow: T0_ISO,
    effectiveDeadline: NEAR_DEADLINE,
  });
}

/**
 * What the server returns once its own deadline scanner froze the attempt:
 * the candidate's failed opt-b never arrived, so the frozen answer is the
 * draft opt-a. B17: this frozen server answer wins over the stale local
 * edit.
 */
function deadlineFrozenDraftSnapshot(): CandidateTakeSnapshot {
  return buildTakeSnapshot({
    timingMode: "timed_window",
    questions: [
      {
        ...singleChoiceQuestion("q1", { prompt: "选择一项" }),
        answerValue: "opt-a",
        answerSource: "submitted",
        currentVersion: 1,
        currentClientSeq: 1,
      },
    ],
    serverNow: new Date(T0.getTime() + 3_100).toISOString(),
    effectiveDeadline: NEAR_DEADLINE,
    isEditable: false,
    canSave: false,
    canSubmit: false,
    lockReason: "deadline",
    attemptStatus: "submitted",
    submittedAt: new Date(T0.getTime() + 3_000).toISOString(),
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
          </Routes>
        </>
      ),
    }),
  );
}

/** Observed POST bodies of answer-save requests, in call order. */
function answerSavePosts(): Array<Record<string, unknown>> {
  return apiPost.mock.calls
    .filter(([path]) => typeof path === "string" && path.includes("/answers/"))
    .map(([, body]) => body as Record<string, unknown>);
}

function submitPostCount(): number {
  return apiPost.mock.calls.filter(
    ([path]) => typeof path === "string" && path.includes("/submit"),
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

describe("deadline editable-defer keeps unacknowledged edits (R-T4-2)", () => {
  it("deferred editable verdict preserves the failed-save edit in the editor and in the retried POST", async () => {
    const send = installRecordingBuffer();
    apiGet.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.includes("/candidate/attempts/")) {
        takeHandler(path);
        return editableDraftSnapshot();
      }
      throw new Error(`unexpected GET ${path}`);
    });
    let answerSaveCalls = 0;
    apiPost.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.includes("/answers/")) {
        answerSaveCalls += 1;
        if (answerSaveCalls === 1) {
          // The candidate's opt-b save dies on a server fault: the server
          // never receives the edit, q1 joins the failed-save retry set.
          throw new ApiError(500, "save endpoint fault");
        }
        // Connectivity recovered: the retry lands — whatever answer value it
        // carries becomes the persisted truth.
        return { accepted: true, serverVersion: 2, savedAt: T0_ISO };
      }
      return { ok: true, serverNow: T0_ISO };
    });

    renderPage();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0); // initial load
    });
    // The confirmed server draft (opt-a) is what both server and editor
    // start from.
    expect(screen.getByRole("radio", { name: "A" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "B" })).toBeEnabled();

    // The candidate switches to opt-b; the 1500ms-debounced save fires and
    // fails with the HTTP 500.
    fireEvent.click(screen.getByRole("radio", { name: "B" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(answerSavePosts()).toHaveLength(1);
    expect(answerSavePosts()[0]!.answer).toBe("opt-b");
    expect(answerSavePosts()[0]!.clientSeq).toBe(2);
    expect(screen.getByRole("radio", { name: "B" })).toBeChecked();

    // The client wall clock jumps ~50min ahead: the deadline episode flushes,
    // verifies with the server, and the server truth is "still editable" —
    // the episode defers and must not submit.
    await act(async () => {
      vi.setSystemTime(new Date(T0.getTime() + 3_100 + 3_000_000));
      await vi.advanceTimersByTimeAsync(1_000);
    });
    await getBuffer().flush();
    const deferredEvents = telemetryEvents(
      send,
      "deadline_auto_submit_deferred",
    );
    expect(deferredEvents).toHaveLength(1);
    expect((deferredEvents[0]!.metadata as { reason?: string }).reason).toBe(
      "server_deadline_not_reached",
    );
    expect(submitPostCount()).toBe(0);

    // WITNESS 1 — the editor keeps the candidate's unconfirmed opt-b: an
    // editable defer is not a terminal verdict, so the server draft has no
    // write authority over unacknowledged local input.
    expect(screen.getByRole("radio", { name: "B" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "A" })).not.toBeChecked();

    // Connectivity recovers (window "online"): the failed save is retried
    // through the existing orchestration.
    await act(async () => {
      window.dispatchEvent(new Event("online"));
      await vi.advanceTimersByTimeAsync(0);
    });

    // WITNESS 2 — the retry POST carries the candidate's last input opt-b on
    // the same versioned sequence (baseVersion 1 unchanged — the failed save
    // was never ACKed; clientSeq 3 = the preserved local counter 2 + 1, NOT
    // reset by the server snapshot's currentClientSeq); re-POSTing the
    // replaced draft opt-a would persist the rollback.
    expect(answerSavePosts()).toHaveLength(2);
    expect(answerSavePosts()[1]!.answer).toBe("opt-b");
    expect(answerSavePosts()[1]!.baseVersion).toBe(1);
    expect(answerSavePosts()[1]!.clientSeq).toBe(3);
    // The page stays on the editable take surface — no submit path fired.
    expect(submitPostCount()).toBe(0);
    expect(screen.getByTestId("current-path")).toHaveTextContent("/take");
  });

  it("counterfactual: a deadline-FROZEN verdict through the same seam still rebuilds business state — frozen server answer wins (B17)", async () => {
    installRecordingBuffer();
    let takeCalls = 0;
    apiGet.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.includes("/candidate/attempts/")) {
        takeHandler(path);
        takeCalls += 1;
        // Load sees the editable draft; the verification read observes the
        // server's own deadline scanner having frozen the attempt.
        return takeCalls === 1
          ? editableDraftSnapshot()
          : deadlineFrozenDraftSnapshot();
      }
      throw new Error(`unexpected GET ${path}`);
    });
    let answerSaveCalls = 0;
    const submitGate = deferred<unknown>();
    apiPost.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.includes("/answers/")) {
        answerSaveCalls += 1;
        throw new ApiError(500, "save endpoint fault");
      }
      if (typeof path === "string" && path.includes("/submit")) {
        return submitGate.promise;
      }
      return { ok: true, serverNow: T0_ISO };
    });

    renderPage();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0); // initial load
    });
    fireEvent.click(screen.getByRole("radio", { name: "B" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000); // save fails (HTTP 500)
    });
    expect(answerSavePosts()).toHaveLength(1);

    // The wall clock jumps past the deadline and the SERVER agrees: the
    // frozen snapshot is applied wholesale and the episode submits exactly
    // once (parked so the frozen editor state is observable in-flight).
    await act(async () => {
      vi.setSystemTime(new Date(T0.getTime() + 3_100));
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(submitPostCount()).toBe(1);

    // B17 through the convergence seam: the frozen server answer (opt-a —
    // the failed opt-b never arrived) wins over the same unacknowledged
    // local edit that the editable defer preserves.
    expect(screen.getByRole("radio", { name: "A" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "B" })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "A" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "B" })).toBeDisabled();
    const overlay = screen.getByTestId("deadline-overlay");
    expect(overlay).toHaveAttribute("data-lock-reason", "deadline");

    // The parked auto submit settles: the page converges on the result
    // route.
    await act(async () => {
      submitGate.resolve({ ok: true, attemptId: "att-1", status: "submitted" });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByTestId("current-path")).toHaveTextContent("/result");
  });

  it("counterfactual: an ACKNOWLEDGED edit gets no preservation — the editable re-read converges the editor to the server draft", async () => {
    installRecordingBuffer();
    apiGet.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.includes("/candidate/attempts/")) {
        takeHandler(path);
        // draftVersion 2: another client's write landed AFTER this page's
        // acknowledged opt-b, so the server draft is the newer truth.
        return editableDraftSnapshot({ draftVersion: 2 });
      }
      throw new Error(`unexpected GET ${path}`);
    });
    apiPost.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.includes("/answers/")) {
        return { accepted: true, serverVersion: 2, savedAt: T0_ISO };
      }
      return { ok: true, serverNow: T0_ISO };
    });

    renderPage();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0); // initial load
    });
    fireEvent.click(screen.getByRole("radio", { name: "B" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000); // save ACKed
    });
    expect(answerSavePosts()).toHaveLength(1);
    expect(screen.getByRole("radio", { name: "B" })).toBeChecked();

    // Same editable defer as the main test — but q1 is ACKNOWLEDGED now, so
    // the editor converges to the server draft exactly like a reload would;
    // preservation is scoped to unacknowledged input, not a blanket
    // "local wins".
    await act(async () => {
      vi.setSystemTime(new Date(T0.getTime() + 3_100 + 3_000_000));
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(screen.getByRole("radio", { name: "A" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "B" })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "A" })).toBeEnabled();

    // No failed saves exist, so no retry path may fire after connectivity
    // returns.
    await act(async () => {
      window.dispatchEvent(new Event("online"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(answerSavePosts()).toHaveLength(1);
    expect(submitPostCount()).toBe(0);
  });
});
