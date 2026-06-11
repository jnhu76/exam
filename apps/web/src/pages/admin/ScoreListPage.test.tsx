import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { AuthProvider } from "@/contexts/AuthContext";
import { BrandProvider } from "@/components/layout/BrandProvider";
import { ScoreListPage } from "./ScoreListPage";

vi.mock("@/lib/api", () => ({
  api: {
    get: vi.fn(),
  },
  setNavigate: () => {},
}));

const getMock = vi.mocked(api.get);

const mockScoreData = {
  items: [
    {
      attemptId: "att-1",
      candidateId: "c1",
      candidateName: "张三",
      candidateFields: { 学号: "EMP001" },
      examId: "exam-1",
      examTitle: "期末考试",
      score: 85,
      passed: true,
      attemptNo: 1,
      submittedAt: new Date().toISOString(),
    },
  ],
  stats: {
    averageScore: 85,
    maxScore: 90,
    minScore: 80,
    passRate: 1,
    totalGraded: 1,
  },
  total: 1,
  page: 1,
  pageSize: 20,
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/admin/exams/exam-1/scores"]}>
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
            <Route path="/admin/exams/:id/scores" element={<ScoreListPage />} />
          </Routes>
        </BrandProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("ScoreListPage", () => {
  beforeEach(() => {
    getMock.mockReset();
    getMock.mockResolvedValue(mockScoreData);
  });

  it("renders score stats cards", async () => {
    renderPage();
    expect(await screen.findByText("平均分")).toBeInTheDocument();
    expect(screen.getByText("最高分")).toBeInTheDocument();
    expect(screen.getByText("最低分")).toBeInTheDocument();
    expect(screen.getByText("及格率")).toBeInTheDocument();
    expect(screen.getByText("已评分")).toBeInTheDocument();
  });

  it("renders score table with candidate data", async () => {
    renderPage();
    expect(await screen.findByText("张三")).toBeInTheDocument();
    expect(screen.getByText("85")).toBeInTheDocument();
    expect(screen.getAllByText("及格").length).toBeGreaterThanOrEqual(1);
  });

  it("export URL includes /api prefix", async () => {
    renderPage();
    await screen.findByText("张三");

    const createObjectURLSpy = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:mock");
    const createElementSpy = vi.spyOn(document, "createElement");

    const user = userEvent.setup();
    const exportBtn = screen.getByText("导出CSV");
    await user.click(exportBtn);

    const anchor = createElementSpy.mock.results[0]?.value as HTMLAnchorElement;
    expect(anchor?.href).toContain("/api/exams/exam-1/export/scores");

    createObjectURLSpy.mockRestore();
    createElementSpy.mockRestore();
  });

  it("shows pass filter tabs", async () => {
    renderPage();
    expect(
      await screen.findByRole("tab", { name: "全部" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "及格" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "不及格" })).toBeInTheDocument();
  });

  it("shows empty state when no scores", async () => {
    getMock.mockResolvedValue({
      ...mockScoreData,
      items: [],
      stats: {
        averageScore: 0,
        maxScore: 0,
        minScore: 0,
        passRate: 0,
        totalGraded: 0,
      },
    });
    renderPage();
    expect(await screen.findByText("暂无成绩")).toBeInTheDocument();
  });
});
