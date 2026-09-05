import { test, expect, type Page } from "@playwright/test";
import { appendFileSync } from "node:fs";
import { seedExam } from "../lib/seed";
import { loginAsAdmin } from "../lib/login";
import {
  adminApiToken,
  candidateApiToken,
  candidateStartAttempt,
  closeExamApi,
  gradeQuestionApi,
  publishResultsApi,
  startAndSubmitAttempt,
} from "../lib/flow";
import {
  assertDialogFitsViewport,
  assertLocalScrollContained,
  assertNoHorizontalOverflow,
  assertReachable,
  MOBILE_VIEWPORT,
} from "../lib/responsive";

/**
 * Admin responsive baseline (Issue #306 closeout — the Admin half deferred
 * after PR #410 landed the Candidate half). Deterministic geometry assertions
 * at the 390x844 contract viewport:
 *
 *   - critical Admin flows: login, mobile drawer navigation, list toolbar,
 *     exam detail, destructive confirm dialog, CRUD form dialog, settings
 *     form — primary controls stay visible and horizontally reachable;
 *   - broad route sweep: every reachable Admin route renders its anchor and
 *     never produces document-level horizontal overflow; dense tables use
 *     their deliberate local scroll container (contained, not page-level);
 *   - long mixed-script content stress on the shared list/detail primitives;
 *   - desktop (1280x720) sanity (non-regression).
 *
 * Screenshots are not the gate — every assertion is computed geometry / DOM
 * state (issue #306 §32).
 */

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

/**
 * Mixed-script long-content stress shared by the Admin list and detail
 * surfaces: per-glyph-wrapping CJK plus a single ~80-char unbroken Latin
 * token (the case that requires overflow-wrap, not just normal wrapping).
 */
const LONG_TITLE =
  "E2E-admin-resp-long-" +
  "这是一个非常长的中文考试标题用于验证窄视口下管理员页面的换行行为" +
  "thesupercalifragilisticexpialidociousunbrokenlatintokenfore2eresponsive";

interface SweepFixture {
  examId: string;
  /** Exam with a graded + published submission (scores surface needs it). */
  gradedExamId: string;
  questionId: string;
  attemptInProgress: string;
  attemptSubmitted: string;
  incidentId: string;
  profileId: string;
}

async function gotoSettled(page: Page, path: string): Promise<string> {
  await page.goto(path);
  // The PageHeader h1 is the route-rendered anchor: it proves the intended
  // surface really rendered (an AccessDenied/Login redirect or an error
  // state would fail this), and its text identifies the surface in failures.
  const h1 = page.locator("main h1");
  await expect(h1).toBeVisible();
  // Data arrives after the header for API-driven pages. networkidle is the
  // settle signal; surfaces that keep polling (monitoring/proctor) never go
  // idle, so fall through after a short grace and let the geometry
  // assertions measure the settled frame.
  await page
    .waitForLoadState("networkidle", { timeout: 5_000 })
    .catch(() => {});
  await page.waitForTimeout(300);
  return (await h1.textContent())?.trim() ?? "";
}

/** Every visible container on the page stays horizontally in the viewport. */
async function assertLocalScrollRegionsContained(page: Page): Promise<void> {
  // Both shared dense-content scroll owners: DataTableShell's explicit
  // local-scroll region (data-overflow-owner="local") and the bare ui/Table
  // container. Any other element overflowing the document fails the R1
  // document assertion instead.
  const containers = page.locator(
    '[data-slot="table-scroll-region"], [data-slot="table-container"]',
  );
  const count = await containers.count();
  for (let i = 0; i < count; i++) {
    const container = containers.nth(i);
    if (await container.isVisible()) {
      await assertLocalScrollContained(page, container);
    }
  }
}

