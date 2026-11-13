import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TakeExamPage } from "./TakeExamPage";
import type { CandidateTakeSnapshot } from "@exam/contracts";
import { setBuffer, getBuffer } from "@/lib/logger";
import {
  __resetExamTelemetryForTest,
  __flushPendingForTest,
} from "@/lib/examTelemetry";
import {
  NOW,
  NavigateProbe,
  SnapshotQuestion,
  buildTakeSnapshot,
  fillBlankQuestion,
  installRecordingBuffer,
  takeExamProviders,
  telemetryEvents,
} from "./TakeExamPage.testHarness";

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

function buildSnapshot(
  overrides: Partial<CandidateTakeSnapshot> = {},
  questions: SnapshotQuestion[] = [fillBlankQuestion("q1")],
): CandidateTakeSnapshot {
  return buildTakeSnapshot({ timingMode: "untimed", questions, ...overrides });
}

const { apiGet, apiPost, postMeta } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  /** Per-test stand-in for the 200 response's x-request-id header. */
  postMeta: { requestId: null as string | null },
}));

vi.mock("@/lib/api", async () => {
  const { createTakeApiModuleMock, makeApiErrorStub } =
    await import("./TakeExamPage.apiMockHarness");
  return {
    ApiError: makeApiErrorStub(),
    // The save path calls postWithMeta; the wrapper delegates to the SAME
    // apiPost mock so url/body/throw assertions stay single-sourced, and
    // threads the per-test header id through postMeta.requestId.
    ...createTakeApiModuleMock({ apiGet, apiPost, postMeta }),
  };
});

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

async function flushAll(): Promise<void> {
  // answer_autosave_success is coalesced (5s window) — emit pending
  // coalesced events first so success-row assertions see them.
  __flushPendingForTest();
  await getBuffer().flush();
}

