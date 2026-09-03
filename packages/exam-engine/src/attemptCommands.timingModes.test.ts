// Phase A2 (#291) — start/restore semantics per timing mode.
//
// Common admission: now < openAt ⇒ cannot start (all modes).
// Close-bound modes (timed_window / deadline): now >= closeAt ⇒ cannot start.
// untimed has no closeAt, so a start long after openAt must still succeed.
// attempt.deadlineAt is populated ONLY for timed_window (personal duration);
// deadline/untimed attempts carry null — the global closeAt is never
// mis-modelled as a personal deadline.

import { describe, expect, it } from "vitest";
import type { Exam, ExamAttempt } from "@exam/domain";
import {
  AttemptLateEntryClosedError,
  AttemptStartSubmitInfeasibleError,
  ExamNotOpenError,
} from "@exam/domain";
import type {
  AttemptRepository,
  EnrollmentRepository,
} from "./attemptCommands.js";
import { startOrRestoreAttempt } from "./attemptCommands.js";
import type { StartOrRestoreDependencies } from "./attemptCommands.js";
import {
  makeAttempt,
  makeEnrollment,
  makeEnrollmentRepo,
  makeExam,
  makeExamRepo,
  makeGradingWorksetRepo,
} from "./attemptMutation.testHelpers.js";

const fixedNow = new Date("2025-01-01T10:30:00Z");

function makeStartAttemptRepo(existing?: ExamAttempt): AttemptRepository & {
  created: ExamAttempt | null;
} {
  let created: ExamAttempt | null = null;
  const store: ExamAttempt[] = existing ? [existing] : [];
  const findStored = (id: string) => store.find((a) => a.id === id) ?? null;
  return {
    get created() {
      return created;
    },
    findById(id) {
      return created && created.id === id ? created : findStored(id);
    },
    findByIdForUpdate(id) {
      return created && created.id === id ? created : findStored(id);
    },
    findActiveByEnrollment(enrollmentId) {
      return (
        store.find(
          (a) =>
            a.enrollmentId === enrollmentId &&
            (a.status === "in_progress" || a.status === "disrupted"),
        ) ?? null
      );
    },
    findByEnrollmentAndAttemptNo() {
      return null;
    },
    create(input) {
      created = {
        ...input,
        id: "attempt-new",
        deadlineAt: input.deadlineAt ?? null,
        createdAt: fixedNow,
        updatedAt: fixedNow,
      };
      return created;
    },
    update(id, data) {
      const idx = store.findIndex((a) => a.id === id);
      if (idx !== -1) {
        store[idx] = { ...store[idx]!, ...data };
        return store[idx]!;
      }
      if (!created || created.id !== id) return null;
      created = { ...created, ...data };
      return created;
    },
    refreshLastActivityIfInProgress(id, now) {
      const target = created && created.id === id ? created : findStored(id);
      if (!target || target.status !== "in_progress") return null;
      target.lastActivityAt = now;
      return target;
    },
  };
}

function makeStartDeps(): StartOrRestoreDependencies {
  return {
    episodeRepo: {} as StartOrRestoreDependencies["episodeRepo"],
    eventRepo: {} as StartOrRestoreDependencies["eventRepo"],
    adjustmentRepo: {} as StartOrRestoreDependencies["adjustmentRepo"],
    gradingWorksetRepo: makeGradingWorksetRepo(),
  };
}

