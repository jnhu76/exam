import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "@/contexts/AuthContext";
import { BrandProvider } from "@/components/layout/BrandProvider";
import { TakeExamPage } from "./TakeExamPage";
import type { CandidateTakeSnapshot, ClientEvent } from "@exam/contracts";
import { permissionsForRole } from "@exam/authz";
import { ApiError } from "@/lib/api";
import { toast } from "sonner";
import { ClientEventBuffer } from "@/lib/clientEventBuffer";
import { getBuffer, setBuffer } from "@/lib/logger";
import { __resetExamTelemetryForTest } from "@/lib/examTelemetry";

/**
 * P3-FSM-0 integration tests — authoritative CandidateTakeSnapshot read path.
 *
 * These tests mock the P3-FSM-0 production endpoint
 *   GET /api/candidate/attempts/:attemptId/take
 * (registered in attempts.candidate.ts:759) and assert that:
 *   - TakeExamPage consumes the real snapshot (not LoadAttemptResponse)
 *   - deriveTakeExamView drives the view from the real snapshot
 *   - locked/submitted/answer-source semantics come from the backend, not
 *     frontend reconstruction
 *
 * These tests must FAIL against the legacy-adapter implementation for the
 * correct architectural reason (the page calls /api/attempts/:id, not the
 * take endpoint; mocks here intercept the take endpoint only).
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
    timingMode: "timed_window",
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
        promptDocument: null,
        answerMode: "plain" as const,
        options: [
          { id: "opt-a", content: "A", contentDocument: null },
          { id: "opt-b", content: "B", contentDocument: null },
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

const { apiGet, apiPost, takeHandler } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  takeHandler: vi.fn(),
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
    // #924: the save path calls postWithMeta; delegate to the same apiPost
    // mock so url/body assertions stay single-sourced. This harness asserts
    // no rejection-id behavior, so the header id is a constant null.
    postWithMeta: async (...args: unknown[]) => ({
      data: await apiPost(...args),
      meta: { requestId: null },
    }),
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

/** Test-only route switch: simulates the candidate leaving attempt att-1. */
function AttemptSwitcher() {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      data-testid="switch-attempt"
      onClick={() => navigate("/exam/exam-1/take/att-2")}
    >
      switch
    </button>
  );
}

