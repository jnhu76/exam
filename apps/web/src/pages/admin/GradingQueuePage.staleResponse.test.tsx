import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { AuthProvider } from "@/contexts/AuthContext";
import { BrandProvider } from "@/components/layout/BrandProvider";
import { GradingQueuePage } from "./GradingQueuePage";
import { permissionsForRole } from "@exam/authz";

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
  setNavigate: () => {},
}));

const getMock = vi.mocked(api.get);

interface QueueItem {
  attemptId: string;
  examId: string;
  examTitle: string;
  candidateId: string;
  candidateName: string;
  submittedAt: string | null;
  gradingStatus: string;
  pendingQuestionCount: number;
}

/** A one-candidate queue snapshot. The candidate name is unique per payload
 * so a cross-response render is unambiguous. */
function queueOf(candidateName: string): {
  items: QueueItem[];
  total: number;
  page: number;
  pageSize: number;
} {
  return {
    items: [
      {
        attemptId: `att-${candidateName}`,
        examId: "exam-1",
        examTitle: "期末考试",
        candidateId: `c-${candidateName}`,
        candidateName,
        submittedAt: "2025-01-15T10:00:00Z",
        gradingStatus: "pending_manual",
        pendingQuestionCount: 2,
      },
    ],
    total: 1,
    page: 1,
    pageSize: 20,
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

/** FIFO of deferred queue reads. Under StrictMode the mount effect fires
 * twice (the same re-entry any future trigger gets for free): the SECOND
 * issued read is the latest one and owns the response, no matter in which
 * order the wire settles them. */
const queue: Array<ReturnType<typeof deferred<ReturnType<typeof queueOf>>>> =
  [];

function renderPage(strict = false) {
  const page = (
    <MemoryRouter initialEntries={["/admin/grading-queue"]}>
      <AuthProvider
        initialUser={{
          id: "admin-1",
          username: "admin",
          name: "Admin",
          role: "Admin",
          organizationId: "org1",
          capabilities: [...permissionsForRole("Admin")],
        }}
      >
        <BrandProvider>
          <Routes>
            <Route path="/admin/grading-queue" element={<GradingQueuePage />} />
          </Routes>
        </BrandProvider>
      </AuthProvider>
    </MemoryRouter>
  );
  return strict ? render(<StrictMode>{page}</StrictMode>) : render(page);
}

describe("GradingQueuePage read ownership (F-10)", () => {
  beforeEach(() => {
    getMock.mockReset();
    queue.length = 0;
    getMock.mockImplementation(() => {
      const d = deferred<ReturnType<typeof queueOf>>();
      queue.push(d);
      return d.promise;
    });
  });

  it("an earlier-issued read settling last must not overwrite the latest read's queue snapshot", async () => {
    renderPage(true);
    // StrictMode double-fire: two concurrent reads for the mount query. The
    // second is the latest-issued one (fresh server knowledge).
    expect(queue.length).toBe(2);

    // The LATEST read settles first: the candidate has left the queue since
    // (their attempt was graded) and a newer candidate appeared.
    await act(async () => {
      queue[1]!.resolve(queueOf("考生新"));
    });
    expect(await screen.findAllByText("考生新")).toHaveLength(2);

    // The EARLIER read settles LAST with an older server snapshot (考生旧
    // still pending, 考生新 absent). Last-settlement must not win: the
    // response is not owned by the current read.
    await act(async () => {
      queue[0]!.resolve(queueOf("考生旧"));
    });

    expect(screen.queryAllByText("考生旧")).toHaveLength(0);
    expect(screen.getAllByText("考生新")).toHaveLength(2);
  });

  it("a superseded read FAILING after the current read succeeded must not flip the queue to its error", async () => {
    renderPage(true);
    expect(queue.length).toBe(2);

    await act(async () => {
      queue[1]!.resolve(queueOf("考生新"));
    });
    expect(await screen.findAllByText("考生新")).toHaveLength(2);

    // The superseded earlier read then FAILS: the failure belongs to a read
    // nobody is waiting for — it must not own the error state.
    await act(async () => {
      queue[0]!.reject(new Error("stale queue read failed"));
    });

    expect(screen.queryByText("加载评分队列失败")).not.toBeInTheDocument();
    expect(screen.getAllByText("考生新")).toHaveLength(2);
  });

  it("the current read failing still surfaces the error with retry (control)", async () => {
    renderPage(false);
    // Single read, no supersession: a real failure must keep surfacing.
    await act(async () => {
      queue[0]!.reject(new Error("boom"));
    });
    expect(await screen.findByText("加载评分队列失败")).toBeInTheDocument();
  });
});
