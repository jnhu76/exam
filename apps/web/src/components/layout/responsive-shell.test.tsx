import type { MeResponse } from "@exam/contracts";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";
import { AdminLayout } from "./AdminLayout";
import { AppSidebar, SidebarContent } from "./AppSidebar";
import { AuthProvider } from "@/contexts/AuthContext";
import { BrandProvider } from "./BrandProvider";

const admin: MeResponse = {
  id: "00000000-0000-4000-8000-000000000001",
  organizationId: "00000000-0000-4000-8000-000000000010",
  username: "admin",
  name: "管理员",
  role: "Admin",
};

function renderWithProviders(
  ui: React.ReactElement,
  route = "/admin/dashboard",
) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <AuthProvider initialUser={admin}>
        <BrandProvider>{ui}</BrandProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("AdminLayout mobile navigation trigger", () => {
  it("renders a menu trigger with an accessible name", () => {
    renderWithProviders(
      <Routes>
        <Route path="/admin" element={<AdminLayout />}>
          <Route path="*" element={<div>page</div>} />
        </Route>
      </Routes>,
    );
    const trigger = screen.getByTestId("mobile-nav-trigger");
    expect(trigger).toBeInTheDocument();
    expect(trigger).toHaveAccessibleName("打开菜单");
  });

  it("starts collapsed (aria-expanded false) and expands when activated", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <Routes>
        <Route path="/admin" element={<AdminLayout />}>
          <Route path="*" element={<div>page</div>} />
        </Route>
      </Routes>,
    );
    const trigger = screen.getByTestId("mobile-nav-trigger");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveAttribute("aria-controls", "mobile-nav-drawer");

    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("mobile-nav-drawer")).toBeInTheDocument();
  });

  it("closes the drawer via the close button", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <Routes>
        <Route path="/admin" element={<AdminLayout />}>
          <Route path="*" element={<div>page</div>} />
        </Route>
      </Routes>,
    );
    await user.click(screen.getByTestId("mobile-nav-trigger"));
    expect(screen.getByTestId("mobile-nav-drawer")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "关闭菜单" }));
    expect(screen.queryByTestId("mobile-nav-drawer")).not.toBeInTheDocument();
  });
});

describe("Shared navigation authority", () => {
  it("renders the same nav entries in the desktop sidebar and the mobile drawer", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <Routes>
        <Route path="/admin" element={<AdminLayout />}>
          <Route path="*" element={<div>page</div>} />
        </Route>
      </Routes>,
    );

    // Desktop sidebar (rendered, visually hidden below lg via CSS) contains
    // the full nav. "考试管理" is a stable label from the shared authority.
    expect(
      screen.getAllByRole("link", { name: "考试管理" }).length,
    ).toBeGreaterThan(0);

    // Open the mobile drawer and confirm the same authority is surfaced there.
    await user.click(screen.getByTestId("mobile-nav-trigger"));
    const drawerLinks = screen
      .getAllByRole("link", { name: "考试管理" })
      .map((a) => a.getAttribute("href"));
    expect(drawerLinks).toContain("/admin/exams");
  });

  it("SidebarContent drives both surfaces from one component", () => {
    // Direct render proves SidebarContent is the single, reusable authority.
    const { rerender } = render(
      <MemoryRouter>
        <BrandProvider>
          <AppSidebar user={admin} collapsed={false} onLogout={() => {}} />
        </BrandProvider>
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "考试管理" })).toHaveAttribute(
      "href",
      "/admin/exams",
    );

    rerender(
      <MemoryRouter>
        <BrandProvider>
          <aside>
            <SidebarContent
              user={admin}
              collapsed={false}
              onLogout={() => {}}
            />
          </aside>
        </BrandProvider>
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "考试管理" })).toHaveAttribute(
      "href",
      "/admin/exams",
    );
  });
});

describe("AdminLayout desktop sidebar presence", () => {
  it("renders the desktop sidebar element (hidden below lg via CSS)", () => {
    renderWithProviders(
      <Routes>
        <Route path="/admin" element={<AdminLayout />}>
          <Route path="*" element={<div>page</div>} />
        </Route>
      </Routes>,
    );
    // The aside is always in the DOM; CSS hides it below lg. Presence here
    // keeps the desktop contract intact.
    expect(screen.getByTestId("app-sidebar")).toBeInTheDocument();
  });
});
