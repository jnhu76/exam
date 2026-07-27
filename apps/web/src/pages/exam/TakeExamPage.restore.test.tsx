import {
  render,
  screen,
  waitFor,
  within,
  act,
  fireEvent,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "@/contexts/AuthContext";
import { BrandProvider } from "@/components/layout/BrandProvider";
import { TakeExamPage } from "./TakeExamPage";
import { ApiError } from "@/lib/api";
import { permissionsForRole } from "@exam/authz";
import type { CandidateTakeSnapshot } from "@exam/contracts";

/**
 * REC-I3 — Disrupted-attempt direct restore UX.
 *
 * ADR-012 §Recovery Semantics (Disrupted attempt):
 *   - restore must be an EXPLICIT command (POST /api/attempts/:attemptId/restore)
 *   - GET /candidate/attempts/:attemptId/take is the authoritative snapshot
 *   - capability fields (canResume) govern the restore action, not raw status
 *   - after restore, the snapshot MUST be re-read — the POST ack is NOT authority
 *
 * These tests assert the user-visible behavior and the API calls made; they
 * do NOT assert implementation details (refs/state). Mocks intercept only the
 * take endpoint and the restore endpoint; all other paths fall through to a
 * defensive default. Deterministic deferred promises are used where needed
 * so no arbitrary sleeps are required.
 */

const NOW = "2026-07-04T10:00:00.000Z";
const DEADLINE = "2026-07-04T11:00:00.000Z";

function buildSnapshot(
  overrides: Partial<CandidateTakeSnapshot> = {},
): CandidateTakeSnapshot {
  return {
    attemptId: "att-1",
    examId: "exam-1",
    attemptStatus: "in_progress",
    gradingStatus: "auto_graded",
    isEditable: true,
    canStart: false,
    canResume: false,
    canSave: true,
    canSubmit: true,
    resultVisibility: "hidden",
    answerVisibility: "hidden",
    submittedAt: null,
    serverNow: NOW,
    effectiveDeadline: DEADLINE,
    serverRevision: NOW,
    questions: [
      {
        id: "q1",
        type: "single_choice",
        prompt: "选择一项",
        options: [
          { id: "opt-a", content: "A" },
          { id: "opt-b", content: "B" },
        ],
        inputMode: "choice",
        maxScore: 10,
        answerValue: null,
        answerSource: "none",
      },
    ],
    ...overrides,
  };
}

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
    constructor(
      status: number,
      message: string,
      code?: string,
      details?: unknown,
      requestId?: string,
    ) {
      super(message);
      this.status = status;
      this.code = code;
      this.details = details;
      this.requestId = requestId;
      this.name = "ApiError";
    }
  },
  setNavigate: () => {},
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="current-path">{location.pathname}</span>;
}

/**
 * Renders the page and exposes the router's navigate() to the test via the
 * returned object. Used by the route-change test to perform a REAL in-router
 * navigation (not a mock flip), exercising the page's attemptId-change path.
 */
function NavigateProbe({
  register,
}: {
  register: (nav: (to: string) => void) => void;
}) {
  register(useNavigate());
  return null;
}

function renderPage(attemptId = "att-1", opts: { strictMode?: boolean } = {}) {
  const navigateRef: { current: ((to: string) => void) | null } = {
    current: null,
  };
  const tree = (
    <MemoryRouter initialEntries={[`/exam/exam-1/take/${attemptId}`]}>
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
          {/* Probe is a sibling of Routes so it is always mounted inside the
              router and can hand navigate() back to the test. */}
          <NavigateProbe register={(n) => (navigateRef.current = n)} />
          <Routes>
            <Route
              path="/exam/:examId/take/:attemptId"
              element={<TakeExamPage />}
            />
            <Route path="/exam/list" element={<LocationProbe />} />
            <Route path="/exam/:attemptId/result" element={<LocationProbe />} />
          </Routes>
        </BrandProvider>
      </AuthProvider>
    </MemoryRouter>
  );
  const utils = opts.strictMode
    ? render(<StrictMode>{tree}</StrictMode>)
    : render(tree);
  return {
    ...utils,
    navigate: (to: string) => {
      if (!navigateRef.current) {
        throw new Error("navigate not registered (probe did not mount)");
      }
      navigateRef.current(to);
    },
  };
}

/** Routes GETs: take endpoint → snapshot. Other GETs throw. */
function routeTakeOnly(snapshot: CandidateTakeSnapshot) {
  apiGet.mockImplementation(async (path: string) => {
    if (typeof path === "string" && path.includes("/candidate/attempts/")) {
      return snapshot;
    }
    throw new Error(`unexpected GET ${path}`);
  });
}

/**
 * Snapshots served sequentially. The first take call returns sequence[0],
 * the second returns sequence[1], etc. Used to simulate a snapshot that
 * changes after restore (e.g. disrupted → in_progress, or disrupted →
 * submitted when deadline wins).
 */
function routeTakeSequence(...snapshots: CandidateTakeSnapshot[]) {
  if (snapshots.length === 0) throw new Error("need at least one snapshot");
  let index = 0;
  apiGet.mockImplementation(async (path: string) => {
    if (typeof path === "string" && path.includes("/candidate/attempts/")) {
      const snapshot = snapshots[Math.min(index, snapshots.length - 1)];
      index += 1;
      return snapshot;
    }
    throw new Error(`unexpected GET ${path}`);
  });
}

function postRestoreOk() {
  apiPost.mockImplementation(async (path: string) => {
    if (typeof path === "string" && path.endsWith("/restore")) {
      return { id: "att-1", status: "in_progress" };
    }
    if (typeof path === "string" && path.includes("/heartbeat")) {
      return { ok: true, serverNow: NOW };
    }
    throw new Error(`unexpected POST ${path}`);
  });
}

