import { act, render, screen, waitFor } from "@testing-library/react";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { ResultPage } from "./ResultPage";
import type { CandidateAttemptResultResponse } from "@exam/contracts";

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
  api: { get: vi.fn() },
}));

const getMock = vi.mocked(api.get);

/** A visible graded result payload whose examTitle is unique per attempt, so
 * a cross-attempt render is unambiguous. */
function visibleResult(
  attemptId: string,
  examTitle: string,
  totalScore: number,
): CandidateAttemptResultResponse {
  return {
    attemptId,
    status: "graded",
    showResultImmediately: true,
    examTitle,
    passingScore: 6,
    totalScore,
    passed: totalScore >= 6,
    gradedAt: "2026-06-01T00:00:00.000Z",
    questionResults: [
      {
        questionId: "q1",
        type: "single_choice",
        content: "选择正确答案",
        order: 0,
        candidateAnswer: "a",
        score: totalScore,
        maxScore: 10,
        correct: totalScore >= 6,
      },
    ],
  } as CandidateAttemptResultResponse;
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

/** FIFO of deferred result GETs: each read holds until the test releases it,
 * pinning the SETTLEMENT order independently of the START order — the
 * freedom an attempt switch has on the wire. */
const queue: Array<
  ReturnType<typeof deferred<CandidateAttemptResultResponse>>
> = [];

const attemptsPath = () =>
  getMock.mock.calls
    .map((c) => String(c[0]))
    .filter((u) => u.includes("/api/scores/attempts/"));

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-path">{location.pathname}</div>;
}

/** Navigations the PAGE did not author (the browser Back / Forward buttons):
 * the attempt switches that supersede an in-flight result read. */
function HistoryNav() {
  const navigate = useNavigate();
  return (
    <>
      <button type="button" onClick={() => void navigate(-1)}>
        后退
      </button>
      <button type="button" onClick={() => void navigate(1)}>
        前进
      </button>
    </>
  );
}

function renderPage() {
  // History: [attempt-2, attempt-1, attempt-3]; the page mounts on attempt-1,
  // Back switches to attempt-2 and Forward returns to attempt-1 WITHOUT
  // remounting the page element.
  return render(
    <MemoryRouter
      initialEntries={[
        "/exam/attempt-2/result",
        "/exam/attempt-1/result",
        "/exam/attempt-3/result",
      ]}
      initialIndex={1}
    >
      <Routes>
        <Route path="/exam/:attemptId/result" element={<ResultPage />} />
      </Routes>
      <LocationProbe />
      <HistoryNav />
    </MemoryRouter>,
  );
}

