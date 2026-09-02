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
import type { AttemptRepository } from "./attemptCommands.js";
import { startOrRestoreAttempt } from "./attemptCommands.js";
import type { StartOrRestoreDependencies } from "./attemptCommands.js";
import {
  makeEnrollment,
  makeEnrollmentRepo,
  makeExam,
  makeExamRepo,
  makeGradingWorksetRepo,
} from "./attemptMutation.testHelpers.js";

const fixedNow = new Date("2025-01-01T10:30:00Z");

function makeStartAttemptRepo(): AttemptRepository & {
  created: ExamAttempt | null;
} {
  let created: ExamAttempt | null = null;
  return {
    get created() {
      return created;
    },
    findById(id) {
      return created && created.id === id ? created : null;
    },
    findByIdForUpdate(id) {
      return created && created.id === id ? created : null;
    },
    findActiveByEnrollment() {
      return null;
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
      if (!created || created.id !== id) return null;
      created = { ...created, ...data };
      return created;
    },
    refreshLastActivityIfInProgress(id, now) {
      if (!created || created.id !== id) return null;
      created = { ...created, lastActivityAt: now };
      return created;
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

const deadlineExam = (): Exam =>
  makeExam({ timingMode: "deadline", durationMinutes: null });

const untimedExam = (): Exam =>
  makeExam({ timingMode: "untimed", durationMinutes: null, closeAt: null });

async function start(exam: Exam, now: Date = fixedNow) {
  const attemptRepo = makeStartAttemptRepo();
  const result = await startOrRestoreAttempt(
    makeExamRepo([exam]),
    makeEnrollmentRepo([makeEnrollment()]),
    attemptRepo,
    "exam-1",
    "cand-1",
    now,
    makeStartDeps(),
  );
  return { result, attemptRepo };
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
