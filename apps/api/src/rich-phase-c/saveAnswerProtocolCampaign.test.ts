/**
 * Phase-C Campaign E (#669) — SaveAnswer protocol interaction.
 *
 * Uses the production SaveAnswer decision core (`processSaveAnswer`) and the
 * production Rich canonicalizer (`validateAnswerForQuestion`) exactly as the
 * API route binds them (engine owns WHEN, caller owns HOW). No state machine
 * is reinvented; the frozen precedence under test (contract §13):
 *
 *   authz/route → deadline → terminal lifecycle → Rich canonicalization →
 *   known replay → baseVersion CAS → accept
 *
 * Frozen replay semantics (contract §12):
 *   same accepted clientSeq + same canonical identity → prior ACK, zero write
 *   same accepted clientSeq + different canonical identity → CONFLICTING_PAYLOAD
 *   unknown clientSeq → normal CAS/version semantics
 */

import { describe, expect, it } from "vitest";
import type {
  AnswerRecord,
  QuestionSnapshot,
  SaveAnswerRequest,
} from "@exam/domain";
import { processSaveAnswer, type AnswerState } from "@exam/exam-engine";
import { validateAnswerForQuestion } from "../lib/validateAnswerForQuestion.js";
import { structuralEqual } from "./generators.js";

const RICH_Q: QuestionSnapshot = {
  originalQuestionId: "q-rich",
  type: "text_response",
  content: "q",
  contentDocument: null,
  answerMode: "rich",
  attachments: [],
  options: [],
  standardAnswer: null,
  score: 10,
  gradingRule: {
    multiSelectScoring: "all_correct_full",
    fillBlankMatchMode: "exact",
  },
  order: 0,
  rubric: null,
};

const canonicalize = (answer: unknown) =>
  validateAnswerForQuestion(RICH_Q, answer);

function docOf(...runs: string[]): unknown {
  return {
    docVersion: 1,
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: runs.map((text) => ({ type: "text", text })),
      },
    ],
  };
}

const VALID_A = docOf("answer a");
// Canonically EQUIVALENT transient form of VALID_A (normalization merges "answer " + "a").
const VALID_A_TRANSIENT = docOf("answer ", "a");
// Canonically DIFFERENT valid rich doc.
const VALID_B = docOf("answer b");
const INVALID_RICH = {
  docVersion: 1,
  type: "doc",
  content: [{ type: "nope" }],
};

function baseRequest(overrides: Partial<SaveAnswerRequest>): SaveAnswerRequest {
  return {
    attemptId: "a1",
    questionId: "q-rich",
    answer: VALID_A,
    clientSeq: 1,
    clientSavedAt: new Date(0).toISOString(),
    baseVersion: 0,
    ...overrides,
  };
}

function state(overrides: Partial<AnswerState> = {}): AnswerState {
  return {
    attemptStatus: "in_progress",
    answers: [],
    clientSeqMap: new Map(),
    deadlineAt: null,
    now: new Date(1000),
    ...overrides,
  };
}

function record(answer: unknown, version: number): AnswerRecord {
  return { questionId: "q-rich", answer, version, savedAt: new Date(500) };
}

