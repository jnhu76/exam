import { StrictMode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "@/contexts/AuthContext";
import { BrandProvider } from "@/components/layout/BrandProvider";
import { TakeExamPage } from "./TakeExamPage";
import type { CandidateTakeSnapshot } from "@exam/contracts";
import { permissionsForRole } from "@exam/authz";
import { ClientEventBuffer } from "@/lib/clientEventBuffer";
import { setBuffer, getBuffer } from "@/lib/logger";
import { __resetExamTelemetryForTest } from "@/lib/examTelemetry";

/**
 * Save-fault classification and cross-layer error correlation (#800 PR-B):
 *
 * - A2-F1: the catch path must record the ApiError machine facts the wire
 *   already provided (stable code, HTTP status, envelope requestId) instead
 *   of collapsing every failure into errorCode "NETWORK"; a transport-level
 *   failure (no ApiError / code undefined) keeps the NETWORK fallback.
 * - A2-F2: the envelope requestId must surface to the candidate (server-fault
 *   banner detail) so support can locate the server-side request.
 * - A2-F5: started/failed telemetry events carry the save's clientSeq so a
 *   persisted telemetry row joins to its answer-save receipt row.
 * - A2-F7: an HTTP >= 500 failure renders the server-fault banner — the
 *   connection banner must not present a server fault as the candidate's
 *   network problem.
 *
 * Desensitization is asserted at the PERSISTENCE boundary (the recording
 * buffer's send transport): the persisted record carries categories/stable
 * codes only — never the ApiError message text or a stack.
 */

const NOW = "2026-07-04T10:00:00.000Z";
const DEADLINE = "2026-07-04T11:00:00.000Z";

type SnapshotQuestion = CandidateTakeSnapshot["questions"][number];

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
  toast: { success: vi.fn(), error: vi.fn() },
}));

