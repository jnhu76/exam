import {
  act,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { toast } from "sonner";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { AuthProvider } from "@/contexts/AuthContext";
import { BrandProvider } from "@/components/layout/BrandProvider";
import { ApiError } from "@/lib/api";
import { CandidatesPage } from "./CandidatesPage";
import { permissionsForRole } from "@exam/authz";

const { apiGet, apiPost, apiPatch } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPatch: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  ApiError: class ApiError extends Error {
    constructor(
      readonly status: number,
      message: string,
      readonly code?: string,
      readonly details?: unknown,
      readonly requestId?: string,
      readonly serverMessage?: string,
    ) {
      super(message);
      this.name = "ApiError";
      this.serverMessage = serverMessage ?? message;
    }
  },
  api: {
    get: (...args: unknown[]) => apiGet(...args),
    post: (...args: unknown[]) => apiPost(...args),
    patch: (...args: unknown[]) => apiPatch(...args),
  },
  setNavigate: () => {},
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

const mockFields = [
  {
    id: "cf1",
    name: "employeeId",
    label: "编号",
    fieldType: "number",
    required: true,
    unique: true,
    sortOrder: 0,
  },
  {
    id: "cf2",
    name: "department",
    label: "部门",
    fieldType: "select",
    required: false,
    unique: false,
    sortOrder: 1,
  },
];

const mockCandidates = [
  {
    id: "c1",
    userId: "u1",
    username: "candidate1",
    name: "Candidate One",
    isActive: true,
    fields: { employeeId: "E001" },
  },
  {
    id: "c2",
    userId: "u2",
    username: "candidate2",
    name: "Candidate Two",
    isActive: false,
    fields: { employeeId: "E002" },
  },
];

/** Surfaces the router's current search string for URL-state assertions. */
function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-search">{location.search}</div>;
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/admin/candidates"]}>
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
            <Route path="/admin/candidates" element={<CandidatesPage />} />
            <Route
              path="/admin/recovery"
              element={
                <>
                  <LocationProbe />
                  <div data-testid="recovery-queue-stub" />
                </>
              }
            />
          </Routes>
        </BrandProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

function dialogSaveBtn(dialog: HTMLElement) {
  return within(dialog)
    .getAllByRole("button")
    .find((b) => b.textContent === "保存")!;
}

/** Open a row's overflow menu and return it (row actions with N>2 live in
 * the kebab under the typed RowActions API). */
async function openRowMenu(
  user: ReturnType<typeof userEvent.setup>,
  index = 0,
) {
  // Row actions render twice by design (desktop table + mobile cards);
  // index rows within the desktop table representation.
  const table = screen.getByRole("table");
  const kebabs = await within(table).findAllByRole("button", {
    name: "更多操作",
  });
  await user.click(kebabs[index]!);
  return await screen.findByRole("menu");
}

/** Last /api/candidates call URL (parallel field fetches bypass lastCall). */
function lastCandidatesUrl(): string {
  const calls = apiGet.mock.calls as unknown as Array<[string]>;
  for (let i = calls.length - 1; i >= 0; i--) {
    if (calls[i]![0].startsWith("/api/candidates")) return calls[i]![0];
  }
  return "";
}

describe("CandidatesPage", () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPost.mockReset();
    apiPatch.mockReset();
    // #785: the list is server-searched and server-paginated — the default
    // mock honors page/pageSize/search like the real route.
    apiGet.mockImplementation((path: string) => {
      if (path === "/api/candidate-fields")
        return Promise.resolve([...mockFields]);
      if (path.startsWith("/api/candidates")) {
        const params = new URLSearchParams(path.split("?")[1] ?? "");
        const page = Number(params.get("page") ?? "1");
        const pageSize = Number(params.get("pageSize") ?? "20");
        const search = (params.get("search") ?? "").trim().toLowerCase();
        const matched = search
          ? mockCandidates.filter(
              (c) =>
                c.name.toLowerCase().includes(search) ||
                c.username.toLowerCase().includes(search),
            )
          : mockCandidates;
        const start = (page - 1) * pageSize;
        return Promise.resolve({
          items: matched.slice(start, start + pageSize),
          total: matched.length,
          page,
          pageSize,
          totalPages: Math.max(1, Math.ceil(matched.length / pageSize)),
        });
      }
      return Promise.resolve({
        items: [...mockCandidates],
        total: 2,
        page: 1,
        pageSize: 20,
        totalPages: 1,
      });
    });
    apiPost.mockResolvedValue({ id: "c3", userId: "u3", fields: {} });
    apiPatch.mockResolvedValue({ ok: true });
  });

  it("renders candidate list with dynamic field columns", async () => {
    renderPage();
    const table = await screen.findByRole("table");
    expect(within(table).getByText("Candidate One")).toBeInTheDocument();
    expect(within(table).getByText("Candidate Two")).toBeInTheDocument();
    expect(within(table).getByText("编号")).toBeInTheDocument();
    expect(within(table).getByText("部门")).toBeInTheDocument();
    expect(within(table).getByText("E001")).toBeInTheDocument();
  });

  // ── #800 PR-C A3-F7: recovery-incident deep link ───────────────────
  // Customer service had no path from a candidate row to that candidate's
  // incidents/attempts. The row action deep-links into the recovery queue
  // pre-filtered by candidateId (an existing server filter), composed only
  // for callers holding the recovery route capability.

  it("deep-links the candidate row to the recovery queue filtered by candidateId", async () => {
    const user = userEvent.setup();
    renderPage();
    const table = await screen.findByRole("table");

    const menu = await openRowMenu(user, 0);
    await user.click(within(menu).getByRole("menuitem", { name: "恢复事件" }));

    expect(
      await screen.findByTestId("recovery-queue-stub"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("location-search")).toHaveTextContent(
      "candidateId=c1",
    );
  });

  it("opens create dialog with dynamic fields", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "新增考生" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText("新增考生")).toBeInTheDocument();
  });

  it("shows validation errors for empty fields on create", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "新增考生" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(dialogSaveBtn(dialog));
    expect(within(dialog).getByText("请输入用户名")).toBeInTheDocument();
    expect(within(dialog).getByText("请输入姓名")).toBeInTheDocument();
    expect(within(dialog).getByText("密码至少 8 位")).toBeInTheDocument();
  });

  it("creates a new candidate with valid data", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "新增考生" }));
    const dialog = await screen.findByRole("dialog");

    fireEvent.change(within(dialog).getByLabelText(/用户名/), {
      target: { value: "newuser" },
    });
    fireEvent.change(within(dialog).getByLabelText(/密码/), {
      target: { value: "password123" },
    });
    fireEvent.change(within(dialog).getByLabelText(/姓名/), {
      target: { value: "New Candidate" },
    });
    fireEvent.change(within(dialog).getByLabelText(/编号/), {
      target: { value: "3" },
    });

    await user.click(dialogSaveBtn(dialog));
    expect(apiPost).toHaveBeenCalledWith("/api/candidates", {
      username: "newuser",
      password: "password123",
      name: "New Candidate",
      fields: { employeeId: 3, department: "" },
    });
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith("考生已创建");
    });
  });

  it("opens edit dialog with candidate data", async () => {
    const user = userEvent.setup();
    renderPage();
    const editButtons = await screen.findAllByLabelText("编辑考生");
    await user.click(editButtons[0]!);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("编辑考生")).toBeInTheDocument();
  });

  it("edits a candidate", async () => {
    const user = userEvent.setup();
    renderPage();
    const editButtons = await screen.findAllByLabelText("编辑考生");
    await user.click(editButtons[0]!);
    const dialog = await screen.findByRole("dialog");
    const nameInput = dialog.querySelectorAll("input")[0]!;
    await user.clear(nameInput);
    await user.type(nameInput, "Updated Name");
    await user.click(dialogSaveBtn(dialog));
    expect(apiPatch).toHaveBeenCalledWith(
      "/api/candidates/c1",
      expect.objectContaining({ name: "Updated Name" }),
    );
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith("考生已更新");
    });
  });

  it("opens confirmation before toggling candidate active status", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("table");
    const menu = await openRowMenu(user, 0);
    await user.click(within(menu).getByRole("menuitem", { name: "禁用" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/Candidate One/)).toBeInTheDocument();
    const confirm = within(dialog).getByRole("button", { name: "确认" });
    expect(confirm).toHaveAttribute("data-variant", "destructive");
    await user.click(confirm);
    expect(apiPatch).toHaveBeenCalledWith(
      "/api/candidates/c1",
      expect.objectContaining({ isActive: false }),
    );
  });

  it("opens confirmation before toggling inactive candidate to active", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("table");
    const menu = await openRowMenu(user, 1);
    await user.click(within(menu).getByRole("menuitem", { name: "启用" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/Candidate Two/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "确认" }));
    expect(apiPatch).toHaveBeenCalledWith(
      "/api/candidates/c2",
      expect.objectContaining({ isActive: true }),
    );
  });

  it("disables all candidate toggle buttons while one toggle is running", async () => {
    let resolveToggle: (value: unknown) => void;
    apiPatch.mockReturnValue(
      new Promise((resolve) => {
        resolveToggle = resolve;
      }),
    );
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("table");
    const menu = await openRowMenu(user, 0);
    await user.click(within(menu).getByRole("menuitem", { name: "禁用" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "确认" }));
    // While the toggle is in flight the busy guard disables the action in
    // every row's menu (labels stay stable under the typed declaration API).
    const otherMenu = await openRowMenu(user, 1);
    expect(
      within(otherMenu).getByRole("menuitem", { name: "启用" }),
    ).toHaveAttribute("aria-disabled", "true");
    resolveToggle!({ ok: true });
    await act(async () => {});
  });

  it("opens import dialog", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "导入" }));
    expect(screen.getByText("导入考生")).toBeInTheDocument();
  });

  it("searches candidates by name (server-side, #785)", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("table");
    await user.type(
      screen.getByPlaceholderText("搜索考生姓名或用户名..."),
      "One",
    );
    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledWith(
        "/api/candidates?page=1&pageSize=20&search=One",
      );
    });
    // The request alone is not the contract: sync on the rendered transition
    // (the filtered-out row disappears) before asserting the result.
    await waitFor(() => {
      expect(
        within(screen.getByRole("table")).queryByText("Candidate Two"),
      ).not.toBeInTheDocument();
    });
    expect(
      within(screen.getByRole("table")).getByText("Candidate One"),
    ).toBeInTheDocument();
  });

  it("searches candidates by username (server-side, #785)", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("table");
    await user.type(
      screen.getByPlaceholderText("搜索考生姓名或用户名..."),
      "candidate2",
    );
    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledWith(
        "/api/candidates?page=1&pageSize=20&search=candidate2",
      );
    });
    await waitFor(() => {
      expect(
        within(screen.getByRole("table")).queryByText("Candidate One"),
      ).not.toBeInTheDocument();
    });
    expect(
      within(screen.getByRole("table")).getByText("Candidate Two"),
    ).toBeInTheDocument();
  });

  it("shows empty search result state and keeps toolbar visible", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("table");
    await user.type(
      screen.getByPlaceholderText("搜索考生姓名或用户名..."),
      "不存在",
    );
    expect(
      await screen.findByRole("heading", { name: "未找到匹配的考生" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("搜索考生")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "清除考生搜索" }),
    ).toBeInTheDocument();
  });

  it("clears search using clear icon and empty state action", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("table");
    await user.type(screen.getByLabelText("搜索考生"), "不存在");
    await waitFor(() => {
      expect(
        new URLSearchParams(lastCandidatesUrl().split("?")[1]).get("search"),
      ).toBe("不存在");
    });
    await user.click(screen.getByRole("button", { name: "清除考生搜索" }));
    await waitFor(() => {
      expect(lastCandidatesUrl()).toBe("/api/candidates?page=1&pageSize=20");
    });
    expect(
      await within(await screen.findByRole("table")).findByText(
        "Candidate One",
      ),
    ).toBeInTheDocument();
    await user.type(screen.getByLabelText("搜索考生"), "不存在");
    await waitFor(() => {
      expect(
        new URLSearchParams(lastCandidatesUrl().split("?")[1]).get("search"),
      ).toBe("不存在");
    });
    // The empty-state action only exists once the no-match response has
    // rendered; findByRole is the sync point that proves it is clickable.
    await user.click(await screen.findByRole("button", { name: "清除搜索" }));
    await waitFor(() => {
      expect(lastCandidatesUrl()).toBe("/api/candidates?page=1&pageSize=20");
    });
    expect(
      await within(await screen.findByRole("table")).findByText(
        "Candidate Two",
      ),
    ).toBeInTheDocument();
  });

  it("shows error state when loading fails", async () => {
    apiGet.mockRejectedValue(new Error("fail"));
    renderPage();
    expect(await screen.findByText("加载考生列表失败")).toBeInTheDocument();
  });

  it("shows empty state when no candidates", async () => {
    apiGet.mockImplementation((path: string) => {
      if (path === "/api/candidate-fields")
        return Promise.resolve([...mockFields]);
      return Promise.resolve({
        items: [],
        total: 0,
        page: 1,
        pageSize: 20,
        totalPages: 0,
      });
    });
    renderPage();
    expect(
      await screen.findByRole("heading", { name: "暂无考生" }),
    ).toBeInTheDocument();
  });

  it("preserves USER_ALREADY_EXISTS save error", async () => {
    apiPost.mockRejectedValue(
      new ApiError(409, "用户名已存在", "USER_ALREADY_EXISTS"),
    );
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "新增考生" }));
    const dialog = await screen.findByRole("dialog");
    const inputs = dialog.querySelectorAll("input");
    await user.type(inputs[0]!, "newuser");
    await user.type(inputs[1]!, "password123");
    await user.type(inputs[2]!, "Name");
    await user.type(inputs[3]!, "123");
    await user.click(dialogSaveBtn(dialog));
    expect(await screen.findByText("用户名已存在")).toBeInTheDocument();
  });

  it("preserves CANDIDATE_IDENTITY_CONFLICT save error", async () => {
    apiPost.mockRejectedValue(
      new ApiError(
        409,
        "身份信息已存在，请检查证件号",
        "CANDIDATE_IDENTITY_CONFLICT",
      ),
    );
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "新增考生" }));
    const dialog = await screen.findByRole("dialog");
    const inputs = dialog.querySelectorAll("input");
    await user.type(inputs[0]!, "newuser");
    await user.type(inputs[1]!, "password123");
    await user.type(inputs[2]!, "Name");
    await user.type(inputs[3]!, "123");
    await user.click(dialogSaveBtn(dialog));
    expect(await screen.findByText("身份信息已存在")).toBeInTheDocument();
  });

  it("renders API field errors from ApiError details", async () => {
    apiPost.mockRejectedValue(
      new ApiError(400, "字段校验失败", "VALIDATION_ERROR", {
        fields: [{ field: "name", message: "姓名不能为空" }],
      }),
    );
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "新增考生" }));
    const dialog = await screen.findByRole("dialog");
    const inputs = dialog.querySelectorAll("input");
    await user.type(inputs[0]!, "newuser");
    await user.type(inputs[1]!, "password123");
    await user.type(inputs[2]!, "Name");
    await user.type(inputs[3]!, "123");
    await user.click(dialogSaveBtn(dialog));
    expect(await screen.findByText("姓名不能为空")).toBeInTheDocument();
  });

  it("renders a server identity-field error from machine code/params under the dynamic field (C2 T7)", async () => {
    // The server paths the error as `fields.employeeId` with a machine code;
    // the compatibility message wording is deliberately alien to prove the
    // localized meaning comes from code + params via the Web catalog.
    apiPost.mockRejectedValue(
      new ApiError(400, "字段校验失败", "VALIDATION_ERROR", {
        fields: [
          {
            field: "fields.employeeId",
            code: "REQUIRED",
            params: { label: "编号" },
            message: "COMPLETELY DIFFERENT SERVER WORDING",
          },
        ],
      }),
    );
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "新增考生" }));
    const dialog = await screen.findByRole("dialog");
    const inputs = dialog.querySelectorAll("input");
    await user.type(inputs[0]!, "newuser");
    await user.type(inputs[1]!, "password123");
    await user.type(inputs[2]!, "Name");
    // Satisfy the CLIENT-side gate so the POST is reached; the server then
    // rejects with the machine-coded identity-field error.
    await user.type(inputs[3]!, "123");
    await user.click(dialogSaveBtn(dialog));
    expect(await screen.findByText("编号为必填项")).toBeInTheDocument();
    expect(
      screen.queryByText("COMPLETELY DIFFERENT SERVER WORDING"),
    ).not.toBeInTheDocument();
  });

  it("disables save button while saving to prevent duplicate submit", async () => {
    let resolveSave: (value: unknown) => void;
    apiPost.mockReturnValue(
      new Promise((resolve) => {
        resolveSave = resolve;
      }),
    );
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "新增考生" }));
    const dialog = await screen.findByRole("dialog");
    const inputs = dialog.querySelectorAll("input");
    await user.type(inputs[0]!, "newuser");
    await user.type(inputs[1]!, "password123");
    await user.type(inputs[2]!, "Name");
    await user.type(inputs[3]!, "123");
    await user.dblClick(dialogSaveBtn(dialog));
    expect(
      within(dialog).getByRole("button", { name: "保存中..." }),
    ).toBeDisabled();
    expect(apiPost).toHaveBeenCalledTimes(1);
    resolveSave!({ id: "c3" });
    await act(async () => {});
  });

  describe("reset password", () => {
    it("opens reset-password dialog with candidate context", async () => {
      const user = userEvent.setup();
      renderPage();
      await screen.findByRole("table");
      const resetMenu = await openRowMenu(user, 0);
      await user.click(
        within(resetMenu).getByRole("menuitem", { name: "重置密码" }),
      );
      const dialog = await screen.findByRole("dialog");
      expect(within(dialog).getByText("重置密码")).toBeInTheDocument();
      expect(within(dialog).getByText(/Candidate One/)).toBeInTheDocument();
    });

    it("rejects a too-short password before submitting", async () => {
      const user = userEvent.setup();
      renderPage();
      await screen.findByRole("table");
      const resetMenu = await openRowMenu(user, 0);
      await user.click(
        within(resetMenu).getByRole("menuitem", { name: "重置密码" }),
      );
      const dialog = await screen.findByRole("dialog");
      const inputs = within(dialog).getAllByPlaceholderText(/位|再次/);
      await user.type(inputs[0]!, "short");
      await user.type(inputs[1]!, "short");
      await user.click(
        within(dialog).getByRole("button", { name: "确认重置" }),
      );
      await waitFor(() => {
        expect(within(dialog).getByText(/密码长度必须在/)).toBeInTheDocument();
      });
      expect(apiPost).not.toHaveBeenCalled();
    });

    it("rejects mismatched passwords before submitting", async () => {
      const user = userEvent.setup();
      renderPage();
      await screen.findByRole("table");
      const resetMenu = await openRowMenu(user, 0);
      await user.click(
        within(resetMenu).getByRole("menuitem", { name: "重置密码" }),
      );
      const dialog = await screen.findByRole("dialog");
      const inputs = within(dialog).getAllByPlaceholderText(/位|再次/);
      await user.type(inputs[0]!, "newpassword123");
      await user.type(inputs[1]!, "differentpass1");
      await user.click(
        within(dialog).getByRole("button", { name: "确认重置" }),
      );
      await waitFor(() => {
        expect(
          within(dialog).getByText("两次输入的密码不一致"),
        ).toBeInTheDocument();
      });
      expect(apiPost).not.toHaveBeenCalled();
    });

    it("submits reset-password request with valid matching password", async () => {
      const user = userEvent.setup();
      renderPage();
      await screen.findByRole("table");
      const resetMenu = await openRowMenu(user, 0);
      await user.click(
        within(resetMenu).getByRole("menuitem", { name: "重置密码" }),
      );
      const dialog = await screen.findByRole("dialog");
      const inputs = within(dialog).getAllByPlaceholderText(/位|再次/);
      await user.type(inputs[0]!, "newpassword123");
      await user.type(inputs[1]!, "newpassword123");
      await user.click(
        within(dialog).getByRole("button", { name: "确认重置" }),
      );
      await waitFor(() => {
        expect(apiPost).toHaveBeenCalledWith("/api/users/c1/reset-password", {
          newPassword: "newpassword123",
        });
      });
      await waitFor(() => {
        expect(toast.success).toHaveBeenCalledWith("密码已重置");
      });
    });

    it("shows error toast when reset fails", async () => {
      apiPost.mockRejectedValue(
        new ApiError(500, "重置密码失败", "INTERNAL_ERROR"),
      );
      const user = userEvent.setup();
      renderPage();
      await screen.findByRole("table");
      const resetMenu = await openRowMenu(user, 0);
      await user.click(
        within(resetMenu).getByRole("menuitem", { name: "重置密码" }),
      );
      const dialog = await screen.findByRole("dialog");
      const inputs = within(dialog).getAllByPlaceholderText(/位|再次/);
      await user.type(inputs[0]!, "newpassword123");
      await user.type(inputs[1]!, "newpassword123");
      await user.click(
        within(dialog).getByRole("button", { name: "确认重置" }),
      );
      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith("服务器内部错误，请稍后重试");
      });
    });
  });
});

