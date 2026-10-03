/**
 * Phase-E Campaign J — frozen-vs-live independence (L4, real PostgreSQL,
 * E-FZ01). The attempt's question facts freeze at start (publish snapshot →
 * attempt copy); live-bank mutations after the freeze must not change how
 * the attempt loads, saves, submits, or reads back:
 *
 * J1: the served questionSnapshot is byte-stable across a live content
 *     edit — before and after submit, and across an app rebuild on the same
 *     DB (no in-memory cache may paper over the freeze).
 *
 * J2: saving still works per the FROZEN facts after the live edit (the
 *     frozen answerMode/grammar governs, not the live row).
 *
 * J3: the durable freeze records — attempts.question_snapshot AND
 *     attempts.submitted_answers — never contain the live-edited content.
 *
 * The live edit here is a legitimate bank correction (new prompt text). The
 * frozen snapshot captured from the attempt's own GET is the authority the
 * attempt must keep serving; the live row is the authority the bank serves.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@exam/db/src/schema/pg.js";
import type { ContentDocumentV1 } from "@exam/domain";
import { rebuildAppOnSameDb } from "@exam/api/src/routes/testHelpers.js";
import { CampaignRecorder } from "./campaignStats.js";
import {
  allAttemptRoutes,
  buildRichAttemptFixture,
  type RichAttemptFixture,
} from "./fixture.js";

const recorder = new CampaignRecorder("J-frozen-vs-live", [0x669e0004]);

function docWithPrompt(prompt: string): ContentDocumentV1 {
  return {
    docVersion: 1,
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: prompt }] }],
  };
}

async function liveEditPrompt(
  fx: RichAttemptFixture,
  prompt: string,
): Promise<void> {
  const res = await fx.ctx.app.inject({
    method: "PATCH",
    url: `/api/questions/${fx.questionId}`,
    payload: { contentDocument: docWithPrompt(prompt) },
    cookies: { "auth-token": fx.ctx.adminToken },
  });
  expect(res.statusCode, res.body.slice(0, 300)).toBe(200);
}

function servedPrompt(body: Record<string, unknown>): string {
  const snap = body.questionSnapshot as Array<Record<string, unknown>>;
  const doc = snap[0].contentDocument as ContentDocumentV1;
  const block = doc.content[0] as {
    type: string;
    content: Array<{ type: string; text?: string }>;
  };
  const run = block.content[0] as { text?: string };
  return run.text ?? "";
}

describe("Campaign J — frozen-vs-live independence (L4, E-FZ01)", () => {
  let fx: RichAttemptFixture;

  beforeAll(async () => {
    fx = await buildRichAttemptFixture("Frozen prompt v1");
  }, 120_000);

  afterAll(async () => {
    recorder.flush();
    await fx.ctx.cleanup();
  });

  it("J1/J2: live bank edits do not move the served snapshot; saves keep working per frozen facts", async () => {
    // Freeze authority: what the attempt serves at start.
    const before = await fx.getAttemptBody();
    expect(servedPrompt(before)).toBe("Frozen prompt v1");

    // One accepted save under the frozen facts.
    const docA: ContentDocumentV1 = {
      docVersion: 1,
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "J answer v1" }] },
      ],
    };
    let seq = 1;
    let version = 0;
    const r1 = await fx.postAnswer(docA, seq, version);
    expect(r1.json().accepted, r1.body.slice(0, 200)).toBe(true);
    version = r1.json().serverVersion as number;

    // LIVE EDIT #1 (pre-submit bank correction).
    await liveEditPrompt(fx, "Live-edited prompt v2");

    // The attempt still serves the frozen snapshot; saves still work.
    const mid = await fx.getAttemptBody();
    expect(servedPrompt(mid)).toBe("Frozen prompt v1");
    const docB: ContentDocumentV1 = {
      docVersion: 1,
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "J answer v2" }] },
      ],
    };
    seq = 2;
    const r2 = await fx.postAnswer(docB, seq, version);
    expect(r2.json().accepted, r2.body.slice(0, 200)).toBe(true);
    version = r2.json().serverVersion as number;
    expect(
      (fx.slotOf(mid) as Record<string, unknown>).version as number,
    ).toBeLessThan(version);

    // Submit under frozen facts.
    const submitRes = await fx.ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${fx.attemptId}/submit`,
      cookies: { "auth-token": fx.ctx.candidateToken },
    });
    expect(submitRes.statusCode, submitRes.body.slice(0, 300)).toBe(200);

    // LIVE EDIT #2 (post-submit).
    await liveEditPrompt(fx, "Live-edited prompt v3");

    // Post-submit reload: frozen facts everywhere.
    const post = await fx.getAttemptBody();
    expect(servedPrompt(post)).toBe("Frozen prompt v1");

    // And across an app rebuild on the same DB (no cache to trust).
    const app2 = await rebuildAppOnSameDb(fx.ctx, allAttemptRoutes);
    try {
      const rebuilt = await fx.getAttemptBody(app2);
      expect(servedPrompt(rebuilt)).toBe("Frozen prompt v1");
      expect((fx.slotOf(rebuilt) as Record<string, unknown>).answer).toEqual(
        docB,
      );
      recorder.record({
        probe: "J1-snapshot-stability",
        outcome: "frozen-across-edit+submit+rebuild",
      });
    } finally {
      await app2.close();
    }

    // J3: the DURABLE freeze rows carry the frozen snapshot, never the live
    // prompt — structural comparison (jsonb serves keys in its own order).
    const rows = await fx.ctx.db
      .select({
        snap: schema.examAttempts.questionSnapshot,
        submitted: schema.examAttempts.submittedAnswers,
      })
      .from(schema.examAttempts)
      .where(eq(schema.examAttempts.id, fx.attemptId));
    const frozenSnap = rows[0].snap as Array<{
      contentDocument: ContentDocumentV1;
    }>;
    expect(frozenSnap[0].contentDocument).toEqual(
      docWithPrompt("Frozen prompt v1"),
    );
    const submitted = rows[0].submitted as {
      answers: Array<{ value: unknown }>;
    };
    expect(submitted.answers[0].value).toEqual(docB);
    recorder.record({
      probe: "J3-durable-freeze",
      outcome: "frozen-rows-verbatim",
    });
  });
});
