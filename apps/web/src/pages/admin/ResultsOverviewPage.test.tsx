import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import { AuthProvider } from "@/contexts/AuthContext";
import { BrandProvider } from "@/components/layout/BrandProvider";
import { ResultsOverviewPage } from "./ResultsOverviewPage";

const apiGet = vi.fn().mockResolvedValue({
  items: [
    {
      id: "exam-open",
      title: "未结束考试",
      status: "published",
      openAt: new Date().toISOString(),
      closeAt: new Date(Date.now() + 3600000).toISOString(),
      passingScore: 60,
      totalScore: 100,
      gradedAttemptCount: 2,
      canViewScores: false,
      scoreViewDisabledReason: "考试尚未结束，暂不能查看成绩",
    },
    {
      id: "exam-empty",
      title: "暂无成绩考试",
      status: "closed",
      openAt: new Date(Date.now() - 86400000).toISOString(),
      closeAt: new Date(Date.now() - 3600000).toISOString(),
      passingScore: 60,
      totalScore: 100,
      gradedAttemptCount: 0,
      canViewScores: false,
      scoreViewDisabledReason: "暂无成绩数据",
    },
    {
      id: "exam-graded",
      title: "已出分考试",
      status: "closed",
      openAt: new Date(Date.now() - 86400000).toISOString(),
      closeAt: new Date(Date.now() - 3600000).toISOString(),
      passingScore: 60,
      totalScore: 100,
      gradedAttemptCount: 3,
      canViewScores: true,
      scoreViewDisabledReason: null,
    },
  ],
});

vi.mock("@/lib/api", () => ({
  api: {
    get: (...args: unknown[]) => apiGet(...args),
  },
  setNavigate: () => {},
}));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/admin/results"]}>
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
            <Route path="/admin/results" element={<ResultsOverviewPage />} />
          </Routes>
        </BrandProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("ResultsOverviewPage", () => {
  it("disables score viewing for ineligible exams and keeps graded exams clickable", async () => {
    renderPage();

    expect(await screen.findByText("成绩查询")).toBeInTheDocument();

    const buttons = await screen.findAllByRole("button", { name: "查看成绩" });
    expect(buttons).toHaveLength(3);
    expect(buttons[0]).toBeDisabled();
    expect(buttons[1]).toBeDisabled();
    expect(buttons[2]).toBeEnabled();
  });
});
