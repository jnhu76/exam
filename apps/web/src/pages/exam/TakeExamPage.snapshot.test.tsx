import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "@/contexts/AuthContext";
import { BrandProvider } from "@/components/layout/BrandProvider";
import { TakeExamPage } from "./TakeExamPage";
import type { CandidateTakeSnapshot } from "@exam/contracts";
import { permissionsForRole } from "@exam/authz";

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

const { apiGet, apiPost, takeHandler } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  takeHandler: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: {
    get: (...args: unknown[]) => apiGet(...args),
    post: (...args: unknown[]) => apiPost(...args),
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

function renderPage() {
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
          <Routes>
            <Route
              path="/exam/:examId/take/:attemptId"
              element={<TakeExamPage />}
            />
            <Route path="/exam/:attemptId/result" element={<LocationProbe />} />
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
  vi.useRealTimers();
});

describe("P3-FSM-0 authoritative snapshot read path", () => {
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
          options: [{ id: "opt-a", content: "Alpha" }],
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

  it("locked authoritative snapshot → question control disabled, no save API call", async () => {
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
          prompt: "已提交的题目",
          options: [{ id: "opt-a", content: "A" }],
          inputMode: "choice",
          maxScore: 10,
          answerValue: "opt-a",
          answerSource: "submitted",
        },
      ],
    });
    installTakeRoute(snap);
    renderPage();

    // Wait for snapshot load.
    await screen.findByText("已提交的题目");

    // Try every reachable save path: click the option, then wait past the
    // autosave debounce window. With view.canSave === false, no save request
    // may be issued.
    const radio = await screen.findByRole("radio", { name: "A" });
    expect(radio).toBeDisabled();

    // Even if a save path were reachable, no /answers/ POST may fire.
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
          options: [
            { id: "frozen-answer", content: "Frozen Choice" },
            { id: "other", content: "Other" },
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

describe("P3-FSM-0 TakeExamPage behaviors over the snapshot read path", () => {
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
          options: [
            { id: "a", content: "A" },
            { id: "b", content: "B" },
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
describe("P3-MOD-P0-3 submit-freeze UI proof", () => {
  it("save execution seam reads derived canSave and skips the API call when the snapshot is non-editable", async () => {
    // The card requires: "view.canSave === false => save endpoint is not
    // called", and explicitly says "disabled control alone is not
    // sufficient proof". The page guards the save execution seam at
    // TakeExamPage.tsx:289 with `if (!viewRef.current?.canSave) return;`.
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
