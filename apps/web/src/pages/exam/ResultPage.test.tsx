import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { ResultPage } from "./ResultPage";

vi.mock("@/lib/api", () => ({
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
    expect(truncatedAnswers[0]).toHaveClass("truncate");
    expect(truncatedAnswers[1]).toHaveClass("truncate");
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
});
