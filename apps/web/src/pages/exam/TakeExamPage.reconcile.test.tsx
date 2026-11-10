import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TakeExamPage } from "./TakeExamPage";
import { ApiError } from "@/lib/api";
import type { CandidateTakeSnapshot } from "@exam/contracts";
import {
  NOW,
  NavigateProbe,
  buildTakeSnapshot,
  singleChoiceQuestion,
  submittedFrozenSnapshot,
  takeExamProviders,
} from "./TakeExamPage.testHarness";

/**
 * EXAM-519 — terminal-signal reconciliation tests.
 *
 * A terminal error (heartbeat 409 INVALID_STATE_TRANSITION, save rejection
 * ATTEMPT_ALREADY_SUBMITTED/ATTEMPT_CLOSED/DEADLINE_EXCEEDED) must trigger
 * ONE authoritative re-read of the take snapshot, whose frozen isEditable
 * then locks the page through the existing view derivation — while a real
 * network failure still shows the generic disconnect banner, and ordinary
 * (non-terminal) save rejections do NOT reconcile.
 *
 * These tests run under fake timers so the 30s heartbeat period and the
 * 1500ms save debounce are crossed deterministically.
 */

function buildSnapshot(
  overrides: Partial<CandidateTakeSnapshot> = {},
): CandidateTakeSnapshot {
  return buildTakeSnapshot({
    timingMode: "untimed",
    questions: [singleChoiceQuestion("q1", { prompt: "选择一项" })],
    ...overrides,
  });
}

/** The frozen post-terminal snapshot the authoritative GET returns. */
function lockedSnapshot(
  overrides: Partial<CandidateTakeSnapshot> = {},
): CandidateTakeSnapshot {
  return submittedFrozenSnapshot({ timingMode: "untimed", ...overrides });
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
    // #924: the save path calls postWithMeta; it delegates to the same
    // apiPost mock so url/body assertions stay single-sourced. This harness
    // asserts no rejection-id behavior, so the header id is a constant null
    // (postMeta: null).
    ...createTakeApiModuleMock({ apiGet, apiPost, postMeta: null }),
  };
});

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function renderPage() {
  const navigateRef: { current: ((to: string) => void) | null } = {
    current: null,
  };
  const tree = takeExamProviders({
    initialPath: "/exam/exam-1/take/att-1",
    children: (
      <>
        <NavigateProbe register={(n) => (navigateRef.current = n)} />
        <Routes>
          <Route
            path="/exam/:examId/take/:attemptId"
            element={<TakeExamPage />}
          />
        </Routes>
      </>
    ),
  });
  const utils = render(tree);
  return {
    ...utils,
    navigate: (to: string) => {
      if (!navigateRef.current) {
        throw new Error("navigate not registered (probe did not mount)");
      }
      navigateRef.current(to);
    },
  };
}

/**
 * Renders under fake timers (so the 30s heartbeat interval and the 1500ms
 * save debounce are fake-controlled) and flushes the initial take GET.
 * Returns the current number of authoritative take GETs issued.
 */
async function renderPageUnderFakeTimers(): Promise<number> {
  vi.useFakeTimers();
  renderPage();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  return takeHandler.mock.calls.length;
}

/** apiPost mock that rejects heartbeats with the given error. */
function heartbeatRejectsWith(err: unknown) {
  apiPost.mockImplementation(async (path: string) => {
    if (typeof path === "string" && path.includes("/heartbeat")) {
      throw err;
    }
    return { ok: true, serverNow: NOW };
  });
}

