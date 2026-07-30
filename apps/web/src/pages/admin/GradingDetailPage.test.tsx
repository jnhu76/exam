import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { AuthProvider } from "@/contexts/AuthContext";
import { BrandProvider } from "@/components/layout/BrandProvider";
import { GradingDetailPage } from "./GradingDetailPage";
import { parseScoreInput, validateScore } from "./GradingDetailPage";
import { permissionsForRole } from "@exam/authz";

vi.mock("@/lib/api", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
  setNavigate: () => {},
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
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
      candidateAnswer: null,
      entry: null,
    },
    {
      questionId: "q2",
      type: "single_choice",
      content: "以下哪个是正确的？",
      maxScore: 5,
      candidateAnswer: "Paris",
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
          capabilities: [...permissionsForRole("Admin")],
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

/**
 * Drives the full submit flow for the first question: clicks "提交评分", then
 * clicks "确认提交" in the confirmation dialog. Returns once the confirm
 * action has fired. Used by tests that need the POST to actually be sent.
 */
async function confirmSubmitFirstQuestion(
  user: ReturnType<typeof userEvent.setup>,
) {
  const submitButtons = screen.getAllByText("提交评分");
  await user.click(submitButtons[0]!);
  const confirmBtn = await screen.findByRole("button", {
    name: "确认提交",
  });
  await user.click(confirmBtn);
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

  it("shows empty score input for ungraded questions (not 0)", async () => {
    // Slice 1: a pending question must render an EMPTY input, never 0. The old
    // behavior (`q.entry?.score ?? 0`) conflated "not graded" with "scored 0".
    renderPage();
    await screen.findByText(/期末考试 — 张三/);
    const scoreInputs = screen.getAllByRole("spinbutton");
    expect(scoreInputs[0]).toHaveValue(null);
  });

  it("renders an already-completed score of 0 as 0 (not empty)", async () => {
    // Slice 1: an explicit stored 0 is a real score and must display as 0,
    // distinct from the empty ungraded input above.
    getMock.mockResolvedValue({
      ...mockDetailData,
      questions: [
        {
          questionId: "q-zero",
          type: "text_response",
          content: "零分题",
          maxScore: 10,
          candidateAnswer: "作答",
          entry: {
            score: 0,
            comment: "",
            gradedBy: "admin-1",
            gradedAt: "2025-01-15T12:00:00Z",
          },
        },
      ],
    });
    renderPage();
    await screen.findByText(/期末考试 — 张三/);
    expect(screen.getByDisplayValue("0")).toBeInTheDocument();
  });

  it("rejects an empty score with a field-level '请输入分数' error and does not POST", async () => {
    // Slice 1: clearing/never-entering a score must block submission. The old
    // behavior POSTed score 0 because Number("") === 0.
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(/期末考试 — 张三/);

    // q1 starts empty (pending). Clicking the submit button must not POST and
    // must not open the confirmation dialog (validation fails first).
    const submitButtons = screen.getAllByText("提交评分");
    await user.click(submitButtons[0]!);

    expect(screen.getByText("请输入分数")).toBeInTheDocument();
    expect(postMock).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: "确认提交" }),
    ).not.toBeInTheDocument();
  });

  it("accepts an explicitly entered 0 score as a valid submission", async () => {
    // Slice 1: explicit 0 is a legitimate grade. The grader types "0", confirms,
    // and the POST must carry score: 0.
    postMock.mockResolvedValue(mockGradeResponse);
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(/期末考试 — 张三/);

    const scoreInputs = screen.getAllByRole("spinbutton");
    const firstInput = scoreInputs[0]!;
    await user.type(firstInput, "0");

    await confirmSubmitFirstQuestion(user);

    expect(postMock).toHaveBeenCalledWith(
      "/api/admin/attempts/att-1/grade-question",
      { questionId: "q1", score: 0, comment: "" },
    );
  });

  it("validates score does not exceed maxScore", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(/期末考试 — 张三/);

    const scoreInputs = screen.getAllByRole("spinbutton");
    const firstInput = scoreInputs[0]!;
    await user.clear(firstInput);
    await user.type(firstInput, "15");

    const submitButtons = screen.getAllByText("提交评分");
    await user.click(submitButtons[0]!);

    expect(screen.getByText("分数不能超过满分 (10)")).toBeInTheDocument();
    expect(postMock).not.toHaveBeenCalled();
    // Validation failure must not open the confirmation dialog.
    expect(
      screen.queryByRole("button", { name: "确认提交" }),
    ).not.toBeInTheDocument();
  });

  it("clears the field validation error after a subsequent valid save", async () => {
    // Characterization: the validation error is routed through the score
    // control's field-error role, and is cleared from that control once a
    // valid submission proceeds (handleSubmitClick deletes the error key on the
    // success path). Protects observable behavior, not the primitive class stack.
    postMock.mockResolvedValue(mockGradeResponse);
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(/期末考试 — 张三/);

    const scoreInputs = screen.getAllByRole("spinbutton");
    const firstInput = scoreInputs[0]!;

    // Trigger a validation failure on q1.
    await user.clear(firstInput);
    await user.type(firstInput, "15");
    await user.click(screen.getAllByText("提交评分")[0]!);
    expect(screen.getByText("分数不能超过满分 (10)")).toBeInTheDocument();

    // Correct the score and submit successfully (submit + confirm).
    await user.clear(firstInput);
    await user.type(firstInput, "8");
    await confirmSubmitFirstQuestion(user);
    await vi.waitFor(() => {
      expect(postMock).toHaveBeenCalled();
    });

    // The field-error feedback for q1 is gone.
    expect(screen.queryByText("分数不能超过满分 (10)")).not.toBeInTheDocument();
  });

  it("scopes the score validation error to its own question", async () => {
    // Characterization: a validation failure on one question's score control
    // must not surface as field-error feedback on a different question's
    // score control. Protects per-question error ownership across any DOM
    // restructuring of the score blocks.
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(/期末考试 — 张三/);

    const scoreInputs = screen.getAllByRole("spinbutton");
    const firstInput = scoreInputs[0]!;
    await user.clear(firstInput);
    await user.type(firstInput, "15");

    const submitButtons = screen.getAllByText("提交评分");
    await user.click(submitButtons[0]!);

    // q1 (maxScore 10) over-max → exactly one field-error text node present.
    const errors = screen.getAllByText("分数不能超过满分 (10)");
    expect(errors).toHaveLength(1);
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

    await confirmSubmitFirstQuestion(user);

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

    await confirmSubmitFirstQuestion(user);

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

    await confirmSubmitFirstQuestion(user);

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

    await confirmSubmitFirstQuestion(user);

    expect(postMock).toHaveBeenCalledWith(
      "/api/admin/attempts/att-1/grade-question",
      {
        questionId: "q1",
        score: 8,
        comment: "回答基本完整，但缺少细节",
      },
    );
  });

  it("disables submit button and shows submitting text during save", async () => {
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

    await confirmSubmitFirstQuestion(user);

    expect(await screen.findByText("提交中...")).toBeInTheDocument();
    expect(
      screen.getAllByText("提交中...")[0]!.closest("button"),
    ).toBeDisabled();

    resolvePost!(mockGradeResponse);
    await vi.waitFor(() => {
      expect(screen.queryByText("提交中...")).not.toBeInTheDocument();
    });
  });
});

