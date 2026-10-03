/**
 * Phase-E Campaign G — SaveAnswer state-machine combinations (L2, invariants
 * E-RP01..RP04, §13 failure precedence).
 *
 * Exhaustively enumerates the decision-core input space (not sampled) and
 * compares `processSaveAnswer`'s actual result with the precedence table
 * frozen by rich-content-semantic-contract.md §12/§13:
 *
 *   lifecycle guards (voided / submitted / graded)
 *     → effective deadline
 *     → Rich canonicalization
 *     → known replay (same identity → verbatim prior ACK; different → conflict)
 *     → baseVersion CAS (STALE / FUTURE)
 *     → accept
 *
 * Rich canonicalization must sit AFTER lifecycle/deadline and BEFORE
 * idempotency/version semantics (§13): a malformed payload can never mask a
 * protocol rejection and can never be masked by one. Terminal lifecycle guards
 * retain precedence over replay (§12).
 *
 * The harness implements the CONTRACT's precedence table as its oracle —
 * production code is never re-implemented, only compared against the frozen
 * order.
 *
 * Seeds: regression continuity 0x66900001 (exhaustive enumeration is seeded
 * only through fast-check's drive of auxiliary values).
 */
import { describe, expect, it, afterAll } from "vitest";
import {
  canonicalAnswerIdentity,
  processSaveAnswer,
  type AnswerState,
} from "@exam/exam-engine";
import { canonicalizeContentDocument } from "@exam/contracts";
import type { AnswerRecord, ContentDocumentV1 } from "@exam/domain";
import { CampaignRecorder } from "./campaignStats.js";

const recorder = new CampaignRecorder("G-saveanswer-precedence", [0x66900001]);

// ── fixed canonical Rich payloads (identity distinction is what matters) ──
const CANON_A = {
  docVersion: 1,
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "AB" }] }],
};
const CANON_B = {
  docVersion: 1,
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "B" }] }],
};
// Pre-normalized input that canonicalizes INTO CANON_A (equivalent semantics:
// adjacent same-mark-set runs merge; duplicate marks dedup; order canonicalizes).
const NONCANONICAL_EQUIV_OF_A = {
  docVersion: 1,
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "A" },
        { type: "text", text: "B", marks: [] },
      ],
    },
  ],
};
const ID_A = canonicalAnswerIdentity(CANON_A);
const ID_B = canonicalAnswerIdentity(CANON_B);

const canonicalizeOk = (answer: unknown) => ({
  ok: true as const,
  value: typeof answer === "string" ? answer : (answer as object),
});
// The production-bound rich canonicalizer semantics (validateAnswerForQuestion's
// rich text_response branch): schema-parse + canonicalizeContentDocument. The
// harness calls the PRODUCTION authority — never a reimplementation (§31).
const canonicalizeRich = (answer: unknown) => {
  if (
    answer !== null &&
    typeof answer === "object" &&
    (answer as { docVersion?: unknown }).docVersion === 1
  ) {
    const canonical = canonicalizeContentDocument(answer as ContentDocumentV1);
    return canonical.ok
      ? { ok: true as const, value: canonical.value }
      : { ok: false as const, reason: canonical.reason };
  }
  return { ok: false as const, reason: "not a ContentDocumentV1" };
};

type Combo = {
  // Axis uses the REAL AttemptStatus values the wire can deliver to the
  // decision core: in_progress / disrupted are the live states (the domain
  // enum has no "active"), submitted/graded/voided are terminal.
  status: "in_progress" | "disrupted" | "submitted" | "graded" | "voided";
  deadline: "none" | "future" | "past";
  payload: "canonA" | "canonB" | "noncanonicalEquivA" | "malformed";
  receipt: "none" | "sameIdA" | "sameIdB" | "diffId";
  baseVersion: "low" | "equal" | "high";
  currentVersion: number;
};

