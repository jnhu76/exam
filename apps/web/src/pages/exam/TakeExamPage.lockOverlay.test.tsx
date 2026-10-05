import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "@/contexts/AuthContext";
import { BrandProvider } from "@/components/layout/BrandProvider";
import { TakeExamPage } from "./TakeExamPage";
import type { CandidateTakeSnapshot } from "@exam/contracts";
import { permissionsForRole } from "@exam/authz";

/**
 * #674 — locked-state presentation matrix. The overlay branches on the
 * AUTHORITATIVE snapshot lockReason; each cause states only what is true:
 * disrupted never claims deadline/auto-submit; deadline copy appears only
 * for the deadline reason; submitted/voided show terminal copy with a valid
 * next action.
 */

const NOW = "2026-07-04T10:00:00.000Z";
const DEADLINE = "2026-07-04T11:00:00.000Z";

function buildSnapshot(
  overrides: Partial<CandidateTakeSnapshot> = {},
): CandidateTakeSnapshot {
  return {
    attemptId: "att-1",
    examId: "exam-1",
    attemptStatus: "in_progress",
    timingMode: "timed_window",
    gradingStatus: "auto_graded",
    isEditable: true,
    canStart: false,
    canResume: false,
    canSave: true,
    canSubmit: true,
    lockReason: undefined,
    resultVisibility: "hidden",
    answerVisibility: "hidden",
    submittedAt: null,
    serverNow: NOW,
    effectiveDeadline: DEADLINE,
    serverRevision: NOW,
    questions: [
      {
        id: "q1",
        type: "single_choice",
        prompt: "选择一项",
        promptDocument: null,
        answerMode: "plain" as const,
        options: [
          { id: "opt-a", content: "A", contentDocument: null },
          { id: "opt-b", content: "B", contentDocument: null },
        ],
        inputMode: "choice",
        maxScore: 10,
        answerValue: null,
        answerSource: "none",
      },
    ],
    ...overrides,
  };
}

const { apiGet, apiPost, takeHandler } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  takeHandler: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  ApiError: class ApiError extends Error {
    readonly status: number;
    readonly code?: string;
    readonly details?: unknown;
    constructor(
      status: number,
      message: string,
      code?: string,
      details?: unknown,
    ) {
      super(message);
      this.name = "ApiError";
      this.status = status;
      this.message = message;
      this.code = code;
      this.details = details;
    }
  },
  api: {
    get: (...args: unknown[]) => apiGet(...args),
    post: (...args: unknown[]) => apiPost(...args),
  },
  setNavigate: () => {},
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/exam/exam-1/take/att-1"]}>
      <AuthProvider
        initialUser={{
          id: "c1",
          username: "candidate",
          name: "Candidate",
          role: "Candidate",
          organizationId: "org1",
          capabilities: [...permissionsForRole("Candidate")],
        }}
      >
        <BrandProvider>
          <Routes>
            <Route
              path="/exam/:examId/take/:attemptId"
              element={<TakeExamPage />}
            />
            <Route path="/exam/list" element={<div>考试列表页</div>} />
            <Route path="/exam/:attemptId/result" element={<div>结果页</div>} />
          </Routes>
        </BrandProvider>
      </AuthProvider>
    </MemoryRouter>,
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

  it("disrupted + canResume: the explicit restore command fires and the page recovers", async () => {
    installTakeRoute(
      lockedSnapshot("disrupted", { canResume: true }),
      buildSnapshot(),
    );
    renderPage();

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith("/api/attempts/att-1/restore");
    });
    // The re-read applies the restored (editable) snapshot — the recovery
    // action is the REAL restore command, not an invented UI API.
    await waitFor(() => {
      expect(screen.getByRole("radio", { name: "A" })).toBeEnabled();
    });
    expect(screen.queryByTestId("deadline-overlay")).not.toBeInTheDocument();
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
