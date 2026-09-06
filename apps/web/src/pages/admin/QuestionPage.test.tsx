import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import { AuthProvider } from "@/contexts/AuthContext";
import { BrandProvider } from "@/components/layout/BrandProvider";
import { QuestionPage } from "./QuestionPage";
import { permissionsForRole } from "@exam/authz";

const { apiGet } = vi.hoisted(() => ({
  apiGet: vi.fn().mockImplementation((path: string) => {
    if (path.startsWith("/api/courses")) {
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
    if (path === "/api/questions/tags") {
      return Promise.resolve({ tags: ["代数", "几何", "概率"] });
    }

    return Promise.resolve({
      items: [
        {
          id: "q1",
          courseId: "course-1",
          type: "single_choice",
          content: "题目一内容",
          score: 10,
          difficulty: 1,
          tags: ["tag1"],
        },
      ],
      total: 21,
      page: 1,
      pageSize: 20,
      totalPages: 2,
    });
  }),
}));

const questionsCalls = () =>
  apiGet.mock.calls
    .filter(
      (call) =>
        typeof call[0] === "string" &&
        (call[0] as string).startsWith("/api/questions?"),
    )
    .map((call) => call[0] as string);

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

/** A never-settling promise plus its settle controls, for deterministic ordering tests. */
function deferredQuestions() {
  let resolve!: (value: QuestionListPayload) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<QuestionListPayload>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function questionListPayload(
  content: string,
  total: number,
): QuestionListPayload {
  return {
    items: [
      {
        id: `q-${content}`,
        courseId: "course-1",
        type: "true_false",
        content,
        score: 2,
        difficulty: 1,
        tags: ["tag1"],
      },
    ],
    total,
    page: 1,
    pageSize: 20,
    totalPages: 1,
  };
}

/** The desktop table shell region (rows also render in the mobile card list). */
function desktopShell(): HTMLElement {
  // C3: admin-table-shell now contains both mobile and desktop regions via
  // ResponsiveRepresentation. Scope to the desktop region so queries don't
  // match mobile card content (jsdom doesn't apply CSS visibility).
  return document.querySelector(
    '[data-slot="admin-table-shell"] [data-slot="responsive-desktop-region"]',
  ) as HTMLElement;
}

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
    delete: vi.fn().mockResolvedValue(undefined),
  },
  setNavigate: () => {},
}));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/admin/questions"]}>
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
          </Routes>
        </BrandProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("QuestionPage", () => {
  it("clears filters and keeps the page shell visible during table reload", async () => {
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText("题目管理")).toBeInTheDocument();
    // The DataWorkbench renders a single continuous shell whose toolbar,
    // desktop table, and footer are regions of one surface. The desktop table
    // (hidden below lg) and mobile card list (hidden at lg+) are separate
    // regions; scope content assertions to the desktop table shell so a single
    // row's content isn't matched twice.
    const workbench = document.querySelector(
      '[data-slot="data-workbench"]',
    ) as HTMLElement;
    expect(workbench).toHaveClass("surface-content", "overflow-hidden");
    const desktop = desktopShell();
    // toolbar and footer are both regions inside the single workbench shell.
    expect(workbench.contains(screen.getByRole("toolbar"))).toBe(true);
    await waitFor(() =>
      expect(within(desktop).getByText("题目一内容")).toBeInTheDocument(),
    );
    // after load, the desktop table content and footer live in one shell.
    expect(workbench.contains(within(desktop).getByText("题目一内容"))).toBe(
      true,
    );
    expect(screen.getByRole("toolbar")).toHaveAttribute(
      "data-toolbar-appearance",
      "quiet",
    );
    expect(within(desktop).getByText("tag1")).toHaveAttribute(
      "data-tag-tone",
      "neutral",
    );

    const pendingQuestions = new Promise(() => {});
    apiGet.mockImplementationOnce(() => pendingQuestions);

    await user.click(screen.getByRole("button", { name: "下一页" }));

    expect(screen.getByText("题目管理")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByText("加载中…")).toBeInTheDocument();

    apiGet.mockImplementation((path: string) => {
      if (path.startsWith("/api/courses")) {
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
      // Keep the tag-vocabulary branch: mockImplementation persists across
      // tests, and later tests rely on the vocabulary fixture.
      if (path === "/api/questions/tags") {
        return Promise.resolve({ tags: ["代数", "几何", "概率"] });
      }

      return Promise.resolve({
        items: [
          {
            id: "q1",
            courseId: "course-1",
            type: "single_choice",
            content: "题目一内容",
            score: 10,
            difficulty: 1,
            tags: ["tag1"],
          },
        ],
        total: 21,
        page: 1,
        pageSize: 20,
        totalPages: 2,
      });
    });

    fireEvent.change(screen.getByLabelText("搜索题目"), {
      target: { value: "题目" },
    });
    // Select one tag through the structured filter, then clear all filters.
    await user.click(screen.getByRole("button", { name: "标签筛选" }));
    await user.click(await screen.findByRole("checkbox", { name: "代数" }));
    await user.click(screen.getByRole("button", { name: "清空筛选" }));

    await waitFor(() => {
      // The tag filter trigger is back to its empty placeholder state and
      // the free-text search box is empty again.
      expect(
        within(screen.getByRole("button", { name: "标签筛选" })).getByText(
          "标签",
        ),
      ).toBeInTheDocument();
      expect(screen.getByLabelText("搜索题目")).toHaveValue("");
      expect(screen.getByText(/共 21 条/)).toBeInTheDocument();
    });
  });

  it("filters tags via the structured multi-select with AND semantics", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("题目管理");

    await user.click(screen.getByRole("button", { name: "标签筛选" }));
    await user.click(await screen.findByRole("checkbox", { name: "代数" }));
    await user.click(screen.getByRole("checkbox", { name: "几何" }));

    await waitFor(() => {
      const last = questionsCalls().at(-1) ?? "";
      expect(decodeURIComponent(last)).toContain("tags=代数,几何");
    });
    // AND hint is visible so the multi-tag behavior is not a guess.
    expect(screen.getByText("多标签为同时包含")).toBeInTheDocument();
  });

  it("narrows the tag vocabulary by search inside the dropdown", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("题目管理");

    await user.click(screen.getByRole("button", { name: "标签筛选" }));
    await user.type(await screen.findByLabelText("搜索标签"), "概率");
    expect(screen.getByRole("checkbox", { name: "概率" })).toBeInTheDocument();
    expect(
      screen.queryByRole("checkbox", { name: "代数" }),
    ).not.toBeInTheDocument();
  });

  it("removes a single tag without clearing the others", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("题目管理");

    await user.click(screen.getByRole("button", { name: "标签筛选" }));
    await user.click(await screen.findByRole("checkbox", { name: "代数" }));
    await user.click(screen.getByRole("checkbox", { name: "几何" }));
    await user.click(screen.getByRole("checkbox", { name: "几何" }));

    await waitFor(() => {
      const last = questionsCalls().at(-1) ?? "";
      expect(decodeURIComponent(last)).toContain("tags=代数");
      expect(decodeURIComponent(last)).not.toContain("几何");
    });
  });

  it("clears all selected tags from the dropdown footer", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("题目管理");

    await user.click(screen.getByRole("button", { name: "标签筛选" }));
    await user.click(await screen.findByRole("checkbox", { name: "代数" }));
    await user.click(screen.getByRole("button", { name: "清除已选" }));

    await waitFor(() => {
      const last = questionsCalls().at(-1) ?? "";
      expect(last).not.toContain("tags=");
    });
  });

  it("supports keyboard operation of the tag filter", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("题目管理");

    const trigger = screen.getByRole("button", { name: "标签筛选" });
    trigger.focus();
    await user.keyboard("{Enter}");
    const checkbox = await screen.findByRole("checkbox", { name: "代数" });
    checkbox.focus();
    await user.keyboard(" ");

    await waitFor(() => {
      const last = questionsCalls().at(-1) ?? "";
      expect(decodeURIComponent(last)).toContain("tags=代数");
    });
  });

  // P0 stale-response ordering: rapid multi-select makes A -> A+B request
  // overlap a normal path. The generation guard must keep the table on the
  // NEWER (A+B) result even when the stale A response resolves last.
  it("ignores a stale tag-filter response that resolves after the newer one", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("题目管理");
    await waitFor(() =>
      expect(
        within(desktopShell()).getByText("题目一内容"),
      ).toBeInTheDocument(),
    );

    const staleA = deferredQuestions();
    const newerAB = deferredQuestions();

    await user.click(screen.getByRole("button", { name: "标签筛选" }));
    // 1. select A — request 1 (tags=代数) stays pending
    apiGet.mockImplementationOnce(() => staleA.promise);
    await user.click(await screen.findByRole("checkbox", { name: "代数" }));
    // 2. select B before A resolves — request 2 (tags=代数,几何) pending
    apiGet.mockImplementationOnce(() => newerAB.promise);
    await user.click(screen.getByRole("checkbox", { name: "几何" }));

    // 3. the A+B response resolves FIRST — table shows the A+B result
    await act(async () => {
      newerAB.resolve(questionListPayload("A+B 结果题目", 5));
    });
    await waitFor(() =>
      expect(
        within(desktopShell()).getByText("A+B 结果题目"),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText(/共 5 条/)).toBeInTheDocument();

    // 4. the stale A-only response resolves SECOND — it must not mutate
    //    questions, total, error, or loading state.
    await act(async () => {
      staleA.resolve(questionListPayload("仅 A 结果题目", 7));
    });
    expect(
      within(desktopShell()).getByText("A+B 结果题目"),
    ).toBeInTheDocument();
    expect(screen.queryByText("仅 A 结果题目")).not.toBeInTheDocument();
    expect(screen.getByText(/共 5 条/)).toBeInTheDocument();
    expect(screen.queryByText(/共 7 条/)).not.toBeInTheDocument();
    // loading is owned by the newest request and already settled
    expect(screen.getByText("加载中…")).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByText("加载考生列表失败")).not.toBeInTheDocument();
  });

  it("ignores a stale tag-filter request that rejects after a newer one resolved", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("题目管理");
    await waitFor(() =>
      expect(
        within(desktopShell()).getByText("题目一内容"),
      ).toBeInTheDocument(),
    );

    const staleA = deferredQuestions();
    const newerAB = deferredQuestions();

    await user.click(screen.getByRole("button", { name: "标签筛选" }));
    apiGet.mockImplementationOnce(() => staleA.promise);
    await user.click(await screen.findByRole("checkbox", { name: "代数" }));
    apiGet.mockImplementationOnce(() => newerAB.promise);
    await user.click(screen.getByRole("checkbox", { name: "几何" }));

    await act(async () => {
      newerAB.resolve(questionListPayload("A+B 结果题目", 5));
    });
    await waitFor(() =>
      expect(
        within(desktopShell()).getByText("A+B 结果题目"),
      ).toBeInTheDocument(),
    );

    // The stale request fails late — its failure must not surface an error.
    await act(async () => {
      staleA.reject(new Error("stale request failed"));
    });
    expect(
      within(desktopShell()).getByText("A+B 结果题目"),
    ).toBeInTheDocument();
    expect(screen.getByText(/共 5 条/)).toBeInTheDocument();
    expect(screen.getByText("加载中…")).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByText("加载考生列表失败")).not.toBeInTheDocument();
  });
});
