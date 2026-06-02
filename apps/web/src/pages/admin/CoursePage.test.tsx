import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import { AuthProvider } from "@/contexts/AuthContext";
import { BrandProvider } from "@/components/layout/BrandProvider";
import { CoursePage } from "./CoursePage";

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

const mockCoursesAfterDelete = [
  {
    id: "c2",
    name: "英语",
    code: "ENG101",
    description: "大学英语",
    createdAt: "2025-01-02",
    updatedAt: "2025-01-02",
  },
];

let resolveRefresh: (value: unknown) => void;
const apiGet = vi.fn().mockResolvedValue({
  items: mockCourses,
  total: 2,
  page: 1,
  pageSize: 20,
  totalPages: 1,
});

const apiDelete = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/api", () => ({
  api: {
    get: (...args: unknown[]) => apiGet(...args),
    delete: (...args: unknown[]) => apiDelete(...args),
  },
  setNavigate: () => {},
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

describe("CoursePage delete", () => {
  it("does not show loading state after deleting a course", async () => {
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText("数学")).toBeInTheDocument();

    let refreshPromise: Promise<unknown>;
    apiGet.mockImplementationOnce(() => {
      refreshPromise = new Promise((resolve) => {
        resolveRefresh = resolve;
      });
      return refreshPromise;
    });

    const deleteBtn = screen.getAllByRole("button", { name: "删除课程" })[0]!;
    await user.click(deleteBtn);

    const dialog = await screen.findByRole("alertdialog");
    const confirmBtn = within(dialog).getByRole("button", { name: "确认" });
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(apiDelete).toHaveBeenCalled();
    });

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByText("英语")).toBeInTheDocument();

    resolveRefresh!({
      items: mockCoursesAfterDelete,
      total: 1,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    });

    expect(await screen.findByText("英语")).toBeInTheDocument();
    expect(screen.queryByText("数学")).not.toBeInTheDocument();
  });
});
