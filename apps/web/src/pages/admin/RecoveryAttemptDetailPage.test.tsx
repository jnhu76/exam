import { act, render, screen, waitFor, within } from "@testing-library/react";
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
      post: vi.fn(),
    },
  };
});

const getMock = vi.mocked(api.get);
const postMock = vi.mocked(api.post);

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
    postMock.mockReset();
    postMock.mockResolvedValue({ outcome: "applied" });
    window.sessionStorage.clear();
    // Clear localStorage too — the time-grant coordinator persists its pending
    // authority there (keyed exam.pendingGrantAuthority:*), and a leftover
    // record from one test would block / restore in another.
    window.localStorage.clear();
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

  it("renders the Operations section with allowedActions-gated command buttons (J5-I1C1)", async () => {
    renderPage();
    await screen.findByText("第 1 次答题");
    // The Operations section renders the three commands (server-computed
    // allowedActions from the mock).
    expect(screen.getByText("操作")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "延长答题时间" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "强制交卷" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "标记违规" }),
    ).toBeInTheDocument();
  });

  it("keeps the page read-only when allowedActions is empty (§6.4 computed result)", async () => {
    getMock.mockResolvedValue({
      ...mockContext,
      allowedActions: [],
    });
    renderPage();
    await screen.findByText("第 1 次答题");
    expect(screen.queryByText("操作")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /延长答题时间|强制交卷|标记违规/ }),
    ).not.toBeInTheDocument();
  });

  it("renders only the granted action when allowedActions is partial", async () => {
    getMock.mockResolvedValue({
      ...mockContext,
      allowedActions: ["misconduct_mark"],
    });
    renderPage();
    await screen.findByText("第 1 次答题");
    expect(
      screen.getByRole("button", { name: "标记违规" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "延长答题时间" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "强制交卷" }),
    ).not.toBeInTheDocument();
  });

  it("grants time via POST /time-grants with a frozen operationId and reloads (J5-I1C1)", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(
      await screen.findByRole("button", { name: "延长答题时间" }),
    );
    await user.type(screen.getByLabelText("原因说明"), "网络故障补偿");
    await user.click(screen.getByRole("button", { name: "延长答题时间" }));

    expect(postMock).toHaveBeenCalledTimes(1);
    const [url, body] = postMock.mock.calls[0]! as unknown as [
      string,
      {
        operationId: string;
        addedSeconds: number;
        reasonCode: string;
        reasonText: string;
      },
    ];
    expect(url).toBe("/api/admin/attempts/attempt-1/time-grants");
    expect(body.operationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(body.addedSeconds).toBe(600);
    expect(body.reasonText).toBe("网络故障补偿");
    // Confirmed success reloads the authoritative projection.
    await screen.findByText("第 1 次答题");
    expect(getMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("blocks the grant confirm until a reason is entered", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(
      await screen.findByRole("button", { name: "延长答题时间" }),
    );
    const confirm = screen.getByRole("button", { name: "延长答题时间" });
    // Dialog confirm (the second button with that name).
    expect(confirm).toBeInTheDocument();
    await user.click(confirm);
    expect(postMock).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText("原因说明"), "网络故障补偿");
    expect(postMock).not.toHaveBeenCalled();
  });

  it("force-submits with an operationId + canonical reason and reloads (J5-I1C1)", async () => {
    const user = userEvent.setup();
    // Keep the POST in flight so the durable pending authority (written BEFORE
    // the request) is observable while the outcome is still unknown.
    let resolvePost: (v: unknown) => void = () => {};
    postMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePost = resolve;
        }),
    );
    renderPage();
    await user.click(await screen.findByRole("button", { name: "强制交卷" }));
    await user.type(screen.getByLabelText("原因说明（必填）"), "考生无法继续");
    await user.click(screen.getByRole("button", { name: "强制交卷" }));

    // The pending authority was persisted BEFORE the POST — visible in flight.
    expect(window.sessionStorage.length).toBe(1);
    await act(async () => {
      resolvePost({ outcome: "applied" });
    });

    expect(postMock).toHaveBeenCalledTimes(1);
    const [url, body] = postMock.mock.calls[0]! as unknown as [
      string,
      { operationId: string; reason: string },
    ];
    expect(url).toBe("/api/admin/attempts/attempt-1/force-submit");
    expect(body.reason).toBe("考生无法继续");
    // Confirmed success cleared the pending authority (session cleanup).
    expect(window.sessionStorage.length).toBe(0);
  });

  it("marks misconduct with operationId + severity + notes and reloads (J5-I1C1)", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "标记违规" }));
    await user.type(screen.getByLabelText("违规说明"), "查看手机");
    await user.click(screen.getByRole("button", { name: "标记违规" }));

    expect(postMock).toHaveBeenCalledTimes(1);
    const [url, body] = postMock.mock.calls[0]! as unknown as [
      string,
      { operationId: string; severity: string; notes: string },
    ];
    expect(url).toBe("/api/admin/attempts/attempt-1/misconduct");
    expect(body.severity).toBe("warning");
    expect(body.notes).toBe("查看手机");
  });

  it("retries an indeterminate force-submit with the SAME operationId (J5-R0 §8.2)", async () => {
    const user = userEvent.setup();
    postMock.mockRejectedValueOnce(new ApiError(0, "Network request failed"));
    renderPage();
    await user.click(await screen.findByRole("button", { name: "强制交卷" }));
    await user.type(screen.getByLabelText("原因说明（必填）"), "考生无法继续");
    await user.click(screen.getByRole("button", { name: "强制交卷" }));

    // Indeterminate — dialog stays open with a retry affordance (the retry
    // button name keeps the operation: "重试 · 强制交卷").
    expect(await screen.findByText("重试 · 强制交卷")).toBeInTheDocument();
    const firstBody = postMock.mock.calls[0]![1] as { operationId: string };
    await user.click(screen.getByRole("button", { name: "重试 · 强制交卷" }));

    expect(postMock).toHaveBeenCalledTimes(2);
    const secondBody = postMock.mock.calls[1]![1] as { operationId: string };
    expect(secondBody.operationId).toBe(firstBody.operationId);
  });

  it("surfaces a definitive rejection and closes the dialog", async () => {
    const user = userEvent.setup();
    postMock.mockRejectedValueOnce(new ApiError(403, "Forbidden"));
    renderPage();
    await user.click(await screen.findByRole("button", { name: "强制交卷" }));
    await user.type(screen.getByLabelText("原因说明（必填）"), "考生无法继续");
    await user.click(screen.getByRole("button", { name: "强制交卷" }));

    // Confirmed rejection — dialog closes, no retry affordance.
    expect(screen.queryByText("重试")).not.toBeInTheDocument();
    expect(screen.queryByText("原因说明（必填）")).not.toBeInTheDocument();
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

  it("keeps the loaded page on screen with an inline warning when a background refresh fails (P1-2)", async () => {
    renderPage();
    await screen.findByText("第 1 次答题");

    // Manual refresh fails while data is on screen (503 → unavailable).
    getMock.mockRejectedValueOnce(new ApiError(503, "unavailable"));
    await userEvent.setup().click(screen.getByRole("button", { name: "刷新" }));

    // Old data stays visible, the failure is an INLINE banner (not a
    // full-screen ErrorState — no retry button, no data swap).
    expect(
      await screen.findByText("恢复数据暂不可用，请稍后重试。"),
    ).toBeInTheDocument();
    expect(screen.getByText("第 1 次答题")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "重试" }),
    ).not.toBeInTheDocument();
  });

  // ── Time-grant reload-recovery (review P1). The time-grant now reuses the
  //    shared PendingGrantCoordinator (the same authority the Proctor dashboard
  //    uses), so the frozen operationId is persisted in localStorage BEFORE the
  //    POST and reused verbatim on an indeterminate retry — a reload can no
  //    longer mint a fresh identity that the server would treat as a REAL
  //    second time adjustment.
  describe("time-grant reload recovery (review P1)", () => {
    /** Returns the coordinator's persisted pending-grant authority, if any. */
    function readPendingGrant() {
      const key = Object.keys(window.localStorage).find((k) =>
        k.startsWith("exam.pendingGrantAuthority:"),
      );
      if (!key) return null;
      return JSON.parse(window.localStorage.getItem(key)!);
    }

    it("persists the pending-grant authority in localStorage before the POST and reuses the same operationId on an indeterminate retry", async () => {
      const user = userEvent.setup();
      // First POST: network failure (status 0) → indeterminate.
      postMock.mockRejectedValueOnce(new ApiError(0, "Network request failed"));
      // Retry: confirmed success.
      postMock.mockResolvedValueOnce({ outcome: "granted" });

      renderPage();
      await user.click(
        await screen.findByRole("button", { name: "延长答题时间" }),
      );
      await user.type(screen.getByLabelText("原因说明"), "网络故障补偿");
      await user.click(screen.getByRole("button", { name: "延长答题时间" }));

      // First POST captured; the coordinator persisted the authority BEFORE
      // the request (the operationId in storage matches the POST body).
      await screen.findByText("重试 · 延长答题时间");
      expect(postMock).toHaveBeenCalledTimes(1);
      const firstBody = postMock.mock.calls[0]![1] as { operationId: string };
      const stored = readPendingGrant();
      expect(stored).not.toBeNull();
      expect(stored.command.operationId).toBe(firstBody.operationId);

      // Retry — replays the SAME operationId (the dialog re-confirms; the
      // inputs are frozen read-only in the indeterminate phase).
      await user.click(
        screen.getByRole("button", { name: "重试 · 延长答题时间" }),
      );
      await waitFor(() => expect(postMock).toHaveBeenCalledTimes(2));
      const retryBody = postMock.mock.calls[1]![1] as { operationId: string };
      expect(retryBody.operationId).toBe(firstBody.operationId);

      // Confirmed success clears the durable authority.
      await waitFor(() => {
        expect(readPendingGrant()).toBeNull();
      });
    });

    it("restores the frozen operationId after a full reload (simulated) via the coordinator authority", async () => {
      // Seed the coordinator's localStorage authority as a real lost-response
      // reload would leave it: a pending command for attempt-1 whose outcome
      // was never confirmed.
      const pendingOpId = "00000000-0000-4000-8000-000000000abc";
      window.localStorage.setItem(
        "exam.pendingGrantAuthority:org1:admin-1",
        JSON.stringify({
          schemaVersion: 1,
          organizationId: "org1",
          actorId: "admin-1",
          command: {
            attemptId: "attempt-1",
            operationId: pendingOpId,
            addedSeconds: 600,
            reasonCode: "technical_incident",
            reasonText: "网络故障补偿",
          },
          revision: 1,
          createdAt: Date.now(),
        }),
      );
      // Retry: idempotent replay (the server already committed before the lost
      // response).
      postMock.mockResolvedValueOnce({ outcome: "idempotent_replay" });

      const user = userEvent.setup();
      renderPage();
      // Open the dialog — it restores the frozen command (indeterminate phase).
      await user.click(
        await screen.findByRole("button", { name: "延长答题时间" }),
      );
      // The confirm button relabels to the retry affordance.
      const retry = await screen.findByRole("button", {
        name: "重试 · 延长答题时间",
      });
      await user.click(retry);

      await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));
      const body = postMock.mock.calls[0]![1] as { operationId: string };
      expect(body.operationId).toBe(pendingOpId);

      // Confirmed replay clears the authority.
      await waitFor(() => {
        expect(readPendingGrant()).toBeNull();
      });
    });
  });

  // ── Cleanup-failed recovery surface (review P2). When a confirmed
  //    force-submit / misconduct outcome's durable-authority CLEAR fails, the
  //    stale record would silently block every later operation of that type.
  //    The page surfaces a recovery banner with a retry-clear affordance.
  describe("cleanup-failed recovery banner (review P2)", () => {
    it("shows the force-submit cleanup-failed banner when the clear fails on a confirmed success", async () => {
      const user = userEvent.setup();
      postMock.mockResolvedValueOnce({ disposition: "applied" });
      // Poison removeItem so the force-submit durable-authority clear fails.
      const removerSpy = vi
        .spyOn(Storage.prototype, "removeItem")
        .mockImplementation((key: string) => {
          if (key.startsWith("exam.pendingForceSubmit:")) {
            throw new DOMException("blocked", "SecurityError");
          }
          return;
        });

      renderPage();
      await user.click(await screen.findByRole("button", { name: "强制交卷" }));
      await user.type(
        screen.getByLabelText("原因说明（必填）"),
        "E2E 清理失败",
      );
      await user.click(screen.getByRole("button", { name: "强制交卷" }));

      // Confirmed success + failed clear → cleanup-failed banner visible.
      await waitFor(() => {
        expect(
          screen.getByTestId("force-submit-cleanup-failed-banner"),
        ).toBeInTheDocument();
      });
      // The stale durable record is still present.
      expect(
        window.sessionStorage.getItem("exam.pendingForceSubmit:org1:admin-1"),
      ).not.toBeNull();

      removerSpy.mockRestore();
    });

    it("shows the misconduct cleanup-failed banner when the clear fails on a confirmed success", async () => {
      const user = userEvent.setup();
      postMock.mockResolvedValueOnce({});
      const removerSpy = vi
        .spyOn(Storage.prototype, "removeItem")
        .mockImplementation((key: string) => {
          if (key.startsWith("exam.pendingMisconduct:")) {
            throw new DOMException("blocked", "SecurityError");
          }
          return;
        });

      renderPage();
      await user.click(await screen.findByRole("button", { name: "标记违规" }));
      await user.type(screen.getByLabelText("违规说明"), "清理失败场景");
      await user.click(screen.getByRole("button", { name: "标记违规" }));

      await waitFor(() => {
        expect(
          screen.getByTestId("misconduct-cleanup-failed-banner"),
        ).toBeInTheDocument();
      });
      expect(
        window.sessionStorage.getItem("exam.pendingMisconduct:org1:admin-1"),
      ).not.toBeNull();

      removerSpy.mockRestore();
    });
  });
});
