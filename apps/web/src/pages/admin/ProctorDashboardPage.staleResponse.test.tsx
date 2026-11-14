import { act, fireEvent, render, screen } from "@testing-library/react";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { AuthProvider } from "@/contexts/AuthContext";
import { permissionsForRole } from "@exam/authz";
import type { CandidateStatusResponse, MeResponse } from "@exam/contracts";
import { ProctorDashboardPage } from "./ProctorDashboardPage";
import { resetPendingGrantCoordinator } from "@/features/operator-grant/pendingGrantCoordinatorSingleton";

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
  toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const getMock = vi.mocked(api.get);
const postMock = vi.mocked(api.post);

const adminUser: MeResponse = {
  id: "admin-1",
  username: "admin",
  name: "Admin",
  role: "Admin",
  organizationId: "org-1",
  capabilities: [...permissionsForRole("Admin")] as string[],
};

function candidatesOf(name: string): CandidateStatusResponse {
  return {
    candidates: [
      {
        candidateId: `cand-${name}`,
        name,
        attemptId: `att-${name}`,
        status: "in_progress",
        deadlineAt: null,
        lastActivityAt: null,
        misconduct: null,
      },
    ],
    total: 1,
  } as CandidateStatusResponse;
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

/** FIFO of deferred status reads, in wire-release order (independent of the
 * request START order). */
const queue: Array<ReturnType<typeof deferred<CandidateStatusResponse>>> = [];

const statusCalls = () =>
  getMock.mock.calls
    .map((c) => String(c[0]))
    .filter((u) => u.includes("/candidates/status"));

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-path">{location.pathname}</div>;
}

/** Navigations the PAGE did not author: the exam switch that supersedes an
 * in-flight status read. */
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

function renderPage(strict = false) {
  // History: [exam-2, exam-1]; the page mounts on exam-1, Back switches to
  // exam-2 WITHOUT remounting the page element.
  const page = (
    <MemoryRouter
      initialEntries={[
        "/admin/exams/exam-2/proctor",
        "/admin/exams/exam-1/proctor",
      ]}
      initialIndex={1}
    >
      <AuthProvider initialUser={adminUser}>
        <Routes>
          <Route
            path="/admin/exams/:id/proctor"
            element={<ProctorDashboardPage />}
          />
        </Routes>
        <LocationProbe />
        <HistoryNav />
      </AuthProvider>
    </MemoryRouter>
  );
  return strict ? render(<StrictMode>{page}</StrictMode>) : render(page);
}

