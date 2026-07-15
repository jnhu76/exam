import {
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

vi.mock("@/lib/api", () => ({
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
    // DataView renders both a desktop table (hidden below lg) and a mobile card
    // list (hidden at lg+) in the DOM; scope content assertions to the desktop
    // table shell so a single row's content isn't matched twice.
    const desktop = document.querySelector(
      '[data-slot="admin-table-shell"]',
    ) as HTMLElement;
    await waitFor(() =>
      expect(within(desktop).getByText("题目一内容")).toBeInTheDocument(),
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

    fireEvent.change(screen.getByPlaceholderText("标签，逗号分隔"), {
      target: { value: "abc" },
    });
    // Server-side search is now debounced via DataViewSearch; the field's
    // accessible name updated to reflect full-dataset search (not current page).
    fireEvent.change(screen.getByLabelText("搜索题目"), {
      target: { value: "题目" },
    });
    await user.click(screen.getByRole("button", { name: "清空筛选" }));

    await waitFor(() => {
      expect(screen.getByPlaceholderText("标签，逗号分隔")).toHaveValue("");
      expect(screen.getByLabelText("搜索题目")).toHaveValue("");
      expect(screen.getByText(/共 21 条/)).toBeInTheDocument();
    });
  });
});
