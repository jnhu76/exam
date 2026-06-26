import { test, expect } from "@playwright/test";
import {
  adminApiToken,
  adminPost,
  candidateLoginApi,
  candidateStartAttempt,
  adminGet,
} from "../lib/flow";
import { seedExam } from "../lib/seed";

test.describe("multi_select question E2E", () => {
  test("candidate selects multiple options → save → submit → graded result", async ({
    request,
  }) => {
    const seeded = await seedExam(request, "multisel", {
      questionScore: 100,
    });
    const adminToken = await adminApiToken(request);
    const candidateToken = await candidateLoginApi(
      request,
      seeded.candidate.username,
      seeded.candidate.password,
    );

    const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

    const mcRes = await request.post(`${BASE_URL}/api/questions`, {
      headers: { Cookie: `auth-token=${adminToken}` },
      data: {
        courseId: seeded.courseId,
        type: "multiple_choice",
        content: "Select the even numbers",
        options: [
          { id: "a", content: "1" },
          { id: "b", content: "2" },
          { id: "c", content: "3" },
          { id: "d", content: "4" },
        ],
        standardAnswer: ["b", "d"],
        score: 100,
        difficulty: 1,
        tags: [],
        gradingRule: {
          multiSelectScoring: "all_correct_full",
          fillBlankMatchMode: "exact",
        },
      },
    });
    expect(mcRes.ok()).toBeTruthy();
    const mcQuestionId = (await mcRes.json()).id;

    const examRes = await request.post(`${BASE_URL}/api/exams`, {
      headers: { Cookie: `auth-token=${adminToken}` },
      data: {
        title: `MC E2E ${Date.now()}`,
        description: "",
        courseId: seeded.courseId,
        timingMode: "timed_window",
        durationMinutes: 60,
        openAt: new Date(Date.now() - 3600_000).toISOString(),
        closeAt: new Date(Date.now() + 86400_000).toISOString(),
        passingScore: 60,
        totalScore: 100,
        questionSelectionMode: "manual",
        questionIds: [mcQuestionId],
        resultPublicationMode: "immediate",
        controlFlags: {
          shuffleQuestions: false,
          shuffleOptions: false,
          detectTabSwitch: false,
          disableCopyPaste: false,
          showResultImmediately: true,
        },
        retakePolicy: "unlimited",
        scoreStrategy: "highest",
        maxAttempts: 1,
      },
    });
    expect(examRes.ok()).toBeTruthy();
    const examId = (await examRes.json()).id;

    await request.post(`${BASE_URL}/api/exams/${examId}/publish`, {
      headers: { Cookie: `auth-token=${adminToken}` },
    });

    await request.post(`${BASE_URL}/api/exams/${examId}/enrollments`, {
      headers: { Cookie: `auth-token=${adminToken}` },
      data: { candidateIds: [seeded.candidateIds[0]] },
    });

    const startRes = await request.post(
      `${BASE_URL}/api/attempts/${examId}/start`,
      { headers: { Cookie: `auth-token=${candidateToken}` } },
    );
    expect(startRes.ok()).toBeTruthy();
    const attemptId = (await startRes.json()).id;

    const saveRes = await request.post(
      `${BASE_URL}/api/attempts/${attemptId}/answers/${mcQuestionId}`,
      {
        headers: { Cookie: `auth-token=${candidateToken}` },
        data: {
          attemptId,
          questionId: mcQuestionId,
          answer: ["b", "d"],
          clientSeq: 1,
          clientSavedAt: new Date().toISOString(),
          baseVersion: 0,
        },
      },
    );
    expect(saveRes.ok()).toBeTruthy();
    expect((await saveRes.json()).accepted).toBe(true);

    const submitRes = await request.post(
      `${BASE_URL}/api/attempts/${attemptId}/submit`,
      { headers: { Cookie: `auth-token=${candidateToken}` } },
    );
    expect(submitRes.ok()).toBeTruthy();
    const submitBody = await submitRes.json();
    expect(submitBody.status).toBe("graded");
    expect(submitBody.score).toBe(100);
    expect(submitBody.passed).toBe(true);
  });
});