describe("GradingDetailPage — one-time submission UX (Slice 2)", () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
    getMock.mockResolvedValue(mockDetailData);
  });

  it("shows the irrevocability notice while grading is in progress", async () => {
    renderPage();
    await screen.findByText(/期末考试 — 张三/);
    expect(screen.getByTestId("grading-irrevocable-notice")).toHaveTextContent(
      "评分提交后不可修改",
    );
  });

  it("shows the fully-graded notice and hides the irrevocability notice once terminal", async () => {
    getMock.mockResolvedValue({
      ...mockDetailData,
      gradingStatus: "fully_graded",
      questions: [
        {
          questionId: "q1",
          type: "text_response",
          content: "已评分题",
          maxScore: 10,
          candidateAnswer: "ans",
          entry: {
            score: 8,
            comment: "",
            gradedBy: "admin-1",
            gradedAt: "2025-01-15T12:00:00Z",
          },
        },
      ],
    });
    renderPage();
    await screen.findByText(/期末考试 — 张三/);
    expect(screen.getByTestId("grading-fully-graded-notice")).toHaveTextContent(
      "评分已完成",
    );
    expect(
      screen.queryByTestId("grading-irrevocable-notice"),
    ).not.toBeInTheDocument();
    // No executable submit button once fully graded.
    expect(
      screen.queryByRole("button", { name: "提交评分" }),
    ).not.toBeInTheDocument();
  });

  it("renders a completed question as read-only with submitted metadata", async () => {
    getMock.mockResolvedValue({
      ...mockDetailData,
      questions: [
        {
          questionId: "q-done",
          type: "text_response",
          content: "已完成题",
          maxScore: 10,
          candidateAnswer: "作答",
          entry: {
            score: 7,
            comment: "不错的回答",
            gradedBy: "admin-1",
            gradedAt: "2025-01-15T12:00:00Z",
          },
        },
      ],
    });
    renderPage();
    await screen.findByText(/期末考试 — 张三/);

    // Score + comment inputs are disabled.
    expect(screen.getByTestId("grading-score-input-q-done")).toBeDisabled();
    expect(screen.getByTestId("grading-comment-input-q-done")).toBeDisabled();
    // No submit button for the completed question.
    expect(
      screen.queryByTestId("grading-submit-btn-q-done"),
    ).not.toBeInTheDocument();
    // Submitted metadata block is present.
    expect(screen.getByText("已提交评分")).toBeInTheDocument();
    expect(
      screen.getByTestId("grading-submitted-meta-q-done"),
    ).toHaveTextContent("已评分: 7 分");
    expect(
      screen.getByTestId("grading-submitted-comment-q-done"),
    ).toHaveTextContent("不错的回答");
    // gradedBy is shown as-is (actor id), not a fabricated name.
    expect(
      screen.getByTestId("grading-submitted-grader-q-done"),
    ).toHaveTextContent("admin-1");
    // gradedAt is rendered via the project date formatter.
    expect(
      screen.getByTestId("grading-submitted-time-q-done"),
    ).toBeInTheDocument();
  });

  it("opens a confirmation dialog showing score, max, and irrevocability before posting", async () => {
    postMock.mockResolvedValue(mockGradeResponse);
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(/期末考试 — 张三/);

    const firstInput = screen.getAllByRole("spinbutton")[0]!;
    await user.clear(firstInput);
    await user.type(firstInput, "8");

    // Clicking submit opens the dialog but does NOT post yet.
    await user.click(screen.getAllByText("提交评分")[0]!);
    expect(postMock).not.toHaveBeenCalled();

    expect(
      await screen.findByRole("button", { name: "确认提交" }),
    ).toBeInTheDocument();
    // The dialog shows the score, max score, and the irrevocable statement.
    const dialog = screen
      .getByText("确认提交评分？")
      .closest("[role='alertdialog']")!;
    expect(dialog).toHaveTextContent("分数: 8");
    expect(dialog).toHaveTextContent("满分: 10");
    expect(dialog).toHaveTextContent("提交后不可通过普通阅卷流程修改");
    expect(dialog).toHaveTextContent("取消");

    // Confirming runs the POST.
    await user.click(screen.getByRole("button", { name: "确认提交" }));
    await vi.waitFor(() => {
      expect(postMock).toHaveBeenCalled();
    });
  });

  it("canceling the confirmation dialog does not POST", async () => {
    postMock.mockResolvedValue(mockGradeResponse);
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(/期末考试 — 张三/);

    const firstInput = screen.getAllByRole("spinbutton")[0]!;
    await user.clear(firstInput);
    await user.type(firstInput, "8");
    await user.click(screen.getAllByText("提交评分")[0]!);

    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(postMock).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: "确认提交" }),
    ).not.toBeInTheDocument();
  });

  it("refreshes from the authoritative GET after a successful POST (no client-fabricated state)", async () => {
    // After POST the page must re-GET grading-details and reflect the
    // server-committed entry, not a locally fabricated one.
    postMock.mockResolvedValue(mockGradeResponse);
    getMock.mockResolvedValueOnce(mockDetailData); // initial load
    getMock.mockResolvedValueOnce({
      ...mockDetailData,
      questions: [
        {
          questionId: "q1",
          type: "text_response",
          content: "请简述光合作用的过程",
          maxScore: 10,
          candidateAnswer: null,
          entry: {
            score: 8,
            comment: "",
            gradedBy: "server-grader",
            gradedAt: "2025-02-01T09:30:00Z",
          },
        },
        mockDetailData.questions[1],
      ],
    });
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(/期末考试 — 张三/);

    const firstInput = screen.getAllByRole("spinbutton")[0]!;
    await user.clear(firstInput);
    await user.type(firstInput, "8");
    await confirmSubmitFirstQuestion(user);

    // The refreshed server entry is now shown (server grader id + read-only).
    await vi.waitFor(() => {
      expect(
        screen.getByTestId("grading-submitted-grader-q1"),
      ).toHaveTextContent("server-grader");
    });
    expect(screen.getByTestId("grading-score-input-q1")).toBeDisabled();
    expect(
      screen.queryByTestId("grading-submit-btn-q1"),
    ).not.toBeInTheDocument();
  });
});

