// INVARIANT (SPEC.md §2.3, #1066): an organization must never keep candidates
// while losing its unique identity field, and must never gain a second one.
// The owners are the `candidate-identity` advisory lock + READ COMMITTED
// transactions in candidateField.ts / candidate.ts and the
// candidate_fields_org_identity_uidx partial unique index.
//
// Unlike candidateField.identityInvariant.test.ts (sequential + same-pool
// Promise.all dispatch), every schedule here is DETERMINISTIC: each wait is a
// real PostgreSQL lock wait (row lock, advisory lock, or unique-index
// insertion point) driven to a known point and released by the test, never a
// timing race. Real overlap is proven from the lock manager (pg_locks /
// waitForBackendBlocked), the same evidence pattern as
// authorityInvariants.concurrency.test.ts.
//
// Mutants this suite discriminates (verified by disabling each piece on a
// scratch copy — see the PR evidence):
//   - advisory lock removed      → the candidate creation no longer queues
//                                  behind the parked DELETE/PATCH; both
//                                  succeed; the org ends up with candidates
//                                  and zero unique fields.
//   - isolation REPEATABLE READ  → the creation's snapshot predates the lock
//                                  grant, reads the pre-DELETE field set, and
//                                  succeeds against stale state.
//   - partial unique index gone  → the second concurrent unique:true inserter
//                                  no longer waits and reject at the index
//                                  insertion point; two rows survive.
//
// Two Fastify apps are built on purpose: buildTestApp(schemaName) pins its
// pool to max:1 (session search_path), so a single app serializes "concurrent"
// requests on one connection. One app per racing request gives two real
// connections. The guard-then-delete-then-candidate order below is forced by
// the test, not by request dispatch luck.
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import type { FastifyPluginAsync } from "fastify";
import { eq, sql } from "drizzle-orm";
import postgres from "postgres";
import { hashPassword } from "@exam/auth/password";
import { signJWT } from "@exam/auth/session";
import candidateFieldRoutes from "./candidateField.js";
import candidateRoutes from "./candidate.js";
import { buildTestApp, uniquePrefix, type TestContext } from "./testHelpers.js";
import { createPostgresDatabase } from "@exam/db/postgres";
import { setupIsolatedTestDb } from "@exam/db/testIsolation";
import { acquireOrganizationAdvisoryLock } from "@exam/db/lock";
import { schema } from "@exam/db/schema/pg";
import { hasPostgresErrorCode } from "@exam/db/types";
import { getRuntimeConfig } from "../config/runtimeConfig.js";
import { createDeferred } from "../testing/barrier.js";
import { waitForBackendBlocked } from "../testing/pgConcurrencyProbes.js";

const p = uniquePrefix();

/** One racing HTTP app + the shared per-file isolated schema connections. */
let app1: TestContext;
let app2: TestContext;
/** Dedicated connections: dbMain (assertions), dbPark (lock parking). */
let dbMain: Awaited<ReturnType<typeof createPostgresDatabase>>;
let dbPark: Awaited<ReturnType<typeof createPostgresDatabase>>;
let connA: Awaited<ReturnType<typeof createPostgresDatabase>>;
let connB: Awaited<ReturnType<typeof createPostgresDatabase>>;
/** Lock-manager observer (no search_path needed: pg_locks is global). */
let observer: postgres.Sql;
let iso: Awaited<ReturnType<typeof setupIsolatedTestDb>>;

