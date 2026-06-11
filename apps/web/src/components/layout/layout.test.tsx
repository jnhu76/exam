import type { User } from "@exam/domain";
import { Role } from "@exam/domain";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";
import { AppSidebar } from "./AppSidebar";
import { AdminLayout } from "./AdminLayout";
import { BrandHeader } from "./BrandHeader";
import { BrandProvider, useBranding } from "./BrandProvider";
import { ExamLayout } from "./ExamLayout";
import { LoginPage } from "@/pages/LoginPage";
import { PlaceholderPage } from "@/pages/PlaceholderPage";
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
    expect(screen.getByText("考试平台")).toBeInTheDocument();
  });

  it("exposes product subtitle in branding", () => {
    renderWithProviders(
      <Routes>
        <Route path="/login" element={<LoginPage />} />
      </Routes>,
      "/login",
    );
    expect(screen.getByText("内部考核与准入控制")).toBeInTheDocument();
  });

  it("renders a stable BrandMark fallback with the product name", () => {
    renderWithProviders(<BrandHeader />);

    expect(screen.getByTestId("brand-mark")).toBeInTheDocument();
    expect(screen.getByText("考试平台")).toBeInTheDocument();
  });

  it("keeps BrandMark visible in compact mode", () => {
    renderWithProviders(<BrandHeader compact />);

    expect(screen.getByTestId("brand-mark")).toBeInTheDocument();
    expect(screen.getByText("考试平台")).toHaveClass("sr-only");
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
    expect(
      screen.queryByText("管理", { selector: "p" }),
    ).not.toBeInTheDocument();
  });

  it("hides management section for Candidate role", () => {
    renderWithProviders(
      <AppSidebar user={candidate} collapsed={false} onLogout={() => {}} />,
    );
    expect(screen.queryByText("管理")).not.toBeInTheDocument();
  });

  it("shows question bank group for candidate role", () => {
    renderWithProviders(
      <AppSidebar user={candidate} collapsed={false} onLogout={() => {}} />,
    );
    expect(screen.getByText("题库")).toBeInTheDocument();
    expect(screen.getByText("课程管理")).toBeInTheDocument();
    expect(screen.getByText("题目管理")).toBeInTheDocument();
  });

  it("shows question bank group for admin role", () => {
    renderWithProviders(
      <AppSidebar user={admin} collapsed={false} onLogout={() => {}} />,
    );
    expect(screen.getByText("题库")).toBeInTheDocument();
    expect(screen.getByText("课程管理")).toBeInTheDocument();
    expect(screen.getByText("题目管理")).toBeInTheDocument();
  });

  it("shows question bank group for teacher role", () => {
    renderWithProviders(
      <AppSidebar
        user={{ ...admin, role: Role.Teacher }}
        collapsed={false}
        onLogout={() => {}}
      />,
    );
    expect(screen.getByText("题库")).toBeInTheDocument();
    expect(screen.getByText("课程管理")).toBeInTheDocument();
    expect(screen.getByText("题目管理")).toBeInTheDocument();
  });

  it("shows exam group for candidate role", () => {
    renderWithProviders(
      <AppSidebar user={candidate} collapsed={false} onLogout={() => {}} />,
    );
    expect(screen.getByText("考试")).toBeInTheDocument();
    expect(screen.getByText("考试管理")).toBeInTheDocument();
    expect(screen.getByText("成绩查询")).toBeInTheDocument();
  });

  it("shows exam group for admin role", () => {
    renderWithProviders(
      <AppSidebar user={admin} collapsed={false} onLogout={() => {}} />,
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
    expect(
      screen.queryByText("管理", { selector: "p" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("退出")).not.toBeInTheDocument();
  });

  it("separates BrandMark from the expanded collapse control", () => {
    renderWithProviders(
      <AppSidebar
        user={admin}
        collapsed={false}
        onCollapse={() => {}}
        onLogout={() => {}}
      />,
    );

    expect(screen.getByTestId("brand-mark")).toBeInTheDocument();
    expect(screen.getByText("考试平台")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "折叠侧栏" })).toHaveAttribute(
      "data-testid",
      "sidebar-collapse-button",
    );
  });

  it("keeps BrandMark visible beside a separate expand control when collapsed", () => {
    renderWithProviders(
      <AppSidebar
        user={admin}
        collapsed={true}
        onCollapse={() => {}}
        onLogout={() => {}}
      />,
    );

    expect(screen.getByTestId("brand-mark")).toBeInTheDocument();
    expect(screen.getByText("考试平台")).toHaveClass("sr-only");
    expect(screen.getByRole("button", { name: "展开侧栏" })).toHaveAttribute(
      "data-testid",
      "sidebar-collapse-button",
    );
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

describe("AppSidebar nav links", () => {
  it("考试管理 link points to /admin/exams", () => {
    renderWithProviders(
      <AppSidebar user={admin} collapsed={false} onLogout={() => {}} />,
    );
    const link = screen.getByRole("link", { name: "考试管理" });
    expect(link).toHaveAttribute("href", "/admin/exams");
  });

  it("成绩查询 link points to /admin/results", () => {
    renderWithProviders(
      <AppSidebar user={admin} collapsed={false} onLogout={() => {}} />,
    );
    const link = screen.getByRole("link", { name: "成绩查询" });
    expect(link).toHaveAttribute("href", "/admin/results");
  });
});

describe("ExamLayout header navigation", () => {
  it("uses NavLink for header navigation links", () => {
    renderWithProviders(
      <AuthProvider initialUser={candidate}>
        <Routes>
          <Route path="/exam/list" element={<ExamLayout />} />
        </Routes>
      </AuthProvider>,
      "/exam/list",
    );
    const myExamLink = screen.getByRole("link", { name: "我的考试" });
    expect(myExamLink).toHaveAttribute("href", "/exam/list");
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
      <AuthProvider initialUser={candidate}>
        <Routes>
          <Route path="/exam/list" element={<ExamLayout />} />
        </Routes>
      </AuthProvider>,
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
      <AuthProvider initialUser={candidate}>
        <Routes>
          <Route path="/exam/list" element={<ExamLayout />} />
        </Routes>
      </AuthProvider>,
      "/exam/list",
    );
    expect(screen.queryByTestId("app-sidebar")).not.toBeInTheDocument();
    expect(screen.queryByTestId("login-layout")).not.toBeInTheDocument();
  });

  it("AdminLayout renders with admin layout test id", () => {
    renderWithProviders(
      <AuthProvider initialUser={admin}>
        <Routes>
          <Route path="/admin" element={<AdminLayout />}>
            <Route path="*" element={<PlaceholderPage />} />
          </Route>
        </Routes>
      </AuthProvider>,
      "/admin/dashboard",
    );
    expect(screen.getByTestId("admin-layout")).toBeInTheDocument();
    expect(screen.getByTestId("app-sidebar")).toBeInTheDocument();
  });

  it("AdminLayout does not render without user", () => {
    renderWithProviders(
      <Routes>
        <Route path="/admin" element={<AdminLayout />}>
          <Route path="*" element={<PlaceholderPage />} />
        </Route>
      </Routes>,
      "/admin/dashboard",
    );
    expect(screen.queryByTestId("admin-layout")).not.toBeInTheDocument();
  });

  it("ExamLayout redirects non-Candidate users to login", () => {
    renderWithProviders(
      <AuthProvider initialUser={admin}>
        <Routes>
          <Route path="/exam/list" element={<ExamLayout />} />
          <Route path="/login" element={<div>login page</div>} />
        </Routes>
      </AuthProvider>,
      "/exam/list",
    );
    expect(screen.getByText("login page")).toBeInTheDocument();
  });

  it("ExamLayout renders exam layout for Candidate", () => {
    renderWithProviders(
      <AuthProvider initialUser={candidate}>
        <Routes>
          <Route path="/exam/list" element={<ExamLayout />} />
        </Routes>
      </AuthProvider>,
      "/exam/list",
    );
    expect(screen.getByTestId("exam-layout")).toBeInTheDocument();
  });
});
