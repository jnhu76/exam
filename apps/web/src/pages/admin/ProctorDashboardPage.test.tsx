import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { AuthProvider } from "@/contexts/AuthContext";
import type { MeResponse, TimeGrantRequest } from "@exam/contracts";
import { ProctorDashboardPage } from "./ProctorDashboardPage";
import { resetPendingGrantCoordinator } from "@/features/operator-grant/pendingGrantCoordinatorSingleton";

/**
 * Seeds localStorage with a pending-grant authority for the test admin
 * (org-1 / admin-1), restoring the exact frozen command the page would use.
 *
 * `withActiveLease` controls whether the authority has a non-expired in-flight
 * lease (true → an indeterminate retry MUST get a LeaseConflict and send NO
 * POST) or no lease at all (false → claimForSend succeeds and the retry POSTs).
 *
 * The expiry is computed against the real clock the production coordinator uses
 * (Date.now), so an active lease is `Date.now() + 30_000`.
 */
function seedPendingAuthority(
  overrides: Partial<{
    attemptId: string;
    operationId: string;
    addedSeconds: number;
    withActiveLease: boolean;
  }> = {},
): {
  operationId: string;
  attemptId: string;
  addedSeconds: number;
  revision: number;
  leaseId: string;
} {
  const operationId = overrides.operationId ?? "seed-op-1";
  const attemptId = overrides.attemptId ?? "att-1";
  const addedSeconds = overrides.addedSeconds ?? 600;
  const leaseId = "seed-lease-1";
  const authority = {
    schemaVersion: 1 as const,
    organizationId: "org-1",
    actorId: "admin-1",
    command: {
      attemptId,
      operationId,
      addedSeconds,
      reasonCode: "technical_incident",
      reasonText: "网络中断",
    },
    revision: 1,
    createdAt: Date.now(),
    inFlightLease: overrides.withActiveLease
      ? {
          tabId: "other-tab",
          leaseId,
          expiresAt: Date.now() + 30_000,
        }
      : undefined,
  };
  localStorage.setItem(
    "exam.pendingGrantAuthority:org-1:admin-1",
    JSON.stringify(authority),
  );
  return { operationId, attemptId, addedSeconds, revision: 1, leaseId };
}

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
    // Clear shared state between tests so one test's leftover pending command
    // cannot leak into another.
    sessionStorage.clear();
    localStorage.clear();
    resetPendingGrantCoordinator();
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

    it("fails closed when cross-tab coordination is unavailable (corrupt authority)", async () => {
      // REC-I4-C1: if the shared authority cannot be read (corrupted record),
      // openGrantDialog must NOT fall back to a fresh draft (which would mint a
      // new uncoordinated operationId). It must show coordinationUnavailable
      // and keep the dialog closed. Mirrors coordinator unit-test case 9.
      apiGet.mockResolvedValue({
        candidates: [makeCandidate()],
        total: 1,
      });
      // adminUser = { id: "admin-1", organizationId: "org-1" } → the
      // coordinator's shared storage key is exam.pendingGrantAuthority:org-1:admin-1.
      // Poison it with unparseable JSON so readAuthority throws
      // CoordinationUnavailableError, making getCurrent return { ok: false }.
      localStorage.setItem(
        "exam.pendingGrantAuthority:org-1:admin-1",
        "not-valid-json{{{",
      );

      renderPage();
      await screen.findByText("张三");

      const extendBtn = await screen.findByRole("button", { name: "延长时间" });
      fireEvent.click(extendBtn);

      // Must fail closed: error toast shown, dialog NOT opened.
      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith(
          expect.stringContaining("无法安全协调"),
        );
      });
      expect(screen.queryByText("延长考试时间")).not.toBeInTheDocument();
      // No grant request was ever sent.
      expect(apiPost).not.toHaveBeenCalled();
    });

    it("fails closed when cross-tab coordination is unavailable (storage blocked)", async () => {
      // REC-I4-C1: if the browser blocks the localStorage getter (e.g. disabled
      // storage policy), opening the grant dialog must not crash or silently
      // degrade to a fresh draft. The lazy storage adapter surfaces the failure
      // as a CoordinationUnavailable Result, and the page shows the coordination
      // unavailable message while keeping the dialog closed.
      apiGet.mockResolvedValue({
        candidates: [makeCandidate()],
        total: 1,
      });

      const getterSpy = vi
        .spyOn(window, "localStorage", "get")
        .mockImplementation(() => {
          throw new DOMException(
            "Access is denied for this document",
            "SecurityError",
          );
        });

      renderPage();
      await screen.findByText("张三");

      const extendBtn = await screen.findByRole("button", { name: "延长时间" });
      fireEvent.click(extendBtn);

      // Must fail closed: error toast shown, dialog NOT opened.
      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith(
          expect.stringContaining("无法安全协调"),
        );
      });
      expect(screen.queryByText("延长考试时间")).not.toBeInTheDocument();
      // No grant request was ever sent.
      expect(apiPost).not.toHaveBeenCalled();

      getterSpy.mockRestore();
    });

    // ── Send-claim ownership (REC-I4-C1 follow-up #233) ───────────────────
    //
    // The retry path MUST `claimForSend` before POST. If a non-expired lease
    // already exists (another tab is sending), the POST is suppressed, the
    // frozen command is KEPT, no new operationId is minted, and the lease
    // conflict warning is shown. If no lease exists, the claim succeeds and
    // the POST replays the exact frozen command.
    describe("indeterminate retry send-claim (claimForSend)", () => {
      it("suppresses the POST when an active lease exists (lease conflict)", async () => {
        // Seed an indeterminate authority for att-1 WITH a non-expired lease
        // held by another tab. The retry must get LeaseConflictError → no POST.
        apiGet.mockResolvedValue({
          candidates: [makeCandidate()],
          total: 1,
        });
        seedPendingAuthority({ withActiveLease: true });

        renderPage();
        await screen.findByText("张三");

        // Open the dialog: the coordinator's getCurrent restores the frozen
        // command as indeterminate (retry button visible).
        const extendBtn = await screen.findByRole("button", {
          name: "延长时间",
        });
        fireEvent.click(extendBtn);
        await screen.findByText("延长考试时间");
        const retryBtn = await screen.findByRole("button", {
          name: "重试同一加时",
        });
        expect(retryBtn).toBeInTheDocument();

        // Retry: claimForSend must return LeaseConflictError → NO POST.
        fireEvent.click(retryBtn);
        await waitFor(() => {
          expect(toast.warning).toHaveBeenCalledWith(
            expect.stringContaining("另一个标签页正在处理"),
          );
        });
        // Definitive proof: zero time-grants POST was sent.
        expect(apiPost).not.toHaveBeenCalled();
      });

      it("re-claims and POSTs the identical frozen command when no lease exists", async () => {
        // Seed an indeterminate authority with NO active lease (it was
        // released). The retry's claimForSend succeeds → POST the exact frozen
        // command, then clearConfirmed on the confirmed result.
        apiGet.mockResolvedValue({
          candidates: [makeCandidate()],
          total: 1,
        });
        const seeded = seedPendingAuthority({ withActiveLease: false });
        apiPost.mockResolvedValueOnce({
          outcome: "idempotent_replay",
          adjustment: null,
          attempt: {
            id: "att-1",
            status: "in_progress",
            deadlineAt: "2026-01-01T00:10:00Z",
          },
        });

        renderPage();
        await screen.findByText("张三");

        const extendBtn = await screen.findByRole("button", {
          name: "延长时间",
        });
        fireEvent.click(extendBtn);
        await screen.findByText("延长考试时间");
        const retryBtn = await screen.findByRole("button", {
          name: "重试同一加时",
        });

        fireEvent.click(retryBtn);

        // Exactly one POST, carrying the EXACT frozen command identity.
        await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
        const body = apiPost.mock.calls[0]![1] as TimeGrantRequest;
        expect(body.operationId).toBe(seeded.operationId);
        expect(body.addedSeconds).toBe(seeded.addedSeconds);
        expect(body.reasonCode).toBe("technical_incident");
        expect(body.reasonText).toBe("网络中断");

        // Confirmed result (idempotent_replay) clears the authority and
        // surfaces the replay toast — no false "second grant".
        await waitFor(() => {
          expect(toast.success).toHaveBeenCalledWith(
            expect.stringContaining("该加时已处理"),
          );
        });
      });

      it("releases the lease on an indeterminate retry failure and keeps the frozen command", async () => {
        // No seeded authority — drive a real draft → indeterminate flow, then
        // prove the retry re-claims and a SECOND indeterminate failure releases.
        apiGet.mockResolvedValue({
          candidates: [makeCandidate()],
          total: 1,
        });
        // First send (draft): network failure → indeterminate.
        apiPost.mockRejectedValueOnce(new Error("Network request failed"));
        // Retry: also indeterminate (another masked 5xx).
        apiPost.mockRejectedValueOnce(new Error("Network request failed"));

        renderPage();
        await openGrantDialog();
        await submitGrant();

        // First POST captured → indeterminate, retry affordance appears.
        await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
        const retryBtn = await screen.findByRole("button", {
          name: "重试同一加时",
        });
        fireEvent.click(retryBtn);

        // The retry re-claimed then POSTed again, then failed indeterminate →
        // releaseIndeterminate surrendered the lease but kept the command, so
        // the retry button must STILL be available for a later retry.
        await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(2));
        await waitFor(() => {
          expect(toast.warning).toHaveBeenCalledWith(
            expect.stringContaining("未确认加时是否成功"),
          );
        });
        // The frozen command is retained → retry affordance still present.
        expect(
          await screen.findByRole("button", { name: "重试同一加时" }),
        ).toBeInTheDocument();
      });

      it("fails closed when coordination becomes unavailable mid-retry", async () => {
        // Seed an indeterminate authority, then poison the storage AFTER the
        // dialog opens so the retry's claimForSend hits a CoordinationUnavailable.
        apiGet.mockResolvedValue({
          candidates: [makeCandidate()],
          total: 1,
        });
        seedPendingAuthority({ withActiveLease: false });

        renderPage();
        await screen.findByText("张三");
        const extendBtn = await screen.findByRole("button", {
          name: "延长时间",
        });
        fireEvent.click(extendBtn);
        await screen.findByText("延长考试时间");

        // Corrupt the shared authority so claimForSend fails closed.
        localStorage.setItem(
          "exam.pendingGrantAuthority:org-1:admin-1",
          "not-valid-json{{{",
        );

        const retryBtn = await screen.findByRole("button", {
          name: "重试同一加时",
        });
        fireEvent.click(retryBtn);

        // Fail closed: coordination-unavailable error, NO POST.
        await waitFor(() => {
          expect(toast.error).toHaveBeenCalledWith(
            expect.stringContaining("无法安全协调"),
          );
        });
        expect(apiPost).not.toHaveBeenCalled();
      });
    });
  });
});
