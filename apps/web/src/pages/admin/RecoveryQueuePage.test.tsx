import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { permissionsForRole } from "@exam/authz";
import { AuthProvider } from "@/contexts/AuthContext";
import { BrandProvider } from "@/components/layout/BrandProvider";
import { api } from "@/lib/api";
import type { RecoveryQueueResponse } from "@/lib/recovery";
import { RecoveryQueuePage } from "./RecoveryQueuePage";

vi.mock("@/lib/api", () => ({
  api: {
    get: vi.fn(),
  },
  setNavigate: () => {},
}));

vi.mock("@/components/shared/DatePicker", () => ({
  DatePicker: ({
    value,
    onChange,
    placeholder,
    "aria-label": ariaLabel,
  }: {
    value?: Date;
    onChange: (date: Date | undefined) => void;
    placeholder?: string;
    "aria-label"?: string;
  }) => (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={() =>
        onChange(
          ariaLabel === "开始日期"
            ? new Date("2025-01-15T12:00:00Z")
            : new Date("2025-01-20T12:00:00Z"),
        )
      }
    >
      {value ? value.toISOString().slice(0, 10) : placeholder}
    </button>
  ),
}));

const getMock = vi.mocked(api.get);

/** Surfaces the router's current search string for URL-state assertions. */
function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-search">{location.search}</div>;
}

function makeItem(
  overrides: Partial<RecoveryQueueResponse["items"][number]> = {},
) {
  return {
    incident: {
      id: "incident-1",
      examId: "exam-1",
      attemptId: null,
      candidateId: null,
      type: "network_interruption",
      severity: "major",
      status: "open",
      occurredAt: null,
      description: "queue test incident",
      resolutionSummary: null,
      resolvedAt: null,
      resolvedBy: null,
      reportedBy: "admin-1",
      version: 1,
      createdAt: "2025-01-15T10:00:00Z",
      updatedAt: "2025-01-15T10:00:00Z",
    },
    examSummary: { id: "exam-1", title: "网络恢复考试", status: "open" },
    primaryAttempt: {
      id: "attempt-1",
      candidateId: "cand-1",
      status: "disrupted",
      deadlineAt: "2025-01-15T11:00:00Z",
    },
    primaryCandidate: { id: "cand-1", displayName: "考生张三" },
    linkedAttemptCount: 1,
    linkedCandidateCount: 1,
    activeProctors: [{ userId: "proctor-1", displayName: "监考李四" }],
    ...overrides,
  };
}

const mockQueueData: RecoveryQueueResponse = {
  items: [makeItem()],
  nextCursor: null,
};

