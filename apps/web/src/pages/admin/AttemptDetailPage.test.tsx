import { StrictMode } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "@/contexts/AuthContext";
import { BrandProvider } from "@/components/layout/BrandProvider";
import { AttemptDetailPage } from "./AttemptDetailPage";
import { permissionsForRole } from "@exam/authz";
import type { AssignableRole } from "@exam/contracts";

const { apiGet, apiPost } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
}));

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
  api: {
    get: (...args: unknown[]) => apiGet(...args),
    post: (...args: unknown[]) => apiPost(...args),
  },
  setNavigate: () => {},
}));

function renderPage(
  attemptId = "attempt-1",
  actor: { role: AssignableRole; capabilities: string[] } = {
    role: "Admin",
    capabilities: [...permissionsForRole("Admin")],
  },
) {
  return render(
    <MemoryRouter initialEntries={[`/admin/attempts/${attemptId}`]}>
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
            <Route path="/admin/attempts/:id" element={<AttemptDetailPage />} />
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

const mockGradedResult = {
  attemptId: "attempt-1",
  status: "graded" as const,
  showResultImmediately: true as const,
  examTitle: "期末考试",
  passingScore: 60,
  totalScore: 100,
  passed: true,
  gradedAt: new Date().toISOString(),
  questionResults: [
    {
      questionId: "q1",
      score: 10,
      maxScore: 10,
      correct: true,
      candidateAnswer: "A",
      standardAnswer: "A",
      type: "single_choice",
      content: "Question 1",
      order: 1,
    },
    {
      questionId: "q2",
      score: 5,
      maxScore: 10,
      correct: false,
      candidateAnswer: "B",
      standardAnswer: "A",
      type: "single_choice",
      content: "Question 2",
      order: 2,
    },
  ],
};

describe("AttemptDetailPage", () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPost.mockReset();
  });

  it("displays earned score (sum of question scores) not totalScore", async () => {
    apiGet.mockResolvedValue(mockGradedResult);
    renderPage();

    await screen.findByText("成绩概览");

    const earnedScoreEl = screen.getByTestId("earned-score");
    expect(earnedScoreEl).toHaveTextContent("15");

    expect(screen.getByText("100")).toBeInTheDocument();
  });

  it("shows green for passed, red for failed", async () => {
    apiGet.mockResolvedValue({ ...mockGradedResult, passed: true });
    renderPage();
    await screen.findByText("成绩概览");

    const earnedScoreEl = screen.getByTestId("earned-score");
    // The status color lives on an inner span (the type-metric recipe owns
    // color on the outer element; the pass/fail state color is applied to the
    // text span so it does not conflict with the recipe).
    expect(earnedScoreEl.querySelector("span")!.className).toContain(
      "text-success",
    );

    expect(screen.getByText("及格")).toBeInTheDocument();
  });

  it("shows destructive color for failed attempt", async () => {
    apiGet.mockResolvedValue({ ...mockGradedResult, passed: false });
    renderPage();
    await screen.findByText("成绩概览");

    const earnedScoreEl = screen.getByTestId("earned-score");
    expect(earnedScoreEl.querySelector("span")!.className).toContain(
      "text-destructive",
    );

    expect(screen.getByText("不及格")).toBeInTheDocument();
  });

  it("shows passing score", async () => {
    apiGet.mockResolvedValue(mockGradedResult);
    renderPage();
    await screen.findByText("成绩概览");
    // R0-F5: the metric card carries the unified concept name; this
    // summary row keeps the shared bare-number metric grammar.
    expect(screen.getByText("及格要求")).toBeInTheDocument();
    expect(screen.getByText("60")).toBeInTheDocument();
  });

  it("shows status-specific message when result is submitted (not graded)", async () => {
    apiGet.mockResolvedValue({
      attemptId: "attempt-1",
      status: "submitted",
      showResultImmediately: false,
      examTitle: "期末考试",
    });
    renderPage();
    expect(
      await screen.findByText("该尝试已提交，等待评分"),
    ).toBeInTheDocument();
  });

  it("shows status-specific message when graded but not visible", async () => {
    apiGet.mockResolvedValue({
      attemptId: "attempt-1",
      status: "graded",
      showResultImmediately: false,
      examTitle: "期末考试",
    });
    renderPage();
    expect(
      await screen.findByText("该尝试已评分，但成绩尚未公布"),
    ).toBeInTheDocument();
  });

  it("shows loading state", () => {
    apiGet.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("shows error state on API failure", async () => {
    apiGet.mockRejectedValue(new Error("fail"));
    renderPage();
    expect(await screen.findByText("加载尝试详情失败")).toBeInTheDocument();
  });

  it("renders question results table", async () => {
    apiGet.mockResolvedValue(mockGradedResult);
    renderPage();
    await screen.findByText("答题详情");
    expect(screen.getByText("Question 1")).toBeInTheDocument();
    expect(screen.getByText("Question 2")).toBeInTheDocument();
    expect(screen.getAllByText("A").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("B").length).toBeGreaterThanOrEqual(1);
  });

  it("renders question type labels from shared constants", async () => {
    apiGet.mockResolvedValue({
      ...mockGradedResult,
      questionResults: [
        ...mockGradedResult.questionResults,
        {
          questionId: "q3",
          score: 8,
          maxScore: 10,
          correct: true,
          candidateAnswer: "foo",
          standardAnswer: "foo",
          type: "fill_blank",
          content: "Question 3",
          order: 3,
        },
      ],
    });
    renderPage();
    await screen.findByText("答题详情");
    expect(screen.getAllByText("单选").length).toBe(2);
    expect(screen.getByText("填空")).toBeInTheDocument();
  });

  // --- Timeline section (P2E-J2) ---
  // api.get is called twice per page load (result + timeline). Route the mock
  // by URL so each fetch resolves to the right payload.

  function mockTimelineResult(
    result: unknown,
    timeline: { events: unknown[] },
    receiptSummary: unknown = {
      receiptCount: 0,
      maxClientSeq: null,
      lastSavedAt: null,
    },
  ) {
    apiGet.mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.includes("/timeline")) {
        return timeline;
      }
      if (
        typeof url === "string" &&
        url.includes("/answer-save-receipt-summary")
      ) {
        return receiptSummary;
      }
      return result;
    });
  }

  const mockTimelineEvents = {
    events: [
      {
        id: "e1",
        organizationId: "org1",
        actorId: "cand-1",
        action: "attempt.start",
        targetType: "attempt",
        targetId: "attempt-1",
        metadata: { source: "candidate" },
        ipAddress: null,
        userAgent: null,
        createdAt: "2026-06-23T08:00:00.000Z",
      },
      {
        id: "e2",
        organizationId: "org1",
        actorId: "admin-1",
        action: "attempt.forceSubmit",
        targetType: "attempt",
        targetId: "attempt-1",
        metadata: { reason: "proctor" },
        ipAddress: "10.0.0.1",
        userAgent: "test",
        createdAt: "2026-06-23T08:30:00.000Z",
      },
    ],
  };

  it("renders the timeline section with human-readable event labels", async () => {
    mockTimelineResult(mockGradedResult, mockTimelineEvents);
    renderPage();
    await screen.findByText("答卷时间线");
    // attempt.start -> 开始答题, attempt.forceSubmit -> 管理员强制交卷
    expect(await screen.findByText("开始答题")).toBeInTheDocument();
    expect(screen.getByText("管理员强制交卷")).toBeInTheDocument();
  });

  it("renders grant_time timeline event with a Chinese label, not the raw key", async () => {
    mockTimelineResult(mockGradedResult, {
      events: [
        {
          id: "e-grant",
          organizationId: "org1",
          actorId: "admin-1",
          action: "grant_time",
          targetType: "attempt",
          targetId: "attempt-1",
          metadata: { addedSeconds: 600 },
          ipAddress: null,
          userAgent: null,
          createdAt: "2026-06-23T08:10:00.000Z",
        },
      ],
    });
    renderPage();
    await screen.findByText("答卷时间线");
    // The localized label is rendered, never the raw action key.
    expect(await screen.findByText("授予考试时间")).toBeInTheDocument();
    expect(screen.queryByText("grant_time")).not.toBeInTheDocument();
  });

  it("shows empty state when timeline has no events", async () => {
    mockTimelineResult(mockGradedResult, { events: [] });
    renderPage();
    await screen.findByText("答卷时间线");
    expect(await screen.findByText("暂无时间线事件")).toBeInTheDocument();
  });

  it("shows timeline error fallback when timeline fetch rejects", async () => {
    apiGet.mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.includes("/timeline")) {
        throw new Error("timeline fail");
      }
      return mockGradedResult;
    });
    renderPage();
    expect(await screen.findByText("加载时间线失败")).toBeInTheDocument();
  });

  it("expands event metadata when an event row is clicked", async () => {
    mockTimelineResult(mockGradedResult, mockTimelineEvents);
    renderPage();
    await screen.findByText("答卷时间线");
    const startLabel = await screen.findByText("开始答题");
    fireEvent.click(startLabel);
    // metadata JSON for the start event contains "source".
    expect(await screen.findByText(/source/)).toBeInTheDocument();
  });

  // ── P3-MOD-P3-3: Admin frozen result view ────────────────────────
  // AttemptDetailPage consumes the admin all-view DTO
  // (GET /api/admin/attempts/:id/result). The server bypasses the publication
  // gate on that surface and keeps standardAnswer, so the DTO carries
  // showResultImmediately:true + standardAnswer even when the candidate result
  // is pending_publish. This test proves the page renders the
  // full admin frozen detail (score/pass + objective standardAnswer) purely from
  // that DTO — it never fetches live questions and never hides based on
  // candidate publication state.
  it("renders full admin frozen result (score/pass + standardAnswer) from the admin scores DTO", async () => {
    apiGet.mockResolvedValue({
      attemptId: "attempt-1",
      status: "graded",
      showResultImmediately: true,
      examTitle: "P3-3 admin frozen",
      passingScore: 20,
      totalScore: 30,
      passed: true,
      gradedAt: new Date().toISOString(),
      questionResults: [
        {
          questionId: "q-obj",
          score: 10,
          maxScore: 10,
          correct: true,
          candidateAnswer: "a",
          standardAnswer: "a",
          type: "single_choice",
          content: "P3-3 objective prompt",
          order: 0,
        },
        {
          questionId: "q-text",
          score: 15,
          maxScore: 20,
          correct: true,
          candidateAnswer: "candidate essay",
          standardAnswer: "P3-3 frozen reference answer",
          type: "text_response",
          content: "P3-3 essay prompt",
          order: 1,
        },
      ],
    });
    renderPage();

    await screen.findByText("成绩概览");
    // Admin aggregate score + pass render (candidate publication is irrelevant
    // to the admin view — the DTO gate is the page's only input).
    expect(screen.getByText("及格")).toBeInTheDocument();
    expect(screen.getByText("P3-3 objective prompt")).toBeInTheDocument();
    expect(screen.getByText("P3-3 essay prompt")).toBeInTheDocument();
    // The objective frozen standardAnswer is rendered for the admin (the server
    // does not strip it for Admin, unlike the candidate projection).
    expect(screen.getAllByText("a").length).toBeGreaterThan(0);
  });

  // ── #524: misconduct flag must carry a dialog-frozen operationId ────────
  // The route contract (MisconductMarkWithOperationRequestSchema) requires
  // operationId; the stale caller posted {severity, notes} and the API always
  // answered 400 VALIDATION_ERROR. One logical dialog command = one
  // operationId: minted on dialog open, retained across same-dialog retries,
  // retired on close/confirm.

  const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  const mockLiveResult = {
    attemptId: "attempt-1",
    status: "in_progress",
    showResultImmediately: false,
    examTitle: "进行中考试",
  };

  function mockLiveView() {
    apiGet.mockImplementation(async (url: string) =>
      typeof url === "string" && url.includes("/timeline")
        ? { events: [] }
        : mockLiveResult,
    );
  }

  async function renderLiveView() {
    mockLiveView();
    renderPage();
    await screen.findByText("尝试状态");
  }

  async function submitFlag(notes = "考生查看手机") {
    fireEvent.click(screen.getByRole("button", { name: "标记违规" }));
    fireEvent.change(screen.getByLabelText("违规说明"), {
      target: { value: notes },
    });
    fireEvent.click(screen.getByRole("button", { name: "确认标记" }));
    await waitFor(() => expect(apiPost).toHaveBeenCalled());
  }

  async function waitSubmitSettled() {
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "确认标记" })).toBeEnabled(),
    );
  }

  function postedBody(call: number): Record<string, unknown> {
    return apiPost.mock.calls[call]![1] as Record<string, unknown>;
  }

  it("T1: flag misconduct POST carries operationId (uuid) with severity + notes", async () => {
    apiPost.mockResolvedValue({});
    await renderLiveView();
    await submitFlag();

    expect(apiPost).toHaveBeenCalledTimes(1);
    expect(apiPost.mock.calls[0]![0]).toBe(
      "/api/admin/attempts/attempt-1/misconduct",
    );
    const body = postedBody(0);
    expect(body.operationId).toMatch(UUID_RE);
    expect(body).toMatchObject({ severity: "warning", notes: "考生查看手机" });
  });

  it("T2: same-dialog retry after unconfirmed failure reuses the same operationId", async () => {
    apiPost.mockResolvedValue({});
    apiPost.mockRejectedValueOnce(new Error("network drop"));
    await renderLiveView();
    await submitFlag();
    await waitSubmitSettled();

    // The failure keeps the dialog open; the retry is the SAME logical
    // command and must replay the SAME identity.
    fireEvent.click(screen.getByRole("button", { name: "确认标记" }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(2));

    expect(postedBody(0).operationId).toMatch(UUID_RE);
    expect(postedBody(1).operationId).toBe(postedBody(0).operationId);
  });

  it("T3: a new dialog after cancel mints a fresh operationId", async () => {
    apiPost.mockRejectedValue(new Error("network drop"));
    await renderLiveView();
    await submitFlag();
    await waitSubmitSettled();

    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    fireEvent.click(screen.getByRole("button", { name: "标记违规" }));
    fireEvent.change(screen.getByLabelText("违规说明"), {
      target: { value: "第二次标记" },
    });
    fireEvent.click(screen.getByRole("button", { name: "确认标记" }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(2));

    expect(postedBody(0).operationId).toMatch(UUID_RE);
    expect(postedBody(1).operationId).toMatch(UUID_RE);
    expect(postedBody(1).operationId).not.toBe(postedBody(0).operationId);
  });

  it("T4: payload semantics unchanged — endpoint, severity, notes", async () => {
    apiPost.mockResolvedValue({});
    await renderLiveView();
    await submitFlag("考试作弊记录");

    expect(apiPost.mock.calls[0]![0]).toBe(
      "/api/admin/attempts/attempt-1/misconduct",
    );
    expect(postedBody(0)).toMatchObject({
      severity: "warning",
      notes: "考试作弊记录",
    });
  });

  // ── #612: capability composition closure ──────────────────────────
  // Route reachability (attempt.timeline.view) and sub-feature authority are
  // distinct capabilities. The load-bearing assertion for a Proctor-like set
  // is NOT merely "button hidden" — it is "button hidden AND the unauthorized
  // privileged request never emitted".

  const proctorActor: { role: AssignableRole; capabilities: string[] } = {
    role: "Proctor",
    capabilities: [...permissionsForRole("Proctor")],
  };

  function mockTimelineOnly(timeline: { events: unknown[] }) {
    apiGet.mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.includes("/timeline")) {
        return timeline;
      }
      if (typeof url === "string" && url.includes("/proctor-events")) {
        // Same attempt.timeline.view capability as the audit timeline — the
        // telemetry timeline composes for the timeline-only caller too.
        return { items: [], total: 0, page: 1, pageSize: 50, totalPages: 0 };
      }
      if (
        typeof url === "string" &&
        url.includes("/answer-save-receipt-summary")
      ) {
        // #866: the receipt summary reuses the SAME attempt.timeline.view
        // capability — legitimate for the timeline-only caller.
        return { receiptCount: 0, maxClientSeq: null, lastSavedAt: null };
      }
      // Any other GET (i.e. the score read) is a contract violation
      // for the timeline-only caller — fail loudly instead of returning data.
      throw new Error(`unexpected privileged request: ${url}`);
    });
  }

  // Regression for #612: capability-set-driven action affordances on the
  // admin attempt timeline.
  it("Proctor-like set renders the timeline shell and never emits the score/export/misconduct requests", async () => {
    mockTimelineOnly(mockTimelineEvents);
    renderPage("attempt-1", proctorActor);

    // The timeline surface (the legitimate base page) renders with events.
    expect(await screen.findByText("答卷时间线")).toBeInTheDocument();
    expect(await screen.findByText("开始答题")).toBeInTheDocument();

    // The result fetch was never issued — page reachability must not mint a
    // guaranteed-403 request. The three timeline-capability reads it DOES
    // emit (audit + telemetry + receipt summary, #866) all share the
    // attempt.timeline.view capability this caller holds.
    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledTimes(3);
    });
    const timelineUrls = apiGet.mock.calls.map((c) => c[0] as string);
    expect(timelineUrls).toContain("/api/admin/attempts/attempt-1/timeline");
    expect(timelineUrls).toContain(
      "/api/admin/attempts/attempt-1/proctor-events?limit=50",
    );
    expect(timelineUrls).toContain(
      "/api/admin/attempts/attempt-1/answer-save-receipt-summary",
    );
    expect(apiPost).not.toHaveBeenCalled();

    // Privileged affordances are absent alongside their requests.
    expect(
      screen.queryByRole("button", { name: "导出CSV" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "导出JSON" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "标记违规" }),
    ).not.toBeInTheDocument();
    // The shell keeps navigation (and is not stuck on the result loading state).
    expect(screen.getByRole("button", { name: "返回" })).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("divergent capability set (score read without export/misconduct) still composes each sub-feature independently", async () => {
    // A Proctor-LABELED actor whose set additionally holds the score-read
    // capability: proves composition follows the capability set, not the role
    // name — timeline + score read held, export + misconduct not.
    const divergentActor: { role: AssignableRole; capabilities: string[] } = {
      role: "Proctor",
      capabilities: ["attempt.timeline.view", "score.all.view"],
    };
    apiGet.mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.includes("/timeline")) {
        return { events: [] };
      }
      return mockLiveResult;
    });
    renderPage("attempt-1", divergentActor);

    // Score-capable caller: the live status view renders (the authorized
    // request WAS issued and composed).
    expect(await screen.findByText("尝试状态")).toBeInTheDocument();
    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledWith(
        "/api/admin/attempts/attempt-1/result",
      );
    });

    // The un-held sub-features stay absent.
    expect(
      screen.queryByRole("button", { name: "导出CSV" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "标记违规" }),
    ).not.toBeInTheDocument();
  });

  it("Admin keeps the export affordances on the live view", async () => {
    mockTimelineResult(mockLiveResult, { events: [] });
    renderPage();

    expect(await screen.findByText("尝试状态")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "导出CSV" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "导出JSON" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "标记违规" }),
    ).toBeInTheDocument();
  });

  // ── #800 PR-C A3-F1: telemetry timeline section ────────────────────
  // After submit/grade the monitoring list drops the attempt, but the 30-day
  // proctor-events telemetry (client_events + audit merge) stays queryable.
  // The attempt detail page must surface it so a save-failure complaint three
  // days later is answerable from the UI instead of a hand-rolled API call.
  // Source provenance stays visible: client rows are ADVISORY telemetry,
  // audit rows are the authoritative record.

  function mockFullTimeline(result: unknown, telemetry: unknown) {
    apiGet.mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.includes("/proctor-events")) {
        return telemetry;
      }
      if (typeof url === "string" && url.includes("/timeline")) {
        return { events: [] };
      }
      return result;
    });
  }

  // Shapes mirror the server projection (proctorMonitoringService.ts): the
  // raw client_events.metadata blob never reaches the wire — only the
  // allowlisted keys do. `answer_autosave_failed` carries the stable
  // questionId/saveMode/durationMs/errorCode category codes, NOT raw content.
  // `serverRecordedAt` is the server-owned receive instant (ordering
  // authority); `occurredAt` is the source-specific display instant.
  const mockTelemetry = {
    items: [
      {
        id: "tel-1",
        serverRecordedAt: "2026-06-23T08:06:00.000Z",
        occurredAt: "2026-06-23T08:05:00.000Z",
        name: "answer_autosave_failed",
        level: "error",
        kind: "exam_telemetry",
        metadata: {
          questionId: "q1",
          saveMode: "auto",
          durationMs: 1500,
          errorCode: "SAVE_NETWORK_TIMEOUT",
        },
        source: "client_event",
      },
      {
        id: "tel-2",
        serverRecordedAt: "2026-06-23T08:30:00.000Z",
        occurredAt: "2026-06-23T08:30:00.000Z",
        name: "force_submit",
        level: "warn",
        kind: "proctor",
        metadata: {},
        source: "audit_log",
      },
    ],
    total: 2,
    page: 1,
    pageSize: 50,
    totalPages: 1,
  };

  it("renders the telemetry timeline with save-failure evidence and source-distinct rows", async () => {
    mockFullTimeline(mockGradedResult, mockTelemetry);
    renderPage();

    await screen.findByText("成绩概览");
    expect(await screen.findByText("遥测时间线")).toBeInTheDocument();
    // Save-failure evidence is visible: the event name + allowlisted stable
    // codes (category identifiers), even after the attempt is graded.
    expect(screen.getByText("answer_autosave_failed")).toBeInTheDocument();
    expect(screen.getByText(/SAVE_NETWORK_TIMEOUT/)).toBeInTheDocument();
    // Provenance is rendered per row from `source` — advisory client
    // telemetry vs authoritative audit rows stay distinguishable.
    expect(screen.getByText("前端遥测")).toBeInTheDocument();
    expect(screen.getByText("审计记录")).toBeInTheDocument();
  });

  it("shows the server receive instant as the primary row time and only client rows carry the client claim", async () => {
    mockFullTimeline(mockGradedResult, mockTelemetry);
    renderPage();

    await screen.findByText("成绩概览");
    await screen.findByText("遥测时间线");

    // Row-level proof (global getByText would over-match ancestor text):
    // the client row carries BOTH the server receive instant (first) and the
    // client claim; the audit row carries only the server instant.
    const clientRow = screen
      .getByText("answer_autosave_failed")
      .closest("div")!;
    const clientText = clientRow.textContent ?? "";
    expect(clientText).toMatch(/服务端接收.*客户端声明/);

    const auditRow = screen.getByText("force_submit").closest("div")!;
    const auditText = auditRow.textContent ?? "";
    expect(auditText).toContain("服务端接收");
    expect(auditText).not.toContain("客户端声明");
  });

  it("Load More appends the next page, keeps loaded rows, and updates the shown/total footer", async () => {
    const pageOne = {
      items: [mockTelemetry.items[0]!],
      total: 2,
      page: 1,
      pageSize: 1,
      totalPages: 2,
    };
    const pageTwo = {
      items: [
        {
          id: "tel-old",
          serverRecordedAt: "2026-06-23T08:00:00.000Z",
          occurredAt: "2026-06-23T08:00:00.000Z",
          name: "answer_saved",
          level: "info",
          kind: "exam_telemetry",
          metadata: {},
          source: "client_event",
        },
      ],
      total: 2,
      page: 2,
      pageSize: 1,
      totalPages: 2,
    };
    apiGet.mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.includes("/proctor-events")) {
        return url.includes("page=2") ? pageTwo : pageOne;
      }
      if (typeof url === "string" && url.includes("/timeline")) {
        return { events: [] };
      }
      return mockGradedResult;
    });
    renderPage();

    await screen.findByText("成绩概览");
    expect(
      await screen.findByText("answer_autosave_failed"),
    ).toBeInTheDocument();
    // Partial view is stated explicitly: 1 of 2 server rows is on screen.
    expect(screen.getByText("已显示 1 / 2 条事件")).toBeInTheDocument();
    expect(
      screen.getByText("仅显示最近 1 条事件，更早证据需加载"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "加载更早事件" }));

    // The older page is appended — the already-loaded row stays mounted.
    expect(await screen.findByText("answer_saved")).toBeInTheDocument();
    expect(screen.getByText("answer_autosave_failed")).toBeInTheDocument();
    // With the final page loaded, the footer reports full coverage and the
    // Load-More affordance retires.
    await waitFor(() =>
      expect(screen.getByText("已显示 2 / 2 条事件")).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("button", { name: "加载更早事件" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("仅显示最近 2 条事件，更早证据需加载"),
    ).not.toBeInTheDocument();
    // The append fetch targeted the NEXT page explicitly.
    expect(
      apiGet.mock.calls.some(
        (c) =>
          typeof c[0] === "string" &&
          c[0].includes("/proctor-events?limit=50&page=2"),
      ),
    ).toBe(true);
  });

  it("a failed Load More keeps the already-loaded rows and offers the retry again", async () => {
    const pageOne = {
      items: [mockTelemetry.items[0]!],
      total: 2,
      page: 1,
      pageSize: 1,
      totalPages: 2,
    };
    apiGet.mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.includes("/proctor-events")) {
        if (url.includes("page=2")) throw new Error("older page failed");
        return pageOne;
      }
      if (typeof url === "string" && url.includes("/timeline")) {
        return { events: [] };
      }
      return mockGradedResult;
    });
    renderPage();

    await screen.findByText("成绩概览");
    expect(
      await screen.findByText("answer_autosave_failed"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "加载更早事件" }));

    // The failed fetch does NOT replace loaded evidence with the error state:
    // the row and the Load-More affordance remain available.
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "加载更早事件" }),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText("answer_autosave_failed")).toBeInTheDocument();
    expect(screen.queryByText("加载遥测时间线失败")).not.toBeInTheDocument();
  });

  it("a >50-event history loads the 50-row first page and appends the 51st on Load More", async () => {
    const makeEvent = (i: number) => ({
      id: `tel-${i}`,
      serverRecordedAt: "2026-06-23T08:06:00.000Z",
      occurredAt: "2026-06-23T08:06:00.000Z",
      name: i === 50 ? "oldest_event" : "answer_saved",
      level: "info",
      kind: "exam_telemetry",
      metadata: {},
      source: "client_event",
    });
    const firstPage = {
      items: Array.from({ length: 50 }, (_, i) => makeEvent(i)),
      total: 51,
      page: 1,
      pageSize: 50,
      totalPages: 2,
    };
    const secondPage = {
      items: [makeEvent(50)],
      total: 51,
      page: 2,
      pageSize: 50,
      totalPages: 2,
    };
    apiGet.mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.includes("/proctor-events")) {
        return url.includes("page=2") ? secondPage : firstPage;
      }
      if (typeof url === "string" && url.includes("/timeline")) {
        return { events: [] };
      }
      return mockGradedResult;
    });
    renderPage();

    await screen.findByText("成绩概览");
    // The default 50-row page is a PARTIAL view of 51 rows: the footer says
    // exactly that instead of silently presenting 50 as the full history.
    expect(
      await screen.findByText("已显示 50 / 51 条事件"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("仅显示最近 50 条事件，更早证据需加载"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "加载更早事件" }));

    // Page 2 supplies the 51st (oldest) event; the first 50 stay mounted.
    expect(await screen.findByText("oldest_event")).toBeInTheDocument();
    expect(screen.getAllByText("answer_saved")).toHaveLength(50);
    await waitFor(() =>
      expect(screen.getByText("已显示 51 / 51 条事件")).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("button", { name: "加载更早事件" }),
    ).not.toBeInTheDocument();
  });

  it("switching to another attempt refetches telemetry from page 1 and drops the previous attempt's rows", async () => {
    const telemetryFor = (attemptId: string) => ({
      items: [
        {
          id: `tel-${attemptId}`,
          serverRecordedAt: "2026-06-23T08:06:00.000Z",
          occurredAt: "2026-06-23T08:06:00.000Z",
          name: `telemetry_${attemptId}`,
          level: "info",
          kind: "exam_telemetry",
          metadata: {},
          source: "client_event",
        },
      ],
      total: 1,
      page: 1,
      pageSize: 50,
      totalPages: 1,
    });
    apiGet.mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.includes("/proctor-events")) {
        return url.includes("attempt-2")
          ? telemetryFor("attempt-2")
          : telemetryFor("attempt-1");
      }
      if (typeof url === "string" && url.includes("/timeline")) {
        return { events: [] };
      }
      if (typeof url === "string" && url.includes("attempt-2")) {
        return { ...mockGradedResult, attemptId: "attempt-2" };
      }
      return mockGradedResult;
    });

    function SwitchAttempt() {
      const navigate = useNavigate();
      return (
        <button
          type="button"
          onClick={() => navigate("/admin/attempts/attempt-2")}
        >
          switch-attempt
        </button>
      );
    }

    render(
      <MemoryRouter initialEntries={["/admin/attempts/attempt-1"]}>
        <AuthProvider
          initialUser={{
            id: "1",
            username: "actor",
            name: "Actor",
            role: "Admin",
            organizationId: "org1",
            capabilities: [...permissionsForRole("Admin")],
          }}
        >
          <BrandProvider>
            <SwitchAttempt />
            <Routes>
              <Route
                path="/admin/attempts/:id"
                element={<AttemptDetailPage />}
              />
            </Routes>
          </BrandProvider>
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText("telemetry_attempt-1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "switch-attempt" }));

    expect(await screen.findByText("telemetry_attempt-2")).toBeInTheDocument();
    expect(screen.queryByText("telemetry_attempt-1")).not.toBeInTheDocument();
    // The new attempt starts its own paging at page 1: the refetch carries
    // no page parameter, never the previous attempt's next page.
    const telemetryCalls = apiGet.mock.calls
      .map((c) => c[0])
      .filter(
        (u): u is string =>
          typeof u === "string" && u.includes("/proctor-events"),
      );
    const lastCall = telemetryCalls[telemetryCalls.length - 1]!;
    expect(lastCall).toContain(
      "/api/admin/attempts/attempt-2/proctor-events?limit=50",
    );
    expect(lastCall).not.toContain("page=");
  });

  it("an empty timeline shows the empty state, not a truncated-history footer", async () => {
    mockFullTimeline(mockGradedResult, {
      items: [],
      total: 0,
      page: 1,
      pageSize: 50,
      totalPages: 0,
    });
    renderPage();

    await screen.findByText("成绩概览");
    expect(await screen.findByText("暂无遥测事件")).toBeInTheDocument();
    expect(screen.queryByText(/^已显示/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "加载更早事件" }),
    ).not.toBeInTheDocument();
  });

  it("StrictMode double-mount and delayed settle keep the telemetry fetch bounded (no recursive fetch loop)", async () => {
    mockFullTimeline(mockGradedResult, mockTelemetry);
    render(
      <StrictMode>
        <MemoryRouter initialEntries={["/admin/attempts/attempt-1"]}>
          <AuthProvider
            initialUser={{
              id: "1",
              username: "actor",
              name: "Actor",
              role: "Admin",
              organizationId: "org1",
              capabilities: [...permissionsForRole("Admin")],
            }}
          >
            <BrandProvider>
              <Routes>
                <Route
                  path="/admin/attempts/:id"
                  element={<AttemptDetailPage />}
                />
              </Routes>
            </BrandProvider>
          </AuthProvider>
        </MemoryRouter>
      </StrictMode>,
    );

    await screen.findByText("成绩概览");
    await screen.findByText("遥测时间线");

    const telemetryCalls = () =>
      apiGet.mock.calls.filter(
        (c) => typeof c[0] === "string" && c[0].includes("/proctor-events"),
      ).length;
    // StrictMode double-invokes the mount effect — one fetch per mount, and
    // a settled tree must NOT keep issuing more (a fetch-in-render or
    // dependency loop would grow this without bound).
    await waitFor(() => expect(telemetryCalls()).toBe(2));
    await new Promise((r) => setTimeout(r, 50));
    expect(telemetryCalls()).toBe(2);
    // Each event renders exactly once — no duplicated rows from re-entry.
    expect(screen.getAllByText("answer_autosave_failed").length).toBe(1);
    expect(screen.getAllByText("force_submit").length).toBe(1);
  });

  it("telemetry load failure shows its own retryable error without breaking the audit timeline", async () => {
    apiGet.mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.includes("/proctor-events")) {
        throw new Error("telemetry fail");
      }
      if (typeof url === "string" && url.includes("/timeline")) {
        return mockTimelineEvents;
      }
      return mockGradedResult;
    });
    renderPage();

    await screen.findByText("成绩概览");
    expect(await screen.findByText("加载遥测时间线失败")).toBeInTheDocument();
    // The audit timeline section stays independent and rendered.
    expect(screen.getByText("答卷时间线")).toBeInTheDocument();
    expect(screen.getByText("开始答题")).toBeInTheDocument();
  });

  // ── #800 PR-C A3-F7: recovery-archive deep link ────────────────────
  // The attempt detail page only offered navigate(-1) — an admin landing on
  // a graded attempt could not jump into the Recovery archive (full ledger /
  // interruption episodes / related incidents). The link composes per
  // capability (IncidentRecoveryView — the recovery route gate), so a
  // timeline-only Proctor set never sees a dead affordance.

  it("renders the recovery-archive deep link for an Admin and navigates to the recovery attempt route", async () => {
    mockFullTimeline(mockGradedResult, {
      items: [],
      total: 0,
      page: 1,
      pageSize: 50,
      totalPages: 0,
    });
    renderPage();

    await screen.findByText("成绩概览");
    fireEvent.click(screen.getByRole("button", { name: "恢复档案" }));
    expect(
      await screen.findByTestId("recovery-attempt-stub"),
    ).toBeInTheDocument();
  });

  it("does not render the recovery-archive link for a timeline-only capability set", async () => {
    mockTimelineOnly({ events: [] });
    renderPage("attempt-1", proctorActor);

    expect(await screen.findByText("答卷时间线")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "恢复档案" })).toBeNull();
  });

  it("#866 renders the receipt summary scalars with the evidentiary disclaimer", async () => {
    mockTimelineResult(mockGradedResult, mockTimelineEvents, {
      receiptCount: 5,
      maxClientSeq: 3,
      lastSavedAt: "2026-06-23T08:20:00.000Z",
    });
    renderPage();
    expect(await screen.findByText("保存收据摘要")).toBeInTheDocument();
    expect(screen.getByText("已接受保存 5 次")).toBeInTheDocument();
    expect(screen.getByText("最大保存序号（clientSeq）3")).toBeInTheDocument();
    expect(screen.getByText(/最后保存（服务端时间）/)).toBeInTheDocument();
    expect(
      screen.getByText(/收据只证明协议在服务端时刻接受了某次保存/),
    ).toBeInTheDocument();
  });

  it("#866 an empty summary renders the UNKNOWN wording, never 'never saved'", async () => {
    mockTimelineResult(mockGradedResult, mockTimelineEvents, {
      receiptCount: 0,
      maxClientSeq: null,
      lastSavedAt: null,
    });
    renderPage();
    expect(await screen.findByText(/这不等于考生从未保存/)).toBeInTheDocument();
  });

  it("#866 a failed summary fetch renders the retry fallback and retry refetches", async () => {
    let summaryAttempts = 0;
    apiGet.mockImplementation(async (url: string) => {
      if (
        typeof url === "string" &&
        url.includes("/answer-save-receipt-summary")
      ) {
        summaryAttempts += 1;
        if (summaryAttempts === 1) throw new Error("boom");
        return { receiptCount: 2, maxClientSeq: 1, lastSavedAt: null };
      }
      if (typeof url === "string" && url.includes("/timeline")) {
        return mockTimelineEvents;
      }
      return mockGradedResult;
    });
    renderPage();
    expect(await screen.findByText("加载保存收据摘要失败")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByText("已接受保存 2 次")).toBeInTheDocument();
    expect(summaryAttempts).toBe(2);
  });
});
