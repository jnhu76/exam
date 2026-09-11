/**
 * issue 292 — durable admission queue: representative browser E2E.
 *
 * Deterministic by construction: one candidate joins via API and HOLDS the
 * head slot without starting (no consumption cascade), so the two UI flows
 * below see stable waiting truth:
 *
 *   - The UI candidate (position 2): the durable waiting panel renders, and
 *     the batch schedule (interval=30s) admits them within one poll cycle —
 *     the client auto-enters the take page.
 *
 * This exercises the real candidate surface end to end: join, durable
 * waiting truth, server-side admission by frozen batch policy, auto start.
 */
import { test, expect } from "@playwright/test";
import { seedExam, type SeededCandidate } from "../lib/seed";
import { loginAsCandidate, candidateApiToken } from "../lib/flow";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

test.describe("durable admission queue (issue 292)", () => {
  // The 30s batch interval plus login/setup needs more than the 30s default.
  test.setTimeout(120_000);

  test("waiting panel renders durable truth; batch schedule admits and auto-enters", async ({
    browser,
    request,
  }) => {
    const seeded = await seedExam(request, "queue-admission", {
      questionAnswer: true,
      questionScore: 100,
      requireQueue: { batchSize: 1, batchInterval: 30 },
      additionalCandidates: 1,
    });
    const uiA: SeededCandidate = seeded.candidate;
    const holder: SeededCandidate = seeded.extraCandidates[0]!;

    const ctxA = await browser.newContext();
    const pageA = await ctxA.newPage();

    // Login + page load BEFORE the holder join so the UI click lands well
    // inside the first 30s interval.
    await loginAsCandidate(pageA, uiA);
    await pageA.goto(`${BASE_URL}/exam/${seeded.examId}/start`);

    // The holder pins position 1 via the API and never starts — eligibility
    // for later batches is driven purely by the frozen interval.
    const holderToken = await candidateApiToken(request, holder);
    const joinRes = await request.post(
      `${BASE_URL}/api/attempts/${seeded.examId}/queue`,
      { headers: { Cookie: `auth-token=${holderToken}` } },
    );
    expect(joinRes.status()).toBe(200);
    const joinBody = (await joinRes.json()) as {
      status: string;
      position: number;
    };
    expect(joinBody).toMatchObject({ status: "ready", position: 1 });

    // Candidate A: durable waiting panel renders (position 2, behind the
    // holder), then the batch schedule admits and the client auto-enters.
    await pageA.getByTestId("exam-start-btn").click();
    await expect(pageA.getByTestId("exam-queue-panel")).toBeVisible({
      timeout: 10_000,
    });
    await expect(pageA).toHaveURL(/\/exam\/[^/]+\/take/, { timeout: 60_000 });

    await ctxA.close();
  });
});
