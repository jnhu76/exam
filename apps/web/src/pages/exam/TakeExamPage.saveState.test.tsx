import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "@/contexts/AuthContext";
import { BrandProvider } from "@/components/layout/BrandProvider";
import { TakeExamPage } from "./TakeExamPage";
import type { CandidateTakeSnapshot } from "@exam/contracts";
import { permissionsForRole } from "@exam/authz";

/**
 * S3.1 characterization — the save-state chip (SaveIndicator) mapping over
 * every setSaveState write path in TakeExamPage:
 *   P1 initial idle / P2 route reset / P3 edit → saving / P4 canSave=false
 *   skip → idle / P5 ACK → saved / P6 stale reconcile → saved /
 *   P7 server rejection → error / P8 network failure → error.
 *
 * These tests pin the AS-BUILT state→copy mapping (zh-CN: 等待保存 / 保存中... /
 * 已保存 / 保存失败) before the idle-copy remediation, so the remapping cannot
 * silently break the authoritative capability "UI 已保存 = 服务器 ACK 语义"
 * (docs/product/standard-supported-capabilities.zh-CN.md §8): an edit that was
 * never acknowledged must never render 已保存.
 */

const NOW = "2026-07-04T10:00:00.000Z";
const DEADLINE = "2026-07-04T11:00:00.000Z";

type SnapshotQuestion = CandidateTakeSnapshot["questions"][number];

function choiceQuestion(id: string): SnapshotQuestion {
  return {
    id,
    type: "single_choice",
    prompt: `选择一项 ${id}`,
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
  };
}

function fillBlankQuestion(id: string): SnapshotQuestion {
  return {
    id,
    type: "fill_blank",
    prompt: `填空 ${id}`,
    promptDocument: null,
    answerMode: "plain" as const,
    options: [],
    inputMode: "single_line",
    maxScore: 10,
    answerValue: null,
    answerSource: "none",
  };
}

function buildSnapshot(
  overrides: Partial<CandidateTakeSnapshot> = {},
  questions: SnapshotQuestion[] = [fillBlankQuestion("q1")],
): CandidateTakeSnapshot {
  return {
    attemptId: "att-1",
    examId: "exam-1",
    attemptStatus: "in_progress",
    timingMode: "untimed",
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
    questions,
    ...overrides,
  };
}

/** The frozen post-terminal snapshot an authoritative re-read returns. */
function lockedSnapshot(): CandidateTakeSnapshot {
  return buildSnapshot(
    {
      attemptStatus: "submitted",
      isEditable: false,
      canSave: false,
      canSubmit: false,
      lockReason: "submitted",
      submittedAt: NOW,
    },
    [
      {
        ...choiceQuestion("q1"),
        answerValue: "opt-a",
        answerSource: "submitted" as const,
      },
    ],
  );
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
  },
  setNavigate: () => {},
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

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
          </Routes>
        </BrandProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

function installTakeRoute(sequence: CandidateTakeSnapshot[]) {
  let takeCalls = 0;
  apiGet.mockImplementation(async (path: string) => {
    if (typeof path === "string" && path.includes("/candidate/attempts/")) {
      takeHandler(path);
      const snapshot = sequence[Math.min(takeCalls, sequence.length - 1)];
      takeCalls += 1;
      return snapshot;
    }
    throw new Error(`unexpected GET ${path}`);
  });
  return () => takeCalls;
}

function answersPostCalls() {
  return apiPost.mock.calls.filter(
    ([p]) => typeof p === "string" && p.includes("/answers/"),
  );
}

