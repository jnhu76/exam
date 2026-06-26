import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { logger } from "@/lib/logger";
import { ExamMonitoringPage } from "./ExamMonitoringPage";

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn() },
  setNavigate: () => {},
}));

vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

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
    getMock.mockResolvedValueOnce({
      items: [makeAttempt()],
      total: 1,
    });
    renderPage();
    expect(await screen.findByText("张三")).toBeInTheDocument();

    getMock.mockRejectedValueOnce(new Error("timeout"));
    await vi.waitFor(
      () => {
        expect(warnMock).toHaveBeenCalledWith("monitoring.poll_failed", {
          examId: "exam-1",
        });
      },
      { timeout: 20000 },
    );
    expect(
      await screen.findByText("监控数据刷新失败，当前为上次成功数据"),
    ).toBeInTheDocument();
  }, 25000);

  // Empty state and timeline dialog tests are deferred to a follow-up PR
  // to avoid timer-interference from the 15s polling interval across tests.
});
