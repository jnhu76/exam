import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { permissionsForRole } from "@exam/authz";
import { AuthProvider } from "@/contexts/AuthContext";
import { BrandProvider } from "@/components/layout/BrandProvider";
import { ApiError, api } from "@/lib/api";
import type { RecoveryIncidentAggregateResponse } from "@/lib/recovery";
import { RecoveryIncidentDetailPage } from "./RecoveryIncidentDetailPage";

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

const mockAggregate: RecoveryIncidentAggregateResponse = {
  incident: {
    id: "incident-1",
    examId: "exam-1",
    attemptId: null,
    candidateId: null,
    type: "network_interruption",
    severity: "major",
    status: "investigating",
    occurredAt: null,
    description: "detail page test incident",
    resolutionSummary: null,
    resolvedAt: null,
    resolvedBy: null,
    reportedBy: "admin-1",
    version: 2,
    createdAt: "2025-01-15T10:00:00Z",
    updatedAt: "2025-01-15T10:00:00Z",
  },
  examSummary: {
    id: "exam-1",
    title: "网络恢复考试",
    status: "open",
    closeAt: "2025-01-15T12:00:00Z",
  },
  events: [
    {
      id: "evt-1",
      eventSequence: 1,
      eventType: "investigated",
      commandType: "startIncidentInvestigation",
      operationId: "op-1",
      actorId: "admin-1",
      beforeVersion: 1,
      afterVersion: 2,
      payload: { reasonCode: "network", note: "开始调查" },
      createdAt: "2025-01-15T10:05:00Z",
    },
  ],
  notes: [
    {
      operationId: "op-2",
      actorId: "admin-1",
      body: "已联系考生",
      createdAt: "2025-01-15T10:10:00Z",
    },
  ],
  actions: [
    {
      id: "act-1",
      actionType: "time_grant",
      actionId: "adj-1",
      attemptId: "attempt-1",
      actorId: "admin-1",
      operationId: "op-3",
      linkedAt: "2025-01-15T10:15:00Z",
    },
  ],
  attemptMemberships: [
    {
      id: "mem-1",
      attemptId: "attempt-1",
      relationshipType: "affected",
      linkedAt: "2025-01-15T10:01:00Z",
      linkedBy: "admin-1",
      operationId: "op-4",
    },
  ],
  interruptionLinks: [
    {
      id: "il-1",
      attemptId: "attempt-1",
      interruptionId: "interruption-1",
      linkedAt: "2025-01-15T10:02:00Z",
      linkedBy: "admin-1",
      operationId: "op-5",
    },
  ],
  candidateSummaries: [{ id: "cand-1", displayName: "考生张三" }],
  attemptSummaries: [
    {
      id: "attempt-1",
      candidateId: "cand-1",
      status: "disrupted",
      effectiveDeadlineAt: "2025-01-15T11:00:00Z",
      score: 88.5,
    },
  ],
  timeAdjustmentSummaries: [
    {
      id: "adj-1",
      attemptId: "attempt-1",
      policy: "operator_incident",
      source: "operator",
      beforeDeadline: "2025-01-15T11:00:00Z",
      afterDeadline: "2025-01-15T12:00:00Z",
      addedSeconds: 3600,
      eligibleSeconds: null,
      reasonCode: "network",
      reasonText: "网络故障补偿",
      actorId: "admin-1",
      operationId: "op-3",
      createdAt: "2025-01-15T10:15:00Z",
    },
  ],
  auditReferences: [
    {
      id: "aud-1",
      action: "incident.investigated",
      actorId: "admin-1",
      actorName: "管理员",
      createdAt: "2025-01-15T10:05:00Z",
    },
  ],
  allowedActions: ["investigate", "resolve"],
  snapshotAt: "2025-01-15T10:05:00Z",
};

