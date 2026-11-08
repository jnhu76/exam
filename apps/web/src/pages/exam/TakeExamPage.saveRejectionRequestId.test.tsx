import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AuthProvider } from "@/contexts/AuthContext";
import { BrandProvider } from "@/components/layout/BrandProvider";
import { TakeExamPage } from "./TakeExamPage";
import type { CandidateTakeSnapshot, ClientEvent } from "@exam/contracts";
import { permissionsForRole } from "@exam/authz";
import { ClientEventBuffer } from "@/lib/clientEventBuffer";
import { setBuffer, getBuffer } from "@/lib/logger";
import {
  __resetExamTelemetryForTest,
  __flushPendingForTest,
} from "@/lib/examTelemetry";

/**
 * #924: the save path consumes the 200 response's `x-request-id` header
 * (`api.postWithMeta`) so a BUSINESS rejection (HTTP 200, accepted:false) —
 * which never forms an ApiError — still leaves a client-claimed correlation
 * id in both surfaces the candidate can hand to support:
 *
 * - the save-rejection alert (请求编号), and
 * - the `answer_autosave_failed` telemetry row (allowlisted requestId).
 *
 * Covers the TASK-CONTRACT §3.6 mock-HTTP rows that need page-level state:
 * accepted:false (+/- header), CONFLICTING_PAYLOAD, 4xx three-way, transport
 * + ACK-loss retry, old-attempt delayed response, multi-question sequences
 * (incl. the mixed reject-then-headerless-reject residue case), and the
 * STALE_VERSION reconcile invariance. Trust positioning is unchanged: the
 * header value is a browser-observed correlation candidate, never a server
 * authority (#860 PR-T labeling applies downstream).
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

const { apiGet, apiPost, postMeta } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  /** Per-test stand-in for the 200 response's x-request-id header. */
  postMeta: { requestId: null as string | null },
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
    // The save path calls postWithMeta; the wrapper delegates to the SAME
    // apiPost mock so url/body/throw assertions stay single-sourced, and
    // threads the per-test header id through postMeta.requestId.
    postWithMeta: async (...args: unknown[]) => ({
      data: await apiPost(...args),
      meta: { requestId: postMeta.requestId },
    }),
  },
  setNavigate: () => {},
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

/** Recording buffer: captures every event the page pushes for persistence. */
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
  // answer_autosave_success is coalesced (5s window) — emit pending
  // coalesced events first so success-row assertions see them.
  __flushPendingForTest();
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

/** Hands the router's navigate() to the test (route-change scenario). */
function NavigateProbe({
  register,
}: {
  register: (nav: (to: string) => void) => void;
}) {
  register(useNavigate());
  return null;
}

