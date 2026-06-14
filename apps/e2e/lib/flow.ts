import type { Page } from "@playwright/test";
import type { SeededCandidate } from "./seed";

export async function candidateLogin(
  page: Page,
  candidate: SeededCandidate,
): Promise<void> {
  await page.goto("/login");
  await page.getByTestId("login-layout").waitFor({ state: "visible" });
  await page.fill("#username", candidate.username);
  await page.fill("#password", candidate.password);
  await page.getByRole("button", { name: "登录" }).click();
  await page.waitForURL("**/exam/list", { timeout: 15_000 });
}

export async function startExamFromList(
  page: Page,
  examId: string,
): Promise<void> {
  await page.getByTestId(`exam-card-${examId}`).waitFor({ state: "visible" });
  await page
    .getByTestId(`exam-card-${examId}`)
    .getByTestId("exam-start-btn")
    .click();
  // Now on StartExamPage (/exam/:examId/start). Wait for it, then click there.
  await page.waitForURL((url) => /\/exam\/[^/]+\/start$/.test(url.pathname), {
    timeout: 15_000,
  });
  await page.getByTestId("exam-start-btn").click();
  await page.waitForURL((url) => /\/exam\/[^/]+\/take$/.test(url.pathname), {
    timeout: 15_000,
  });
  await page.getByTestId("take-question-section").waitFor({ state: "visible" });
}

export async function answerTrueFalse(
  page: Page,
  value: boolean,
): Promise<void> {
  await page.getByTestId(`true-false-${value}`).check();
}

export async function waitForSaveSaved(page: Page): Promise<void> {
  await page.getByText("已保存").waitFor({ state: "visible", timeout: 10_000 });
}

export async function submitExam(page: Page): Promise<void> {
  await page.getByTestId("take-submit-btn").click();
  await page.getByRole("dialog").waitFor({ state: "visible" });
  // confirm-submit-btn is disabled while a save flush is in flight;
  // Playwright click() auto-waits for it to become enabled.
  await page.getByTestId("confirm-submit-btn").click();
  await page.waitForURL("**/result", { timeout: 30_000 });
}
