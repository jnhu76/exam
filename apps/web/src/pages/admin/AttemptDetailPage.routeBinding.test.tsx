import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "@/contexts/AuthContext";
import { BrandProvider } from "@/components/layout/BrandProvider";
import { DateTimeProvider } from "@/contexts/DateTimeContext";
import { AppRoutes } from "@/App";
import { permissionsForRole } from "@exam/authz";
import type { AssignableRole } from "@exam/contracts";

const { apiGet, apiPost } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
}));

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
    get: (...args: unknown[]) => apiGet(...args),
    post: (...args: unknown[]) => apiPost(...args),
  },
  setNavigate: () => {},
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const adminUser = {
  id: "admin-1",
  username: "admin",
  name: "Admin",
  role: "Admin" as AssignableRole,
  organizationId: "org-1",
  capabilities: [...permissionsForRole("Admin")] as string[],
};

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/**
 * Held reads keyed by the attempt id the URL names: the response can then be
 * released in an order different from the request START order. A read whose
 * key has no entry resolves immediately.
 */
class HeldReads<T> {
  #map = new Map<string, { promise: Promise<T> }>();

  hold(attemptId: string) {
    const d = deferred<T>();
    this.#map.set(attemptId, d);
    return d;
  }

  take(attemptId: string): { promise: Promise<T> } | undefined {
    const box = this.#map.get(attemptId);
    this.#map.delete(attemptId);
    return box;
  }
}

function gradedResult(attemptId: string, examTitle: string) {
  return {
    attemptId,
    status: "graded" as const,
    showResultImmediately: true as const,
    examTitle,
    passingScore: 60,
    totalScore: 100,
    passed: true,
    gradedAt: new Date().toISOString(),
    questionResults: [
      {
        questionId: "q1",
        score: 10,
        maxScore: 10,
        correct: true,
        candidateAnswer: "A",
        standardAnswer: "A",
        type: "single_choice",
        content: `Question of ${examTitle}`,
        order: 1,
      },
    ],
  };
}

function timelineEventsOf(...actions: string[]) {
  return {
    events: actions.map((action, i) => ({
      id: `ev-${action}`,
      organizationId: "org-1",
      actorId: "admin-1",
      action,
      targetType: "attempt",
      targetId: "attempt-1",
      metadata: {},
      ipAddress: null,
      userAgent: null,
      createdAt: `2026-06-23T08:0${i}:00.000Z`,
    })),
  };
}

function attemptIdOf(url: string): string | null {
  const m = url.match(/\/api\/admin\/attempts\/([^/]+)\//);
  return m ? m[1]! : null;
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-path">{location.pathname}</div>;
}

/** Navigation the PAGE did not author: the attempt switch that changes :id
 * in place (same route element, no page-authored navigation). */
function HistoryNav() {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => void navigate(-1)}>
      nav-attempt-back
    </button>
  );
}

/**
 * R-WP2-2: the binding under test is AppRoutes' OWN route wiring for
 * /admin/attempts/:id — the same element the production router mounts — not a
 * test-local remount of the page component (a local harness would keep
 * failing after the route is fixed, exercising nothing of the fix layer).
 */
