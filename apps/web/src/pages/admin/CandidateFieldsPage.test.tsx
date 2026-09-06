import { act, render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import { AuthProvider } from "@/contexts/AuthContext";
import { BrandProvider } from "@/components/layout/BrandProvider";
import { CandidateFieldsPage } from "./CandidateFieldsPage";
import { permissionsForRole } from "@exam/authz";
import { ApiError } from "@/lib/api";

const { apiGet, apiPost, apiDelete, apiPatch } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiDelete: vi.fn(),
  apiPatch: vi.fn(),
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
    delete: (...args: unknown[]) => apiDelete(...args),
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
    label: "工号",
    fieldType: "text",
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

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/admin/candidate-fields"]}>
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
            <Route
              path="/admin/candidate-fields"
              element={<CandidateFieldsPage />}
            />
          </Routes>
        </BrandProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

function dialogInput(dialog: HTMLElement, index: number) {
  return dialog.querySelectorAll("input")[index]!;
}

/** Open a row's overflow menu and return it (row actions with N>2 live in
 * the kebab under the typed RowActions API). */
async function openRowMenu(
  user: ReturnType<typeof userEvent.setup>,
  index: number,
) {
  const kebabs = await screen.findAllByRole("button", { name: "更多操作" });
  await user.click(kebabs[index]!);
  return await screen.findByRole("menu");
}

describe("CandidateFieldsPage", () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPost.mockReset();
    apiDelete.mockReset();
    apiPatch.mockReset();
    apiGet.mockResolvedValue([...mockFields]);
    apiPost.mockResolvedValue({ id: "cf3" });
    apiPatch.mockResolvedValue(undefined);
    apiDelete.mockResolvedValue(undefined);
  });

  it("renders page title", async () => {
    renderPage();
    expect(await screen.findByText("考生字段配置")).toBeInTheDocument();
  });

  it("renders field list with columns", async () => {
    renderPage();
    // Row content renders twice by design (desktop table + mobile cards);
    // scope to the desktop table representation.
    const table = await screen.findByRole("table");
    expect(within(table).getByText("employeeId")).toBeInTheDocument();
    expect(within(table).getByText("工号")).toBeInTheDocument();
    expect(within(table).getByText("文本")).toBeInTheDocument();
    expect(within(table).getAllByText("是").length).toBeGreaterThanOrEqual(1);
  });

  it("renders second field correctly", async () => {
    renderPage();
    expect(await screen.findByText("department")).toBeInTheDocument();
    expect(screen.getByText("选项")).toBeInTheDocument();
  });

  it("renders add field and download template buttons", async () => {
    renderPage();
    expect(
      await screen.findByRole("button", { name: /添加字段/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /下载模板/ }),
    ).toBeInTheDocument();
  });

  it("opens create dialog", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: /添加字段/ }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("saves a new field", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: /添加字段/ }));
    const dialog = screen.getByRole("dialog");
    const inputs = dialog.querySelectorAll("input");
    await user.type(inputs[0]!, "phone");
    await user.type(inputs[1]!, "手机号");
    const saveBtn = within(dialog)
      .getAllByRole("button")
      .find((b) => b.textContent === "保存")!;
    await user.click(saveBtn);
    expect(apiPost).toHaveBeenCalledWith("/api/candidate-fields", {
      name: "phone",
      label: "手机号",
      fieldType: "text",
      required: false,
      unique: false,
      sortOrder: 2,
    });
  });

  it("shows API error without unhandled rejection", async () => {
    apiPost.mockRejectedValue(
      new ApiError(409, "字段名已存在", "CANDIDATE_IDENTITY_FIELD_CONFLICT"),
    );
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: /添加字段/ }));
    const dialog = screen.getByRole("dialog");
    const inputs = dialog.querySelectorAll("input");
    await user.type(inputs[0]!, "phone");
    await user.type(inputs[1]!, "手机号");
    const saveBtn = within(dialog)
      .getAllByRole("button")
      .find((b) => b.textContent === "保存")!;
    await user.click(saveBtn);
    expect(
      await within(dialog).findByText("只能设置一个唯一身份字段"),
    ).toBeInTheDocument();
  });

  it("clears dialog mutation error when closing", async () => {
    apiPost.mockRejectedValue(
      new ApiError(409, "字段名已存在", "CANDIDATE_IDENTITY_FIELD_CONFLICT"),
    );
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: /添加字段/ }));
    const dialog = screen.getByRole("dialog");
    const inputs = dialog.querySelectorAll("input");
    await user.type(inputs[0]!, "phone");
    await user.type(inputs[1]!, "手机号");
    const saveBtn = within(dialog)
      .getAllByRole("button")
      .find((b) => b.textContent === "保存")!;
    await user.click(saveBtn);
    expect(
      await within(dialog).findByText("只能设置一个唯一身份字段"),
    ).toBeInTheDocument();
    const cancelBtn = within(dialog)
      .getAllByRole("button")
      .find((b) => b.textContent === "取消")!;
    await user.click(cancelBtn);
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(
      screen.queryByText("只能设置一个唯一身份字段"),
    ).not.toBeInTheDocument();
  });

  it("disables save while field mutation is running", async () => {
    let resolveSave: (value: unknown) => void;
    apiPost.mockReturnValue(
      new Promise((resolve) => {
        resolveSave = resolve;
      }),
    );
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: /添加字段/ }));
    const dialog = screen.getByRole("dialog");
    const inputs = dialog.querySelectorAll("input");
    await user.type(inputs[0]!, "phone");
    await user.type(inputs[1]!, "手机号");
    const saveBtn = within(dialog)
      .getAllByRole("button")
      .find((b) => b.textContent === "保存")!;
    await user.dblClick(saveBtn);
    expect(
      within(dialog).getByRole("button", { name: "保存中..." }),
    ).toBeDisabled();
    expect(apiPost).toHaveBeenCalledTimes(1);
    resolveSave!({ id: "cf3" });
    await act(async () => {});
  });

  it("does not save when name and label are empty", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: /添加字段/ }));
    const dialog = screen.getByRole("dialog");
    const saveBtn = within(dialog)
      .getAllByRole("button")
      .find((b) => b.textContent === "保存")!;
    await user.click(saveBtn);
    expect(apiPost).not.toHaveBeenCalled();
  });

  it("opens edit dialog with field data", async () => {
    const user = userEvent.setup();
    renderPage();
    const editButtons = await screen.findAllByLabelText("编辑字段");
    await user.click(editButtons[0]!);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("编辑字段")).toBeInTheDocument();
    expect(screen.getByText(/不可修改/)).toBeInTheDocument();
    const inputs = dialog.querySelectorAll("input");
    expect(inputs[0]!).toHaveValue("工号");
  });

  it("saves edited field", async () => {
    const user = userEvent.setup();
    renderPage();
    const editButtons = await screen.findAllByLabelText("编辑字段");
    await user.click(editButtons[0]!);
    const dialog = await screen.findByRole("dialog");
    const labelInput = dialog.querySelectorAll("input")[0]!;
    await user.clear(labelInput);
    await user.type(labelInput, "员工编号");
    const saveBtn = within(dialog)
      .getAllByRole("button")
      .find((b) => b.textContent === "保存")!;
    await user.click(saveBtn);
    expect(apiPatch).toHaveBeenCalledWith("/api/candidate-fields/cf1", {
      label: "员工编号",
      required: true,
      unique: true,
      sortOrder: 0,
    });
  });

  it("deletes a field after confirmation", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("employeeId");
    const menu = await openRowMenu(user, 0);
    await user.click(within(menu).getByRole("menuitem", { name: "删除字段" }));
    const alertDialog = await screen.findByRole("alertdialog");
    const confirmBtn = within(alertDialog).getByRole("button", {
      name: "确认",
    });
    await user.click(confirmBtn);
    expect(apiDelete).toHaveBeenCalledWith("/api/candidate-fields/cf1");
  });

  it("moves a field up", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("department");
    const menu = await openRowMenu(user, 1);
    await user.click(within(menu).getByRole("menuitem", { name: "上移" }));
    expect(apiPatch).toHaveBeenCalledTimes(2);
  });

  it("moves a field down", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("employeeId");
    const menu = await openRowMenu(user, 0);
    await user.click(within(menu).getByRole("menuitem", { name: "下移" }));
    expect(apiPatch).toHaveBeenCalledTimes(2);
  });

  it("first up item and last down item are disabled", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("employeeId");
    const kebabs = await screen.findAllByRole("button", { name: "更多操作" });
    await user.click(kebabs[0]!);
    const firstMenu = await screen.findByRole("menu");
    expect(
      within(firstMenu).getByRole("menuitem", { name: "上移" }),
    ).toHaveAttribute("aria-disabled", "true");
    await user.keyboard("{Escape}");
    await user.click(kebabs[kebabs.length - 1]!);
    const lastMenu = await screen.findByRole("menu");
    expect(
      within(lastMenu).getByRole("menuitem", { name: "下移" }),
    ).toHaveAttribute("aria-disabled", "true");
  });

  it("cancels dialog", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: /添加字段/ }));
    const dialog = screen.getByRole("dialog");
    const cancelBtn = within(dialog)
      .getAllByRole("button")
      .find((b) => b.textContent === "取消")!;
    await user.click(cancelBtn);
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("shows error state when loading fails", async () => {
    apiGet.mockRejectedValue(new Error("fail"));
    renderPage();
    expect(await screen.findByText("加载字段配置失败")).toBeInTheDocument();
  });

  it("recovers after retry succeeds", async () => {
    apiGet
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValueOnce([...mockFields]);
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByText("加载字段配置失败")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByText("employeeId")).toBeInTheDocument();
    expect(screen.queryByText("加载字段配置失败")).not.toBeInTheDocument();
  });

  it("shows empty state when no fields", async () => {
    apiGet.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText("暂无候选人字段")).toBeInTheDocument();
  });

  it("downloads template", async () => {
    apiGet.mockImplementation((path: string) => {
      if (path.includes("template"))
        return Promise.resolve({ headers: ["username", "name", "employeeId"] });
      return Promise.resolve([...mockFields]);
    });
    renderPage();
    await screen.findByText("employeeId");
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /下载模板/ }));
    expect(apiGet).toHaveBeenCalledWith("/api/candidate-fields/template");
  });

  it("toggles required and unique checkboxes in dialog", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: /添加字段/ }));
    const dialog = screen.getByRole("dialog");
    const inputs = dialog.querySelectorAll("input");
    await user.type(inputs[0]!, "test");
    await user.type(inputs[1]!, "Test");
    const checkboxes = within(dialog).getAllByRole("checkbox");
    await user.click(checkboxes[0]!);
    await user.click(checkboxes[1]!);
    const saveBtn = within(dialog)
      .getAllByRole("button")
      .find((b) => b.textContent === "保存")!;
    await user.click(saveBtn);
    expect(apiPost).toHaveBeenCalledWith(
      "/api/candidate-fields",
      expect.objectContaining({ required: true, unique: true }),
    );
  });
});
