import { expect, test, type Page } from "@playwright/test";
import { seedExam } from "../lib/seed";
import { loginAsAdmin } from "../lib/login";

/**
 * #460 UI-FORM-LAYOUT-CORRECTIVE-1 runtime spot-check — the migrated
 * ExamConfigForm field pairs (FieldRow, the only multi-column form
 * primitive): two columns at sm+ (desktop), one-column stack below sm.
 * No visual redesign: the pair renders the same classes as before, now from
 * the shared primitive.
 */

async function openTimePair(page: Page, editUrl: string) {
  await page.goto(editUrl);
  // Role-scoped: the raw text also appears inside the empty-state copy
  // (请点击「手动选题」按钮…), which trips strict-mode resolution.
  await expect(page.getByRole("button", { name: "手动选题" })).toBeVisible({
    timeout: 15_000,
  });
  const startLabel = page.getByText("开始时间", { exact: true }).first();
  await expect(startLabel).toBeVisible();
  const endLabel = page.getByText("结束时间", { exact: true }).first();
  await expect(endLabel).toBeVisible();
  return {
    startInput: startLabel.locator("..").locator("input"),
    endInput: endLabel.locator("..").locator("input"),
  };
}

test.describe("form field-pair columns at sm+ (1280px)", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("the time pair lays out in two columns", async ({ page, request }) => {
    const seeded = await seedExam(request, `form-cols-lg-${Date.now()}`);
    await loginAsAdmin(page);
    const { startInput, endInput } = await openTimePair(
      page,
      `/admin/exams/${seeded.examId}/edit`,
    );
    const a = await startInput.boundingBox();
    const b = await endInput.boundingBox();
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    // Same row (two columns), start field to the left of end field.
    expect(Math.abs(a!.y - b!.y)).toBeLessThanOrEqual(1);
    expect(b!.x).toBeGreaterThan(a!.x + a!.width / 2);
  });
});

test.describe("form field-pair stack below sm (375px)", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("the pair stacks in one column", async ({ page, request }) => {
    const seeded = await seedExam(request, `form-cols-sm-${Date.now()}`);
    await loginAsAdmin(page);
    const { startInput, endInput } = await openTimePair(
      page,
      `/admin/exams/${seeded.examId}/edit`,
    );
    const a = await startInput.boundingBox();
    const b = await endInput.boundingBox();
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    // Stacked: the end field starts below the start field.
    expect(b!.y).toBeGreaterThan(a!.y + 16);
    // Both keep the full single-column width.
    expect(Math.abs(a!.x - b!.x)).toBeLessThanOrEqual(1);
  });
});
