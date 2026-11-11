import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router";
import { AuthProvider } from "@/contexts/AuthContext";
import { BrandProvider } from "@/components/layout/BrandProvider";
import { QuestionPage } from "./QuestionPage";
import { ApiError } from "@/lib/api";
import { permissionsForRole } from "@exam/authz";

/**
 * #784 stage A — QuestionPage URL query-state oracles (A01, A02, A07-L2, A08,
 * A09, A09b, A10, A12, A14, A16, A17-L2, A18) plus the C1 course-probe
 * negative paths.
 *
 * Every assertion is bound to THREE facts at once — the URL, the query that was
 * actually issued, and what the user can see (rows, control values, empty
 * states) — because any one of them alone can be satisfied by a wrong
 * implementation.
 */

type QuestionListPayload = {
  items: Array<{
    id: string;
    courseId: string;
    type: string;
    content: string;
    score: number;
    difficulty: number;
    tags: string[];
  }>;
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

const { apiGet, apiDelete } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiDelete: vi.fn(),
}));

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
    delete: (...args: unknown[]) => apiDelete(...args),
  },
  setNavigate: () => {},
}));

function questionRow(id: string, content: string) {
  return {
    id,
    courseId: "course-1",
    type: "true_false",
    content,
    score: 2,
    difficulty: 1,
    tags: ["tag1"],
  };
}

/** Rows for `page` out of a collection of `total`, 20 per page. */
function pagePayload(
  page: number,
  total: number,
  prefix = "第",
): QuestionListPayload {
  const size = 20;
  const start = (page - 1) * size;
  const count = Math.max(0, Math.min(size, total - start));
  return {
    items: Array.from({ length: count }, (_, i) =>
      questionRow(`q${start + i + 1}`, `${prefix}${start + i + 1}题`),
    ),
    total,
    page,
    pageSize: size,
    totalPages: Math.max(1, Math.ceil(total / size)),
  };
}

/** Serves the paginated list from a real (page, total) model. */
function mockPaginated(total: number, prefix = "第") {
  apiGet.mockImplementation(async (url: string) => {
    if (url.startsWith("/api/questions/tags")) {
      return { tags: ["代数", "几何"] };
    }
    if (/^\/api\/courses\/[^/?]+$/.test(url)) {
      // A listed course must never be probed, but a deep-linked one is; answer
      // both so the fixture cannot mask the request under test. The answer
      // carries the SERVER's canonical spelling (a uuid's lowercase form), not
      // the requested one — echoing the request would hide the case-folding
      // rule the page has to implement.
      const id = url.slice("/api/courses/".length).toLowerCase();
      return { id, name: `课程${id}`, code: id.toUpperCase() };
    }
    if (url.startsWith("/api/courses")) {
      return {
        items: [
          { id: "course-1", name: "课程一", code: "C1" },
          { id: "course-2", name: "课程二", code: "C2" },
        ],
        total: 2,
        page: 1,
        pageSize: 20,
        totalPages: 1,
      };
    }
    const params = new URLSearchParams(url.split("?")[1] ?? "");
    return pagePayload(Number(params.get("page") ?? "1"), total, prefix);
  });
}

const questionsCalls = () =>
  apiGet.mock.calls
    .filter(
      (call) =>
        typeof call[0] === "string" &&
        (call[0] as string).startsWith("/api/questions?"),
    )
    .map((call) => decodeURIComponent(call[0] as string));

function LocationProbe() {
  const location = useLocation();
  return (
    <>
      <div data-testid="location-search">{location.search}</div>
      <div data-testid="location-state">
        {location.state === null || location.state === undefined
          ? ""
          : JSON.stringify(location.state)}
      </div>
    </>
  );
}

/** Real history navigation through the router (Back/Forward), not a URL write. */
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

