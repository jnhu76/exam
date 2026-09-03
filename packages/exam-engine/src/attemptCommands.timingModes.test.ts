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

// Candidate manual submit is legal only in [earliestSubmitAt,
// effectiveDeadline): the too-early guard admits now >= earliestSubmitAt
// while the canonical deadline kernel expires at now >= effectiveDeadline.
// A NEW start is therefore feasible iff earliestSubmitAt < effectiveDeadline
// STRICTLY — at equality the single guard-passing instant is already expired.
// The rule flows through computeEffectiveDeadline, never per-mode arithmetic.
describe("startOrRestoreAttempt — min-submit feasibility (#395)", () => {
  // Fixture defaults give the exam a 09:00–12:00 window.
  function startTracked(exam: Exam, now: Date) {
    const attemptRepo = makeStartAttemptRepo();
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

  it("rejects an impossible late timed_window start and leaves zero mutation", async () => {
    // Start 11:45 → earliest 12:15, past the closeAt-bound effective 12:00.
    const { promise, attemptRepo, enrollmentUpdateCalls } = startTracked(
      makeExam({ durationMinutes: 120, minSubmitAfterStartMinutes: 30 }),
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

  it("admits strictly before the boundary and rejects at earliestSubmitAt == effectiveDeadline", async () => {
    const exam = makeExam({
      durationMinutes: 90,
      minSubmitAfterStartMinutes: 30,
    });
    // Start 11:29 → earliest 11:59 < effective 12:00 — one legal minute left.
    const admitted = await startTracked(exam, new Date("2025-01-01T11:29:00Z"))
      .promise;
    expect(admitted.attempt.status).toBe("in_progress");
    // Start 11:30 → earliest 12:00 == effective 12:00: the only instant
    // passing the too-early guard is already the expiry instant.
    const error = (await startTracked(
      exam,
      new Date("2025-01-01T11:30:00Z"),
    ).promise.then(
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

  it("applies the same canonical rule to deadline mode (effective deadline = closeAt)", async () => {
    const exam = makeExam({
      timingMode: "deadline",
      durationMinutes: null,
      minSubmitAfterStartMinutes: 30,
    });
    await expect(
      startTracked(exam, new Date("2025-01-01T11:45:00Z")).promise,
    ).rejects.toThrow(AttemptStartSubmitInfeasibleError);
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

  it("rejects a late timed_sync start through the same canonical rule (latent B2)", async () => {
    // The shared sitting deadline (T0 10:00 + 90min = 11:30, before closeAt
    // 12:00) must flow through this same guard — a future timed_sync start
    // path must not grow a mode-specific feasibility policy.
    const syncExam = makeExam({
      timingMode: "timed_sync",
      durationMinutes: 90,
      syncStartedAt: new Date("2025-01-01T10:00:00Z"),
      minSubmitAfterStartMinutes: 30,
    });
    const { promise, attemptRepo, enrollmentUpdateCalls } = startTracked(
      syncExam,
      new Date("2025-01-01T11:05:00Z"),
    );
    await expect(promise).rejects.toThrow(AttemptStartSubmitInfeasibleError);
    expect(attemptRepo.created).toBeNull();
    expect(enrollmentUpdateCalls).toHaveLength(0);
  });
});
