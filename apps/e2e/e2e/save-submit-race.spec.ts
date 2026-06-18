import { test, expect, type APIRequestContext } from "@playwright/test";
import { seedExam, type SeededExam } from "../lib/seed";
import {
  candidateLogin,
  startExamFromList,
  answerTrueFalse,
  waitForSaveSaved,
  submitExam,
} from "../lib/flow";

// P2A-J6 — save-submit-race
//
// Distinct from submit-flush.spec.ts (which proves the client-side flush
// path). This spec proves the SERVER-side determinism of the save vs submit
// race:
//
//   - Answer is saved and confirmed on the server.
//   - Concurrently with /submit, fire additional /answers requests.
//   - Outcome must be deterministic:
//       * attempt ends up graded (never corrupted / half-saved)
//       * every concurrent save either:
//           (a) is accepted as idempotent, or
//           (b) is rejected with a deterministic conflict reason
//       * the saved answer is reflected in the graded score
//   - A second full submit (idempotent) must not re-grade or alter state.
//
// Racing saves use the current persisted answer version as baseVersion to
// ensure they test save-vs-submit race, not stale-version rejection.

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

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

interface SaveOutcome {
  status: number;
  body: Record<string, unknown>;
}

async function saveAnswer(
  request: APIRequestContext,
  token: string,
  attemptId: string,
  questionId: string,
  clientSeq: number,
  answer: boolean,
  baseVersion: number,
): Promise<SaveOutcome> {
  const res = await request.post(
    `${BASE_URL}/api/attempts/${attemptId}/answers/${questionId}`,
    {
      headers: {
        "Content-Type": "application/json",
        Cookie: `auth-token=${token}`,
      },
      data: {
        attemptId,
        questionId,
        answer,
        clientSeq,
        clientSavedAt: new Date().toISOString(),
        baseVersion,
      },
    },
  );
  const text = await res.text();
  const body = text
    ? ((JSON.parse(text) as Record<string, unknown>) ?? {})
    : {};
  return { status: res.status(), body };
}

async function submitAttempt(
  request: APIRequestContext,
  token: string,
  attemptId: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await request.post(
    `${BASE_URL}/api/attempts/${attemptId}/submit`,
    {
      headers: {
        "Content-Type": "application/json",
        Cookie: `auth-token=${token}`,
      },
    },
  );
  const text = await res.text();
  const body = text
    ? ((JSON.parse(text) as Record<string, unknown>) ?? {})
    : {};
  return { status: res.status(), body };
}

async function fetchAttempt(
  request: APIRequestContext,
  token: string,
  attemptId: string,
): Promise<Record<string, unknown>> {
  const res = await request.get(`${BASE_URL}/api/attempts/${attemptId}`, {
    headers: { Cookie: `auth-token=${token}` },
  });
  if (!res.ok()) {
    throw new Error(
      `GET /api/attempts/${attemptId} failed: ${res.status()} ${await res.text()}`,
    );
  }
  return (await res.json()) as Record<string, unknown>;
}

