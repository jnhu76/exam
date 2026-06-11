import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "@/contexts/AuthContext";
import { BrandProvider } from "@/components/layout/BrandProvider";
import { AttemptDetailPage } from "./AttemptDetailPage";

const { apiGet } = vi.hoisted(() => ({
  apiGet: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: {
    get: (...args: unknown[]) => apiGet(...args),
  },
  setNavigate: () => {},
}));

function renderPage(attemptId = "attempt-1") {
  return render(
    <MemoryRouter initialEntries={[`/admin/attempts/${attemptId}`]}>
      <AuthProvider
        initialUser={{
          id: "1",
          username: "admin",
          name: "Admin",
          role: "Admin",
          organizationId: "org1",
        }}
      >
        <BrandProvider>
          <Routes>
            <Route path="/admin/attempts/:id" element={<AttemptDetailPage />} />
          </Routes>
        </BrandProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

const mockGradedResult = {
  attemptId: "attempt-1",
  status: "graded" as const,
  showResultImmediately: true as const,
  examTitle: "期末考试",
  passingScore: 60,
  totalScore: 100,
  passed: true,
  gradedAt: new Date().toISOString(),
  questionResults: [
    {
      questionId: "q1",
      score: 10,
      maxScore: 10,
      correct: true,
      candidateAnswer: "A",
      standardAnswer: "A",
      type: "single_choice",
      content: "Question 1",
      order: 1,
    },
    {
      questionId: "q2",
      score: 5,
      maxScore: 10,
      correct: false,
      candidateAnswer: "B",
      standardAnswer: "A",
      type: "single_choice",
      content: "Question 2",
      order: 2,
    },
  ],
};

describe("AttemptDetailPage", () => {
  beforeEach(() => {
    apiGet.mockReset();
  });

  it("displays earned score (sum of question scores) not totalScore", async () => {
    apiGet.mockResolvedValue(mockGradedResult);
    renderPage();

    await screen.findByText("成绩概览");

    const earnedScoreEl = screen.getByTestId("earned-score");
    expect(earnedScoreEl).toHaveTextContent("15");

    expect(screen.getByText("100")).toBeInTheDocument();
  });

  it("shows green for passed, red for failed", async () => {
    apiGet.mockResolvedValue({ ...mockGradedResult, passed: true });
    renderPage();
    await screen.findByText("成绩概览");

    const earnedScoreEl = screen.getByTestId("earned-score");
    expect(earnedScoreEl.className).toContain("text-success");

    expect(screen.getByText("及格")).toBeInTheDocument();
  });

  it("shows destructive color for failed attempt", async () => {
    apiGet.mockResolvedValue({ ...mockGradedResult, passed: false });
    renderPage();
    await screen.findByText("成绩概览");

    const earnedScoreEl = screen.getByTestId("earned-score");
    expect(earnedScoreEl.className).toContain("text-destructive");

    expect(screen.getByText("不及格")).toBeInTheDocument();
  });

  it("shows passing score", async () => {
    apiGet.mockResolvedValue(mockGradedResult);
    renderPage();
    await screen.findByText("成绩概览");
    expect(screen.getByText("60")).toBeInTheDocument();
  });

  it("shows error when result is not graded", async () => {
    apiGet.mockResolvedValue({
      attemptId: "attempt-1",
      status: "pending",
      showResultImmediately: false,
      examTitle: "期末考试",
    });
    renderPage();
    expect(
      await screen.findByText("该尝试尚未完成评分或结果不可见"),
    ).toBeInTheDocument();
  });

  it("shows loading state", () => {
    apiGet.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("shows error state on API failure", async () => {
    apiGet.mockRejectedValue(new Error("fail"));
    renderPage();
    expect(await screen.findByText("加载尝试详情失败")).toBeInTheDocument();
  });

  it("renders question results table", async () => {
    apiGet.mockResolvedValue(mockGradedResult);
    renderPage();
    await screen.findByText("答题详情");
    expect(screen.getByText("Question 1")).toBeInTheDocument();
    expect(screen.getByText("Question 2")).toBeInTheDocument();
    expect(screen.getAllByText("A").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("B").length).toBeGreaterThanOrEqual(1);
  });

  it("renders question type labels from shared constants", async () => {
    apiGet.mockResolvedValue({
      ...mockGradedResult,
      questionResults: [
        ...mockGradedResult.questionResults,
        {
          questionId: "q3",
          score: 8,
          maxScore: 10,
          correct: true,
          candidateAnswer: "foo",
          standardAnswer: "foo",
          type: "fill_blank",
          content: "Question 3",
          order: 3,
        },
      ],
    });
    renderPage();
    await screen.findByText("答题详情");
    expect(screen.getAllByText("单选").length).toBe(2);
    expect(screen.getByText("填空")).toBeInTheDocument();
  });
});
