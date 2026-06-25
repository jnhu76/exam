import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { RequestContext } from "@exam/domain";
import { beforeAll, describe, expect, it, afterAll } from "vitest";
import { getIsolatedTestDb } from "../testDb.js";
import { createClientEventRepo } from "./clientEventRepo.js";
import { createOrganizationRepo } from "./organizationRepo.js";
import { schema } from "../schema/pg.js";
import type { Database } from "../types.js";

function createContext(organizationId: string): RequestContext {
  return {
    actorId: randomUUID(),
    organizationId,
    role: "Admin",
    permissions: [],
    sessionId: randomUUID(),
  };
}

describe("clientEventRepo.createMany", () => {
  let db: Database;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    const result = await getIsolatedTestDb("db-clientEventRepo");
    db = result.db;
    cleanup = result.cleanup;
  });

  afterAll(async () => {
    await cleanup();
  });

  async function seedOrg(name: string) {
    const orgRepo = createOrganizationRepo(db);
    const org = await orgRepo.create(createContext("system"), {
      name,
      displayName: name,
      slug: `${name.toLowerCase()}-${randomUUID().slice(0, 8)}`,
    });
    return org.id;
  }

  it("inserts a batch scoped to the context organizationId", async () => {
    const orgId = await seedOrg("ClientEventOrg");
    const ctx = createContext(orgId);
    const repo = createClientEventRepo(db);
    const receivedAt = new Date();

    const inserted = await repo.createMany(ctx, [
      {
        userId: ctx.actorId,
        attemptId: null,
        examId: null,
        questionId: null,
        kind: "log",
        level: "warn",
        name: "test.repo.one",
        route: null,
        occurredAt: new Date("2026-06-25T00:00:00.000Z"),
        receivedAt,
        clientSessionId: null,
        metadata: { foo: "bar" },
        userAgent: "vitest",
      },
      {
        userId: ctx.actorId,
        attemptId: null,
        examId: null,
        questionId: null,
        kind: "log",
        level: "error",
        name: "test.repo.two",
        route: null,
        occurredAt: new Date("2026-06-25T00:00:01.000Z"),
        receivedAt,
        clientSessionId: null,
        metadata: {},
        userAgent: null,
      },
    ]);

    expect(inserted).toBe(2);

    const rows = await db
      .select()
      .from(schema.clientEvents)
      .where(eq(schema.clientEvents.organizationId, orgId));
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.userId === ctx.actorId)).toBe(true);
    expect(rows.map((r) => r.name).sort()).toEqual([
      "test.repo.one",
      "test.repo.two",
    ]);
    expect(rows[0]!.metadata).toEqual({ foo: "bar" });

    // Clean up this org's rows.
    await db
      .delete(schema.clientEvents)
      .where(eq(schema.clientEvents.organizationId, orgId));
  });

  it("returns 0 and writes nothing for an empty batch", async () => {
    const orgId = await seedOrg("ClientEventEmpty");
    const ctx = createContext(orgId);
    const repo = createClientEventRepo(db);

    const inserted = await repo.createMany(ctx, []);
    expect(inserted).toBe(0);
  });

  it("keeps events isolated per organization", async () => {
    const orgA = await seedOrg("ClientEventOrgA");
    const orgB = await seedOrg("ClientEventOrgB");
    const repo = createClientEventRepo(db);
    const marker = `isolation.${randomUUID()}`;

    await repo.createMany(createContext(orgA), [
      {
        userId: "u-a",
        attemptId: null,
        examId: null,
        questionId: null,
        kind: "log",
        level: "info",
        name: marker,
        route: null,
        occurredAt: new Date(),
        receivedAt: new Date(),
        clientSessionId: null,
        metadata: {},
        userAgent: null,
      },
    ]);

    const inB = await db
      .select()
      .from(schema.clientEvents)
      .where(eq(schema.clientEvents.organizationId, orgB));
    expect(inB.filter((r) => r.name === marker)).toHaveLength(0);

    await db
      .delete(schema.clientEvents)
      .where(eq(schema.clientEvents.name, marker));
  });
});
