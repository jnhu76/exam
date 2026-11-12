import { act, fireEvent, render, screen } from "@testing-library/react";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "@/lib/api";
import { setBuffer } from "@/lib/logger";
import type { ClientEventBuffer } from "@/lib/clientEventBuffer";
import type { ClientEvent } from "@exam/contracts";
import { AuthProvider } from "@/contexts/AuthContext";
import { BrandProvider } from "@/components/layout/BrandProvider";
import { StartExamPage } from "./StartExamPage";
import { permissionsForRole } from "@exam/authz";

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
      this.status = status;
      this.code = code;
      this.details = details;
      this.requestId = requestId;
      this.serverMessage = serverMessage ?? message;
      this.name = "ApiError";
    }
  },
  setNavigate: () => {},
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const getMock = vi.mocked(apiGet);
const postMock = vi.mocked(apiPost);

interface ExamDetailPayload {
  id: string;
  title: string;
  durationMinutes: number;
  passingScore: number;
  totalScore: number;
  questionCount: number;
  controlFlags: {
    shuffleQuestions: boolean;
    shuffleOptions: boolean;
    detectTabSwitch: boolean;
    disableCopyPaste: boolean;
    requireQueue: boolean;
    batchSize: number;
    batchInterval: number;
    restrictIp: boolean;
    requireLockdown: boolean;
    showResultImmediately: boolean;
  };
  maxAttempts: number;
  currentAttempts: number;
  canStartNewAttempt: boolean;
  availabilityStatus: string;
  primaryAction: "start" | "resume" | "view_result" | "none";
}

interface QueueStatusPayload {
  examId: string;
  status: "waiting" | "ready";
  position: number;
  waitCount: number;
  estimatedWaitSeconds: number;
}

interface AttemptPayload {
  id: string;
  status: string;
  examId: string;
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface DetailRequest {
  url: string;
  resolve: (detail: ExamDetailPayload) => void;
  reject: (error: unknown) => void;
}

/** One entry per candidate-exam detail GET, held until the test settles it. */
const detailRequests: DetailRequest[] = [];

function detailRequest(examId: string): DetailRequest {
  const request = detailRequests.find((candidate) =>
    candidate.url.includes(`/api/candidate/exams/${examId}`),
  );
  if (!request) throw new Error(`no pending detail request for ${examId}`);
  return request;
}

const queueDeferreds: Array<ReturnType<typeof deferred<QueueStatusPayload>>> =
  [];
const startDeferreds: Array<ReturnType<typeof deferred<AttemptPayload>>> = [];

const postUrls = () => postMock.mock.calls.map((call) => String(call[0]));

function examDetail(overrides: {
  id: string;
  title: string;
  requireQueue: boolean;
  primaryAction?: ExamDetailPayload["primaryAction"];
}): ExamDetailPayload {
  return {
    id: overrides.id,
    title: overrides.title,
    durationMinutes: 30,
    passingScore: 50,
    totalScore: 100,
    questionCount: 5,
    controlFlags: {
      shuffleQuestions: false,
      shuffleOptions: false,
      detectTabSwitch: false,
      disableCopyPaste: false,
      requireQueue: overrides.requireQueue,
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
    primaryAction: overrides.primaryAction ?? "start",
  };
}

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

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="current-path">{location.pathname}</span>;
}

/** A navigation the PAGE did not author (the browser Back button) — the
 * reachable way the examId param changes without remounting the page. */
function HistoryNav() {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => void navigate(-1)}>
      后退
    </button>
  );
}

/** initialEntries are visited back-to-front: the LAST entry is where the
 * page mounts, and Back moves to the earlier entry. */
function renderStartPage(initialEntries: string[]) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <AuthProvider
        initialUser={{
          id: "c1",
          username: "candidate",
          name: "Candidate",
          role: "Candidate",
          organizationId: "org1",
          capabilities: [...permissionsForRole("Candidate")],
        }}
      >
        <BrandProvider>
          <Routes>
            <Route path="/exam/:examId/start" element={<StartExamPage />} />
            <Route
              path="/exam/:attemptId/take"
              element={<div data-testid="take-page-stub" />}
            />
          </Routes>
          <LocationProbe />
          <HistoryNav />
        </BrandProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

async function navigateBackTo(precedingExamId: string) {
  await act(async () => {
    screen.getByRole("button", { name: "后退" }).click();
  });
  expect(await screen.findByTestId("current-path")).toHaveTextContent(
    `/exam/${precedingExamId}/start`,
  );
}

beforeEach(() => {
  getMock.mockReset();
  postMock.mockReset();
  detailRequests.length = 0;
  queueDeferreds.length = 0;
  startDeferreds.length = 0;
  getMock.mockImplementation((url: unknown) => {
    const d = deferred<ExamDetailPayload>();
    detailRequests.push({
      url: String(url),
      resolve: d.resolve,
      reject: d.reject,
    });
    return d.promise;
  });
  postMock.mockImplementation(async (url: unknown) => {
    const target = String(url);
    if (target.endsWith("/queue")) {
      const d = deferred<QueueStatusPayload>();
      queueDeferreds.push(d);
      return d.promise;
    }
    if (target.endsWith("/start")) {
      const d = deferred<AttemptPayload>();
      startDeferreds.push(d);
      return d.promise;
    }
    throw new Error(`unexpected POST ${target}`);
  });
});

afterEach(() => {
  setBuffer(null);
});

