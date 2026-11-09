import {
  test,
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";
import { loginAsAdmin } from "../lib/login";
import type { SeededCandidate } from "../lib/seed";
import {
  adminApiToken,
  adminPost,
  candidateApiToken,
  candidateLogin,
  startExamFromList,
  submitExam,
  waitForSaveSaved,
} from "../lib/flow";

/**
 * Rich-content overflow & keyboard contract (#S2.4 / R1–R7).
 *
 * This is the browser layer of the shared contract proved in
 * ContentDocumentRenderer.overflow.test.tsx: a formula, code block or table
 * that is intrinsically wider than its slot must become ONE local scroll
 * viewport, must not widen the surrounding table/card/page, must be reachable
 * with real Tab, must scroll with real ArrowRight, and must be left with
 * Shift+Tab. Content that fits adds no tab stop.
 *
 * The fixture is a real authored question + a real exam attempt: the rich
 * answer is persisted through the production answer-save protocol, submitted
 * through the candidate UI, and graded through the production grading command.
 * No component-only fixture stands in for the page.
 *
 * E2E retention (docs/standards/testing.md §4.0): the geometry assertions are
 * an explicit, material exception to the "no trivial visual geometry" rule.
 * The failure they own is content inaccessibility (a formula painted over the
 * score column, or an un-clamped token widening the mobile page), and the
 * mechanism is real browser intrinsic sizing / scroll overflow / focus, which
 * jsdom cannot reproduce. The assertions are relational (viewport inside its
 * answer cell, page scrollWidth == clientWidth, geometry unchanged by
 * expansion), not fixed px contracts; the width loop is an operability/reflow
 * matrix (mobile representation visible, no page scroll), not pixel layout.
 */

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const STAMP = `${Date.now()}`;

const Q2_PROMPT = `S2.4 富文本作答溢出回归 ${STAMP}`;
const Q3_PROMPT = `S2.4 长 token 作答溢出回归 ${STAMP}`;
const Q4_PROMPT = `S2.4 代码纵向适配回归 ${STAMP}`;
const LONG_TOKEN = `https://example.test/${"a".repeat(300)}`;

const LONG_MATH =
  "\\sum_{i=1}^{n}\\left(\\frac{a_i+b_i}{c_i+d_i}\\right)^2 + " +
  "\\sum_{j=1}^{m}\\left(\\frac{x_j+y_j}{z_j+w_j}\\right)^3 + " +
  "\\int_{0}^{T}\\left(f(t)+g(t)\\right)dt + " +
  "\\alpha\\beta\\gamma\\delta\\epsilon\\zeta\\eta\\theta\\iota\\kappa" +
  "\\lambda\\mu\\nu\\xi\\omicron\\pi\\rho\\sigma\\tau\\upsilon";

const LONG_CODE =
  "const veryLongIdentifier = someFunction(argumentOne, argumentTwo, " +
  "argumentThree, argumentFour, argumentFive, argumentSix, argumentSeven, " +
  "argumentEight, argumentNine, argumentTen, argumentEleven, argumentTwelve, " +
  "argumentThirteen, argumentFourteen, argumentFifteen, argumentSixteen);";

const TOKEN = `UNBREAKABLE_${"X".repeat(48)}`;

function cell(text: string) {
  return {
    type: "tableCell",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  };
}

const WIDE_TABLE = {
  type: "table",
  content: [
    {
      type: "tableRow",
      content: [
        cell("列一"),
        cell("列二"),
        cell("列三"),
        cell("列四"),
        cell("列五"),
        cell("列六"),
      ],
    },
    ...Array.from({ length: 3 }, () => ({
      type: "tableRow",
      content: [
        cell(TOKEN),
        cell(TOKEN),
        cell(TOKEN),
        cell(TOKEN),
        cell(TOKEN),
        cell(TOKEN),
      ],
    })),
  ],
};

const INLINE_MATH = {
  type: "paragraph",
  content: [
    { type: "text", text: "行内公式：" },
    {
      type: "inlineMath",
      latex: "T_{end}=T_{prop}+T_{trans}+T_{queue}+T_{extra}+T_{more}+T_{last}",
    },
  ],
};

function richDocument() {
  return {
    docVersion: 1,
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: "富内容溢出证据：" }],
      },
      { type: "blockMath", latex: LONG_MATH },
      { type: "codeBlock", language: null, text: LONG_CODE },
      WIDE_TABLE,
      INLINE_MATH,
    ],
  };
}

/** One unbreakable token: fits vertically pre-fix, so the clamp is removed
 *  and the mobile card/page used to widen. With break-words it wraps and the
 *  disclosure clips it; either way the page must not scroll horizontally. */
function tokenDocument() {
  return {
    docVersion: 1,
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: LONG_TOKEN }],
      },
    ],
  };
}

/** One short code line: fits the vertical clamp, so there is no toggle, but
 *  the code viewport still needs a local keyboard stop. */
function codeOnlyDocument() {
  return {
    docVersion: 1,
    type: "doc",
    content: [{ type: "codeBlock", language: null, text: LONG_CODE }],
  };
}

interface Fixture {
  examId: string;
  questionId: string;
  richQuestionId: string;
  tokenQuestionId: string;
  codeQuestionId: string;
  candidate: SeededCandidate;
  adminToken: string;
}

let fixture: Fixture;
let attemptId = "";

async function seedCourseId(
  request: APIRequestContext,
  adminToken: string,
): Promise<string> {
  const res = await request.get(
    `${BASE_URL}/api/courses?search=${encodeURIComponent("基础安全")}`,
    { headers: { Cookie: `auth-token=${adminToken}` } },
  );
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as {
    items: Array<{ id: string; name: string }>;
  };
  const course = body.items.find((c) => c.name === "基础安全培训");
  expect(course, "seed course 基础安全培训 must exist").toBeTruthy();
  return course!.id;
}

