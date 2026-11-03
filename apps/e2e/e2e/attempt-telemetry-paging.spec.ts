import { test, expect } from "@playwright/test";
import { seedExam } from "../lib/seed";
import { loginAsAdmin } from "../lib/login";
import {
  adminApiToken,
  candidateApiToken,
  candidateStartAttempt,
} from "../lib/flow";

/**
 * #800 PR-C browser acceptance: a terminal attempt with MORE than one page of
 * proctor telemetry must disclose the partial view and load the older page
 * through the existing paginated endpoint (no new API).
 *
 * Real browser + real API + real PostgreSQL: the telemetry section fetches
 * `/api/admin/attempts/:id/proctor-events?limit=50` on mount, then the
 * Load-More control must request page 2 and append it. The server-owned
 * receive instant is the row's primary time; the client-asserted occurredAt
 * is labeled as a claim (time authority, #544).
 *
 * Determinism: the 51 events are posted for THIS run's attempt only; the
 * assertions count the rendered bulk event rows, so they never depend on
 * tie-breaking among events that share a server receive millisecond.
 */

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const BULK_EVENT_COUNT = 51;
const PAGE_SIZE = 50;

test.describe("admin attempt detail telemetry paging (#800 PR-C)", () => {
  test("a >50-event terminal attempt discloses partial history and loads the older page", async ({
    page,
    request,
  }) => {
    const seeded = await seedExam(request, "telemetry-paging");
    const candidateToken = await candidateApiToken(request, seeded.candidate);
    const attemptId = await candidateStartAttempt(
      request,
      candidateToken,
      seeded.examId,
    );

    // Post the bulk telemetry while the attempt is still the candidate's own
    // in-progress attempt, so the reference normalizer can prove the tie.
    const occurredAt = new Date().toISOString();
    const events = Array.from({ length: BULK_EVENT_COUNT }, (_, i) => ({
      kind: "exam_telemetry",
      level: "info",
      name: `e2e_bulk_${String(i).padStart(2, "0")}`,
      occurredAt,
      attemptId,
      examId: seeded.examId,
      metadata: {},
    }));
    for (let start = 0; start < events.length; start += PAGE_SIZE) {
      const batch = events.slice(start, start + PAGE_SIZE);
      const res = await request.post(`${BASE_URL}/api/client-events`, {
        headers: { Cookie: `auth-token=${candidateToken}` },
        data: { events: batch },
      });
      expect(res.ok(), await res.text()).toBe(true);
      expect(((await res.json()) as { accepted: number }).accepted).toBe(
        batch.length,
      );
    }

    // Make the attempt terminal.
    const submit = await request.post(
      `${BASE_URL}/api/attempts/${attemptId}/submit`,
      { headers: { Cookie: `auth-token=${candidateToken}` } },
    );
    expect(submit.ok(), await submit.text()).toBe(true);

    // The admin detail page requires a readable result response; wait until
    // the server projects one (no sleeps — poll the real endpoint).
    const adminToken = await adminApiToken(request);
    await expect
      .poll(
        async () => {
          const res = await request.get(
            `${BASE_URL}/api/admin/attempts/${attemptId}/result`,
            { headers: { Cookie: `auth-token=${adminToken}` } },
          );
          return res.status();
        },
        { timeout: 30_000, intervals: [500, 1000, 2000] },
      )
      .toBe(200);

    await loginAsAdmin(page);
    await page.goto(`/admin/attempts/${attemptId}`);

    await expect(page.getByText("遥测时间线")).toBeVisible({
      timeout: 30_000,
    });
    // Partial history is disclosed explicitly: 50 of 51 rows on screen.
    await expect(page.getByText("已显示 50 / 51 条事件")).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      page.getByText("仅显示最近 50 条事件，更早证据需加载"),
    ).toBeVisible();
    // Time authority: the server receive instant anchors the row, and the
    // client-asserted instant is labeled as a claim.
    await expect(page.getByText(/服务端接收/).first()).toBeVisible();
    await expect(page.getByText(/客户端声明/).first()).toBeVisible();

    const firstPageNames = await page.getByText(/^e2e_bulk_/).allTextContents();
    expect(firstPageNames).toHaveLength(PAGE_SIZE);

    await page.getByRole("button", { name: "加载更早事件" }).click();

    await expect(page.getByText("已显示 51 / 51 条事件")).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      page.getByRole("button", { name: "加载更早事件" }),
    ).toHaveCount(0);

    const allNames = await page.getByText(/^e2e_bulk_/).allTextContents();
    expect(allNames).toHaveLength(BULK_EVENT_COUNT);
    // Exactly the one row that was missing from page 1 was appended (the
    // first 50 stay mounted; no duplicates, no drop).
    const appended = allNames.filter((name) => !firstPageNames.includes(name));
    expect(appended).toHaveLength(BULK_EVENT_COUNT - PAGE_SIZE);
    for (const name of allNames) {
      expect(name).toMatch(/^e2e_bulk_\d{2}$/);
    }
  });
});