/**
 * Candidate exam detail request ownership: a detail response may only write
 * the page state (exam, error, loading, telemetry) while the request still
 * belongs to the route's current examId. A late response for the exam the
 * candidate navigated away from must never replace the new exam's view, and
 * while the new exam's detail is in flight the page shows loading — not the
 * previous exam's data.
 */
describe("StartExamPage detail request ownership", () => {
  it("a late A detail response after the route moved to B must not overwrite B's view", async () => {
    renderStartPage(["/exam/exam-B/start", "/exam/exam-A/start"]);
    expect(detailRequests).toHaveLength(1);
    expect(detailRequests[0]!.url).toContain("/api/candidate/exams/exam-A");

    // The candidate navigates from A to B while A's detail is on the wire.
    await navigateBackTo("exam-B");
    expect(detailRequests).toHaveLength(2);
    await act(async () => {
      detailRequest("exam-B").resolve(
        examDetail({
          id: "exam-B",
          title: "考试 B",
          requireQueue: false,
          primaryAction: "start",
        }),
      );
    });
    expect(await screen.findByText("考试 B")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "开始考试" }),
    ).toBeInTheDocument();

    // A's detail arrives after B's: it belongs to an abandoned route.
    await act(async () => {
      detailRequest("exam-A").resolve(
        examDetail({
          id: "exam-A",
          title: "考试 A",
          requireQueue: false,
          primaryAction: "view_result",
        }),
      );
    });
    await act(async () => {});

    expect(screen.getByText("考试 B")).toBeInTheDocument();
    expect(screen.queryByText("考试 A")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "开始考试" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "查看成绩" }),
    ).not.toBeInTheDocument();
  });

  it("while B's detail is still pending, a completed A response shows loading instead of A", async () => {
    renderStartPage(["/exam/exam-B/start", "/exam/exam-A/start"]);
    await navigateBackTo("exam-B");
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByText("考试 A")).not.toBeInTheDocument();

    // A resolves first; B is still pending.
    await act(async () => {
      detailRequest("exam-A").resolve(
        examDetail({
          id: "exam-A",
          title: "考试 A",
          requireQueue: false,
        }),
      );
    });
    await act(async () => {});

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByText("考试 A")).not.toBeInTheDocument();
    expect(screen.queryByText("加载考试信息失败")).not.toBeInTheDocument();

    // B arrives and owns the view.
    await act(async () => {
      detailRequest("exam-B").resolve(
        examDetail({
          id: "exam-B",
          title: "考试 B",
          requireQueue: false,
        }),
      );
    });

    expect(await screen.findByText("考试 B")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByText("考试 A")).not.toBeInTheDocument();
  });

  it("a rejected A detail request must not write B's error/loading state or telemetry", async () => {
    const recording = recordingBuffer();
    renderStartPage(["/exam/exam-B/start", "/exam/exam-A/start"]);
    await navigateBackTo("exam-B");

    await act(async () => {
      detailRequest("exam-A").reject(
        new ApiError(404, "gone", "EXAM_NOT_FOUND"),
      );
    });
    await act(async () => {});

    // B's detail is still on the wire: the page keeps waiting, with no error
    // borrowed from the abandoned request.
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByText("加载考试信息失败")).not.toBeInTheDocument();
    expect(
      recording.events.filter(
        (event) =>
          event.kind === "exam_telemetry" &&
          event.name === "exam_detail_load_failed",
      ),
    ).toHaveLength(0);

    await act(async () => {
      detailRequest("exam-B").resolve(
        examDetail({
          id: "exam-B",
          title: "考试 B",
          requireQueue: false,
        }),
      );
    });

    expect(await screen.findByText("考试 B")).toBeInTheDocument();
    expect(screen.queryByText("加载考试信息失败")).not.toBeInTheDocument();
  });

  it("starting from B's page uses B's requireQueue: A=false, B=true joins B's queue", async () => {
    renderStartPage(["/exam/exam-B/start", "/exam/exam-A/start"]);
    await navigateBackTo("exam-B");

    await act(async () => {
      detailRequest("exam-B").resolve(
        examDetail({
          id: "exam-B",
          title: "考试 B",
          requireQueue: true,
        }),
      );
    });
    expect(await screen.findByText("考试 B")).toBeInTheDocument();

    // A's stale detail says no queue; it must not decide B's entry path.
    await act(async () => {
      detailRequest("exam-A").resolve(
        examDetail({
          id: "exam-A",
          title: "考试 A",
          requireQueue: false,
        }),
      );
    });
    await act(async () => {});

    fireEvent.click(screen.getByRole("button", { name: "开始考试" }));
    await act(async () => {});

    expect(postUrls()).toEqual(["/api/attempts/exam-B/queue"]);
  });

  it("starting from B's page uses B's requireQueue: A=true, B=false starts B directly", async () => {
    renderStartPage(["/exam/exam-B/start", "/exam/exam-A/start"]);
    await navigateBackTo("exam-B");

    await act(async () => {
      detailRequest("exam-B").resolve(
        examDetail({
          id: "exam-B",
          title: "考试 B",
          requireQueue: false,
        }),
      );
    });
    expect(await screen.findByText("考试 B")).toBeInTheDocument();

    // A's stale detail says queue required; it must not decide B's entry path.
    await act(async () => {
      detailRequest("exam-A").resolve(
        examDetail({
          id: "exam-A",
          title: "考试 A",
          requireQueue: true,
        }),
      );
    });
    await act(async () => {});

    fireEvent.click(screen.getByRole("button", { name: "开始考试" }));
    await act(async () => {});

    expect(postUrls()).toEqual(["/api/attempts/exam-B/start"]);
  });
});
