import { test, expect } from "@playwright/test";
import { seedExam } from "../lib/seed";
import {
  adminApiToken,
  adminPost,
  answerTrueFalse,
  candidateLogin,
  startExamFromList,
  submitExam,
  waitForSaveSaved,
} from "../lib/flow";
import { loginAsAdmin } from "../lib/login";

/**
 * #678 W3.3 — Minimal deployment (PRODUCT_PRESET=minimal), five objective
 * questions, browser-level.
 *
 * Deployment precondition: the API server is booting with the Minimal
 * ceiling (ADR-022 Phase 3). Every assertion below is Minimal-specific —
 * under a Standard deployment this spec FAILS LOUD on the projection
 * precondition, never silently.
 *
 * Material invariants owned here (testing.md §4.0):
 *  1. the Minimal presentation is served end-to-end in the REAL browser:
 *     public-config drives nav pruning (监考工作台 gone, 待评分 obligation
 *     face stays) and question authoring offers exactly Minimal's three
 *     question types — the §6 no-preset-branching contract exercised
 *     against the one domain resolver output;
 *  2. the Minimal ceiling is ENFORCED at the authoritative write seam in
 *     the deployed topology: a beyond-ceiling NEW question (multiple_choice,
 *     rich prompt) is rejected through the bypass-the-frontend channel
 *     (W2 write guards live under Minimal, not only in vitest);
 *  3. a five-objective-question Minimal exam runs the full candidate
 *     journey (start → answer 5 × true_false → save → submit → immediate
 *     graded result) on the SAME semantic kernel — no second Attempt/
 *     grading/result path exists for Minimal (ADR-022 D1).
 *
 * Browser mechanism that requires the browser: the admin shell composition
 * (provider fetch → nav pruning → authoring surface) and the candidate
 * runtime journey are end-user-visible behaviors; jsdom cannot serve the
 * deployed public-config over the network topology.
 */

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

test.describe("Minimal deployment — objective exam (#678 W3.3)", () => {
  test("presents Minimal surfaces, enforces the ceiling, and runs the five-objective journey", async ({
    page,
    request,
  }) => {
    // Deployment precondition: this shard MUST boot Minimal. The projection
    // the browser fetches is the same resolver output the server enforced
    // at startup (one composition root).
    const config = await request.get(`${BASE_URL}/api/system/public-config`);
    expect(config.ok()).toBeTruthy();
    expect((await config.json()).product.presentation).toBe("minimal");

    // Seed BEFORE the admin browser flow so the obligation face already has
    // the exam (and the seed itself proves the Minimal ceiling admits the
    // plain-objective authoring path end-to-end).
    const seeded = await seedExam(request, "min-obj", {
      objectiveQuestionCount: 5,
      questionScore: 20,
      passingScore: 60,
    });

    // ── Admin browser: nav prunes the capability-scoped monitoring surface
    // and keeps the obligation face (§4.4 red line in the real shell).
    await loginAsAdmin(page);
    await expect(page.getByText("监考工作台")).toHaveCount(0);
    await expect(page.getByText("待评分")).toBeVisible();

    // ── Question authoring offers exactly Minimal's three types.
    await page.goto(`${BASE_URL}/admin/questions/new`, {
      waitUntil: "networkidle",
    });
    await page.getByRole("combobox", { name: "题目类型" }).click();
    for (const label of ["单选题", "判断题", "文本作答题"]) {
      await expect(page.getByRole("option", { name: label })).toBeVisible();
    }
    for (const label of ["多选题", "填空题"]) {
      await expect(page.getByRole("option", { name: label })).toHaveCount(0);
    }
    // Close the modal select (Radix aria-hides the rest of the tree while
    // open) before driving the API channel below.
    await page.getByRole("option", { name: "单选题" }).click();

    // ── The ceiling is enforced at the authoritative write seam: a
    // beyond-ceiling NEW question is rejected through the direct API channel
    // (bypass-the-frontend), and nothing persists.
    const token = await adminApiToken(request);
    const courseResponse = await adminPost(request, token, "/api/courses", {
      name: `MinObj-Course-${Date.now()}`,
      code: `MINOBJ-${Date.now()}`,
      description: "",
    });
    const course = (await courseResponse.json()) as { id: string };
    const rejected = await request.post(`${BASE_URL}/api/questions`, {
      data: {
        courseId: course.id,
        type: "multiple_choice",
        content: "beyond the Minimal ceiling",
        options: [
          { id: "a", content: "0" },
          { id: "b", content: "1" },
          { id: "c", content: "2" },
        ],
        standardAnswer: ["a"],
        score: 10,
      },
      headers: { Cookie: `auth-token=${token}` },
    });
    expect(rejected.status()).toBe(400);

    // ── The five-objective candidate journey on the same kernel.
    await candidateLogin(page, seeded.candidate);
    await startExamFromList(page, seeded.examId);
    for (let i = 0; i < 5; i += 1) {
      await answerTrueFalse(page, true);
      await waitForSaveSaved(page);
      if (i < 4) await page.getByRole("button", { name: "下一题" }).click();
    }
    await submitExam(page);

    // Immediate publication: the graded result is visible right after
    // submit (all-correct → full score 100).
    await expect(page.getByText("已通过")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("result-total-score")).toHaveText("100");
  });
});
