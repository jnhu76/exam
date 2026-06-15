import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "@/contexts/AuthContext";
import { BrandProvider } from "@/components/layout/BrandProvider";
import { StartExamPage } from "./StartExamPage";
import { ApiError } from "@/lib/api";

const { apiGet, apiPost } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: {
    get: (...args: unknown[]) => apiGet(...args),
    post: (...args: unknown[]) => apiPost(...args),
  },
  ApiError: class ApiError extends Error {
    readonly status: number;
    readonly code?: string;
    readonly details?: unknown;
    readonly requestId?: string;
    constructor(
      status: number,
      message: string,
      code?: string,
      details?: unknown,
      requestId?: string,
    ) {
      super(message);
      this.status = status;
      this.code = code;
      this.details = details;
      this.requestId = requestId;
      this.name = "ApiError";
    }
  },
  setNavigate: () => {},
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="current-path">{location.pathname}</span>;
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/exam/exam-1/start"]}>
      <AuthProvider
        initialUser={{
          id: "c1",
          username: "candidate",
          name: "Candidate",
          role: "Candidate",
          organizationId: "org1",
        }}
      >
        <BrandProvider>
          <Routes>
            <Route path="/exam/:examId/start" element={<StartExamPage />} />
            <Route path="/exam/:attemptId/take" element={<LocationProbe />} />
          </Routes>
        </BrandProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  apiGet.mockReset();
  apiPost.mockReset();
});

