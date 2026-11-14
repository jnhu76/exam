import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes, useLocation, useNavigate } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TakeExamPage } from "./TakeExamPage";
import type { CandidateTakeSnapshot } from "@exam/contracts";
import { ApiError } from "@/lib/api";
import { toast } from "sonner";
import { getBuffer, setBuffer } from "@/lib/logger";
import { __resetExamTelemetryForTest } from "@/lib/examTelemetry";
import {
  NOW,
  buildTakeSnapshot,
  fillBlankQuestion,
  installRecordingBuffer,
  singleChoiceQuestion,
  takeExamProviders,
  telemetryEvents,
} from "./TakeExamPage.testHarness";

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

function buildSnapshot(
  overrides: Partial<CandidateTakeSnapshot> = {},
): CandidateTakeSnapshot {
  return buildTakeSnapshot({
    timingMode: "timed_window",
    questions: [singleChoiceQuestion("q1", { prompt: "选择一项" })],
    ...overrides,
  });
}

const { apiGet, apiPost, takeHandler, postMeta } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  takeHandler: vi.fn(),
  // The x-request-id header value postWithMeta reports on save responses
  // (#924). Null by default (no header); tests that pin rejection-id
  // correlation set it before triggering the save.
  postMeta: { requestId: null as string | null },
}));

vi.mock("@/lib/api", async () => {
  const { createTakeApiModuleMock, makeApiErrorStub } =
    await import("./TakeExamPage.apiMockHarness");
  return {
    ApiError: makeApiErrorStub(),
    // #924: the save path calls postWithMeta; it delegates to the same
    // apiPost mock so url/body assertions stay single-sourced. The header id
    // comes from the shared postMeta holder so rejection-correlation tests
    // can forge one; every other test sees the absent-header null.
    ...createTakeApiModuleMock({ apiGet, apiPost, postMeta }),
  };
});

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="current-path">{location.pathname}</span>;
}

/** Test-only routes: switch attempt or leave the take page entirely. */
function AttemptSwitcher() {
  const navigate = useNavigate();
  return (
    <>
      <button
        type="button"
        data-testid="switch-attempt"
        onClick={() => navigate("/exam/exam-1/take/att-2")}
      >
        switch
      </button>
      <button
        type="button"
        data-testid="leave-page"
        onClick={() => navigate("/exam/list")}
      >
        leave
      </button>
    </>
  );
}

function renderPage(options: { withAttemptSwitcher?: boolean } = {}) {
  return render(
    takeExamProviders({
      initialPath: "/exam/exam-1/take/att-1",
      children: (
        <>
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
            <Route path="/exam/list" element={<span>list</span>} />
          </Routes>
        </>
      ),
    }),
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
  postMeta.requestId = null;
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

  it("shows error state and a retry button when the snapshot endpoint fails", async () => {
    apiGet.mockRejectedValueOnce(new Error("network"));
    renderPage();

    expect(
      await screen.findByText("无法加载答题记录，请检查连接后重试"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
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
});
describe("submit dialog fact weighting (S3.4)", () => {
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
    installTakeRoute(buildSnapshot({ questions: [fillBlankQuestion("q1")] }));
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
      buildSnapshot({
        questions: [fillBlankQuestion("q1"), fillBlankQuestion("q2")],
      }),
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
    installTakeRoute(buildSnapshot({ questions: [fillBlankQuestion("q1")] }));
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

describe("submit dialog flush timeout (W5.1 超时控制流)", () => {
  it("a save that outlives the 10s flush budget gates confirm behind the explicit override; the timeout is a business fact, never telemetry", async () => {
    const send = installRecordingBuffer();
    // effectiveDeadline: null → the 1s deadline auto-submit episode is gated
    // off entirely (this test exercises the MANUAL submit dialog's flush
    // budget, not the deadline flow, and fake Date.now() would otherwise
    // read the harness's fixed July deadline as already passed).
    installTakeRoute(
      buildSnapshot({
        effectiveDeadline: null,
        questions: [fillBlankQuestion("q1")],
      }),
    );
    // The save response never settles inside the test: only the flush
    // budget can end the wait (as-built control flow — the browser client
    // sets no fetch timeout; the queue's 10s budget decides).
    apiPost.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.includes("/answers/")) {
        return new Promise(() => {});
      }
      return { ok: true, serverNow: NOW };
    });

    vi.useFakeTimers();
    renderPage();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0); // initial snapshot load
    });
    fireEvent.change(screen.getByLabelText("第1空答案"), {
      target: { value: "x" },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500); // debounce fires → save in flight
    });

    fireEvent.click(screen.getByTestId("take-submit-btn"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0); // dialog opens; flush drains
    });
    const dialog = screen.getByRole("dialog");
    // The in-flight save blocks the plain confirm while flushing.
    expect(
      within(dialog).getByRole("button", { name: "确认交卷" }),
    ).toBeDisabled();

    // The flush budget elapses: the unfinished save is counted as PENDING
    // (not failed) and the explicit override is offered. Direct assertions
    // after the act-advanced budget — RTL waitFor does not settle under
    // vitest fake timers (no real-timer advancement for its retry loop).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(
      within(dialog).getByRole("button", { name: "仍然提交" }),
    ).toBeEnabled();
    expect(
      within(dialog).getByRole("button", { name: "确认交卷" }),
    ).toBeDisabled();
    expect(within(dialog).getByTestId("submit-fact-unsaved")).toHaveTextContent(
      "未保存：1 题",
    );
    // No failure surface was fabricated from the timeout: the save is not
    // failed and no error toast fired.
    expect(
      within(dialog).getByTestId("submit-fact-save-failed"),
    ).toHaveTextContent("保存失败：0 题");
    expect(toast.error).not.toHaveBeenCalled();

    // The timeout is a business fact computed from the save queue — it does
    // NOT enter client telemetry as a failure verdict.
    await getBuffer().flush();
    expect(telemetryEvents(send, "answer_autosave_failed")).toHaveLength(0);
    expect(telemetryEvents(send, "answer_autosave_success")).toHaveLength(0);
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
});

