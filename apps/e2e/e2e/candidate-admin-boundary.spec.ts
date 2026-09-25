/**
 * P4-C3 — Candidate admin-console boundary E2E.
 *
 * Proves the browser-level boundary composition for the Candidate: the
 * AdminLayout console gate redirects any /admin/* URL to the exam runtime
 * before the per-route guard runs, and no privileged admin content renders.
 *
 * Backend denial and anti-enumeration claims for the same surfaces are owned
 * at the API/PostgreSQL layer and are deliberately not duplicated here:
 * routes/permissionBoundary.test.ts (Candidate denial matrices),
 * routes/gradingQueue.test.ts, routes/attempts/candidate-save-submit.test.ts
 * and routes/scores.test.ts (cross-candidate 404 folding).
 *
 * Candidate is a demo-seed account (admin/candidate flow) — no new fixture
 * type is needed.
 */
import { test, expect } from "@playwright/test";
import { seedExam } from "../lib/seed";
import { loginAsCandidate } from "../lib/flow";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

test.describe("P4-C3 Candidate admin-console boundary", () => {
  test("Candidate cannot render admin pages; /admin/* redirects to the exam runtime", async ({
    page,
    request,
  }) => {
    const seededActor = await seedExam(request, "cand-boundary-actor", {
      questionAnswer: true,
      questionScore: 100,
    });

    // ── UI boundary: Candidate is redirected away from any /admin/* URL ──
    // Candidate has no admin-console capability, so AdminLayout's
    // canAccessAdminConsole check redirects to the exam runtime before the
    // per-route guard even runs. No privileged admin content renders.
    await loginAsCandidate(page, seededActor.candidate);
    await expect(page).toHaveURL(/\/exam\/list(?:$|[/?#])/);

    await page.goto(`${BASE_URL}/admin/users`);
    await expect(page).toHaveURL(/\/exam\/list(?:$|[/?#])/);
    await expect(page.getByTestId("admin-layout")).not.toBeVisible();

    await page.goto(`${BASE_URL}/admin/exams`);
    await expect(page).toHaveURL(/\/exam\/list(?:$|[/?#])/);

    await page.goto(`${BASE_URL}/admin/grading-queue`);
    await expect(page).toHaveURL(/\/exam\/list(?:$|[/?#])/);
  });
});
