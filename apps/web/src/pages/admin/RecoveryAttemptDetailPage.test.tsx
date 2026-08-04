import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { permissionsForRole } from "@exam/authz";
import { AuthProvider } from "@/contexts/AuthContext";
import { BrandProvider } from "@/components/layout/BrandProvider";
import { ApiError, api } from "@/lib/api";
import type { AttemptOperationsContext as RecoveryAttemptOperationsResponse } from "@exam/contracts";
import { RecoveryAttemptDetailPage } from "./RecoveryAttemptDetailPage";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      get: vi.fn(),
    },
  };
});

const getMock = vi.mocked(api.get);

const mockContext: RecoveryAttemptOperationsResponse = {
  attempt: {
    id: "attempt-1",
    examId: "exam-1",
    candidateId: "cand-1",
    attemptNo: 1,
    status: "disrupted",
    startedAt: "2025-01-15T09:00:00Z",
    deadlineAt: "2025-01-15T11:00:00Z",
    effectiveDeadlineAt: "2025-01-15T12:00:00Z",
    submittedAt: null,
    gradedAt: null,
    lastActivityAt: "2025-01-15T10:30:00Z",
    misconduct: false,
  },
  examSummary: {
    id: "exam-1",
    title: "网络恢复考试",
    status: "open",
    closeAt: "2025-01-15T12:00:00Z",
  },
  candidateSummary: { id: "cand-1", displayName: "考生张三" },
  interruptionEpisodes: [
    {
      interruption: {
        id: "interruption-1",
        attemptId: "attempt-1",
        createdAt: "2025-01-15T09:30:00Z",
      },
      events: [
        {
          id: "evt-1",
          eventType: "detected",
          occurredAt: "2025-01-15T09:30:00Z",
          observedLastActivityAt: "2025-01-15T09:29:00Z",
          detectionSource: "heartbeat_timeout",
          timeoutSeconds: 60,
          policy: "bounded_grace",
          eligibleSeconds: 3600,
          timeAdjustmentId: null,
          actorId: null,
          reasonCode: "heartbeat_timeout",
        },
        {
          id: "evt-2",
          eventType: "restored",
          occurredAt: "2025-01-15T09:35:00Z",
          observedLastActivityAt: null,
          detectionSource: null,
          timeoutSeconds: null,
          policy: "bounded_grace",
          eligibleSeconds: null,
          timeAdjustmentId: "adj-1",
          actorId: "admin-1",
          reasonCode: "grace_restore",
        },
      ],
    },
  ],
  timeAdjustments: [
    {
      id: "adj-1",
      operationId: "op-1",
      attemptId: "attempt-1",
      interruptionId: "interruption-1",
      incidentId: "incident-1",
      policy: "bounded_grace",
      source: "bounded_grace",
      beforeDeadline: "2025-01-15T11:00:00Z",
      afterDeadline: "2025-01-15T12:00:00Z",
      addedSeconds: 3600,
      eligibleSeconds: 3600,
      reasonCode: "grace_restore",
      reasonText: "自动宽限补偿",
      actorId: null,
      createdAt: "2025-01-15T09:35:00Z",
    },
  ],
  timeline: [
    {
      id: "tl-1",
      organizationId: "org-1",
      actorId: "admin-1",
      actorName: "管理员",
      action: "attempt.disrupted",
      targetType: "attempt",
      targetId: "attempt-1",
      metadata: { reasonCode: "heartbeat_timeout" },
      ipAddress: null,
      userAgent: null,
      createdAt: "2025-01-15T09:30:00Z",
    },
  ],
  relatedIncidents: [
    {
      id: "incident-1",
      status: "investigating",
      severity: "major",
      title: "关联的网络中断事件",
    },
  ],
  allowedActions: ["time_grant", "force_submit", "misconduct_mark"],
  snapshotAt: "2025-01-15T10:05:00Z",
};