describe("GradingDetailPage — ambiguous-result reconciliation (Slice 3)", () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
    getMock.mockResolvedValue(mockDetailData);
  });

  /**
   * Drives a submit that fails the POST: types a valid score, submits,
   * confirms. The POST must have been rejected before reconciliation runs.
   */
  async function submitAndFailPost(user: ReturnType<typeof userEvent.setup>) {
    const firstInput = screen.getAllByRole("spinbutton")[0]!;
    await user.clear(firstInput);
    await user.type(firstInput, "8");
    await confirmSubmitFirstQuestion(user);
    await vi.waitFor(() => {
      expect(postMock).toHaveBeenCalled();
    });
  }

  it("Case A: POST rejects but server shows entry committed → synchronized success, read-only", async () => {
    // The POST's response was lost (network error) but the server actually
    // committed the grade. The page must NOT show a retry error.
    const { toast } = await import("sonner");
    postMock.mockRejectedValue(new Error("Network request failed"));
    // initial load
    getMock.mockResolvedValueOnce(mockDetailData);
    // reconciliation GET: q1 now committed by the server
    getMock.mockResolvedValueOnce({
      ...mockDetailData,
      questions: [
        {
          questionId: "q1",
          type: "text_response",
          content: "请简述光合作用的过程",
          maxScore: 10,
          candidateAnswer: null,
          entry: {
            score: 8,
            comment: "",
            gradedBy: "server-grader",
            gradedAt: "2025-02-01T09:30:00Z",
          },
        },
        mockDetailData.questions[1],
      ],
    });
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(/期末考试 — 张三/);

    await submitAndFailPost(user);

    // Neutral synchronized-success, NOT a failure/retry prompt.
    await vi.waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith(
        "评分已提交，页面已同步最新状态。",
      );
    });
    expect(toast.error).not.toHaveBeenCalled();
    // The question is now read-only from the authoritative refresh.
    expect(screen.getByTestId("grading-score-input-q1")).toBeDisabled();
    expect(
      screen.queryByTestId("grading-submit-btn-q1"),
    ).not.toBeInTheDocument();
    // Only one POST ever fired (no auto-retry).
    expect(postMock).toHaveBeenCalledTimes(1);
  });

  it("Case B: POST rejects and server still pending → real failure, input preserved, editable", async () => {
    const { toast } = await import("sonner");
    postMock.mockRejectedValue(new Error("Network request failed"));
    // initial load + reconciliation GET both return the original pending state
    getMock.mockResolvedValue(mockDetailData);

    const user = userEvent.setup();
    renderPage();
    await screen.findByText(/期末考试 — 张三/);

    await submitAndFailPost(user);

    // Real failure message, NOT a synchronized-success.
    await vi.waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        "评分未提交，请确认网络后重试。",
      );
    });
    expect(toast.success).not.toHaveBeenCalled();
    // Operator input is preserved (the typed 8 is still in the field) and the
    // control stays editable.
    expect(screen.getByTestId("grading-score-input-q1")).toHaveValue(8);
    expect(screen.getByTestId("grading-score-input-q1")).not.toBeDisabled();
    expect(screen.getByTestId("grading-submit-btn-q1")).toBeInTheDocument();
    // No auto-retry.
    expect(postMock).toHaveBeenCalledTimes(1);
  });

  it("Case C: POST rejects and attempt is now fully_graded → status-changed message", async () => {
    const { toast } = await import("sonner");
    postMock.mockRejectedValue(new Error("Network request failed"));
    getMock.mockResolvedValueOnce(mockDetailData); // initial load
    // reconciliation GET: attempt reached terminal state (another grader closed
    // it while our POST was in flight)
    getMock.mockResolvedValueOnce({
      ...mockDetailData,
      gradingStatus: "fully_graded",
      questions: [
        {
          questionId: "q1",
          type: "text_response",
          content: "请简述光合作用的过程",
          maxScore: 10,
          candidateAnswer: null,
          entry: {
            score: 8,
            comment: "",
            gradedBy: "other-grader",
            gradedAt: "2025-02-01T09:30:00Z",
          },
        },
        mockDetailData.questions[1],
      ],
    });
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(/期末考试 — 张三/);

    await submitAndFailPost(user);

    await vi.waitFor(() => {
      expect(toast.info).toHaveBeenCalledWith(
        "阅卷状态已发生变化，已加载最新结果。",
      );
    });
    expect(postMock).toHaveBeenCalledTimes(1);
  });

  it("Failure-of-failure: POST and reconciliation GET both fail → unknown message, no auto-retry", async () => {
    const { toast } = await import("sonner");
    postMock.mockRejectedValue(new Error("Network request failed"));
    // initial load OK, but the reconciliation GET fails too
    getMock.mockResolvedValueOnce(mockDetailData);
    getMock.mockRejectedValueOnce(new Error("Network request failed"));

    const user = userEvent.setup();
    renderPage();
    await screen.findByText(/期末考试 — 张三/);

    await submitAndFailPost(user);

    await vi.waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        "无法确认评分是否已提交，请刷新页面核对。",
      );
    });
    // No success claim, no auto-retry.
    expect(toast.success).not.toHaveBeenCalled();
    expect(postMock).toHaveBeenCalledTimes(1);
  });
});

