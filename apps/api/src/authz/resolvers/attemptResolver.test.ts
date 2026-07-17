import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the repos so the resolver logic (org-anchor, not-found, no-throw) is
// tested without DB fixtures. Each test seeds the mock's return value.
let attemptChain: Record<string, unknown> | null = null;
let examChain: Record<string, unknown> | null = null;

vi.mock("@exam/db/src/repository/attemptRepo.js", () => ({
  createAttemptRepo: () => ({
    findAuthorizationChain: async (_ctx: unknown, id: string) =>
      attemptChain && attemptChain.attemptId === id ? attemptChain : null,
  }),
}));
vi.mock("@exam/db/src/repository/examRepo.js", () => ({
  createExamRepo: () => ({
    findAuthorizationChain: async (_ctx: unknown, id: string) =>
      examChain && examChain.examId === id ? examChain : null,
  }),
}));

const { createAttemptResolver, createExamResolver } =
  await import("./attemptResolver.js");

const ORG = randomUUID();
const ACTOR = randomUUID();

describe("RBAC Step 3 attempt resolver", () => {
  beforeEach(() => {
    attemptChain = null;
    examChain = null;
  });

  it("resolves a same-org attempt", async () => {
    const id = randomUUID();
    const examId = randomUUID();
    const courseId = randomUUID();
    attemptChain = {
      attemptId: id,
      attemptOrganizationId: ORG,
      linkedExamId: examId,
      examId,
      examOrganizationId: ORG,
      linkedCourseId: courseId,
      courseId,
      courseOrganizationId: ORG,
      organizationId: ORG,
    };
    const resolver = createAttemptResolver({} as never);
    const r = await resolver.resolve(
      { actorId: ACTOR, organizationId: ORG },
      { type: "attempt", id },
    );
    expect(r).toMatchObject({
      scope: "attempt",
      organizationId: ORG,
      resourceId: id,
      chain: [
        { type: "attempt", id },
        { type: "exam", id: examId },
        { type: "course", id: courseId },
      ],
    });
  });

  it("denies and monitors an attempt whose exam parent is missing", async () => {
    const id = randomUUID();
    const linkedExamId = randomUUID();
    attemptChain = {
      attemptId: id,
      attemptOrganizationId: ORG,
      linkedExamId,
      examId: null,
      examOrganizationId: null,
      linkedCourseId: null,
      courseId: null,
      courseOrganizationId: null,
      organizationId: null,
    };
    const logger = { warn: vi.fn(), error: vi.fn() };

    const r = await createAttemptResolver({} as never, logger as never).resolve(
      { actorId: ACTOR, organizationId: ORG },
      { type: "attempt", id },
    );

    expect(r).toMatchObject({ denied: true, reason: "broken_parent_chain" });
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it("denies and monitors an organization mismatch anywhere in the attempt chain", async () => {
    const id = randomUUID();
    const examId = randomUUID();
    const courseId = randomUUID();
    const foreignOrg = randomUUID();
    attemptChain = {
      attemptId: id,
      attemptOrganizationId: ORG,
      linkedExamId: examId,
      examId,
      examOrganizationId: ORG,
      linkedCourseId: courseId,
      courseId,
      courseOrganizationId: foreignOrg,
      organizationId: foreignOrg,
    };
    const logger = { warn: vi.fn(), error: vi.fn() };

    const r = await createAttemptResolver({} as never, logger as never).resolve(
      { actorId: ACTOR, organizationId: ORG },
      { type: "attempt", id },
    );

    expect(r).toMatchObject({ denied: true, reason: "organization_mismatch" });
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it("denies resource_not_found for a missing attempt", async () => {
    const resolver = createAttemptResolver({} as never);
    const r = await resolver.resolve(
      { actorId: ACTOR, organizationId: ORG },
      { type: "attempt", id: randomUUID() },
    );
    expect(r).toMatchObject({ denied: true, reason: "resource_not_found" });
  });
});

describe("RBAC Step 3 exam resolver", () => {
  beforeEach(() => {
    attemptChain = null;
    examChain = null;
  });

  it("resolves a same-org exam", async () => {
    const id = randomUUID();
    const courseId = randomUUID();
    examChain = {
      examId: id,
      examOrganizationId: ORG,
      linkedCourseId: courseId,
      courseId,
      courseOrganizationId: ORG,
      organizationId: ORG,
    };
    const resolver = createExamResolver({} as never);
    const r = await resolver.resolve(
      { actorId: ACTOR, organizationId: ORG },
      { type: "exam", id },
    );
    expect(r).toMatchObject({
      scope: "exam",
      organizationId: ORG,
      resourceId: id,
      chain: [
        { type: "exam", id },
        { type: "course", id: courseId },
      ],
    });
  });

  it("denies and monitors an exam whose course belongs to another organization", async () => {
    const id = randomUUID();
    const courseId = randomUUID();
    const foreignOrg = randomUUID();
    examChain = {
      examId: id,
      examOrganizationId: ORG,
      linkedCourseId: courseId,
      courseId,
      courseOrganizationId: foreignOrg,
      organizationId: foreignOrg,
    };
    const logger = { warn: vi.fn(), error: vi.fn() };

    const r = await createExamResolver({} as never, logger as never).resolve(
      { actorId: ACTOR, organizationId: ORG },
      { type: "exam", id },
    );

    expect(r).toMatchObject({ denied: true, reason: "organization_mismatch" });
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it("denies resource_not_found for a missing exam", async () => {
    const resolver = createExamResolver({} as never);
    const r = await resolver.resolve(
      { actorId: ACTOR, organizationId: ORG },
      { type: "exam", id: randomUUID() },
    );
    expect(r).toMatchObject({ denied: true, reason: "resource_not_found" });
  });
});