describe("Phase-C Campaign E — SaveAnswer × Rich canonicalization", () => {
  it("accept path persists the CANONICAL value, not the transient request value", () => {
    const result = processSaveAnswer(
      state(),
      baseRequest({ answer: VALID_A_TRANSIENT }),
      canonicalize,
    );
    expect(result.accepted).toBe(true);
    expect(result.newAnswer).toBeDefined();
    const persisted = (result.newAnswer as AnswerRecord).answer;
    // The transient split form must have been canonicalized (merged).
    expect(structuralEqual(persisted, VALID_A)).toBe(true);
  });

  it("terminal lifecycle keeps precedence over Rich validation (malformed payload cannot mask it)", () => {
    let canonicalizerCalls = 0;
    const spy = (answer: unknown) => {
      canonicalizerCalls += 1;
      return canonicalize(answer);
    };
    const voided = processSaveAnswer(
      state({ attemptStatus: "voided" }),
      baseRequest({ answer: INVALID_RICH }),
      spy,
    );
    expect(voided.conflict?.reason).toBe("ATTEMPT_CLOSED");
    const submitted = processSaveAnswer(
      state({ attemptStatus: "submitted" }),
      baseRequest({ answer: INVALID_RICH }),
      spy,
    );
    expect(submitted.conflict?.reason).toBe("ATTEMPT_ALREADY_SUBMITTED");
    expect(canonicalizerCalls).toBe(0);
  });

  it("effective deadline keeps precedence over Rich validation (valid and invalid payloads alike)", () => {
    const expired = state({ deadlineAt: new Date(500), now: new Date(1000) });
    const invalid = processSaveAnswer(
      expired,
      baseRequest({ answer: INVALID_RICH }),
      canonicalize,
    );
    expect(invalid.conflict?.reason).toBe("DEADLINE_EXCEEDED");
    const valid = processSaveAnswer(
      expired,
      baseRequest({ answer: VALID_A }),
      canonicalize,
    );
    expect(valid.conflict?.reason).toBe("DEADLINE_EXCEEDED");
  });

  it("deadline equality boundary: now == deadline is expired (frozen canonical predicate)", () => {
    const atDeadline = state({
      deadlineAt: new Date(1000),
      now: new Date(1000),
    });
    expect(
      processSaveAnswer(atDeadline, baseRequest({}), canonicalize).conflict
        ?.reason,
    ).toBe("DEADLINE_EXCEEDED");
    const before = state({ deadlineAt: new Date(1001), now: new Date(1000) });
    expect(
      processSaveAnswer(before, baseRequest({}), canonicalize).accepted,
    ).toBe(true);
  });

  it("malformed payload after guards → INVALID_ANSWER echoing the current version (never masks, never masks others)", () => {
    const withExisting = state({
      answers: [
        {
          ...record(VALID_A, 3),
          clientSeq: 1,
          clientSeqHistory: [],
        } as unknown as AnswerRecord,
      ],
      clientSeqMap: new Map([["q-rich:1", record(VALID_A, 3)]]),
    });
    const result = processSaveAnswer(
      withExisting,
      baseRequest({ answer: INVALID_RICH, clientSeq: 1 }),
      canonicalize,
    );
    expect(result.conflict?.reason).toBe("INVALID_ANSWER");
    expect(result.serverVersion).toBe(3);
  });

  it("canonical identity drives replay: canonically-equivalent transient re-send replays with prior ACK, zero write", () => {
    const prior = record(VALID_A, 1);
    const s = state({
      answers: [
        {
          ...prior,
          clientSeq: 1,
          clientSeqHistory: [],
        } as unknown as AnswerRecord,
      ],
      clientSeqMap: new Map([["q-rich:1", prior]]),
    });
    const result = processSaveAnswer(
      s,
      baseRequest({ answer: VALID_A_TRANSIENT, clientSeq: 1, baseVersion: 1 }),
      canonicalize,
    );
    expect(result.accepted).toBe(true);
    expect(result.newAnswer).toBeUndefined();
    expect(result.serverVersion).toBe(1);
    expect(result.savedAt).toBe(new Date(500).toISOString());
  });

  it("same accepted clientSeq + canonically different payload → CONFLICTING_PAYLOAD carrying the prior canonical value", () => {
    const prior = record(VALID_A, 2);
    const s = state({
      answers: [
        {
          ...prior,
          clientSeq: 1,
          clientSeqHistory: [],
        } as unknown as AnswerRecord,
      ],
      clientSeqMap: new Map([["q-rich:1", prior]]),
    });
    const result = processSaveAnswer(
      s,
      baseRequest({ answer: VALID_B, clientSeq: 1 }),
      canonicalize,
    );
    expect(result.accepted).toBe(false);
    expect(result.conflict).toMatchObject({ reason: "CONFLICTING_PAYLOAD" });
    expect(
      structuralEqual(
        (result.conflict as { latestAnswer: unknown }).latestAnswer,
        VALID_A,
      ),
    ).toBe(true);
  });

  it("malformed retry of an accepted clientSeq → INVALID_ANSWER (canonicalization precedes replay lookup)", () => {
    const prior = record(VALID_A, 1);
    const s = state({
      clientSeqMap: new Map([["q-rich:1", prior]]),
    });
    const result = processSaveAnswer(
      s,
      baseRequest({ answer: INVALID_RICH, clientSeq: 1 }),
      canonicalize,
    );
    expect(result.conflict?.reason).toBe("INVALID_ANSWER");
  });

  it("unknown clientSeq follows CAS: stale → STALE_VERSION, future → FUTURE_VERSION, exact → accept", () => {
    const existing = state({ answers: [record(VALID_A, 3)] });
    const stale = processSaveAnswer(
      existing,
      baseRequest({ clientSeq: 9, baseVersion: 2 }),
      canonicalize,
    );
    expect(stale.conflict?.reason).toBe("STALE_VERSION");
    const future = processSaveAnswer(
      existing,
      baseRequest({ clientSeq: 9, baseVersion: 4 }),
      canonicalize,
    );
    expect(future.conflict?.reason).toBe("FUTURE_VERSION");
    const exact = processSaveAnswer(
      existing,
      baseRequest({ clientSeq: 9, baseVersion: 3 }),
      canonicalize,
    );
    expect(exact.accepted).toBe(true);
    expect(exact.serverVersion).toBe(4);
  });

  it("B-F01 interaction: an over-limit canonical draft is accepted once, replays identically, and is served verbatim as STALE_VERSION latestAnswer", () => {
    // Save the B-F01 seed with clientSeq 1 → canonical (over-limit) value persisted.
    const b01 = docOf("a".repeat(20000), "b");
    const first = processSaveAnswer(
      state(),
      baseRequest({ answer: b01, clientSeq: 1 }),
      canonicalize,
    );
    expect(first.accepted).toBe(true);
    const canonicalDraft = (first.newAnswer as AnswerRecord).answer;
    expect(ContentDocumentV1SchemaSafe(canonicalDraft)).toBe(false);

    // Replay of the same seq with the same input: deterministic canonicalization
    // yields the same (over-limit) canonical → structural equality → prior ACK.
    const prior = record(canonicalDraft, 1);
    const replayState = state({
      answers: [
        {
          ...prior,
          clientSeq: 1,
          clientSeqHistory: [],
        } as unknown as AnswerRecord,
      ],
      clientSeqMap: new Map([["q-rich:1", prior]]),
    });
    const replay = processSaveAnswer(
      replayState,
      baseRequest({ answer: b01, clientSeq: 1, baseVersion: 1 }),
      canonicalize,
    );
    expect(replay.accepted).toBe(true);
    expect(replay.newAnswer).toBeUndefined();

    // A different question save later makes baseVersion stale; STALE_VERSION
    // then carries the over-limit canonical draft to the wire as latestAnswer
    // (production route maps it into details.serverAnswer for client adoption).
    const stale = processSaveAnswer(
      state({ answers: [record(canonicalDraft, 2)] }),
      baseRequest({ answer: VALID_A, clientSeq: 5, baseVersion: 1 }),
      canonicalize,
    );
    expect(stale.conflict?.reason).toBe("STALE_VERSION");
    expect(
      structuralEqual(
        (stale.conflict as { latestAnswer: unknown }).latestAnswer,
        canonicalDraft,
      ),
    ).toBe(true);
  });
});

import { ContentDocumentV1Schema } from "@exam/contracts";
function ContentDocumentV1SchemaSafe(value: unknown): boolean {
  return ContentDocumentV1Schema.safeParse(value).success;
}
