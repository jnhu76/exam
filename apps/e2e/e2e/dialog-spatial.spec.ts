import { expect, test } from "@playwright/test";
import { seedExam } from "../lib/seed";
import { loginAsAdmin } from "../lib/login";
import { adminApiToken, adminPost } from "../lib/flow";

/**
 * #459 UI-DIALOG-SPATIAL-1 runtime validation — mobile (375px) dialog
 * geometry under the sm/md/lg size vocabulary:
 *   - no dialog-level horizontal scrolling, ever;
 *   - the dialog stays inside the viewport margins (full-width-with-margins
 *     mobile behavior preserved);
 *   - data-slot="dialog-body" owns vertical scrolling when content is tall,
 *     with header/footer fixed in the composition;
 *   - Radix interaction authority unchanged (Escape still closes).
 */

test.use({ viewport: { width: 375, height: 812 } });

interface DialogGeometry {
  contentWidth: number;
  scrollWidth: number;
  clientWidth: number;
  bodyScrollable: boolean;
  headerTop: number;
  footerBottom: number;
}

async function probeDialog(content: {
  evaluate: (
    fn: (el: HTMLElement) => DialogGeometry,
  ) => Promise<DialogGeometry>;
}): Promise<DialogGeometry> {
  return content.evaluate((el) => {
    const body = el.querySelector<HTMLElement>('[data-slot="dialog-body"]');
    const header = el.querySelector<HTMLElement>('[data-slot="dialog-header"]');
    const footer = el.querySelector<HTMLElement>('[data-slot="dialog-footer"]');
    return {
      contentWidth: el.getBoundingClientRect().width,
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      bodyScrollable: body ? body.scrollHeight > body.clientHeight : false,
      headerTop: header ? header.getBoundingClientRect().top : -1,
      footerBottom: footer ? footer.getBoundingClientRect().bottom : -1,
    };
  });
}

function expectNoHorizontalOverflow(geometry: DialogGeometry) {
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1);
}

test("sm dialog (exam extend) fits 375px with footer reachable", async ({
  page,
  request,
}) => {
  const seeded = await seedExam(request, `dialog-spatial-sm-${Date.now()}`);
  await loginAsAdmin(page);
  await page.goto(`/admin/exams/${seeded.examId}`);
  const extendBtn = page.getByTestId("exam-detail-extend-btn");
  await expect(extendBtn).toBeVisible({ timeout: 15_000 });
  await extendBtn.click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const content = dialog.locator('[data-slot="dialog-content"]');
  const geometry = await probeDialog(content);
  expectNoHorizontalOverflow(geometry);
  // Full-width-with-margins: at most 2rem of total margin at 375px.
  expect(geometry.contentWidth).toBeGreaterThanOrEqual(375 - 32 - 1);
  expect(geometry.contentWidth).toBeLessThanOrEqual(375);
  // Footer stays inside the viewport and below the fixed header.
  expect(geometry.footerBottom).toBeGreaterThan(0);
  expect(geometry.footerBottom).toBeLessThanOrEqual(812);
  expect(geometry.footerBottom).toBeGreaterThan(geometry.headerTop);

  // Radix interaction authority unchanged: Escape closes.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("lg dialog (question picker) scrolls its body with fixed bands at 375px", async ({
  page,
  request,
}) => {
  const seeded = await seedExam(request, `dialog-spatial-lg-${Date.now()}`);
  const token = await adminApiToken(request);
  // Enough rows to force the body region past the 85dvh cap.
  for (let i = 0; i < 12; i++) {
    const res = await adminPost(request, token, "/api/questions", {
      courseId: seeded.courseId,
      type: "true_false",
      content: `空间契约长题目内容 ${i} — ${Date.now()}`,
      standardAnswer: true,
      score: 5,
    });
    expect(res.ok()).toBeTruthy();
  }

  await loginAsAdmin(page);
  await page.goto(`/admin/exams/${seeded.examId}/edit`);
  const pickerOpen = page.getByRole("button", { name: "手动选题" });
  await expect(pickerOpen).toBeVisible({ timeout: 15_000 });
  await pickerOpen.click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const content = dialog.locator('[data-slot="dialog-content"]');
  const geometry = await probeDialog(content);
  expectNoHorizontalOverflow(geometry);
  expect(geometry.contentWidth).toBeGreaterThanOrEqual(375 - 32 - 1);
  // Content cap holds: the dialog itself never exceeds the viewport height.
  const box = await content.boundingBox();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(812 + 0.5);
  // The body region is the scroll owner; header and footer stay in view.
  expect(geometry.bodyScrollable).toBe(true);
  expect(geometry.headerTop).toBeGreaterThanOrEqual(box!.y - 0.5);
  expect(geometry.footerBottom).toBeLessThanOrEqual(box!.y + box!.height + 0.5);

  // Scrolling the body never scrolls the dialog horizontally (never legal).
  await content.evaluate((el) => {
    const body = el.querySelector<HTMLElement>('[data-slot="dialog-body"]');
    body?.scrollTo({ top: 40 });
  });
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});
