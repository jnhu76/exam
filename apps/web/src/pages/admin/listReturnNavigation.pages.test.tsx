import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { AuthProvider } from "@/contexts/AuthContext";
import { BrandProvider } from "@/components/layout/BrandProvider";
import { ExamCreatePage } from "./ExamCreatePage";
import { ExamDetailPage } from "./ExamDetailPage";
import { QuestionEditPage } from "./QuestionEditPage";
import { QuestionImportPage } from "./QuestionImportPage";
import { permissionsForRole } from "@exam/authz";

/**
 * #784 stage A — A05 / C2 at component level: the internal return points must
 * restore the list query they were entered from, and must NEVER navigate to a
 * target outside their own list route.
 *
 * The full malformed-input matrix is pinned by the resolver's unit tests
 * (listReturnNavigation.test.ts); here the REAL pages are exercised, because a
 * correct resolver wired to a hardcoded path — or wired to the wrong list —
 * would still pass the unit tests.
 */

const { apiGet, apiPost } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  ApiError: class ApiError extends Error {
    readonly status: number;
    constructor(status: number, message: string) {
      super(message);
      this.name = "ApiError";
      this.status = status;
    }
  },
  api: {
    get: (...args: unknown[]) => apiGet(...args),
    post: (...args: unknown[]) => apiPost(...args),
    delete: vi.fn(),
  },
  setNavigate: () => {},
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const examFixture = {
  id: "exam-1",
  title: "期末能力测评",
  description: "",
  courseId: "course-1",
  status: "draft",
  timingMode: "timed_window",
  durationMinutes: 60,
  openAt: new Date().toISOString(),
  closeAt: new Date(Date.now() + 86_400_000).toISOString(),
  passingScore: 60,
  totalScore: 100,
  questionIds: ["q1", "q2"],
  controlFlags: {},
  retakePolicy: "no-retake",
  scoreStrategy: "best",
  maxAttempts: 1,
  stats: { participantCount: 0, completedCount: 0, passedCount: 0 },
  participants: [],
};

/**
 * The detail page fetches its roster in parallel with the exam itself, so the
 * fixture has to answer both shapes — a single object for the exam, a list for
 * the enrollments — or the page never reaches its header actions.
 */
function mockExamDetailApi() {
  apiGet.mockImplementation((path: string) =>
    path.includes("/enrollments")
      ? Promise.resolve([])
      : Promise.resolve(examFixture),
  );
}

/**
 * A permissive read model for the entry pages: the list endpoints answer a
 * paginated envelope, the picker endpoints an empty collection.
 */
function mockPageData() {
  // The import flow reaches its back control only after a validation round
  // trip, so the import endpoint answers a one-row result.
  apiPost.mockImplementation(() =>
    Promise.resolve({
      total: 1,
      valid: 1,
      warnings: 0,
      errors: 0,
      details: [{ row: 1, status: "valid" }],
    }),
  );
  apiGet.mockImplementation((path: string) => {
    if (path.includes("/courses")) {
      return Promise.resolve({
        items: [{ id: "course-1", name: "课程一", code: "C1" }],
        total: 1,
        page: 1,
        pageSize: 20,
        totalPages: 1,
      });
    }
    if (path.includes("/questions")) {
      return Promise.resolve({
        items: [],
        total: 0,
        page: 1,
        pageSize: 100,
        totalPages: 1,
      });
    }
    return Promise.resolve([]);
  });
}

function LocationProbe() {
  const location = useLocation();
  return (
    <div data-testid="location">
      {location.pathname}
      {location.search}
    </div>
  );
}

function renderAt(
  entry: { pathname: string; state?: unknown },
  element: React.ReactNode,
  routePath: string,
) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <AuthProvider
        initialUser={{
          id: "admin-1",
          username: "admin",
          name: "Admin",
          role: "Admin",
          organizationId: "org1",
          capabilities: [...permissionsForRole("Admin")],
        }}
      >
        <BrandProvider>
          <Routes>
            <Route path={routePath} element={element} />
          </Routes>
          <LocationProbe />
        </BrandProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

function locationText(): string {
  return screen.getByTestId("location").textContent ?? "";
}

