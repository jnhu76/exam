import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router";
import { AuthProvider } from "@/contexts/AuthContext";
import { BrandProvider } from "@/components/layout/BrandProvider";
import { ExamPage } from "./ExamPage";
import { permissionsForRole } from "@exam/authz";

/**
 * #784 stage A — ExamPage URL query-state oracles (A03, A06-L2, A10-L2,
 * A16-L2, OD3) plus the history semantics a page change can prove at L2.
 *
 * #785's own B01/B06/B07/B08/B11/B12 oracles stay in ExamPage.test.tsx and are
 * NOT duplicated here: those assertions must keep their original force.
 */

type ExamRow = {
  id: string;
  title: string;
  status: string;
  openAt: string;
  closeAt: string;
  durationMinutes: number;
  passingScore: number;
  totalScore: number;
  questionIds: string[];
  participantCount: number;
  canDelete: boolean;
  deleteDisabledReasonCode: null;
  deleteDisabledReason: string | null;
};

const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }));

vi.mock("@/lib/api", () => ({
  ApiError: class ApiError extends Error {
    readonly status: number;
    constructor(status: number, message: string) {
      super(message);
      this.name = "ApiError";
      this.status = status;
    }
  },
  api: {
    get: (...args: unknown[]) => apiGet(...args),
    delete: vi.fn().mockResolvedValue(undefined),
  },
  setNavigate: () => {},
}));

function examRow(id: string, title: string, status = "draft"): ExamRow {
  return {
    id,
    title,
    status,
    openAt: new Date().toISOString(),
    closeAt: new Date(Date.now() + 3_600_000).toISOString(),
    durationMinutes: 60,
    passingScore: 60,
    totalScore: 100,
    questionIds: ["q1"],
    participantCount: 0,
    canDelete: status === "draft",
    deleteDisabledReasonCode: null,
    deleteDisabledReason: null,
  };
}

/** Rows for `page` out of `total`, 20 per page, status-tagged. */
function examsPayload(page: number, total: number, status = "draft") {
  const size = 20;
  const start = (page - 1) * size;
  const count = Math.max(0, Math.min(size, total - start));
  return {
    items: Array.from({ length: count }, (_, i) =>
      examRow(`e${start + i + 1}`, `考试${start + i + 1}`, status),
    ),
    total,
    page,
    pageSize: size,
    totalPages: Math.max(1, Math.ceil(total / size)),
  };
}

const examCalls = () =>
  apiGet.mock.calls
    .filter(
      (call) =>
        typeof call[0] === "string" &&
        (call[0] as string).startsWith("/api/exams?"),
    )
    .map((call) => decodeURIComponent(call[0] as string));

function LocationProbe() {
  const location = useLocation();
  return (
    <>
      <div data-testid="location-search">{location.search}</div>
      <div data-testid="location-state">
        {JSON.stringify(location.state ?? null)}
      </div>
    </>
  );
}

function HistoryNav() {
  const navigate = useNavigate();
  return (
    <div>
      <button type="button" onClick={() => void navigate(-1)}>
        后退
      </button>
      <button type="button" onClick={() => void navigate(1)}>
        前进
      </button>
    </div>
  );
}

