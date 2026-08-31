/**
 * Recovery Center cross-page navigation smoke.
 *
 * INVARIANT: the Recovery link graph is navigable in a real browser —
 * Queue → Incident → Attempt → Exam → filtered Queue. Every step asserts the
 * exact target URL (no `/admin/recovery` prefix matching that would let an
 * earlier page pass), so a broken or relabeled link cannot pass silently.
 */
import { test, expect } from "@playwright/test";
import { IncidentSeverity, IncidentType } from "@exam/domain";
import { seedExam } from "../lib/seed";
import { loginAsAdmin } from "../lib/login";
import {
  adminApiToken,
  adminPost,
  candidateApiToken,
  candidateStartAttempt,
} from "../lib/flow";

test.describe("Recovery Center cross-page navigation", () => {
  test("Queue → Incident → Attempt → Exam → filtered Queue", async ({
    page,
    request,
  }) => {
    // Seed exam → candidate → live attempt → one anchored incident, so every
    // page on the path has real data to render.
    const s = await seedExam(request, `recovery-nav-${Date.now()}`);
    const attemptId = await candidateStartAttempt(
      request,
      await candidateApiToken(request, s.candidate),
      s.examId,
    );
    const adminToken = await adminApiToken(request);
    const createRes = await adminPost(
      request,
      adminToken,
      `/api/admin/exams/${s.examId}/incidents`,
      {
        operationId: crypto.randomUUID(),
        type: IncidentType.NetworkInterruption,
        severity: IncidentSeverity.Critical,
        description: "E2E navigation smoke — network disruption during exam",
        attemptId,
        candidateId: s.candidate.profileId,
      },
    );
    expect(createRes.ok()).toBe(true);
    const { incident } = (await createRes.json()) as {
      incident: { id: string };
    };

    await loginAsAdmin(page);

    // 1. Queue → Incident detail. The queue is (createdAt DESC, id DESC), so
    //    targeting the incident by href keeps the step independent of row
    //    order.
    await page.goto("/admin/recovery");
    const incidentLink = page
      .locator(`a[href="/admin/recovery/incidents/${incident.id}"]:visible`)
      .first();
    await expect(incidentLink).toBeVisible({ timeout: 15_000 });
    await incidentLink.click();
    await expect(page).toHaveURL(`/admin/recovery/incidents/${incident.id}`);

    // 2. Incident detail → Attempt detail (anchor attempt link)
    const attemptLink = page
      .locator(`a[href="/admin/recovery/attempts/${attemptId}"]:visible`)
      .first();
    await expect(attemptLink).toBeVisible({ timeout: 15_000 });
    await attemptLink.click();
    await expect(page).toHaveURL(`/admin/recovery/attempts/${attemptId}`);

    // 3. Attempt detail → Exam detail
    const examLink = page
      .locator(`a[href="/admin/recovery/exams/${s.examId}"]:visible`)
      .first();
    await expect(examLink).toBeVisible({ timeout: 15_000 });
    await examLink.click();
    await expect(page).toHaveURL(`/admin/recovery/exams/${s.examId}`);

    // 4. Exam detail → filtered Queue ("在队列中查看" carries ?examId=)
    const queueLink = page
      .locator(`a[href="/admin/recovery?examId=${s.examId}"]:visible`)
      .first();
    await expect(queueLink).toBeVisible({ timeout: 15_000 });
    await queueLink.click();
    await expect(page).toHaveURL(`/admin/recovery?examId=${s.examId}`);

    // Final: exactly the queue page, filtered to the seeded exam
    const finalUrl = new URL(page.url());
    expect(finalUrl.pathname).toBe("/admin/recovery");
    expect(finalUrl.searchParams.get("examId")).toBe(s.examId);

    // No error surface on the final page
    await expect(page.locator('[role="alert"]')).toHaveCount(0);
  });
});
