import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { logger } from "@/lib/logger";
import { AuthProvider } from "@/contexts/AuthContext";
import { BrandProvider } from "@/components/layout/BrandProvider";
import { ExamMonitoringPage } from "./ExamMonitoringPage";
import { permissionsForRole } from "@exam/authz";
import type { AssignableRole } from "@exam/contracts";

vi.mock("@/lib/api", () => ({
  ApiError: class ApiError extends Error {
    readonly status: number;
    readonly message: string;
    readonly code?: string;
    readonly details?: unknown;
    readonly requestId?: string;
    readonly serverMessage?: string;
    constructor(
      status: number,
      message: string,
      code?: string,
      details?: unknown,
      requestId?: string,
      serverMessage?: string,
    ) {
      super(message);
      this.name = "ApiError";
      this.status = status;
      this.message = message;
      this.code = code;
      this.details = details;
      this.requestId = requestId;
      this.serverMessage = serverMessage ?? message;
    }
  },
  api: { get: vi.fn() },
  setNavigate: () => {},
}));

vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Ownership-sensitive mock of the canonical status-meta accessor. The page
// must derive its attempt-status label from `getStatusMeta` (the statusMeta
// owner), NOT from a page-local `AttemptStatus → labelKey` map. A reintroduced
// local map would never call this accessor, so the call assertion in the
// ownership test below fails.
//
// `vi.hoisted` + `vi.mock` is the deterministic form: the mock factory is
// hoisted above the `ExamMonitoringPage` import, so the page's static
// `import { getStatusMeta }` resolves to `getStatusMetaSpy` at module-eval
// time. This replaces a post-import `vi.spyOn` that patched the namespace
// property AFTER the page had already captured the original named-import
// binding; interception was module-cache-order-dependent and intermittently
// recorded 0 calls. `importOriginal` preserves every real export and the spy
// delegates to the real `getStatusMeta`, so rendered labels are identical to
// production.
const { getStatusMetaSpy } = vi.hoisted(() => ({
  getStatusMetaSpy: vi.fn(),
}));

vi.mock("@/lib/statusMeta", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/statusMeta")>();
  getStatusMetaSpy.mockImplementation(actual.getStatusMeta);
  return { ...actual, getStatusMeta: getStatusMetaSpy };
});

const getMock = vi.mocked(api.get);
const warnMock = vi.mocked(logger.warn);

function makeAttempt(overrides: Record<string, unknown> = {}) {
  return {
    attemptId: "att-1",
    candidateId: "cand-1",
    candidateName: "张三",
    status: "in_progress",
    onlineState: "online",
    lastHeartbeatAt: new Date().toISOString(),
    lastSaveAt: new Date().toISOString(),
    lastClientEventAt: null,
    visibilityLostCount: 0,
    browserOfflineCount: 0,
    saveFailedCount: 0,
    submitFailedCount: 0,
    warningLevel: "normal",
    ...overrides,
  };
}