test.describe("save vs submit race — deterministic outcome", () => {
  test("concurrent saves racing with submit cannot corrupt the attempt", async ({
    browser,
    request,
  }) => {
    const seeded: SeededExam = await seedExam(request, "race-corrupt", {
      questionAnswer: true,
      questionScore: 100,
      durationMinutes: 30,
    });

    // Phase 1 — UI start + answer + save so we have a real saved answer.
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await candidateLogin(page, seeded.candidate);
    await startExamFromList(page, seeded.examId);
    await answerTrueFalse(page, true);
    await waitForSaveSaved(page);
    await page.close();
    await ctx.close();

    const token = await candidateLoginByApi(
      request,
      seeded.candidate.username,
      seeded.candidate.password,
    );

    const examDetail = (await request
      .get(`${BASE_URL}/api/candidate/exams/${seeded.examId}`, {
        headers: { Cookie: `auth-token=${token}` },
      })
      .then((r) => r.json())) as { activeAttemptId?: string };
    const attemptId = examDetail.activeAttemptId;
    if (!attemptId) throw new Error("no activeAttemptId after start");

    // Read the current persisted answer version to use as baseVersion
    // for racing saves — this ensures they test save-vs-submit race,
    // not stale-version rejection.
    const before = await fetchAttempt(request, token, attemptId);
    const currentVersion =
      ((before.answers as Array<Record<string, unknown>>)?.[0]
        ?.version as number) ?? 0;

    // Phase 2 — race: fire 3 saves concurrently with the submit. Saves use
    // the current version as baseVersion.
    const race = await Promise.all([
      submitAttempt(request, token, attemptId),
      saveAnswer(
        request,
        token,
        attemptId,
        seeded.questionId,
        9001,
        false,
        currentVersion,
      ),
      saveAnswer(
        request,
        token,
        attemptId,
        seeded.questionId,
        9002,
        false,
        currentVersion,
      ),
      saveAnswer(
        request,
        token,
        attemptId,
        seeded.questionId,
        9003,
        false,
        currentVersion,
      ),
    ]);

    const [submitResult, ...saveResults] = race;

    // The submit itself must succeed (2xx) and grade.
    expect(submitResult.status).toBeGreaterThanOrEqual(200);
    expect(submitResult.status).toBeLessThan(300);
    expect(submitResult.body.status).toBe("graded");

    // Every racing save either accepted (idempotent) or rejected with a
    // deterministic conflict reason.
    for (const s of saveResults) {
      expect(s.status).toBeGreaterThanOrEqual(200);
      expect(s.status).toBeLessThan(500);
      if (s.status === 200) {
        expect(s.body).toHaveProperty("serverVersion");
      } else {
        const reason = (s.body as { reason?: string }).reason;
        expect([
          "ATTEMPT_ALREADY_SUBMITTED",
          "STALE_VERSION",
          "CONFLICTING_PAYLOAD",
          "DEADLINE_EXCEEDED",
          "ATTEMPT_CLOSED",
        ]).toContain(reason);
      }
    }

    // Phase 3 — re-read the attempt. It must still be graded with the
    // originally saved (correct) answer; no partial writes from the racing
    // saves may have leaked through.
    const finalAttempt = await fetchAttempt(request, token, attemptId);
    expect(finalAttempt.status).toBe("graded");
    expect(finalAttempt.score).toBe(100);
    expect(finalAttempt.passed).toBe(true);
  });

  test("double submit is idempotent — no re-grade, same result", async ({
    browser,
    request,
  }) => {
    const seeded: SeededExam = await seedExam(request, "race-dbl-submit", {
      questionAnswer: true,
      questionScore: 100,
      durationMinutes: 30,
    });

    // UI path: start, answer, save, submit normally.
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await candidateLogin(page, seeded.candidate);
    await startExamFromList(page, seeded.examId);
    await answerTrueFalse(page, true);
    await waitForSaveSaved(page);
    await submitExam(page);
    await expect(page.getByText("已通过")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("result-total-score")).toHaveText("100");
    await page.close();
    await ctx.close();

    const token = await candidateLoginByApi(
      request,
      seeded.candidate.username,
      seeded.candidate.password,
    );

    const summaries = (await request
      .get(`${BASE_URL}/api/candidate/exams`, {
        headers: { Cookie: `auth-token=${token}` },
      })
      .then((r) => r.json())) as Array<{
      examId: string;
      latestAttemptId?: string;
    }>;
    const attemptId = summaries.find(
      (s) => s.examId === seeded.examId,
    )?.latestAttemptId;
    if (!attemptId) throw new Error("no latestAttemptId after submit");

    // Fire two more submits concurrently. Both must be idempotent.
    const [r1, r2] = await Promise.all([
      submitAttempt(request, token, attemptId),
      submitAttempt(request, token, attemptId),
    ]);
    for (const r of [r1, r2]) {
      expect(r.status).toBeGreaterThanOrEqual(200);
      expect(r.status).toBeLessThan(500);
      expect(r.body.status).toBe("graded");
      expect(r.body.score).toBe(100);
      expect(r.body.passed).toBe(true);
    }
  });
});
