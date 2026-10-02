/**
 * Phase-C Campaigns H / I / J (#669) — submit freeze parity, corrupt-value
 * behavior, and export semantics (L3/L4, real PostgreSQL + real routes).
 *
 * H (freeze parity, contract §8/§9): the last accepted canonical draft ==
 * the submitted frozen value == the grading workset candidateAnswer. The
 * value must not be renormalized, repaired, upgraded, or reinterpreted from
 * live question-bank state anywhere along the chain.
 *
 * I (corrupt persisted values, contract §7): corrupt values injected via
 * controlled repository setup must surface as a visible/typed integrity
 * condition on read seams — never silently become empty, never silently
 * repaired, never block the protocol seams.
 *
 * J (export, contract §14): raw evidence stays raw evidence; invalid/corrupt
 * Rich must never be exported AS IF it were a valid semantic Plain
 * projection. Exact emitted shapes are recorded for the ledger.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { buildTestApp, uniquePrefix } from "../testHelpers.js";
import examRoutes from "../exam.js";
import attemptRoutes from "../attempts.js";
import questionRoutes from "../question.js";
import { schema } from "@exam/db/src/schema/pg.js";
import {
  buildExamPayload,
  enrollCandidateForExam,
  ensureCandidateProfile,
} from "./__tests__/attempts.testHelpers.js";

const RICH_DRAFT = {
  docVersion: 1,
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "最终", marks: ["bold"] },
        { type: "text", text: "答案" },
        { type: "inlineMath", latex: "\\frac{1}{2}" },
      ],
    },
    {
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "要点一" }] },
          ],
        },
      ],
    },
    { type: "codeBlock", language: "ts", text: "const a = 1;" },
  ],
};

const CORRUPT_VALUE = {
  docVersion: 1,
  type: "doc",
  content: [{ type: "mysteryBlock", payload: { deep: [1, 2, 3] } }],
};

const UNSUPPORTED_VERSION_VALUE = {
  docVersion: 7,
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "v7" }] }],
};

describe("Phase-C Campaigns H/I/J — freeze, corrupt, export (L3/L4)", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;
  let candidateProfileId: string;

  interface Rig {
    courseId: string;
    questionId: string;
    examId: string;
    attemptId: string;
    richQId: string;
  }

  async function createRig(title: string): Promise<Rig> {
    const courseId = crypto.randomUUID();
    await ctx.db.insert(schema.courses).values({
      id: courseId,
      organizationId: ctx.org.id,
      name: `${title} Course`,
      code: `${title}-${uniquePrefix()}`,
      description: "",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/questions",
      payload: {
        courseId,
        score: 50,
        difficulty: 1,
        type: "text_response",
        contentDocument: RICH_DRAFT,
        answerMode: "rich",
        options: [],
        standardAnswer: null,
        rubric: "按要点给分",
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode, res.body).toBe(201);
    const questionId = res.json().id as string;
    const examRes = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: buildExamPayload({
        title: `${title} Exam`,
        courseId,
        questionIds: [questionId],
        totalScore: 50,
        passingScore: 30,
      }),
      cookies: { "auth-token": ctx.adminToken },
    });
    const examId = examRes.json().id as string;
    await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/publish`,
      cookies: { "auth-token": ctx.adminToken },
    });
    await enrollCandidateForExam(ctx, candidateProfileId, examId);
    const startRes = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${examId}/start`,
      cookies: { "auth-token": ctx.candidateToken },
    });
    expect(startRes.statusCode, startRes.body).toBe(201);
    const snapshot = startRes.json().questionSnapshot as Array<{
      originalQuestionId: string;
    }>;
    return {
      courseId,
      questionId,
      examId,
      attemptId: startRes.json().id as string,
      richQId: snapshot[0]?.originalQuestionId as string,
    };
  }

  async function attemptRow(attemptId: string) {
    const rows = await ctx.db
      .select()
      .from(schema.examAttempts)
      .where(eq(schema.examAttempts.id, attemptId));
    return rows[0]!;
  }

  function draftValue(row: {
    answers: unknown;
  }): Record<string, unknown> | undefined {
    return (
      (row.answers as unknown as Array<Record<string, unknown>>) ?? []
    ).find((a) => true);
  }

  async function worksetEntry(attemptId: string) {
    const rows = await ctx.db
      .select()
      .from(schema.attemptGradingEntries)
      .where(eq(schema.attemptGradingEntries.attemptId, attemptId));
    return rows[0];
  }

  let rigH: Rig;
  let rigI: Rig;
  let rigJValid: Rig;
  let rigJDraftCorrupt: Rig;
  let rigJLegacy: Rig;

  beforeAll(async () => {
    ctx = await buildTestApp(async (fastify) => {
      await fastify.register(examRoutes, { prefix: "" });
      await fastify.register(questionRoutes, { prefix: "" });
      await fastify.register(attemptRoutes, { prefix: "" });
    });
    candidateProfileId = await ensureCandidateProfile(ctx);
    rigH = await createRig("H");
    rigI = await createRig("I");
    rigJValid = await createRig("JV");
    rigJDraftCorrupt = await createRig("JC");
    rigJLegacy = await createRig("JL");
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  // ── Campaign H — submit freeze / grading parity ──────────────────

  it("H: last accepted canonical draft == submitted frozen value == workset candidateAnswer", async () => {
    // Save a canonically-distinctive draft through the production route.
    const saveRes = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${rigH.attemptId}/answers/${rigH.richQId}`,
      payload: {
        attemptId: rigH.attemptId,
        questionId: rigH.richQId,
        answer: RICH_DRAFT,
        clientSeq: 1,
        clientSavedAt: new Date().toISOString(),
        baseVersion: 0,
      },
      cookies: { "auth-token": ctx.candidateToken },
    });
    expect(saveRes.statusCode, saveRes.body).toBe(200);
    expect(saveRes.json().accepted).toBe(true);

    const draftRow = await attemptRow(rigH.attemptId);
    const draft = draftValue(draftRow)?.answer;
    expect(draft).toEqual(RICH_DRAFT); // canonical persisted (equals input: already canonical)

    const submitRes = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${rigH.attemptId}/submit`,
      payload: { attemptId: rigH.attemptId },
      cookies: { "auth-token": ctx.candidateToken },
    });
    expect(submitRes.statusCode, submitRes.body).toBe(200);

    const submittedRow = await attemptRow(rigH.attemptId);
    expect(submittedRow.status).toBe("submitted");
    const submitted = (
      submittedRow.submittedAnswers as unknown as {
        answers: Array<{ questionId: string; value: unknown }>;
      }
    ).answers;
    const frozen = submitted.find((a) => a.questionId === rigH.richQId);
    // Verbatim freeze: value identical to the draft, no renormalization/upgrade.
    expect(frozen?.value).toEqual(draft);

    const entry = await worksetEntry(rigH.attemptId);
    expect(entry).toBeDefined();
    expect(entry?.candidateAnswer).toEqual(draft);
  });

  it("H: mutating the LIVE question after snapshot does not change the frozen interpretation", async () => {
    // Mutate the LIVE question row after the attempt snapshot exists
    // (direct repository setup; the live question-bank state changes while
    // the attempt's frozen snapshot and grading evidence must not).
    await ctx.db
      .update(schema.questions)
      .set({
        contentDocument: {
          docVersion: 1,
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "LIVE-MUTATED" }],
            },
          ],
        } as never,
        updatedAt: new Date(),
      })
      .where(eq(schema.questions.id, rigH.questionId));

    const row = await attemptRow(rigH.attemptId);
    const frozenQuestion = (
      row.questionSnapshot as unknown as Array<{
        originalQuestionId: string;
        contentDocument: unknown;
      }>
    ).find((q) => q.originalQuestionId === rigH.richQId);
    // Frozen snapshot untouched by the live mutation.
    expect(frozenQuestion?.contentDocument).toEqual(RICH_DRAFT);
    // Workset candidateAnswer untouched.
    const entry = await worksetEntry(rigH.attemptId);
    expect(entry?.candidateAnswer).toEqual(RICH_DRAFT);
  });

  // ── Campaign I — corrupt persisted draft through the protocol seams ──

  it("I: corrupt draft is served verbatim by the take snapshot (no validation, no repair at read)", async () => {
    await ctx.db
      .update(schema.examAttempts)
      .set({
        answers: [
          {
            questionId: rigI.richQId,
            answer: CORRUPT_VALUE,
            version: 1,
            savedAt: new Date(),
            clientSeq: 1,
            clientSeqHistory: [],
          },
        ] as never,
      })
      .where(eq(schema.examAttempts.id, rigI.attemptId));

    const takeRes = await ctx.app.inject({
      method: "GET",
      url: `/api/candidate/attempts/${rigI.attemptId}/take`,
      cookies: { "auth-token": ctx.candidateToken },
    });
    expect(takeRes.statusCode, takeRes.body).toBe(200);
    const snapshot = takeRes.json() as {
      questions?: Array<{ id: string; answerValue: unknown }>;
    };
    const q = snapshot.questions?.find((x) => x.id === rigI.richQId);
    // Ledger: the read seam hands the corrupt value to the client verbatim —
    // no typed integrity failure, no repair; classification is client-side.
    expect(q?.answerValue).toEqual(CORRUPT_VALUE);
  });

  it("I: submit freezes the corrupt draft verbatim; workset carries it verbatim", async () => {
    const submitRes = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${rigI.attemptId}/submit`,
      payload: { attemptId: rigI.attemptId },
      cookies: { "auth-token": ctx.candidateToken },
    });
    expect(submitRes.statusCode, submitRes.body).toBe(200);
    const row = await attemptRow(rigI.attemptId);
    expect(row.status).toBe("submitted");
    const submitted = (
      row.submittedAnswers as unknown as {
        answers: Array<{ questionId: string; value: unknown }>;
      }
    ).answers;
    expect(submitted.find((a) => a.questionId === rigI.richQId)?.value).toEqual(
      CORRUPT_VALUE,
    );
    const entry = await worksetEntry(rigI.attemptId);
    expect(entry?.candidateAnswer).toEqual(CORRUPT_VALUE);
  });

  it("I: unsupported_version draft value is likewise served verbatim by the take snapshot", async () => {
    await ctx.db
      .update(schema.examAttempts)
      .set({
        answers: [
          {
            questionId: rigJLegacy.richQId,
            answer: UNSUPPORTED_VERSION_VALUE,
            version: 2,
            savedAt: new Date(),
            clientSeq: 2,
            clientSeqHistory: [],
          },
        ] as never,
      })
      .where(eq(schema.examAttempts.id, rigJLegacy.attemptId));

    const takeRes = await ctx.app.inject({
      method: "GET",
      url: `/api/candidate/attempts/${rigJLegacy.attemptId}/take`,
      cookies: { "auth-token": ctx.candidateToken },
    });
    expect(takeRes.statusCode, takeRes.body).toBe(200);
    const snapshot = takeRes.json() as {
      questions?: Array<{ id: string; answerValue: unknown }>;
    };
    const q = snapshot.questions?.find((x) => x.id === rigJLegacy.richQId);
    // docVersion 7 is served verbatim — classification happens client-side,
    // where Campaign G shows it becomes an empty editable editor.
    expect(q?.answerValue).toEqual(UNSUPPORTED_VERSION_VALUE);
  });

  // ── Campaign J — export semantics ────────────────────────────────

  it("J setup: valid submitted rig + corrupt draft rig prepared", async () => {
    // Valid submitted rig through the production path.
    await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${rigJValid.attemptId}/answers/${rigJValid.richQId}`,
      payload: {
        attemptId: rigJValid.attemptId,
        questionId: rigJValid.richQId,
        answer: RICH_DRAFT,
        clientSeq: 1,
        clientSavedAt: new Date().toISOString(),
        baseVersion: 0,
      },
      cookies: { "auth-token": ctx.candidateToken },
    });
    const submitRes = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${rigJValid.attemptId}/submit`,
      payload: { attemptId: rigJValid.attemptId },
      cookies: { "auth-token": ctx.candidateToken },
    });
    expect(submitRes.statusCode, submitRes.body).toBe(200);

    // Corrupt DRAFT rig (unsubmitted): direct repository setup.
    await ctx.db
      .update(schema.examAttempts)
      .set({
        answers: [
          {
            questionId: rigJDraftCorrupt.richQId,
            answer: CORRUPT_VALUE,
            version: 3,
            savedAt: new Date(),
            clientSeq: 3,
            clientSeqHistory: [],
          },
        ] as never,
      })
      .where(eq(schema.examAttempts.id, rigJDraftCorrupt.attemptId));
  });

  it("J: JSON export emits the frozen Rich value as raw structured evidence (not a Plain projection)", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/admin/attempts/${rigJValid.attemptId}/export`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as {
      questionResults?: Array<{ order: number; candidateAnswer: unknown }>;
    };
    const q = body.questionResults?.find((x) => x.order === 0);
    // candidateAnswer is the raw structured document — verbatim raw evidence.
    expect(q?.candidateAnswer).toEqual(RICH_DRAFT);
    // It is NOT wrapped or presented as a plain-text projection.
    expect(typeof q?.candidateAnswer).toBe("object");
  });

  it("J: corrupt submitted value exports verbatim; corrupt DRAFT exports verbatim via the draft fallback; string draft exports as string", async () => {
    // Corrupt submitted state via controlled fixture setup.
    await ctx.db
      .update(schema.examAttempts)
      .set({
        status: "submitted",
        submittedAt: new Date(),
        submissionReason: "manual",
        gradingStatus: "pending_manual",
        submittedAnswers: {
          schemaVersion: 1,
          answers: [
            {
              questionId: rigJLegacy.richQId,
              value: UNSUPPORTED_VERSION_VALUE,
            },
          ],
        } as never,
      })
      .where(eq(schema.examAttempts.id, rigJLegacy.attemptId));

    const jsonRes = await ctx.app.inject({
      method: "GET",
      url: `/api/admin/attempts/${rigJLegacy.attemptId}/export`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(jsonRes.statusCode, jsonRes.body).toBe(200);
    const body = jsonRes.json() as {
      questionResults?: Array<{ order: number; candidateAnswer: unknown }>;
    };
    expect(
      body.questionResults?.find((x) => x.order === 0)?.candidateAnswer,
    ).toEqual(UNSUPPORTED_VERSION_VALUE);

    // Corrupt DRAFT fallback (unsubmitted attempt).
    const draftRes = await ctx.app.inject({
      method: "GET",
      url: `/api/admin/attempts/${rigJDraftCorrupt.attemptId}/export`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(draftRes.statusCode, draftRes.body).toBe(200);
    const draftBody = draftRes.json() as {
      questionResults?: Array<{ order: number; candidateAnswer: unknown }>;
    };
    expect(
      draftBody.questionResults?.find((x) => x.order === 0)?.candidateAnswer,
    ).toEqual(CORRUPT_VALUE);

    // CSV: the Rich document is emitted as JSON.stringify in a quoted cell.
    const csvRes = await ctx.app.inject({
      method: "GET",
      url: `/api/admin/attempts/${rigJValid.attemptId}/export/csv`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(csvRes.statusCode, csvRes.body).toBe(200);
    // CSV quotes double inner quotes; unescape before matching the JSON cell.
    // Postgres jsonb round-trip reorders object keys, so assert on raw-JSON
    // tokens that only exist inside the serialized document cell, not on a
    // string prefix.
    const csv = csvRes.body.replaceAll('""', '"');
    for (const token of [
      '"bold"',
      '"inlineMath"',
      '"codeBlock"',
      '"language"',
    ]) {
      expect(csv).toContain(token);
    }
    // Frozen invariant upheld: raw evidence stays raw; the answer cell is the
    // raw JSON document, never a semantic Plain projection of it. The plain
    // projection appears exactly once — the 题目内容 (question content) cell —
    // never a second time as an exported "answer projection".
    const projection = "最终答案\\frac{1}{2}\n要点一\nconst a = 1;";
    expect(csv.split(projection).length - 1).toBe(1);
  });
});