describe("StartExamPage", () => {
  it("continues an existing in-progress attempt without creating a new one", async () => {
    const user = userEvent.setup();
    apiGet.mockResolvedValueOnce({
      id: "exam-1",
      title: "安全培训考核 A",
      durationMinutes: 60,
      passingScore: 60,
      totalScore: 100,
      questionCount: 10,
      controlFlags: {
        shuffleQuestions: false,
        shuffleOptions: false,
        detectTabSwitch: false,
        disableCopyPaste: false,
        requireQueue: false,
        batchSize: 10,
        batchInterval: 3,
        restrictIp: false,
        requireLockdown: false,
        showResultImmediately: true,
      },
      maxAttempts: 1,
      currentAttempts: 1,
      activeAttemptId: "att-1",
      canStartNewAttempt: false,
      availabilityStatus: "in_progress",
      primaryAction: "resume",
    });

    renderPage();

    expect(await screen.findByText("继续考试")).toBeInTheDocument();
    expect(
      screen.getByText("检测到未完成的考试记录，将继续上次进度。"),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "继续考试" }));

    await waitFor(() => {
      expect(screen.getByTestId("current-path")).toHaveTextContent(
        "/exam/att-1/take",
      );
    });
    expect(apiPost).not.toHaveBeenCalled();
  });

  it("shows a clear max-attempt error state", async () => {
    apiGet.mockResolvedValueOnce({
      id: "exam-1",
      title: "安全培训考核 A",
      durationMinutes: 60,
      passingScore: 60,
      totalScore: 100,
      questionCount: 10,
      controlFlags: {
        shuffleQuestions: false,
        shuffleOptions: false,
        detectTabSwitch: false,
        disableCopyPaste: false,
        requireQueue: false,
        batchSize: 10,
        batchInterval: 3,
        restrictIp: false,
        requireLockdown: false,
        showResultImmediately: true,
      },
      maxAttempts: 1,
      currentAttempts: 1,
      canStartNewAttempt: false,
      blockingReason: "max_attempts_reached",
      availabilityStatus: "max_attempts_exhausted",
      primaryAction: "view_result",
    });

    renderPage();

    expect(
      await screen.findByText("已达到最大考试次数，无法再次开始考试。"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "查看成绩" }),
    ).toBeInTheDocument();
  });

  it("shows already-passed blocking reason", async () => {
    apiGet.mockResolvedValueOnce({
      id: "exam-1",
      title: "安全培训考核 A",
      durationMinutes: 60,
      passingScore: 60,
      totalScore: 100,
      questionCount: 10,
      controlFlags: {
        shuffleQuestions: false,
        shuffleOptions: false,
        detectTabSwitch: false,
        disableCopyPaste: false,
        requireQueue: false,
        batchSize: 10,
        batchInterval: 3,
        restrictIp: false,
        requireLockdown: false,
        showResultImmediately: true,
      },
      maxAttempts: 3,
      currentAttempts: 1,
      canStartNewAttempt: false,
      blockingReason: "already_passed",
      availabilityStatus: "max_attempts_exhausted",
      primaryAction: "view_result",
    });

    renderPage();

    expect(
      await screen.findByText("已达到最大考试次数，无法再次开始考试。"),
    ).toBeInTheDocument();
  });

  it("starts a new attempt when canStartNewAttempt is true", async () => {
    const user = userEvent.setup();
    apiGet.mockResolvedValueOnce({
      id: "exam-1",
      title: "Open Exam",
      durationMinutes: 30,
      passingScore: 50,
      totalScore: 100,
      questionCount: 5,
      controlFlags: {
        shuffleQuestions: false,
        shuffleOptions: false,
        detectTabSwitch: false,
        disableCopyPaste: false,
        requireQueue: false,
        batchSize: 10,
        batchInterval: 3,
        restrictIp: false,
        requireLockdown: false,
        showResultImmediately: true,
      },
      maxAttempts: 2,
      currentAttempts: 0,
      canStartNewAttempt: true,
      availabilityStatus: "available",
      primaryAction: "start",
    });
    apiPost.mockResolvedValueOnce({
      id: "new-att",
      status: "in_progress",
      examId: "exam-1",
    });

    renderPage();

    expect(await screen.findByText("Open Exam")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "开始考试" }));

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith("/api/attempts/exam-1/start");
    });
  });

  it("shows exam info card", async () => {
    apiGet.mockResolvedValueOnce({
      id: "exam-1",
      title: "Math Exam",
      durationMinutes: 90,
      passingScore: 60,
      totalScore: 100,
      questionCount: 20,
      controlFlags: {
        shuffleQuestions: false,
        shuffleOptions: false,
        detectTabSwitch: false,
        disableCopyPaste: false,
        requireQueue: false,
        batchSize: 10,
        batchInterval: 3,
        restrictIp: false,
        requireLockdown: false,
        showResultImmediately: true,
      },
      maxAttempts: 1,
      currentAttempts: 0,
      canStartNewAttempt: true,
      availabilityStatus: "available",
      primaryAction: "start",
    });

    renderPage();

    expect(await screen.findByText("Math Exam")).toBeInTheDocument();
    expect(screen.getByText("90分钟")).toBeInTheDocument();
    expect(screen.getByText("20题")).toBeInTheDocument();
  });

  it("shows error state on load failure", async () => {
    apiGet.mockRejectedValueOnce(new Error("Network error"));

    renderPage();

    expect(await screen.findByText("加载考试信息失败")).toBeInTheDocument();
  });

  it("shows max-attempt message from error code not message text", async () => {
    const user = userEvent.setup();
    apiGet.mockResolvedValueOnce({
      id: "exam-1",
      title: "Test",
      durationMinutes: 30,
      passingScore: 50,
      totalScore: 100,
      questionCount: 5,
      controlFlags: {
        shuffleQuestions: false,
        shuffleOptions: false,
        detectTabSwitch: false,
        disableCopyPaste: false,
        requireQueue: false,
        batchSize: 10,
        batchInterval: 3,
        restrictIp: false,
        requireLockdown: false,
        showResultImmediately: true,
      },
      maxAttempts: 1,
      currentAttempts: 0,
      canStartNewAttempt: true,
      availabilityStatus: "available",
      primaryAction: "start",
    });
    apiPost.mockRejectedValueOnce(
      new ApiError(409, "已达最大考试次数", "MAX_ATTEMPTS_REACHED"),
    );

    renderPage();
    await screen.findByText("Test");
    await user.click(screen.getByRole("button", { name: "开始考试" }));

    await waitFor(() => {
      expect(
        screen.getByText("已达到最大考试次数，无法再次开始考试。"),
      ).toBeInTheDocument();
    });
  });

  it("shows already-passed message from error code", async () => {
    const user = userEvent.setup();
    apiGet.mockResolvedValueOnce({
      id: "exam-1",
      title: "Test",
      durationMinutes: 30,
      passingScore: 50,
      totalScore: 100,
      questionCount: 5,
      controlFlags: {
        shuffleQuestions: false,
        shuffleOptions: false,
        detectTabSwitch: false,
        disableCopyPaste: false,
        requireQueue: false,
        batchSize: 10,
        batchInterval: 3,
        restrictIp: false,
        requireLockdown: false,
        showResultImmediately: true,
      },
      maxAttempts: 3,
      currentAttempts: 1,
      canStartNewAttempt: true,
      availabilityStatus: "available",
      primaryAction: "start",
    });
    apiPost.mockRejectedValueOnce(
      new ApiError(409, "已通过考试", "EXAM_ALREADY_PASSED"),
    );

    renderPage();
    await screen.findByText("Test");
    await user.click(screen.getByRole("button", { name: "再次考试" }));

    await waitFor(() => {
      expect(
        screen.getByText("本场考试已通过，无需再次参加。"),
      ).toBeInTheDocument();
    });
  });

  it("shows not-open message from error code", async () => {
    const user = userEvent.setup();
    apiGet.mockResolvedValueOnce({
      id: "exam-1",
      title: "Test",
      durationMinutes: 30,
      passingScore: 50,
      totalScore: 100,
      questionCount: 5,
      controlFlags: {
        shuffleQuestions: false,
        shuffleOptions: false,
        detectTabSwitch: false,
        disableCopyPaste: false,
        requireQueue: false,
        batchSize: 10,
        batchInterval: 3,
        restrictIp: false,
        requireLockdown: false,
        showResultImmediately: true,
      },
      maxAttempts: 3,
      currentAttempts: 0,
      canStartNewAttempt: true,
      availabilityStatus: "available",
      primaryAction: "start",
    });
    apiPost.mockRejectedValueOnce(
      new ApiError(409, "考试尚未开放", "EXAM_NOT_OPEN"),
    );

    renderPage();
    await screen.findByText("Test");
    await user.click(screen.getByRole("button", { name: "开始考试" }));

    await waitFor(() => {
      expect(screen.getByText("考试当前不在开放时间内。")).toBeInTheDocument();
    });
  });

  it("preserves server message for deferred queue error without rendering queue UI", async () => {
    const user = userEvent.setup();
    apiGet.mockResolvedValueOnce({
      id: "exam-1",
      title: "Test",
      durationMinutes: 30,
      passingScore: 50,
      totalScore: 100,
      questionCount: 5,
      controlFlags: {
        shuffleQuestions: false,
        shuffleOptions: false,
        detectTabSwitch: false,
        disableCopyPaste: false,
        requireQueue: false,
        batchSize: 10,
        batchInterval: 3,
        restrictIp: false,
        requireLockdown: false,
        showResultImmediately: true,
      },
      maxAttempts: 3,
      currentAttempts: 0,
      canStartNewAttempt: true,
      availabilityStatus: "available",
      primaryAction: "start",
    });
    apiPost.mockRejectedValueOnce(
      new ApiError(409, "请等待队列准入", "QUEUE_WAIT_REQUIRED"),
    );

    renderPage();
    await screen.findByText("Test");
    await user.click(screen.getByRole("button", { name: "开始考试" }));

    await waitFor(() => {
      expect(screen.getByText("请等待队列准入")).toBeInTheDocument();
    });
    expect(screen.queryByText("正在排队")).not.toBeInTheDocument();
  });
});
