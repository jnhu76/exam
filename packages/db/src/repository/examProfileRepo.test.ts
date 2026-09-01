import { randomUUID } from "node:crypto";
import type { RequestContext } from "@exam/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schema } from "../schema/pg.js";
import { getIsolatedTestDb } from "../testDb.js";
import type { Database } from "../types.js";
import { createExamProfileRepo } from "./examProfileRepo.js";

function context(organizationId: string, actorId: string): RequestContext {
  return {
    actorId,
    organizationId,
    role: "Admin",
    permissions: [],
    sessionId: randomUUID(),
  };
}

/** Extract the PostgreSQL constraint name from a 23505 error chain. */
function constraintNameOf(err: unknown): string | null {
  let current: unknown = err;
  const visited = new Set<unknown>();
  while (current && !visited.has(current)) {
    visited.add(current);
    if (typeof current === "object" && current !== null) {
      const e = current as Record<string, unknown>;
      if (e.code === "23505") {
        return String(e.constraint ?? e.constraint_name ?? "");
      }
      current = "cause" in e ? e.cause : null;
    } else {
      current = null;
    }
  }
  return null;
}

describe("examProfileRepo — organization-scoped CRUD (P7-M2 §10/§27)", () => {
  let db: Database;
  let cleanup: () => Promise<void>;
  let orgA: string;
  let orgB: string;
  let actor: string;
  let ctxA: RequestContext;
  let ctxB: RequestContext;
  const now = new Date("2026-01-01T00:00:00.000Z");

  const profileInput = {
    name: "Standard",
    description: "Default template",
    durationMinutes: 60,
    latestStartOffsetMinutes: 10,
    minSubmitAfterStartMinutes: null,
    retakePolicy: "max_attempts" as const,
    maxAttempts: 2,
    scoreStrategy: "highest" as const,
    resultPublicationMode: "after_grading" as const,
    interruptionTimePolicy: "bounded_grace" as const,
    interruptionGracePerIncidentSeconds: 120,
    interruptionGracePerAttemptSeconds: 600,
  };

  beforeAll(async () => {
    const result = await getIsolatedTestDb("db-examProfileRepo");
    db = result.db;
    cleanup = result.cleanup;
    orgA = randomUUID();
    orgB = randomUUID();
    actor = randomUUID();
    ctxA = context(orgA, actor);
    ctxB = context(orgB, actor);
    await db.insert(schema.organizations).values([
      {
        id: orgA,
        name: `Org A ${orgA}`,
        displayName: `Org A ${orgA}`,
        slug: `org-a-${orgA}`,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: orgB,
        name: `Org B ${orgB}`,
        displayName: `Org B ${orgB}`,
        slug: `org-b-${orgB}`,
        createdAt: now,
        updatedAt: now,
      },
    ]);
  }, 30_000);

  afterAll(async () => {
    await cleanup();
  });

  it("creates a profile scoped to the requesting organization", async () => {
    const repo = createExamProfileRepo(db);
    const profile = await repo.create(ctxA, profileInput);
    expect(profile.id).toBeDefined();
    expect(profile.organizationId).toBe(orgA);
    expect(profile.name).toBe("Standard");
    expect(profile.durationMinutes).toBe(60);
    expect(profile.interruptionTimePolicy).toBe("bounded_grace");
  });

  it("findById only returns rows from the same organization (fail closed)", async () => {
    const repo = createExamProfileRepo(db);
    const profile = await repo.create(ctxA, {
      ...profileInput,
      name: "Only-Org-A",
    });
    expect((await repo.findById(ctxA, profile.id))?.id).toBe(profile.id);
    expect(await repo.findById(ctxB, profile.id)).toBeNull();
  });

  it("list returns only the organization's profiles, ordered deterministically", async () => {
    const repo = createExamProfileRepo(db);
    await repo.create(ctxB, { ...profileInput, name: "Org-B-Profile" });
    const listA = await repo.list(ctxA);
    const listB = await repo.list(ctxB);
    expect(listA.some((p) => p.name === "Org-B-Profile")).toBe(false);
    expect(listB.some((p) => p.name === "Org-B-Profile")).toBe(true);
    // Deterministic ordering: createdAt asc, id tie-break.
    const times = listA.map((p) => p.createdAt.getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it("update is org-scoped and touches updatedAt", async () => {
    const repo = createExamProfileRepo(db);
    const profile = await repo.create(ctxA, {
      ...profileInput,
      name: "Update-Me",
    });
    const updated = await repo.update(ctxA, profile.id, {
      durationMinutes: 90,
      latestStartOffsetMinutes: null,
    });
    expect(updated?.durationMinutes).toBe(90);
    expect(updated?.latestStartOffsetMinutes).toBeNull();
    // Foreign-org update is a no-op (returns null).
    expect(await repo.update(ctxB, profile.id, { maxAttempts: 9 })).toBeNull();
    const unchanged = await repo.findById(ctxA, profile.id);
    expect(unchanged?.maxAttempts).toBe(2);
  });

  it("delete is org-scoped; foreign-org delete returns false", async () => {
    const repo = createExamProfileRepo(db);
    const profile = await repo.create(ctxA, {
      ...profileInput,
      name: "Delete-Me",
    });
    expect(await repo.delete(ctxB, profile.id)).toBe(false);
    expect(await repo.findById(ctxA, profile.id)).not.toBeNull();
    expect(await repo.delete(ctxA, profile.id)).toBe(true);
    expect(await repo.findById(ctxA, profile.id)).toBeNull();
  });

  it("rejects duplicate (organizationId, name) at the unique constraint", async () => {
    const repo = createExamProfileRepo(db);
    await repo.create(ctxA, { ...profileInput, name: "Dup-Name" });
    await expect(
      repo.create(ctxA, { ...profileInput, name: "Dup-Name" }),
    ).rejects.toSatisfy(
      (err) => constraintNameOf(err) === "exam_policy_profiles_org_name_unique",
    );
    // Same name in a DIFFERENT organization is allowed.
    const otherOrg = await repo.create(ctxB, {
      ...profileInput,
      name: "Dup-Name",
    });
    expect(otherOrg.organizationId).toBe(orgB);
  });
});
