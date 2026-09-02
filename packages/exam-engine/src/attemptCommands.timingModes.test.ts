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
import { AttemptLateEntryClosedError } from "@exam/domain";
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
    await expect(start(untriggered)).rejects.toThrow(
      /synchronized exam has not been started/i,
    );
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
    await expect(start(syncExam(), atDeadline)).rejects.toThrow(
      /synchronized exam deadline has passed/i,
    );
  });

  it("still rejects start at/after closeAt (window gate regression)", async () => {
    const afterClose = new Date("2025-01-01T12:00:00Z");
    await expect(start(syncExam(), afterClose)).rejects.toThrow(
      /outside exam open window/i,
    );
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