describe("ResultPage attempt-switch snapshot ownership (S5)", () => {
  beforeEach(() => {
    getMock.mockReset();
    queue.length = 0;
    getMock.mockImplementation(() => {
      const d = deferred<CandidateAttemptResultResponse>();
      queue.push(d);
      return d.promise;
    });
  });

  it("switching to a new attempt must immediately retire the old attempt's success snapshot and show loading", async () => {
    renderPage();
    // attempt-1 loads successfully — its title and score are visible.
    await act(async () => {
      queue.shift()!.resolve(visibleResult("attempt-1", "考试甲", 10));
    });
    expect(await screen.findByText("考试甲")).toBeInTheDocument();
    expect(screen.getByTestId("result-total-score")).toHaveTextContent("10");

    // Switch the route to attempt-2 while holding its read on the wire.
    await act(async () => {
      screen.getByRole("button", { name: "后退" }).click();
    });
    await act(async () => {});
    expect(screen.getByTestId("location-path").textContent).toContain(
      "attempt-2",
    );
    expect(attemptsPath().at(-1)).toContain("attempt-2");

    // The OLD attempt's title/score must not linger under the NEW attempt's
    // URL: the visible snapshot is bound to its attemptId, so the page shows
    // the current attempt's loading state instead.
    expect(screen.queryByText("考试甲")).not.toBeInTheDocument();
    expect(screen.queryByTestId("result-total-score")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();

    // The current attempt's read settles — its own content renders.
    await act(async () => {
      queue[0]!.resolve(visibleResult("attempt-2", "考试乙", 7));
    });
    expect(await screen.findByText("考试乙")).toBeInTheDocument();
    expect(screen.getByTestId("result-total-score")).toHaveTextContent("7");
    expect(screen.queryByText("考试甲")).not.toBeInTheDocument();
  });

  it("a superseded read landing last must not overwrite the current attempt's success snapshot", async () => {
    renderPage();
    // attempt-1 loads successfully.
    await act(async () => {
      queue.shift()!.resolve(visibleResult("attempt-1", "考试甲", 10));
    });
    expect(await screen.findByText("考试甲")).toBeInTheDocument();

    // Request A: switch to attempt-2 — held on the wire.
    await act(async () => {
      screen.getByRole("button", { name: "后退" }).click();
    });
    await act(async () => {});
    expect(attemptsPath().at(-1)).toContain("attempt-2");

    // Request B: Forward again to attempt-1 (attempt-2's read still in
    // flight).
    await act(async () => {
      screen.getByRole("button", { name: "前进" }).click();
    });
    await act(async () => {});
    expect(screen.getByTestId("location-path").textContent).toContain(
      "attempt-1",
    );
    expect(attemptsPath().at(-1)).toContain("attempt-1");
    expect(attemptsPath()).toHaveLength(3);

    // The CURRENT read (B, attempt-1) settles first: its snapshot renders.
    await act(async () => {
      queue[1]!.resolve(visibleResult("attempt-1", "考试甲", 9));
    });
    await waitFor(() =>
      expect(screen.getByTestId("result-total-score")).toHaveTextContent("9"),
    );

    // The SUPERSEDED read (A, attempt-2) settles LAST: its title/score belong
    // to an attempt the URL no longer names and must be discarded.
    await act(async () => {
      queue[0]!.resolve(visibleResult("attempt-2", "考试乙", 7));
    });

    expect(screen.queryByText("考试乙")).not.toBeInTheDocument();
    expect(screen.getByTestId("result-total-score")).toHaveTextContent("9");
    expect(screen.getByText("考试甲")).toBeInTheDocument();
    expect(screen.getByTestId("location-path").textContent).toContain(
      "attempt-1",
    );
  });

  it("a superseded read FAILING after the current attempt succeeded must not flip the page to its error", async () => {
    renderPage();
    await act(async () => {
      queue.shift()!.resolve(visibleResult("attempt-1", "考试甲", 10));
    });
    expect(await screen.findByText("考试甲")).toBeInTheDocument();

    // A: switch to attempt-2 — held. B: forward back to attempt-1 — held.
    await act(async () => {
      screen.getByRole("button", { name: "后退" }).click();
    });
    await act(async () => {});
    await act(async () => {
      screen.getByRole("button", { name: "前进" }).click();
    });
    await act(async () => {});
    expect(screen.getByTestId("location-path").textContent).toContain(
      "attempt-1",
    );
    expect(attemptsPath()).toHaveLength(3);

    // The current attempt-1 read succeeds.
    await act(async () => {
      queue[1]!.resolve(visibleResult("attempt-1", "考试甲", 9));
    });
    await waitFor(() =>
      expect(screen.getByTestId("result-total-score")).toHaveTextContent("9"),
    );

    // The superseded attempt-2 read then FAILS. The failure belongs to a
    // request nobody is waiting for — it must not own the current page.
    await act(async () => {
      queue[0]!.reject(new Error("stale attempt failed"));
    });

    expect(screen.queryByText("加载成绩失败")).not.toBeInTheDocument();
    expect(screen.getByTestId("result-total-score")).toHaveTextContent("9");
    expect(screen.getByText("考试甲")).toBeInTheDocument();
  });

  it("switching away from a failed attempt must retire the old error and adopt the new attempt's success", async () => {
    renderPage();
    // attempt-1's read fails: the error is bound to attempt-1.
    await act(async () => {
      queue.shift()!.reject(new Error("attempt-1 failed"));
    });
    expect(await screen.findByText("加载成绩失败")).toBeInTheDocument();

    // Switch to attempt-2: the old attempt's error must not linger under the
    // new attempt's URL.
    await act(async () => {
      screen.getByRole("button", { name: "后退" }).click();
    });
    await act(async () => {});
    expect(screen.getByTestId("location-path").textContent).toContain(
      "attempt-2",
    );
    expect(screen.queryByText("加载成绩失败")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();

    // attempt-2 succeeds: its own content renders, the old error stays gone.
    await act(async () => {
      queue[0]!.resolve(visibleResult("attempt-2", "考试乙", 7));
    });
    expect(await screen.findByText("考试乙")).toBeInTheDocument();
    expect(screen.queryByText("加载成绩失败")).not.toBeInTheDocument();
  });
});
