import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { AuthProvider } from "@/contexts/AuthContext";
import { BrandProvider } from "@/components/layout/BrandProvider";
import { GradingQueuePage } from "./GradingQueuePage";
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

const mockQueueData = {
  items: [
    {
      attemptId: "att-1",
      examId: "exam-1",
      examTitle: "期末考试",
      candidateId: "c1",
      candidateName: "张三",
      submittedAt: "2025-01-15T10:00:00Z",
      gradingStatus: "pending_manual",
      pendingQuestionCount: 3,
    },
    {
      attemptId: "att-2",
      examId: "exam-1",
      examTitle: "期末考试",
      candidateId: "c2",
      candidateName: "李四",
      submittedAt: "2025-01-15T11:00:00Z",
      gradingStatus: "pending_manual",
      pendingQuestionCount: 1,
    },
  ],
  total: 2,
  page: 1,
  pageSize: 20,
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/admin/grading-queue"]}>
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
            <Route path="/admin/grading-queue" element={<GradingQueuePage />} />
            <Route
              path="/admin/grading-queue/:id"
              element={<div>Detail Page</div>}
            />
          </Routes>
        </BrandProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("GradingQueuePage", () => {
  beforeEach(() => {
    getMock.mockReset();
    getMock.mockResolvedValue(mockQueueData);
  });

  it("renders queue items with candidate names and exam titles", async () => {
    renderPage();
    expect(await screen.findByText("张三")).toBeInTheDocument();
    expect(screen.getByText("李四")).toBeInTheDocument();
    expect(screen.getAllByText("期末考试").length).toBeGreaterThanOrEqual(1);
  });

  it("renders pending question counts", async () => {
    renderPage();
    expect(await screen.findByText("张三")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("shows empty state when no pending attempts", async () => {
    getMock.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    });
    renderPage();
    expect(await screen.findByText("暂无待评分的试卷")).toBeInTheDocument();
  });

  it("shows loading state then data", async () => {
    renderPage();
    expect(screen.getByText("加载中...")).toBeInTheDocument();
    expect(await screen.findByText("张三")).toBeInTheDocument();
  });

  it("shows error state on fetch failure", async () => {
    getMock.mockRejectedValue(new Error("Network error"));
    renderPage();
    expect(await screen.findByText("加载评分队列失败")).toBeInTheDocument();
  });

  it("clicking a row navigates to grading detail", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("张三");

    const row = screen.getByText("张三").closest("tr");
    expect(row).toBeTruthy();
    await user.click(row!);

    expect(await screen.findByText("Detail Page")).toBeInTheDocument();
  });

  it("retry button re-fetches data on error", async () => {
    getMock.mockRejectedValueOnce(new Error("fail"));
    renderPage();
    await screen.findByText("加载评分队列失败");

    getMock.mockResolvedValue(mockQueueData);
    await userEvent.setup().click(screen.getByText("重试"));
    expect(await screen.findByText("张三")).toBeInTheDocument();
  });
});
