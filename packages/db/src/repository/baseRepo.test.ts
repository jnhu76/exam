import { randomUUID } from "node:crypto";
import type { RequestContext } from "@exam/domain";
import { beforeAll, describe, expect, it, afterAll } from "vitest";
import { getIsolatedTestDb } from "../testDb.js";
import { createAsyncTenantCrudRepo } from "./baseRepo.js";
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

describe("baseRepo count and listPaginated", () => {
  let db: Database;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    const result = await getIsolatedTestDb("db-baseRepo-count");
    db = result.db;
    cleanup = result.cleanup;
  }, 30_000);

  afterAll(async () => {
    await cleanup();
  }, 30_000);

  async function seedOrg(name: string) {
    const orgRepo = createOrganizationRepo(db);
    const ctx = createContext("system");
    const org = await orgRepo.create(ctx, {
      name,
      displayName: name,
      slug: `${name.toLowerCase()}-${randomUUID().slice(0, 8)}`,
    });
    return org.id;
  }

  it("count returns 0 for empty table", async () => {
    const orgId = await seedOrg("empty");
    const ctx = createContext(orgId);
    const repo = createAsyncTenantCrudRepo(db, schema.courses);

    const count = await repo.count(ctx);
    expect(count).toBe(0);
  });

  it("count returns correct number of rows for tenant", async () => {
    const orgId = await seedOrg("three");
    const ctx = createContext(orgId);
    const repo = createAsyncTenantCrudRepo(db, schema.courses);

    await repo.create(ctx, {
      name: "Course A",
      code: `A${randomUUID().slice(0, 4)}`,
      description: "",
    });
    await repo.create(ctx, {
      name: "Course B",
      code: `B${randomUUID().slice(0, 4)}`,
      description: "",
    });
    await repo.create(ctx, {
      name: "Course C",
      code: `C${randomUUID().slice(0, 4)}`,
      description: "",
    });

    const count = await repo.count(ctx);
    expect(count).toBe(3);
  });

  it("count isolates tenants", async () => {
    const orgAlpha = await seedOrg("alpha");
    const orgBeta = await seedOrg("beta");
    const ctxAlpha = createContext(orgAlpha);
    const ctxBeta = createContext(orgBeta);
    const repo = createAsyncTenantCrudRepo(db, schema.courses);

    await repo.create(ctxAlpha, {
      name: "Alpha 1",
      code: `A1${randomUUID().slice(0, 4)}`,
      description: "",
    });
    await repo.create(ctxAlpha, {
      name: "Alpha 2",
      code: `A2${randomUUID().slice(0, 4)}`,
      description: "",
    });
    await repo.create(ctxBeta, {
      name: "Beta 1",
      code: `B1${randomUUID().slice(0, 4)}`,
      description: "",
    });

    expect(await repo.count(ctxAlpha)).toBe(2);
    expect(await repo.count(ctxBeta)).toBe(1);
  });

  it("listPaginated returns correct total across pages", async () => {
    const orgId = await seedOrg("pages");
    const ctx = createContext(orgId);
    const repo = createAsyncTenantCrudRepo(db, schema.courses);

    for (let i = 0; i < 5; i++) {
      await repo.create(ctx, {
        name: `Page Course ${i}`,
        code: `P${i}${randomUUID().slice(0, 4)}`,
        description: "",
      });
    }

    const page1 = await repo.listPaginated(ctx, 1, 2);
    expect(page1.items).toHaveLength(2);
    expect(page1.total).toBe(5);

    const page3 = await repo.listPaginated(ctx, 3, 2);
    expect(page3.items).toHaveLength(1);
    expect(page3.total).toBe(5);
  });

  it("listPaginated total is tenant-scoped", async () => {
    const orgAlpha = await seedOrg("alphaPage");
    const orgBeta = await seedOrg("betaPage");
    const ctxAlpha = createContext(orgAlpha);
    const ctxBeta = createContext(orgBeta);
    const repo = createAsyncTenantCrudRepo(db, schema.courses);

    for (let i = 0; i < 3; i++) {
      await repo.create(ctxAlpha, {
        name: `Alpha ${i}`,
        code: `A${i}${randomUUID().slice(0, 4)}`,
        description: "",
      });
    }
    await repo.create(ctxBeta, {
      name: "Beta",
      code: `B${randomUUID().slice(0, 4)}`,
      description: "",
    });

    const alphaPage = await repo.listPaginated(ctxAlpha, 1, 10);
    expect(alphaPage.total).toBe(3);

    const betaPage = await repo.listPaginated(ctxBeta, 1, 10);
    expect(betaPage.total).toBe(1);
  });
});
