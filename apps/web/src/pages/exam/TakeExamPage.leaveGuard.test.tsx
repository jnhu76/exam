import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes, useLocation, useNavigate } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TakeExamPage } from "./TakeExamPage";
import { ExamLayout } from "@/components/layout/ExamLayout";
import type {
  CandidateTakeSnapshot,
  SaveAnswerResponseDTO,
} from "@exam/contracts";
import {
  NOW,
  SnapshotQuestion,
  buildTakeSnapshot,
  fillBlankQuestion,
  singleChoiceQuestion,
  submittedFrozenSnapshot,
  takeExamProviders,
} from "./TakeExamPage.testHarness";

/**
 * W2 (#971 F-01) — controlled leave-page save contract.
 *
 * The candidate shell (ExamLayout) owns every Exam-controlled exit from the
 * take page: the exam-list NavLink, the account-settings item, and the
 * logout item. Before the shell navigates, the take page's EXISTING
 * per-question serial save queue must drain and obtain server ACKs; only
 * then may navigation proceed. A failed or timed-out save keeps the page and
 * the edits and demands the explicit abandon confirmation; frozen
 * (non-saveable) pages leave freely because they own nothing unconfirmed.
 * An exit request during a deadline auto-submit episode is declined — the
 * authoritative submit flow owns the page's next location. Browser Back /
 * close / hard refresh are NOT Exam-controlled exits under BrowserRouter
 * (data-router migration is a documented tradeoff; crash persistence is
 * #827).
 */

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
    ...createTakeApiModuleMock({ apiGet, apiPost, postMeta }),
  };
});

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function snapshotWith(
  questions: SnapshotQuestion[],
  overrides: Partial<CandidateTakeSnapshot> = {},
): CandidateTakeSnapshot {
  return buildTakeSnapshot({ timingMode: "untimed", questions, ...overrides });
}

function rejectedSave(): SaveAnswerResponseDTO {
  return {
    accepted: false,
    reason: "INVALID_ANSWER",
    message: "invalid",
    serverVersion: 0,
    savedAt: NOW,
  };
}

function acceptedSave(): SaveAnswerResponseDTO {
  return { accepted: true, serverVersion: 1, savedAt: NOW };
}

/** Location readout so navigation assertions do not depend on page internals. */
function LocationProbe() {
  const location = useLocation();
  return <span data-testid="current-path">{location.pathname}</span>;
}

function NavProbe({
  register,
}: {
  register: (nav: (to: string) => void) => void;
}) {
  register(useNavigate());
  return null;
}

