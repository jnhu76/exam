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
    getMock.mockImplementation((path: string) => {
      if (path.includes("/enrollments")) return Promise.resolve([]);
      return Promise.resolve({ ...mockDraftExam });
    });
  });

  describe("layout structure", () => {
    it("renders stats cards at the top", async () => {
      renderPage();
      expect(await screen.findByText("期末能力测评")).toBeInTheDocument();
      expect(screen.getByText("状态")).toBeInTheDocument();
      expect(screen.getByText("考试时长")).toBeInTheDocument();
      expect(screen.getByText("及格分")).toBeInTheDocument();
      expect(screen.getByText("题目数量")).toBeInTheDocument();
    });

    it("renders config section", async () => {
      renderPage();
      expect(await screen.findByText("考试配置")).toBeInTheDocument();
      expect(screen.getByText("timed_window")).toBeInTheDocument();
    });

    // Characterization (UI-MIGRATE-N-W4B): the detail stat + config cards are
    // Card-primitive containers that own their elevation. After the business
    // `shadow-sm` is removed (the Card primitive already supplies it), each
    // card title must still sit inside a `data-slot="card"` region holding its
    // value. Asserts the durable container role, not the raw shadow token.
    it("keeps stat and config card titles inside Card regions holding their values", async () => {
      renderPage();
      const statusLabel = await screen.findByText("状态");
      const statCard = statusLabel.closest("[data-slot='card']");
      expect(statCard).toBeInTheDocument();
      const configLabel = await screen.findByText("考试配置");
      const configCard = configLabel.closest("[data-slot='card']");
      expect(configCard).toBeInTheDocument();
      expect(configCard).toHaveTextContent("timed_window");
    });

    it("renders Phase 1 tabs without audit placeholder", async () => {
      renderPage();
      expect(
        await screen.findByRole("tab", { name: "报考" }),
      ).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "成绩" })).toBeInTheDocument();
      expect(
        screen.queryByRole("tab", { name: "操作日志" }),
      ).not.toBeInTheDocument();
    });
  });

  describe("enrollment tab", () => {
    it("shows enrollment stats and table in报考 tab", async () => {
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
    });

    it("shows empty state when no enrollments", async () => {
      renderPage();
      expect(await screen.findByText("暂无考生")).toBeInTheDocument();
    });
  });

  describe("scores tab", () => {
    it("shows scores tab content with link to score list", async () => {
      renderPage();
      await screen.findByRole("tab", { name: "成绩" });
      const user = userEvent.setup();
      await user.click(screen.getByRole("tab", { name: "成绩" }));
      expect(screen.getByText("成绩管理")).toBeInTheDocument();
    });
  });

  describe("publish and archive", () => {
    it("renders publish button for draft", async () => {
      renderPage();
      expect(await screen.findByText("发布考试")).toBeInTheDocument();
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

    it("shows publish error message on failure", async () => {
      postMock.mockRejectedValue(new Error("发布失败"));
      const user = userEvent.setup();
      renderPage();
      await user.click(await screen.findByText("发布考试"));
      expect(await screen.findByText("发布失败")).toBeInTheDocument();
    });

    it("opens confirmation before archiving a published exam", async () => {
      getMock.mockImplementation((path: string) => {
        if (path.includes("/enrollments")) return Promise.resolve([]);
        return Promise.resolve({ ...mockDraftExam, status: "published" });
      });
      postMock.mockResolvedValue({});
      const user = userEvent.setup();
      renderPage();
      await screen.findByText("期末能力测评");
      await user.click(screen.getByText("归档"));
      const dialog = await screen.findByRole("alertdialog");
      expect(within(dialog).getByText(/期末能力测评/)).toBeInTheDocument();
      const confirm = within(dialog).getByRole("button", { name: "确认" });
      expect(confirm).toHaveAttribute("data-variant", "destructive");
      await user.click(confirm);
      await waitFor(() => {
        expect(postMock).toHaveBeenCalledWith("/api/exams/exam-1/archive");
      });
    });

    it("does not show cancel button for draft exams", async () => {
      // draft → no cancel button
      getMock.mockImplementation((path: string) => {
        if (path.includes("/enrollments")) return Promise.resolve([]);
        return Promise.resolve({ ...mockDraftExam, status: "draft" });
      });
      renderPage();
      await screen.findByText("期末能力测评");
      expect(screen.queryByText("取消考试")).not.toBeInTheDocument();
    });

    it("opens confirmation and cancels a published exam", async () => {
      getMock.mockImplementation((path: string) => {
        if (path.includes("/enrollments")) return Promise.resolve([]);
        return Promise.resolve({ ...mockDraftExam, status: "published" });
      });
      postMock.mockResolvedValue({});
      const user = userEvent.setup();
      renderPage();
      await screen.findByText("期末能力测评");
      await user.click(screen.getByText("取消考试"));
      const dialog = await screen.findByRole("alertdialog");
      expect(within(dialog).getByText(/期末能力测评/)).toBeInTheDocument();
      const confirm = within(dialog).getByRole("button", { name: "确认" });
      expect(confirm).toHaveAttribute("data-variant", "destructive");
      await user.click(confirm);
      await waitFor(() => {
        expect(postMock).toHaveBeenCalledWith("/api/exams/exam-1/cancel");
      });
    });

    it("shows publish-results button for manual-mode unpublished published exam", async () => {
      getMock.mockImplementation((path: string) => {
        if (path.includes("/enrollments")) return Promise.resolve([]);
        return Promise.resolve({
          ...mockDraftExam,
          status: "published",
          resultPublicationMode: "manual",
          resultsPublishedAt: null,
        });
      });
      renderPage();
      expect(
        await screen.findByTestId("exam-detail-publish-results-btn"),
      ).toBeInTheDocument();
    });

    it("hides publish-results button when results already published", async () => {
      getMock.mockImplementation((path: string) => {
        if (path.includes("/enrollments")) return Promise.resolve([]);
        return Promise.resolve({
          ...mockDraftExam,
          status: "published",
          resultPublicationMode: "manual",
          resultsPublishedAt: new Date().toISOString(),
        });
      });
      renderPage();
      await screen.findByText("期末能力测评");
      expect(
        screen.queryByTestId("exam-detail-publish-results-btn"),
      ).toBeNull();
    });

    it("hides publish-results button for immediate-mode exam", async () => {
      getMock.mockImplementation((path: string) => {
        if (path.includes("/enrollments")) return Promise.resolve([]);
        return Promise.resolve({
          ...mockDraftExam,
          status: "published",
          resultPublicationMode: "immediate",
          resultsPublishedAt: null,
        });
      });
      renderPage();
      await screen.findByText("期末能力测评");
      expect(
        screen.queryByTestId("exam-detail-publish-results-btn"),
      ).toBeNull();
    });

    it("publishes results after confirmation", async () => {
      getMock.mockImplementation((path: string) => {
        if (path.includes("/enrollments")) return Promise.resolve([]);
        return Promise.resolve({
          ...mockDraftExam,
          status: "published",
          resultPublicationMode: "manual",
          resultsPublishedAt: null,
        });
      });
      postMock.mockResolvedValue({
        ok: true,
        resultsPublishedAt: new Date().toISOString(),
        alreadyPublished: false,
      });
      const user = userEvent.setup();
      renderPage();
      await screen.findByTestId("exam-detail-publish-results-btn");
      await user.click(screen.getByTestId("exam-detail-publish-results-btn"));
      const dialog = await screen.findByRole("alertdialog");
      await user.click(within(dialog).getByRole("button", { name: "确认" }));
      await waitFor(() => {
        expect(postMock).toHaveBeenCalledWith(
          "/api/exams/exam-1/publish-results",
        );
      });
    });
  });

  describe("enrollment management", () => {
    it("opens add enrollment dialog", async () => {
      getMock.mockImplementation((path: string) => {
        if (path.includes("/enrollments")) return Promise.resolve([]);
        if (path.includes("/api/candidates"))
          return Promise.resolve({ items: [], total: 0 });
        return Promise.resolve(mockDraftExam);
      });
      const user = userEvent.setup();
      renderPage();
      await screen.findByText("期末能力测评");
      const addButtons = screen.getAllByText("添加考生");
      await user.click(addButtons[0]!);
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    it("shows enrollment status using StatusBadge", async () => {
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
        return Promise.resolve(mockDraftExam);
      });
      renderPage();
      expect(await screen.findByText("张三")).toBeInTheDocument();
      expect(screen.getByText("已分配")).toBeInTheDocument();
    });

    it("shows remove button only for assigned enrollments", async () => {
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
            {
              id: "enr-2",
              examId: "exam-1",
              candidateId: "c2",
              candidateDisplayName: "李四",
              status: "completed",
              attemptCount: 1,
              finalScore: 80,
              finalPassed: true,
            },
          ]);
        return Promise.resolve(mockDraftExam);
      });
      renderPage();
      await screen.findByText("张三");
      const removeButtons = screen.getAllByRole("button", { name: "移除考生" });
      expect(removeButtons).toHaveLength(1);
    });
  });

  describe("error states", () => {
    it("shows error state when exam loading fails", async () => {
      getMock.mockRejectedValue(new Error("fail"));
      renderPage();
      expect(await screen.findByText("加载考试详情失败")).toBeInTheDocument();
    });
  });
});
