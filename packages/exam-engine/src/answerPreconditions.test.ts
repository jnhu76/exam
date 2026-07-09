import { describe, expect, it } from "vitest";
import type { Exam } from "@exam/domain";
import { ValidationError } from "@exam/domain";
import { saveAnswer } from "./answerProtocol.js";
import type { ReconciledAttemptMutationContext } from "./attemptMutationContext.js";
import {
  makeExam,
  makeAttempt,
  makeEnrollment,
  makeAttemptRepo,
  makeManualSnapshot,
  prepare,
} from "./attemptMutation.testHelpers.js";
import { computeEffectiveDeadline } from "./deadlineReconciliation.js";

// EXAM-ANSWER-PRECONDITION-CORRECTIVE-0 — tests for the explicit answer-mutation
// precondition topology (P1 membership, P2 row-serialization repo affinity,
// P3 canonical effective deadline). The canonical `saveAnswer` action consumes
// an opaque `ReconciledAttemptMutationContext` minted by the preparation seam,
// and the pure decision uses the canonical effective deadline.
//
// RED note (recorded before implementation): before the corrective, `saveAnswer`
// had signature saveAnswer(attemptRepo, attemptId, request, now), accepted and
// persisted non-member questions, used attempt.deadlineAt, and accepted saves in
// the reachable `exam.closeAt < now < attempt.deadlineAt` window. These tests
// are written against the CORRECTED API and turned RED on the pre-corrective
// code (11 failing: `prepareReconciledAttemptMutation is not a function` +
// signature mismatch).