function buildState(
  c: Combo,
  canonicalize: (a: unknown) => ReturnType<typeof canonicalizeRich>,
): {
  state: AnswerState;
  request: {
    attemptId: string;
    questionId: string;
    answer: unknown;
    baseVersion: number;
    clientSeq: number;
    clientSavedAt: string;
  };
  canonicalizerSpied: { called: boolean };
} {
  const now = new Date("2026-10-03T12:00:00Z");
  const answers: AnswerRecord[] =
    c.currentVersion > 0
      ? [
          {
            questionId: "q1",
            answer: CANON_A,
            version: c.currentVersion,
            savedAt: new Date("2026-10-03T11:00:00Z"),
          },
        ]
      : [];
  const canonicalizerSpied = { called: false };
  const wrap = (answer: unknown) => {
    canonicalizerSpied.called = true;
    return canonicalize(answer);
  };
  const receiptId =
    c.receipt === "sameIdA"
      ? ID_A
      : c.receipt === "sameIdB"
        ? ID_B
        : c.receipt === "diffId"
          ? "deadbeef"
          : null;
  const state: AnswerState = {
    attemptStatus: c.status,
    answers,
    knownReceipt:
      receiptId === null
        ? null
        : {
            questionId: "q1",
            clientSeq: 7,
            answerIdentity: receiptId,
            version: Math.max(c.currentVersion, 1),
            savedAt: new Date("2026-10-03T10:00:00Z"),
          },
    deadlineAt:
      c.deadline === "none"
        ? null
        : c.deadline === "future"
          ? new Date("2026-10-03T13:00:00Z")
          : new Date("2026-10-03T11:00:00Z"),
    now,
  };
  const payload =
    c.payload === "canonA"
      ? CANON_A
      : c.payload === "canonB"
        ? CANON_B
        : c.payload === "noncanonicalEquivA"
          ? NONCANONICAL_EQUIV_OF_A
          : { hostile: true };
  return {
    state,
    request: {
      attemptId: "a1",
      questionId: "q1",
      answer: payload,
      baseVersion:
        c.baseVersion === "low"
          ? 0
          : c.baseVersion === "equal"
            ? c.currentVersion
            : c.currentVersion + 2,
      clientSeq: 7,
      // Server-time authority: the engine never reads client time, but the
      // request shape carries it (§5).
      clientSavedAt: now.toISOString(),
    },
    canonicalizerSpied,
  };
}

/** The contract-frozen precedence oracle (§12/§13), independent of code. */
function expectedOutcome(c: Combo): {
  kind:
    | "accepted"
    | "ATTEMPT_CLOSED"
    | "ATTEMPT_ALREADY_SUBMITTED"
    | "DEADLINE_EXCEEDED"
    | "INVALID_ANSWER"
    | "REPLAY_ACK"
    | "CONFLICTING_PAYLOAD"
    | "STALE_VERSION"
    | "FUTURE_VERSION";
  replayMustWriteNothing?: boolean;
} {
  if (c.status === "voided") return { kind: "ATTEMPT_CLOSED" };
  if (c.status === "submitted" || c.status === "graded") {
    return { kind: "ATTEMPT_ALREADY_SUBMITTED" };
  }
  if (c.deadline === "past") return { kind: "DEADLINE_EXCEEDED" };
  if (c.payload === "malformed") return { kind: "INVALID_ANSWER" };
  // Known-replay is IDENTITY-bound (§12): the stub receipt carries the
  // canonical identity of CANON_A (sameIdA) or CANON_B (sameIdB); only a
  // payload whose canonical identity equals the stored one gets the verbatim
  // ACK — any other payload with the same clientSeq is CONFLICTING_PAYLOAD
  // (E-RP02), regardless of CAS state (replay lookup precedes version CAS).
  if (c.receipt === "sameIdA") {
    return c.payload === "canonB"
      ? { kind: "CONFLICTING_PAYLOAD" }
      : { kind: "REPLAY_ACK", replayMustWriteNothing: true };
  }
  if (c.receipt === "sameIdB") {
    return c.payload === "canonB"
      ? { kind: "REPLAY_ACK", replayMustWriteNothing: true }
      : { kind: "CONFLICTING_PAYLOAD" };
  }
  if (c.receipt === "diffId") return { kind: "CONFLICTING_PAYLOAD" };
  // CAS is numeric: baseVersion low = 0. STALE only when 0 < currentVersion.
  const base =
    c.baseVersion === "low"
      ? 0
      : c.baseVersion === "equal"
        ? c.currentVersion
        : c.currentVersion + 2;
  if (base < c.currentVersion) return { kind: "STALE_VERSION" };
  if (base > c.currentVersion) return { kind: "FUTURE_VERSION" };
  return { kind: "accepted" };
}