describe("internal return restores the list query (#784 A05 / C2)", () => {
  it("the exam detail back action returns to the filtered, paged list URL", async () => {
    mockExamDetailApi();
    const user = userEvent.setup();
    renderAt(
      {
        pathname: "/admin/exams/exam-1",
        state: { from: "/admin/exams?status=published&page=3" },
      },
      <ExamDetailPage />,
      "/admin/exams/:id",
    );

    await user.click(await screen.findByRole("button", { name: "返回列表" }));
    expect(locationText()).toBe("/admin/exams?status=published&page=3");
  });

  it("the exam detail back action falls back to the bare list for a hostile target", async () => {
    mockExamDetailApi();
    const user = userEvent.setup();
    const hostile = [
      "//evil.example/admin/exams",
      "/\\evil.example",
      "/\t/evil.example",
      "/admin/questions?page=2",
      "/admin/exams/../questions",
      "",
      "admin/exams",
    ];
    for (const from of hostile) {
      const view = renderAt(
        { pathname: "/admin/exams/exam-1", state: { from } },
        <ExamDetailPage />,
        "/admin/exams/:id",
      );
      await user.click(await screen.findByRole("button", { name: "返回列表" }));
      expect(locationText()).toBe("/admin/exams");
      view.unmount();
    }
  });

  it("the question editor cancel returns to the filtered list URL", async () => {
    apiGet.mockResolvedValue({
      items: [{ id: "course-1", name: "课程一", code: "C1" }],
      total: 1,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    });
    const user = userEvent.setup();
    renderAt(
      {
        pathname: "/admin/questions/new",
        state: { from: "/admin/questions?courseId=course-1&page=2" },
      },
      <QuestionEditPage />,
      "/admin/questions/new",
    );

    await user.click(await screen.findByRole("button", { name: "取消" }));
    expect(locationText()).toBe("/admin/questions?courseId=course-1&page=2");
  });

  it("the question editor cancel falls back to the bare list for a hostile target", async () => {
    apiGet.mockResolvedValue({
      items: [{ id: "course-1", name: "课程一", code: "C1" }],
      total: 1,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    });
    const user = userEvent.setup();
    renderAt(
      {
        pathname: "/admin/questions/new",
        state: { from: "/admin/exams?status=open" },
      },
      <QuestionEditPage />,
      "/admin/questions/new",
    );

    await user.click(await screen.findByRole("button", { name: "取消" }));
    // The other list's route is not an acceptable target for this exit.
    expect(locationText()).toBe("/admin/questions");
  });

  it("a detail page opened without a carried target returns to the bare list", async () => {
    mockExamDetailApi();
    const user = userEvent.setup();
    renderAt(
      { pathname: "/admin/exams/exam-1" },
      <ExamDetailPage />,
      "/admin/exams/:id",
    );

    await user.click(await screen.findByRole("button", { name: "返回列表" }));
    expect(locationText()).toBe("/admin/exams");
  });

  it("the question import back action returns to the filtered list URL", async () => {
    mockPageData();
    const user = userEvent.setup();
    const view = renderAt(
      {
        pathname: "/admin/questions/import",
        state: { from: "/admin/questions?tags=algebra&page=3" },
      },
      <QuestionImportPage />,
      "/admin/questions/import",
    );

    // The back control only exists once a file has been parsed, so the import
    // flow has to be driven to that step — otherwise this exit is never
    // exercised and a hardcoded bare-list return would pass every test.
    // The page renders its loader first, so the input is awaited rather than
    // queried.
    const fileInput = await waitFor(() => {
      const el = view.container.querySelector("input[type='file']");
      if (el === null) throw new Error("file input not rendered yet");
      return el as HTMLInputElement;
    });
    await user.upload(
      fileInput,
      new File(
        ["type,content,answer,score\ntrue_false,导入题目一,true,10\n"],
        "questions.csv",
        { type: "text/csv" },
      ),
    );

    // The back control belongs to the RESULT step, so the flow is driven
    // through validation first.
    await user.click(
      await screen.findByRole("button", { name: "校验导入数据" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "返回题目列表" }),
    );
    // The carried query is preserved verbatim (a non-ASCII tag would come back
    // percent-encoded, which is the same target, not a different one).
    expect(locationText()).toBe("/admin/questions?tags=algebra&page=3");
  });

  it("the question import back action falls back to the bare list for a hostile target", async () => {
    mockPageData();
    const user = userEvent.setup();
    const view = renderAt(
      {
        pathname: "/admin/questions/import",
        state: { from: "/admin/exams?status=published" },
      },
      <QuestionImportPage />,
      "/admin/questions/import",
    );
    // The page renders its loader first, so the input is awaited rather than
    // queried.
    const fileInput = await waitFor(() => {
      const el = view.container.querySelector("input[type='file']");
      if (el === null) throw new Error("file input not rendered yet");
      return el as HTMLInputElement;
    });
    await user.upload(
      fileInput,
      new File(
        ["type,content,answer,score\ntrue_false,导入题目一,true,10\n"],
        "questions.csv",
        { type: "text/csv" },
      ),
    );

    // The back control belongs to the RESULT step, so the flow is driven
    // through validation first.
    await user.click(
      await screen.findByRole("button", { name: "校验导入数据" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "返回题目列表" }),
    );
    // The other list's route is not an acceptable target for this exit.
    expect(locationText()).toBe("/admin/questions");
  });

  it("the exam create cancel returns to the filtered list URL", async () => {
    mockPageData();
    const user = userEvent.setup();
    renderAt(
      {
        pathname: "/admin/exams/new",
        state: { from: "/admin/exams?status=published&page=2" },
      },
      <ExamCreatePage />,
      "/admin/exams/new",
    );

    await user.click(await screen.findByRole("button", { name: "取消" }));
    expect(locationText()).toBe("/admin/exams?status=published&page=2");
  });

  it("the exam create cancel falls back to the bare list for a hostile target", async () => {
    mockPageData();
    const user = userEvent.setup();
    renderAt(
      {
        pathname: "/admin/exams/new",
        state: { from: "/\\t/evil.example" },
      },
      <ExamCreatePage />,
      "/admin/exams/new",
    );

    await user.click(await screen.findByRole("button", { name: "取消" }));
    expect(locationText()).toBe("/admin/exams");
  });
});
