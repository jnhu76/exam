import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
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

interface QueueStatusPayload {
  examId: string;
  status: "waiting" | "ready";
  position: number;
  waitCount: number;
  estimatedWaitSeconds: number;
}

function queueWaiting(examId: string): QueueStatusPayload {
  return {
    examId,
    status: "waiting",
    position: 2,
    waitCount: 1,
    estimatedWaitSeconds: 30,
  };
}

function queueReady(examId: string): QueueStatusPayload {
  return {
    examId,
    status: "ready",
    position: 1,
    waitCount: 0,
    estimatedWaitSeconds: 0,
  };
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

/** Deferred FIFO for the admission-queue endpoint: each queue request holds
 * until the test releases it, pinning settlement order independently of
 * issue order. */
const queueDeferreds: Array<ReturnType<typeof deferred<QueueStatusPayload>>> =
  [];
/** Deferred FIFO for the start-command endpoint (same contract). */
const startDeferreds: Array<
  ReturnType<typeof deferred<{ id: string; status: string; examId: string }>>
> = [];

const postUrls = () => postMock.mock.calls.map((call) => String(call[0]));

function examDetail(overrides: {
  id: string;
  title: string;
  requireQueue: boolean;
}) {
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
    primaryAction: "start",
  };
}

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="current-path">{location.pathname}</span>;
}

/** A navigation the PAGE did not author (the browser Back button) — the
 * reachable way the page lifecycle or its examId param changes while an
 * entry operation is still on the wire. */
function HistoryNav() {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => void navigate(-1)}>
      后退
    </button>
  );
}

/** initialEntries are visited back-to-front: the LAST entry is where the
 * page mounts, and Back moves to the earlier entry without remounting a
 * route whose path pattern is unchanged. */
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
            <Route
              path="/somewhere-else"
              element={<div data-testid="left-page" />}
            />
          </Routes>
          <LocationProbe />
          <HistoryNav />
        </BrandProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  getMock.mockReset();
  postMock.mockReset();
  queueDeferreds.length = 0;
  startDeferreds.length = 0;
  getMock.mockImplementation(async (url: string) => {
    if (String(url).includes("/api/candidate/exams/exam-1")) {
      return examDetail({
        id: "exam-1",
        title: "排队考试",
        requireQueue: true,
      });
    }
    if (String(url).includes("/api/candidate/exams/exam-2")) {
      return examDetail({
        id: "exam-2",
        title: "普通考试",
        requireQueue: false,
      });
    }
    throw new Error(`unexpected GET ${String(url)}`);
  });
  postMock.mockImplementation(async (url: string) => {
    const target = String(url);
    if (target.endsWith("/queue")) {
      const d = deferred<QueueStatusPayload>();
      queueDeferreds.push(d);
      return d.promise;
    }
    if (target.endsWith("/start")) {
      const d = deferred<{ id: string; status: string; examId: string }>();
      startDeferreds.push(d);
      return d.promise;
    }
    throw new Error(`unexpected POST ${target}`);
  });
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * Start-entry operation ownership: exactly one entry operation owns the
 * start/queue UI per page lifecycle and exam id. The queue loop previously
 * checked its cancellation flag only after the poll sleep, so an operation
 * superseded by an unmount or an examId param change could still POST the
 * start command for the abandoned exam and navigate the page to an attempt
 * the user is no longer entering. Each await boundary must re-check that
 * the operation still owns the page before it may fire the start command,
 * mutate start/queue UI, or navigate.
 */
