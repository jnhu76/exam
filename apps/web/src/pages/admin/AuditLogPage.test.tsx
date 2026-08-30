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

/**
 * Backend-driven action vocabulary (#298): the page renders the dropdown from
 * this endpoint, never from a hardcoded list.
 */
const actionsMock = {
  actions: [
    {
      action: "grading.score_entered",
      durability: "atomic",
      obligation: "privileged_mutation",
      frequency: "medium",
    },
    {
      action: "exam.publish_results",
      durability: "atomic",
      obligation: "privileged_mutation",
      frequency: "low",
    },
    {
      action: "exam.cancel",
      durability: "atomic",
      obligation: "privileged_mutation",
      frequency: "low",
    },
    {
      action: "attempt.timeGrant",
      durability: "atomic",
      obligation: "privileged_mutation",
      frequency: "low",
    },
    {
      action: "user.invited",
      durability: "atomic",
      obligation: "authority",
      frequency: "low",
    },
    {
      action: "audit_log.exported",
      durability: "synchronous_sensitive_read",
      obligation: "privacy_access",
      frequency: "low",
    },
  ],
};

const auditItems = [
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
];

const mockAuditData = {
  items: auditItems,
  nextCursor: "v1|2025-01-15T10:05:00.000Z|log-2",
};

/** Routes api.get by URL: actions vocabulary vs the keyset log page. */
function mockApi() {
  getMock.mockImplementation((path: string) => {
    if (path.includes("/api/admin/audit-log/actions")) {
      return Promise.resolve(actionsMock);
    }
    return Promise.resolve(mockAuditData);
  });
}

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
    mockApi();
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
    getMock.mockImplementation((path: string) => {
      if (path.includes("/api/admin/audit-log/actions")) {
        return Promise.resolve(actionsMock);
      }
      return Promise.resolve({ items: [], nextCursor: null });
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
    getMock.mockImplementation((path: string) => {
      if (path.includes("/api/admin/audit-log/actions")) {
        return Promise.resolve(actionsMock);
      }
      return Promise.reject(new Error("Network error"));
    });
    renderPage();
    expect(await screen.findByText("加载审计日志失败")).toBeInTheDocument();
  });

  it("navigates pages with keyset next/prev", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("grading.score_entered");

    // A non-null nextCursor enables the next button.
    const nextButton = screen.getByRole("button", { name: /下一页/ });
    expect(nextButton).toBeEnabled();
    await user.click(nextButton);

    // The next request carries the opaque cursor.
    await waitFor(() => {
      const lastCall = getMock.mock.calls.at(-1)?.[0] as string;
      expect(lastCall).toContain("cursor=");
    });

    // After navigating forward, the prev button becomes enabled.
    const prevButton = screen.getByRole("button", { name: /上一页/ });
    expect(prevButton).toBeEnabled();
  });

  it("disables the prev button on the first page", async () => {
    renderPage();
    await screen.findByText("grading.score_entered");
    expect(screen.getByRole("button", { name: /上一页/ })).toBeDisabled();
  });

  it("retry button re-fetches data on error", async () => {
    getMock.mockImplementation((path: string) => {
      if (path.includes("/api/admin/audit-log/actions")) {
        return Promise.resolve(actionsMock);
      }
      return Promise.reject(new Error("fail"));
    });
    renderPage();
    await screen.findByText("加载审计日志失败");

    mockApi();
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
    expect(await screen.findByText("管理员张三")).toBeInTheDocument();
  });

  it("falls back to raw actorId when actorName is absent", async () => {
    renderPage();
    await screen.findByText("管理员张三");
    expect(screen.getAllByText("admin-1").length).toBeGreaterThanOrEqual(1);
  });

  it("renders the action dropdown FROM the backend vocabulary, not a hardcoded list", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("管理员张三");
    // A #297 action shipped after the old hardcoded list: present because the
    // dropdown is backend-driven, with a Chinese label from i18n.
    await user.click(screen.getByRole("combobox", { name: /全部操作/ }));
    expect(
      await screen.findByRole("option", { name: "邀请用户" }),
    ).toBeInTheDocument();
    // The export action is present with its label too.
    expect(
      screen.getByRole("option", { name: "导出审计日志" }),
    ).toBeInTheDocument();
  });

  it("sends the exact action value when a backend-driven action is selected", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("管理员张三");

    await user.click(screen.getByRole("combobox", { name: /全部操作/ }));
    const grantOption = await screen.findByRole("option", {
      name: "授予考试时间",
    });
    expect(grantOption).toBeInTheDocument();
    // The raw action key must not appear as a visible label.
    expect(screen.queryByText("attempt.timeGrant")).not.toBeInTheDocument();

    await user.click(grantOption);
    await waitFor(() => {
      const lastCall = getMock.mock.calls.at(-1)?.[0] as string;
      expect(lastCall).toContain("action=attempt.timeGrant");
    });
  });
});