function renderPage(options: { withAttemptSwitcher?: boolean } = {}) {
  return render(
    <MemoryRouter initialEntries={["/exam/exam-1/take/att-1"]}>
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
          <LocationProbe />
          <Routes>
            <Route
              path="/exam/:examId/take/:attemptId"
              element={
                options.withAttemptSwitcher ? (
                  <>
                    <TakeExamPage />
                    <AttemptSwitcher />
                  </>
                ) : (
                  <TakeExamPage />
                )
              }
            />
            <Route
              path="/exam/:attemptId/result"
              element={<span>result</span>}
            />
          </Routes>
        </BrandProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

/** Routes GET requests: take endpoint → takeHandler; others fall through. */
function installTakeRoute(snapshot: CandidateTakeSnapshot) {
  apiGet.mockImplementation(async (path: string) => {
    if (typeof path === "string" && path.includes("/candidate/attempts/")) {
      takeHandler(path);
      return snapshot;
    }
    throw new Error(`unexpected GET ${path}`);
  });
  apiPost.mockResolvedValue({ ok: true, serverNow: NOW });
}

beforeEach(() => {
  apiGet.mockReset();
  apiPost.mockReset();
  takeHandler.mockReset();
});

afterEach(() => {
  setBuffer(null);
  __resetExamTelemetryForTest();
  vi.useRealTimers();
});

describe("authoritative snapshot read path", () => {
  it("consumes GET /api/candidate/attempts/:id/take (not /api/attempts/:id)", async () => {
    installTakeRoute(buildSnapshot());
    renderPage();

    await waitFor(() => {
      expect(takeHandler).toHaveBeenCalledWith(
        expect.stringMatching(/\/api\/candidate\/attempts\/att-1\/take$/),
      );
    });
    // The legacy endpoint must NOT be hit.
    expect(
      apiGet.mock.calls.some(
        ([p]) => typeof p === "string" && /^\/api\/attempts\/att-1$/.test(p),
      ),
    ).toBe(false);
  });

  it("renders snapshot question prompt and routes answerValue verbatim from the backend", async () => {
    const snap = buildSnapshot({
      questions: [
        {
          id: "q1",
          type: "single_choice",
          prompt: "Backend-authored prompt",
          promptDocument: null,
          answerMode: "plain" as const,
          options: [{ id: "opt-a", content: "Alpha", contentDocument: null }],
          inputMode: "choice",
          maxScore: 10,
          answerValue: "opt-a",
          answerSource: "draft",
        },
      ],
    });
    installTakeRoute(snap);
    renderPage();

    expect(
      await screen.findByText("Backend-authored prompt"),
    ).toBeInTheDocument();
  });

  // Characterization (UI-MIGRATE-N-W3): the question content surface
  // (take-question-section) is a governed content region wrapping the
  // question prompt and the answer controls. After the surface-content
  // migration it must remain a distinct region holding the prompt and
  // keeping the answer controls reachable. Asserts the durable role, not
  // the raw surface utility classes.
  it("keeps the question content surface region holding the prompt and answer controls", async () => {
    installTakeRoute(buildSnapshot());
    renderPage();
    const section = await screen.findByTestId("take-question-section");
    expect(section).toBeInTheDocument();
    // The prompt renders inside the question content surface.
    expect(section).toHaveTextContent("选择一项");
    // The answer radio controls remain reachable within the surface.
    const radio = await within(section).findByRole("radio", { name: "A" });
    expect(radio).toBeInTheDocument();
  });

  // Characterization (UI-MIGRATE-N-W4B): the question content surface selects
  // the flat `surface-content` recipe. W4B removes the business `shadow-sm`
  // that contradicted this flat-surface contract; the section must keep the
  // `surface-content` class (the durable flat-surface authority), the prompt,
  // and its relative positioning. Asserts the durable surface role, not the
  // removed shadow token.
  it("keeps the question section on the flat surface-content recipe after the shadow removal", async () => {
    installTakeRoute(buildSnapshot());
    renderPage();
    const section = await screen.findByTestId("take-question-section");
    expect(section.className).toContain("surface-content");
    expect(section.className).toContain("relative");
    expect(section).toHaveTextContent("选择一项");
  });

  it("submitted snapshot's frozen answer is displayed from answerSource='submitted', not substituted", async () => {
    const snap = buildSnapshot({
      attemptStatus: "submitted",
      isEditable: false,
      canSave: false,
      canSubmit: false,
      lockReason: "submitted",
      submittedAt: NOW,
      questions: [
        {
          id: "q1",
          type: "single_choice",
          prompt: "frozen",
          promptDocument: null,
          answerMode: "plain" as const,
          options: [
            {
              id: "frozen-answer",
              content: "Frozen Choice",
              contentDocument: null,
            },
            { id: "other", content: "Other", contentDocument: null },
          ],
          inputMode: "choice",
          maxScore: 10,
          // Backend has authoritative frozen value.
          answerValue: "frozen-answer",
          answerSource: "submitted",
        },
      ],
    });
    installTakeRoute(snap);
    renderPage();

    const frozen = await screen.findByRole("radio", { name: "Frozen Choice" });
    // The backend's submitted value is selected; UI must reflect it verbatim.
    expect(frozen).toBeChecked();
  });

  it("refresh reconstructs locked state solely from a newly fetched snapshot", async () => {
    const submitted = buildSnapshot({
      attemptStatus: "submitted",
      isEditable: false,
      canSave: false,
      canSubmit: false,
      lockReason: "submitted",
      submittedAt: NOW,
    });

    installTakeRoute(submitted);
    const { unmount } = renderPage();
    await screen.findByText("选择一项");

    // Inputs must be disabled from the snapshot alone (no local reducer state
    // required to carry the lock).
    expect((await screen.findAllByRole("radio"))[0]).toBeDisabled();

    unmount();

    // Fresh render with a freshly-fetched snapshot.
    installTakeRoute(submitted);
    renderPage();
    expect((await screen.findAllByRole("radio"))[0]).toBeDisabled();
  });

  it("during submitting transient state, repeated submit clicks issue one submit request", async () => {
    installTakeRoute(buildSnapshot());
    // Stall submit so the page stays in the submitting transient state.
    let resolveSubmit!: (v: unknown) => void;
    apiPost.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.includes("/submit")) {
        return new Promise((r) => {
          resolveSubmit = r;
        });
      }
      return { ok: true, serverNow: NOW };
    });

    renderPage();
    await screen.findByText("选择一项");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "交卷" }));
    const dialog = await screen.findByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: "确认交卷" });
    await user.click(confirm);

    // Rapidly click again — must not issue a second /submit.
    await user.click(confirm);
    await user.click(confirm);

    await waitFor(() => {
      const submits = apiPost.mock.calls.filter(
        ([p]) => typeof p === "string" && p.includes("/submit"),
      );
      expect(submits.length).toBe(1);
    });

    resolveSubmit({ ok: true });
  });

  it("save_failed transient does not modify answer source / lock / visibility semantics", async () => {
    // Snapshot is editable initially; a save fails; the snapshot-derived view
    // must remain the sole source of lock/visibility semantics.
    const editable = buildSnapshot();
    installTakeRoute(editable);
    apiPost.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.includes("/answers/")) {
        return {
          accepted: false,
          reason: "STALE_VERSION",
          message: "stale",
          serverVersion: 1,
          savedAt: NOW,
        };
      }
      return { ok: true, serverNow: NOW };
    });

    renderPage();
    const radio = await screen.findByRole("radio", { name: "A" });
    const user = userEvent.setup();
    await user.click(radio);

    // Wait past the 1500ms autosave debounce so the save fires and fails.
    await waitFor(
      () => {
        const saveCalls = apiPost.mock.calls.filter(
          ([p]) => typeof p === "string" && p.includes("/answers/"),
        );
        expect(saveCalls.length).toBeGreaterThan(0);
      },
      { timeout: 4000 },
    );

    // After save failure, the snapshot remains authoritative — control must
    // not become spuriously disabled, and no locally-reconstructed lock state
    // may appear. The attempt is still editable per the snapshot, so the
    // submit button and an enabled radio remain visible.
    expect(screen.getByRole("button", { name: "交卷" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "A" })).not.toBeDisabled();
    // No locked-overlay introduced by frontend state.
    expect(screen.queryByTestId("deadline-overlay")).not.toBeInTheDocument();
  });
});

