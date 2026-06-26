import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { AuthProvider } from "@/contexts/AuthContext";
import { BrandProvider } from "@/components/layout/BrandProvider";
import { GradingDetailPage } from "./GradingDetailPage";
import { validateScore } from "./GradingDetailPage";

vi.mock("@/lib/api", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
  setNavigate: () => {},
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const getMock = vi.mocked(api.get);
const postMock = vi.mocked(api.post);

const mockDetailData = {
  attemptId: "att-1",
  examId: "exam-1",
  examTitle: "期末考试",
  candidateId: "c1",
  candidateName: "张三",
  gradingStatus: "pending_manual",
  questions: [
    {
      questionId: "q1",
      type: "fill_blank",
      content: "请简述光合作用的过程",
      maxScore: 10,
      entry: null,
    },
    {
      questionId: "q2",
      type: "single_choice",
      content: "以下哪个是正确的？",
      maxScore: 5,
      entry: {
        score: 4,
        comment: "基本正确",
        gradedBy: "admin-1",
        gradedAt: "2025-01-15T12:00:00Z",
      },
    },
  ],
};

const mockGradeResponse = {
  attemptId: "att-1",
  gradingStatus: "pending_manual",
  questionId: "q1",
  score: 8,
  fullyGraded: false,
};

const mockFullyGradedResponse = {
  attemptId: "att-1",
  gradingStatus: "fully_graded",
  questionId: "q1",
  score: 8,
  fullyGraded: true,
};

function renderPage(attemptId = "att-1") {
  return render(
    <MemoryRouter initialEntries={[`/admin/grading-queue/${attemptId}`]}>
      <AuthProvider
        initialUser={{
          id: "admin-1",
          username: "admin",
          name: "Admin",
          role: "Admin",
          organizationId: "org1",
        }}
      >
        <BrandProvider>
          <Routes>
            <Route
              path="/admin/grading-queue/:id"
              element={<GradingDetailPage />}
            />
          </Routes>
        </BrandProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("GradingDetailPage", () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
    getMock.mockResolvedValue(mockDetailData);
  });

  it("renders attempt info and questions", async () => {
    renderPage();
    expect(await screen.findByText(/期末考试 — 张三/)).toBeInTheDocument();
    expect(screen.getByText("请简述光合作用的过程")).toBeInTheDocument();
    expect(screen.getByText("以下哪个是正确的？")).toBeInTheDocument();
  });

  it("shows existing grading entry for scored questions", async () => {
    renderPage();
    await screen.findByText(/期末考试 — 张三/);
    expect(screen.getByDisplayValue("4")).toBeInTheDocument();
    expect(screen.getByDisplayValue("基本正确")).toBeInTheDocument();
  });

  it("shows empty score input for ungraded questions", async () => {
    renderPage();
    await screen.findByText(/期末考试 — 张三/);
    const scoreInputs = screen.getAllByRole("spinbutton");
    expect(scoreInputs[0]).toHaveValue(0);
  });

  it("validates score does not exceed maxScore", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(/期末考试 — 张三/);

    const scoreInputs = screen.getAllByRole("spinbutton");
    const firstInput = scoreInputs[0]!;
    await user.clear(firstInput);
    await user.type(firstInput, "15");

    const saveButtons = screen.getAllByText("保存");
    await user.click(saveButtons[0]!);

    expect(screen.getByText("分数不能超过满分 (10)")).toBeInTheDocument();
    expect(postMock).not.toHaveBeenCalled();
  });

  it("submits score on save", async () => {
    postMock.mockResolvedValue(mockGradeResponse);
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(/期末考试 — 张三/);

    const scoreInputs = screen.getAllByRole("spinbutton");
    const firstInput = scoreInputs[0]!;
    await user.clear(firstInput);
    await user.type(firstInput, "8");

    const saveButtons = screen.getAllByText("保存");
    await user.click(saveButtons[0]!);

    expect(postMock).toHaveBeenCalledWith(
      "/api/admin/attempts/att-1/grade-question",
      { questionId: "q1", score: 8, comment: "" },
    );
  });

  it("shows success toast after saving", async () => {
    const { toast } = await import("sonner");
    postMock.mockResolvedValue(mockGradeResponse);
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(/期末考试 — 张三/);

    const scoreInputs = screen.getAllByRole("spinbutton");
    const firstInput = scoreInputs[0]!;
    await user.clear(firstInput);
    await user.type(firstInput, "8");

    const saveButtons = screen.getAllByText("保存");
    await user.click(saveButtons[0]!);

    await vi.waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith("评分已保存");
    });
  });

  it("shows fully graded status when all questions scored", async () => {
    const { toast } = await import("sonner");
    postMock.mockResolvedValue(mockFullyGradedResponse);
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(/期末考试 — 张三/);

    const scoreInputs = screen.getAllByRole("spinbutton");
    const firstInput = scoreInputs[0]!;
    await user.clear(firstInput);
    await user.type(firstInput, "8");

    const saveButtons = screen.getAllByText("保存");
    await user.click(saveButtons[0]!);

    await vi.waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith("评分已完成");
    });
  });

  it("shows loading then data", async () => {
    renderPage();
    expect(screen.getByText("加载中...")).toBeInTheDocument();
    expect(await screen.findByText(/期末考试 — 张三/)).toBeInTheDocument();
  });

  it("shows error on fetch failure", async () => {
    getMock.mockRejectedValue(new Error("fail"));
    renderPage();
    expect(await screen.findByText("加载评分详情失败")).toBeInTheDocument();
  });

  it("submits non-empty comment with score", async () => {
    postMock.mockResolvedValue(mockGradeResponse);
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(/期末考试 — 张三/);

    const scoreInputs = screen.getAllByRole("spinbutton");
    const firstInput = scoreInputs[0]!;
    await user.clear(firstInput);
    await user.type(firstInput, "8");

    const commentInputs = screen.getAllByPlaceholderText("输入评语...");
    await user.type(commentInputs[0]!, "回答基本完整，但缺少细节");

    const saveButtons = screen.getAllByText("保存");
    await user.click(saveButtons[0]!);

    expect(postMock).toHaveBeenCalledWith(
      "/api/admin/attempts/att-1/grade-question",
      {
        questionId: "q1",
        score: 8,
        comment: "回答基本完整，但缺少细节",
      },
    );
  });

  it("disables save button and shows saving text during save", async () => {
    let resolvePost: (v: unknown) => void;
    postMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePost = resolve;
        }),
    );
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(/期末考试 — 张三/);

    const scoreInputs = screen.getAllByRole("spinbutton");
    const firstInput = scoreInputs[0]!;
    await user.clear(firstInput);
    await user.type(firstInput, "8");

    const saveButtons = screen.getAllByText("保存");
    await user.click(saveButtons[0]!);

    expect(await screen.findByText("保存中...")).toBeInTheDocument();
    expect(
      screen.getAllByText("保存中...")[0]!.closest("button"),
    ).toBeDisabled();

    resolvePost!(mockGradeResponse);
    await vi.waitFor(() => {
      expect(screen.queryByText("保存中...")).not.toBeInTheDocument();
    });
  });
});

describe("validateScore", () => {
  it("returns null for valid score", () => {
    expect(validateScore(5, 10)).toBeNull();
  });

  it("returns null for zero score", () => {
    expect(validateScore(0, 10)).toBeNull();
  });

  it("returns null for score equal to maxScore", () => {
    expect(validateScore(10, 10)).toBeNull();
  });

  it("returns error for negative score", () => {
    expect(validateScore(-1, 10)).toBe("分数不能为负数");
  });

  it("returns error when score exceeds maxScore", () => {
    expect(validateScore(15, 10)).toBe("分数不能超过满分 (10)");
  });

  it("does not white-screen on a malformed/null response (shows a retryable error)", async () => {
    // A null body causes a downstream TypeError that the page catches; the
    // key behavior is "no white screen" — a retryable ErrorState is shown.
    getMock.mockResolvedValue(null);
    renderPage();
    // Either the catch-block message or the !data fallback message is fine;
    // both are visible error states with a retry button.
    await screen.findByRole("alert");
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
  });
});
