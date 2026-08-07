import {
  act,
  render,
  screen,
  waitFor,
  fireEvent,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { api } from "@/lib/api";
import i18n from "@/i18n";
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

      // ── Stale-response reconciliation (review P1) ─────────────────────────
      //
      // A late stale indeterminate response must NOT revive a hidden local
      // indeterminate state. Scenario:
      //   Tab is submitting a frozen command; the request fails indeterminate.
      //   Meanwhile another tab confirmed + CLEARED the authority (the
      //   authority_cleared broadcast already closed this dialog). The stale
      //   response's releaseIndeterminate returns a mismatch; reconciliation
      //   re-reads the shared authority, sees it gone, and resets to a fresh
      //   draft + resolvedInAnotherTab info toast. A subsequent attempt on a
      //   DIFFERENT candidate must open without a false block.
      it("a stale indeterminate response does not revive a hidden local state after the authority was cleared elsewhere", async () => {
        apiGet.mockResolvedValue({
          candidates: [makeCandidate()],
          total: 1,
        });
        // Seed a released authority (NO active lease) for att-1. openGrantDialog
        // restores it as indeterminate; retry will claimForSend (succeeds, fresh
        // lease) then POST.
        seedPendingAuthority({ withActiveLease: false });

        // The POST resolves indeterminate (network failure). Crucially, we
        // simulate the cross-tab clear happening DURING the in-flight request:
        // remove the shared authority from localStorage before the request
        // rejects, so the subsequent releaseIndeterminate sees no authority and
        // returns a mismatch.
        apiPost.mockImplementationOnce(async () => {
          localStorage.removeItem("exam.pendingGrantAuthority:org-1:admin-1");
          throw new Error("Network request failed");
        });

        renderPage();
        await screen.findByText("张三");
        const extendBtn = await screen.findByRole("button", {
          name: "延长时间",
        });
        fireEvent.click(extendBtn);
        await screen.findByText("延长考试时间");
        // Retry the frozen command (claimForSend → POST).
        const retryBtn = await screen.findByRole("button", {
          name: "重试同一加时",
        });
        fireEvent.click(retryBtn);

        // The stale indeterminate response reconciles against the (now empty)
        // shared authority → reset + resolvedInAnotherTab info toast.
        await waitFor(() => {
          expect(toast.info).toHaveBeenCalledWith(
            expect.stringContaining("其他标签页处理"),
          );
        });
        // No hidden local indeterminate state survived: the dialog was reset to
        // a fresh draft (retry affordance gone).
        expect(
          screen.queryByRole("button", { name: "重试同一加时" }),
        ).not.toBeInTheDocument();

        // Reopen the grant dialog for the SAME candidate. Because the local
        // stale indeterminate state was discarded and the shared authority is
        // now empty, openGrantDialog reads the authority first and opens a
        // FRESH draft — NOT a retry. No blockedByPending warning either.
        fireEvent.click(extendBtn);
        await screen.findByText("延长考试时间");
        // Fresh draft → confirm button shows "延长 10 分钟", NOT "重试同一加时".
        expect(
          screen.getByRole("button", { name: "延长 10 分钟" }),
        ).toBeInTheDocument();
        expect(
          screen.queryByRole("button", { name: "重试同一加时" }),
        ).not.toBeInTheDocument();
        expect(toast.warning).not.toHaveBeenCalledWith(
          expect.stringContaining("存在未确认的加时命令"),
        );
      });
    });
  });

  describe("force-submit retry identity (J5-I1C Slice 2 review P1-1/P1-2 + re-review)", () => {
    async function openForceSubmitDialog() {
      const trigger = await screen.findByRole("button", { name: "强制交卷" });
      fireEvent.click(trigger);
      // The dialog content renders after the click.
      await screen.findByText("确认强制交卷");
    }

    async function confirmForceSubmit() {
      // The confirm button label differs by state: "确认" on a fresh action,
      // "重试强制交卷" when an indeterminate command is being retried.
      const confirmBtn = await screen.findByRole("button", {
        name: /确认|重试强制交卷/,
      });
      // The click handler is async: `handleForceSubmitConfirm` → POST →
      // continuation state updates, and on success a chained `loadStatus()`.
      // fireEvent only wraps the synchronous dispatch in act(); awaiting
      // act() flushes the whole continuation chain, so no render lands
      // outside act() (removes the "not wrapped in act" warnings).
      await act(async () => {
        fireEvent.click(confirmBtn);
      });
    }

    /** Returns the page-level pending banner, or fails if it is absent. */
    async function pendingBanner() {
      return screen.findByTestId("pending-force-submit-banner");
    }

    it("reuses the SAME operationId + reason on retry after an indeterminate (network) failure", async () => {
      apiGet.mockResolvedValue({
        candidates: [makeCandidate()],
        total: 1,
      });
      // First attempt: network failure (status 0) → indeterminate.
      apiPost.mockRejectedValueOnce(new Error("Network request failed"));
      // Retry: succeeds (any 200 disposition).
      apiPost.mockResolvedValueOnce({ disposition: "applied" });

      renderPage();
      await openForceSubmitDialog();
      await confirmForceSubmit();

      // First POST captured.
      await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
      const firstBody = apiPost.mock.calls[0]![1] as Record<string, unknown>;
      const firstOpId = firstBody.operationId as string;
      expect(firstBody.reason).toBe("管理员强制交卷");

      // After the indeterminate failure, the pending command is RETAINED.
      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith(
          expect.stringContaining("提交状态未确认"),
        );
      });
      // The pending command is persisted in sessionStorage.
      const stored = sessionStorage.getItem(
        "exam.pendingForceSubmit:org-1:admin-1",
      );
      expect(stored).not.toBeNull();
      expect(JSON.parse(stored!).command.operationId).toBe(firstOpId);

      // The PAGE-LEVEL banner appears (re-review P1-1: recovery independent
      // of candidate live status). Retry from the banner.
      const banner = await pendingBanner();
      const retryBtn = screen.getByRole("button", {
        name: "重试未确认强制交卷",
      });
      // The banner retry handler is async (POST → continuation → chained
      // loadStatus); flush it inside act() so no render lands outside it.
      await act(async () => {
        fireEvent.click(retryBtn);
      });

      await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(2));
      const retryBody = apiPost.mock.calls[1]![1] as Record<string, unknown>;
      expect(retryBody.operationId).toBe(firstOpId);
      expect(retryBody.reason).toBe(firstBody.reason);

      // Confirmed success clears the pending command + banner.
      await waitFor(() => {
        expect(toast.success).toHaveBeenCalledWith(
          expect.stringContaining("已强制交卷"),
        );
      });
      expect(
        sessionStorage.getItem("exam.pendingForceSubmit:org-1:admin-1"),
      ).toBeNull();
    });

    it("clears the command on a confirmed rejection (4xx)", async () => {
      apiGet.mockResolvedValue({
        candidates: [makeCandidate()],
        total: 1,
      });
      // 409 IDEMPOTENCY_CONFLICT → idempotency_conflict (clears).
      const conflict = Object.assign(new Error("conflict"), {
        status: 409,
        code: "IDEMPOTENCY_CONFLICT",
      });
      apiPost.mockRejectedValueOnce(conflict);

      renderPage();
      await openForceSubmitDialog();
      await confirmForceSubmit();

      await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
      const firstOpId = (apiPost.mock.calls[0]![1] as { operationId: string })
        .operationId;

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalled();
      });
      // Confirmed rejection clears the pending command.
      expect(
        sessionStorage.getItem("exam.pendingForceSubmit:org-1:admin-1"),
      ).toBeNull();
      // No page-level banner after a confirmed rejection.
      expect(screen.queryByTestId("pending-force-submit-banner")).toBeNull();
      // A second open mints a NEW operationId (not the cleared one).
      await openForceSubmitDialog();
      await confirmForceSubmit();
      await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(2));
      const secondOpId = (apiPost.mock.calls[1]![1] as { operationId: string })
        .operationId;
      expect(secondOpId).not.toBe(firstOpId);
    });

    // ── Re-review P1-1: page-level recovery independent of candidate live
    //    status. The server commits but the response is lost; by the next
    //    status poll the candidate is graded and the card lost its force-
    //    submit button. The banner must still surface retry + dismiss.
    it("hydrates the pending command on mount and surfaces the page-level banner even when the candidate is no longer live", async () => {
      const pendingOpId = "00000000-0000-4000-8000-000000000abc";
      sessionStorage.setItem(
        "exam.pendingForceSubmit:org-1:admin-1",
        JSON.stringify({
          schemaVersion: 2,
          organizationId: "org-1",
          actorId: "admin-1",
          command: {
            attemptId: "att-1",
            operationId: pendingOpId,
            reason: "管理员强制交卷",
            examId: "exam-1",
            candidateName: "张三",
          },
          createdAt: Date.now(),
        }),
      );
      // The candidate is now GRADED — no force-submit button on the card.
      apiGet.mockResolvedValue({
        candidates: [
          makeCandidate({
            status: "graded",
            attemptId: "att-1",
          }),
        ],
        total: 1,
      });
      // Retry succeeds (idempotent_replay — the server already committed).
      apiPost.mockResolvedValueOnce({ disposition: "idempotent_replay" });

      renderPage();

      // The page-level banner appears on mount (hydrate), independent of the
      // candidate's graded status — the card has no force-submit button.
      const banner = await pendingBanner();
      expect(
        screen.queryByRole("button", { name: "强制交卷" }),
      ).not.toBeInTheDocument();

      // Retry from the banner reuses the persisted operationId verbatim.
      // The banner retry handler is async (POST → continuation → chained
      // loadStatus); flush it inside act() so no render lands outside it.
      await act(async () => {
        fireEvent.click(
          screen.getByRole("button", { name: "重试未确认强制交卷" }),
        );
      });
      await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
      const body = apiPost.mock.calls[0]![1] as Record<string, unknown>;
      expect(body.operationId).toBe(pendingOpId);
      expect(body.reason).toBe("管理员强制交卷");

      // Confirmed outcome clears the banner + sessionStorage.
      await waitFor(() => {
        expect(toast.success).toHaveBeenCalled();
      });
      expect(screen.queryByTestId("pending-force-submit-banner")).toBeNull();
      expect(
        sessionStorage.getItem("exam.pendingForceSubmit:org-1:admin-1"),
      ).toBeNull();
    });

    // ── Re-review P1-1 second scenario: reload after a lost response, then
    //    retry from the banner → idempotent_replay (same operationId).
    it("restores the pending command after a full reload and retries via the banner", async () => {
      const pendingOpId = "00000000-0000-4000-8000-000000000def";
      sessionStorage.setItem(
        "exam.pendingForceSubmit:org-1:admin-1",
        JSON.stringify({
          schemaVersion: 2,
          organizationId: "org-1",
          actorId: "admin-1",
          command: {
            attemptId: "att-1",
            operationId: pendingOpId,
            reason: "管理员强制交卷",
            examId: "exam-1",
            candidateName: "张三",
          },
          createdAt: Date.now(),
        }),
      );
      apiGet.mockResolvedValue({
        candidates: [makeCandidate()],
        total: 1,
      });
      apiPost.mockResolvedValueOnce({ disposition: "idempotent_replay" });

      renderPage();

      const banner = await pendingBanner();
      // The banner retry handler is async (POST → continuation → chained
      // loadStatus); flush it inside act() so no render lands outside it.
      await act(async () => {
        fireEvent.click(
          screen.getByRole("button", { name: "重试未确认强制交卷" }),
        );
      });

      await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
      const body = apiPost.mock.calls[0]![1] as Record<string, unknown>;
      expect(body.operationId).toBe(pendingOpId);
    });

    // ── Re-review P1-1: explicit dismiss from the banner clears the slot.
    it("explicit dismiss from the banner clears the pending command", async () => {
      const pendingOpId = "00000000-0000-4000-8000-000000000eee";
      sessionStorage.setItem(
        "exam.pendingForceSubmit:org-1:admin-1",
        JSON.stringify({
          schemaVersion: 2,
          organizationId: "org-1",
          actorId: "admin-1",
          command: {
            attemptId: "att-1",
            operationId: pendingOpId,
            reason: "管理员强制交卷",
            examId: "exam-1",
            candidateName: "张三",
          },
          createdAt: Date.now(),
        }),
      );
      // Candidate is GRADED so the card does not render its own dismiss
      // button — only the page-level banner offers dismiss here.
      apiGet.mockResolvedValue({
        candidates: [makeCandidate({ status: "graded", attemptId: "att-1" })],
        total: 1,
      });

      renderPage();
      await pendingBanner();
      fireEvent.click(screen.getByRole("button", { name: "清除未确认命令" }));

      await waitFor(() => {
        expect(screen.queryByTestId("pending-force-submit-banner")).toBeNull();
      });
      expect(
        sessionStorage.getItem("exam.pendingForceSubmit:org-1:admin-1"),
      ).toBeNull();
      // No POST was ever sent.
      expect(apiPost).not.toHaveBeenCalled();
    });

    // ── Re-review P1 (mutation-proof): a pending command for attempt A must
    //    stay recoverable even after the admin opens (and closes) a BLOCKED
    //    force-submit dialog for a different attempt B. The old code reset
    //    `forceSubmitState` to `idle` in the blocked branch, which dropped
    //    the page-level banner (it renders only in the `indeterminate` phase)
    //    while the durable record was still present — re-introducing the
    //    unreachable-slot bug from a second entry point. A later change that
    //    reconstructed the phase as `cleanup_failed` from the storage record
    //    alone was equally wrong: storage cannot prove the server confirmed,
    //    so the banner must STILL offer retry, and retry must replay op-A
    //    verbatim (re-review P1). This test fails under either mutation.
    it("keeps the pending banner alive when a DIFFERENT candidate's force-submit dialog is blocked and closed", async () => {
      const pendingOpId = "00000000-0000-4000-8000-00000000aaa1";
      sessionStorage.setItem(
        "exam.pendingForceSubmit:org-1:admin-1",
        JSON.stringify({
          schemaVersion: 2,
          organizationId: "org-1",
          actorId: "admin-1",
          command: {
            attemptId: "att-1",
            operationId: pendingOpId,
            reason: "管理员强制交卷",
            examId: "exam-1",
            candidateName: "张三",
          },
          createdAt: Date.now(),
        }),
      );
      // A (att-1) is GRADED — no card button; B (att-2) is still in_progress.
      apiGet.mockResolvedValue({
        candidates: [
          makeCandidate({ status: "graded", attemptId: "att-1" }),
          makeCandidate({
            candidateId: "cand-2",
            name: "李四",
            attemptId: "att-2",
            status: "in_progress",
          }),
        ],
        total: 2,
      });
      apiPost.mockResolvedValueOnce({ disposition: "idempotent_replay" });

      renderPage();
      const banner = await pendingBanner();

      // Click B's force-submit → the dialog opens but is BLOCKED by the
      // pending A (the global per-admin slot holds at most one command).
      const forceSubmitButtons = screen.getAllByRole("button", {
        name: "强制交卷",
      });
      expect(forceSubmitButtons).toHaveLength(1); // only B's card has one
      fireEvent.click(forceSubmitButtons[0]!);
      await screen.findByText("确认强制交卷");
      await screen.findAllByText(
        "存在未确认的强制交卷命令，请先解决后再操作。",
      );

      // Close the B dialog (cancel).
      fireEvent.click(screen.getByRole("button", { name: "取消" }));

      // The banner for A is STILL visible AND still offers retry —
      // opening/blocking/closing B must not have discarded A's recovery
      // surface, and a storage-only record must not have been promoted to
      // the dismiss-only cleanup_failed phase.
      expect(banner).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "重试未确认强制交卷" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "清除未确认命令" }),
      ).toBeInTheDocument();

      // Retry from the banner → POST replays op-A for att-1 verbatim.
      // The banner retry handler is async (POST → continuation → chained
      // loadStatus); flush it inside act() so no render lands outside it.
      await act(async () => {
        fireEvent.click(
          screen.getByRole("button", { name: "重试未确认强制交卷" }),
        );
      });
      await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
      const body = apiPost.mock.calls[0]![1] as Record<string, unknown>;
      expect(apiPost.mock.calls[0]![0]).toContain("/att-1/force-submit");
      expect(body.operationId).toBe(pendingOpId);
      expect(body.reason).toBe("管理员强制交卷");
    });

    // ── Re-review P2: save read-back is byte-for-byte. A storage layer that
    //    returns the SAME record re-serialized with different formatting is
    //    semantically identical but byte-different — the old field-level
    //    comparison would accept it; the fail-closed contract must not.
    it("fails closed when the read-back bytes differ from the written record", async () => {
      apiGet.mockResolvedValue({
        candidates: [makeCandidate()],
        total: 1,
      });
      // The read-back re-serializes pending force-submit records with pretty
      // formatting: same parsed object (all fields intact), different bytes.
      const originalGetItem = Storage.prototype.getItem;
      const getItemSpy = vi
        .spyOn(Storage.prototype, "getItem")
        .mockImplementation(function (this: Storage, key: string) {
          const value = originalGetItem.call(this, key);
          if (key.startsWith("exam.pendingForceSubmit:") && value !== null) {
            return JSON.stringify(JSON.parse(value), null, 2);
          }
          return value;
        });

      renderPage();
      await openForceSubmitDialog();
      await confirmForceSubmit();

      // Fail-closed: no POST, persistence failure surfaced, bad bytes removed.
      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith(
          expect.stringContaining("无法安全保存强制交卷命令"),
        );
      });
      expect(apiPost).not.toHaveBeenCalled();
      expect(
        sessionStorage.getItem("exam.pendingForceSubmit:org-1:admin-1"),
      ).toBeNull();

      getItemSpy.mockRestore();
    });

    // ── Re-review P2: explicit dismiss must NOT switch the UI to "cleared"
    //    when the durable record could not be removed. The banner stays and
    //    an error is surfaced, so the admin never believes the slot is free
    //    while a stale record still blocks later force-submits.
    it("keeps the banner and surfaces an error when explicit dismiss cannot clear the record", async () => {
      const pendingOpId = "00000000-0000-4000-8000-00000000ccc1";
      sessionStorage.setItem(
        "exam.pendingForceSubmit:org-1:admin-1",
        JSON.stringify({
          schemaVersion: 2,
          organizationId: "org-1",
          actorId: "admin-1",
          command: {
            attemptId: "att-1",
            operationId: pendingOpId,
            reason: "管理员强制交卷",
            examId: "exam-1",
            candidateName: "张三",
          },
          createdAt: Date.now(),
        }),
      );
      apiGet.mockResolvedValue({
        candidates: [makeCandidate({ status: "graded", attemptId: "att-1" })],
        total: 1,
      });
      // Poison removeItem so the clear fails.
      const removerSpy = vi
        .spyOn(Storage.prototype, "removeItem")
        .mockImplementation(() => {
          throw new DOMException("blocked", "SecurityError");
        });

      renderPage();
      await pendingBanner();
      fireEvent.click(screen.getByRole("button", { name: "清除未确认命令" }));

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith(
          expect.stringContaining("无法清除未确认的强制交卷命令"),
        );
      });
      // The banner is KEPT and the durable record is still present.
      expect(
        screen.getByTestId("pending-force-submit-banner"),
      ).toBeInTheDocument();
      expect(
        sessionStorage.getItem("exam.pendingForceSubmit:org-1:admin-1"),
      ).not.toBeNull();
      // No POST was ever sent.
      expect(apiPost).not.toHaveBeenCalled();

      removerSpy.mockRestore();
    });

    // ── P2 fix: a CONFIRMED outcome with failed cleanup now transitions to
    //    `cleanup_failed` — the page-level banner shows the stale record and
    //    offers only a dismiss (storage cleanup) affordance, preventing the
    //    hidden stale authority that would block later force-submits.
    it("shows the cleanup-failed banner when a confirmed success cannot clear the record", async () => {
      const pendingOpId = "00000000-0000-4000-8000-00000000ddd1";
      sessionStorage.setItem(
        "exam.pendingForceSubmit:org-1:admin-1",
        JSON.stringify({
          schemaVersion: 2,
          organizationId: "org-1",
          actorId: "admin-1",
          command: {
            attemptId: "att-1",
            operationId: pendingOpId,
            reason: "管理员强制交卷",
            examId: "exam-1",
            candidateName: "张三",
          },
          createdAt: Date.now(),
        }),
      );
      apiGet.mockResolvedValue({
        candidates: [makeCandidate({ status: "graded", attemptId: "att-1" })],
        total: 1,
      });
      // The server confirms (idempotent replay) but the clear fails.
      apiPost.mockResolvedValueOnce({ disposition: "idempotent_replay" });
      const removerSpy = vi
        .spyOn(Storage.prototype, "removeItem")
        .mockImplementation(() => {
          throw new DOMException("blocked", "SecurityError");
        });

      renderPage();
      await pendingBanner();
      // The banner retry handler is async (POST → continuation → chained
      // loadStatus); flush it inside act() so no render lands outside it.
      await act(async () => {
        fireEvent.click(
          screen.getByRole("button", { name: "重试未确认强制交卷" }),
        );
      });

      // Confirmed success: success toast + warning about the failed cleanup.
      await waitFor(() => {
        expect(toast.success).toHaveBeenCalledWith(
          expect.stringContaining("已强制交卷"),
        );
      });
      expect(toast.warning).toHaveBeenCalledWith(
        expect.stringContaining("清理失败"),
      );
      // P2 fix: the banner is KEPT with cleanup_failed semantics — the stale
      // record is visible and offers a dismiss (storage cleanup) affordance.
      const banner = screen.getByTestId("pending-force-submit-banner");
      expect(banner).toBeInTheDocument();
      expect(banner).toHaveTextContent("清理失败");
      // Only dismiss button, no retry (POST is pointless on confirmed outcome).
      expect(
        screen.queryByRole("button", { name: "重试未确认强制交卷" }),
      ).toBeNull();
      expect(
        screen.getByRole("button", { name: "清除未确认命令" }),
      ).toBeInTheDocument();
      // The stale durable record is still present.
      expect(
        sessionStorage.getItem("exam.pendingForceSubmit:org-1:admin-1"),
      ).not.toBeNull();

      removerSpy.mockRestore();
    });

    // ── P2 fix (kept): when the SESSION already holds the confirmed
    //    cleanup_failed fact for the SAME operationId, the blocked branch must
    //    NOT demote it back to indeterminate. A confirmed outcome + failed
    //    cleanup is dismiss-only: retrying the POST is pointless (the server
    //    already committed). This locks the guard in the blocked branch.
    it("keeps cleanup_failed (dismiss-only) when a different attempt's dialog is blocked while the session knows the outcome was confirmed", async () => {
      const pendingOpId = "00000000-0000-4000-8000-00000000ddd2";
      // A (att-1) is GRADED — no card button; B (att-2) is still in_progress.
      apiGet.mockResolvedValue({
        candidates: [
          makeCandidate({ status: "graded", attemptId: "att-1" }),
          makeCandidate({
            candidateId: "cand-2",
            name: "李四",
            attemptId: "att-2",
            status: "in_progress",
          }),
        ],
        total: 2,
      });
      sessionStorage.setItem(
        "exam.pendingForceSubmit:org-1:admin-1",
        JSON.stringify({
          schemaVersion: 2,
          organizationId: "org-1",
          actorId: "admin-1",
          command: {
            attemptId: "att-1",
            operationId: pendingOpId,
            reason: "管理员强制交卷",
            examId: "exam-1",
            candidateName: "张三",
          },
          createdAt: Date.now(),
        }),
      );
      // The server confirms (idempotent replay) but the clear fails — the
      // session transitions to cleanup_failed, which KNOWS the outcome.
      apiPost.mockResolvedValueOnce({ disposition: "idempotent_replay" });
      const removerSpy = vi
        .spyOn(Storage.prototype, "removeItem")
        .mockImplementation(() => {
          throw new DOMException("blocked", "SecurityError");
        });

      renderPage();
      await pendingBanner();
      await act(async () => {
        fireEvent.click(
          screen.getByRole("button", { name: "重试未确认强制交卷" }),
        );
      });
      await waitFor(() => {
        expect(toast.warning).toHaveBeenCalledWith(
          expect.stringContaining("清理失败"),
        );
      });

      // Session now holds cleanup_failed (confirmed + cleanup failure).
      const banner = screen.getByTestId("pending-force-submit-banner");
      expect(banner).toHaveTextContent("清理失败");
      expect(
        screen.queryByRole("button", { name: "重试未确认强制交卷" }),
      ).toBeNull();

      // Click B's force-submit → blocked, but the phase is KEPT as
      // cleanup_failed — the in-session confirmed fact is not discarded.
      const forceSubmitButtons = screen.getAllByRole("button", {
        name: "强制交卷",
      });
      expect(forceSubmitButtons).toHaveLength(1); // only B's card has one
      fireEvent.click(forceSubmitButtons[0]!);
      await screen.findByText("确认强制交卷");
      await screen.findAllByText(
        "存在未确认的强制交卷命令，请先解决后再操作。",
      );

      // Close the B dialog (cancel) — the banner must STILL be cleanup_failed:
      // "清理失败" copy, dismiss-only, no retry (the open modal would make
      // the page aria-hidden and hide the banner buttons from role queries).
      fireEvent.click(screen.getByRole("button", { name: "取消" }));
      expect(
        screen.getByTestId("pending-force-submit-banner"),
      ).toHaveTextContent("清理失败");
      expect(
        screen.queryByRole("button", { name: "重试未确认强制交卷" }),
      ).toBeNull();
      expect(
        screen.getByRole("button", { name: "清除未确认命令" }),
      ).toBeInTheDocument();
      // No POST was sent for the blocked B dialog.
      expect(apiPost).toHaveBeenCalledTimes(1);

      removerSpy.mockRestore();
    });

    // ── Review P1-2: the pending authority carries its target exam identity.
    //    When the banner renders on a DIFFERENT exam's page it must identify
    //    the command's target (exam + candidate) and MUST NOT offer the
    //    destructive retry — retrying there would force-submit the OTHER
    //    exam's candidate from a page that gives no context. Navigation back
    //    to the owning exam and dismiss (global-slot cleanup) remain
    //    available. This test fails if the exam-scope guard is removed.
    it("identifies the target exam and withholds the destructive retry when the pending command belongs to a DIFFERENT exam", async () => {
      const pendingOpId = "00000000-0000-4000-8000-00000000fff2";
      // The pending command targets exam-9 / 王五 (att-9) — NOT the page's
      // exam-1. The page renders /admin/exams/exam-1/proctor.
      sessionStorage.setItem(
        "exam.pendingForceSubmit:org-1:admin-1",
        JSON.stringify({
          schemaVersion: 2,
          organizationId: "org-1",
          actorId: "admin-1",
          command: {
            attemptId: "att-9",
            operationId: pendingOpId,
            reason: "管理员强制交卷",
            examId: "exam-9",
            candidateName: "王五",
          },
          createdAt: Date.now(),
        }),
      );
      apiGet.mockResolvedValue({
        candidates: [makeCandidate()],
        total: 1,
      });

      renderPage();
      const banner = await pendingBanner();

      // The banner identifies the command's target: the owning exam + the
      // candidate snapshot.
      expect(banner).toHaveTextContent("其他考试");
      expect(banner).toHaveTextContent("exam-9");
      expect(banner).toHaveTextContent("王五");

      // NO destructive retry on the wrong exam page.
      expect(
        screen.queryByRole("button", { name: "重试未确认强制交卷" }),
      ).toBeNull();
      // Navigation back to the owning exam + dismiss are available.
      expect(
        screen.getByRole("button", { name: "返回原考试页面" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "清除未确认命令" }),
      ).toBeInTheDocument();
      // No POST was ever sent — the pending command stays untouched.
      expect(apiPost).not.toHaveBeenCalled();

      // Dismiss from the banner clears the stale storage record.
      fireEvent.click(screen.getByRole("button", { name: "清除未确认命令" }));
      await waitFor(() => {
        expect(
          sessionStorage.getItem("exam.pendingForceSubmit:org-1:admin-1"),
        ).toBeNull();
      });
      expect(screen.queryByTestId("pending-force-submit-banner")).toBeNull();
    });

    // ── Re-review P2: hydrate must never downgrade a stronger in-session
    //    fact. Storage alone reconstructs `indeterminate`, but when the
    //    session ALREADY knows the outcome was confirmed (cleanup_failed) for
    //    the SAME operationId, a re-run of the hydrate effect (user/t
    //    identity change) must keep it — the record cannot prove the outcome.
    //    Without the guard, the banner would gain a retry button and lose the
    //    confirmed fact. This test fails if the hydrate guard is removed.
    it("keeps the in-session cleanup_failed fact when the hydrate effect re-runs", async () => {
      const pendingOpId = "00000000-0000-4000-8000-00000000aaac";
      // Seed the same pending record the in-session flow will confirm +
      // fail to clear.
      sessionStorage.setItem(
        "exam.pendingForceSubmit:org-1:admin-1",
        JSON.stringify({
          schemaVersion: 2,
          organizationId: "org-1",
          actorId: "admin-1",
          command: {
            attemptId: "att-1",
            operationId: pendingOpId,
            reason: "管理员强制交卷",
            examId: "exam-1",
            candidateName: "张三",
          },
          createdAt: Date.now(),
        }),
      );
      // The server confirms (idempotent replay) but the clear fails → the
      // session transitions to cleanup_failed, which KNOWS the outcome.
      apiPost.mockResolvedValueOnce({ disposition: "idempotent_replay" });
      const removerSpy = vi
        .spyOn(Storage.prototype, "removeItem")
        .mockImplementation(() => {
          throw new DOMException("blocked", "SecurityError");
        });

      try {
        apiGet.mockResolvedValue({
          candidates: [makeCandidate({ status: "graded", attemptId: "att-1" })],
          total: 1,
        });
        renderPage();
        await pendingBanner();
        await act(async () => {
          fireEvent.click(
            screen.getByRole("button", { name: "重试未确认强制交卷" }),
          );
        });
        await waitFor(() => {
          expect(toast.warning).toHaveBeenCalledWith(
            expect.stringContaining("清理失败"),
          );
        });

        // Session now holds cleanup_failed (confirmed + cleanup failure).
        expect(
          screen.getByTestId("pending-force-submit-banner"),
        ).toHaveTextContent("清理失败");
        expect(
          screen.queryByRole("button", { name: "重试未确认强制交卷" }),
        ).toBeNull();

        // Language round-trip changes the `t` identity (react-i18next
        // getFixedT per language) → the hydrate effect re-runs. The guard
        // must keep the stronger cleanup_failed state (dismiss-only).
        await act(async () => {
          await i18n.changeLanguage("en");
          await i18n.changeLanguage("zh-CN");
        });
        expect(
          screen.getByTestId("pending-force-submit-banner"),
        ).toHaveTextContent("清理失败");
        expect(
          screen.queryByRole("button", { name: "重试未确认强制交卷" }),
        ).toBeNull();
        // The retry from earlier is the ONLY POST — the downgraded path must
        // not have sent anything.
        expect(apiPost).toHaveBeenCalledTimes(1);
      } finally {
        // Restore even on failure so a broken guard cannot poison the rest
        // of the suite (spy + global i18n language).
        removerSpy.mockRestore();
        await i18n.changeLanguage("zh-CN");
      }
    });

    //    the server confirmed the command — the same bytes may be a lost
    //    response (indeterminate, retry REQUIRED) or a confirmed outcome whose
    //    cleanup failed. When React state drifted to idle (simulated by
    //    injecting the record AFTER render) and the admin opens a force-submit
    //    dialog for a DIFFERENT attempt, the blocked branch must reconstruct
    //    `indeterminate` (fail-safe: retry always replays the same operationId
    //    idempotently), never the dismiss-only `cleanup_failed` phase. This
    //    test fails under a `phase: "cleanup_failed"` reconstruction mutation.
    it("restores the INDETERMINATE banner (with retry) when a different attempt's dialog is blocked by a storage-only authority", async () => {
      const pendingOpId = "00000000-0000-4000-8000-00000000eee1";
      // A (att-1) is GRADED — no card button; B (att-2) is still in_progress.
      apiGet.mockResolvedValue({
        candidates: [
          makeCandidate({ status: "graded", attemptId: "att-1" }),
          makeCandidate({
            candidateId: "cand-2",
            name: "李四",
            attemptId: "att-2",
            status: "in_progress",
          }),
        ],
        total: 2,
      });
      // Retry succeeds — the server may have committed before the lost
      // response, so the replay returns idempotent_replay.
      apiPost.mockResolvedValueOnce({ disposition: "idempotent_replay" });

      // Render WITHOUT a stored authority — state stays idle, no banner.
      renderPage();
      await waitFor(() => {
        expect(screen.getByText("张三")).toBeInTheDocument();
      });
      expect(screen.queryByTestId("pending-force-submit-banner")).toBeNull();

      // Simulate a stale record appearing after the page loaded (React state
      // is still idle — e.g. reloaded before this write became visible).
      sessionStorage.setItem(
        "exam.pendingForceSubmit:org-1:admin-1",
        JSON.stringify({
          schemaVersion: 2,
          organizationId: "org-1",
          actorId: "admin-1",
          command: {
            attemptId: "att-1",
            operationId: pendingOpId,
            reason: "管理员强制交卷",
            examId: "exam-1",
            candidateName: "张三",
          },
          createdAt: Date.now(),
        }),
      );

      // Click B's force-submit → the dialog opens but is BLOCKED by the
      // stale authority for A. The blocked branch reconstructs the banner
      // as indeterminate — NOT cleanup_failed (storage cannot prove the
      // outcome was confirmed).
      const forceSubmitButtons = screen.getAllByRole("button", {
        name: "强制交卷",
      });
      expect(forceSubmitButtons).toHaveLength(1); // only B's card has one
      fireEvent.click(forceSubmitButtons[0]!);
      await screen.findByText("确认强制交卷");
      await screen.findAllByText(
        "存在未确认的强制交卷命令，请先解决后再操作。",
      );

      // The banner is now visible and NOT the cleanup-failed copy (the open
      // modal marks the page aria-hidden, so banner buttons are role-
      // invisible until the dialog closes — text assertions still work).
      const banner = screen.getByTestId("pending-force-submit-banner");
      expect(banner).toBeInTheDocument();
      expect(banner).not.toHaveTextContent("清理失败");

      // Close the B dialog (cancel) — the indeterminate banner must STILL
      // offer retry + dismiss (mutations to `cleanup_failed` or `idle` fail
      // here).
      fireEvent.click(screen.getByRole("button", { name: "取消" }));
      expect(
        screen.getByRole("button", { name: "重试未确认强制交卷" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "清除未确认命令" }),
      ).toBeInTheDocument();

      // Retry from the banner → POST replays op-A for att-1 verbatim.
      // The banner retry handler is async (POST → continuation → chained
      // loadStatus); flush it inside act() so no render lands outside it.
      await act(async () => {
        fireEvent.click(
          screen.getByRole("button", { name: "重试未确认强制交卷" }),
        );
      });
      await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
      const body = apiPost.mock.calls[0]![1] as Record<string, unknown>;
      expect(apiPost.mock.calls[0]![0]).toContain("/att-1/force-submit");
      expect(body.operationId).toBe(pendingOpId);
      expect(body.reason).toBe("管理员强制交卷");

      // Confirmed replay outcome clears the banner + the durable record.
      await waitFor(() => {
        expect(toast.success).toHaveBeenCalledWith(
          expect.stringContaining("已强制交卷"),
        );
      });
      expect(screen.queryByTestId("pending-force-submit-banner")).toBeNull();
      expect(
        sessionStorage.getItem("exam.pendingForceSubmit:org-1:admin-1"),
      ).toBeNull();
    });

    // ── Re-review P1-2: fail-closed persistence. When sessionStorage cannot
    //    be written, the POST MUST be suppressed.
    it("suppresses the POST when the pending command cannot be persisted (fail-closed)", async () => {
      apiGet.mockResolvedValue({
        candidates: [makeCandidate()],
        total: 1,
      });
      // Poison sessionStorage.setItem so persistence fails.
      const setterSpy = vi
        .spyOn(Storage.prototype, "setItem")
        .mockImplementation(() => {
          throw new DOMException("quota exceeded", "QuotaExceededError");
        });

      renderPage();
      await openForceSubmitDialog();
      await confirmForceSubmit();

      // Fail-closed: NO POST was sent.
      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith(
          expect.stringContaining("无法安全保存强制交卷命令"),
        );
      });
      expect(apiPost).not.toHaveBeenCalled();

      setterSpy.mockRestore();
    });

    // ── Re-review P2-2: a damaged pending record is cleared + surfaced, not
    //    silently treated as "no pending".
    it("clears and surfaces a corrupt pending authority on hydrate", async () => {
      sessionStorage.setItem(
        "exam.pendingForceSubmit:org-1:admin-1",
        "not-valid-json{{{",
      );
      apiGet.mockResolvedValue({
        candidates: [makeCandidate()],
        total: 1,
      });

      renderPage();

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith(
          expect.stringContaining("检测到损坏"),
        );
      });
      // The corrupt record was removed.
      expect(
        sessionStorage.getItem("exam.pendingForceSubmit:org-1:admin-1"),
      ).toBeNull();
      // No banner (nothing valid to recover) and no POST.
      expect(screen.queryByTestId("pending-force-submit-banner")).toBeNull();
      expect(apiPost).not.toHaveBeenCalled();
    });

    it("rejects a pending authority whose org/actor does not match the lookup key", async () => {
      // Valid shape but for a DIFFERENT admin — must be treated as corrupt
      // (cleared + surfaced), not silently accepted.
      sessionStorage.setItem(
        "exam.pendingForceSubmit:org-1:admin-1",
        JSON.stringify({
          schemaVersion: 2,
          organizationId: "other-org",
          actorId: "other-user",
          command: {
            attemptId: "att-1",
            operationId: "00000000-0000-4000-8000-000000000fff",
            reason: "管理员强制交卷",
            examId: "exam-1",
            candidateName: "张三",
          },
          createdAt: Date.now(),
        }),
      );
      apiGet.mockResolvedValue({
        candidates: [makeCandidate()],
        total: 1,
      });

      renderPage();

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith(
          expect.stringContaining("检测到损坏"),
        );
      });
      expect(
        sessionStorage.getItem("exam.pendingForceSubmit:org-1:admin-1"),
      ).toBeNull();
      expect(screen.queryByTestId("pending-force-submit-banner")).toBeNull();
    });
  });
});
