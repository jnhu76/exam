import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import type { SeededCandidate } from "../lib/seed";
import {
  adminApiToken,
  adminPost,
  candidateLogin,
  startExamFromList,
  waitForSaveSaved,
} from "../lib/flow";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

/**
 * #669 Phase U — candidate Rich editor UI regression suite.
 *
 * Proves the browser-only properties of the new editor surface at the real
 * candidate journey level: grouped icon toolbar with live active state,
 * undo/redo, list keyboard contract (no focus escape), the formula dialog
 * (visual entry, re-edit, no-op confirm), contextual table controls, the
 * writing placeholder, and the accessible names of the icon controls.
 * Owner-layer semantics (command catalogue, no-op policy, list decisions)
 * are pinned by the jsdom reality suites in apps/web.
 */

const STAMP = `${Date.now()}`;
const RUBRIC = "按要点给分";

interface PhaseUFixture {
  examId: string;
  questionId: string;
  candidate: SeededCandidate;
}

async function seedRichExam(
  request: APIRequestContext,
  tag: string,
): Promise<PhaseUFixture> {
  const adminToken = await adminApiToken(request);
  const courseRes = await adminPost(request, adminToken, "/api/courses", {
    name: `Course-phaseu-${tag}`,
    code: `E2E-phaseu-${tag}-${STAMP}`,
    description: "",
  });
  const courseId = ((await courseRes.json()) as { id: string }).id;
  const questionRes = await adminPost(request, adminToken, "/api/questions", {
    courseId,
    type: "text_response",
    content: `PhaseU 编辑器题-${tag}-${STAMP}`,
    standardAnswer: null,
    rubric: RUBRIC,
    score: 40,
    answerMode: "rich",
  });
  const questionId = ((await questionRes.json()) as { id: string }).id;
  const examRes = await adminPost(request, adminToken, "/api/exams", {
    title: `E2E-phaseu-${tag}-${STAMP}`,
    description: "",
    courseId,
    timingMode: "timed_window",
    durationMinutes: 90,
    openAt: new Date(Date.now() - 3_600_000).toISOString(),
    closeAt: new Date(Date.now() + 86_400_000).toISOString(),
    passingScore: 0,
    totalScore: 40,
    questionSelectionMode: "manual",
    questionIds: [questionId],
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
    maxAttempts: 3,
    minSubmitAfterStartMinutes: null,
    latestStartOffsetMinutes: null,
    resultPublicationMode: "immediate",
  });
  const examId = ((await examRes.json()) as { id: string }).id;
  await adminPost(request, adminToken, `/api/exams/${examId}/publish`, {});
  const candidateRes = await request.post(`${BASE_URL}/api/candidates`, {
    data: {
      username: `e2e-phaseu-${tag}-${STAMP}`,
      password: "candidate123",
      name: `PhaseU考生-${tag}`,
      fields: { candidateNo: `E2E-PU-${tag}` },
    },
  });
  expect(candidateRes.ok()).toBeTruthy();
  const candidateBody = (await candidateRes.json()) as {
    id: string;
    userId: string;
  };
  const enrollRes = await adminPost(
    request,
    adminToken,
    `/api/exams/${examId}/enrollments`,
    { candidateIds: [candidateBody.id] },
  );
  expect(enrollRes.status()).toBeLessThan(300);
  return {
    examId,
    questionId,
    candidate: {
      profileId: candidateBody.id,
      userId: candidateBody.userId ?? candidateBody.id,
      username: `e2e-phaseu-${tag}-${STAMP}`,
      name: `PhaseU考生-${tag}`,
      password: "candidate123",
    },
  };
}

interface TakeAttempt {
  page: Page;
  editor: ReturnType<Page["getByTestId"]>;
  attemptId: string;
}

