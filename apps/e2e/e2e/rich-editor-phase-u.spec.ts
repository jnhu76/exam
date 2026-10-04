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
 * #669 Phase U — candidate Rich editor browser journeys (OWNER_LAYER_FIRST).
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
});
