import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "@/lib/api";
import { setBuffer } from "@/lib/logger";
import type { ClientEventBuffer } from "@/lib/clientEventBuffer";
import type { ClientEvent } from "@exam/contracts";
import { ExamListPage } from "./ExamListPage";

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
    get: vi.fn(),
  },
}));

const getMock = vi.mocked(api.get);

/** Buffer stand-in recording pushed events so tests can assert what would be persisted. */
class RecordingBuffer {
  readonly events: ClientEvent[] = [];
  push(event: ClientEvent): void {
    this.events.push(event);
  }
  dispose(): void {}
}

function recordingBuffer(): RecordingBuffer {
  const recording = new RecordingBuffer();
  setBuffer(recording as unknown as ClientEventBuffer);
  return recording;
}

function makeExam(overrides: Record<string, unknown>) {
  return {
    examId: "exam-1",
    title: "Test Exam",
    windowStartAt: "2026-05-01T00:00:00.000Z",
    windowEndAt: "2026-05-01T01:00:00.000Z",
    durationMinutes: 60,
    passingScore: 60,
    totalScore: 100,
    totalQuestions: 5,
    attemptsUsed: 0,
    maxAttempts: 3,
    retakePolicy: "max_attempts" as const,
    latestAttemptId: undefined as string | undefined,
    latestAttemptStatus: undefined as string | undefined,
    bestScore: undefined as number | undefined,
    bestScorePercent: undefined as number | undefined,
    availabilityStatus: "available" as const,
    primaryAction: "start" as const,
    ...overrides,
  };
}

