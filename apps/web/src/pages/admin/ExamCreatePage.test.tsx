import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { AuthProvider } from "@/contexts/AuthContext";
import { BrandProvider } from "@/components/layout/BrandProvider";
import { ExamCreatePage } from "./ExamCreatePage";
import { permissionsForRole } from "@exam/authz";

const { apiGet, apiPost } = vi.hoisted(() => {
  const mockCourses = [{ id: "c1", name: "数学", code: "MATH101" }];
  const mockQuestions = [
    {
      id: "q1",
      type: "true_false",
      content: "2+2=4",
      score: 10,
      courseId: "c1",
      standardAnswer: true,
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
    },
    {
      id: "q2",
      type: "single_choice",
      content: "Capital of France?",
      score: 15,
      courseId: "c1",
      standardAnswer: "Paris",
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
    },
  ];
  return {
    apiGet: vi.fn().mockImplementation((path: string) => {
      if (path.includes("/api/courses"))
        return Promise.resolve({ items: mockCourses, total: 1 });
      if (path.includes("/api/questions"))
        return Promise.resolve({ items: mockQuestions, total: 2 });
      return Promise.resolve({});
    }),
    apiPost: vi.fn().mockResolvedValue({ id: "exam-1" }),
  };
});

vi.mock("@/lib/api", () => ({
  api: {
    get: (...args: unknown[]) => apiGet(...args),
    post: (...args: unknown[]) => apiPost(...args),
  },
  setNavigate: () => {},
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/admin/exams/new"]}>
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
            <Route path="/admin/exams/new" element={<ExamCreatePage />} />
            <Route
              path="/admin/exams"
              element={<div data-testid="exam-list" />}
            />
          </Routes>
        </BrandProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

// Title is a plain text input; fireEvent.change sets it in one synchronous
// event instead of user.type's per-keystroke delay. The business assertion
// (apiPost payload carries `title`) is preserved — only the input path
// changes. userEvent is reserved for genuinely interactive assertions
// (opening dialogs, clicking buttons).
function fillTitle(value: string) {
  fireEvent.change(screen.getByPlaceholderText("请输入考试名称"), {
    target: { value },
  });
}

describe("ExamCreatePage smoke", () => {
  it("renders page title and exam config form without Phase 2 controls", async () => {
    renderPage();

    expect(await screen.findByText("创建考试")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("请输入考试名称")).toBeInTheDocument();
    expect(screen.getByText("时间设置")).toBeInTheDocument();
    expect(screen.queryByText(/随机选题/)).not.toBeInTheDocument();
    expect(screen.queryByText(/排队入场/)).not.toBeInTheDocument();
    expect(screen.queryByText(/限制访问网络/)).not.toBeInTheDocument();
    expect(screen.queryByText(/要求锁定环境/)).not.toBeInTheDocument();
  });

  it("shows question selection dialog and adds question", async () => {
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText("创建考试")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "手动选题" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("2+2=4")).toBeInTheDocument();

    const addButtons = within(dialog).getAllByRole("button", { name: "添加" });
    await user.click(addButtons[0]!);

    await waitFor(() => {
      expect(screen.getByText("已选题目 (1)")).toBeInTheDocument();
    });
    expect(screen.getByText("2+2=4")).toBeInTheDocument();
  });

  it("removes a selected question", async () => {
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText("创建考试")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "手动选题" }));

    const dialog = await screen.findByRole("dialog");
    const addButtons = within(dialog).getAllByRole("button", { name: "添加" });
    await user.click(addButtons[0]!);

    await user.click(within(dialog).getByRole("button", { name: "关闭" }));

    await waitFor(() => {
      expect(screen.getByText("已选题目 (1)")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "删除题目" }));

    await waitFor(() => {
      expect(screen.getByText("已选题目 (0)")).toBeInTheDocument();
    });
  });

  it("calls API on save draft", async () => {
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText("创建考试")).toBeInTheDocument();

    fillTitle("Test Exam");
    await user.click(screen.getByRole("button", { name: "保存草稿" }));

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith(
        "/api/exams",
        expect.objectContaining({ title: "Test Exam" }),
      );
    });
  });

  it("calls create and publish API on publish button", async () => {
    const user = userEvent.setup();
    apiPost.mockReset();
    apiPost.mockResolvedValue({ id: "exam-new" });

    renderPage();

    expect(await screen.findByText("创建考试")).toBeInTheDocument();

    fillTitle("Publish Exam");
    await user.click(screen.getByRole("button", { name: "发布考试" }));

    await waitFor(() => {
      expect(apiPost.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    const hasCreate = apiPost.mock.calls.some(
      (c: Array<unknown>) => c[0] === "/api/exams",
    );
    const hasPublish = apiPost.mock.calls.some(
      (c: Array<unknown>) =>
        typeof c[0] === "string" && (c[0] as string).includes("/publish"),
    );
    expect(hasCreate).toBe(true);
    expect(hasPublish).toBe(true);
  });

  it("shows specific API error on save failure", async () => {
    const user = userEvent.setup();
    apiPost.mockReset();
    apiPost.mockRejectedValue(new Error("题目不属于所选课程"));

    renderPage();

    expect(await screen.findByText("创建考试")).toBeInTheDocument();
    fillTitle("Bad Exam");
    await user.click(screen.getByRole("button", { name: "保存草稿" }));

    expect(await screen.findByText("题目不属于所选课程")).toBeInTheDocument();
  });
});