async function makeOrg(tag: string): Promise<{ orgId: string; token: string }> {
  const orgId = crypto.randomUUID();
  const adminId = crypto.randomUUID();
  const now = new Date();
  await dbMain.db.insert(schema.organizations).values({
    id: orgId,
    name: `WP02C-${tag}-${p}`,
    displayName: `WP02C-${tag}`,
    slug: `wp02c-${tag}-${p}-${orgId}`,
    createdAt: now,
    updatedAt: now,
  });
  await dbMain.db.insert(schema.users).values({
    id: adminId,
    organizationId: orgId,
    username: `wp02c-admin-${tag}-${p}`,
    passwordHash: await hashPassword("password123"),
    name: "WP02C Admin",
    role: "Admin",
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await dbMain.db.insert(schema.userRoleAssignments).values({
    id: crypto.randomUUID(),
    organizationId: orgId,
    userId: adminId,
    role: "Admin",
    isPrimary: true,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  // Both apps share the deterministic test runtime config, so one token
  // authenticates on either instance (resetRuntimeConfigForTest only clears
  // the cache; secrets re-derive from the same env).
  const token = signJWT(
    { actorId: adminId, role: "Admin", organizationId: orgId, authEpoch: 0 },
    getRuntimeConfig().authSecret.jwtSecret,
  );
  return { orgId, token };
}

/** Response body parsed leniently: 204 responses have no body at all. */
function parseBody(raw: string): Record<string, unknown> {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function injectField(
  ctx: TestContext,
  token: string,
  method: "POST" | "PATCH" | "DELETE",
  body: Record<string, unknown> | undefined,
  fieldId?: string,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await ctx.app.inject({
    method,
    url: fieldId ? `/api/candidate-fields/${fieldId}` : "/api/candidate-fields",
    ...(body ? { payload: body } : {}),
    cookies: { "auth-token": token },
  });
  return { status: res.statusCode, json: parseBody(res.body) };
}

async function createCandidate(
  ctx: TestContext,
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

/** Terminal org state for the cross-scenario invariant assertions. */
async function orgIdentityState(orgId: string): Promise<{
  uniqueFields: number;
  profiles: number;
}> {
  const fields = await dbMain.db
    .select({ unique: schema.candidateFields.unique })
    .from(schema.candidateFields)
    .where(eq(schema.candidateFields.organizationId, orgId));
  const profiles = await dbMain.db
    .select({ id: schema.candidateProfiles.id })
    .from(schema.candidateProfiles)
    .where(eq(schema.candidateProfiles.organizationId, orgId));
  return {
    uniqueFields: fields.filter((f) => f.unique).length,
    profiles: profiles.length,
  };
}

/**
 * Poll pg_locks until at least `min` backends wait UNGRANTED on the
 * organization's candidate-identity advisory lock — proof that the racing
 * HTTP requests reached the lock statement and are truly parked on it (the
 * same real-overlap evidence waitForBackendBlocked gives by pid, keyed here
 * by the lock itself because pooled HTTP backends have no known pid).
 *
 * The key columns mirror acquireOrganizationAdvisoryLock's
 * pg_advisory_xact_lock(hashtext(kind), hashtext(organizationId)).
 */
async function waitForAdvisoryWaiters(
  orgId: string,
  min: number,
  timeoutMs = 8_000,
): Promise<void> {
  await waitForAdvisoryLockState(orgId, false, min, timeoutMs);
}

/**
 * Poll pg_locks until the org's candidate-identity advisory lock is HELD by
 * at least `min` backends — proof that a racing request's transaction has
 * started and passed its lock statement, so a request fired after this point
 * deterministically queues BEHIND it.
 */
async function waitForAdvisoryHeld(
  orgId: string,
  min = 1,
  timeoutMs = 8_000,
): Promise<void> {
  await waitForAdvisoryLockState(orgId, true, min, timeoutMs);
}

async function waitForAdvisoryLockState(
  orgId: string,
  granted: boolean,
  min: number,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const rows = (await observer.unsafe(
      `SELECT count(*)::int AS n FROM pg_locks
       WHERE locktype = 'advisory' AND granted = ${granted}
         AND classid = hashtext('candidate-identity')
         AND objid = hashtext($1)`,
      [orgId],
    )) as Array<{ n: number }>;
    if ((rows[0]?.n ?? 0) >= min) return;
    if (Date.now() > deadline) {
      throw new Error(
        `advisory lock state (granted=${granted}) not reached within ` +
          `${timeoutMs}ms (the schedule did not produce real overlap)`,
      );
    }
    await new Promise((r) => setTimeout(r, 25));
  }
}

/** A row lock on one candidate_fields row, held until released. */
async function parkCandidateFieldRow(fieldId: string): Promise<{
  held: Promise<void>;
  release: () => Promise<void>;
}> {
  const held = createDeferred("row-lock-held");
  const releaseGate = createDeferred("row-lock-release");
  const tx = dbPark.db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT id FROM candidate_fields WHERE id = ${fieldId} FOR UPDATE`,
    );
    held.resolve(undefined);
    await releaseGate.promise;
  });
  await held.promise;
  return {
    held: tx,
    // Idempotent: an assertion failure before the schedule's own release
    // still unparks the transaction from the finally block.
    release: async () => {
      if (!releaseGate.isSettled()) releaseGate.resolve(undefined);
      await tx;
    },
  };
}

/** The org's candidate-identity advisory lock, held until released. */
async function parkOrgIdentityLock(orgId: string): Promise<{
  release: () => Promise<void>;
}> {
  const held = createDeferred("advisory-lock-held");
  const releaseGate = createDeferred("advisory-lock-release");
  const tx = dbPark.db.transaction(async (tx) => {
    // Same key derivation as the routes (production lock function).
    await acquireOrganizationAdvisoryLock(tx, orgId, "candidate-identity");
    held.resolve(undefined);
    await releaseGate.promise;
  });
  await held.promise;
  return {
    release: async () => {
      if (!releaseGate.isSettled()) releaseGate.resolve(undefined);
      await tx;
    },
  };
}

beforeAll(async () => {
  iso = await setupIsolatedTestDb({
    namespace: "candidate_identity_concurrency",
  });
  const routes: FastifyPluginAsync = async (app) => {
    await app.register(candidateFieldRoutes);
    await app.register(candidateRoutes);
  };
  // First build migrates the schema (migratePostgres is idempotent).
  app1 = await buildTestApp(routes, {
    databaseUrl: iso.databaseUrl,
    schemaName: iso.schemaName,
  });
  app2 = await buildTestApp(routes, {
    databaseUrl: iso.databaseUrl,
    schemaName: iso.schemaName,
  });
  dbMain = await createPostgresDatabase(iso.databaseUrl, iso.schemaName);
  dbPark = await createPostgresDatabase(iso.databaseUrl, iso.schemaName);
  connA = await createPostgresDatabase(iso.databaseUrl, iso.schemaName);
  connB = await createPostgresDatabase(iso.databaseUrl, iso.schemaName);
  observer = postgres(iso.databaseUrl, { max: 1 });
}, 120_000);

afterAll(async () => {
  if (app1) await app1.drainAuditWrites();
  if (app2) await app2.drainAuditWrites();
  await Promise.allSettled([
    app1?.cleanup(),
    app2?.cleanup(),
    dbMain?.sql.end(),
    dbPark?.sql.end(),
    connA?.sql.end(),
    connB?.sql.end(),
    observer?.end(),
  ]);
  await iso.cleanup();
}, 60_000);

describe("candidate identity invariants — deterministic concurrency (#1066)", () => {
  /**
   * Shared fixture: one non-unique field (so "fields exist but none unique"
   * stays distinguishable from the legitimate zero-fields state) plus one
   * unique identity field, zero candidates.
   */
  async function orgWithIdentityField(tag: string): Promise<{
    orgId: string;
    token: string;
    sidId: string;
    name: string;
    sid: string;
  }> {
    const { orgId, token } = await makeOrg(tag);
    const name = await injectField(app1, token, "POST", {
      name: `${p}-${tag}-name`,
      label: "Name",
      fieldType: "text",
      required: false,
      unique: false,
      sortOrder: 0,
    });
    const sid = await injectField(app1, token, "POST", {
      name: `${p}-${tag}-sid`,
      label: "StudentId",
      fieldType: "text",
      required: true,
      unique: true,
      sortOrder: 1,
    });
    expect(name.status).toBe(201);
    expect(sid.status).toBe(201);
    return {
      orgId,
      token,
      sidId: sid.json.id as string,
      name: name.json.name as string,
      sid: sid.json.name as string,
    };
  }

  /**
   * Shared deterministic schedule for the DELETE/PATCH races: the field
   * mutation passes its guard (zero candidates), blocks mid-write on a
   * parked row lock while HOLDING the org advisory lock, and the candidate
   * creation (second app, second connection) queues on that lock. The row
   * lock is released only after both facts are proven from the lock manager,
   * so the creation always re-reads committed state AFTER the mutation.
   */
  async function parkedMutationVsCandidateCreation(args: {
    tag: string;
    username: string;
    identityValue: string;
    mutate: (
      token: string,
      sidId: string,
    ) => Promise<{ status: number; json: Record<string, unknown> }>;
  }): Promise<{
    mutation: { status: number; json: Record<string, unknown> };
    creation: { status: number; json: Record<string, unknown> };
    orgId: string;
  }> {
    const { orgId, token, sidId, name, sid } = await orgWithIdentityField(
      args.tag,
    );
    const rowPark = await parkCandidateFieldRow(sidId);
    let mutation:
      | Promise<{ status: number; json: Record<string, unknown> }>
      | undefined;
    let creation:
      | Promise<{ status: number; json: Record<string, unknown> }>
      | undefined;
    try {
      mutation = args.mutate(token, sidId);
      // Determinism gate: the mutation's transaction HOLDS the org advisory
      // lock before the creation is fired, so the creation is guaranteed to
      // queue BEHIND it, never ahead.
      await waitForAdvisoryHeld(orgId);
      creation = createCandidate(app2, token, {
        username: args.username,
        password: "password123",
        name: "Racer",
        fields: { [name]: "N", [sid]: args.identityValue },
      });
      await waitForAdvisoryWaiters(orgId, 1);
    } finally {
      // Also runs when an evidence wait already failed: unpark the row lock
      // so the dangling mutation can settle (idempotent release).
      await rowPark.release();
    }
    return {
      mutation: await mutation!,
      creation: await creation!,
      orgId,
    };
  }

  it("DELETE parked mid-write serializes against candidate creation (no 204+201, no candidates without identity)", async () => {
    const {
      mutation: del,
      creation: cand,
      orgId,
    } = await parkedMutationVsCandidateCreation({
      tag: "delrace",
      username: `wp02cr1${p}`,
      identityValue: "4000001",
      mutate: (token, sidId) =>
        injectField(app1, token, "DELETE", undefined, sidId),
    });

    // The defect signature (204 + 201 leaving candidates without identity)
    // must be impossible; under the fix the creation fails closed.
    expect(del.status).toBe(204);
    expect(cand.status).toBe(400);
    const candErr = (
      cand.json as {
        error?: {
          code?: string;
          details?: { fields?: Array<{ code?: string }> };
        };
      }
    ).error;
    expect(candErr?.code).toBe("VALIDATION_ERROR");
    expect(candErr?.details?.fields?.[0]?.code).toBe(
      "IDENTITY_FIELD_CONFIGURATION",
    );

    const st = await orgIdentityState(orgId);
    expect(st.profiles).toBe(0);
    expect(st.uniqueFields).toBe(0);
  }, 30_000);

  it("PATCH unique:false parked mid-write serializes against candidate creation", async () => {
    const {
      mutation: patch,
      creation: cand,
      orgId,
    } = await parkedMutationVsCandidateCreation({
      tag: "patchrace",
      username: `wp02cr2${p}`,
      identityValue: "4000002",
      mutate: (token, sidId) =>
        injectField(app1, token, "PATCH", { unique: false }, sidId),
    });

    expect(patch.status).toBe(200);
    expect(cand.status).toBe(400);
    const candErr = (
      cand.json as {
        error?: {
          code?: string;
          details?: { fields?: Array<{ code?: string }> };
        };
      }
    ).error;
    expect(candErr?.code).toBe("VALIDATION_ERROR");
    expect(candErr?.details?.fields?.[0]?.code).toBe(
      "IDENTITY_FIELD_CONFIGURATION",
    );

    const st = await orgIdentityState(orgId);
    expect(st.profiles).toBe(0);
    expect(st.uniqueFields).toBe(0);
  }, 30_000);

  it("two concurrent unique:true creates on independent connections: exactly one wins", async () => {
    const { orgId, token } = await makeOrg("postrace");
    // app1/app2 own separate pooled connections, so the two POSTs truly
    // overlap (unlike a same-pool Promise.all, which dispatch-serializes).
    // The outcome is order-symmetric: lock + precheck, or the partial unique
    // index, must reject the loser either way.
    const [r1, r2] = await Promise.all([
      injectField(app1, token, "POST", {
        name: `${p}-pr-a`,
        label: "RaceA",
        fieldType: "text",
        required: false,
        unique: true,
        sortOrder: 0,
      }),
      injectField(app2, token, "POST", {
        name: `${p}-pr-b`,
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

    const st = await orgIdentityState(orgId);
    expect(st.uniqueFields).toBe(1);
  }, 30_000);

  it("the partial unique index alone rejects a concurrent second inserter at the index insertion point (no lock, no API)", async () => {
    const { orgId } = await makeOrg("idxrace");
    // connB's backend pid, captured while idle (a blocked backend cannot
    // answer probes).
    const pidRows = (await connB.sql.unsafe(
      `SELECT pg_backend_pid() AS pid`,
    )) as Array<{ pid: number }>;
    const pidB = pidRows[0]!.pid;

    // T1 inserts a unique field and PARKS before commit: its uncommitted
    // index entry makes any same-org unique inserter wait on T1's
    // transaction outcome.
    const inserted = createDeferred("t1-inserted");
    const releaseT1 = createDeferred("t1-release");
    const t1 = connA.db.transaction(async (tx) => {
      await tx.insert(schema.candidateFields).values({
        id: crypto.randomUUID(),
        organizationId: orgId,
        name: `${p}-ix-a`,
        label: "IndexRaceA",
        fieldType: "text",
        required: false,
        unique: true,
        sortOrder: 0,
        createdAt: new Date(),
      });
      inserted.resolve(undefined);
      await releaseT1.promise;
    });
    await inserted.promise;

    // T2 (independent connection) inserts another unique field for the same
    // org — it must block on the pending unique-index entry, not slip past.
    let pgErr: unknown;
    try {
      const t2 = connB.db.transaction(async (tx) => {
        await tx.insert(schema.candidateFields).values({
          id: crypto.randomUUID(),
          organizationId: orgId,
          name: `${p}-ix-b`,
          label: "IndexRaceB",
          fieldType: "text",
          required: false,
          unique: true,
          sortOrder: 1,
          createdAt: new Date(),
        });
      });
      const blocked = await waitForBackendBlocked(observer, pidB);
      expect(blocked.blockedOnLocktype).toBe("transactionid");

      if (!releaseT1.isSettled()) releaseT1.resolve(undefined);
      await t1;
      await t2.catch((err) => {
        pgErr = err;
      });
      expect(hasPostgresErrorCode(pgErr, "23505")).toBe(true);
    } finally {
      // Unpark T1 even when an evidence assertion already failed.
      if (!releaseT1.isSettled()) releaseT1.resolve(undefined);
      await t1.catch(() => {});
    }

    const st = await orgIdentityState(orgId);
    expect(st.uniqueFields).toBe(1);
  }, 30_000);

  it("a request blocked on the org lock proceeds with unchanged semantics once the lock is granted", async () => {
    const { orgId, token } = await makeOrg("lockwait");
    // Pre-hold the org's candidate-identity lock, then fire a field create:
    // it must deterministically queue on the lock (ungranted advisory wait)
    // and, once granted, behave exactly like the uncontended path.
    const lockPark = await parkOrgIdentityLock(orgId);
    let postPromise:
      | Promise<{ status: number; json: Record<string, unknown> }>
      | undefined;
    try {
      postPromise = injectField(app1, token, "POST", {
        name: `${p}-lw-sid`,
        label: "StudentId",
        fieldType: "text",
        required: true,
        unique: true,
        sortOrder: 0,
      });
      await waitForAdvisoryWaiters(orgId, 1);
    } finally {
      // Release BEFORE awaiting the request: it is parked on this very lock.
      await lockPark.release();
    }
    const res = await postPromise!;
    expect(res.status).toBe(201);

    const st = await orgIdentityState(orgId);
    expect(st.uniqueFields).toBe(1);
  }, 30_000);

  /**
   * Reverse order of the DELETE/PATCH races above, where the candidates>0
   * guard is the load-bearing owner: the candidate is COMMITTED (on app2's
   * connection) before the field mutation fires on app1, so the guard must
   * observe the committed candidate across connections and reject with 409.
   * Guards disabled, the mutation strips the identity field and the org ends
   * with candidates but zero unique fields — the invariant violation.
   */
  async function mutationAfterCommittedCandidate(args: {
    tag: string;
    username: string;
    identityValue: string;
    mutate: (
      token: string,
      sidId: string,
    ) => Promise<{ status: number; json: Record<string, unknown> }>;
  }): Promise<{
    mutation: { status: number; json: Record<string, unknown> };
    orgId: string;
  }> {
    const { orgId, token, sidId, name, sid } = await orgWithIdentityField(
      args.tag,
    );
    // Commit the candidate first (its own locked transaction completes
    // before this await resolves).
    const created = await createCandidate(app2, token, {
      username: args.username,
      password: "password123",
      name: "Existing",
      fields: { [name]: "N", [sid]: args.identityValue },
    });
    expect(created.status).toBe(201);
    // Gate on DURABLE state, not on the HTTP response alone: the guard's
    // count must see this committed row.
    const pre = await orgIdentityState(orgId);
    expect(pre.profiles).toBe(1);
    expect(pre.uniqueFields).toBe(1);

    const mutation = await args.mutate(token, sidId);
    return { mutation, orgId };
  }

  it("DELETE of the identity field is rejected once a candidate is committed (guard observes committed state)", async () => {
    const { mutation: del, orgId } = await mutationAfterCommittedCandidate({
      tag: "delguard",
      username: `wp02cg1${p}`,
      identityValue: "5000001",
      mutate: (token, sidId) =>
        injectField(app1, token, "DELETE", undefined, sidId),
    });
    expect(del.status).toBe(409);
    expect((del.json as { error?: { code?: string } }).error?.code).toBe(
      "CANDIDATE_FIELD_IN_USE",
    );

    // Invariant end-state: the candidate keeps its identity configuration.
    const st = await orgIdentityState(orgId);
    expect(st.profiles).toBe(1);
    expect(st.uniqueFields).toBe(1);
  }, 30_000);

  it("PATCH unique:false of the identity field is rejected once a candidate is committed", async () => {
    const { mutation: patch, orgId } = await mutationAfterCommittedCandidate({
      tag: "patchguard",
      username: `wp02cg2${p}`,
      identityValue: "5000002",
      mutate: (token, sidId) =>
        injectField(app1, token, "PATCH", { unique: false }, sidId),
    });
    expect(patch.status).toBe(409);
    expect((patch.json as { error?: { code?: string } }).error?.code).toBe(
      "CANDIDATE_FIELD_IN_USE",
    );

    const st = await orgIdentityState(orgId);
    expect(st.profiles).toBe(1);
    expect(st.uniqueFields).toBe(1);
  }, 30_000);
});