function renderAppRoutes() {
  // History: [attempt-2, attempt-1]; the page mounts on attempt-1, Back
  // switches to attempt-2 WITHOUT remounting the route element.
  return render(
    <MemoryRouter
      initialEntries={[
        "/admin/attempts/attempt-2",
        "/admin/attempts/attempt-1",
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

function installApiMock(options: {
  resultReads: HeldReads<unknown>;
  timelineReads: HeldReads<unknown>;
  immediateResult: (attemptId: string) => unknown;
}) {
  apiGet.mockImplementation((url: string) => {
    const attemptId = attemptIdOf(url);
    if (!attemptId) return Promise.reject(new Error(`unexpected GET ${url}`));
    if (url.includes("/proctor-events")) {
      return Promise.resolve({
        items: [],
        total: 0,
        page: 1,
        pageSize: 50,
        totalPages: 1,
      });
    }
    if (url.includes("/answer-save-receipt-summary")) {
      return Promise.resolve({
        count: 0,
        maxClientSeq: null,
        lastSavedAt: null,
      });
    }
    if (url.includes("/timeline")) {
      const box = options.timelineReads.take(attemptId);
      return box ? box.promise : Promise.resolve(timelineEventsOf());
    }
    if (url.endsWith(`/attempts/${attemptId}/result`)) {
      const box = options.resultReads.take(attemptId);
      return box
        ? box.promise
        : Promise.resolve(options.immediateResult(attemptId));
    }
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
}

describe("AppRoutes binding for attempts/:id (R-WP2-2)", () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPost.mockReset();
    sessionStorage.clear();
    localStorage.clear();
  });

  it("the previous attempt's late result response must not overwrite the newly routed attempt's projection", async () => {
    const resultReads = new HeldReads<unknown>();
    const timelineReads = new HeldReads<unknown>();
    installApiMock({
      resultReads,
      timelineReads,
      immediateResult: (attemptId) =>
        gradedResult(
          attemptId,
          attemptId === "attempt-2" ? "考试乙" : "考试甲",
        ),
    });
    // attempt-1's and attempt-2's result reads are both held on the wire, so
    // attempt-2 can land FIRST and attempt-1 can arrive LATE.
    const attempt1Result = resultReads.hold("attempt-1");
    const attempt2Result = resultReads.hold("attempt-2");

    renderAppRoutes();
    // Switch the route to attempt-2 in place while both reads are pending.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "nav-attempt-back" }));
    });
    await act(async () => {});
    expect(screen.getByTestId("location-path").textContent).toContain(
      "attempt-2",
    );

    // The CURRENT attempt's result lands first and owns the projection.
    await act(async () => {
      attempt2Result.resolve(gradedResult("attempt-2", "考试乙"));
    });
    expect(
      await screen.findByRole("heading", { name: /考试乙/ }),
    ).toBeInTheDocument();

    // The SUPERSEDED attempt-1 result settles LAST: it must not replace the
    // attempt-2 page the URL now names.
    await act(async () => {
      attempt1Result.resolve(gradedResult("attempt-1", "考试甲"));
    });

    expect(screen.getByRole("heading", { name: /考试乙/ })).toBeInTheDocument();
    expect(screen.queryByText(/考试甲/)).not.toBeInTheDocument();
  });

  it("the previous attempt's late timeline response must not overwrite the newly routed attempt's timeline", async () => {
    const resultReads = new HeldReads<unknown>();
    const timelineReads = new HeldReads<unknown>();
    installApiMock({
      resultReads,
      timelineReads,
      immediateResult: (attemptId) =>
        gradedResult(
          attemptId,
          attemptId === "attempt-2" ? "考试乙" : "考试甲",
        ),
    });
    const attempt1Timeline = timelineReads.hold("attempt-1");
    const attempt2Timeline = timelineReads.hold("attempt-2");

    renderAppRoutes();
    // attempt-1's result lands immediately; its timeline stays pending.
    expect(await screen.findByRole("heading", { name: /考试甲/ }));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "nav-attempt-back" }));
    });
    await act(async () => {});
    expect(screen.getByTestId("location-path").textContent).toContain(
      "attempt-2",
    );
    expect(await screen.findByRole("heading", { name: /考试乙/ }));

    // The CURRENT attempt's timeline lands first and owns the section.
    await act(async () => {
      attempt2Timeline.resolve(timelineEventsOf("fresh_marker_b"));
    });
    expect(await screen.findByText("fresh_marker_b")).toBeInTheDocument();

    // The SUPERSEDED attempt-1 timeline settles LAST: it must not replace the
    // attempt-2 timeline the URL now names.
    await act(async () => {
      attempt1Timeline.resolve(timelineEventsOf("stale_marker_a"));
    });

    expect(screen.getByText("fresh_marker_b")).toBeInTheDocument();
    expect(screen.queryByText("stale_marker_a")).not.toBeInTheDocument();
  });
});
