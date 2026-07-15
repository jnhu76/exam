import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "@/contexts/AuthContext";
import { BrandProvider } from "@/components/layout/BrandProvider";
import { DashboardPage } from "./DashboardPage";

const { apiGet } = vi.hoisted(() => ({
  apiGet: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: {
    get: (...args: unknown[]) => apiGet(...args),
  },
  setNavigate: () => {},
}));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/admin/dashboard"]}>
      <AuthProvider
        initialUser={{
          id: "1",
          username: "admin",
          name: "Admin",
          role: "Admin",
          organizationId: "org1",
        }}
      >
        <BrandProvider>
          <Routes>
            <Route path="/admin/dashboard" element={<DashboardPage />} />
            <Route path="/admin/exams/new" element={<div>create exam</div>} />
          </Routes>
        </BrandProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

const mockDashboardData = {
  totalQuestions: 120,
  activeExams: 3,
  totalCandidates: 45,
  todayExams: 2,
  recentExams: [
    {
      id: "exam-1",
      title: "期中考试",
      status: "open",
      participantCount: 20,
    },
    {
      id: "exam-2",
      title: "模拟测试",
      status: "draft",
      participantCount: 0,
    },
    {
      id: "exam-3",
      title: "结业考试",
      status: "closed",
      participantCount: 35,
    },
  ],
};

describe("DashboardPage", () => {
  beforeEach(() => {
    apiGet.mockReset();
  });

  describe("loading state", () => {
    it("shows skeleton while loading", () => {
      apiGet.mockReturnValue(new Promise(() => {}));
      renderPage();
      expect(
        document.querySelector("[data-slot='skeleton']"),
      ).toBeInTheDocument();
    });
  });

  describe("stats cards", () => {
    beforeEach(() => {
      apiGet.mockResolvedValue(mockDashboardData);
    });

    it("renders 4 stat cards with correct labels and values", async () => {
      renderPage();
      expect(await screen.findByText("题目总数")).toBeInTheDocument();
      expect(screen.getByText("120")).toBeInTheDocument();
      expect(screen.getByText("考试进行中")).toBeInTheDocument();
      expect(screen.getByText("3")).toBeInTheDocument();
      expect(screen.getByText("考生总数")).toBeInTheDocument();
      expect(screen.getByText("45")).toBeInTheDocument();
      expect(screen.getByText("今日考试")).toBeInTheDocument();
      expect(screen.getByText("2")).toBeInTheDocument();
    });

    it("renders stats in a 4-column grid at desktop", async () => {
      renderPage();
      const grid = await screen.findByText("题目总数").then((el) => {
        return el.closest("[class*='grid']");
      });
      expect(grid).toBeInTheDocument();
      expect(grid!.className).toContain("lg:grid-cols-4");
    });
  });

  describe("status badges", () => {
    beforeEach(() => {
      apiGet.mockResolvedValue(mockDashboardData);
    });

    it("renders status badges with centralized tones for each status", async () => {
      renderPage();
      await waitFor(() => {
        expect(screen.getByText("开放中")).toBeInTheDocument();
      });

      const openBadge = screen.getByText("开放中");
      expect(openBadge).toHaveAttribute("data-status-tone", "success");

      const draftBadge = screen.getByText("草稿");
      expect(draftBadge).toHaveAttribute("data-status-tone", "muted");

      const closedBadge = screen.getByText("已关闭");
      expect(closedBadge).toHaveAttribute("data-status-tone", "secondary");
    });
  });

  describe("quick actions", () => {
    beforeEach(() => {
      apiGet.mockResolvedValue(mockDashboardData);
    });

    it("renders quick action buttons for creating exam and importing questions", async () => {
      renderPage();
      await waitFor(() => {
        expect(screen.getByText("期中考试")).toBeInTheDocument();
      });

      expect(
        screen.getByRole("button", { name: "创建考试" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "导入题目" }),
      ).toBeInTheDocument();
    });

    it("navigates to exam creation on create button click", async () => {
      renderPage();
      await waitFor(() => {
        expect(screen.getByText("期中考试")).toBeInTheDocument();
      });

      const user = userEvent.setup();
      const createBtn = screen.getByRole("button", { name: "创建考试" });
      await user.click(createBtn);
      // navigation unmounts the component — button is no longer in DOM
      expect(
        screen.queryByRole("button", { name: "创建考试" }),
      ).not.toBeInTheDocument();
    });
  });

  describe("recent exams table", () => {
    it("renders recent exams with title, status, and participant count", async () => {
      apiGet.mockResolvedValue(mockDashboardData);
      renderPage();
      expect(await screen.findByText("期中考试")).toBeInTheDocument();
      expect(screen.getByText("模拟测试")).toBeInTheDocument();
      expect(screen.getByText("结业考试")).toBeInTheDocument();
      expect(screen.getByText("20")).toBeInTheDocument();
      expect(screen.getByText("0")).toBeInTheDocument();
      expect(screen.getByText("35")).toBeInTheDocument();
    });

    it("renders view button for each exam", async () => {
      apiGet.mockResolvedValue(mockDashboardData);
      renderPage();
      await waitFor(() => {
        expect(screen.getByText("期中考试")).toBeInTheDocument();
      });
      const viewButtons = screen.getAllByRole("button", { name: /查看考试/ });
      expect(viewButtons).toHaveLength(3);
    });

    // Characterization (UI-MIGRATE-N-W3): the "近期考试" heading names the
    // recent-exams content section. It must remain present and continue to
    // label the table block after the section-title typography migration.
    // Asserts the durable role, not the raw typography class.
    it("keeps the 近期考试 section title naming the recent-exams block", async () => {
      apiGet.mockResolvedValue(mockDashboardData);
      renderPage();
      const title = await screen.findByText("近期考试");
      expect(title).toBeInTheDocument();
      // The title sits inside the surface-content container for the recent-exams table.
      const card = title.closest(".surface-content");
      expect(card).toBeInTheDocument();
      expect(card).toHaveTextContent("期中考试");
    });
  });

  describe("empty state", () => {
    it("shows empty state when no recent exams", async () => {
      apiGet.mockResolvedValue({
        totalQuestions: 0,
        activeExams: 0,
        totalCandidates: 0,
        todayExams: 0,
        recentExams: [],
      });
      renderPage();
      expect(await screen.findByText("暂无考试")).toBeInTheDocument();
    });
  });

  describe("error state", () => {
    it("shows error message when dashboard load fails", async () => {
      apiGet.mockRejectedValue(new Error("network error"));
      renderPage();
      expect(await screen.findByText("加载仪表盘数据失败")).toBeInTheDocument();
    });

    it("shows retry button on error", async () => {
      apiGet.mockRejectedValue(new Error("network error"));
      renderPage();
      expect(await screen.findByText("重试")).toBeInTheDocument();
    });
  });
});
