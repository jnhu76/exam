/**
 * Measurement-neutrality mechanism test for the #550 capacity research
 * instrumentation (EXAM-550-CORRECTIVE-1).
 *
 * postgres.js v3 Query objects are LAZY thenables: execution is submitted by
 * the first call to then/catch/finally (query.js: `then() { this.handle() }`),
 * and `Promise.resolve(thenable)` attaches `.then` — so ANY completion
 * observation of a Query submits it. These tests prove the boundary with the
 * real driver against real PostgreSQL, deterministically (single-connection
 * pool → per-connection FIFO: a probe statement created after a target
 * statement can only observe the target's effect if the target was already
 * submitted at creation time; no sleeps are needed).
 *
 * Layers proven here:
 *  1. baseline driver laziness (no instrumentation);
 *  2. `Promise.resolve(query)` DOES execute a lazy query;
 *  3. the SUPERSEDED pre-corrective wrapper (inline copy of the old
 *     mechanism) eagerly executed every statement — the MAJOR-2 defect;
 *  4. the corrective wrapper does NOT execute or reorder anything;
 *  5. full OFF-vs-ON neutrality gate: identical server-side journal,
 *     returned values, transaction semantics, and error propagation.
 */
import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createPostgresDatabase } from "@exam/db/src/postgres.js";
import { getIsolatedTestDb, resolveTestDbUrl } from "@exam/db/src/testDb.js";
import { addSearchPathToUrl } from "@exam/db/src/testIsolation.js";
import type postgres from "postgres";
import {
  getCapacityResearchSnapshot,
  installCapacityResearchInstrumentation,
} from "./capacityResearch.js";

async function pgReachable(): Promise<boolean> {
  try {
    const conn = await createPostgresDatabase(resolveTestDbUrl());
    try {
      await conn.sql`SELECT 1`;
      return true;
    } finally {
      await conn.sql.end();
    }
  } catch {
    return false;
  }
}

const PG_UP = await pgReachable();
const PG_DESCRIBE = PG_UP ? describe : describe.skip;

/**
 * SUPERSEDED pre-corrective mechanism, kept verbatim as the MAJOR-2
 * characterization target. It observed completion by attaching
 * catch/finally through `Promise.resolve(result)` — which submits the lazy
 * Query for execution at CREATION time. Never reintroduce this.
 */
function installSupersededEagerWrapper(sql: postgres.Sql): void {
  const orig = sql.unsafe.bind(sql);
  const instrumented = (...args: Parameters<typeof orig>) => {
    const result = orig(...args);
    void Promise.resolve(result)
      .catch(() => undefined)
      .finally(() => undefined);
    return result;
  };
  sql.unsafe = instrumented as typeof sql.unsafe;
}

/** One-connection real-PG fixture bound to the isolated test schema. */
async function makeSql(
  schemaName: string | undefined,
  databaseUrl: string | undefined,
): Promise<postgres.Sql> {
  const baseUrl = databaseUrl ?? resolveTestDbUrl();
  const url = schemaName ? addSearchPathToUrl(baseUrl, schemaName) : baseUrl;
  const conn = await createPostgresDatabase(url, schemaName ?? undefined);
  return conn.sql;
}

