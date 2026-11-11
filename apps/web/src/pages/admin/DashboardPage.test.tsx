import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "@/contexts/AuthContext";
import { BrandProvider } from "@/components/layout/BrandProvider";
import { DashboardPage } from "./DashboardPage";
import { permissionsForRole } from "@exam/authz";

const { apiGet } = vi.hoisted(() => ({
  apiGet: vi.fn(),
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
  },
  setNavigate: () => {},
}));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/admin/dashboard"]}>
      <AuthProvider
        initialUser={{
          id: "1",
          username: "admin",
          name: "Admin",
          role: "Admin",
          organizationId: "org1",
          capabilities: [...permissionsForRole("Admin")],
        }}
      >
        <BrandProvider>
          <Routes>
            <Route path="/admin/dashboard" element={<DashboardPage />} />
            <Route path="/admin/exams/new" element={<div>create exam</div>} />
          </Routes>
        </BrandProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

const mockDashboardData = {
  totalQuestions: 120,
  activeExams: 3,
  totalCandidates: 45,
  todayExams: 2,
  recentExams: [
    {
      id: "exam-1",
      title: "期中考试",
      status: "open",
      participantCount: 20,
    },
    {
      id: "exam-2",
      title: "模拟测试",
      status: "draft",
      participantCount: 0,
    },
    {
      id: "exam-3",
      title: "结业考试",
      status: "closed",
      participantCount: 35,
    },
  ],
};

