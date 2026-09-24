import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { permissionsForRole } from "@exam/authz";
import type { ProctorRecoveryWorklistResponse } from "@exam/contracts";
import { AuthProvider } from "@/contexts/AuthContext";
import { BrandProvider } from "@/components/layout/BrandProvider";
import { api } from "@/lib/api";
import { ProctorRecoveryPage } from "./ProctorRecoveryPage";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      get: vi.fn(),
    },
    setNavigate: () => {},
  };
});

const getMock = vi.mocked(api.get);

function makeWorklist(
  collectionScope: ProctorRecoveryWorklistResponse["collectionScope"],
): ProctorRecoveryWorklistResponse {
  return {
    items: [
      {
        incident: {
          id: "incident-1",
          examId: "exam-1",
          attemptId: "attempt-1",
          candidateId: null,
          type: "network_interruption",
          severity: "major",
          status: "open",
          occurredAt: null,
          description: "scope test incident",
          resolutionSummary: null,
          resolvedAt: null,
          resolvedBy: null,
          reportedBy: "admin-1",
          version: 1,
          createdAt: "2025-01-15T10:00:00Z",
          updatedAt: "2025-01-15T10:00:00Z",
        },
        examSummary: { id: "exam-1", title: "监考处置考试", status: "open" },
        primaryAttempt: { id: "attempt-1", candidateId: null, status: "open" },
      },
    ],
    nextCursor: null,
    snapshotAt: "2025-01-15T10:00:00Z",
    collectionScope,
  };
}

/**
 * issue 606: the SAME account is rendered against BOTH server-reported scopes. If
 * the page derived scope from role/capabilities, one of these pairs would
 * fail — the rendered scope must track the WIRE FACT, never the user.
 */
function renderPageForScope(
  collectionScope: ProctorRecoveryWorklistResponse["collectionScope"],
  userRole: "Admin" | "Proctor",
) {
  return render(
    <MemoryRouter initialEntries={["/admin/proctor/recovery"]}>
      <AuthProvider
        initialUser={{
          id: "user-1",
          username: "actor",
          name: "Actor",
          role: userRole,
          organizationId: "org1",
          capabilities: [...permissionsForRole(userRole)],
        }}
      >
        <BrandProvider>
          <Routes>
            <Route
              path="/admin/proctor/recovery"
              element={<ProctorRecoveryPage />}
            />
            <Route
              path="/admin/proctor/recovery/incidents/:incidentId"
              element={<div data-testid="incident-detail-stub" />}
            />
          </Routes>
        </BrandProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("ProctorRecoveryPage — collectionScope presentation (issue 606)", () => {
  beforeEach(() => {
    getMock.mockReset();
  });

  it("renders the organization scope the server reported, for an Admin caller", async () => {
    getMock.mockResolvedValue(makeWorklist("organization"));
    renderPageForScope("organization", "Admin");
    expect(
      await screen.findByTestId("proctor-recovery-collection-scope"),
    ).toHaveTextContent("范围：组织内全部考试");
  });

  it("renders the active-assignments scope the server reported, for a Proctor caller", async () => {
    getMock.mockResolvedValue(makeWorklist("active_assignments"));
    renderPageForScope("active_assignments", "Proctor");
    expect(
      await screen.findByTestId("proctor-recovery-collection-scope"),
    ).toHaveTextContent("范围：我的当前监考任务");
  });

  it("scope follows the WIRE FACT, not the user's role: Admin + active_assignments response", async () => {
    // Deliberately "impossible" per current policy — if the page branched on
    // user.role (the forbidden second scope authority), it would render the
    // organization copy here. It must render what the server said.
    getMock.mockResolvedValue(makeWorklist("active_assignments"));
    renderPageForScope("active_assignments", "Admin");
    expect(
      await screen.findByTestId("proctor-recovery-collection-scope"),
    ).toHaveTextContent("范围：我的当前监考任务");
    expect(screen.queryByText("范围：组织内全部考试")).not.toBeInTheDocument();
  });

  it("scope follows the WIRE FACT, not the user's role: Proctor + organization response", async () => {
    getMock.mockResolvedValue(makeWorklist("organization"));
    renderPageForScope("organization", "Proctor");
    expect(
      await screen.findByTestId("proctor-recovery-collection-scope"),
    ).toHaveTextContent("范围：组织内全部考试");
    expect(
      screen.queryByText("范围：我的当前监考任务"),
    ).not.toBeInTheDocument();
  });

  it("never renders the retired fixed assignment sentence", async () => {
    getMock.mockResolvedValue(makeWorklist("organization"));
    renderPageForScope("organization", "Admin");
    await screen.findByTestId("proctor-recovery-collection-scope");
    expect(screen.queryByText(/与您监考分配相关/)).not.toBeInTheDocument();
  });
});