async function createCandidate(
  request: APIRequestContext,
  adminToken: string,
): Promise<SeededCandidate> {
  const username = `e2e-overflow-${STAMP}`;
  const password = "candidate123";
  const name = `E2E Overflow ${STAMP}`;
  const res = await adminPost(request, adminToken, "/api/candidates", {
    username,
    password,
    name,
    fields: { candidateNo: `E2E-OVERFLOW-${STAMP}` },
  });
  expect(res.status(), await res.text()).toBeLessThan(300);
  const body = (await res.json()) as { id: string; userId: string };
  return {
    profileId: body.id,
    userId: body.userId,
    username,
    password,
    name,
  };
}

async function assembleExam(
  request: APIRequestContext,
  adminToken: string,
  courseId: string,
  candidateId: string,
  questionIds: string[],
): Promise<string> {
  const res = await adminPost(request, adminToken, "/api/exams", {
    title: `S2.4 富内容溢出回归 ${STAMP}`,
    description: "",
    courseId,
    timingMode: "timed_window",
    durationMinutes: 60,
    openAt: new Date(Date.now() - 3_600_000).toISOString(),
    closeAt: new Date(Date.now() + 86_400_000).toISOString(),
    passingScore: 0,
    totalScore: 25,
    questionSelectionMode: "manual",
    questionIds,
    controlFlags: {
      shuffleQuestions: false,
      shuffleOptions: false,
      detectTabSwitch: false,
      disableCopyPaste: false,
      requireQueue: false,
      batchSize: 10,
      batchInterval: 3,
      restrictIp: false,
      requireLockdown: false,
      showResultImmediately: true,
    },
    retakePolicy: "unlimited",
    scoreStrategy: "highest",
    maxAttempts: 1,
    minSubmitAfterStartMinutes: null,
    latestStartOffsetMinutes: null,
    resultPublicationMode: "immediate",
  });
  expect(res.status(), await res.text()).toBe(201);
  const { id: examId } = (await res.json()) as { id: string };

  const publish = await adminPost(
    request,
    adminToken,
    `/api/exams/${examId}/publish`,
    {},
  );
  expect(publish.status(), await publish.text()).toBeLessThan(300);

  const enroll = await adminPost(
    request,
    adminToken,
    `/api/exams/${examId}/enrollments`,
    { candidateIds: [candidateId] },
  );
  expect(enroll.status(), await enroll.text()).toBeLessThan(300);
  return examId;
}

/** The candidate take snapshot for one question (version metadata only). */
async function takeQuestion(
  request: APIRequestContext,
  candidateToken: string,
  qid: string,
): Promise<{ currentVersion: number; currentClientSeq: number }> {
  const res = await request.get(
    `${BASE_URL}/api/candidate/attempts/${attemptId}/take`,
    { headers: { Cookie: `auth-token=${candidateToken}` } },
  );
  expect(res.ok(), await res.text()).toBeTruthy();
  const body = (await res.json()) as {
    questions: Array<{
      id: string;
      currentVersion?: number;
      currentClientSeq?: number;
    }>;
  };
  const question = body.questions.find((q) => q.id === qid);
  expect(question, "rich question missing from take snapshot").toBeTruthy();
  return {
    currentVersion: question!.currentVersion ?? 0,
    currentClientSeq: question!.currentClientSeq ?? 0,
  };
}

/** Save the rich answer through the production versioned protocol. */
async function saveRichAnswer(
  request: APIRequestContext,
  candidateToken: string,
  qid: string,
  answer: unknown = richDocument(),
): Promise<void> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const { currentVersion, currentClientSeq } = await takeQuestion(
      request,
      candidateToken,
      qid,
    );
    const res = await request.post(
      `${BASE_URL}/api/attempts/${attemptId}/answers/${qid}`,
      {
        headers: { Cookie: `auth-token=${candidateToken}` },
        data: {
          attemptId,
          questionId: qid,
          answer,
          clientSeq: currentClientSeq + 1,
          clientSavedAt: new Date().toISOString(),
          baseVersion: currentVersion,
        },
      },
    );
    expect(res.status(), await res.text()).toBe(200);
    const body = (await res.json()) as { accepted: boolean; reason?: string };
    if (body.accepted) return;
    if (attempt === 3) {
      throw new Error(`rich answer save rejected: ${body.reason ?? "unknown"}`);
    }
  }
}

/** Hold ArrowRight until the focused local scroller reaches its right edge. */
async function scrollToHorizontalEnd(
  page: Page,
  target: Locator,
  maxPresses = 160,
): Promise<number> {
  // WHY per-press conditions instead of fixed-delay sampling: Chrome animates
  // arrow-key scrolling, and under CI-level CPU contention the first committed
  // frame after a press can land far past any fixed budget (#878: measured
  // 59ms–1078ms with CPU throttling). Two identical fixed-delay samples can
  // therefore read the pre-animation position and mistake "not started yet"
  // for "edge reached". Each press instead waits for an explicit condition —
  // the position grows past everything seen so far, or it is pinned at the
  // right edge — which is only satisfied once this press's scroll has landed.
  const edge = await target.evaluate(
    (el) => el.scrollWidth - el.clientWidth - 2,
  );
  let reached = await target.evaluate((el) => el.scrollLeft);
  for (let i = 0; i < maxPresses && reached < edge; i += 1) {
    await page.keyboard.press("ArrowRight");
    await expect
      .poll(
        () =>
          target.evaluate(
            (el, state) =>
              el.scrollLeft > state.grownPast || el.scrollLeft >= state.edge,
            { grownPast: reached, edge },
          ),
        { timeout: 5_000 },
      )
      .toBe(true);
    reached = await target.evaluate((el) => el.scrollLeft);
  }
  return reached;
}

/**
 * One real ArrowRight on the focused local scroller, proven by the full
 * trigger → state-change → settle chain instead of a fixed time budget
 * (#878: Chrome's internal key-scroll animation can start arbitrarily late
 * under load, so a sample taken after a fixed delay races the first frame
 * and reads `scrollLeft = 0`).
 *
 * The oracle fails — never passes vacuously — when the premise of the press
 * is broken: target not focused, node not live, no room left to scroll, the
 * key producing no scroll, or the page scrolling instead of the target.
 *
 * Callers showing lazily projected KaTeX must settle that content (rendered
 * formula + web fonts) before calling: a mid-swap geometry change can clamp
 * the position and defeat the growth condition.
 */
