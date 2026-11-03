import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import { AuthProvider } from "@/contexts/AuthContext";
import { BrandProvider } from "@/components/layout/BrandProvider";
import { CoursePage } from "./CoursePage";
import { permissionsForRole } from "@exam/authz";

const { apiGet, apiPost, apiPatch, apiDelete } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPatch: vi.fn(),
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
    post: (...args: unknown[]) => apiPost(...args),
    patch: (...args: unknown[]) => apiPatch(...args),
    delete: (...args: unknown[]) => apiDelete(...args),
  },
  setNavigate: () => {},
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/admin/courses"]}>
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
            <Route path="/admin/courses" element={<CoursePage />} />
          </Routes>
        </BrandProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

const mockCourses = [
  {
    id: "c1",
    name: "数学",
    code: "MATH101",
    description: "高等数学",
    createdAt: "2025-01-01",
    updatedAt: "2025-01-01",
  },
  {
    id: "c2",
    name: "英语",
    code: "ENG101",
    description: "大学英语",
    createdAt: "2025-01-02",
    updatedAt: "2025-01-02",
  },
];

describe("CoursePage", () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPost.mockReset();
    apiPatch.mockReset();
    apiDelete.mockReset();
    // #785: the list is server-searched and server-paginated — the default
    // mock honors page/pageSize/search like the real route.
    apiGet.mockImplementation((path: string) => {
      if (!path.startsWith("/api/courses")) {
        return Promise.resolve({});
      }
      const params = new URLSearchParams(path.split("?")[1] ?? "");
      const page = Number(params.get("page") ?? "1");
      const pageSize = Number(params.get("pageSize") ?? "20");
      const search = (params.get("search") ?? "").trim().toLowerCase();
      const matched = search
        ? mockCourses.filter(
            (c) =>
              c.name.toLowerCase().includes(search) ||
              c.code.toLowerCase().includes(search),
          )
        : mockCourses;
      const start = (page - 1) * pageSize;
      return Promise.resolve({
        items: matched.slice(start, start + pageSize),
        total: matched.length,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(matched.length / pageSize)),
      });
    });
    apiPost.mockResolvedValue({ id: "c3" });
    apiPatch.mockResolvedValue(undefined);
    apiDelete.mockResolvedValue(undefined);
  });

  it("renders course list", async () => {
    renderPage();
    // Row content renders twice by design (desktop table + mobile cards);
    // scope to the desktop table representation.
    const table = await screen.findByRole("table");
    expect(within(table).getByText("数学")).toBeInTheDocument();
    expect(within(table).getByText("MATH101")).toBeInTheDocument();
    expect(within(table).getByText("英语")).toBeInTheDocument();
  });

  it("opens create dialog", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "新增课程" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/课程名称/)).toHaveValue("");
    expect(within(dialog).getByLabelText(/课程代码/)).toHaveValue("");
  });

  it("exposes required state and hides the visual asterisk from AT", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "新增课程" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText(/课程名称/)).toBeRequired();
    expect(within(dialog).getByLabelText(/课程代码/)).toBeRequired();
    const nameLabel = within(dialog).getByText("课程名称").closest("label")!;
    const codeLabel = within(dialog).getByText("课程代码").closest("label")!;
    expect(within(nameLabel).getByText("*")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(within(codeLabel).getByText("*")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });

  it("shows validation errors for empty fields", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "新增课程" }));
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(screen.getByText("请输入课程名称")).toBeInTheDocument();
    expect(screen.getByText("请输入课程代码")).toBeInTheDocument();
  });

  it("creates a new course", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "新增课程" }));
    await user.type(screen.getByLabelText(/课程名称/), "物理");
    await user.type(screen.getByLabelText(/课程代码/), "PHY101");
    await user.type(screen.getByLabelText("描述"), "大学物理");
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(apiPost).toHaveBeenCalledWith("/api/courses", {
      name: "物理",
      code: "PHY101",
      description: "大学物理",
    });
  });

  it("clears field error on input change", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "新增课程" }));
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(screen.getByText("请输入课程名称")).toBeInTheDocument();
    await user.type(screen.getByLabelText(/课程名称/), "物理");
    expect(screen.queryByText("请输入课程名称")).not.toBeInTheDocument();
  });

  it("opens edit dialog with course data", async () => {
    const user = userEvent.setup();
    renderPage();
    const editButtons = await screen.findAllByLabelText("编辑课程");
    await user.click(editButtons[0]!);
    expect(screen.getByText("编辑课程")).toBeInTheDocument();
    expect(screen.getByLabelText(/课程名称/)).toHaveValue("数学");
    expect(screen.getByLabelText(/课程代码/)).toHaveValue("MATH101");
  });

  it("saves edited course", async () => {
    const user = userEvent.setup();
    renderPage();
    const editButtons = await screen.findAllByLabelText("编辑课程");
    await user.click(editButtons[0]!);
    const nameInput = screen.getByLabelText(/课程名称/);
    await user.clear(nameInput);
    await user.type(nameInput, "高等数学A");
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(apiPatch).toHaveBeenCalledWith("/api/courses/c1", {
      name: "高等数学A",
      code: "MATH101",
      description: "高等数学",
    });
  });

  it("deletes a course after confirmation", async () => {
    const user = userEvent.setup();
    renderPage();
    const deleteButtons = await screen.findAllByLabelText("删除课程");
    await user.click(deleteButtons[0]!);
    const dialog = await screen.findByRole("alertdialog");
    const confirmBtn = within(dialog).getByRole("button", { name: "确认" });
    await user.click(confirmBtn);
    expect(apiDelete).toHaveBeenCalledWith("/api/courses/c1");
  });

  it("searches courses by name", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("table");
    await user.type(screen.getByPlaceholderText("搜索课程名称或代码..."), "数");
    await waitFor(() => {
      const [lastUrl] = apiGet.mock.lastCall!;
      expect(
        new URLSearchParams(String(lastUrl).split("?")[1]).get("search"),
      ).toBe("数");
    });
    // Sync on the filtered render (英语 drops out) before asserting 数学.
    await waitFor(() => {
      expect(
        within(screen.getByRole("table")).queryByText("英语"),
      ).not.toBeInTheDocument();
    });
    expect(
      within(screen.getByRole("table")).getByText("数学"),
    ).toBeInTheDocument();
  });

  it("searches courses by code", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("table");
    await user.type(
      screen.getByPlaceholderText("搜索课程名称或代码..."),
      "ENG",
    );
    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledWith(
        "/api/courses?page=1&pageSize=20&search=ENG",
      );
    });
    await waitFor(() => {
      expect(
        within(screen.getByRole("table")).queryByText("数学"),
      ).not.toBeInTheDocument();
    });
    expect(
      within(screen.getByRole("table")).getByText("英语"),
    ).toBeInTheDocument();
  });

  it("shows empty search result state with clear action", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("table");
    await user.type(
      screen.getByPlaceholderText("搜索课程名称或代码..."),
      "不存在",
    );
    expect(
      await screen.findByRole("heading", { name: "未找到匹配的课程" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("搜索课程")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "清除课程搜索" }));
    await waitFor(() => {
      expect(apiGet).toHaveBeenLastCalledWith(
        "/api/courses?page=1&pageSize=20",
      );
    });
    expect(
      await within(await screen.findByRole("table")).findByText("数学"),
    ).toBeInTheDocument();
    await user.type(screen.getByLabelText("搜索课程"), "不存在");
    await waitFor(() => {
      const [lastUrl] = apiGet.mock.lastCall!;
      expect(
        new URLSearchParams(String(lastUrl).split("?")[1]).get("search"),
      ).toBe("不存在");
    });
    // The empty-state action only exists once the no-match response rendered.
    await user.click(await screen.findByRole("button", { name: "清除搜索" }));
    await waitFor(() => {
      expect(apiGet).toHaveBeenLastCalledWith(
        "/api/courses?page=1&pageSize=20",
      );
    });
    expect(
      await within(await screen.findByRole("table")).findByText("英语"),
    ).toBeInTheDocument();
  });

  it("shows error state when loading fails", async () => {
    apiGet.mockRejectedValue(new Error("fail"));
    renderPage();
    expect(await screen.findByText("加载课程列表失败")).toBeInTheDocument();
  });

  it("shows empty state when no courses", async () => {
    apiGet.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
      totalPages: 0,
    });
    renderPage();
    expect(
      await screen.findByRole("heading", { name: "暂无课程" }),
    ).toBeInTheDocument();
  });

  it("shows saving state during save", async () => {
    let resolveSave: (value: unknown) => void;
    apiPost.mockReturnValue(
      new Promise((resolve) => {
        resolveSave = resolve;
      }),
    );
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "新增课程" }));
    await user.type(screen.getByLabelText(/课程名称/), "物理");
    await user.type(screen.getByLabelText(/课程代码/), "PHY101");
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(screen.getByText("保存中...")).toBeInTheDocument();
    resolveSave!({ id: "c3" });
    await waitFor(() => {
      expect(screen.queryByText("保存中...")).not.toBeInTheDocument();
    });
  });

  it("closes dialog on cancel", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "新增课程" }));
    const dialog = screen.getByRole("dialog");
    const cancelBtn = within(dialog)
      .getAllByRole("button")
      .find((b) => b.textContent === "取消")!;
    await user.click(cancelBtn);
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("does not show search when no courses exist", async () => {
    apiGet.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
      totalPages: 0,
    });
    renderPage();
    await screen.findByRole("heading", { name: "暂无课程" });
    expect(
      screen.queryByPlaceholderText("搜索课程名称或代码..."),
    ).not.toBeInTheDocument();
  });
});

