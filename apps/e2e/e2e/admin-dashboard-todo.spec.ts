import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { loginAsAdmin } from "../lib/login";
import {
  adminApiToken,
  adminGet,
  adminPost,
  candidateApiToken,
  startAndSubmitAttempt,
} from "../lib/flow";
import { seedExam } from "../lib/seed";

/**
 * #784 stage B3 — L3 witnesses for the actionable admin dashboard queues.
 *
 * Covered here:
 *  - B01: the grading card renders the DISTINCT-attempt workset count (one
 *    seeded attempt carries TWO pending entries and must move the count by 1);
 *  - B02: the incident card renders the honest ">20" lower bound when the
 *    unresolved set exceeds the bounded page (21 seeded incidents);
 *  - B08: each card lands on its queue with the SAME predicate the count used
 *    — the grading queue total equals the card number, and the recovery URL
 *    carries `unresolvedOnly=true` with a visible, clearable filter;
 *  - B10: the pre-existing dashboard blocks (stats cards, quick actions,
 *    recent exams) remain in place beside the todo section.
 *
 * Determinism contract (same as the A3 witnesses): every seeded record carries
 * a per-run unique stamp; the grading count is baselined against the live
 * queue BEFORE seeding, so assertions never depend on prior runs of the
 * persistent exam_e2e database. Every step is event-synced on the response it
 * depends on — no sleeps. A card click is only issued after the card has
 * rendered its value, so the queue-page fetch tracked after the navigation can
 * never be confused with the dashboard's own card fetch (same URL shape).
 */

test.use({ trace: "on" });

const STAMP = Date.now().toString(36);
/** Matches the seeded grading exams by title keyword. */
const GRADING_KEYWORD = `b3g${STAMP}`;
/** Matches the seeded incidents by description keyword. */
const INCIDENT_KEYWORD = `b3kw-${STAMP}`;

const GRADING_QUEUE_API = "/api/admin/grading-queue?page=1&pageSize=1";
const INCIDENT_QUEUE_API = "/api/admin/recovery/incidents?unresolvedOnly=true";

function trackRequestUrls(page: Page, pathFragment: string): string[] {
  const urls: string[] = [];
  page.on("request", (req) => {
    if (req.method() !== "GET") return;
    if (!req.url().includes(pathFragment)) return;
    urls.push(req.url());
  });
  return urls;
}