describe("EXAM-ANSWER-PRECONDITION-CORRECTIVE-0", () => {
  it("4.1 P1 — non-member question is rejected inside saveAnswer with zero write (same ValidationError semantics as old route)", async () => {
    const now = new Date("2025-01-01T10:05:00Z");
    const h = await prepare(makeExam(), makeAttempt(), makeEnrollment(), now);
    const before = h.attemptRepo.get("attempt-1").answers;

    // Non-member question — NOT in attempt.questionSnapshot. The Save Answer
    // command itself must be illegal (§9), preserving the old route's
    // ValidationError error semantics (§1.8 forbids enum expansion).
    let caught: unknown;
    try {
      await saveAnswer(h.attemptRepo, h.mutationContext, {
        attemptId: "attempt-1",
        questionId: "q-NOT-IN-SNAPSHOT",
        answer: "x",
        clientSeq: 1,
        clientSavedAt: now.toISOString(),
        baseVersion: 0,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ValidationError);

    // Required negative proof: zero attempt.answers write.
    expect(h.attemptRepo.draftAnswerWriteCount()).toBe(0);
    expect(h.attemptRepo.get("attempt-1").answers).toBe(before);
  });

  it("4.2 P3 — late-start attempt (deadlineAt > exam.closeAt): preparation seam freezes at the canonical effective deadline and saveAnswer does NOT write", async () => {
    // Reachable adversarial shape: candidate started at 09:55 for a 90-min exam
    // closing at 10:00 → deadlineAt = 11:25 > exam.closeAt = 10:00. The
    // canonical effective deadline = min(10:00, 11:25) = 10:00.
    //
    // A manual-grading snapshot lets the reconciliation seam freeze cleanly to
    // `pending_manual` (no grading aggregation), so the post-freeze saveAnswer
    // behavior is observable. The pure DEADLINE_EXCEEDED boundary (now ===
    // effectiveDeadline) is proven at the pure-decision level in
    // answerProtocol.test.ts; this test proves the canonical effective deadline
    // is the one enforced over the reachable `deadlineAt > exam.closeAt` state.
    const examCloseAt = new Date("2025-01-01T10:00:00Z");
    const now = new Date("2025-01-01T10:10:00Z");
    const exam = makeExam({ closeAt: examCloseAt });
    const attempt = makeAttempt({
      questionSnapshot: makeManualSnapshot(),
      deadlineAt: new Date("2025-01-01T11:25:00Z"),
    });
    const h = await prepare(exam, attempt, makeEnrollment(), now);

    // Canonical effective deadline = min(10:00, 11:25) = 10:00 — the context
    // carries the canonical value, NOT attempt.deadlineAt (11:25).
    expect(
      computeEffectiveDeadline(
        h.examRepo.findById("exam-1") as Exam,
        h.attempt,
      ).getTime(),
    ).toBe(examCloseAt.getTime());
    expect(h.mutationContext.effectiveDeadline.getTime()).toBe(
      examCloseAt.getTime(),
    );
    // The preparation seam froze the attempt at the canonical effective deadline.
    expect(h.attempt.status).toBe("submitted");

    const result = await saveAnswer(h.attemptRepo, h.mutationContext, {
      attemptId: "attempt-1",
      questionId: "q1",
      answer: "b",
      clientSeq: 1,
      clientSavedAt: now.toISOString(),
      baseVersion: 0,
    });

    // Required proof: no draft answer write after the effective deadline. The
    // preparation seam's lifecycle freeze (status/submittedAnswers) is NOT a
    // draft `answers` write; the save action must not mutate draft answers.
    expect(result.accepted).toBe(false);
    expect(h.attemptRepo.draftAnswerWriteCount()).toBe(0);
  });

  it("4.3 exact boundary — now === canonical effectiveDeadline closes mutation safety (pure decision proof in answerProtocol.test.ts; composition freezes here)", async () => {
    // At now === effectiveDeadline the canonical expiry predicate is true
    // (now >= effectiveDeadline). The preparation seam therefore freezes the
    // attempt before saveAnswer runs. This composition-level test proves no
    // write occurs at the boundary; the pure-decision DEADLINE_EXCEEDED at
    // now === deadline is proven directly in answerProtocol.test.ts
    // ("rejects save when now equals deadline exactly").
    const examCloseAt = new Date("2025-01-01T10:00:00Z");
    const now = new Date("2025-01-01T10:00:00Z"); // exactly === effective deadline
    const exam = makeExam({ closeAt: examCloseAt });
    const attempt = makeAttempt({
      questionSnapshot: makeManualSnapshot(),
      deadlineAt: examCloseAt, // effectiveDeadline = 10:00; now === it
    });
    const h = await prepare(exam, attempt, makeEnrollment(), now);

    expect(h.mutationContext.effectiveDeadline.getTime()).toBe(
      examCloseAt.getTime(),
    );
    expect(h.mutationContext.checkedAt.getTime()).toBe(now.getTime());
    // Frozen at the boundary.
    expect(h.attempt.status).toBe("submitted");

    const result = await saveAnswer(h.attemptRepo, h.mutationContext, {
      attemptId: "attempt-1",
      questionId: "q1",
      answer: "b",
      clientSeq: 1,
      clientSavedAt: now.toISOString(),
      baseVersion: 0,
    });

    expect(result.accepted).toBe(false);
    expect(h.attemptRepo.draftAnswerWriteCount()).toBe(0);
  });

  it("4.4 P2 — mutation context used with a different AttemptRepository object rejects at runtime", async () => {
    const now = new Date("2025-01-01T10:05:00Z");
    const h = await prepare(makeExam(), makeAttempt(), makeEnrollment(), now);

    // A DIFFERENT repo object than the one the context was minted against.
    const otherRepo = makeAttemptRepo([makeAttempt()]);

    // Await + try/catch (rather than rejects.toThrow) so the rejected promise
    // is deterministically handled before vitest's unhandled-rejection detector.
    let caught: unknown;
    try {
      await saveAnswer(otherRepo, h.mutationContext, {
        attemptId: "attempt-1",
        questionId: "q1",
        answer: "b",
        clientSeq: 1,
        clientSavedAt: now.toISOString(),
        baseVersion: 0,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(String(caught)).toMatch(/affinity/i);
    // The wrong repo must not be written.
    expect(otherRepo.updateCalls).toHaveLength(0);
  });

  it("4.5 type-level — saveAnswer cannot be called without a mutation context (signature requires it)", () => {
    // This is a compile-time property. We assert the runtime signature shape:
    // the second positional argument must be the opaque mutation context, and
    // a bare `saveAnswer(repo, attemptId, request, now)` call must NOT be the
    // supported shape. Verified statically by tsc via the new signature; the
    // runtime affinity guard is exercised in 4.4. Here we only assert the
    // action is exported with the corrected arity.
    expect(typeof saveAnswer).toBe("function");
  });

  it("context is bound to the exact attempt identity — mismatched attemptId rejects", async () => {
    const now = new Date("2025-01-01T10:05:00Z");
    const h = await prepare(makeExam(), makeAttempt(), makeEnrollment(), now);

    // Request names a DIFFERENT attemptId than the context was minted for.
    let caught: unknown;
    try {
      await saveAnswer(h.attemptRepo, h.mutationContext, {
        attemptId: "attempt-OTHER",
        questionId: "q1",
        answer: "b",
        clientSeq: 1,
        clientSavedAt: now.toISOString(),
        baseVersion: 0,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(h.attemptRepo.draftAnswerWriteCount()).toBe(0);
  });

  it("regression — accepted save semantics preserved with the corrected signature", async () => {
    const now = new Date("2025-01-01T10:05:00Z");
    const h = await prepare(makeExam(), makeAttempt(), makeEnrollment(), now);

    const result = await saveAnswer(h.attemptRepo, h.mutationContext, {
      attemptId: "attempt-1",
      questionId: "q1",
      answer: "b",
      clientSeq: 1,
      clientSavedAt: now.toISOString(),
      baseVersion: 0,
    });

    expect(result.accepted).toBe(true);
    expect(result.serverVersion).toBe(1);
    expect(h.attemptRepo.updateCalls).toHaveLength(1);
    expect(h.attemptRepo.get("attempt-1").answers[0]).toMatchObject({
      questionId: "q1",
      answer: "b",
      version: 1,
    });
  });

  it("regression — stale version semantics preserved", async () => {
    const now = new Date("2025-01-01T10:05:00Z");
    const existing = {
      questionId: "q1",
      answer: "c",
      version: 2,
      savedAt: new Date("2025-01-01T10:04:00Z"),
      clientSeq: 2,
      clientSeqHistory: [
        {
          clientSeq: 2,
          answer: "c",
          version: 2,
          savedAt: new Date("2025-01-01T10:04:00Z"),
        },
      ],
    };
    const h = await prepare(
      makeExam(),
      makeAttempt({ answers: [existing] }),
      makeEnrollment(),
      now,
    );

    const result = await saveAnswer(h.attemptRepo, h.mutationContext, {
      attemptId: "attempt-1",
      questionId: "q1",
      answer: "x",
      clientSeq: 3,
      clientSavedAt: now.toISOString(),
      baseVersion: 1,
    });

    expect(result.accepted).toBe(false);
    expect(result.conflict?.reason).toBe("STALE_VERSION");
    expect(h.attemptRepo.updateCalls).toHaveLength(0);
  });

  it("regression — idempotent replay performs no write", async () => {
    const originalSavedAt = new Date("2025-01-01T10:04:00Z");
    const now = new Date("2025-01-01T10:05:00Z");
    const existing = {
      questionId: "q1",
      answer: "b",
      version: 1,
      savedAt: originalSavedAt,
      clientSeq: 1,
      clientSeqHistory: [
        {
          clientSeq: 1,
          answer: "b",
          version: 1,
          savedAt: originalSavedAt,
        },
      ],
    };
    const h = await prepare(
      makeExam(),
      makeAttempt({ answers: [existing] }),
      makeEnrollment(),
      now,
    );

    const result = await saveAnswer(h.attemptRepo, h.mutationContext, {
      attemptId: "attempt-1",
      questionId: "q1",
      answer: "b",
      clientSeq: 1,
      clientSavedAt: now.toISOString(),
      baseVersion: 0,
    });

    expect(result.accepted).toBe(true);
    expect(result.savedAt).toBe(originalSavedAt.toISOString());
    expect(h.attemptRepo.updateCalls).toHaveLength(0);
  });

  it("regression — conflicting payload semantics preserved", async () => {
    const now = new Date("2025-01-01T10:05:00Z");
    const originalSavedAt = new Date("2025-01-01T10:04:00Z");
    const existing = {
      questionId: "q1",
      answer: "b",
      version: 1,
      savedAt: originalSavedAt,
      clientSeq: 1,
      clientSeqHistory: [
        {
          clientSeq: 1,
          answer: "b",
          version: 1,
          savedAt: originalSavedAt,
        },
      ],
    };
    const h = await prepare(
      makeExam(),
      makeAttempt({ answers: [existing] }),
      makeEnrollment(),
      now,
    );

    const result = await saveAnswer(h.attemptRepo, h.mutationContext, {
      attemptId: "attempt-1",
      questionId: "q1",
      answer: "DIFFERENT",
      clientSeq: 1,
      clientSavedAt: now.toISOString(),
      baseVersion: 0,
    });

    expect(result.accepted).toBe(false);
    expect(result.conflict?.reason).toBe("CONFLICTING_PAYLOAD");
    expect(result.conflict?.latestAnswer).toBe("b");
    expect(h.attemptRepo.updateCalls).toHaveLength(0);
  });

  it("regression — accepted save stamps lastActivityAt with the context checkedAt", async () => {
    const now = new Date("2025-01-01T10:05:00Z");
    const h = await prepare(makeExam(), makeAttempt(), makeEnrollment(), now);

    await saveAnswer(h.attemptRepo, h.mutationContext, {
      attemptId: "attempt-1",
      questionId: "q1",
      answer: "b",
      clientSeq: 1,
      clientSavedAt: now.toISOString(),
      baseVersion: 0,
    });

    expect(h.attemptRepo.get("attempt-1").lastActivityAt).toEqual(now);
  });

  it("clientSeq history durability preserved across a subsequent call", async () => {
    const t0 = new Date("2025-01-01T10:05:00Z");
    const t1 = new Date("2025-01-01T10:06:00Z");

    const h0 = await prepare(makeExam(), makeAttempt(), makeEnrollment(), t0);
    await saveAnswer(h0.attemptRepo, h0.mutationContext, {
      attemptId: "attempt-1",
      questionId: "q1",
      answer: "a",
      clientSeq: 1,
      clientSavedAt: t0.toISOString(),
      baseVersion: 0,
    });
    const h1 = await prepare(
      makeExam(),
      h0.attemptRepo.get("attempt-1"),
      makeEnrollment(),
      t1,
    );
    await saveAnswer(h1.attemptRepo, h1.mutationContext, {
      attemptId: "attempt-1",
      questionId: "q1",
      answer: "b",
      clientSeq: 2,
      clientSavedAt: t1.toISOString(),
      baseVersion: 1,
    });

    // Replay clientSeq=1 with the SAME payload — must be accepted as idempotent.
    const replay = await saveAnswer(h1.attemptRepo, h1.mutationContext, {
      attemptId: "attempt-1",
      questionId: "q1",
      answer: "a",
      clientSeq: 1,
      clientSavedAt: t0.toISOString(),
      baseVersion: 0,
    });

    expect(replay.accepted).toBe(true);
    expect(replay.conflict).toBeUndefined();
    expect(h1.attemptRepo.get("attempt-1").answers[0]).toMatchObject({
      questionId: "q1",
      answer: "b",
      version: 2,
    });
  });
});

// EXAM-ANSWER-PRECONDITION-CORRECTIVE-0 §4.5 / §13 — type-level opacity +
// direct-call rejection. These are compile-time guards: the @ts-expect-error
// directives fail typecheck (TS2578 unused) if the context ever became
// object-literal-constructible or if saveAnswer reverted to the old 4-arg
// shape. The runtime assertions are no-op smoke tests that keep the file in
// the test run; the real assertion is the expect-error at typecheck time.

describe("EXAM-ANSWER-PRECONDITION-CORRECTIVE-0 — type opacity + direct-call rejection", () => {
  it("rejects object-literal construction of the mutation context (typecheck)", () => {
    // @ts-expect-error — Property '[MUTATION_PROVENANCE_TOKEN]' is missing (brand private).
    const _forged: ReconciledAttemptMutationContext = {
      attemptId: "a1",
      checkedAt: new Date(),
      effectiveDeadline: new Date(),
    };
    void _forged;
    expect(true).toBe(true);
  });

  it("saveAnswer cannot be called with the old 4-arg shape saveAnswer(repo, attemptId, request, now) (typecheck)", () => {
    // A valid opaque mutation context is REQUIRED as the 2nd positional arg;
    // the old 4-arg shape (repo, attemptId, request, now) is no longer
    // supported. This is a COMPILE-TIME guard: the @ts-expect-error is the
    // assertion (it would become unused / TS2578 if the signature reverted to
    // accepting a string). The call is guarded by `if (false)` so it is type-
    // checked but NEVER executed at runtime — a runtime call with a string
    // context would (correctly) trip the affinity guard and create an unhandled
    // rejection, which we avoid here since the type system is the authority.
    const repo = makeAttemptRepo([makeAttempt()]);
    const now = new Date("2025-01-01T10:05:00Z");
    const request = {
      attemptId: "attempt-1",
      questionId: "q1",
      answer: "b",
      clientSeq: 1,
      clientSavedAt: now.toISOString(),
      baseVersion: 0,
    };
    if (false) {
      // @ts-expect-error — Argument of type 'string' is not assignable to parameter of type 'ReconciledAttemptMutationContext'.
      saveAnswer(repo, "attempt-1", request, now);
    }
    expect(true).toBe(true);
  });
});