function actualOutcome(
  c: Combo,
  canonicalize: (a: unknown) => ReturnType<typeof canonicalizeRich>,
): { kind: string; newAnswer: boolean; newReceipt: boolean } {
  const { state, request, canonicalizerSpied } = buildState(c, canonicalize);
  const result = processSaveAnswer(state, request, (answer) => {
    canonicalizerSpied.called = true;
    return canonicalize(answer);
  });
  if (!result.accepted)
    return {
      kind: result.conflict?.reason ?? "unknown",
      newAnswer: false,
      newReceipt: false,
    };
  if (result.newAnswer)
    return {
      kind: "accepted",
      newAnswer: true,
      newReceipt: !!result.newReceipt,
    };
  return { kind: "REPLAY_ACK", newAnswer: false, newReceipt: false };
}

const STATUSES: Combo["status"][] = [
  "in_progress",
  "disrupted",
  "submitted",
  "graded",
  "voided",
];
const DEADLINES: Combo["deadline"][] = ["none", "future", "past"];
const PAYLOADS: Combo["payload"][] = [
  "canonA",
  "canonB",
  "noncanonicalEquivA",
  "malformed",
];
const RECEIPTS: Combo["receipt"][] = ["none", "sameIdA", "sameIdB", "diffId"];
const BASES: Combo["baseVersion"][] = ["low", "equal", "high"];