function renderPage() {
  const navigateRef: { current: ((to: string) => void) | null } = {
    current: null,
  };
  render(
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
          <NavigateProbe register={(n) => (navigateRef.current = n)} />
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
  return {
    navigate: (to: string) => {
      if (!navigateRef.current) {
        throw new Error("navigate not registered (probe did not mount)");
      }
      navigateRef.current(to);
    },
  };
}

function installTakeRoute(sequence: CandidateTakeSnapshot[]) {
  let takeCalls = 0;
  apiGet.mockImplementation(async (path: string) => {
    if (typeof path === "string" && path.includes("/candidate/attempts/")) {
      const snapshot = sequence[Math.min(takeCalls, sequence.length - 1)];
      takeCalls += 1;
      return snapshot;
    }
    throw new Error(`unexpected GET ${path}`);
  });
}

/** Types one character into the fill-blank answer input (schedules a save). */
async function editAnswer(label = "第1空答案") {
  const input = await screen.findByLabelText(label);
  const user = userEvent.setup();
  await user.type(input, "x");
}

/** A typed non-terminal business rejection body (HTTP 200, accepted:false). */
function rejection(reason: string, serverVersion = 5) {
  return {
    accepted: false,
    reason,
    message: "rejected",
    serverVersion,
    savedAt: NOW,
  };
}

beforeEach(() => {
  apiGet.mockReset();
  apiPost.mockReset();
  postMeta.requestId = null;
});

afterEach(() => {
  setBuffer(null);
  __resetExamTelemetryForTest();
  vi.useRealTimers();
});

describe("save-rejection requestId correlation (#924, TASK-CONTRACT §3.6)", () => {
  it("a 200 business rejection surfaces the header requestId in the alert and the failed telemetry", async () => {
    const send = installRecordingBuffer();
    installTakeRoute([buildSnapshot()]);
    postMeta.requestId = "req-rej-865-001";
    let postedClientSeq: unknown;
    apiPost.mockImplementation(
      async (path: string, body?: { clientSeq?: number }) => {
        if (typeof path === "string" && path.includes("/answers/")) {
          postedClientSeq = body?.clientSeq;
          return rejection("FUTURE_VERSION");
        }
        return { ok: true, serverNow: NOW };
      },
    );

    renderPage();
    await editAnswer();

    const alert = await screen.findByTestId(
      "save-rejection-alert",
      {},
      { timeout: 4000 },
    );
    expect(alert).toHaveTextContent("请求编号：req-rej-865-001");
    // A 200 business rejection claims neither connectivity nor server fault
    // (three-way contract) — the id rides the existing rejection surface.
    expect(screen.queryByText("连接异常")).not.toBeInTheDocument();
    expect(screen.queryByText("服务器错误")).not.toBeInTheDocument();

    await flushAll();
    const failed = telemetryEvents(send, "answer_autosave_failed");
    expect(failed).toHaveLength(1);
    const meta = failed[0]!.metadata as Record<string, unknown>;
    expect(meta.requestId).toBe("req-rej-865-001");
    expect(meta.errorCode).toBe("FUTURE_VERSION");
    expect(meta.clientSeq).toBe(postedClientSeq);
    expect(meta.saveMode).toBe("autosave");
  });

  it("a 200 business rejection without the header shows no fabricated id in either surface", async () => {
    const send = installRecordingBuffer();
    installTakeRoute([buildSnapshot()]);
    // postMeta.requestId stays null (older server / stripping hop).
    apiPost.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.includes("/answers/")) {
        return rejection("INVALID_ANSWER");
      }
      return { ok: true, serverNow: NOW };
    });

    renderPage();
    await editAnswer();

    const alert = await screen.findByTestId(
      "save-rejection-alert",
      {},
      { timeout: 4000 },
    );
    // Missing id → no 请求编号 placeholder, never a stale or invented id.
    expect(alert).not.toHaveTextContent("请求编号");

    await flushAll();
    const failed = telemetryEvents(send, "answer_autosave_failed");
    expect(failed).toHaveLength(1);
    const meta = failed[0]!.metadata as Record<string, unknown>;
    expect(meta).not.toHaveProperty("requestId");
    expect(meta.errorCode).toBe("INVALID_ANSWER");
  });

  it("CONFLICTING_PAYLOAD keeps its rejection classification and carries the header id", async () => {
    const send = installRecordingBuffer();
    installTakeRoute([buildSnapshot()]);
    postMeta.requestId = "req-conflict-865";
    apiPost.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.includes("/answers/")) {
        return rejection("CONFLICTING_PAYLOAD");
      }
      return { ok: true, serverNow: NOW };
    });

    renderPage();
    await editAnswer();

    const alert = await screen.findByTestId(
      "save-rejection-alert",
      {},
      { timeout: 4000 },
    );
    expect(alert).toHaveTextContent("答案数据冲突");
    expect(alert).toHaveTextContent("请求编号：req-conflict-865");

    await flushAll();
    const failed = telemetryEvents(send, "answer_autosave_failed");
    expect(failed).toHaveLength(1);
    const meta = failed[0]!.metadata as Record<string, unknown>;
    expect(meta.errorCode).toBe("CONFLICTING_PAYLOAD");
    expect(meta.requestId).toBe("req-conflict-865");
  });

  it("STALE_VERSION reconciliation is unchanged by a present header id: server answer applied, zero failure telemetry", async () => {
    const send = installRecordingBuffer();
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
    postMeta.requestId = "req-stale-865";
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

    // Reconcile still wins: chip saved, server answer applied, no rejection
    // alert — the captured id must NOT turn a reconcile into a failure fact.
    await waitFor(
      () => {
        expect(screen.getByText("已保存")).toBeInTheDocument();
      },
      { timeout: 4000 },
    );
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes[0]).toBeChecked();
    expect(boxes[1]).toBeChecked();
    expect(
      screen.queryByTestId("save-rejection-alert"),
    ).not.toBeInTheDocument();

    await flushAll();
    expect(telemetryEvents(send, "answer_autosave_failed")).toHaveLength(0);
    const success = telemetryEvents(send, "answer_autosave_success");
    expect(success).toHaveLength(1);
    // Case A guard applies to the reconcile success too: no requestId in
    // success telemetry, header or not.
    expect(success[0]!.metadata).not.toHaveProperty("requestId");
  });

  it("a save 401 keeps the 4xx three-way contract and records the envelope requestId (no rejection id)", async () => {
    const send = installRecordingBuffer();
    installTakeRoute([buildSnapshot()]);
    apiPost.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.includes("/answers/")) {
        const { ApiError } = await import("@/lib/api");
        throw new ApiError(
          401,
          "session expired confidential-detail",
          "AUTH_REQUIRED",
          undefined,
          "req-401-env",
        );
      }
      return { ok: true, serverNow: NOW };
    });

    renderPage();
    await editAnswer();

    await waitFor(
      () => {
        expect(screen.getByText("部分答案尚未保存成功")).toBeInTheDocument();
      },
      { timeout: 4000 },
    );
    // 4xx: the server ANSWERED — no connectivity claim, no server-fault
    // claim, and no business-rejection alert (that surface is for 200
    // accepted:false bodies only).
    expect(screen.queryByText("连接异常")).not.toBeInTheDocument();
    expect(screen.queryByText("服务器错误")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("save-rejection-alert"),
    ).not.toBeInTheDocument();

    await flushAll();
    const failed = telemetryEvents(send, "answer_autosave_failed");
    expect(failed).toHaveLength(1);
    const meta = failed[0]!.metadata as Record<string, unknown>;
    expect(meta.errorCode).toBe("AUTH_REQUIRED");
    expect(meta.status).toBe(401);
    expect(meta.requestId).toBe("req-401-env");
  });

  it("a save 403 keeps the same three-way contract with its envelope id", async () => {
    const send = installRecordingBuffer();
    installTakeRoute([buildSnapshot()]);
    apiPost.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.includes("/answers/")) {
        const { ApiError } = await import("@/lib/api");
        throw new ApiError(
          403,
          "forbidden confidential-detail",
          "FORBIDDEN",
          undefined,
          "req-403-env",
        );
      }
      return { ok: true, serverNow: NOW };
    });

    renderPage();
    await editAnswer();

    await waitFor(
      () => {
        expect(screen.getByText("部分答案尚未保存成功")).toBeInTheDocument();
      },
      { timeout: 4000 },
    );
    expect(screen.queryByText("连接异常")).not.toBeInTheDocument();
    expect(screen.queryByText("服务器错误")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("save-rejection-alert"),
    ).not.toBeInTheDocument();

    await flushAll();
    const failed = telemetryEvents(send, "answer_autosave_failed");
    expect(failed).toHaveLength(1);
    const meta = failed[0]!.metadata as Record<string, unknown>;
    expect(meta.errorCode).toBe("FORBIDDEN");
    expect(meta.status).toBe(403);
    expect(meta.requestId).toBe("req-403-env");
  });

  it("transport failure then online retry: two HTTP attempts, independent clientSeqs, and no fabricated id in either telemetry row", async () => {
    const send = installRecordingBuffer();
    installTakeRoute([buildSnapshot()]);
    // Header present on every response — yet neither the transport-failed
    // row (no response existed for the client to observe) nor the success
    // row (Case A guard) may carry it.
    postMeta.requestId = "req-retry-865";
    let answersCalls = 0;
    apiPost.mockImplementation(
      async (path: string, body?: { clientSeq?: number }) => {
        if (typeof path === "string" && path.includes("/answers/")) {
          answersCalls += 1;
          if (answersCalls === 1) {
            throw new Error("socket hang up");
          }
          return { accepted: true, serverVersion: 1, savedAt: NOW };
        }
        return { ok: true, serverNow: NOW };
      },
    );

    renderPage();
    await editAnswer();

    await waitFor(
      () => {
        expect(screen.getByText("连接异常")).toBeInTheDocument();
      },
      { timeout: 4000 },
    );

    // Connectivity restored: the online listener retries through the EXISTING
    // orchestration and the ACK flips the chip to saved.
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    await waitFor(
      () => {
        expect(screen.getByText("已保存")).toBeInTheDocument();
      },
      { timeout: 4000 },
    );

    await flushAll();
    const started = telemetryEvents(send, "answer_autosave_started");
    expect(started).toHaveLength(2);
    const seqA = (started[0]!.metadata as Record<string, unknown>).clientSeq;
    const seqB = (started[1]!.metadata as Record<string, unknown>).clientSeq;
    expect(seqA).not.toBe(seqB);

    const failed = telemetryEvents(send, "answer_autosave_failed");
    expect(failed).toHaveLength(1);
    const failedMeta = failed[0]!.metadata as Record<string, unknown>;
    expect(failedMeta.errorCode).toBe("NETWORK");
    // UNKNOWN semantics: no response was observed, so no id may be claimed.
    expect(failedMeta).not.toHaveProperty("requestId");

    const success = telemetryEvents(send, "answer_autosave_success");
    expect(success).toHaveLength(1);
    expect(success[0]!.metadata).not.toHaveProperty("requestId");
  }, 10_000);

  it("an old attempt's delayed rejection (with header id) never writes the new attempt's state or telemetry", async () => {
    const send = installRecordingBuffer();
    const snap1 = buildSnapshot({ attemptId: "att-1" }, [
      fillBlankQuestion("q1"),
    ]);
    const snap2 = buildSnapshot({ attemptId: "att-2" }, [
      fillBlankQuestion("q2"),
    ]);
    apiGet.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.includes("/candidate/attempts/")) {
        if (path.includes("att-1")) return snap1;
        if (path.includes("att-2")) return snap2;
      }
      throw new Error(`unexpected GET ${path}`);
    });
    postMeta.requestId = "req-att1-late";
    let resolveAtt1Save: ((value: unknown) => void) | null = null;
    apiPost.mockImplementation(
      (path: string) =>
        new Promise((resolve) => {
          if (typeof path === "string" && path.includes("/answers/")) {
            resolveAtt1Save = resolve;
            return;
          }
          resolve({ ok: true, serverNow: NOW });
        }),
    );

    const { navigate } = renderPage();
    await editAnswer();
    // The att-1 save is now IN FLIGHT (debounce fired, response pending).
    await waitFor(
      () => {
        expect(resolveAtt1Save).not.toBeNull();
      },
      { timeout: 4000 },
    );

    act(() => {
      navigate("/exam/exam-1/take/att-2");
    });
    await screen.findByText("填空 q2");

    // The old attempt's rejection (200 accepted:false + header id) settles
    // AFTER the route change — every write behind this point is scoped to
    // the OLD attempt and must not touch the new page.
    await act(async () => {
      resolveAtt1Save!(rejection("INVALID_ANSWER"));
    });

    expect(
      screen.queryByTestId("save-rejection-alert"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("已保存")).toBeInTheDocument();
    expect(screen.queryByText("保存失败")).not.toBeInTheDocument();

    await flushAll();
    expect(telemetryEvents(send, "answer_autosave_failed")).toHaveLength(0);
    expect(telemetryEvents(send, "answer_autosave_success")).toHaveLength(0);
  }, 10_000);

  it("a later successful save clears both rejection states (alert and id) from the prior rejection", async () => {
    const send = installRecordingBuffer();
    installTakeRoute([
      buildSnapshot({}, [fillBlankQuestion("q1"), fillBlankQuestion("q2")]),
    ]);
    let answersCalls = 0;
    apiPost.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.includes("/answers/")) {
        answersCalls += 1;
        if (answersCalls === 1) {
          postMeta.requestId = "req-q1-rej";
          return rejection("INVALID_ANSWER");
        }
        postMeta.requestId = "req-q2-ok";
        return { accepted: true, serverVersion: 1, savedAt: NOW };
      }
      return { ok: true, serverNow: NOW };
    });

    renderPage();
    await editAnswer();
    await screen.findByTestId("save-rejection-alert", {}, { timeout: 4000 });

    // Move to q2 and save successfully: the success clears the rejection
    // alert AND its id together (same-point clear) — no residual 请求编号.
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "下一题" }));
    await editAnswer();
    await waitFor(
      () => {
        expect(screen.getByText("已保存")).toBeInTheDocument();
      },
      { timeout: 4000 },
    );
    expect(
      screen.queryByTestId("save-rejection-alert"),
    ).not.toBeInTheDocument();

    await flushAll();
    // Success telemetry stays id-free even though this response carried one
    // (Case A guard) — the rejection row keeps its own id.
    const failed = telemetryEvents(send, "answer_autosave_failed");
    expect(failed).toHaveLength(1);
    expect((failed[0]!.metadata as Record<string, unknown>).requestId).toBe(
      "req-q1-rej",
    );
    const success = telemetryEvents(send, "answer_autosave_success");
    expect(success).toHaveLength(1);
    expect(success[0]!.metadata).not.toHaveProperty("requestId");
  }, 10_000);

  it("mixed sequence: q1 rejected with an id, then q2 rejected WITHOUT a header — the alert shows q2's copy with no residual id", async () => {
    const send = installRecordingBuffer();
    installTakeRoute([
      buildSnapshot({}, [fillBlankQuestion("q1"), fillBlankQuestion("q2")]),
    ]);
    let answersCalls = 0;
    apiPost.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.includes("/answers/")) {
        answersCalls += 1;
        if (answersCalls === 1) {
          postMeta.requestId = "req-q1-rej";
          return rejection("INVALID_ANSWER");
        }
        // Second rejection arrives with NO header (older hop): the id state
        // must be overwritten to null in the same write as the rejection.
        postMeta.requestId = null;
        return rejection("FUTURE_VERSION");
      }
      return { ok: true, serverNow: NOW };
    });

    renderPage();
    await editAnswer();
    const firstAlert = await screen.findByTestId(
      "save-rejection-alert",
      {},
      { timeout: 4000 },
    );
    expect(firstAlert).toHaveTextContent("请求编号：req-q1-rej");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "下一题" }));
    await editAnswer();
    // q1's alert is still mounted when q2's edit is typed — wait for q2's
    // OWN rejection copy, not the mere presence of the alert.
    await waitFor(
      () => {
        expect(screen.getByTestId("save-rejection-alert")).toHaveTextContent(
          "答案版本超前",
        );
      },
      { timeout: 4000 },
    );
    const secondAlert = screen.getByTestId("save-rejection-alert");
    // q2's own rejection copy, and q1's id must NOT survive into it.
    expect(secondAlert).not.toHaveTextContent("请求编号");
    expect(secondAlert).not.toHaveTextContent("req-q1-rej");

    await flushAll();
    // Per-question telemetry rows carry only their own observation.
    const failed = telemetryEvents(send, "answer_autosave_failed");
    expect(failed).toHaveLength(2);
    expect((failed[0]!.metadata as Record<string, unknown>).requestId).toBe(
      "req-q1-rej",
    );
    expect(failed[1]!.metadata).not.toHaveProperty("requestId");
  }, 10_000);

  it("the save path is the single answer-save implementation (postWithMeta, no second save call site)", () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "TakeExamPage.tsx"),
      "utf8",
    );
    expect(
      source.match(/api\.postWithMeta<SaveAnswerResponseDTO>/g),
    ).toHaveLength(1);
    // A second save implementation (plain api.post on the same DTO) would be
    // an uncorrelated second path — the retry/flush/recovery flows must all
    // reuse the one saveAnswer orchestration.
    expect(source.match(/api\.post<SaveAnswerResponseDTO>/g)).toBeNull();
  });
});
