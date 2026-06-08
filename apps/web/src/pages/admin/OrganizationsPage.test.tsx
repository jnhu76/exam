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

  it("opens create dialog", async () => {
    renderPage();
    await screen.findByText("org-one");
    const { userEvent } = await import("@testing-library/user-event");
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /新增机构/ }));
    expect(screen.getAllByText("名称").length).toBeGreaterThanOrEqual(2);
  });

  it("creates a new organization", async () => {
    const { api } = await import("@/lib/api");
    renderPage();
    await screen.findByText("org-one");
    const { userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "新增机构" }));
    const inputs = screen.getAllByRole("textbox");
    await user.type(inputs[0]!, "New Org");
    await user.type(inputs[1]!, "New Org Display");
    await user.type(inputs[2]!, "new-org");
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(api.post).toHaveBeenCalledWith("/api/organizations", {
      name: "New Org",
      displayName: "New Org Display",
      slug: "new-org",
    });
  });

  it("opens edit dialog", async () => {
    renderPage();
    await screen.findByText("org-one");
    const editButtons = screen.getAllByLabelText("编辑机构");
    const { userEvent } = await import("@testing-library/user-event");
    await userEvent.setup().click(editButtons[0]!);
    expect(screen.getByText("编辑机构")).toBeInTheDocument();
  });

  it("deletes an organization after confirmation", async () => {
    const { api } = await import("@/lib/api");
    renderPage();
    await screen.findByText("org-one");
    const deleteButtons = screen.getAllByLabelText("删除机构");
    const { userEvent } = await import("@testing-library/user-event");
    await userEvent.setup().click(deleteButtons[0]!);
    const confirmBtn = screen.getByRole("button", { name: "确认" });
    await userEvent.setup().click(confirmBtn);
    expect(api.delete).toHaveBeenCalledWith("/api/organizations/org1");
  });
});
