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
import { TakeExamPage } from "./TakeExamPage";
import type { CandidateTakeSnapshot } from "@exam/contracts";
import {
  NOW,
  NavigateProbe,
  SnapshotQuestion,
  buildTakeSnapshot,
  fillBlankQuestion,
  singleChoiceQuestion,
  submittedFrozenSnapshot,
  takeExamProviders,
} from "./TakeExamPage.testHarness";

/**
 * Save-state chip (SaveIndicator) mapping over every setSaveState write path
 * in TakeExamPage:
 *   P1 initial idle / P2 route reset / P3 edit → saving / P4 canSave=false
 *   skip → error / P5 ACK → saved / P6 stale reconcile → saved /
 *   P7 server rejection → error / P8 network failure → error.
 *
 * Established by S3.1 characterization and carried through the S3.2 idle
 * remediation. The idle copy is 已保存 (idle = no pending edit and the
 * displayed content is the server state — every unacknowledged edit keeps
 * the chip in saving/error), so the authoritative capability "UI 已保存 =
 * 服务器 ACK 语义" (docs/product/standard-supported-capabilities.zh-CN.md §8)
 * holds: an edit that was never acknowledged must never render 已保存.
 */

function buildSnapshot(
  overrides: Partial<CandidateTakeSnapshot> = {},
  questions: SnapshotQuestion[] = [fillBlankQuestion("q1")],
): CandidateTakeSnapshot {
  return buildTakeSnapshot({ timingMode: "untimed", questions, ...overrides });
}

const { apiGet, apiPost, takeHandler, postMeta } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  takeHandler: vi.fn(),
  postMeta: { requestId: null as string | null },
}));

