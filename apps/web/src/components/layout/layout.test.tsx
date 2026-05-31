import type { User } from "@exam/domain";
import { Role } from "@exam/domain";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";
import { AppSidebar } from "./AppSidebar";
import { BrandProvider, useBranding } from "./BrandProvider";
import { ExamLayout } from "./ExamLayout";
import { LoginPage } from "@/pages/LoginPage";
import { AuthProvider } from "@/contexts/AuthContext";

const admin: User = {
  id: "admin",
  organizationId: "org",
  username: "admin",
  passwordHash: "",
  name: "管理员",
  role: Role.Admin,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const candidate: User = {
  ...admin,
  id: "candidate-1",
  username: "candidate",
  name: "考生",
  role: Role.Candidate,
};

function BrandingProbe() {
  const branding = useBranding();
  return <p>{branding.productName}</p>;
}

function renderWithProviders(ui: React.ReactElement, route = "/") {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <AuthProvider>
        <BrandProvider>{ui}</BrandProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("branding", () => {
  it("provides generic fallback branding", () => {
    renderWithProviders(<BrandingProbe />);
    expect(screen.getByText("内网考试平台")).toBeInTheDocument();
  });

  it("exposes product subtitle in branding", () => {
    renderWithProviders(
      <Routes>
        <Route path="/login" element={<LoginPage />} />
      </Routes>,
      "/login",
    );
    expect(screen.getByText("机构内部测评与准入认证")).toBeInTheDocument();
  });
});

describe("AppSidebar role visibility", () => {
  it("shows management section for Admin role", () => {
    renderWithProviders(
      <AppSidebar user={admin} collapsed={false} onLogout={() => {}} />,
    );
    expect(screen.getByText("平台设置")).toBeInTheDocument();
    expect(screen.queryByText("机构管理")).not.toBeInTheDocument();
  });

  it("shows organization management for SuperAdmin", () => {
    renderWithProviders(
      <AppSidebar
        user={{ ...admin, role: Role.SuperAdmin }}
        collapsed={false}
        onLogout={() => {}}
      />,
    );
    expect(screen.getByText("机构管理")).toBeInTheDocument();
  });

  it("hides management section for Teacher role", () => {
    renderWithProviders(
      <AppSidebar
        user={{ ...admin, role: Role.Teacher }}
        collapsed={false}
        onLogout={() => {}}
      />,
    );
    expect(screen.queryByText("平台设置")).not.toBeInTheDocument();
    expect(screen.queryByText("管理")).not.toBeInTheDocument();
  });

  it("hides management section for Candidate role", () => {
    renderWithProviders(
      <AppSidebar user={candidate} collapsed={false} onLogout={() => {}} />,
    );
    expect(screen.queryByText("管理")).not.toBeInTheDocument();
  });

  it("always shows question bank group for all roles", () => {
    renderWithProviders(
      <AppSidebar user={candidate} collapsed={false} onLogout={() => {}} />,
    );
    expect(screen.getByText("题库")).toBeInTheDocument();
    expect(screen.getByText("课程管理")).toBeInTheDocument();
    expect(screen.getByText("题目管理")).toBeInTheDocument();
  });

  it("always shows exam group for all roles", () => {
    renderWithProviders(
      <AppSidebar user={candidate} collapsed={false} onLogout={() => {}} />,
    );
    expect(screen.getByText("考试")).toBeInTheDocument();
    expect(screen.getByText("考试管理")).toBeInTheDocument();
    expect(screen.getByText("成绩查询")).toBeInTheDocument();
  });

  it("collapses to icon-only mode", () => {
    renderWithProviders(
      <AppSidebar user={admin} collapsed={true} onLogout={() => {}} />,
    );
    expect(screen.queryByText("题库")).not.toBeInTheDocument();
    expect(screen.queryByText("管理")).not.toBeInTheDocument();
    expect(screen.queryByText("退出")).not.toBeInTheDocument();
  });

  it("shows user name when not collapsed", () => {
    renderWithProviders(
      <AppSidebar user={admin} collapsed={false} onLogout={() => {}} />,
    );
    expect(screen.getByText("管理员")).toBeInTheDocument();
  });

  it("hides user name when collapsed", () => {
    renderWithProviders(
      <AppSidebar user={admin} collapsed={true} onLogout={() => {}} />,
    );
    expect(screen.queryByText("管理员")).not.toBeInTheDocument();
  });
});

describe("layout shells", () => {
  it("renders LoginPage with login layout test id", () => {
    renderWithProviders(
      <Routes>
        <Route path="/login" element={<LoginPage />} />
      </Routes>,
      "/login",
    );
    expect(screen.getByTestId("login-layout")).toBeInTheDocument();
  });

  it("renders ExamLayout with exam layout test id", () => {
    renderWithProviders(
      <Routes>
        <Route path="/exam/list" element={<ExamLayout />} />
      </Routes>,
      "/exam/list",
    );
    expect(screen.getByTestId("exam-layout")).toBeInTheDocument();
  });

  it("LoginPage does not render sidebar or exam layout", () => {
    renderWithProviders(
      <Routes>
        <Route path="/login" element={<LoginPage />} />
      </Routes>,
      "/login",
    );
    expect(screen.queryByTestId("app-sidebar")).not.toBeInTheDocument();
    expect(screen.queryByTestId("exam-layout")).not.toBeInTheDocument();
  });

  it("ExamLayout does not render sidebar or login layout", () => {
    renderWithProviders(
      <Routes>
        <Route path="/exam/list" element={<ExamLayout />} />
      </Routes>,
      "/exam/list",
    );
    expect(screen.queryByTestId("app-sidebar")).not.toBeInTheDocument();
    expect(screen.queryByTestId("login-layout")).not.toBeInTheDocument();
  });
});
