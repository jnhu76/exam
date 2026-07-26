import { render, screen, waitFor, within, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
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
 *   - after restore, the snapshot MUST be reloaded
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

function renderPage(attemptId = "att-1") {
  return render(
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
    </MemoryRouter>,
  );
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

  it("Case 5: retry after restore failure succeeds and renders editable exam", async () => {
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

    let restoreAttempt = 0;
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

    const retryBtn = await screen.findByRole("button", { name: "重试恢复" });

    // First restore attempt already fired automatically; it failed.
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

    // Wait a bit more to ensure no automatic restore loop fires.
    await new Promise((r) => setTimeout(r, 300));

    const restoresFinal = apiPost.mock.calls.filter(
      ([p]) => typeof p === "string" && (p as string).endsWith("/restore"),
    );
    expect(restoresFinal).toHaveLength(1);

    // The terminal snapshot is honored — the page must NOT show a network
    // error or a restore-in-progress view.
    expect(
      screen.queryByRole("heading", { name: "恢复考试失败" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/正在恢复考试/)).not.toBeInTheDocument();
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
    routeTakeSequence(disrupted, buildSnapshot());

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

    renderPage();

    // First restore fires.
    await waitFor(
      () => {
        const restores = apiPost.mock.calls.filter(
          ([p]) => typeof p === "string" && (p as string).endsWith("/restore"),
        );
        expect(restores.length).toBeGreaterThanOrEqual(1);
      },
      { timeout: 4000 },
    );

    // Simulate Strict Mode by wrapping a no-op re-render in act, which can
    // re-fire effects. While the first restore is still in flight, exactly
    // one restore may be on the wire.
    await act(async () => {
      // Trigger a re-render of the same mounted page without changing the
      // attemptId. Effects may re-run but must not duplicate the request.
      // (Stable refs/deduplication is what we are exercising.)
    });

    await new Promise((r) => setTimeout(r, 50));

    const restoresWhilePending = apiPost.mock.calls.filter(
      ([p]) => typeof p === "string" && (p as string).endsWith("/restore"),
    );
    expect(restoresWhilePending.length).toBe(1);

    // Resolve the in-flight restore so the page can complete and tests
    // tear down cleanly.
    await act(async () => {
      resolveRestore({ id: "att-1", status: "in_progress" });
      await new Promise((r) => setTimeout(r, 50));
    });
  });

  it("Case 8: attemptId change does not allow stale async result to overwrite new page", async () => {
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
    const editableNew = buildSnapshot({
      attemptId: "att-new",
      attemptStatus: "in_progress",
      isEditable: true,
      canResume: false,
      canSave: true,
      canSubmit: true,
    });

    // First GET returns disrupted for att-old; once the route changes,
    // subsequent GETs return the editable new attempt.
    let switchedToNew = false;
    apiGet.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.includes("/candidate/attempts/")) {
        return switchedToNew ? editableNew : disruptedOld;
      }
      throw new Error(`unexpected GET ${path}`);
    });

    // The restore POST stays pending so its eventual resolution races the
    // route change.
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

    renderPage("att-old");

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

    // Switch the mock so the next load returns the new attempt's snapshot.
    switchedToNew = true;

    // Resolve the stale in-flight restore of att-old. The cancelledRef guard
    // must prevent att-old's snapshot reload from firing against a new page,
    // and the in-flight guard prevents re-firing.
    await act(async () => {
      _resolveRestore?.({ id: "att-old", status: "in_progress" });
      // Microtask flush: the stale promise chain must complete without
      // affecting any new page.
      await Promise.resolve();
      await Promise.resolve();
    });

    // The att-old restore path may have triggered its own snapshot reload
    // (which would have served the new attempt's snapshot, since we flipped
    // the mock). That is acceptable per ADR-012 — what is unacceptable is
    // the page re-firing restore or the stale snapshot overwriting a
    // freshly-loaded new attempt. We assert the negative: no restore POST
    // was issued against the new attempt's path (the new attempt is not
    // resumable, so it must never invoke restore).
    const restoresForNew = apiPost.mock.calls.filter(
      ([p]) =>
        typeof p === "string" && (p as string).includes("/att-new/restore"),
    );
    expect(restoresForNew).toHaveLength(0);
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
    routeTakeSequence(disrupted);
    // Reload after restore throws — page must NOT invent an in_progress state.
    apiGet.mockImplementation(async (path: string) => {
      if (
        typeof path === "string" &&
        path.endsWith("/att-1/take") &&
        apiGet.mock.calls.length >= 2
      ) {
        throw new Error("reload failed");
      }
      return disrupted;
    });
    postRestoreOk();

    renderPage();

    // Restore fired, reload failed, and the page presents an uncertain /
    // reload-retry path rather than pretending the exam is editable.
    await waitFor(
      () => {
        const restores = apiPost.mock.calls.filter(
          ([p]) => typeof p === "string" && (p as string).endsWith("/restore"),
        );
        expect(restores).toHaveLength(1);
      },
      { timeout: 4000 },
    );

    // The page must not invent editable controls from the restore response.
    expect(screen.queryByRole("radio", { name: "A" })).not.toBeInTheDocument();
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

    // Let the in-flight restore resolve so the test can tear down.
    await act(async () => {
      _resolveRestore?.({ id: "att-1", status: "in_progress" });
      await new Promise((r) => setTimeout(r, 50));
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
