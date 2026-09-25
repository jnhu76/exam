/**
 * #612 — AttemptDetail capability composition, real browser vertical.
 *
 * The Proctor preset legitimately reaches `/admin/attempts/:id` (route gate
 * attempt.timeline.view) through the Proctor Recovery incident detail. This
 * spec proves the page composes by CAPABILITY, not by page identity:
 *
 *   - the timeline shell loads (timeline request issued and answered 200,
 *     section rendered — the legitimate base page works);
 *   - the privileged affordances (export CSV/JSON, flag misconduct) never
 *     render for a caller whose capability set does not own them;
 *   - the privileged requests (GET /api/scores/attempts/:id — a guaranteed
 *     403 for the Proctor preset — plus export/misconduct) are never EMITTED.
 *
 * The network-level assertion is the point: DOM visibility alone cannot prove
 * request composition. Both page-load fetches fire in the same mount effect
 * flush, so once the timeline RESPONSE has arrived, absence of the score
 * request in the captured list is deterministic (no settling sleep needed).
 *
 * The Admin contrast test locks the preservation side: the same route, same
 * attempt, full privileged affordance set for the capability-superset caller.
 */
import { expect, test } from "@playwright/test";
import { seedExam } from "../lib/seed";
import { loginAsAdmin, loginViaUi } from "../lib/login";
import {
  adminApiToken,
  adminPost,
  candidateApiToken,
  candidateStartAttempt,
} from "../lib/flow";
import { createProctorAssignmentFixture } from "../lib/seed";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

/** Pure Proctor persona — the Proctor preset only (see proctor-landing.spec.ts). */
const PROCTOR_LANDING = /\/admin\/proctor(?:$|[/?#])/;

/** Privileged AttemptDetail request patterns a timeline-only caller must not emit. */
function isPrivilegedAttemptDetailRequest(url: string): boolean {
  return (
    url.includes("/api/scores/attempts/") ||
    /\/api\/admin\/attempts\/[^/]+\/export/.test(url) ||
    url.includes("/misconduct")
  );
}

test.describe("Proctor → AttemptDetail capability composition (#612)", () => {
  test.describe.configure({ mode: "serial" });

  let attemptId: string;
  let incidentId: string;
  let proctorUsername: string;
  let proctorPassword: string;

  test.beforeAll(async ({ request }) => {
    const unique = `attempt-composition-${Date.now().toString(36)}`;
    const s = await seedExam(request, unique);
    attemptId = await candidateStartAttempt(
      request,
      await candidateApiToken(request, s.candidate),
      s.examId,
    );

    // Exam-anchored incident carrying the live attempt, so the Proctor
    // Recovery detail surfaces the /admin/attempts/:id link.
    const adminToken = await adminApiToken(request);
    const createRes = await adminPost(
      request,
      adminToken,
      `/api/admin/exams/${s.examId}/incidents`,
      {
        operationId: crypto.randomUUID(),
        type: "network_interruption",
        severity: "major",
        description: `E2E 组合闭环 ${unique}`,
        attemptId,
        candidateId: s.candidate.profileId,
      },
    );
    expect(createRes.ok(), `createIncident → ${createRes.status()}`).toBe(true);
    incidentId = ((await createRes.json()) as { incident: { id: string } })
      .incident.id;

    // Assigned Proctor (ADR-015 assignment scoping gates the Recovery worklist).
    const stamp = Date.now().toString(36);
    proctorUsername = `e2e-comp-proctor-${stamp}`;
    proctorPassword = "proctor123";
    const userRes = await request.post(`${BASE_URL}/api/users`, {
      headers: { Cookie: `auth-token=${adminToken}` },
      data: {
        username: proctorUsername,
        password: proctorPassword,
        name: `E2E Composition Proctor ${stamp}`,
        role: "Proctor",
      },
    });
    expect(userRes.status(), `POST /api/users → ${await userRes.text()}`).toBe(
      201,
    );
    const proctorUserId = ((await userRes.json()) as { id: string }).id;
    await createProctorAssignmentFixture(
      request,
      adminToken,
      s.examId,
      proctorUserId,
    );
  });

  test("Proctor Recovery → attempt link: timeline shell loads, privileged requests and controls absent", async ({
    page,
  }) => {
    await loginViaUi(page, proctorUsername, proctorPassword, PROCTOR_LANDING);

    // Enter Proctor Recovery; the assigned incident is in the worklist.
    // #601 Phase F: the responsive switch mounts the mobile card region first
    // in DOM order, so assert the link in the desktop region this viewport
    // renders (same idiom as proctor-recovery-center.spec.ts).
    await page.goto("/admin/proctor/recovery");
    await expect(page.getByRole("heading", { name: "监考处置" })).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page
        .locator('[data-slot="responsive-desktop-region"]')
        .locator(`a[href="/admin/proctor/recovery/incidents/${incidentId}"]`)
        .first(),
    ).toBeVisible({ timeout: 15_000 });

    // Incident detail carries the canonical AttemptDetail link.
    await page.goto(`/admin/proctor/recovery/incidents/${incidentId}`);
    const attemptLink = page.locator(`a[href="/admin/attempts/${attemptId}"]`);
    await expect(attemptLink.first()).toBeVisible({ timeout: 15_000 });

    // Request composition audit: capture everything the AttemptDetail load emits.
    const privilegedUrls: string[] = [];
    page.on("request", (req) => {
      const url = req.url();
      if (isPrivilegedAttemptDetailRequest(url)) privilegedUrls.push(url);
    });
    const timelineResponsePromise = page.waitForResponse(
      (res) => res.url().includes(`/api/admin/attempts/${attemptId}/timeline`),
      { timeout: 15_000 },
    );

    await attemptLink.first().click();
    await page.waitForURL(`**/admin/attempts/${attemptId}`, {
      timeout: 15_000,
    });

    // The legitimate base page works: timeline request answered 200, section
    // rendered, no error surface.
    const timelineResponse = await timelineResponsePromise;
    expect(timelineResponse.status()).toBe(200);
    await expect(page.getByText("答卷时间线").first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText("加载时间线失败")).toHaveCount(0);
    await expect(page.locator('[role="alert"]')).toHaveCount(0);

    // Privileged affordances absent …
    for (const name of ["导出CSV", "导出JSON", "标记违规"]) {
      await expect(
        page.getByRole("button", { name }),
        `privileged control must not render: ${name}`,
      ).toHaveCount(0);
    }
    // … AND their requests never emitted (see header comment for why this is
    // deterministic once the timeline response has arrived).
    expect(
      privilegedUrls,
      `privileged requests emitted: ${privilegedUrls.join(", ")}`,
    ).toEqual([]);
  });

  test("Admin on the same route keeps the full privileged affordance set", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await page.goto(`/admin/attempts/${attemptId}`);
    await page.waitForURL(`**/admin/attempts/${attemptId}`, {
      timeout: 15_000,
    });

    // Live attempt → the live view with export + misconduct affordances.
    await expect(page.getByText("尝试状态")).toBeVisible({ timeout: 15_000 });
    for (const name of ["导出CSV", "导出JSON", "标记违规"]) {
      await expect(
        page.getByRole("button", { name }),
        `authorized affordance missing: ${name}`,
      ).toBeVisible();
    }
  });
});