describe("TakeExamPage behaviors over the snapshot read path", () => {
  it("submit dialog shows unanswered count and submits, then reloads snapshot and navigates", async () => {
    installTakeRoute(buildSnapshot());
    apiPost.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.includes("/submit")) {
        return { ok: true };
      }
      return { ok: true, serverNow: NOW };
    });

    renderPage();
    await screen.findByText("选择一项");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "交卷" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/题未作答/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "确认交卷" }));

    await waitFor(() => {
      expect(screen.getByTestId("current-path")).toHaveTextContent("/result");
    });
    expect(takeHandler.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("displays save-rejection alert when backend rejects with ATTEMPT_ALREADY_SUBMITTED", async () => {
    const snap = buildSnapshot({
      questions: [
        {
          id: "q1",
          type: "fill_blank",
          prompt: "填空题",
          promptDocument: null,
          answerMode: "plain" as const,
          options: [],
          inputMode: "single_line",
          maxScore: 10,
          answerValue: null,
          answerSource: "none",
        },
      ],
    });
    installTakeRoute(snap);
    apiPost.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.includes("/answers/")) {
        return {
          accepted: false,
          reason: "ATTEMPT_ALREADY_SUBMITTED",
          message: "已提交",
          serverVersion: 0,
          savedAt: NOW,
        };
      }
      return { ok: true, serverNow: NOW };
    });

    renderPage();
    const input = await screen.findByLabelText("第1空答案");
    const user = userEvent.setup();
    await user.type(input, "x");

    expect(
      await screen.findByTestId("save-rejection-alert", {}, { timeout: 3000 }),
    ).toBeInTheDocument();
    expect(screen.getByText("考试已结束")).toBeInTheDocument();
  });

  it("shows error state and a retry button when the snapshot endpoint fails", async () => {
    apiGet.mockRejectedValueOnce(new Error("network"));
    renderPage();

    expect(
      await screen.findByText("无法加载答题记录，请检查连接后重试"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
  });

  it("deadline auto-submit fires when effectiveDeadline has passed", async () => {
    // Real timers (matching the original suite's pattern) so apiPost promises
    // resolve and waitFor can observe the submit. The snapshot reports an
    // already-passed effectiveDeadline; the page's deadline checker fires
    // submit on the next tick.
    const serverNow = new Date("2026-07-04T12:00:00Z");
    const expired = buildSnapshot({
      serverNow: serverNow.toISOString(),
      effectiveDeadline: new Date("2026-07-04T11:00:00Z").toISOString(),
    });
    installTakeRoute(expired);
    apiPost.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.includes("/submit")) {
        return { ok: true };
      }
      return { ok: true, serverNow: serverNow.toISOString() };
    });

    renderPage();

    await waitFor(
      () => {
        expect(
          apiPost.mock.calls.some(
            ([p]) => typeof p === "string" && p.includes("/submit"),
          ),
        ).toBe(true);
      },
      { timeout: 4000 },
    );
  });

  it("stale-version rejection reconciles the server-returned answer", async () => {
    const snap = buildSnapshot({
      questions: [
        {
          id: "q1",
          type: "multiple_choice",
          prompt: "多选",
          promptDocument: null,
          answerMode: "plain" as const,
          options: [
            { id: "a", content: "A", contentDocument: null },
            { id: "b", content: "B", contentDocument: null },
          ],
          inputMode: "choice",
          maxScore: 10,
          answerValue: null,
          answerSource: "none",
        },
      ],
    });
    installTakeRoute(snap);
    apiPost.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.includes("/answers/")) {
        return {
          accepted: false,
          reason: "STALE_VERSION",
          message: "stale",
          serverVersion: 3,
          savedAt: NOW,
          details: { serverAnswer: ["a", "b"] },
        };
      }
      return { ok: true, serverNow: NOW };
    });

    renderPage();
    const checkboxes = await screen.findAllByRole("checkbox");
    const user = userEvent.setup();
    await user.click(checkboxes[0]!);

    await waitFor(
      () => {
        expect(
          apiPost.mock.calls.some(
            ([p]) => typeof p === "string" && p.includes("/answers/"),
          ),
        ).toBe(true);
      },
      { timeout: 3000 },
    );
    // Give the STALE reconcile state update time to flush.
    await waitFor(
      () => {
        const boxes = screen.getAllByRole("checkbox");
        expect(boxes[0]).toBeChecked();
        expect(boxes[1]).toBeChecked();
      },
      { timeout: 3000 },
    );
  });

  it("flag toggle marks the current question as flagged", async () => {
    installTakeRoute(buildSnapshot());
    renderPage();
    await screen.findByText("选择一项");

    // The question-section flag button is the one inside take-question-section;
    // it lives next to the score. Scope to that section to disambiguate from
    // the footer flag button.
    const section = screen.getByTestId("take-question-section");
    const user = userEvent.setup();
    const flagBtn = within(section).getByRole("button", { name: /标记/ });
    await user.click(flagBtn);

    expect(
      within(section).getByRole("button", { name: /取消标记/ }),
    ).toBeInTheDocument();
  });

  it("submit dialog blocks confirm while a save is flushing, then enables after", async () => {
    const snap = buildSnapshot({
      questions: [
        {
          id: "q1",
          type: "fill_blank",
          prompt: "填空",
          promptDocument: null,
          answerMode: "plain" as const,
          options: [],
          inputMode: "single_line",
          maxScore: 10,
          answerValue: null,
          answerSource: "none",
        },
      ],
    });
    installTakeRoute(snap);
    let resolveSave!: (v: unknown) => void;
    apiPost.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.includes("/answers/")) {
        return new Promise((r) => {
          resolveSave = r;
        });
      }
      return { ok: true };
    });

    renderPage();
    const input = await screen.findByLabelText("第1空答案");
    const user = userEvent.setup();
    await user.type(input, "x");
    await user.click(screen.getByRole("button", { name: "交卷" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/保存中/)).toBeInTheDocument();
    const confirm = within(dialog).getByRole("button", { name: "确认交卷" });
    expect(confirm).toBeDisabled();

    resolveSave({ accepted: true, serverVersion: 1, savedAt: NOW });
    await waitFor(() => {
      expect(within(dialog).queryByText(/保存中/)).not.toBeInTheDocument();
    });
    expect(confirm).toBeEnabled();
  });

  it("network save failure reports connection abnormal; snapshot authority unchanged", async () => {
    installTakeRoute(buildSnapshot());
    apiPost.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.includes("/answers/")) {
        throw new Error("offline");
      }
      return { ok: true, serverNow: NOW };
    });

    renderPage();
    const radio = await screen.findByRole("radio", { name: "A" });
    const user = userEvent.setup();
    await user.click(radio);

    expect(
      await screen.findByText("连接异常", {}, { timeout: 3000 }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "交卷" })).toBeInTheDocument();
  });
});
describe("submit dialog fact weighting (S3.4)", () => {
  function fillBlank(id: string) {
    return {
      id,
      type: "fill_blank" as const,
      prompt: `填空 ${id}`,
      promptDocument: null,
      answerMode: "plain" as const,
      options: [],
      inputMode: "single_line" as const,
      maxScore: 10,
      answerValue: null,
      answerSource: "none" as const,
    };
  }

  function factRow(testId: string) {
    return screen.getByTestId(testId);
  }

  function ackSaves() {
    return apiPost.mock.calls.filter(
      ([p]) => typeof p === "string" && p.includes("/answers/"),
    );
  }

  async function openSubmitDialog() {
    const user = userEvent.setup();
    await user.click(screen.getByTestId("take-submit-btn"));
    await screen.findByRole("dialog");
  }

  it("weakens all three facts when every count is zero and keeps confirm enabled", async () => {
    installTakeRoute(buildSnapshot({ questions: [fillBlank("q1")] }));
    apiPost.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.includes("/answers/")) {
        return { accepted: true, serverVersion: 1, savedAt: NOW };
      }
      return { ok: true, serverNow: NOW };
    });

    renderPage();
    const input = await screen.findByLabelText("第1空答案");
    const user = userEvent.setup();
    await user.type(input, "x");
    // Wait for the ACK so the flush result reports all-zero counts.
    await waitFor(
      () => {
        expect(ackSaves()).toHaveLength(1);
      },
      { timeout: 4000 },
    );

    await openSubmitDialog();
    await waitFor(() => {
      expect(factRow("submit-fact-unanswered")).toBeInTheDocument();
    });

    // All three facts remain (S3.4: 三个事实全保留) — as quiet rows.
    for (const testId of [
      "submit-fact-unanswered",
      "submit-fact-unsaved",
      "submit-fact-save-failed",
    ]) {
      const row = factRow(testId);
      expect(row).not.toHaveAttribute("data-feedback-tone");
      expect(row.className).toContain("type-secondary");
    }
    // Zero risk → the confirm gate stays the plain enabled confirm.
    expect(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "确认交卷",
      }),
    ).toBeEnabled();
    expect(
      within(screen.getByRole("dialog")).queryByRole("button", {
        name: "仍然提交",
      }),
    ).not.toBeInTheDocument();
  });

  it("marks a non-zero unanswered count with the info tone and an icon while zeros stay quiet", async () => {
    installTakeRoute(
      buildSnapshot({ questions: [fillBlank("q1"), fillBlank("q2")] }),
    );
    apiPost.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.includes("/answers/")) {
        return { accepted: true, serverVersion: 1, savedAt: NOW };
      }
      return { ok: true, serverNow: NOW };
    });

    renderPage();
    const input = await screen.findByLabelText("第1空答案");
    const user = userEvent.setup();
    await user.type(input, "x");
    await waitFor(
      () => {
        expect(ackSaves()).toHaveLength(1);
      },
      { timeout: 4000 },
    );

    await openSubmitDialog();
    await waitFor(() => {
      expect(factRow("submit-fact-unanswered")).toBeInTheDocument();
    });

    const unanswered = factRow("submit-fact-unanswered");
    expect(unanswered).toHaveAttribute("data-feedback-tone", "info");
    // Not color alone: the toned row carries an icon and the full fact text.
    expect(unanswered.querySelector("svg")).not.toBeNull();
    expect(unanswered).toHaveTextContent("未答题：1 题未作答");
    for (const testId of ["submit-fact-unsaved", "submit-fact-save-failed"]) {
      expect(factRow(testId)).not.toHaveAttribute("data-feedback-tone");
    }
    // An unanswered question is a decision fact, not a save failure — the
    // confirm gate must stay enabled (S3.4: 不得放宽交卷门控).
    expect(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "确认交卷",
      }),
    ).toBeEnabled();
  });

  it("marks the save-failed count with the destructive tone and keeps the override gate intact", async () => {
    installTakeRoute(buildSnapshot({ questions: [fillBlank("q1")] }));
    apiPost.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.includes("/answers/")) {
        throw new Error("offline");
      }
      return { ok: true, serverNow: NOW };
    });

    renderPage();
    const input = await screen.findByLabelText("第1空答案");
    const user = userEvent.setup();
    await user.type(input, "x");
    await waitFor(
      () => {
        expect(screen.getByText("保存失败")).toBeInTheDocument();
      },
      { timeout: 4000 },
    );

    await openSubmitDialog();
    // The dialog flush retries the failed save, which fails again offline.
    await waitFor(() => {
      expect(factRow("submit-fact-save-failed")).toBeInTheDocument();
    });

    const saveFailed = factRow("submit-fact-save-failed");
    expect(saveFailed).toHaveAttribute("data-feedback-tone", "destructive");
    expect(saveFailed.querySelector("svg")).not.toBeNull();
    expect(saveFailed).toHaveTextContent("保存失败：1 题");
    // The unsaved count includes the failed question → caution tone.
    expect(factRow("submit-fact-unsaved")).toHaveAttribute(
      "data-feedback-tone",
      "caution",
    );
    // Zero counts stay quiet.
    expect(factRow("submit-fact-unanswered")).not.toHaveAttribute(
      "data-feedback-tone",
    );
    // The necessary warning text is retained (S3.4: 不得删除必要警告).
    expect(
      within(screen.getByRole("dialog")).getByText(
        "部分答案保存失败，请继续答题后重新保存或确认仍然提交。",
      ),
    ).toBeInTheDocument();
    // Non-zero failed saves gate the plain confirm and offer the override.
    expect(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "确认交卷",
      }),
    ).toBeDisabled();
    expect(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "仍然提交",
      }),
    ).toBeEnabled();
  });
});