function renderShell() {
  const navigateRef: { current: ((to: string) => void) | null } = {
    current: null,
  };
  const utils = render(
    takeExamProviders({
      initialPath: "/exam/exam-1/take/att-1",
      children: (
        <>
          <LocationProbe />
          <NavProbe register={(n) => (navigateRef.current = n)} />
          <Routes>
            <Route path="/login" element={<span>登录页</span>} />
            <Route path="/exam" element={<ExamLayout />}>
              <Route path="list" element={<span>列表页</span>} />
              <Route path="settings" element={<span>设置页</span>} />
              <Route
                path=":examId/take/:attemptId"
                element={<TakeExamPage />}
              />
              <Route path=":attemptId/result" element={<span>结果页</span>} />
            </Route>
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

function installNotificationMock() {
  apiGet.mockImplementation(async (path: string) => {
    if (
      typeof path === "string" &&
      path.includes("/api/notifications/unread-count")
    ) {
      return { count: 0 };
    }
    throw new Error(`unexpected GET ${path}`);
  });
}

function answerPostCalls() {
  return apiPost.mock.calls.filter(
    ([p]) => typeof p === "string" && p.includes("/answers/"),
  ) as Array<[string, Record<string, unknown>]>;
}

/** Clicks a button by text inside a dialog container selected by testid. */
function clickDialogButton(testId: string, text: string): void {
  const dialog = screen.getByTestId(testId);
  const button = Array.from(dialog.querySelectorAll("button")).find((b) =>
    b.textContent?.includes(text),
  );
  if (!button) {
    throw new Error(`button "${text}" not found in ${testId}`);
  }
  fireEvent.click(button);
}

/** Waits (real timers) until the element with the given testid is gone. */
async function waitForGone(testId: string): Promise<void> {
  for (let i = 0; i < 100; i += 1) {
    if (!document.querySelector(`[data-testid="${testId}"]`)) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  expect(document.querySelector(`[data-testid="${testId}"]`)).toBeNull();
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

describe("controlled leave-page save (#971 F-01)", () => {
  it("editing → clicking the exam-list exit BEFORE the debounce fires → the save drains and obtains the server ACK → only then does navigation proceed; re-entering the attempt shows the server snapshot with the typed answer", async () => {
    const q1 = fillBlankQuestion("q1");
    let serverHasAnswer = false;
    apiGet.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.includes("/candidate/attempts/")) {
        takeHandler(path);
        return serverHasAnswer
          ? snapshotWith([{ ...q1, answerValue: "答案甲" }])
          : snapshotWith([q1]);
      }
      if (
        typeof path === "string" &&
        path.includes("/api/notifications/unread-count")
      ) {
        return { count: 0 };
      }
      throw new Error(`unexpected GET ${path}`);
    });

    // Response latch: the ACK is held back so the test can prove navigation
    // WAITS for the business ACK instead of racing it.
    const ack = deferred<SaveAnswerResponseDTO>();
    apiPost.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.includes("/answers/")) {
        return ack.promise;
      }
      return { ok: true, serverNow: NOW };
    });

    const { navigate } = renderShell();
    const input = await screen.findByLabelText("第1空答案");

    // Edit and click the exit inside the 1500ms debounce window (same tick):
    // the pending timer must not be what carries the answer.
    fireEvent.change(input, { target: { value: "答案甲" } });
    expect(screen.getByText("保存中...")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: "我的考试" }));

    // The controlled leave started the save queue and holds the shell on the
    // take page until the server confirms.
    expect(answerPostCalls()).toHaveLength(1);
    const [postPath, body] = answerPostCalls()[0]!;
    expect(postPath).toBe("/api/attempts/att-1/answers/q1");
    expect(body).toMatchObject({
      attemptId: "att-1",
      questionId: "q1",
      answer: "答案甲",
      clientSeq: 1,
      baseVersion: 0,
    });
    expect(screen.queryByText("列表页")).not.toBeInTheDocument();
    expect(screen.getByTestId("current-path")).toHaveTextContent(
      "/exam/exam-1/take/att-1",
    );
    // The wait is visible: the leave-hold dialog states the save is running.
    expect(screen.getByTestId("leave-saving-dialog")).toBeInTheDocument();

    // Server ACK → navigation finally proceeds.
    await act(async () => {
      ack.resolve(acceptedSave());
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(await screen.findByText("列表页")).toBeInTheDocument();
    expect(screen.getByTestId("current-path")).toHaveTextContent("/exam/list");
    // The unmount after navigation must not double-fire the drained save.
    expect(answerPostCalls()).toHaveLength(1);

    // Re-enter the same attempt: the (mock) server snapshot now carries the
    // acknowledged answer — nothing typed before leaving was lost.
    serverHasAnswer = true;
    act(() => {
      navigate("/exam/exam-1/take/att-1");
    });
    const input2 = await screen.findByLabelText("第1空答案");
    expect(input2).toHaveValue("答案甲");
  });

  it("duplicate exit clicks start ONE drain and navigate once", async () => {
    apiGet.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.includes("/candidate/attempts/")) {
        takeHandler(path);
        return snapshotWith([fillBlankQuestion("q1")]);
      }
      if (
        typeof path === "string" &&
        path.includes("/api/notifications/unread-count")
      ) {
        return { count: 0 };
      }
      throw new Error(`unexpected GET ${path}`);
    });
    const ack = deferred<SaveAnswerResponseDTO>();
    apiPost.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.includes("/answers/")) {
        return ack.promise;
      }
      return { ok: true, serverNow: NOW };
    });

    renderShell();
    const input = await screen.findByLabelText("第1空答案");
    fireEvent.change(input, { target: { value: "答案甲" } });
    const exit = screen.getByRole("link", { name: "我的考试" });
    fireEvent.click(exit);
    fireEvent.click(exit);

    expect(answerPostCalls()).toHaveLength(1);

    await act(async () => {
      ack.resolve(acceptedSave());
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(await screen.findByText("列表页")).toBeInTheDocument();
    expect(answerPostCalls()).toHaveLength(1);
  });

  it("a failed save keeps the page: the abandon dialog names the risk explicitly; 留在本页 stays with the retry entry, and a later confirmed exit succeeds after the retry ACK", async () => {
    apiGet.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.includes("/candidate/attempts/")) {
        takeHandler(path);
        return snapshotWith([fillBlankQuestion("q1")]);
      }
      if (
        typeof path === "string" &&
        path.includes("/api/notifications/unread-count")
      ) {
        return { count: 0 };
      }
      throw new Error(`unexpected GET ${path}`);
    });
    let rejectNext = true;
    apiPost.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.includes("/answers/")) {
        return rejectNext ? rejectedSave() : acceptedSave();
      }
      return { ok: true, serverNow: NOW };
    });

    renderShell();
    const input = await screen.findByLabelText("第1空答案");
    fireEvent.change(input, { target: { value: "答案甲" } });
    fireEvent.click(screen.getByRole("link", { name: "我的考试" }));

    // The rejection surfaces: page retained, explicit abandon decision.
    expect(
      await screen.findByTestId("leave-abandon-dialog"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("current-path")).toHaveTextContent(
      "/exam/exam-1/take/att-1",
    );
    expect(screen.getByText(/1 道题的修改未获服务器确认/)).toBeInTheDocument();

    // 留在本页: stay; the per-question retry banner remains reachable.
    clickDialogButton("leave-abandon-dialog", "留在本页");
    await waitForGone("leave-abandon-dialog");
    expect(screen.getByTestId("current-path")).toHaveTextContent(
      "/exam/exam-1/take/att-1",
    );
    expect(
      screen.getByRole("button", { name: "重试保存" }),
    ).toBeInTheDocument();

    rejectNext = false;
    fireEvent.click(screen.getByRole("button", { name: "重试保存" }));
    await waitFor(() => {
      expect(screen.getByText("已保存")).toBeInTheDocument();
    });
    await waitForGone("save-rejection-alert");

    // A confirmed exit now succeeds without the abandon dialog.
    fireEvent.click(screen.getByRole("link", { name: "我的考试" }));
    expect(await screen.findByText("列表页")).toBeInTheDocument();
    expect(
      screen.queryByTestId("leave-abandon-dialog"),
    ).not.toBeInTheDocument();
  });

  it("放弃修改并离开 abandons the unconfirmed edits only after the candidate explicitly confirms", async () => {
    apiGet.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.includes("/candidate/attempts/")) {
        takeHandler(path);
        return snapshotWith([fillBlankQuestion("q1")]);
      }
      if (
        typeof path === "string" &&
        path.includes("/api/notifications/unread-count")
      ) {
        return { count: 0 };
      }
      throw new Error(`unexpected GET ${path}`);
    });
    apiPost.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.includes("/answers/")) {
        return rejectedSave();
      }
      return { ok: true, serverNow: NOW };
    });

    renderShell();
    const input = await screen.findByLabelText("第1空答案");
    fireEvent.change(input, { target: { value: "答案甲" } });
    fireEvent.click(screen.getByRole("link", { name: "我的考试" }));

    expect(
      await screen.findByTestId("leave-abandon-dialog"),
    ).toBeInTheDocument();

    const postsBefore = answerPostCalls().length;
    clickDialogButton("leave-abandon-dialog", "放弃修改并离开");
    expect(await screen.findByText("列表页")).toBeInTheDocument();
    // Abandoning did NOT attempt another save.
    expect(answerPostCalls()).toHaveLength(postsBefore);
  });

  it("账号设置 is a guarded exit: navigation waits for the save ACK", async () => {
    apiGet.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.includes("/candidate/attempts/")) {
        takeHandler(path);
        return snapshotWith([fillBlankQuestion("q1")]);
      }
      if (
        typeof path === "string" &&
        path.includes("/api/notifications/unread-count")
      ) {
        return { count: 0 };
      }
      throw new Error(`unexpected GET ${path}`);
    });
    const ack = deferred<SaveAnswerResponseDTO>();
    apiPost.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.includes("/answers/")) {
        return ack.promise;
      }
      return { ok: true, serverNow: NOW };
    });

    renderShell();
    const input = await screen.findByLabelText("第1空答案");
    fireEvent.change(input, { target: { value: "答案甲" } });

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "账号菜单" }));
    await user.click(await screen.findByText("账号设置"));

    expect(answerPostCalls()).toHaveLength(1);
    expect(screen.queryByText("设置页")).not.toBeInTheDocument();
    await act(async () => {
      ack.resolve(acceptedSave());
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(await screen.findByText("设置页")).toBeInTheDocument();
  });

  it("退出登录 is a guarded exit: POST /auth/logout fires only after the save ACK, then the login page renders", async () => {
    apiGet.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.includes("/candidate/attempts/")) {
        takeHandler(path);
        return snapshotWith([fillBlankQuestion("q1")]);
      }
      if (
        typeof path === "string" &&
        path.includes("/api/notifications/unread-count")
      ) {
        return { count: 0 };
      }
      throw new Error(`unexpected GET ${path}`);
    });
    const ack = deferred<SaveAnswerResponseDTO>();
    apiPost.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.includes("/answers/")) {
        return ack.promise;
      }
      return { ok: true, serverNow: NOW };
    });

    renderShell();
    const input = await screen.findByLabelText("第1空答案");
    fireEvent.change(input, { target: { value: "答案甲" } });

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "账号菜单" }));
    await user.click(await screen.findByText("退出登录"));

    expect(answerPostCalls()).toHaveLength(1);
    const logoutCallsBefore = apiPost.mock.calls.filter(
      ([p]) => typeof p === "string" && p.includes("/auth/logout"),
    );
    expect(logoutCallsBefore).toHaveLength(0);
    expect(screen.queryByText("登录页")).not.toBeInTheDocument();

    await act(async () => {
      ack.resolve(acceptedSave());
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(await screen.findByText("登录页")).toBeInTheDocument();
    const calls = apiPost.mock.calls.map(([p]) => String(p));
    expect(calls.findIndex((p) => p.includes("/answers/"))).toBeLessThan(
      calls.findIndex((p) => p.includes("/auth/logout")),
    );
  });

  it("a frozen (non-saveable) page leaves freely — it owns nothing unconfirmed", async () => {
    apiGet.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.includes("/candidate/attempts/")) {
        takeHandler(path);
        return submittedFrozenSnapshot({ timingMode: "untimed" });
      }
      if (
        typeof path === "string" &&
        path.includes("/api/notifications/unread-count")
      ) {
        return { count: 0 };
      }
      throw new Error(`unexpected GET ${path}`);
    });
    apiPost.mockResolvedValue({ ok: true, serverNow: NOW });

    renderShell();
    await screen.findByTestId("deadline-overlay");
    fireEvent.click(screen.getByRole("link", { name: "我的考试" }));
    expect(await screen.findByText("列表页")).toBeInTheDocument();
    expect(screen.queryByTestId("leave-saving-dialog")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("leave-abandon-dialog"),
    ).not.toBeInTheDocument();
  });

  it("an exit request during a deadline auto-submit episode is declined; the authoritative submit flow owns the next location", async () => {
    const T0 = new Date("2026-07-04T10:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    const NEAR = new Date(T0.getTime() + 3_000).toISOString();
    let episodeInFlight = false;
    let submitted = false;
    const verify = deferred<CandidateTakeSnapshot>();
    apiGet.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.includes("/candidate/attempts/")) {
        takeHandler(path);
        if (episodeInFlight) return verify.promise;
        if (submitted) {
          return snapshotWith(
            [singleChoiceQuestion("q1", { prompt: "选择一项" })],
            {
              serverNow: new Date(T0.getTime() + 3_100).toISOString(),
              isEditable: false,
              canSave: false,
              canSubmit: false,
              lockReason: "deadline",
              attemptStatus: "submitted",
              submittedAt: new Date(T0.getTime() + 3_000).toISOString(),
              effectiveDeadline: NEAR,
            },
          );
        }
        return snapshotWith(
          [singleChoiceQuestion("q1", { prompt: "选择一项" })],
          {
            serverNow: T0.toISOString(),
            effectiveDeadline: NEAR,
          },
        );
      }
      if (
        typeof path === "string" &&
        path.includes("/api/notifications/unread-count")
      ) {
        return { count: 0 };
      }
      throw new Error(`unexpected GET ${path}`);
    });
    apiPost.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.includes("/answers/")) {
        return acceptedSave();
      }
      if (typeof path === "string" && path.includes("/submit")) {
        submitted = true;
        return { ok: true, serverNow: NOW };
      }
      return { ok: true, serverNow: NOW };
    });

    renderShell();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // Edit, then cross the deadline so the auto-submit episode declares.
    fireEvent.click(screen.getByRole("radio", { name: "B" }));
    episodeInFlight = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_500);
    });
    // The episode drained the edit into the answers POST and is awaiting its
    // verification read.
    expect(answerPostCalls()).toHaveLength(1);

    // Competing exit request while the episode owns the page's next location.
    fireEvent.click(screen.getByRole("link", { name: "我的考试" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(screen.queryByText("列表页")).not.toBeInTheDocument();

    // The episode completes: server-frozen verification → submit → result.
    // Synchronous assertions after timer advances: RTL waitFor polling does
    // not run under vitest fake timers (no jest global), so findBy* hangs.
    episodeInFlight = false;
    await act(async () => {
      verify.resolve(
        snapshotWith([singleChoiceQuestion("q1", { prompt: "选择一项" })], {
          serverNow: new Date(T0.getTime() + 3_100).toISOString(),
          isEditable: false,
          canSave: false,
          canSubmit: false,
          lockReason: "deadline",
          attemptStatus: "submitted",
          submittedAt: new Date(T0.getTime() + 3_000).toISOString(),
          effectiveDeadline: NEAR,
        }),
      );
      await vi.advanceTimersByTimeAsync(200);
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(screen.getByText("结果页")).toBeInTheDocument();
    expect(screen.queryByText("列表页")).not.toBeInTheDocument();
    // Flush-before-submit ordering preserved: the answer POST preceded it.
    const postPaths = apiPost.mock.calls.map(([p]) => String(p));
    expect(postPaths.findIndex((p) => p.includes("/answers/"))).toBeLessThan(
      postPaths.findIndex((p) => p.includes("/submit")),
    );
  });
});
