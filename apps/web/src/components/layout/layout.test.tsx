import type { MeResponse } from "@exam/contracts";
import { permissionsForRole } from "@exam/authz";
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

const admin: MeResponse = {
  id: "00000000-0000-4000-8000-000000000001",
  organizationId: "00000000-0000-4000-8000-000000000010",
  username: "admin",
  name: "管理员",
  role: "Admin",
  capabilities: [...permissionsForRole("Admin")],
};

const candidate: MeResponse = {
  ...admin,
  id: "00000000-0000-4000-8000-000000000002",
  username: "candidate",
  name: "考生",
  role: "Candidate",
  capabilities: [...permissionsForRole("Candidate")],
};

const teacher: MeResponse = {
  ...admin,
  id: "a",
  username: "t",
  name: "教师",
  role: "Teacher",
  capabilities: [...permissionsForRole("Teacher")],
};
const grader: MeResponse = {
  ...admin,
  id: "b",
  username: "g",
  name: "评分员",
  role: "Grader",
  capabilities: [...permissionsForRole("Grader")],
};
const proctor: MeResponse = {
  ...admin,
  id: "c",
  username: "p",
  name: "监考员",
  role: "Proctor",
  capabilities: [...permissionsForRole("Proctor")],
};

// Multi-role users: capabilities are the union of both presets.
const candidateTeacher: MeResponse = {
  ...admin,
  id: "d",
  username: "ct",
  name: "考生+教师",
  role: "Candidate",
  capabilities: [
    ...permissionsForRole("Candidate"),
    ...permissionsForRole("Teacher"),
  ],
};

