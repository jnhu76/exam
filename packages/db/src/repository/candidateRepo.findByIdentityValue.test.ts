// INVARIANT: candidateRepo.findByIdentityValue (targeted jsonb lookup) must
// agree with the former in-memory identity scan — findIdentityMatch over
// repo.list() with JS strict equality — on every JSON-scalar boundary the
// candidate identity protocol can observe: string vs number ("42" and 42
// never cross-match), numeric canonical form (42 = 42.0), null/missing
// fields, empty values, and org scoping. The create/import routes probe
// identity through this query; any divergence here is a silent identity
// conflict resolution change.
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@exam/domain";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getWorkerScopedTestDb } from "../testDb.js";
import { createCandidateRepo } from "./candidateRepo.js";
import { schema } from "../schema/pg.js";
import type { Database } from "../types.js";

type CandidateProfile = typeof schema.candidateProfiles.$inferSelect;

function createContext(organizationId: string): RequestContext {
  return {
    actorId: randomUUID(),
    organizationId,
    role: "Admin",
    permissions: [],
    sessionId: randomUUID(),
  };
}

/**
 * The former in-memory matcher, kept verbatim as the equivalence oracle:
 * empty values never probe, then strict-equality scan over the full list.
 */
function legacyIdentityMatch(
  candidates: CandidateProfile[],
  fieldName: string,
  value: unknown,
): CandidateProfile | null {
  if (value === undefined || value === null || value === "") return null;
  return (
    candidates.find((candidate) => candidate.fields[fieldName] === value) ??
    null
  );
}

/**
 * The route-shaped probe composition over the targeted query (mirrors
 * findIdentityMatch in apps/api/src/routes/candidate.ts): same empty-value
 * early exits, then the per-field targeted lookup.
 */
async function targetedIdentityMatch(
  repo: ReturnType<typeof createCandidateRepo>,
  ctx: RequestContext,
  fieldName: string,
  value: unknown,
): Promise<CandidateProfile | null> {
  if (value === undefined || value === null || value === "") return null;
  if (
    typeof value !== "string" &&
    typeof value !== "number" &&
    typeof value !== "boolean"
  ) {
    return null;
  }
  return repo.findByIdentityValue(ctx, fieldName, value);
}

