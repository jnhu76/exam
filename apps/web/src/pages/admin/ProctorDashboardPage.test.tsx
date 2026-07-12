import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { ProctorDashboardPage } from "./ProctorDashboardPage";

// Ownership-sensitive mock: capture the canonical status keys the page routes
// through the shared StatusBadge boundary. A local severity → variant decision
// (the bypass this test guards against) would NOT call StatusBadge with
// `misconduct_${severity}`, so this assertion fails if the bypass returns.
const statusBadgeProps: { status: string }[] = [];
vi.mock("@/components/shared/StatusBadge", () => ({
  StatusBadge: ({ status }: { status: string }) => {
    statusBadgeProps.push({ status });
    return (
      <span data-testid="status-badge" data-status={status}>
        {status}
      </span>
    );
  },
}));

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn() },
  setNavigate: () => {},
}));

const apiGet = vi.mocked(api.get);

function makeCandidate(overrides: Record<string, unknown> = {}) {
  return {
    candidateId: "cand-1",
    name: "张三",
    attemptId: "att-1",
    status: "in_progress",
    deadlineAt: null,
    lastActivityAt: null,
    misconduct: null,
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/admin/exams/exam-1/proctor"]}>
      <Routes>
        <Route
          path="/admin/exams/:id/proctor"
          element={<ProctorDashboardPage />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ProctorDashboardPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    statusBadgeProps.length = 0;
  });

  it("routes misconduct severity through the canonical statusMeta authority", async () => {
    apiGet.mockResolvedValueOnce({
      candidates: [
        makeCandidate({
          misconduct: {
            flaggedAt: "2026-01-01T00:00:00Z",
            flaggedBy: "admin",
            notes: "looked away",
            severity: "warning",
          },
        }),
        makeCandidate({
          candidateId: "cand-2",
          name: "李四",
          misconduct: {
            flaggedAt: "2026-01-01T00:00:00Z",
            flaggedBy: "admin",
            notes: "phone visible",
            severity: "serious",
          },
        }),
      ],
      total: 2,
    });

    renderPage();
    await waitFor(() => {
      expect(screen.getByText("张三")).toBeInTheDocument();
    });

    // The candidate attempt *status* (in_progress) is routed through
    // StatusBadge, and — critically — misconduct severity is routed through
    // the SAME authority via `misconduct_${severity}`. A local severity →
    // Badge-variant decision would never produce these canonical keys.
    const misconductStatuses = statusBadgeProps
      .filter((p) => p.status.startsWith("misconduct_"))
      .map((p) => p.status)
      .sort();
    expect(misconductStatuses).toEqual([
      "misconduct_serious",
      "misconduct_warning",
    ]);
  });

  // Characterization (UI-MIGRATE-N-W4B): each candidate card is a Card-primitive
  // container that owns its elevation. After the business `shadow-sm` is removed
  // (the Card primitive already supplies it), the candidate name and status must
  // still sit inside a `data-slot="card"` region. Asserts the durable container
  // role, not the raw shadow token.
  it("keeps each candidate card as a Card region holding name and status", async () => {
    apiGet.mockResolvedValueOnce({
      candidates: [makeCandidate()],
      total: 1,
    });
    renderPage();
    const name = await screen.findByText("张三");
    const card = name.closest("[data-slot='card']");
    expect(card).toBeInTheDocument();
    // The candidate attempt status routes through StatusBadge inside the card.
    expect(
      card?.querySelector("[data-testid='status-badge']"),
    ).toBeInTheDocument();
  });
});
