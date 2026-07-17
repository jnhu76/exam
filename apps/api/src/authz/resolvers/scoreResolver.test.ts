import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Unit tests for the score resource resolver
 * (RBAC-SCOPED-AUTHORIZATION-CORRECTIVE-1, ADR §Resource Resolver Matrix `score`).
 *
 * Verifies:
 *   - success path surfaces ownership facts (candidateId, ownerUserId)
 *   - resource_not_found / broken_parent_chain / organization_mismatch denials
 *   - operational errors surface as resolver_error (ADR §3.9, never throw)
 *
 * Mirrors attemptResolver.test.ts: repos are mocked so the chain-integrity
 * logic is tested without DB fixtures.
 */
let scoreChain: Record<string, unknown> | null = null;
let shouldThrow = false;

vi.mock("@exam/db/src/repository/attemptRepo.js", () => ({
  createAttemptRepo: () => ({
    findScoreOwnershipChain: async (_ctx: unknown, id: string) => {
      if (shouldThrow) {
        throw new Error("simulated DB outage");
      }
      return scoreChain && scoreChain.attemptId === id ? scoreChain : null;
    },
  }),
}));

const { resolveScoreScope, isScoreDenied } = await import("./scoreResolver.js");

const ORG = randomUUID();
const ACTOR = randomUUID();

describe("score resolver — success surfaces ownership facts", () => {
  beforeEach(() => {
    scoreChain = null;
    shouldThrow = false;
  });

  it("resolves a same-org attempt and returns candidateId + ownerUserId", async () => {
    const id = randomUUID();
    const candidateId = randomUUID();
    const examId = randomUUID();
    const courseId = randomUUID();
    scoreChain = {
      attemptId: id,
      attemptOrganizationId: ORG,
      candidateId,
      ownerUserId: ACTOR,
      linkedExamId: examId,
      examId,
      examOrganizationId: ORG,
      linkedCourseId: courseId,
      courseId,
      courseOrganizationId: ORG,
      organizationId: ORG,
    };
    const r = await resolveScoreScope(
      {} as never,
      undefined,
      {
        actorId: ACTOR,
        organizationId: ORG,
      },
      id,
    );
    expect(isScoreDenied(r)).toBe(false);
    expect(r).toMatchObject({
      scope: "own_score",
      organizationId: ORG,
      resourceId: id,
      ownership: { candidateId, ownerUserId: ACTOR },
    });
  });

  it("returns null ownerUserId when the candidate->user link is missing", async () => {
    const id = randomUUID();
    const examId = randomUUID();
    const courseId = randomUUID();
    scoreChain = {
      attemptId: id,
      attemptOrganizationId: ORG,
      candidateId: randomUUID(),
      ownerUserId: null, // candidate profile exists but user link null
      linkedExamId: examId,
      examId,
      examOrganizationId: ORG,
      linkedCourseId: courseId,
      courseId,
      courseOrganizationId: ORG,
      organizationId: ORG,
    };
    const r = await resolveScoreScope(
      {} as never,
      undefined,
      {
        actorId: ACTOR,
        organizationId: ORG,
      },
      id,
    );
    expect(isScoreDenied(r)).toBe(false);
    expect(
      (r as { ownership: { ownerUserId: string | null } }).ownership,
    ).toMatchObject({ ownerUserId: null });
  });
});

describe("score resolver — deny mapping (ADR §3.9 / §3.4 / §22.1)", () => {
  beforeEach(() => {
    scoreChain = null;
    shouldThrow = false;
  });

  it("denies resource_not_found when the chain load returns null", async () => {
    const r = await resolveScoreScope(
      {} as never,
      undefined,
      {
        actorId: ACTOR,
        organizationId: ORG,
      },
      randomUUID(),
    );
    expect(r).toMatchObject({ denied: true, reason: "resource_not_found" });
  });

  it("denies broken_parent_chain when exam parent is missing", async () => {
    const id = randomUUID();
    scoreChain = {
      attemptId: id,
      attemptOrganizationId: ORG,
      candidateId: randomUUID(),
      ownerUserId: ACTOR,
      linkedExamId: randomUUID(),
      examId: null, // exam join failed
      examOrganizationId: null,
      linkedCourseId: null,
      courseId: null,
      courseOrganizationId: null,
      organizationId: null,
    };
    const logger = { warn: vi.fn(), error: vi.fn() };
    const r = await resolveScoreScope(
      {} as never,
      logger as never,
      {
        actorId: ACTOR,
        organizationId: ORG,
      },
      id,
    );
    expect(r).toMatchObject({ denied: true, reason: "broken_parent_chain" });
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it("denies organization_mismatch when any chain org differs from ctx", async () => {
    const id = randomUUID();
    const examId = randomUUID();
    const courseId = randomUUID();
    const foreignOrg = randomUUID();
    scoreChain = {
      attemptId: id,
      attemptOrganizationId: ORG,
      candidateId: randomUUID(),
      ownerUserId: ACTOR,
      linkedExamId: examId,
      examId,
      examOrganizationId: ORG,
      linkedCourseId: courseId,
      courseId,
      courseOrganizationId: foreignOrg, // foreign org in the chain
      organizationId: foreignOrg,
    };
    const logger = { warn: vi.fn(), error: vi.fn() };
    const r = await resolveScoreScope(
      {} as never,
      logger as never,
      {
        actorId: ACTOR,
        organizationId: ORG,
      },
      id,
    );
    expect(r).toMatchObject({ denied: true, reason: "organization_mismatch" });
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it("surfaces a DB error as resolver_error (never throws, ADR §3.9)", async () => {
    shouldThrow = true;
    const logger = { warn: vi.fn(), error: vi.fn() };
    const r = await resolveScoreScope(
      {} as never,
      logger as never,
      {
        actorId: ACTOR,
        organizationId: ORG,
      },
      randomUUID(),
    );
    expect(r).toMatchObject({ denied: true, reason: "resolver_error" });
    expect(logger.error).toHaveBeenCalledOnce();
  });
});