async function createLogTable(sql: postgres.Sql): Promise<string> {
  const table = `capacity_neutrality_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  await sql.unsafe(
    `CREATE TABLE ${table} (id serial PRIMARY KEY, op text NOT NULL)`,
  );
  return table;
}

const probeCount = (sql: postgres.Sql, table: string) =>
  sql.unsafe(`SELECT count(*)::int AS n FROM ${table}`);

PG_DESCRIBE("capacity research instrumentation neutrality", () => {
  it("baseline postgres.js: an unawaited unsafe() query has NOT executed (lazy)", async () => {
    const iso = await getIsolatedTestDb("cap-neutral-baseline");
    const sql = await makeSql(iso.schemaName, iso.databaseUrl);
    try {
      const table = await createLogTable(sql);
      const q = sql.unsafe(`INSERT INTO ${table} (op) VALUES ('lazy-target')`);
      // FIFO proof of laziness: q was created FIRST on a max=1 pool; if it had
      // been submitted at creation, it would run before this probe.
      const before = await probeCount(sql, table);
      expect(before[0]?.n).toBe(0);
      await q;
      const after = await probeCount(sql, table);
      expect(after[0]?.n).toBe(1);
    } finally {
      await sql.end();
      await iso.cleanup();
    }
  });

  it("Promise.resolve(query) executes the lazy query — observation is NOT neutral", async () => {
    const iso = await getIsolatedTestDb("cap-neutral-eager");
    const sql = await makeSql(iso.schemaName, iso.databaseUrl);
    try {
      const table = await createLogTable(sql);
      const q = sql.unsafe(`INSERT INTO ${table} (op) VALUES ('eager-target')`);
      const eager = Promise.resolve(q);
      // The probe runs after q was submitted by the Promise.resolve .then —
      // FIFO order proves the query executed without anyone awaiting it.
      const probe = await probeCount(sql, table);
      expect(probe[0]?.n).toBe(1);
      await eager;
    } finally {
      await sql.end();
      await iso.cleanup();
    }
  });

  it("SUPERSEDED pre-corrective wrapper eagerly executed the statement (MAJOR-2 defect, characterized)", async () => {
    const iso = await getIsolatedTestDb("cap-neutral-superseded");
    const sql = await makeSql(iso.schemaName, iso.databaseUrl);
    try {
      installSupersededEagerWrapper(sql);
      const table = await createLogTable(sql);
      const q = sql.unsafe(
        `INSERT INTO ${table} (op) VALUES ('superseded-wrapper')`,
      );
      const probe = await probeCount(sql, table);
      // The INSERT is durable BEFORE any caller awaited it — the wrapper
      // alone submitted the query. This changed execution timing and, for
      // later-created statements, submission order.
      expect(probe[0]?.n).toBe(1);
      await q;
    } finally {
      await sql.end();
      await iso.cleanup();
    }
  });

  it("corrective wrapper preserves laziness: nothing executes before the caller awaits", async () => {
    const iso = await getIsolatedTestDb("cap-neutral-corrective");
    const sql = await makeSql(iso.schemaName, iso.databaseUrl);
    try {
      const totalBefore = Number(
        (getCapacityResearchSnapshot().sql as { total: number }).total,
      );
      installCapacityResearchInstrumentation(sql);
      const table = await createLogTable(sql);
      const q = sql.unsafe(`INSERT INTO ${table} (op) VALUES ('corrective')`);
      const probe = await probeCount(sql, table);
      expect(probe[0]?.n).toBe(0);
      await q;
      const after = await probeCount(sql, table);
      expect(after[0]?.n).toBe(1);
      const snap = getCapacityResearchSnapshot();
      // 4 outer-funnel arrivals: table create + target insert (counted at
      // creation) + the two probes.
      expect((snap.sql as { total: number }).total - totalBefore).toBe(4);
    } finally {
      await sql.end();
      await iso.cleanup();
    }
  });

  it("neutrality gate: instrumentation OFF vs ON produce identical journals, values, transactions, and errors", async () => {
    const iso = await getIsolatedTestDb("cap-neutral-gate");
    const funnelTotal = (): number =>
      Number((getCapacityResearchSnapshot().sql as { total: number }).total);

    /**
     * Deterministic fixture: one accepted insert, one read, one committed
     * transaction, one rejected statement, one rolled-back transaction, and
     * the journal readback. All statements are awaited in the same order in
     * both configurations, so any instrumentation-caused eager submission or
     * reordering must show up as extra/different journal rows.
     */
    const runFixture = async (
      sql: postgres.Sql,
      table: string,
    ): Promise<{
      journal: string[];
      firstInsertId: number;
      txResult: string;
      error: { code: string; message: string } | null;
      arrivalsDelta: number;
    }> => {
      const before = funnelTotal();
      // Direct outer-funnel calls: 4 below. Each sql.begin segment adds ONE
      // more outer-funnel statement (its BEGIN; the COMMIT/ROLLBACK runs on
      // the transaction scope's own Sql object and is not observed).
      const ins = await sql.unsafe(
        `INSERT INTO ${table} (op) VALUES ('a-first') RETURNING id`,
      );
      const listed = await sql.unsafe(`SELECT op FROM ${table} ORDER BY id`);
      const txResult = await sql.begin(async (tx) => {
        await tx.unsafe(`INSERT INTO ${table} (op) VALUES ('c-tx')`);
        await tx.unsafe(`INSERT INTO ${table} (op) VALUES ('d-tx')`);
        return "tx-ok";
      });
      let error: { code: string; message: string } | null = null;
      try {
        await sql.unsafe(`SELECT * FROM ${table}_missing`);
      } catch (err) {
        const e = err as { code?: string; message?: string };
        error = { code: e.code ?? "?", message: e.message ?? "" };
      }
      try {
        await sql.begin(async (tx) => {
          await tx.unsafe(`INSERT INTO ${table} (op) VALUES ('f-rollback')`);
          throw new Error("rollback-intentional");
        });
      } catch {
        /* expected */
      }
      const journalRows = await sql.unsafe(
        `SELECT op FROM ${table} ORDER BY id`,
      );

      return {
        journal: journalRows.map((r) => r.op as string),
        firstInsertId: ins[0]?.id as number,
        txResult: txResult as string,
        error,
        arrivalsDelta: funnelTotal() - before,
      };
    };

    // One shared table in the isolated schema: control and treatment run the
    // IDENTICAL SQL text (truncate + restart identity between runs), so even
    // the error message text must match byte-for-byte.
    const controlSql = await makeSql(iso.schemaName, iso.databaseUrl);
    // Treatment instance: corrective wrapper installed before the fixture.
    const treatmentSql = await makeSql(iso.schemaName, iso.databaseUrl);
    try {
      const table = await createLogTable(controlSql);
      installCapacityResearchInstrumentation(treatmentSql);
      const control = await runFixture(controlSql, table);
      await controlSql.unsafe(`TRUNCATE ${table} RESTART IDENTITY`);
      const treatment = await runFixture(treatmentSql, table);

      // Same server-side statement effect (order included, no extra ops).
      expect(control.journal).toEqual(["a-first", "c-tx", "d-tx"]);
      expect(treatment.journal).toEqual(control.journal);
      expect(treatment.journal).not.toContain("f-rollback");
      expect(control.firstInsertId).toBe(1);
      expect(treatment.firstInsertId).toBe(control.firstInsertId);
      expect(control.txResult).toBe("tx-ok");
      expect(treatment.txResult).toBe(control.txResult);
      // Same error propagation (driver's PostgresError code reaches caller).
      expect(control.error?.code).toBe("42P01");
      expect(treatment.error).toEqual(control.error);
      // The wrapper counted exactly the outer-funnel arrivals: 4 direct
      // statements + 1 BEGIN per sql.begin segment. The control delta is 0
      // because nothing on the control instance is wrapped.
      expect(treatment.arrivalsDelta).toBe(6);
      expect(control.arrivalsDelta).toBe(0);
    } finally {
      await controlSql.end();
      await treatmentSql.end();
      await iso.cleanup();
    }
  });
});