/** Recording buffer: captures every event the page pushes for persistence. */
function installRecordingBuffer() {
  const send = vi.fn().mockResolvedValue(true);
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

/** All persisted exam_telemetry records with the given event name. */
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

function renderPage(strict = false) {
  const page = (
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
    </MemoryRouter>
  );
  return render(strict ? <StrictMode>{page}</StrictMode> : page);
}

function installTakeRoute() {
  apiGet.mockImplementation(async (path: string) => {
    if (typeof path === "string" && path.includes("/candidate/attempts/")) {
      return buildSnapshot();
    }
    throw new Error(`unexpected GET ${path}`);
  });
}

/** Types one character into the fill-blank answer input (schedules a save). */
async function editAnswer() {
  const input = await screen.findByLabelText("第1空答案");
  const user = userEvent.setup();
  await user.type(input, "x");
}

beforeEach(() => {
  apiGet.mockReset();
  apiPost.mockReset();
});

afterEach(() => {
  setBuffer(null);
  __resetExamTelemetryForTest();
  vi.useRealTimers();
});

describe("save-fault classification and correlation (#800 PR-B)", () => {
  it("an HTTP 500 save failure records stable machine facts, joins clientSeq, and renders the server-fault banner (A2-F1/F2/F5/F7)", async () => {
    const send = installRecordingBuffer();
    installTakeRoute();
    let postedClientSeq: unknown;
    apiPost.mockImplementation(
      async (path: string, body?: { clientSeq?: number }) => {
        if (typeof path === "string" && path.includes("/answers/")) {
          postedClientSeq = body?.clientSeq;
          // The message carries text that must NEVER reach the persisted
          // telemetry record (raw server compatibility text).
          const { ApiError } = await import("@/lib/api");
          throw new ApiError(
            500,
            "internal ooops confidential-detail",
            "SAVE_PERSISTENCE_FAILED",
            undefined,
            "req-500-abc",
          );
        }
        return { ok: true, serverNow: NOW };
      },
    );

    renderPage();
    await editAnswer();

    // A2-F7: the server fault gets its own banner — not the connection copy.
    await waitFor(
      () => {
        expect(screen.getByText("服务器错误")).toBeInTheDocument();
      },
      { timeout: 4000 },
    );
    expect(screen.queryByText("连接异常")).not.toBeInTheDocument();
    // A2-F2: the envelope requestId is surfaced for support correlation.
    expect(
      screen.getByText("错误编号：req-500-abc（如需联系管理员，请提供此编号）"),
    ).toBeInTheDocument();
    expect(screen.getByText("部分答案尚未保存成功")).toBeInTheDocument();

    await flushAll();

    // A2-F1: the failed event carries the machine facts — stable code,
    // status, requestId — with the NETWORK fallback unused.
    const failed = telemetryEvents(send, "answer_autosave_failed");
    expect(failed).toHaveLength(1);
    const meta = failed[0]!.metadata as Record<string, unknown>;
    expect(meta.errorCode).toBe("SAVE_PERSISTENCE_FAILED");
    expect(meta.status).toBe(500);
    expect(meta.requestId).toBe("req-500-abc");
    expect(meta.saveMode).toBe("autosave");
    expect(typeof meta.durationMs).toBe("number");

    // A2-F5: started and failed events share the save's clientSeq, and it
    // equals the clientSeq sent in the POST body (receipt join key).
    const started = telemetryEvents(send, "answer_autosave_started");
    expect(started).toHaveLength(1);
    const startedMeta = started[0]!.metadata as Record<string, unknown>;
    expect(startedMeta.clientSeq).toBe(postedClientSeq);
    expect(meta.clientSeq).toBe(postedClientSeq);

    // Desensitization at the persistence boundary: the persisted records
    // carry categories/stable codes only — the raw message text and any
    // stack/message-bearing key must not appear anywhere in the batch.
    const persisted = JSON.stringify(send.mock.calls);
    expect(persisted).not.toContain("ooops");
    expect(persisted).not.toContain("confidential-detail");
    expect(meta).not.toHaveProperty("message");
    expect(meta).not.toHaveProperty("stack");
    expect(meta).not.toHaveProperty("serverMessage");
  });

  it("a transport-level failure keeps the NETWORK fallback, omits status/requestId, and keeps the connection banner (A2-F1 fallback, A2-F7 unchanged path)", async () => {
    const send = installRecordingBuffer();
    installTakeRoute();
    apiPost.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.includes("/answers/")) {
        throw new Error("socket hang up");
      }
      return { ok: true, serverNow: NOW };
    });

    renderPage();
    await editAnswer();

    await waitFor(
      () => {
        expect(screen.getByText("连接异常")).toBeInTheDocument();
      },
      { timeout: 4000 },
    );
    expect(screen.queryByText("服务器错误")).not.toBeInTheDocument();

    await flushAll();

    const failed = telemetryEvents(send, "answer_autosave_failed");
    expect(failed).toHaveLength(1);
    const meta = failed[0]!.metadata as Record<string, unknown>;
    expect(meta.errorCode).toBe("NETWORK");
    expect(meta).not.toHaveProperty("status");
    expect(meta).not.toHaveProperty("requestId");
    // The raw failure text of the non-ApiError must not be persisted either.
    const persisted = JSON.stringify(send.mock.calls);
    expect(persisted).not.toContain("socket hang up");
  });

  it("StrictMode mount + failing save records exactly one started/failed pair; a remount replays nothing (no duplicate/recursive records)", async () => {
    const send = installRecordingBuffer();
    installTakeRoute();
    apiPost.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.includes("/answers/")) {
        throw new Error("offline");
      }
      return { ok: true, serverNow: NOW };
    });

    const view = renderPage(true);
    await editAnswer();
    await waitFor(
      () => {
        expect(screen.getByText("连接异常")).toBeInTheDocument();
      },
      { timeout: 4000 },
    );

    await flushAll();
    expect(telemetryEvents(send, "answer_autosave_started")).toHaveLength(1);
    expect(telemetryEvents(send, "answer_autosave_failed")).toHaveLength(1);

    // Remount: the fresh page must not replay the previous session's failure
    // records — no new answer_autosave_* events without a new user edit.
    view.unmount();
    send.mockClear();
    renderPage(true);
    await screen.findByText("填空 q1");
    await flushAll();
    expect(telemetryEvents(send, "answer_autosave_started")).toHaveLength(0);
    expect(telemetryEvents(send, "answer_autosave_failed")).toHaveLength(0);
  });
});
