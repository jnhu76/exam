/**
 * Phase-E Campaign I — submit freeze (L4, real PostgreSQL). Falsification
 * targets E-SB01/E-SB02:
 *
 * E-SB01: submitted_answers[i].value == the LAST ACCEPTED canonical draft —
 *   including the cleared (null) answer as a legitimate last accepted value,
 *   and the replay ACK contributing nothing.
 *
 * E-SB02: the freeze path is a VERBATIM COPY. Structurally: the engine's
 *   submit path imports no canonicalizer/normalizer at all (the canonicalize
 *   seams in answerProtocol are caller-injected SaveAnswer callbacks); the
 *   snapshot builder is a pure projection. Behaviorally: the submitted value
 *   equals the served draft answer exactly (deep + identity), and re-reading
 *   the durable freeze record gives the same bytes.
 *
 * The freeze record (attempts.submitted_answers) is the durable artifact the
 * grading consumers own (E-GR01); it is not exposed on the candidate GET, so
 * the freeze is read directly from the test-owned database row.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { readFileSync } from "node:fs";
import path from "node:path";
import { schema } from "@exam/db/src/schema/pg.js";
import type { ContentDocumentV1 } from "@exam/domain";
import {
  ContentDocumentV1Schema,
  canonicalizeContentDocument,
} from "@exam/contracts";
import { canonicalAnswerIdentity } from "@exam/exam-engine";
import { CampaignRecorder } from "./campaignStats.js";
import { buildRichAttemptFixture, type RichAttemptFixture } from "./fixture.js";

const recorder = new CampaignRecorder("I-submit-freeze", [0x669e0004]);
const REPO_ROOT = path.resolve(import.meta.dirname, "../../../..");

function para(text: string): ContentDocumentV1 {
  return {
    docVersion: 1,
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  };
}

/** Grammar-legal but NON-canonical: bold+italic in reversed canonical order. */
function noncanonicalDoc(text: string): ContentDocumentV1 {
  return {
    docVersion: 1,
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text, marks: ["italic", "bold"] }],
      },
    ],
  };
}

async function readSubmittedAnswers(
  fx: RichAttemptFixture,
): Promise<{
  schemaVersion: number;
  answers: Array<{ questionId: string; value: unknown }>;
}> {
  const rows = await fx.ctx.db
    .select({ submitted: schema.examAttempts.submittedAnswers })
    .from(schema.examAttempts)
    .where(eq(schema.examAttempts.id, fx.attemptId));
  return rows[0].submitted as {
    schemaVersion: number;
    answers: Array<{ questionId: string; value: unknown }>;
  };
}

async function submitCurrent(fx: RichAttemptFixture) {
  const res = await fx.ctx.app.inject({
    method: "POST",
    url: `/api/attempts/${fx.attemptId}/submit`,
    cookies: { "auth-token": fx.ctx.candidateToken },
  });
  return res;
}

