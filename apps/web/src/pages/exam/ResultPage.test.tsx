import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { ResultPage } from "./ResultPage";

// The shell's viewport switch is CSS-only, so BOTH representations of the
// result detail are in the DOM in every test run (the real browser shows one
// and display:none-hides the other). Region-scoped queries target one
// representation; whole-screen queries prove copy shared by both.
function representationRegion(kind: "desktop" | "mobile") {
  const el = document.querySelector(
    kind === "desktop"
      ? '[data-slot="responsive-desktop-region"]'
      : '[data-slot="responsive-mobile-region"]',
  );
  if (!el) throw new Error(`responsive ${kind} region not mounted`);
  return within(el as HTMLElement);
}

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
    get: vi.fn(),
  },
}));

const getMock = vi.mocked(api.get);

// jsdom reports 0 for every box metric; the answer disclosure reads
// scrollHeight/clientHeight to decide whether content overflows the clamp
// budget, so tests stub the metrics the real browser reports on the element
// prototype (restored after each use).
let originalMetrics: {
  scrollHeight?: PropertyDescriptor;
  clientHeight?: PropertyDescriptor;
};

function stubElementMetrics(metrics: {
  scrollHeight: number;
  clientHeight: number;
}) {
  const proto = Element.prototype;
  originalMetrics = {
    scrollHeight: Object.getOwnPropertyDescriptor(proto, "scrollHeight"),
    clientHeight: Object.getOwnPropertyDescriptor(proto, "clientHeight"),
  };
  Object.defineProperty(proto, "scrollHeight", {
    configurable: true,
    get: () => metrics.scrollHeight,
  });
  Object.defineProperty(proto, "clientHeight", {
    configurable: true,
    get: () => metrics.clientHeight,
  });
}

