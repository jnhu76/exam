/**
 * Phase-E Campaign T — DB-history corpus at the draft seam (L4, real
 * PostgreSQL, E-RD01/E-RD03/E-RD04). The draft slot (examAttempts.answers
 * jsonb) can carry ANY value a past protocol version, legacy import, or
 * manual repair ever wrote; the current pipeline must treat that history
 * exactly as the shared classifier says — never repair it on the read path,
 * never reinterpret it, never crash:
 *
 *   T.a  GET /attempts/:id serves the historical value VERBATIM (value,
 *        version, savedAt) — E-RD04 no-repair at the candidate read seam.
 *   T.b  DUAL-CLASSIFIER AGREEMENT: after a wire submit, the export
 *        boundary's candidateAnswerIntegrity equals an independent
 *        classifyPersistedRichAnswer over the served value with the frozen
 *        slot mode — two consumers, one classification, whatever the history.
 *        (Submit rejection for a corrupt draft is recorded as an observed
 *        verdict, with the no-partial-freeze premise asserted.)
 *   T.c  WRITE-SEAM BOUNDARY: a subsequent SaveAnswer over a corrupt draft
 *        history follows SaveAnswer precedence (accepts at the served
 *        version) and replaces the corrupt value with the canonical form —
 *        repair is a WRITE-path authority only; the read path never mutated
 *        the underlying row (T.a already proved the served bytes).
 *
 * Injection discipline: corrupt histories cannot be produced through the
 * SaveAnswer wire (D proved it persists only canonical values), so the corpus
 * is written DIRECTLY into the draft jsonb in its jsonb-representable form —
 * exactly what a historical writer would have left behind.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@exam/db/src/schema/pg.js";
import { classifyPersistedRichAnswer } from "@exam/contracts";
import { CampaignRecorder } from "./campaignStats.js";
import { persistedAnswerCorpus } from "./generators.js";
import { buildRichAttemptFixture, type RichAttemptFixture } from "./fixture.js";

const recorder = new CampaignRecorder("T-db-history-corpus", [0x669e0005]);
const CORPUS = persistedAnswerCorpus();
const INJECTED_SAVED_AT = "2026-01-01T00:00:00.000Z";

/** jsonb representation of a historical value: undefined keys cannot exist. */
const jsonbForm = (v: unknown): unknown =>
  JSON.parse(JSON.stringify(v ?? null));

async function injectDraftHistory(
  fx: RichAttemptFixture,
  value: unknown,
): Promise<void> {
  const rows = await fx.ctx.db
    .select({ answers: schema.examAttempts.answers })
    .from(schema.examAttempts)
    .where(eq(schema.examAttempts.id, fx.attemptId));
  void rows;
  const record = jsonbForm({
    questionId: fx.questionId,
    answer: value,
    version: 1,
    savedAt: INJECTED_SAVED_AT,
  }) as Record<string, unknown>;
  await fx.ctx.db
    .update(schema.examAttempts)
    .set({ answers: [record] as never })
    .where(eq(schema.examAttempts.id, fx.attemptId));
}

