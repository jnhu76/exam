import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import { AuthProvider } from "@/contexts/AuthContext";
import { BrandProvider } from "@/components/layout/BrandProvider";
import { ExamPage } from "./ExamPage";
import { permissionsForRole } from "@exam/authz";

const { apiGet } = vi.hoisted(() => ({
  apiGet: vi.fn().mockResolvedValue({
    items: [
      {
        id: "draft-exam",
        title: "Draft Exam",
        status: "draft",
        openAt: new Date().toISOString(),
        closeAt: new Date(Date.now() + 3600000).toISOString(),
        durationMinutes: 60,
        passingScore: 60,
        totalScore: 100,
        questionIds: ["q1"],
        participantCount: 0,
        canDelete: true,
        deleteDisabledReason: null,
      },
      {
        id: "published-exam",
        title: "Published Exam",
        status: "published",
        openAt: new Date().toISOString(),
        closeAt: new Date(Date.now() + 3600000).toISOString(),
        durationMinutes: 60,
        passingScore: 60,
        totalScore: 100,
        questionIds: ["q1"],
        participantCount: 2,
        canDelete: false,
        deleteDisabledReason: "仅草稿状态的考试允许删除",
      },
    ],
    total: 2,
    page: 1,
    pageSize: 20,
    totalPages: 1,
  }),
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
    delete: vi.fn().mockResolvedValue(undefined),
  },
  setNavigate: () => {},
}));

function renderPage(role: "Admin" | "Teacher" = "Admin") {
  return render(
    <MemoryRouter initialEntries={["/admin/exams"]}>
      <AuthProvider
        initialUser={{
          id: "1",
          username: "admin",
          name: "Admin",
          role,
          organizationId: "org1",
          capabilities: [...permissionsForRole(role)],
        }}
      >
        <BrandProvider>
          <Routes>
            <Route path="/admin/exams" element={<ExamPage />} />
          </Routes>
        </BrandProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("ExamPage", () => {
  it("shows Teacher create access without rendering Admin-only delete actions", async () => {
    renderPage("Teacher");

    expect(
      await screen.findByRole("button", { name: "创建考试" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "删除考试" }),
    ).not.toBeInTheDocument();
  });

  it("shows delete only as enabled for draft exams", async () => {
    renderPage();

    expect(await screen.findByText("考试管理")).toBeInTheDocument();

    // Row actions render twice by design (desktop table + mobile cards);
    // scope to the desktop table representation.
    const table = await screen.findByRole("table");
    const deleteButtons = await within(table).findAllByRole("button", {
      name: "删除考试",
    });
    expect(deleteButtons).toHaveLength(2);
    expect(deleteButtons[0]).toBeEnabled();
    expect(deleteButtons[1]).toBeDisabled();
  });

  it("renders through the shared list-page template", async () => {
    renderPage();

    const heading = await screen.findByRole("heading", { name: "考试列表" });
    const shell = heading.closest('[data-slot="admin-table-shell"]');

    expect(shell).toBeInTheDocument();
    expect(shell).toHaveTextContent("共 2 场考试");
    expect(
      screen.queryByRole("toolbar", { name: "考试列表工具栏" }),
    ).not.toBeInTheDocument();
  });

  it("declares atomic duration, score, date and action columns", async () => {
    renderPage();

    // Atomic columns are a desktop-table declaration; scope to it (row
    // content also renders in the mobile card list).
    const table = await screen.findByRole("table");
    const duration = within(table).getAllByText("60分钟");
    const score = within(table).getAllByText("60/100");
    const deleteButtons = within(table).getAllByRole("button", {
      name: "删除考试",
    });

    expect(duration[0]?.closest("td")).toHaveAttribute(
      "data-column-role",
      "duration",
    );
    expect(duration[0]?.closest("td")).toHaveAttribute(
      "data-column-overflow",
      "nowrap",
    );
    expect(score[0]?.closest("td")).toHaveAttribute(
      "data-column-role",
      "score",
    );
    expect(
      document.querySelector('col[data-column-role="date-range"]'),
    ).toBeInTheDocument();
    expect(
      document.querySelector('col[data-column-role="actions"]'),
    ).toBeInTheDocument();
    expect(deleteButtons[0]).toHaveAttribute("data-action-id", "delete");
  });
});