function renderPage() {
  const navigateRef: { current: ((to: string) => void) | null } = {
    current: null,
  };
  render(
    takeExamProviders({
      initialPath: "/exam/exam-1/take/att-1",
      children: (
        <>
          <NavigateProbe register={(n) => (navigateRef.current = n)} />
          <Routes>
            <Route
              path="/exam/:examId/take/:attemptId"
              element={<TakeExamPage />}
            />
          </Routes>
        </>
      ),
    }),
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

  it("a STALE_VERSION on the current revision is a business failure: the rejection alert carries the header id and failure telemetry records it", async () => {
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

    // This revision was NOT accepted: the failure surface applies (alert +
    // id + failed chip), and the candidate's input is preserved.
    await waitFor(
      () => {
        expect(screen.getByText("保存失败")).toBeInTheDocument();
      },
      { timeout: 4000 },
    );
    const alert = screen.getByTestId("save-rejection-alert");
    expect(alert).toHaveTextContent("服务器上存在更新的答案版本");
    expect(alert).toHaveTextContent("请求编号：req-stale-865");
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes[0]).toBeChecked();
    expect(boxes[1]).not.toBeChecked();

    await flushAll();
    expect(telemetryEvents(send, "answer_autosave_success")).toHaveLength(0);
    const failed = telemetryEvents(send, "answer_autosave_failed");
    expect(failed).toHaveLength(1);
    const meta = failed[0]!.metadata as Record<string, unknown>;
    expect(meta.errorCode).toBe("STALE_VERSION");
    expect(meta.requestId).toBe("req-stale-865");
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

  // W5.1: the SUCCESS variant of the same stale-response guard — a delayed
  // accepted:true response from the OLD attempt settles after the route
  // change and must not write the new attempt's chip, version map, or
  // telemetry (the post-await saveStale() scope guard returns before every
  // write; the started row already emitted belongs to the old attempt).
  it("an old attempt's delayed save SUCCESS (with header id) never writes the new attempt's state or telemetry", async () => {
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
    postMeta.requestId = "req-att1-late-ok";
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
    // The att-1 save is IN FLIGHT (debounce fired, response pending).
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

    // The old attempt's accepted:true settles AFTER the route change.
    await act(async () => {
      resolveAtt1Save!({ accepted: true, serverVersion: 1, savedAt: NOW });
    });

    // The new attempt's chip stays on its own idle claim; no stale editing
    // state, no rejection surface from the old attempt's episode.
    expect(screen.getByText("已保存")).toBeInTheDocument();
    expect(screen.queryByText("保存中...")).not.toBeInTheDocument();
    expect(screen.queryByText("保存失败")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("save-rejection-alert"),
    ).not.toBeInTheDocument();

    await flushAll();
    // Neither a success row (the late ACK belongs to the old attempt) nor a
    // failure row (an ACK is not a failure) lands on the new attempt.
    expect(telemetryEvents(send, "answer_autosave_success")).toHaveLength(0);
    expect(telemetryEvents(send, "answer_autosave_failed")).toHaveLength(0);
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
    // R6 (#971): the chip derives from EVERY question's revision status, so
    // q1's still-failed revision keeps the chip on 保存失败 — q2's success
    // no longer flips the chip to the synced claim behind a failed question
    // (the per-question banner remains the "which question" surface).
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "下一题" }));
    await editAnswer();
    // q2's ACK is the discriminating event: it clears the rejection alert
    // and its id together (same-point clear, #924) — no residual 请求编号.
    await waitFor(
      () => {
        expect(
          screen.queryByTestId("save-rejection-alert"),
        ).not.toBeInTheDocument();
      },
      { timeout: 4000 },
    );
    // R6 (#971): the chip derives from EVERY question's revision status, so
    // q1's still-failed revision keeps the chip on 保存失败 — q2's success
    // no longer flips the chip to the synced claim behind a failed question
    // (the per-question banner remains the "which question" surface).
    expect(screen.getByText("保存失败")).toBeInTheDocument();
    expect(screen.getByText("部分答案尚未保存成功")).toBeInTheDocument();
    expect(screen.queryByText("已保存")).not.toBeInTheDocument();

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

/**
 * Heartbeat × save-rejection interaction (TASK-CONTRACT §3.4: "不因
 * Heartbeat 的 requestId 覆盖一次 SaveAnswer 的拒绝 ID"). The two states are
 * structurally separate writers (the heartbeat only touches the server-fault
 * trio), but that separation is a contract, not an accident — these pin it
 * against a future "unified" regression. Fake timers drive the 30s heartbeat
 * deterministically (no edit is needed for it to fire).
 */
describe("heartbeat never overwrites the save-rejection id (#924, TASK-CONTRACT §3.4)", () => {
  async function editCurrentBlank(value: string) {
    const input = screen.getByLabelText("第1空答案");
    await act(async () => {
      fireEvent.change(input, { target: { value } });
    });
  }

  it("a heartbeat 5xx updates the server-fault banner on its own; the rejection id survives the failure/restore cycle unchanged", async () => {
    const send = installRecordingBuffer();
    // Null effectiveDeadline (untimed allows it): under the frozen fake
    // clock the default Jul-4 deadline is ALWAYS in the past, which would
    // fire the deadline auto-submit machinery every second and bury the
    // heartbeat cycle under its state churn.
    installTakeRoute([buildSnapshot({ effectiveDeadline: null })]);
    postMeta.requestId = "req-rej-hb-865";
    let heartbeatCalls = 0;
    let q1SaveCalls = 0;
    apiPost.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.includes("/answers/")) {
        q1SaveCalls += 1;
        if (q1SaveCalls === 1) {
          return rejection("FUTURE_VERSION");
        }
        // Post-restore retries of q1 answer 403: the catch path claims
        // neither connectivity nor server fault and NEVER re-writes the
        // rejection pair — so the id shown at steady state is the one the
        // ORIGINAL rejection wrote, making any heartbeat-path overwrite or
        // clear of it observable instead of masked by retry re-writes.
        const { ApiError } = await import("@/lib/api");
        throw new ApiError(403, "forbidden confidential-detail", "FORBIDDEN");
      }
      if (typeof path === "string" && path.includes("/heartbeat")) {
        heartbeatCalls += 1;
        if (heartbeatCalls === 1) {
          const { ApiError } = await import("@/lib/api");
          throw new ApiError(
            500,
            "heartbeat boom confidential-detail",
            "INTERNAL_ERROR",
            undefined,
            "req-hb-500",
          );
        }
        return { ok: true, serverNow: NOW };
      }
      return { ok: true, serverNow: NOW };
    });

    vi.useFakeTimers();
    renderPage();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    // Sync query: under fake timers findBy* polling never advances — the
    // advance above already flushed the snapshot GET's microtasks.
    expect(screen.getByText("填空 q1")).toBeInTheDocument();
    await editCurrentBlank("x");
    // Debounce (1500ms) fires → 200 rejection → the alert shows its id.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(screen.getByTestId("save-rejection-alert")).toHaveTextContent(
      "请求编号：req-rej-hb-865",
    );

    // First heartbeat fails 5xx: the server-fault banner carries the
    // HEARTBEAT's own envelope id, never the rejection's; the rejection
    // alert is hidden while disconnected but its state is untouched.
    //
    // Timing: the heartbeat interval re-arms across render cycles, so the
    // beat sits at no fixed fake-time offset — drive it with whole-interval
    // jumps (fine 250ms stepping starves the re-arming interval) and stop
    // at the first observable state.
    let faultShown = false;
    for (let jump = 0; jump < 4 && !faultShown; jump += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(31_000);
      });
      faultShown = screen.queryByTestId("server-fault-alert") !== null;
    }
    expect(
      faultShown,
      "first heartbeat must render the server-fault banner",
    ).toBe(true);
    const faultBanner = screen.getByTestId("server-fault-alert");
    expect(faultBanner).toHaveTextContent("错误编号：req-hb-500");
    expect(faultBanner).not.toHaveTextContent("req-rej-hb-865");
    expect(
      screen.queryByTestId("save-rejection-alert"),
    ).not.toBeInTheDocument();

    // Next heartbeat succeeds: connectivity restored → the rejection alert
    // reappears with the ORIGINAL id — the heartbeat's id neither overwrote
    // the rejection pair nor cleared it (§3.4), and nothing re-writes the
    // pair afterwards (q1 retries 403), so the steady state is the proof.
    let alertRestored = false;
    for (let jump = 0; jump < 4 && !alertRestored; jump += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(31_000);
      });
      alertRestored = (
        screen.queryByTestId("save-rejection-alert")?.textContent ?? ""
      ).includes("请求编号：req-rej-hb-865");
    }
    expect(
      alertRestored,
      "restored heartbeat must re-surface the rejection alert with its id",
    ).toBe(true);
    const alert = screen.getByTestId("save-rejection-alert");
    expect(alert).not.toHaveTextContent("req-hb-500");
    expect(screen.queryByTestId("server-fault-alert")).not.toBeInTheDocument();
  }, 10_000);

  it("a later transport failure hides the rejection alert; restored connectivity re-surfaces it with the id and no 错误编号", async () => {
    // Save-path variant of the §3.4 separation, single-question shape (the
    // same deterministic skeleton as the online-retry test above): a
    // transport failure's isDisconnected HIDES the pending rejection alert
    // without consuming it, and the restoration that clears the fault trio
    // leaves the rejection pair (and its id) untouched. The heartbeat-
    // triggered restoration cycle is pinned by the sibling test above.
    const send = installRecordingBuffer();
    // Null effectiveDeadline — same fake-clock rationale as the sibling test.
    installTakeRoute([buildSnapshot({ effectiveDeadline: null })]);
    postMeta.requestId = "req-q1-rej";
    let saveCalls = 0;
    apiPost.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.includes("/answers/")) {
        saveCalls += 1;
        if (saveCalls === 1) {
          return rejection("INVALID_ANSWER");
        }
        if (saveCalls === 2) {
          throw new Error("socket hang up");
        }
        // The post-restoration retry answers 403: the catch path clears
        // isDisconnected while claiming neither connectivity nor server
        // fault and never re-writes the rejection pair, so the id shown at
        // steady state is the one the ORIGINAL rejection wrote.
        const { ApiError } = await import("@/lib/api");
        throw new ApiError(403, "forbidden confidential-detail", "FORBIDDEN");
      }
      return { ok: true, serverNow: NOW };
    });

    vi.useFakeTimers();
    renderPage();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText("填空 q1")).toBeInTheDocument();

    // Save 1: business rejection with an id → alert visible.
    await editCurrentBlank("x");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(screen.getByTestId("save-rejection-alert")).toHaveTextContent(
      "请求编号：req-q1-rej",
    );

    // Save 2 (another edit): transport failure → connectivity banner, the
    // rejection alert hidden (isDisconnected), the pair only hidden.
    await editCurrentBlank("y");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(screen.getByText("连接异常")).toBeInTheDocument();
    expect(
      screen.queryByTestId("save-rejection-alert"),
    ).not.toBeInTheDocument();

    // Connectivity restored (online event → existing retry orchestration):
    // the 403-answered retry clears isDisconnected only — the rejection
    // alert+id re-surface untouched, and no 错误编号 text appears anywhere.
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    const alert = screen.getByTestId("save-rejection-alert");
    expect(alert).toHaveTextContent("请求编号：req-q1-rej");
    expect(screen.queryByText("连接异常")).not.toBeInTheDocument();
    expect(screen.queryByText(/错误编号/)).not.toBeInTheDocument();

    await flushAll();
    const failed = telemetryEvents(send, "answer_autosave_failed");
    // The ORIGINAL rejection row keeps its own id; the transport row and
    // the 403 retry rows claim none — no invented or borrowed ids anywhere.
    for (const row of failed) {
      const meta = row.metadata as Record<string, unknown>;
      if (meta.errorCode === "INVALID_ANSWER") {
        expect(meta.requestId).toBe("req-q1-rej");
      } else {
        expect(
          meta.errorCode === "FORBIDDEN" || meta.errorCode === "NETWORK",
        ).toBe(true);
        expect(meta).not.toHaveProperty("requestId");
      }
    }
    expect(failed.length).toBeGreaterThanOrEqual(2);
  }, 10_000);
});
