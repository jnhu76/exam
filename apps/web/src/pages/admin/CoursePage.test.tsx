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
    apiGet.mockResolvedValue({
      items: mockCourses,
      total: 2,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    });
    apiPost.mockResolvedValue({ id: "c3" });
    apiPatch.mockResolvedValue(undefined);
    apiDelete.mockResolvedValue(undefined);
  });

  it("renders page title", async () => {
    renderPage();
    expect(await screen.findByText("课程管理")).toBeInTheDocument();
  });

  it("renders course list", async () => {
    renderPage();
    expect(await screen.findByText("数学")).toBeInTheDocument();
    expect(screen.getByText("MATH101")).toBeInTheDocument();
    expect(screen.getByText("英语")).toBeInTheDocument();
  });

  it("renders new course button", async () => {
    renderPage();
    expect(
      await screen.findByRole("button", { name: "新增课程" }),
    ).toBeInTheDocument();
  });

  it("opens create dialog", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "新增课程" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByLabelText("课程名称")).toHaveValue("");
    expect(within(dialog).getByLabelText("课程代码")).toHaveValue("");
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
    await user.type(screen.getByLabelText("课程名称"), "物理");
    await user.type(screen.getByLabelText("课程代码"), "PHY101");
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
    await user.type(screen.getByLabelText("课程名称"), "物理");
    expect(screen.queryByText("请输入课程名称")).not.toBeInTheDocument();
  });

  it("opens edit dialog with course data", async () => {
    const user = userEvent.setup();
    renderPage();
    const editButtons = await screen.findAllByLabelText("编辑课程");
    await user.click(editButtons[0]!);
    expect(screen.getByText("编辑课程")).toBeInTheDocument();
    expect(screen.getByLabelText("课程名称")).toHaveValue("数学");
    expect(screen.getByLabelText("课程代码")).toHaveValue("MATH101");
  });

  it("saves edited course", async () => {
    const user = userEvent.setup();
    renderPage();
    const editButtons = await screen.findAllByLabelText("编辑课程");
    await user.click(editButtons[0]!);
    const nameInput = screen.getByLabelText("课程名称");
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
    await screen.findByText("数学");
    await user.type(
      screen.getByPlaceholderText("搜索课程名称、代码或描述..."),
      "数",
    );
    expect(screen.getByText("数学")).toBeInTheDocument();
    expect(screen.queryByText("英语")).not.toBeInTheDocument();
  });

  it("searches courses by code", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("数学");
    await user.type(
      screen.getByPlaceholderText("搜索课程名称、代码或描述..."),
      "ENG",
    );
    expect(screen.getByText("英语")).toBeInTheDocument();
    expect(screen.queryByText("数学")).not.toBeInTheDocument();
  });

  it("shows empty search result state with clear action", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("数学");
    await user.type(
      screen.getByPlaceholderText("搜索课程名称、代码或描述..."),
      "不存在",
    );
    expect(screen.getByText("未找到匹配的课程")).toBeInTheDocument();
    expect(screen.getByLabelText("搜索课程")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "清除课程搜索" }));
    expect(screen.getByText("数学")).toBeInTheDocument();
    await user.type(screen.getByLabelText("搜索课程"), "不存在");
    await user.click(screen.getByRole("button", { name: "清除搜索" }));
    expect(screen.getByText("英语")).toBeInTheDocument();
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
    expect(await screen.findByText("暂无课程")).toBeInTheDocument();
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
    await user.type(screen.getByLabelText("课程名称"), "物理");
    await user.type(screen.getByLabelText("课程代码"), "PHY101");
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
    await screen.findByText("暂无课程");
    expect(
      screen.queryByPlaceholderText("搜索课程名称、代码或描述..."),
    ).not.toBeInTheDocument();
  });
});
