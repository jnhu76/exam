import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "@/contexts/AuthContext";
import { BrandProvider } from "@/components/layout/BrandProvider";
import { TakeExamPage } from "./TakeExamPage";

const { apiGet, apiPost, mockAttempt } = vi.hoisted(() => {
  const mockAttempt = {
    id: "att-1",
    examId: "exam-1",
    status: "in_progress",
    score: null,
    deadlineAt: new Date(Date.now() + 3600000).toISOString(),
    questionSnapshot: [
      {
        originalQuestionId: "q1",
        type: "true_false",
        content: "地球是圆的",
        score: 10,
        options: null,
        standardAnswer: true,
      },
      {
        originalQuestionId: "q2",
        type: "true_false",
        content: "水是透明的",
        score: 15,
        options: null,
        standardAnswer: true,
      },
    ],
    answers: [],
    startedAt: new Date().toISOString(),
    submittedAt: null,
  };
  return {
    apiGet: vi.fn().mockResolvedValue(mockAttempt),
    apiPost: vi.fn().mockResolvedValue({ ok: true }),
    mockAttempt,
  };
});

vi.mock("@/lib/api", () => ({
  api: {
    get: (...args: unknown[]) => apiGet(...args),
    post: (...args: unknown[]) => apiPost(...args),
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
    <MemoryRouter initialEntries={["/exam/exam-1/take/att-1"]}>
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
            <Route
              path="/exam/:examId/take/:attemptId"
              element={<TakeExamPage />}
            />
            <Route path="/exam/:attemptId/result" element={<LocationProbe />} />
            <Route path="/exam/list" element={<LocationProbe />} />
          </Routes>
        </BrandProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.useRealTimers();
  apiGet.mockReset();
  apiPost.mockReset();
  apiGet.mockResolvedValue(mockAttempt);
  apiPost.mockResolvedValue({ ok: true });
});

describe("TakeExamPage smoke", () => {
  it("loads attempt and renders question content", async () => {
    renderPage();

    expect(await screen.findByText("地球是圆的")).toBeInTheDocument();
    expect(screen.getAllByText(/第 1 题/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/共 2 题/).length).toBeGreaterThanOrEqual(1);
  });

  it("shows question count in header", async () => {
    renderPage();

    expect(await screen.findByText("答题中")).toBeInTheDocument();
    expect(
      screen.getAllByText(/第 1 题 \/ 共 2 题/).length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("shows submit button", async () => {
    renderPage();

    expect(
      await screen.findByRole("button", { name: "交卷" }),
    ).toBeInTheDocument();
  });

  it("navigates between questions", async () => {
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText("地球是圆的")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "下一题" }));

    await waitFor(() => {
      expect(screen.getByText("水是透明的")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "上一题" }));

    await waitFor(() => {
      expect(screen.getByText("地球是圆的")).toBeInTheDocument();
    });
  });

  it("shows submit confirmation dialog with unanswered count", async () => {
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText("地球是圆的")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "交卷" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/题未作答/)).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "确认交卷" }),
    ).toBeInTheDocument();
  });

  it("submits exam and navigates to result", async () => {
    const user = userEvent.setup();
    apiPost.mockResolvedValueOnce({ score: 10 });

    renderPage();

    expect(await screen.findByText("地球是圆的")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "交卷" }));

    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "确认交卷" }));

    await waitFor(() => {
      expect(screen.getByTestId("current-path")).toHaveTextContent("/result");
    });
  });

  it("shows answered/unanswered counts in footer", async () => {
    renderPage();

    expect(
      (await screen.findAllByText(/已答 0/)).length,
    ).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/未答 2/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/共 2 题/).length).toBeGreaterThanOrEqual(1);
  });

  it("shows an error state when attempt loading fails", async () => {
    apiGet.mockRejectedValueOnce(new Error("network error"));

    renderPage();

    expect(
      await screen.findByText("无法加载答题记录，请检查连接后重试"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
  });

  it("highlights timer when less than five minutes remain", async () => {
    apiGet.mockResolvedValueOnce({
      ...mockAttempt,
      deadlineAt: new Date(Date.now() + 295000).toISOString(),
    });

    renderPage();

    const timer = await screen.findByText(/04:5\d/);
    expect(timer.closest("div")).toHaveClass("text-destructive");
  });

  it("shows disconnected feedback when answer save fails", async () => {
    apiGet.mockResolvedValueOnce({
      ...mockAttempt,
      questionSnapshot: [
        {
          originalQuestionId: "q1",
          type: "fill_blank",
          content: "通行确认码是____",
          score: 10,
          options: [],
        },
      ],
    });
    apiPost.mockRejectedValueOnce(new Error("offline"));

    renderPage();

    const input = await screen.findByLabelText("第1空答案");
    const user = userEvent.setup();
    await user.type(input, "A");

    expect(
      await screen.findByText("连接异常", {}, { timeout: 3000 }),
    ).toBeInTheDocument();
    expect(screen.getByText("保存失败")).toBeInTheDocument();
  });

  it("shows deadline message (not 连接异常) when save is rejected with DEADLINE_EXCEEDED", async () => {
    apiGet.mockResolvedValueOnce({
      ...mockAttempt,
      questionSnapshot: [
        {
          originalQuestionId: "q1",
          type: "fill_blank",
          content: "通行确认码是____",
          score: 10,
          options: [],
        },
      ],
    });
    apiPost.mockResolvedValueOnce({
      accepted: false,
      reason: "DEADLINE_EXCEEDED",
      message: "考试时间已到",
      serverVersion: 0,
      savedAt: new Date().toISOString(),
    });

    renderPage();

    const input = await screen.findByLabelText("第1空答案");
    const user = userEvent.setup();
    await user.type(input, "A");

    expect(
      await screen.findByTestId("save-rejection-alert", {}, { timeout: 3000 }),
    ).toBeInTheDocument();
    expect(screen.getByText("已到截止时间")).toBeInTheDocument();
    expect(
      screen.getByText("已到截止时间，不能继续修改答案"),
    ).toBeInTheDocument();
    expect(screen.queryByText("连接异常")).not.toBeInTheDocument();
  });

  it("shows exam-ended message (not 连接异常) when save is rejected with ATTEMPT_ALREADY_SUBMITTED", async () => {
    apiGet.mockResolvedValueOnce({
      ...mockAttempt,
      questionSnapshot: [
        {
          originalQuestionId: "q1",
          type: "fill_blank",
          content: "通行确认码是____",
          score: 10,
          options: [],
        },
      ],
    });
    apiPost.mockResolvedValueOnce({
      accepted: false,
      reason: "ATTEMPT_ALREADY_SUBMITTED",
      message: "考试已提交或已结束",
      serverVersion: 0,
      savedAt: new Date().toISOString(),
    });

    renderPage();

    const input = await screen.findByLabelText("第1空答案");
    const user = userEvent.setup();
    await user.type(input, "A");

    expect(
      await screen.findByTestId("save-rejection-alert", {}, { timeout: 3000 }),
    ).toBeInTheDocument();
    expect(screen.getByText("考试已结束")).toBeInTheDocument();
    expect(screen.getByText("答案已提交，考试已结束")).toBeInTheDocument();
    expect(screen.queryByText("连接异常")).not.toBeInTheDocument();
  });

  it("renders fill_blank input and saves the answer", async () => {
    apiGet.mockResolvedValueOnce({
      ...mockAttempt,
      questionSnapshot: [
        {
          originalQuestionId: "q1",
          type: "fill_blank",
          content: "安全出口标识的颜色是____色",
          score: 10,
          options: [],
        },
      ],
    });

    renderPage();

    const input = await screen.findByLabelText("第1空答案");
    const user = userEvent.setup();
    await user.type(input, "绿");

    await waitFor(
      () => {
        expect(apiPost).toHaveBeenCalledWith(
          "/api/attempts/att-1/answers/q1",
          expect.objectContaining({
            attemptId: "att-1",
            questionId: "q1",
            answer: "绿",
          }),
        );
      },
      { timeout: 3000 },
    );
  });
});