test.describe("admin responsive baseline 390x844", () => {
  test.describe.configure({ mode: "serial" });

  let fixture: SweepFixture;

  test.beforeAll(async ({ request }) => {
    const seededActive = await seedExam(request, "adm-resp-a", {
      questionAnswer: true,
      titleOverride: LONG_TITLE,
    });
    const seededGraded = await seedExam(request, "adm-resp-b", {
      questionAnswer: true,
      textResponseQuestions: [
        {
          score: 60,
          content: "admin-resp 论述题：请简述响应式基线的验收标准",
          standardAnswer: "参考答案",
          rubric: "评分标准",
        },
      ],
    });
    // Third exam: its submission gets graded + published so the scores
    // surface has real rows (a graded attempt no longer sits in the grading
    // queue, so the pending and graded fixtures must be separate attempts).
    const seededPublished = await seedExam(request, "adm-resp-c", {
      questionAnswer: true,
      textResponseQuestions: [
        {
          score: 60,
          content: "admin-resp 论述题：成绩发布流程验证",
          standardAnswer: "参考答案",
          rubric: "评分标准",
        },
      ],
    });

    const adminToken = await adminApiToken(request);
    const candidateTokenActive = await candidateApiToken(
      request,
      seededActive.candidate,
    );
    const candidateTokenGraded = await candidateApiToken(
      request,
      seededGraded.candidate,
    );

    // In-progress attempt (attempts/:id, monitor surfaces) and a submitted
    // attempt with pending manual grading (grading-queue/:id, recovery).
    const attemptInProgress = await candidateStartAttempt(
      request,
      candidateTokenActive,
      seededActive.examId,
    );
    const attemptSubmitted = await startAndSubmitAttempt(
      request,
      candidateTokenGraded,
      seededGraded.examId,
    );

    // Real scores for the /admin/exams/:id/scores sweep target: submit a
    // second attempt on the third exam, grade it, publish the results.
    const candidateTokenPublished = await candidateApiToken(
      request,
      seededPublished.candidate,
    );
    const attemptPublished = await startAndSubmitAttempt(
      request,
      candidateTokenPublished,
      seededPublished.examId,
    );
    const gradedQuestionId = seededPublished.textResponseQuestionIds[0]!;
    const gradeRes = await gradeQuestionApi(
      request,
      adminToken,
      attemptPublished,
      gradedQuestionId,
      55,
    );
    expect(
      gradeRes.ok(),
      `grade: ${gradeRes.status()} ${await gradeRes.text()}`,
    ).toBe(true);
    const publishRes = await publishResultsApi(
      request,
      adminToken,
      seededPublished.examId,
    );
    expect(
      publishRes.ok(),
      `publish: ${publishRes.status()} ${await publishRes.text()}`,
    ).toBe(true);
    // The scores surface serves only finished exams (EXAM_NOT_FINISHED otherwise).
    const closeRes = await closeExamApi(
      request,
      adminToken,
      seededPublished.examId,
    );
    expect(
      closeRes.ok(),
      `close: ${closeRes.status()} ${await closeRes.text()}`,
    ).toBe(true);

    const incidentRes = await request.post(
      `${BASE_URL}/api/admin/exams/${seededActive.examId}/incidents`,
      {
        headers: { Cookie: `auth-token=${adminToken}` },
        data: {
          operationId: crypto.randomUUID(),
          type: "network_interruption",
          severity: "major",
          description: "admin-resp E2E incident",
        },
      },
    );
    expect(incidentRes.ok(), `incident: ${incidentRes.status()}`).toBe(true);
    const incidentId = (
      (await incidentRes.json()) as {
        incident: { id: string };
      }
    ).incident.id;

    const profileRes = await request.post(`${BASE_URL}/api/exam-profiles`, {
      headers: { Cookie: `auth-token=${adminToken}` },
      data: {
        name: `adm-resp-profile-${Date.now()}`,
        description: "e2e",
        durationMinutes: 60,
        latestStartOffsetMinutes: 15,
        minSubmitAfterStartMinutes: 10,
        retakePolicy: "max_attempts",
        maxAttempts: 2,
        scoreStrategy: "highest",
        resultPublicationMode: "after_grading",
        interruptionTimePolicy: "strict",
      },
    });
    expect(
      profileRes.ok(),
      `profile: ${profileRes.status()} ${await profileRes.text()}`,
    ).toBe(true);
    const profileId = ((await profileRes.json()) as { id: string }).id;

    // The grading-queue/:id sweep target needs a real queue row. The queue
    // paginates (20/page) and earlier runs may have filled page 1, so walk
    // pages until the seeded attempt shows up.
    let inQueue = false;
    for (let qPage = 1; qPage <= 10 && !inQueue; qPage++) {
      const queueRes = await request.get(
        `${BASE_URL}/api/admin/grading-queue?page=${qPage}&pageSize=20`,
        { headers: { Cookie: `auth-token=${adminToken}` } },
      );
      expect(queueRes.ok(), `grading queue: ${queueRes.status()}`).toBe(true);
      const queue = (await queueRes.json()) as {
        items: { attemptId: string }[];
      };
      inQueue = queue.items.some((i) => i.attemptId === attemptSubmitted);
      if (!queue.items.length) break;
    }
    expect(inQueue, "seeded submission must appear in the grading queue").toBe(
      true,
    );

    fixture = {
      examId: seededActive.examId,
      gradedExamId: seededPublished.examId,
      questionId: seededActive.questionId,
      attemptInProgress,
      attemptSubmitted,
      incidentId,
      profileId,
    };
  });

  test("login → mobile drawer → exam list → long-title detail → close dialog", async ({
    page,
  }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);

    await page.goto("/login");
    await expect(page.getByTestId("login-layout")).toBeVisible();
    await assertNoHorizontalOverflow(page);
    await loginAsAdmin(page);

    // Mobile shell: below lg the drawer is the nav surface (deep contract
    // already proven by admin-shell-viewport.spec.ts; here it is the
    // user path to the list).
    const trigger = page.getByTestId("mobile-nav-trigger");
    await expect(trigger).toBeVisible();
    await trigger.click();
    await page
      .getByTestId("mobile-nav-drawer")
      .getByRole("link", { name: "考试管理" })
      .click();
    await expect(page).toHaveURL(/\/admin\/exams(?:$|[?#])/);

    // Exam list: anchored, no document overflow, shell title band + table
    // usable (this list's toolbar is a summary span, not a search input).
    const listTitle = await gotoSettled(page, "/admin/exams");
    expect(listTitle.length).toBeGreaterThan(0);
    await assertReachable(
      page,
      page.locator('[data-slot="data-table-title-band"]'),
    );
    await assertLocalScrollRegionsContained(page);
    await assertNoHorizontalOverflow(page);

    // Long mixed-script content stress through the shared list + detail
    // primitives: the seeded exam title carries a CJK + unbroken-Latin token.
    await expect(page.getByText(LONG_TITLE.slice(0, 20)).first()).toBeVisible();

    await page.goto(`/admin/exams/${fixture.examId}`);
    const detailTitle = await gotoSettled(
      page,
      `/admin/exams/${fixture.examId}`,
    );
    expect(detailTitle.length).toBeGreaterThan(0);
    await assertNoHorizontalOverflow(page);

    // Destructive confirm dialog opens, fits, and keeps both actions
    // reachable at 390px.
    const closeBtn = page.getByTestId("exam-detail-close-btn");
    await assertReachable(page, closeBtn);
    await closeBtn.click();
    const dialog = page.getByRole("alertdialog");
    await assertDialogFitsViewport(page, dialog);
    for (const action of [
      dialog.getByRole("button", { name: /^确认$/ }),
      dialog.getByRole("button", { name: /^取消$/ }),
    ]) {
      await assertReachable(page, action);
    }
    await dialog.getByRole("button", { name: /^取消$/ }).click();
    await expect(dialog).toBeHidden();
    await assertNoHorizontalOverflow(page);
  });

  test("candidates CRUD form dialog fits and stays operable", async ({
    page,
  }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await loginAsAdmin(page);

    await gotoSettled(page, "/admin/candidates");
    await assertNoHorizontalOverflow(page);

    await page.getByRole("button", { name: "新增考生" }).first().click();
    const dialog = page.getByRole("dialog");
    await assertDialogFitsViewport(page, dialog);

    // Inputs fit their container; every visible action in the dialog stays
    // inside the viewport (submit/cancel reachable without horizontal hunt).
    const inputs = dialog.locator("input");
    const inputCount = await inputs.count();
    expect(inputCount).toBeGreaterThanOrEqual(1);
    for (let i = 0; i < inputCount; i++) {
      const input = inputs.nth(i);
      if (await input.isVisible()) {
        await assertReachable(page, input);
      }
    }
    const buttons = dialog.getByRole("button");
    const buttonCount = await buttons.count();
    let reachableButtons = 0;
    for (let i = 0; i < buttonCount; i++) {
      const button = buttons.nth(i);
      if (await button.isVisible()) {
        await assertReachable(page, button);
        reachableButtons++;
      }
    }
    expect(reachableButtons).toBeGreaterThanOrEqual(1);

    await assertNoHorizontalOverflow(page);
  });

  test("settings form usable at 390px", async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await loginAsAdmin(page);

    await gotoSettled(page, "/admin/settings");
    await assertNoHorizontalOverflow(page);
    const inputs = page.locator("main form input, main form textarea");
    const count = await inputs.count();
    for (let i = 0; i < count; i++) {
      const input = inputs.nth(i);
      if (await input.isVisible()) {
        await assertReachable(page, input);
      }
    }
    await assertReachable(page, page.getByTestId("profile-save-btn"));
  });

  test("broad route sweep: every reachable Admin surface anchored + contained", async ({
    page,
  }) => {
    // 34+ routes × settled navigation exceeds the default 30s test budget.
    test.setTimeout(180_000);
    await page.setViewportSize(MOBILE_VIEWPORT);
    await loginAsAdmin(page);

    const routes: Array<{ path: string; surface: string }> = [
      { path: "/admin/dashboard", surface: "OTHER" },
      { path: "/admin/system", surface: "AUDIT_DIAGNOSTIC" },
      { path: "/admin/operations", surface: "OPERATIONS" },
      { path: "/admin/settings", surface: "SETTINGS" },
      { path: "/admin/candidate-fields", surface: "LIST_TABLE" },
      { path: "/admin/users", surface: "LIST_TABLE" },
      { path: "/admin/candidates", surface: "LIST_TABLE" },
      { path: "/admin/courses", surface: "LIST_TABLE" },
      { path: "/admin/questions", surface: "LIST_TABLE" },
      { path: "/admin/questions/new", surface: "FORM" },
      { path: `/admin/questions/${fixture.questionId}/edit`, surface: "FORM" },
      { path: "/admin/questions/import", surface: "IMPORT" },
      { path: "/admin/exams", surface: "LIST_TABLE" },
      { path: "/admin/exams/new", surface: "WIZARD" },
      { path: `/admin/exams/${fixture.examId}`, surface: "DETAIL" },
      { path: `/admin/exams/${fixture.examId}/edit`, surface: "FORM" },
      {
        path: `/admin/exams/${fixture.gradedExamId}/scores`,
        surface: "LIST_TABLE",
      },
      { path: "/admin/exam-profiles", surface: "LIST_TABLE" },
      { path: "/admin/exam-profiles/new", surface: "FORM" },
      {
        path: `/admin/exam-profiles/${fixture.profileId}/edit`,
        surface: "FORM",
      },
      { path: `/admin/exams/${fixture.examId}/proctor`, surface: "OPERATIONS" },
      { path: "/admin/proctor", surface: "OPERATIONS" },
      {
        path: `/admin/exams/${fixture.examId}/proctor/monitor`,
        surface: "OPERATIONS",
      },
      { path: "/admin/results", surface: "LIST_TABLE" },
      { path: "/admin/grading-queue", surface: "LIST_TABLE" },
      {
        path: `/admin/grading-queue/${fixture.attemptSubmitted}`,
        surface: "FORM",
      },
      { path: "/admin/audit-logs", surface: "AUDIT_DIAGNOSTIC" },
      { path: "/admin/permissions", surface: "AUDIT_DIAGNOSTIC" },
      { path: "/admin/import-logs", surface: "AUDIT_DIAGNOSTIC" },
      {
        path: `/admin/attempts/${fixture.attemptInProgress}`,
        surface: "DETAIL",
      },
      { path: "/admin/recovery", surface: "RECOVERY" },
      {
        path: `/admin/recovery/incidents/${fixture.incidentId}`,
        surface: "RECOVERY",
      },
      {
        path: `/admin/recovery/attempts/${fixture.attemptSubmitted}`,
        surface: "RECOVERY",
      },
      {
        path: `/admin/recovery/exams/${fixture.examId}`,
        surface: "RECOVERY",
      },
    ];

    const visited: string[] = [];
    for (const { path, surface } of routes) {
      const title = await gotoSettled(page, path);
      expect(
        title.length,
        `${path} (${surface}) rendered an empty h1`,
      ).toBeGreaterThan(0);
      await assertLocalScrollRegionsContained(page);
      await assertNoHorizontalOverflow(page);
      visited.push(`${path} → "${title}"`);
    }
    // The sweep must stay non-vacuous: persist the anchored surfaces next
    // to the run artifacts so a digest of what was actually proven survives
    // (console output trips the code-quality gate; same pattern as the a11y
    // digest file).
    appendFileSync(
      "/tmp/admin-responsive-sweep.log",
      `anchored ${visited.length} surfaces @390x844:\n${visited.join("\n")}\n`,
    );
  });

  test("desktop 1280x720 sanity: list + detail non-regression", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await loginAsAdmin(page);

    await gotoSettled(page, "/admin/exams");
    await assertNoHorizontalOverflow(page);
    // Desktop shell: the expanded sidebar is present (not the mobile drawer).
    await expect(page.getByTestId("app-sidebar")).toBeVisible();
    await assertReachable(
      page,
      page.locator('[data-slot="data-table-title-band"]'),
    );

    await gotoSettled(page, `/admin/exams/${fixture.examId}`);
    await assertNoHorizontalOverflow(page);
    await expect(page.getByTestId("app-sidebar")).toBeVisible();
    await expect(page.getByTestId("exam-detail-close-btn")).toBeVisible();
  });
});