function restoreElementMetrics() {
  const proto = Element.prototype;
  for (const key of ["scrollHeight", "clientHeight"] as const) {
    const desc = originalMetrics?.[key];
    if (desc) Object.defineProperty(proto, key, desc);
    else delete (proto as unknown as Record<string, unknown>)[key];
  }
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/exam/attempt-1/result"]}>
      <Routes>
        <Route path="/exam/:attemptId/result" element={<ResultPage />} />
        <Route path="/exam/list" element={<div>考试列表</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ResultPage", () => {
  beforeEach(() => {
    getMock.mockReset();
  });

  it("shows score card and answer indicators for immediate results", async () => {
    getMock.mockResolvedValue({
      attemptId: "attempt-1",
      status: "graded",
      showResultImmediately: true,
      examTitle: "能力测验",
      passingScore: 6,
      totalScore: 10,
      passed: true,
      gradedAt: "2026-06-01T00:00:00.000Z",
      questionResults: [
        {
          questionId: "q1",
          type: "single_choice",
          content: "选择正确答案",
          order: 0,
          candidateAnswer: "a",
          score: 10,
          maxScore: 10,
          correct: true,
        },
        {
          questionId: "q2",
          type: "single_choice",
          content: "另一题",
          order: 1,
          candidateAnswer: "b",
          score: 0,
          maxScore: 10,
          correct: false,
        },
      ],
    });

    renderPage();

    expect(await screen.findByText("10")).toBeInTheDocument();
    expect(screen.getByText("已通过")).toBeInTheDocument();
    // The detail renders twice in the DOM (desktop table + mobile blocks; the
    // CSS viewport switch shows one) — 2 questions × 2 representations.
    expect(screen.getAllByText("单选")).toHaveLength(4);
    expect(screen.getAllByLabelText("回答正确")).toHaveLength(2);
    expect(screen.getAllByLabelText("回答错误")).toHaveLength(2);
  });

  it("shows only the neutral fallback when results are hidden", async () => {
    getMock.mockResolvedValue({
      attemptId: "attempt-1",
      status: "graded",
      showResultImmediately: false,
      examTitle: "能力测验",
    });

    renderPage();

    expect(
      await screen.findByTestId("result-status-message"),
    ).toHaveTextContent("暂无法查看成绩，请稍后重试");
    expect(screen.queryByText("及格线")).not.toBeInTheDocument();
  });

  it("shows pending_publish message when hiddenReason is pending_publish", async () => {
    getMock.mockResolvedValue({
      attemptId: "attempt-1",
      status: "graded",
      showResultImmediately: false,
      examTitle: "能力测验",
      hiddenReason: "pending_publish",
    });

    renderPage();

    expect(
      await screen.findByTestId("result-status-message"),
    ).toHaveTextContent("评分已完成，成绩尚未公布");
  });

  it("shows not_graded message when hiddenReason is not_graded", async () => {
    getMock.mockResolvedValue({
      attemptId: "attempt-1",
      status: "graded",
      showResultImmediately: false,
      examTitle: "能力测验",
      hiddenReason: "not_graded",
    });

    renderPage();

    expect(
      await screen.findByTestId("result-status-message"),
    ).toHaveTextContent("成绩暂未满足查看条件，请稍后查看");
  });

  it("falls back to the neutral message when hiddenReason is unknown/missing", async () => {
    getMock.mockResolvedValue({
      attemptId: "attempt-1",
      status: "graded",
      showResultImmediately: false,
      examTitle: "能力测验",
      // hiddenReason is optional on the wire — the fallback must not assert
      // any particular lifecycle state (e.g. submitted).
    });

    renderPage();

    expect(
      await screen.findByTestId("result-status-message"),
    ).toHaveTextContent("暂无法查看成绩，请稍后重试");
  });

  it("published (visible) result still displays score details", async () => {
    getMock.mockResolvedValue({
      attemptId: "attempt-1",
      status: "graded",
      showResultImmediately: true,
      examTitle: "能力测验",
      passingScore: 6,
      totalScore: 8,
      passed: true,
      gradedAt: "2026-06-01T00:00:00.000Z",
      questionResults: [],
    });

    renderPage();

    expect(await screen.findByText("已通过")).toBeInTheDocument();
    expect(screen.getByText("8")).toBeInTheDocument();
  });

  it("shows submitted lifecycle copy from the wire status, not the hiddenReason catch-all (#698)", async () => {
    // Deadline auto-submit holding state: answers frozen, grading pending.
    // The REAL wire carries the engine's historical catch-all hiddenReason
    // ("not_started") for non-graded attempts — the page must key lifecycle
    // copy on status, never render the catch-all "考试尚未开始" literally.
    getMock.mockResolvedValue({
      attemptId: "attempt-1",
      status: "submitted",
      showResultImmediately: false,
      examTitle: "能力测验",
      hiddenReason: "not_started",
    });

    renderPage();

    expect(
      await screen.findByTestId("result-status-message"),
    ).toHaveTextContent("已交卷，等待评分完成");
    expect(screen.queryByText("考试尚未开始")).not.toBeInTheDocument();
  });

  it("shows disrupted copy with a warning icon from the wire status", async () => {
    getMock.mockResolvedValue({
      attemptId: "attempt-1",
      status: "disrupted",
      showResultImmediately: false,
      examTitle: "能力测验",
      hiddenReason: "not_started",
    });

    const { container } = renderPage();

    expect(
      await screen.findByTestId("result-status-message"),
    ).toHaveTextContent("答题已中断，请返回考试列表尝试恢复");
    // Hidden states are not successes — the icon must not render the green
    // success treatment the visible/graded result uses.
    expect(container.querySelector("svg[data-app-icon]")).toHaveClass(
      "text-warning",
    );
    expect(container.querySelector("svg[data-app-icon]")).not.toHaveClass(
      "text-success",
    );
  });

  it("shows in-progress copy from the wire status", async () => {
    getMock.mockResolvedValue({
      attemptId: "attempt-1",
      status: "in_progress",
      showResultImmediately: false,
      examTitle: "能力测验",
      hiddenReason: "not_started",
    });

    renderPage();

    expect(
      await screen.findByTestId("result-status-message"),
    ).toHaveTextContent("考试正在进行中，尚未交卷");
  });

  it("shows queued copy from the wire status", async () => {
    getMock.mockResolvedValue({
      attemptId: "attempt-1",
      status: "queued",
      showResultImmediately: false,
      examTitle: "能力测验",
      hiddenReason: "not_started",
    });

    renderPage();

    expect(
      await screen.findByTestId("result-status-message"),
    ).toHaveTextContent("尚未开始答题，暂无成绩");
  });

  it("shows voided copy with a destructive icon from the wire status", async () => {
    getMock.mockResolvedValue({
      attemptId: "attempt-1",
      status: "voided",
      showResultImmediately: false,
      examTitle: "能力测验",
      hiddenReason: "not_started",
    });

    const { container } = renderPage();

    expect(
      await screen.findByTestId("result-status-message"),
    ).toHaveTextContent("本次考试记录已作废，无法查看成绩");
    expect(container.querySelector("svg[data-app-icon]")).toHaveClass(
      "text-destructive",
    );
  });

  it("clamps a long fill blank answer behind a keyboard-operable disclosure (R1-F2)", async () => {
    const longAnswer =
      "这是一个远超三行预览高度的较长填空答案，收起时只应看到截断预览，展开后必须完整可读，悬停提示不得是唯一全文入口。";
    getMock.mockResolvedValue({
      attemptId: "attempt-1",
      status: "graded",
      showResultImmediately: true,
      examTitle: "能力测验",
      passingScore: 6,
      totalScore: 10,
      passed: true,
      gradedAt: "2026-06-01T00:00:00.000Z",
      questionResults: [
        {
          questionId: "q1",
          type: "fill_blank",
          content: "填写答案",
          order: 0,
          candidateAnswer: longAnswer,
          manualGraded: false,
          score: 10,
          maxScore: 10,
          correct: true,
        },
      ],
    });

    stubElementMetrics({ scrollHeight: 120, clientHeight: 66 });
    try {
      renderPage();

      // The full value stays in the DOM (selectable, announced) — only the
      // presentation is clamped; a hover tooltip is not the full-text entry.
      // Both representations render it (2 = desktop cell + mobile block).
      expect(await screen.findAllByText(longAnswer)).toHaveLength(2);
      const desktop = representationRegion("desktop");

      // The disclosure is a real button with an expanded state, rendered at
      // the smallest authorized Button geometry (h-9; DESIGN.md "Standard
      // desktop control: 36px") — no page-local height override.
      const toggle = desktop.getByRole("button", { name: "展开全文" });
      expect(toggle).toHaveAttribute("aria-expanded", "false");
      expect(toggle).toHaveClass("h-9");
      expect(toggle).not.toHaveClass("h-6");

      await userEvent.click(toggle);
      expect(desktop.getByRole("button", { name: "收起" })).toHaveAttribute(
        "aria-expanded",
        "true",
      );

      // Keyboard operable: Enter on the focused toggle collapses again.
      await userEvent.keyboard("{Enter}");
      expect(desktop.getByRole("button", { name: "展开全文" })).toHaveAttribute(
        "aria-expanded",
        "false",
      );
    } finally {
      restoreElementMetrics();
    }
  });

  it("clamps a long text_response answer below its metadata line (R1-F2)", async () => {
    const essay =
      "印象最深的是密码加盐哈希存储，因为培训前系统把口令直接哈希入库，加盐能让相同口令得到不同摘要，配合慢哈希可以显著提高离线破解成本。";
    getMock.mockResolvedValue({
      attemptId: "attempt-1",
      status: "graded",
      showResultImmediately: true,
      examTitle: "能力测验",
      passingScore: 6,
      totalScore: 10,
      passed: true,
      gradedAt: "2026-06-01T00:00:00.000Z",
      questionResults: [
        {
          questionId: "q1",
          type: "text_response",
          content: "简答题",
          order: 0,
          candidateAnswer: essay,
          manualGraded: true,
          score: 8,
          maxScore: 10,
          correct: false,
        },
      ],
    });

    stubElementMetrics({ scrollHeight: 220, clientHeight: 66 });
    try {
      renderPage();

      // Full essay text stays in the DOM behind the clamped presentation
      // (2 = the desktop cell + the mobile block).
      expect(await screen.findAllByText(essay)).toHaveLength(2);
      const desktop = representationRegion("desktop");
      // The metadata (verdict icon + manual marker) renders as its own line;
      // the answer text is no longer squeezed beside it.
      expect(desktop.getByLabelText("回答错误")).toBeInTheDocument();
      expect(desktop.getByText("主观题")).toBeInTheDocument();
      expect(desktop.getByRole("button", { name: "展开全文" })).toHaveAttribute(
        "aria-expanded",
        "false",
      );
    } finally {
      restoreElementMetrics();
    }
  });

  it("renders no disclosure toggle when the answer fits the clamp budget", async () => {
    getMock.mockResolvedValue({
      attemptId: "attempt-1",
      status: "graded",
      showResultImmediately: true,
      examTitle: "能力测验",
      passingScore: 6,
      totalScore: 10,
      passed: true,
      gradedAt: "2026-06-01T00:00:00.000Z",
      questionResults: [
        {
          questionId: "q1",
          type: "fill_blank",
          content: "填写答案",
          order: 0,
          candidateAnswer: "短答案",
          manualGraded: false,
          score: 10,
          maxScore: 10,
          correct: true,
        },
      ],
    });

    stubElementMetrics({ scrollHeight: 44, clientHeight: 66 });
    try {
      renderPage();

      // The short answer renders in both representations (2 = desktop +
      // mobile) and neither mounts a disclosure toggle.
      expect(await screen.findAllByText("短答案")).toHaveLength(2);
      expect(
        screen.queryByRole("button", { name: /展开全文|收起/ }),
      ).not.toBeInTheDocument();
    } finally {
      restoreElementMetrics();
    }
  });

  it("renders every legal question type through the shared localized dictionary (no raw enum leak)", async () => {
    getMock.mockResolvedValue({
      attemptId: "attempt-1",
      status: "graded",
      showResultImmediately: true,
      examTitle: "题型词典回归",
      passingScore: 5,
      totalScore: 5,
      passed: true,
      gradedAt: "2026-06-01T00:00:00.000Z",
      questionResults: [
        {
          questionId: "q1",
          type: "single_choice",
          content: "单选题干",
          order: 0,
          candidateAnswer: "a",
          score: 1,
          maxScore: 1,
          correct: true,
        },
        {
          questionId: "q2",
          type: "multiple_choice",
          content: "多选题干",
          order: 1,
          candidateAnswer: ["a", "b"],
          score: 1,
          maxScore: 1,
          correct: true,
        },
        {
          questionId: "q3",
          type: "fill_blank",
          content: "填空题干",
          order: 2,
          candidateAnswer: "答案",
          manualGraded: false,
          score: 1,
          maxScore: 1,
          correct: true,
        },
        {
          questionId: "q4",
          type: "true_false",
          content: "判断题干",
          order: 3,
          candidateAnswer: true,
          score: 1,
          maxScore: 1,
          correct: true,
        },
        {
          questionId: "q5",
          type: "text_response",
          content: "文本题干",
          order: 4,
          candidateAnswer: "考生作答内容",
          manualGraded: true,
          score: 1,
          maxScore: 1,
          correct: true,
        },
      ],
    });

    renderPage();

    await screen.findByTestId("result-total-score");
    // Raw enum values must not surface as UI text (R1-F3) — in either
    // representation.
    expect(screen.queryByText("text_response")).not.toBeInTheDocument();
    // The shared questionType dictionary covers every legal QuestionType with
    // localized copy — the type column must never fall back to the raw key.
    const desktop = representationRegion("desktop");
    expect(desktop.getByText("单选")).toBeInTheDocument();
    expect(desktop.getByText("多选")).toBeInTheDocument();
    expect(desktop.getByText("填空")).toBeInTheDocument();
    expect(desktop.getByText("判断")).toBeInTheDocument();
    expect(desktop.getByText("文本作答")).toBeInTheDocument();
    // The mobile per-question blocks render the same shared dictionary.
    expect(
      representationRegion("mobile").getByText("文本作答"),
    ).toBeInTheDocument();
  });

  it("removes the empty correct-answer column and keeps the manual marker visible", async () => {
    getMock.mockResolvedValue({
      attemptId: "attempt-1",
      status: "graded",
      showResultImmediately: true,
      examTitle: "R0-F4 回归",
      passingScore: 2,
      totalScore: 2,
      passed: true,
      gradedAt: "2026-06-01T00:00:00.000Z",
      questionResults: [
        {
          questionId: "q1",
          type: "single_choice",
          content: "客观题干",
          order: 0,
          candidateAnswer: "a",
          manualGraded: false,
          score: 1,
          maxScore: 1,
          correct: true,
        },
        {
          questionId: "q2",
          type: "text_response",
          content: "主观题干",
          order: 1,
          candidateAnswer: "考生作答",
          manualGraded: true,
          score: 1,
          maxScore: 1,
          correct: true,
        },
      ],
    });

    renderPage();

    await screen.findByTestId("result-total-score");
    // R0-F4: the column promised "正确答案" but the candidate DTO never
    // carries one (EXSEM-017), so every cell was a visibility placeholder
    // (— / 主观题). The column is gone entirely.
    expect(screen.queryByText("正确答案")).not.toBeInTheDocument();
    expect(screen.queryByText("—")).not.toBeInTheDocument();
    // The page states why no reference answers are shown.
    expect(screen.getByText("参考答案不公开")).toBeInTheDocument();
    // The manualGraded marker survives at its new home (your-answer cell) —
    // never silently dropped, in BOTH representations (2 = desktop + mobile),
    // and only the genuinely manual question carries it.
    expect(screen.getAllByText("主观题")).toHaveLength(2);
  });

  it("renders the mobile per-question view from the same business data (WS2 S2.4)", async () => {
    getMock.mockResolvedValue({
      attemptId: "attempt-1",
      status: "graded",
      showResultImmediately: true,
      examTitle: "R0-F2 回归",
      passingScore: 2,
      totalScore: 2,
      passed: true,
      gradedAt: "2026-06-01T00:00:00.000Z",
      questionResults: [
        {
          questionId: "q1",
          type: "single_choice",
          content: "移动端题干一",
          order: 0,
          candidateAnswer: "a",
          manualGraded: false,
          score: 1,
          maxScore: 1,
          correct: true,
        },
        {
          questionId: "q2",
          type: "text_response",
          content: "移动端题干二",
          order: 1,
          candidateAnswer: "移动端长作答",
          manualGraded: true,
          score: 1,
          maxScore: 1,
          correct: true,
        },
      ],
    });

    renderPage();

    await screen.findByTestId("result-total-score");
    const mobile = representationRegion("mobile");
    // One semantically grouped block per question: numbered header with the
    // score (the primary conclusion), content, type, and the answer.
    expect(mobile.getByTestId("result-mobile-questions").children).toHaveLength(
      2,
    );
    expect(mobile.getByText("第 1 题")).toBeInTheDocument();
    expect(mobile.getByText("第 2 题")).toBeInTheDocument();
    expect(mobile.getAllByText("1/1")).toHaveLength(2);
    expect(mobile.getByText("移动端题干一")).toBeInTheDocument();
    expect(mobile.getByText("移动端题干二")).toBeInTheDocument();
    expect(mobile.getByText("移动端长作答")).toBeInTheDocument();
    // Same verdict + manual semantics as the desktop table.
    expect(mobile.getAllByLabelText("回答正确")).toHaveLength(2);
    expect(mobile.getByText("主观题")).toBeInTheDocument();
  });

  it("navigates back to the exam list", async () => {
    getMock.mockResolvedValue({
      attemptId: "attempt-1",
      status: "graded",
      showResultImmediately: false,
      examTitle: "能力测验",
    });
    renderPage();

    await userEvent.click(
      await screen.findByRole("button", { name: "返回考试列表" }),
    );
    expect(screen.getByText("考试列表")).toBeInTheDocument();
  });

  // ── P3-MOD-P3-2: independent result/answer visibility gates ──────
  // The Candidate result DTO strips standardAnswer server-side and never
  // carries rubric, so the realistic candidate DTO has score visible but NO
  // answer material. These tests prove ResultPage does NOT self-infer answer
  // visibility from score-visible or from grading state — it only renders what
  // the DTO gate says.

  it("score visible + answers hidden — renders score but not standardAnswer/rubric", async () => {
    // Realistic candidate DTO: standardAnswer stripped (undefined) by the API,
    // no rubric field. The page must show score/pass and must NOT open an
    // answer-review section just because the score is visible. manualGraded
    // survives the stripping, so only genuinely manual questions keep the
    // "主观题" marker; there is no correct-answer column at all (R0-F4).
    getMock.mockResolvedValue({
      attemptId: "attempt-1",
      status: "graded",
      showResultImmediately: true,
      examTitle: "P3-2 mixed",
      passingScore: 10,
      totalScore: 25,
      passed: true,
      gradedAt: "2026-07-01T00:00:00.000Z",
      questionResults: [
        {
          questionId: "q-obj",
          type: "single_choice",
          content: "P3-2 objective prompt",
          order: 0,
          candidateAnswer: "a",
          // standardAnswer intentionally ABSENT (server strips it for candidates)
          manualGraded: false,
          score: 10,
          maxScore: 10,
          correct: true,
        },
        {
          questionId: "q-text",
          type: "text_response",
          content: "P3-2 essay prompt",
          order: 1,
          candidateAnswer: "candidate essay",
          // standardAnswer absent; rubric is never in the DTO
          manualGraded: true,
          score: 15,
          maxScore: 20,
          correct: true,
        },
      ],
    });

    renderPage();

    // Score gate open: totalScore + pass render.
    expect(await screen.findByTestId("result-total-score")).toHaveTextContent(
      "25",
    );
    expect(screen.getByText("已通过")).toBeInTheDocument();

    // Answer gate closed (DTO carries no standardAnswer): there is no
    // correct-answer column at all (R0-F4 removal) — the objective question
    // renders neither a real answer nor a hidden placeholder.
    expect(screen.queryByText("正确答案")).not.toBeInTheDocument();
    expect(screen.queryByText("—")).not.toBeInTheDocument();
    // The genuinely manual question keeps the manual marker (2 = the desktop
    // cell + the mobile block).
    expect(screen.getAllByText("主观题")).toHaveLength(2);
    // No rubric is ever rendered by ResultPage (it is not in the DTO contract).
    expect(screen.queryByText(/评分标准|rubric/i)).not.toBeInTheDocument();
  });

  it("does not self-release result from grading state when DTO gate is hidden", async () => {
    // Deliberately cross-wired DTO: terminal grading state (graded) BUT the
    // authoritative result gate says hidden. ResultPage must keep the result
    // hidden — it must not infer release from status=graded.
    getMock.mockResolvedValue({
      attemptId: "attempt-1",
      status: "graded",
      showResultImmediately: false,
      hiddenReason: "pending_publish",
      examTitle: "P3-2 manual hidden",
    });

    renderPage();

    // Pending message shows; no score/pass leaked.
    expect(await screen.findByTestId("result-status-message")).toBeVisible();
    expect(screen.queryByTestId("result-total-score")).not.toBeInTheDocument();
    expect(screen.queryByText("已通过")).not.toBeInTheDocument();
  });
});
