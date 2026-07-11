import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { logger } from "@/lib/logger";
import * as statusMetaModule from "@/lib/statusMeta";
import { ExamMonitoringPage } from "./ExamMonitoringPage";

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn() },
  setNavigate: () => {},
}));

vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Ownership-sensitive spy on the canonical status-meta accessor. The page must
// derive its attempt-status label from `getStatusMeta` (the statusMeta owner),
// NOT from a page-local `AttemptStatus → labelKey` map. A reintroduced local
// map would never call this accessor, so the call assertion below fails. The
// spy preserves the real implementation so sibling tests' rendered text is
// unaffected.
const getStatusMetaSpy = vi.spyOn(statusMetaModule, "getStatusMeta");

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

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/admin/exams/exam-1/proctor/monitor"]}>
      <Routes>
        {/* Route param must match the component's useParams<{ id }>() and the
            real App.tsx route (exams/:id/proctor/monitor). Earlier this used
            :examId, which left useParams().id undefined and the page never
            fetched monitoring data. */}
        <Route
          path="/admin/exams/:id/proctor/monitor"
          element={<ExamMonitoringPage />}
        />
      </Routes>
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
    // `STATUS_LABEL_KEY` map would bypass this accessor entirely, so the call
    // assertion below fails if the bypass returns. The spy keeps the real
    // implementation so the rendered label is unchanged.
    getMock.mockResolvedValueOnce({
      items: [makeAttempt({ status: "in_progress" })],
      total: 1,
    });

    renderPage();
    await waitFor(() => {
      expect(screen.getByText("考试监控")).toBeInTheDocument();
    });

    expect(getStatusMetaSpy).toHaveBeenCalledWith("in_progress");
  });
});
