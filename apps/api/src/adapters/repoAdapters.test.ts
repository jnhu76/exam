import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { RequestContext } from "@exam/domain";
import {
  createExamRepoAdapter,
  createAttemptRepoAdapter,
  createEnrollmentRepoAdapter,
  createExamEngineRepos,
} from "./repoAdapters.js";

function createCtx(overrides?: Partial<RequestContext>): RequestContext {
  return {
    actorId: randomUUID(),
    organizationId: randomUUID(),
    role: "Admin",
    permissions: [],
    sessionId: randomUUID(),
    ...overrides,
  };
}

function createMockExamRepo() {
  return {
    findById: vi.fn(),
    update: vi.fn(),
  };
}

function createMockAttemptRepo() {
  return {
    findById: vi.fn(),
    findByIdForUpdate: vi.fn(),
    findActiveByEnrollment: vi.fn(),
    findByEnrollmentAndAttemptNo: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  };
}

function createMockEnrollmentRepo() {
  return {
    findByExamAndCandidate: vi.fn(),
    findByExamAndCandidateForUpdate: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  };
}

describe("repoAdapters", () => {
  const ctx = createCtx();

  describe("individual adapters", () => {
    it("createExamRepoAdapter delegates findById to repo", async () => {
      const repo = createMockExamRepo();
      const exam = { id: "exam-1" };
      repo.findById.mockResolvedValue(exam);

      const adapter = createExamRepoAdapter(repo as never, ctx);
      const result = await adapter.findById("exam-1");

      expect(result).toEqual(exam);
      expect(repo.findById).toHaveBeenCalledWith(ctx, "exam-1");
    });

    it("createAttemptRepoAdapter delegates create to repo", async () => {
      const repo = createMockAttemptRepo();
      const input = {
        organizationId: ctx.organizationId,
        examId: "exam-1",
        candidateId: "cand-1",
        enrollmentId: "enroll-1",
        attemptNo: 1,
        status: "in_progress" as const,
        questionSnapshot: [],
        answers: [],
      };
      const created = { id: "attempt-1", ...input };
      repo.create.mockResolvedValue(created);

      const adapter = createAttemptRepoAdapter(repo as never, ctx);
      const result = await adapter.create(input);

      expect(result).toEqual(created);
      expect(repo.create).toHaveBeenCalledWith(ctx, input);
    });

    it("createEnrollmentRepoAdapter delegates findByExamAndCandidate", async () => {
      const repo = createMockEnrollmentRepo();
      const enrollment = { id: "enroll-1" };
      repo.findByExamAndCandidate.mockResolvedValue(enrollment);

      const adapter = createEnrollmentRepoAdapter(repo as never, ctx);
      const result = await adapter.findByExamAndCandidate("exam-1", "cand-1");

      expect(result).toEqual(enrollment);
      expect(repo.findByExamAndCandidate).toHaveBeenCalledWith(
        ctx,
        "exam-1",
        "cand-1",
      );
    });
  });

  describe("createExamEngineRepos", () => {
    it("returns all three adapted repos", () => {
      const examRepo = createMockExamRepo();
      const attemptRepo = createMockAttemptRepo();
      const enrollmentRepo = createMockEnrollmentRepo();

      const result = createExamEngineRepos(
        {
          examRepo: examRepo as never,
          attemptRepo: attemptRepo as never,
          enrollmentRepo: enrollmentRepo as never,
        },
        ctx,
      );

      expect(result).toHaveProperty("exams");
      expect(result).toHaveProperty("attempts");
      expect(result).toHaveProperty("enrollments");
      expect(typeof result.exams.findById).toBe("function");
      expect(typeof result.attempts.findById).toBe("function");
      expect(typeof result.enrollments.findByExamAndCandidate).toBe("function");
    });

    it("exam adapter delegates to exam repo with ctx", async () => {
      const examRepo = createMockExamRepo();
      const attemptRepo = createMockAttemptRepo();
      const enrollmentRepo = createMockEnrollmentRepo();
      const exam = { id: "exam-1" };
      examRepo.findById.mockResolvedValue(exam);

      const { exams } = createExamEngineRepos(
        {
          examRepo: examRepo as never,
          attemptRepo: attemptRepo as never,
          enrollmentRepo: enrollmentRepo as never,
        },
        ctx,
      );
      const result = await exams.findById("exam-1");

      expect(result).toEqual(exam);
      expect(examRepo.findById).toHaveBeenCalledWith(ctx, "exam-1");
    });

    it("attempt adapter delegates to attempt repo with ctx", async () => {
      const examRepo = createMockExamRepo();
      const attemptRepo = createMockAttemptRepo();
      const enrollmentRepo = createMockEnrollmentRepo();
      const attempt = { id: "attempt-1" };
      attemptRepo.findByIdForUpdate.mockResolvedValue(attempt);

      const { attempts } = createExamEngineRepos(
        {
          examRepo: examRepo as never,
          attemptRepo: attemptRepo as never,
          enrollmentRepo: enrollmentRepo as never,
        },
        ctx,
      );
      const result = await attempts.findByIdForUpdate("attempt-1");

      expect(result).toEqual(attempt);
      expect(attemptRepo.findByIdForUpdate).toHaveBeenCalledWith(
        ctx,
        "attempt-1",
      );
    });

    it("enrollment adapter delegates to enrollment repo with ctx", async () => {
      const examRepo = createMockExamRepo();
      const attemptRepo = createMockAttemptRepo();
      const enrollmentRepo = createMockEnrollmentRepo();
      const enrollment = { id: "enroll-1" };
      enrollmentRepo.findByExamAndCandidateForUpdate.mockResolvedValue(
        enrollment,
      );

      const { enrollments } = createExamEngineRepos(
        {
          examRepo: examRepo as never,
          attemptRepo: attemptRepo as never,
          enrollmentRepo: enrollmentRepo as never,
        },
        ctx,
      );
      const result = await enrollments.findByExamAndCandidateForUpdate(
        "exam-1",
        "cand-1",
      );

      expect(result).toEqual(enrollment);
      expect(
        enrollmentRepo.findByExamAndCandidateForUpdate,
      ).toHaveBeenCalledWith(ctx, "exam-1", "cand-1");
    });
  });
});
