import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { AuthProvider } from "@/contexts/AuthContext";
import { BrandProvider } from "@/components/layout/BrandProvider";
import { GradingDetailPageRoute } from "./GradingDetailPage";
import { permissionsForRole } from "@exam/authz";
import { toast } from "sonner";

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
    post: vi.fn(),
  },
  setNavigate: () => {},
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const getMock = vi.mocked(api.get);
const postMock = vi.mocked(api.post);
const toastErrorMock = vi.mocked(toast.error);
const toastSuccessMock = vi.mocked(toast.success);

interface GradingEntryFixture {
  score: number;
  comment: string;
  gradedBy: string;
  gradedByName: string;
  gradedAt: string;
}

function entry(score: number, comment = "评语"): GradingEntryFixture {
  return {
    score,
    comment,
    gradedBy: "admin-1",
    gradedByName: "李评分",
    gradedAt: "2026-01-15T12:00:00Z",
  };
}

/** Builds a grading-details snapshot. q1Entry/q2Entry are null while the
 * question is still pending (editable). */
function detail(
  q1Entry: GradingEntryFixture | null,
  q2Entry: GradingEntryFixture | null,
  gradingStatus: string,
) {
  return {
    attemptId: "att-1",
    examId: "exam-1",
    examTitle: "期末考试",
    candidateId: "c1",
    candidateName: "张三",
    gradingStatus,
    questions: [
      {
        questionId: "q1",
        type: "text_response",
        content: "第一题",
        maxScore: 10,
        candidateAnswer: "答案一",
        entry: q1Entry,
      },
      {
        questionId: "q2",
        type: "single_choice",
        content: "第二题",
        maxScore: 5,
        candidateAnswer: "答案二",
        entry: q2Entry,
      },
    ],
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

/** FIFO of deferred grading-details GETs: each read holds until the test
 * releases it, pinning the SETTLEMENT order independently of the START
 * order — the freedom a slow authoritative read has on the wire. */
const queue: Array<ReturnType<typeof deferred<ReturnType<typeof detail>>>> = [];

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/admin/grading-queue/att-1"]}>
      <AuthProvider
        initialUser={{
          id: "admin-1",
          username: "admin",
          name: "Admin",
          role: "Admin",
          organizationId: "org-1",
          capabilities: [...permissionsForRole("Admin")],
        }}
      >
        <BrandProvider>
          <Routes>
            <Route
              path="/admin/grading-queue/:id"
              element={<GradingDetailPageRoute />}
            />
          </Routes>
        </BrandProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

/** Drives the full submit flow for one question: types the score, clicks the
 * question's submit button, confirms the irrevocable-POST dialog. */
async function submitScore(
  user: ReturnType<typeof userEvent.setup>,
  questionId: string,
  score: string,
) {
  await user.type(
    screen.getByTestId(`grading-score-input-${questionId}`),
    score,
  );
  await user.click(screen.getByTestId(`grading-submit-btn-${questionId}`));
  await user.click(await screen.findByRole("button", { name: "确认提交" }));
}

describe("GradingDetailPage stale-read ownership (F-11)", () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.error).mockClear();
    vi.mocked(toast.info).mockClear();
    queue.length = 0;
    getMock.mockImplementation(() => {
      const d = deferred<ReturnType<typeof detail>>();
      queue.push(d);
      return d.promise;
    });
  });

  it("a superseded reconciliation read landing last must not unlock an already-submitted question", async () => {
    const user = userEvent.setup();
    renderPage();
    // Initial load: both questions pending (editable).
    await act(async () => {
      queue.shift()!.resolve(detail(null, null, "pending_manual"));
    });
    expect(await screen.findByText(/期末考试 — 张三/)).toBeInTheDocument();
    expect(screen.getByTestId("grading-submit-btn-q1")).toBeInTheDocument();
    expect(screen.getByTestId("grading-submit-btn-q2")).toBeInTheDocument();

    // Submit q1: POST succeeds; its authoritative reconciliation read (read
    // #2) is held on the wire.
    postMock.mockResolvedValueOnce({
      attemptId: "att-1",
      gradingStatus: "pending_manual",
      questionId: "q1",
      score: 8,
      fullyGraded: false,
    });
    await submitScore(user, "q1", "8");
    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(2));

    // Submit q2 while q1's reconciliation read is still in flight: POST #2
    // succeeds and starts read #3 (a newer generation). Read #2 is now
    // superseded — its snapshot can only describe the attempt BEFORE q2's
    // POST committed.
    postMock.mockResolvedValueOnce({
      attemptId: "att-1",
      gradingStatus: "fully_graded",
      questionId: "q2",
      score: 5,
      fullyGraded: true,
    });
    await submitScore(user, "q2", "5");
    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(3));

    // The CURRENT read (#3) settles first: both questions committed.
    await act(async () => {
      queue[1]!.resolve(detail(entry(8), entry(5), "fully_graded"));
    });
    await waitFor(() =>
      expect(
        screen.getByTestId("grading-submitted-meta-q2"),
      ).toBeInTheDocument(),
    );

    // The SUPERSEDED read (#2) settles LAST: in its snapshot q2 is still
    // pending (it started before q2's POST). Rendering it would unlock a
    // question whose grade is already irrevocably committed.
    await act(async () => {
      queue[0]!.resolve(detail(entry(8), null, "pending_manual"));
    });

    expect(screen.getByTestId("grading-score-input-q2")).toBeDisabled();
    expect(
      screen.queryByTestId("grading-submit-btn-q2"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("grading-submitted-meta-q2")).toBeInTheDocument();
    // q1 stays locked with its committed score as well.
    expect(screen.getByTestId("grading-score-input-q1")).toBeDisabled();
    expect(screen.getByTestId("grading-score-input-q1")).toHaveValue(8);
    // The attempt-level projection must not flip back to the irrevocable
    // notice either.
    expect(
      screen.getByTestId("grading-fully-graded-notice"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("grading-irrevocable-notice"),
    ).not.toBeInTheDocument();
  });

  it("an unknown-outcome POST whose reconciliation read is superseded must not claim failure, revert the sibling, or re-POST", async () => {
    const user = userEvent.setup();
    renderPage();
    await act(async () => {
      queue.shift()!.resolve(detail(null, null, "pending_manual"));
    });
    expect(await screen.findByText(/期末考试 — 张三/)).toBeInTheDocument();

    // q1's POST fails with a lost response (commit state UNKNOWN): the page
    // starts a reconciliation read (#2), held on the wire.
    postMock.mockRejectedValueOnce(new Error("network lost"));
    await submitScore(user, "q1", "8");
    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(2));

    // q2 is submitted while the reconciliation is pending: POST #2 succeeds
    // and starts read #3 (newer generation — read #2 is superseded).
    postMock.mockResolvedValueOnce({
      attemptId: "att-1",
      gradingStatus: "pending_manual",
      questionId: "q2",
      score: 5,
      fullyGraded: false,
    });
    await submitScore(user, "q2", "5");
    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(3));

    // The current read (#3) settles: q2 committed, q1 STILL pending (q1's
    // POST genuinely did not commit). The operator's q1 draft survives.
    await act(async () => {
      queue[1]!.resolve(detail(null, entry(5), "pending_manual"));
    });
    await waitFor(() =>
      expect(
        screen.getByTestId("grading-submitted-meta-q2"),
      ).toBeInTheDocument(),
    );
    expect(screen.getByTestId("grading-score-input-q1")).toBeEnabled();
    expect(screen.getByTestId("grading-score-input-q1")).toHaveValue(8);

    // The superseded reconciliation read (#2) settles LAST with a snapshot
    // where BOTH questions are still pending. It must not classify the q1
    // outcome (a newer authoritative read owns the projection), must not
    // revert q2 to editable, and must not fabricate a failure verdict.
    await act(async () => {
      queue[0]!.resolve(detail(null, null, "pending_manual"));
    });

    expect(toastErrorMock).toHaveBeenCalledWith(
      "无法确认评分是否已提交，请刷新页面核对。",
    );
    expect(toastErrorMock).not.toHaveBeenCalledWith(
      "评分未提交，请确认网络后重试。",
    );
    // q2 keeps its committed read-only state — the stale snapshot must not
    // unlock it.
    expect(screen.getByTestId("grading-score-input-q2")).toBeDisabled();
    expect(
      screen.queryByTestId("grading-submit-btn-q2"),
    ).not.toBeInTheDocument();
    // q1's draft stays intact and editable for a manual retry.
    expect(screen.getByTestId("grading-score-input-q1")).toBeEnabled();
    expect(screen.getByTestId("grading-score-input-q1")).toHaveValue(8);
    // No automatic re-POST may fire from the ambiguous path.
    expect(postMock).toHaveBeenCalledTimes(2);
  });

  it("a lost POST response whose reconciliation read is CURRENT shows the committed outcome and locks the question (control)", async () => {
    const user = userEvent.setup();
    renderPage();
    await act(async () => {
      queue.shift()!.resolve(detail(null, null, "pending_manual"));
    });
    expect(await screen.findByText(/期末考试 — 张三/)).toBeInTheDocument();

    // q1's POST errors (response lost) but the server committed. The
    // reconciliation read (#2) is the only read in flight → current.
    postMock.mockRejectedValueOnce(new Error("network lost"));
    await submitScore(user, "q1", "8");
    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(2));
    await act(async () => {
      queue[0]!.resolve(detail(entry(8), null, "pending_manual"));
    });

    // Case A: the committed outcome is surfaced neutrally and the question
    // is read-only with the real entry metadata.
    expect(toastSuccessMock).toHaveBeenCalledWith(
      "评分已提交，页面已同步最新状态。",
    );
    expect(screen.getByTestId("grading-score-input-q1")).toBeDisabled();
    expect(
      screen.queryByTestId("grading-submit-btn-q1"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("grading-submitted-meta-q1")).toBeInTheDocument();
    // No failure verdict may be fabricated for a confirmed commit.
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  it("re-entering the attempt performs a fresh authoritative read and renders the committed state", async () => {
    const user = userEvent.setup();
    const first = renderPage();
    // First session: both pending; grade q1.
    await act(async () => {
      queue.shift()!.resolve(detail(null, null, "pending_manual"));
    });
    expect(await screen.findByText(/期末考试 — 张三/)).toBeInTheDocument();
    postMock.mockResolvedValueOnce({
      attemptId: "att-1",
      gradingStatus: "pending_manual",
      questionId: "q1",
      score: 8,
      fullyGraded: false,
    });
    await submitScore(user, "q1", "8");
    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(2));
    await act(async () => {
      queue[0]!.resolve(detail(entry(8), null, "pending_manual"));
    });
    expect(screen.getByTestId("grading-submitted-meta-q1")).toBeInTheDocument();

    // Leave and re-enter the attempt: a fresh mount must re-read the server
    // (the route remounts per :id), not inherit the previous session's local
    // state, and the fresh read re-establishes the committed projection.
    first.unmount();
    renderPage();
    expect(getMock).toHaveBeenCalledTimes(3);
    await act(async () => {
      queue[1]!.resolve(detail(entry(8), null, "pending_manual"));
    });
    expect(await screen.findByText(/期末考试 — 张三/)).toBeInTheDocument();
    expect(screen.getByTestId("grading-score-input-q1")).toBeDisabled();
    expect(screen.getByTestId("grading-submitted-meta-q1")).toBeInTheDocument();
    expect(screen.getByTestId("grading-score-input-q2")).toBeEnabled();
  });
});