beforeEach(() => {
  apiGet.mockReset();
  apiPost.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("REC-I3 — disrupted direct restore", () => {
  it("Case 1: disrupted + canResume deep link invokes explicit restore once and reloads snapshot", async () => {
    const disrupted = buildSnapshot({
      attemptStatus: "disrupted",
      isEditable: false,
      canResume: true,
      canSave: false,
      canSubmit: false,
      lockReason: "disrupted",
    });
    const restored = buildSnapshot();
    routeTakeSequence(disrupted, restored);
    postRestoreOk();

    renderPage();

    // Restore is invoked exactly once.
    await waitFor(
      () => {
        const restores = apiPost.mock.calls.filter(
          ([p]) => typeof p === "string" && (p as string).endsWith("/restore"),
        );
        expect(restores).toHaveLength(1);
      },
      { timeout: 4000 },
    );

    // The take endpoint is called at least twice (initial load + post-restore
    // reload). The reload — NOT the restore response — is the page authority.
    await waitFor(() => {
      const takeCalls = apiGet.mock.calls.filter(
        ([p]) =>
          typeof p === "string" &&
          (p as string).includes("/candidate/attempts/"),
      );
      expect(takeCalls.length).toBeGreaterThanOrEqual(2);
    });

    // The restored, editable exam renders. The question control is enabled.
    expect(await screen.findByRole("radio", { name: "A" })).not.toBeDisabled();
  });

  it("Case 2: ordinary in-progress attempt does NOT call restore", async () => {
    routeTakeOnly(buildSnapshot());
    postRestoreOk();

    renderPage();
    await screen.findByText("选择一项");

    // No restore POST may be issued for an ordinary editable attempt.
    await waitFor(
      () => {
        const restores = apiPost.mock.calls.filter(
          ([p]) => typeof p === "string" && (p as string).endsWith("/restore"),
        );
        expect(restores).toHaveLength(0);
      },
      { timeout: 1500 },
    );
  });

  it("Case 3: terminal submitted attempt does NOT call restore", async () => {
    const submitted = buildSnapshot({
      attemptStatus: "submitted",
      isEditable: false,
      canResume: false,
      canSave: false,
      canSubmit: false,
      lockReason: "submitted",
      submittedAt: NOW,
    });
    routeTakeOnly(submitted);
    postRestoreOk();

    renderPage();
    // Wait for the page to settle.
    expect((await screen.findAllByRole("radio"))[0]).toBeDisabled();

    await waitFor(
      () => {
        const restores = apiPost.mock.calls.filter(
          ([p]) => typeof p === "string" && (p as string).endsWith("/restore"),
        );
        expect(restores).toHaveLength(0);
      },
      { timeout: 1500 },
    );
  });

  it("Case 4: restore request failure shows explicit recovery error, not time-up copy", async () => {
    const disrupted = buildSnapshot({
      attemptStatus: "disrupted",
      isEditable: false,
      canResume: true,
      canSave: false,
      canSubmit: false,
      lockReason: "disrupted",
    });
    routeTakeOnly(disrupted);
    apiPost.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.endsWith("/restore")) {
        throw new ApiError(0, "Network request failed");
      }
      throw new Error(`unexpected POST ${path}`);
    });

    renderPage();

    // Restore failure UI: dedicated alert surface, explicit description,
    // and a retry control. Stable role/id selectors — not text-only.
    const failedSurface = await screen.findByTestId("restore-failed-surface");
    expect(failedSurface).toHaveTextContent("恢复考试失败");
    expect(failedSurface).toHaveTextContent(/未能确认考试状态/);
    expect(
      within(failedSurface).getByRole("button", { name: "重试恢复" }),
    ).toBeInTheDocument();

    // The generic deadline/time-up copy MUST NOT appear merely because
    // isEditable is false on a disrupted attempt.
    expect(
      screen.queryByText("考试时间已到，答题已结束"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/系统正在自动提交/)).not.toBeInTheDocument();
  });

  it("Case 5: retry after a genuine restore failure succeeds and renders editable exam", async () => {
    const disrupted = buildSnapshot({
      attemptStatus: "disrupted",
      isEditable: false,
      canResume: true,
      canSave: false,
      canSubmit: false,
      lockReason: "disrupted",
    });
    const restored = buildSnapshot();

    // Sequence: initial GET → disrupted. After the failed POST, the GET
    // still reports disrupted (the server did NOT restore — a genuine
    // failure). Only after the retry's POST does the GET report restored.
    // This is what surfaces the restore-failed UI between attempts: under
    // the new model a POST failure is always followed by an authoritative
    // GET, and only a still-disrupted GET yields the failed state.
    let takeIndex = 0;
    let restoreAttempt = 0;
    apiGet.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.includes("/candidate/attempts/")) {
        takeIndex += 1;
        // take 1: initial disrupted; take 2 (after failed POST): still
        // disrupted (genuine failure); take 3 (after retry): restored.
        return takeIndex <= 2 ? disrupted : restored;
      }
      throw new Error(`unexpected GET ${path}`);
    });
    apiPost.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.endsWith("/restore")) {
        restoreAttempt += 1;
        if (restoreAttempt === 1) {
          throw new ApiError(0, "Network request failed");
        }
        return { id: "att-1", status: "in_progress" };
      }
      throw new Error(`unexpected POST ${path}`);
    });

    renderPage();

    // First restore attempt already fired automatically; it failed and the
    // authoritative GET confirmed the attempt is still disrupted+resumable,
    // so the restore-failed surface appears with a retry control.
    const retryBtn = await screen.findByRole("button", { name: "重试恢复" });

    await waitFor(() => {
      const restores = apiPost.mock.calls.filter(
        ([p]) => typeof p === "string" && (p as string).endsWith("/restore"),
      );
      expect(restores).toHaveLength(1);
    });

    const user = userEvent.setup();
    await user.click(retryBtn);

    // The retry fires a second restore; the snapshot reloads; the exam
    // becomes editable.
    await waitFor(
      () => {
        const restores = apiPost.mock.calls.filter(
          ([p]) => typeof p === "string" && (p as string).endsWith("/restore"),
        );
        expect(restores).toHaveLength(2);
      },
      { timeout: 3000 },
    );
    expect(await screen.findByRole("radio", { name: "A" })).not.toBeDisabled();
  });

  it("Case 6: deadline wins during restore → terminal snapshot wins, no restore loop", async () => {
    const disrupted = buildSnapshot({
      attemptStatus: "disrupted",
      isEditable: false,
      canResume: true,
      canSave: false,
      canSubmit: false,
      lockReason: "disrupted",
    });
    // The deadline expired server-side between GET and POST restore. The
    // reload reports a terminal submitted attempt.
    const submittedAfterDeadline = buildSnapshot({
      attemptStatus: "submitted",
      isEditable: false,
      canResume: false,
      canSave: false,
      canSubmit: false,
      lockReason: "submitted",
      submittedAt: NOW,
    });
    routeTakeSequence(disrupted, submittedAfterDeadline);
    postRestoreOk();

    renderPage();

    // A single restore fired (initial); reload returned a terminal snapshot.
    await waitFor(
      () => {
        const restores = apiPost.mock.calls.filter(
          ([p]) => typeof p === "string" && (p as string).endsWith("/restore"),
        );
        expect(restores).toHaveLength(1);
      },
      { timeout: 4000 },
    );

    // The terminal snapshot is honored — disabled controls appear, and the
    // page must NOT show a network error or a restore-in-progress view. No
    // arbitrary sleep: a deterministic waitFor on the terminal controls is
    // both faster and a real assertion of outcome.
    expect((await screen.findAllByRole("radio"))[0]).toBeDisabled();
    expect(
      screen.queryByRole("heading", { name: "恢复考试失败" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/正在恢复考试/)).not.toBeInTheDocument();

    // After settling, no further restore may fire. We re-check via a final
    // microtask flush (deterministic) rather than an arbitrary sleep.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const restoresFinal = apiPost.mock.calls.filter(
      ([p]) => typeof p === "string" && (p as string).endsWith("/restore"),
    );
    expect(restoresFinal).toHaveLength(1);
  });

  it("Case 7: Strict Mode effect replay issues only one concurrent restore", async () => {
    const disrupted = buildSnapshot({
      attemptStatus: "disrupted",
      isEditable: false,
      canResume: true,
      canSave: false,
      canSubmit: false,
      lockReason: "disrupted",
    });
    // StrictMode double-invokes the loadSnapshot effect too (it does a
    // mount → simulated unmount → simulated remount in dev), so the page
    // will GET the take endpoint more than once. We serve disrupted on
    // every call so the snapshot stays resumable; the auto-restore guard
    // under test is "only one concurrent POST", not a snapshot transition.
    routeTakeOnly(disrupted);

    // Deterministic deferred promise: the restore POST stays pending until
    // the test resolves it. This is how we observe "only one concurrent
    // request" — we hold it open and count calls.
    let resolveRestore!: (v: unknown) => void;
    apiPost.mockImplementation(
      async (path: string) =>
        new Promise((resolve) => {
          if (typeof path === "string" && path.endsWith("/restore")) {
            resolveRestore = resolve;
            return;
          }
          resolve({ ok: true, serverNow: NOW });
        }),
    );

    // REAL Strict Mode: the page mounts under <StrictMode>, which in React
    // 18/19 dev mode double-invokes effects (setup → cleanup → setup). The
    // previous test used an empty act() and proved nothing.
    renderPage("att-1", { strictMode: true });

    // First restore fires. The in-flight ref + restoredForAttempt guard must
    // prevent StrictMode's second effect invocation from issuing a second POST.
    await waitFor(
      () => {
        const restores = apiPost.mock.calls.filter(
          ([p]) => typeof p === "string" && (p as string).endsWith("/restore"),
        );
        expect(restores.length).toBeGreaterThanOrEqual(1);
      },
      { timeout: 4000 },
    );

    // While the first restore is STILL pending, exactly one restore POST is
    // on the wire. No arbitrary sleep: we flush microtasks deterministically
    // so any pending effect re-run has had a chance to execute.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const restoresWhilePending = apiPost.mock.calls.filter(
      ([p]) => typeof p === "string" && (p as string).endsWith("/restore"),
    );
    expect(restoresWhilePending.length).toBe(1);

    // Sanity check that StrictMode actually double-invoked effects here (so the
    // single-restore assertion above is meaningful, not a no-op). Under
    // StrictMode the page's loadSnapshot effect re-runs, producing >1 GET to
    // the take endpoint. If this ever drops to 1, the StrictMode wrapper is no
    // longer exercising the double-invoke path and the test stops proving
    // anything about effect replay.
    await waitFor(() => {
      const takeGets = apiGet.mock.calls.filter(
        ([p]) =>
          typeof p === "string" &&
          (p as string).includes("/candidate/attempts/"),
      );
      expect(takeGets.length).toBeGreaterThan(1);
    });

    // Resolve the in-flight restore so the page can complete and tests
    // tear down cleanly.
    await act(async () => {
      resolveRestore({ id: "att-1", status: "in_progress" });
      await Promise.resolve();
      await Promise.resolve();
    });
  });

  it("Case 8: real router navigation — stale att-old restore does not affect att-new page", async () => {
    // Initial attempt: disrupted + resumable.
    const disruptedOld = buildSnapshot({
      attemptId: "att-old",
      attemptStatus: "disrupted",
      isEditable: false,
      canResume: true,
      canSave: false,
      canSubmit: false,
      lockReason: "disrupted",
    });
    // The new attempt is editable (e.g. one already in progress), so it must
    // NOT trigger a restore (canResume=false).
    const editableNew = buildSnapshot({
      attemptId: "att-new",
      examId: "exam-new",
      attemptStatus: "in_progress",
      isEditable: true,
      canResume: false,
      canSave: true,
      canSubmit: true,
    });

    // GET serves per-attempt snapshots: att-old → disrupted, att-new → editable.
    apiGet.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.includes("/candidate/attempts/")) {
        if (path.includes("/att-old/")) return disruptedOld;
        if (path.includes("/att-new/")) return editableNew;
      }
      throw new Error(`unexpected GET ${path}`);
    });

    // The att-old restore POST stays pending so its eventual resolution races
    // the route change. att-new must never receive a restore POST.
    let resolveRestoreOld: ((v: unknown) => void) | null = null;
    apiPost.mockImplementation(
      async (path: string) =>
        new Promise((resolve) => {
          if (typeof path === "string" && path.endsWith("/att-old/restore")) {
            resolveRestoreOld = resolve;
            return;
          }
          if (typeof path === "string" && path.endsWith("/att-new/restore")) {
            // The new attempt must never be restored; if this fires the test
            // will fail on the assertion below.
            resolve({ id: "att-new", status: "in_progress" });
            return;
          }
          resolve({ ok: true, serverNow: NOW });
        }),
    );

    const { navigate } = renderPage("att-old");

    // Wait for the restore to start for att-old.
    await waitFor(
      () => {
        const restores = apiPost.mock.calls.filter(
          ([p]) =>
            typeof p === "string" && (p as string).includes("/att-old/restore"),
        );
        expect(restores.length).toBeGreaterThanOrEqual(1);
      },
      { timeout: 4000 },
    );

    // Perform a REAL router navigation to the new attempt. React Router
    // reuses the same element instance (only the :attemptId param changes),
    // which is exactly the race the PR #219 review flagged: the old
    // in-flight restore must not apply to the new page.
    await act(async () => {
      navigate("/exam/exam-new/take/att-new");
      // Flush microtasks so the param change propagates through render.
      await Promise.resolve();
      await Promise.resolve();
    });

    // Now resolve att-old's stale restore. Its GET reload would serve the
    // att-old disrupted snapshot again (per the per-attempt mock), which must
    // NOT be applied to the att-new page. The page must still render att-new's
    // editable content.
    await act(async () => {
      resolveRestoreOld?.({ id: "att-old", status: "in_progress" });
      await Promise.resolve();
      await Promise.resolve();
    });

    // (a) No restore POST was ever issued against att-new (canResume=false).
    const restoresForNew = apiPost.mock.calls.filter(
      ([p]) =>
        typeof p === "string" && (p as string).includes("/att-new/restore"),
    );
    expect(restoresForNew).toHaveLength(0);

    // (b) The att-new editable exam rendered (att-old's stale reload did not
    // overwrite it). We assert the new attempt's radio is present and enabled.
    expect(await screen.findByRole("radio", { name: "A" })).not.toBeDisabled();

    // (c) No restoring/failed UI leaked from att-old into att-new.
    expect(
      screen.queryByTestId("restore-restoring-surface"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("restore-failed-surface"),
    ).not.toBeInTheDocument();
  });

  it("Case 9: snapshot reload fails after a successful restore shows reload/retry path", async () => {
    const disrupted = buildSnapshot({
      attemptStatus: "disrupted",
      isEditable: false,
      canResume: true,
      canSave: false,
      canSubmit: false,
      lockReason: "disrupted",
    });
    // First GET returns disrupted; the post-restore reload GET throws. The
    // page must surface the dedicated restore-failed surface (NOT invent an
    // editable state from the POST ack, and NOT silently render loadError
    // only).
    let takeCallCount = 0;
    apiGet.mockImplementation(async (path: string) => {
      if (
        typeof path === "string" &&
        path.includes("/candidate/attempts/att-1/take")
      ) {
        takeCallCount += 1;
        if (takeCallCount >= 2) {
          throw new Error("reload failed");
        }
        return disrupted;
      }
      throw new Error(`unexpected GET ${path}`);
    });
    postRestoreOk();

    renderPage();

    // Restore fired exactly once.
    await waitFor(
      () => {
        const restores = apiPost.mock.calls.filter(
          ([p]) => typeof p === "string" && (p as string).endsWith("/restore"),
        );
        expect(restores).toHaveLength(1);
      },
      { timeout: 4000 },
    );

    // The dedicated restore-failed surface appears (reload/retry path), with
    // the retry control reachable. This is the positive assertion the
    // previous test was missing.
    const failedSurface = await screen.findByTestId("restore-failed-surface");
    expect(
      within(failedSurface).getByRole("button", { name: "重试恢复" }),
    ).toBeInTheDocument();

    // The page must not invent editable controls from the restore response.
    expect(screen.queryByRole("radio", { name: "A" })).not.toBeInTheDocument();
  });

  it("Case 11: POST restore 409 (server already submitted) → terminal snapshot wins, not a failure", async () => {
    const disrupted = buildSnapshot({
      attemptStatus: "disrupted",
      isEditable: false,
      canResume: true,
      canSave: false,
      canSubmit: false,
      lockReason: "disrupted",
    });
    // The server reconciled the deadline during the POST: restore returns
    // 409 (already in a terminal state), and the authoritative GET reports
    // submitted. The terminal snapshot must win — this is NOT a restore
    // failure.
    const submitted = buildSnapshot({
      attemptStatus: "submitted",
      isEditable: false,
      canResume: false,
      canSave: false,
      canSubmit: false,
      lockReason: "submitted",
      submittedAt: NOW,
    });
    routeTakeSequence(disrupted, submitted);
    apiPost.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.endsWith("/restore")) {
        throw new ApiError(
          409,
          "Attempt already submitted",
          "ATTEMPT_ALREADY_SUBMITTED",
        );
      }
      if (typeof path === "string" && path.includes("/heartbeat")) {
        return { ok: true, serverNow: NOW };
      }
      throw new Error(`unexpected POST ${path}`);
    });

    renderPage();

    // Exactly one restore POST fired (the 409), then the GET re-read the
    // authoritative terminal snapshot.
    await waitFor(
      () => {
        const restores = apiPost.mock.calls.filter(
          ([p]) => typeof p === "string" && (p as string).endsWith("/restore"),
        );
        expect(restores).toHaveLength(1);
      },
      { timeout: 4000 },
    );

    // Terminal controls render (disabled radios), and crucially the restore-
    // failed surface does NOT appear — the recovery succeeded in the sense
    // that the authoritative terminal state was reached.
    expect((await screen.findAllByRole("radio"))[0]).toBeDisabled();
    expect(
      screen.queryByTestId("restore-failed-surface"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("restore-restoring-surface"),
    ).not.toBeInTheDocument();
  });

  it("Case 12: POST response lost but server restored → GET in_progress wins, not a failure", async () => {
    const disrupted = buildSnapshot({
      attemptStatus: "disrupted",
      isEditable: false,
      canResume: true,
      canSave: false,
      canSubmit: false,
      lockReason: "disrupted",
    });
    // The restore POST response was lost (network failure thrown), but the
    // server actually restored successfully — the authoritative GET reports
    // an editable in_progress attempt. The page MUST trust the GET, not the
    // POST failure, so it renders the editable exam.
    const restored = buildSnapshot({
      attemptStatus: "in_progress",
      isEditable: true,
      canResume: false,
      canSave: true,
      canSubmit: true,
    });
    routeTakeSequence(disrupted, restored);
    apiPost.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.endsWith("/restore")) {
        // Response lost — simulate a network failure.
        throw new ApiError(0, "Network request failed");
      }
      if (typeof path === "string" && path.includes("/heartbeat")) {
        return { ok: true, serverNow: NOW };
      }
      throw new Error(`unexpected POST ${path}`);
    });

    renderPage();

    // Exactly one restore POST fired (the lost one), then the GET re-read the
    // authoritative restored snapshot.
    await waitFor(
      () => {
        const restores = apiPost.mock.calls.filter(
          ([p]) => typeof p === "string" && (p as string).endsWith("/restore"),
        );
        expect(restores).toHaveLength(1);
      },
      { timeout: 4000 },
    );

    // The editable exam renders — the POST failure did NOT pin the page to a
    // restore-failed state, because the authoritative GET reported success.
    expect(await screen.findByRole("radio", { name: "A" })).not.toBeDisabled();
    expect(
      screen.queryByTestId("restore-failed-surface"),
    ).not.toBeInTheDocument();
  });

  it("Case 13: cross-attempt race — resumable → resumable, new attempt restores despite old POST in flight", async () => {
    // Both attempts are disrupted + resumable. att-old's restore POST is held
    // pending; the test navigates to att-new and asserts that att-new's own
    // restore POST fires even before att-old's stale POST resolves.
    const disruptedOld = buildSnapshot({
      attemptId: "att-old",
      attemptStatus: "disrupted",
      isEditable: false,
      canResume: true,
      canSave: false,
      canSubmit: false,
      lockReason: "disrupted",
    });
    const disruptedNew = buildSnapshot({
      attemptId: "att-new",
      examId: "exam-new",
      attemptStatus: "disrupted",
      isEditable: false,
      canResume: true,
      canSave: false,
      canSubmit: false,
      lockReason: "disrupted",
    });

    // Per-attempt snapshots: GET att-old/.../take → disruptedOld; GET att-new →
    // disruptedNew on the FIRST call (so canResume surfaces), restored on later
    // calls (so att-new's restore chain reaches the editable view).
    let newTakeCall = 0;
    apiGet.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.includes("/candidate/attempts/")) {
        if (path.includes("/att-old/")) return disruptedOld;
        if (path.includes("/att-new/")) {
          newTakeCall += 1;
          // First GET for att-new: disrupted (drives auto-restore trigger).
          // Subsequent GETs (post-restore reload): editable.
          return newTakeCall === 1
            ? disruptedNew
            : buildSnapshot({
                attemptId: "att-new",
                examId: "exam-new",
                attemptStatus: "in_progress",
                isEditable: true,
                canResume: false,
                canSave: true,
                canSubmit: true,
              });
        }
      }
      throw new Error(`unexpected GET ${path}`);
    });

    let resolveRestoreOld: ((v: unknown) => void) | null = null;
    apiPost.mockImplementation(
      async (path: string) =>
        new Promise((resolve) => {
          if (typeof path === "string" && path.endsWith("/att-old/restore")) {
            resolveRestoreOld = resolve;
            return;
          }
          if (typeof path === "string" && path.endsWith("/att-new/restore")) {
            resolve({ id: "att-new", status: "in_progress" });
            return;
          }
          resolve({ ok: true, serverNow: NOW });
        }),
    );

    const { navigate } = renderPage("att-old");

    // att-old's restore POST is on the wire and pending.
    await waitFor(
      () => {
        const restores = apiPost.mock.calls.filter(
          ([p]) =>
            typeof p === "string" && (p as string).includes("/att-old/restore"),
        );
        expect(restores.length).toBeGreaterThanOrEqual(1);
      },
      { timeout: 4000 },
    );

    // Navigate to the new attempt while att-old's POST is STILL pending.
    await act(async () => {
      navigate("/exam/exam-new/take/att-new");
      await Promise.resolve();
      await Promise.resolve();
    });

    // KEY ASSERTION: att-new's restore POST fires even though att-old's POST
    // is still in flight. This is the cross-attempt race the previous
    // boolean in-flight guard dropped.
    await waitFor(
      () => {
        const restoresForNew = apiPost.mock.calls.filter(
          ([p]) =>
            typeof p === "string" && (p as string).includes("/att-new/restore"),
        );
        expect(restoresForNew.length).toBe(1);
      },
      { timeout: 4000 },
    );

    // att-new reaches the editable exam (its restore chain completed; the
    // stale att-old POST did NOT block it).
    expect(await screen.findByRole("radio", { name: "A" })).not.toBeDisabled();

    // Now resolve the stale att-old POST. It must NOT affect att-new's page
    // (no overwrite of snapshot, no restore UI flicker).
    await act(async () => {
      resolveRestoreOld?.({ id: "att-old", status: "in_progress" });
      await Promise.resolve();
      await Promise.resolve();
    });

    // att-new still rendered, exactly one restore per attempt.
    expect(
      screen.queryByTestId("restore-restoring-surface"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("restore-failed-surface"),
    ).not.toBeInTheDocument();
    const oldRestores = apiPost.mock.calls.filter(
      ([p]) =>
        typeof p === "string" && (p as string).includes("/att-old/restore"),
    );
    const newRestores = apiPost.mock.calls.filter(
      ([p]) =>
        typeof p === "string" && (p as string).includes("/att-new/restore"),
    );
    expect(oldRestores).toHaveLength(1);
    expect(newRestores).toHaveLength(1);
  });

  it("Case 14: cross-attempt race — old GET resolves AFTER new GET, old snapshot does not overwrite new page", async () => {
    // Initial att-old snapshot is editable (no restore). The test deliberately
    // stalls the att-old GET so it resolves AFTER the att-new GET, then asserts
    // att-old's snapshot is NOT applied to the att-new page.
    const editableOld = buildSnapshot({
      attemptId: "att-old",
      attemptStatus: "in_progress",
      isEditable: true,
      canResume: false,
      canSave: true,
      canSubmit: true,
    });
    const editableNew = buildSnapshot({
      attemptId: "att-new",
      examId: "exam-new",
      attemptStatus: "in_progress",
      isEditable: true,
      canResume: false,
      canSave: true,
      canSubmit: true,
    });

    let resolveOldGet: ((v: unknown) => void) | null = null;
    apiGet.mockImplementation(
      (path: string) =>
        new Promise((resolve, reject) => {
          if (
            typeof path === "string" &&
            path.includes("/candidate/attempts/")
          ) {
            if (path.includes("/att-old/")) {
              // Hold the old GET pending so it resolves AFTER navigation.
              resolveOldGet = resolve;
              return;
            }
            if (path.includes("/att-new/")) {
              resolve(editableNew);
              return;
            }
          }
          reject(new Error(`unexpected GET ${path}`));
        }),
    );
    apiPost.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.includes("/heartbeat")) {
        return { ok: true, serverNow: NOW };
      }
      throw new Error(`unexpected POST ${path}`);
    });

    const { navigate } = renderPage("att-old");

    // Navigate to att-new before att-old's GET resolves.
    await act(async () => {
      navigate("/exam/exam-new/take/att-new");
      await Promise.resolve();
      await Promise.resolve();
    });

    // att-new's editable exam renders.
    expect(await screen.findByRole("radio", { name: "A" })).not.toBeDisabled();

    // Now resolve the late att-old GET with att-old's snapshot. The stale-GET
    // guard must reject it; att-new's page must remain intact.
    await act(async () => {
      resolveOldGet?.(editableOld);
      await Promise.resolve();
      await Promise.resolve();
    });

    // att-new's page is still correct — no ErrorState, no flash of att-old.
    expect(
      screen.queryByTestId("restore-failed-surface"),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "A" })).toBeInTheDocument();
  });

  it("Case 15: cross-attempt race — old GET fails AFTER new GET succeeded, old failure does not write loadError", async () => {
    const editableNew = buildSnapshot({
      attemptId: "att-new",
      examId: "exam-new",
      attemptStatus: "in_progress",
      isEditable: true,
      canResume: false,
      canSave: true,
      canSubmit: true,
    });

    let rejectOldGet: ((e: unknown) => void) | null = null;
    apiGet.mockImplementation(
      (path: string) =>
        new Promise((resolve, reject) => {
          if (
            typeof path === "string" &&
            path.includes("/candidate/attempts/")
          ) {
            if (path.includes("/att-old/")) {
              // Hold the old GET pending so its FAILURE resolves after nav.
              rejectOldGet = reject;
              return;
            }
            if (path.includes("/att-new/")) {
              resolve(editableNew);
              return;
            }
          }
          reject(new Error(`unexpected GET ${path}`));
        }),
    );
    apiPost.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.includes("/heartbeat")) {
        return { ok: true, serverNow: NOW };
      }
      throw new Error(`unexpected POST ${path}`);
    });

    const { navigate } = renderPage("att-old");

    await act(async () => {
      navigate("/exam/exam-new/take/att-new");
      await Promise.resolve();
      await Promise.resolve();
    });

    // att-new's editable exam renders.
    expect(await screen.findByRole("radio", { name: "A" })).not.toBeDisabled();

    // Now the late att-old GET fails. The stale guard must reject its
    // loadError / isLoading write — att-new's page stays usable.
    await act(async () => {
      rejectOldGet?.(new Error("att-old GET failed late"));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      screen.queryByTestId("restore-failed-surface"),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "A" })).toBeInTheDocument();
  });

  it("Case 16: cross-attempt race — currentIndex from a long old exam does not pin short new exam to ErrorState", async () => {
    // Old exam has 10 questions and the candidate was on the last one.
    // New exam has 1 question. Without attempt-scoped reset, currentIndex=9
    // would make view.questions[9] undefined → currentQuestionView=null →
    // generic ErrorState, even after the new snapshot loaded successfully.
    const tenQuestionOld = buildSnapshot({
      attemptId: "att-old",
      attemptStatus: "in_progress",
      isEditable: true,
      canResume: false,
      canSave: true,
      canSubmit: true,
      questions: Array.from({ length: 10 }, (_, i) => ({
        id: `q-old-${i}`,
        type: "single_choice" as const,
        prompt: `旧题 ${i + 1}`,
        options: [
          { id: `opt-old-a-${i}`, content: "A" },
          { id: `opt-old-b-${i}`, content: "B" },
        ],
        inputMode: "choice" as const,
        maxScore: 10,
        answerValue: null,
        answerSource: "none" as const,
      })),
    });
    const oneQuestionNew = buildSnapshot({
      attemptId: "att-new",
      examId: "exam-new",
      attemptStatus: "in_progress",
      isEditable: true,
      canResume: false,
      canSave: true,
      canSubmit: true,
    });

    apiGet.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.includes("/candidate/attempts/")) {
        if (path.includes("/att-old/")) return tenQuestionOld;
        if (path.includes("/att-new/")) return oneQuestionNew;
      }
      throw new Error(`unexpected GET ${path}`);
    });
    apiPost.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.includes("/heartbeat")) {
        return { ok: true, serverNow: NOW };
      }
      throw new Error(`unexpected POST ${path}`);
    });

    const { navigate } = renderPage("att-old");

    // Wait for att-old to load, then advance to its last question (index 9).
    await screen.findByText("旧题 1");
    // Drive currentIndex to 9 via repeated Next clicks (uses the in-page
    // footer control). This is what makes the test prove the reset path:
    // without the reset, the retained index 9 would break att-new.
    const user = userEvent.setup();
    for (let i = 0; i < 9; i++) {
      const nextBtn = await screen.findByRole("button", { name: /下一题/ });
      await user.click(nextBtn);
    }
    // Sanity: we are now on the old exam's last question.
    expect(await screen.findByText("旧题 10")).toBeInTheDocument();

    // Navigate to the short new exam.
    await act(async () => {
      navigate("/exam/exam-new/take/att-new");
      await Promise.resolve();
      await Promise.resolve();
    });

    // The new exam's single question renders — NOT the generic ErrorState.
    // This is the regression assertion: a retained out-of-range currentIndex
    // would otherwise have driven the page into ErrorState.
    expect(await screen.findByText("选择一项")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "A" })).not.toBeDisabled();
  });

  // ====== Cross-attempt save-queue isolation ======

  it("Case 17: pending save cross-attempt — old debounce timer is cancelled, never fires against old URL", async () => {
    // att-old is editable; the candidate types an answer (schedules a 1500ms
    // debounce timer) and immediately navigates to att-new BEFORE the timer
    // fires. The hook's scope switch must cancel att-old's pending timer, so
    // no POST to att-old's answers URL ever issues, and att-new is untouched.
    const editableOld = buildSnapshot({
      attemptId: "att-old",
      attemptStatus: "in_progress",
      isEditable: true,
      canResume: false,
      canSave: true,
      canSubmit: true,
    });
    const editableNew = buildSnapshot({
      attemptId: "att-new",
      examId: "exam-new",
      attemptStatus: "in_progress",
      isEditable: true,
      canResume: false,
      canSave: true,
      canSubmit: true,
    });

    apiGet.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.includes("/candidate/attempts/")) {
        if (path.includes("/att-old/")) return editableOld;
        if (path.includes("/att-new/")) return editableNew;
      }
      throw new Error(`unexpected GET ${path}`);
    });
    apiPost.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.includes("/answers/")) {
        return { accepted: true, serverVersion: 1, savedAt: NOW };
      }
      if (typeof path === "string" && path.includes("/heartbeat")) {
        return { ok: true, serverNow: NOW };
      }
      throw new Error(`unexpected POST ${path}`);
    });

    // Fake timers for THIS case only, so we can deterministically cross the
    // 1500ms debounce window and prove the timer was cancelled (not merely
    // unobserved). Restored in finally.
    const { navigate } = renderPage("att-old");
    // Load att-old's editable exam under REAL timers (findBy polls via real
    // setTimeout; switching to fake timers first would freeze the poll).
    const oldRadio = await screen.findByRole("radio", { name: "A" });

    vi.useFakeTimers();
    try {
      // Schedule a save under att-old. The 1500ms debounce timer is armed.
      // fireEvent.click is synchronous (no internal pointer-event timing),
      // so it is safe under fake timers where userEvent would stall.
      await act(async () => {
        fireEvent.click(oldRadio);
      });

      // Navigate to att-new BEFORE the debounce fires. The scope switch
      // (useLayoutEffect keyed on attemptId) cancels att-old's pending timer.
      await act(async () => {
        navigate("/exam/exam-new/take/att-new");
        await Promise.resolve();
        await Promise.resolve();
      });

      // Cross the full debounce window. saveAnswer's timer was cancelled, so
      // no POST to att-old's answers URL should ever issue.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });

      const oldAnswerPosts = apiPost.mock.calls.filter(
        ([p]) =>
          typeof p === "string" &&
          (p as string).includes("/att-old/") &&
          (p as string).includes("/answers/"),
      );
      expect(oldAnswerPosts).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }

    // Back under real timers: att-new renders its own editable content; no
    // leaked save UI.
    expect(await screen.findByRole("radio", { name: "A" })).not.toBeDisabled();
  });

  it("Case 18: in-flight save cross-attempt — shared questionId, new save not blocked by old; old late-resolve does not pollute new page", async () => {
    // Both attempts use questionId "q1" (the buildSnapshot default). The
    // critical race: att-old's q1 save is IN-FLIGHT (POST on the wire, held
    // pending); the candidate navigates to att-new; att-new's q1 save must
    // fire IMMEDIATELY (not serialized behind att-old, proving per-scope
    // inflight maps), and att-old's late resolve must NOT mark att-new's
    // save state/version.
    const editableOld = buildSnapshot({
      attemptId: "att-old",
      attemptStatus: "in_progress",
      isEditable: true,
      canResume: false,
      canSave: true,
      canSubmit: true,
    });
    const editableNew = buildSnapshot({
      attemptId: "att-new",
      examId: "exam-new",
      attemptStatus: "in_progress",
      isEditable: true,
      canResume: false,
      canSave: true,
      canSubmit: true,
    });

    apiGet.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.includes("/candidate/attempts/")) {
        if (path.includes("/att-old/")) return editableOld;
        if (path.includes("/att-new/")) return editableNew;
      }
      throw new Error(`unexpected GET ${path}`);
    });

    // att-old's answers POST stays pending (deferred); att-new's resolves
    // immediately with serverVersion 1.
    let resolveOldSave: ((v: unknown) => void) | null = null;
    apiPost.mockImplementation(
      async (path: string) =>
        new Promise((resolve, reject) => {
          if (typeof path === "string" && path.includes("/answers/")) {
            if (path.includes("/att-old/")) {
              resolveOldSave = resolve;
              return;
            }
            // att-new: resolve immediately.
            resolve({ accepted: true, serverVersion: 1, savedAt: NOW });
            return;
          }
          if (typeof path === "string" && path.includes("/heartbeat")) {
            resolve({ ok: true, serverNow: NOW });
            return;
          }
          reject(new Error(`unexpected POST ${path}`));
        }),
    );

    const { navigate } = renderPage("att-old");

    // Type an answer on att-old and let its debounce fire so the POST is
    // in-flight (pending on resolveOldSave).
    const oldRadio = await screen.findByRole("radio", { name: "A" });
    const user = userEvent.setup();
    await user.click(oldRadio);
    await waitFor(
      () => {
        const oldPosts = apiPost.mock.calls.filter(
          ([p]) =>
            typeof p === "string" &&
            (p as string).includes("/att-old/") &&
            (p as string).includes("/answers/"),
        );
        expect(oldPosts.length).toBe(1);
      },
      { timeout: 3000 },
    );

    // Navigate to att-new (att-old's save still in flight).
    await act(async () => {
      navigate("/exam/exam-new/take/att-new");
      await Promise.resolve();
      await Promise.resolve();
    });

    // Type an answer on att-new. Its save must NOT wait behind att-old's
    // in-flight save (per-scope inflight map). Assert the att-new POST body
    // carries baseVersion 0 — att-old's save result (serverVersion 1) was
    // NOT written to the new page's versionsRef.
    const newRadio = await screen.findByRole("radio", { name: "A" });
    await user.click(newRadio);
    await waitFor(
      () => {
        const newPosts = apiPost.mock.calls.filter(
          ([p]) =>
            typeof p === "string" &&
            (p as string).includes("/att-new/") &&
            (p as string).includes("/answers/"),
        );
        expect(newPosts.length).toBe(1);
      },
      { timeout: 3000 },
    );
    const newPostCall = apiPost.mock.calls.find(
      ([p]) =>
        typeof p === "string" &&
        (p as string).includes("/att-new/") &&
        (p as string).includes("/answers/"),
    );
    const newPostBody = newPostCall?.[1] as
      | { baseVersion?: number }
      | undefined;
    expect(newPostBody?.baseVersion).toBe(0);

    // Now resolve att-old's stale in-flight save. It must NOT pollute the
    // new page: no flipped save indicator, no error surface. The page stays
    // on att-new's editable content.
    await act(async () => {
      resolveOldSave?.({ accepted: true, serverVersion: 1, savedAt: NOW });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(
      screen.queryByTestId("restore-failed-surface"),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "A" })).not.toBeDisabled();
  });

  // ====== Per-call load generation (latest-GET-wins within one attempt) ======

  it("Case 19: same-attempt GET reorder (StrictMode) — late old success does not overwrite newer snapshot", async () => {
    // StrictMode double-invokes the load effect: GET-1 then GET-2 for the
    // SAME attempt. Hold GET-1 pending; let GET-2 return a snapshot whose
    // prompt is "新题目 v2"; then resolve GET-1 with an OLDER snapshot whose
    // prompt is "旧题目 v1". The per-call load-generation bump must reject
    // GET-1's late success — the page shows v2, not v1.
    const snapshotV2 = buildSnapshot({
      questions: [
        {
          id: "q1",
          type: "single_choice",
          prompt: "新题目 v2",
          options: [
            { id: "opt-a", content: "A" },
            { id: "opt-b", content: "B" },
          ],
          inputMode: "choice",
          maxScore: 10,
          answerValue: null,
          answerSource: "none",
        },
      ],
    });
    const snapshotV1Full = buildSnapshot({
      questions: [
        {
          id: "q1",
          type: "single_choice",
          prompt: "旧题目 v1",
          options: [
            { id: "opt-a", content: "A" },
            { id: "opt-b", content: "B" },
          ],
          inputMode: "choice",
          maxScore: 10,
          answerValue: null,
          answerSource: "none",
        },
      ],
    });

    let resolveGet1: ((v: unknown) => void) | null = null;
    let getCall = 0;
    apiGet.mockImplementation(
      (path: string) =>
        new Promise((resolve, reject) => {
          if (
            typeof path === "string" &&
            path.includes("/candidate/attempts/")
          ) {
            getCall += 1;
            if (getCall === 1) {
              // GET-1: hold pending so it resolves AFTER GET-2.
              resolveGet1 = resolve;
              return;
            }
            // GET-2 (and any later): the newer snapshot.
            resolve(snapshotV2);
            return;
          }
          reject(new Error(`unexpected GET ${path}`));
        }),
    );
    apiPost.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.includes("/heartbeat")) {
        return { ok: true, serverNow: NOW };
      }
      throw new Error(`unexpected POST ${path}`);
    });

    renderPage("att-1", { strictMode: true });

    // GET-2 wins and renders v2.
    expect(await screen.findByText("新题目 v2")).toBeInTheDocument();

    // Now resolve GET-1 with the OLDER v1 snapshot. The per-call generation
    // bump must reject it — the page stays on v2.
    await act(async () => {
      resolveGet1?.(snapshotV1Full);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText("新题目 v2")).toBeInTheDocument();
    expect(screen.queryByText("旧题目 v1")).not.toBeInTheDocument();
  });

  it("Case 20: same-attempt GET reorder (StrictMode) — late old failure does not write loadError onto loaded page", async () => {
    // Symmetric with Case 19 but GET-1 FAILS late. StrictMode issues GET-1
    // then GET-2 for the same attempt; hold GET-1 pending; let GET-2 succeed
    // and render; then reject GET-1. The per-call generation bump must
    // reject GET-1's late failure — no loadError / ErrorState appears.
    const snapshotOk = buildSnapshot();

    let rejectGet1: ((e: unknown) => void) | null = null;
    let getCall = 0;
    apiGet.mockImplementation(
      (path: string) =>
        new Promise((resolve, reject) => {
          if (
            typeof path === "string" &&
            path.includes("/candidate/attempts/")
          ) {
            getCall += 1;
            if (getCall === 1) {
              rejectGet1 = reject;
              return;
            }
            resolve(snapshotOk);
            return;
          }
          reject(new Error(`unexpected GET ${path}`));
        }),
    );
    apiPost.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.includes("/heartbeat")) {
        return { ok: true, serverNow: NOW };
      }
      throw new Error(`unexpected POST ${path}`);
    });

    renderPage("att-1", { strictMode: true });

    // GET-2 succeeds and renders the editable exam.
    expect(await screen.findByRole("radio", { name: "A" })).not.toBeDisabled();

    // Now reject GET-1. The late failure must NOT write loadError / surface
    // the generic ErrorState.
    await act(async () => {
      rejectGet1?.(new Error("att-1 GET-1 failed late"));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByRole("radio", { name: "A" })).toBeInTheDocument();
    // The generic load-error ErrorState surfaces a Retry button; it must not
    // appear (the page is still the loaded editable exam).
    expect(
      screen.queryByRole("button", { name: /重试|Retry/ }),
    ).not.toBeInTheDocument();
  });
});