describe("StartExamPage entry operation ownership", () => {
  it("a queue admission returning ready after the candidate left the page must not POST start or navigate", async () => {
    renderStartPage(["/somewhere-else", "/exam/exam-1/start"]);
    expect(await screen.findByText("排队考试")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "开始考试" }));
    expect(postUrls()).toEqual(["/api/attempts/exam-1/queue"]);

    // The candidate navigates away while the join request is on the wire.
    await act(async () => {
      screen.getByRole("button", { name: "后退" }).click();
    });
    expect(screen.getByTestId("left-page")).toBeInTheDocument();

    // Admission became ready AFTER the page was left: the response belongs
    // to an operation nobody is waiting for. It must not fire the start
    // command, and the page must stay where the candidate navigated to.
    await act(async () => {
      queueDeferreds[0]!.resolve(queueReady("exam-1"));
    });
    await act(async () => {});

    expect(postUrls()).toEqual(["/api/attempts/exam-1/queue"]);
    expect(screen.getByTestId("current-path")).toHaveTextContent(
      "/somewhere-else",
    );
  });

  it("an examId change on the same route supersedes the in-flight queue flow; the new exam starts unaffected", async () => {
    renderStartPage(["/exam/exam-2/start", "/exam/exam-1/start"]);
    expect(await screen.findByText("排队考试")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "开始考试" }));
    expect(postUrls()).toEqual(["/api/attempts/exam-1/queue"]);

    // Same route element, param change: the page is NOT remounted for the
    // next exam. The old exam's entry operation must die here.
    await act(async () => {
      screen.getByRole("button", { name: "后退" }).click();
    });
    expect(await screen.findByText("普通考试")).toBeInTheDocument();

    // The old exam's admission became ready after the examId changed.
    await act(async () => {
      queueDeferreds[0]!.resolve(queueReady("exam-1"));
    });
    await act(async () => {});

    expect(postUrls()).not.toContain("/api/attempts/exam-1/start");
    expect(screen.getByTestId("current-path")).toHaveTextContent(
      "/exam/exam-2/start",
    );

    // The new exam's own entry flow runs normally, unaffected by the
    // superseded flow.
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "开始考试" }));
    expect(postUrls()).toContain("/api/attempts/exam-2/start");
    await act(async () => {
      startDeferreds[0]!.resolve({
        id: "att-2",
        status: "in_progress",
        examId: "exam-2",
      });
    });
    await waitFor(() => {
      expect(screen.getByTestId("current-path")).toHaveTextContent(
        "/exam/att-2/take",
      );
    });
    expect(postUrls()).not.toContain("/api/attempts/exam-1/start");
  });

  it("a waiting poll cycle that returns ready after the examId changed must not start the old exam", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    renderStartPage(["/exam/exam-2/start", "/exam/exam-1/start"]);
    await act(async () => {});
    expect(screen.getByText("排队考试")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "开始考试" }));
    await act(async () => {});

    // The join returned WAITING: the queue panel renders and the loop
    // sleeps before its next poll.
    await act(async () => {
      queueDeferreds[0]!.resolve(queueWaiting("exam-1"));
    });
    expect(screen.getByTestId("exam-queue-panel")).toBeInTheDocument();
    expect(postUrls()).toEqual(["/api/attempts/exam-1/queue"]);

    // The next poll fires after the sleep and is held on the wire.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(postUrls()).toEqual([
      "/api/attempts/exam-1/queue",
      "/api/attempts/exam-1/queue",
    ]);

    // The examId changes while the poll is in flight…
    await act(async () => {
      screen.getByRole("button", { name: "后退" }).click();
    });
    await act(async () => {});
    expect(screen.getByText("普通考试")).toBeInTheDocument();

    // …and the poll returns ready for the OLD exam: it must not proceed to
    // the start command.
    await act(async () => {
      queueDeferreds[1]!.resolve(queueReady("exam-1"));
    });
    await act(async () => {});

    expect(postUrls()).not.toContain("/api/attempts/exam-1/start");
    expect(screen.getByTestId("current-path")).toHaveTextContent(
      "/exam/exam-2/start",
    );
  });

  it("an already-issued start POST returning after the page was left must not navigate to the old attempt", async () => {
    renderStartPage(["/somewhere-else", "/exam/exam-2/start"]);
    expect(await screen.findByText("普通考试")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "开始考试" }));
    expect(postUrls()).toEqual(["/api/attempts/exam-2/start"]);

    // The page is left while the start command is on the wire. The command
    // may commit server-side — the client's only allowed handling is to
    // claim neither the result nor the navigation.
    await act(async () => {
      screen.getByRole("button", { name: "后退" }).click();
    });
    expect(screen.getByTestId("left-page")).toBeInTheDocument();

    await act(async () => {
      startDeferreds[0]!.resolve({
        id: "att-2",
        status: "in_progress",
        examId: "exam-2",
      });
    });
    await act(async () => {});

    expect(screen.getByTestId("current-path")).toHaveTextContent(
      "/somewhere-else",
    );
  });

  it("a second click landing during an in-flight queue flow must not spawn a competing flow", async () => {
    renderStartPage(["/exam/exam-1/start"]);
    expect(await screen.findByText("排队考试")).toBeInTheDocument();

    // Two clicks inside one act: neither sees the other's disabled commit,
    // so the entry slot must refuse the second flow at claim time.
    await act(async () => {
      screen.getByRole("button", { name: "开始考试" }).click();
      screen.getByRole("button", { name: "开始考试" }).click();
    });
    expect(postUrls()).toEqual(["/api/attempts/exam-1/queue"]);

    // The owning flow still completes normally.
    await act(async () => {
      queueDeferreds[0]!.resolve(queueReady("exam-1"));
    });
    await act(async () => {
      startDeferreds[0]!.resolve({
        id: "att-1",
        status: "in_progress",
        examId: "exam-1",
      });
    });
    await waitFor(() => {
      expect(screen.getByTestId("current-path")).toHaveTextContent(
        "/exam/att-1/take",
      );
    });
    expect(postUrls()).toEqual([
      "/api/attempts/exam-1/queue",
      "/api/attempts/exam-1/start",
    ]);
  });
});