describe("ProctorDashboardPage status-read ownership (R7)", () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
    queue.length = 0;
    sessionStorage.clear();
    localStorage.clear();
    resetPendingGrantCoordinator();
    getMock.mockImplementation(() => {
      const d = deferred<CandidateStatusResponse>();
      queue.push(d);
      return d.promise;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("a superseded exam's status response landing last must not render under the newly routed exam", async () => {
    renderPage();
    // exam-1's initial read is held; switch to exam-2 (external Back) while
    // it is on the wire.
    expect(statusCalls().at(-1)).toContain("/exams/exam-1/");

    await act(async () => {
      screen.getByRole("button", { name: "后退" }).click();
    });
    await act(async () => {});
    expect(screen.getByTestId("location-path").textContent).toContain("exam-2");
    expect(statusCalls().at(-1)).toContain("/exams/exam-2/");
    expect(statusCalls()).toHaveLength(2);

    // The CURRENT read (exam-2) settles first: its candidates render.
    await act(async () => {
      queue[1]!.resolve(candidatesOf("考生乙"));
    });
    expect(await screen.findByText("考生乙")).toBeInTheDocument();

    // The SUPERSEDED exam-1 read settles LAST: its candidates belong to an
    // exam the URL no longer names.
    await act(async () => {
      queue[0]!.resolve(candidatesOf("考生甲"));
    });

    expect(screen.queryByText("考生甲")).not.toBeInTheDocument();
    expect(screen.getByText("考生乙")).toBeInTheDocument();
  });

  it("a superseded exam's read FAILING after the current exam loaded must not flip the page to its error", async () => {
    renderPage();
    await act(async () => {
      screen.getByRole("button", { name: "后退" }).click();
    });
    await act(async () => {});
    expect(statusCalls()).toHaveLength(2);

    await act(async () => {
      queue[1]!.resolve(candidatesOf("考生乙"));
    });
    expect(await screen.findByText("考生乙")).toBeInTheDocument();

    await act(async () => {
      queue[0]!.reject(new Error("stale exam read failed"));
    });

    expect(screen.queryByText("加载监考数据失败")).not.toBeInTheDocument();
    expect(screen.getByText("考生乙")).toBeInTheDocument();
  });

  it("a poll tick must not stack onto an in-flight read, and the slow read still refreshes when it lands", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    renderPage();
    // Initial read held on the wire (slow server).
    expect(statusCalls()).toHaveLength(1);

    // One 5s poll tick while the initial read is in flight: the tick must be
    // SKIPPED (no overlapping request), not stacked.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(statusCalls()).toHaveLength(1);

    // The slow read is still the current one: when it finally lands it owns
    // the projection — a slow response must not freeze the dashboard forever.
    await act(async () => {
      queue[0]!.resolve(candidatesOf("考生慢"));
    });
    expect(screen.getByText("考生慢")).toBeInTheDocument();

    // With no read in flight, the next tick fires a fresh poll again.
    getMock.mockResolvedValueOnce(candidatesOf("考生快"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText("考生快")).toBeInTheDocument();
  });

  it("the manual refresh button keeps forcing an immediate read even while a poll read is in flight", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    renderPage();
    // Initial read resolves immediately: dashboard is live. (Sync queries:
    // waitFor/findByText spin on fake timers.)
    await act(async () => {
      queue.shift()!.resolve(candidatesOf("考生初"));
    });
    expect(screen.getByText("考生初")).toBeInTheDocument();

    // A poll read goes out and hangs.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(statusCalls()).toHaveLength(2);

    // Manual refresh: supersedes the hanging poll read.
    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(statusCalls()).toHaveLength(3);

    // The forced read lands and its data owns the projection.
    await act(async () => {
      queue[1]!.resolve(candidatesOf("考生刷"));
    });
    expect(screen.getByText("考生刷")).toBeInTheDocument();
    // The superseded poll read landing later must not overwrite it.
    await act(async () => {
      queue[0]!.resolve(candidatesOf("考生轮"));
    });
    expect(screen.queryByText("考生轮")).not.toBeInTheDocument();
    expect(screen.getByText("考生刷")).toBeInTheDocument();
  });

  it("a command continuation from the previous exam must not start a forced read after the route switched", async () => {
    renderPage();
    // exam-1's status loads with a live candidate.
    await act(async () => {
      queue.shift()!.resolve(candidatesOf("考生甲"));
    });
    expect(await screen.findByText("考生甲")).toBeInTheDocument();

    // Start an exam-1 force-submit command; its POST stays on the wire.
    const command = deferred<unknown>();
    postMock.mockImplementation(() => command.promise);
    fireEvent.click(screen.getByRole("button", { name: "强制交卷" }));
    await screen.findByRole("heading", { name: "确认强制交卷" });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "确认强制交卷" }));
    });
    expect(postMock).toHaveBeenCalledTimes(1);

    // Switch to exam-2 while the command is still in flight; its status read
    // resolves and owns the projection.
    await act(async () => {
      screen.getByRole("button", { name: "后退" }).click();
    });
    await act(async () => {});
    expect(statusCalls().at(-1)).toContain("/exams/exam-2/");
    await act(async () => {
      queue[0]!.resolve(candidatesOf("考生乙"));
    });
    expect(await screen.findByText("考生乙")).toBeInTheDocument();
    const readsBeforeCommandSettles = statusCalls().length;
    expect(readsBeforeCommandSettles).toBe(2);

    // The old command's continuation now runs with the exam-1 closure. It must
    // NOT issue an exam-1 read: that read would become the newest generation
    // and commit the previous exam's candidates under the exam-2 route.
    await act(async () => {
      command.resolve({ disposition: "applied" });
      await Promise.resolve();
    });

    expect(statusCalls()).toHaveLength(readsBeforeCommandSettles);
    expect(statusCalls().at(-1)).toContain("/exams/exam-2/");
    expect(screen.getByText("考生乙")).toBeInTheDocument();
    expect(screen.queryByText("考生甲")).not.toBeInTheDocument();
    expect(screen.queryByText("加载监考数据失败")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
