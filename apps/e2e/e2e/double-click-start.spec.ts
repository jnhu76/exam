import { test, expect, type APIRequestContext } from "@playwright/test";
import { seedExam, type SeededExam } from "../lib/seed";
import { candidateLogin, clickExamPrimaryAction } from "../lib/flow";

// P2A-J6 — double-click-start (UI layer)
//
// A double-click on the exam start button must not double-fire the start
// action: the candidate lands on the take page and the enrollment holds
// exactly one attempt.
//
// The wire-level atomicity (two parallel start POSTs → one attempt) is owned
// by apps/api/src/routes/attempts/candidate-start.test.ts and is deliberately
// not duplicated here.

const ADMIN_USERNAME = process.env.E2E_ADMIN_USERNAME ?? "admin";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "admin123";
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

async function adminLogin(request: APIRequestContext): Promise<string> {
  const res = await request.post(`${BASE_URL}/api/auth/login`, {
    data: { username: ADMIN_USERNAME, password: ADMIN_PASSWORD },
  });
  if (!res.ok())
    throw new Error(`admin login failed: ${res.status()} ${await res.text()}`);
  const token = res.headers()["set-cookie"]?.match(/auth-token=([^;]+)/)?.[1];
  if (!token) throw new Error("no auth-token cookie");
  return token;
}

async function getEnrollmentAttemptCount(
  request: APIRequestContext,
  adminToken: string,
  examId: string,
  candidateProfileId: string,
): Promise<number> {
  const res = await request.get(`${BASE_URL}/api/exams/${examId}/enrollments`, {
    headers: { Cookie: `auth-token=${adminToken}` },
  });
  if (!res.ok())
    throw new Error(
      `list enrollments failed: ${res.status()} ${await res.text()}`,
    );
  const list = (await res.json()) as Array<{
    candidateId: string;
    attemptCount: number;
  }>;
  const row = list.find((e) => e.candidateId === candidateProfileId);
  if (!row)
    throw new Error(`enrollment for candidate ${candidateProfileId} not found`);
  return row.attemptCount;
}

async function candidateLoginByApi(
  request: APIRequestContext,
  username: string,
  password: string,
): Promise<string> {
  const res = await request.post(`${BASE_URL}/api/auth/login`, {
    data: { username, password },
  });
  if (!res.ok())
    throw new Error(
      `candidate login failed: ${res.status()} ${await res.text()}`,
    );
  const token = res.headers()["set-cookie"]?.match(/auth-token=([^;]+)/)?.[1];
  if (!token) throw new Error("no auth-token cookie");
  return token;
}

test.describe("double-click start — no duplicate attempts (P2A-J1)", () => {
  test("UI double-click on start button does not create a second attempt", async ({
    page,
    request,
  }) => {
    const seeded: SeededExam = await seedExam(request, "dbl-ui", {
      questionAnswer: true,
      questionScore: 100,
      durationMinutes: 30,
    });

    await candidateLogin(page, seeded.candidate);
    await clickExamPrimaryAction(page, seeded.examId, "start");
    await page.waitForURL((url) => /\/exam\/[^/]+\/start$/.test(url.pathname), {
      timeout: 15_000,
    });

    const startBtn = page.getByTestId("exam-start-btn");
    await startBtn.waitFor({ state: "visible" });
    await Promise.all([startBtn.click({ clickCount: 2 })]);

    await page.waitForURL((url) => /\/exam\/[^/]+\/take$/.test(url.pathname), {
      timeout: 15_000,
    });
    await page
      .getByTestId("take-question-section")
      .waitFor({ state: "visible" });

    const candidateToken = await candidateLoginByApi(
      request,
      seeded.candidate.username,
      seeded.candidate.password,
    );
    const adminToken = await adminLogin(request);
    const attemptCount = await getEnrollmentAttemptCount(
      request,
      adminToken,
      seeded.examId,
      seeded.candidate.profileId,
    );
    expect(attemptCount).toBe(1);

    const meRes = await request.get(`${BASE_URL}/api/candidate/exams`, {
      headers: { Cookie: `auth-token=${candidateToken}` },
    });
    expect(meRes.ok()).toBe(true);
  });
});
