import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { BrowserRouter } from "react-router";
import { AuthProvider } from "@/contexts/AuthContext";
import { ExamPage } from "@/pages/admin/ExamPage";
import { permissionsForRole } from "@exam/authz";

const server = setupServer(
  http.get("http://localhost:5173/api/exams", () => {
    return HttpResponse.json({
      items: [
        {
          id: "exam-1",
          title: "测试考试1",
          description: "这是一个测试考试",
          status: "published",
          durationMinutes: 60,
          passingScore: 60,
          totalScore: 100,
          courseId: "course-1",
          openAt: new Date().toISOString(),
          closeAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          questionIds: ["q1", "q2"],
          participantCount: 5,
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    });
  }),

  http.delete("http://localhost:5173/api/exams/:id", () => {
    return HttpResponse.json({ success: true });
  }),

  http.get("http://localhost:5173/api/auth/me", async () => {
    return HttpResponse.json({
      id: "user-1",
      username: "admin",
      name: "管理员",
      role: "Admin",
      organizationId: "org-1",
      capabilities: [...permissionsForRole("Admin")],
    });
  }),
);

describe("考试管理流程集成测试", () => {
  const renderExamPage = () => {
    return render(
      <BrowserRouter>
        <AuthProvider
          initialUser={{
            id: "user-1",
            username: "admin",
            name: "管理员",
            role: "Admin",
            organizationId: "org-1",
            capabilities: [...permissionsForRole("Admin")],
          }}
        >
          <ExamPage />
        </AuthProvider>
      </BrowserRouter>,
    );
  };

  beforeEach(() => {
    server.listen({ onUnhandledRequest: "error" });
  });

  afterEach(() => {
    server.close();
  });

  it("应该显示考试列表", async () => {
    renderExamPage();

    await waitFor(
      () => {
        expect(screen.getByText(/考试管理/)).toBeInTheDocument();
        // Row content renders twice by design (desktop table + mobile
        // cards); assert presence in at least the desktop table.
        const table = screen.getByRole("table");
        expect(within(table).getByText(/测试考试1/)).toBeInTheDocument();
      },
      { timeout: 3000 },
    );
  });

  it("应该显示创建考试按钮", async () => {
    renderExamPage();

    await waitFor(
      () => {
        expect(
          screen.getByRole("button", { name: /创建考试/ }),
        ).toBeInTheDocument();
      },
      { timeout: 3000 },
    );
  });

  it("应该显示考试状态标签", async () => {
    renderExamPage();

    await waitFor(
      () => {
        const table = screen.getByRole("table");
        expect(within(table).getByText(/已发布/)).toBeInTheDocument();
      },
      { timeout: 3000 },
    );
  });

  it("应该显示空状态当没有考试时", async () => {
    server.use(
      http.get("http://localhost:5173/api/exams", () => {
        return HttpResponse.json({
          items: [],
          total: 0,
          page: 1,
          pageSize: 20,
        });
      }),
    );

    renderExamPage();

    await waitFor(
      () => {
        expect(screen.getByText(/暂无考试/)).toBeInTheDocument();
      },
      { timeout: 3000 },
    );
  });

  it("应该显示加载状态", () => {
    server.use(
      http.get("http://localhost:5173/api/exams", () => {
        return new Promise(() => {});
      }),
    );

    renderExamPage();

    expect(screen.getByText(/加载中/)).toBeInTheDocument();
  });

  it("应该显示错误状态当请求失败时", async () => {
    server.use(
      http.get("http://localhost:5173/api/exams", () => {
        return HttpResponse.json(
          { error: "Internal server error" },
          { status: 500 },
        );
      }),
    );

    renderExamPage();

    await waitFor(
      () => {
        expect(screen.getByText(/加载考试列表失败/)).toBeInTheDocument();
      },
      { timeout: 3000 },
    );
  });
});