function renderPage(attemptId = "attempt-1") {
  return render(
    <MemoryRouter initialEntries={[`/admin/recovery/attempts/${attemptId}`]}>
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
            <Route
              path="/admin/recovery/attempts/:attemptId"
              element={<RecoveryAttemptDetailPage />}
            />
            <Route path="*" element={<div data-testid="unmatched-route" />} />
          </Routes>
        </BrandProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("RecoveryAttemptDetailPage", () => {
  beforeEach(() => {
    getMock.mockReset();
    getMock.mockResolvedValue(mockContext);
  });

  it("renders the attempt header with status and attempt number", async () => {
    renderPage();
    expect(await screen.findByText("第 1 次答题")).toBeInTheDocument();
    expect(screen.getAllByText("断线").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("考生张三")).toBeInTheDocument();
  });

  it("renders the effective deadline with a differs-indicator", async () => {
    renderPage();
    expect(
      (await screen.findAllByText(/有效截止时间/)).length,
    ).toBeGreaterThanOrEqual(1);
    expect(
      screen.getByText("有效截止时间与原始截止不同（由时间调整决定）"),
    ).toBeInTheDocument();
  });

  it("renders the Recovery Exam cross-link and closeAt", async () => {
    renderPage();
    expect(await screen.findByText("网络恢复考试")).toBeInTheDocument();
    // Cross-navigation to the Recovery Exam detail (not the plain exam detail).
    expect(screen.getByRole("link", { name: "网络恢复考试" })).toHaveAttribute(
      "href",
      "/admin/recovery/exams/exam-1",
    );
  });

  it("renders interruption episodes with nested events", async () => {
    renderPage();
    expect(await screen.findByText("第 1 次中断")).toBeInTheDocument();
    expect(screen.getByText("检测到中断")).toBeInTheDocument();
    expect(screen.getByText("已恢复")).toBeInTheDocument();
    expect(screen.getByText(/heartbeat_timeout/)).toBeInTheDocument();
  });

  it("renders the FULL adjustment ledger (policy/source/deadlines/reason/linked incident)", async () => {
    renderPage();
    expect(await screen.findByText("宽限")).toBeInTheDocument();
    expect(screen.getByText("自动宽限")).toBeInTheDocument();
    expect(screen.getByText(/自动宽限补偿/)).toBeInTheDocument();
    expect(screen.getByText(/调整前截止/)).toBeInTheDocument();
    expect(screen.getByText(/调整后截止/)).toBeInTheDocument();
    // The ledger caption makes the full-vs-incident-scoped distinction explicit.
    expect(
      screen.getByText(/完整时间调整台账（含所有来源）/),
    ).toBeInTheDocument();
  });

  it("renders the audit timeline with actor names", async () => {
    renderPage();
    expect(await screen.findByText("attempt.disrupted")).toBeInTheDocument();
    expect(screen.getByText("管理员")).toBeInTheDocument();
  });

  it("renders related incidents as navigation stubs to the incident page", async () => {
    renderPage();
    expect(await screen.findByText("关联的网络中断事件")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "关联的网络中断事件" }),
    ).toHaveAttribute("href", "/admin/recovery/incidents/incident-1");
  });

  it("shows the misconduct flag prominently when set", async () => {
    getMock.mockResolvedValue({
      ...mockContext,
      attempt: { ...mockContext.attempt, misconduct: true },
    });
    renderPage();
    expect(
      await screen.findByText("该答题已被标记为违规。"),
    ).toBeInTheDocument();
  });

  it("renders NO command action buttons in the read-only phase", async () => {
    renderPage();
    await screen.findByText("第 1 次答题");
    // The action COMMAND area is not rendered (read-only phase). Toolbar
    // affordances (refresh / back) are not commands. allowedActions must not
    // produce command buttons (time_grant / force_submit / misconduct_mark).
    expect(screen.queryByText(/allowedActions/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: /time_grant|force_submit|misconduct/i,
      }),
    ).not.toBeInTheDocument();
  });

  it("shows loading state then data", async () => {
    renderPage();
    expect(screen.getByText("加载中...")).toBeInTheDocument();
    expect(await screen.findByText("第 1 次答题")).toBeInTheDocument();
  });

  it("shows not-found for 404 and retry works", async () => {
    getMock.mockRejectedValueOnce(new ApiError(404, "Not found"));
    renderPage();
    expect(await screen.findByText("未找到该答题")).toBeInTheDocument();

    getMock.mockResolvedValue(mockContext);
    await userEvent.setup().click(screen.getByText("重试"));
    expect(await screen.findByText("第 1 次答题")).toBeInTheDocument();
  });

  it("shows the classified network error state on fetch failure", async () => {
    getMock.mockRejectedValueOnce(new ApiError(0, "Network request failed"));
    renderPage();
    // status 0 → network kind → networkError message (classifier authority).
    expect(await screen.findByText(/网络异常/)).toBeInTheDocument();
  });
});
