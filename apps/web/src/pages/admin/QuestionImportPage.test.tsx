import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import { AuthProvider } from "@/contexts/AuthContext";
import { BrandProvider } from "@/components/layout/BrandProvider";
import { QuestionImportPage } from "./QuestionImportPage";
import { permissionsForRole } from "@exam/authz";

const { apiGet } = vi.hoisted(() => ({
  apiGet: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  ApiError: class ApiError extends Error {
    readonly status: number;
    readonly message: string;
    readonly code?: string;
    readonly details?: unknown;
    readonly requestId?: string;
    readonly serverMessage?: string;
    constructor(
      status: number,
      message: string,
      code?: string,
      details?: unknown,
      requestId?: string,
      serverMessage?: string,
    ) {
      super(message);
      this.name = "ApiError";
      this.status = status;
      this.message = message;
      this.code = code;
      this.details = details;
      this.requestId = requestId;
      this.serverMessage = serverMessage ?? message;
    }
  },
  api: {
    get: (...args: unknown[]) => apiGet(...args),
  },
  setNavigate: () => {},
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const courses = [
  { id: "c1", name: "数学", code: "MATH" },
  { id: "c2", name: "英语", code: "ENG" },
];

function renderPage(apiImpl?: (...args: unknown[]) => Promise<unknown>) {
  if (apiImpl) {
    apiGet.mockImplementation(apiImpl);
  } else {
    apiGet.mockImplementation(() => Promise.resolve({ items: courses }));
  }
  return render(
    <MemoryRouter initialEntries={["/admin/questions/import"]}>
      <AuthProvider
        initialUser={{
          id: "1",
          username: "admin",
          name: "Admin",
          role: "Admin",
          organizationId: "org1",
          capabilities: [...permissionsForRole("Admin")],
        }}
      >
        <BrandProvider>
          <Routes>
            <Route
              path="/admin/questions/import"
              element={<QuestionImportPage />}
            />
          </Routes>
        </BrandProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("QuestionImportPage", () => {
  beforeEach(() => {
    apiGet.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows loading skeleton while fetching courses", async () => {
    apiGet.mockImplementation(() => new Promise(() => {}));
    renderPage();
    expect(screen.getByRole("status")).toBeInTheDocument();
    await act(async () => {});
  });

  it("shows error state when courses API fails", async () => {
    renderPage(() => Promise.reject(new Error("network")));
    expect(await screen.findByText("加载课程列表失败")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /重试/ })).toBeInTheDocument();
  });

  it("renders import page with course selector and download button", async () => {
    renderPage();
    expect(await screen.findByText("导入题目")).toBeInTheDocument();
    expect(screen.getByText("下载模板")).toBeInTheDocument();
  });

  it("shows retry button on error", async () => {
    renderPage(() => Promise.reject(new Error("fail")));
    const retryBtn = await screen.findByRole("button", { name: /重试/ });
    expect(retryBtn).toBeInTheDocument();
  });
});
