import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { AuthProvider } from "@/contexts/AuthContext";
import { BrandProvider } from "@/components/layout/BrandProvider";
import { AuditLogPage } from "./AuditLogPage";
import { permissionsForRole } from "@exam/authz";

vi.mock("@/lib/api", () => ({
  api: {
    get: vi.fn(),
  },
  setNavigate: () => {},
}));

vi.mock("@/components/shared/DatePicker", () => ({
  DatePicker: ({
    value,
    onChange,
    placeholder,
    "aria-label": ariaLabel,
  }: {
    value?: Date;
    onChange: (date: Date | undefined) => void;
    placeholder?: string;
    "aria-label"?: string;
  }) => (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={() =>
        onChange(
          ariaLabel === "开始日期"
            ? new Date("2025-01-15T12:00:00Z")
            : new Date("2025-01-20T12:00:00Z"),
        )
      }
    >
      {value ? value.toISOString().slice(0, 10) : placeholder}
    </button>
  ),
}));

const getMock = vi.mocked(api.get);

const mockAuditData = {
  items: [
    {
      id: "log-1",
      organizationId: "org-1",
      actorId: "admin-1",
      actorName: "管理员张三",
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
          capabilities: [...permissionsForRole("Admin")],
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

  it("sends targetType query param when target filter is set", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("grading.score_entered");

    // Open the target filter and pick 考试 (exam).
    const targetTrigger = screen.getByRole("combobox", {
      name: /全部目标/,
    });
    await user.click(targetTrigger);
    await user.click(await screen.findByRole("option", { name: "考试" }));

    const lastCall = getMock.mock.calls.at(-1)?.[0] as string;
    expect(lastCall).toContain("targetType=exam");
  });

  it("renders 开始日期 / 结束日期 date-range pickers", async () => {
    renderPage();
    await screen.findByText("grading.score_entered");
    expect(screen.getByLabelText("开始日期")).toBeInTheDocument();
    expect(screen.getByLabelText("结束日期")).toBeInTheDocument();
  });

  it("sends from / to query params when a date range is selected", async () => {
    renderPage();
    await screen.findByText("grading.score_entered");

    fireEvent.click(screen.getByLabelText("开始日期"));
    await waitFor(() => {
      const lastCall = getMock.mock.calls.at(-1)?.[0] as string;
      expect(lastCall).toMatch(/from=\d{4}-\d{2}-\d{2}T/);
    });

    fireEvent.click(screen.getByLabelText("结束日期"));

    await waitFor(() => {
      const lastCall = getMock.mock.calls.at(-1)?.[0] as string;
      expect(lastCall).toMatch(/from=\d{4}-\d{2}-\d{2}T/);
      expect(lastCall).toMatch(/to=\d{4}-\d{2}-\d{2}T/);
    });
  });

  it("has a clear-filters control that resets all filters", async () => {
    renderPage();
    await screen.findByText("grading.score_entered");

    fireEvent.click(screen.getByRole("combobox", { name: /全部操作/ }));
    fireEvent.click(await screen.findByRole("option", { name: "公布成绩" }));
    await screen.findByText("grading.score_entered");

    fireEvent.click(screen.getByText("清空筛选"));

    await waitFor(() => {
      const lastCall = getMock.mock.calls.at(-1)?.[0] as string;
      expect(lastCall).not.toContain("action=");
    });
  });

  it("renders resolved actorName instead of raw actorId when present", async () => {
    renderPage();
    // log-1 has actorName "管理员张三"; that should show, not the raw "admin-1".
    expect(await screen.findByText("管理员张三")).toBeInTheDocument();
  });

  it("falls back to raw actorId when actorName is absent", async () => {
    renderPage();
    await screen.findByText("管理员张三");
    // log-2 has no actorName → its raw actorId "admin-1" is shown.
    // (log-1 also has actorId admin-1 but renders the name; there will be at
    // least one "admin-1" cell from log-2.)
    expect(screen.getAllByText("admin-1").length).toBeGreaterThanOrEqual(1);
  });

  it("includes expanded audit actions in the action filter", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("管理员张三");
    // Open the action filter and verify a previously-missing action is present.
    await user.click(screen.getByRole("combobox", { name: /全部操作/ }));
    expect(await screen.findByText("取消考试")).toBeInTheDocument();
  });
});