/**
 * #785 BDD acceptance — L2 (component level; mocked API with the REAL
 * paginated response shape). Scenario source:
 * docs/design/admin-list-pagination-bdd.md (B03).
 */
describe("CoursePage #785 server-side search and pagination (BDD L2)", () => {
  function courseRow(id: string, name: string, code: string) {
    return {
      id,
      name,
      code,
      description: "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  /** Serves /api/courses with real pagination shapes, honoring page and search. */
  function mockCourseApi(all: ReturnType<typeof courseRow>[]) {
    apiGet.mockImplementation(async (url: string) => {
      if (!url.startsWith("/api/courses")) {
        throw new Error(`unexpected GET ${url}`);
      }
      const params = new URLSearchParams(url.split("?")[1] ?? "");
      const page = Number(params.get("page") ?? "1");
      const pageSize = Number(params.get("pageSize") ?? "20");
      const search = (params.get("search") ?? "").trim().toLowerCase();
      const matched = search
        ? all.filter(
            (c) =>
              c.name.toLowerCase().includes(search) ||
              c.code.toLowerCase().includes(search),
          )
        : all;
      const start = (page - 1) * pageSize;
      return {
        items: matched.slice(start, start + pageSize),
        total: matched.length,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(matched.length / pageSize)),
      };
    });
  }

  it("B03: courses beyond the first page are reachable and the total is real", async () => {
    const user = userEvent.setup();
    const all = Array.from({ length: 21 }, (_, i) =>
      courseRow(
        `co${i + 1}`,
        `课程${String(i + 1).padStart(2, "0")}`,
        `C${i + 1}`,
      ),
    );
    mockCourseApi(all);

    renderPage();
    const table = await screen.findByRole("table");
    expect(within(table).getByText("课程01")).toBeInTheDocument();
    expect(within(table).queryByText("课程21")).not.toBeInTheDocument();
    expect(screen.getByText(/共 21 条/)).toBeInTheDocument();
    expect(apiGet).toHaveBeenCalledWith("/api/courses?page=1&pageSize=20");

    await user.click(screen.getByRole("button", { name: "下一页" }));
    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledWith("/api/courses?page=2&pageSize=20");
    });
    expect(
      await within(await screen.findByRole("table")).findByText("课程21"),
    ).toBeInTheDocument();
  });

  // 15s budget, same as the staff-pagination precedent in UsersPage.test.tsx:
  // seven real-timer keystrokes against a 300ms debounce plus five settled
  // assertions over 20-row re-renders put this interaction class past the
  // 10s CI testTimeout under coverage contention (#858).
  it("B03: search queries the server full set and survives page flips", async () => {
    const user = userEvent.setup();
    const all = [
      ...Array.from({ length: 25 }, (_, i) =>
        courseRow(`co${i + 1}`, `bulk785 课程${i + 1}`, `B785-${i + 1}`),
      ),
      ...Array.from({ length: 15 }, (_, i) =>
        courseRow(`ot${i + 1}`, `其他课程${i + 1}`, `OTH-${i + 1}`),
      ),
    ];
    mockCourseApi(all);

    renderPage();
    await screen.findByRole("table");
    await user.type(screen.getByLabelText("搜索课程"), "bulk785");
    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledWith(
        "/api/courses?page=1&pageSize=20&search=bulk785",
      );
    });
    expect(await screen.findByText(/共 25 条/)).toBeInTheDocument();

    // Paging keeps the search condition.
    await user.click(screen.getByRole("button", { name: "下一页" }));
    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledWith(
        "/api/courses?page=2&pageSize=20&search=bulk785",
      );
    });

    // Clearing restores the unfiltered full set on page 1.
    await user.click(screen.getByRole("button", { name: "清除课程搜索" }));
    await waitFor(() => {
      expect(apiGet).toHaveBeenLastCalledWith(
        "/api/courses?page=1&pageSize=20",
      );
    });
    expect(await screen.findByText(/共 40 条/)).toBeInTheDocument();
  }, 15_000);

  it("B07: deleting the only course on page 2 steps back to page 1", async () => {
    const user = userEvent.setup();
    let deleted = false;
    const page1 = Array.from({ length: 20 }, (_, i) =>
      courseRow(`co${i + 1}`, `课程${i + 1}`, `C${i + 1}`),
    );
    apiGet.mockImplementation(async (url: string) => {
      if (!url.startsWith("/api/courses")) {
        throw new Error(`unexpected GET ${url}`);
      }
      const params = new URLSearchParams(url.split("?")[1] ?? "");
      const page = Number(params.get("page") ?? "1");
      const total = deleted ? 20 : 21;
      return {
        items:
          page === 1
            ? page1
            : deleted
              ? []
              : [courseRow("co21", "待删除课程", "C21")],
        total,
        page,
        pageSize: 20,
        totalPages: Math.max(1, Math.ceil(total / 20)),
      };
    });
    apiDelete.mockImplementation(async () => {
      deleted = true;
    });

    renderPage();
    await screen.findByRole("table");
    await user.click(screen.getByRole("button", { name: "下一页" }));
    expect(
      await within(await screen.findByRole("table")).findByText("待删除课程"),
    ).toBeInTheDocument();

    await user.click(
      within(await screen.findByRole("table")).getByRole("button", {
        name: "删除课程",
      }),
    );
    await user.click(await screen.findByRole("button", { name: "确认" }));

    await waitFor(() => {
      expect(apiDelete).toHaveBeenCalledWith("/api/courses/co21");
    });
    await waitFor(() => {
      expect(apiGet).toHaveBeenLastCalledWith(
        "/api/courses?page=1&pageSize=20",
      );
    });
    expect(
      await within(await screen.findByRole("table")).findByText("课程1"),
    ).toBeInTheDocument();
  });
});
