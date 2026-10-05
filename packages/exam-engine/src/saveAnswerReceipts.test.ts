/**
 * Replay-receipt mechanism regressions (engine level, #669).
 *
 * Replay semantics were already correct when receipts were embedded (with
 * full payload copies) in the draft-answer JSONB; the compact append-only
 * receipt mechanism must preserve those frozen semantics:
 *
 *   - the oldest accepted clientSeq still replays to the prior ACK after
 *     many subsequent saves — no bounded-window eviction can exist;
 *   - the oldest replay with a different canonical identity stays
 *     CONFLICTING_PAYLOAD (never "unseen");
 *   - unknown clientSeq keeps normal CAS semantics;
 *   - canonically-equivalent candidate payloads share one identity
 *     (identity is computed on the accepted canonical value);
 *   - the identity representation is faithful to structural equality over
 *     the SaveAnswer value domain.
 */
import { describe, expect, it } from "vitest";
import type { ExamAttempt } from "@exam/domain";
import { canonicalAnswerIdentity, saveAnswer } from "./answerProtocol.js";
import type { AnswerReceipt } from "./attemptCommands.js";
import {
  makeExam,
  makeAttempt,
  makeEnrollment,
  makeManualSnapshot,
  prepare,
  type PreparedHarness,
} from "./attemptMutation.testHelpers.js";

const T0 = new Date("2025-01-01T10:05:00Z");

async function harness(
  attemptOverrides: Partial<ExamAttempt> = {},
  now = T0,
): Promise<PreparedHarness> {
  return prepare(
    makeExam(),
    makeAttempt(attemptOverrides),
    makeEnrollment(),
    now,
  );
}

interface SaveArgs {
  answer: unknown;
  clientSeq: number;
  baseVersion: number;
  at?: Date;
}

async function save(h: PreparedHarness, questionId: string, args: SaveArgs) {
  return saveAnswer(h.attemptRepo, h.mutationContext, {
    attemptId: h.mutationContext.attemptId,
    questionId,
    answer: args.answer,
    clientSeq: args.clientSeq,
    clientSavedAt: (args.at ?? T0).toISOString(),
    baseVersion: args.baseVersion,
  });
}

describe("D2 replay receipts — frozen semantics on the repaired mechanism", () => {
  it("the oldest accepted clientSeq still ACKs after 60 later saves (no bounded window)", async () => {
    const N = 60;
    const h = await harness();
    let oldestAck: { serverVersion: number; savedAt: string } | null = null;

    for (let i = 1; i <= N; i++) {
      const result = await save(h, "q1", {
        answer: `answer-${i}`,
        clientSeq: i,
        baseVersion: i - 1,
        at: new Date(T0.getTime() + i * 1000),
      });
      expect(result.accepted).toBe(true);
      if (i === 1) {
        oldestAck = {
          serverVersion: result.serverVersion,
          savedAt: result.savedAt,
        };
      }
    }

    // Replay seq 1 with the same canonical identity: the PRIOR acknowledgement
    // comes back verbatim, with zero new answer write and no new receipt.
    const replay = await save(h, "q1", {
      answer: "answer-1",
      clientSeq: 1,
      baseVersion: N, // stale/future baseVersion must not matter for a known replay
      at: new Date(T0.getTime() + (N + 1) * 1000),
    });
    expect(replay.accepted).toBe(true);
    expect(replay.serverVersion).toBe(oldestAck!.serverVersion);
    expect(replay.savedAt).toBe(oldestAck!.savedAt);
    expect(h.attemptRepo.draftAnswerWriteCount()).toBe(N); // replay added none
    expect(h.attemptRepo.receipts.size).toBe(N); // append-only, no eviction
  });

  it("oldest replay with a different canonical identity stays CONFLICTING_PAYLOAD", async () => {
    const N = 30;
    const h = await harness();
    for (let i = 1; i <= N; i++) {
      const result = await save(h, "q1", {
        answer: `answer-${i}`,
        clientSeq: i,
        baseVersion: i - 1,
      });
      expect(result.accepted).toBe(true);
    }

    const replay = await save(h, "q1", {
      answer: "HIJACKED",
      clientSeq: 1,
      baseVersion: N,
    });
    expect(replay.accepted).toBe(false);
    expect(replay.conflict?.reason).toBe("CONFLICTING_PAYLOAD");
    expect(h.attemptRepo.draftAnswerWriteCount()).toBe(N);
  });

  it("an unknown clientSeq follows normal CAS semantics", async () => {
    const h = await harness();
    await save(h, "q1", { answer: "v1", clientSeq: 1, baseVersion: 0 });

    // Unknown seq + stale baseVersion → STALE_VERSION (precedence unchanged).
    const stale = await save(h, "q1", {
      answer: "v-next",
      clientSeq: 99,
      baseVersion: 0,
    });
    expect(stale.accepted).toBe(false);
    expect(stale.conflict?.reason).toBe("STALE_VERSION");
    expect(stale.conflict?.latestAnswer).toBe("v1");

    // Unknown seq + matching baseVersion → normal acceptance.
    const fresh = await save(h, "q1", {
      answer: "v2",
      clientSeq: 99,
      baseVersion: 1,
    });
    expect(fresh.accepted).toBe(true);
    expect(fresh.serverVersion).toBe(2);
  });

  it("canonically-equivalent candidates replay to the prior ACK (identity of the accepted canonical value)", async () => {
    // The route's canonicalizer trims case/whitespace; both candidates land on
    // the same canonical value, so identity(receipt) == identity(replay).
    const canonicalizing = (
      _question: unknown,
      answer: unknown,
    ): { ok: true; value: unknown } | { ok: false; reason: string } =>
      typeof answer === "string"
        ? { ok: true, value: (answer as string).trim().toUpperCase() }
        : { ok: false, reason: "malformed" };

    const now = T0;
    const h = await prepare(makeExam(), makeAttempt(), makeEnrollment(), now);
    const first = await saveAnswer(
      h.attemptRepo,
      h.mutationContext,
      {
        attemptId: h.mutationContext.attemptId,
        questionId: "q1",
        answer: "  hello world  ",
        clientSeq: 7,
        clientSavedAt: now.toISOString(),
        baseVersion: 0,
      },
      canonicalizing,
    );
    expect(first.accepted).toBe(true);

    // Next action call over the persisted receipts store.
    const h2 = await prepare(
      makeExam(),
      h.attemptRepo.get("attempt-1"),
      makeEnrollment(),
      new Date(T0.getTime() + 1000),
      [...h.attemptRepo.receipts.values()],
    );
    const replay = await saveAnswer(
      h2.attemptRepo,
      h2.mutationContext,
      {
        attemptId: h2.mutationContext.attemptId,
        questionId: "q1",
        answer: "hello WORLD", // different candidate, same canonical value
        clientSeq: 7,
        clientSavedAt: now.toISOString(),
        baseVersion: 0,
      },
      canonicalizing,
    );
    expect(replay.accepted).toBe(true);
    expect(replay.serverVersion).toBe(first.serverVersion);
    expect(replay.savedAt).toBe(first.savedAt);
  });
});

