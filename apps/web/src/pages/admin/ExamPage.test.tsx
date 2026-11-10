import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, afterEach } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import { AuthProvider } from "@/contexts/AuthContext";
import { BrandProvider } from "@/components/layout/BrandProvider";
import { ExamPage } from "./ExamPage";
import { permissionsForRole } from "@exam/authz";

const { apiGet, apiDelete } = vi.hoisted(() => ({
  apiGet: vi.fn().mockResolvedValue({
    items: [
      {
        id: "draft-exam",
        title: "Draft Exam",
        status: "draft",
        openAt: new Date().toISOString(),
        closeAt: new Date(Date.now() + 3600000).toISOString(),
        durationMinutes: 60,
        passingScore: 60,
        totalScore: 100,
        questionIds: ["q1"],
        participantCount: 0,
        canDelete: true,
        deleteDisabledReason: null,
      },
      {
        id: "published-exam",
        title: "Published Exam",
        status: "published",
        openAt: new Date().toISOString(),
        closeAt: new Date(Date.now() + 3600000).toISOString(),
        durationMinutes: 60,
        passingScore: 60,
        totalScore: 100,
        questionIds: ["q1"],
        participantCount: 2,
        canDelete: false,
        deleteDisabledReason: "仅草稿状态的考试允许删除",
      },
    ],
    total: 2,
    page: 1,
    pageSize: 20,
    totalPages: 1,
  }),
  apiDelete: vi.fn(),
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
    delete: (...args: unknown[]) => apiDelete(...args),
  },
  setNavigate: () => {},
}));

