import { test, expect } from "@playwright/test";
import {
  adminApiToken,
  adminGet,
  candidateApiToken,
  candidateLogin,
  startExamFromList,
} from "../lib/flow";
import { loginAsAdmin } from "../lib/login";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

/**
 * #678 review (P2) — the Minimal phase of the legacy-Rich switch story,
 * browser-level.
 *
 * Deployment precondition: the API server boots with the Minimal ceiling
 * (PRODUCT_PRESET=minimal) against the database legacy-rich-material.spec.ts
 * authored under Standard (fixed LEGACY-RICH-678 markers, fixed candidate
 * credentials — see that spec's header for the paired local commands and the
 * CI two-phase lane).
 *
 * Material invariants owned here (testing.md §4.0):
 *  1. the legacy Rich bank question offers an EXPLICIT Rich→Plain conversion
 *     (prompt, option, and rich answer mode) under the closed Rich ceiling,
 *     while the Plain→Rich direction stays closed (no mode selector);
 *  2. the converted question SAVES through the real PATCH seam — the
 *     eliminating edit is the one final material the write guard admits —
 *     and persists plain after reload (the API re-read is the persistence
 *     witness, the browser drive is the affordance witness);
 *  3. the PUBLISHED paper keeps its original Rich frozen snapshot: the
 *     candidate's take serves the rich prompt document untouched by the bank
 *     edit (publish-frozen semantics, not a Minimal-specific branch).
 *
 * Browser mechanism that requires the browser: the conversion affordance and
 * the take-page rendering are end-user-visible behaviors on the deployed
 * Minimal topology; jsdom cannot serve the deployed public-config over the
 * network or prove the real editor/textarea swap.
 */

const MARKER = "LEGACY-RICH-678";
const PROMPT_TEXT = `${MARKER} 题干`;
const SHORT_ANSWER_TEXT = `${MARKER} 简答`;
const EXAM_TITLE = `${MARKER} 卷`;
const CANDIDATE = {
  username: "legacy-rich-678",
  password: "candidate123",
  name: "Legacy Rich 678 Candidate",
  profileId: "",
  userId: "",
};

const RICH_PROMPT_DOC = {
  docVersion: 1,
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [{ type: "text", text: PROMPT_TEXT, marks: ["bold"] }],
    },
  ],
};

interface LegacyQuestion {
  id: string;
  content: string;
  contentDocument: unknown;
  answerMode: string | null;
  options: Array<{ id: string; contentDocument: unknown }>;
}

