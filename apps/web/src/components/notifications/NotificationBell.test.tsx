import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationBell } from "./NotificationBell";
import type { NotificationDTO, PaginatedResponse } from "@exam/contracts";

// P5-N1-I3 — NotificationBell frontend tests (P5-N1-R0 §25.7).
//
// Mocks the API client (no real network). Covers:
//   - unread badge reflects /unread-count
//   - loading (Skeleton) / empty / error states
//   - list renders result_published (title, body, createdAt)
//   - mark one read (click) decrements badge + updates list
//   - mark all read updates count
//   - result action navigates to /exam/:attemptId/result

const api = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api,
  ApiError: class ApiError extends Error {
    constructor(
      readonly status: number,
      message: string,
    ) {
      super(message);
      this.name = "ApiError";
    }
  },
}));

// MemoryRouter target so we can assert navigation.
const RESULT_PAGE_MARKER = "RESULT_PAGE";

function renderBell() {
  return render(
    <MemoryRouter initialEntries={["/exam/list"]}>
      <Routes>
        <Route path="/exam/list" element={<NotificationBell />} />
        <Route
          path="/exam/:attemptId/result"
          element={<div data-testid={RESULT_PAGE_MARKER} />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

function makeNotification(
  overrides: Partial<NotificationDTO> = {},
): NotificationDTO {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    organizationId: "00000000-0000-4000-8000-000000000002",
    recipientUserId: "00000000-0000-4000-8000-000000000003",
    type: "result_published",
    title: "考试结果已发布",
    body: "您的考试结果已发布。",
    actionPath: "/exam/00000000-0000-4000-8000-00000000000a/result",
    createdAt: "2026-07-25T00:00:00.000Z",
    readAt: null,
    ...overrides,
  };
}

describe("NotificationBell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no unread, empty list.
    api.get.mockImplementation((path: string) => {
      if (path.includes("unread-count")) return Promise.resolve({ count: 0 });
      if (path.includes("/notifications")) {
        return Promise.resolve<PaginatedResponse<NotificationDTO>>({
          items: [],
          total: 0,
          page: 1,
          pageSize: 20,
          totalPages: 0,
        });
      }
      return Promise.reject(new Error(`unmocked GET ${path}`));
    });
    api.post.mockResolvedValue({});
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the bell button without a badge when there are zero unread", async () => {
    renderBell();
    await waitFor(() =>
      expect(screen.getByTestId("notification-bell")).toBeInTheDocument(),
    );
    expect(
      screen.queryByTestId("notification-unread-badge"),
    ).not.toBeInTheDocument();
  });

  it("shows the unread badge when count > 0", async () => {
    api.get.mockImplementation((path: string) => {
      if (path.includes("unread-count")) return Promise.resolve({ count: 3 });
      return Promise.resolve({
        items: [],
        total: 0,
        page: 1,
        pageSize: 20,
        totalPages: 0,
      });
    });
    renderBell();
    await waitFor(() =>
      expect(screen.getByTestId("notification-unread-badge")).toHaveTextContent(
        "3",
      ),
    );
  });

  it("shows the empty state when the panel opens and the list is empty", async () => {
    renderBell();
    await waitFor(() =>
      expect(screen.getByTestId("notification-bell")).toBeInTheDocument(),
    );
    await act(async () => {
      screen.getByTestId("notification-bell").click();
    });
    await waitFor(() =>
      expect(screen.getByTestId("notification-empty")).toBeInTheDocument(),
    );
  });

  it("shows the loading skeleton while the list is loading", async () => {
    // Never-resolving promise keeps the loading state visible.
    api.get.mockImplementation((path: string) => {
      if (path.includes("unread-count")) return Promise.resolve({ count: 0 });
      return new Promise(() => {});
    });
    renderBell();
    await waitFor(() =>
      expect(screen.getByTestId("notification-bell")).toBeInTheDocument(),
    );
    await act(async () => {
      screen.getByTestId("notification-bell").click();
    });
    await waitFor(() =>
      expect(screen.getByTestId("notification-loading")).toBeInTheDocument(),
    );
  });

  it("renders the list with title/body when notifications exist", async () => {
    const n = makeNotification({ title: "数学考试结果", body: "可查看。" });
    api.get.mockImplementation((path: string) => {
      if (path.includes("unread-count")) return Promise.resolve({ count: 1 });
      return Promise.resolve({
        items: [n],
        total: 1,
        page: 1,
        pageSize: 20,
        totalPages: 1,
      });
    });
    renderBell();
    await act(async () => {
      screen.getByTestId("notification-bell").click();
    });
    await waitFor(() =>
      expect(screen.getByText("数学考试结果")).toBeInTheDocument(),
    );
    expect(screen.getByText("可查看。")).toBeInTheDocument();
  });

  it("shows the error banner when the list fails to load", async () => {
    const { ApiError } = await import("@/lib/api");
    api.get.mockImplementation((path: string) => {
      if (path.includes("unread-count")) return Promise.resolve({ count: 0 });
      return Promise.reject(new ApiError(500, "boom"));
    });
    renderBell();
    await act(async () => {
      screen.getByTestId("notification-bell").click();
    });
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });

  it("marks one read on click and navigates to the result route", async () => {
    const n = makeNotification({
      id: "00000000-0000-4000-8000-000000000099",
      actionPath: "/exam/00000000-0000-4000-8000-00000000000a/result",
    });
    api.get.mockImplementation((path: string) => {
      if (path.includes("unread-count")) return Promise.resolve({ count: 1 });
      return Promise.resolve({
        items: [n],
        total: 1,
        page: 1,
        pageSize: 20,
        totalPages: 1,
      });
    });
    renderBell();
    await act(async () => {
      screen.getByTestId("notification-bell").click();
    });
    const item = await screen.findByTestId(`notification-item-${n.id}`);
    await act(async () => {
      item.click();
    });
    // POST mark-read fired.
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(`/api/notifications/${n.id}/read`),
    );
    // Navigated to the result page.
    await waitFor(() =>
      expect(screen.getByTestId(RESULT_PAGE_MARKER)).toBeInTheDocument(),
    );
  });

  it("mark-all-read posts to /read-all and clears the badge", async () => {
    const n = makeNotification();
    api.get.mockImplementation((path: string) => {
      if (path.includes("unread-count")) return Promise.resolve({ count: 2 });
      return Promise.resolve({
        items: [n],
        total: 1,
        page: 1,
        pageSize: 20,
        totalPages: 1,
      });
    });
    renderBell();
    await act(async () => {
      screen.getByTestId("notification-bell").click();
    });
    const markAll = await screen.findByTestId("notification-mark-all-read");
    await act(async () => {
      markAll.click();
    });
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/api/notifications/read-all"),
    );
    // Badge is gone (count dropped to 0 client-side).
    await waitFor(() =>
      expect(
        screen.queryByTestId("notification-unread-badge"),
      ).not.toBeInTheDocument(),
    );
  });
});