function renderPage(initialEntry: string | string[] = "/admin/exams") {
  return render(
    <MemoryRouter
      initialEntries={
        Array.isArray(initialEntry) ? initialEntry : [initialEntry]
      }
    >
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
            <Route path="/admin/exams" element={<ExamPage />} />
            <Route path="/admin/exams/:id" element={<div>考试详情</div>} />
          </Routes>
          <LocationProbe />
          <HistoryNav />
        </BrandProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

function urlSearch(): string {
  return screen.getByTestId("location-search").textContent ?? "";
}

describe("ExamPage URL query state (#784 A3)", () => {
  // ── A03 — status + page restore, and the control shows the filter ──
  it("A03: a deep link restores the status filter and the page", async () => {
    apiGet.mockImplementation(async (url: string) => {
      const params = new URLSearchParams(url.split("?")[1] ?? "");
      const page = Number(params.get("page") ?? "1");
      if (params.get("statuses") === "published") {
        return examsPayload(page, 41, "published");
      }
      return examsPayload(page, 61);
    });

    renderPage("/admin/exams?status=published&page=2");

    await waitFor(() =>
      expect(examCalls().at(-1)).toContain(
        "/api/exams?page=2&pageSize=20&statuses=published",
      ),
    );
    // The control shows the applied filter, not the default.
    expect(
      screen.getByRole("combobox", { name: "按状态筛选" }),
    ).toHaveTextContent("已发布");
    // ...and the rendered rows belong to page 2 of the filtered set.
    await waitFor(() =>
      expect(screen.getByRole("table")).toHaveTextContent("考试21"),
    );
  });

  it("A03: the default status is never written and an unknown one is dropped", async () => {
    apiGet.mockImplementation(async (url: string) => {
      const params = new URLSearchParams(url.split("?")[1] ?? "");
      return examsPayload(Number(params.get("page") ?? "1"), 21);
    });

    renderPage("/admin/exams?status=all");
    await waitFor(() => expect(examCalls().length).toBeGreaterThan(0));
    await waitFor(() => expect(urlSearch()).not.toContain("status="));
    expect(examCalls().at(-1)).not.toContain("statuses=");
  });

  it("A03: a comma-joined or unknown status is dropped and the list renders unfiltered", async () => {
    apiGet.mockImplementation(async (url: string) => {
      const params = new URLSearchParams(url.split("?")[1] ?? "");
      return examsPayload(Number(params.get("page") ?? "1"), 21);
    });

    renderPage("/admin/exams?status=open,closed");
    await waitFor(() => expect(urlSearch()).not.toContain("status="));
    expect(examCalls().at(-1)).not.toContain("statuses=");
    expect(
      screen.getByRole("combobox", { name: "按状态筛选" }),
    ).toHaveTextContent("全部状态");
  });

  it("A17: an illegal page is normalized away and page=1 is never written", async () => {
    apiGet.mockImplementation(async (url: string) => {
      const params = new URLSearchParams(url.split("?")[1] ?? "");
      return examsPayload(Number(params.get("page") ?? "1"), 21);
    });

    renderPage("/admin/exams?page=abc");
    await waitFor(() => expect(examCalls().at(-1)).toContain("page=1"));
    await waitFor(() => expect(urlSearch()).not.toContain("page="));

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "下一页" }));
    await waitFor(() => expect(urlSearch()).toContain("page=2"));
    // Back to the first page: the parameter is removed, not set to 1.
    await user.click(screen.getByRole("button", { name: "上一页" }));
    await waitFor(() => expect(urlSearch()).not.toContain("page="));
  });

  // ── A06 (L2) — Back does not resurrect a parameter the user left ──
  it("A06: after Back, a write is based on the URL the user actually left", async () => {
    apiGet.mockImplementation(async (url: string) => {
      const params = new URLSearchParams(url.split("?")[1] ?? "");
      const page = Number(params.get("page") ?? "1");
      if (params.get("statuses") === "published") {
        return examsPayload(page, 41, "published");
      }
      return examsPayload(page, 61);
    });

    const user = userEvent.setup();
    // Entry 1 is the bare list; entry 2 (current) carries the filter.
    renderPage(["/admin/exams", "/admin/exams?status=published"]);
    await waitFor(() =>
      expect(examCalls().at(-1)).toContain("statuses=published"),
    );

    await user.click(screen.getByRole("button", { name: "后退" }));
    await waitFor(() => expect(urlSearch()).not.toContain("status="));

    // The next write must start from the URL the user is ON, not from the
    // filter they navigated away from.
    await user.click(screen.getByRole("button", { name: "下一页" }));
    await waitFor(() => expect(urlSearch()).toContain("page=2"));
    expect(urlSearch()).not.toContain("status=");
    expect(examCalls().at(-1)).not.toContain("statuses=");
  });

  it("A06: Forward restores the filtered entry and its rows", async () => {
    apiGet.mockImplementation(async (url: string) => {
      const params = new URLSearchParams(url.split("?")[1] ?? "");
      const page = Number(params.get("page") ?? "1");
      if (params.get("statuses") === "published") {
        return examsPayload(page, 41, "published");
      }
      return examsPayload(page, 61);
    });

    const user = userEvent.setup();
    renderPage(["/admin/exams", "/admin/exams?status=published"]);
    await waitFor(() =>
      expect(examCalls().at(-1)).toContain("statuses=published"),
    );

    await user.click(screen.getByRole("button", { name: "后退" }));
    await waitFor(() => expect(urlSearch()).not.toContain("status="));
    await user.click(screen.getByRole("button", { name: "前进" }));
    await waitFor(() => expect(urlSearch()).toContain("status=published"));
    expect(
      screen.getByRole("combobox", { name: "按状态筛选" }),
    ).toHaveTextContent("已发布");
  });

  // ── page changes PUSH: Back walks the pages the user visited ──
  it("a page change pushes a history entry, so Back returns to the previous page", async () => {
    apiGet.mockImplementation(async (url: string) => {
      const params = new URLSearchParams(url.split("?")[1] ?? "");
      return examsPayload(Number(params.get("page") ?? "1"), 61);
    });

    const user = userEvent.setup();
    renderPage();
    await within(await screen.findByRole("table")).findByText("考试1");

    await user.click(screen.getByRole("button", { name: "下一页" }));
    await waitFor(() =>
      expect(
        within(screen.getByRole("table")).getByText("考试21"),
      ).toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: "后退" }));
    await waitFor(() => expect(urlSearch()).not.toContain("page="));
    await waitFor(() =>
      expect(
        within(screen.getByRole("table")).getByText("考试1"),
      ).toBeInTheDocument(),
    );
  });

  // ── A10 (L2) — out-of-range recovery writes the URL, single jump ──
  it("A10: an emptied page recovers in one jump and the URL names the rendered page", async () => {
    apiGet.mockImplementation(async (url: string) => {
      const params = new URLSearchParams(url.split("?")[1] ?? "");
      const page = Number(params.get("page") ?? "1");
      // 21 records ⇒ two real pages; page 3 answers empty.
      if (page > 2) return { ...examsPayload(1, 21), page, items: [] };
      return examsPayload(page, 21);
    });

    renderPage("/admin/exams?page=3");

    await waitFor(() =>
      expect(screen.getByRole("table")).toHaveTextContent("考试21"),
    );
    expect(urlSearch()).toContain("page=2");
    expect(examCalls().map((c) => c.match(/page=(\d+)/)?.[1])).toEqual([
      "3",
      "2",
    ]);
    expect(screen.queryByText("暂无考试")).not.toBeInTheDocument();
  });

  // ── OD3 — a pending identity offers no page numbers from the old total ──
  it("OD3: while a new status query is pending, the footer shows neither the old count nor its pages", async () => {
    let resolvePublished!: (value: unknown) => void;
    const published = new Promise((resolve) => {
      resolvePublished = resolve;
    });
    apiGet.mockImplementation((url: string) => {
      const params = new URLSearchParams(url.split("?")[1] ?? "");
      if (params.get("statuses") === "published") return published;
      return Promise.resolve(examsPayload(1, 61));
    });

    const user = userEvent.setup();
    renderPage();
    await within(await screen.findByRole("table")).findByText("考试1");
    // The loaded query's own count is on screen.
    expect(screen.getByText(/共 61 条/)).toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: "按状态筛选" }));
    await user.click(await screen.findByRole("option", { name: "已发布" }));

    // Pending: the previous query's total must not produce page numbers for
    // the new one, so neither the count nor the page links are offered.
    expect(screen.queryByText(/共 61 条/)).not.toBeInTheDocument();
    expect(screen.getByText("正在查询…")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "第 2 页" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();

    await act(async () => {
      resolvePublished(examsPayload(1, 3, "published"));
    });
    await waitFor(() =>
      expect(screen.getByText(/共 3 条/)).toBeInTheDocument(),
    );
  });

  it("OD3: a page turn within the same query keeps the real footer", async () => {
    let resolvePage2!: (value: unknown) => void;
    const page2 = new Promise((resolve) => {
      resolvePage2 = resolve;
    });
    apiGet.mockImplementation((url: string) => {
      const params = new URLSearchParams(url.split("?")[1] ?? "");
      if (Number(params.get("page") ?? "1") === 2) return page2;
      return Promise.resolve(examsPayload(1, 61));
    });

    const user = userEvent.setup();
    renderPage();
    await within(await screen.findByRole("table")).findByText("考试1");

    await user.click(screen.getByRole("button", { name: "下一页" }));
    // Same query, different page: the count still describes this result set,
    // so the footer keeps stating it (and the page links stay meaningful).
    expect(screen.getByText(/共 61 条/)).toBeInTheDocument();
    expect(screen.queryByText("正在查询…")).not.toBeInTheDocument();

    await act(async () => {
      resolvePage2(examsPayload(2, 61));
    });
    await waitFor(() =>
      expect(
        within(screen.getByRole("table")).getByText("考试21"),
      ).toBeInTheDocument(),
    );
  });

  // ── A16 (L2) — ExamPage failure classes ──
  it("A16: a first-load failure is reported and is not a permanent loader", async () => {
    apiGet.mockRejectedValue(new Error("boom"));
    renderPage();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("加载考试列表失败");
    expect(screen.queryByText("加载中...")).not.toBeInTheDocument();
  });

  it("A16: retry leaves the error presentation and reports the attempt it started", async () => {
    let releaseRetry!: () => void;
    const retryGate = new Promise<void>((resolve) => {
      releaseRetry = resolve;
    });
    let failing = true;
    apiGet.mockImplementation(async () => {
      if (failing) throw new Error("boom");
      await retryGate;
      return examsPayload(1, 3);
    });

    renderPage();
    await screen.findByRole("alert");

    failing = false;
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "重试" }));

    // Retry is a NEW attempt, not a re-render of the failure: while its request
    // is in flight the error must be gone and the page must show that it is
    // working. Leaving the error up makes the click look like a no-op — the
    // button stays mounted, so every extra click issues another request.
    await waitFor(() =>
      expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("加载中...")).toBeInTheDocument();

    releaseRetry();
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("A16: a failure never persists into the next query", async () => {
    let failAll = true;
    apiGet.mockImplementation((url: string) => {
      if (failAll) return Promise.reject(new Error("boom"));
      const params = new URLSearchParams(url.split("?")[1] ?? "");
      return Promise.resolve(
        examsPayload(Number(params.get("page") ?? "1"), 61),
      );
    });

    const user = userEvent.setup();
    // Entry 1 is the bare list; entry 2 (current) fails on load.
    renderPage(["/admin/exams", "/admin/exams?page=2"]);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("加载考试列表失败");

    failAll = false;
    await user.click(screen.getByRole("button", { name: "后退" }));
    await waitFor(() =>
      expect(screen.getByRole("table")).toHaveTextContent("考试1"),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  // ── Internal navigation carries the list query ──
  it("carries the current list query into a detail navigation", async () => {
    apiGet.mockImplementation(async (url: string) => {
      const params = new URLSearchParams(url.split("?")[1] ?? "");
      const page = Number(params.get("page") ?? "1");
      if (params.get("statuses") === "published") {
        return examsPayload(page, 41, "published");
      }
      return examsPayload(page, 61);
    });

    const user = userEvent.setup();
    renderPage("/admin/exams?status=published&page=2");
    await waitFor(() =>
      expect(screen.getByRole("table")).toHaveTextContent("考试21"),
    );

    const row = screen
      .getAllByRole("row")
      .find((r) => r.textContent?.includes("考试21"));
    // Composed per-row accessible name (audit #971 F-07).
    await user.click(
      within(row as HTMLElement).getByRole("button", {
        name: "查看详情：考试21",
      }),
    );
    expect(await screen.findByText("考试详情")).toBeInTheDocument();
    expect(screen.getByTestId("location-state")).toHaveTextContent(
      JSON.stringify({ from: "/admin/exams?status=published&page=2" }),
    );
  });
});
