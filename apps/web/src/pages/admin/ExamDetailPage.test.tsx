import { render, screen, waitFor, within } from "@testing-library/react";
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
const deleteMock = vi.mocked(api.delete);

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

const mockPublishedExam = {
  ...mockDraftExam,
  status: "published",
};

const mockClosedExam = {
  ...mockDraftExam,
  status: "closed",
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

describe("ExamDetailPage", () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
    deleteMock.mockReset();
  });

  describe("draft exam", () => {
    beforeEach(() => {
      getMock.mockImplementation((path: string) => {
        if (path.includes("/enrollments")) return Promise.resolve([]);
        return Promise.resolve({ ...mockDraftExam });
      });
    });

    it("renders exam title and stats cards", async () => {
      renderPage();
      expect(await screen.findByText("期末能力测评")).toBeInTheDocument();
      expect(screen.getByText("60分钟")).toBeInTheDocument();
      expect(screen.getByText("60/100")).toBeInTheDocument();
      expect(screen.getByText("草稿")).toBeInTheDocument();
      expect(screen.getByText("2")).toBeInTheDocument();
    });

    it("renders config card with timing and policy info", async () => {
      renderPage();
      expect(await screen.findByText("考试配置")).toBeInTheDocument();
      expect(screen.getByText("timed_window")).toBeInTheDocument();
      expect(screen.getByText("no-retake")).toBeInTheDocument();
      expect(screen.getByText("best")).toBeInTheDocument();
    });

    it("renders publish button for draft", async () => {
      renderPage();
      expect(await screen.findByText("发布考试")).toBeInTheDocument();
    });

    it("shows server validation error when publish fails", async () => {
      postMock.mockRejectedValue(
        new Error("Exam totalScore must match question scores"),
      );
      renderPage();
      await userEvent.click(await screen.findByText("发布考试"));
      await waitFor(() => {
        expect(
          screen.getByText("Exam totalScore must match question scores"),
        ).toBeInTheDocument();
      });
    });

    it("publishes exam successfully", async () => {
      postMock.mockResolvedValue({});
      const user = userEvent.setup();
      renderPage();
      await user.click(await screen.findByText("发布考试"));
      await waitFor(() => {
        expect(postMock).toHaveBeenCalledWith("/api/exams/exam-1/publish");
      });
    });

    it("renders empty enrollment state", async () => {
      renderPage();
      expect(await screen.findByText("暂无考生")).toBeInTheDocument();
    });

    it("renders back button", async () => {
      renderPage();
      expect(await screen.findByText("返回列表")).toBeInTheDocument();
    });

    it("renders stat cards with zeros", async () => {
      renderPage();
      expect(await screen.findByText("参与人数")).toBeInTheDocument();
      expect(screen.getByText("已完成")).toBeInTheDocument();
      expect(screen.getByText("已通过")).toBeInTheDocument();
    });
  });

  describe("published exam", () => {
    beforeEach(() => {
      getMock.mockImplementation((path: string) => {
        if (path.includes("/enrollments")) return Promise.resolve([]);
        return Promise.resolve({ ...mockPublishedExam });
      });
    });

    it("renders archive button for published exam", async () => {
      renderPage();
      expect(await screen.findByText("归档")).toBeInTheDocument();
      expect(screen.queryByText("发布考试")).not.toBeInTheDocument();
    });

    it("archives exam successfully", async () => {
      postMock.mockResolvedValue({});
      const user = userEvent.setup();
      renderPage();
      await user.click(await screen.findByText("归档"));
      await waitFor(() => {
        expect(postMock).toHaveBeenCalledWith("/api/exams/exam-1/archive");
      });
    });
  });

  describe("closed exam", () => {
    beforeEach(() => {
      getMock.mockImplementation((path: string) => {
        if (path.includes("/enrollments")) return Promise.resolve([]);
        return Promise.resolve({ ...mockClosedExam });
      });
    });

    it("renders archive button for closed exam", async () => {
      renderPage();
      expect(await screen.findByText("归档")).toBeInTheDocument();
    });
  });

  describe("enrollments", () => {
    it("renders enrollment list with details", async () => {
      getMock.mockImplementation((path: string) => {
        if (path.includes("/enrollments"))
          return Promise.resolve([
            {
              id: "enr-1",
              examId: "exam-1",
              candidateId: "c1",
              candidateDisplayName: "张三",
              candidateIdentity: "EMP001",
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
      expect(await screen.findByText("张三")).toBeInTheDocument();
      expect(screen.getByText("EMP001")).toBeInTheDocument();
      expect(screen.getByText("assigned")).toBeInTheDocument();
    });

    it("removes enrollment after confirmation", async () => {
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
        return Promise.resolve({ ...mockDraftExam });
      });
      deleteMock.mockResolvedValue(undefined);
      const user = userEvent.setup();
      renderPage();
      const removeBtn = await screen.findByLabelText("移除考生");
      await user.click(removeBtn);
      const dialog = await screen.findByRole("alertdialog");
      const confirmBtn = within(dialog).getByRole("button", { name: "确认" });
      await user.click(confirmBtn);
      expect(deleteMock).toHaveBeenCalledWith(
        "/api/exams/exam-1/enrollments/enr-1",
      );
    });

    it("opens add candidate dialog", async () => {
      getMock.mockImplementation((path: string) => {
        if (path.includes("/enrollments")) return Promise.resolve([]);
        if (path.includes("/candidates"))
          return Promise.resolve({ items: [], total: 0 });
        return Promise.resolve({ ...mockDraftExam });
      });
      const user = userEvent.setup();
      renderPage();
      const addBtn = await screen.findByRole("button", { name: /添加考生/ });
      await user.click(addBtn);
      const dialog = await screen.findByRole("dialog");
      expect(dialog).toBeInTheDocument();
    });

    it("shows candidate identity fallback when not provided", async () => {
      const longId = "candidate-very-long-id-12345678";
      getMock.mockImplementation((path: string) => {
        if (path.includes("/enrollments"))
          return Promise.resolve([
            {
              id: "enr-1",
              examId: "exam-1",
              candidateId: longId,
              candidateDisplayName: "李四",
              status: "assigned",
              attemptCount: 0,
              finalScore: null,
              finalPassed: null,
            },
          ]);
        return Promise.resolve({ ...mockDraftExam });
      });
      renderPage();
      expect(await screen.findByText("李四")).toBeInTheDocument();
      expect(screen.getByText(longId.slice(0, 8))).toBeInTheDocument();
    });
  });

  describe("error states", () => {
    it("shows error state when exam loading fails", async () => {
      getMock.mockRejectedValue(new Error("fail"));
      renderPage();
      expect(await screen.findByText("加载考试详情失败")).toBeInTheDocument();
    });

    it("shows score in enrollment", async () => {
      getMock.mockImplementation((path: string) => {
        if (path.includes("/enrollments"))
          return Promise.resolve([
            {
              id: "enr-1",
              examId: "exam-1",
              candidateId: "c1",
              candidateDisplayName: "王五",
              status: "completed",
              attemptCount: 1,
              finalScore: 85,
              finalPassed: true,
            },
          ]);
        return Promise.resolve({ ...mockDraftExam });
      });
      renderPage();
      expect(await screen.findByText("85")).toBeInTheDocument();
    });
  });
});