describe("candidateRepo.findByIdentityValue — targeted identity lookup equivalence", () => {
  let db: Database;
  let cleanup: () => Promise<void>;
  let orgA: string;
  let orgB: string;
  let ctxA: RequestContext;
  let ctxB: RequestContext;
  let repo: ReturnType<typeof createCandidateRepo>;
  /** org-A candidate rows, one per identity-value boundary form. */
  const rowIds = {
    string42: randomUUID(),
    number42: randomUUID(),
    raw420: randomUUID(),
    string420: randomUUID(),
    jsonNull: randomUUID(),
    missingKey: randomUUID(),
    nested: randomUUID(),
    array: randomUUID(),
    boolean: randomUUID(),
    emptyString: randomUUID(),
    otherFieldHolds42: randomUUID(),
  } as const;
  const orgBRow = randomUUID();

  beforeAll(async () => {
    const result = await getWorkerScopedTestDb();
    db = result.db;
    cleanup = result.cleanup;

    const now = new Date();
    const orgs = [randomUUID(), randomUUID()];
    for (const orgId of orgs) {
      await db.insert(schema.organizations).values({
        id: orgId,
        name: `identity-eq-${orgId.slice(0, 8)}`,
        displayName: `identity-eq-${orgId.slice(0, 8)}`,
        slug: `identity-eq-${orgId}`,
        createdAt: now,
        updatedAt: now,
      });
    }
    orgA = orgs[0]!;
    orgB = orgs[1]!;
    ctxA = createContext(orgA);
    ctxB = createContext(orgB);
    repo = createCandidateRepo(db);

    let userSeq = 0;
    const seedUser = async (orgId: string) => {
      const userId = randomUUID();
      await db.insert(schema.users).values({
        id: userId,
        organizationId: orgId,
        username: `identity-eq-${orgId.slice(0, 8)}-${userSeq++}`,
        passwordHash: "not-a-login-hash",
        name: "Identity Eq",
        role: "Candidate",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
      return userId;
    };
    const seedProfile = async (
      orgId: string,
      id: string,
      fields: Record<string, unknown>,
    ) => {
      await db.insert(schema.candidateProfiles).values({
        id,
        organizationId: orgId,
        userId: await seedUser(orgId),
        fields,
      });
    };
    // Raw jsonb forms JSON.stringify cannot express from JS (42.0 keeps a
    // scale distinct from JS 42/42.0 collapse in the STORED jsonb text).
    const seedProfileRawJson = async (
      orgId: string,
      id: string,
      fieldsJson: string,
    ) => {
      const userId = await seedUser(orgId);
      await db.execute(
        sql`insert into candidate_profiles (id, organization_id, user_id, fields) values (${id}, ${orgId}, ${userId}, ${fieldsJson}::jsonb)`,
      );
    };

    await seedProfile(orgA, rowIds.string42, { sid: "42" });
    await seedProfile(orgA, rowIds.number42, { sid: 42 });
    await seedProfileRawJson(orgA, rowIds.raw420, `{"sid": 42.0}`);
    await seedProfile(orgA, rowIds.string420, { sid: "42.0" });
    await seedProfile(orgA, rowIds.jsonNull, { sid: null });
    await seedProfile(orgA, rowIds.missingKey, { other: "x" });
    await seedProfile(orgA, rowIds.nested, { sid: { a: 1 } });
    await seedProfile(orgA, rowIds.array, { sid: [1, 2] });
    await seedProfile(orgA, rowIds.boolean, { sid: true });
    await seedProfile(orgA, rowIds.emptyString, { sid: "" });
    // Field-name discrimination: a "42" under a non-identity key must never
    // satisfy an identity probe on `sid`.
    await seedProfile(orgA, rowIds.otherFieldHolds42, {
      sid: "other",
      grade: "42",
    });
    // Org B holds the numeric-canonical witness in isolation: a jsonb 42.0
    // row and nothing else, so a numeric 42 probe is unambiguous.
    await seedProfileRawJson(orgB, orgBRow, `{"sid": 42.0}`);
  }, 60_000);

  afterAll(async () => {
    await cleanup();
  }, 30_000);

  it("agrees with the in-memory strict-equality scan on every JSON-scalar boundary", async () => {
    const candidates = await repo.list(ctxA);
    // Seed sanity: every boundary row is visible to the oracle input.
    expect(candidates.map((c) => c.id).sort()).toEqual(
      Object.values(rowIds).slice().sort(),
    );

    const probes: unknown[] = [
      42,
      "42",
      "42.0",
      true,
      false,
      "",
      null,
      undefined,
      { a: 1 },
      [1, 2],
      "other",
    ];
    for (const probe of probes) {
      const legacy = legacyIdentityMatch(candidates, "sid", probe);
      const targeted = await targetedIdentityMatch(repo, ctxA, "sid", probe);
      expect(
        targeted === null,
        `probe ${JSON.stringify(probe)}: targeted ${targeted?.id ?? "null"} vs legacy ${legacy?.id ?? "null"}`,
      ).toBe(legacy === null);
      if (legacy && targeted) {
        // Both resolved to A row whose stored identity value strictly
        // equals the probe (for 42, either the 42 or the 42.0 row — both
        // load as JS 42 — is a legitimate LIMIT-1 winner).
        expect(targeted.fields.sid).toBe(probe);
        expect(legacy.fields.sid).toBe(probe);
      }
    }

    // Directed boundary pins (redundant with the loop, but each names its
    // corruption mode so a regression reads immediately):
    // String vs number never cross-match.
    expect((await repo.findByIdentityValue(ctxA, "sid", "42"))?.id).toBe(
      rowIds.string42,
    );
    // Numeric canonical form: 42 matches a stored jsonb 42.0.
    expect((await repo.findByIdentityValue(ctxA, "sid", 42))?.fields.sid).toBe(
      42,
    );
    expect((await repo.findByIdentityValue(ctxB, "sid", 42))?.id).toBe(orgBRow);
    // A stored JSON null and a missing key never match any scalar probe.
    expect(await repo.findByIdentityValue(ctxA, "sid", "null")).toBeNull();
    // A probe by a key another row DOES carry still resolves by that key.
    expect((await repo.findByIdentityValue(ctxA, "other", "x"))?.id).toBe(
      rowIds.missingKey,
    );
  });

  it("probes only the named field: values under other keys never satisfy an identity probe", async () => {
    // grade:"42" exists on otherFieldHolds42; an identity probe on `sid`
    // with "42" must resolve to the sid:"42" row, never that row.
    const byIdentity = await repo.findByIdentityValue(ctxA, "sid", "42");
    expect(byIdentity?.id).toBe(rowIds.string42);
    // The query itself is field-keyed (the identity protocol passes the
    // configured unique field name; other keys are inert for it).
    const byGrade = await repo.findByIdentityValue(ctxA, "grade", "42");
    expect(byGrade?.id).toBe(rowIds.otherFieldHolds42);
    const legacyAll = await repo.list(ctxA);
    expect(legacyIdentityMatch(legacyAll, "grade", "42")?.id).toBe(
      rowIds.otherFieldHolds42,
    );
  });

  it("stays org-scoped: another organization's identical value is invisible", async () => {
    // org B stores jsonb 42.0; org A also has numeric 42 rows. Each probe
    // resolves within its own org only.
    const inA = await repo.findByIdentityValue(ctxA, "sid", 42);
    expect(inA).not.toBeNull();
    expect(inA?.organizationId).toBe(orgA);
    const inB = await repo.findByIdentityValue(ctxB, "sid", 42);
    expect(inB?.id).toBe(orgBRow);
    expect(inB?.organizationId).toBe(orgB);
    // And the string form still does not cross-match in either org.
    expect(await repo.findByIdentityValue(ctxB, "sid", "42")).toBeNull();
  });

  it("pins the nested-value boundary: jsonb deep equality is reachable only through the raw query, never the identity protocol", async () => {
    // Why the route's scalar narrow is load-bearing: the raw jsonb
    // expression DOES deep-match a nested value where JS strict equality
    // across a serialization boundary never could. The identity protocol
    // rejects non-scalar identity values (validateCandidateFields) and the
    // probe composition excludes them before querying, so this capability
    // is unreachable from the API — pinned here so the boundary stays
    // explicit if the probe composition is ever loosened.
    const rows = await db.execute(
      sql`select id from candidate_profiles where organization_id = ${orgA} and fields -> 'sid' = ${JSON.stringify({ a: 1 })}::jsonb`,
    );
    expect(rows.map((r) => (r as { id: string }).id)).toEqual([rowIds.nested]);
    // The protocol-shaped probe never matches a nested value:
    const candidates = await repo.list(ctxA);
    expect(legacyIdentityMatch(candidates, "sid", { a: 1 })).toBeNull();
    expect(await targetedIdentityMatch(repo, ctxA, "sid", { a: 1 })).toBeNull();
  });
});