test.describe.serial("admin dashboard todo queues (#784 B3 L3)", () => {
  let adminToken: string;
  /** Grading-queue total BEFORE this run's seeds. */
  let baselineGradingTotal = 0;

  test("seed two pending-grading attempts (one with two entries) and 21 unresolved incidents", async ({
    request,
  }) => {
    test.setTimeout(240_000);
    adminToken = await adminApiToken(request);

    const baseline = await adminGet(request, adminToken, GRADING_QUEUE_API);
    expect(baseline.ok(), await baseline.text()).toBe(true);
    baselineGradingTotal = ((await baseline.json()) as { total: number }).total;

    // Attempt A: TWO text_response questions → TWO pending entries, ONE queue
    // row (the DISTINCT-attempt unit the card must display).
    const examA = await seedExam(request, `${GRADING_KEYWORD}-a`, {
      questionScore: 10,
      passingScore: 0,
      titleOverride: `${GRADING_KEYWORD}-a 多主观题考试`,
      textResponseQuestions: [
        { score: 30, content: `论述一-${STAMP}` },
        { score: 30, content: `论述二-${STAMP}` },
      ],
    });
    const tokenA = await candidateApiToken(request, examA.candidate);
    await startAndSubmitAttempt(request, tokenA, examA.examId);

    // Attempt B: ONE text_response question → ONE pending entry.
    const examB = await seedExam(request, `${GRADING_KEYWORD}-b`, {
      questionScore: 10,
      passingScore: 0,
      titleOverride: `${GRADING_KEYWORD}-b 单主观题考试`,
      textResponseQuestions: [{ score: 30, content: `论述三-${STAMP}` }],
    });
    const tokenB = await candidateApiToken(request, examB.candidate);
    await startAndSubmitAttempt(request, tokenB, examB.examId);

    const after = await adminGet(request, adminToken, GRADING_QUEUE_API);
    const afterBody = (await after.json()) as { total: number };
    // Three new entries, exactly TWO new queue rows.
    expect(afterBody.total).toBe(baselineGradingTotal + 2);

    // 21 unresolved incidents on one exam → the org-wide unresolved set now
    // exceeds the bounded page whatever older runs left behind.
    const examC = await seedExam(request, `${GRADING_KEYWORD}-c`, {
      passingScore: 0,
      titleOverride: `${GRADING_KEYWORD}-c 事件考试`,
    });
    for (let i = 1; i <= 21; i += 1) {
      const res = await adminPost(
        request,
        adminToken,
        `/api/admin/exams/${examC.examId}/incidents`,
        {
          operationId: randomUUID(),
          type: "network_interruption",
          severity: "minor",
          description: `${INCIDENT_KEYWORD} 未处理事件 ${String(i).padStart(2, "0")}`,
        },
      );
      expect(res.ok(), await res.text()).toBe(true);
    }

    const incidents = await adminGet(
      request,
      adminToken,
      `${INCIDENT_QUEUE_API}&limit=20`,
    );
    const incidentBody = (await incidents.json()) as {
      items: unknown[];
      nextCursor: string | null;
    };
    expect(incidentBody.items.length).toBe(20);
    expect(incidentBody.nextCursor).not.toBeNull();
  });

  test("dashboard renders the honest counts and keeps every existing block (B01/B02/B10)", async ({
    page,
  }, testInfo) => {
    const incidentUrls = trackRequestUrls(
      page,
      "/api/admin/recovery/incidents",
    );
    await loginAsAdmin(page);
    await page.goto("/admin/dashboard");

    // Grading card: exact baseline+2 with its unit (attempt count, NOT the
    // 3 pending entries a per-entry mutant would render).
    const gradingCard = page.getByRole("link", { name: /待人工评分/ });
    await expect(gradingCard).toContainText(String(baselineGradingTotal + 2));
    await expect(gradingCard).toContainText("份答卷");

    // Incident card: the bounded display — ">20", never a fabricated 21.
    const incidentCard = page.getByRole("link", { name: /待处理异常/ });
    await expect(incidentCard).toContainText(">20");

    // The dashboard queried the recovery source with its bounded read.
    expect(
      incidentUrls.some((u) => u.includes("unresolvedOnly=true&limit=20")),
    ).toBe(true);

    // B10: stats cards, quick actions and recent exams remain in place.
    await expect(page.getByText("题目总数")).toBeVisible();
    await expect(page.getByRole("button", { name: "创建考试" })).toBeVisible();
    await expect(page.getByText("近期考试")).toBeVisible();

    const shot = await page.screenshot({ fullPage: true });
    await testInfo.attach("dashboard-b3-todo", {
      body: shot,
      contentType: "image/png",
    });
  });

  test("the grading card lands on the same-predicate queue (B08)", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/dashboard");

    // Rendering the value proves the dashboard's own card fetch (identical URL
    // shape) has completed — the response tracked after the click is the
    // queue page's.
    const gradingCard = page.getByRole("link", { name: /待人工评分/ });
    await expect(gradingCard).toContainText(String(baselineGradingTotal + 2));

    const queueResponse = page.waitForResponse(
      (r) =>
        r.request().method() === "GET" &&
        r.url().includes("/api/admin/grading-queue"),
    );
    await gradingCard.click();
    await page.waitForURL("**/admin/grading-queue");

    const body = (await (await queueResponse).json()) as { total: number };
    // The queue the card lands on counts the SAME workset the card displayed.
    expect(body.total).toBe(baselineGradingTotal + 2);
    // The seeded row is on the queue — the exact match binds to the exam
    // column cell: the candidate cell hosts the entry link whose accessible
    // name carries candidate + exam, so it also contains this title as a
    // substring. (The mobile card list renders the same title but is
    // display:none at the desktop viewport.)
    await expect(
      page.getByRole("cell", {
        name: `${GRADING_KEYWORD}-a 多主观题考试`,
        exact: true,
      }),
    ).toBeVisible();
  });

  test("the incident card lands on the unresolved-only queue with a visible, clearable filter (B08 + P1)", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/dashboard");

    // Same race guard: wait for the bounded display before tracking, so every
    // tracked recovery request below belongs to the card click / landing /
    // clear actions (never the dashboard's own card fetch).
    const incidentCard = page.getByRole("link", { name: /待处理异常/ });
    await expect(incidentCard).toContainText(">20");

    const incidentUrls = trackRequestUrls(
      page,
      "/api/admin/recovery/incidents",
    );
    await incidentCard.click();
    await page.waitForURL("**/admin/recovery?unresolvedOnly=true");

    // The landing list queries the same unresolved predicate.
    await expect
      .poll(() => incidentUrls.some((u) => u.includes("unresolvedOnly=true")))
      .toBe(true);

    // The filter state is VISIBLE (select reads 仅未处理) and CLEARABLE.
    const resolution = page.getByRole("combobox", { name: "全部事件" });
    await expect(resolution).toHaveText("仅未处理");
    await expect(page.getByRole("button", { name: "清除筛选" })).toBeVisible();

    // This run's unresolved incidents are in the landing rows — anchored by
    // the desktop table cell (all 21 rows share the seeded exam title, hence
    // .first(); the mobile card list is display:none at this viewport).
    await expect(
      page.getByRole("cell", { name: `${GRADING_KEYWORD}-c 事件考试` }).first(),
    ).toBeVisible();

    await page.getByRole("button", { name: "清除筛选" }).click();
    await expect(page).not.toHaveURL(new RegExp("unresolvedOnly"));
    // The cleared view refetches WITHOUT the predicate (no filter params).
    await expect
      .poll(() => incidentUrls.some((u) => !u.includes("unresolvedOnly")))
      .toBe(true);
  });

  test("Back from the recovery queue returns to the dashboard (history intact)", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/dashboard");
    const incidentCard = page.getByRole("link", { name: /待处理异常/ });
    await expect(incidentCard).toContainText(">20");
    await incidentCard.click();
    await page.waitForURL("**/admin/recovery?unresolvedOnly=true");
    await page.goBack();
    await page.waitForURL("**/admin/dashboard");
  });
});
