import { describe, expect, it } from "vitest";
import { NotFoundError, ValidationError } from "@exam/domain";
import type { ExamAttempt, ExamEnrollment } from "@exam/domain";
import type {
  AttemptRepository,
  EnrollmentRepository,
} from "./attemptCommands.js";
import {
  assertCapabilityFor,
  lockEnrollmentAndAttempt,
  type LockedEnrollmentAttemptIdentity,
} from "./lockSeam.js";

/**
 * J6 — Type opacity regression. The `@ts-expect-error` below is a compile-time
 * guard: if the capability ever became object-literal-constructible, the
 * expect-error would be reported as unused (TS2578) and `pnpm typecheck`
 * would fail. The runtime test is a no-op smoke test that keeps the file in
 * the test run; the real assertion is the expect-error at typecheck time.
 */
describe("LockedEnrollmentAttemptIdentity opacity (J6)", () => {
  it("rejects object-literal construction of the capability (typecheck)", () => {
    // @ts-expect-error — Property '[LOCK_TOKEN]' is missing (brand private).
    const _forged: LockedEnrollmentAttemptIdentity = {
      enrollmentId: "e1",
      attemptId: "a1",
    };
    void _forged;
    expect(true).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Shared fixtures for the protocol + affinity tests below.
// ---------------------------------------------------------------------------

function makeAttempt(overrides: Partial<ExamAttempt> = {}): ExamAttempt {
  return {
    id: "attempt-1",
    organizationId: "org-1",
    examId: "exam-1",
    enrollmentId: "enr-1",
    candidateId: "cand-1",
    attemptNo: 1,
    status: "in_progress",
    questionSnapshot: [],
    answers: [],
    startedAt: new Date("2025-01-01T10:00:00Z"),
    deadlineAt: new Date("2025-01-01T11:00:00Z"),
    lastActivityAt: new Date("2025-01-01T10:00:00Z"),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeEnrollment(
  overrides: Partial<ExamEnrollment> = {},
): ExamEnrollment {
  return {
    id: "enr-1",
    organizationId: "org-1",
    examId: "exam-1",
    candidateId: "cand-1",
    status: "started",
    attemptCount: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/** A minimal recording repo pair that captures the call order into `log`. */
function makeRecordingRepos(opts: {
  attempt?: ExamAttempt | null;
  enrollment?: ExamEnrollment | null;
  lockedAttempt?: ExamAttempt | null;
}): {
  attemptRepo: AttemptRepository;
  enrollmentRepo: EnrollmentRepository;
  log: string[];
} {
  const log: string[] = [];
  // When `lockedAttempt` is explicitly provided (incl. null) use it; otherwise
  // mirror the locator read so the common case needs only `attempt`.
  const lockedAttempt =
    opts.lockedAttempt === undefined
      ? (opts.attempt ?? null)
      : opts.lockedAttempt;
  const attemptRepo: AttemptRepository = {
    findById: (id) => {
      log.push(`attempt.findById(${id})`);
      return opts.attempt ?? null;
    },
    findByIdForUpdate: (id) => {
      log.push(`attempt.findByIdForUpdate(${id})`);
      return lockedAttempt;
    },
    findActiveByEnrollment: () => null,
    findByEnrollmentAndAttemptNo: () => null,
    create: () => {
      throw new Error("not used");
    },
    update: () => {
      throw new Error("not used");
    },
    refreshLastActivityIfInProgress: () => {
      throw new Error("not used");
    },
  };
  const enrollmentRepo: EnrollmentRepository = {
    findByExamAndCandidate: () => null,
    findByExamAndCandidateForUpdate: (examId, candidateId) => {
      log.push(
        `enrollment.findByExamAndCandidateForUpdate(${examId},${candidateId})`,
      );
      return opts.enrollment ?? null;
    },
    create: () => {
      throw new Error("not used");
    },
    update: () => {
      throw new Error("not used");
    },
  };
  return { attemptRepo, enrollmentRepo, log };
}

// ---------------------------------------------------------------------------
// J1 — Canonical lock-acquisition protocol.
// ---------------------------------------------------------------------------

describe("lockEnrollmentAndAttempt (J1 protocol)", () => {
  it("acquires in canonical order: Attempt plain read → Enrollment FOR UPDATE → Attempt FOR UPDATE → mint", async () => {
    const { attemptRepo, enrollmentRepo, log } = makeRecordingRepos({
      attempt: makeAttempt(),
      enrollment: makeEnrollment(),
      lockedAttempt: makeAttempt(),
    });

    const cap = await lockEnrollmentAndAttempt(
      enrollmentRepo,
      attemptRepo,
      "attempt-1",
    );

    expect(log).toEqual([
      "attempt.findById(attempt-1)",
      "enrollment.findByExamAndCandidateForUpdate(exam-1,cand-1)",
      "attempt.findByIdForUpdate(attempt-1)",
    ]);
    expect(cap.enrollmentId).toBe("enr-1");
    expect(cap.attemptId).toBe("attempt-1");
  });

  it("throws NotFoundError when the attempt locator is missing", async () => {
    const { attemptRepo, enrollmentRepo, log } = makeRecordingRepos({
      attempt: null,
    });
    await expect(
      lockEnrollmentAndAttempt(enrollmentRepo, attemptRepo, "missing"),
    ).rejects.toBeInstanceOf(NotFoundError);
    // Only the locator read must have happened — no Enrollment lock acquired.
    expect(log).toEqual(["attempt.findById(missing)"]);
  });

  it("throws NotFoundError when the enrollment row is missing", async () => {
    const { attemptRepo, enrollmentRepo, log } = makeRecordingRepos({
      attempt: makeAttempt(),
      enrollment: null,
    });
    await expect(
      lockEnrollmentAndAttempt(enrollmentRepo, attemptRepo, "attempt-1"),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(log).toEqual([
      "attempt.findById(attempt-1)",
      "enrollment.findByExamAndCandidateForUpdate(exam-1,cand-1)",
    ]);
  });

  it("throws ValidationError when the enrollment locator does not match the attempt FK", async () => {
    const { attemptRepo, enrollmentRepo, log } = makeRecordingRepos({
      attempt: makeAttempt({ enrollmentId: "enr-1" }),
      enrollment: makeEnrollment({ id: "enr-DIFFERENT" }),
    });
    await expect(
      lockEnrollmentAndAttempt(enrollmentRepo, attemptRepo, "attempt-1"),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(log).toEqual([
      "attempt.findById(attempt-1)",
      "enrollment.findByExamAndCandidateForUpdate(exam-1,cand-1)",
    ]);
  });

  it("throws NotFoundError when the attempt disappears after the Enrollment lock", async () => {
    const { attemptRepo, enrollmentRepo, log } = makeRecordingRepos({
      attempt: makeAttempt(), // locator succeeds
      enrollment: makeEnrollment(),
      lockedAttempt: null, // FOR UPDATE read fails
    });
    await expect(
      lockEnrollmentAndAttempt(enrollmentRepo, attemptRepo, "attempt-1"),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(log).toEqual([
      "attempt.findById(attempt-1)",
      "enrollment.findByExamAndCandidateForUpdate(exam-1,cand-1)",
      "attempt.findByIdForUpdate(attempt-1)",
    ]);
  });

  it("throws ValidationError when locked attempt.enrollmentId !== locked enrollment.id", async () => {
    const { attemptRepo, enrollmentRepo, log } = makeRecordingRepos({
      attempt: makeAttempt({ enrollmentId: "enr-1" }),
      enrollment: makeEnrollment({ id: "enr-1" }),
      lockedAttempt: makeAttempt({ enrollmentId: "enr-DIFFERENT" }),
    });
    await expect(
      lockEnrollmentAndAttempt(enrollmentRepo, attemptRepo, "attempt-1"),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(log).toEqual([
      "attempt.findById(attempt-1)",
      "enrollment.findByExamAndCandidateForUpdate(exam-1,cand-1)",
      "attempt.findByIdForUpdate(attempt-1)",
    ]);
  });

  it("mints a capability carrying NO mutable Attempt/Enrollment snapshots", async () => {
    const { attemptRepo, enrollmentRepo } = makeRecordingRepos({
      attempt: makeAttempt({
        status: "in_progress",
        answers: [
          { questionId: "q", version: 1, savedAt: new Date(), answer: "x" },
        ],
      }),
      enrollment: makeEnrollment({ status: "started", finalScore: 42 }),
      lockedAttempt: makeAttempt(),
    });
    const cap = await lockEnrollmentAndAttempt(
      enrollmentRepo,
      attemptRepo,
      "attempt-1",
    );
    // Public surface is identity only.
    const publicKeys = Object.keys(cap).sort();
    expect(publicKeys).toEqual(["attemptId", "enrollmentId"]);
    expect(cap.enrollmentId).toBe("enr-1");
    expect(cap.attemptId).toBe("attempt-1");
    // No attempt/enrollment status, score, answers, etc. reachable.
    expect((cap as unknown as Record<string, unknown>).status).toBeUndefined();
    expect(
      (cap as unknown as Record<string, unknown>).finalScore,
    ).toBeUndefined();
    expect((cap as unknown as Record<string, unknown>).answers).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// J2 — Repository-affinity assertion.
//
// Retry-remint framing (former J5): a witness minted against one repo pair
// (transaction T1) is invalid for a different pair (transaction T2) even with
// identical ids — that is exactly the "throws when both repos differ" row
// below; a freshly minted T2 witness passing is exactly the
// "passes when the consumer uses the exact mint-time repo pair" row.
// ---------------------------------------------------------------------------

describe("assertCapabilityFor (J2 affinity)", () => {
  function makeStore(): {
    attemptRepo: AttemptRepository;
    enrollmentRepo: EnrollmentRepository;
  } {
    const attempt = makeAttempt();
    const enrollment = makeEnrollment();
    const attemptRepo: AttemptRepository = {
      findById: () => attempt,
      findByIdForUpdate: () => attempt,
      findActiveByEnrollment: () => null,
      findByEnrollmentAndAttemptNo: () => null,
      create: () => {
        throw new Error("not used");
      },
      update: () => {
        throw new Error("not used");
      },
      refreshLastActivityIfInProgress: () => {
        throw new Error("not used");
      },
    };
    const enrollmentRepo: EnrollmentRepository = {
      findByExamAndCandidate: () => enrollment,
      findByExamAndCandidateForUpdate: () => enrollment,
      create: () => {
        throw new Error("not used");
      },
      update: () => {
        throw new Error("not used");
      },
    };
    return { attemptRepo, enrollmentRepo };
  }

  it("passes when the consumer uses the exact mint-time repo pair", async () => {
    const t1 = makeStore();
    const cap = await lockEnrollmentAndAttempt(
      t1.enrollmentRepo,
      t1.attemptRepo,
      "attempt-1",
    );
    expect(() =>
      assertCapabilityFor(cap, t1.enrollmentRepo, t1.attemptRepo),
    ).not.toThrow();
  });

  it("throws when both repos differ (T1 cap + T2 pair) even with identical ids", async () => {
    const t1 = makeStore();
    const t2 = makeStore(); // distinct objects, identical ids
    const cap = await lockEnrollmentAndAttempt(
      t1.enrollmentRepo,
      t1.attemptRepo,
      "attempt-1",
    );
    expect(cap.enrollmentId).toBe("enr-1");
    expect(cap.attemptId).toBe("attempt-1");
    expect(() =>
      assertCapabilityFor(cap, t2.enrollmentRepo, t2.attemptRepo),
    ).toThrow(/transaction-affinity violation/);
  });

  it("throws when only the enrollment repo differs", async () => {
    const t1 = makeStore();
    const t2 = makeStore();
    const cap = await lockEnrollmentAndAttempt(
      t1.enrollmentRepo,
      t1.attemptRepo,
      "attempt-1",
    );
    expect(() =>
      assertCapabilityFor(cap, t2.enrollmentRepo, t1.attemptRepo),
    ).toThrow(/transaction-affinity violation/);
  });

  it("throws when only the attempt repo differs", async () => {
    const t1 = makeStore();
    const t2 = makeStore();
    const cap = await lockEnrollmentAndAttempt(
      t1.enrollmentRepo,
      t1.attemptRepo,
      "attempt-1",
    );
    expect(() =>
      assertCapabilityFor(cap, t1.enrollmentRepo, t2.attemptRepo),
    ).toThrow(/transaction-affinity violation/);
  });
});