describe("candidateAnswer rendering", () => {
  const baseData = {
    attemptId: "att-1",
    examId: "exam-1",
    examTitle: "期末考试",
    candidateId: "c1",
    candidateName: "张三",
    gradingStatus: "pending_manual",
  };

  it("renders short text answer", async () => {
    getMock.mockResolvedValue({
      ...baseData,
      questions: [
        {
          questionId: "q1",
          type: "fill_blank",
          content: "法国首都是哪里？",
          maxScore: 10,
          candidateAnswer: "Paris",
          entry: null,
        },
      ],
    });
    renderPage();
    await screen.findByText(/期末考试 — 张三/);
    expect(screen.getByTestId("grading-candidate-answer-q1")).toHaveTextContent(
      "Paris",
    );
  });

  it("shows unanswered label for null candidateAnswer", async () => {
    getMock.mockResolvedValue({
      ...baseData,
      questions: [
        {
          questionId: "q1",
          type: "fill_blank",
          content: "简述光合作用",
          maxScore: 10,
          candidateAnswer: null,
          entry: null,
        },
      ],
    });
    renderPage();
    await screen.findByText(/期末考试 — 张三/);
    expect(screen.getByTestId("grading-candidate-answer-q1")).toHaveTextContent(
      "未作答",
    );
  });

  it("shows unanswered label for empty string candidateAnswer", async () => {
    getMock.mockResolvedValue({
      ...baseData,
      questions: [
        {
          questionId: "q1",
          type: "fill_blank",
          content: "简述光合作用",
          maxScore: 10,
          candidateAnswer: "",
          entry: null,
        },
      ],
    });
    renderPage();
    await screen.findByText(/期末考试 — 张三/);
    expect(screen.getByTestId("grading-candidate-answer-q1")).toHaveTextContent(
      "未作答",
    );
  });

  it("renders long multi-line answer", async () => {
    const longAnswer =
      "光合作用是植物利用光能将二氧化碳和水转化为有机物并释放氧气的过程。" +
      "该过程主要发生在叶绿体中，分为光反应和暗反应两个阶段。" +
      "光反应在类囊体膜上进行，产生ATP和NADPH；暗反应在叶绿体基质中进行，利用ATP和NADPH固定CO2。" +
      "光合作用是地球上几乎所有食物链的能量基础。";
    getMock.mockResolvedValue({
      ...baseData,
      questions: [
        {
          questionId: "q1",
          type: "fill_blank",
          content: "简述光合作用",
          maxScore: 10,
          candidateAnswer: longAnswer,
          entry: null,
        },
      ],
    });
    renderPage();
    await screen.findByText(/期末考试 — 张三/);
    const answerEl = screen.getByTestId("grading-candidate-answer-q1");
    expect(answerEl).toHaveTextContent(longAnswer);
    // The candidate-answer box uses the type-long-response semantic recipe
    // (UI-RECIPE-1A), which owns white-space: pre-wrap as a CSS property
    // rather than a primitive utility class.
    expect(answerEl).toHaveClass("type-long-response");
  });

  it("renders array answer joined by Chinese comma", async () => {
    getMock.mockResolvedValue({
      ...baseData,
      questions: [
        {
          questionId: "q1",
          type: "multiple_choice",
          content: "以下哪些是正确的？",
          maxScore: 10,
          candidateAnswer: ["A", "B", "C"],
          entry: null,
        },
      ],
    });
    renderPage();
    await screen.findByText(/期末考试 — 张三/);
    expect(screen.getByTestId("grading-candidate-answer-q1")).toHaveTextContent(
      "A、B、C",
    );
  });

  it("renders boolean answer as correct/incorrect label", async () => {
    getMock.mockResolvedValue({
      ...baseData,
      questions: [
        {
          questionId: "q1",
          type: "true_false",
          content: "地球是平的",
          maxScore: 5,
          candidateAnswer: false,
          entry: null,
        },
      ],
    });
    renderPage();
    await screen.findByText(/期末考试 — 张三/);
    expect(screen.getByTestId("grading-candidate-answer-q1")).toHaveTextContent(
      "错误",
    );
  });

  it("renders JSON object answer as text values", async () => {
    getMock.mockResolvedValue({
      ...baseData,
      questions: [
        {
          questionId: "q1",
          type: "fill_blank",
          content: "描述你的答案",
          maxScore: 10,
          candidateAnswer: { value: "A", notes: "some notes" },
          entry: null,
        },
      ],
    });
    renderPage();
    await screen.findByText(/期末考试 — 张三/);
    const answerEl = screen.getByTestId("grading-candidate-answer-q1");
    expect(answerEl).toHaveTextContent("A、some notes");
  });

  it("renders HTML/script in answer as plain text, not executed", async () => {
    delete (window as unknown as Record<string, unknown>).__xss;
    const unsafe = "<script>window.__xss = true</script><b>bold</b>";
    getMock.mockResolvedValue({
      ...baseData,
      questions: [
        {
          questionId: "q1",
          type: "fill_blank",
          content: "输入你的答案",
          maxScore: 10,
          candidateAnswer: unsafe,
          entry: null,
        },
      ],
    });
    renderPage();
    await screen.findByText(/期末考试 — 张三/);
    const answerEl = screen.getByTestId("grading-candidate-answer-q1");
    expect(answerEl).toHaveTextContent(unsafe);
    expect(answerEl.querySelector("script")).toBeNull();
    expect(answerEl.querySelector("b")).toBeNull();
    expect(
      (window as unknown as Record<string, unknown>).__xss,
    ).toBeUndefined();
  });

  it("keeps score input visible when candidateAnswer is present", async () => {
    getMock.mockResolvedValue({
      ...baseData,
      questions: [
        {
          questionId: "q1",
          type: "fill_blank",
          content: "法国首都是哪里？",
          maxScore: 10,
          candidateAnswer: "Paris",
          entry: null,
        },
      ],
    });
    renderPage();
    await screen.findByText(/期末考试 — 张三/);
    expect(screen.getByTestId("grading-score-input-q1")).toBeInTheDocument();
    expect(screen.getByTestId("grading-submit-btn-q1")).toBeInTheDocument();
  });
});

