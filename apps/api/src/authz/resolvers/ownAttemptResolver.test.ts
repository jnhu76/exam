import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the attempt repo so the resolver logic (org-anchor, ownership chain,
// not-found, no-throw) is tested without DB fixtures. The `throwNext` flag
// drives the resolver_error case without resetting the module registry (which
// would invalidate the top-level import for sibling tests).
let ownAttemptChain: Record<string, unknown> | null = null;
let throwNext = false;

vi.mock("@exam/db/src/repository/attemptRepo.js", () => ({
  createAttemptRepo: () => ({
    findOwnAttemptChain: async (_ctx: unknown, id: string) => {
      if (throwNext) throw new Error("db down");
      return ownAttemptChain && ownAttemptChain.attemptId === id
        ? ownAttemptChain
        : null;
    },
  }),
}));

const { resolveOwnAttemptScope, isOwnAttemptDenied } =
  await import("./ownAttemptResolver.js");

const ORG = randomUUID();
const ACTOR = randomUUID();
const OTHER_ACTOR = randomUUID();

function sameOrgChain(overrides: Partial<Record<string, unknown>> = {}) {
  // linkedXxxId mirrors xxxId (a legitimate FK link); the resolver's
  // materializeChain rejects when they diverge (broken parent chain).
  const examId = randomUUID();
  const courseId = randomUUID();
  return {
    attemptId: randomUUID(),
    attemptOrganizationId: ORG,
    candidateId: randomUUID(),
    ownerUserId: ACTOR,
    candidateProfileOrganizationId: ORG,
    linkedExamId: examId,
    examId,
    examOrganizationId: ORG,
    linkedCourseId: courseId,
    courseId,
    courseOrganizationId: ORG,
    organizationId: ORG,
    ...overrides,
  };
}

describe("RBAC-M10-A own-attempt resolver", () => {
  beforeEach(() => {
    ownAttemptChain = null;
    throwNext = false;
  });

  it("resolves a same-org own attempt with ownership facts", async () => {
    const row = sameOrgChain();
    ownAttemptChain = row;
    const r = await resolveOwnAttemptScope(
      {} as never,
      undefined,
      { actorId: ACTOR, organizationId: ORG },
      row.attemptId as string,
    );
    expect(isOwnAttemptDenied(r)).toBe(false);
    expect(r).toMatchObject({
      scope: "own_attempt",
      organizationId: ORG,
      resourceId: row.attemptId,
      ownership: { candidateId: row.candidateId, ownerUserId: ACTOR },
    });
  });

  it("denies resource_not_found for a missing attempt", async () => {
    const r = await resolveOwnAttemptScope(
      {} as never,
      undefined,
      { actorId: ACTOR, organizationId: ORG },
      randomUUID(),
    );
    expect(r).toMatchObject({ denied: true, reason: "resource_not_found" });
  });

  it("denies broken_parent_chain when the exam parent is missing", async () => {
    const row = sameOrgChain({
      linkedExamId: randomUUID(),
      examId: null,
      examOrganizationId: null,
      linkedCourseId: null,
      courseId: null,
      courseOrganizationId: null,
      organizationId: null,
    });
    ownAttemptChain = row;
    const logger = { warn: vi.fn(), error: vi.fn() };
    const r = await resolveOwnAttemptScope(
      {} as never,
      logger as never,
      { actorId: ACTOR, organizationId: ORG },
      row.attemptId as string,
    );
    expect(r).toMatchObject({ denied: true, reason: "broken_parent_chain" });
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it("denies organization_mismatch anywhere in the chain", async () => {
    const foreign = randomUUID();
    const row = sameOrgChain({
      courseOrganizationId: foreign,
      organizationId: foreign,
    });
    ownAttemptChain = row;
    const logger = { warn: vi.fn(), error: vi.fn() };
    const r = await resolveOwnAttemptScope(
      {} as never,
      logger as never,
      { actorId: ACTOR, organizationId: ORG },
      row.attemptId as string,
    );
    expect(r).toMatchObject({ denied: true, reason: "organization_mismatch" });
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it("maps a cross-candidate probe (resolved, not owner) at the resolver as a successful resolution — the ownership verdict is the preHandler's, not the resolver's (404 is decided from ownership + capability, preserving anti-enumeration)", async () => {
    // The resolver returns ownership facts for a same-org attempt regardless of
    // who owns it; the preHandler decides the 404 anti-enumeration outcome.
    // This is the scoreResolver precedent: the resolver is org-anchor + chain,
    // not a role/identity branch.
    const row = sameOrgChain({ ownerUserId: OTHER_ACTOR });
    ownAttemptChain = row;
    const r = await resolveOwnAttemptScope(
      {} as never,
      undefined,
      { actorId: ACTOR, organizationId: ORG },
      row.attemptId as string,
    );
    expect(isOwnAttemptDenied(r)).toBe(false);
    expect(r).toMatchObject({
      scope: "own_attempt",
      ownership: { ownerUserId: OTHER_ACTOR },
    });
  });

  it("resolves when candidate profile organization matches the core org anchor", async () => {
    const row = sameOrgChain({ candidateProfileOrganizationId: ORG });
    ownAttemptChain = row;
    const r = await resolveOwnAttemptScope(
      {} as never,
      undefined,
      { actorId: ACTOR, organizationId: ORG },
      row.attemptId as string,
    );
    expect(isOwnAttemptDenied(r)).toBe(false);
    expect(r).toMatchObject({
      scope: "own_attempt",
      organizationId: ORG,
    });
  });

  it("denies organization_mismatch when candidate profile organization differs from the core org anchor", async () => {
    const foreign = randomUUID();
    const row = sameOrgChain({ candidateProfileOrganizationId: foreign });
    ownAttemptChain = row;
    const logger = { warn: vi.fn(), error: vi.fn() };
    const r = await resolveOwnAttemptScope(
      {} as never,
      logger as never,
      { actorId: ACTOR, organizationId: ORG },
      row.attemptId as string,
    );
    expect(r).toMatchObject({ denied: true, reason: "organization_mismatch" });
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it("does not fail on null candidate profile organization (missing profile is an existence fact, not a chain failure)", async () => {
    const row = sameOrgChain({
      candidateProfileOrganizationId: null,
      candidateId: null,
      ownerUserId: null,
    });
    ownAttemptChain = row;
    const r = await resolveOwnAttemptScope(
      {} as never,
      undefined,
      { actorId: ACTOR, organizationId: ORG },
      row.attemptId as string,
    );
    expect(isOwnAttemptDenied(r)).toBe(false);
    expect(r).toMatchObject({
      ownership: { candidateId: null, ownerUserId: null },
    });
  });

  it("surfaces resolver_error (never fail open) when the repo throws", async () => {
    throwNext = true;
    const logger = { warn: vi.fn(), error: vi.fn() };
    const r = await resolveOwnAttemptScope(
      {} as never,
      logger as never,
      { actorId: ACTOR, organizationId: ORG },
      randomUUID(),
    );
    expect(r).toMatchObject({ denied: true, reason: "resolver_error" });
    expect(logger.error).toHaveBeenCalledOnce();
  });
});
