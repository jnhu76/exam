import type { Page } from "@playwright/test";
import type { SeededCandidate } from "./seed";

export async function loginAsCandidate(
  page: Page,
  candidate: SeededCandidate,
): Promise<void> {
  await page.goto("/login");
  await page.getByTestId("login-layout").waitFor({ state: "visible" });

  const loginResponsePromise = page.waitForResponse(
    (res) => res.url().includes("/api/auth/login"),
    { timeout: 15_000 },
  );

  await page.fill("#username", candidate.username);
  await page.fill("#password", candidate.password);
  await page.getByRole("button", { name: "登录" }).click();

  const loginResponse = await loginResponsePromise;
  if (loginResponse.status() !== 200) {
    const body = await loginResponse.text().catch(() => "");
    throw new Error(
      `Login failed for ${candidate.username}: status=${loginResponse.status()}, body=${body}, url=${page.url()}`,
    );
  }

  await page.waitForURL("**/exam/list", { timeout: 15_000 });
}

export const candidateLogin = loginAsCandidate;

export async function clickExamPrimaryAction(
  page: Page,
  examId: string,
  expectedAction: string,
): Promise<void> {
  const card = page.getByTestId(`exam-card-${examId}`);
  await card.waitFor({ state: "visible" });
  const action = card.getByTestId("exam-action-btn");
  await action.waitFor({ state: "visible" });
  await action.click();
}

export async function startAvailableExamFromList(
  page: Page,
  examId: string,
): Promise<void> {
  await clickExamPrimaryAction(page, examId, "start");
  await page.waitForURL((url) => /\/exam\/[^/]+\/start$/.test(url.pathname), {
    timeout: 15_000,
  });
  await page.getByTestId("exam-start-btn").click();
  await page.waitForURL((url) => /\/exam\/[^/]+\/take$/.test(url.pathname), {
    timeout: 15_000,
  });
  await page.getByTestId("take-question-section").waitFor({ state: "visible" });
}

export async function startExamFromList(
  page: Page,
  examId: string,
): Promise<void> {
  await startAvailableExamFromList(page, examId);
}

export async function resumeExamFromList(
  page: Page,
  examId: string,
): Promise<void> {
  const card = page.getByTestId(`exam-card-${examId}`);
  await card.waitFor({ state: "visible" });
  await card.getByTestId("exam-action-btn").click();
  await page.waitForURL(
    (url) => /\/exam\/[^/]+\/(start|take)$/.test(url.pathname),
    {
      timeout: 15_000,
    },
  );
  const url = page.url();
  if (/\/start$/.test(url)) {
    await page.getByTestId("exam-start-btn").click();
    await page.waitForURL((url) => /\/exam\/[^/]+\/take$/.test(url.pathname), {
      timeout: 15_000,
    });
  }
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
  await page.getByTestId("confirm-submit-btn").click();
  await page.waitForURL("**/result", { timeout: 30_000 });
}
