/**
 * Phase-E Campaign O — publish trust composition (L4, real PostgreSQL,
 * E-PB01..04). The publish freeze gate must trust repository Rich BEFORE
 * any projection, and freeze canonical Rich only:
 *
 * E-PB01: corrupt / unsupported_version / noncanonical question Rich → typed
 *   ValidationError at the wire (HTTP 400), never a projection crash (500),
 *   never a silent freeze.
 *
 * E-PB02: a successful publish freezes exactly the canonical documents; the
 *   projection invariant (content == plainTextProjection(document)) is part
 *   of the gate.
 *
 * E-PB04: the frozen exam snapshot does not repair or drift when the live
 *   bank is edited afterwards.
 *
 * The unhealthy bank states cannot be produced through the question write
 * seam (D5.1 + F proved it only persists canonical Rich), so they are
 * injected DIRECTLY into the question row — the DB-history reality the gate
 * exists to catch (a bypassed write seam, an import bug, a migration).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@exam/db/src/schema/pg.js";
import { plainTextProjection, type ContentDocumentV1 } from "@exam/domain";
import { CampaignRecorder } from "./campaignStats.js";
import { buildRichAttemptFixture, type RichAttemptFixture } from "./fixture.js";

const recorder = new CampaignRecorder("O-publish-trust", [0x669e0004]);

function para(text: string): ContentDocumentV1 {
  return {
    docVersion: 1,
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  };
}

async function createRichQuestion(
  fx: RichAttemptFixture,
  doc: ContentDocumentV1,
): Promise<string> {
  const res = await fx.ctx.app.inject({
    method: "POST",
    url: "/api/questions",
    payload: {
      courseId: fx.courseId,
      type: "text_response",
      answerMode: "rich",
      contentDocument: doc,
      options: [],
      standardAnswer: null,
      score: 10,
      difficulty: 1,
      rubric: "r",
    },
    cookies: { "auth-token": fx.ctx.adminToken },
  });
  expect(res.statusCode, res.body.slice(0, 300)).toBe(201);
  return res.json().id as string;
}

async function createUnpublishedExam(
  fx: RichAttemptFixture,
  questionId: string,
): Promise<string> {
  const res = await fx.ctx.app.inject({
    method: "POST",
    url: "/api/exams",
    payload: {
      title: "O publish-trust exam",
      description: "",
      courseId: fx.courseId,
      timingMode: "timed_window",
      durationMinutes: 60,
      openAt: new Date(Date.now() - 3600000).toISOString(),
      closeAt: new Date(Date.now() + 86400000).toISOString(),
      passingScore: 6,
      totalScore: 10,
      questionSelectionMode: "manual",
      questionIds: [questionId],
      controlFlags: {
        shuffleQuestions: false,
        shuffleOptions: false,
        detectTabSwitch: false,
        disableCopyPaste: false,
        requireQueue: false,
        batchSize: 10,
        batchInterval: 3,
        restrictIp: false,
        requireLockdown: false,
        showResultImmediately: true,
      },
      retakePolicy: "unlimited",
      scoreStrategy: "highest",
      maxAttempts: 3,
    },
    cookies: { "auth-token": fx.ctx.adminToken },
  });
  expect(res.statusCode, res.body.slice(0, 300)).toBe(201);
  return res.json().id as string;
}

function publish(fx: RichAttemptFixture, examId: string) {
  return fx.ctx.app.inject({
    method: "POST",
    url: `/api/exams/${examId}/publish`,
    cookies: { "auth-token": fx.ctx.adminToken },
  });
}

/** Direct bank-row injection: the bypassed-seam reality the gate must catch. */
async function injectQuestionDoc(
  fx: RichAttemptFixture,
  questionId: string,
  doc: unknown,
  content: string,
): Promise<void> {
  await fx.ctx.db
    .update(schema.questions)
    .set({
      contentDocument: doc as ContentDocumentV1,
      content,
    })
    .where(eq(schema.questions.id, questionId));
}

async function frozenSnapshot(
  fx: RichAttemptFixture,
  examId: string,
): Promise<Array<Record<string, unknown>>> {
  const rows = await fx.ctx.db
    .select({ snap: schema.exams.questionSnapshot })
    .from(schema.exams)
    .where(eq(schema.exams.id, examId));
  return (rows[0].snap ?? []) as unknown as Array<Record<string, unknown>>;
}

