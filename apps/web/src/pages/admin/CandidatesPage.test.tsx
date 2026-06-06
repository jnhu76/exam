import { render, screen } from "@testing-library/react";
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
              fieldType: "text",
              required: true,
              sortOrder: 0,
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
            ],
            total: 1,
            page: 1,
            pageSize: 20,
            totalPages: 1,
          }),
    ),
    post: vi.fn().mockResolvedValue({
      id: "c2",
      userId: "u2",
      fields: { employeeId: "E002" },
    }),
  },
  setNavigate: () => {},
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
});
