import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { AuthProvider } from "@/contexts/AuthContext";
import type { MeResponse, TimeGrantRequest } from "@exam/contracts";
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

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const apiGet = vi.mocked(api.get);
const apiPost = vi.mocked(api.post);

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

const adminUser: MeResponse = {
  id: "admin-1",
  username: "admin",
  name: "Admin",
  role: "Admin",
  organizationId: "org-1",
  capabilities: [],
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/admin/exams/exam-1/proctor"]}>
      <AuthProvider initialUser={adminUser}>
        <Routes>
          <Route
            path="/admin/exams/:id/proctor"
            element={<ProctorDashboardPage />}
          />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("ProctorDashboardPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    statusBadgeProps.length = 0;
    // The grant dialog persists pending (indeterminate) commands in
    // sessionStorage; clear it between tests so one test's leftover pending
    // command cannot leak into another.
    sessionStorage.clear();
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

  // ── Operator time-grant dialog (P1-3 / P1-4) ────────────────────────────
  //
  // The grant dialog implements a draft → submitting → (indeterminate | done)
  // state machine. operationId is command identity: it is minted when the
  // dialog opens, frozen on first submit, and reused verbatim on retry. The
  // outcome (granted / idempotent_replay / terminal) drives distinct UI.
  describe("operator time-grant dialog", () => {
    /** Opens the grant dialog for the first candidate's extend button. */
    async function openGrantDialog() {
      // The card's extend button label ("延长时间").
      const extendBtn = await screen.findByRole("button", { name: "延长时间" });
      fireEvent.click(extendBtn);
      await screen.findByText("延长考试时间");
    }

    /** Fills the reason textarea and clicks the confirm (10-minute) button. */
    async function submitGrant() {
      const reason = await screen.findByPlaceholderText("请说明延长原因");
      fireEvent.change(reason, { target: { value: "网络中断" } });
      const confirm = await screen.findByRole("button", {
        name: "延长 10 分钟",
      });
      fireEvent.click(confirm);
    }

    it("branches on outcome: granted shows a success toast", async () => {
      apiGet.mockResolvedValue({
        candidates: [makeCandidate()],
        total: 1,
      });
      apiPost.mockResolvedValueOnce({
        outcome: "granted",
        adjustment: {
          id: "adj-1",
          operationId: "op-1",
          attemptId: "att-1",
          source: "operator",
          beforeDeadline: "2026-01-01T00:00:00Z",
          afterDeadline: "2026-01-01T00:10:00Z",
          addedSeconds: 600,
          reasonCode: "technical_incident",
          reasonText: "网络中断",
          interruptionId: null,
          incidentId: null,
          createdAt: "2026-01-01T00:00:00Z",
        },
        attempt: {
          id: "att-1",
          status: "in_progress",
          deadlineAt: "2026-01-01T00:10:00Z",
        },
      });
      renderPage();
      await openGrantDialog();
      await submitGrant();

      await waitFor(() => {
        expect(toast.success).toHaveBeenCalledWith(
          expect.stringContaining("已延长"),
        );
      });
    });

    it("branches on outcome: terminal shows a WARNING (not success), no '已延长'", async () => {
      apiGet.mockResolvedValue({
        candidates: [makeCandidate()],
        total: 1,
      });
      apiPost.mockResolvedValueOnce({
        outcome: "terminal",
        adjustment: null,
        attempt: {
          id: "att-1",
          status: "graded",
          deadlineAt: null,
        },
      });
      renderPage();
      await openGrantDialog();
      await submitGrant();

      await waitFor(() => {
        // terminal must NOT use success — it reports that nothing was granted.
        expect(toast.warning).toHaveBeenCalled();
      });
      expect(toast.success).not.toHaveBeenCalled();
    });

    it("reuses the SAME operationId + payload on retry after an indeterminate failure", async () => {
      apiGet.mockResolvedValue({
        candidates: [makeCandidate()],
        total: 1,
      });
      // First attempt: network failure (status 0) → indeterminate.
      apiPost.mockRejectedValueOnce(new Error("Network request failed"));
      // Retry: succeeds as granted.
      apiPost.mockResolvedValueOnce({
        outcome: "granted",
        adjustment: {
          id: "adj-1",
          operationId: "op-1",
          attemptId: "att-1",
          source: "operator",
          beforeDeadline: "2026-01-01T00:00:00Z",
          afterDeadline: "2026-01-01T00:10:00Z",
          addedSeconds: 600,
          reasonCode: "technical_incident",
          reasonText: "网络中断",
          interruptionId: null,
          incidentId: null,
          createdAt: "2026-01-01T00:00:00Z",
        },
        attempt: {
          id: "att-1",
          status: "in_progress",
          deadlineAt: "2026-01-01T00:10:00Z",
        },
      });
      renderPage();
      await openGrantDialog();
      await submitGrant();

      // First POST captured.
      await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
      const firstBody = apiPost.mock.calls[0]![1] as Record<string, unknown>;
      const firstOpId = firstBody.operationId as string;

      // After the indeterminate failure, the dialog reopens to the same frozen
      // command (retry button). Retry must send the identical operationId and
      // identical payload.
      await waitFor(() => {
        expect(toast.warning).toHaveBeenCalled();
      });
      const retryBtn = await screen.findByRole("button", {
        name: "重试同一加时",
      });
      fireEvent.click(retryBtn);

      await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(2));
      const retryBody = apiPost.mock.calls[1]![1] as Record<string, unknown>;
      expect(retryBody.operationId).toBe(firstOpId);
      expect(retryBody.addedSeconds).toBe(firstBody.addedSeconds);
      expect(retryBody.reasonCode).toBe(firstBody.reasonCode);
      expect(retryBody.reasonText).toBe(firstBody.reasonText);

      // Confirmed success clears the pending command.
      await waitFor(() => {
        expect(toast.success).toHaveBeenCalledWith(
          expect.stringContaining("已延长"),
        );
      });
    });

    it("IDEMPOTENCY_CONFLICT clears the command and surfaces the conflict", async () => {
      apiGet.mockResolvedValue({
        candidates: [makeCandidate()],
        total: 1,
      });
      // The thrown error must carry code=IDEMPOTENCY_CONFLICT for classification.
      const conflict = Object.assign(new Error("操作标识符与已有请求冲突"), {
        status: 409,
        code: "IDEMPOTENCY_CONFLICT",
      });
      // Register BOTH mocks up front: first rejects with the conflict, second
      // succeeds as granted. Registering the success mock after the second
      // submitGrant() would be too late — the second request would hit the base
      // mock (undefined) and could fall into the indeterminate branch.
      apiPost.mockRejectedValueOnce(conflict);
      apiPost.mockResolvedValueOnce({
        outcome: "granted",
        adjustment: {
          id: "adj-2",
          operationId: "op-2",
          attemptId: "att-1",
          source: "operator",
          beforeDeadline: "2026-01-01T00:00:00Z",
          afterDeadline: "2026-01-01T00:10:00Z",
          addedSeconds: 600,
          reasonCode: "technical_incident",
          reasonText: "网络中断",
          interruptionId: null,
          incidentId: null,
          createdAt: "2026-01-01T00:00:00Z",
        },
        attempt: {
          id: "att-1",
          status: "in_progress",
          deadlineAt: "2026-01-01T00:10:00Z",
        },
      });

      renderPage();
      await openGrantDialog();
      await submitGrant();

      // First POST captured.
      await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
      const firstBody = apiPost.mock.calls[0]![1] as TimeGrantRequest;
      const firstOperationId = firstBody.operationId;

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith(
          expect.stringContaining("加时标识已被其他请求占用"),
        );
      });

      // The frozen command was cleared — reopening must mint a NEW operationId,
      // not reuse the conflicted one.
      await openGrantDialog();
      await submitGrant();

      await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(2));
      const secondBody = apiPost.mock.calls[1]![1] as TimeGrantRequest;

      // The new command must carry a fresh identity, the normal payload, and
      // resolve as a confirmed grant (not indeterminate).
      expect(secondBody.operationId).not.toBe(firstOperationId);
      expect(secondBody.addedSeconds).toBe(600);
      expect(secondBody.reasonCode).toBe("technical_incident");
      expect(toast.success).toHaveBeenCalled();
    });

    it("renders and opens the grant dialog without randomUUID (non-secure context)", async () => {
      // Simulate a plain-HTTP LAN origin where crypto.randomUUID is unavailable
      // (non-secure context). The page must still render, and opening the grant
      // dialog must not throw. Restores the original property after the test.
      const originalRandomUUID = crypto.randomUUID;
      // @ts-expect-error — deliberately removing randomUUID to simulate a
      // non-secure context where it is undefined.
      delete crypto.randomUUID;
      try {
        apiGet.mockResolvedValue({
          candidates: [makeCandidate()],
          total: 1,
        });
        apiPost.mockResolvedValueOnce({
          outcome: "granted",
          adjustment: {
            id: "adj-1",
            operationId: "op-1",
            attemptId: "att-1",
            source: "operator",
            beforeDeadline: "2026-01-01T00:00:00Z",
            afterDeadline: "2026-01-01T00:10:00Z",
            addedSeconds: 600,
            reasonCode: "technical_incident",
            reasonText: "网络中断",
            interruptionId: null,
            incidentId: null,
            createdAt: "2026-01-01T00:00:00Z",
          },
          attempt: {
            id: "att-1",
            status: "in_progress",
            deadlineAt: "2026-01-01T00:10:00Z",
          },
        });

        renderPage();
        // Page still renders and shows the candidate.
        expect(await screen.findByText("张三")).toBeInTheDocument();

        // Opening the dialog must not throw even without randomUUID.
        await openGrantDialog();
        expect(screen.getByText("延长考试时间")).toBeInTheDocument();

        // Submitting sends a well-formed UUID operationId.
        await submitGrant();
        await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
        const body = apiPost.mock.calls[0]![1] as TimeGrantRequest;
        expect(body.operationId).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        );

        await waitFor(() => {
          expect(toast.success).toHaveBeenCalledWith(
            expect.stringContaining("已延长"),
          );
        });
      } finally {
        // Restore so other tests are not polluted.
        crypto.randomUUID = originalRandomUUID;
      }
    });

    it("mints a fresh operationId on confirmed outcome", async () => {
      apiGet.mockResolvedValue({
        candidates: [makeCandidate()],
        total: 1,
      });
      apiPost.mockResolvedValueOnce({
        outcome: "granted",
        adjustment: {
          id: "adj-1",
          operationId: "op-1",
          attemptId: "att-1",
          source: "operator",
          beforeDeadline: "2026-01-01T00:00:00Z",
          afterDeadline: "2026-01-01T00:10:00Z",
          addedSeconds: 600,
          reasonCode: "technical_incident",
          reasonText: "网络中断",
          interruptionId: null,
          incidentId: null,
          createdAt: "2026-01-01T00:00:00Z",
        },
        attempt: {
          id: "att-1",
          status: "in_progress",
          deadlineAt: "2026-01-01T00:10:00Z",
        },
      });

      renderPage();
      await openGrantDialog();
      await submitGrant();
      await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
      const firstBody = apiPost.mock.calls[0]![1] as TimeGrantRequest;

      // After a confirmed grant, the dialog resets to a draft with a NEW
      // operationId. Reopen and submit again to capture it.
      await openGrantDialog();
      // The draft was reset — the reason text is empty, so we must fill it.
      const reason = await screen.findByPlaceholderText("请说明延长原因");
      fireEvent.change(reason, { target: { value: "设备故障" } });
      const confirm = await screen.findByRole("button", {
        name: "延长 10 分钟",
      });
      fireEvent.click(confirm);

      await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(2));
      const secondBody = apiPost.mock.calls[1]![1] as TimeGrantRequest;
      expect(secondBody.operationId).not.toBe(firstBody.operationId);
    });
  });
});
