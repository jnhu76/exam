import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { permissionsForRole } from "@exam/authz";
import { AuthProvider } from "@/contexts/AuthContext";
import { BrandProvider } from "@/components/layout/BrandProvider";
import { api } from "@/lib/api";
import type { ProctorIncidentDetail } from "@exam/contracts";
import { ProctorRecoveryIncidentDetailPage } from "./ProctorRecoveryIncidentDetailPage";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: { get: vi.fn(), post: vi.fn() },
  };
});

const getMock = vi.mocked(api.get);
const postMock = vi.mocked(api.post);

const INCIDENT_ID = "00000000-0000-4000-8000-000000000001";

/**
 * The FULL six-action investigate family a Proctor holds on a non-anchored,
 * non-terminal incident — exactly what the server returns for the reviewed
 * gap (link_action / link_interruption were previously not renderable).
 */
const PROCTOR_ALLOWED_ACTIONS = [
  "investigate",
  "add_note",
  "change_severity",
  "link_action",
  "link_attempt",
  "link_interruption",
] as const;

function detail(
  allowedActions: readonly ProctorIncidentDetail["allowedActions"][number][],
): ProctorIncidentDetail {
  return {
    incident: {
      id: INCIDENT_ID,
      examId: "exam-1",
      attemptId: null,
      candidateId: null,
      type: "network_interruption",
      severity: "major",
      status: "open",
      occurredAt: null,
      description: "proctor detail test incident",
      resolutionSummary: null,
      resolvedAt: null,
      resolvedBy: null,
      reportedBy: "proctor-1",
      version: 3,
      createdAt: "2025-01-15T10:00:00Z",
      updatedAt: "2025-01-15T10:00:00Z",
    },
    examSummary: { id: "exam-1", title: "监考考试", status: "open" },
    primaryAttempt: null,
    events: [],
    notes: [],
    actionLinks: [],
    attemptLinks: [],
    interruptionLinks: [],
    allowedActions: [...allowedActions],
    snapshotAt: new Date().toISOString(),
  };
}

function renderPage() {
  return render(
    <MemoryRouter
      initialEntries={[`/admin/proctor/recovery/incidents/${INCIDENT_ID}`]}
    >
      <AuthProvider
        initialUser={{
          id: "proctor-1",
          username: "proctor",
          name: "Proctor",
          role: "Proctor",
          organizationId: "org1",
          capabilities: [...permissionsForRole("Proctor")],
        }}
      >
        <BrandProvider>
          <Routes>
            <Route
              path="/admin/proctor/recovery/incidents/:incidentId"
              element={<ProctorRecoveryIncidentDetailPage />}
            />
            <Route path="*" element={<div data-testid="unmatched-route" />} />
          </Routes>
        </BrandProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("ProctorRecoveryIncidentDetailPage", () => {
  beforeEach(() => {
    getMock.mockReset();
    getMock.mockResolvedValue(detail(PROCTOR_ALLOWED_ACTIONS));
    postMock.mockReset();
    postMock.mockResolvedValue({ outcome: "applied" });
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.error).mockClear();
    window.sessionStorage.clear();
  });

  it("renders every command the server listed in allowedActions", async () => {
    renderPage();
    await screen.findByText("proctor detail test incident");

    // The investigated gap: the whole Proctor investigate family must be
    // reachable from the product surface, not just the API.
    for (const name of [
      "开始调查",
      "添加备注",
      "修改严重程度",
      "关联操作记录",
      "关联答题",
      "关联中断证据",
    ]) {
      expect(
        screen.getByRole("button", { name }),
        `missing action button: ${name}`,
      ).toBeInTheDocument();
    }
  });

  it("never offers Admin terminal judgment, even on an open incident", async () => {
    renderPage();
    await screen.findByText("proctor detail test incident");
    expect(
      screen.queryByRole("button", { name: "解决事件" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "驳回事件" }),
    ).not.toBeInTheDocument();
  });

  it("omits every command the server did NOT list (read-only projection)", async () => {
    getMock.mockResolvedValue(detail([]));
    renderPage();
    await screen.findByText("proctor detail test incident");
    expect(screen.queryByText("操作")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: /开始调查|添加备注|修改严重程度|关联操作记录|关联答题|关联中断证据/,
      }),
    ).not.toBeInTheDocument();
  });

  it("posts link_action to the canonical incident action endpoint with a frozen operationId", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("proctor detail test incident");

    await user.click(screen.getByRole("button", { name: "关联操作记录" }));
    await user.click(screen.getByRole("combobox", { name: "操作类型" }));
    await user.click(await screen.findByRole("option", { name: "时间补偿" }));
    await user.type(
      screen.getByLabelText("操作记录 ID"),
      "adjustment-1234567890",
    );
    await user.click(screen.getByRole("button", { name: "关联操作记录" }));

    expect(postMock).toHaveBeenCalledTimes(1);
    const [url, body] = postMock.mock.calls[0]! as unknown as [
      string,
      {
        operationId: string;
        expectedVersion: number;
        actionType: string;
        actionId: string;
      },
    ];
    expect(url).toBe(`/api/admin/incidents/${INCIDENT_ID}/actions`);
    expect(body.operationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.expectedVersion).toBe(3);
    expect(body.actionType).toBe("time_grant");
    // The referent field name is the API contract's `actionId` — a rename here
    // would be a runtime 400 in production with no other test catching it.
    expect(body.actionId).toBe("adjustment-1234567890");
  });

  it("posts link_interruption to the canonical interruption endpoint", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("proctor detail test incident");

    await user.click(screen.getByRole("button", { name: "关联中断证据" }));
    await user.type(
      screen.getByLabelText("中断记录 ID"),
      "00000000-0000-4000-8000-000000000099",
    );
    await user.click(screen.getByRole("button", { name: "关联中断证据" }));

    expect(postMock).toHaveBeenCalledTimes(1);
    const [url, body] = postMock.mock.calls[0]! as unknown as [string, object];
    expect(url).toBe(`/api/admin/incidents/${INCIDENT_ID}/interruptions`);
    expect(body).toMatchObject({
      interruptionId: "00000000-0000-4000-8000-000000000099",
      expectedVersion: 3,
    });
  });
});
