import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { AuthProvider } from "@/contexts/AuthContext";
import { BrandProvider } from "@/components/layout/BrandProvider";
import { AuditLogPage } from "./AuditLogPage";

vi.mock("@/lib/api", () => ({
  api: {
    get: vi.fn(),
  },
  setNavigate: () => {},
}));

const getMock = vi.mocked(api.get);

const mockAuditData = {
  items: [
    {
      id: "log-1",
      organizationId: "org-1",
      actorId: "admin-1",
      action: "grading.score_entered",
      targetType: "attempt",
      targetId: "att-1",
      metadata: {
        questionId: "q1",
        score: 8,
        maxScore: 10,
        graderId: "admin-1",
      },
      ipAddress: "127.0.0.1",
      userAgent: "Mozilla/5.0",
      createdAt: "2025-01-15T10:00:00Z",
    },
    {
      id: "log-2",
      organizationId: "org-1",
      actorId: "admin-1",
      action: "exam.publish_results",
      targetType: "exam",
      targetId: "exam-1",
      metadata: {
        alreadyPublished: false,
        resultsPublishedAt: "2025-01-15T10:05:00Z",
      },
      ipAddress: "127.0.0.1",
      userAgent: "Mozilla/5.0",
      createdAt: "2025-01-15T10:05:00Z",
    },
  ],
  total: 2,
  page: 1,
  pageSize: 20,
  totalPages: 1,
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/admin/audit-logs"]}>
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
            <Route path="/admin/audit-logs" element={<AuditLogPage />} />
          </Routes>
        </BrandProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("AuditLogPage", () => {
  beforeEach(() => {
    getMock.mockReset();
    getMock.mockResolvedValue(mockAuditData);
  });

  it("renders audit log table with entries", async () => {
    renderPage();
    expect(
      await screen.findByText("grading.score_entered"),
    ).toBeInTheDocument();
    expect(screen.getByText("exam.publish_results")).toBeInTheDocument();
  });

  it("renders target type and target id", async () => {
    renderPage();
    await screen.findByText("grading.score_entered");
    expect(screen.getAllByText("attempt").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("exam").length).toBeGreaterThanOrEqual(1);
  });

  it("shows empty state when no logs", async () => {
    getMock.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
      totalPages: 0,
    });
    renderPage();
    expect(await screen.findByText("暂无审计日志")).toBeInTheDocument();
  });

  it("shows loading state then data", async () => {
    renderPage();
    expect(screen.getByText("加载中...")).toBeInTheDocument();
    expect(
      await screen.findByText("grading.score_entered"),
    ).toBeInTheDocument();
  });

  it("shows error state on fetch failure", async () => {
    getMock.mockRejectedValue(new Error("Network error"));
    renderPage();
    expect(await screen.findByText("加载审计日志失败")).toBeInTheDocument();
  });

  it("renders pagination", async () => {
    getMock.mockResolvedValue({
      ...mockAuditData,
      total: 50,
      totalPages: 3,
    });
    renderPage();
    await screen.findByText("grading.score_entered");
    expect(screen.getByText(/共 50 条/)).toBeInTheDocument();
  });

  it("retry button re-fetches data on error", async () => {
    getMock.mockRejectedValueOnce(new Error("fail"));
    renderPage();
    await screen.findByText("加载审计日志失败");

    getMock.mockResolvedValue(mockAuditData);
    await userEvent.setup().click(screen.getByText("重试"));
    expect(
      await screen.findByText("grading.score_entered"),
    ).toBeInTheDocument();
  });

  it("expands metadata on row click", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("grading.score_entered");

    const row = screen.getByText("grading.score_entered").closest("tr");
    expect(row).toBeTruthy();
    await user.click(row!);

    expect(await screen.findByText(/questionId/)).toBeInTheDocument();
  });
});
