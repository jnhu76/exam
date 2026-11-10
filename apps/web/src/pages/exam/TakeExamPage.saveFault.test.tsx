import { StrictMode } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TakeExamPage } from "./TakeExamPage";
import type { CandidateTakeSnapshot } from "@exam/contracts";
import { setBuffer, getBuffer } from "@/lib/logger";
import { __resetExamTelemetryForTest } from "@/lib/examTelemetry";
import {
  NOW,
  SnapshotQuestion,
  buildTakeSnapshot,
  fillBlankQuestion,
  installRecordingBuffer,
  takeExamProviders,
  telemetryEvents,
} from "./TakeExamPage.testHarness";

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
 *   persisted telemetry row correlates with the receipt row keyed
 *   (attemptId, questionId, clientSeq) — a candidate correlation key, not
 *   content identity (a reloaded client can reuse a clientSeq for different
 *   content; the receipt's answerIdentity digest is the content authority).
 * - A2-F7 (three-way contract): transport → connection banner; HTTP >= 500
 *   → server-fault banner; HTTP 4xx (the server ANSWERED with a
 *   protocol/business rejection) → NEITHER banner — the save-failed surface
 *   and the telemetry errorCode still carry it.
 *
 * Desensitization is asserted at the PERSISTENCE boundary (the recording
 * buffer's send transport): the persisted record carries categories/stable
 * codes only — never the ApiError message text or a stack.
 */

function buildSnapshot(
  overrides: Partial<CandidateTakeSnapshot> = {},
  questions: SnapshotQuestion[] = [fillBlankQuestion("q1")],
): CandidateTakeSnapshot {
  return buildTakeSnapshot({ timingMode: "untimed", questions, ...overrides });
}

const { apiGet, apiPost, postMeta } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  postMeta: { requestId: null as string | null },
}));

vi.mock("@/lib/api", async () => {
  const { createTakeApiModuleMock, makeApiErrorStub } =
    await import("./TakeExamPage.apiMockHarness");
  return {
    ApiError: makeApiErrorStub(),
    // #924: the save path calls postWithMeta; it delegates to the same
    // apiPost mock so url/body/throw assertions stay single-sourced (header
    // id via postMeta when a test needs one — this file's saves never
    // succeed on the rejection surfaces under test, so null is the honest
    // default).
    ...createTakeApiModuleMock({ apiGet, apiPost, postMeta }),
  };
});

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

async function flushAll(): Promise<void> {
  await getBuffer().flush();
}

function renderPage(strict = false) {
  const page = takeExamProviders({
    initialPath: "/exam/exam-1/take/att-1",
    children: (
      <Routes>
        <Route
          path="/exam/:examId/take/:attemptId"
          element={<TakeExamPage />}
        />
      </Routes>
    ),
  });
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
  it("an HTTP 500 save failure records stable machine facts, carries clientSeq, and renders the server-fault banner (A2-F1/F2/F5/F7)", async () => {
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

    // A2-F5: within this one save, the started/failed rows and the POST
    // body share the same clientSeq — the candidate key for correlating a
    // telemetry row with the receipt row (equal clientSeq alone is not
    // content identity; the receipt's answerIdentity digest is).
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

  it("an HTTP 409 save rejection claims neither connectivity nor server fault: no banner, save-failed surface only, telemetry carries code/status/requestId (A2-F7 three-way)", async () => {
    const send = installRecordingBuffer();
    installTakeRoute();
    apiPost.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.includes("/answers/")) {
        const { ApiError } = await import("@/lib/api");
        throw new ApiError(
          409,
          "attempt state conflict confidential-detail",
          "INVALID_STATE_TRANSITION",
          undefined,
          "req-409-xyz",
        );
      }
      return { ok: true, serverNow: NOW };
    });

    renderPage();
    await editAnswer();

    // The save-failed surface is present (per-question retry banner)...
    await waitFor(
      () => {
        expect(screen.getByText("部分答案尚未保存成功")).toBeInTheDocument();
      },
      { timeout: 4000 },
    );
    // ...but NEITHER banner renders: an HTTP-level 4xx is the server
    // ANSWERING with a rejection — not the candidate's connectivity, and
    // not a server fault. Same rejection semantics as the typed envelope
    // path, delivered on the wire-status channel.
    expect(screen.queryByText("连接异常")).not.toBeInTheDocument();
    expect(screen.queryByText("服务器错误")).not.toBeInTheDocument();

    await flushAll();

    // The telemetry row is the 4xx's surface: stable code, status, and
    // requestId for cross-layer correlation — machine facts only.
    const failed = telemetryEvents(send, "answer_autosave_failed");
    expect(failed).toHaveLength(1);
    const meta = failed[0]!.metadata as Record<string, unknown>;
    expect(meta.errorCode).toBe("INVALID_STATE_TRANSITION");
    expect(meta.status).toBe(409);
    expect(meta.requestId).toBe("req-409-xyz");
    expect(meta).not.toHaveProperty("message");
    const persisted = JSON.stringify(send.mock.calls);
    expect(persisted).not.toContain("attempt state conflict");
    expect(persisted).not.toContain("confidential-detail");
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

/**
 * The heartbeat is the other live wire probe; it must classify failures with
 * the SAME three-way contract as the save path (shared
 * classifyWireFailure). A heartbeat 4xx is the server ANSWERING, so it may
 * neither clear nor claim connectivity wrongly; a heartbeat 5xx is a server
 * fault; a fetch-level failure (ApiError status 0) is the candidate's
 * connection. These run under fake timers so the 30s heartbeat fires
 * deterministically, with no save scheduled (no edit).
 */
describe("heartbeat wire-failure classification (#800 PR-B A2-F7)", () => {
  function heartbeatFailsWith(status: number, code?: string) {
    apiPost.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.includes("/heartbeat")) {
        const { ApiError } = await import("@/lib/api");
        throw new ApiError(
          status,
          "heartbeat rejected",
          code,
          undefined,
          "req-hb",
        );
      }
      return { ok: true, serverNow: NOW };
    });
  }

  async function renderAndFireHeartbeat() {
    vi.useFakeTimers();
    renderPage();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    // The heartbeat interval fires at T=30s; advance past it and let the
    // rejection settle through the catch path.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(31_000);
    });
  }

  it("a 4xx heartbeat claims neither connectivity nor server fault (no banner)", async () => {
    installTakeRoute();
    heartbeatFailsWith(403, "FORBIDDEN");

    await renderAndFireHeartbeat();

    expect(screen.queryByText("连接异常")).not.toBeInTheDocument();
    expect(screen.queryByText("服务器错误")).not.toBeInTheDocument();
  });

  it("a 5xx heartbeat renders the server-fault banner, not the connectivity copy", async () => {
    installTakeRoute();
    heartbeatFailsWith(503, "SERVICE_UNAVAILABLE");

    await renderAndFireHeartbeat();

    expect(screen.getByText("服务器错误")).toBeInTheDocument();
    expect(screen.queryByText("连接异常")).not.toBeInTheDocument();
  });

  // The transport leg (ApiError status 0 → connectivity banner) is asserted
  // in TakeExamPage.reconcile.test.tsx ("heartbeat network failure → generic
  // disconnect, no authoritative re-read") with a strict superset of these
  // assertions, so the three-way heartbeat partition stays complete.
});
