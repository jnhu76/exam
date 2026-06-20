import { test, expect, type APIRequestContext } from "@playwright/test";
import { seedExam, type SeededExam } from "../lib/seed";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

async function adminApiToken(request: APIRequestContext): Promise<string> {
  const res = await request.post(`${BASE_URL}/api/auth/login`, {
    data: {
      username: process.env.E2E_ADMIN_USERNAME ?? "admin",
      password: process.env.E2E_ADMIN_PASSWORD ?? "admin123",
    },
  });
  if (!res.ok()) {
    throw new Error(
      `admin API login failed: ${res.status()} ${await res.text()}`,
    );
  }
  const token = res.headers()["set-cookie"]?.match(/auth-token=([^;]+)/)?.[1];
  if (!token) throw new Error("admin API login returned no auth-token cookie");
  return token;
}

async function candidateApiLogin(
  request: APIRequestContext,
  username: string,
  password: string,
): Promise<string> {
  const res = await request.post(`${BASE_URL}/api/auth/login`, {
    data: { username, password },
  });
  if (!res.ok()) {
    throw new Error(
      `candidate API login failed: ${res.status()} ${await res.text()}`,
    );
  }
  const token = res.headers()["set-cookie"]?.match(/auth-token=([^;]+)/)?.[1];
  if (!token) throw new Error("candidate API login returned no auth-token");
  return token;
}

async function adminPost(
  request: APIRequestContext,
  token: string,
  path: string,
  data?: unknown,
) {
  const res = await request.post(`${BASE_URL}${path}`, {
    headers: { Cookie: `auth-token=${token}` },
    data: data ?? {},
  });
  return res;
}

async function adminGet(
  request: APIRequestContext,
  token: string,
  path: string,
) {
  const res = await request.get(`${BASE_URL}${path}`, {
    headers: { Cookie: `auth-token=${token}` },
  });
  return res;
}

async function candidateStartAttempt(
  request: APIRequestContext,
  candidateToken: string,
  examId: string,
): Promise<string> {
  const res = await request.post(`${BASE_URL}/api/attempts/${examId}/start`, {
    headers: { Cookie: `auth-token=${candidateToken}` },
  });
  if (!res.ok()) {
    throw new Error(
      `candidate start attempt failed: ${res.status()} ${await res.text()}`,
    );
  }
  return ((await res.json()) as { id: string }).id;
}

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
    candidateToken = await candidateApiLogin(
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

  test("admin extends time on a new in_progress attempt", async ({
    request,
  }) => {
    const exam2 = await seedExam(request, `j8-ext-${Date.now()}`);
    const candToken = await candidateApiLogin(
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
    const beforeBody = await beforeRes.json();
    const beforeDeadline = new Date(
      beforeBody.candidates[0].deadlineAt,
    ).getTime();

    const res = await adminPost(
      request,
      adminToken,
      `/api/admin/attempts/${newAttemptId}/extend-time`,
      { additionalMinutes: 15 },
    );
    expect(res.status()).toBe(200);

    const afterRes = await adminGet(
      request,
      adminToken,
      `/api/admin/exams/${exam2.examId}/candidates/status`,
    );
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
    const candToken = await candidateApiLogin(
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
    const statusBody = await statusRes.json();
    expect(statusBody.candidates[0].misconduct).toBeTruthy();
    expect(statusBody.candidates[0].misconduct.severity).toBe("serious");
    expect(statusBody.candidates[0].misconduct.notes).toBe(
      "E2E misconduct flag test",
    );
  });

  test("non-admin cannot access candidate status", async ({ request }) => {
    const res = await request.get(
      `${BASE_URL}/api/admin/exams/${seeded.examId}/candidates/status`,
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