beforeEach(() => {
  apiGet.mockReset();
  apiPost.mockReset();
  takeHandler.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("terminal-signal reconciliation", () => {
  it("heartbeat 409 INVALID_STATE_TRANSITION → one authoritative re-read → locked UI, no generic disconnect, no loop", async () => {
    let takeCalls = 0;
    apiGet.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.includes("/candidate/attempts/")) {
        takeHandler(path);
        takeCalls += 1;
        return takeCalls === 1 ? buildSnapshot() : lockedSnapshot();
      }
      throw new Error(`unexpected GET ${path}`);
    });
    // Terminal heartbeat: server reports the attempt left in_progress.
    heartbeatRejectsWith(
      new ApiError(
        409,
        "Cannot heartbeat attempt: status changed or attempt not found",
        "INVALID_STATE_TRANSITION",
      ),
    );

    const initialCalls = await renderPageUnderFakeTimers();
    expect(initialCalls).toBe(1);
    const radioA = screen.getByRole("radio", { name: "A" });
    expect(radioA).toBeEnabled();
    expect(screen.queryByText("连接异常")).not.toBeInTheDocument();

    // First real heartbeat period: 409 → reconcile → frozen snapshot locks.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(takeCalls).toBe(2);
    expect(radioA).toBeDisabled();
    expect(screen.queryByTestId("take-submit-btn")).not.toBeInTheDocument();
    const overlay = screen.getByTestId("deadline-overlay");
    // The overlay branches on the authoritative lockReason (#674): a
    // submitted attempt shows the terminal copy, not the deadline/auto-submit
    // one — the header carries the same ended title by design.
    expect(overlay).toHaveAttribute("data-lock-reason", "submitted");
    expect(within(overlay).getByText("考试已结束")).toBeInTheDocument();
    expect(
      within(overlay).queryByText("系统正在自动提交您的答案..."),
    ).not.toBeInTheDocument();
    // The generic disconnect banner must NOT appear for a terminal signal.
    expect(screen.queryByText("连接异常")).not.toBeInTheDocument();
    expect(
      screen.queryByText("网络连接已中断，正在自动重试；请不要关闭页面。"),
    ).not.toBeInTheDocument();

    // Second heartbeat period: already locked → terminal 409 is a no-op,
    // no additional re-read (no convergence loop).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(takeCalls).toBe(2);
  });

  it("heartbeat network failure → generic disconnect, no authoritative re-read", async () => {
    let takeCalls = 0;
    apiGet.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.includes("/candidate/attempts/")) {
        takeHandler(path);
        takeCalls += 1;
        return buildSnapshot();
      }
      throw new Error(`unexpected GET ${path}`);
    });
    heartbeatRejectsWith(new ApiError(0, "Network request failed"));

    await renderPageUnderFakeTimers();
    expect(screen.queryByText("连接异常")).not.toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(screen.getByText("连接异常")).toBeInTheDocument();
    // The connection banner explains the CONNECTION state only (S3.3: the
    // answer-save state and its actions live in the save-retry banner).
    expect(
      screen.getByText("网络连接已中断，正在自动重试；请不要关闭页面。"),
    ).toBeInTheDocument();
    // A transport failure is NOT an authority signal — no re-read.
    expect(takeCalls).toBe(1);
  });

  it("save rejection ATTEMPT_ALREADY_SUBMITTED → re-read → locked UI, accurate terminal alert retained, frozen answer wins", async () => {
    let takeCalls = 0;
    apiGet.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.includes("/candidate/attempts/")) {
        takeHandler(path);
        takeCalls += 1;
        return takeCalls === 1 ? buildSnapshot() : lockedSnapshot();
      }
      throw new Error(`unexpected GET ${path}`);
    });
    apiPost.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.includes("/answers/")) {
        return {
          accepted: false,
          reason: "ATTEMPT_ALREADY_SUBMITTED",
          message: "考试已提交，不能继续保存答案",
          serverVersion: 1,
          savedAt: NOW,
        };
      }
      return { ok: true, serverNow: NOW };
    });

    await renderPageUnderFakeTimers();
    const radioB = screen.getByRole("radio", { name: "B" });
    expect(radioB).toBeEnabled();

    // Candidate edits after terminalization; the debounced save fires and is
    // rejected with the terminal reason.
    await act(async () => {
      fireEvent.click(radioB);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    // Convergence: one re-read applied the frozen snapshot.
    expect(takeCalls).toBe(2);
    expect(screen.getByRole("radio", { name: "A" })).toBeDisabled();
    expect(screen.getByTestId("deadline-overlay")).toBeInTheDocument();
    // Accurate terminal feedback retained (NOT suppressed by a disconnect).
    const alert = screen.getByTestId("save-rejection-alert");
    expect(alert).toHaveTextContent("答案已提交，考试已结束");
    expect(screen.queryByText("连接异常")).not.toBeInTheDocument();
    // The frozen server answer wins over the stale local edit (B17).
    expect(screen.getByRole("radio", { name: "A" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "B" })).not.toBeChecked();
  });

  it("ordinary non-terminal save rejection → NO re-read, page stays editable with rejection feedback", async () => {
    let takeCalls = 0;
    apiGet.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.includes("/candidate/attempts/")) {
        takeHandler(path);
        takeCalls += 1;
        return buildSnapshot();
      }
      throw new Error(`unexpected GET ${path}`);
    });
    apiPost.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.includes("/answers/")) {
        return {
          accepted: false,
          reason: "INVALID_ANSWER",
          message: "答案格式不符合此题要求",
          serverVersion: 1,
          savedAt: NOW,
        };
      }
      return { ok: true, serverNow: NOW };
    });

    await renderPageUnderFakeTimers();
    await act(async () => {
      fireEvent.click(screen.getByRole("radio", { name: "B" }));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    // Rejection feedback shown, but NO authoritative re-read and no lock:
    // a local validation rejection is not a terminal signal.
    expect(screen.getByTestId("save-rejection-alert")).toBeInTheDocument();
    expect(takeCalls).toBe(1);
    expect(screen.getByRole("radio", { name: "A" })).toBeEnabled();
    expect(screen.queryByTestId("deadline-overlay")).not.toBeInTheDocument();
  });

  it("concurrent terminal signals collapse into one in-flight authoritative re-read", async () => {
    let takeCalls = 0;
    let resolveTake: ((s: CandidateTakeSnapshot) => void) | null = null;
    apiGet.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.includes("/candidate/attempts/")) {
        takeHandler(path);
        takeCalls += 1;
        if (takeCalls === 1) return buildSnapshot();
        // The reconciliation re-read stays in flight while the next terminal
        // signal arrives.
        return new Promise<CandidateTakeSnapshot>((resolve) => {
          resolveTake = resolve;
        });
      }
      throw new Error(`unexpected GET ${path}`);
    });
    // Save rejection and heartbeat both produce terminal signals in the same
    // episode: the save rejects at +1.5s, the heartbeat 409 at +30s.
    apiPost.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.includes("/answers/")) {
        return {
          accepted: false,
          reason: "ATTEMPT_CLOSED",
          message: "该考试已被关闭",
          serverVersion: 1,
          savedAt: NOW,
        };
      }
      if (typeof path === "string" && path.includes("/heartbeat")) {
        throw new ApiError(
          409,
          "Cannot heartbeat attempt: status changed or attempt not found",
          "INVALID_STATE_TRANSITION",
        );
      }
      return { ok: true, serverNow: NOW };
    });

    await renderPageUnderFakeTimers();
    await act(async () => {
      fireEvent.click(screen.getByRole("radio", { name: "B" }));
    });
    // Cross the save debounce (+1.5s → rejection → reconcile GET in flight)
    // and the heartbeat period (+30s → 409 → second terminal signal).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    // Only ONE reconciliation GET: the second signal joined the in-flight one.
    expect(takeCalls).toBe(2);
    expect(resolveTake).not.toBeNull();

    await act(async () => {
      resolveTake?.(lockedSnapshot());
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByRole("radio", { name: "A" })).toBeDisabled();
    expect(takeCalls).toBe(2);
  });

  it("route change during an in-flight reconciliation lets the NEW attempt start its own re-read", async () => {
    // Attempt att-1's reconciliation GET never settles (hung fetch); the
    // candidate navigates to att-2 in the same mounted instance. att-2's
    // terminal signal must NOT join the stale att-1 promise — it starts a
    // fresh re-read for att-2.
    const att1Gets: string[] = [];
    const att2Gets: string[] = [];
    let resolveAtt1Reconcile: ((s: CandidateTakeSnapshot) => void) | null =
      null;
    apiGet.mockImplementation(async (path: string) => {
      const p = path as string;
      if (!p.includes("/candidate/attempts/")) {
        throw new Error(`unexpected GET ${path}`);
      }
      if (p.includes("/att-1/")) {
        att1Gets.push(p);
        if (att1Gets.length === 1) return buildSnapshot();
        // The att-1 reconciliation GET hangs forever (like a stalled fetch).
        return new Promise<CandidateTakeSnapshot>((resolve) => {
          resolveAtt1Reconcile = resolve;
        });
      }
      att2Gets.push(p);
      if (att2Gets.length === 1) {
        return buildSnapshot({
          attemptId: "att-2",
          examId: "exam-2",
        });
      }
      return lockedSnapshot({ attemptId: "att-2", examId: "exam-2" });
    });
    apiPost.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.includes("/heartbeat")) {
        throw new ApiError(
          409,
          "Cannot heartbeat attempt: status changed or attempt not found",
          "INVALID_STATE_TRANSITION",
        );
      }
      return { ok: true, serverNow: NOW };
    });

    vi.useFakeTimers();
    const { navigate } = renderPage();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(att1Gets).toHaveLength(1);

    // att-1 terminal heartbeat → reconciliation GET starts (hangs).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(att1Gets).toHaveLength(2);
    expect(resolveAtt1Reconcile).not.toBeNull();

    // Navigate to att-2 (same component instance) while att-1's GET hangs.
    await act(async () => {
      navigate("/exam/exam-2/take/att-2");
      await Promise.resolve();
      await Promise.resolve();
    });
    // att-2's own initial load issued its first GET.
    expect(att2Gets).toHaveLength(1);

    // att-2's terminal heartbeat must start a NEW reconciliation for att-2,
    // not join the stale att-1 in-flight promise.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(
      att2Gets,
      "att-2 terminal signal re-reads att-2 despite att-1's hung promise",
    ).toHaveLength(2);
    expect(screen.getByRole("radio", { name: "A" })).toBeDisabled();
    expect(screen.queryByText("连接异常")).not.toBeInTheDocument();
  });
});
