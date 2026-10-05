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
 * Candidate Rich editor journeys whose invariants live at the real
 * browser/system boundary.
 *
 * Origins: #669 (editor browser-journey closure), #701 (first-keystroke
 * selection synchronization), #677 (list Tab escape), #679 (persisted-formula
 * first re-edit).
 *
 * Only invariants that materially depend on the real browser/system boundary
 * are replayed here: real focus traversal (the list Tab contract) and the
 * persisted-formula re-edit journey through the MathLive shadow-DOM field and
 * real save/reload. Editor/controller semantics — toolbar active state,
 * undo/redo, placeholder, icon naming, table mechanics, formula no-op and
 * blockAllowed/target-context policy — are owned by the jsdom suites in
 * apps/web (commands.reality, editorExtensions, richContentEditor.reality,
 * richContentEditor.activation, FormulaEditorDialog.policy/behavior) and are
 * deliberately not duplicated through the browser.
 */

const STAMP = `${Date.now()}`;
const RUBRIC = "按要点给分";

interface RichEditorFixture {
  examId: string;
  questionId: string;
  candidate: SeededCandidate;
}

async function seedRichExam(
  request: APIRequestContext,
  tag: string,
): Promise<RichEditorFixture> {
  const adminToken = await adminApiToken(request);
  const courseRes = await adminPost(request, adminToken, "/api/courses", {
    name: `Course-rich-editor-${tag}`,
    code: `E2E-rich-editor-${tag}-${STAMP}`,
    description: "",
  });
  const courseId = ((await courseRes.json()) as { id: string }).id;
  const questionRes = await adminPost(request, adminToken, "/api/questions", {
    courseId,
    type: "text_response",
    content: `Rich 编辑器题-${tag}-${STAMP}`,
    standardAnswer: null,
    rubric: RUBRIC,
    score: 40,
    answerMode: "rich",
  });
  const questionId = ((await questionRes.json()) as { id: string }).id;
  const examRes = await adminPost(request, adminToken, "/api/exams", {
    title: `E2E-rich-editor-${tag}-${STAMP}`,
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
      username: `e2e-rich-editor-${tag}-${STAMP}`,
      password: "candidate123",
      name: `Rich编辑器考生-${tag}`,
      fields: { candidateNo: `E2E-RE-${tag}` },
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
      username: `e2e-rich-editor-${tag}-${STAMP}`,
      name: `Rich编辑器考生-${tag}`,
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
  fixture: RichEditorFixture,
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

test.describe("candidate rich editor browser boundaries", () => {
  // Regression for #701: native caret relocation + asynchronous
  // selectionchange + contenteditable first-keystroke synchronization.
  test("first keystroke after native caret relocation survives save", async ({
    page,
    request,
  }) => {
    const fixture = await seedRichExam(request, "first-keystroke");
    const {
      page: p,
      editor,
      attemptId,
    } = await openRichEditor(page, request, fixture);

    // Compose a document whose LAST block is a table.
    await editor.click();
    await p.keyboard.type("基底。", { delay: 12 });
    await p.keyboard.press("Enter");
    await p.getByRole("button", { name: "表格" }).click();
    await p.waitForTimeout(400);
    await p.keyboard.type("甲", { delay: 12 });
    await waitForSaveSaved(p);

    // Native Ctrl+End is not handled by the editor, so the browser moves the
    // DOM selection itself — after the trailing tableWrapper, a DOM position
    // with no document representation. Chrome delivers the matching
    // selectionchange asynchronously, so the next keystroke can arrive while
    // the view state still points at the clicked paragraph.
    await editor
      .locator("p")
      .first()
      .click({ position: { x: 5, y: 5 } });
    await p.keyboard.press("Control+End");
    // 16 ms/char is inside the previously-failing window (lost at ≤40, won
    // at 80); the input path must not depend on this pace at all.
    await p.keyboard.type("R1st", { delay: 16 });
    await waitForSaveSaved(p);

    const { candidateApiToken } = await import("../lib/flow");
    const token = await candidateApiToken(request, fixture.candidate);
    const take = await request.get(
      `${BASE_URL}/api/candidate/attempts/${attemptId}/take`,
      { headers: { Cookie: `auth-token=${token}` } },
    );
    const body = (await take.json()) as {
      questions: Array<{
        answerValue: {
          content: Array<{
            type: string;
            content?: Array<Record<string, unknown>>;
          }>;
        };
      }>;
    };
    const answer = body.questions[0]?.answerValue;
    const textOf = (content: unknown): string => {
      const parts: string[] = [];
      const walk = (node: unknown): void => {
        if (Array.isArray(node)) return node.forEach(walk);
        if (node && typeof node === "object") {
          const n = node as { text?: string; content?: unknown };
          if (typeof n.text === "string") parts.push(n.text);
          walk(n.content);
        }
      };
      walk(content);
      return parts.join("");
    };
    // The relocation target is the trailing table; its mapping is PM's own
    // selectionFromDOM decision, so the test pins the integrity contract, not
    // a particular cell: nothing dropped, nothing merged into the paragraph
    // the caret was relocated away from. On the defect the marker landed in
    // that first paragraph ("基底。R1st") or lost its first character.
    const first = answer?.content?.[0];
    expect(first?.type).toBe("paragraph");
    expect(textOf(first?.content)).toBe("基底。");
    expect(textOf(answer?.content)).toContain("R1st");
    const table = answer?.content?.find((b) => b?.type === "table");
    expect(textOf(table?.content)).toContain("R1st");
  });

  // Regression for #677: Tab on the first list item must not escape the
  // editor through native focus traversal.
  test("list keyboard contract: Tab indents where legal, first-item Tab never escapes", async ({
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
  });

  // Regression for #679: the persisted formula must arm the MathLive
  // field on a fresh page and survive save + reload.
  test("persisted formula first re-edit: the visual field arms from the persisted latex and the edit survives save+reload", async ({
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
});