function renderPage(role: "Admin" | "Teacher" = "Admin") {
  return render(
    <MemoryRouter initialEntries={["/admin/exams"]}>
      <AuthProvider
        initialUser={{
          id: "1",
          username: "admin",
          name: "Admin",
          role,
          organizationId: "org1",
          capabilities: [...permissionsForRole(role)],
        }}
      >
        <BrandProvider>
          <Routes>
            <Route path="/admin/exams" element={<ExamPage />} />
          </Routes>
        </BrandProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("ExamPage", () => {
  it("shows Teacher create access without rendering Admin-only delete actions", async () => {
    renderPage("Teacher");

    expect(
      await screen.findByRole("button", { name: "创建考试" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "删除考试" }),
    ).not.toBeInTheDocument();
  });

  it("shows delete only as enabled for draft exams", async () => {
    renderPage();

    expect(await screen.findByText("考试管理")).toBeInTheDocument();

    // Row actions render twice by design (desktop table + mobile cards);
    // scope to the desktop table representation.
    const table = await screen.findByRole("table");
    const deleteButtons = await within(table).findAllByRole("button", {
      name: "删除考试",
    });
    expect(deleteButtons).toHaveLength(2);
    expect(deleteButtons[0]).toBeEnabled();
    expect(deleteButtons[1]).toBeDisabled();
  });

  it("renders through the shared list-page template", async () => {
    renderPage();

    const heading = await screen.findByRole("heading", { name: "考试列表" });
    const shell = heading.closest('[data-slot="admin-table-shell"]');

    expect(shell).toBeInTheDocument();
    // The footer's range line is the single count authority (#785) — the
    // loaded-row summary line is gone.
    expect(shell).toHaveTextContent("共 2 条");
    expect(shell).not.toHaveTextContent("共 2 场考试");
    // The status filter lives in the shell's toolbar band.
    expect(
      screen.getByRole("toolbar", { name: "考试列表工具栏" }),
    ).toBeInTheDocument();
  });

  it("declares fixed-capacity duration, score, date and action columns", async () => {
    renderPage();

    // Non-compressible columns are a desktop-table declaration; scope to it
    // (row content also renders in the mobile card list).
    const table = await screen.findByRole("table");
    const duration = within(table).getAllByText("60分钟");
    // R0-F5: the score column uses the unified passing-requirement
    // vocabulary with an explicit unit — threshold/full-marks + 分.
    expect(
      within(table)
        .getAllByText("及格要求")
        .some((el) => el.tagName === "TH"),
    ).toBe(true);
    const score = within(table).getAllByText("60/100 分");
    const deleteButtons = within(table).getAllByRole("button", {
      name: "删除考试",
    });

    expect(duration[0]?.closest("td")).toHaveAttribute(
      "data-column-role",
      "duration",
    );
    expect(duration[0]?.closest("td")).toHaveAttribute(
      "data-column-overflow",
      "nowrap",
    );
    expect(score[0]?.closest("td")).toHaveAttribute(
      "data-column-role",
      "score",
    );
    expect(
      document.querySelector('col[data-column-role="date-range"]'),
    ).toBeInTheDocument();
    expect(
      document.querySelector('col[data-column-role="actions"]'),
    ).toBeInTheDocument();
    expect(deleteButtons[0]).toHaveAttribute("data-action-id", "delete");
  });
});

/**
 * #785 BDD acceptance — L2 (component level; mocked API with the REAL
 * paginated response shape). Scenario source:
 * docs/design/admin-list-pagination-bdd.md (B01/B06/B08).
 */
describe("ExamPage #785 pagination and status filter (BDD L2)", () => {
  const hoistedDefault = apiGet.getMockImplementation();

  afterEach(() => {
    apiGet.mockReset();
    if (hoistedDefault) apiGet.mockImplementation(hoistedDefault);
  });

  function examRow(id: string, title: string, overrides = {}) {
    return {
      id,
      title,
      status: "draft",
      openAt: new Date().toISOString(),
      closeAt: new Date(Date.now() + 3_600_000).toISOString(),
      durationMinutes: 60,
      passingScore: 60,
      totalScore: 100,
      questionIds: ["q1"],
      participantCount: 0,
      canDelete: true,
      deleteDisabledReason: null,
      ...overrides,
    };
  }

  /** Serves /api/exams with real pagination shapes from a page → items map. */
  function mockExamPages(
    pagesByNumber: Record<number, ReturnType<typeof examRow>[]>,
    total: number,
  ) {
    apiGet.mockImplementation(async (url: string) => {
      if (url.startsWith("/api/exams")) {
        const params = new URLSearchParams(url.split("?")[1] ?? "");
        const page = Number(params.get("page") ?? "1");
        const items = pagesByNumber[page] ?? [];
        return {
          items,
          total,
          page,
          pageSize: 20,
          totalPages: Math.max(1, Math.ceil(total / 20)),
        };
      }
      throw new Error(`unexpected GET ${url}`);
    });
  }

  it("B01: the 21st exam is reachable through real pagination and the total is 21", async () => {
    const user = userEvent.setup();
    const page1 = Array.from({ length: 20 }, (_, i) =>
      examRow(`e${i + 1}`, `旧考试 ${i + 1}`),
    );
    const page2 = [examRow("e21", "新考试 21")];
    mockExamPages({ 1: page1, 2: page2 }, 21);

    renderPage();
    const table = await screen.findByRole("table");
    expect(within(table).getByText("旧考试 1")).toBeInTheDocument();
    expect(within(table).queryByText("新考试 21")).not.toBeInTheDocument();
    // The footer states the REAL total, not the loaded-row count.
    expect(screen.getByText(/共 21 条/)).toBeInTheDocument();
    expect(apiGet).toHaveBeenCalledWith("/api/exams?page=1&pageSize=20");

    await user.click(screen.getByRole("button", { name: "下一页" }));
    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledWith("/api/exams?page=2&pageSize=20");
    });
    // The table element already exists from page 1; sync on the row that only
    // the page-2 response can render.
    expect(
      await within(await screen.findByRole("table")).findByText("新考试 21"),
    ).toBeInTheDocument();
  });

  it("B06: choosing a status filter queries the server set and resets to page 1", async () => {
    const user = userEvent.setup();
    const page1 = Array.from({ length: 20 }, (_, i) =>
      examRow(`e${i + 1}`, `草稿考试 ${i + 1}`),
    );
    apiGet.mockImplementation(async (url: string) => {
      const params = new URLSearchParams(url.split("?")[1] ?? "");
      const statuses = params.get("statuses");
      const page = Number(params.get("page") ?? "1");
      if (statuses === "published") {
        return {
          items: [
            examRow("p1", "已发布考试", {
              status: "published",
              canDelete: false,
            }),
          ],
          total: 1,
          page,
          pageSize: 20,
          totalPages: 1,
        };
      }
      return {
        items: page === 1 ? page1 : [examRow("e21", "草稿考试 21")],
        total: 21,
        page,
        pageSize: 20,
        totalPages: 2,
      };
    });

    renderPage();
    await screen.findByRole("table");
    // Navigate to page 2 first: changing the filter must reset to page 1.
    await user.click(screen.getByRole("button", { name: "下一页" }));
    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledWith("/api/exams?page=2&pageSize=20");
    });

    await user.click(screen.getByRole("combobox", { name: "按状态筛选" }));
    await user.click(await screen.findByRole("option", { name: "已发布" }));

    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledWith(
        "/api/exams?page=1&pageSize=20&statuses=published",
      );
    });
    expect(
      await within(await screen.findByRole("table")).findByText("已发布考试"),
    ).toBeInTheDocument();
  });

  it("B08: a stale response must not overwrite a newer page's data (request race)", async () => {
    const user = userEvent.setup();
    type Deferred = { url: string; resolve: (value: unknown) => void };
    const pending: Deferred[] = [];
    apiGet.mockImplementation(
      (url: string) =>
        new Promise((resolve) => {
          pending.push({ url, resolve });
        }),
    );

    renderPage();
    // Initial page-1 request is pending.
    expect(pending).toHaveLength(1);
    pending.shift()!.resolve({
      items: [examRow("e1", "第一页数据")],
      total: 60,
      page: 1,
      pageSize: 20,
      totalPages: 3,
    });
    // Rows render in both the desktop table and the mobile card list.
    expect(await screen.findAllByText("第一页数据")).not.toHaveLength(0);

    // Two rapid page flips: page 2 then page 3, both slow.
    await user.click(screen.getByRole("button", { name: "下一页" }));
    await user.click(screen.getByRole("button", { name: "下一页" }));
    expect(pending).toHaveLength(2);
    const page2Req = pending[0]!;
    const page3Req = pending[1]!;
    // The NEWER request (page 3) resolves FIRST; the stale page-2 response
    // arrives last and must be discarded.
    page3Req.resolve({
      items: [examRow("e41", "第三页数据")],
      total: 60,
      page: 3,
      pageSize: 20,
      totalPages: 3,
    });
    expect(await screen.findAllByText("第三页数据")).not.toHaveLength(0);
    page2Req.resolve({
      items: [examRow("e21", "第二页过期数据")],
      total: 60,
      page: 2,
      pageSize: 20,
      totalPages: 3,
    });
    // Stale data never lands in the UI.
    await waitFor(() => {
      expect(screen.queryByText("第二页过期数据")).not.toBeInTheDocument();
    });
    expect(screen.getAllByText("第三页数据").length).toBeGreaterThan(0);
  });

  // ── B11 — 越界恢复期间不得出现虚假空态 ─────────────────────────────────
  it("B11: recovering from an emptied page never renders a fake empty state (deferred)", async () => {
    const user = userEvent.setup();
    const page1 = Array.from({ length: 20 }, (_, i) =>
      examRow(`e${i + 1}`, `旧考试 ${i + 1}`),
    );
    const page2 = [examRow("e21", "待删除考试")];
    let deleted = false;
    let resolveRecovered!: (value: unknown) => void;
    const recovered = new Promise((resolve) => {
      resolveRecovered = resolve;
    });
    const recoveryPage1Calls: string[] = [];
    apiGet.mockImplementation(async (url: string) => {
      if (!url.startsWith("/api/exams")) {
        throw new Error(`unexpected GET ${url}`);
      }
      const params = new URLSearchParams(url.split("?")[1] ?? "");
      const requestedPage = Number(params.get("page") ?? "1");
      if (!deleted) {
        return {
          items: requestedPage === 1 ? page1 : page2,
          total: 21,
          page: requestedPage,
          pageSize: 20,
          totalPages: 2,
        };
      }
      // Post-delete: page 2 is empty (total dropped to 20); the recovery
      // fetch for page 1 is held in flight so the recovery window can be
      // observed deterministically.
      if (requestedPage === 2) {
        return { items: [], total: 20, page: 2, pageSize: 20, totalPages: 1 };
      }
      recoveryPage1Calls.push(url);
      await recovered;
      return { items: page1, total: 20, page: 1, pageSize: 20, totalPages: 1 };
    });
    apiDelete.mockImplementation(async () => {
      deleted = true;
    });

    renderPage();
    await screen.findByRole("table");
    await user.click(screen.getByRole("button", { name: "下一页" }));
    expect(
      await within(await screen.findByRole("table")).findByText("待删除考试"),
    ).toBeInTheDocument();

    await user.click(
      within(await screen.findByRole("table")).getByRole("button", {
        name: "删除考试",
      }),
    );
    await user.click(await screen.findByRole("button", { name: "确认" }));
    await waitFor(() => {
      expect(apiDelete).toHaveBeenCalledWith("/api/exams/e21");
    });
    // Single-jump recovery: exactly ONE page-1 refetch, no step-back walk.
    await waitFor(() => {
      expect(recoveryPage1Calls).toHaveLength(1);
    });

    // While the recovery is in flight: no fake empty state, no stale
    // deleted row, and no old rows presented as fresh data.
    expect(screen.queryByText("暂无考试")).not.toBeInTheDocument();
    expect(screen.queryByText("待删除考试")).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();

    resolveRecovered(undefined);
    expect(
      await within(await screen.findByRole("table")).findByText("旧考试 1"),
    ).toBeInTheDocument();
    expect(screen.getByText(/共 20 条/)).toBeInTheDocument();
  });

  // ── B12 — 请求进行中，旧记录不得被呈现为新查询的结果 ──────────────────
  it("B12: while a filter query is in flight, old rows are never presented as its result (deferred)", async () => {
    const user = userEvent.setup();
    const drafts = Array.from({ length: 20 }, (_, i) =>
      examRow(`d${i + 1}`, `草稿考试 ${i + 1}`),
    );
    let resolvePublished!: (value: unknown) => void;
    const publishedResponse = new Promise((resolve) => {
      resolvePublished = resolve;
    });
    apiGet.mockImplementation((url: string) => {
      if (!url.startsWith("/api/exams")) {
        return Promise.reject(new Error(`unexpected GET ${url}`));
      }
      const params = new URLSearchParams(url.split("?")[1] ?? "");
      const requestedPage = Number(params.get("page") ?? "1");
      if (params.get("statuses") === "published") {
        return publishedResponse.then(() => ({
          items: [
            examRow("p1", "已发布考试", {
              status: "published",
              canDelete: false,
            }),
          ],
          total: 1,
          page: requestedPage,
          pageSize: 20,
          totalPages: 1,
        }));
      }
      return Promise.resolve({
        items: drafts,
        total: 20,
        page: requestedPage,
        pageSize: 20,
        totalPages: 1,
      });
    });

    renderPage();
    await within(await screen.findByRole("table")).findByText("草稿考试 1");

    await user.click(screen.getByRole("combobox", { name: "按状态筛选" }));
    await user.click(await screen.findByRole("option", { name: "已发布" }));

    // The published query is in flight: the draft rows must not stay on
    // screen as if they were the published query's result, and no fake
    // empty state may appear while loading.
    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledWith(
        "/api/exams?page=1&pageSize=20&statuses=published",
      );
    });
    expect(screen.queryByText("草稿考试 1")).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByText("暂无考试")).not.toBeInTheDocument();

    resolvePublished(undefined);
    expect(
      await within(await screen.findByRole("table")).findByText("已发布考试"),
    ).toBeInTheDocument();
    expect(screen.getByText(/共 1 条/)).toBeInTheDocument();
  });
});
