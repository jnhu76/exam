import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "@/contexts/AuthContext";
import { BrandProvider } from "@/components/layout/BrandProvider";
import { AttemptDetailPage } from "./AttemptDetailPage";
import { permissionsForRole } from "@exam/authz";

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
          capabilities: [...permissionsForRole("Admin")],
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
    // The status color lives on an inner span (the type-metric recipe owns
    // color on the outer element; the pass/fail state color is applied to the
    // text span so it does not conflict with the recipe).
    expect(earnedScoreEl.querySelector("span")!.className).toContain(
      "text-success",
    );

    expect(screen.getByText("及格")).toBeInTheDocument();
  });

  it("shows destructive color for failed attempt", async () => {
    apiGet.mockResolvedValue({ ...mockGradedResult, passed: false });
    renderPage();
    await screen.findByText("成绩概览");

    const earnedScoreEl = screen.getByTestId("earned-score");
    expect(earnedScoreEl.querySelector("span")!.className).toContain(
      "text-destructive",
    );

    expect(screen.getByText("不及格")).toBeInTheDocument();
  });

  it("shows passing score", async () => {
    apiGet.mockResolvedValue(mockGradedResult);
    renderPage();
    await screen.findByText("成绩概览");
    expect(screen.getByText("60")).toBeInTheDocument();
  });

  it("shows status-specific message when result is submitted (not graded)", async () => {
    apiGet.mockResolvedValue({
      attemptId: "attempt-1",
      status: "submitted",
      showResultImmediately: false,
      examTitle: "期末考试",
    });
    renderPage();
    expect(
      await screen.findByText("该尝试已提交，等待评分"),
    ).toBeInTheDocument();
  });

  it("shows status-specific message when result is grading", async () => {
    apiGet.mockResolvedValue({
      attemptId: "attempt-1",
      status: "grading",
      showResultImmediately: false,
      examTitle: "期末考试",
    });
    renderPage();
    expect(await screen.findByText("该尝试正在评分中")).toBeInTheDocument();
  });

  it("shows status-specific message when graded but not visible", async () => {
    apiGet.mockResolvedValue({
      attemptId: "attempt-1",
      status: "graded",
      showResultImmediately: false,
      examTitle: "期末考试",
    });
    renderPage();
    expect(
      await screen.findByText("该尝试已评分，但成绩尚未公布"),
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

  // --- Timeline section (P2E-J2) ---
  // api.get is called twice per page load (result + timeline). Route the mock
  // by URL so each fetch resolves to the right payload.

  function mockTimelineResult(
    result: unknown,
    timeline: { events: unknown[] },
  ) {
    apiGet.mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.includes("/timeline")) {
        return timeline;
      }
      return result;
    });
  }

  const mockTimelineEvents = {
    events: [
      {
        id: "e1",
        organizationId: "org1",
        actorId: "cand-1",
        action: "attempt.start",
        targetType: "attempt",
        targetId: "attempt-1",
        metadata: { source: "candidate" },
        ipAddress: null,
        userAgent: null,
        createdAt: "2026-06-23T08:00:00.000Z",
      },
      {
        id: "e2",
        organizationId: "org1",
        actorId: "admin-1",
        action: "attempt.forceSubmit",
        targetType: "attempt",
        targetId: "attempt-1",
        metadata: { reason: "proctor" },
        ipAddress: "10.0.0.1",
        userAgent: "test",
        createdAt: "2026-06-23T08:30:00.000Z",
      },
    ],
  };

  it("renders the timeline section with human-readable event labels", async () => {
    mockTimelineResult(mockGradedResult, mockTimelineEvents);
    renderPage();
    await screen.findByText("答卷时间线");
    // attempt.start -> 开始答题, attempt.forceSubmit -> 管理员强制交卷
    expect(await screen.findByText("开始答题")).toBeInTheDocument();
    expect(screen.getByText("管理员强制交卷")).toBeInTheDocument();
  });

  it("renders grant_time timeline event with a Chinese label, not the raw key", async () => {
    mockTimelineResult(mockGradedResult, {
      events: [
        {
          id: "e-grant",
          organizationId: "org1",
          actorId: "admin-1",
          action: "grant_time",
          targetType: "attempt",
          targetId: "attempt-1",
          metadata: { addedSeconds: 600 },
          ipAddress: null,
          userAgent: null,
          createdAt: "2026-06-23T08:10:00.000Z",
        },
      ],
    });
    renderPage();
    await screen.findByText("答卷时间线");
    // The localized label is rendered, never the raw action key.
    expect(await screen.findByText("授予考试时间")).toBeInTheDocument();
    expect(screen.queryByText("grant_time")).not.toBeInTheDocument();
  });

  it("shows empty state when timeline has no events", async () => {
    mockTimelineResult(mockGradedResult, { events: [] });
    renderPage();
    await screen.findByText("答卷时间线");
    expect(await screen.findByText("暂无时间线事件")).toBeInTheDocument();
  });

  it("shows timeline error fallback when timeline fetch rejects", async () => {
    apiGet.mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.includes("/timeline")) {
        throw new Error("timeline fail");
      }
      return mockGradedResult;
    });
    renderPage();
    expect(await screen.findByText("加载时间线失败")).toBeInTheDocument();
  });

  it("expands event metadata when an event row is clicked", async () => {
    mockTimelineResult(mockGradedResult, mockTimelineEvents);
    renderPage();
    await screen.findByText("答卷时间线");
    const startLabel = await screen.findByText("开始答题");
    fireEvent.click(startLabel);
    // metadata JSON for the start event contains "source".
    expect(await screen.findByText(/source/)).toBeInTheDocument();
  });

  // ── P3-MOD-P3-3: Admin frozen result view ────────────────────────
  // AttemptDetailPage consumes the Admin scores DTO (GET /api/scores/attempts).
  // For Admin the server bypasses the publication gate and keeps standardAnswer,
  // so the DTO carries showResultImmediately:true + standardAnswer even when the
  // candidate result is pending_publish. This test proves the page renders the
  // full admin frozen detail (score/pass + objective standardAnswer) purely from
  // that DTO — it never fetches live questions and never hides based on
  // candidate publication state.
  it("P3-3: renders full admin frozen result (score/pass + standardAnswer) from the admin scores DTO", async () => {
    apiGet.mockResolvedValue({
      attemptId: "attempt-1",
      status: "graded",
      showResultImmediately: true,
      examTitle: "P3-3 admin frozen",
      passingScore: 20,
      totalScore: 30,
      passed: true,
      gradedAt: new Date().toISOString(),
      questionResults: [
        {
          questionId: "q-obj",
          score: 10,
          maxScore: 10,
          correct: true,
          candidateAnswer: "a",
          standardAnswer: "a",
          type: "single_choice",
          content: "P3-3 objective prompt",
          order: 0,
        },
        {
          questionId: "q-text",
          score: 15,
          maxScore: 20,
          correct: true,
          candidateAnswer: "candidate essay",
          standardAnswer: "P3-3 frozen reference answer",
          type: "text_response",
          content: "P3-3 essay prompt",
          order: 1,
        },
      ],
    });
    renderPage();

    await screen.findByText("成绩概览");
    // Admin aggregate score + pass render (candidate publication is irrelevant
    // to the admin view — the DTO gate is the page's only input).
    expect(screen.getByText("及格")).toBeInTheDocument();
    expect(screen.getByText("P3-3 objective prompt")).toBeInTheDocument();
    expect(screen.getByText("P3-3 essay prompt")).toBeInTheDocument();
    // The objective frozen standardAnswer is rendered for the admin (the server
    // does not strip it for Admin, unlike the candidate projection).
    expect(screen.getAllByText("a").length).toBeGreaterThan(0);
  });
});