describe("TakeExamPage S03b submit flush", () => {
  it("clicking 交卷 awaits pending saves before submit POST is fired", async () => {
    apiGet.mockResolvedValueOnce({
      ...mockAttempt,
      questionSnapshot: [
        {
          originalQuestionId: "q1",
          type: "fill_blank",
          content: "通行确认码是____",
          score: 10,
          options: [],
        },
      ],
    });

    let resolveSave!: (value: unknown) => void;
    apiPost.mockImplementation(async (path: string) => {
      if (path.includes("/answers/")) {
        return new Promise((resolve) => {
          resolveSave = resolve;
        });
      }
      if (path.includes("/submit")) {
        return { score: 10 };
      }
      return { ok: true };
    });

    const wasSubmitCalled = () =>
      apiPost.mock.calls.some(
        (call: unknown[]) =>
          typeof call[0] === "string" && call[0].includes("/submit"),
      );
    const wasSaveCalled = () =>
      apiPost.mock.calls.some(
        (call: unknown[]) =>
          typeof call[0] === "string" && call[0].includes("/answers/"),
      );

    renderPage();

    const user = userEvent.setup();
    const input = await screen.findByLabelText("第1空答案");

    await user.type(input, "A");
    expect(wasSaveCalled()).toBe(false);

    await user.click(screen.getByRole("button", { name: "交卷" }));
    const dialog = await screen.findByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: "确认交卷" });

    await waitFor(() => {
      expect(wasSaveCalled()).toBe(true);
    });
    expect(confirm).toBeDisabled();
    expect(wasSubmitCalled()).toBe(false);
    await Promise.resolve();
    await Promise.resolve();
    expect(wasSubmitCalled()).toBe(false);

    resolveSave({ accepted: true, serverVersion: 1, savedAt: "now" });

    await waitFor(() => {
      expect(confirm).toBeEnabled();
    });
    expect(wasSubmitCalled()).toBe(false);

    await user.click(confirm);

    await waitFor(() => {
      expect(wasSubmitCalled()).toBe(true);
    });

    const saveIndex = apiPost.mock.calls.findIndex(
      (call: unknown[]) =>
        typeof call[0] === "string" && call[0].includes("/answers/"),
    );
    const submitIndex = apiPost.mock.calls.findIndex(
      (call: unknown[]) =>
        typeof call[0] === "string" && call[0].includes("/submit"),
    );
    expect(saveIndex).toBeGreaterThanOrEqual(0);
    expect(submitIndex).toBeGreaterThan(saveIndex);
  });

  it("dialog shows 保存中 progress and gates submit while flush is in flight", async () => {
    apiGet.mockResolvedValueOnce({
      ...mockAttempt,
      questionSnapshot: [
        {
          originalQuestionId: "q1",
          type: "fill_blank",
          content: "通行确认码是____",
          score: 10,
          options: [],
        },
      ],
    });

    let resolveSave!: (value: unknown) => void;
    apiPost.mockImplementation(async (path: string) => {
      if (path.includes("/answers/")) {
        return new Promise((resolve) => {
          resolveSave = resolve;
        });
      }
      return { ok: true };
    });

    renderPage();

    const user = userEvent.setup();
    const input = await screen.findByLabelText("第1空答案");
    await user.type(input, "A");
    await user.click(screen.getByRole("button", { name: "交卷" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/保存中/)).toBeInTheDocument();
    expect(
      within(dialog).queryByRole("button", { name: "Close" }),
    ).not.toBeInTheDocument();

    const confirm = within(dialog).getByRole("button", { name: "确认交卷" });
    expect(confirm).toBeDisabled();

    await user.click(confirm);
    await Promise.resolve();
    await Promise.resolve();
    expect(
      apiPost.mock.calls.some(
        (call: unknown[]) =>
          typeof call[0] === "string" && call[0].includes("/submit"),
      ),
    ).toBe(false);

    resolveSave({ accepted: true, serverVersion: 1, savedAt: "now" });

    await waitFor(() => {
      expect(within(dialog).queryByText(/保存中/)).not.toBeInTheDocument();
    });
    expect(
      within(dialog).getByRole("button", { name: "确认交卷" }),
    ).toBeEnabled();
  });

  it("timer timeout flushes pending saves before submit", async () => {
    apiGet.mockResolvedValueOnce({
      ...mockAttempt,
      deadlineAt: new Date(Date.now() - 1000).toISOString(),
      questionSnapshot: [
        {
          originalQuestionId: "q1",
          type: "fill_blank",
          content: "通行确认码是____",
          score: 10,
          options: [],
        },
      ],
    });

    let resolveSave!: (value: unknown) => void;
    apiPost.mockImplementation(async (path: string) => {
      if (path.includes("/answers/")) {
        return new Promise((resolve) => {
          resolveSave = resolve;
        });
      }
      if (path.includes("/submit")) {
        return { score: 10 };
      }
      return { ok: true };
    });

    renderPage();

    const user = userEvent.setup();
    const input = await screen.findByLabelText("第1空答案");
    await user.type(input, "A");

    await waitFor(
      () => {
        expect(
          apiPost.mock.calls.some(
            (call: unknown[]) =>
              typeof call[0] === "string" && call[0].includes("/answers/"),
          ),
        ).toBe(true);
      },
      { timeout: 2500 },
    );
    expect(
      apiPost.mock.calls.some(
        (call: unknown[]) =>
          typeof call[0] === "string" && call[0].includes("/submit"),
      ),
    ).toBe(false);

    resolveSave({ accepted: true, serverVersion: 1, savedAt: "now" });

    await waitFor(() => {
      expect(
        apiPost.mock.calls.some(
          (call: unknown[]) =>
            typeof call[0] === "string" && call[0].includes("/submit"),
        ),
      ).toBe(true);
    });
  });

  it("dialog shows unanswered, unsaved, and failed save counts", async () => {
    apiGet.mockResolvedValueOnce({
      ...mockAttempt,
      questionSnapshot: [
        {
          originalQuestionId: "q1",
          type: "fill_blank",
          content: "通行确认码是____",
          score: 10,
          options: [],
        },
        {
          originalQuestionId: "q2",
          type: "true_false",
          content: "确认第二项",
          score: 10,
          options: [],
        },
      ],
    });
    apiPost.mockImplementation(async (path: string) => {
      if (path.includes("/answers/")) {
        throw new Error("offline");
      }
      return { ok: true };
    });

    renderPage();

    const user = userEvent.setup();
    const input = await screen.findByLabelText("第1空答案");
    await user.type(input, "A");
    await user.click(screen.getByRole("button", { name: "交卷" }));

    const dialog = await screen.findByRole("dialog");
    await waitFor(() => {
      expect(within(dialog).queryByText(/保存中/)).not.toBeInTheDocument();
    });

    expect(within(dialog).getByText("未答题：1 题未作答")).toBeInTheDocument();
    expect(within(dialog).getByText("未保存：1 题")).toBeInTheDocument();
    expect(within(dialog).getByText("保存失败：1 题")).toBeInTheDocument();
  });

  it("blocks normal submit after a rejected save and requires 仍然提交", async () => {
    apiGet.mockResolvedValueOnce({
      ...mockAttempt,
      questionSnapshot: [
        {
          originalQuestionId: "q1",
          type: "fill_blank",
          content: "通行确认码是____",
          score: 10,
          options: [],
        },
      ],
    });
    apiPost.mockImplementation(async (path: string) => {
      if (path.includes("/answers/")) {
        return {
          accepted: false,
          reason: "STALE_VERSION",
          message: "服务器上存在更新的答案版本",
          serverVersion: 2,
          savedAt: new Date().toISOString(),
        };
      }
      if (path.includes("/submit")) {
        return { score: 10 };
      }
      return { ok: true };
    });

    renderPage();

    const user = userEvent.setup();
    const input = await screen.findByLabelText("第1空答案");
    await user.type(input, "A");
    await user.click(screen.getByRole("button", { name: "交卷" }));

    const dialog = await screen.findByRole("dialog");
    await waitFor(() => {
      expect(within(dialog).getByText("保存失败：1 题")).toBeInTheDocument();
    });

    expect(screen.queryByText("连接异常")).not.toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "确认交卷" }),
    ).toBeDisabled();
    expect(
      apiPost.mock.calls.some(
        (call: unknown[]) =>
          typeof call[0] === "string" && call[0].includes("/submit"),
      ),
    ).toBe(false);

    await user.click(within(dialog).getByRole("button", { name: "仍然提交" }));

    await waitFor(() => {
      expect(
        apiPost.mock.calls.some(
          (call: unknown[]) =>
            typeof call[0] === "string" && call[0].includes("/submit"),
        ),
      ).toBe(true);
    });
  });

  it("offers retry or 仍然提交 after flush timeout", async () => {
    apiGet.mockResolvedValueOnce({
      ...mockAttempt,
      questionSnapshot: [
        {
          originalQuestionId: "q1",
          type: "fill_blank",
          content: "通行确认码是____",
          score: 10,
          options: [],
        },
      ],
    });

    let resolveSave!: (value: unknown) => void;
    apiPost.mockImplementation(async (path: string) => {
      if (path.includes("/answers/")) {
        return new Promise((resolve) => {
          resolveSave = resolve;
        });
      }
      if (path.includes("/submit")) {
        return { score: 10 };
      }
      return { ok: true };
    });

    renderPage();

    const user = userEvent.setup();
    const input = await screen.findByLabelText("第1空答案");
    await user.type(input, "A");

    vi.useFakeTimers();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "交卷" }));
    });
    const dialog = screen.getByRole("dialog");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(within(dialog).getByText(/保存超时/)).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "重试" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "仍然提交" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "确认交卷" }),
    ).toBeDisabled();
    expect(
      apiPost.mock.calls.some(
        (call: unknown[]) =>
          typeof call[0] === "string" && call[0].includes("/submit"),
      ),
    ).toBe(false);

    await act(async () => {
      resolveSave({ accepted: true, serverVersion: 1, savedAt: "now" });
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "重试" }));
      await Promise.resolve();
    });

    expect(within(dialog).queryByText(/保存超时/)).not.toBeInTheDocument();
    expect(within(dialog).getByText("未保存：0 题")).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "确认交卷" }),
    ).toBeEnabled();

    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "确认交卷" }));
      await Promise.resolve();
    });

    expect(
      apiPost.mock.calls.some(
        (call: unknown[]) =>
          typeof call[0] === "string" && call[0].includes("/submit"),
      ),
    ).toBe(true);
  });

  it("recovers from stale version by accepting server answer", async () => {
    apiGet.mockResolvedValueOnce({
      ...mockAttempt,
      questionSnapshot: [
        {
          originalQuestionId: "q1",
          type: "fill_blank",
          content: "通行确认码是____",
          score: 10,
          options: [],
        },
      ],
    });
    apiPost.mockImplementation(async (path: string) => {
      if (path.includes("/answers/")) {
        return {
          accepted: false,
          reason: "STALE_VERSION",
          message: "服务器上存在更新的答案版本",
          serverVersion: 3,
          savedAt: new Date().toISOString(),
          details: { serverAnswer: ["B"] },
        };
      }
      return { ok: true };
    });

    renderPage();

    const user = userEvent.setup();
    const input = await screen.findByLabelText("第1空答案");
    await user.type(input, "A");
    await user.click(screen.getByRole("button", { name: "交卷" }));

    const dialog = await screen.findByRole("dialog");
    await waitFor(() => {
      expect(within(dialog).getByText("未保存：0 题")).toBeInTheDocument();
    });
    expect(
      within(dialog).queryByText("保存失败：1 题"),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "确认交卷" }),
    ).toBeEnabled();
  });
});
