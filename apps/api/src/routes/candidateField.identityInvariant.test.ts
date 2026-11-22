// INVARIANT (SPEC.md §2.3, #1066): an organization has AT MOST ONE unique
// candidate identity field, and an organization that already has candidates
// never loses its identity field. The at-most-one rule must be enforced at
// the database level (partial unique index on candidate_fields(organization_id)
// WHERE unique): the API prechecks in candidateField.ts are check-then-act
// and cannot survive concurrent requests.
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { hashPassword } from "@exam/auth/password";
import { signJWT } from "@exam/auth/session";
import candidateFieldRoutes from "./candidateField.js";
import candidateRoutes from "./candidate.js";
import { buildTestApp, uniquePrefix } from "./testHelpers.js";
import { schema } from "@exam/db/schema/pg";
import { cleanupOrganizationTestData } from "@exam/db/testCleanup";
import { hasPostgresErrorCode } from "@exam/db/types";
import { getRuntimeConfig } from "../config/runtimeConfig.js";

let ctx: Awaited<ReturnType<typeof buildTestApp>>;
const p = uniquePrefix();
const orgsToClean: string[] = [];

async function makeOrg(tag: string): Promise<{ orgId: string; token: string }> {
  const orgId = crypto.randomUUID();
  const adminId = crypto.randomUUID();
  const now = new Date();
  await ctx.db.insert(schema.organizations).values({
    id: orgId,
    name: `WP02-${tag}-${p}`,
    displayName: `WP02-${tag}`,
    slug: `wp02-${tag}-${p}-${orgId}`,
    createdAt: now,
    updatedAt: now,
  });
  await ctx.db.insert(schema.users).values({
    id: adminId,
    organizationId: orgId,
    username: `wp02-admin-${tag}-${p}`,
    passwordHash: await hashPassword("password123"),
    name: "WP02 Admin",
    role: "Admin",
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await ctx.db.insert(schema.userRoleAssignments).values({
    id: crypto.randomUUID(),
    organizationId: orgId,
    userId: adminId,
    role: "Admin",
    isPrimary: true,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  orgsToClean.push(orgId);
  const token = signJWT(
    { actorId: adminId, role: "Admin", organizationId: orgId, authEpoch: 0 },
    getRuntimeConfig().authSecret.jwtSecret,
  );
  return { orgId, token };
}

async function createField(
  token: string,
  body: Record<string, unknown>,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await ctx.app.inject({
    method: "POST",
    url: "/api/candidate-fields",
    payload: body,
    cookies: { "auth-token": token },
  });
  return {
    status: res.statusCode,
    json: res.json() as Record<string, unknown>,
  };
}

async function patchField(
  token: string,
  id: string,
  body: Record<string, unknown>,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await ctx.app.inject({
    method: "PATCH",
    url: `/api/candidate-fields/${id}`,
    payload: body,
    cookies: { "auth-token": token },
  });
  return {
    status: res.statusCode,
    json: res.json() as Record<string, unknown>,
  };
}

async function listFields(
  token: string,
): Promise<Array<Record<string, unknown>>> {
  const res = await ctx.app.inject({
    method: "GET",
    url: "/api/candidate-fields",
    cookies: { "auth-token": token },
  });
  expect(res.statusCode).toBe(200);
  return res.json() as Array<Record<string, unknown>>;
}

async function createCandidate(
  token: string,
  body: Record<string, unknown>,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await ctx.app.inject({
    method: "POST",
    url: "/api/candidates",
    payload: body,
    cookies: { "auth-token": token },
  });
  return {
    status: res.statusCode,
    json: res.json() as Record<string, unknown>,
  };
}

beforeAll(async () => {
  ctx = await buildTestApp(async (app) => {
    await app.register(candidateFieldRoutes);
    await app.register(candidateRoutes);
  });
});

afterAll(async () => {
  await ctx.drainAuditWrites();
  for (const orgId of orgsToClean) {
    await cleanupOrganizationTestData(ctx.db, orgId);
  }
  await ctx.cleanup();
});

describe("candidate identity field invariants (#1066)", () => {
  it("rejects clearing the only identity field while candidates exist; zero-candidate init stays allowed", async () => {
    // Org with candidates: the identity field must be irremovable.
    const { token } = await makeOrg("guarded");
    const name = await createField(token, {
      name: `${p}-g-name`,
      label: "Name",
      fieldType: "text",
      required: false,
      unique: false,
      sortOrder: 0,
    });
    const sid = await createField(token, {
      name: `${p}-g-sid`,
      label: "StudentId",
      fieldType: "text",
      required: true,
      unique: true,
      sortOrder: 1,
    });
    expect(name.status).toBe(201);
    expect(sid.status).toBe(201);
    const sidId = sid.json.id as string;

    const baseline = await createCandidate(token, {
      username: `wp02gu1${p}`,
      password: "password123",
      name: "Baseline",
      fields: { [`${p}-g-name`]: "Ann", [`${p}-g-sid`]: "2024001" },
    });
    expect(baseline.status).toBe(201);

    // Clearing the only identity field must be rejected (409, same
    // contract as DELETE of a unique field with candidates).
    const patch = await patchField(token, sidId, { unique: false });
    expect(patch.status).toBe(409);

    const fields = await listFields(token);
    expect(fields.filter((f) => f.unique === true)).toHaveLength(1);

    const after = await createCandidate(token, {
      username: `wp02gu2${p}`,
      password: "password123",
      name: "After",
      fields: { [`${p}-g-name`]: "Bob", [`${p}-g-sid`]: "2024002" },
    });
    expect(after.status).toBe(201);

    // Zero-candidate initialization path stays allowed: an org without
    // candidates may restructure its identity field freely.
    const { token: initToken } = await makeOrg("init");
    const initSid = await createField(initToken, {
      name: `${p}-i-sid`,
      label: "StudentId",
      fieldType: "text",
      required: true,
      unique: true,
      sortOrder: 0,
    });
    expect(initSid.status).toBe(201);
    const clear = await patchField(initToken, initSid.json.id as string, {
      unique: false,
    });
    expect(clear.status).toBe(200);
    const restore = await patchField(initToken, initSid.json.id as string, {
      unique: true,
    });
    expect(restore.status).toBe(200);
    expect(
      (await listFields(initToken)).filter((f) => f.unique === true),
    ).toHaveLength(1);
  });

  it("enforces at most one identity field per organization at the database level", async () => {
    const { orgId, token } = await makeOrg("dbguard");
    const first = await createField(token, {
      name: `${p}-d-first`,
      label: "First",
      fieldType: "text",
      required: true,
      unique: true,
      sortOrder: 0,
    });
    expect(first.status).toBe(201);

    // DB-level invariant: even a direct insert bypassing the API precheck
    // must fail against the partial unique index.
    let rejected = false;
    let violated = false;
    try {
      await ctx.db.insert(schema.candidateFields).values({
        id: crypto.randomUUID(),
        organizationId: orgId,
        name: `${p}-d-second`,
        label: "Second",
        fieldType: "text",
        required: false,
        unique: true,
        sortOrder: 1,
        createdAt: new Date(),
      });
    } catch (err) {
      rejected = true;
      // Drizzle wraps driver errors — classify via the repository's
      // cause-chain walk, like the route error mapping does.
      violated = hasPostgresErrorCode(err, "23505");
    }
    expect(rejected).toBe(true);
    expect(violated).toBe(true);

    // Concurrent API creates race the check-then-act precheck in a FRESH
    // org (zero configured fields): the index must let exactly one win and
    // surface the loser as a 409 conflict.
    const { token: raceToken } = await makeOrg("dbrace");
    const [r1, r2] = await Promise.all([
      createField(raceToken, {
        name: `${p}-d-race-a`,
        label: "RaceA",
        fieldType: "text",
        required: false,
        unique: true,
        sortOrder: 0,
      }),
      createField(raceToken, {
        name: `${p}-d-race-b`,
        label: "RaceB",
        fieldType: "text",
        required: false,
        unique: true,
        sortOrder: 1,
      }),
    ]);
    expect([r1.status, r2.status].filter((s) => s === 201)).toHaveLength(1);
    expect([r1.status, r2.status].filter((s) => s === 409)).toHaveLength(1);
    const loser = r1.status === 201 ? r2 : r1;
    expect((loser.json as { error?: { code?: string } }).error?.code).toBe(
      "CANDIDATE_IDENTITY_FIELD_CONFLICT",
    );

    const fields = await listFields(raceToken);
    const uniqueFields = fields.filter((f) => f.unique === true);
    expect(uniqueFields).toHaveLength(1);
    const winnerName = uniqueFields[0]!.name as string;

    // Provisioning stays intact: exactly one identity field means candidate
    // creation works.
    const cand = await createCandidate(raceToken, {
      username: `wp02dbu1${p}`,
      password: "password123",
      name: "Provisioned",
      fields: { [winnerName]: "2025001" },
    });
    expect(cand.status).toBe(201);
  });

  it("concurrent identity-field deletion and candidate creation never strips identity from an org that gains a candidate", async () => {
    // A non-unique field is kept so the post-delete state is "fields exist
    // but none unique" — candidate creation then fails closed with a 400,
    // making a 204+201 outcome observable as the interleaving defect rather
    // than the legitimate zero-fields path.
    const { orgId, token } = await makeOrg("racedelete");
    const name = await createField(token, {
      name: `${p}-r-name`,
      label: "Name",
      fieldType: "text",
      required: false,
      unique: false,
      sortOrder: 0,
    });
    const sid = await createField(token, {
      name: `${p}-r-sid`,
      label: "StudentId",
      fieldType: "text",
      required: true,
      unique: true,
      sortOrder: 1,
    });
    expect(name.status).toBe(201);
    expect(sid.status).toBe(201);
    const sidId = sid.json.id as string;

    const [del, cand] = await Promise.all([
      ctx.app.inject({
        method: "DELETE",
        url: `/api/candidate-fields/${sidId}`,
        cookies: { "auth-token": token },
      }),
      createCandidate(token, {
        username: `wp02ru1${p}`,
        password: "password123",
        name: "Racer",
        fields: { [`${p}-r-name`]: "N", [`${p}-r-sid`]: "3000001" },
      }),
    ]);
    expect(del.statusCode === 204 && cand.status === 201).toBe(false);

    // End-state invariant: a candidate may never coexist with a stripped
    // identity configuration in this org.
    const profiles = await ctx.db
      .select()
      .from(schema.candidateProfiles)
      .where(eq(schema.candidateProfiles.organizationId, orgId));
    const fields = await listFields(token);
    const uniqueCount = fields.filter((f) => f.unique === true).length;
    if (profiles.length > 0) {
      expect(uniqueCount).toBeGreaterThanOrEqual(1);
    }
  });
});
