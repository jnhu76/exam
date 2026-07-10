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
    expect(answerEl).toHaveClass("whitespace-pre-wrap");
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
    expect(screen.getByTestId("grading-save-btn-q1")).toBeInTheDocument();
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