describe("DashboardPage", () => {
  beforeEach(() => {
    apiGet.mockReset();
  });

  describe("loading state", () => {
    it("shows skeleton while loading", () => {
      apiGet.mockReturnValue(new Promise(() => {}));
      renderPage();
      expect(
        document.querySelector("[data-slot='skeleton']"),
      ).toBeInTheDocument();
    });
  });

  describe("stats cards", () => {
    beforeEach(() => {
      apiGet.mockResolvedValue(mockDashboardData);
    });

    it("renders 4 stat cards with correct labels and values", async () => {
      renderPage();
      expect(await screen.findByText("题目总数")).toBeInTheDocument();
      expect(screen.getByText("120")).toBeInTheDocument();
      expect(screen.getByText("考试进行中")).toBeInTheDocument();
      expect(screen.getByText("3")).toBeInTheDocument();
      expect(screen.getByText("考生总数")).toBeInTheDocument();
      expect(screen.getByText("45")).toBeInTheDocument();
      // R0-F7: the value is today's started-attempt count (人次, retakes
      // included) — the repo counts examAttempts rows with startedAt >=
      // startOfDay — so the label must state the 人次 unit instead of an
      // exam count (「今日考试」).
      expect(screen.getByText("今日开考人次")).toBeInTheDocument();
      expect(screen.queryByText("今日考试")).not.toBeInTheDocument();
      expect(screen.getByText("2")).toBeInTheDocument();
    });
  });

  describe("status badges", () => {
    beforeEach(() => {
      apiGet.mockResolvedValue(mockDashboardData);
    });

    it("renders status badges with centralized tones for each status", async () => {
      renderPage();
      // Badges render twice by design (desktop table + mobile cards);
      // scope to the desktop table representation.
      const table = await screen.findByRole("table");
      const openBadge = within(table).getByText("开放中");
      expect(openBadge).toHaveAttribute("data-status-tone", "success");

      const draftBadge = within(table).getByText("草稿");
      expect(draftBadge).toHaveAttribute("data-status-tone", "muted");

      const closedBadge = within(table).getByText("已关闭");
      expect(closedBadge).toHaveAttribute("data-status-tone", "secondary");
    });
  });

  describe("quick actions", () => {
    beforeEach(() => {
      apiGet.mockResolvedValue(mockDashboardData);
    });

    it("renders quick action buttons for creating exam and importing questions", async () => {
      renderPage();
      await screen.findByRole("table");

      expect(
        screen.getByRole("button", { name: "创建考试" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "导入题目" }),
      ).toBeInTheDocument();
    });

    it("navigates to exam creation on create button click", async () => {
      renderPage();
      await screen.findByRole("table");

      const user = userEvent.setup();
      const createBtn = screen.getByRole("button", { name: "创建考试" });
      await user.click(createBtn);
      // navigation unmounts the component — button is no longer in DOM
      expect(
        screen.queryByRole("button", { name: "创建考试" }),
      ).not.toBeInTheDocument();
    });
  });

  describe("recent exams table", () => {
    it("renders recent exams with title, status, and participant count", async () => {
      apiGet.mockResolvedValue(mockDashboardData);
      renderPage();
      const table = await screen.findByRole("table");
      expect(within(table).getByText("期中考试")).toBeInTheDocument();
      expect(within(table).getByText("模拟测试")).toBeInTheDocument();
      expect(within(table).getByText("结业考试")).toBeInTheDocument();
      expect(within(table).getByText("20")).toBeInTheDocument();
      expect(within(table).getByText("0")).toBeInTheDocument();
      expect(within(table).getByText("35")).toBeInTheDocument();
    });

    it("renders view button for each exam", async () => {
      apiGet.mockResolvedValue(mockDashboardData);
      renderPage();
      const table = await screen.findByRole("table");
      const viewButtons = within(table).getAllByRole("button", {
        name: /查看考试/,
      });
      expect(viewButtons).toHaveLength(3);
    });

    // Characterization (UI-MIGRATE-N-W3): the "近期考试" heading names the
    // recent-exams content section. It must remain present and continue to
    // label the table block after the section-title typography migration.
    // Asserts the durable role, not the raw typography class.
    it("keeps the 近期考试 section title naming the recent-exams block", async () => {
      apiGet.mockResolvedValue(mockDashboardData);
      renderPage();
      const title = await screen.findByText("近期考试");
      expect(title).toBeInTheDocument();
      // The title sits inside the surface-content container for the recent-exams table.
      const card = title.closest(".surface-content");
      expect(card).toBeInTheDocument();
      expect(card).toHaveTextContent("期中考试");
    });
  });

  describe("empty state", () => {
    it("shows empty state when no recent exams", async () => {
      apiGet.mockResolvedValue({
        totalQuestions: 0,
        activeExams: 0,
        totalCandidates: 0,
        todayExams: 0,
        recentExams: [],
      });
      renderPage();
      // The empty fact renders in both representations (desktop EmptyState
      // hidden below lg, mobile empty card hidden at lg+).
      const empties = await screen.findAllByText("暂无考试");
      expect(empties.length).toBeGreaterThanOrEqual(1);
      // 零值 (S6.4): the stats cards render the numeric 0 — including the
      // today stat — instead of blank or a placeholder.
      expect(await screen.findByText("今日开考人次")).toBeInTheDocument();
      expect(screen.getAllByText("0").length).toBeGreaterThanOrEqual(4);
    });
  });

  describe("error state", () => {
    it("shows error message when dashboard load fails", async () => {
      apiGet.mockRejectedValue(new Error("network error"));
      renderPage();
      expect(await screen.findByText("加载仪表盘数据失败")).toBeInTheDocument();
    });

    it("shows retry button on error", async () => {
      apiGet.mockRejectedValue(new Error("network error"));
      renderPage();
      expect(await screen.findByText("重试")).toBeInTheDocument();
    });
  });

  // ── #784 B3 — actionable todo section ────────────────────────

  /** Per-URL API routing so each todo source can be controlled independently. */
  function mockApiRouting(sources: {
    dashboard?: unknown;
    grading?: unknown;
    incidents?: unknown;
    dashboardError?: Error;
    gradingError?: Error;
    incidentsError?: Error;
  }) {
    apiGet.mockImplementation(async (path: string) => {
      if (path.startsWith("/api/system/dashboard")) {
        if (sources.dashboardError) throw sources.dashboardError;
        return sources.dashboard ?? mockDashboardData;
      }
      if (path.startsWith("/api/admin/grading-queue")) {
        if (sources.gradingError) throw sources.gradingError;
        return sources.grading ?? { items: [], total: 0, page: 1, pageSize: 1 };
      }
      if (path.startsWith("/api/admin/recovery/incidents")) {
        if (sources.incidentsError) throw sources.incidentsError;
        return (
          sources.incidents ?? {
            items: [],
            nextCursor: null,
            snapshotAt: "2025-01-01T00:00:00Z",
          }
        );
      }
      throw new Error(`unexpected api path: ${path}`);
    });
  }

  async function todoCard(label: string): Promise<HTMLElement> {
    // The whole page stays on the dashboard skeleton until the summary source
    // resolves, so the card labels only exist after that gate.
    const heading = await screen.findByText(label);
    const card = heading.closest("[data-slot='admin-todo-card']");
    if (!(card instanceof HTMLElement)) {
      throw new Error(`todo card ${label} not rendered`);
    }
    return card;
  }

  describe("todo section", () => {
    it("requests the bounded authoritative reads (pageSize=1 / unresolvedOnly&limit=20)", async () => {
      mockApiRouting({});
      renderPage();
      await screen.findByText("需要处理");
      const gradingCalls = apiGet.mock.calls
        .map((c) => String(c[0]))
        .filter((p) => p.startsWith("/api/admin/grading-queue"));
      expect(gradingCalls).toEqual([
        "/api/admin/grading-queue?page=1&pageSize=1",
      ]);
      const incidentCalls = apiGet.mock.calls
        .map((c) => String(c[0]))
        .filter((p) => p.startsWith("/api/admin/recovery/incidents"));
      expect(incidentCalls).toEqual([
        "/api/admin/recovery/incidents?unresolvedOnly=true&limit=20",
      ]);
    });

    it("renders the grading card from the authoritative total and the incident card from the keyset page", async () => {
      mockApiRouting({
        grading: { items: [], total: 25, page: 1, pageSize: 1 },
        incidents: {
          items: [{}, {}],
          nextCursor: null,
          snapshotAt: "2025-01-01T00:00:00Z",
        },
      });
      renderPage();
      const grading = await todoCard("待人工评分");
      await within(grading).findByText("25");
      expect(within(grading).getByText("份答卷")).toBeInTheDocument();

      const incidents = await todoCard("待处理异常");
      await within(incidents).findByText("2");
      expect(within(incidents).getByText("条事件")).toBeInTheDocument();
    });

    it("shows the >20 lower bound when the incident page has a next cursor", async () => {
      mockApiRouting({
        incidents: {
          items: Array.from({ length: 20 }),
          nextCursor: "cursor",
          snapshotAt: "2025-01-01T00:00:00Z",
        },
      });
      renderPage();
      const incidents = await todoCard("待处理异常");
      await within(incidents).findByText(">20");
      // A full first page must never be presented as the exact total.
      expect(within(incidents).queryByText("20")).not.toBeInTheDocument();
    });

    it("renders verified zero only from fulfilled sources", async () => {
      mockApiRouting({
        grading: { items: [], total: 0, page: 1, pageSize: 1 },
        incidents: {
          items: [],
          nextCursor: null,
          snapshotAt: "2025-01-01T00:00:00Z",
        },
      });
      renderPage();
      const grading = await todoCard("待人工评分");
      await within(grading).findByText("0");
      expect(within(grading).getByText("暂无待评分答卷")).toBeInTheDocument();
      const incidents = await todoCard("待处理异常");
      await within(incidents).findByText("0");
      expect(within(incidents).getByText("暂无未处理异常")).toBeInTheDocument();
    });

    it("a failed grading source never renders a fake zero and keeps the incident card intact (B05/B06)", async () => {
      mockApiRouting({
        gradingError: new Error("500"),
        incidents: {
          items: [{}, {}],
          nextCursor: null,
          snapshotAt: "2025-01-01T00:00:00Z",
        },
      });
      renderPage();
      const grading = await todoCard("待人工评分");
      await within(grading).findByText("无法获取");
      expect(
        within(grading).getByRole("button", { name: "重试" }),
      ).toBeEnabled();
      expect(within(grading).queryByText("0")).not.toBeInTheDocument();

      const incidents = await todoCard("待处理异常");
      await within(incidents).findByText("2");
      expect(within(incidents).queryByText("无法获取")).not.toBeInTheDocument();
    });

    it("a failed incident source leaves the grading card untouched (B06, reverse direction)", async () => {
      mockApiRouting({
        grading: { items: [], total: 7, page: 1, pageSize: 1 },
        incidentsError: new Error("500"),
      });
      renderPage();
      const grading = await todoCard("待人工评分");
      await within(grading).findByText("7");
      const incidents = await todoCard("待处理异常");
      await within(incidents).findByText("无法获取");
      expect(within(incidents).queryByText("0")).not.toBeInTheDocument();
    });

    it("hides the grading card without GradingQueueView and the incident card without IncidentRecoveryView", async () => {
      apiGet.mockImplementation(async () => mockDashboardData);
      render(
        <MemoryRouter initialEntries={["/admin/dashboard"]}>
          <AuthProvider
            initialUser={{
              id: "1",
              username: "admin",
              name: "Admin",
              role: "Admin",
              organizationId: "org1",
              capabilities: permissionsForRole("Admin").filter(
                (p) =>
                  p !== "grading.queue.view" && p !== "incident.recovery.view",
              ),
            }}
          >
            <BrandProvider>
              <Routes>
                <Route path="/admin/dashboard" element={<DashboardPage />} />
              </Routes>
            </BrandProvider>
          </AuthProvider>
        </MemoryRouter>,
      );
      await screen.findByText("题目总数");
      expect(screen.queryByText("需要处理")).not.toBeInTheDocument();
      expect(screen.queryByText("待人工评分")).not.toBeInTheDocument();
      expect(screen.queryByText("待处理异常")).not.toBeInTheDocument();
      // A capability-hidden card must not fire its request at all — no
      // guaranteed 403 behind a hidden surface.
      const todoCalls = apiGet.mock.calls
        .map((c) => String(c[0]))
        .filter(
          (p) =>
            p.startsWith("/api/admin/grading-queue") ||
            p.startsWith("/api/admin/recovery/incidents"),
        );
      expect(todoCalls).toEqual([]);
    });

    it("keeps the four stats cards, quick actions and recent exams alongside the todo section (B10)", async () => {
      mockApiRouting({});
      renderPage();
      await screen.findByText("需要处理");
      expect(screen.getByText("题目总数")).toBeInTheDocument();
      expect(screen.getByText("考生总数")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "创建考试" }),
      ).toBeInTheDocument();
      expect(screen.getByText("近期考试")).toBeInTheDocument();
    });
  });

  // PageHeader actions slot + section order todo → stats → recent exams.
  // The order IS the behavioral contract; pinned with document position,
  // not visual inspection (#932).
  describe("dashboard ordering and actions slot", () => {
    beforeEach(() => {
      mockApiRouting({});
    });

    it("renders quick actions inside the PageHeader actions slot", async () => {
      renderPage();
      await screen.findByText("需要处理");
      const header = document.querySelector("header");
      expect(header).not.toBeNull();
      expect(
        within(header as HTMLElement).getByRole("button", {
          name: "创建考试",
        }),
      ).toBeInTheDocument();
      expect(
        within(header as HTMLElement).getByRole("button", {
          name: "导入题目",
        }),
      ).toBeInTheDocument();
    });

    it("orders sections todo → 资产概览 → 近期考试", async () => {
      renderPage();
      await screen.findByText("需要处理");
      const todo = document.getElementById("admin-todo-heading");
      const stats = document.getElementById("admin-stats-heading");
      const shell = document.querySelector("[data-slot='admin-table-shell']");
      expect(todo).not.toBeNull();
      expect(stats).not.toBeNull();
      expect(shell).not.toBeNull();
      expect(
        todo!.compareDocumentPosition(stats!) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(
        stats!.compareDocumentPosition(shell!) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(screen.getByText("资产概览")).toBeInTheDocument();
    });
  });
});
