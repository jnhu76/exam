import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { AuthProvider } from "@/contexts/AuthContext";
import { BrandProvider } from "@/components/layout/BrandProvider";
import * as downloadModule from "@/lib/download";
import { ScoreListPage } from "./ScoreListPage";
import { permissionsForRole } from "@exam/authz";

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
  setNavigate: () => {},
}));

const getMock = vi.mocked(api.get);
const downloadFileSpy = vi
  .spyOn(downloadModule, "downloadFile")
  .mockResolvedValue(undefined);

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
          capabilities: [...permissionsForRole("Admin")],
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
    downloadFileSpy.mockReset();
    downloadFileSpy.mockResolvedValue(undefined);
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
    // Row content renders twice by design (desktop table + mobile cards);
    // scope to the desktop table representation.
    const table = await screen.findByRole("table");
    expect(within(table).getByText("张三")).toBeInTheDocument();
    expect(within(table).getByText("85")).toBeInTheDocument();
    expect(within(table).getAllByText("及格").length).toBeGreaterThanOrEqual(1);
  });

  it("export calls authenticated downloadFile with the scores export path", async () => {
    renderPage();
    await screen.findByRole("table");

    const user = userEvent.setup();
    await user.click(screen.getByText("导出CSV"));

    await waitFor(() => {
      expect(downloadFileSpy).toHaveBeenCalledTimes(1);
    });
    // Must request the scores export endpoint with a csv filename.
    const [path, filename] = downloadFileSpy.mock.calls[0]!;
    expect(path).toContain("/api/exams/exam-1/export/scores");
    expect(filename).toMatch(/\.csv$/);
  });

  it("export failure shows an error toast (no silent swallow)", async () => {
    renderPage();
    await screen.findByRole("table");

    const { toast } = await import("sonner");
    const toastErrorSpy = vi
      .spyOn(toast, "error")
      .mockImplementation(() => "x");
    downloadFileSpy.mockRejectedValueOnce(new Error("401"));

    const user = userEvent.setup();
    await user.click(screen.getByText("导出CSV"));

    await waitFor(() => {
      expect(toastErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("导出失败"),
      );
    });
    toastErrorSpy.mockRestore();
  });

  it("shows pass filter tabs without dead search input", async () => {
    renderPage();
    expect(
      await screen.findByRole("tab", { name: "全部" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "及格" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "不及格" })).toBeInTheDocument();
    expect(
      screen.queryByPlaceholderText("搜索考生..."),
    ).not.toBeInTheDocument();
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
    // The empty fact renders in both representations.
    const empties = await screen.findAllByText("暂无成绩");
    expect(empties.length).toBeGreaterThanOrEqual(1);
  });

  it("renders each score metric through the StatsCard authority", async () => {
    renderPage();
    const avg = await screen.findByText("平均分");
    const card = avg.closest("[data-slot='stats-card']");
    expect(card).toBeInTheDocument();
    expect(card).toHaveTextContent("85");
    expect(card?.querySelector("[data-slot='stats-card-value']")).toHaveClass(
      "type-metric",
    );
  });

  it("shows a visible error state (no white screen) when data is null", async () => {
    // Simulate a malformed/null response body. Previously `if (!scores) return null`
    // produced a white screen; now it renders a retryable ErrorState.
    getMock.mockResolvedValue(null);
    renderPage();
    expect(
      await screen.findByText("成绩数据加载异常，请重试"),
    ).toBeInTheDocument();
  });
});