describe("submit-freeze UI proof", () => {
  it("save execution seam reads derived canSave, keeps the control disabled, and skips the API call when the snapshot is non-editable", async () => {
    // Requirement: "view.canSave === false => save endpoint is not called",
    // and a disabled control alone is not sufficient proof. The page guards the
    // save execution seam with `if (!viewRef.current?.canSave) return;`.
    //
    // Prove the guard: render with a submitted/non-editable snapshot,
    // then drive the autosave path by typing into the (disabled) input
    // via a direct DOM event — and assert no /answers/ POST fires through
    // the full debounce window. This proves the guard at the execution
    // seam, not merely the disabled attribute.
    const submitted = buildSnapshot({
      attemptStatus: "submitted",
      isEditable: false,
      canSave: false,
      canSubmit: false,
      lockReason: "submitted",
      submittedAt: NOW,
      questions: [
        {
          id: "q1",
          type: "fill_blank",
          prompt: "frozen",
          promptDocument: null,
          answerMode: "plain" as const,
          options: [],
          inputMode: "single_line",
          maxScore: 10,
          answerValue: "old",
          answerSource: "submitted",
        },
      ],
    });
    installTakeRoute(submitted);

    renderPage();
    await screen.findByText("frozen");

    // The control itself must be disabled (INVARIANT half of the contract);
    // the seam guard below is what actually protects the save endpoint.
    expect(screen.getByLabelText("第1空答案")).toBeDisabled();

    // The input is disabled; even if a save were scheduled by some path,
    // the execution seam must refuse it. Wait through the debounce window.
    await waitFor(
      () => {
        const saveCalls = apiPost.mock.calls.filter(
          ([p]) => typeof p === "string" && p.includes("/answers/"),
        );
        expect(saveCalls).toHaveLength(0);
      },
      { timeout: 2500 },
    );
  });

  it("save execution seam allows the API call when canSave is true (control)", async () => {
    // Control case proving the path is reachable and the guard is decisive:
    // with canSave=true, the same autosave path DOES issue a save.
    const editable = buildSnapshot({
      questions: [
        {
          id: "q1",
          type: "fill_blank",
          prompt: "open",
          promptDocument: null,
          answerMode: "plain" as const,
          options: [],
          inputMode: "single_line",
          maxScore: 10,
          answerValue: null,
          answerSource: "none",
        },
      ],
    });
    installTakeRoute(editable);

    renderPage();
    const input = await screen.findByLabelText("第1空答案");
    const user = userEvent.setup();
    await user.type(input, "x");

    await waitFor(
      () => {
        const saveCalls = apiPost.mock.calls.filter(
          ([p]) => typeof p === "string" && p.includes("/answers/"),
        );
        expect(saveCalls.length).toBeGreaterThan(0);
      },
      { timeout: 3000 },
    );
  });
});

