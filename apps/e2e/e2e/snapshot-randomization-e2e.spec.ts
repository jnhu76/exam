import { test, expect, type Page } from "@playwright/test";
import { seedExam } from "../lib/seed";
import {
  candidateLogin,
  candidateApiToken,
  startExamFromList,
  waitForSaveSaved,
  submitExam,
  adminApiToken,
  adminPost,
  getCandidateResult,
} from "../lib/flow";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

/**
 * #294 — representative browser scenario for snapshot-frozen randomization.
 *
 * Author creates an exam with shuffleQuestions=true AND shuffleOptions=true
 * over three questions (single_choice / multiple_choice / true_false).
 * Candidate starts the attempt and the frozen presentation order is captured
 * from the real take UI. The page is then reloaded (navigate away + resume)
 * and the SAME order must render — the browser-level resume invariant.
 *
 * The candidate then answers by CONTENT (option text / true-false value),
 * never by position, proving identity-based answering; submission grades
 * correct (100) through the real result surface.
 *
 * Deliberately NOT asserted: that two attempts produce different orders —
 * the identity permutation is a legal draw. "Different attempts CAN differ"
 * is proven deterministically by the engine/integration tests with the
 * injected RNG seam.
 */
test.describe("snapshot-frozen randomization E2E (#294)", () => {
  test("shuffle on → frozen order survives reload → identity-answered → graded 100", async ({
    page,
    request,
  }) => {
    const unique = `shuf${Date.now()}`;
    const seeded = await seedExam(request, `shufseed${Date.now()}`);
    const adminToken = await adminApiToken(request);

    // Three questions with distinctive, unique content/option text.
    const q1Res = await adminPost(request, adminToken, "/api/questions", {
      courseId: seeded.courseId,
      type: "single_choice",
      content: `单选标识-${unique}`,
      options: [
        { id: "opt-a", content: "Alpha选项" },
        { id: "opt-b", content: "Bravo选项" },
        { id: "opt-c", content: "Charlie选项" },
      ],
      standardAnswer: "opt-b",
      score: 40,
      difficulty: 1,
      tags: [],
      gradingRule: {
        multiSelectScoring: "all_correct_full",
        fillBlankMatchMode: "exact",
      },
    });
    expect(q1Res.ok()).toBeTruthy();
    const q1Id = (await q1Res.json()).id as string;

    const q2Res = await adminPost(request, adminToken, "/api/questions", {
      courseId: seeded.courseId,
      type: "multiple_choice",
      content: `多选标识-${unique}`,
      options: [
        { id: "opt-d", content: "Delta选项" },
        { id: "opt-e", content: "Echo选项" },
      ],
      standardAnswer: ["opt-d"],
      score: 30,
      difficulty: 1,
      tags: [],
      gradingRule: {
        multiSelectScoring: "all_correct_full",
        fillBlankMatchMode: "exact",
      },
    });
    expect(q2Res.ok()).toBeTruthy();
    const q2Id = (await q2Res.json()).id as string;

    const q3Res = await adminPost(request, adminToken, "/api/questions", {
      courseId: seeded.courseId,
      type: "true_false",
      content: `判断标识-${unique}`,
      standardAnswer: true,
      score: 30,
    });
    expect(q3Res.ok()).toBeTruthy();
    const q3Id = (await q3Res.json()).id as string;

    const examRes = await adminPost(request, adminToken, "/api/exams", {
      title: `Randomization E2E ${unique}`,
      description: "",
      courseId: seeded.courseId,
      timingMode: "timed_window",
      durationMinutes: 60,
      openAt: new Date(Date.now() - 3600_000).toISOString(),
      closeAt: new Date(Date.now() + 86400_000).toISOString(),
      passingScore: 60,
      totalScore: 100,
      questionSelectionMode: "manual",
      questionIds: [q1Id, q2Id, q3Id],
      resultPublicationMode: "immediate",
      controlFlags: {
        shuffleQuestions: true,
        shuffleOptions: true,
        detectTabSwitch: false,
        disableCopyPaste: false,
        showResultImmediately: true,
      },
      retakePolicy: "unlimited",
      scoreStrategy: "highest",
      maxAttempts: 1,
    });
    expect(examRes.ok()).toBeTruthy();
    const examId = (await examRes.json()).id as string;

    await adminPost(request, adminToken, `/api/exams/${examId}/publish`, {});
    await adminPost(request, adminToken, `/api/exams/${examId}/enrollments`, {
      candidateIds: [seeded.candidateIds[0]],
    });

    await candidateLogin(page, seeded.candidate);
    await startExamFromList(page, examId);

    const q1Prompt = `单选标识-${unique}`;
    const q2Prompt = `多选标识-${unique}`;
    const q3Prompt = `判断标识-${unique}`;
    const allPrompts = [q1Prompt, q2Prompt, q3Prompt];

    // Capture the frozen presentation order from the real take UI: the
    // navigator buttons are rendered in server-frozen array order.
    const captureOrder = async (): Promise<string[]> => {
      const prompts: string[] = [];
      const navigator = page.getByRole("navigation", { name: "题目导航" });
      const buttons = navigator.getByRole("button");
      const count = await buttons.count();
      expect(count).toBe(3);
      for (let i = 0; i < count; i += 1) {
        await buttons.nth(i).click();
        const section = page.getByTestId("take-question-section");
        await expect(section).toBeVisible();
        const prompt = (
          await section.locator("div.type-reading").innerText()
        ).trim();
        prompts.push(prompt);
      }
      return prompts;
    };

    const firstOrder = await captureOrder();
    // The captured order is exactly the three frozen questions (a permutation,
    // never a duplicate or a foreign question).
    expect([...firstOrder].sort()).toEqual([...allPrompts].sort());

    // Browser-level resume: reload replays the frozen order exactly.
    await page.reload();
    await page
      .getByTestId("take-question-section")
      .waitFor({ state: "visible" });
    const resumedOrder = await captureOrder();
    expect(resumedOrder).toEqual(firstOrder);

    // Answer every question by CONTENT identity, navigating by frozen order.
    for (let i = 0; i < firstOrder.length; i += 1) {
      const prompt = firstOrder[i]!;
      const navigator = page.getByRole("navigation", { name: "题目导航" });
      await navigator.getByRole("button").nth(i).click();
      const section = page.getByTestId("take-question-section");
      await expect(section).toBeVisible();

      if (prompt === q1Prompt) {
        // The correct option id is opt-b; its rendered label is "Bravo选项".
        // Find it by content text — position is presentation state.
        await section
          .locator("label", { hasText: "Bravo选项" })
          .locator("input[type='radio']")
          .check();
      } else if (prompt === q2Prompt) {
        await section
          .locator("label", { hasText: "Delta选项" })
          .locator("input[type='checkbox']")
          .check();
      } else {
        await section.getByTestId("true-false-true").check();
      }
      await waitForSaveSaved(page);
    }

    await submitExam(page);

    // Browser truth: graded result renders immediately and correctly.
    await expect(page.getByText("已通过")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("result-total-score")).toHaveText("100");

    // Server truth: the graded total is identity-based (no index drift).
    const resultUrl = new URL(page.url());
    const attemptId = resultUrl.pathname.split("/").filter(Boolean)[1]!;
    const candidateToken = await candidateApiToken(request, seeded.candidate);
    const result = await getCandidateResult(request, candidateToken, attemptId);
    expect(result.totalScore).toBe(100);
    expect(result.passed).toBe(true);
  });
});
