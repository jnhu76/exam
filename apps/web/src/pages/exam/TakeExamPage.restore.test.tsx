import { render, screen, waitFor, within, act } from "@testing-library/react";
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
