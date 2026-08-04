import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { permissionsForRole } from "@exam/authz";
import { AuthProvider } from "@/contexts/AuthContext";
import { BrandProvider } from "@/components/layout/BrandProvider";
import { ApiError, api } from "@/lib/api";
import type { RecoveryExamContextResponse } from "@/lib/recovery";
import { RecoveryExamDetailPage } from "./RecoveryExamDetailPage";

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

const mockExamContext: RecoveryExamContextResponse = {
  examSummary: {
    id: "exam-1",
    title: "网络恢复考试",
    status: "open",
    timingMode: "timed_window",
    closeAt: "2025-01-15T12:00:00Z",
  },
  incidentStats: {
    total: 2,
    byStatus: { open: 1, investigating: 1, resolved: 0, dismissed: 0 },
    bySeverity: { info: 0, minor: 1, major: 1, critical: 0 },
  },
  recentIncidents: [
    {
      id: "incident-1",
      type: "network_interruption",
      severity: "major",
      status: "open",
      createdAt: "2025-01-15T10:00:00Z",
    },
    {
      id: "incident-2",
      type: "device_failure",
      severity: "minor",
      status: "investigating",
      createdAt: "2025-01-15T09:00:00Z",
    },
  ],
  activeProctors: [{ userId: "proctor-1", displayName: "监考李四" }],
  attemptStatusDistribution: { in_progress: 2, disrupted: 1 },
  snapshotAt: "2025-01-15T10:05:00Z",
};

function renderPage(examId = "exam-1") {
  return render(
    <MemoryRouter initialEntries={[`/admin/recovery/exams/${examId}`]}>
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
              path="/admin/recovery/exams/:examId"
              element={<RecoveryExamDetailPage />}
            />
            <Route path="*" element={<div data-testid="unmatched-route" />} />
          </Routes>
        </BrandProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("RecoveryExamDetailPage", () => {
  beforeEach(() => {
    getMock.mockReset();
    getMock.mockResolvedValue(mockExamContext);
  });

  it("renders the exam summary with timing mode and closeAt", async () => {
    renderPage();
    expect(
      (await screen.findAllByText("网络恢复考试")).length,
    ).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/定时窗口/)).toBeInTheDocument();
    expect(screen.getByText(/关闭时间/)).toBeInTheDocument();
  });

  it("renders incident counts by status and severity", async () => {
    renderPage();
    expect(await screen.findByText(/事件总数/)).toBeInTheDocument();
    // byStatus: open=1, investigating=1 (labels render twice — count badge +
    // section row; assert via within-free text with getAllBy).
    expect(screen.getByText("2")).toBeInTheDocument();
    // Severity counts are rendered as label + number pairs.
    expect(screen.getAllByText("严重").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("轻微").length).toBeGreaterThanOrEqual(1);
  });

  it("renders recent incidents as navigation stubs to the incident page", async () => {
    renderPage();
    expect(await screen.findByText("网络中断")).toBeInTheDocument();
    expect(screen.getByText("设备故障")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "网络中断" })).toHaveAttribute(
      "href",
      "/admin/recovery/incidents/incident-1",
    );
  });

  it("renders active proctors", async () => {
    renderPage();
    expect(await screen.findByText("监考李四")).toBeInTheDocument();
  });

  it("renders the attempt status distribution", async () => {
    renderPage();
    expect(await screen.findByText("2 次")).toBeInTheDocument();
    expect(screen.getByText("1 次")).toBeInTheDocument();
  });

  it("provides a queue link filtered by this exam", async () => {
    renderPage();
    expect(await screen.findByText("在队列中查看")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /在队列中查看/ })).toHaveAttribute(
      "href",
      "/admin/recovery?examId=exam-1",
    );
  });

  it("shows loading state then data", async () => {
    renderPage();
    expect(screen.getByText("加载中...")).toBeInTheDocument();
    expect(
      (await screen.findAllByText("网络恢复考试")).length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("shows not-found for 404 and retry works", async () => {
    getMock.mockRejectedValueOnce(new ApiError(404, "Not found"));
    renderPage();
    expect(await screen.findByText("未找到该考试")).toBeInTheDocument();

    getMock.mockResolvedValue(mockExamContext);
    await userEvent.setup().click(screen.getByText("重试"));
    expect(
      (await screen.findAllByText("网络恢复考试")).length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("shows the error state on fetch failure", async () => {
    getMock.mockRejectedValueOnce(new ApiError(0, "Network request failed"));
    renderPage();
    expect(
      await screen.findByText(/Network request failed/),
    ).toBeInTheDocument();
  });
});