function renderPage(
  actor: { role: AssignableRole; capabilities: string[] } = {
    role: "Admin",
    capabilities: [...permissionsForRole("Admin")],
  },
) {
  return render(
    <MemoryRouter initialEntries={["/admin/exams/exam-1/proctor/monitor"]}>
      <AuthProvider
        initialUser={{
          id: "1",
          username: "actor",
          name: "Actor",
          role: actor.role,
          organizationId: "org1",
          capabilities: actor.capabilities,
        }}
      >
        <BrandProvider>
          <Routes>
            {/* HAZARD: the route param must match the component's
                useParams<{ id }>() and the real App.tsx route
                (exams/:id/proctor/monitor). A mismatch (e.g. :examId) leaves
                useParams().id undefined and the page silently never fetches
                monitoring data — no error, just an empty surface. */}
            <Route
              path="/admin/exams/:id/proctor/monitor"
              element={<ExamMonitoringPage />}
            />
            <Route
              path="/admin/recovery/attempts/:attemptId"
              element={<div data-testid="recovery-attempt-stub" />}
            />
          </Routes>
        </BrandProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("ExamMonitoringPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Safety net: ensure no fake timers leak into sibling tests in this file.
  // (The global setup.ts afterEach also calls useRealTimers, but the poll
  // test below switches to fake timers and we want to be explicit.)
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the monitoring table on successful load", async () => {
    getMock.mockResolvedValueOnce({
      items: [makeAttempt({ candidateName: "李四" })],
      total: 1,
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("考试监控")).toBeInTheDocument();
    });
    expect(screen.getByText("李四")).toBeInTheDocument();
  });

  it("shows initial error state when first load fails", async () => {
    getMock.mockRejectedValueOnce(new Error("network"));
    renderPage();
    expect(await screen.findByText("加载监控数据失败")).toBeInTheDocument();
  });

  it("shows stale warning and logger.warn on subsequent poll failure", async () => {
    // Use fake timers so the 15s POLL_INTERVAL_MS fires synchronously instead
    // of waiting real wall-clock. This removes both the 15s test duration and
    // the act() warning (a real pending timer firing setState after the test
    // body was the warning's cause). No userEvent is used in this test; if one
    // were added, it must be configured with
    // userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).
    vi.useFakeTimers({ shouldAdvanceTime: false });

    // First load succeeds → table renders with 张三.
    getMock.mockResolvedValueOnce({
      items: [makeAttempt()],
      total: 1,
    });
    // Second call (the next poll) rejects → should trigger stale warning.
    getMock.mockRejectedValueOnce(new Error("timeout"));

    renderPage();
    // Flush the initial load's microtasks + resulting React state update
    // without running timers (the page has an infinite 60s tick interval for
    // label refresh, so runAllTimers would loop). An empty act drains the
    // pending promise chain. Using findByText/waitFor here would spin on
    // fake-timer polling, so we flush then assert with a sync query.
    await act(async () => {});
    expect(screen.getByText("张三")).toBeInTheDocument();

    // Advance the fake poll interval; the rejected poll resolves and the
    // component sets staleWarning + logs. Wrapped in act because this drives
    // a React state update.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });

    expect(warnMock).toHaveBeenCalledWith("monitoring.poll_failed", {
      examId: "exam-1",
    });
    expect(
      screen.getByText("监控数据刷新失败，当前为上次成功数据"),
    ).toBeInTheDocument();
  });

  // Empty state and timeline dialog tests are deferred to a follow-up PR
  // to avoid timer-interference from the 15s polling interval across tests.

  it("derives attempt-status label metadata from the canonical statusMeta owner", async () => {
    // The page must consult the canonical `getStatusMeta` accessor for the
    // AttemptStatus → labelKey decision. A reintroduced page-local
    // `STATUS_LABEL_KEY` map would bypass the mocked accessor entirely, so the
    // call assertion below fails if the bypass returns. `getStatusMetaSpy` is
    // installed via a hoisted `vi.mock` (established before the page module
    // evaluates), so interception does not depend on post-import spy binding
    // or test-execution order. It delegates to the real implementation, so the
    // rendered label is unchanged.
    //
    // The waitFor target is the candidate-name cell, NOT the page header: the
    // header ("考试监控") renders before the async fetch resolves, so waiting
    // for it would let the spy assertion race ahead of `loadAttempts` and
    // intermittently record 0 calls when the fetch hadn't drained yet. The
    // candidate name only appears once the attempt row renders, which is
    // strictly after `getStatusMeta(a.status)` ran in the row's status cell.
    // A rendered-label assertion alone cannot prove authority (a copied local
    // map produces identical text), so the spy call assertion is still
    // required; the row-render wait only removes the timing race.
    getMock.mockResolvedValueOnce({
      items: [makeAttempt({ status: "in_progress" })],
      total: 1,
    });

    renderPage();
    await waitFor(() => {
      expect(screen.getByText("张三")).toBeInTheDocument();
    });

    expect(getStatusMetaSpy).toHaveBeenCalledWith("in_progress");
  });

  // ── #860 PR-T: monitoring dialog trust semantics ────────────────────
  // The dialog's source badge must branch on the row's REAL `source`, not on
  // `kind`: audit rows are emitted with kind "proctor" (provenance lives in
  // source, not kind — proctorMonitoringService.ts), so a kind-based badge
  // mislabels server-authoritative audit rows as frontend telemetry. The
  // allowlisted metadata of a client_event row is the client's claim about a
  // server interaction and renders only inside the explicit
  // "客户端声明，未经服务端核验" group label; audit metadata (the server's
  // own record) carries no such label.

  function makeTimelineEvent(
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      id: crypto.randomUUID(),
      serverRecordedAt: "2026-06-23T08:06:00.000Z",
      occurredAt: "2026-06-23T08:05:00.000Z",
      name: "answer_autosave_failed",
      level: "error",
      kind: "exam_telemetry",
      metadata: {
        questionId: "q1",
        errorCode: "SAVE_NETWORK_TIMEOUT",
        requestId: "req-42",
        status: 500,
      },
      source: "client_event",
      ...overrides,
    };
  }

  it("renders dialog source badges from real source and marks only client-event metadata as client-claimed/unverified", async () => {
    getMock.mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.includes("/proctor-events")) {
        return {
          items: [
            makeTimelineEvent(),
            // Server-authoritative audit row: kind is "proctor" (NOT
            // "audit_log") — the kind-based badge never labeled it 操作.
            makeTimelineEvent({
              id: crypto.randomUUID(),
              name: "force_submit",
              level: "warn",
              kind: "proctor",
              metadata: { reason: "proctor" },
              source: "audit_log",
              occurredAt: "2026-06-23T08:30:00.000Z",
              serverRecordedAt: "2026-06-23T08:30:00.000Z",
            }),
          ],
          total: 2,
          page: 1,
          pageSize: 50,
          totalPages: 1,
        };
      }
      return { items: [makeAttempt()], total: 1 };
    });
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("张三");
    await user.click(screen.getByRole("button", { name: "时间线" }));

    // Client telemetry row: badge from real source + unverified group label
    // around the (visible) forged requestId/status correlation claims.
    expect(await screen.findByText("answer_autosave_failed")).toBeVisible();
    const clientRow = screen
      .getByText("answer_autosave_failed")
      .closest("div")!;
    const clientText = clientRow.textContent ?? "";
    expect(clientText).toContain("前端");
    expect(clientText).toContain("客户端声明，未经服务端核验");
    expect(clientText).toContain("req-42");
    expect(clientText).toContain("500");

    // Audit row: labeled 操作 from its real source (never 前端), and its
    // server-owned metadata is NOT marked as a client claim.
    const auditRow = screen.getByText("force_submit").closest("div")!;
    const auditText = auditRow.textContent ?? "";
    expect(auditText).toContain("操作");
    expect(auditText).not.toContain("前端");
    expect(auditText).not.toContain("客户端声明，未经服务端核验");
  });

  // ── #800 PR-C A3-F7: recovery-archive deep link ────────────────────
  // A proctor spotting a suspicious candidate had no way to jump from the
  // monitoring row into that attempt's Recovery archive — only the timeline
  // dialog existed. The deep link composes per capability: the recovery
  // route is Admin-gated (IncidentRecoveryView), so a Proctor's rows simply
  // do not render the affordance (no dead button).

  it("renders the recovery-archive row action for an Admin and deep-links to the recovery attempt route", async () => {
    getMock.mockResolvedValue({ items: [makeAttempt()], total: 1 });
    const user = userEvent.setup();
    renderPage();

    const action = await screen.findByRole("button", {
      name: "恢复档案",
    });
    await user.click(action);

    expect(
      await screen.findByTestId("recovery-attempt-stub"),
    ).toBeInTheDocument();
  });

  it("does not render the recovery-archive action for a caller without IncidentRecoveryView", async () => {
    getMock.mockResolvedValue({
      items: [makeAttempt()],
      total: 1,
    });
    renderPage({
      role: "Proctor",
      capabilities: [...permissionsForRole("Proctor")],
    });

    expect(await screen.findByText("张三")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "恢复档案" })).toBeNull();
  });
});
