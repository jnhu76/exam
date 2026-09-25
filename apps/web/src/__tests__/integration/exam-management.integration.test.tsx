import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { BrowserRouter } from "react-router";
import { AuthProvider } from "@/contexts/AuthContext";
import { ExamPage } from "@/pages/admin/ExamPage";
import { permissionsForRole } from "@exam/authz";

// ExamPage list rendering and action affordances are owned by
// ExamPage.test.tsx (role-scoped table assertions). This file keeps only the
// async request states of the page: empty, loading, and error.
const server = setupServer(
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

describe("考试管理请求状态", () => {
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

  it("应该显示加载状态直到请求完成", async () => {
    // Deferred handler: the request stays genuinely in flight until the test
    // resolves it. The loading claim is therefore the full lifecycle — the
    // loading state renders while pending AND transitions to content on
    // completion (a hardcoded loading state would fail the second half).
    let resolveExams: ((response: Response) => void) | undefined;
    server.use(
      http.get("http://localhost:5173/api/exams", () => {
        return new Promise<Response>((resolve) => {
          resolveExams = resolve;
        });
      }),
    );

    renderExamPage();

    // msw interception is async — wait until the deferred handler is invoked
    // (the request is genuinely in flight), then pin the loading state.
    await waitFor(() => {
      expect(resolveExams).toBeDefined();
    });
    expect(screen.getByText(/加载中/)).toBeInTheDocument();

    resolveExams!(
      HttpResponse.json({
        items: [
          {
            id: "exam-1",
            title: "示例考试",
            status: "draft",
            openAt: "2030-01-01T00:00:00Z",
            closeAt: "2030-01-02T00:00:00Z",
            durationMinutes: 60,
            passingScore: 60,
            totalScore: 100,
            questionIds: [],
            participantCount: 0,
            canDelete: true,
            deleteDisabledReasonCode: null,
            deleteDisabledReason: null,
          },
        ],
        total: 1,
        page: 1,
        pageSize: 20,
        totalPages: 1,
      }),
    );

    // Resolved → rows render (desktop table + mobile cards), loading gone.
    await waitFor(() => {
      expect(screen.getAllByText("示例考试").length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.queryByText(/加载中/)).not.toBeInTheDocument();
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