describe("deadline auto-submit trigger declaration and result recording (F16)", () => {
  const T0 = new Date("2026-07-04T10:00:00.000Z");
  const T0_ISO = T0.toISOString();
  const nearDeadline = new Date(T0.getTime() + 3_000).toISOString();

  /** Recording telemetry buffer (same persistence seam as the saveFault suite). */
  function installRecordingBuffer() {
    const send = vi.fn(async (events: ClientEvent[]) => ({
      acknowledgedCount: events.length,
      rejected: [],
    }));
    setBuffer(
      new ClientEventBuffer({
        send,
        batchSize: 100,
        flushIntervalMs: 0,
      }),
    );
    return send;
  }

  async function flushAll(): Promise<void> {
    await getBuffer().flush();
  }

  /** All buffered exam_telemetry records with the given event name. */
  function telemetryEvents(
    send: ReturnType<typeof vi.fn>,
    name: string,
  ): Array<Record<string, unknown>> {
    const out: Array<Record<string, unknown>> = [];
    for (const call of send.mock.calls) {
      for (const ev of call[0] as Array<Record<string, unknown>>) {
        if (ev.kind === "exam_telemetry" && ev.name === name) out.push(ev);
      }
    }
    return out;
  }

  /** A /submit POST that stays in flight until the test settles it. */
  interface DeferredSubmit {
    promise: Promise<unknown>;
    reject: (err: unknown) => void;
  }

  function deferredSubmit(): DeferredSubmit {
    let reject!: (err: unknown) => void;
    const promise = new Promise<unknown>((_, rej) => {
      reject = rej;
    });
    return { promise, reject: (err: unknown) => reject(err) };
  }

  function submitPostCount(): number {
    return apiPost.mock.calls.filter(
      ([p]) => typeof p === "string" && p.includes("/submit"),
    ).length;
  }

  /**
   * The dialog and timer entries invoke `void handleSubmit()` and DELIBERATELY
   * discard the submit failure (the toast is the candidate feedback). Node
   * raises that discarded rejection as a global unhandled rejection, and
   * vitest's own listener would fail the run for it. This capture attaches a
   * second listener for the duration of one test: vitest's handler explicitly
   * yields when another listener exists ("assume that it's handled by user
   * code"), and the capture keeps the discard ASSERTED (exact count) instead
   * of silently suppressed.
   */
  function captureDiscardedSubmitRejections() {
    const discarded: unknown[] = [];
    const listener = (err: unknown) => {
      discarded.push(err);
    };
    process.on("unhandledRejection", listener);
    return {
      discarded,
      stop() {
        process.off("unhandledRejection", listener);
      },
    };
  }

  /** Fake timers pinned at T0 so the server clock offset is zero. */
  function renderWithFakeClock(
    options: { withAttemptSwitcher?: boolean } = {},
  ) {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    return renderPage(options);
  }

  it("deadline tick with the user's submit POST in flight: no phantom success, episode re-arms once idle, real failure surfaces the retry entry", async () => {
    const send = installRecordingBuffer();
    const capture = captureDiscardedSubmitRejections();
    try {
      // timingMode "deadline" mounts no ExamTimer: the page's 1s tick is the
      // only trigger, isolating the effect-vs-in-flight-submit interleave.
      const editable = buildSnapshot({
        timingMode: "deadline",
        serverNow: T0_ISO,
        effectiveDeadline: nearDeadline,
      });
      // The frozen snapshot the authoritative re-read returns after the
      // terminal heartbeat (lockReason 'deadline' = locked pre-reconcile).
      // serverNow is the SERVER's live clock — past the deadline — so the
      // re-read does not re-base the client clock backwards below it.
      const locked = buildSnapshot({
        timingMode: "deadline",
        serverNow: new Date(T0.getTime() + 35_000).toISOString(),
        effectiveDeadline: nearDeadline,
        isEditable: false,
        canSave: false,
        canSubmit: false,
        lockReason: "deadline",
      });
      let takeCalls = 0;
      apiGet.mockImplementation(async (path: string) => {
        if (typeof path === "string" && path.includes("/candidate/attempts/")) {
          takeHandler(path);
          takeCalls += 1;
          return takeCalls === 1 ? editable : locked;
        }
        throw new Error(`unexpected GET ${path}`);
      });
      const pendingSubmits: DeferredSubmit[] = [];
      apiPost.mockImplementation(async (path: string) => {
        if (typeof path === "string" && path.includes("/submit")) {
          const d = deferredSubmit();
          pendingSubmits.push(d);
          return d.promise;
        }
        if (typeof path === "string" && path.includes("/heartbeat")) {
          // Past the deadline the server froze the attempt; the terminal
          // heartbeat is the authority signal that drives the re-read.
          throw new ApiError(
            409,
            "attempt no longer in_progress",
            "INVALID_STATE_TRANSITION",
          );
        }
        return { ok: true, serverNow: T0_ISO };
      });

      renderWithFakeClock();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(takeCalls).toBe(1);

      // User submit: dialog open → confirm; the POST stalls in flight.
      fireEvent.click(screen.getByTestId("take-submit-btn"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      fireEvent.click(
        within(screen.getByRole("dialog")).getByTestId("confirm-submit-btn"),
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(pendingSubmits).toHaveLength(1);

      // The deadline passes while the user's POST is still in flight.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_100);
      });
      // The tick must not double-submit…
      expect(pendingSubmits).toHaveLength(1);
      // …must not declare an episode it did not start…
      expect(
        telemetryEvents(send, "deadline_auto_submit_started"),
      ).toHaveLength(0);
      // …and above all must not record success for a submit that never ran.
      await flushAll();
      expect(
        telemetryEvents(send, "deadline_auto_submit_success"),
      ).toHaveLength(0);

      // The user's POST settles FAILED: submittingRef is released again.
      await act(async () => {
        pendingSubmits[0]!.reject(new Error("network down"));
        await vi.advanceTimersByTimeAsync(0);
      });

      // Next tick (submit idle) REALLY initiates the deadline auto-submit.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_100);
      });
      expect(pendingSubmits).toHaveLength(2);

      // That real auto-submit fails → the failure branch records real results.
      await act(async () => {
        pendingSubmits[1]!.reject(new Error("network down"));
        await vi.advanceTimersByTimeAsync(0);
      });
      await flushAll();
      expect(
        telemetryEvents(send, "deadline_auto_submit_started"),
      ).toHaveLength(1);
      const failures = telemetryEvents(send, "deadline_auto_submit_failed");
      expect(failures).toHaveLength(1);
      expect((failures[0]!.metadata as { stage?: string }).stage).toBe(
        "submit",
      );
      expect(
        telemetryEvents(send, "deadline_auto_submit_success"),
      ).toHaveLength(0);
      expect(toast.error).toHaveBeenCalledWith("自动提交失败，请点击重试");
      // Exactly the dialog-invoked user submit is discarded by production's
      // fire-and-forget; the auto-submit flow handles its own failure.
      expect(capture.discarded).toHaveLength(1);

      // Dismiss the still-open submit dialog: while it is open, Radix
      // aria-hides the page around it, which blanks the lock overlay's
      // accessibility subtree for role queries.
      fireEvent.click(
        within(screen.getByRole("dialog")).getByRole("button", {
          name: "继续答题",
        }),
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      // Heartbeat 409 → authoritative re-read locks the page; with the real
      // failure recorded, the lock overlay offers the candidate a retry entry.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
      expect(takeCalls).toBe(2);
      const overlay = screen.getByTestId("deadline-overlay");
      expect(overlay).toHaveAttribute("data-lock-reason", "deadline");
      expect(
        within(overlay).getByRole("button", { name: "重试提交" }),
      ).toBeInTheDocument();
    } finally {
      capture.stop();
    }
  });

  it("attempt switch during the pre-submit flush: no submit for the abandoned attempt, no cross-attempt UI or telemetry", async () => {
    const send = installRecordingBuffer();
    const editableA = buildSnapshot({
      attemptId: "att-1",
      timingMode: "deadline",
      serverNow: T0_ISO,
      effectiveDeadline: nearDeadline,
    });
    const editableB = buildSnapshot({
      attemptId: "att-2",
      timingMode: "deadline",
      serverNow: T0_ISO,
      effectiveDeadline: new Date(T0.getTime() + 600_000).toISOString(),
    });
    apiGet.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.includes("/attempts/att-1/")) {
        takeHandler(path);
        return editableA;
      }
      if (typeof path === "string" && path.includes("/attempts/att-2/")) {
        takeHandler(path);
        return editableB;
      }
      throw new Error(`unexpected GET ${path}`);
    });

    // A save POST that stays in flight: the deadline auto-submit's flush()
    // awaits exactly this promise.
    let resolveSave!: () => void;
    const saveGate = new Promise<unknown>((resolve) => {
      resolveSave = () =>
        resolve({ accepted: true, serverVersion: 1, savedAt: T0_ISO });
    });
    const pendingSubmits: DeferredSubmit[] = [];
    apiPost.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.includes("/answers/")) {
        return saveGate;
      }
      if (typeof path === "string" && path.includes("/submit")) {
        const d = deferredSubmit();
        pendingSubmits.push(d);
        return d.promise;
      }
      return { ok: true, serverNow: T0_ISO };
    });

    renderWithFakeClock({ withAttemptSwitcher: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(takeHandler).toHaveBeenCalledWith(expect.stringContaining("att-1"));

    fireEvent.click(screen.getByRole("radio", { name: "A" }));
    // Debounce fires: the save POST is in flight.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_600);
    });
    // The deadline passes: the episode is declared and flush() starts
    // awaiting the in-flight save.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_600);
    });
    await flushAll();
    expect(telemetryEvents(send, "deadline_auto_submit_started")).toHaveLength(
      1,
    );

    // The candidate leaves att-1 for att-2 while the flush is still awaiting.
    fireEvent.click(screen.getByTestId("switch-attempt"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByTestId("current-path")).toHaveTextContent(
      "/exam/exam-1/take/att-2",
    );

    // The abandoned flush finally settles.
    await act(async () => {
      resolveSave();
      await vi.advanceTimersByTimeAsync(0);
    });
    await flushAll();

    // The stale episode must not submit att-1, must not record a success for
    // it, and must not write its submit state onto att-2's page.
    expect(pendingSubmits).toHaveLength(0);
    expect(telemetryEvents(send, "submit_requested")).toHaveLength(0);
    expect(telemetryEvents(send, "deadline_auto_submit_success")).toHaveLength(
      0,
    );
    expect(screen.getByTestId("current-path")).toHaveTextContent(
      "/exam/exam-1/take/att-2",
    );
  });

  it("ExamTimer onTimeout and the deadline effect in the same window: one declaration, one submit POST, one real failure record", async () => {
    const send = installRecordingBuffer();
    const capture = captureDiscardedSubmitRejections();
    try {
      // timed_window mounts ExamTimer: at the deadline instant its onTimeout
      // and the page's 1s tick fire in the same window — one episode, not two
      // competing flows (the two triggers must not double-declare/submit).
      installTakeRoute(
        buildSnapshot({
          timingMode: "timed_window",
          serverNow: T0_ISO,
          effectiveDeadline: nearDeadline,
        }),
      );
      const pendingSubmits: DeferredSubmit[] = [];
      apiPost.mockImplementation(async (path: string) => {
        if (typeof path === "string" && path.includes("/submit")) {
          const d = deferredSubmit();
          pendingSubmits.push(d);
          return d.promise;
        }
        return { ok: true, serverNow: T0_ISO };
      });

      renderWithFakeClock();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      // Cross the deadline: both triggers land in the same window.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_100);
      });
      // Exactly one submit POST, declared by exactly one episode.
      expect(pendingSubmits).toHaveLength(1);
      await flushAll();
      expect(
        telemetryEvents(send, "deadline_auto_submit_started"),
      ).toHaveLength(1);
      expect(
        telemetryEvents(send, "deadline_auto_submit_success"),
      ).toHaveLength(0);

      // The auto-submit POST fails; later ticks must not re-submit.
      await act(async () => {
        pendingSubmits[0]!.reject(new Error("network down"));
        await vi.advanceTimersByTimeAsync(1_100);
      });
      expect(pendingSubmits).toHaveLength(1);
      await flushAll();
      const failures = telemetryEvents(send, "deadline_auto_submit_failed");
      expect(failures).toHaveLength(1);
      expect((failures[0]!.metadata as { stage?: string }).stage).toBe(
        "submit",
      );
      expect(toast.error).toHaveBeenCalledWith("自动提交失败，请点击重试");
      // The unified flow awaits its own submit, so nothing is discarded.
      expect(capture.discarded).toHaveLength(0);
    } finally {
      capture.stop();
    }
  });
});
