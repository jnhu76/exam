import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { AdminIndexRoute, AppTitle } from "@/App";
import { BrandProvider } from "@/components/layout/BrandProvider";
import { AuthProvider } from "@/contexts/AuthContext";
import type { MeResponse } from "@exam/contracts";

function renderTitleProbe(route: string, productName = "测评平台") {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <BrandProvider value={{ productName, productSubtitle: "" }}>
        <AppTitle />
      </BrandProvider>
    </MemoryRouter>,
  );
}

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="current-path">{location.pathname}</span>;
}

function renderAdminIndex(user: MeResponse) {
  return render(
    <MemoryRouter initialEntries={["/admin"]}>
      <AuthProvider initialUser={user}>
        <Routes>
          <Route path="/admin" element={<AdminIndexRoute />} />
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("AppTitle", () => {
  afterEach(() => {
    document.title = "";
  });

  it("syncs document title for admin routes", async () => {
    renderTitleProbe("/admin/settings");

    await waitFor(() => {
      expect(document.title).toBe("平台设置 - 测评平台");
    });
  });

  it("syncs document title for candidate-facing routes", async () => {
    renderTitleProbe("/exam/list");

    await waitFor(() => {
      expect(document.title).toBe("我的考试 - 测评平台");
    });
  });

  it("does not leave document title at loading fallback", async () => {
    document.title = "加载中";
    renderTitleProbe("/admin/dashboard", "");

    await waitFor(() => {
      expect(document.title).toBe("仪表盘 - 考试平台");
    });
  });
});

describe("AdminIndexRoute", () => {
  it("redirects Teacher to the exam list instead of the Admin dashboard", () => {
    renderAdminIndex({
      id: "teacher",
      username: "teacher",
      name: "教师",
      role: "Teacher",
      organizationId: "org",
    });

    expect(screen.getByTestId("current-path").textContent).toBe("/admin/exams");
  });

  it("keeps Proctor on a safe placeholder until a global surface exists", () => {
    renderAdminIndex({
      id: "proctor",
      username: "proctor",
      name: "监考员",
      role: "Proctor",
      organizationId: "org",
    });

    expect(screen.getByText("页面将在后续任务中实现。")).toBeInTheDocument();
    expect(screen.queryByTestId("current-path")).not.toBeInTheDocument();
  });
});