async function arrowKeyScrollsLocally(
  page: Page,
  target: Locator,
): Promise<{
  before: number;
  after: number;
  maxScroll: number;
}> {
  await expect(target).toBeFocused();
  const start = await target.evaluate((el) => ({
    left: el.scrollLeft,
    maxScroll: el.scrollWidth - el.clientWidth,
    connected: el.isConnected,
    pageLeft: document.documentElement.scrollLeft,
  }));
  expect(start.connected, "the scroll target must be a live node").toBe(true);
  expect(
    start.maxScroll,
    "the target must have real horizontal overflow left to scroll",
  ).toBeGreaterThan(start.left);
  await page.keyboard.press("ArrowRight");
  await expect
    .poll(() => target.evaluate((el) => el.scrollLeft), { timeout: 5_000 })
    .toBeGreaterThan(start.left);
  // Settled completion: sample until the position stops changing. The sample
  // cadence is not the oracle — growth above already proved the scroll; this
  // only reports the resting position for the range/locality assertions.
  let settled = await target.evaluate((el) => el.scrollLeft);
  for (let i = 0; i < 40; i += 1) {
    await page.waitForTimeout(50);
    const current = await target.evaluate((el) => el.scrollLeft);
    if (current === settled) break;
    settled = current;
  }
  expect(settled).toBeGreaterThan(start.left);
  expect(settled).toBeLessThanOrEqual(start.maxScroll + 1);
  expect(
    await page.evaluate(() => document.documentElement.scrollLeft),
    "the page must not scroll horizontally; the scroll stays local",
  ).toBe(start.pageLeft);
  return { before: start.left, after: settled, maxScroll: start.maxScroll };
}

/** Geometry of one result-detail row, isolated from presentation state. */
async function resultRowGeometry(page: Page) {
  return page.evaluate((prompt) => {
    const row = Array.from(document.querySelectorAll("tbody tr")).find((tr) =>
      tr.textContent?.includes(prompt),
    );
    if (!row) throw new Error("result row not found");
    const table = row.closest("table");
    if (!table) throw new Error("result table not found");
    const cells = Array.from(row.children).map((cell) =>
      cell.getBoundingClientRect(),
    );
    const answerCell = cells[3];
    const scoreCell = cells[4];
    if (!answerCell || !scoreCell) {
      throw new Error("result row does not have the five-column geometry");
    }
    const viewports = Array.from(
      row.querySelectorAll<HTMLElement>(
        '[data-slot="content-scroll-viewport"]',
      ),
    ).map((el) => {
      const rect = el.getBoundingClientRect();
      return {
        kind: el.dataset.kind,
        label: el.getAttribute("aria-label"),
        tabIndex: el.tabIndex,
        overflowing: el.dataset.overflowing,
        left: rect.left,
        right: rect.right,
        width: rect.width,
      };
    });
    return {
      docScrollWidth: document.documentElement.scrollWidth,
      docClientWidth: document.documentElement.clientWidth,
      tableWidth: table.getBoundingClientRect().width,
      answerCell,
      scoreCell,
      viewports,
    };
  }, Q2_PROMPT);
}

/** Press Shift+Tab from the current focus until a rich-content viewport is
 * focused (the disclosure's content precedes its toggle in DOM order). */
async function shiftTabToViewport(page: Page, label?: string): Promise<string> {
  for (let i = 0; i < 10; i += 1) {
    await page.keyboard.press("Shift+Tab");
    const state = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return {
        isViewport: el?.dataset.slot === "content-scroll-viewport",
        label: el?.getAttribute("aria-label"),
      };
    });
    if (state.isViewport && (!label || state.label === label)) {
      return state.label ?? "";
    }
  }
  throw new Error(`Shift+Tab did not reach viewport ${label ?? "(any)"}`);
}

/** Press Tab from the current focus until a rich-content viewport is focused. */
async function tabToViewport(page: Page): Promise<void> {
  for (let i = 0; i < 250; i += 1) {
    await page.keyboard.press("Tab");
    const isViewport = await page.evaluate(
      () =>
        (document.activeElement as HTMLElement | null)?.dataset.slot ===
        "content-scroll-viewport",
    );
    if (isViewport) return;
  }
  throw new Error("Tab did not reach a rich-content viewport");
}

