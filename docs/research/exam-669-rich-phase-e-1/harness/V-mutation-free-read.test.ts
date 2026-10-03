/**
 * Phase-E Campaign V — mutation-free read (L4, real PostgreSQL, E-RD04).
 * Read classification never repairs persisted data — here that invariant is
 * falsified at the durable layer, not the response layer:
 *
 *   V1  a fully materialized attempt (accepted saves + receipts + freeze +
 *       grading entries + a manual score) is snapshotted row-for-row; a
 *       hammer of every read surface (candidate GET, take snapshot,
 *       grading-details, JSON export, CSV export, 3 rounds each) must leave
 *       EVERY durable row byte-identical — including updatedAt, grading
 *       scores, receipts, and both jsonb truth slots;
 *   V2  the sharpest no-repair probe: a CORRUPT value injected into the
 *       frozen truth (the state a read path would have the most incentive to
 *       "fix") survives the same read hammer byte-identical — fail-closed
 *       consumers observed it (200s), and the stored corruption is untouched;
 *   V3  response-level stability: first vs last body of each read surface is
 *       identical modulo the volatile serverNow stamp.
 *
 * A single jsonb rewrite, receipt insert, score reset, or timestamp bump on
 * any read path is a Phase-D trust violation: reads would be writes.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@exam/db/src/schema/pg.js";
import { CampaignRecorder } from "./campaignStats.js";
import { buildRichAttemptFixture, type RichAttemptFixture } from "./fixture.js";

const recorder = new CampaignRecorder("V-mutation-free-read", [0x669e0006]);

const READS = (fx: RichAttemptFixture) =>
  [
    {
      name: "candidate-get",
      run: () =>
        fx.ctx.app.inject({
          method: "GET",
          url: `/api/attempts/${fx.attemptId}`,
          cookies: { "auth-token": fx.ctx.candidateToken },
        }),
    },
    {
      name: "take-snapshot",
      run: () =>
        fx.ctx.app.inject({
          method: "GET",
          url: `/api/candidate/attempts/${fx.attemptId}/take`,
          cookies: { "auth-token": fx.ctx.candidateToken },
        }),
    },
    {
      name: "grading-details",
      run: () =>
        fx.ctx.app.inject({
          method: "GET",
          url: `/api/admin/attempts/${fx.attemptId}/grading-details`,
          cookies: { "auth-token": fx.ctx.adminToken },
        }),
    },
    {
      name: "json-export",
      run: () =>
        fx.ctx.app.inject({
          method: "GET",
          url: `/api/admin/attempts/${fx.attemptId}/export`,
          cookies: { "auth-token": fx.ctx.adminToken },
        }),
    },
    {
      name: "csv-export",
      run: () =>
        fx.ctx.app.inject({
          method: "GET",
          url: `/api/admin/attempts/${fx.attemptId}/export/csv`,
          cookies: { "auth-token": fx.ctx.adminToken },
        }),
    },
  ] as const;

/** Recursively strips the volatile serverNow stamp for stability compare. */
function stripVolatile(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripVolatile);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === "serverNow") continue;
      out[k] = stripVolatile(v);
    }
    return out;
  }
  return value;
}

type RowSnapshot = {
  attempts: Record<string, unknown>[];
  gradingEntries: Record<string, unknown>[];
  receipts: Record<string, unknown>[];
};

async function snapshotRows(fx: RichAttemptFixture): Promise<RowSnapshot> {
  const attempts = (await fx.ctx.db
    .select()
    .from(schema.examAttempts)
    .where(eq(schema.examAttempts.id, fx.attemptId))) as Record<
    string,
    unknown
  >[];
  const gradingEntries = (await fx.ctx.db
    .select()
    .from(schema.attemptGradingEntries)
    .where(eq(schema.attemptGradingEntries.attemptId, fx.attemptId))) as Record<
    string,
    unknown
  >[];
  const receipts = (await fx.ctx.db
    .select()
    .from(schema.examAnswerSaveReceipts)
    .where(
      eq(schema.examAnswerSaveReceipts.attemptId, fx.attemptId),
    )) as Record<string, unknown>[];
  return {
    attempts: structuredClone(attempts),
    gradingEntries: structuredClone(gradingEntries),
    receipts: structuredClone(receipts),
  };
}

async function hammerReads(
  fx: RichAttemptFixture,
  rounds: number,
): Promise<Map<string, unknown>> {
  const firstBodies = new Map<string, unknown>();
  for (let round = 0; round < rounds; round += 1) {
    for (const read of READS(fx)) {
      const res = await read.run();
      expect(
        res.statusCode,
        `${read.name} round ${round}: ${res.body.slice(0, 200)}`,
      ).toBe(200);
      if (round === 0) {
        firstBodies.set(
          read.name,
          read.name === "csv-export" ? res.body : stripVolatile(res.json()),
        );
      } else if (read.name === "csv-export") {
        expect(res.body, `csv-export round ${round} drifted`).toBe(
          firstBodies.get(read.name),
        );
      } else {
        expect(
          stripVolatile(res.json()),
          `${read.name} round ${round} drifted`,
        ).toEqual(firstBodies.get(read.name));
      }
    }
  }
  return firstBodies;
}