/** Candidate journey up to a live editor on the take page. */
async function openRichEditor(
  page: Page,
  request: APIRequestContext,
  fixture: PhaseUFixture,
): Promise<TakeAttempt> {
  await candidateLogin(page, fixture.candidate);
  const startResponse = page.waitForResponse(
    (res) =>
      res.request().method() === "POST" &&
      /\/api\/attempts\/[^/]+\/start$/.test(res.url()),
    { timeout: 15_000 },
  );
  await startExamFromList(page, fixture.examId);
  const attemptId = ((await (await startResponse).json()) as { id: string }).id;
  const editor = page
    .getByTestId("take-question-section")
    .locator(".ProseMirror");
  await expect(editor).toHaveCount(1);
  void request;
  return { page, editor, attemptId };
}

async function insertVisualFormula(
  page: Page,
  latexTyped: string,
  mode: "行内" | "独立显示" | null,
): Promise<void> {
  await page.getByRole("button", { name: "公式" }).click();
  const dialog = page.getByTestId("formula-dialog");
  await dialog.waitFor({ state: "visible" });
  const field = dialog.locator("math-field");
  await field.waitFor({ state: "visible" });
  // The visual field's key handling lives in its shadow DOM, which completes
  // one tick after the element attaches (first-open lazy import). Typing
  // before the keyboard sink exists would drop the keystrokes on the floor.
  await page.waitForFunction(() => {
    const mf = document.querySelector("math-field");
    return (
      !!mf &&
      !!mf.shadowRoot &&
      !!mf.shadowRoot.querySelector(".ML__keyboard-sink")
    );
  });
  await field.click();
  await page.waitForFunction(() => {
    const mf = document.querySelector("math-field");
    return !!mf && !!mf.shadowRoot && mf.shadowRoot.activeElement !== null;
  });
  // Zero-delay synthetic bursts outrun MathLive's key pipeline (keys get
  // dropped); human-rate the keystrokes.
  await page.keyboard.type(latexTyped, { delay: 20 });
  if (mode !== null) {
    await dialog.getByRole("radio", { name: mode }).check();
  }
  await dialog.getByTestId("formula-confirm").click();
  await dialog.waitFor({ state: "hidden" });
}