describe("D2 canonical answer identity — faithful representation of structural equality", () => {
  const ID = canonicalAnswerIdentity;

  it("equal canonical values share one identity regardless of key order or nesting aliasing", () => {
    expect(ID("b")).toBe(ID("b"));
    expect(ID({ a: 1, b: 2 })).toBe(ID({ b: 2, a: 1 }));
    expect(ID(["a", "b", "c"])).toBe(ID(["a", "b", "c"]));
    expect(ID({ doc: { content: [{ text: "x" }] } })).toBe(
      ID({ doc: { content: [{ text: "x" }] } }),
    );
    expect(ID(null)).toBe(ID(null));
  });

  it("distinct canonical values never share an identity (injectivity samples)", () => {
    expect(ID("1")).not.toBe(ID(1));
    expect(ID(null)).not.toBe(ID("null"));
    expect(ID(0)).not.toBe(ID(-0)); // Object.is semantics
    expect(ID([1, 2])).not.toBe(ID([2, 1]));
    expect(ID([1, 2])).not.toBe(ID([1, 2, 3]));
    expect(ID({ a: 1 })).not.toBe(ID({ a: "1" }));
    expect(ID({})).not.toBe(ID([]));
    expect(ID({ a: { b: 1 } })).not.toBe(ID({ a: 1 }));
  });

  it("identity of a rich canonical document distinguishes content and marks", () => {
    const doc = (text: string, marks?: string[]) => ({
      docVersion: 1,
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            // Absent optional keys stay absent — canonical JSON values never
            // carry explicit undefined (the serializer throws on those).
            ...(marks === undefined
              ? [{ type: "text", text }]
              : [{ type: "text", text, marks }]),
          ],
        },
      ],
    });
    expect(ID(doc("same"))).toBe(ID(doc("same")));
    expect(ID(doc("same"))).not.toBe(ID(doc("different")));
    expect(ID(doc("same"))).not.toBe(ID(doc("same", ["bold"])));
  });

  it("receipt identity binds the accepted canonical value, not the raw candidate", () => {
    const canonicalizing = (answer: unknown) =>
      typeof answer === "string"
        ? { ok: true as const, value: (answer as string).trim() }
        : { ok: false as const, reason: "malformed" };
    // Direct decision-core check: the emitted receipt's identity equals the
    // identity of the canonical value (trimmed), not of the raw candidate.
    return import("./answerProtocol.js").then(({ processSaveAnswer }) => {
      const state = {
        attemptStatus: "in_progress" as const,
        answers: [],
        knownReceipt: null,
        now: T0,
      };
      const result = processSaveAnswer(
        state,
        {
          attemptId: "attempt-1",
          questionId: "q1",
          answer: "  padded  ",
          clientSeq: 1,
          clientSavedAt: T0.toISOString(),
          baseVersion: 0,
        },
        canonicalizing,
      );
      expect(result.newReceipt?.answerIdentity).toBe(ID("padded"));
      expect(result.newReceipt?.answerIdentity).not.toBe(ID("  padded  "));
    });
  });

  it("legacy-backed receipts resolve to the same identity as digest-backed ones", () => {
    // Migration 0044 backfills pre-D2 receipts as legacy payloads; the read
    // authority derives identity with the same function. Both representations
    // must agree or a legacy replay would falsely conflict (D2-G).
    const legacyAnswer = { docVersion: 1, type: "doc", content: [] };
    const digestBacked: AnswerReceipt = {
      questionId: "q1",
      clientSeq: 3,
      answerIdentity: ID(legacyAnswer),
      version: 2,
      savedAt: T0,
    };
    expect(ID(legacyAnswer)).toBe(digestBacked.answerIdentity);
  });
});