function renderPage(
  initialEntry: string | string[] = "/admin/questions",
  options?: { initialIndex?: number },
) {
  return render(
    <MemoryRouter
      initialEntries={
        Array.isArray(initialEntry) ? initialEntry : [initialEntry]
      }
      initialIndex={options?.initialIndex}
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
            <Route path="/admin/questions" element={<QuestionPage />} />
            <Route
              path="/admin/questions/:id/edit"
              element={<div>编辑页</div>}
            />
          </Routes>
          <LocationProbe />
          <HistoryNav />
        </BrandProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

/** The desktop table region (rows also render in the mobile card list). */
function desktopShell(): HTMLElement {
  return document.querySelector(
    '[data-slot="admin-table-shell"]',
  ) as HTMLElement;
}

function urlSearch(): string {
  return screen.getByTestId("location-search").textContent ?? "";
}

/**
 * The course filter control. It carries no aria-label (the shared Select uses
 * its placeholder as the name), so a selected value would change its
 * accessible name — address it by its fixed toolbar position instead.
 */
function courseTrigger(): HTMLElement {
  return screen.getAllByRole("combobox")[0] as HTMLElement;
}

describe("QuestionPage URL query state (#784 A3)", () => {
  beforeEach(() => {
    apiDelete.mockReset();
    apiDelete.mockResolvedValue(undefined);
  });

  // ── A01 — a deep link restores the filters AND the controls display them ──
  it("A01: a deep link restores filter, page, controls and rows together", async () => {
    mockPaginated(61);
    renderPage(
      "/admin/questions?courseId=course-2&type=fill_blank&difficulty=3&page=3",
    );

    await screen.findByText("题目管理");
    // The request is exactly what the parameter table derives.
    await waitFor(() => {
      const last = questionsCalls().at(-1) ?? "";
      expect(last).toContain(
        "/api/questions?page=3&pageSize=20&courseId=course-2&type=fill_blank&difficulty=3",
      );
    });
    // The CONTROLS show the applied filters (a request-only implementation
    // would still render the defaults here).
    await waitFor(() =>
      expect(within(desktopShell()).getByText("第41题")).toBeInTheDocument(),
    );
    expect(courseTrigger()).toHaveTextContent("课程二");
    expect(
      screen.getByRole("combobox", { name: "按题型筛选" }),
    ).toHaveTextContent("填空题");
    expect(
      screen.getByRole("combobox", { name: "按难度筛选" }),
    ).toHaveTextContent("难度 3");
    // ...and the URL still carries them.
    expect(urlSearch()).toContain("page=3");
    expect(urlSearch()).toContain("courseId=course-2");
  });

  // ── A02 — multi-tag AND + search + page together ──
  it("A02: tags, search and page combine; tags are canonicalized (sorted, de-duplicated)", async () => {
    mockPaginated(61);
    renderPage(
      "/admin/questions?tags=%E5%87%A0%E4%BD%95,%E4%BB%A3%E6%95%B0,%E4%BB%A3%E6%95%B0&search=%E5%AF%BC%E8%88%AA&page=2",
    );

    await screen.findByText("题目管理");
    await waitFor(() => {
      const last = questionsCalls().at(-1) ?? "";
      expect(last).toContain("page=2");
      expect(last).toContain("search=导航");
      // Sorted by code unit (代数 < 几何) and de-duplicated, not left as typed.
      expect(last).toContain("tags=代数,几何");
      expect(last).not.toContain("几何,代数");
    });
    // The canonical form is also what the URL holds afterwards.
    await waitFor(() => {
      expect(urlSearch()).toContain(
        "tags=%E4%BB%A3%E6%95%B0%2C%E5%87%A0%E4%BD%95",
      );
    });
    // The search box reflects the committed term.
    expect(screen.getByLabelText("搜索题目")).toHaveValue("导航");
  });

  // ── A07 (L2) — illegal and repeated parameters never reach the API ──
  it("A07: an illegal page renders the list normally and is normalized away", async () => {
    mockPaginated(61);
    renderPage("/admin/questions?page=abc");

    await screen.findByText("题目管理");
    await waitFor(() => {
      expect(within(desktopShell()).getByText("第1题")).toBeInTheDocument();
    });
    const last = questionsCalls().at(-1) ?? "";
    expect(last).toContain("page=1&pageSize=20");
    expect(last).not.toContain("NaN");
    // The URL is corrected, not merely ignored.
    await waitFor(() => expect(urlSearch()).not.toContain("page="));
  });

  it("A07: an unknown enum value is dropped and the list renders unfiltered", async () => {
    mockPaginated(61);
    renderPage("/admin/questions?type=bogus_type&difficulty=9");

    await screen.findByText("题目管理");
    await waitFor(() => {
      const last = questionsCalls().at(-1) ?? "";
      expect(last).toContain("/api/questions?page=1&pageSize=20");
    });
    await waitFor(() => {
      expect(urlSearch()).not.toContain("type=");
      expect(urlSearch()).not.toContain("difficulty=");
    });
  });

  // ── A17 (L2) — repeated parameters keep the FIRST value; defaults omitted ──
  it("A17: a repeated page keeps its first value and the default is never written", async () => {
    mockPaginated(61);
    renderPage("/admin/questions?page=0&page=2");

    await screen.findByText("题目管理");
    // Taking the LAST value would query page 2 and keep `page=2` in the URL.
    await waitFor(() => {
      const last = questionsCalls().at(-1) ?? "";
      expect(last).toContain("page=1&pageSize=20");
    });
    await waitFor(() => expect(urlSearch()).not.toContain("page="));
  });

  it("A17: page=1 is removed from the URL", async () => {
    mockPaginated(61);
    renderPage("/admin/questions?page=1&type=fill_blank");

    await screen.findByText("题目管理");
    await waitFor(() => expect(urlSearch()).not.toContain("page="));
    expect(urlSearch()).toContain("type=fill_blank");
  });

  // ── A08 — the newest request wins, including for a page turn ──
  it("A08: a late out-of-order response for another page never renders", async () => {
    type Deferred = { url: string; resolve: (v: QuestionListPayload) => void };
    const pending: Deferred[] = [];
    apiGet.mockImplementation((url: string) => {
      if (url.startsWith("/api/questions?")) {
        return new Promise<QuestionListPayload>((resolve) => {
          pending.push({ url, resolve });
        });
      }
      if (url.startsWith("/api/questions/tags"))
        return Promise.resolve({ tags: [] });
      return Promise.resolve({
        items: [
          { id: "course-1", name: "课程一", code: "C1" },
          { id: "course-2", name: "课程二", code: "C2" },
        ],
        total: 2,
        page: 1,
        pageSize: 20,
        totalPages: 1,
      });
    });

    renderPage();
    await waitFor(() => expect(pending).toHaveLength(1));
    await act(async () => {
      pending[0]!.resolve(pagePayload(1, 60));
    });
    await waitFor(() =>
      expect(within(desktopShell()).getByText("第1题")).toBeInTheDocument(),
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "下一页" }));
    await user.click(screen.getByRole("button", { name: "下一页" }));
    await waitFor(() => expect(pending).toHaveLength(3));
    const page2 = pending[1]!;
    const page3 = pending[2]!;
    expect(decodeURIComponent(page2.url)).toContain("page=2");
    expect(decodeURIComponent(page3.url)).toContain("page=3");

    // The NEWER request (page 3) lands first; the page-2 response arrives last.
    await act(async () => {
      page3.resolve(pagePayload(3, 60));
    });
    await waitFor(() =>
      expect(within(desktopShell()).getByText("第41题")).toBeInTheDocument(),
    );
    await act(async () => {
      page2.resolve(pagePayload(2, 60));
    });
    expect(
      within(desktopShell()).queryByText("第21题"),
    ).not.toBeInTheDocument();
    expect(within(desktopShell()).getByText("第41题")).toBeInTheDocument();
  });

  // ── A09 — a cross-identity pending window shows neither old rows nor an
  //    empty state, in EITHER representation ──
  it("A09: while a new filter is in flight the old identity's rows are gone from the whole document", async () => {
    let resolveFiltered!: (v: QuestionListPayload) => void;
    const filtered = new Promise<QuestionListPayload>((resolve) => {
      resolveFiltered = resolve;
    });
    apiGet.mockImplementation((url: string) => {
      if (url.startsWith("/api/questions/tags"))
        return Promise.resolve({ tags: [] });
      if (/^\/api\/courses\/[^/?]+$/.test(url)) {
        return Promise.resolve({ id: "course-2", name: "课程二", code: "C2" });
      }
      if (url.startsWith("/api/courses")) {
        return Promise.resolve({
          items: [
            { id: "course-1", name: "课程一", code: "C1" },
            { id: "course-2", name: "课程二", code: "C2" },
          ],
          total: 2,
          page: 1,
          pageSize: 20,
          totalPages: 1,
        });
      }
      if (decodeURIComponent(url).includes("courseId=course-2")) {
        return filtered;
      }
      return Promise.resolve(pagePayload(1, 21));
    });

    renderPage();
    await waitFor(() =>
      expect(within(desktopShell()).getByText("第1题")).toBeInTheDocument(),
    );

    const user = userEvent.setup();
    await user.click(courseTrigger());
    await user.click(await screen.findByRole("option", { name: "课程二" }));

    // The new identity is in flight: no old row anywhere in the document, no
    // empty state, no actionable row control, and no stale row action.
    expect(screen.queryByText("第1题")).not.toBeInTheDocument();
    expect(screen.queryByText("暂无题目")).not.toBeInTheDocument();
    expect(screen.queryByText("未找到匹配的题目")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "编辑题目" }),
    ).not.toBeInTheDocument();

    await act(async () => {
      resolveFiltered(pagePayload(1, 3, "筛选后"));
    });
    await waitFor(() =>
      expect(within(desktopShell()).getByText("筛选后1题")).toBeInTheDocument(),
    );
  });

  // ── A09b — the same-identity page-turn window stays bounded ──
  it("A13 (wiring): a cross-identity pending body reserves the height the rows last occupied", async () => {
    mockPaginated(61);
    let resolvePending!: (v: QuestionListPayload) => void;
    const pendingResponse = new Promise<QuestionListPayload>((resolve) => {
      resolvePending = resolve;
    });
    const inner = apiGet.getMockImplementation()!;
    apiGet.mockImplementation(async (url: string) =>
      url.includes("difficulty=3") ? pendingResponse : inner(url),
    );

    renderPage("/admin/questions");
    await waitFor(() =>
      expect(within(desktopShell()).getByText("第1题")).toBeInTheDocument(),
    );

    // jsdom reports 0 for every layout box, so the measurement is stubbed — on
    // THIS element only, because a prototype-wide stub also feeds the table's
    // own column-allocation geometry. The real geometry is proved in the L3
    // witness; this pins the wiring: without the reservation the pending body
    // falls back to the table's single short placeholder row, which is the
    // measured 1374px -> 170px collapse.
    const measured = 1374;
    const box = within(desktopShell())
      .getByRole("table")
      .closest("[data-slot='table-container']")!.parentElement as HTMLElement;
    const originalOffsetHeight = Object.getOwnPropertyDescriptor(
      HTMLDivElement.prototype,
      "offsetHeight",
    );
    Object.defineProperty(HTMLDivElement.prototype, "offsetHeight", {
      configurable: true,
      get(this: HTMLElement) {
        // Only the wrapper that holds the table answers with a height; every
        // other box keeps jsdom's 0, so the table's own column-allocation
        // geometry is untouched.
        return this.querySelector(':scope > [data-slot="table-container"]')
          ? measured
          : 0;
      },
    });
    expect(box.style.minHeight).toBe("");

    const user = userEvent.setup();
    // One settled turn so the effect re-measures through the stub.
    await user.click(screen.getByRole("button", { name: "下一页" }));
    await waitFor(() =>
      expect(within(desktopShell()).getByText("第21题")).toBeInTheDocument(),
    );

    // A cross-identity change: the old rows are gone from the body, so only the
    // reservation can keep the region from collapsing.
    await user.click(screen.getByRole("combobox", { name: "按难度筛选" }));
    await user.click(await screen.findByRole("option", { name: "难度 3" }));

    await waitFor(() => expect(box.style.minHeight).toBe(`${measured}px`));
    expect(
      within(desktopShell()).queryByText("第21题"),
    ).not.toBeInTheDocument();

    resolvePending(pagePayload(1, 0));
    // Both representations render the copy (desktop table and mobile cards).
    await waitFor(() =>
      expect(
        within(desktopShell()).getByText("未找到匹配的题目"),
      ).toBeInTheDocument(),
    );
    // Settled again: the reservation follows the new body, so a later page does
    // not inherit a stale height.
    await waitFor(() => expect(box.style.minHeight).toBe(""));
    if (originalOffsetHeight) {
      Object.defineProperty(
        HTMLDivElement.prototype,
        "offsetHeight",
        originalOffsetHeight,
      );
    }
  });

  it("A09b: a page turn keeps the previous slice with an in-flight signal and never shows an empty state", async () => {
    let resolvePage2!: (v: QuestionListPayload) => void;
    const page2Response = new Promise<QuestionListPayload>((resolve) => {
      resolvePage2 = resolve;
    });
    apiGet.mockImplementation((url: string) => {
      if (url.startsWith("/api/questions/tags"))
        return Promise.resolve({ tags: [] });
      if (url.startsWith("/api/courses")) {
        return Promise.resolve({
          items: [{ id: "course-1", name: "课程一", code: "C1" }],
          total: 1,
          page: 1,
          pageSize: 20,
          totalPages: 1,
        });
      }
      const page = Number(new URLSearchParams(url.split("?")[1]).get("page"));
      if (page === 2) return page2Response;
      return Promise.resolve(pagePayload(1, 41));
    });

    renderPage();
    await waitFor(() =>
      expect(within(desktopShell()).getByText("第1题")).toBeInTheDocument(),
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "下一页" }));

    // Page turn: the previous slice stays, with the in-flight signal, and no
    // empty state — the shell must NOT be replaced by a loading placeholder.
    expect(within(desktopShell()).getByText("第1题")).toBeInTheDocument();
    expect(
      desktopShell().querySelector('[aria-busy="true"]'),
    ).toBeInTheDocument();
    expect(screen.queryByText("暂无题目")).not.toBeInTheDocument();
    expect(screen.queryByText("未找到匹配的题目")).not.toBeInTheDocument();

    await act(async () => {
      resolvePage2(pagePayload(2, 41));
    });
    // page≥2 must land: a render key mixed with a request key would leave the
    // gate pending forever here.
    await waitFor(() =>
      expect(within(desktopShell()).getByText("第21题")).toBeInTheDocument(),
    );
    expect(
      desktopShell().querySelector('[aria-busy="true"]'),
    ).not.toBeInTheDocument();
  });

  // ── A10 — out-of-range recovery is a single jump with no fake empty state ──
  it("A10: an out-of-range page recovers in one jump and never renders a fake empty state", async () => {
    const calls: string[] = [];
    apiGet.mockImplementation((url: string) => {
      if (url.startsWith("/api/questions/tags"))
        return Promise.resolve({ tags: [] });
      if (url.startsWith("/api/courses")) {
        return Promise.resolve({
          items: [{ id: "course-1", name: "课程一", code: "C1" }],
          total: 1,
          page: 1,
          pageSize: 20,
          totalPages: 1,
        });
      }
      calls.push(decodeURIComponent(url));
      const page = Number(new URLSearchParams(url.split("?")[1]).get("page"));
      // 21 records ⇒ two real pages, so page 3 answers empty.
      if (page > 2)
        return Promise.resolve({ ...pagePayload(1, 21), page, items: [] });
      return Promise.resolve(pagePayload(page, 21));
    });

    renderPage("/admin/questions?page=3");

    await waitFor(() =>
      expect(within(desktopShell()).getByText("第21题")).toBeInTheDocument(),
    );
    // Exactly two requests: the out-of-range page and the single jump back —
    // no step-by-step walk.
    expect(calls.map((c) => c.match(/page=(\d+)/)?.[1])).toEqual(["3", "2"]);
    // The URL now names the page that is actually rendered.
    expect(urlSearch()).toContain("page=2");
    expect(screen.queryByText("未找到匹配的题目")).not.toBeInTheDocument();
    expect(screen.queryByText("暂无题目")).not.toBeInTheDocument();
  });

  it("A10: an out-of-range page with no records at all recovers to page 1", async () => {
    apiGet.mockImplementation((url: string) => {
      if (url.startsWith("/api/questions/tags"))
        return Promise.resolve({ tags: [] });
      if (url.startsWith("/api/courses")) {
        return Promise.resolve({
          items: [],
          total: 0,
          page: 1,
          pageSize: 20,
          totalPages: 1,
        });
      }
      const page = Number(new URLSearchParams(url.split("?")[1]).get("page"));
      if (page > 1) {
        return Promise.resolve({ ...pagePayload(1, 0), page, items: [] });
      }
      return Promise.resolve(pagePayload(1, 0));
    });

    renderPage("/admin/questions?page=4");
    await waitFor(() => expect(urlSearch()).not.toContain("page="));
    await waitFor(() =>
      expect(within(desktopShell()).getByText("暂无题目")).toBeInTheDocument(),
    );
  });

  it("A10: a NON-EMPTY page is never discarded even when total says otherwise", async () => {
    apiGet.mockImplementation((url: string) => {
      if (url.startsWith("/api/questions/tags"))
        return Promise.resolve({ tags: [] });
      if (url.startsWith("/api/courses")) {
        return Promise.resolve({
          items: [],
          total: 0,
          page: 1,
          pageSize: 20,
          totalPages: 1,
        });
      }
      const page = Number(new URLSearchParams(url.split("?")[1]).get("page"));
      if (page === 4) {
        // Concurrent delete between the paged SELECT and the COUNT: rows exist
        // but the total is too small for this page.
        return Promise.resolve({
          items: [questionRow("q-real", "并发删除后的真实数据")],
          total: 20,
          page: 4,
          pageSize: 20,
          totalPages: 1,
        });
      }
      return Promise.resolve(pagePayload(page, 20));
    });

    renderPage("/admin/questions?page=4");
    await waitFor(() =>
      expect(
        within(desktopShell()).getByText("并发删除后的真实数据"),
      ).toBeInTheDocument(),
    );
    expect(urlSearch()).toContain("page=4");
  });

  // ── A12 — atomic writes, and an external navigation cancels a draft ──
  it("A12(a): a debounced search commit and an immediate filter write both survive one task", async () => {
    mockPaginated(61);
    vi.useFakeTimers({ shouldAdvanceTime: false });
    try {
      renderPage();
      await act(async () => {});

      fireEvent.change(screen.getByLabelText("搜索题目"), {
        target: { value: "导航" },
      });
      // ONE act: the debounce deadline and the immediate page write land in the
      // same task, so there is no render between the two writes. If the second
      // write started from render-time params it would drop the just-committed
      // search; only a write that composes against the latest committed state
      // survives.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
        fireEvent.click(screen.getByRole("button", { name: "下一页" }));
      });

      expect(urlSearch()).toContain("search=");
      expect(urlSearch()).toContain("page=2");
      const last = questionsCalls().at(-1) ?? "";
      expect(last).toContain("search=导航");
      expect(last).toContain("page=2");
    } finally {
      vi.useRealTimers();
    }
  });

  it("A12(c): an external Back cancels an unlanded debounce commit", async () => {
    mockPaginated(61);
    // Entry 1 is the bare list; entry 2 (current) carries the committed search.
    renderPage(["/admin/questions", "/admin/questions?search=abc"]);
    await waitFor(() =>
      expect(within(desktopShell()).getByText("第1题")).toBeInTheDocument(),
    );
    expect(screen.getByLabelText("搜索题目")).toHaveValue("abc");

    // Real timers made the Back-vs-deadline order depend on machine load: the
    // click path measures ~240ms idle but crosses the 300ms deadline under CI
    // contention, letting the deadline expire between the navigation and the
    // cancel effect chain (run 43030066262: "?search=abcd" on the entry the
    // user navigated TO). Fake timers pin the order this test verifies.
    vi.useFakeTimers({ shouldAdvanceTime: false });
    try {
      // Type, then navigate away BEFORE the debounce deadline. The draft
      // belongs to an entry the user has left, so it must neither land nor
      // survive.
      fireEvent.change(screen.getByLabelText("搜索题目"), {
        target: { value: "abcd" },
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(299);
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "后退" }));
      });
      // The cancel has landed before the deadline: the field already shows
      // the entry the user is on now.
      expect(screen.getByLabelText("搜索题目")).toHaveValue("");
      // Past the debounce deadline: a stale draft landing here would write
      // search=abcd into the entry the user just navigated to.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(400);
      });
      expect(urlSearch()).not.toContain("search=");
      expect(screen.getByLabelText("搜索题目")).toHaveValue("");
      // The entry the user is on carries no search, so its reload query must
      // not filter by one either — a stale commit would have re-queried with
      // search=abcd here.
      expect(questionsCalls().at(-1) ?? "").not.toContain("search=");
    } finally {
      vi.useRealTimers();
    }
  });

  it("A12(d): a page-authored write does NOT cancel the draft the user typed", async () => {
    mockPaginated(61);
    // Fake timers make the ORDER of the two writes explicit. Leaving it to a
    // real-timer race made the assertion depend on machine load: the commit
    // resets the page, so if the debounce happens to land first the final URL
    // legitimately carries only `search` — the test would then flake on the
    // ordering rather than on the contract it is meant to pin.
    vi.useFakeTimers({ shouldAdvanceTime: false });
    try {
      renderPage("/admin/questions?search=abc");
      await act(async () => {});
      await act(async () => {});

      fireEvent.change(screen.getByLabelText("搜索题目"), {
        target: { value: "abcd" },
      });
      // An immediate write this page makes (a page turn) must not be mistaken
      // for an external navigation. A page-authored write that reset the field
      // to the committed term would also cancel the pending commit, so the term
      // the user typed would never land.
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "下一页" }));
      });
      expect(screen.getByLabelText("搜索题目")).toHaveValue("abcd");
      expect(urlSearch()).toContain("page=2");
      expect(urlSearch()).toContain("search=abc");

      // Past the debounce deadline the draft lands. Asserted synchronously:
      // `waitFor` schedules its polling on timers, which are fake here.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
      expect(screen.getByLabelText("搜索题目")).toHaveValue("abcd");
      expect(urlSearch()).toContain("search=abcd");
      expect(questionsCalls().at(-1) ?? "").toContain("search=abcd");
    } finally {
      vi.useRealTimers();
    }
  });

  // ── A14 + C1 — an applied course filter must be displayable or dropped ──
  it("A14: a deep-linked course id outside the loaded options is resolved and displayed", async () => {
    const probes: string[] = [];
    apiGet.mockImplementation((url: string) => {
      if (/^\/api\/courses\/[^/?]+$/.test(url)) {
        probes.push(url);
        return Promise.resolve({
          id: "course-9",
          name: "第九课程",
          code: "C9",
        });
      }
      if (url.startsWith("/api/courses")) {
        return Promise.resolve({
          items: [{ id: "course-1", name: "课程一", code: "C1" }],
          total: 1,
          page: 1,
          pageSize: 20,
          totalPages: 1,
        });
      }
      if (url.startsWith("/api/questions/tags"))
        return Promise.resolve({ tags: [] });
      return Promise.resolve(pagePayload(1, 3));
    });

    renderPage("/admin/questions?courseId=course-9");

    await waitFor(() => expect(courseTrigger()).toHaveTextContent("第九课程"));
    expect(probes).toEqual(["/api/courses/course-9"]);
    // The list request carries the resolved id and is issued AFTER the probe.
    const last = questionsCalls().at(-1) ?? "";
    expect(last).toContain("courseId=course-9");
  });

  it("A14/C1: a course id already in the options is used without a probe", async () => {
    const probes: string[] = [];
    apiGet.mockImplementation((url: string) => {
      if (/^\/api\/courses\/[^/?]+$/.test(url)) {
        probes.push(url);
        return Promise.reject(new Error("must not probe a listed course"));
      }
      if (url.startsWith("/api/courses")) {
        return Promise.resolve({
          items: [{ id: "course-1", name: "课程一", code: "C1" }],
          total: 1,
          page: 1,
          pageSize: 20,
          totalPages: 1,
        });
      }
      if (url.startsWith("/api/questions/tags"))
        return Promise.resolve({ tags: [] });
      return Promise.resolve(pagePayload(1, 3));
    });

    renderPage("/admin/questions?courseId=course-1");
    await waitFor(() =>
      expect(questionsCalls().at(-1) ?? "").toContain("courseId=course-1"),
    );
    expect(probes).toEqual([]);
  });

  it("C1: a deterministic 404 drops the course filter and normalizes the URL", async () => {
    apiGet.mockImplementation((url: string) => {
      if (/^\/api\/courses\/[^/?]+$/.test(url)) {
        return Promise.reject(new ApiError(404, "not found"));
      }
      if (url.startsWith("/api/courses")) {
        return Promise.resolve({
          items: [{ id: "course-1", name: "课程一", code: "C1" }],
          total: 1,
          page: 1,
          pageSize: 20,
          totalPages: 1,
        });
      }
      if (url.startsWith("/api/questions/tags"))
        return Promise.resolve({ tags: [] });
      return Promise.resolve(pagePayload(1, 3));
    });

    renderPage("/admin/questions?courseId=ghost-course&page=2");

    await waitFor(() => expect(urlSearch()).not.toContain("courseId="));
    await waitFor(() =>
      expect(questionsCalls().at(-1) ?? "").not.toContain("courseId="),
    );
    // Page 2 is preserved: only the undisplayable filter is dropped.
    expect(urlSearch()).toContain("page=2");
  });

  it("C1: a transient probe failure keeps the filter and offers retry instead of dropping it", async () => {
    let failProbe = true;
    apiGet.mockImplementation((url: string) => {
      if (/^\/api\/courses\/[^/?]+$/.test(url)) {
        if (failProbe) return Promise.reject(new Error("network down"));
        return Promise.resolve({
          id: "course-9",
          name: "第九课程",
          code: "C9",
        });
      }
      if (url.startsWith("/api/courses")) {
        return Promise.resolve({
          items: [{ id: "course-1", name: "课程一", code: "C1" }],
          total: 1,
          page: 1,
          pageSize: 20,
          totalPages: 1,
        });
      }
      if (url.startsWith("/api/questions/tags"))
        return Promise.resolve({ tags: [] });
      return Promise.resolve(pagePayload(1, 3));
    });

    renderPage("/admin/questions?courseId=course-9");

    // The user's intent is preserved: the parameter is still in the URL and the
    // page offers a retry rather than pretending the course does not exist.
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(urlSearch()).toContain("courseId=course-9");
    // No list request was issued for an identity that is not yet established.
    expect(questionsCalls()).toHaveLength(0);

    failProbe = false;
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => expect(courseTrigger()).toHaveTextContent("第九课程"));
    expect(questionsCalls().at(-1) ?? "").toContain("courseId=course-9");
  });

  it("C1: a course id is encoded before it is probed", async () => {
    const probes: string[] = [];
    apiGet.mockImplementation((url: string) => {
      if (/^\/api\/courses\//.test(url)) {
        probes.push(url);
        return Promise.reject(new ApiError(404, "not found"));
      }
      if (url.startsWith("/api/questions/tags"))
        return Promise.resolve({ tags: [] });
      return Promise.resolve(pagePayload(1, 0));
    });

    renderPage("/admin/questions?courseId=..%2Fquestions%2Ftags");

    await waitFor(() => expect(probes).toHaveLength(1));
    // The path is escaped, so the probe cannot address a DIFFERENT endpoint.
    expect(probes[0]).toBe("/api/courses/..%2Fquestions%2Ftags");
    expect(probes[0]).not.toContain("/api/questions/tags");
  });

  it("C1: an uppercase deep link folds onto the server's spelling and stays displayable", async () => {
    const canonical = "0a1b2c3d-0000-4000-8000-000000000001";
    const probes: string[] = [];
    apiGet.mockImplementation((url: string) => {
      if (/^\/api\/courses\/[^/?]+$/.test(url)) {
        probes.push(url);
        // uuid comparison is case-insensitive on zod and Postgres, so the
        // server honours the uppercase request and answers with its OWN
        // spelling — which is what the Select's option values are built from.
        return Promise.resolve({
          id: canonical,
          name: "大写课程",
          code: "U1",
        });
      }
      if (url.startsWith("/api/courses")) {
        return Promise.resolve({
          items: [{ id: "course-1", name: "课程一", code: "C1" }],
          total: 1,
          page: 1,
          pageSize: 20,
          totalPages: 1,
        });
      }
      if (url.startsWith("/api/questions/tags"))
        return Promise.resolve({ tags: [] });
      return Promise.resolve(pagePayload(1, 3));
    });

    renderPage(`/admin/questions?courseId=${canonical.toUpperCase()}`);

    // The applied filter is DISPLAYED. An exact-match implementation would
    // leave the Select on its placeholder — an applied filter the user can
    // neither see nor undo — and would keep the page resolving forever.
    // Budgeted wait (#858): this folds through TWO sequential awaited GETs
    // (options list, then the id probe gated on it) plus dependent Select
    // commits — cheap on an idle host, but beyond waitFor's 1000ms default
    // under CI's coverage contention (same lane that kills R1 in readTrust).
    await waitFor(() => expect(courseTrigger()).toHaveTextContent("大写课程"), {
      timeout: 5000,
    });
    // URL, control and request name the same course.
    await waitFor(() => expect(urlSearch()).toContain(`courseId=${canonical}`));
    expect(urlSearch()).not.toContain(canonical.toUpperCase());
    expect(questionsCalls().at(-1) ?? "").toContain(`courseId=${canonical}`);
    expect(probes).toHaveLength(1);
  });

  it("C1: a transient probe failure stops being reported once the URL no longer carries that course", async () => {
    apiGet.mockImplementation((url: string) => {
      if (/^\/api\/courses\/[^/?]+$/.test(url))
        return Promise.reject(new Error("network down"));
      if (url.startsWith("/api/courses")) {
        return Promise.resolve({
          items: [{ id: "course-1", name: "课程一", code: "C1" }],
          total: 1,
          page: 1,
          pageSize: 20,
          totalPages: 1,
        });
      }
      if (url.startsWith("/api/questions/tags"))
        return Promise.resolve({ tags: [] });
      return Promise.resolve(pagePayload(1, 3));
    });

    renderPage(["/admin/questions", "/admin/questions?courseId=course-9"]);
    expect(await screen.findByRole("alert")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "后退" }));

    // The failure belonged to one identity. Once the URL stops carrying it, the
    // error must not keep replacing a query that is not about that course.
    await waitFor(() =>
      expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(questionsCalls().at(-1) ?? "").toBe(
        "/api/questions?page=1&pageSize=20",
      ),
    );
    expect(urlSearch()).toBe("");
  });

  it("C1: a stale probe result cannot rewrite a course filter the user has moved to", async () => {
    let releaseProbeA!: () => void;
    const probeAGate = new Promise<void>((resolve) => {
      releaseProbeA = resolve;
    });
    const probes: string[] = [];
    apiGet.mockImplementation(async (url: string) => {
      if (/^\/api\/courses\/[^/?]+$/.test(url)) {
        const id = url.slice("/api/courses/".length);
        probes.push(id);
        if (id === "course-a") {
          // Held open until the test releases it — after the user has moved on.
          await probeAGate;
          throw new ApiError(404, "not found");
        }
        return { id: "course-b", name: "课程乙", code: "B" };
      }
      if (url.startsWith("/api/courses")) {
        return { items: [], total: 0, page: 1, pageSize: 20, totalPages: 1 };
      }
      if (url.startsWith("/api/questions/tags")) return { tags: [] };
      return pagePayload(1, 3);
    });

    renderPage([
      "/admin/questions?courseId=course-b",
      "/admin/questions?courseId=course-a",
    ]);
    await waitFor(() => expect(probes).toEqual(["course-a"]));

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "后退" }));
    await waitFor(() => expect(courseTrigger()).toHaveTextContent("课程乙"));
    expect(urlSearch()).toContain("courseId=course-b");

    // The 404 belonged to course A's probe. Landing now, it must not delete the
    // courseId the user is actually on — a probe result has to be subject to
    // the navigation identity that is current when it settles.
    //
    // The negative fact has to be observable, so the assertions are taken after
    // the stale continuation has had every chance to run: if it rewrote the URL
    // the list would refetch for the bare query, which both adds a request and
    // clears the filter.
    const callsBefore = questionsCalls().length;
    releaseProbeA();
    await act(async () => {});
    await act(async () => {});
    expect(probes).toEqual(["course-a", "course-b"]);
    expect(questionsCalls()).toHaveLength(callsBefore);
    expect(urlSearch()).toContain("courseId=course-b");
    expect(courseTrigger()).toHaveTextContent("课程乙");
  });

  // ── R1 — a refetch that outlives the render it started in ──
  it("a delete confirmed after the user moved on does not strand the new query", async () => {
    mockPaginated(61);
    let releaseDelete!: () => void;
    const deleteGate = new Promise<void>((resolve) => {
      releaseDelete = resolve;
    });
    apiDelete.mockImplementation(() => deleteGate);

    renderPage("/admin/questions");
    await waitFor(() =>
      expect(within(desktopShell()).getByText("第1题")).toBeInTheDocument(),
    );

    const user = userEvent.setup();
    // Start the delete, then move to page 2 while its confirmation is still in
    // flight.
    await user.click(
      within(desktopShell()).getAllByRole("button", { name: "删除题目" })[0]!,
    );
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "确认",
      }),
    );
    await user.click(screen.getByRole("button", { name: "下一页" }));
    await waitFor(() => expect(urlSearch()).toContain("page=2"));
    await waitFor(() =>
      expect(within(desktopShell()).getByText("第21题")).toBeInTheDocument(),
    );

    releaseDelete();

    // The refetch must target the query the user is on NOW. A render-time
    // closure would issue a page-1 request, which the generation guard would
    // then treat as newest: page 2's own response is discarded, the URL says
    // page 2 while the body shows page 1, and the table never settles.
    await waitFor(() =>
      expect(questionsCalls().at(-1) ?? "").toContain("page=2"),
    );
    await waitFor(() =>
      expect(within(desktopShell()).getByText("第21题")).toBeInTheDocument(),
    );
    expect(within(desktopShell()).queryByText("第1题")).not.toBeInTheDocument();
    expect(urlSearch()).toContain("page=2");
  });

  // ── A16 — the four failure classes ──
  it("A16: a first-load failure is a page-level error, not a permanent loader", async () => {
    apiGet.mockImplementation((url: string) => {
      if (url.startsWith("/api/questions/tags"))
        return Promise.resolve({ tags: [] });
      if (url.startsWith("/api/courses")) {
        return Promise.resolve({
          items: [],
          total: 0,
          page: 1,
          pageSize: 20,
          totalPages: 1,
        });
      }
      return Promise.reject(new Error("boom"));
    });

    renderPage();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("加载考生列表失败");
    expect(screen.queryByText("加载中...")).not.toBeInTheDocument();
  });

  it("A16: a cross-identity failure takes over the page and drops the old rows", async () => {
    apiGet.mockImplementation((url: string) => {
      if (url.startsWith("/api/questions/tags"))
        return Promise.resolve({ tags: [] });
      if (url.startsWith("/api/courses")) {
        return Promise.resolve({
          items: [
            { id: "course-1", name: "课程一", code: "C1" },
            { id: "course-2", name: "课程二", code: "C2" },
          ],
          total: 2,
          page: 1,
          pageSize: 20,
          totalPages: 1,
        });
      }
      if (decodeURIComponent(url).includes("courseId=course-2")) {
        return Promise.reject(new Error("boom"));
      }
      return Promise.resolve(pagePayload(1, 21));
    });

    const user = userEvent.setup();
    renderPage();
    await waitFor(() =>
      expect(within(desktopShell()).getByText("第1题")).toBeInTheDocument(),
    );

    await user.click(courseTrigger());
    await user.click(await screen.findByRole("option", { name: "课程二" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("加载考生列表失败");
    // The old identity's rows are not shown next to the error, and the shell
    // that could keep them is gone.
    expect(screen.queryByText("第1题")).not.toBeInTheDocument();
    expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();
  });

  it("A16: moving on after a failure shows the new query, not the old error", async () => {
    apiGet.mockImplementation((url: string) => {
      if (url.startsWith("/api/questions/tags"))
        return Promise.resolve({ tags: [] });
      if (/^\/api\/courses\/[^/?]+$/.test(url)) {
        // Resolvable (so the filter survives normalization) but the LIST
        // request for it fails — the failure under test.
        const id = url.slice("/api/courses/".length);
        return Promise.resolve({ id, name: `课程${id}`, code: "G" });
      }
      if (url.startsWith("/api/courses")) {
        return Promise.resolve({
          items: [],
          total: 0,
          page: 1,
          pageSize: 20,
          totalPages: 1,
        });
      }
      if (decodeURIComponent(url).includes("courseId=ghost")) {
        return Promise.reject(new Error("boom"));
      }
      return Promise.resolve(pagePayload(1, 21));
    });

    const user = userEvent.setup();
    // Entry 1 is the bare list; entry 2 (current) is the failing query.
    renderPage(["/admin/questions", "/admin/questions?courseId=ghost"]);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("加载考生列表失败");

    await user.click(screen.getByRole("button", { name: "后退" }));
    await waitFor(() =>
      expect(within(desktopShell()).getByText("第1题")).toBeInTheDocument(),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("A16: a same-identity page-turn failure keeps the shell and renders the body error row", async () => {
    apiGet.mockImplementation((url: string) => {
      if (url.startsWith("/api/questions/tags"))
        return Promise.resolve({ tags: [] });
      if (url.startsWith("/api/courses")) {
        return Promise.resolve({
          items: [],
          total: 0,
          page: 1,
          pageSize: 20,
          totalPages: 1,
        });
      }
      const page = Number(new URLSearchParams(url.split("?")[1]).get("page"));
      if (page === 2) return Promise.reject(new Error("boom"));
      return Promise.resolve(pagePayload(1, 41));
    });

    const user = userEvent.setup();
    renderPage();
    await waitFor(() =>
      expect(within(desktopShell()).getByText("第1题")).toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: "下一页" }));
    // The shell survives (no page-level takeover) and the body states the
    // failure — the page-level error path would unmount the toolbar.
    await waitFor(() =>
      expect(
        within(desktopShell()).getByText("加载考生列表失败"),
      ).toBeInTheDocument(),
    );
    expect(screen.getByRole("toolbar")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("A16: a same-identity page-turn failure does not persist into the next page turn", async () => {
    let releasePage3!: () => void;
    const page3Gate = new Promise<void>((resolve) => {
      releasePage3 = resolve;
    });
    let page3Held = false;
    apiGet.mockImplementation(async (url: string) => {
      if (url.startsWith("/api/questions/tags")) return { tags: [] };
      if (url.startsWith("/api/courses")) {
        return { items: [], total: 0, page: 1, pageSize: 20, totalPages: 1 };
      }
      const page = Number(new URLSearchParams(url.split("?")[1]).get("page"));
      if (page === 2) throw new Error("boom");
      if (page === 3) {
        page3Held = true;
        await page3Gate;
      }
      return pagePayload(page, 61);
    });

    const user = userEvent.setup();
    renderPage();
    await waitFor(() =>
      expect(within(desktopShell()).getByText("第1题")).toBeInTheDocument(),
    );
    await user.click(screen.getByRole("button", { name: "下一页" }));
    await waitFor(() =>
      expect(
        within(desktopShell()).getByText("加载考生列表失败"),
      ).toBeInTheDocument(),
    );

    // The next page turn is a different request. The failure belongs to page
    // 2's request key, so the IN-FLIGHT window of page 3 must already be the
    // page-turn window again — asserting only the settled state would let an
    // implementation that keys `failed` on the identity keep the old error row
    // (and its missing busy signal) on screen for the whole request.
    await user.click(screen.getByRole("button", { name: "下一页" }));
    await waitFor(() => expect(page3Held).toBe(true));
    expect(
      within(desktopShell()).queryByText("加载考生列表失败"),
    ).not.toBeInTheDocument();
    expect(
      within(desktopShell()).getByRole("table").querySelector("tbody"),
    ).toHaveAttribute("aria-busy", "true");

    releasePage3();
    await waitFor(() =>
      expect(within(desktopShell()).getByText("第41题")).toBeInTheDocument(),
    );
    expect(
      within(desktopShell()).queryByText("加载考生列表失败"),
    ).not.toBeInTheDocument();
  });

  // ── A10 — a clamp that happens mid-session (the identity is already loaded) ──
  it("A10: a mid-session out-of-range page keeps the recovery window open until its own response lands", async () => {
    let releaseClamp!: () => void;
    const clampGate = new Promise<void>((resolve) => {
      releaseClamp = resolve;
    });
    let clampHeld = false;
    apiGet.mockImplementation(async (url: string) => {
      if (url.startsWith("/api/questions/tags")) return { tags: [] };
      if (url.startsWith("/api/courses")) {
        return { items: [], total: 0, page: 1, pageSize: 20, totalPages: 1 };
      }
      const page = Number(new URLSearchParams(url.split("?")[1]).get("page"));
      // Page 5 is out of range (4 pages) → an empty response the page must
      // normalize; page 4 is the clamp target and is held open.
      if (page === 5) return pagePayload(5, 61);
      if (page === 4) {
        clampHeld = true;
        await clampGate;
      }
      return pagePayload(page, 61);
    });

    const user = userEvent.setup();
    // Mount settled on page 1, then FORWARD into the out-of-range page: the
    // identity is already loaded, so the recovery window is the only thing that
    // can keep the body from rendering page 1's rows as page 4's result.
    renderPage(["/admin/questions", "/admin/questions?page=5"], {
      initialIndex: 0,
    });
    await waitFor(() =>
      expect(within(desktopShell()).getByText("第1题")).toBeInTheDocument(),
    );
    await user.click(screen.getByRole("button", { name: "前进" }));
    await waitFor(() => expect(clampHeld).toBe(true));

    // Exactly one jump, and the URL names the page being loaded. The window is
    // still open: the previous page's rows belong to a page the URL no longer
    // names, and no empty state may be rendered.
    await waitFor(() => expect(urlSearch()).toContain("page=4"));
    expect(within(desktopShell()).queryByText("第1题")).not.toBeInTheDocument();
    expect(screen.queryByText("未找到匹配的题目")).not.toBeInTheDocument();
    expect(screen.queryByText("暂无题目")).not.toBeInTheDocument();

    releaseClamp();
    await waitFor(() =>
      expect(within(desktopShell()).getByText("第61题")).toBeInTheDocument(),
    );
  });

  it("A16: a clamp refetch that fails leaves the pending state and reports it", async () => {
    apiGet.mockImplementation((url: string) => {
      if (url.startsWith("/api/questions/tags"))
        return Promise.resolve({ tags: [] });
      if (url.startsWith("/api/courses")) {
        return Promise.resolve({
          items: [],
          total: 0,
          page: 1,
          pageSize: 20,
          totalPages: 1,
        });
      }
      const page = Number(new URLSearchParams(url.split("?")[1]).get("page"));
      // 21 records ⇒ page 3 is out of range, so the recovery refetch happens.
      if (page > 2) {
        return Promise.resolve({ ...pagePayload(1, 21), page, items: [] });
      }
      return Promise.reject(new Error("boom"));
    });

    renderPage("/admin/questions?page=3");
    // The recovery refetch fails: the page must leave the pending state and
    // state the failure rather than loading forever.
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("加载考生列表失败");
    expect(screen.queryByText("加载中...")).not.toBeInTheDocument();
  });

  // ── A18 — a selected tag outside the vocabulary stays observable ──
  it("A18: a selected tag the vocabulary does not offer is listed and can be removed", async () => {
    apiGet.mockImplementation((url: string) => {
      if (url.startsWith("/api/questions/tags")) {
        return Promise.resolve({ tags: ["代数", "几何"] });
      }
      if (url.startsWith("/api/courses")) {
        return Promise.resolve({
          items: [{ id: "course-1", name: "课程一", code: "C1" }],
          total: 1,
          page: 1,
          pageSize: 20,
          totalPages: 1,
        });
      }
      return Promise.resolve(pagePayload(1, 2));
    });

    const user = userEvent.setup();
    renderPage(
      "/admin/questions?tags=%E4%BB%A3%E6%95%B0,%E9%99%88%E6%97%A7%E6%A0%87%E7%AD%BE",
    );
    await screen.findByText("题目管理");
    expect(screen.getByRole("button", { name: "标签筛选" })).toHaveTextContent(
      "代数 +1",
    );

    await user.click(screen.getByRole("button", { name: "标签筛选" }));
    // The non-vocabulary tag is listed as a checked option...
    const stale = await screen.findByRole("checkbox", { name: "陈旧标签" });
    expect(stale).toBeChecked();
    // ...and can be removed on its own, without touching the other tag.
    await user.click(stale);
    await waitFor(() => {
      const last = questionsCalls().at(-1) ?? "";
      expect(last).toContain("tags=代数");
      expect(last).not.toContain("陈旧标签");
    });
    expect(urlSearch()).not.toContain("%E9%99%88%E6%97%A7");
  });

  // ── Internal navigation carries the list query ──
  it("carries the current list query into an edit navigation", async () => {
    mockPaginated(61);
    const user = userEvent.setup();
    renderPage("/admin/questions?courseId=course-1&page=2");
    await waitFor(() =>
      expect(within(desktopShell()).getByText("第21题")).toBeInTheDocument(),
    );

    await user.click(
      within(desktopShell()).getAllByRole("button", { name: "编辑题目" })[0]!,
    );
    expect(await screen.findByText("编辑页")).toBeInTheDocument();
    // The list URL is CARRIED, not merely left behind: the exit needs it to
    // restore the query without a browser Back. Asserting only that the editor
    // rendered would let a write-side that passes no state pass this test.
    expect(screen.getByTestId("location-state").textContent).toBe(
      JSON.stringify({ from: "/admin/questions?courseId=course-1&page=2" }),
    );
  });
});