test.describe("#669 Phase U candidate editor", () => {
  test("toolbar active state, undo/redo, and placeholder (#677 F2/F3/F9)", async ({
    page,
    request,
  }) => {
    const fixture = await seedRichExam(request, "base");
    const { page: p, editor } = await openRichEditor(page, request, fixture);

    // Placeholder on the empty editor (editor-only projection).
    await expect(
      p.locator(".ProseMirror p.is-editor-empty[data-placeholder]"),
    ).toHaveCount(1);

    const toolbar = p.getByTestId("rich-editor-toolbar");
    await expect(toolbar).toHaveAttribute("role", "toolbar");
    const bold = toolbar.getByRole("button", { name: "加粗" });
    const undo = toolbar.getByRole("button", { name: "撤销" });
    const redo = toolbar.getByRole("button", { name: "重做" });

    // History starts empty: undo/redo disabled.
    await expect(undo).toBeDisabled();
    await expect(redo).toBeDisabled();

    await editor.click();
    await p.keyboard.type("激活态测试");
    await p.keyboard.press("Home");
    await p.keyboard.press("Shift+End");
    await bold.click();
    await expect(bold).toHaveAttribute("aria-pressed", "true");

    // Input fidelity: plain caret keys take the browser-native path (native
    // caret move, then ProseMirror's async DOM-observer sync) while command
    // keys (toolbar clicks, Enter, typing) are PM-synchronous. A synthetic
    // 0 ms burst across that boundary outruns the native sync — the stale
    // range selection survives and Enter then replaces it. Real input cannot
    // inter-key that fast (0 wipes at >=60 ms gaps in 20 probe runs vs ~40%
    // at 0 ms), so keep human-scale rhythm between native caret keys.
    const keySettled = async (key: string) => {
      await p.keyboard.press(key);
      await p.waitForTimeout(80);
    };

    // Caret INSIDE the marked span → stays active; move out → inactive.
    await keySettled("ArrowLeft");
    await expect(bold).toHaveAttribute("aria-pressed", "true");
    await keySettled("End");
    await expect(bold).toHaveAttribute("aria-pressed", "true");
    // Enter at a bold line-end carries the mark as STORED marks (Tiptap v3
    // splitBlock keepMarks): the new doc node is unmarked, but the caret's
    // active marks stay bold — the next characters type bold and the toggle
    // stays pressed (app-probed 4/4 deterministic).
    await keySettled("Enter");
    await expect(editor.locator("p")).toHaveCount(2);
    await expect(bold).toHaveAttribute("aria-pressed", "true");
    await p.keyboard.type("普通");
    await expect(bold).toHaveAttribute("aria-pressed", "true");
    await expect(editor.locator("p").nth(1)).toContainText("普通");

    // Keyboard undo reverts the last typing; toolbar redo restores it.
    await p.keyboard.press("Control+z");
    await expect(editor).not.toContainText("普通");
    await redo.click();
    await expect(editor).toContainText("普通");
    await undo.click();

    // Selection changes alone must refresh state (no mutation needed).
    await p.keyboard.press("Control+Home");
    await p.keyboard.press("Shift+End");
    await expect(bold).toHaveAttribute("aria-pressed", "true");

    await waitForSaveSaved(p);
  });

  test("list keyboard contract: Tab indents where legal, first-item Tab never escapes (#677 F4)", async ({
    page,
    request,
  }) => {
    const fixture = await seedRichExam(request, "list");
    const { page: p, editor } = await openRichEditor(page, request, fixture);

    await editor.click();
    await p.keyboard.type("第一项");
    await p.getByRole("button", { name: "无序列表" }).click();

    // FIRST/only item: Tab is illegal for a sink — it must be swallowed
    // instead of moving focus out of the editor (the #677 F4 escape).
    await p.keyboard.press("Tab");
    const focusedTag = await p.evaluate(() => ({
      isEditor: document.activeElement?.classList.contains("ProseMirror"),
      tag: document.activeElement?.tagName,
    }));
    expect(focusedTag.isEditor).toBe(true);
    await expect(editor.locator("ul > li")).toHaveCount(1);

    // Second item: Tab sinks it under the first (nested list).
    await p.keyboard.press("Enter");
    await p.keyboard.type("第二项");
    await p.keyboard.press("Tab");
    await expect(editor.locator("ul > li > ul > li")).toHaveCount(1);

    // Shift+Tab lifts it back out.
    await p.keyboard.press("Shift+Tab");
    await expect(editor.locator("ul > li")).toHaveCount(2);
    await expect(editor.locator("ul > li > ul > li")).toHaveCount(0);

    await waitForSaveSaved(p);
    await p.reload();
    const restored = p
      .getByTestId("take-question-section")
      .locator(".ProseMirror");
    await expect(restored).toContainText("第一项");
    await expect(restored.locator("ul > li")).toHaveCount(2);
  });

  test("formula: visual entry, re-edit, and no-op confirm (#679)", async ({
    page,
    request,
  }) => {
    const fixture = await seedRichExam(request, "formula");
    const {
      page: p,
      editor,
      attemptId,
    } = await openRichEditor(page, request, fixture);

    await editor.click();
    await p.keyboard.type("公式测试：");
    // Visual entry WITHOUT the expert field: plain keystrokes become math.
    await insertVisualFormula(p, "x^2+y^2", "行内");
    await expect(
      editor.locator("[data-type='inline-math'], .katex"),
    ).not.toHaveCount(0);
    await waitForSaveSaved(p);

    // No-op: open the existing formula, change nothing, confirm → no new
    // save request, no dirty state (SaveAnswer is not called again).
    const saveRequests: string[] = [];
    p.on("request", (req) => {
      if (
        req.method() === "POST" &&
        /\/api\/attempts\/[^/]+\/answers\//.test(req.url())
      ) {
        saveRequests.push(req.url());
      }
    });
    const savesBeforeNoop = saveRequests.length;
    await editor.locator("[data-type='inline-math']").first().click();
    const dialog = p.getByTestId("formula-dialog");
    await dialog.waitFor({ state: "visible" });
    await dialog.getByTestId("formula-confirm").click();
    await dialog.waitFor({ state: "hidden" });
    await p.waitForTimeout(2500); // past the 1500ms save debounce
    expect(saveRequests.length).toBe(savesBeforeNoop);

    // Re-edit: click the atom, source is pre-filled, edit via expert source,
    // confirm — the SAME node is updated.
    await editor.locator("[data-type='inline-math']").first().click();
    await dialog.waitFor({ state: "visible" });
    await dialog.getByTestId("formula-expert-toggle").click();
    const source = dialog.getByTestId("formula-expert-source");
    await expect(source).not.toHaveValue("");
    await source.fill("a^2+b^2=c^2");
    await dialog.getByTestId("formula-confirm").click();
    await dialog.waitFor({ state: "hidden" });
    await waitForSaveSaved(p);

    // The persisted document carries the UPDATED latex, same single node.
    const { candidateApiToken } = await import("../lib/flow");
    const token = await candidateApiToken(request, fixture.candidate);
    const take = await request.get(
      `${BASE_URL}/api/candidate/attempts/${attemptId}/take`,
      { headers: { Cookie: `auth-token=${token}` } },
    );
    const body = (await take.json()) as {
      questions: Array<{
        answerValue: {
          content: Array<{ content?: Array<{ type: string; latex?: string }> }>;
        };
      }>;
    };
    const inlines = (body.questions[0]?.answerValue?.content ?? []).flatMap(
      (block) => (block.content ?? []).filter((n) => n.type === "inlineMath"),
    );
    expect(inlines).toHaveLength(1);
    expect(inlines[0]?.latex).toBe("a^2+b^2=c^2");
  });

  test("persisted formula first re-edit: the visual field arms from the persisted latex and the edit survives save+reload (#679 U1)", async ({
    page,
    request,
  }) => {
    const fixture = await seedRichExam(request, "reedit");
    const {
      page: p,
      editor,
      attemptId,
    } = await openRichEditor(page, request, fixture);

    await editor.click();
    await p.keyboard.type("重编辑：");
    await insertVisualFormula(p, "x^2+y^2", "行内");
    await waitForSaveSaved(p);

    // Reload BEFORE the first re-edit. The same-session re-edit path masks an
    // arming defect (the dialog's draft state already equals the atom), so
    // this is the reviewer-mandated sequence: persisted atom → fresh page →
    // first dialog open must show the PERSISTED latex in the MathLive field.
    await p.reload();
    const restored = p
      .getByTestId("take-question-section")
      .locator(".ProseMirror");
    await expect(restored.locator("[data-type='inline-math']")).toHaveCount(1);

    await restored.locator("[data-type='inline-math']").first().click();
    const dialog = p.getByTestId("formula-dialog");
    await dialog.waitFor({ state: "visible" });
    const field = dialog.locator("math-field");
    await field.waitFor({ state: "visible" });
    // The field is mounted lazily (first-open import); its shadow keyboard
    // sink is the readiness marker the insert path also uses.
    await p.waitForFunction(() => {
      const mf = document.querySelector("math-field");
      return (
        !!mf &&
        !!mf.shadowRoot &&
        !!mf.shadowRoot.querySelector(".ML__keyboard-sink")
      );
    });
    await expect
      .poll(
        () =>
          field.evaluate((el) => (el as unknown as { value: string }).value),
        { timeout: 5_000 },
      )
      .toBe("x^2+y^2");

    // Visual edit on the armed field (not the expert source): select-all,
    // replace, confirm — then prove the edited formula survives the round trip.
    await field.click();
    await p.keyboard.press("Control+a");
    await p.keyboard.type("z^3", { delay: 20 });
    await dialog.getByTestId("formula-confirm").click();
    await dialog.waitFor({ state: "hidden" });
    await waitForSaveSaved(p);

    await p.reload();
    const again = p
      .getByTestId("take-question-section")
      .locator(".ProseMirror");
    await expect(again.locator("[data-type='inline-math']")).toHaveCount(1);
    const { candidateApiToken } = await import("../lib/flow");
    const token = await candidateApiToken(request, fixture.candidate);
    const take = await request.get(
      `${BASE_URL}/api/candidate/attempts/${attemptId}/take`,
      { headers: { Cookie: `auth-token=${token}` } },
    );
    const body = (await take.json()) as {
      questions: Array<{
        answerValue: {
          content: Array<{ content?: Array<{ type: string; latex?: string }> }>;
        };
      }>;
    };
    const inlines = (body.questions[0]?.answerValue?.content ?? []).flatMap(
      (block) => (block.content ?? []).filter((n) => n.type === "inlineMath"),
    );
    expect(inlines).toHaveLength(1);
    expect(inlines[0]?.latex).toBe("z^3");
  });

  test("table contextual controls persist through save/reload (#677 F7)", async ({
    page,
    request,
  }) => {
    const fixture = await seedRichExam(request, "table");
    const { page: p, editor } = await openRichEditor(page, request, fixture);

    await editor.click();
    await p.keyboard.type("表格前");
    await p.getByRole("button", { name: "表格" }).click();
    const bar = p.getByTestId("table-contextual-bar");
    await expect(bar).toBeVisible();

    // 2×2 grammar shape, no header row.
    await expect(editor.locator("table tr")).toHaveCount(2);
    await expect(editor.locator("table th")).toHaveCount(0);

    await bar.getByTestId("table-cmd-add-row-below").click();
    await bar.getByTestId("table-cmd-add-column-right").click();
    await expect(editor.locator("table tr")).toHaveCount(3);
    await expect(editor.locator("table tr").first().locator("td")).toHaveCount(
      3,
    );
    await bar.getByTestId("table-cmd-delete-row").click();
    await expect(editor.locator("table tr")).toHaveCount(2);
    await expect(bar.getByTestId("table-cmd-delete-table")).toBeEnabled();

    await waitForSaveSaved(p);
    await p.reload();
    const restored = p
      .getByTestId("take-question-section")
      .locator(".ProseMirror");
    await expect(restored.locator("table tr")).toHaveCount(2);
    await expect(
      restored.locator("table tr").first().locator("td"),
    ).toHaveCount(3);
  });

  test("responsive overflow and accessible names (#677 F3, U-C/U-V)", async ({
    page,
    request,
  }) => {
    const fixture = await seedRichExam(request, "a11y");
    const { page: p } = await openRichEditor(page, request, fixture);
    const toolbar = p.getByTestId("rich-editor-toolbar");

    // Every icon-only control carries an accessible name; toggles expose
    // aria-pressed.
    const buttons = toolbar.getByRole("button");
    const count = await buttons.count();
    expect(count).toBeGreaterThanOrEqual(9);
    for (let i = 0; i < count; i += 1) {
      const btn = buttons.nth(i);
      const label = await btn.getAttribute("aria-label");
      expect(label, `button ${i} must have an accessible name`).toBeTruthy();
    }
    await expect(toolbar.getByRole("button", { name: "加粗" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    // Narrow viewport: code-block/table move into the overflow menu; the row
    // never wraps (single flex row), and the menu exposes them.
    await p.setViewportSize({ width: 375, height: 720 });
    await expect(toolbar.getByRole("button", { name: "表格" })).toBeHidden();
    await p.getByTestId("toolbar-overflow-trigger").click();
    const menu = p.getByRole("menu");
    await expect(menu.getByText("代码块")).toBeVisible();
    await expect(menu.getByText("表格")).toBeVisible();
    await p.keyboard.press("Escape");

    // Wide viewport again: the same commands render inline.
    await p.setViewportSize({ width: 1440, height: 900 });
    await expect(toolbar.getByRole("button", { name: "表格" })).toBeVisible();
  });
});