describe("REC-I3 — restoring UX and accessibility", () => {
  it("displays a clear restoring heading and descriptive text while restore is in flight", async () => {
    const disrupted = buildSnapshot({
      attemptStatus: "disrupted",
      isEditable: false,
      canResume: true,
      canSave: false,
      canSubmit: false,
      lockReason: "disrupted",
    });
    routeTakeOnly(disrupted);

    let _resolveRestore: ((v: unknown) => void) | null = null;
    apiPost.mockImplementation(
      async (path: string) =>
        new Promise((resolve) => {
          if (typeof path === "string" && path.endsWith("/restore")) {
            _resolveRestore = resolve;
            return;
          }
          resolve({ ok: true, serverNow: NOW });
        }),
    );

    renderPage();

    // Visible, accessible restoring UI: heading + descriptive copy. The
    // editable controls MUST NOT render while restore is pending.
    const surface = await screen.findByTestId("restore-restoring-surface");
    expect(surface).toHaveTextContent("正在恢复考试");
    expect(surface).toHaveTextContent(/服务器正在确认考试状态和剩余时间/);

    // No editable radio while restoring.
    expect(screen.queryByRole("radio", { name: "A" })).not.toBeInTheDocument();

    // Let the in-flight restore resolve so the test can tear down. Deterministic
    // microtask flush instead of an arbitrary sleep.
    await act(async () => {
      _resolveRestore?.({ id: "att-1", status: "in_progress" });
      await Promise.resolve();
      await Promise.resolve();
    });
  });

  it("restore failure surfaces a '返回考试列表' control alongside the retry", async () => {
    const disrupted = buildSnapshot({
      attemptStatus: "disrupted",
      isEditable: false,
      canResume: true,
      canSave: false,
      canSubmit: false,
      lockReason: "disrupted",
    });
    routeTakeOnly(disrupted);
    apiPost.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.endsWith("/restore")) {
        throw new ApiError(0, "Network request failed");
      }
      throw new Error(`unexpected POST ${path}`);
    });

    renderPage();

    expect(
      await screen.findByRole("button", { name: "重试恢复" }),
    ).toBeInTheDocument();
    // The "back to list" affordance must be reachable.
    expect(
      screen.getByRole("button", { name: "返回考试列表" }),
    ).toBeInTheDocument();
  });
});

describe("REC-I3 — regression: existing StartExam flow stays intact", () => {
  it("Case 10: ordinary editable attempt navigates, edits, and saves via the existing flow", async () => {
    routeTakeOnly(buildSnapshot());
    apiPost.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.includes("/answers/")) {
        return { accepted: true, serverVersion: 1, savedAt: NOW };
      }
      if (typeof path === "string" && path.includes("/heartbeat")) {
        return { ok: true, serverNow: NOW };
      }
      throw new Error(`unexpected POST ${path}`);
    });

    renderPage();
    const radio = await screen.findByRole("radio", { name: "A" });
    const user = userEvent.setup();
    await user.click(radio);

    await waitFor(
      () => {
        const saves = apiPost.mock.calls.filter(
          ([p]) => typeof p === "string" && (p as string).includes("/answers/"),
        );
        expect(saves.length).toBeGreaterThan(0);
      },
      { timeout: 3000 },
    );
  });
});
