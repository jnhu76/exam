import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { AuthProvider } from "@/contexts/AuthContext";
import { BrandProvider } from "@/components/layout/BrandProvider";
import { ExamDetailPage } from "./ExamDetailPage";

vi.mock("@/lib/api", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
  setNavigate: () => {},
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const getMock = vi.mocked(api.get);
const postMock = vi.mocked(api.post);

const mockDraftExam = {
  id: "exam-1",
  title: "期末能力测评",
  description: "",
  courseId: "course-1",
  status: "draft",
  timingMode: "timed_window",
  durationMinutes: 60,
  openAt: new Date().toISOString(),
  closeAt: new Date(Date.now() + 86400000).toISOString(),
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

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/admin/exams/exam-1"]}>
      <AuthProvider
        initialUser={{
          id: "admin-1",
          username: "admin",
          name: "Admin",
          role: "Admin",
          organizationId: "org1",
        }}
      >
        <BrandProvider>
          <Routes>
            <Route path="/admin/exams/:id" element={<ExamDetailPage />} />
          </Routes>
        </BrandProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("ExamDetailPage publish validation error", () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
  });

  it("shows server validation error when publish fails", async () => {
    getMock.mockImplementation((path: string) => {
      if (path.includes("/enrollments")) return Promise.resolve([]);
      return Promise.resolve({ ...mockDraftExam });
    });

    postMock.mockRejectedValue(
      new Error("Exam totalScore must match question scores"),
    );

    renderPage();

    expect(await screen.findByText("期末能力测评")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "发布考试" }));

    await waitFor(() => {
      expect(
        screen.getByText("Exam totalScore must match question scores"),
      ).toBeInTheDocument();
    });
  });

  it("renders exam info and stats cards", async () => {
    getMock.mockImplementation((path: string) => {
      if (path.includes("/enrollments")) return Promise.resolve([]);
      return Promise.resolve({ ...mockDraftExam });
    });

    renderPage();

    expect(await screen.findByText("期末能力测评")).toBeInTheDocument();
    expect(screen.getByText("60分钟")).toBeInTheDocument();
  });

  it("renders empty enrollment state", async () => {
    getMock.mockImplementation((path: string) => {
      if (path.includes("/enrollments")) return Promise.resolve([]);
      return Promise.resolve({ ...mockDraftExam });
    });

    renderPage();

    expect(await screen.findByText("暂无考生")).toBeInTheDocument();
  });

  it("renders enrollments when present", async () => {
    getMock.mockImplementation((path: string) => {
      if (path.includes("/enrollments"))
        return Promise.resolve([
          {
            id: "enr-1",
            examId: "exam-1",
            candidateId: "c1",
            candidateDisplayName: "张三",
            status: "assigned",
            attemptCount: 0,
            finalScore: null,
            finalPassed: null,
          },
        ]);
      return Promise.resolve({
        ...mockDraftExam,
        stats: { participantCount: 1, completedCount: 0, passedCount: 0 },
      });
    });

    renderPage();

    expect(await screen.findByText("期末能力测评")).toBeInTheDocument();
    expect(await screen.findByText("张三")).toBeInTheDocument();
  });

  it("shows back button", async () => {
    getMock.mockImplementation((path: string) => {
      if (path.includes("/enrollments")) return Promise.resolve([]);
      return Promise.resolve({ ...mockDraftExam });
    });

    renderPage();

    expect(await screen.findByText("返回列表")).toBeInTheDocument();
  });
});
