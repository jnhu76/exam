import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { AuthProvider } from "@/contexts/AuthContext";
import { BrandProvider } from "@/components/layout/BrandProvider";
import { ScoreListPage } from "./ScoreListPage";
import { permissionsForRole } from "@exam/authz";

vi.mock("@/lib/api", () => ({
  ApiError: class ApiError extends Error {
    readonly status: number;
    constructor(status: number, message: string) {
      super(message);
      this.name = "ApiError";
      this.status = status;
    }
  },
  api: { get: vi.fn() },
  setNavigate: () => {},
}));

const getMock = vi.mocked(api.get);

interface ScoreRow {
  attemptId: string;
  candidateId: string;
  candidateName: string;
  candidateFields: Record<string, unknown>;
  examId: string;
  examTitle: string;
  score: number;
  passed: boolean;
  attemptNo: number;
  submittedAt?: string;
}
interface ScoreResponse {
  items: ScoreRow[];
  stats: {
    averageScore: number;
    maxScore: number;
    minScore: number;
    passRate: number;
    totalGraded: number;
  };
  total: number;
  page: number;
  pageSize: number;
}

function row(name: string, passed: boolean, n: number): ScoreRow {
  return {
    attemptId: `att-${name}`,
    candidateId: `c-${name}`,
    candidateName: name,
    candidateFields: {},
    examId: "exam-1",
    examTitle: "期末考试",
    score: passed ? 90 : 40,
    passed,
    attemptNo: n,
    submittedAt: "2026-01-01T00:00:00Z",
  };
}

function payload(
  items: ScoreRow[],
  page: number,
  total: number,
): ScoreResponse {
  return {
    items,
    stats: {
      averageScore: 60,
      maxScore: 100,
      minScore: 10,
      passRate: items.length ? (items[0]!.passed ? 1 : 0) : 0,
      totalGraded: total,
    },
    total,
    page,
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

/** FIFO of deferred responses: each scores request holds until the test
 * releases it, pinning the COMPLETION order independently of the START
 * order — the exact freedom a superseding navigation has on the wire. */
const queue: Array<ReturnType<typeof deferred<ScoreResponse>>> = [];
const scoreCalls = () =>
  getMock.mock.calls
    .map((c) => String(c[0]))
    .filter((u) => u.includes("/scores?"));

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-search">{location.search}</div>;
}

/** A navigation the PAGE did not author (the browser Back button), available
 * while the page is in its full-page loading state — its own controls are
 * unmounted then, so an external navigation is the one reachable way a
 * second request can start while the first is in flight. */
function HistoryNav() {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => void navigate(-1)}>
      后退
    </button>
  );
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/admin/exams/exam-1/scores"]}>
      <AuthProvider
        initialUser={{
          id: "1",
          username: "admin",
          name: "Admin",
          role: "Admin",
          organizationId: "org1",
          capabilities: [...permissionsForRole("Admin")],
        }}
      >
        <BrandProvider>
          <Routes>
            <Route path="/admin/exams/:id/scores" element={<ScoreListPage />} />
          </Routes>
          <LocationProbe />
          <HistoryNav />
        </BrandProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

/**
 * Stale-response ownership (#958): the scores query is URL-driven (page,
 * passFilter, exam id), and a navigation the page did not author (Back /
 * Forward, a link) can start a NEW request while the previous one is still
 * on the wire. Whichever response settles LAST used to win `setScores` /
 * `setError` / `setIsLoading`, regardless of which query is current — the
 * table, the stats, and the error state could all describe a query the URL
 * no longer names. The settlement boundary must attribute each response to
 * the request that is still current.
 *
 * Every assertion binds the three facts at once: the URL, the request that
 * was issued, and what the user can see.
 */
