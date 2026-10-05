import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { buildTestApp, uniquePrefix } from "../testHelpers.js";
import examRoutes from "../exam.js";
import attemptRoutes from "../attempts.js";
import { schema } from "@exam/db/src/schema/pg.js";
import { plainTextProjection } from "@exam/domain";
import {
  buildExamPayload,
  enrollCandidateForExam,
  ensureCandidateProfile,
} from "./__tests__/attempts.testHelpers.js";
import type { ContentDocumentV1 } from "@exam/domain";

/**
 * The attempt export trust boundary for persisted Rich (#669)
 * answers (F-05): a corrupt or unsupported persisted Rich value must keep its
 * raw evidence in the JSON export but must never be exported as if it were a
 * valid semantic Plain answer (rich-content-semantic-contract §7/§14).
 *
 * These regressions exercise the REAL export seam (both routes through the
 * frozen attempt snapshot), not only the shared classifier.
 */
describe("attempt export — Rich answer integrity (D4 / F-05)", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;
  let courseId: string;
  let candidateProfileId: string;

  const RICH_PROMPT = "Rich prompt";
  const PLAIN_PROMPT = "Plain prompt";
  const CHOICE_PROMPT = "Choice prompt";

  const RICH_QUESTION_ID = crypto.randomUUID();
  const PLAIN_QUESTION_ID = crypto.randomUUID();
  const CHOICE_QUESTION_ID = crypto.randomUUID();

  /** Canonical rich answer (matches the write seam's canonical output). */
  const RICH_DOC: ContentDocumentV1 = {
    docVersion: 1,
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: "canonical answer" }],
      },
    ],
  };

  /** Schema-valid but noncanonical: unsorted marks, split same-mark runs. */
  const NONCANONICAL_DOC: ContentDocumentV1 = {
    docVersion: 1,
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "答", marks: ["italic", "bold"] },
          { type: "text", text: "案", marks: ["italic", "bold"] },
        ],
      },
    ],
  };

  const UNSUPPORTED_DOC = {
    docVersion: 2,
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "v2" }] }],
  };

  const CORRUPT_ENVELOPE = {
    docVersion: 1,
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "mysteryInline", text: "x" }] },
    ],
  };

  const LEGACY_LOOKING_STRING = "looks like legacy text";

  /** The not-applicable marker used where no semantic projection is permitted. */
  const NOT_APPLICABLE_CELL = "—";

  beforeAll(async () => {
    ctx = await buildTestApp(async (fastify) => {
      await fastify.register(examRoutes, { prefix: "" });
      await fastify.register(attemptRoutes, { prefix: "" });
    });

    courseId = crypto.randomUUID();
    const now = new Date();
    await ctx.db.insert(schema.courses).values({
      id: courseId,
      organizationId: ctx.org.id,
      name: "Rich Export Course",
      code: `RE-${uniquePrefix()}`,
      description: "",
      createdAt: now,
      updatedAt: now,
    });

    // Rich text_response: prompt content equals the document projection so
    // the publish freeze gate accepts the row.
    await ctx.db.insert(schema.questions).values({
      id: RICH_QUESTION_ID,
      organizationId: ctx.org.id,
      courseId,
      type: "text_response",
      content: RICH_PROMPT,
      contentDocument: {
        docVersion: 1,
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: RICH_PROMPT }] },
        ],
      },
      answerMode: "rich",
      rubric: "按要点给分",
      options: [],
      standardAnswer: null,
      attachments: [],
      score: 50,
      difficulty: 1,
      tags: [],
      gradingRule: {
        multiSelectScoring: "all_correct_full",
        fillBlankMatchMode: "exact",
      },
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert(schema.questions).values({
      id: PLAIN_QUESTION_ID,
      organizationId: ctx.org.id,
      courseId,
      type: "text_response",
      content: PLAIN_PROMPT,
      contentDocument: null,
      answerMode: "plain",
      rubric: "按要点给分",
      options: [],
      standardAnswer: "reference answer",
      attachments: [],
      score: 30,
      difficulty: 1,
      tags: [],
      gradingRule: {
        multiSelectScoring: "all_correct_full",
        fillBlankMatchMode: "exact",
      },
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert(schema.questions).values({
      id: CHOICE_QUESTION_ID,
      organizationId: ctx.org.id,
      courseId,
      type: "multiple_choice",
      content: CHOICE_PROMPT,
      contentDocument: null,
      answerMode: null,
      rubric: null,
      options: [
        { id: "a", content: "Alpha" },
        { id: "b", content: "Beta" },
      ],
      standardAnswer: ["a"],
      attachments: [],
      score: 20,
      difficulty: 1,
      tags: [],
      gradingRule: {
        multiSelectScoring: "all_correct_full",
        fillBlankMatchMode: "exact",
      },
      createdAt: now,
      updatedAt: now,
    });

    candidateProfileId = await ensureCandidateProfile(ctx);
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  /**
   * Publishes a fresh exam over the shared questions and starts a fresh
   * attempt, asserting the frozen rich slot mode is preserved. A new exam per
   * test keeps each attempt's draft state isolated (the start endpoint
   * resumes an existing active attempt instead of creating a second one).
   */
  async function startFrozenAttempt(): Promise<string> {
    const examRes = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: buildExamPayload({
        title: `Rich Export Exam ${uniquePrefix()}`,
        courseId,
        questionIds: [RICH_QUESTION_ID, PLAIN_QUESTION_ID, CHOICE_QUESTION_ID],
        totalScore: 100,
        passingScore: 60,
        maxAttempts: 5,
      }),
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(examRes.statusCode, examRes.body).toBe(201);
    const freshExamId = examRes.json().id as string;

    const publishRes = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${freshExamId}/publish`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(publishRes.statusCode, publishRes.body).toBe(200);

    await enrollCandidateForExam(ctx, candidateProfileId, freshExamId);

    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${freshExamId}/start`,
      cookies: { "auth-token": ctx.candidateToken },
    });
    expect(res.statusCode, res.body).toBe(201);
    const snapshot = res.json().questionSnapshot as Array<{
      originalQuestionId: string;
      answerMode: string | null;
    }>;
    const rich = snapshot.find(
      (q) => q.originalQuestionId === RICH_QUESTION_ID,
    );
    expect(rich?.answerMode).toBe("rich");
    return res.json().id as string;
  }

  /** Saves an answer through the real candidate protocol. */
  async function saveAnswer(
    attemptId: string,
    questionId: string,
    answer: unknown,
  ): Promise<void> {
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${attemptId}/answers/${questionId}`,
      payload: {
        attemptId,
        questionId,
        answer,
        clientSeq: 1,
        clientSavedAt: new Date().toISOString(),
        baseVersion: 0,
      },
      cookies: { "auth-token": ctx.candidateToken },
    });
    expect(res.statusCode, res.body).toBe(200);
  }

  /**
   * Corrupts one draft answer row directly (bypassing the write seam, which
   * rejects these shapes) — the same fabrication the audit used to prove the
   * F-05 counterexample against persisted historical data.
   */
  async function tamperDraftAnswer(
    attemptId: string,
    questionId: string,
    answer: unknown,
  ): Promise<void> {
    const rows = await ctx.db
      .select({ answers: schema.examAttempts.answers })
      .from(schema.examAttempts)
      .where(eq(schema.examAttempts.id, attemptId));
    const answers = rows[0]!.answers as Array<{
      questionId: string;
      answer: unknown;
      version: number;
      savedAt: Date;
    }>;
    expect(answers.some((a) => a.questionId === questionId)).toBe(true);
    const next = answers.map((a) =>
      a.questionId === questionId ? { ...a, answer } : a,
    );
    await ctx.db
      .update(schema.examAttempts)
      .set({ answers: next, updatedAt: new Date() })
      .where(eq(schema.examAttempts.id, attemptId));
  }

  /** Reads the persisted draft value back (read-only proof for R5). */
  async function readDraftAnswer(
    attemptId: string,
    questionId: string,
  ): Promise<unknown> {
    const rows = await ctx.db
      .select({ answers: schema.examAttempts.answers })
      .from(schema.examAttempts)
      .where(eq(schema.examAttempts.id, attemptId));
    const answers = rows[0]!.answers as Array<{
      questionId: string;
      answer: unknown;
    }>;
    return answers.find((a) => a.questionId === questionId)?.answer;
  }

  async function exportJson(attemptId: string): Promise<{
    questionResults: Array<Record<string, unknown> & { content: string }>;
  }> {
    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/admin/attempts/${attemptId}/export`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode, res.body).toBe(200);
    return res.json();
  }

  async function exportCsv(attemptId: string): Promise<{
    raw: string;
    rows: Array<Record<string, string>>;
  }> {
    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/admin/attempts/${attemptId}/export/csv`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = String(res.body).replace(/^\uFEFF/, "");
    const lines = body.trimEnd().split("\n");
    const headers = lines[0]!.split(",");
    const rows = lines.slice(1).map((line) => {
      const cells = line.split(",");
      const row: Record<string, string> = {};
      headers.forEach((header, index) => {
        row[header!] = cells[index] ?? "";
      });
      return row;
    });
    return { raw: body, rows };
  }

  /** Fixture question results are comma-free, so content identifies a row. */
  function resultFor(
    data: {
      questionResults: Array<Record<string, unknown> & { content: string }>;
    },
    content: string,
  ): Record<string, unknown> {
    const result = data.questionResults.find((q) => q.content === content);
    expect(result, `question result for "${content}"`).toBeDefined();
    return result!;
  }

  function csvRowFor(
    csv: { rows: Array<Record<string, string>> },
    content: string,
  ): Record<string, string> {
    const row = csv.rows.find((r) => r["题目内容"] === content);
    expect(row, `CSV row for "${content}"`).toBeDefined();
    return row!;
  }

  it("empty: an absent answer exports as empty with no projection", async () => {
    const attemptId = await startFrozenAttempt();

    const data = await exportJson(attemptId);
    const rich = resultFor(data, RICH_PROMPT);
    expect(rich.candidateAnswer).toBeNull();
    expect(rich.candidateAnswerMode).toBe("rich");
    expect(rich.candidateAnswerIntegrity).toBe("empty");
    expect(rich.candidateAnswerProjection).toBeNull();

    const csv = await exportCsv(attemptId);
    const row = csvRowFor(csv, RICH_PROMPT);
    expect(row["考生答案"]).toBe("");
    expect(row["考生答案状态"]).toBe("empty");
  });

  it("R1/F-05: a string in a frozen rich slot never exports as normal Plain answer text", async () => {
    const attemptId = await startFrozenAttempt();
    await saveAnswer(attemptId, RICH_QUESTION_ID, RICH_DOC);
    await tamperDraftAnswer(attemptId, RICH_QUESTION_ID, LEGACY_LOOKING_STRING);

    const data = await exportJson(attemptId);
    const rich = resultFor(data, RICH_PROMPT);
    // Raw evidence preserved for the audit trail...
    expect(rich.candidateAnswer).toBe(LEGACY_LOOKING_STRING);
    // ...but classified corrupt (no legacy provenance), never plain.
    expect(rich.candidateAnswerMode).toBe("rich");
    expect(rich.candidateAnswerIntegrity).toBe("corrupt");
    expect(rich.candidateAnswerProjection).toBeNull();

    const csv = await exportCsv(attemptId);
    expect(csv.raw).not.toContain(LEGACY_LOOKING_STRING);
    const row = csvRowFor(csv, RICH_PROMPT);
    expect(row["考生答案"]).toBe(NOT_APPLICABLE_CELL);
    expect(row["考生答案模式"]).toBe("rich");
    expect(row["考生答案状态"]).toBe("corrupt");
  });

  it("R2: plain and typed objective answers still export normally", async () => {
    const attemptId = await startFrozenAttempt();
    await saveAnswer(attemptId, PLAIN_QUESTION_ID, "hello");
    await saveAnswer(attemptId, CHOICE_QUESTION_ID, ["a", "b"]);

    const data = await exportJson(attemptId);
    const plain = resultFor(data, PLAIN_PROMPT);
    expect(plain.candidateAnswer).toBe("hello");
    expect(plain.candidateAnswerMode).toBe("plain");
    expect(plain.candidateAnswerIntegrity).toBe("plain");
    expect(plain.candidateAnswerProjection).toBe("hello");

    const choice = resultFor(data, CHOICE_PROMPT);
    expect(choice.candidateAnswer).toEqual(["a", "b"]);
    expect(choice.candidateAnswerMode).toBe("plain");
    expect(choice.candidateAnswerIntegrity).toBe("plain");
    expect(choice.candidateAnswerProjection).toBe("a; b");

    const csv = await exportCsv(attemptId);
    expect(csvRowFor(csv, PLAIN_PROMPT)["考生答案"]).toBe("hello");
    expect(csvRowFor(csv, CHOICE_PROMPT)["考生答案"]).toBe("a; b");
  });

  it("R4: canonical Rich preserves raw evidence and labels its derived projection", async () => {
    const attemptId = await startFrozenAttempt();
    await saveAnswer(attemptId, RICH_QUESTION_ID, RICH_DOC);

    const data = await exportJson(attemptId);
    const rich = resultFor(data, RICH_PROMPT);
    expect(rich.candidateAnswer).toEqual(RICH_DOC);
    expect(rich.candidateAnswerMode).toBe("rich");
    expect(rich.candidateAnswerIntegrity).toBe("rich_valid");
    expect(rich.candidateAnswerProjection).toBe(plainTextProjection(RICH_DOC));

    const csv = await exportCsv(attemptId);
    const row = csvRowFor(csv, RICH_PROMPT);
    expect(row["考生答案"]).toBe("canonical answer");
    expect(row["考生答案状态"]).toBe("rich_valid");
  });

  it("R5: historical noncanonical Rich stays identifiable, is projected, and is never repaired", async () => {
    const attemptId = await startFrozenAttempt();
    await saveAnswer(attemptId, RICH_QUESTION_ID, RICH_DOC);
    await tamperDraftAnswer(attemptId, RICH_QUESTION_ID, NONCANONICAL_DOC);

    const data = await exportJson(attemptId);
    const rich = resultFor(data, RICH_PROMPT);
    expect(rich.candidateAnswer).toEqual(NONCANONICAL_DOC);
    expect(rich.candidateAnswerIntegrity).toBe("rich_noncanonical");
    expect(rich.candidateAnswerProjection).toBe("答案");

    const csv = await exportCsv(attemptId);
    const row = csvRowFor(csv, RICH_PROMPT);
    expect(row["考生答案"]).toBe("答案");
    expect(row["考生答案状态"]).toBe("rich_noncanonical");

    // Read-only export: the persisted value is returned as-is, unrepaired.
    expect(await readDraftAnswer(attemptId, RICH_QUESTION_ID)).toEqual(
      NONCANONICAL_DOC,
    );
  });

  it("R6: unsupported docVersion preserves raw evidence but fabricates no Plain projection", async () => {
    const attemptId = await startFrozenAttempt();
    await saveAnswer(attemptId, RICH_QUESTION_ID, RICH_DOC);
    await tamperDraftAnswer(attemptId, RICH_QUESTION_ID, UNSUPPORTED_DOC);

    const data = await exportJson(attemptId);
    const rich = resultFor(data, RICH_PROMPT);
    expect(rich.candidateAnswer).toEqual(UNSUPPORTED_DOC);
    expect(rich.candidateAnswerIntegrity).toBe("unsupported_version");
    expect(rich.candidateAnswerProjection).toBeNull();

    const csv = await exportCsv(attemptId);
    expect(csv.raw).not.toContain("docVersion");
    const row = csvRowFor(csv, RICH_PROMPT);
    expect(row["考生答案"]).toBe(NOT_APPLICABLE_CELL);
    expect(row["考生答案模式"]).toBe("rich");
    expect(row["考生答案状态"]).toBe("unsupported_version");
  });

  it("R7: a malformed Rich envelope exports as corrupt without a Plain projection", async () => {
    const attemptId = await startFrozenAttempt();
    await saveAnswer(attemptId, RICH_QUESTION_ID, RICH_DOC);
    await tamperDraftAnswer(attemptId, RICH_QUESTION_ID, CORRUPT_ENVELOPE);

    const data = await exportJson(attemptId);
    const rich = resultFor(data, RICH_PROMPT);
    expect(rich.candidateAnswer).toEqual(CORRUPT_ENVELOPE);
    expect(rich.candidateAnswerIntegrity).toBe("corrupt");
    expect(rich.candidateAnswerProjection).toBeNull();

    const csv = await exportCsv(attemptId);
    expect(csv.raw).not.toContain("mysteryInline");
    const row = csvRowFor(csv, RICH_PROMPT);
    expect(row["考生答案"]).toBe(NOT_APPLICABLE_CELL);
    expect(row["考生答案状态"]).toBe("corrupt");
  });

  it("D4-G: export classifies with the frozen snapshot mode, not the live question row", async () => {
    const attemptId = await startFrozenAttempt();
    await saveAnswer(attemptId, RICH_QUESTION_ID, RICH_DOC);
    await tamperDraftAnswer(attemptId, RICH_QUESTION_ID, LEGACY_LOOKING_STRING);

    // Mutate the LIVE question row after the attempt froze: an implementation
    // consulting live question state would classify the string as plain and
    // export it as normal answer text.
    try {
      await ctx.db
        .update(schema.questions)
        .set({ answerMode: "plain" })
        .where(eq(schema.questions.id, RICH_QUESTION_ID));

      const data = await exportJson(attemptId);
      const rich = resultFor(data, RICH_PROMPT);
      expect(rich.candidateAnswerMode).toBe("rich");
      expect(rich.candidateAnswerIntegrity).toBe("corrupt");
      expect(rich.candidateAnswerProjection).toBeNull();
    } finally {
      await ctx.db
        .update(schema.questions)
        .set({ answerMode: "rich" })
        .where(eq(schema.questions.id, RICH_QUESTION_ID));
    }
  });
});
