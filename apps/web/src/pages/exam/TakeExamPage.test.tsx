import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "@/contexts/AuthContext";
import { BrandProvider } from "@/components/layout/BrandProvider";
import { TakeExamPage } from "./TakeExamPage";

const { apiGet, apiPost, mockAttempt } = vi.hoisted(() => {
  const mockAttempt = {
    id: "att-1",
    examId: "exam-1",
    status: "in_progress",
    score: null,
    deadlineAt: new Date(Date.now() + 3600000).toISOString(),
    questionSnapshot: [
      {
        originalQuestionId: "q1",
        type: "true_false",
        content: "地球是圆的",
        score: 10,
        options: null,
        standardAnswer: true,
      },
      {
        originalQuestionId: "q2",
        type: "true_false",
        content: "水是透明的",
        score: 15,
        options: null,
        standardAnswer: true,
      },
    ],
    answers: [],
    startedAt: new Date().toISOString(),
    submittedAt: null,
  };
  return {
    apiGet: vi.fn().mockResolvedValue(mockAttempt),
    apiPost: vi.fn().mockResolvedValue({ ok: true }),
    mockAttempt,
  };
});

vi.mock("@/lib/api", () => ({
  api: {
    get: (...args: unknown[]) => apiGet(...args),
    post: (...args: unknown[]) => apiPost(...args),
  },
  setNavigate: () => {},
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="current-path">{location.pathname}</span>;
}

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
        }}
      >
        <BrandProvider>
          <Routes>
            <Route
              path="/exam/:examId/take/:attemptId"
              element={<TakeExamPage />}
            />
            <Route path="/exam/:attemptId/result" element={<LocationProbe />} />
            <Route path="/exam/list" element={<LocationProbe />} />
          </Routes>
        </BrandProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.useRealTimers();
  apiGet.mockReset();
  apiPost.mockReset();
  apiGet.mockResolvedValue(mockAttempt);
  apiPost.mockResolvedValue({ ok: true });
});

describe("TakeExamPage smoke", () => {
  it("loads attempt and renders question content", async () => {
    renderPage();

    expect(await screen.findByText("地球是圆的")).toBeInTheDocument();
    expect(screen.getAllByText(/第 1 题/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/共 2 题/).length).toBeGreaterThanOrEqual(1);
  });

  it("shows question count in header", async () => {
    renderPage();

    expect(await screen.findByText("答题中")).toBeInTheDocument();
    expect(
      screen.getAllByText(/第 1 题 \/ 共 2 题/).length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("shows submit button", async () => {
    renderPage();

    expect(
      await screen.findByRole("button", { name: "交卷" }),
    ).toBeInTheDocument();
  });

  it("navigates between questions", async () => {
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText("地球是圆的")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "下一题" }));

    await waitFor(() => {
      expect(screen.getByText("水是透明的")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "上一题" }));

    await waitFor(() => {
      expect(screen.getByText("地球是圆的")).toBeInTheDocument();
    });
  });

  it("shows submit confirmation dialog with unanswered count", async () => {
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText("地球是圆的")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "交卷" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/题未作答/)).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "确认交卷" }),
    ).toBeInTheDocument();
  });

  it("submits exam and navigates to result", async () => {
    const user = userEvent.setup();
    apiPost.mockResolvedValueOnce({ score: 10 });

    renderPage();

    expect(await screen.findByText("地球是圆的")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "交卷" }));

    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "确认交卷" }));

    await waitFor(() => {
      expect(screen.getByTestId("current-path")).toHaveTextContent("/result");
    });
  });

  it("shows answered/unanswered counts in footer", async () => {
    renderPage();

    expect(
      (await screen.findAllByText(/已答 0/)).length,
    ).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/未答 2/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/共 2 题/).length).toBeGreaterThanOrEqual(1);
  });

  it("shows an error state when attempt loading fails", async () => {
    apiGet.mockRejectedValueOnce(new Error("network error"));

    renderPage();

    expect(
      await screen.findByText("无法加载答题记录，请检查连接后重试"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
  });

  it("highlights timer when less than five minutes remain", async () => {
    apiGet.mockResolvedValueOnce({
      ...mockAttempt,
      deadlineAt: new Date(Date.now() + 295000).toISOString(),
    });

    renderPage();

    const timer = await screen.findByText(/04:5\d/);
    expect(timer.closest("div")).toHaveClass("text-destructive");
  });

  it("shows disconnected feedback when answer save fails", async () => {
    apiGet.mockResolvedValueOnce({
      ...mockAttempt,
      questionSnapshot: [
        {
          originalQuestionId: "q1",
          type: "fill_blank",
          content: "通行确认码是____",
          score: 10,
          options: [],
        },
      ],
    });
    apiPost.mockRejectedValueOnce(new Error("offline"));

    renderPage();

    const input = await screen.findByLabelText("第1空答案");
    const user = userEvent.setup();
    await user.type(input, "A");

    expect(
      await screen.findByText("连接异常", {}, { timeout: 3000 }),
    ).toBeInTheDocument();
    expect(screen.getByText("保存失败")).toBeInTheDocument();
  });

  it("renders fill_blank input and saves the answer", async () => {
    apiGet.mockResolvedValueOnce({
      ...mockAttempt,
      questionSnapshot: [
        {
          originalQuestionId: "q1",
          type: "fill_blank",
          content: "安全出口标识的颜色是____色",
          score: 10,
          options: [],
        },
      ],
    });

    renderPage();

    const input = await screen.findByLabelText("第1空答案");
    const user = userEvent.setup();
    await user.type(input, "绿");

    await waitFor(
      () => {
        expect(apiPost).toHaveBeenCalledWith(
          "/api/attempts/att-1/answers/q1",
          expect.objectContaining({
            attemptId: "att-1",
            questionId: "q1",
            answer: "绿",
          }),
        );
      },
      { timeout: 3000 },
    );
  });
});