// Minimal strict-policy dependency stack for the disrupted-restore control:
// the restore path locks the episode, reads the detected event (occurredAt
// must equal interruptedAt), finds no prior outcome, then writes the
// `restored` outcome. Strict grants zero time — no adjustment is written.
function makeRestoreDeps(
  attempt: ExamAttempt,
  detectedAt: Date,
): StartOrRestoreDependencies {
  const episodeRepo = {
    create: async () => ({ id: attempt.currentInterruptionId! }) as never,
    findById: async () => null,
    findByAttemptForUpdate: async () =>
      ({ id: attempt.currentInterruptionId!, attemptId: attempt.id }) as never,
    findLatestByAttempt: async () => null,
  };
  const eventRepo = {
    insert: async () => ({ id: "evt-restored" }) as never,
    findDetected: async () =>
      ({
        attemptId: attempt.id,
        interruptionId: attempt.currentInterruptionId!,
        occurredAt: detectedAt,
      }) as never,
    findOutcome: async () => null,
    findLatestOutcomeByAttempt: async () => null,
  };
  const adjustmentRepo = {
    insert: async () => ({ id: "adj-1" }) as never,
    findById: async () => null,
    findByOperationId: async () => null,
    findBoundedByInterruption: async () => null,
    sumBoundedGraceSeconds: async () => 0,
  };
  return {
    episodeRepo,
    eventRepo,
    adjustmentRepo,
    gradingWorksetRepo: makeGradingWorksetRepo(),
  };
}

const deadlineExam = (): Exam =>
  makeExam({ timingMode: "deadline", durationMinutes: null });

const untimedExam = (): Exam =>
  makeExam({ timingMode: "untimed", durationMinutes: null, closeAt: null });

// Wires the same dependency stack as `start` but exposes the pending
// promise, so rejection tests can still inspect the in-memory
// AttemptRepository after the command has failed.
function startWithRepo(exam: Exam, now: Date = fixedNow) {
  const attemptRepo = makeStartAttemptRepo();
  const promise = startOrRestoreAttempt(
    makeExamRepo([exam]),
    makeEnrollmentRepo([makeEnrollment()]),
    attemptRepo,
    "exam-1",
    "cand-1",
    now,
    makeStartDeps(),
  );
  return { promise, attemptRepo };
}

async function start(exam: Exam, now: Date = fixedNow) {
  const { promise, attemptRepo } = startWithRepo(exam, now);
  return { result: await promise, attemptRepo };
}

describe("startOrRestoreAttempt — Phase A timing modes", () => {
  it("deadline mode: attempt carries deadlineAt = null", async () => {
    const { attempt } = (await start(deadlineExam())).result;
    expect(attempt.deadlineAt).toBeNull();
  });

  it("untimed mode: attempt carries deadlineAt = null", async () => {
    const { attempt } = (await start(untimedExam())).result;
    expect(attempt.deadlineAt).toBeNull();
  });

  it("timed_window mode: attempt keeps a personal deadline (regression)", async () => {
    const { attempt } = (await start(makeExam())).result;
    // started 10:30 + duration 60min.
    expect(attempt.deadlineAt).toEqual(new Date("2025-01-01T11:30:00Z"));
  });

  it("deadline mode: start at/after closeAt is rejected", async () => {
    const afterClose = new Date("2025-01-01T12:00:00Z");
    await expect(start(deadlineExam(), afterClose)).rejects.toThrow(
      /outside exam open window/i,
    );
  });

  it("untimed mode: start long after openAt is allowed", async () => {
    const muchLater = new Date("2025-01-02T09:00:00Z");
    const { attempt } = (await start(untimedExam(), muchLater)).result;
    expect(attempt.status).toBe("in_progress");
    expect(attempt.deadlineAt).toBeNull();
  });

  it("untimed mode: still requires now >= openAt", async () => {
    const beforeOpen = new Date("2025-01-01T08:00:00Z");
    await expect(start(untimedExam(), beforeOpen)).rejects.toThrow(
      /outside exam open window/i,
    );
  });
});