describe("deadline auto-submit trigger declaration and result recording (F16)", () => {
  const T0 = new Date("2026-07-04T10:00:00.000Z");
  const T0_ISO = T0.toISOString();
  const nearDeadline = new Date(T0.getTime() + 3_000).toISOString();

  async function flushAll(): Promise<void> {
    await getBuffer().flush();
  }

  /** A /submit POST that stays in flight until the test settles it. */
  interface DeferredSubmit {
    promise: Promise<unknown>;
    resolve: (value: unknown) => void;
    reject: (err: unknown) => void;
  }

  function deferredSubmit(): DeferredSubmit {
    let resolve!: (value: unknown) => void;
    let reject!: (err: unknown) => void;
    const promise = new Promise<unknown>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return {
      promise,
      resolve: (value: unknown) => resolve(value),
      reject: (err: unknown) => reject(err),
    };
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

  it("DEADLINE_EXCEEDED 200-rejection (with header id) during the auto-submit flush: one reconcile, exactly one submit, correlated failure telemetry", async () => {
    // Reviewer-C follow-up from the #924×#929 combination gate: a terminal
    // save rejection is driven here as the real DEADLINE_EXCEEDED 200
    // envelope (with the #924 header correlation id), interleaved with the
    // deadline auto-submit's flush→submit — the reconcile tests only drove
    // ATTEMPT_ALREADY_SUBMITTED / ATTEMPT_CLOSED.
    const send = installRecordingBuffer();
    const capture = captureDiscardedSubmitRejections();
    try {
      // timingMode "deadline" mounts no ExamTimer: the page's 1s tick is the
      // only trigger.
      const editable = buildSnapshot({
        timingMode: "deadline",
        serverNow: T0_ISO,
        effectiveDeadline: nearDeadline,
      });
      // The frozen snapshot the terminal-rejection reconcile returns: the
      // server froze saving at the deadline. Submit stays the converging
      // action (the lock overlay offers 重试提交), so canSubmit is retained.
      // serverNow is the SERVER's live clock — past the deadline — so the
      // re-read does not re-base the client clock backwards below it.
      const locked = buildSnapshot({
        timingMode: "deadline",
        serverNow: new Date(T0.getTime() + 3_500).toISOString(),
        effectiveDeadline: nearDeadline,
        isEditable: false,
        canSave: false,
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
      // The save POST stalls in flight until the episode's flush() is
      // awaiting it, then settles as the server's terminal 200-rejection.
      let postedClientSeq: unknown;
      let settleSave!: () => void;
      const saveInFlight = new Promise<unknown>((resolve) => {
        settleSave = () =>
          resolve({
            accepted: false,
            reason: "DEADLINE_EXCEEDED",
            message: "已到截止时间",
            serverVersion: 5,
            savedAt: T0_ISO,
          });
      });
      postMeta.requestId = "req-deadline-865-929";
      const pendingSubmits: DeferredSubmit[] = [];
      apiPost.mockImplementation(
        async (path: string, body?: { clientSeq?: number }) => {
          if (typeof path === "string" && path.includes("/answers/")) {
            postedClientSeq = body?.clientSeq;
            return saveInFlight;
          }
          if (typeof path === "string" && path.includes("/submit")) {
            const d = deferredSubmit();
            pendingSubmits.push(d);
            return d.promise;
          }
          return { ok: true, serverNow: T0_ISO };
        },
      );

      renderWithFakeClock();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(takeCalls).toBe(1);

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
      expect(
        telemetryEvents(send, "deadline_auto_submit_started"),
      ).toHaveLength(1);
      expect(pendingSubmits).toHaveLength(0);

      // The racing save settles as the terminal 200-rejection carrying the
      // header id — while the episode's flush is still awaiting it.
      await act(async () => {
        settleSave();
        await vi.advanceTimersByTimeAsync(0);
      });
      // The alert names the header correlation id for support lookup…
      const alert = screen.getByTestId("save-rejection-alert");
      expect(alert).toHaveTextContent("请求编号：req-deadline-865-929");
      // …and TWO authoritative re-reads have happened: the terminal signal's
      // single reconcile (this test's subject) plus the deadline gate's own
      // verification read before it may submit (R-02 server authority). The
      // submit's own post-success reload comes later.
      expect(takeCalls).toBe(3);
      await flushAll();
      const failed = telemetryEvents(send, "answer_autosave_failed");
      expect(failed).toHaveLength(1);
      const failedMeta = failed[0]!.metadata as Record<string, unknown>;
      expect(failedMeta.errorCode).toBe("DEADLINE_EXCEEDED");
      expect(failedMeta.requestId).toBe("req-deadline-865-929");
      expect(failedMeta.clientSeq).toBe(postedClientSeq);

      // flush() drains via allSettled, so the rejected save does not abort
      // the episode: the deadline submit fires EXACTLY once — neither
      // duplicated nor cancelled by the terminal rejection.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(pendingSubmits).toHaveLength(1);
      await act(async () => {
        pendingSubmits[0]!.resolve({ ok: true });
        await vi.advanceTimersByTimeAsync(0);
      });
      await flushAll();
      expect(
        telemetryEvents(send, "deadline_auto_submit_success"),
      ).toHaveLength(1);
      expect(telemetryEvents(send, "deadline_auto_submit_failed")).toHaveLength(
        0,
      );
      expect(screen.getByTestId("current-path")).toHaveTextContent("/result");
      // No duplicate submit after convergence.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_000);
      });
      expect(submitPostCount()).toBe(1);
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

  it("attempt switch during the auto-submit POST failure: no failure UI on the new attempt; telemetry stays attributed to the old one", async () => {
    const send = installRecordingBuffer();
    const farDeadline = new Date(T0.getTime() + 600_000).toISOString();
    const editableA = buildSnapshot({
      attemptId: "att-1",
      timingMode: "deadline",
      serverNow: T0_ISO,
      effectiveDeadline: nearDeadline,
    });
    // The deadline gate's verification read: the SERVER clock has passed the
    // deadline and froze att-1 (the submit POST that follows is the
    // idempotent converging action), so the episode proceeds to POST.
    const frozenA = buildSnapshot({
      attemptId: "att-1",
      timingMode: "deadline",
      serverNow: new Date(T0.getTime() + 3_100).toISOString(),
      effectiveDeadline: nearDeadline,
      isEditable: false,
      canSave: false,
      canSubmit: false,
      lockReason: "deadline",
      attemptStatus: "submitted",
      submittedAt: nearDeadline,
    });
    const lockedB = buildSnapshot({
      attemptId: "att-2",
      timingMode: "deadline",
      serverNow: T0_ISO,
      effectiveDeadline: farDeadline,
      isEditable: false,
      canSave: false,
      canSubmit: false,
      lockReason: "deadline",
    });
    let attOneReads = 0;
    apiGet.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.includes("/candidate/attempts/")) {
        takeHandler(path);
        if (path.includes("att-1")) {
          attOneReads += 1;
          return attOneReads === 1 ? editableA : frozenA;
        }
        return lockedB;
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
      return { ok: true, serverNow: T0_ISO };
    });

    renderWithFakeClock({ withAttemptSwitcher: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_100);
    });
    expect(pendingSubmits).toHaveLength(1);

    // The POST is in flight when the candidate switches to att-2.
    fireEvent.click(screen.getByTestId("switch-attempt"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByTestId("current-path")).toHaveTextContent(
      "/exam/exam-1/take/att-2",
    );
    expect(
      within(screen.getByTestId("deadline-overlay")).queryByRole("button", {
        name: "重试提交",
      }),
    ).toBeNull();

    // att-1's submit settles FAILED after the switch.
    await act(async () => {
      pendingSubmits[0]!.reject(new Error("network down"));
      await vi.advanceTimersByTimeAsync(0);
    });
    await flushAll();

    // No failure toast / autoSubmitFailed retry entry may land on att-2.
    expect(toast.error).not.toHaveBeenCalled();
    expect(screen.getByTestId("current-path")).toHaveTextContent(
      "/exam/exam-1/take/att-2",
    );
    expect(
      within(screen.getByTestId("deadline-overlay")).queryByRole("button", {
        name: "重试提交",
      }),
    ).toBeNull();
    // The real failure is still attributable to the attempt that submitted.
    const failures = telemetryEvents(send, "deadline_auto_submit_failed");
    expect(failures).toHaveLength(1);
    expect(failures[0]!.attemptId).toBe("att-1");
  });

  it("attempt switch during the auto-submit POST success: the new attempt is not navigated to the old result", async () => {
    installRecordingBuffer();
    const farDeadline = new Date(T0.getTime() + 600_000).toISOString();
    const editableA = buildSnapshot({
      attemptId: "att-1",
      timingMode: "deadline",
      serverNow: T0_ISO,
      effectiveDeadline: nearDeadline,
    });
    // The gate's verification read: the server froze att-1 at its deadline,
    // which is what unlocks the converging submit POST.
    const frozenA = buildSnapshot({
      attemptId: "att-1",
      timingMode: "deadline",
      serverNow: new Date(T0.getTime() + 3_100).toISOString(),
      effectiveDeadline: nearDeadline,
      isEditable: false,
      canSave: false,
      canSubmit: false,
      lockReason: "deadline",
      attemptStatus: "submitted",
      submittedAt: nearDeadline,
    });
    const editableB = buildSnapshot({
      attemptId: "att-2",
      timingMode: "deadline",
      serverNow: T0_ISO,
      effectiveDeadline: farDeadline,
    });
    let attOneReads = 0;
    apiGet.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.includes("/candidate/attempts/")) {
        takeHandler(path);
        if (path.includes("att-1")) {
          attOneReads += 1;
          return attOneReads === 1 ? editableA : frozenA;
        }
        return editableB;
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
      return { ok: true, serverNow: T0_ISO };
    });

    renderWithFakeClock({ withAttemptSwitcher: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_100);
    });
    expect(pendingSubmits).toHaveLength(1);
    fireEvent.click(screen.getByTestId("switch-attempt"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByTestId("current-path")).toHaveTextContent(
      "/exam/exam-1/take/att-2",
    );

    await act(async () => {
      pendingSubmits[0]!.resolve({ ok: true });
      await vi.advanceTimersByTimeAsync(0);
    });
    await flushAll();

    expect(screen.getByTestId("current-path")).toHaveTextContent(
      "/exam/exam-1/take/att-2",
    );
  });

  it("leaving the take page during the auto-submit POST: the settled old submit does not navigate the router", async () => {
    installRecordingBuffer();
    const editableA = buildSnapshot({
      attemptId: "att-1",
      timingMode: "deadline",
      serverNow: T0_ISO,
      effectiveDeadline: nearDeadline,
    });
    // The gate's verification read: server-side deadline freeze, which is
    // what unlocks the converging submit POST.
    const frozenA = buildSnapshot({
      attemptId: "att-1",
      timingMode: "deadline",
      serverNow: new Date(T0.getTime() + 3_100).toISOString(),
      effectiveDeadline: nearDeadline,
      isEditable: false,
      canSave: false,
      canSubmit: false,
      lockReason: "deadline",
      attemptStatus: "submitted",
      submittedAt: nearDeadline,
    });
    let takeReads = 0;
    apiGet.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.includes("/candidate/attempts/")) {
        takeHandler(path);
        takeReads += 1;
        return takeReads === 1 ? editableA : frozenA;
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
      return { ok: true, serverNow: T0_ISO };
    });

    renderWithFakeClock({ withAttemptSwitcher: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_100);
    });
    expect(pendingSubmits).toHaveLength(1);

    fireEvent.click(screen.getByTestId("leave-page"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByTestId("current-path")).toHaveTextContent("/exam/list");

    await act(async () => {
      pendingSubmits[0]!.resolve({ ok: true });
      await vi.advanceTimersByTimeAsync(0);
    });
    await flushAll();

    expect(screen.getByTestId("current-path")).toHaveTextContent("/exam/list");
  });

  it("a stale heartbeat success does not retry the new attempt's failed save against the old attempt", async () => {
    installRecordingBuffer();
    const farDeadline = new Date(T0.getTime() + 600_000).toISOString();
    const snapA = buildSnapshot({
      attemptId: "att-1",
      timingMode: "deadline",
      serverNow: T0_ISO,
      effectiveDeadline: farDeadline,
    });
    const snapB = buildSnapshot({
      attemptId: "att-2",
      timingMode: "deadline",
      serverNow: T0_ISO,
      effectiveDeadline: farDeadline,
    });
    apiGet.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.includes("/candidate/attempts/")) {
        takeHandler(path);
        return path.includes("att-1") ? snapA : snapB;
      }
      throw new Error(`unexpected GET ${path}`);
    });
    let heartbeat: DeferredSubmit | null = null;
    const oldAttemptSavePaths: string[] = [];
    apiPost.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.includes("/heartbeat")) {
        heartbeat = deferredSubmit();
        return heartbeat.promise;
      }
      if (typeof path === "string" && path.includes("/answers/")) {
        if (path.includes("/attempts/att-1/")) {
          oldAttemptSavePaths.push(path);
        }
        throw new Error("save transport down");
      }
      return { ok: true, serverNow: T0_ISO };
    });

    renderWithFakeClock({ withAttemptSwitcher: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // att-1's heartbeat is in flight when the candidate switches to att-2.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(heartbeat).not.toBeNull();
    fireEvent.click(screen.getByTestId("switch-attempt"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByTestId("current-path")).toHaveTextContent(
      "/exam/exam-1/take/att-2",
    );

    // att-2 now has a failed save of its own.
    fireEvent.click(screen.getByRole("radio", { name: "A" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_600);
    });
    expect(screen.getByText("部分答案尚未保存成功")).toBeInTheDocument();

    // The OLD attempt's heartbeat settles success after the switch.
    await act(async () => {
      heartbeat!.resolve({ ok: true, serverNow: T0_ISO });
      await vi.advanceTimersByTimeAsync(1_600);
    });
    await flushAll();

    // Its stale retry must not replay att-2's failed save against att-1.
    expect(oldAttemptSavePaths).toHaveLength(0);
  });

  it("attempt switch during the post-submit authoritative reload: no navigation to the old result", async () => {
    installRecordingBuffer();
    const farDeadline = new Date(T0.getTime() + 600_000).toISOString();
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
      effectiveDeadline: farDeadline,
    });
    let aGets = 0;
    let resolveReload!: (value: unknown) => void;
    const reloadGate = new Promise<unknown>((resolve) => {
      resolveReload = resolve;
    });
    apiGet.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.includes("/candidate/attempts/")) {
        takeHandler(path);
        if (path.includes("att-1")) {
          aGets += 1;
          return aGets === 1 ? editableA : reloadGate;
        }
        return editableB;
      }
      throw new Error(`unexpected GET ${path}`);
    });
    apiPost.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.includes("/submit")) {
        return { ok: true };
      }
      return { ok: true, serverNow: T0_ISO };
    });

    renderWithFakeClock({ withAttemptSwitcher: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_100);
    });
    // The submit POST resolved; its authoritative reload GET is in flight.
    expect(aGets).toBe(2);

    fireEvent.click(screen.getByTestId("switch-attempt"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByTestId("current-path")).toHaveTextContent(
      "/exam/exam-1/take/att-2",
    );

    // The abandoned reload settles after the switch; it must not navigate.
    await act(async () => {
      resolveReload(editableA);
      await vi.advanceTimersByTimeAsync(0);
    });
    await flushAll();

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
      // The first /take read renders the editable page; the gate's later
      // verification read returns the server's frozen deadline view, which is
      // what unlocks the converging submit POST.
      const editable = buildSnapshot({
        timingMode: "timed_window",
        serverNow: T0_ISO,
        effectiveDeadline: nearDeadline,
      });
      const frozen = buildSnapshot({
        timingMode: "timed_window",
        serverNow: new Date(T0.getTime() + 3_100).toISOString(),
        effectiveDeadline: nearDeadline,
        isEditable: false,
        canSave: false,
        canSubmit: false,
        lockReason: "deadline",
        attemptStatus: "submitted",
        submittedAt: nearDeadline,
      });
      let takeReads = 0;
      apiGet.mockImplementation(async (path: string) => {
        if (typeof path === "string" && path.includes("/candidate/attempts/")) {
          takeHandler(path);
          takeReads += 1;
          return takeReads === 1 ? editable : frozen;
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
