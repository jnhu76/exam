import { render, screen, within } from "@testing-library/react";
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
    // Row content renders twice by design (desktop table + mobile cards);
    // scope to the desktop table representation.
    const table = await screen.findByRole("table");
    expect(within(table).getByText("张三")).toBeInTheDocument();
    expect(within(table).getByText("李四")).toBeInTheDocument();
    expect(
      within(table).getAllByText("期末考试").length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("renders pending question counts", async () => {
    renderPage();
    const table = await screen.findByRole("table");
    expect(within(table).getByText("张三")).toBeInTheDocument();
    expect(within(table).getByText("3")).toBeInTheDocument();
    expect(within(table).getByText("1")).toBeInTheDocument();
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

  it("shows error state on fetch failure", async () => {
    getMock.mockRejectedValue(new Error("Network error"));
    renderPage();
    expect(await screen.findByText("加载评分队列失败")).toBeInTheDocument();
  });

  it("exposes a real detail link per queue entry whose accessible name identifies the target", async () => {
    renderPage();
    const table = await screen.findByRole("table");

    // One real link per row; its accessible name must distinguish the target
    // (candidate + exam), not read as the row's bare first-cell text.
    const links = within(table).getAllByRole("link");
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute("href", "/admin/grading-queue/att-1");
    expect(links[0]).toHaveAccessibleName(/张三/);
    expect(links[0]).toHaveAccessibleName(/期末考试/);
    expect(links[1]).toHaveAccessibleName(/李四/);
    // A link is a native focusable element — the old <tr onClick> was not.
    expect(links[0]).toHaveAttribute("href");
  });

  it("mobile cards carry the same real detail link (single column source)", async () => {
    renderPage();
    // Desktop table + mobile cards both render the shared candidate column
    // cell, so the same named link exists in both representations.
    const links = await screen.findAllByRole("link", { name: /张三/ });
    expect(links.length).toBeGreaterThanOrEqual(2);
  });

  it("opens the grading detail with keyboard Enter on the native link", async () => {
    const user = userEvent.setup();
    renderPage();
    const table = await screen.findByRole("table");

    const link = within(table).getAllByRole("link")[0]!;
    link.focus();
    expect(link).toHaveFocus();
    await user.keyboard("{Enter}");

    expect(await screen.findByText("Detail Page")).toBeInTheDocument();
  });

  it("retry button re-fetches data on error", async () => {
    getMock.mockRejectedValueOnce(new Error("fail"));
    renderPage();
    await screen.findByText("加载评分队列失败");

    getMock.mockResolvedValue(mockQueueData);
    await userEvent.setup().click(screen.getByText("重试"));
    const table = await screen.findByRole("table");
    expect(within(table).getByText("张三")).toBeInTheDocument();
  });
});
