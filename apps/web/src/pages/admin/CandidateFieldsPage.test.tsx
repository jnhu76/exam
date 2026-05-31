import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import { AuthProvider } from "@/contexts/AuthContext";
import { BrandProvider } from "@/components/layout/BrandProvider";
import { CandidateFieldsPage } from "./CandidateFieldsPage";

vi.mock("@/lib/api", () => ({
  api: {
    get: vi.fn().mockResolvedValue([
      {
        id: "cf1",
        name: "employeeId",
        label: "工号",
        fieldType: "text",
        required: true,
        unique: true,
        sortOrder: 0,
      },
    ]),
    post: vi.fn().mockResolvedValue({
      id: "cf2",
      name: "department",
      label: "部门",
      fieldType: "text",
      required: false,
      unique: false,
      sortOrder: 1,
    }),
    delete: vi.fn().mockResolvedValue(undefined),
  },
  setNavigate: () => {},
}));

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

describe("CandidateFieldsPage", () => {
  it("renders page title", async () => {
    renderPage();
    expect(await screen.findByText("考生字段配置")).toBeInTheDocument();
  });

  it("renders candidate field list", async () => {
    renderPage();
    expect(await screen.findByText("employeeId")).toBeInTheDocument();
  });

  it("renders add field button", async () => {
    renderPage();
    expect(
      await screen.findByRole("button", { name: "添加字段" }),
    ).toBeInTheDocument();
  });
});