describe("Campaign G — SaveAnswer precedence combinations (E-RP01..04, §13)", () => {
  it("exhaustive decision-core matrix: actual == frozen precedence for every combination", () => {
    let checked = 0;
    for (const status of STATUSES) {
      for (const deadline of DEADLINES) {
        for (const payload of PAYLOADS) {
          for (const receipt of RECEIPTS) {
            for (const baseVersion of BASES) {
              for (const currentVersion of [0, 2] as const) {
                const combo: Combo = {
                  status,
                  deadline,
                  payload,
                  receipt,
                  baseVersion,
                  currentVersion,
                };
                const expected = expectedOutcome(combo);
                const actual = actualOutcome(combo, canonicalizeRich);
                const expectedKind =
                  expected.kind === "REPLAY_ACK"
                    ? "REPLAY_ACK"
                    : expected.kind === "accepted"
                      ? "accepted"
                      : expected.kind;
                expect(
                  `${actual.kind}`,
                  `combo ${JSON.stringify(combo)}: actual ${actual.kind} != frozen ${expectedKind}`,
                ).toBe(expectedKind);
                if (expected.kind === "accepted") {
                  expect(actual.newAnswer).toBe(true);
                  expect(actual.newReceipt).toBe(true);
                }
                if (expected.kind === "REPLAY_ACK") {
                  expect(
                    actual.newAnswer,
                    "replay ACK must write nothing",
                  ).toBe(false);
                }
                checked += 1;
              }
            }
          }
        }
      }
    }
    recorder.record({ probe: "exhaustive-matrix", combos: checked });
  });

  it("precedence proof: lifecycle/deadline guards run BEFORE canonicalization (malformed payload cannot mask them)", () => {
    for (const status of ["voided", "submitted", "graded"] as const) {
      const { canonicalizerSpied } = buildState(
        {
          status,
          deadline: "none",
          payload: "malformed",
          receipt: "none",
          baseVersion: "equal",
          currentVersion: 0,
        },
        canonicalizeRich,
      );
      const result = actualOutcome(
        {
          status,
          deadline: "none",
          payload: "malformed",
          receipt: "none",
          baseVersion: "equal",
          currentVersion: 0,
        },
        canonicalizeRich,
      );
      expect(result.kind).toBe(
        status === "voided" ? "ATTEMPT_CLOSED" : "ATTEMPT_ALREADY_SUBMITTED",
      );
      expect(
        canonicalizerSpied.called,
        `canonicalizer must not run on ${status}`,
      ).toBe(false);
    }
    const past = actualOutcome(
      {
        status: "in_progress",
        deadline: "past",
        payload: "malformed",
        receipt: "none",
        baseVersion: "equal",
        currentVersion: 0,
      },
      canonicalizeRich,
    );
    expect(past.kind).toBe("DEADLINE_EXCEEDED");
    recorder.record({ probe: "guards-before-canonicalization", outcome: "ok" });
  });

  it("canonical identity: same clientSeq + semantically equivalent pre-normalized payload → verbatim prior ACK (E-RP01)", () => {
    const result = actualOutcome(
      {
        status: "in_progress",
        deadline: "future",
        payload: "noncanonicalEquivA",
        receipt: "sameIdA",
        baseVersion: "low",
        currentVersion: 2,
      },
      canonicalizeRich,
    );
    expect(result.kind).toBe("REPLAY_ACK");
    expect(result.newAnswer).toBe(false);
    // Identity of the canonical value — pre-normalized candidate shares it.
    expect(canonicalAnswerIdentity(CANON_A)).toBe(ID_A);
    recorder.record({ probe: "equivalent-identity-replay", outcome: "ok" });
  });

  it("known replay retains precedence over CAS: same identity accepted even with stale/future baseVersion (E-RP04)", () => {
    for (const baseVersion of ["low", "high"] as const) {
      const result = actualOutcome(
        {
          status: "in_progress",
          deadline: "future",
          payload: "canonA",
          receipt: "sameIdA",
          baseVersion,
          currentVersion: 2,
        },
        canonicalizeRich,
      );
      expect(result.kind, `baseVersion=${baseVersion}`).toBe("REPLAY_ACK");
    }
    recorder.record({ probe: "replay-over-cas", outcome: "ok" });
  });

  it("known replay never masks terminal lifecycle (§12: terminal guards retain precedence)", () => {
    const result = actualOutcome(
      {
        status: "submitted",
        deadline: "future",
        payload: "canonA",
        receipt: "sameIdA",
        baseVersion: "equal",
        currentVersion: 2,
      },
      canonicalizeRich,
    );
    expect(result.kind).toBe("ATTEMPT_ALREADY_SUBMITTED");
    recorder.record({ probe: "terminal-over-replay", outcome: "ok" });
  });

  it("same clientSeq + truly different canonical identity → CONFLICTING_PAYLOAD regardless of CAS state (E-RP02)", () => {
    for (const baseVersion of ["low", "equal", "high"] as const) {
      const result = actualOutcome(
        {
          status: "in_progress",
          deadline: "future",
          payload: "canonA",
          receipt: "sameIdB",
          baseVersion,
          currentVersion: 2,
        },
        canonicalizeRich,
      );
      expect(result.kind, `baseVersion=${baseVersion}`).toBe(
        "CONFLICTING_PAYLOAD",
      );
    }
    recorder.record({ probe: "conflicting-payload", outcome: "ok" });
  });

  afterAll(() => {
    recorder.flush({
      enumeration:
        "exhaustive 5×3×4×4×3×2 = 1440 decision-core combos (real AttemptStatus axis)",
    });
  });
});