// #291 Phase B1 — timed_sync start gating (Model A freeze). The sitting's
// shared deadline comes from the durable T0 (exam.syncStartedAt), never from
// the candidate's start instant; entry before the trigger or after the
// global deadline is forbidden.
describe("startOrRestoreAttempt — timed_sync (Phase B kernel)", () => {
  const t0 = new Date("2025-01-01T10:00:00Z");

  const syncExam = (overrides: Partial<Exam> = {}): Exam =>
    makeExam({
      timingMode: "timed_sync",
      durationMinutes: 90,
      syncStartedAt: t0,
      ...overrides,
    });

  it("rejects start before the operator trigger even inside the open window", async () => {
    const untriggered = syncExam({ syncStartedAt: null });
    const { promise, attemptRepo } = startWithRepo(untriggered);
    await expect(promise).rejects.toThrow(
      /synchronized exam has not been started/i,
    );
    // Pre-T0 rejection must not have created any attempt row.
    expect(attemptRepo.created).toBeNull();
  });

  it("mints the shared global deadline regardless of the start instant", async () => {
    const at = (await start(syncExam(), new Date("2025-01-01T10:02:00Z")))
      .result.attempt;
    const late = (await start(syncExam(), new Date("2025-01-01T10:55:00Z")))
      .result.attempt;
    // T0 + 90min, identical for both candidates.
    expect(at.deadlineAt).toEqual(new Date("2025-01-01T11:30:00Z"));
    expect(late.deadlineAt).toEqual(at.deadlineAt);
  });

  it("caps the shared deadline at closeAt when the cap binds earlier", async () => {
    const capped = syncExam({ closeAt: new Date("2025-01-01T11:00:00Z") });
    const { attempt } = (await start(capped, new Date("2025-01-01T10:30:00Z")))
      .result;
    expect(attempt.deadlineAt).toEqual(new Date("2025-01-01T11:00:00Z"));
  });

  it("rejects start at/after the global deadline even when closeAt is later", async () => {
    const atDeadline = new Date("2025-01-01T11:30:00Z");
    const { promise, attemptRepo } = startWithRepo(syncExam(), atDeadline);
    await expect(promise).rejects.toThrow(
      /synchronized exam deadline has passed/i,
    );
    // Post-deadline rejection must never leave a born-expired attempt row.
    expect(attemptRepo.created).toBeNull();
  });

  it("still rejects start at/after closeAt (window gate regression)", async () => {
    const afterClose = new Date("2025-01-01T12:00:00Z");
    await expect(start(syncExam(), afterClose)).rejects.toThrow(
      /outside exam open window/i,
    );
  });

  it("never-triggered sitting past closeAt rejects as expired window, not as waiting", async () => {
    // P2-A oracle: with syncStartedAt = null AND now >= closeAt, the closeAt
    // window guard must dominate the T0-null guard — the candidate sees the
    // canonical expired-window rejection, never the pre-T0 waiting text.
    const untriggered = syncExam({ syncStartedAt: null });
    const afterClose = new Date("2025-01-01T12:00:00Z");
    const error = await startWithRepo(untriggered, afterClose).promise.then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ExamNotOpenError);
    const message = error instanceof Error ? error.message : String(error);
    expect(message).toMatch(/outside exam open window/i);
    expect(message).not.toMatch(/synchronized exam has not been started/i);
  });

  it("anchors the late-entry cutoff at T0, not openAt", async () => {
    const offsetExam = syncExam({ latestStartOffsetMinutes: 20 });
    // openAt 09:00 + 20min = 09:20 (long past); T0 10:00 + 20min = 10:20.
    const withinBuffer = new Date("2025-01-01T10:15:00Z");
    const afterBuffer = new Date("2025-01-01T10:25:00Z");
    const { attempt } = (await start(offsetExam, withinBuffer)).result;
    expect(attempt.deadlineAt).toEqual(new Date("2025-01-01T11:30:00Z"));
    await expect(start(offsetExam, afterBuffer)).rejects.toThrow(
      AttemptLateEntryClosedError,
    );
  });

  it("rejects an untriggered sync exam as not-started, not late-entry", async () => {
    const untriggered = syncExam({
      syncStartedAt: null,
      latestStartOffsetMinutes: 20,
    });
    await expect(start(untriggered)).rejects.toThrow(
      /synchronized exam has not been started/i,
    );
  });
});

