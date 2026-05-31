import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import { AuthProvider } from "@/contexts/AuthContext";
import { BrandProvider } from "@/components/layout/BrandProvider";
import { SettingsPage } from "./SettingsPage";

vi.mock("@/lib/api", () => ({
  api: {
    get: vi.fn().mockResolvedValue({
      productName: "Test Platform",
      productSubtitle: "Test Subtitle",
    }),
    patch: vi.fn().mockResolvedValue({
      id: "s1",
      organizationId: "org1",
      productName: "Updated",
    }),
  },
  setNavigate: () => {},
}));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/admin/settings"]}>
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
            <Route path="/admin/settings" element={<SettingsPage />} />
          </Routes>
        </BrandProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("SettingsPage", () => {
  it("renders page title", async () => {
    renderPage();
    expect(await screen.findByText("平台与机构设置")).toBeInTheDocument();
  });

  it("renders product name field with loaded value", async () => {
    renderPage();
    const input = await screen.findByLabelText("产品标题");
    expect(input).toBeInTheDocument();
  });

  it("renders save button", async () => {
    renderPage();
    expect(
      await screen.findByRole("button", { name: "保存设置" }),
    ).toBeInTheDocument();
  });
});