function renderPage(incidentId = "incident-1") {
  return render(
    <MemoryRouter initialEntries={[`/admin/recovery/incidents/${incidentId}`]}>
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
              path="/admin/recovery/incidents/:incidentId"
              element={<RecoveryIncidentDetailPage />}
            />
            <Route path="*" element={<div data-testid="unmatched-route" />} />
          </Routes>
        </BrandProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("RecoveryIncidentDetailPage", () => {
  beforeEach(() => {
    getMock.mockReset();
    getMock.mockResolvedValue(mockAggregate);
  });

  it("renders the incident overview header", async () => {
    renderPage();
    expect(
      await screen.findByText("detail page test incident"),
    ).toBeInTheDocument();
    // Status renders through StatusBadge (incident domain keys).
    expect(screen.getByText("调查中")).toBeInTheDocument();
    expect(screen.getByText("严重")).toBeInTheDocument();
    expect(screen.getByText("网络中断")).toBeInTheDocument();
    expect(screen.getAllByText("admin-1").length).toBeGreaterThanOrEqual(1);
  });

  it("renders exam, candidates and attempt summaries with score", async () => {
    renderPage();
    expect(await screen.findByText("网络恢复考试")).toBeInTheDocument();
    expect(screen.getByText("考生张三")).toBeInTheDocument();
    const attemptsSection = screen
      .getByText("答题")
      .closest("section") as HTMLElement;
    expect(within(attemptsSection).getByText(/88\.5/)).toBeInTheDocument();
    expect(within(attemptsSection).getByText("断线")).toBeInTheDocument();
  });

  it("renders events, notes, actions, memberships and interruption links", async () => {
    renderPage();
    expect(await screen.findByText("开始调查")).toBeInTheDocument();
    expect(screen.getByText("已联系考生")).toBeInTheDocument();
    expect(screen.getAllByText("时间补偿").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("受影响")).toBeInTheDocument();
    expect(screen.getByText("interruption-1")).toBeInTheDocument();
  });

  it("renders time adjustment facts (policy/source/deadlines)", async () => {
    renderPage();
    expect(await screen.findByText("人工干预")).toBeInTheDocument();
    expect(screen.getByText("人工")).toBeInTheDocument();
    expect(screen.getByText("+3600s")).toBeInTheDocument();
    expect(screen.getByText(/调整前截止/)).toBeInTheDocument();
    expect(screen.getByText(/调整后截止/)).toBeInTheDocument();
    expect(screen.getByText(/网络故障补偿/)).toBeInTheDocument();
  });

  it("renders audit references with actor names", async () => {
    renderPage();
    expect(
      await screen.findByText("incident.investigated"),
    ).toBeInTheDocument();
    expect(screen.getByText("管理员")).toBeInTheDocument();
  });

  it("renders attempt-operation navigation links (cross-links, not multi-fetch)", async () => {
    renderPage();
    expect(
      (await screen.findAllByText("attempt-1")).length,
    ).toBeGreaterThanOrEqual(1);
    const links = screen
      .getAllByRole("link")
      .filter((l) =>
        l.getAttribute("href")?.includes("/admin/recovery/attempts/"),
      );
    expect(links.length).toBeGreaterThanOrEqual(3);
  });

  it("renders NO action buttons in the read-only phase (allowedActions is never rendered)", async () => {
    renderPage();
    await screen.findByText("detail page test incident");
    // The only interactive element is the back link (an anchor) — the action
    // area is simply not rendered; allowedActions must not produce buttons.
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryByText(/allowedActions/)).not.toBeInTheDocument();
  });

  it("shows the snapshot timestamp and a stale warning for old snapshots", async () => {
    getMock.mockResolvedValue({
      ...mockAggregate,
      snapshotAt: "2025-01-01T00:00:00Z",
    });
    renderPage();
    expect(await screen.findByText(/快照时间：/)).toBeInTheDocument();
    expect(screen.getByText("快照较旧，数据可能已变化")).toBeInTheDocument();
  });

  it("shows a fresh snapshot without a stale warning", async () => {
    getMock.mockResolvedValue({
      ...mockAggregate,
      snapshotAt: new Date().toISOString(),
    });
    renderPage();
    expect(await screen.findByText(/快照时间：/)).toBeInTheDocument();
    expect(
      screen.queryByText("快照较旧，数据可能已变化"),
    ).not.toBeInTheDocument();
  });

  it("shows loading state then data", async () => {
    renderPage();
    expect(screen.getByText("加载中...")).toBeInTheDocument();
    expect(
      await screen.findByText("detail page test incident"),
    ).toBeInTheDocument();
  });

  it("shows not-found for 404 and retry works", async () => {
    getMock.mockRejectedValueOnce(new ApiError(404, "Not found"));
    renderPage();
    expect(await screen.findByText("未找到该事件")).toBeInTheDocument();

    getMock.mockResolvedValue(mockAggregate);
    await userEvent.setup().click(screen.getByText("重试"));
    expect(
      await screen.findByText("detail page test incident"),
    ).toBeInTheDocument();
  });

  it("shows the error state on fetch failure", async () => {
    getMock.mockRejectedValueOnce(new ApiError(0, "Network request failed"));
    renderPage();
    expect(
      await screen.findByText(/Network request failed/),
    ).toBeInTheDocument();
  });
});
