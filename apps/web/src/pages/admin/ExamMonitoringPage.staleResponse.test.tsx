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

const getMock = vi.mocked(api.get);

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

function makeTimelineEvent(name: string): Record<string, unknown> {
  return {
    id: `evt-${name}`,
    serverRecordedAt: "2026-06-23T08:06:00.000Z",
    occurredAt: "2026-06-23T08:05:00.000Z",
    name,
    level: "info",
    kind: "exam_telemetry",
    metadata: {},
    source: "client_event",
  };
}

function timelinePayload(events: string[]) {
  return {
    items: events.map(makeTimelineEvent),
    total: events.length,
    page: 1,
    pageSize: 50,
    totalPages: 1,
  };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Deferred FIFOs pinning each endpoint's settlement order independently of
 * its issue order — the freedom overlapping requests have on the wire. */
const attemptsDeferreds: Array<
  ReturnType<typeof deferred<{ items: unknown[]; total: number }>>
> = [];
const timelineDeferreds: Array<
  ReturnType<typeof deferred<Record<string, unknown>>>
> = [];
/** Resolved-value FIFOs for requests that settle immediately. */
const attemptsImmediate: Array<{ items: unknown[]; total: number }> = [];
const timelineImmediate: Array<Record<string, unknown>> = [];

const timelineCalls = () =>
  getMock.mock.calls
    .map((c) => String(c[0]))
    .filter((u) => u.includes("/proctor-events"));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/admin/exams/exam-1/proctor/monitor"]}>
      <AuthProvider
        initialUser={{
          id: "1",
          username: "proctor",
          name: "Proctor",
          role: "Admin",
          organizationId: "org1",
          capabilities: [...permissionsForRole("Admin")],
        }}
      >
        <BrandProvider>
          <Routes>
            <Route
              path="/admin/exams/:id/proctor/monitor"
              element={<ExamMonitoringPage />}
            />
          </Routes>
        </BrandProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  attemptsDeferreds.length = 0;
  timelineDeferreds.length = 0;
  attemptsImmediate.length = 0;
  timelineImmediate.length = 0;
  getMock.mockImplementation(async (url: string) => {
    const target = String(url);
    if (target.includes("/proctor-events")) {
      if (timelineImmediate.length > 0) return timelineImmediate.shift()!;
      const d = deferred<Record<string, unknown>>();
      timelineDeferreds.push(d);
      return d.promise;
    }
    if (target.includes("/proctor/attempts")) {
      if (attemptsImmediate.length > 0) return attemptsImmediate.shift()!;
      const d = deferred<{ items: unknown[]; total: number }>();
      attemptsDeferreds.push(d);
      return d.promise;
    }
    throw new Error(`unexpected GET ${target}`);
  });
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * Response ownership for the monitoring page: the timeline dialog shows the
 * event stream of the currently selected attempt, and the attempts table
 * shows the latest issued poll. Neither setTimeline / setTimelineError /
 * setAttempts nor their loading flags may be written by a response whose
 * request was superseded by another selection, a dialog close, or a newer
 * poll — the last-settled response previously won regardless of ownership.
 */
describe("ExamMonitoringPage response ownership", () => {
  it("a superseded timeline response landing last must not overwrite the current attempt's dialog", async () => {
    attemptsImmediate.push({
      items: [
        makeAttempt({ attemptId: "att-A", candidateName: "张三" }),
        makeAttempt({ attemptId: "att-B", candidateName: "李四" }),
      ],
      total: 2,
    });
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("张三");

    // Attempt A's timeline request — held on the wire. The modal dialog
    // blocks row clicks while open, so the reachable superseding selection
    // is close-then-reopen.
    await user.click(screen.getAllByRole("button", { name: "时间线" })[0]!);
    expect(timelineCalls().at(-1)).toContain("att-A");
    await user.click(screen.getByRole("button", { name: "关闭" }));

    // Attempt B is selected while A is still in flight: A is superseded.
    await user.click(screen.getAllByRole("button", { name: "时间线" })[1]!);
    expect(timelineCalls().at(-1)).toContain("att-B");

    // B settles first; its dialog is current.
    await act(async () => {
      timelineDeferreds[1]!.resolve(timelinePayload(["event-of-B"]));
    });
    expect(await screen.findByText("event-of-B")).toBeVisible();
    expect(screen.getByText("事件时间线 — 李四")).toBeInTheDocument();

    // Superseded A settles LAST: its rows must be discarded — the dialog
    // must keep describing the attempt whose title it shows.
    await act(async () => {
      timelineDeferreds[0]!.resolve(timelinePayload(["event-of-A"]));
    });

    expect(screen.queryByText("event-of-A")).not.toBeInTheDocument();
    expect(screen.getByText("event-of-B")).toBeInTheDocument();
    expect(screen.getByText("事件时间线 — 李四")).toBeInTheDocument();
  });

  it("a timeline response arriving after the dialog closed must not pollute the next opened attempt", async () => {
    attemptsImmediate.push({
      items: [
        makeAttempt({ attemptId: "att-A", candidateName: "张三" }),
        makeAttempt({ attemptId: "att-B", candidateName: "李四" }),
      ],
      total: 2,
    });
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("张三");

    // Open A — its timeline request is held on the wire.
    await user.click(screen.getAllByRole("button", { name: "时间线" })[0]!);
    expect(timelineCalls().at(-1)).toContain("att-A");

    // Close the dialog: the in-flight A request is now orphaned.
    await user.click(screen.getByRole("button", { name: "关闭" }));
    expect(screen.queryByText(/事件时间线/)).not.toBeInTheDocument();

    // Open B while A is still in flight.
    await user.click(screen.getAllByRole("button", { name: "时间线" })[1]!);
    expect(timelineCalls().at(-1)).toContain("att-B");

    // Orphaned A settles while B is loading: B's dialog must not show A's
    // rows, and A's settlement must not end B's loading skeleton.
    await act(async () => {
      timelineDeferreds[0]!.resolve(timelinePayload(["event-of-A"]));
    });

    expect(screen.queryByText("event-of-A")).not.toBeInTheDocument();
    expect(screen.getByText("事件时间线 — 李四")).toBeInTheDocument();

    // B's own response still lands normally.
    await act(async () => {
      timelineDeferreds[1]!.resolve(timelinePayload(["event-of-B"]));
    });
    expect(await screen.findByText("event-of-B")).toBeVisible();
  });

  it("a superseded timeline request FAILING after the current one succeeded must not flip the dialog to its error", async () => {
    attemptsImmediate.push({
      items: [
        makeAttempt({ attemptId: "att-A", candidateName: "张三" }),
        makeAttempt({ attemptId: "att-B", candidateName: "李四" }),
      ],
      total: 2,
    });
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("张三");

    await user.click(screen.getAllByRole("button", { name: "时间线" })[0]!);
    await user.click(screen.getByRole("button", { name: "关闭" }));
    await user.click(screen.getAllByRole("button", { name: "时间线" })[1]!);

    // B succeeds; A then FAILS. The failure belongs to a request nobody is
    // waiting for — it must not own B's dialog.
    await act(async () => {
      timelineDeferreds[1]!.resolve(timelinePayload(["event-of-B"]));
    });
    expect(await screen.findByText("event-of-B")).toBeVisible();

    await act(async () => {
      timelineDeferreds[0]!.reject(new Error("stale timeline failed"));
    });

    expect(screen.queryByText("加载事件时间线失败")).not.toBeInTheDocument();
    expect(screen.getByText("event-of-B")).toBeInTheDocument();
  });

  it("a superseded attempts poll response landing last must not overwrite the newer list", async () => {
    attemptsImmediate.push({
      items: [makeAttempt({ attemptId: "att-1", candidateName: "张三" })],
      total: 1,
    });
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("张三");

    // Manual refresh — request A held on the wire.
    await user.click(screen.getByRole("button", { name: "刷新监控数据" }));
    // A visibility-change refetch overlaps it — request B, issued LAST.
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(attemptsDeferreds.length).toBe(2);

    // The latest-issued request settles first: its rows are current.
    await act(async () => {
      attemptsDeferreds[1]!.resolve({
        items: [makeAttempt({ attemptId: "att-9", candidateName: "李四" })],
        total: 1,
      });
    });
    await waitFor(() => expect(screen.getByText("李四")).toBeInTheDocument());

    // The superseded request settles LAST: its older rows must be dropped.
    await act(async () => {
      attemptsDeferreds[0]!.resolve({
        items: [makeAttempt({ attemptId: "att-1", candidateName: "张三" })],
        total: 1,
      });
    });

    expect(screen.queryByText("张三")).not.toBeInTheDocument();
    expect(screen.getByText("李四")).toBeInTheDocument();
  });
});
