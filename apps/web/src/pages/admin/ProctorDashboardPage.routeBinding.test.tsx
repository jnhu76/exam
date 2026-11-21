import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { AuthProvider } from "@/contexts/AuthContext";
import { BrandProvider } from "@/components/layout/BrandProvider";
import { DateTimeProvider } from "@/contexts/DateTimeContext";
import { AppRoutes } from "@/App";
import { permissionsForRole } from "@exam/authz";
import type { CandidateStatusResponse, MeResponse } from "@exam/contracts";
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

/** Navigations the PAGE did not author: the exam switch that changes :id
 * in place (same route element, no page-authored navigation). */
function HistoryNav() {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => void navigate(-1)}>
      nav-exam-back
    </button>
  );
}

/**
 * R-WP2-2: the binding under test is AppRoutes' OWN route wiring for
 * /admin/exams/:id/proctor — the same element the production router mounts —
 * not a test-local remount of the page component. A test-local harness that
 * mounts ProctorDashboardPage directly would keep failing after the route is
 * fixed, because it would not exercise the fix layer at all.
 */
function renderAppRoutes() {
  // History: [exam-2, exam-1]; the page mounts on exam-1, Back switches to
  // exam-2 WITHOUT remounting the route element.
  return render(
    <MemoryRouter
      initialEntries={[
        "/admin/exams/exam-2/proctor",
        "/admin/exams/exam-1/proctor",
      ]}
      initialIndex={1}
    >
      <AuthProvider initialUser={adminUser}>
        <BrandProvider>
          <DateTimeProvider>
            <LocationProbe />
            <HistoryNav />
            <AppRoutes />
          </DateTimeProvider>
        </BrandProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("AppRoutes binding for exams/:id/proctor (R-WP2-2)", () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
    queue.length = 0;
    sessionStorage.clear();
    localStorage.clear();
    resetPendingGrantCoordinator();
    // Only status reads join the release queue; DateTimeProvider's
    // /api/admin/settings read (AppRoutes mounts it) must not occupy a queue
    // slot or it would shift the status-read indices.
    getMock.mockImplementation((url: unknown) => {
      if (typeof url === "string" && url.includes("/candidates/status")) {
        const d = deferred<CandidateStatusResponse>();
        queue.push(d);
        return d.promise;
      }
      return Promise.resolve({});
    });
  });

  it("an in-place exam switch must drop the previous exam's interactive cards while the new exam loads", async () => {
    renderAppRoutes();
    // exam-1 loads and renders a live candidate with its actions.
    await act(async () => {
      queue.shift()!.resolve(candidatesOf("考生甲"));
    });
    expect(await screen.findByText("考生甲")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "强制交卷" }),
    ).toBeInTheDocument();

    // External Back switches the routed exam in place; exam-2's read hangs.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "nav-exam-back" }));
    });
    await act(async () => {});
    expect(screen.getByTestId("location-path").textContent).toContain("exam-2");
    expect(statusCalls().at(-1)).toContain("/exams/exam-2/");
    expect(statusCalls()).toHaveLength(2);

    // The URL names exam-2, whose read is still on the wire: the previous
    // exam's projection must not stay interactive under it, and the page must
    // show the fresh mount's loading state instead of exam-1's stale data.
    expect(screen.queryByText("考生甲")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "强制交卷" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();

    // Sanity for the harness itself: once exam-2's read lands, its candidates
    // own the projection and exam-1's data does not come back.
    await act(async () => {
      queue.shift()!.resolve(candidatesOf("考生乙"));
    });
    expect(await screen.findByText("考生乙")).toBeInTheDocument();
    expect(screen.queryByText("考生甲")).not.toBeInTheDocument();
  });

  it("the previous exam's late status response must not render after the route switched", async () => {
    renderAppRoutes();
    expect(statusCalls().at(-1)).toContain("/exams/exam-1/");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "nav-exam-back" }));
    });
    await act(async () => {});
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

  it("a persisted pending force-submit command survives the keyed remount and retries with its frozen identity", async () => {
    const operationId = "11111111-1111-4111-8111-111111111111";
    sessionStorage.setItem(
      "exam.pendingForceSubmit:org-1:admin-1",
      JSON.stringify({
        schemaVersion: 2,
        organizationId: "org-1",
        actorId: "admin-1",
        command: {
          attemptId: "att-persisted",
          operationId,
          reason: "管理员强制交卷",
          examId: "exam-1",
          candidateName: "考生甲",
        },
        createdAt: Date.now(),
      }),
    );
    postMock.mockResolvedValue({ outcome: "applied" });

    renderAppRoutes();
    // exam-1 mounts and its status read lands: the page hydrates the pending
    // command from sessionStorage and offers the retry (command targets THIS
    // exam).
    await act(async () => {
      queue.shift()!.resolve(candidatesOf("考生甲"));
    });
    expect(
      await screen.findByTestId("pending-force-submit-banner"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "重试未确认强制交卷" }),
    ).toBeInTheDocument();

    // Switch to exam-2: the route remounts the page; the command's exam scope
    // no longer matches, so the banner identifies the owning exam instead of
    // offering the destructive retry.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "nav-exam-back" }));
    });
    await act(async () => {
      queue.shift()!.resolve(candidatesOf("考生乙"));
    });
    expect(
      await screen.findByTestId("pending-force-submit-banner"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "重试未确认强制交卷" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "返回原考试页面" }),
    ).toBeInTheDocument();

    // Navigate back to the owning exam: the remounted page re-hydrates the
    // SAME frozen command and offers the retry again.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "返回原考试页面" }));
    });
    await act(async () => {
      queue.shift()!.resolve(candidatesOf("考生甲"));
    });
    expect(
      await screen.findByTestId("pending-force-submit-banner"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("location-path").textContent).toContain("exam-1");

    // The retry replays the frozen identity verbatim: same operationId, same
    // target attempt — never a freshly minted command under the remounted page.
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "重试未确认强制交卷" }),
      );
    });
    expect(postMock).toHaveBeenCalledTimes(1);
    const [postUrl, postBody] = postMock.mock.calls[0]!;
    expect(postUrl).toBe("/api/admin/attempts/att-persisted/force-submit");
    expect(postBody as Record<string, unknown>).toMatchObject({
      operationId,
      reason: "管理员强制交卷",
    });
    // A confirmed outcome clears the durable slot.
    expect(
      sessionStorage.getItem("exam.pendingForceSubmit:org-1:admin-1"),
    ).toBeNull();
  });
});
