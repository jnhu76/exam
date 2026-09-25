/**
 * Misconduct dialog wiring — both admin entry surfaces (#524 browser vertical).
 *
 * Drives the REAL misconduct dialog from each surface that exposes it and
 * proves the browser-sent command satisfies the operationId contract and is
 * ACCEPTED (disposition `applied`, success toast):
 *
 *   - /admin/attempts/:id          — admin attempt detail: custom dialog with
 *     static copy, confirm button 确认标记
 *   - /admin/recovery/attempts/:id — recovery attempt detail: shared
 *     ConfirmDialog whose copy names candidate + exam, confirm button 标记违规
 *
 * Server truth is NOT re-proven here: the applied receipt, misconduct
 * projection, operationId audit and idempotent replay are owned by
 * apps/api/src/routes/attempts/admin-misconduct.test.ts. The lost-response /
 * same-operationId sessionStorage retry protocol is owned by
 * proctor-dashboard-misconduct-retry.spec.ts (browser) and the engine tests.
 */
import { test, expect } from "@playwright/test";
import { seedExam } from "../lib/seed";
import { loginAsAdmin } from "../lib/login";
import { candidateLoginApi, candidateStartAttempt } from "../lib/flow";

interface MisconductEntry {
  surface: string;
  url: (attemptId: string) => string;
  urlGlob: string;
  /** Copy that only the opened dialog renders (not the trigger button). */
  dialogCopy: RegExp;
  confirmName: string;
}

const ENTRIES: MisconductEntry[] = [
  {
    surface: "admin attempt detail",
    url: (id) => `/admin/attempts/${id}`,
    urlGlob: "**/admin/attempts/**",
    dialogCopy: /标记违规用于记录考生异常行为/,
    confirmName: "确认标记",
  },
  {
    surface: "recovery attempt detail",
    url: (id) => `/admin/recovery/attempts/${id}`,
    urlGlob: "**/admin/recovery/attempts/**",
    dialogCopy: /标记为违规/,
    confirmName: "标记违规",
  },
];

test.describe("misconduct dialog wiring (#524)", () => {
  for (const entry of ENTRIES) {
    test(`${entry.surface}: dialog sends a fresh operationId and the mark applies`, async ({
      page,
      request,
    }) => {
      const s = await seedExam(request, `mis-wiring-${Date.now()}`);
      const candidateToken = await candidateLoginApi(
        request,
        s.candidate.username,
        s.candidate.password,
      );
      const targetAttemptId = await candidateStartAttempt(
        request,
        candidateToken,
        s.examId,
      );

      let capturedBody: Record<string, unknown> = {};
      let capturedDisposition = "";
      await page.route("**/api/admin/attempts/*/misconduct", async (route) => {
        capturedBody = route.request().postDataJSON() as Record<
          string,
          unknown
        >;
        const response = await route.fetch();
        const parsed = (await response.json()) as { disposition?: string };
        capturedDisposition = parsed.disposition ?? "";
        await route.fulfill({
          status: response.status(),
          contentType: "application/json",
          body: JSON.stringify(parsed),
        });
      });

      await loginAsAdmin(page);
      await page.goto(entry.url(targetAttemptId));
      await page.waitForURL(entry.urlGlob, { timeout: 15_000 });

      await expect(page.getByRole("button", { name: "标记违规" })).toBeVisible({
        timeout: 15_000,
      });
      await page.getByRole("button", { name: "标记违规" }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByText(entry.dialogCopy)).toBeVisible();
      await dialog.getByLabel("违规说明").fill("E2E 违规标记说明");
      await dialog.getByRole("button", { name: entry.confirmName }).click();

      await expect(page.getByText("已标记违规").first()).toBeVisible({
        timeout: 15_000,
      });
      // The previously-400 caller now satisfies the operationId contract.
      expect(typeof capturedBody.operationId).toBe("string");
      expect(capturedBody.operationId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      expect(capturedBody.severity).toBe("warning");
      expect(capturedDisposition).toBe("applied");
    });
  }
});
