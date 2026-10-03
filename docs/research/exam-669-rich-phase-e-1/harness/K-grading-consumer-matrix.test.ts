/**
 * Phase-E Campaign K — grading consumer × frozen-value-status matrix (L4,
 * real PostgreSQL, E-GR01). The grading consumer must read the FROZEN
 * attempt truth (submitted_answers + frozen QuestionSnapshot), never the
 * live bank, and a bad frozen Rich value must surface as its raw evidence +
 * integrity classification — never reinterpreted, never blocking manual
 * scoring with a reinterpretation:
 *
 * For every frozen-value status {rich_valid, rich_noncanonical, corrupt,
 * unsupported_version, null}:
 *   K.a  grading-details serves the value VERBATIM (raw evidence) and the
 *        FROZEN prompt/mode (not the live row) — live bank edits before the
 *        read change nothing (rich_valid leg);
 *   K.b  manual scoring (grade-question) succeeds — bad Rich surfaces as
 *        integrity state for consumers (export/result, Campaigns L/M), the
 *        grader still owns the score.
 *
 * Injection discipline: the corrupt statuses cannot be produced through the
 * SaveAnswer wire (D proved it only persists canonical values), so they are
 * injected DIRECTLY into the durable freeze record — into submitted_answers
 * AND the materialized grading entry TOGETHER, keeping the single-commit
 * pairing consistent so the consistency validator sees one coherent (bad)
 * truth. This is the DB-history reality the read classifiers exist for
 * (E-RD01); writing it needs the test-owned database, not production code.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema } from "@exam/db/src/schema/pg.js";
import type { ContentDocumentV1 } from "@exam/domain";
import { classifyPersistedRichAnswer } from "@exam/contracts";
import { CampaignRecorder } from "./campaignStats.js";
import { buildRichAttemptFixture, type RichAttemptFixture } from "./fixture.js";

const recorder = new CampaignRecorder(
  "K-grading-consumer-matrix",
  [0x669e0004],
);

function para(text: string): ContentDocumentV1 {
  return {
    docVersion: 1,
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  };
}

type StatusCase = {
  name: string;
  value: unknown;
  expectedKind: string;
};

const STATUS_CASES: StatusCase[] = [
  {
    name: "rich_valid",
    value: para("K canonical answer"),
    expectedKind: "rich_valid",
  },
  {
    name: "rich_noncanonical",
    value: {
      docVersion: 1,
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "K noncanonical", marks: ["italic", "bold"] },
          ],
        },
      ],
    },
    expectedKind: "rich_noncanonical",
  },
  {
    name: "corrupt",
    value: { docVersion: 1, type: "not-doc", content: [] },
    expectedKind: "corrupt",
  },
  {
    name: "unsupported_version",
    value: { docVersion: 2, type: "doc", content: [] },
    expectedKind: "unsupported_version",
  },
  { name: "null-empty", value: null, expectedKind: "empty" },
];

async function submitAndInject(
  fx: RichAttemptFixture,
  value: unknown,
): Promise<void> {
  // A real accepted draft + submit so the freeze + workset materialize
  // through the production path first.
  const res = await fx.postAnswer(para("K draft through the wire"), 1, 0);
  expect(res.json().accepted, res.body.slice(0, 200)).toBe(true);
  const submitRes = await fx.ctx.app.inject({
    method: "POST",
    url: `/api/attempts/${fx.attemptId}/submit`,
    cookies: { "auth-token": fx.ctx.candidateToken },
  });
  expect(submitRes.statusCode, submitRes.body.slice(0, 300)).toBe(200);

  // Swap the frozen value to the case's value — in BOTH durable slots the
  // pairing owns (freeze record + materialized entry), so the attempt stays
  // internally consistent while carrying the bad truth.
  const rows = await fx.ctx.db
    .select({ submitted: schema.examAttempts.submittedAnswers })
    .from(schema.examAttempts)
    .where(eq(schema.examAttempts.id, fx.attemptId));
  const submitted = rows[0].submitted!;
  submitted.answers[0]!.value = value;
  await fx.ctx.db
    .update(schema.examAttempts)
    .set({ submittedAnswers: submitted })
    .where(eq(schema.examAttempts.id, fx.attemptId));
  await fx.ctx.db
    .update(schema.attemptGradingEntries)
    .set({ candidateAnswer: value })
    .where(
      and(
        eq(schema.attemptGradingEntries.attemptId, fx.attemptId),
        eq(schema.attemptGradingEntries.questionId, fx.questionId),
      ),
    );
}

describe("Campaign K — grading consumer × frozen-value status (L4, E-GR01)", () => {
  let fx: RichAttemptFixture;

  beforeAll(async () => {
    fx = await buildRichAttemptFixture("K frozen grading prompt");
  }, 120_000);

  afterAll(async () => {
    recorder.flush();
    await fx.ctx.cleanup();
  });

  for (const tc of STATUS_CASES) {
    it(`matrix [${tc.name}]: grading-details serves frozen raw evidence; manual scoring succeeds`, async () => {
      await fx.startNewAttempt();
      await submitAndInject(fx, tc.value);

      // Premise: the shared classifier assigns the expected integrity kind.
      const kind = classifyPersistedRichAnswer({
        value: tc.value,
        answerMode: "rich",
      }).kind;
      expect(kind, `classifier kind for ${tc.name}`).toBe(tc.expectedKind);

      // The grading consumer reads the FROZEN attempt truth.
      const details = await fx.ctx.app.inject({
        method: "GET",
        url: `/api/admin/attempts/${fx.attemptId}/grading-details`,
        cookies: { "auth-token": fx.ctx.adminToken },
      });
      expect(details.statusCode, details.body.slice(0, 300)).toBe(200);
      const q = (
        details.json().questions as Array<Record<string, unknown>>
      ).find((x) => x.questionId === fx.questionId);
      expect(q, "grading details missing the question").toBeDefined();
      // K.a raw evidence verbatim (deep-equal; jsonb key order excluded).
      expect(q?.candidateAnswer).toEqual(tc.value);
      // K.a frozen prompt, not the live row.
      const servedDoc = q?.contentDocument as ContentDocumentV1 | null;
      const block = servedDoc?.content[0] as {
        content: Array<{ text?: string }>;
      };
      expect(block?.content[0]?.text).toBe("K frozen grading prompt");
      expect(q?.answerMode).toBe("rich");

      // K.b manual scoring succeeds regardless of the frozen value's health.
      const gradeRes = await fx.ctx.app.inject({
        method: "POST",
        url: `/api/admin/attempts/${fx.attemptId}/grade-question`,
        payload: { questionId: fx.questionId, score: 7, comment: "K matrix" },
        cookies: { "auth-token": fx.ctx.adminToken },
      });
      expect(gradeRes.statusCode, gradeRes.body.slice(0, 300)).toBe(200);
      expect(gradeRes.json()).toMatchObject({
        questionId: fx.questionId,
        score: 7,
      });

      recorder.record({
        probe: `matrix-${tc.name}`,
        outcome: "raw-evidence-served+manual-scoring-ok",
        classifierKind: kind,
      });
    });
  }

  it("live bank edit after submit does not move the grading consumer's frozen basis (E-GR01)", async () => {
    await fx.startNewAttempt();
    await submitAndInject(fx, para("K live-edit leg answer"));

    // Live bank correction AFTER submit+injection.
    const patchRes = await fx.ctx.app.inject({
      method: "PATCH",
      url: `/api/questions/${fx.questionId}`,
      payload: {
        contentDocument: para("K LIVE-EDITED prompt — must never leak"),
      },
      cookies: { "auth-token": fx.ctx.adminToken },
    });
    expect(patchRes.statusCode, patchRes.body.slice(0, 300)).toBe(200);

    const details = await fx.ctx.app.inject({
      method: "GET",
      url: `/api/admin/attempts/${fx.attemptId}/grading-details`,
      cookies: { "auth-token": fx.ctx.adminToken },
    });
    expect(details.statusCode).toBe(200);
    const q = (details.json().questions as Array<Record<string, unknown>>).find(
      (x) => x.questionId === fx.questionId,
    );
    const servedDoc = q?.contentDocument as ContentDocumentV1 | null;
    const block = servedDoc?.content[0] as {
      content: Array<{ text?: string }>;
    };
    expect(block?.content[0]?.text).toBe("K frozen grading prompt");
    recorder.record({
      probe: "live-edit-isolation",
      outcome: "frozen-basis-held",
    });
  });
});
