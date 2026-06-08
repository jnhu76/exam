import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "@/contexts/AuthContext";
import { BrandProvider } from "@/components/layout/BrandProvider";
import { StartExamPage } from "./StartExamPage";

const apiGet = vi.fn();
const apiPost = vi.fn();

vi.mock("@/lib/api", () => ({
  api: {
    get: (...args: unknown[]) => apiGet(...args),
    post: (...args: unknown[]) => apiPost(...args),
  },
  ApiError: class ApiError extends Error {
    constructor(
      readonly status: number,
      message: string,
    ) {
      super(message);
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
    });

    renderPage();

    expect(
      await screen.findByText("已达到最大考试次数，无法再次开始考试。"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "开始考试" })).toBeDisabled();
  });
});
