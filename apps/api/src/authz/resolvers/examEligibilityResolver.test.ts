import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

let eligibilityChain: Record<string, unknown> | null = null;
let throwNext = false;

vi.mock("@exam/db/src/repository/examRepo.js", () => ({
  createExamRepo: () => ({
    findCandidateEligibilityChain: async (
      _ctx: unknown,
      examId: string,
      _userId: string,
    ) => {
      if (throwNext) throw new Error("db down");
      return eligibilityChain && eligibilityChain.examId === examId
        ? eligibilityChain
        : null;
    },
  }),
}));

const { resolveExamEligibilityScope, isExamEligibilityDenied } =
  await import("./examEligibilityResolver.js");

const ORG = randomUUID();
const ACTOR = randomUUID();

function sameOrgChain(overrides: Partial<Record<string, unknown>> = {}) {
  // linkedCourseId mirrors courseId (legitimate FK link); the resolver's
  // materializeChain rejects when they diverge (broken parent chain).
  const courseId = randomUUID();
  return {
    examId: randomUUID(),
    examOrganizationId: ORG,
    linkedCourseId: courseId,
    courseId,
    courseOrganizationId: ORG,
    organizationId: ORG,
    candidateProfileId: randomUUID(),
    candidateProfileOrganizationId: ORG,
    ownerUserId: ACTOR,
    enrollmentId: randomUUID(),
    enrollmentOrganizationId: ORG,
    ...overrides,
  };
}

describe("RBAC-M10-A exam-eligibility resolver", () => {
  beforeEach(() => {
    eligibilityChain = null;
    throwNext = false;
  });

  it("resolves a same-org enrolled candidate with eligibility facts", async () => {
    const row = sameOrgChain();
    eligibilityChain = row;
    const r = await resolveExamEligibilityScope(
      {} as never,
      undefined,
      { actorId: ACTOR, organizationId: ORG },
      row.examId as string,
    );
    expect(isExamEligibilityDenied(r)).toBe(false);
    expect(r).toMatchObject({
      scope: "own_attempt",
      organizationId: ORG,
      resourceId: row.examId,
      ownership: {
        candidateProfileId: row.candidateProfileId,
        ownerUserId: ACTOR,
        enrollmentId: row.enrollmentId,
      },
    });
  });

  it("denies resource_not_found for a missing exam", async () => {
    const r = await resolveExamEligibilityScope(
      {} as never,
      undefined,
      { actorId: ACTOR, organizationId: ORG },
      randomUUID(),
    );
    expect(r).toMatchObject({ denied: true, reason: "resource_not_found" });
  });

  it("denies broken_parent_chain when the course parent is missing", async () => {
    const row = sameOrgChain({
      linkedCourseId: randomUUID(),
      courseId: null,
      courseOrganizationId: null,
      organizationId: null,
    });
    eligibilityChain = row;
    const logger = { warn: vi.fn(), error: vi.fn() };
    const r = await resolveExamEligibilityScope(
      {} as never,
      logger as never,
      { actorId: ACTOR, organizationId: ORG },
      row.examId as string,
    );
    expect(r).toMatchObject({ denied: true, reason: "broken_parent_chain" });
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it("denies organization_mismatch when the core chain crosses orgs", async () => {
    const foreign = randomUUID();
    const row = sameOrgChain({
      courseOrganizationId: foreign,
      organizationId: foreign,
    });
    eligibilityChain = row;
    const logger = { warn: vi.fn(), error: vi.fn() };
    const r = await resolveExamEligibilityScope(
      {} as never,
      logger as never,
      { actorId: ACTOR, organizationId: ORG },
      row.examId as string,
    );
    expect(r).toMatchObject({ denied: true, reason: "organization_mismatch" });
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it("resolves (not denies) when the actor has no candidate profile — the preHandler decides the 404 (anti-enumeration), the resolver only reports facts", async () => {
    // A candidate with no profile / no enrollment still resolves the exam
    // chain under the org anchor; the eligibility facts are null and the
    // preHandler maps that to 404. The resolver does not branch on identity.
    const row = sameOrgChain({
      candidateProfileId: null,
      candidateProfileOrganizationId: null,
      ownerUserId: null,
      enrollmentId: null,
      enrollmentOrganizationId: null,
    });
    eligibilityChain = row;
    const r = await resolveExamEligibilityScope(
      {} as never,
      undefined,
      { actorId: ACTOR, organizationId: ORG },
      row.examId as string,
    );
    expect(isExamEligibilityDenied(r)).toBe(false);
    expect(r).toMatchObject({
      scope: "own_attempt",
      ownership: {
        candidateProfileId: null,
        enrollmentId: null,
        ownerUserId: null,
      },
    });
  });

  it("surfaces resolver_error (never fail open) when the repo throws", async () => {
    throwNext = true;
    const logger = { warn: vi.fn(), error: vi.fn() };
    const r = await resolveExamEligibilityScope(
      {} as never,
      logger as never,
      { actorId: ACTOR, organizationId: ORG },
      randomUUID(),
    );
    expect(r).toMatchObject({ denied: true, reason: "resolver_error" });
    expect(logger.error).toHaveBeenCalledOnce();
  });
});
