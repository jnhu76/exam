import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TakeExamPage } from "./TakeExamPage";
import type { CandidateTakeSnapshot } from "@exam/contracts";
import {
  NOW,
  buildTakeSnapshot,
  singleChoiceQuestion,
  takeExamProviders,
} from "./TakeExamPage.testHarness";

/**
 * #674 — locked-state presentation matrix. The overlay branches on the
 * AUTHORITATIVE snapshot lockReason; each cause states only what is true:
 * disrupted never claims deadline/auto-submit; deadline copy appears only
 * for the deadline reason; submitted/voided show terminal copy with a valid
 * next action.
 */

function buildSnapshot(
  overrides: Partial<CandidateTakeSnapshot> = {},
): CandidateTakeSnapshot {
  return buildTakeSnapshot({
    timingMode: "timed_window",
    questions: [singleChoiceQuestion("q1", { prompt: "选择一项" })],
    // Fixture contract: the unlocked base carries an explicit
    // `lockReason: undefined` key, not an absent one.
    lockReason: undefined,
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
  return render(
    takeExamProviders({
      initialPath: "/exam/exam-1/take/att-1",
      children: (
        <Routes>
          <Route
            path="/exam/:examId/take/:attemptId"
            element={<TakeExamPage />}
          />
          <Route path="/exam/list" element={<div>考试列表页</div>} />
          <Route path="/exam/:attemptId/result" element={<div>结果页</div>} />
        </Routes>
      ),
    }),
  );
}

function installTakeRoute(...snapshots: CandidateTakeSnapshot[]) {
  let call = 0;
  apiGet.mockImplementation(async (path: string) => {
    if (typeof path === "string" && path.includes("/candidate/attempts/")) {
      takeHandler(path);
      const snapshot = snapshots[Math.min(call, snapshots.length - 1)];
      call += 1;
      return snapshot;
    }
    throw new Error(`unexpected GET ${path}`);
  });
  apiPost.mockResolvedValue({ ok: true, serverNow: NOW });
}

function lockedSnapshot(
  lockReason: NonNullable<CandidateTakeSnapshot["lockReason"]>,
  overrides: Partial<CandidateTakeSnapshot> = {},
): CandidateTakeSnapshot {
  return buildSnapshot({
    attemptStatus:
      lockReason === "submitted"
        ? "submitted"
        : lockReason === "disrupted"
          ? "disrupted"
          : "in_progress",
    isEditable: false,
    canSave: false,
    canSubmit: false,
    lockReason,
    ...overrides,
  });
}

beforeEach(() => {
  apiGet.mockReset();
  apiPost.mockReset();
  takeHandler.mockReset();
});

// Regression for #674: the candidate-facing locked-state overlay matrix.
describe("locked-state presentation matrix", () => {
  it("disrupted: recovery copy + list navigation; NEVER deadline/auto-submit claims", async () => {
    installTakeRoute(lockedSnapshot("disrupted", { canResume: false }));
    renderPage();

    const overlay = await screen.findByTestId("deadline-overlay");
    expect(overlay).toHaveAttribute("data-lock-reason", "disrupted");
    expect(within(overlay).getByText("连接已中断")).toBeInTheDocument();
    expect(
      within(overlay).getByText("请返回考试列表，点击「继续考试」恢复作答。"),
    ).toBeInTheDocument();
    expect(
      within(overlay).queryByText("考试时间已到，答题已结束"),
    ).not.toBeInTheDocument();
    expect(
      within(overlay).queryByText("系统正在自动提交您的答案..."),
    ).not.toBeInTheDocument();
    expect(within(overlay).queryByText("正在恢复考试")).not.toBeInTheDocument();
    expect(screen.getByTestId("lock-back-to-list-btn")).toBeInTheDocument();
  });

  it("deadline: time-up copy, no false auto-submit while the flow is not in flight", async () => {
    installTakeRoute(lockedSnapshot("deadline"));
    renderPage();

    const overlay = await screen.findByTestId("deadline-overlay");
    expect(overlay).toHaveAttribute("data-lock-reason", "deadline");
    expect(
      within(overlay).getByText("考试时间已到，答题已结束"),
    ).toBeInTheDocument();
    expect(
      within(overlay).getByText("本次考试已结束，感谢作答。"),
    ).toBeInTheDocument();
    expect(
      within(overlay).queryByText("系统正在自动提交您的答案..."),
    ).not.toBeInTheDocument();
  });

  it("submitted: terminal copy with no auto-submit claim", async () => {
    installTakeRoute(lockedSnapshot("submitted", { submittedAt: NOW }));
    renderPage();

    const overlay = await screen.findByTestId("deadline-overlay");
    expect(overlay).toHaveAttribute("data-lock-reason", "submitted");
    expect(within(overlay).getByText("考试已结束")).toBeInTheDocument();
    expect(within(overlay).getByText("您的答案已提交。")).toBeInTheDocument();
    expect(
      within(overlay).queryByText("系统正在自动提交您的答案..."),
    ).not.toBeInTheDocument();
    expect(
      within(overlay).queryByText("考试时间已到，答题已结束"),
    ).not.toBeInTheDocument();
  });

  it("voided: terminal voided copy", async () => {
    installTakeRoute(lockedSnapshot("voided"));
    renderPage();

    const overlay = await screen.findByTestId("deadline-overlay");
    expect(overlay).toHaveAttribute("data-lock-reason", "voided");
    expect(within(overlay).getByText("考试已作废")).toBeInTheDocument();
  });

  it("disrupted back-to-list navigates to the exam list", async () => {
    installTakeRoute(lockedSnapshot("disrupted", { canResume: false }));
    renderPage();

    const user = userEvent.setup();
    await screen.findByTestId("deadline-overlay");
    await user.click(screen.getByTestId("lock-back-to-list-btn"));
    expect(await screen.findByText("考试列表页")).toBeInTheDocument();
  });
});
