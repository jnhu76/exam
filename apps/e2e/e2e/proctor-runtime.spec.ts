import { test, expect } from "@playwright/test";
import { seedExam, type SeededExam } from "../lib/seed";
import {
  adminApiToken,
  candidateLoginApi,
  candidateStartAttempt,
  adminPost,
  adminGet,
} from "../lib/flow";

/**
 * P2C-J8 — Proctor Runtime E2E.
 *
 * Validates the proctor runtime flows end-to-end via API-level tests:
 * 1. Candidate status polling endpoint returns live status.
 * 2. Force-submit transitions an in_progress attempt to graded.
 * 3. Extend-time updates the attempt deadline.
 * 4. Misconduct flag persists on the attempt and shows in status response.
 *
 * Uses seedExam() to create a fully-published exam + enrolled candidate,
 * then drives the candidate API to start an attempt and the admin API to
 * perform proctor actions. No production code is modified.
 */
test.describe("Proctor Runtime E2E", () => {
  test.describe.configure({ mode: "serial" });

  let seeded: SeededExam;
  let adminToken: string;
  let candidateToken: string;
  let attemptId: string;

  test.beforeAll(async ({ request }) => {
    const unique = `j8-${Date.now()}`;
    seeded = await seedExam(request, unique);

    adminToken = await adminApiToken(request);
    candidateToken = await candidateLoginApi(
      request,
      seeded.candidate.username,
      seeded.candidate.password,
    );
    attemptId = await candidateStartAttempt(
      request,
      candidateToken,
      seeded.examId,
    );
  });

  test("admin sees candidate status as in_progress on the polling endpoint", async ({
    request,
  }) => {
    const res = await adminGet(
      request,
      adminToken,
      `/api/admin/exams/${seeded.examId}/candidates/status`,
    );
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(1);
    expect(body.candidates[0].status).toBe("in_progress");
    expect(body.candidates[0].attemptId).toBe(attemptId);
    expect(body.candidates[0].deadlineAt).toBeTruthy();
  });

  test("admin force-submits the in_progress attempt", async ({ request }) => {
    const res = await adminPost(
      request,
      adminToken,
      `/api/admin/attempts/${attemptId}/force-submit`,
      { reason: "E2E force-submit test" },
    );
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("graded");
  });

  test("status reflects graded after force-submit", async ({ request }) => {
    const res = await adminGet(
      request,
      adminToken,
      `/api/admin/exams/${seeded.examId}/candidates/status`,
    );
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.candidates[0].status).toBe("graded");
  });

  test("admin grants operator time on a new in_progress attempt", async ({
    request,
  }) => {
    // Operator time-grant requires the exam to freeze an operator_incident
    // policy snapshot onto started attempts.
    const exam2 = await seedExam(request, `j8-grant-${Date.now()}`, {
      interruptionTimePolicy: "operator_incident",
    });
    const candToken = await candidateLoginApi(
      request,
      exam2.candidate.username,
      exam2.candidate.password,
    );
    const newAttemptId = await candidateStartAttempt(
      request,
      candToken,
      exam2.examId,
    );

    const beforeRes = await adminGet(
      request,
      adminToken,
      `/api/admin/exams/${exam2.examId}/candidates/status`,
    );
    expect(beforeRes.status()).toBe(200);
    const beforeBody = await beforeRes.json();
    const beforeDeadline = new Date(
      beforeBody.candidates[0].deadlineAt,
    ).getTime();

    const operationId = crypto.randomUUID();
    const res = await adminPost(
      request,
      adminToken,
      `/api/admin/attempts/${newAttemptId}/time-grants`,
      {
        operationId,
        addedSeconds: 15 * 60,
        reasonCode: "technical_incident",
        reasonText: "E2E operator time grant",
      },
    );
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.outcome).toBe("granted");
    expect(body.adjustment?.operationId).toBe(operationId);
    expect(body.adjustment?.addedSeconds).toBe(15 * 60);
    expect(body.adjustment?.source).toBe("operator");

    const afterRes = await adminGet(
      request,
      adminToken,
      `/api/admin/exams/${exam2.examId}/candidates/status`,
    );
    expect(afterRes.status()).toBe(200);
    const afterBody = await afterRes.json();
    const afterDeadline = new Date(
      afterBody.candidates[0].deadlineAt,
    ).getTime();

    expect(afterDeadline).toBe(beforeDeadline + 15 * 60_000);
  });

  test("admin flags misconduct on an in_progress attempt", async ({
    request,
  }) => {
    const exam3 = await seedExam(request, `j8-mis-${Date.now()}`);
    const candToken = await candidateLoginApi(
      request,
      exam3.candidate.username,
      exam3.candidate.password,
    );
    const misAttemptId = await candidateStartAttempt(
      request,
      candToken,
      exam3.examId,
    );

    const res = await adminPost(
      request,
      adminToken,
      `/api/admin/attempts/${misAttemptId}/misconduct`,
      { severity: "serious", notes: "E2E misconduct flag test" },
    );
    expect(res.status()).toBe(200);
    expect((await res.json()).ok).toBe(true);

    const statusRes = await adminGet(
      request,
      adminToken,
      `/api/admin/exams/${exam3.examId}/candidates/status`,
    );
    expect(statusRes.status()).toBe(200);
    const statusBody = await statusRes.json();
    expect(statusBody.candidates[0].misconduct).toBeTruthy();
    expect(statusBody.candidates[0].misconduct.severity).toBe("serious");
    expect(statusBody.candidates[0].misconduct.notes).toBe(
      "E2E misconduct flag test",
    );
  });

  test("non-admin cannot access candidate status", async ({ request }) => {
    const res = await request.get(
      `${process.env.E2E_BASE_URL ?? "http://localhost:3000"}/api/admin/exams/${seeded.examId}/candidates/status`,
      { headers: { Cookie: `auth-token=${candidateToken}` } },
    );
    expect(res.status()).toBe(403);
  });

  test("candidate status returns 404 for non-existent exam", async ({
    request,
  }) => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const res = await adminGet(
      request,
      adminToken,
      `/api/admin/exams/${fakeId}/candidates/status`,
    );
    expect(res.status()).toBe(404);
  });
});
