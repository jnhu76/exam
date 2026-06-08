import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import { AuthProvider } from "@/contexts/AuthContext";
import { BrandProvider } from "@/components/layout/BrandProvider";
import { CandidatesPage } from "./CandidatesPage";

vi.mock("@/lib/api", () => ({
  api: {
    get: vi.fn().mockImplementation((path: string) =>
      path === "/api/candidate-fields"
        ? Promise.resolve([
            {
              id: "cf1",
              name: "employeeId",
              label: "编号",
              fieldType: "number",
              required: true,
              sortOrder: 0,
            },
            {
              id: "cf2",
              name: "department",
              label: "部门",
              fieldType: "select",
              required: false,
              sortOrder: 1,
            },
          ])
        : Promise.resolve({
            items: [
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
            ],
            total: 2,
            page: 1,
            pageSize: 20,
            totalPages: 1,
          }),
    ),
    post: vi.fn().mockResolvedValue({
      id: "c3",
      userId: "u3",
      fields: { employeeId: "E003" },
    }),
    patch: vi.fn().mockResolvedValue({ ok: true }),
  },
  setNavigate: () => {},
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

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

describe("CandidatesPage", () => {
  it("renders page title", async () => {
    renderPage();
    expect(await screen.findByText("考生管理")).toBeInTheDocument();
  });

  it("renders candidate list", async () => {
    renderPage();
    expect(await screen.findByText("E001")).toBeInTheDocument();
  });

  it("renders import button", async () => {
    renderPage();
    expect(
      await screen.findByRole("button", { name: "导入" }),
    ).toBeInTheDocument();
  });

  it("opens create dialog with blank credentials and type-based dynamic fields", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "新增考生" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText(/用户名/)).toHaveValue("");
    expect(within(dialog).getByLabelText(/初始密码/)).toHaveValue("");
    expect(within(dialog).getByLabelText(/编号/)).toHaveAttribute(
      "type",
      "number",
    );
    expect(within(dialog).getByLabelText("部门")).toHaveAttribute(
      "type",
      "text",
    );
  });

  it("shows candidate names in the table", async () => {
    renderPage();
    expect(await screen.findByText("Candidate One")).toBeInTheDocument();
    expect(screen.getByText("Candidate Two")).toBeInTheDocument();
  });

  it("toggles candidate active status", async () => {
    const { api } = await import("@/lib/api");
    renderPage();
    await screen.findByText("candidate1");
    const toggleBtn = screen.getByRole("button", { name: "禁用" });
    await userEvent.setup().click(toggleBtn);
    expect(api.patch).toHaveBeenCalledWith(
      "/api/candidates/c1",
      expect.objectContaining({ isActive: false }),
    );
  });

  it("opens import dialog", async () => {
    renderPage();
    await screen.findByText("candidate1");
    await userEvent.setup().click(screen.getByRole("button", { name: "导入" }));
    expect(screen.getByText("导入考生")).toBeInTheDocument();
  });

  it("renders dynamic field columns in table", async () => {
    renderPage();
    expect(await screen.findByText("编号")).toBeInTheDocument();
    expect(screen.getByText("部门")).toBeInTheDocument();
  });
});