describe("Campaign T — DB-history corpus at the draft seam (L4, E-RD01/03/04)", () => {
  let rich: RichAttemptFixture;
  let plain: RichAttemptFixture;

  beforeAll(async () => {
    rich = await buildRichAttemptFixture("T rich history prompt");
    plain = await buildRichAttemptFixture("T plain history prompt", {
      answerMode: "plain",
    });
  }, 180_000);

  afterAll(async () => {
    recorder.flush();
    await rich.ctx.cleanup();
    await plain.ctx.cleanup();
  });

  for (const tc of CORPUS) {
    it(`history [${tc.name}]: served verbatim, consumers agree with the classifier`, async () => {
      const fx = tc.answerMode === "plain" ? plain : rich;
      await fx.startNewAttempt();
      await injectDraftHistory(fx, tc.value);
      const stored = jsonbForm(tc.value);

      // Premise: the standalone classifier's verdict for this history under
      // its own slot mode (the corpus encodes the mode context).
      const expectedKind = classifyPersistedRichAnswer({
        value: stored,
        answerMode: tc.answerMode,
      }).kind;

      // T.a — candidate GET serves the history verbatim (E-RD04).
      const body = await fx.getAttemptBody();
      const slot = fx.slotOf(body);
      expect(slot, `slot for ${tc.name}`).toBeDefined();
      expect(slot?.version).toBe(1);
      expect(slot?.savedAt).toBe(INJECTED_SAVED_AT);
      if (tc.value === undefined) {
        // jsonb cannot hold undefined: the historical row has no answer key.
        expect(slot?.answer).toBeUndefined();
      } else {
        expect(slot?.answer, `${tc.name}: served value not verbatim`).toEqual(
          stored,
        );
      }

      // T.b — submit through the wire, then the export boundary must agree
      // with the standalone classifier over the SERVED value.
      const submitRes = await fx.ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${fx.attemptId}/submit`,
        cookies: { "auth-token": fx.ctx.candidateToken },
      });
      if (submitRes.statusCode === 200) {
        const exportRes = await fx.ctx.app.inject({
          method: "GET",
          url: `/api/admin/attempts/${fx.attemptId}/export`,
          cookies: { "auth-token": fx.ctx.adminToken },
        });
        expect(exportRes.statusCode, exportRes.body.slice(0, 300)).toBe(200);
        // Single-question exam: the result row is order 0 (export rows carry
        // no questionId — the order-indexed result is the contract).
        const q = (
          exportRes.json().questionResults as Array<Record<string, unknown>>
        ).find((x) => x.order === 0);
        expect(q, `export row for ${tc.name}`).toBeDefined();
        expect(
          q?.candidateAnswerIntegrity,
          `${tc.name}: export classifier disagrees with the standalone authority`,
        ).toBe(expectedKind);
        // Raw evidence preserved through the freeze — no repair in flight.
        if (tc.value === undefined) {
          expect(q?.candidateAnswer ?? undefined).toBeUndefined();
        } else {
          expect(q?.candidateAnswer).toEqual(stored);
        }
        recorder.record({
          probe: `history-${tc.name}`,
          outcome: "verbatim+agreement",
          expectedKind,
          mode: tc.answerMode,
        });
      } else {
        // Observed submit rejection of a historical value: legal only as a
        // fail-closed outcome; the freeze must NOT have partially happened.
        recorder.record({
          probe: `history-${tc.name}`,
          outcome: "submit-rejected",
          statusCode: submitRes.statusCode,
          expectedKind,
          mode: tc.answerMode,
        });
        const rowAfter = await fx.ctx.db
          .select({ submitted: schema.examAttempts.submittedAnswers })
          .from(schema.examAttempts)
          .where(eq(schema.examAttempts.id, fx.attemptId));
        expect(
          rowAfter[0]?.submitted,
          `${tc.name}: partial freeze on rejection`,
        ).toBeNull();
      }
    });
  }

  it("T.c write-seam boundary: SaveAnswer over corrupt history accepts at the served version and canonicalizes forward", async () => {
    await rich.startNewAttempt();
    const corrupt = { docVersion: 1, type: "not-doc", content: [] };
    await injectDraftHistory(rich, corrupt);

    const canonical = {
      docVersion: 1,
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "T.c canonical overwrite" }],
        },
      ],
    };
    const saveRes = await rich.postAnswer(canonical, 2, 1);
    expect(
      saveRes.statusCode,
      `save over corrupt history: ${saveRes.body.slice(0, 300)}`,
    ).toBe(200);
    const receipt = saveRes.json();
    expect(receipt.accepted).toBe(true);
    expect(receipt.serverVersion).toBe(2);

    // The draft now carries the canonical value (write-path authority).
    const body = await rich.getAttemptBody();
    const slot = rich.slotOf(body);
    expect(slot?.version).toBe(2);
    expect(slot?.answer).toEqual(canonical);
    recorder.record({
      probe: "write-seam-over-corrupt-history",
      outcome: "accepted+canonicalized",
    });
  });
});