describe("ExamListPage", () => {
  beforeEach(() => {
    getMock.mockReset();
  });

  it("renders available exam with start button in 可参加 section", async () => {
    getMock.mockResolvedValue([makeExam({})]);

    render(
      <MemoryRouter initialEntries={["/exam/list"]}>
        <Routes>
          <Route path="/exam/list" element={<ExamListPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText("可参加的考试")).toBeInTheDocument();
    expect(screen.getByText("开始考试")).toBeInTheDocument();
  });

  // R0-F5: the card meta row states the passing requirement with the
  // unified concept name and an explicit unit — same fact as the start page,
  // result page and admin surfaces, one vocabulary.
  it("renders the unified passing requirement copy in the card meta row", async () => {
    getMock.mockResolvedValue([makeExam({})]);

    render(
      <MemoryRouter initialEntries={["/exam/list"]}>
        <Routes>
          <Route path="/exam/list" element={<ExamListPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText("及格要求: 60/100 分")).toBeInTheDocument();
  });

  it("renders in_progress exam with resume button", async () => {
    getMock.mockResolvedValue([
      makeExam({
        availabilityStatus: "in_progress",
        primaryAction: "resume",
        latestAttemptId: "att-1",
        attemptsUsed: 1,
      }),
    ]);

    render(
      <MemoryRouter initialEntries={["/exam/list"]}>
        <Routes>
          <Route path="/exam/list" element={<ExamListPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText("继续考试")).toBeInTheDocument();
    expect(screen.getByText("进行中")).toBeInTheDocument();
  });

  it("renders resumable exam with resume button", async () => {
    getMock.mockResolvedValue([
      makeExam({
        availabilityStatus: "resumable",
        primaryAction: "resume",
        latestAttemptId: "att-1",
        attemptsUsed: 1,
      }),
    ]);

    render(
      <MemoryRouter initialEntries={["/exam/list"]}>
        <Routes>
          <Route path="/exam/list" element={<ExamListPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText("继续考试")).toBeInTheDocument();
    expect(screen.getByText("可恢复")).toBeInTheDocument();
  });

  it("renders graded exam with bestScore badge", async () => {
    getMock.mockResolvedValue([
      makeExam({
        availabilityStatus: "graded",
        primaryAction: "view_result",
        bestScore: 85,
        bestScorePercent: 85,
        attemptsUsed: 1,
        latestAttemptId: "att-1",
      }),
    ]);

    render(
      <MemoryRouter initialEntries={["/exam/list"]}>
        <Routes>
          <Route path="/exam/list" element={<ExamListPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText("已评分")).toBeInTheDocument();
    const scoreBadge = screen.getByTestId("exam-best-score");
    expect(scoreBadge).toBeInTheDocument();
    expect(scoreBadge).toHaveTextContent("85");
    expect(screen.getByText("查看成绩")).toBeInTheDocument();
    expect(screen.getByTestId("exam-primary-action")).toHaveAttribute(
      "data-action",
      "view_result",
    );
  });

  it("graded retake card keeps the published result viewable next to the start action", async () => {
    getMock.mockResolvedValue([
      makeExam({
        availabilityStatus: "graded",
        primaryAction: "start",
        attemptsUsed: 1,
        bestScore: 85,
        bestScorePercent: 85,
        latestAttemptId: "att-1",
      }),
    ]);

    render(
      <MemoryRouter initialEntries={["/exam/list"]}>
        <Routes>
          <Route path="/exam/list" element={<ExamListPage />} />
          <Route
            path="/exam/:attemptId/result"
            element={<div>考试结果页</div>}
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText("可参加的考试")).toBeInTheDocument();
    expect(screen.getByTestId("exam-primary-action")).toHaveAttribute(
      "data-action",
      "start",
    );
    const viewResult = screen.getByTestId("exam-view-result");
    await userEvent.click(viewResult);
    expect(await screen.findByText("考试结果页")).toBeInTheDocument();
  });

  it("graded retake card without a visible result (bestScore absent) renders no result entry", async () => {
    getMock.mockResolvedValue([
      makeExam({
        availabilityStatus: "graded",
        primaryAction: "start",
        attemptsUsed: 1,
        latestAttemptId: "att-1",
      }),
    ]);

    render(
      <MemoryRouter initialEntries={["/exam/list"]}>
        <Routes>
          <Route path="/exam/list" element={<ExamListPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByTestId("exam-primary-action")).toHaveAttribute(
      "data-action",
      "start",
    );
    expect(screen.queryByText("查看成绩")).not.toBeInTheDocument();
  });

  it("renders the attempts line per the server-projected retake policy (R1-F6)", async () => {
    getMock.mockResolvedValue([
      makeExam({
        examId: "exam-limited",
        title: "限次考试",
        retakePolicy: "max_attempts",
        attemptsUsed: 1,
        maxAttempts: 2,
      }),
      makeExam({
        examId: "exam-unlimited",
        title: "不限次考试",
        retakePolicy: "unlimited",
        // Authored sentinel-like number: must never render as a cap.
        attemptsUsed: 1,
        maxAttempts: 99,
      }),
      makeExam({
        examId: "exam-until-pass",
        title: "通过即止考试",
        retakePolicy: "pass_then_stop",
        attemptsUsed: 2,
        maxAttempts: 99,
      }),
    ]);

    render(
      <MemoryRouter initialEntries={["/exam/list"]}>
        <Routes>
          <Route path="/exam/list" element={<ExamListPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText("限次考试")).toBeInTheDocument();
    expect(screen.getByText("已考: 1/2次")).toBeInTheDocument();
    expect(screen.getByText("不限次数")).toBeInTheDocument();
    expect(screen.getByText("已考: 2次 · 通过即止")).toBeInTheDocument();
    expect(screen.queryByText(/99/)).not.toBeInTheDocument();
  });

  it("renders max_attempts_exhausted in 历史考试 section", async () => {
    getMock.mockResolvedValue([
      makeExam({
        examId: "exam-exhaust",
        availabilityStatus: "max_attempts_exhausted",
        primaryAction: "view_result",
        attemptsUsed: 3,
        maxAttempts: 3,
        latestAttemptId: "att-2",
        bestScore: 90,
      }),
    ]);

    render(
      <MemoryRouter initialEntries={["/exam/list"]}>
        <Routes>
          <Route path="/exam/list" element={<ExamListPage />} />
          <Route
            path="/exam/:attemptId/result"
            element={<div>考试结果页</div>}
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.queryByText("可参加的考试")).not.toBeInTheDocument();
    expect(await screen.findByText("历史考试")).toBeInTheDocument();
    expect(screen.getByText("次数已用完")).toBeInTheDocument();
    expect(screen.getByText("查看成绩")).toBeInTheDocument();
  });

  it("shows empty state when no exams", async () => {
    getMock.mockResolvedValue([]);

    render(
      <MemoryRouter initialEntries={["/exam/list"]}>
        <Routes>
          <Route path="/exam/list" element={<ExamListPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText("暂无可参加的考试")).toBeInTheDocument();
  });

  // Characterization (UI-MIGRATE-N-W3): each section heading introduces a
  // page-level group of exam cards and must remain present as a heading
  // tied to its card group after the section-title typography migration.
  // Asserts the durable role, not the raw typography class.
  it("keeps the 可参加的考试 heading as a section title over its card group", async () => {
    getMock.mockResolvedValue([makeExam({})]);
    render(
      <MemoryRouter initialEntries={["/exam/list"]}>
        <Routes>
          <Route path="/exam/list" element={<ExamListPage />} />
        </Routes>
      </MemoryRouter>,
    );
    const heading = await screen.findByRole("heading", {
      name: "可参加的考试",
    });
    expect(heading.tagName).toBe("H2");
    const section = heading.closest("section");
    expect(section).toBeInTheDocument();
    expect(section).toHaveTextContent("Test Exam");
  });

  it("keeps the 历史考试 heading as a section title over its card group", async () => {
    getMock.mockResolvedValue([
      makeExam({
        examId: "exam-exhaust",
        availabilityStatus: "max_attempts_exhausted",
        primaryAction: "view_result",
        attemptsUsed: 3,
        maxAttempts: 3,
        latestAttemptId: "att-2",
        bestScore: 90,
      }),
    ]);
    render(
      <MemoryRouter initialEntries={["/exam/list"]}>
        <Routes>
          <Route path="/exam/list" element={<ExamListPage />} />
        </Routes>
      </MemoryRouter>,
    );
    const heading = await screen.findByRole("heading", {
      name: "历史考试",
    });
    expect(heading.tagName).toBe("H2");
    const section = heading.closest("section");
    expect(section).toBeInTheDocument();
  });

  // Characterization (UI-MIGRATE-N-W4B): the exam card is a Card-primitive
  // container that owns its elevation. After the business `shadow-sm` is
  // removed (the Card primitive already supplies it), the card must remain a
  // single `data-slot="card"` region holding the title, metadata, and primary
  // action. Asserts the durable container role, not the raw shadow token.
  it("keeps each exam card as a Card region holding title, metadata, and action", async () => {
    getMock.mockResolvedValue([makeExam({})]);
    render(
      <MemoryRouter initialEntries={["/exam/list"]}>
        <Routes>
          <Route path="/exam/list" element={<ExamListPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByTestId("exam-card-exam-1");
    const card = screen.getByTestId("exam-card-exam-1");
    // The exam card renders as the Card primitive container.
    expect(card).toHaveAttribute("data-slot", "card");
    // The card region still holds the exam title, its meta, and the action.
    expect(card).toHaveTextContent("Test Exam");
    expect(card).toHaveTextContent("60");
    expect(card).toHaveTextContent("开始考试");
  });

  it("shows error state on load failure", async () => {
    getMock.mockRejectedValue(new Error("Network error"));

    render(
      <MemoryRouter initialEntries={["/exam/list"]}>
        <Routes>
          <Route path="/exam/list" element={<ExamListPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText("加载考试列表失败")).toBeInTheDocument();
  });

  it("reports exam_list_load_failed with the ApiError code on load failure", async () => {
    const recording = recordingBuffer();
    getMock.mockRejectedValue(
      new ApiError(0, "Network request failed", "NETWORK"),
    );

    render(
      <MemoryRouter initialEntries={["/exam/list"]}>
        <Routes>
          <Route path="/exam/list" element={<ExamListPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText("加载考试列表失败")).toBeInTheDocument();

    const telemetry = recording.events.filter(
      (e) => e.kind === "exam_telemetry" && e.name === "exam_list_load_failed",
    );
    expect(telemetry).toHaveLength(1);
    expect(telemetry[0]!.level).toBe("warn");
    expect(telemetry[0]!.metadata).toEqual({ errorCode: "NETWORK" });
    // Dual-emit: the warn level also lands in the generic log channel.
    expect(
      recording.events.some(
        (e) => e.kind === "log" && e.name === "exam_list_load_failed",
      ),
    ).toBe(true);
    setBuffer(null);
  });

  it("reports exam_list_load_failed with UNKNOWN for non-ApiError failures", async () => {
    const recording = recordingBuffer();
    getMock.mockRejectedValue(new Error("Network error"));

    render(
      <MemoryRouter initialEntries={["/exam/list"]}>
        <Routes>
          <Route path="/exam/list" element={<ExamListPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText("加载考试列表失败")).toBeInTheDocument();

    const telemetry = recording.events.filter(
      (e) => e.kind === "exam_telemetry" && e.name === "exam_list_load_failed",
    );
    expect(telemetry).toHaveLength(1);
    expect(telemetry[0]!.metadata).toEqual({ errorCode: "UNKNOWN" });
    // Raw exception text must not leak into the persisted metadata.
    expect(JSON.stringify(telemetry[0])).not.toContain("Network error");
    setBuffer(null);
  });
});