beforeEach(() => {
  apiGet.mockReset();
  apiPost.mockReset();
  takeHandler.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("save-state chip mapping (real timers)", () => {
  it("maps initial idle → edit saving → ACK saved (P1 → P3 → P5)", async () => {
    installTakeRoute([buildSnapshot()]);
    apiPost.mockResolvedValue({
      accepted: true,
      serverVersion: 1,
      savedAt: NOW,
    });

    renderPage();

    // P1: before any edit the chip renders the idle copy.
    expect(await screen.findByText("等待保存")).toBeInTheDocument();

    const input = await screen.findByLabelText("第1空答案");
    const user = userEvent.setup();
    await user.type(input, "x");

    // P3: the edit enters the debounce window as saving — the chip never
    // claims 已保存 before the server ACKs.
    expect(screen.getByText("保存中...")).toBeInTheDocument();
    expect(screen.queryByText("已保存")).not.toBeInTheDocument();

    await waitFor(
      () => {
        expect(screen.getByText("已保存")).toBeInTheDocument();
      },
      { timeout: 4000 },
    );
    expect(answersPostCalls()).toHaveLength(1);
  });

  it("maps a network failure to error and auto-recovers to saved on the browser online event (P8 → P5)", async () => {
    installTakeRoute([buildSnapshot({}, [choiceQuestion("q1")])]);
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

    // P8: transport failure → error chip + disconnect banner + per-question
    // failure banner. No saveRejection alert (the server said nothing).
    await waitFor(
      () => {
        expect(screen.getByText("保存失败")).toBeInTheDocument();
      },
      { timeout: 4000 },
    );
    expect(screen.getByText("连接异常")).toBeInTheDocument();
    expect(screen.getByText("部分答案尚未保存成功")).toBeInTheDocument();
    expect(
      screen.queryByTestId("save-rejection-alert"),
    ).not.toBeInTheDocument();

    // Connection restored: the online listener retries through the EXISTING
    // save orchestration (#677 F6) and the ACK flips the chip to saved.
    apiPost.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.includes("/answers/")) {
        return { accepted: true, serverVersion: 1, savedAt: NOW };
      }
      return { ok: true, serverNow: NOW };
    });
    act(() => {
      window.dispatchEvent(new Event("online"));
    });

    await waitFor(
      () => {
        expect(screen.getByText("已保存")).toBeInTheDocument();
      },
      { timeout: 4000 },
    );
    expect(screen.queryByText("连接异常")).not.toBeInTheDocument();
    expect(screen.queryByText("部分答案尚未保存成功")).not.toBeInTheDocument();
  });

  it("maps a non-terminal server rejection to error and keeps the rejection alert (P7)", async () => {
    installTakeRoute([buildSnapshot()]);
    apiPost.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.includes("/answers/")) {
        return {
          accepted: false,
          reason: "INVALID_ANSWER",
          message: "invalid",
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

    await waitFor(
      () => {
        expect(screen.getByText("保存失败")).toBeInTheDocument();
      },
      { timeout: 4000 },
    );
    // The chip says the save failed; the alert explains WHY. The page stays
    // editable (non-terminal rejection does not lock).
    expect(screen.getByTestId("save-rejection-alert")).toHaveTextContent(
      "答案格式不符合此题要求",
    );
    expect(screen.getByLabelText("第1空答案")).not.toBeDisabled();
  });

  it("maps a stale-version reconcile to saved and applies the server answer (P6)", async () => {
    installTakeRoute([
      buildSnapshot({}, [
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
      ]),
    ]);
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
        expect(screen.getByText("已保存")).toBeInTheDocument();
      },
      { timeout: 4000 },
    );
    // The reconciled server answer is applied and the chip reads saved —
    // the server ACKed (with its own content), so 已保存 is true here.
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes[0]).toBeChecked();
    expect(boxes[1]).toBeChecked();
  });

  it("keeps the failed question's banner visible after a later question saves (last-event chip, #677 F6)", async () => {
    installTakeRoute([
      buildSnapshot({}, [fillBlankQuestion("q1"), fillBlankQuestion("q2")]),
    ]);
    apiPost.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.includes("/answers/q1")) {
        return {
          accepted: false,
          reason: "INVALID_ANSWER",
          message: "invalid",
          serverVersion: 0,
          savedAt: NOW,
        };
      }
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
        expect(screen.getByText("保存失败")).toBeInTheDocument();
      },
      { timeout: 4000 },
    );
    expect(screen.getByText("部分答案尚未保存成功")).toBeInTheDocument();

    // Move to q2 and save successfully: the chip reflects the LATEST save
    // event (已保存), while q1's failure remains visible through the queue's
    // per-question banner — the success must not mask the failed question.
    await user.click(screen.getByRole("button", { name: "下一题" }));
    const input2 = await screen.findByLabelText("第1空答案");
    await user.type(input2, "y");

    await waitFor(
      () => {
        expect(screen.getByText("已保存")).toBeInTheDocument();
      },
      { timeout: 4000 },
    );
    expect(screen.getByText("部分答案尚未保存成功")).toBeInTheDocument();
  });
});

describe("save-state chip mapping (fake timers — skip path)", () => {
  it("a pending edit whose attempt turns non-saveable before the debounce fires is skipped: no POST, chip back to idle, never 已保存 (P4)", async () => {
    const getTakeCalls = installTakeRoute([
      buildSnapshot({}, [choiceQuestion("q1")]),
      // The authoritative re-read returns the frozen submitted snapshot.
      lockedSnapshot(),
    ]);

    vi.useFakeTimers();
    apiPost.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.includes("/heartbeat")) {
        throw new (await import("@/lib/api")).ApiError(
          409,
          "Cannot heartbeat attempt: status changed or attempt not found",
          "INVALID_STATE_TRANSITION",
        );
      }
      return { ok: true, serverNow: NOW };
    });

    renderPage();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(getTakeCalls()).toBe(1);

    // Advance to T=29s, then edit: the save is scheduled for T=30.5s
    // (debounce 1500ms), i.e. 500ms AFTER the 30s heartbeat.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(29_000);
    });
    const radioB = screen.getByRole("radio", { name: "B" });
    await act(async () => {
      fireEvent.click(radioB);
    });
    expect(screen.getByText("保存中...")).toBeInTheDocument();

    // T=30.2s: the terminal heartbeat (409) triggers the authoritative
    // re-read, which applies the frozen submitted snapshot (canSave=false).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_200);
    });
    expect(getTakeCalls()).toBe(2);
    expect(screen.getByRole("radio", { name: "A" })).toBeDisabled();

    // As-built wart pinned for the remapping: the chip still reads 保存中...
    // during the window between the snapshot apply and the debounce fire.
    expect(screen.getByText("保存中...")).toBeInTheDocument();

    // T=31.2s: the debounce fires, the execution-time canSave guard skips the
    // save — no POST is issued, the queue records the question failed, and
    // the chip returns to the idle copy. The unacknowledged edit NEVER
    // renders 已保存 (UNACKNOWLEDGED != SAVED).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(answersPostCalls()).toHaveLength(0);
    expect(screen.getByText("等待保存")).toBeInTheDocument();
    expect(screen.queryByText("已保存")).not.toBeInTheDocument();
    expect(screen.queryByText("保存中...")).not.toBeInTheDocument();
    // The server truth won: the frozen snapshot locked the page.
    expect(screen.getByTestId("deadline-overlay")).toHaveAttribute(
      "data-lock-reason",
      "submitted",
    );
    expect(screen.getByRole("radio", { name: "A" })).toBeChecked();
  });
});