test.describe.serial("rich-content overflow contract", () => {
  test.setTimeout(180_000);

  test.beforeAll(async ({ playwright }) => {
    const request = await playwright.request.newContext({ baseURL: BASE_URL });
    const adminToken = await adminApiToken(request);
    const courseId = await seedCourseId(request, adminToken);
    const candidate = await createCandidate(request, adminToken);

    const q1 = await adminPost(request, adminToken, "/api/questions", {
      courseId,
      type: "single_choice",
      score: 5,
      difficulty: 1,
      contentDocument: richDocument(),
      options: [
        {
          id: "opt-a",
          content: "选项A",
          contentDocument: null,
          isCorrect: true,
        },
        {
          id: "opt-b",
          content: "选项B",
          contentDocument: null,
          isCorrect: false,
        },
      ],
      standardAnswer: "opt-a",
      rubric: null,
    });
    expect(q1.status(), await q1.text()).toBe(201);
    const { id: questionId } = (await q1.json()) as { id: string };

    const q2 = await adminPost(request, adminToken, "/api/questions", {
      courseId,
      type: "text_response",
      score: 10,
      difficulty: 1,
      content: Q2_PROMPT,
      answerMode: "rich",
      standardAnswer: null,
      rubric: `S2.4 富文本评分标准 ${STAMP}`,
    });
    expect(q2.status(), await q2.text()).toBe(201);
    const { id: richQuestionId } = (await q2.json()) as { id: string };

    const q3 = await adminPost(request, adminToken, "/api/questions", {
      courseId,
      type: "text_response",
      score: 5,
      difficulty: 1,
      content: Q3_PROMPT,
      answerMode: "rich",
      standardAnswer: null,
      rubric: `S2.4 长 token 评分标准 ${STAMP}`,
    });
    expect(q3.status(), await q3.text()).toBe(201);
    const { id: tokenQuestionId } = (await q3.json()) as { id: string };

    const q4 = await adminPost(request, adminToken, "/api/questions", {
      courseId,
      type: "text_response",
      score: 5,
      difficulty: 1,
      content: Q4_PROMPT,
      answerMode: "rich",
      standardAnswer: null,
      rubric: `S2.4 代码评分标准 ${STAMP}`,
    });
    expect(q4.status(), await q4.text()).toBe(201);
    const { id: codeQuestionId } = (await q4.json()) as { id: string };

    const examId = await assembleExam(
      request,
      adminToken,
      courseId,
      candidate.profileId,
      [questionId, richQuestionId, tokenQuestionId, codeQuestionId],
    );
    fixture = {
      examId,
      questionId,
      richQuestionId,
      tokenQuestionId,
      codeQuestionId,
      candidate,
      adminToken,
    };
    await request.dispose();
  });

  test("candidate take → rich answer → graded result: local scroll, keyboard, stable geometry", async ({
    page,
    request,
  }) => {
    await candidateLogin(page, fixture.candidate);
    const startResponse = page.waitForResponse(
      (res) =>
        res.request().method() === "POST" &&
        /\/api\/attempts\/[^/]+\/start$/.test(res.url()),
      { timeout: 20_000 },
    );
    await startExamFromList(page, fixture.examId);
    const startRes = await startResponse;
    expect([200, 201]).toContain(startRes.status());
    attemptId = ((await startRes.json()) as { id: string }).id;

    const section = page.getByTestId("take-question-section");
    await expect(section).toBeVisible();

    // ── Candidate take: the prompt's first overflowing block becomes the
    //    next real Tab stop after the flag control. ─────────────────────
    const promptViewport = section
      .locator('[data-slot="content-scroll-viewport"][data-kind="block"]')
      .first();
    // Judge every tab-stop/ARIA/scroll fact on the SETTLED KaTeX projection
    // (the same rule as the result-page flow below): the raw-LaTeX fallback
    // and the rendered formula have different widths, so mid-swap the
    // derived tab-stop state can flip (role/tabindex vanish while focus
    // stays) and scroll geometry samples a transient surface, not the
    // contract.
    await expect(promptViewport.locator(".katex")).toHaveCount(1);
    await page.evaluate(async () => {
      if (document.fonts) await document.fonts.ready;
    });
    await expect(promptViewport).toHaveAttribute("data-overflowing", "true");
    await section.getByRole("button", { name: "标记本题" }).click();
    await page.keyboard.press("Tab");
    await expect(promptViewport).toBeFocused();
    expect(await promptViewport.getAttribute("role")).toBe("group");
    expect(await promptViewport.getAttribute("aria-label")).toBe(
      "公式，可横向滚动",
    );
    await arrowKeyScrollsLocally(page, promptViewport);
    await page.keyboard.press("Shift+Tab");
    await expect(
      section.getByRole("button", { name: "取消标记" }),
    ).toBeFocused();

    // Answer Q1 through the real control, then move to the rich question.
    await page.getByRole("radio").first().check();
    await waitForSaveSaved(page);
    await page.getByRole("button", { name: "下一题" }).click();
    await expect(section.locator(".ProseMirror")).toHaveCount(1);

    // Persist a rich answer through the production save protocol, then reload
    // so the real editor restores it before the real submit.
    const candidateToken = await candidateApiToken(request, fixture.candidate);
    await saveRichAnswer(request, candidateToken, fixture.richQuestionId);

    await page.reload();
    await expect(section).toBeVisible();
    await page.getByRole("button", { name: "下一题" }).click();
    const editor = section.locator(".ProseMirror");
    await expect(editor).toHaveCount(1);
    await expect(editor.locator("[data-type='block-math']")).toHaveCount(1);

    // Q3: a single long unbreakable token answer; persisted through the same
    // production save protocol, then restored in the editor before submit.
    await page.getByRole("button", { name: "下一题" }).click();
    await expect(section.locator(".ProseMirror")).toHaveCount(1);
    await saveRichAnswer(
      request,
      candidateToken,
      fixture.tokenQuestionId,
      tokenDocument(),
    );
    await page.reload();
    await expect(section).toBeVisible();
    await page.getByRole("button", { name: "下一题" }).click();
    await page.getByRole("button", { name: "下一题" }).click();
    await expect(section.locator(".ProseMirror")).toHaveCount(1);
    await expect(section.locator(".ProseMirror")).toContainText("a".repeat(40));

    // Q4: one short code line; fits vertically (no toggle) but overflows
    // horizontally at 320px. Persist it, restore it in the editor, submit.
    await page.getByRole("button", { name: "下一题" }).click();
    await expect(section.locator(".ProseMirror")).toHaveCount(1);
    await saveRichAnswer(
      request,
      candidateToken,
      fixture.codeQuestionId,
      codeOnlyDocument(),
    );
    await page.reload();
    await expect(section).toBeVisible();
    await page.getByRole("button", { name: "下一题" }).click();
    await page.getByRole("button", { name: "下一题" }).click();
    await page.getByRole("button", { name: "下一题" }).click();
    await expect(section.locator(".ProseMirror")).toHaveCount(1);
    await expect(section.locator(".ProseMirror pre")).toHaveCount(1);
    await submitExam(page);
    await page.waitForURL(/\/result$/, { timeout: 30_000 });

    // Grade the manual question through the production grading command.
    const grade = await adminPost(
      request,
      fixture.adminToken,
      `/api/admin/attempts/${attemptId}/grade-question`,
      {
        questionId: fixture.richQuestionId,
        score: 8,
        comment: "S2.4 browser regression",
      },
    );
    expect(grade.status(), await grade.text()).toBe(200);
    const tokenGrade = await adminPost(
      request,
      fixture.adminToken,
      `/api/admin/attempts/${attemptId}/grade-question`,
      {
        questionId: fixture.tokenQuestionId,
        score: 5,
        comment: "S2.4 long-token browser regression",
      },
    );
    expect(tokenGrade.status(), await tokenGrade.text()).toBe(200);
    const codeGrade = await adminPost(
      request,
      fixture.adminToken,
      `/api/admin/attempts/${attemptId}/grade-question`,
      {
        questionId: fixture.codeQuestionId,
        score: 5,
        comment: "S2.4 un-clipped code browser regression",
      },
    );
    expect(codeGrade.status(), await codeGrade.text()).toBe(200);

    await page.reload();
    await expect(page.getByTestId("result-total-score")).toHaveText("23");

    const row = page.locator("tbody tr").filter({ hasText: Q2_PROMPT }).first();
    await expect(row).toBeVisible();

    const before = await resultRowGeometry(page);
    expect(before.docScrollWidth).toBe(before.docClientWidth);
    // Initial collapsed state: the preview is clipped, so none of its scroll
    // regions is a tab stop yet.
    expect(before.viewports.length).toBeGreaterThanOrEqual(3);
    expect(before.viewports.every((v) => v.tabIndex === -1)).toBe(true);
    await expect(
      row.locator("[data-answer-disclosure]").first(),
    ).toHaveAttribute("data-answer-disclosure", "collapsed");

    await row.getByRole("button", { name: "展开全文" }).click();
    await expect(
      row
        .locator('[data-slot="content-scroll-viewport"][data-kind="block"]')
        .first(),
    ).toHaveAttribute("data-overflowing", "true");

    // Content completeness: prompt, answer payload, score and the semantic
    // table all remain present. Wait for the lazy KaTeX boundary first: the
    // raw-source fallback is intentionally visible until the chunk arrives.
    await expect(row).toContainText(Q2_PROMPT);
    await expect(row).toContainText("UNBREAKABLE_");
    await expect(row).toContainText("8/10");
    await expect(row.locator(".katex")).toHaveCount(2);
    const mathCopy = await row.evaluate((rowEl) => ({
      total: rowEl.querySelectorAll(".katex").length,
      mathml: rowEl.querySelectorAll(".katex-mathml").length,
      hiddenHtml: rowEl.querySelectorAll('.katex-html[aria-hidden="true"]')
        .length,
    }));
    expect(mathCopy.total).toBeGreaterThanOrEqual(2);
    expect(mathCopy.mathml).toBe(mathCopy.total);
    expect(mathCopy.hiddenHtml).toBe(mathCopy.total);
    const nestedTable = row.locator("table").first();
    await expect(nestedTable).toHaveCount(1);
    expect(
      await nestedTable.evaluate(
        (el) => el.closest('[data-slot="content-scroll-viewport"]') !== null,
      ),
    ).toBe(true);

    const after = await resultRowGeometry(page);
    // Expansion grows the row vertically only: the governed table/column
    // geometry and the page do not move.
    expect(after.tableWidth).toBeCloseTo(before.tableWidth, 0);
    expect(after.answerCell.width).toBeCloseTo(before.answerCell.width, 0);
    expect(after.scoreCell.left).toBeCloseTo(before.scoreCell.left, 0);
    expect(after.docScrollWidth).toBe(after.docClientWidth);
    // Every local viewport stays inside the answer cell and clear of the
    // score column — the pre-fix defect painted the formula over "8/10".
    expect(after.viewports.length).toBeGreaterThanOrEqual(3);
    for (const viewport of after.viewports) {
      expect(viewport.left).toBeGreaterThanOrEqual(after.answerCell.left - 1);
      expect(viewport.right).toBeLessThanOrEqual(after.answerCell.right + 1);
      expect(viewport.right).toBeLessThanOrEqual(after.scoreCell.left + 1);
      expect(viewport.width).toBeLessThanOrEqual(after.answerCell.width + 1);
    }
    const kinds = after.viewports.map((v) => v.kind);
    expect(kinds).toContain("block");
    expect(kinds).toContain("code");
    expect(after.viewports.some((v) => v.label === "公式，可横向滚动")).toBe(
      true,
    );

    // ── Real keyboard within the expanded answer. The toggle is focused;
    //    Shift+Tab walks backwards through the local viewports. ─────────
    const formulaLabel = await shiftTabToViewport(page, "公式，可横向滚动");
    expect(formulaLabel).toBe("公式，可横向滚动");
    const formula = page
      .locator(
        '[data-slot="content-scroll-viewport"][aria-label="公式，可横向滚动"]',
      )
      .last();
    await expect(formula).toBeFocused();
    // Wait for the lazy KaTeX projection and the web font, then use the
    // SETTLED scroll range: the raw LaTeX fallback is wider than the rendered
    // formula, so a range measured mid-swap would be a false target.
    await expect(formula.locator(".katex").first()).toHaveCount(1);
    await page.evaluate(async () => {
      if (document.fonts) await document.fonts.ready;
    });
    const initialMax = await formula.evaluate(
      (el) => el.scrollWidth - el.clientWidth,
    );
    expect(initialMax).toBeGreaterThan(0);
    const reached = await scrollToHorizontalEnd(page, formula);
    const finalMax = await formula.evaluate(
      (el) => el.scrollWidth - el.clientWidth,
    );
    expect(reached).toBeGreaterThanOrEqual(finalMax - 2);
    // Not a trap: Shift+Tab leaves the answer's scroll regions. (It may land
    // on another valid viewport in an earlier row, so assert departure from
    // THIS row, not "not a viewport".)
    await page.keyboard.press("Shift+Tab");
    expect(
      await page.evaluate((prompt) => {
        const row = Array.from(document.querySelectorAll("tbody tr")).find(
          (tr) => tr.textContent?.includes(prompt),
        );
        return row ? !row.contains(document.activeElement) : false;
      }, Q2_PROMPT),
    ).toBe(true);

    // Collapse: the clipped preview must not retain the browser's scroll
    // adjustments, and its nested viewports must leave the tab order.
    await row.getByRole("button", { name: "收起" }).click();
    await expect(
      row.locator("[data-answer-disclosure]").first(),
    ).toHaveAttribute("data-answer-clipped", "true");
    await expect(
      row.locator('[data-slot="content-scroll-viewport"]').first(),
    ).toHaveAttribute("tabindex", "-1");
    const collapsed = await page.evaluate((prompt) => {
      const row = Array.from(document.querySelectorAll("tbody tr")).find((tr) =>
        tr.textContent?.includes(prompt),
      );
      if (!row) throw new Error("row missing");
      const clamp = row.querySelector("[data-answer-disclosure]");
      return {
        scrollTop: clamp?.scrollTop ?? 0,
        pageX: window.scrollX,
        viewports: Array.from(
          row.querySelectorAll<HTMLElement>(
            '[data-slot="content-scroll-viewport"]',
          ),
        ).map((el) => el.tabIndex),
      };
    }, Q2_PROMPT);
    expect(collapsed.scrollTop).toBe(0);
    expect(collapsed.pageX).toBe(0);
    expect(collapsed.viewports.every((index) => index === -1)).toBe(true);

    // Re-expand: the viewport becomes reachable again and still scrolls.
    await row.getByRole("button", { name: "展开全文" }).click();
    const reopened = row
      .locator(
        '[data-slot="content-scroll-viewport"][aria-label="公式，可横向滚动"]',
      )
      .last();
    await expect(reopened).toHaveAttribute("tabindex", "0");
    await expect(reopened).toHaveAttribute("data-overflowing", "true");
  });

  test("viewport matrix: 1440 / 1024 / 768 / 390 / 320 / 720 reflow", async ({
    page,
  }) => {
    // Reuse the graded attempt by logging in and opening its result directly.
    await candidateLogin(page, fixture.candidate);
    await page.goto(`${BASE_URL}/exam/${attemptId}/result`, {
      waitUntil: "networkidle",
    });
    await expect(page.getByTestId("result-total-score")).toHaveText("23");

    for (const width of [1440, 1024, 768, 390, 320, 720]) {
      await page.setViewportSize({ width, height: 900 });
      const mobileVisible = await page
        .getByTestId("result-mobile-questions")
        .isVisible();
      if (width >= 1024) {
        expect(mobileVisible).toBe(false);
        const desktopGeometry = await page.evaluate(() => ({
          docScrollWidth: document.documentElement.scrollWidth,
          docClientWidth: document.documentElement.clientWidth,
        }));
        expect(
          desktopGeometry.docScrollWidth,
          `${width}px must not create page-level horizontal scrolling`,
        ).toBe(desktopGeometry.docClientWidth);
        continue;
      }
      expect(mobileVisible).toBe(true);
      const block = page
        .locator('[data-testid="result-mobile-questions"] li')
        .filter({ hasText: Q2_PROMPT })
        .first();
      const tokenBlock = page
        .locator('[data-testid="result-mobile-questions"] li')
        .filter({ hasText: Q3_PROMPT })
        .first();
      await expect(block).toBeVisible();
      await expect(tokenBlock).toBeVisible();
      // Wait for BOTH disclosure measurements before reading final widths:
      // the clamp/toggle state is set after layout, not on the first render.
      await expect(
        block.getByRole("button", { name: /展开全文|收起/ }),
      ).toHaveCount(1);
      await expect(
        tokenBlock.getByRole("button", { name: /展开全文|收起/ }),
      ).toHaveCount(1);
      const geometry = await page.evaluate(() => ({
        docScrollWidth: document.documentElement.scrollWidth,
        docClientWidth: document.documentElement.clientWidth,
      }));
      expect(
        geometry.docScrollWidth,
        `${width}px must not create page-level horizontal scrolling`,
      ).toBe(geometry.docClientWidth);

      const button = block.getByRole("button", { name: "展开全文" });
      if (await button.count()) await button.click();
      const cardGeometry = await block.evaluate((li) => {
        const content = li.querySelector(
          '[data-slot="content-scroll-viewport"]',
        );
        if (!content) return null;
        const liRect = li.getBoundingClientRect();
        return {
          liLeft: liRect.left,
          liRight: liRect.right,
          viewportLeft: content.getBoundingClientRect().left,
          viewportRight: content.getBoundingClientRect().right,
          tabIndex: (content as HTMLElement).tabIndex,
          overflowing: (content as HTMLElement).dataset.overflowing,
        };
      });
      expect(cardGeometry).not.toBeNull();
      expect(cardGeometry!.viewportLeft).toBeGreaterThanOrEqual(
        cardGeometry!.liLeft - 1,
      );
      expect(cardGeometry!.viewportRight).toBeLessThanOrEqual(
        cardGeometry!.liRight + 1,
      );
      // Only genuinely overflowing content is a tab stop.
      if (cardGeometry!.overflowing === "true") {
        expect(cardGeometry!.tabIndex).toBe(0);
      } else {
        expect(cardGeometry!.tabIndex).toBe(-1);
      }
    }

    // 320px: the genuinely overflowing viewport is a real keyboard stop.
    await page.setViewportSize({ width: 320, height: 900 });
    const block = page
      .locator('[data-testid="result-mobile-questions"] li')
      .filter({ hasText: Q2_PROMPT })
      .first();
    const toggle = block.getByRole("button", { name: "收起" });
    if (!(await toggle.count())) {
      await block.getByRole("button", { name: "展开全文" }).click();
    }
    // The answer's formula must be SETTLED before the keyboard walk: the
    // raw-LaTeX fallback and the rendered formula have different widths, so
    // mid-swap the derived tab-stop state can flip and the walk skips the
    // stop it is supposed to land on (same rule as the take page).
    await expect(block.locator(".katex").first()).toHaveCount(1);
    await page.evaluate(async () => {
      if (document.fonts) await document.fonts.ready;
    });
    await block.getByRole("button", { name: "收起" }).focus();
    const label = await shiftTabToViewport(page);
    expect(label.length).toBeGreaterThan(0);
    const viewport = page.locator(
      '[data-slot="content-scroll-viewport"]:focus',
    );
    await arrowKeyScrollsLocally(page, viewport);
    // Shift+Tab walks backward through any earlier viewport in the same
    // answer block; it must leave the block entirely (no keyboard trap).
    let leftBlock = false;
    for (let i = 0; i < 8 && !leftBlock; i += 1) {
      await page.keyboard.press("Shift+Tab");
      leftBlock = await block.evaluate(
        (el) => !el.contains(document.activeElement),
      );
    }
    expect(leftBlock).toBe(true);

    // Q3: one long unbreakable token. Before the wrapping fix it fit the
    // three-line clamp vertically, so the clamp was removed and the mobile
    // card/page widened. Expanding must wrap the token, never scroll the page.
    const tokenBlock = page
      .locator('[data-testid="result-mobile-questions"] li')
      .filter({ hasText: Q3_PROMPT })
      .first();
    await expect(
      tokenBlock.getByRole("button", { name: /展开全文|收起/ }),
    ).toHaveCount(1);
    const tokenToggle = tokenBlock.getByRole("button", { name: "收起" });
    if (!(await tokenToggle.count())) {
      await tokenBlock.getByRole("button", { name: "展开全文" }).click();
    }
    await expect(
      tokenBlock.locator("[data-answer-disclosure]").first(),
    ).toHaveAttribute("data-answer-clipped", "false");
    await expect(tokenBlock).toContainText("a".repeat(40));
    const tokenGeometry = await page.evaluate(() => ({
      docScrollWidth: document.documentElement.scrollWidth,
      docClientWidth: document.documentElement.clientWidth,
    }));
    expect(
      tokenGeometry.docScrollWidth,
      "an expanded long token must wrap, not widen the page",
    ).toBe(tokenGeometry.docClientWidth);

    // Q4: one short code line. It fits the vertical clamp, so there is NO
    // disclosure toggle; the local code viewport must still be the next real
    // Tab stop and scroll with ArrowRight.
    const inlineBlock = page
      .locator('[data-testid="result-mobile-questions"] li')
      .filter({ hasText: Q4_PROMPT })
      .first();
    await expect(inlineBlock).toBeVisible();
    await expect(
      inlineBlock.getByRole("button", { name: /展开全文|收起/ }),
    ).toHaveCount(0);
    await expect(
      inlineBlock.locator("[data-answer-disclosure]").first(),
    ).toHaveAttribute("data-answer-clipped", "false");
    const inlineCandidate = inlineBlock
      .locator('[data-slot="content-scroll-viewport"][data-kind="code"]')
      .first();
    await expect(inlineCandidate).toHaveAttribute("data-overflowing", "true");
    await expect(inlineCandidate).toHaveAttribute("tabindex", "0");
    await page.keyboard.press("Tab");
    const inlineViewport = page.locator(
      '[data-slot="content-scroll-viewport"][data-kind="code"]:focus',
    );
    await expect(inlineViewport).toBeVisible();
    await expect(inlineViewport).toHaveAttribute("role", "group");
    await expect(inlineViewport).toHaveAttribute(
      "aria-label",
      "代码块，可横向滚动",
    );
    expect(
      await inlineBlock.evaluate((el) => el.contains(document.activeElement)),
    ).toBe(true);
    await arrowKeyScrollsLocally(page, inlineViewport);
    await page.keyboard.press("Shift+Tab");
    expect(
      await inlineBlock.evaluate((el) => !el.contains(document.activeElement)),
    ).toBe(true);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(await page.evaluate(() => document.documentElement.clientWidth));
  });

  test("admin authoring preview: rich prompt stays inside the preview card and is keyboard operable", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await page.goto(`${BASE_URL}/admin/questions/${fixture.questionId}/edit`, {
      waitUntil: "networkidle",
    });
    await page.getByText("考生视角预览").waitFor({ state: "visible" });

    const card = page
      .locator('[data-slot="card"]')
      .filter({ hasText: "考生视角预览" })
      .first();
    // Settle the lazy KaTeX projection BEFORE the one-shot geometry snapshot:
    // overflowing/tabIndex in the snapshot derive from the measured width,
    // and a mid-swap read samples the transient raw-LaTeX fallback surface
    // (the #878 family; independent review finding).
    await expect(card.locator(".katex").first()).toHaveCount(1);
    await page.evaluate(async () => {
      if (document.fonts) await document.fonts.ready;
    });
    const geometry = await card.evaluate((cardEl) => {
      const cardRect = cardEl.getBoundingClientRect();
      const viewports = Array.from(
        cardEl.querySelectorAll<HTMLElement>(
          '[data-slot="content-scroll-viewport"]',
        ),
      ).map((el) => {
        const rect = el.getBoundingClientRect();
        return {
          kind: el.dataset.kind,
          left: rect.left,
          right: rect.right,
          tabIndex: el.tabIndex,
          overflowing: el.dataset.overflowing,
        };
      });
      return {
        cardLeft: cardRect.left,
        cardRight: cardRect.right,
        docScrollWidth: document.documentElement.scrollWidth,
        docClientWidth: document.documentElement.clientWidth,
        viewports,
      };
    });
    expect(geometry.docScrollWidth).toBe(geometry.docClientWidth);
    expect(geometry.viewports.length).toBeGreaterThanOrEqual(4);
    for (const viewport of geometry.viewports) {
      expect(viewport.left).toBeGreaterThanOrEqual(geometry.cardLeft - 1);
      expect(viewport.right).toBeLessThanOrEqual(geometry.cardRight + 1);
      if (viewport.overflowing === "true") {
        expect(viewport.tabIndex).toBe(0);
      } else {
        expect(viewport.tabIndex).toBe(-1);
      }
    }
    expect(
      geometry.viewports.some(
        (v) => v.kind === "block" && v.overflowing === "true",
      ),
    ).toBe(true);
    expect(
      geometry.viewports.some(
        (v) => v.kind === "code" && v.overflowing === "true",
      ),
    ).toBe(true);

    // KaTeX + fonts are already settled above (before the geometry
    // snapshot), so the walk relies on the settled tab-stop state.
    await page.mouse.click(2, 2);
    await tabToViewport(page);
    const focused = page.locator('[data-slot="content-scroll-viewport"]:focus');
    await expect(focused).toHaveAttribute("role", "group");
    await arrowKeyScrollsLocally(page, focused);
    await page.keyboard.press("Shift+Tab");
    expect(
      await page.evaluate(
        () =>
          (document.activeElement as HTMLElement | null)?.dataset.slot ===
          "content-scroll-viewport",
      ),
    ).toBe(false);

    // Authoring formula dialog: the live preview is a real read surface with
    // the same local-scroll/keyboard contract (the dialog body owns vertical
    // scrolling; the formula owns horizontal scrolling).
    await page.getByRole("button", { name: "公式" }).first().click();
    const dialog = page.getByTestId("formula-dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByTestId("formula-expert-toggle").click();
    await dialog.getByTestId("formula-expert-source").fill(LONG_MATH);
    const mathPreview = dialog.locator('[data-slot="content-scroll-viewport"]');
    // Live-rendered KaTeX: settle the projection before judging any derived
    // tab-stop/ARIA/scroll fact (same rule as the take page).
    await expect(mathPreview.locator(".katex").first()).toHaveCount(1);
    await page.evaluate(async () => {
      if (document.fonts) await document.fonts.ready;
    });
    await expect(mathPreview).toHaveAttribute("data-overflowing", "true");
    await expect(mathPreview).toHaveAttribute("tabindex", "0");
    expect(
      await dialog.evaluate((dialogEl) => {
        const viewport = dialogEl.querySelector<HTMLElement>(
          '[data-slot="content-scroll-viewport"]',
        );
        if (!viewport) return false;
        const dialogRect = dialogEl.getBoundingClientRect();
        const viewportRect = viewport.getBoundingClientRect();
        return (
          viewportRect.left >= dialogRect.left - 1 &&
          viewportRect.right <= dialogRect.right + 1
        );
      }),
    ).toBe(true);
    await dialog.getByTestId("formula-expert-source").focus();
    await page.keyboard.press("Tab");
    await expect(mathPreview).toBeFocused();
    await arrowKeyScrollsLocally(page, mathPreview);
    await page.keyboard.press("Shift+Tab");
    await expect(dialog.getByTestId("formula-expert-source")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  test("grader detail: long rich answer is locally scrollable without widening the page", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await page.goto(`${BASE_URL}/admin/grading-queue/${attemptId}`, {
      waitUntil: "networkidle",
    });
    const answer = page.getByTestId(
      `grading-candidate-answer-${fixture.richQuestionId}`,
    );
    await expect(answer).toBeVisible();

    const geometry = await answer.evaluate((el) => {
      const box = el.getBoundingClientRect();
      const viewports = Array.from(
        el.querySelectorAll<HTMLElement>(
          '[data-slot="content-scroll-viewport"]',
        ),
      ).map((viewport) => {
        const rect = viewport.getBoundingClientRect();
        return {
          kind: viewport.dataset.kind,
          left: rect.left,
          right: rect.right,
          tabIndex: viewport.tabIndex,
          overflowing: viewport.dataset.overflowing,
          label: viewport.getAttribute("aria-label"),
        };
      });
      return {
        boxLeft: box.left,
        boxRight: box.right,
        docScrollWidth: document.documentElement.scrollWidth,
        docClientWidth: document.documentElement.clientWidth,
        viewports,
      };
    });
    expect(geometry.docScrollWidth).toBe(geometry.docClientWidth);
    expect(geometry.viewports.length).toBeGreaterThanOrEqual(3);
    for (const viewport of geometry.viewports) {
      expect(viewport.left).toBeGreaterThanOrEqual(geometry.boxLeft - 1);
      expect(viewport.right).toBeLessThanOrEqual(geometry.boxRight + 1);
    }
    const code = geometry.viewports.find(
      (v) => v.kind === "code" && v.overflowing === "true",
    );
    expect(code, "the long code block must overflow locally").toBeTruthy();
    expect(code!.tabIndex).toBe(0);
    expect(code!.label).toBe("代码块，可横向滚动");

    // Settle the lazy KaTeX projection at the ANSWER level BEFORE the
    // keyboard walk: the walk's target selection is itself swap-dependent —
    // pre-swap the wider raw-LaTeX fallback makes the formula a tab stop
    // (first stop), while the settled formula is not — so a pre-settle walk
    // can land on a viewport whose settled geometry has no real overflow
    // and the initialMax assertion below would then read the transient
    // surface (#878 family; independent review finding).
    await expect(answer.locator(".katex").first()).toHaveCount(1);
    await page.evaluate(async () => {
      if (document.fonts) await document.fonts.ready;
    });
    await page.mouse.click(2, 2);
    await tabToViewport(page);
    const focused = page.locator('[data-slot="content-scroll-viewport"]:focus');
    expect(
      await answer.evaluate((el) => el.contains(document.activeElement)),
    ).toBe(true);
    const initialMax = await focused.evaluate(
      (el) => el.scrollWidth - el.clientWidth,
    );
    expect(initialMax).toBeGreaterThan(0);
    const reached = await scrollToHorizontalEnd(page, focused);
    const finalMax = await focused.evaluate(
      (el) => el.scrollWidth - el.clientWidth,
    );
    expect(reached).toBeGreaterThanOrEqual(finalMax - 2);
    // Walk backward through the answer's viewports and leave it entirely.
    let leftAnswer = false;
    for (let i = 0; i < 10 && !leftAnswer; i += 1) {
      await page.keyboard.press("Shift+Tab");
      leftAnswer = await answer.evaluate(
        (el) => !el.contains(document.activeElement),
      );
    }
    expect(leftAnswer).toBe(true);
  });
});