describe("ScoreListPage stale-response ownership", () => {
  beforeEach(() => {
    getMock.mockReset();
    queue.length = 0;
    getMock.mockImplementation(() => {
      const d = deferred<ScoreResponse>();
      queue.push(d);
      return d.promise;
    });
  });

  it("a superseded passFilter response landing last must not overwrite the current query's rows", async () => {
    renderPage();
    // Initial load (all, page 1) — release immediately.
    await act(async () => {
      queue.shift()!.resolve(payload([row("初始考生", true, 1)], 1, 1));
    });
    await waitFor(() =>
      expect(
        within(screen.getByRole("table")).getByText("初始考生"),
      ).toBeInTheDocument(),
    );

    const user = userEvent.setup();
    // Request A: passFilter=passed — held on the wire. The page is now in its
    // full-page loading state; its own controls are unmounted, so the
    // superseding navigation must come from outside the page.
    await user.click(screen.getByRole("tab", { name: "及格" }));
    expect(scoreCalls().at(-1)).toContain("passFilter=passed");

    // Request B: Back to the bare entry (passFilter=all) — held; A is still
    // in flight, so two requests are on the wire at once.
    await act(async () => {
      screen.getByRole("button", { name: "后退" }).click();
    });
    await act(async () => {});
    expect(scoreCalls().at(-1)).toContain("passFilter=all");
    expect(scoreCalls().length).toBe(3);

    // The CURRENT request (B) settles first; the page shows its rows.
    await act(async () => {
      queue[1]!.resolve(payload([row("当前全部考生乙", false, 1)], 1, 1));
    });
    await waitFor(() =>
      expect(
        within(screen.getByRole("table")).getByText("当前全部考生乙"),
      ).toBeInTheDocument(),
    );
    expect(screen.getByTestId("location-search").textContent).not.toContain(
      "passFilter",
    );

    // The SUPERSEDED request (A) settles last. Its rows must be discarded:
    // the URL names the all-filter, so the table must keep describing it.
    await act(async () => {
      queue[0]!.resolve(payload([row("迟到及格考生甲", true, 1)], 1, 1));
    });

    const table = screen.getByRole("table");
    expect(within(table).queryByText("迟到及格考生甲")).not.toBeInTheDocument();
    expect(within(table).getByText("当前全部考生乙")).toBeInTheDocument();
  });

  it("a superseded request FAILING after the current one succeeded must not flip the page to ErrorState", async () => {
    renderPage();
    await act(async () => {
      queue.shift()!.resolve(payload([row("初始考生", true, 1)], 1, 1));
    });
    await waitFor(() =>
      expect(
        within(screen.getByRole("table")).getByText("初始考生"),
      ).toBeInTheDocument(),
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "及格" })); // A held
    await act(async () => {
      screen.getByRole("button", { name: "后退" }).click(); // B (current) held
    });
    await act(async () => {});
    expect(scoreCalls().length).toBe(3);

    await act(async () => {
      queue[1]!.resolve(payload([row("当前全部考生乙", false, 1)], 1, 1));
    });
    await waitFor(() =>
      expect(
        within(screen.getByRole("table")).getByText("当前全部考生乙"),
      ).toBeInTheDocument(),
    );

    // The superseded request now FAILS. The current query succeeded, so the
    // error belongs to a request nobody is waiting for — it must not own the
    // page.
    await act(async () => {
      queue[0]!.reject(new Error("stale request failed"));
    });

    expect(screen.queryByText(/重试/)).not.toBeInTheDocument();
    expect(
      within(screen.getByRole("table")).getByText("当前全部考生乙"),
    ).toBeInTheDocument();
  });

  it("a superseded request settling FIRST must not end the CURRENT request's loading window", async () => {
    renderPage();
    await act(async () => {
      queue.shift()!.resolve(payload([row("初始考生", true, 1)], 1, 1));
    });
    await waitFor(() =>
      expect(
        within(screen.getByRole("table")).getByText("初始考生"),
      ).toBeInTheDocument(),
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "及格" })); // A held
    await act(async () => {
      screen.getByRole("button", { name: "后退" }).click(); // B (current) held
    });
    expect(scoreCalls().length).toBe(3);

    // The SUPERSEDED request A settles while the current request B is still
    // on the wire. Its `finally` must not end B's loading window: the page
    // would drop LoadingState and flash the PREVIOUS query's rows under a
    // URL that names neither.
    await act(async () => {
      queue[0]!.resolve(payload([row("迟到及格考生甲", true, 1)], 1, 1));
    });

    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByText("迟到及格考生甲")).not.toBeInTheDocument();

    // The current request still completes normally afterwards.
    await act(async () => {
      queue[1]!.resolve(payload([row("当前全部考生乙", false, 1)], 1, 1));
    });
    await waitFor(() =>
      expect(
        within(screen.getByRole("table")).getByText("当前全部考生乙"),
      ).toBeInTheDocument(),
    );
  });

  it("a superseded page-2 response landing after Back to page 1 must not overwrite the restored page", async () => {
    renderPage();
    await act(async () => {
      queue.shift()!.resolve(payload([row("第1页考生", true, 1)], 1, 45));
    });
    await waitFor(() =>
      expect(
        within(screen.getByRole("table")).getByText("第1页考生"),
      ).toBeInTheDocument(),
    );

    const user = userEvent.setup();
    // Page 2 (push) — held on the wire.
    await user.click(screen.getByRole("button", { name: "下一页" }));
    expect(scoreCalls().at(-1)).toContain("page=2");

    // Back to page 1 — held; the page-2 request is still in flight.
    await act(async () => {
      screen.getByRole("button", { name: "后退" }).click();
    });
    await act(async () => {});
    expect(scoreCalls().at(-1)).toContain("page=1");

    // The CURRENT request (page 1) settles first.
    await act(async () => {
      queue[1]!.resolve(payload([row("返回后第1页", true, 1)], 1, 45));
    });
    await waitFor(() =>
      expect(
        within(screen.getByRole("table")).getByText("返回后第1页"),
      ).toBeInTheDocument(),
    );

    // The superseded page-2 response lands last.
    await act(async () => {
      queue[0]!.resolve(payload([row("迟到的第2页", false, 2)], 2, 45));
    });

    expect(screen.getByTestId("location-search").textContent).not.toContain(
      "page=2",
    );
    const table = screen.getByRole("table");
    expect(within(table).queryByText("迟到的第2页")).not.toBeInTheDocument();
    expect(within(table).getByText("返回后第1页")).toBeInTheDocument();
  });

  it("a failing CURRENT request still owns the error state (the ownership cut must not swallow real errors)", async () => {
    renderPage();
    // Initial load succeeds so the controls exist.
    await act(async () => {
      queue.shift()!.resolve(payload([row("初始考生", true, 1)], 1, 1));
    });
    await waitFor(() =>
      expect(
        within(screen.getByRole("table")).getByText("初始考生"),
      ).toBeInTheDocument(),
    );

    // The CURRENT request (and the only one in flight) fails: the error must
    // surface with a retry affordance.
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "及格" }));
    await act(async () => {
      queue[0]!.reject(new Error("current request failed"));
    });
    await waitFor(() => expect(screen.getByText(/重试/)).toBeInTheDocument());
  });
});