describe("frozen grading metadata rendering (P3-MOD-P1-1)", () => {
  const baseData = {
    attemptId: "att-1",
    examId: "exam-1",
    examTitle: "期末考试",
    candidateId: "c1",
    candidateName: "张三",
    gradingStatus: "pending_manual",
  };

  it("renders the frozen standardAnswer and rubric as plain text for text_response", async () => {
    getMock.mockResolvedValue({
      ...baseData,
      questions: [
        {
          questionId: "q1",
          type: "text_response",
          content: "请阐述你的观点",
          maxScore: 20,
          standardAnswer: "参考答案第一行\n参考答案第二行",
          rubric: "评分细则：\n1. 逻辑清晰\n2. 概念准确",
          candidateAnswer: "我的回答",
          entry: null,
        },
      ],
    });
    renderPage();
    await screen.findByText(/期末考试 — 张三/);

    // textContent collapses newlines to spaces; verify the literal text is
    // present, and rely on the whitespace-pre-wrap class assertion (separate
    // test) to prove the line breaks are visually preserved.
    const rubricEl = screen.getByTestId("grading-rubric-q1");
    expect(rubricEl).toHaveTextContent("评分细则：");
    expect(rubricEl).toHaveTextContent("1. 逻辑清晰");
    expect(rubricEl).toHaveTextContent("2. 概念准确");
    expect(rubricEl).toHaveClass("whitespace-pre-wrap");

    const refEl = screen.getByTestId("grading-standard-answer-q1");
    expect(refEl).toHaveTextContent("参考答案第一行");
    expect(refEl).toHaveTextContent("参考答案第二行");
    expect(refEl).toHaveClass("whitespace-pre-wrap");
  });

  it("shows not-set labels when standardAnswer and rubric are null", async () => {
    getMock.mockResolvedValue({
      ...baseData,
      questions: [
        {
          questionId: "q1",
          type: "text_response",
          content: "请阐述你的观点",
          maxScore: 20,
          standardAnswer: null,
          rubric: null,
          candidateAnswer: "我的回答",
          entry: null,
        },
      ],
    });
    renderPage();
    await screen.findByText(/期末考试 — 张三/);
    expect(screen.getByTestId("grading-rubric-q1")).toHaveTextContent("未设置");
    expect(screen.getByTestId("grading-standard-answer-q1")).toHaveTextContent(
      "未设置",
    );
  });

  it("renders rubric and standardAnswer as literal text (no HTML execution)", async () => {
    delete (window as unknown as Record<string, unknown>).__xssMeta;
    const unsafeRubric =
      "<script>window.__xssMeta = true</script><b>rubric</b>";
    const unsafeRef = "<script>window.__xssMeta = true</script><b>ref</b>";
    getMock.mockResolvedValue({
      ...baseData,
      questions: [
        {
          questionId: "q1",
          type: "text_response",
          content: "请阐述你的观点",
          maxScore: 20,
          standardAnswer: unsafeRef,
          rubric: unsafeRubric,
          candidateAnswer: "我的回答",
          entry: null,
        },
      ],
    });
    renderPage();
    await screen.findByText(/期末考试 — 张三/);

    const rubricEl = screen.getByTestId("grading-rubric-q1");
    expect(rubricEl).toHaveTextContent(unsafeRubric);
    expect(rubricEl.querySelector("script")).toBeNull();
    expect(rubricEl.querySelector("b")).toBeNull();
    expect(
      (window as unknown as Record<string, unknown>).__xssMeta,
    ).toBeUndefined();
  });

  it("preserves multiline whitespace-pre-wrap on rubric and standardAnswer", async () => {
    getMock.mockResolvedValue({
      ...baseData,
      questions: [
        {
          questionId: "q1",
          type: "text_response",
          content: "请阐述你的观点",
          maxScore: 20,
          standardAnswer: "行1\n行2\n行3",
          rubric: "细则1\n细则2",
          candidateAnswer: "答案",
          entry: null,
        },
      ],
    });
    renderPage();
    await screen.findByText(/期末考试 — 张三/);
    expect(screen.getByTestId("grading-rubric-q1")).toHaveClass(
      "whitespace-pre-wrap",
    );
    expect(screen.getByTestId("grading-standard-answer-q1")).toHaveClass(
      "whitespace-pre-wrap",
    );
  });

  it("serializes a structured (object/array) standardAnswer as readable JSON", async () => {
    // standardAnswer is typed `z.unknown()` on the wire. Production objective
    // types are flat primitives / arrays of option-id strings, but the schema
    // admits arbitrary structures. A non-primitive must render as readable
    // JSON, not `[object Object]`.
    const structuredRef = {
      criteria: ["逻辑清晰", "概念准确"],
      minExamples: 2,
    };
    getMock.mockResolvedValue({
      ...baseData,
      questions: [
        {
          questionId: "q1",
          type: "text_response",
          content: "请阐述你的观点",
          maxScore: 20,
          standardAnswer: structuredRef,
          rubric: "按对象化评分依据给分",
          candidateAnswer: "我的回答",
          entry: null,
        },
      ],
    });
    renderPage();
    await screen.findByText(/期末考试 — 张三/);

    const refEl = screen.getByTestId("grading-standard-answer-q1");
    // Keys and values are present as readable JSON text.
    expect(refEl).toHaveTextContent('"criteria"');
    expect(refEl).toHaveTextContent("逻辑清晰");
    expect(refEl).toHaveTextContent('"minExamples"');
    // No `[object Object]` leakage.
    expect(refEl).not.toHaveTextContent("[object Object]");
  });
});

describe("parseScoreInput", () => {
  it("rejects an empty string as scoreRequired (not as 0)", () => {
    expect(parseScoreInput("", 10)).toEqual({ error: "请输入分数" });
  });

  it("rejects a whitespace-only string as scoreRequired", () => {
    expect(parseScoreInput("   ", 10)).toEqual({ error: "请输入分数" });
  });

  it("accepts an explicit 0 as a valid score", () => {
    expect(parseScoreInput("0", 10)).toEqual({ score: 0 });
  });

  it("accepts a positive integer score", () => {
    expect(parseScoreInput("8", 10)).toEqual({ score: 8 });
  });

  it("accepts a score equal to maxScore", () => {
    expect(parseScoreInput("10", 10)).toEqual({ score: 10 });
  });

  it("rejects a negative score with the range message", () => {
    expect(parseScoreInput("-1", 10)).toEqual({ error: "分数不能为负数" });
  });

  it("rejects a score exceeding maxScore with the range message", () => {
    expect(parseScoreInput("15", 10)).toEqual({
      error: "分数不能超过满分 (10)",
    });
  });

  it("rejects non-numeric input as scoreRequired", () => {
    expect(parseScoreInput("abc", 10)).toEqual({ error: "请输入分数" });
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