vi.mock("@/lib/api", async () => {
  const { createTakeApiModuleMock, makeApiErrorStub } =
    await import("./TakeExamPage.apiMockHarness");
  return {
    ApiError: makeApiErrorStub(),
    // #924: the save path calls postWithMeta; it delegates to the same
    // apiPost mock (url/body assertions stay single-sourced) and threads the
    // per-test response-header id through postMeta.requestId.
    ...createTakeApiModuleMock({ apiGet, apiPost, postMeta }),
  };
});

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function renderPage() {
  const navigateRef: { current: ((to: string) => void) | null } = {
    current: null,
  };
  const utils = render(
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
    ...utils,
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

beforeEach(() => {
  apiGet.mockReset();
  apiPost.mockReset();
  takeHandler.mockReset();
  postMeta.requestId = null;
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

    // P1: before any edit the chip renders the idle copy — the steady state
    // reads as synced (nothing pending), not as an outstanding save.
    expect(await screen.findByText("已保存")).toBeInTheDocument();

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
    installTakeRoute([
      buildSnapshot({}, [
        singleChoiceQuestion("q1", { prompt: "选择一项 q1" }),
      ]),
    ]);
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

    // S3.3 division of labor: the connection banner explains the CONNECTION
    // state (and the don't-close warning); it no longer promises save
    // recovery. The answer-save state, the auto-retry mention, and the manual
    // retry action live in the save-retry banner.
    expect(
      screen.getByText("网络连接已中断，正在自动重试；请不要关闭页面。"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/连接恢复后继续保存/)).not.toBeInTheDocument();
    expect(
      screen.getByText("网络恢复后会自动重试；也可以立即手动重试。"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "重试保存" }),
    ).toBeInTheDocument();

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
    // #924: the rejection response carries an x-request-id header — the
    // reconcile branch must be unchanged by its presence (no failure fact,
    // no rejection alert; the captured id is simply unused on this path).
    postMeta.requestId = "req-p6-stale-865";

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
    expect(
      screen.queryByTestId("save-rejection-alert"),
    ).not.toBeInTheDocument();
    // R6: a reconciled reply is NOT "this edit was accepted". The page
    // states that the server's existing answer is now displayed — this edit
    // was replaced, not accepted (STALE_VERSION distinction).
    expect(screen.getByTestId("stale-reconcile-notice")).toBeInTheDocument();
    expect(
      screen.getByText(
        "已显示服务器上已保存的答案；你本次修改未被保存，可重新编辑。",
      ),
    ).toBeInTheDocument();
  });

  it("a stale reply that arrives while a NEWER unconfirmed edit exists does not clobber the editor: it advances version knowledge only, and the newer save replays against the advanced server version (R6)", async () => {
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
            { id: "c", content: "C", contentDocument: null },
          ],
          inputMode: "choice",
          maxScore: 10,
          answerValue: null,
          answerSource: "none",
        },
      ]),
    ]);
    // The first save (older revision ["a"]) is held inflight; it then
    // resolves STALE_VERSION AFTER a newer edit (["b"]) is scheduled. The
    // second save must fire with baseVersion advanced from the stale reply.
    const staleAck = deferred<{
      accepted: false;
      reason: "STALE_VERSION";
      message: string;
      serverVersion: number;
      savedAt: string;
      details: { serverAnswer: string[] };
    }>();
    let call = 0;
    apiPost.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.includes("/answers/")) {
        call += 1;
        if (call === 1) {
          return staleAck.promise;
        }
        return { accepted: true, serverVersion: 4, savedAt: NOW };
      }
      return { ok: true, serverNow: NOW };
    });

    renderPage();
    const user = userEvent.setup();
    const boxes = await screen.findAllByRole("checkbox");
    await user.click(boxes[0]!); // revision 1: ["a"]
    // Hold until revision 1 is on the wire (inflight, ACK latched).
    await waitFor(
      () => {
        expect(answersPostCalls().length).toBe(1);
      },
      { timeout: 4000 },
    );

    // Newer unconfirmed edit while the old save is on the wire.
    const freshBoxes = screen.getAllByRole("checkbox");
    await user.click(freshBoxes[1]!); // revision 2: ["b"]

    await act(async () => {
      staleAck.resolve({
        accepted: false,
        reason: "STALE_VERSION",
        message: "stale",
        serverVersion: 3,
        savedAt: NOW,
        details: { serverAnswer: ["a", "c"] },
      });
      await Promise.resolve();
    });

    // The editor still shows the CANDIDATE's newest unconfirmed input — the
    // old reply's serverAnswer (["a","c"]) must NOT overwrite it. Revision 2
    // accumulated to ["a","b"]: A and B stay checked, C (only in the stale
    // reply's serverAnswer) must NOT appear. Applying the serverAnswer would
    // uncheck B and check C.
    const after = screen.getAllByRole("checkbox");
    expect(after[0]).toBeChecked();
    expect(after[1]).toBeChecked();
    expect(after[2]).not.toBeChecked();
    expect(
      screen.queryByTestId("stale-reconcile-notice"),
    ).not.toBeInTheDocument();

    // The newer revision replays with the ADVANCED baseVersion (3 from the
    // stale reply's serverVersion), so it is accepted by the server.
    await waitFor(
      () => {
        expect(answersPostCalls().length).toBe(2);
      },
      { timeout: 4000 },
    );
    const [, secondBody] = answersPostCalls()[1]!;
    expect(secondBody.answer).toEqual(["a", "b"]);
    expect(secondBody.baseVersion).toBe(3);
    await waitFor(
      () => {
        expect(screen.getByText("已保存")).toBeInTheDocument();
      },
      { timeout: 4000 },
    );
  });

  it("keeps the failed question's state visible after a later question saves — the chip is DERIVED from every question's revision status, not a last-event slot (#677 F6, R6)", async () => {
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

    // Move to q2 and save successfully: the chip stays on 保存失败 — a
    // later question's success must NOT mask an earlier question's failed
    // revision (R6: derived from ALL per-question statuses, not the last
    // event). The per-question banner persists alongside it.
    await user.click(screen.getByRole("button", { name: "下一题" }));
    const input2 = await screen.findByLabelText("第1空答案");
    await user.type(input2, "y");

    await waitFor(
      () => {
        expect(screen.getByText("部分答案尚未保存成功")).toBeInTheDocument();
      },
      { timeout: 4000 },
    );
    expect(screen.getByText("保存失败")).toBeInTheDocument();
    expect(screen.queryByText("已保存")).not.toBeInTheDocument();
  });

  it("derives 保存中 from an earlier question's saved revision while the current question's edit is still unconfirmed (q1 ACK ≠ q2 synced, R6)", async () => {
    // q1's save is HELD inflight; q2's edit sits in its debounce window. The
    // chip must read 保存中 the whole time — never 已保存 — because q2's
    // revision is unconfirmed even while q1's is not yet ACKed either.
    const ackLatch = deferred();
    installTakeRoute([
      buildSnapshot({}, [fillBlankQuestion("q1"), fillBlankQuestion("q2")]),
    ]);
    apiPost.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.includes("/answers/q1")) {
        return ackLatch.promise;
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
        expect(
          apiPost.mock.calls.some(
            ([p]) => typeof p === "string" && p.includes("/answers/q1"),
          ),
        ).toBe(true);
      },
      { timeout: 4000 },
    );

    // Move to q2 and edit while q1's ACK is still held: chip reads 保存中.
    await user.click(screen.getByRole("button", { name: "下一题" }));
    const input2 = await screen.findByLabelText("第1空答案");
    await user.type(input2, "y");
    expect(screen.getByText("保存中...")).toBeInTheDocument();
    expect(screen.queryByText("已保存")).not.toBeInTheDocument();

    // q2's ACK lands while q1 is STILL inflight: the chip must stay 保存中 —
    // q2's success cannot declare the whole page synced (R6).
    await waitFor(
      () => {
        expect(
          apiPost.mock.calls.some(
            ([p]) => typeof p === "string" && p.includes("/answers/q2"),
          ),
        ).toBe(true);
      },
      { timeout: 4000 },
    );
    expect(screen.getByText("保存中...")).toBeInTheDocument();
    expect(screen.queryByText("已保存")).not.toBeInTheDocument();

    // q1's ACK finally lands: everything confirmed → the chip reads saved.
    await act(async () => {
      ackLatch.resolve({ accepted: true, serverVersion: 1, savedAt: NOW });
      await Promise.resolve();
    });
    await waitFor(
      () => {
        expect(screen.getByText("已保存")).toBeInTheDocument();
      },
      { timeout: 4000 },
    );
  });

  it("route reset maps the chip back to idle for the new attempt — the old attempt's un-ACKed saving state must not leak (P2)", async () => {
    // P2 (render-time reset at the route change) is what clears saveState
    // when the SAME component instance switches attempts: without it, the
    // old attempt's un-ACKed 保存中... would persist onto the new attempt's
    // page (applySnapshot never writes saveState). Two attempts, real timers.
    const snap1 = buildSnapshot({ attemptId: "att-1" }, [
      fillBlankQuestion("q1"),
    ]);
    const snap2 = buildSnapshot({ attemptId: "att-2" }, [
      fillBlankQuestion("q2"),
    ]);
    apiGet.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.includes("/candidate/attempts/")) {
        takeHandler(path);
        if (path.includes("att-1")) return snap1;
        if (path.includes("att-2")) return snap2;
      }
      throw new Error(`unexpected GET ${path}`);
    });
    apiPost.mockResolvedValue({ ok: true, serverNow: NOW });

    const { navigate } = renderPage();
    const input = await screen.findByLabelText("第1空答案");
    const user = userEvent.setup();
    await user.type(input, "x");

    // att-1 is inside its un-ACK window: the chip reads 保存中...
    expect(screen.getByText("保存中...")).toBeInTheDocument();

    // Switch attempts while the edit is still unacknowledged.
    act(() => {
      navigate("/exam/exam-1/take/att-2");
    });
    // att-2's own question is rendered.
    await screen.findByText("填空 q2");

    // P2: the new attempt starts from the idle claim (its displayed content
    // IS the att-2 server state); the stale 保存中... must be gone.
    expect(screen.getByText("已保存")).toBeInTheDocument();
    expect(screen.queryByText("保存中...")).not.toBeInTheDocument();
    // The save never fired against either attempt: the pending timer was
    // cancelled by the scope change, so no answers POST exists at all.
    expect(answersPostCalls()).toHaveLength(0);
  });
});

describe("save-state chip mapping (fake timers — skip path)", () => {
  it("a pending edit whose attempt turns non-saveable before the debounce fires is skipped: no POST, chip reads 保存失败, never 已保存 (P4)", async () => {
    const getTakeCalls = installTakeRoute([
      buildSnapshot({}, [
        singleChoiceQuestion("q1", { prompt: "选择一项 q1" }),
      ]),
      // The authoritative re-read returns the frozen submitted snapshot.
      submittedFrozenSnapshot({ timingMode: "untimed" }),
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
    // the chip maps the skip to the error copy: a skipped (unacknowledged)
    // edit must claim neither 已保存 nor 已同步 (UNACKNOWLEDGED != SAVED).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(answersPostCalls()).toHaveLength(0);
    expect(screen.getByText("保存失败")).toBeInTheDocument();
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