test.describe("Minimal deployment — legacy Rich downgrade (#678 review)", () => {
  test("converts the legacy Rich bank questions to Plain and keeps the published Rich snapshot", async ({
    page,
    request,
  }) => {
    // Deployment precondition: this shard MUST boot Minimal.
    const config = await request.get(`${BASE_URL}/api/system/public-config`);
    expect(config.ok()).toBeTruthy();
    expect((await config.json()).product.presentation).toBe("minimal");

    // ── Discover the Standard-authored legacy material (fixed markers).
    const token = await adminApiToken(request);
    const search = await adminGet(
      request,
      token,
      `/api/questions?search=${encodeURIComponent(MARKER)}&pageSize=50`,
    );
    expect(search.status(), await search.text()).toBe(200);
    const items = (await search
      .json()
      .then((body) => body.items)) as LegacyQuestion[];
    const promptQuestion = items.find((q) => q.content === PROMPT_TEXT);
    const shortAnswerQuestion = items.find(
      (q) => q.content === SHORT_ANSWER_TEXT,
    );
    expect(promptQuestion?.contentDocument).toEqual(RICH_PROMPT_DOC);
    expect(promptQuestion?.options[0]?.contentDocument).toBeTruthy();
    expect(shortAnswerQuestion?.answerMode).toBe("rich");

    // ── Admin browser: the legacy rich-prompt question's edit page offers
    // the explicit downgrade (no mode selector — upgrade stays closed).
    await loginAsAdmin(page);
    await page.goto(`${BASE_URL}/admin/questions/${promptQuestion!.id}/edit`, {
      waitUntil: "networkidle",
    });
    await expect(page.getByRole("combobox", { name: "内容模式" })).toHaveCount(
      0,
    );

    // Formatted prompt → the lossy confirmation guards the downgrade.
    // exact: the per-option conversion button's aria-label contains the same
    // text, and role name matching is substring-based by default.
    await page.getByRole("button", { name: "转为纯文本", exact: true }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "转换并丢弃格式" }).click();
    await expect(dialog).toBeHidden();
    // The rich editor is replaced by the plain textarea surface.
    await expect(page.getByPlaceholder("输入题目内容")).toBeVisible();

    // The legacy rich option converts directly (unformatted → no dialog).
    await page.getByRole("button", { name: "选项 a 转为纯文本" }).click();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);

    // ── Save through the real PATCH seam — the eliminating edit is the one
    // final material the Minimal write guard admits.
    const patchResponse = page.waitForResponse(
      (res) =>
        res.request().method() === "PATCH" &&
        res.url().endsWith(`/api/questions/${promptQuestion!.id}`),
      { timeout: 15_000 },
    );
    await page.getByRole("button", { name: /^保存$/ }).click();
    const saved = await patchResponse;
    expect(saved.status(), await saved.text()).toBe(200);

    // Persistence witness: the row re-reads plain (content keeps the plain
    // projection, every rich slot cleared).
    const reread = await adminGet(
      request,
      token,
      `/api/questions/${promptQuestion!.id}`,
    );
    expect(reread.status(), await reread.text()).toBe(200);
    const persisted = (await reread.json()) as LegacyQuestion;
    expect(persisted.contentDocument).toBeNull();
    expect(persisted.options[0]?.contentDocument).toBeNull();
    expect(persisted.content).toBe(PROMPT_TEXT);

    // ── The rich-answer 简答 converts its answer mode the same way.
    await page.goto(
      `${BASE_URL}/admin/questions/${shortAnswerQuestion!.id}/edit`,
      { waitUntil: "networkidle" },
    );
    await page.getByRole("button", { name: "转为纯文本作答" }).click();
    const shortPatch = page.waitForResponse(
      (res) =>
        res.request().method() === "PATCH" &&
        res.url().endsWith(`/api/questions/${shortAnswerQuestion!.id}`),
      { timeout: 15_000 },
    );
    await page.getByRole("button", { name: /^保存$/ }).click();
    const shortSaved = await shortPatch;
    expect(shortSaved.status(), await shortSaved.text()).toBe(200);
    const shortReread = (await (
      await adminGet(
        request,
        token,
        `/api/questions/${shortAnswerQuestion!.id}`,
      )
    ).json()) as LegacyQuestion;
    expect(shortReread.answerMode).toBe("plain");

    // ── The PUBLISHED paper keeps its original Rich frozen snapshot: the
    // candidate takes the exam and the served prompt document is the
    // Standard-authored one, untouched by the bank edit above.
    const candidateToken = await candidateApiToken(request, CANDIDATE);
    const exams = await request.get(`${BASE_URL}/api/candidate/exams`, {
      headers: { Cookie: `auth-token=${candidateToken}` },
    });
    expect(exams.status(), await exams.text()).toBe(200);
    const examList = (await exams.json()) as Array<{
      examId: string;
      title: string;
    }>;
    const legacyExam = examList.find((exam) => exam.title === EXAM_TITLE);
    expect(legacyExam?.examId).toBeTruthy();

    await candidateLogin(page, CANDIDATE);
    const startResponse = page.waitForResponse(
      (res) =>
        res.request().method() === "POST" &&
        /\/api\/attempts\/[^/]+\/start$/.test(res.url()),
      { timeout: 15_000 },
    );
    await startExamFromList(page, legacyExam!.examId);
    const startRes = await startResponse;
    expect([200, 201]).toContain(startRes.status());
    const attemptId = ((await startRes.json()) as { id: string }).id;

    // Browser: the frozen rich prompt renders for the candidate.
    await expect(
      page.getByTestId("take-question-section").getByText(PROMPT_TEXT),
    ).toBeVisible();

    // API: the frozen snapshot still carries the rich document (the graded
    // freeze predates the ceiling switch; the bank edit never touches it).
    const take = await request.get(
      `${BASE_URL}/api/candidate/attempts/${attemptId}/take`,
      { headers: { Cookie: `auth-token=${candidateToken}` } },
    );
    expect(take.status(), await take.text()).toBe(200);
    const served = (await take.json().then((body) => body.questions)) as Array<{
      id: string;
      prompt: string;
      promptDocument: unknown;
      answerMode: string;
    }>;
    const servedPrompt = served.find((q) => q.prompt === PROMPT_TEXT);
    expect(servedPrompt?.promptDocument).toEqual(RICH_PROMPT_DOC);
    const servedShortAnswer = served.find(
      (q) => q.prompt === SHORT_ANSWER_TEXT,
    );
    // The frozen paper also keeps the rich ANSWER mode for the legacy
    // question — the runtime path is retained (ADR-022 §7/D5).
    expect(servedShortAnswer?.answerMode).toBe("rich");
  });
});
