import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the repos so the resolver logic (org-anchor, not-found, broken chain)
// is tested without DB fixtures (same pattern as attemptResolver.test.ts).
let courseChain: Record<string, unknown> | null = null;
let questionChain: Record<string, unknown> | null = null;

vi.mock("@exam/db/src/repository/courseRepo.js", () => ({
  createCourseRepo: () => ({
    findAuthorizationChain: async (_ctx: unknown, id: string) =>
      courseChain && courseChain.courseId === id ? courseChain : null,
  }),
}));
vi.mock("@exam/db/src/repository/questionRepo.js", () => ({
  createQuestionRepo: () => ({
    findAuthorizationChain: async (_ctx: unknown, id: string) =>
      questionChain && questionChain.questionId === id ? questionChain : null,
  }),
}));

const { createCourseResolver, createQuestionResolver } =
  await import("./courseResolver.js");

const ORG = randomUUID();
const ACTOR = randomUUID();

describe("course scope resolver (issue #286)", () => {
  beforeEach(() => {
    courseChain = null;
    questionChain = null;
  });

  it("resolves a same-org course to Scope.Course", async () => {
    const id = randomUUID();
    courseChain = {
      courseId: id,
      courseOrganizationId: ORG,
      organizationId: ORG,
    };
    const r = await createCourseResolver({} as never).resolve(
      { actorId: ACTOR, organizationId: ORG },
      { type: "course", id },
    );
    expect(r).toMatchObject({
      scope: "course",
      organizationId: ORG,
      resourceId: id,
      chain: [{ type: "course", id }],
    });
  });

  it("denies resource_not_found for a missing course", async () => {
    const r = await createCourseResolver({} as never).resolve(
      { actorId: ACTOR, organizationId: ORG },
      { type: "course", id: randomUUID() },
    );
    expect(r).toMatchObject({ denied: true, reason: "resource_not_found" });
  });

  it("denies organization_mismatch when the course belongs to another org", async () => {
    const id = randomUUID();
    const foreignOrg = randomUUID();
    courseChain = {
      courseId: id,
      courseOrganizationId: foreignOrg,
      organizationId: foreignOrg,
    };
    const logger = { warn: vi.fn(), error: vi.fn() };
    const r = await createCourseResolver({} as never, logger as never).resolve(
      { actorId: ACTOR, organizationId: ORG },
      { type: "course", id },
    );
    expect(r).toMatchObject({ denied: true, reason: "organization_mismatch" });
  });
});

describe("question scope resolver (issue #286)", () => {
  beforeEach(() => {
    courseChain = null;
    questionChain = null;
  });

  it("resolves a same-org question through its durable parent course", async () => {
    const id = randomUUID();
    const courseId = randomUUID();
    questionChain = {
      questionId: id,
      questionOrganizationId: ORG,
      linkedCourseId: courseId,
      courseId,
      courseOrganizationId: ORG,
      organizationId: ORG,
    };
    const r = await createQuestionResolver({} as never).resolve(
      { actorId: ACTOR, organizationId: ORG },
      { type: "question", id },
    );
    expect(r).toMatchObject({
      scope: "course",
      organizationId: ORG,
      resourceId: id,
      chain: [
        { type: "question", id },
        { type: "course", id: courseId },
      ],
    });
  });

  it("denies broken_parent_chain when the question's course parent is missing", async () => {
    const id = randomUUID();
    const linkedCourseId = randomUUID();
    questionChain = {
      questionId: id,
      questionOrganizationId: ORG,
      linkedCourseId,
      courseId: null,
      courseOrganizationId: null,
      organizationId: null,
    };
    const logger = { warn: vi.fn(), error: vi.fn() };
    const r = await createQuestionResolver(
      {} as never,
      logger as never,
    ).resolve(
      { actorId: ACTOR, organizationId: ORG },
      { type: "question", id },
    );
    expect(r).toMatchObject({ denied: true, reason: "broken_parent_chain" });
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it("denies resource_not_found for a missing question", async () => {
    const r = await createQuestionResolver({} as never).resolve(
      { actorId: ACTOR, organizationId: ORG },
      { type: "question", id: randomUUID() },
    );
    expect(r).toMatchObject({ denied: true, reason: "resource_not_found" });
  });
});
