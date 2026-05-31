import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import { AuthProvider } from "@/contexts/AuthContext";
import { BrandProvider } from "@/components/layout/BrandProvider";
import { OrganizationsPage } from "./OrganizationsPage";

vi.mock("@/lib/api", () => ({
  api: {
    get: vi.fn().mockResolvedValue([
      { id: "org1", name: "Org One", displayName: "Org One", slug: "org-one" },
      { id: "org2", name: "Org Two", displayName: "Org Two", slug: "org-two" },
    ]),
    post: vi.fn().mockResolvedValue({
      id: "org3",
      name: "New Org",
      displayName: "New Org",
      slug: "new-org",
    }),
    patch: vi.fn().mockResolvedValue({
      id: "org1",
      name: "Org One",
      displayName: "Updated",
      slug: "org-one",
    }),
    delete: vi.fn().mockResolvedValue(undefined),
  },
  setNavigate: () => {},
}));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/admin/organizations"]}>
      <AuthProvider
        initialUser={{
          id: "1",
          username: "admin",
          name: "Admin",
          role: "SuperAdmin",
          organizationId: "org1",
        }}
      >
        <BrandProvider>
          <Routes>
            <Route
              path="/admin/organizations"
              element={<OrganizationsPage />}
            />
          </Routes>
        </BrandProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("OrganizationsPage", () => {
  it("renders page title", async () => {
    renderPage();
    expect(await screen.findByText("机构管理")).toBeInTheDocument();
  });

  it("renders organization list", async () => {
    renderPage();
    expect(await screen.findByText("org-one")).toBeInTheDocument();
    expect(screen.getByText("org-two")).toBeInTheDocument();
  });

  it("renders create button", async () => {
    renderPage();
    expect(
      await screen.findByRole("button", { name: "新增机构" }),
    ).toBeInTheDocument();
  });
});