const teacherCandidate: MeResponse = {
  ...admin,
  id: "e",
  username: "tc",
  name: "教师+考生",
  role: "Teacher",
  capabilities: [
    ...permissionsForRole("Teacher"),
    ...permissionsForRole("Candidate"),
  ],
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

  it("hides management section for Candidate role", () => {
    renderWithProviders(
      <AppSidebar user={candidate} collapsed={false} onLogout={() => {}} />,
    );
    expect(screen.queryByText("管理")).not.toBeInTheDocument();
  });

  it("hides question bank group for candidate role (P4-4: candidate sees no admin nav)", () => {
    renderWithProviders(
      <AppSidebar user={candidate} collapsed={false} onLogout={() => {}} />,
    );
    expect(screen.queryByText("题库")).not.toBeInTheDocument();
    expect(screen.queryByText("课程管理")).not.toBeInTheDocument();
    expect(screen.queryByText("题目管理")).not.toBeInTheDocument();
  });

  it("shows question bank group for admin role", () => {
    renderWithProviders(
      <AppSidebar user={admin} collapsed={false} onLogout={() => {}} />,
    );
    expect(screen.getByText("题库")).toBeInTheDocument();
    expect(screen.getByText("课程管理")).toBeInTheDocument();
    expect(screen.getByText("题目管理")).toBeInTheDocument();
  });

  it("hides exam group for candidate role (P4-4: candidate sees no admin nav)", () => {
    renderWithProviders(
      <AppSidebar user={candidate} collapsed={false} onLogout={() => {}} />,
    );
    expect(screen.queryByText("考试")).not.toBeInTheDocument();
    expect(screen.queryByText("考试管理")).not.toBeInTheDocument();
    expect(screen.queryByText("成绩查询")).not.toBeInTheDocument();
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

  // ── P4-4: Teacher/Grader/Proctor nav visibility ──
  it("Teacher sees question bank and exams but NOT grading/management (P4-4)", () => {
    renderWithProviders(
      <AppSidebar user={teacher} collapsed={false} onLogout={() => {}} />,
    );
    expect(screen.getByText("题库")).toBeInTheDocument();
    expect(screen.getByText("课程管理")).toBeInTheDocument();
    expect(screen.getByText("题目管理")).toBeInTheDocument();
    expect(screen.getByText("题目导入")).toBeInTheDocument();
    expect(screen.getByText("考试")).toBeInTheDocument();
    expect(screen.getByText("考试管理")).toBeInTheDocument();
    expect(screen.getByText("成绩查询")).toBeInTheDocument();
    expect(screen.queryByText("评分队列")).not.toBeInTheDocument();
    expect(screen.queryByText("用户管理")).not.toBeInTheDocument();
    expect(screen.queryByText("仪表盘")).not.toBeInTheDocument();
  });

  it("Grader sees grading queue but NOT question bank/exams/management (P4-4)", () => {
    renderWithProviders(
      <AppSidebar user={grader} collapsed={false} onLogout={() => {}} />,
    );
    expect(screen.getByText("待评分")).toBeInTheDocument();
    expect(screen.queryByText("题库")).not.toBeInTheDocument();
    expect(screen.queryByText("考试管理")).not.toBeInTheDocument();
    expect(screen.queryByText("用户管理")).not.toBeInTheDocument();
    expect(screen.queryByText("仪表盘")).not.toBeInTheDocument();
  });

  it("Proctor sees only the monitoring workspace entry", () => {
    renderWithProviders(
      <AppSidebar user={proctor} collapsed={false} onLogout={() => {}} />,
    );
    expect(screen.getByRole("link", { name: "监考工作台" })).toHaveAttribute(
      "href",
      "/admin/proctor",
    );
    expect(screen.queryByText("题库")).not.toBeInTheDocument();
    expect(screen.queryByText("考试管理")).not.toBeInTheDocument();
    expect(screen.queryByText("评分队列")).not.toBeInTheDocument();
    expect(screen.queryByText("用户管理")).not.toBeInTheDocument();
    expect(screen.queryByText("仪表盘")).not.toBeInTheDocument();
  });

  it.each([
    ["Teacher", teacher],
    ["Grader", grader],
    ["Candidate", candidate],
  ] as const)(
    "%s does not see the monitoring workspace entry",
    (_role, user) => {
      renderWithProviders(
        <AppSidebar user={user} collapsed={false} onLogout={() => {}} />,
      );
      expect(screen.queryByText("监考工作台")).not.toBeInTheDocument();
    },
  );
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

describe("Admin shell viewport-scrolling contract (MVP-P2-04)", () => {
  it("keeps the desktop sidebar attached to the viewport (sticky h-screen self-start)", () => {
    renderWithProviders(
      <AppSidebar user={admin} collapsed={false} onLogout={() => {}} />,
    );
    const aside = screen.getByTestId("app-sidebar");
    // The aside must not stretch to the page height (min-h-screen). It is a
    // viewport-constrained, self-starting flex item that sticks to the top of
    // the scrollport while the main document scrolls.
    expect(aside).toHaveClass(
      "sticky",
      "top-0",
      "h-screen",
      "min-h-0",
      "self-start",
    );
  });

  it("gives the sidebar navigation its own internal scroll region", () => {
    renderWithProviders(
      <AppSidebar user={admin} collapsed={false} onLogout={() => {}} />,
    );
    const nav = screen
      .getByTestId("app-sidebar")
      .querySelector("nav") as HTMLElement;
    expect(nav).not.toBeNull();
    // flex-1 + min-h-0 + overflow-y-auto: the nav region shrinks within the
    // h-screen sidebar and scrolls independently instead of growing the page.
    expect(nav).toHaveClass("flex-1", "min-h-0", "overflow-y-auto");
  });

  it("keeps the sidebar header and footer from being compressed by the nav region", () => {
    renderWithProviders(
      <AppSidebar user={admin} collapsed={false} onLogout={() => {}} />,
    );
    const aside = screen.getByTestId("app-sidebar");
    const brandHeader = aside.firstElementChild as HTMLElement;
    expect(brandHeader).toHaveClass("shrink-0");
    const logoutButton = aside.querySelector(
      'button[aria-label="退出登录"]',
    ) as HTMLElement;
    expect(logoutButton).not.toBeNull();
    expect(logoutButton.parentElement).toHaveClass("shrink-0");
  });

  it("renders the Admin topbar as a sticky, opaque surface below overlay z-index", () => {
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
    const header = screen
      .getByTestId("admin-layout")
      .querySelector("header") as HTMLElement;
    expect(header).not.toBeNull();
    // Sticky + opaque bg; z-40 stays below dialog/sheet/popover overlays (z-50).
    expect(header).toHaveClass("sticky", "top-0", "z-40", "bg-card");
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
        <Route path="/login" element={<div>login page</div>} />
      </Routes>,
      "/admin/dashboard",
    );
    expect(screen.queryByTestId("admin-layout")).not.toBeInTheDocument();
  });

  it("ExamLayout redirects non-ExamTake users with admin console to admin landing", () => {
    // Admin has no ExamTake but has admin console → redirect to dashboard.
    renderWithProviders(
      <AuthProvider initialUser={admin}>
        <Routes>
          <Route path="/exam/list" element={<ExamLayout />} />
          <Route path="/admin/dashboard" element={<div>admin dashboard</div>} />
          <Route path="/login" element={<div>login page</div>} />
        </Routes>
      </AuthProvider>,
      "/exam/list",
    );
    expect(screen.getByText("admin dashboard")).toBeInTheDocument();
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

  // ── RBAC-M10-E-FRONTEND-MULTI-ROLE-SHELL-CORRECTIVE-1 ──

  it("AdminLayout renders for Teacher (single-role console user)", () => {
    renderWithProviders(
      <AuthProvider initialUser={teacher}>
        <Routes>
          <Route path="/admin" element={<AdminLayout />}>
            <Route path="exams" element={<PlaceholderPage />} />
          </Route>
        </Routes>
      </AuthProvider>,
      "/admin/exams",
    );
    expect(screen.getByTestId("admin-layout")).toBeInTheDocument();
  });

  it("AdminLayout renders for Grader (single-role console user)", () => {
    renderWithProviders(
      <AuthProvider initialUser={grader}>
        <Routes>
          <Route path="/admin" element={<AdminLayout />}>
            <Route path="grading-queue" element={<PlaceholderPage />} />
          </Route>
        </Routes>
      </AuthProvider>,
      "/admin/grading-queue",
    );
    expect(screen.getByTestId("admin-layout")).toBeInTheDocument();
  });

  it("AdminLayout renders for Proctor (single-role console user)", () => {
    renderWithProviders(
      <AuthProvider initialUser={proctor}>
        <Routes>
          <Route path="/admin" element={<AdminLayout />}>
            <Route path="proctor" element={<PlaceholderPage />} />
          </Route>
        </Routes>
      </AuthProvider>,
      "/admin/proctor",
    );
    expect(screen.getByTestId("admin-layout")).toBeInTheDocument();
  });

  it("AdminLayout redirects pure Candidate to exam list", () => {
    renderWithProviders(
      <AuthProvider initialUser={candidate}>
        <Routes>
          <Route path="/admin" element={<AdminLayout />}>
            <Route path="*" element={<PlaceholderPage />} />
          </Route>
          <Route path="/exam/list" element={<div>exam list page</div>} />
          <Route path="/login" element={<div>login page</div>} />
        </Routes>
      </AuthProvider>,
      "/admin/dashboard",
    );
    expect(screen.getByText("exam list page")).toBeInTheDocument();
  });

  it("AdminLayout renders for primary Candidate + secondary Teacher", () => {
    renderWithProviders(
      <AuthProvider initialUser={candidateTeacher}>
        <Routes>
          <Route path="/admin" element={<AdminLayout />}>
            <Route path="exams" element={<PlaceholderPage />} />
          </Route>
        </Routes>
      </AuthProvider>,
      "/admin/exams",
    );
    expect(screen.getByTestId("admin-layout")).toBeInTheDocument();
  });

  it("ExamLayout renders for primary Teacher + secondary Candidate", () => {
    renderWithProviders(
      <AuthProvider initialUser={teacherCandidate}>
        <Routes>
          <Route path="/exam/list" element={<ExamLayout />} />
        </Routes>
      </AuthProvider>,
      "/exam/list",
    );
    expect(screen.getByTestId("exam-layout")).toBeInTheDocument();
  });

  it("ExamLayout renders for primary Candidate + secondary Teacher", () => {
    renderWithProviders(
      <AuthProvider initialUser={candidateTeacher}>
        <Routes>
          <Route path="/exam/list" element={<ExamLayout />} />
        </Routes>
      </AuthProvider>,
      "/exam/list",
    );
    expect(screen.getByTestId("exam-layout")).toBeInTheDocument();
  });

  it("AdminLayout redirects user with no capabilities to login", () => {
    const noCap: MeResponse = {
      ...admin,
      capabilities: [],
    };
    renderWithProviders(
      <AuthProvider initialUser={noCap}>
        <Routes>
          <Route path="/admin" element={<AdminLayout />}>
            <Route path="*" element={<PlaceholderPage />} />
          </Route>
          <Route path="/login" element={<div>login page</div>} />
        </Routes>
      </AuthProvider>,
      "/admin/dashboard",
    );
    expect(screen.getByText("login page")).toBeInTheDocument();
  });

  // ── P4-C2: per-route capability guard (direct-URL denial) ──

  /**
   * P4-G-02 closure. An authenticated console user who direct-URLs a
   * /admin/* page whose capability they lack must see the 403 Access-Denied
   * page, NOT the privileged page. The shell still renders (the user is in the
   * console); only the routed page is replaced.
   */
  it("P4-C2: Teacher direct-URL /admin/users renders the 403 page, not the privileged page", () => {
    renderWithProviders(
      <AuthProvider initialUser={teacher}>
        <Routes>
          <Route path="/admin" element={<AdminLayout />}>
            <Route path="users" element={<div>users page content</div>} />
          </Route>
        </Routes>
      </AuthProvider>,
      "/admin/users",
    );
    // Shell still renders.
    expect(screen.getByTestId("admin-layout")).toBeInTheDocument();
    // Privileged page content must NOT render.
    expect(screen.queryByText("users page content")).not.toBeInTheDocument();
    // The 403 access-denied message renders.
    expect(screen.getByText("您没有权限访问该页面。")).toBeInTheDocument();
  });

  it("P4-C2: Teacher direct-URL /admin/grading-queue renders the 403 page", () => {
    renderWithProviders(
      <AuthProvider initialUser={teacher}>
        <Routes>
          <Route path="/admin" element={<AdminLayout />}>
            <Route
              path="grading-queue"
              element={<div>grading queue content</div>}
            />
          </Route>
        </Routes>
      </AuthProvider>,
      "/admin/grading-queue",
    );
    expect(screen.queryByText("grading queue content")).not.toBeInTheDocument();
    expect(screen.getByText("您没有权限访问该页面。")).toBeInTheDocument();
  });

  it("P4-C2: Teacher ALLOW direct-URL /admin/exams renders the page normally", () => {
    renderWithProviders(
      <AuthProvider initialUser={teacher}>
        <Routes>
          <Route path="/admin" element={<AdminLayout />}>
            <Route path="exams" element={<div>exams page content</div>} />
          </Route>
        </Routes>
      </AuthProvider>,
      "/admin/exams",
    );
    expect(screen.getByText("exams page content")).toBeInTheDocument();
    expect(
      screen.queryByText("您没有权限访问该页面。"),
    ).not.toBeInTheDocument();
  });

  it("P4-C2: Teacher ALLOW direct-URL /admin/questions/import renders the page", () => {
    renderWithProviders(
      <AuthProvider initialUser={teacher}>
        <Routes>
          <Route path="/admin" element={<AdminLayout />}>
            <Route
              path="questions/import"
              element={<div>import page content</div>}
            />
          </Route>
        </Routes>
      </AuthProvider>,
      "/admin/questions/import",
    );
    expect(screen.getByText("import page content")).toBeInTheDocument();
  });

  it("P4-C2: Candidate (no console cap) is redirected away from any /admin/* URL", () => {
    // Candidate has no admin-console capability at all → the shell redirect
    // fires before the per-route guard (console-access check is first).
    renderWithProviders(
      <AuthProvider initialUser={candidate}>
        <Routes>
          <Route path="/admin" element={<AdminLayout />}>
            <Route path="users" element={<div>users page content</div>} />
          </Route>
          <Route path="/exam/list" element={<div>exam list</div>} />
        </Routes>
      </AuthProvider>,
      "/admin/users",
    );
    expect(screen.queryByText("users page content")).not.toBeInTheDocument();
    expect(screen.getByText("exam list")).toBeInTheDocument();
  });

  it("P4-C2: multi-role primary Candidate + secondary Teacher reaches Teacher pages (union, not primary role)", () => {
    renderWithProviders(
      <AuthProvider initialUser={candidateTeacher}>
        <Routes>
          <Route path="/admin" element={<AdminLayout />}>
            <Route path="exams" element={<div>exams page content</div>} />
          </Route>
        </Routes>
      </AuthProvider>,
      "/admin/exams",
    );
    expect(screen.getByText("exams page content")).toBeInTheDocument();
    expect(
      screen.queryByText("您没有权限访问该页面。"),
    ).not.toBeInTheDocument();
  });

  it("ExamLayout redirects user with no capabilities to login", () => {
    const noCap: MeResponse = {
      ...admin,
      capabilities: [],
    };
    renderWithProviders(
      <AuthProvider initialUser={noCap}>
        <Routes>
          <Route path="/exam/list" element={<ExamLayout />} />
          <Route path="/login" element={<div>login page</div>} />
        </Routes>
      </AuthProvider>,
      "/exam/list",
    );
    expect(screen.getByText("login page")).toBeInTheDocument();
  });
});
