import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { AuthProvider } from "@/contexts/AuthContext";
import { BrandProvider } from "@/components/layout/BrandProvider";
import { TakeExamPage } from "./TakeExamPage";

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

const apiGet = vi.fn().mockResolvedValue(mockAttempt);
const apiPost = vi.fn().mockResolvedValue({ ok: true });

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

describe("TakeExamPage smoke", () => {
  it("loads attempt and renders question content", async () => {
    renderPage();

    expect(await screen.findByText("地球是圆的")).toBeInTheDocument();
    expect(screen.getByText(/第 1 题/)).toBeInTheDocument();
    expect(screen.getByText(/共 2 题/)).toBeInTheDocument();
  });

  it("shows question count in header", async () => {
    renderPage();

    expect(await screen.findByText("2题")).toBeInTheDocument();
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

    await user.click(screen.getByRole("button", { name: "下一题 ▶" }));

    await waitFor(() => {
      expect(screen.getByText("水是透明的")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "◀ 上一题" }));

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

    expect(await screen.findByText(/已答 0/)).toBeInTheDocument();
    expect(screen.getByText(/未答 2/)).toBeInTheDocument();
    expect(screen.getByText(/共 2 题/)).toBeInTheDocument();
  });
});