function renderPage(initialEntries = ["/admin/recovery"]) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
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
              path="/admin/recovery"
              element={
                <>
                  <LocationProbe />
                  <RecoveryQueuePage />
                </>
              }
            />
            <Route
              path="/admin/recovery/incidents/:incidentId"
              element={
                <>
                  <LocationProbe />
                  <div data-testid="incident-detail-stub" />
                </>
              }
            />
          </Routes>
        </BrandProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("RecoveryQueuePage", () => {
  beforeEach(() => {
    getMock.mockReset();
    getMock.mockResolvedValue(mockQueueData);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the queue table with server fields", async () => {
    renderPage();
    const table = await screen.findByTestId("recovery-queue-table");
    expect(within(table).getByText("网络恢复考试")).toBeInTheDocument();
    expect(within(table).getByText("考生张三")).toBeInTheDocument();
    expect(within(table).getByText("严重")).toBeInTheDocument();
    expect(within(table).getByText("监考李四")).toBeInTheDocument();
    // Incident status renders through StatusBadge (statusMeta authority).
    expect(within(table).getByText("待处理")).toBeInTheDocument();
    expect(within(table).getByText("1 条关联")).toBeInTheDocument();
  });

  it("shows loading state then data", async () => {
    renderPage();
    expect(screen.getByText("加载中...")).toBeInTheDocument();
    expect(await screen.findAllByText("网络恢复考试")).toHaveLength(2);
  });

  it("shows empty state when no incidents match", async () => {
    getMock.mockResolvedValue({ items: [], nextCursor: null });
    renderPage();
    expect(await screen.findByText("暂无中断事件")).toBeInTheDocument();
  });

  it("shows error state on fetch failure and retry refetches", async () => {
    getMock.mockRejectedValueOnce(new Error("Network error"));
    renderPage();
    expect(await screen.findByText("加载恢复队列失败")).toBeInTheDocument();

    getMock.mockResolvedValue(mockQueueData);
    await userEvent.setup().click(screen.getByText("重试"));
    expect(await screen.findAllByText("网络恢复考试")).toHaveLength(2);
  });

  it("sends URL filters as server query params on load", async () => {
    renderPage(["/admin/recovery?status=open&severity=major"]);
    await screen.findAllByText("网络恢复考试");
    const lastCall = getMock.mock.calls.at(-1)?.[0] as string;
    expect(lastCall).toContain("/api/admin/recovery/incidents?");
    expect(lastCall).toContain("status=open");
    expect(lastCall).toContain("severity=major");
  });

  it("changing a filter updates the URL and refetches page 1", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findAllByText("网络恢复考试");

    const trigger = screen.getByRole("combobox", { name: "全部状态" });
    await user.click(trigger);
    await user.click(await screen.findByRole("option", { name: "调查中" }));

    expect(screen.getByTestId("location-search")).toHaveTextContent(
      "status=investigating",
    );
    const lastCall = getMock.mock.calls.at(-1)?.[0] as string;
    expect(lastCall).toContain("status=investigating");
  });

  it("clearing filters resets the URL and refetches", async () => {
    const user = userEvent.setup();
    renderPage(["/admin/recovery?status=open"]);
    await screen.findAllByText("网络恢复考试");

    await user.click(screen.getByText("清除筛选"));
    expect(screen.getByTestId("location-search")).not.toHaveTextContent(
      "status=",
    );
    const lastCall = getMock.mock.calls.at(-1)?.[0] as string;
    expect(lastCall).not.toContain("status=");
  });

  it("row click navigates to the incident detail route", async () => {
    const user = userEvent.setup();
    renderPage();
    const table = await screen.findByTestId("recovery-queue-table");
    const row = within(table).getByText("网络恢复考试").closest("tr");
    expect(row).toBeTruthy();
    await user.click(row!);
    expect(screen.getByTestId("incident-detail-stub")).toBeInTheDocument();
  });

  it("load more appends the cursor page (cursor stays in component state, not URL)", async () => {
    const user = userEvent.setup();
    getMock.mockResolvedValueOnce({
      items: [makeItem()],
      nextCursor: "cursor-1",
    });
    getMock.mockResolvedValueOnce({
      items: [
        makeItem({
          examSummary: { id: "exam-2", title: "第二页考试", status: "open" },
        }),
      ],
      nextCursor: null,
    });
    renderPage();
    const table = await screen.findByTestId("recovery-queue-table");
    expect(within(table).getByText("网络恢复考试")).toBeInTheDocument();

    await user.click(screen.getByText("加载更多"));
    expect(await within(table).findByText("第二页考试")).toBeInTheDocument();
    // The cursor page went through a query param, but the URL never carries it.
    expect(screen.getByTestId("location-search")).not.toHaveTextContent(
      "cursor=",
    );
    const lastCall = getMock.mock.calls.at(-1)?.[0] as string;
    expect(lastCall).toContain("cursor=cursor-1");
  });

  it("poll tick refetches page 1 and resets accumulated pages", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    getMock.mockResolvedValueOnce({
      items: [makeItem()],
      nextCursor: "cursor-1",
    });
    getMock.mockResolvedValueOnce({
      items: [
        makeItem({
          examSummary: { id: "exam-2", title: "第二页考试", status: "open" },
        }),
      ],
      nextCursor: null,
    });
    getMock.mockResolvedValueOnce({
      items: [
        makeItem({
          examSummary: { id: "exam-3", title: "刷新后考试", status: "open" },
        }),
      ],
      nextCursor: null,
    });
    renderPage();
    await act(async () => {});
    const table = screen.getByTestId("recovery-queue-table");
    expect(within(table).getByText("网络恢复考试")).toBeInTheDocument();

    // Load page 2, then a poll refresh must REPLACE the chain with page 1.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    fireEvent.click(screen.getByText("加载更多"));
    await act(async () => {});
    expect(within(table).getByText("第二页考试")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(within(table).getByText("刷新后考试")).toBeInTheDocument();
    expect(within(table).queryByText("第二页考试")).not.toBeInTheDocument();
  });

  it("hidden tab skips poll ticks; re-visibility triggers an immediate refresh", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    getMock.mockResolvedValue(mockQueueData);
    renderPage();
    await act(async () => {});
    expect(getMock).toHaveBeenCalledTimes(1);

    // Tab hidden → interval ticks are dropped.
    const visibilityStateSpy = vi.spyOn(document, "visibilityState", "get");
    visibilityStateSpy.mockReturnValue("hidden" as DocumentVisibilityState);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(getMock).toHaveBeenCalledTimes(1);

    // Re-visible → immediate refresh (focus event).
    visibilityStateSpy.mockReturnValue("visible" as DocumentVisibilityState);
    await act(async () => {
      fireEvent(window, new Event("focus"));
    });
    expect(getMock).toHaveBeenCalledTimes(2);
    visibilityStateSpy.mockRestore();
  });

  it("single-flight: a poll tick while a request is in flight is dropped", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    let resolveFirst: (value: RecoveryQueueResponse) => void = () => {};
    getMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFirst = resolve;
      }),
    );
    getMock.mockResolvedValueOnce(mockQueueData);
    renderPage();

    // First request is still in flight — the 30s tick must NOT start another.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(getMock).toHaveBeenCalledTimes(1);

    // Resolve the in-flight request; the next tick (no in-flight) refetches.
    await act(async () => {
      resolveFirst(mockQueueData);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(getMock).toHaveBeenCalledTimes(2);
  });
});
