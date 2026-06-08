import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import { AuthProvider } from "@/contexts/AuthContext";
import { BrandProvider } from "@/components/layout/BrandProvider";
import { CandidatesPage } from "./CandidatesPage";

const apiGet = vi.fn();
const apiPost = vi.fn();
const apiPatch = vi.fn();

vi.mock("@/lib/api", () => ({
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
        }}
      >
        <BrandProvider>
          <Routes>
            <Route path="/admin/candidates" element={<CandidatesPage />} />
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

describe("CandidatesPage", () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPost.mockReset();
    apiPatch.mockReset();
    apiGet.mockImplementation((path: string) => {
      if (path === "/api/candidate-fields")
        return Promise.resolve([...mockFields]);
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

  it("renders page title", async () => {
    renderPage();
    expect(await screen.findByText("考生管理")).toBeInTheDocument();
  });

  it("renders candidate list with dynamic field columns", async () => {
    renderPage();
    expect(await screen.findByText("Candidate One")).toBeInTheDocument();
    expect(screen.getByText("Candidate Two")).toBeInTheDocument();
    expect(screen.getByText("编号")).toBeInTheDocument();
    expect(screen.getByText("部门")).toBeInTheDocument();
    expect(screen.getByText("E001")).toBeInTheDocument();
  });

  it("renders status column", async () => {
    renderPage();
    expect(await screen.findByText("candidate1")).toBeInTheDocument();
    const rows = screen.getAllByRole("row");
    expect(rows.length).toBeGreaterThanOrEqual(3);
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
    expect(within(dialog).getByText("密码至少6位")).toBeInTheDocument();
  });

  it("creates a new candidate with valid data", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "新增考生" }));
    const dialog = await screen.findByRole("dialog");
    const inputs = dialog.querySelectorAll("input");
    await user.type(inputs[0]!, "newuser");
    await user.type(inputs[1]!, "password123");
    await user.type(inputs[2]!, "New Candidate");
    await user.type(inputs[3]!, "3");
    await user.click(dialogSaveBtn(dialog));
    expect(apiPost).toHaveBeenCalledWith("/api/candidates", {
      username: "newuser",
      password: "password123",
      name: "New Candidate",
      fields: { employeeId: 3, department: "" },
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
  });

  it("toggles candidate active status", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("candidate1");
    const toggleBtn = screen.getByRole("button", { name: "禁用" });
    await user.click(toggleBtn);
    expect(apiPatch).toHaveBeenCalledWith(
      "/api/candidates/c1",
      expect.objectContaining({ isActive: false }),
    );
  });

  it("toggles inactive candidate to active", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("candidate2");
    const toggleBtn = screen.getByRole("button", { name: "启用" });
    await user.click(toggleBtn);
    expect(apiPatch).toHaveBeenCalledWith(
      "/api/candidates/c2",
      expect.objectContaining({ isActive: true }),
    );
  });

  it("opens import dialog", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "导入" }));
    expect(screen.getByText("导入考生")).toBeInTheDocument();
  });

  it("searches candidates by name", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Candidate One");
    await user.type(
      screen.getByPlaceholderText("搜索考生姓名或用户名..."),
      "One",
    );
    expect(screen.getByText("Candidate One")).toBeInTheDocument();
    expect(screen.queryByText("Candidate Two")).not.toBeInTheDocument();
  });

  it("searches candidates by username", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Candidate One");
    await user.type(
      screen.getByPlaceholderText("搜索考生姓名或用户名..."),
      "candidate2",
    );
    expect(screen.getByText("Candidate Two")).toBeInTheDocument();
    expect(screen.queryByText("Candidate One")).not.toBeInTheDocument();
  });

  it("shows empty search result state", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Candidate One");
    await user.type(
      screen.getByPlaceholderText("搜索考生姓名或用户名..."),
      "不存在",
    );
    expect(screen.getByText("未找到匹配的考生")).toBeInTheDocument();
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
    expect(await screen.findByText("暂无考生")).toBeInTheDocument();
  });

  it("shows save error on API failure", async () => {
    apiPost.mockRejectedValue(new Error("save failed"));
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
    expect(await screen.findByText("保存失败，请重试")).toBeInTheDocument();
  });

  it("renders import button", async () => {
    renderPage();
    expect(
      await screen.findByRole("button", { name: "导入" }),
    ).toBeInTheDocument();
  });
});
