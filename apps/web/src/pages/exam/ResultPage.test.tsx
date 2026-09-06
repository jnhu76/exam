import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { ResultPage } from "./ResultPage";

vi.mock("@/lib/api", () => ({
  ApiError: class ApiError extends Error {
    readonly status: number;
    readonly message: string;
    readonly code?: string;
    readonly details?: unknown;
    readonly requestId?: string;
    readonly serverMessage?: string;
    constructor(
      status: number,
      message: string,
      code?: string,
      details?: unknown,
      requestId?: string,
      serverMessage?: string,
    ) {
      super(message);
      this.name = "ApiError";
      this.status = status;
      this.message = message;
      this.code = code;
      this.details = details;
      this.requestId = requestId;
      this.serverMessage = serverMessage ?? message;
    }
  },
  api: {
    get: vi.fn(),
  },
}));

const getMock = vi.mocked(api.get);

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/exam/attempt-1/result"]}>
      <Routes>
        <Route path="/exam/:attemptId/result" element={<ResultPage />} />
        <Route path="/exam/list" element={<div>考试列表</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ResultPage", () => {
  beforeEach(() => {
    getMock.mockReset();
  });

  it("shows score card and answer indicators for immediate results", async () => {
    getMock.mockResolvedValue({
      attemptId: "attempt-1",
      status: "graded",
      showResultImmediately: true,
      examTitle: "能力测验",
      passingScore: 6,
      totalScore: 10,
      passed: true,
      gradedAt: "2026-06-01T00:00:00.000Z",
      questionResults: [
        {
          questionId: "q1",
          type: "single_choice",
          content: "选择正确答案",
          order: 0,
          candidateAnswer: "a",
          standardAnswer: "a",
          score: 10,
          maxScore: 10,
          correct: true,
        },
        {
          questionId: "q2",
          type: "single_choice",
          content: "另一题",
          order: 1,
          candidateAnswer: "b",
          standardAnswer: "a",
          score: 0,
          maxScore: 10,
          correct: false,
        },
      ],
    });

    renderPage();

    expect(await screen.findByText("10")).toBeInTheDocument();
    expect(screen.getByText("已通过")).toBeInTheDocument();
    expect(screen.getAllByText("单选题")).toHaveLength(2);
    expect(screen.getByLabelText("回答正确")).toBeInTheDocument();
    expect(screen.getByLabelText("回答错误")).toBeInTheDocument();
  });

  it("shows only waiting state when results are hidden", async () => {
    getMock.mockResolvedValue({
      attemptId: "attempt-1",
      status: "graded",
      showResultImmediately: false,
      examTitle: "能力测验",
    });

    renderPage();

    expect(
      await screen.findByTestId("result-status-message"),
    ).toHaveTextContent("成绩尚未公布");
    expect(screen.queryByText("及格线")).not.toBeInTheDocument();
  });

  it("shows pending_publish message when hiddenReason is pending_publish", async () => {
    getMock.mockResolvedValue({
      attemptId: "attempt-1",
      status: "graded",
      showResultImmediately: false,
      examTitle: "能力测验",
      hiddenReason: "pending_publish",
    });

    renderPage();

    expect(
      await screen.findByTestId("result-status-message"),
    ).toHaveTextContent("成绩正在审核中，将在公布后可见");
  });

  it("shows not_graded message when hiddenReason is not_graded", async () => {
    getMock.mockResolvedValue({
      attemptId: "attempt-1",
      status: "graded",
      showResultImmediately: false,
      examTitle: "能力测验",
      hiddenReason: "not_graded",
    });

    renderPage();

    expect(
      await screen.findByTestId("result-status-message"),
    ).toHaveTextContent("考试尚未完成评分，请等待");
  });

  it("falls back to generic message when hiddenReason is unknown/missing", async () => {
    getMock.mockResolvedValue({
      attemptId: "attempt-1",
      status: "graded",
      showResultImmediately: false,
      examTitle: "能力测验",
      // no hiddenReason → fallback
    });

    renderPage();

    expect(
      await screen.findByTestId("result-status-message"),
    ).toHaveTextContent("成绩尚未公布");
  });

  it("published (visible) result still displays score details", async () => {
    getMock.mockResolvedValue({
      attemptId: "attempt-1",
      status: "graded",
      showResultImmediately: true,
      examTitle: "能力测验",
      passingScore: 6,
      totalScore: 8,
      passed: true,
      gradedAt: "2026-06-01T00:00:00.000Z",
      questionResults: [],
    });

    renderPage();

    expect(await screen.findByText("已通过")).toBeInTheDocument();
    expect(screen.getByText("8")).toBeInTheDocument();
  });

  it("shows '已提交，等待评分' when status is submitted and no score", async () => {
    getMock.mockResolvedValue({
      attemptId: "attempt-1",
      status: "submitted",
      showResultImmediately: false,
      examTitle: "能力测验",
    });

    renderPage();

    expect(
      await screen.findByTestId("result-status-message"),
    ).toHaveTextContent("已提交，等待评分");
    expect(screen.queryByText("正在评分")).not.toBeInTheDocument();
  });

  it("shows '正在评分' when status is grading and no score", async () => {
    getMock.mockResolvedValue({
      attemptId: "attempt-1",
      status: "grading",
      showResultImmediately: false,
      examTitle: "能力测验",
    });

    renderPage();

    expect(
      await screen.findByTestId("result-status-message"),
    ).toHaveTextContent("正在评分");
  });

  it("truncates long fill blank answers with the full value in title", async () => {
    const longAnswer = "这是一个需要在悬停时查看完整内容的较长填空答案";
    getMock.mockResolvedValue({
      attemptId: "attempt-1",
      status: "graded",
      showResultImmediately: true,
      examTitle: "能力测验",
      passingScore: 6,
      totalScore: 10,
      passed: true,
      gradedAt: "2026-06-01T00:00:00.000Z",
      questionResults: [
        {
          questionId: "q1",
          type: "fill_blank",
          content: "填写答案",
          order: 0,
          candidateAnswer: longAnswer,
          standardAnswer: longAnswer,
          score: 10,
          maxScore: 10,
          correct: true,
        },
      ],
    });

    renderPage();

    const truncatedAnswers = await screen.findAllByTitle(longAnswer);
    expect(truncatedAnswers).toHaveLength(2);
    expect(truncatedAnswers[0]).toHaveClass("data-table-overflow-truncate");
    expect(truncatedAnswers[1]).toHaveClass("data-table-overflow-truncate");
  });

  it("navigates back to the exam list", async () => {
    getMock.mockResolvedValue({
      attemptId: "attempt-1",
      status: "graded",
      showResultImmediately: false,
      examTitle: "能力测验",
    });
    renderPage();

    await userEvent.click(
      await screen.findByRole("button", { name: "返回考试列表" }),
    );
    expect(screen.getByText("考试列表")).toBeInTheDocument();
  });

  // ── P3-MOD-P3-2: independent result/answer visibility gates ──────
  // The Candidate result DTO strips standardAnswer server-side and never
  // carries rubric, so the realistic candidate DTO has score visible but NO
  // answer material. These tests prove ResultPage does NOT self-infer answer
  // visibility from score-visible or from grading state — it only renders what
  // the DTO gate says.

  it("P3-2: score visible + answers hidden — renders score but not standardAnswer/rubric", async () => {
    // Realistic candidate DTO: standardAnswer stripped (undefined) by the API,
    // no rubric field. The page must show score/pass and must NOT open an
    // answer-review section just because the score is visible. manualGraded
    // survives the stripping, so only genuinely manual questions keep the
    // "主观题" marker while objective answers render as hidden.
    getMock.mockResolvedValue({
      attemptId: "attempt-1",
      status: "graded",
      showResultImmediately: true,
      examTitle: "P3-2 mixed",
      passingScore: 10,
      totalScore: 25,
      passed: true,
      gradedAt: "2026-07-01T00:00:00.000Z",
      questionResults: [
        {
          questionId: "q-obj",
          type: "single_choice",
          content: "P3-2 objective prompt",
          order: 0,
          candidateAnswer: "a",
          // standardAnswer intentionally ABSENT (server strips it for candidates)
          manualGraded: false,
          score: 10,
          maxScore: 10,
          correct: true,
        },
        {
          questionId: "q-text",
          type: "text_response",
          content: "P3-2 essay prompt",
          order: 1,
          candidateAnswer: "candidate essay",
          // standardAnswer absent; rubric is never in the DTO
          manualGraded: true,
          score: 15,
          maxScore: 20,
          correct: true,
        },
      ],
    });

    renderPage();

    // Score gate open: totalScore + pass render.
    expect(await screen.findByTestId("result-total-score")).toHaveTextContent(
      "25",
    );
    expect(screen.getByText("已通过")).toBeInTheDocument();

    // Answer gate closed (DTO carries no standardAnswer): the objective
    // correct-answer cell renders the hidden placeholder, NOT a real answer
    // and NOT the manual marker.
    expect(screen.getAllByText("—")).toHaveLength(1);
    // The genuinely manual question keeps the manual marker.
    expect(screen.getByText("主观题")).toBeInTheDocument();
    // No rubric is ever rendered by ResultPage (it is not in the DTO contract).
    expect(screen.queryByText(/评分标准|rubric/i)).not.toBeInTheDocument();
  });

  it("P3-2: does not self-release result from grading state when DTO gate is hidden", async () => {
    // Deliberately cross-wired DTO: terminal grading state (graded) BUT the
    // authoritative result gate says hidden. ResultPage must keep the result
    // hidden — it must not infer release from status=graded.
    getMock.mockResolvedValue({
      attemptId: "attempt-1",
      status: "graded",
      showResultImmediately: false,
      hiddenReason: "pending_publish",
      examTitle: "P3-2 manual hidden",
    });

    renderPage();

    // Pending message shows; no score/pass leaked.
    expect(await screen.findByTestId("result-status-message")).toBeVisible();
    expect(screen.queryByTestId("result-total-score")).not.toBeInTheDocument();
    expect(screen.queryByText("已通过")).not.toBeInTheDocument();
  });
});