describe("Campaign I — submit freeze (L4, E-SB01/02)", () => {
  let fx: RichAttemptFixture;

  beforeAll(async () => {
    fx = await buildRichAttemptFixture("Submit freeze prompt.");
  }, 120_000);

  afterAll(async () => {
    recorder.flush();
    await fx.ctx.cleanup();
  });

  it("E-SB01: the freeze captures exactly the LAST accepted draft; replays and earlier versions contribute nothing", async () => {
    const docFinal = para("I final accepted answer");
    const docMiddle = para("I middle answer");

    // seq 1: noncanonical-legal draft → the WRITE path canonicalizes it, so
    // the stored draft value is its canonical form.
    const nonCanonical = noncanonicalDoc("I first draft");
    let seq = 1;
    let version = 0;
    const r1 = await fx.postAnswer(nonCanonical, seq, version);
    expect(r1.json().accepted, r1.body.slice(0, 200)).toBe(true);
    version = r1.json().serverVersion as number;
    const canonicalFirst = canonicalizeContentDocument(nonCanonical);
    expect(canonicalFirst.ok).toBe(true);

    seq = 2;
    const r2 = await fx.postAnswer(docMiddle, seq, version);
    version = r2.json().serverVersion as number;
    expect(r2.json().accepted, r2.body.slice(0, 200)).toBe(true);

    seq = 3;
    const r3 = await fx.postAnswer(null, seq, version);
    version = r3.json().serverVersion as number;
    expect(r3.json().accepted, r3.body.slice(0, 200)).toBe(true);

    seq = 4;
    const r4 = await fx.postAnswer(docFinal, seq, version);
    version = r4.json().serverVersion as number;
    expect(r4.json().accepted, r4.body.slice(0, 200)).toBe(true);

    // Replay of the final key: must ACK and contribute nothing to the freeze.
    const replay = await fx.postAnswer(docFinal, seq, version - 1);
    expect(replay.json()).toMatchObject({
      accepted: true,
      serverVersion: version,
    });

    // The served draft is the freeze's source of truth.
    const slot = fx.slotOf(await fx.getAttemptBody()) as Record<
      string,
      unknown
    >;
    expect(slot.answer).toEqual(docFinal);

    const submitRes = await submitCurrent(fx);
    expect(submitRes.statusCode, submitRes.body.slice(0, 300)).toBe(200);

    const submitted = await readSubmittedAnswers(fx);
    expect(submitted.schemaVersion).toBe(1);
    expect(submitted.answers).toHaveLength(1);
    expect(submitted.answers[0].questionId).toBe(fx.questionId);
    // E-SB01: exactly the last accepted draft, byte-deep.
    expect(submitted.answers[0].value).toEqual(docFinal);
    // E-SB02: verbatim copy — identity digest of the frozen value equals the
    // canonical identity of the last accepted draft, and the value itself is
    // schema-legal (no freeze-time transformation happened OR would matter).
    expect(
      canonicalAnswerIdentity(submitted.answers[0].value as ContentDocumentV1),
    ).toBe(canonicalAnswerIdentity(docFinal));
    expect(
      ContentDocumentV1Schema.safeParse(submitted.answers[0].value).success,
    ).toBe(true);
    recorder.record({
      probe: "E-SB01-last-accepted",
      outcome: "frozen-verbatim",
    });
  });

  it("E-SB01 cleared: a null (cleared) last accepted value freezes as null — not as the prior draft", async () => {
    await fx.startNewAttempt();
    const docA = para("I cleared-case draft");

    let seq = 1;
    let version = 0;
    const r1 = await fx.postAnswer(docA, seq, version);
    expect(r1.json().accepted, r1.body.slice(0, 200)).toBe(true);
    version = r1.json().serverVersion as number;

    seq = 2;
    const r2 = await fx.postAnswer(null, seq, version);
    expect(r2.json().accepted, r2.body.slice(0, 200)).toBe(true);

    const submitRes = await submitCurrent(fx);
    expect(submitRes.statusCode, submitRes.body.slice(0, 300)).toBe(200);
    const submitted = await readSubmittedAnswers(fx);
    expect(submitted.answers[0].value).toBeNull();
    recorder.record({ probe: "E-SB01-cleared-final", outcome: "frozen-null" });
  });

  it("E-SB02: the submit path imports no Rich canonicalizer — freeze is a pure copy (source census)", () => {
    const answerProtocol = readFileSync(
      path.join(REPO_ROOT, "packages/exam-engine/src/answerProtocol.ts"),
      "utf8",
    );
    // The protocol module owns canonicalization ONLY as caller-injected
    // SaveAnswer callbacks; the freeze builder itself must stay a pure
    // projection over draft answers.
    expect(answerProtocol).not.toMatch(
      /import\s*\{[^}]*normalizeContentDocument[^}]*\}\s*from/,
    );
    expect(answerProtocol).not.toMatch(
      /import\s*\{[^}]*canonicalizeContentDocument[^}]*\}\s*from/,
    );
    const attemptCommands = readFileSync(
      path.join(REPO_ROOT, "packages/exam-engine/src/attemptCommands.ts"),
      "utf8",
    );
    expect(attemptCommands).not.toMatch(/normalizeContentDocument/);
    expect(attemptCommands).not.toMatch(/canonicalizeContentDocument/);
    expect(attemptCommands).toMatch(/buildSubmittedAnswersSnapshot\(/);
    recorder.record({
      probe: "E-SB02-source-census",
      outcome: "no-second-canonicalizer",
    });
  });
});