describe("Campaign O — publish trust composition (L4, E-PB01/02/04)", () => {
  let fx: RichAttemptFixture;

  beforeAll(async () => {
    fx = await buildRichAttemptFixture("O fixture prompt");
  }, 120_000);

  afterAll(async () => {
    recorder.flush();
    await fx.ctx.cleanup();
  });

  it("E-PB02 healthy: publish freezes exactly the canonical wire document", async () => {
    const doc = para("O healthy publish document");
    const questionId = await createRichQuestion(fx, doc);
    const examId = await createUnpublishedExam(fx, questionId);
    const res = await publish(fx, examId);
    expect(res.statusCode, res.body.slice(0, 300)).toBe(200);
    const snap = await frozenSnapshot(fx, examId);
    expect(snap).toHaveLength(1);
    expect(snap[0].contentDocument).toEqual(doc);
    recorder.record({ probe: "E-PB02-healthy", outcome: "canonical-frozen" });
  });

  it("E-PB01 corrupt: bypassed-seam corruption fails publish closed with a typed 400 (never 500, never freeze)", async () => {
    const questionId = await createRichQuestion(fx, para("O corrupt leg"));
    await injectQuestionDoc(
      fx,
      questionId,
      { docVersion: 1, type: "not-doc", content: [] },
      "x",
    );
    const examId = await createUnpublishedExam(fx, questionId);
    const res = await publish(fx, examId);
    expect(res.statusCode, res.body.slice(0, 300)).toBe(400);
    expect(res.json().error?.code).toBe("VALIDATION_ERROR");
    // Nothing was frozen.
    expect(await frozenSnapshot(fx, examId)).toHaveLength(0);
    recorder.record({
      probe: "E-PB01-corrupt",
      outcome: "typed-400-no-freeze",
    });
  });

  it("E-PB01 unsupported_version: bypassed docVersion 2 fails publish closed", async () => {
    const questionId = await createRichQuestion(fx, para("O v2 leg"));
    await injectQuestionDoc(
      fx,
      questionId,
      { docVersion: 2, type: "doc", content: [] },
      "x",
    );
    const examId = await createUnpublishedExam(fx, questionId);
    const res = await publish(fx, examId);
    expect(res.statusCode, res.body.slice(0, 300)).toBe(400);
    expect(res.json().error?.code).toBe("VALIDATION_ERROR");
    expect(await frozenSnapshot(fx, examId)).toHaveLength(0);
    recorder.record({
      probe: "E-PB01-unsupported",
      outcome: "typed-400-no-freeze",
    });
  });

  it("E-PB01 noncanonical: a bypassed noncanonical row may not be frozen (even with a consistent projection)", async () => {
    const noncanonical: ContentDocumentV1 = {
      docVersion: 1,
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "O noncanonical row",
              marks: ["italic", "bold"],
            },
          ],
        },
      ],
    };
    const questionId = await createRichQuestion(fx, para("O noncanonical leg"));
    // Projection kept CONSISTENT so the noncanonical branch itself fires —
    // not the projection invariant.
    await injectQuestionDoc(
      fx,
      questionId,
      noncanonical,
      plainTextProjection(noncanonical),
    );
    const examId = await createUnpublishedExam(fx, questionId);
    const res = await publish(fx, examId);
    expect(res.statusCode, res.body.slice(0, 300)).toBe(400);
    expect(res.json().error?.code).toBe("VALIDATION_ERROR");
    expect(await frozenSnapshot(fx, examId)).toHaveLength(0);
    recorder.record({
      probe: "E-PB01-noncanonical",
      outcome: "typed-400-no-freeze",
    });
  });

  it("E-PB02 projection invariant: canonical doc with a stale plain content string fails the gate", async () => {
    const questionId = await createRichQuestion(
      fx,
      para("O stale projection leg"),
    );
    await injectQuestionDoc(
      fx,
      questionId,
      para("O actual document"),
      "STALE PROJECTION TEXT",
    );
    const examId = await createUnpublishedExam(fx, questionId);
    const res = await publish(fx, examId);
    expect(res.statusCode, res.body.slice(0, 300)).toBe(400);
    expect(res.json().error?.code).toBe("VALIDATION_ERROR");
    expect(await frozenSnapshot(fx, examId)).toHaveLength(0);
    recorder.record({
      probe: "E-PB02-projection-invariant",
      outcome: "typed-400-no-freeze",
    });
  });

  it("E-PB04: the frozen exam snapshot does not drift when the live bank is edited after publish", async () => {
    const docV1 = para("O frozen at publish v1");
    const questionId = await createRichQuestion(fx, docV1);
    const examId = await createUnpublishedExam(fx, questionId);
    const pub = await publish(fx, examId);
    expect(pub.statusCode).toBe(200);

    const patch = await fx.ctx.app.inject({
      method: "PATCH",
      url: `/api/questions/${questionId}`,
      payload: {
        contentDocument: para(
          "O live-edited v2 — must not leak into the freeze",
        ),
      },
      cookies: { "auth-token": fx.ctx.adminToken },
    });
    expect(patch.statusCode, patch.body.slice(0, 300)).toBe(200);

    const snap = await frozenSnapshot(fx, examId);
    expect(snap[0].contentDocument).toEqual(docV1);
    recorder.record({
      probe: "E-PB04-no-repair-no-drift",
      outcome: "frozen-held",
    });
  });
});
