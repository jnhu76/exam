/**
 * P4-C3 — Candidate admin-console boundary E2E.
 *
 * Proves the Candidate cannot reach admin-console pages or management APIs, and
 * that cross-candidate anti-enumeration holds (404, not 403). P4-G-03.
 *
 * Candidate is a demo-seed account (admin/candidate flow) — no new fixture
 * type is needed. We use the seeded candidate from seedExam and a second
 * seeded candidate as the anti-enumeration probe target.
 *
 * Per task §6.5: one browser/API boundary proof is sufficient when detailed API
 * ownership tests already exist (candidateOwnership.test.ts etc.). This spec
 * covers the representative assertions, not exhaustive duplication.
 */
import { test, expect } from "@playwright/test";
import { seedExam } from "../lib/seed";
import {
  loginAsCandidate,
  candidateApiToken,
  candidateStartAttempt,
} from "../lib/flow";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

test.describe("P4-C3 Candidate admin-console boundary", () => {
  test("Candidate cannot render admin pages or call management APIs; cross-candidate probes 404", async ({
    page,
    request,
  }) => {
    // Two distinct candidates: the actor + a second seeded candidate whose
    // attempt/score the actor must NOT be able to read (anti-enumeration).
    const seededActor = await seedExam(request, "cand-boundary-actor", {
      questionAnswer: true,
      questionScore: 100,
    });
    const seededOther = await seedExam(request, "cand-boundary-other", {
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

    // ── API boundary: Candidate denied on management APIs (403) ──
    const token = await candidateApiToken(request, seededActor.candidate);

    const usersRes = await request.get(`${BASE_URL}/api/users`, {
      headers: { Cookie: `auth-token=${token}` },
    });
    expect(usersRes.status(), "GET /api/users as Candidate").toBe(403);

    const examsAdminRes = await request.get(`${BASE_URL}/api/exams`, {
      headers: { Cookie: `auth-token=${token}` },
    });
    expect(examsAdminRes.status(), "GET /api/exams as Candidate").toBe(403);

    const gradingRes = await request.get(
      `${BASE_URL}/api/admin/grading-queue`,
      {
        headers: { Cookie: `auth-token=${token}` },
      },
    );
    expect(
      gradingRes.status(),
      "GET /api/admin/grading-queue as Candidate",
    ).toBe(403);

    // ── Anti-enumeration: cross-candidate attempt/score probe → 404 ──
    // Start the OTHER candidate's attempt (so a real attempt exists), then
    // prove the ACTOR candidate cannot read it. A 404 (not 403) preserves
    // anti-enumeration: the actor cannot tell whether the attempt exists.
    const otherToken = await candidateApiToken(request, seededOther.candidate);
    const otherAttemptId = await candidateStartAttempt(
      request,
      otherToken,
      seededOther.examId,
    );

    const probeAttemptRes = await request.get(
      `${BASE_URL}/api/attempts/${otherAttemptId}`,
      { headers: { Cookie: `auth-token=${token}` } },
    );
    expect(
      probeAttemptRes.status(),
      "GET another candidate's attempt as Candidate (anti-enumeration)",
    ).toBe(404);

    const probeScoreRes = await request.get(
      `${BASE_URL}/api/scores/attempts/${otherAttemptId}`,
      { headers: { Cookie: `auth-token=${token}` } },
    );
    expect(
      probeScoreRes.status(),
      "GET another candidate's score as Candidate (anti-enumeration)",
    ).toBe(404);
  });
});
