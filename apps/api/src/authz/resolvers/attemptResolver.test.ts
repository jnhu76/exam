import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the repos so the resolver logic (org-anchor, not-found, no-throw) is
// tested without DB fixtures. Each test seeds the mock's return value.
let attemptRow: Record<string, unknown> | null = null;
let examRow: Record<string, unknown> | null = null;

vi.mock("@exam/db/src/repository/attemptRepo.js", () => ({
  createAttemptRepo: () => ({
    findById: async (_ctx: unknown, id: string) =>
      attemptRow && attemptRow.id === id ? attemptRow : null,
  }),
}));
vi.mock("@exam/db/src/repository/examRepo.js", () => ({
  createExamRepo: () => ({
    findById: async (_ctx: unknown, id: string) =>
      examRow && examRow.id === id ? examRow : null,
  }),
}));

const { createAttemptResolver, createExamResolver } =
  await import("./attemptResolver.js");

const ORG = randomUUID();
const ACTOR = randomUUID();

describe("RBAC Step 3 attempt resolver", () => {
  beforeEach(() => {
    attemptRow = null;
    examRow = null;
  });

  it("resolves a same-org attempt", async () => {
    const id = randomUUID();
    attemptRow = {
      id,
      organizationId: ORG,
      examId: randomUUID(),
      candidateId: randomUUID(),
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
    });
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
    attemptRow = null;
    examRow = null;
  });

  it("resolves a same-org exam", async () => {
    const id = randomUUID();
    examRow = { id, organizationId: ORG, courseId: randomUUID() };
    const resolver = createExamResolver({} as never);
    const r = await resolver.resolve(
      { actorId: ACTOR, organizationId: ORG },
      { type: "exam", id },
    );
    expect(r).toMatchObject({
      scope: "exam",
      organizationId: ORG,
      resourceId: id,
    });
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