/**
 * #785 BDD acceptance — L2 (component level; mocked API with the REAL
 * paginated response shape). Scenario source:
 * docs/design/admin-list-pagination-bdd.md (B02).
 */
describe("CandidatesPage #785 server-side search and pagination (BDD L2)", () => {
  function candidateRow(id: string, name: string, username: string) {
    return {
      id,
      userId: `u-${id}`,
      username,
      name,
      isActive: true,
      fields: {},
    };
  }

  /** Serves /api/candidates with real pagination shapes, honoring page and search. */
  function mockCandidateApi(all: ReturnType<typeof candidateRow>[]) {
    apiGet.mockImplementation(async (url: string) => {
      if (url === "/api/candidate-fields")
        return Promise.resolve([...mockFields]);
      if (url.startsWith("/api/candidates")) {
        const params = new URLSearchParams(url.split("?")[1] ?? "");
        const page = Number(params.get("page") ?? "1");
        const pageSize = Number(params.get("pageSize") ?? "20");
        const search = (params.get("search") ?? "").trim().toLowerCase();
        const matched = search
          ? all.filter(
              (c) =>
                c.name.toLowerCase().includes(search) ||
                c.username.toLowerCase().includes(search),
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
      }
      throw new Error(`unexpected GET ${url}`);
    });
  }

  it("B02: the 41st candidate is reachable through pagination and the total is 41", async () => {
    const user = userEvent.setup();
    const all = Array.from({ length: 41 }, (_, i) =>
      candidateRow(
        `c${i + 1}`,
        `考生${String(i + 1).padStart(2, "0")}`,
        `u${i + 1}`,
      ),
    );
    mockCandidateApi(all);

    renderPage();
    const table = await screen.findByRole("table");
    expect(within(table).getByText("考生01")).toBeInTheDocument();
    expect(within(table).queryByText("考生41")).not.toBeInTheDocument();
    expect(screen.getByText(/共 41 条/)).toBeInTheDocument();
    expect(apiGet).toHaveBeenCalledWith("/api/candidates?page=1&pageSize=20");

    await user.click(screen.getByRole("button", { name: "下一页" }));
    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledWith("/api/candidates?page=2&pageSize=20");
    });
    // Page 2 carries records 21-40; record 41 sits on page 3.
    expect(
      await within(await screen.findByRole("table")).findByText("考生21"),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "下一页" }));
    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledWith("/api/candidates?page=3&pageSize=20");
    });
    expect(
      await within(await screen.findByRole("table")).findByText("考生41"),
    ).toBeInTheDocument();
  });

  it("B02: searching from page 1 reaches a record beyond the first page (server-side)", async () => {
    const user = userEvent.setup();
    const all = [
      ...Array.from({ length: 40 }, (_, i) =>
        candidateRow(`c${i + 1}`, `普通考生${i + 1}`, `plain${i + 1}`),
      ),
      candidateRow("c41", "Zoe zebra785", "u41"),
    ];
    mockCandidateApi(all);

    renderPage();
    await screen.findByRole("table");
    await user.type(screen.getByLabelText("搜索考生"), "ZEBRA785");

    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledWith(
        "/api/candidates?page=1&pageSize=20&search=ZEBRA785",
      );
    });
    expect(
      await within(await screen.findByRole("table")).findByText("Zoe zebra785"),
    ).toBeInTheDocument();
    expect(screen.getByText(/共 1 条/)).toBeInTheDocument();
  });

  it("B02: a no-match search renders the true empty state; clearing restores the full set", async () => {
    const user = userEvent.setup();
    const all = Array.from({ length: 25 }, (_, i) =>
      candidateRow(`c${i + 1}`, `考生${i + 1}`, `u${i + 1}`),
    );
    mockCandidateApi(all);

    renderPage();
    await screen.findByRole("table");
    await user.type(screen.getByLabelText("搜索考生"), "nomatch785");
    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledWith(
        "/api/candidates?page=1&pageSize=20&search=nomatch785",
      );
    });
    expect(await screen.findAllByText("未找到匹配的考生")).not.toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "清除考生搜索" }));
    await waitFor(() => {
      expect(lastCandidatesUrl()).toBe("/api/candidates?page=1&pageSize=20");
    });
    expect(
      await within(await screen.findByRole("table")).findByText("考生1"),
    ).toBeInTheDocument();
    expect(screen.getByText(/共 25 条/)).toBeInTheDocument();
  });

  it("B02: search composes with paging — the filtered set spans page boundaries", async () => {
    const user = userEvent.setup();
    const all = [
      ...Array.from({ length: 25 }, (_, i) =>
        candidateRow(`c${i + 1}`, `bulk785 批次${i + 1}`, `bulk${i + 1}`),
      ),
      ...Array.from({ length: 16 }, (_, i) =>
        candidateRow(`o${i + 1}`, `无关考生${i + 1}`, `other${i + 1}`),
      ),
    ];
    mockCandidateApi(all);

    renderPage();
    await screen.findByRole("table");
    await user.type(screen.getByLabelText("搜索考生"), "bulk785");
    await waitFor(() => {
      expect(screen.getByText(/共 25 条/)).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "下一页" }));
    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledWith(
        "/api/candidates?page=2&pageSize=20&search=bulk785",
      );
    });
    // Page 2 of the filtered set shows the remaining five matches.
    expect(
      await within(await screen.findByRole("table")).findByText(
        "bulk785 批次21",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/共 25 条/)).toBeInTheDocument();
  });

  // ── B12 — 请求进行中，旧记录不得被呈现为新查询的结果 ──────────────────
  it("B12: while a search query is in flight, old rows are never presented as its result (deferred)", async () => {
    const user = userEvent.setup();
    const all = [
      candidateRow("c1", "普通考生甲", "putong1"),
      candidateRow("c2", "普通考生乙", "putong2"),
    ];
    let resolveSearch!: (value: unknown) => void;
    const searchResponse = new Promise((resolve) => {
      resolveSearch = resolve;
    });
    apiGet.mockImplementation((url: string) => {
      if (url === "/api/candidate-fields") {
        return Promise.resolve([...mockFields]);
      }
      if (url.startsWith("/api/candidates")) {
        const params = new URLSearchParams(url.split("?")[1] ?? "");
        const page = Number(params.get("page") ?? "1");
        if (params.get("search")) {
          return searchResponse.then(() => ({
            items: [candidateRow("k1", "关键词考生", "guanjianci")],
            total: 1,
            page,
            pageSize: 20,
            totalPages: 1,
          }));
        }
        return Promise.resolve({
          items: all,
          total: 2,
          page,
          pageSize: 20,
          totalPages: 1,
        });
      }
      return Promise.reject(new Error(`unexpected GET ${url}`));
    });

    renderPage();
    await within(await screen.findByRole("table")).findByText("普通考生甲");

    await user.type(screen.getByLabelText("搜索考生"), "关键词");
    await waitFor(() => {
      expect(
        new URLSearchParams(lastCandidatesUrl().split("?")[1]).get("search"),
      ).toBe("关键词");
    });
    // The search response is still pending: the unfiltered rows must not
    // masquerade as the search result, and no fake empty state may appear.
    expect(screen.queryByText("普通考生甲")).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByText("未找到匹配的考生")).not.toBeInTheDocument();

    resolveSearch(undefined);
    expect(
      await within(await screen.findByRole("table")).findByText("关键词考生"),
    ).toBeInTheDocument();
    expect(screen.getByText(/共 1 条/)).toBeInTheDocument();
  });
});
