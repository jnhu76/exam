import type { Page } from "@playwright/test";
import type { SeededCandidate } from "./seed";
import { loginViaUi } from "./login";

export async function loginAsCandidate(
  page: Page,
  candidate: SeededCandidate,
): Promise<void> {
  await loginViaUi(page, candidate.username, candidate.password);
}

export const candidateLogin = loginAsCandidate;

export async function clickExamPrimaryAction(
  page: Page,
  examId: string,
  expectedAction: string,
): Promise<void> {
  const card = page.getByTestId(`exam-card-${examId}`);
  await card.waitFor({ state: "visible" });
  const action = card.getByTestId("exam-primary-action");
  await action.waitFor({ state: "visible" });
  await action.evaluate((el, expected) => {
    if (el.getAttribute("data-action") !== expected) {
      throw new Error(
        `Expected primary action ${expected}, got ${el.getAttribute(
          "data-action",
        )}`,
      );
    }
  }, expectedAction);
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
  await card.getByTestId("exam-primary-action").click();
  await page.waitForURL(
    (url) => /\/exam\/[^/]+\/(start|take)$/.test(url.pathname),
    {
      timeout: 15_000,
    },
  );
  const currentUrl = new URL(page.url());
  if (/\/start$/.test(currentUrl.pathname)) {
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