// #395 — new-attempt manual-submit feasibility. A candidate manual submit is
// legal only in [earliestSubmitAt, effectiveDeadline): the too-early guard
// admits now >= earliestSubmitAt (attemptCommands submitAttempt) while the
// canonical deadline kernel expires at now >= effectiveDeadline
// (deadlineReconciliation isAttemptDeadlineExpired) and freezes the attempt
// with the deadline source before a candidate submit can run. The window is
// therefore reachable iff earliestSubmitAt < effectiveDeadline — STRICT: at
// equality the single guard-passing instant is already expired.
//
// The rule is expressed through computeEffectiveDeadline (the canonical
// kernel), never per-mode arithmetic, so timed_window / deadline /
// timed_sync all flow through the same guard and untimed (null effective
// deadline) never rejects here.
describe("startOrRestoreAttempt — min-submit feasibility (#395)", () => {
  // Issue reproduction shape: closeAt-bound effective deadline. openAt 09:00,
  // closeAt 12:00, duration 120, minSubmit 30 (authoring-sane: min < duration).
  const lateWindowExam = (): Exam =>
    makeExam({ durationMinutes: 120, minSubmitAfterStartMinutes: 30 });

  function startTracked(exam: Exam, now: Date, existing?: ExamAttempt) {
    const attemptRepo = makeStartAttemptRepo(existing);
    const enrollmentUpdateCalls: unknown[] = [];
    const base = makeEnrollmentRepo([makeEnrollment()]);
    const enrollmentRepo: EnrollmentRepository = {
      ...base,
      update(id, data) {
        enrollmentUpdateCalls.push(data);
        return base.update(id, data);
      },
    };
    const promise = startOrRestoreAttempt(
      makeExamRepo([exam]),
      enrollmentRepo,
      attemptRepo,
      "exam-1",
      "cand-1",
      now,
      makeStartDeps(),
    );
    return { promise, attemptRepo, enrollmentUpdateCalls };
  }

  it("rejects an impossible late timed_window start and leaves zero mutation (#395 repro)", async () => {
    // now 11:45 → deadlineAt 13:45 → effective min(12:00, 13:45) = 12:00;
    // earliest 12:15 ≥ 12:00 → the whole manual-submit window is past the
    // deadline. Before #395 this start SUCCEEDED and trapped the candidate.
    const { promise, attemptRepo, enrollmentUpdateCalls } = startTracked(
      lateWindowExam(),
      new Date("2025-01-01T11:45:00Z"),
    );
    const error = await promise.then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(AttemptStartSubmitInfeasibleError);
    // Zero side effects: no attempt row, no enrollment attemptCount/status write.
    expect(attemptRepo.created).toBeNull();
    expect(enrollmentUpdateCalls).toHaveLength(0);
  });

  it("rejects when the personal duration binds the effective deadline (wide-open window)", async () => {
    // duration 30, minSubmit 45, now 10:00 → deadlineAt 10:30 < closeAt 12:00;
    // effective = 10:30, earliest 10:45. The exam window is wide open, yet no
    // legal manual-submit instant exists.
    const exam = makeExam({
      durationMinutes: 30,
      minSubmitAfterStartMinutes: 45,
    });
    const { promise, attemptRepo } = startTracked(
      exam,
      new Date("2025-01-01T10:00:00Z"),
    );
    await expect(promise).rejects.toThrow(AttemptStartSubmitInfeasibleError);
    expect(attemptRepo.created).toBeNull();
  });

  it("allows a nearby feasible late start on the same exam", async () => {
    // Same exam as the repro; now 11:00 → earliest 11:30 < effective 12:00.
    const { promise, attemptRepo } = startTracked(
      lateWindowExam(),
      new Date("2025-01-01T11:00:00Z"),
    );
    const { attempt, isNew } = await promise;
    expect(isNew).toBe(true);
    expect(attempt.status).toBe("in_progress");
    expect(attemptRepo.created).not.toBeNull();
    expect(attempt.deadlineAt).toEqual(new Date("2025-01-01T13:00:00Z"));
  });

  it("rejects at the exact boundary earliestSubmitAt == effectiveDeadline", async () => {
    // duration 90, minSubmit 30, closeAt 12:00; now 11:30 → deadlineAt 13:00,
    // effective 12:00, earliest 12:00. At equality the ONLY instant that
    // passes the too-early guard (12:00) is exactly the expiry instant
    // (now >= effectiveDeadline), so no candidate-manual-submit instant is
    // reachable — rejected.
    const exam = makeExam({
      durationMinutes: 90,
      minSubmitAfterStartMinutes: 30,
    });
    const { promise } = startTracked(exam, new Date("2025-01-01T11:30:00Z"));
    const error = (await promise.then(
      () => null,
      (e: unknown) => e,
    )) as AttemptStartSubmitInfeasibleError | null;
    expect(error).toBeInstanceOf(AttemptStartSubmitInfeasibleError);
    const details = error?.details as
      | { earliestSubmitAt: Date; effectiveDeadline: Date }
      | undefined;
    expect(details?.earliestSubmitAt.getTime()).toBe(
      new Date("2025-01-01T12:00:00Z").getTime(),
    );
    expect(details?.earliestSubmitAt.getTime()).toBe(
      details?.effectiveDeadline.getTime(),
    );
  });

  it("admits the start one minute before the boundary (earliestSubmitAt strictly before effectiveDeadline)", async () => {
    // Same exam; now 11:29 → earliest 11:59 < effective 12:00 — the candidate
    // keeps a one-minute legal manual-submit window.
    const exam = makeExam({
      durationMinutes: 90,
      minSubmitAfterStartMinutes: 30,
    });
    const { promise } = startTracked(exam, new Date("2025-01-01T11:29:00Z"));
    const { attempt } = await promise;
    expect(attempt.status).toBe("in_progress");
  });

  it("applies the same canonical rule to deadline mode (closeAt-only effective deadline)", async () => {
    // deadline mode: attempt deadlineAt is null, effective deadline = closeAt.
    const exam = makeExam({
      timingMode: "deadline",
      durationMinutes: null,
      minSubmitAfterStartMinutes: 30,
    });
    // now 11:45 → earliest 12:15 ≥ closeAt 12:00 → reject.
    await expect(
      startTracked(exam, new Date("2025-01-01T11:45:00Z")).promise,
    ).rejects.toThrow(AttemptStartSubmitInfeasibleError);
    // Control on the same exam: now 11:00 → earliest 11:30 < 12:00 → start.
    const { attempt } = await startTracked(
      exam,
      new Date("2025-01-01T11:00:00Z"),
    ).promise;
    expect(attempt.deadlineAt).toBeNull();
  });

  it("does not reject an untimed start solely because of minSubmitAfterStartMinutes (null effective deadline)", async () => {
    const exam = makeExam({
      timingMode: "untimed",
      durationMinutes: null,
      closeAt: null,
      minSubmitAfterStartMinutes: 300,
    });
    const { attempt } = await startTracked(
      exam,
      new Date("2025-01-02T09:00:00Z"),
    ).promise;
    expect(attempt.status).toBe("in_progress");
    expect(attempt.deadlineAt).toBeNull();
  });

  it("still resumes an existing in_progress attempt whose remaining time is shorter than minSubmitAfterStartMinutes", async () => {
    // Existing attempt: started 10:30, deadlineAt 11:30 → effective
    // min(12:00, 11:30) = 11:30. now 11:15 leaves 15 min < minSubmit 60, but
    // #395 governs NEW attempt creation only — the resume must return the
    // existing attempt untouched.
    const exam = makeExam({
      durationMinutes: 60,
      minSubmitAfterStartMinutes: 60,
    });
    const active = makeAttempt({
      status: "in_progress",
      startedAt: new Date("2025-01-01T10:30:00Z"),
      deadlineAt: new Date("2025-01-01T11:30:00Z"),
    });
    const { promise, attemptRepo } = startTracked(
      exam,
      new Date("2025-01-01T11:15:00Z"),
      active,
    );
    const { attempt, isNew } = await promise;
    expect(isNew).toBe(false);
    expect(attempt.id).toBe("attempt-1");
    expect(attempt.status).toBe("in_progress");
    expect(attemptRepo.created).toBeNull();
  });

  it("still restores a disrupted attempt whose remaining time is shorter than minSubmitAfterStartMinutes", async () => {
    const exam = makeExam({
      durationMinutes: 60,
      minSubmitAfterStartMinutes: 60,
    });
    const detectedAt = new Date("2025-01-01T10:45:00Z");
    const disrupted = makeAttempt({
      status: "disrupted",
      startedAt: new Date("2025-01-01T10:30:00Z"),
      deadlineAt: new Date("2025-01-01T11:30:00Z"),
      currentInterruptionId: "ep-1",
      interruptedAt: detectedAt,
      interruptionTimingPolicySnapshot: {
        schemaVersion: 1,
        policy: "strict",
        perIncidentCapSeconds: null,
        perAttemptAggregateCapSeconds: null,
      },
    });
    const attemptRepo = makeStartAttemptRepo(disrupted);
    const result = await startOrRestoreAttempt(
      makeExamRepo([exam]),
      makeEnrollmentRepo([makeEnrollment()]),
      attemptRepo,
      "exam-1",
      "cand-1",
      new Date("2025-01-01T11:15:00Z"),
      makeRestoreDeps(disrupted, detectedAt),
    );
    expect(result.isNew).toBe(false);
    expect(result.attempt.id).toBe("attempt-1");
    expect(result.attempt.status).toBe("in_progress");
    expect(attemptRepo.created).toBeNull();
  });

  // Latent Phase B2 oracle (#291 Model A): late entry against a SHARED global
  // deadline must be protected by the SAME canonical feasibility rule — no
  // timed_sync-specific implementation. This is the pre-B2 regression the
  // issue requires: syncDeadline 11:30, NEW start at 11:05, minSubmit 30.
  describe("timed_sync latent oracle (pre-B2)", () => {
    const t0 = new Date("2025-01-01T10:00:00Z");
    const syncExam = (): Exam =>
      makeExam({
        timingMode: "timed_sync",
        durationMinutes: 90,
        syncStartedAt: t0,
        minSubmitAfterStartMinutes: 30,
      });

    it("rejects a late timed_sync NEW start through the canonical feasibility rule", async () => {
      // T0 + 90min = syncDeadline 11:30 (closeAt 12:00 later). Start at 11:05
      // passes the pre-T0/post-deadline/closeAt gates; earliest 11:35 ≥
      // effective min(12:00, 11:30) = 11:30 → infeasible.
      const { promise, attemptRepo, enrollmentUpdateCalls } = startTracked(
        syncExam(),
        new Date("2025-01-01T11:05:00Z"),
      );
      await expect(promise).rejects.toThrow(AttemptStartSubmitInfeasibleError);
      expect(attemptRepo.created).toBeNull();
      expect(enrollmentUpdateCalls).toHaveLength(0);
    });

    it("admits a timed_sync start leaving a reachable manual-submit window before the shared deadline", async () => {
      // Start 10:55 → earliest 11:25 < shared deadline 11:30 → feasible.
      const { promise } = startTracked(
        syncExam(),
        new Date("2025-01-01T10:55:00Z"),
      );
      const { attempt } = await promise;
      expect(attempt.deadlineAt).toEqual(new Date("2025-01-01T11:30:00Z"));
    });
  });
});