describe("Campaign V — mutation-free read (L4, E-RD04)", () => {
  let fx: RichAttemptFixture;

  beforeAll(async () => {
    fx = await buildRichAttemptFixture("V mutation-free prompt");
  }, 120_000);

  afterAll(async () => {
    recorder.flush();
    await fx.ctx.cleanup();
  });

  it("V1: the full read hammer leaves every durable row byte-identical", async () => {
    // Materialize the whole write surface through production paths.
    const docA = {
      docVersion: 1,
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "V first answer" }],
        },
      ],
    };
    const docB = {
      docVersion: 1,
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "V final answer" }],
        },
      ],
    };
    expect((await fx.postAnswer(docA, 1, 0)).json().accepted).toBe(true);
    expect((await fx.postAnswer(docB, 2, 1)).json().accepted).toBe(true);
    const submitRes = await fx.ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${fx.attemptId}/submit`,
      cookies: { "auth-token": fx.ctx.candidateToken },
    });
    expect(submitRes.statusCode, submitRes.body.slice(0, 300)).toBe(200);
    const gradeRes = await fx.ctx.app.inject({
      method: "POST",
      url: `/api/admin/attempts/${fx.attemptId}/grade-question`,
      payload: { questionId: fx.questionId, score: 8, comment: "V graded" },
      cookies: { "auth-token": fx.ctx.adminToken },
    });
    expect(gradeRes.statusCode, gradeRes.body.slice(0, 300)).toBe(200);

    const before = await snapshotRows(fx);
    expect(before.attempts.length).toBe(1);
    expect(before.gradingEntries.length).toBe(1);
    expect(before.receipts.length).toBe(2);

    await hammerReads(fx, 3);

    const after = await snapshotRows(fx);
    expect(after.attempts, "examAttempts row mutated by a read path").toEqual(
      before.attempts,
    );
    expect(
      after.gradingEntries,
      "grading entries mutated by a read path",
    ).toEqual(before.gradingEntries);
    expect(after.receipts, "receipts mutated by a read path").toEqual(
      before.receipts,
    );
    recorder.record({
      probe: "V1-full-hammer",
      outcome: "rows-byte-identical",
      rounds: 3,
      surfaces: 5,
      receipts: before.receipts.length,
    });
  });

  it("V2: a corrupt frozen value survives the read hammer unrepaired", async () => {
    // Fresh attempt: wire answer + submit, then inject the un-writable state
    // (corrupt Rich) into BOTH frozen slots, keeping the pairing consistent.
    await fx.startNewAttempt();
    const draft = {
      docVersion: 1,
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "V corrupt leg" }],
        },
      ],
    };
    expect((await fx.postAnswer(draft, 1, 0)).json().accepted).toBe(true);
    const submitRes = await fx.ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${fx.attemptId}/submit`,
      cookies: { "auth-token": fx.ctx.candidateToken },
    });
    expect(submitRes.statusCode).toBe(200);
    const corrupt = { docVersion: 1, type: "not-doc", content: [] };
    const rows = await fx.ctx.db
      .select({ submitted: schema.examAttempts.submittedAnswers })
      .from(schema.examAttempts)
      .where(eq(schema.examAttempts.id, fx.attemptId));
    const submitted = rows[0].submitted!;
    submitted.answers[0]!.value = corrupt;
    await fx.ctx.db
      .update(schema.examAttempts)
      .set({ submittedAnswers: submitted })
      .where(eq(schema.examAttempts.id, fx.attemptId));
    await fx.ctx.db
      .update(schema.attemptGradingEntries)
      .set({ candidateAnswer: corrupt })
      .where(eq(schema.attemptGradingEntries.attemptId, fx.attemptId));

    const before = await snapshotRows(fx);
    const bodies = await hammerReads(fx, 3);

    const after = await snapshotRows(fx);
    expect(
      after.attempts,
      "corrupt truth repaired/moved by a read path",
    ).toEqual(before.attempts);
    expect(
      after.gradingEntries,
      "corrupt entry repaired by a read path",
    ).toEqual(before.gradingEntries);
    // Fail-closed observed at the consumers: the corrupt value reached them
    // verbatim (K proved the classification; here the raw evidence serves).
    const details = bodies.get("grading-details") as {
      questions: Array<Record<string, unknown>>;
    };
    expect(details.questions[0]?.candidateAnswer).toEqual(corrupt);
    recorder.record({
      probe: "V2-corrupt-frozen-hammer",
      outcome: "corruption-survived-unrepaired",
    });
  });

  it("V3: read responses are stable modulo serverNow across the hammer", async () => {
    // Covered inside hammerReads (first-vs-last per surface, per round).
    // This leg re-runs the hammer once more post-V2 and pins the census so
    // the stability claim cannot silently degrade to zero surfaces.
    const bodies = await hammerReads(fx, 2);
    expect(bodies.size).toBe(5);
    recorder.record({
      probe: "V3-response-stability",
      outcome: "stable-modulo-serverNow",
      surfaces: bodies.size,
    });
  });
});
