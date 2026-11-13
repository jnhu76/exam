/**
 * Plugin contract suite on real PostgreSQL (#964 W2 acceptance).
 *
 * Owns: install idempotence + enable/disable/restore, statement-span single
 * measurement (multi-consumer, laziness, adoption counter-example), root vs
 * transaction attribution (W2.1 S4 template), attribute-safety closure (no
 * SQL text / params / messages — marker-based), rollback with error-identity
 * preservation, READ COMMITTED isolation attribute, pool reuse, failure
 * isolation (broken tracer / throwing observer never change business
 * results), and the declared forEach boundary.
 *
 * The real 40001/40P01 retry fixtures live in otelDbTelemetryRetry.test.ts.
 *
 * Fixture ownership (docs/standards/testing.md §2.8): getIsolatedTestDb
 * per-file schema + extra pools via createDatabase / postgres startup
 * parameters (W2.1 F5: search_path rides `options.connection`, never a
 * pool-level SET).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, sql as sqlRaw } from "drizzle-orm";
import { SpanStatusCode, type Tracer } from "@opentelemetry/api";
import { getIsolatedTestDb } from "@exam/db/testDb";
import { createDatabase } from "@exam/db/database";
import {
  executeInTransaction,
  setTransactionRetryLogger,
} from "@exam/db/types";
import { setTransactionSeam } from "@exam/db/observation";
import { schema } from "@exam/db/schema/pg";
import {
  deltaDiagnostics,
  inScenario,
  installWithRootPool,
  parentSpanIdOf,
  PARAM_VALUE_MARKER,
  SQL_TEXT_MARKER,
  startSpanCapture,
  ALLOWED_ATTRIBUTE_KEYS,
  type InstrumentedPool,
  type SpanCapture,
} from "./testHelpers.js";
import {
  installOtelDbTelemetry,
  isOtelDbTelemetryInstalled,
  type OtelDbTelemetryHandle,
} from "./index.js";
import {
  isStatementSeamPatched,
  setStatementSeamObserver,
} from "./driverStatementSeam.js";
import { createTransactionSeam } from "./transactionSeam.js";

describe("otel-drizzle-postgresjs plugin (real PostgreSQL)", () => {
  let iso: Awaited<ReturnType<typeof getIsolatedTestDb>>;
  let probe: Awaited<ReturnType<typeof createDatabase>>;
  let pool: InstrumentedPool;
  let capture: SpanCapture;
  let handle: OtelDbTelemetryHandle;
  const orgA = randomUUID();
  const orgB = randomUUID();

  beforeAll(async () => {
    iso = await getIsolatedTestDb("otelw22");
    probe = await createDatabase(iso.databaseUrl!, iso.schemaName);
    const now = new Date();
    for (const [id, slug] of [
      [orgA, "otelw22-a"],
      [orgB, "otelw22-b"],
    ] as const) {
      await iso.db.insert(schema.organizations).values({
        id,
        name: slug,
        displayName: slug,
        slug,
        createdAt: now,
        updatedAt: now,
      });
    }
    capture = startSpanCapture();
    // Instrumented pool: max 3 connections + per-connection search_path
    // startup parameter (W2.1 F5).
    const sql = postgres(iso.databaseUrl!, {
      max: 3,
      connection: { search_path: iso.schemaName },
    });
    pool = { sql, db: drizzle(sql, { schema }) };
    handle = installWithRootPool(pool.sql);
    // the production wiring step: hand the plugin's seam to @exam/db
    setTransactionSeam(handle.transactionSeam);
    // POOL WARMUP, outside every scenario: postgres.js fetches pg_type OIDs
    // on the first connection of a fresh pool through reserve()'s OWN handler
    // closure (a real statement the seam correctly records as scoped). Doing
    // it here keeps per-scenario statement counts stable and pool-shaped.
    await pool.sql.unsafe("select 1");
    expect(isOtelDbTelemetryInstalled()).toBe(true);
    expect(isStatementSeamPatched()).toBe(true);
  }, 60_000);

  afterAll(async () => {
    setTransactionSeam(null);
    setTransactionRetryLogger(null);
    await probe?.sql.end();
    await pool?.sql.end({ timeout: 5 });
    await iso?.cleanup();
  }, 30_000);

  it("installs idempotently: a repeat call returns the same handle", () => {
    expect(installOtelDbTelemetry()).toBe(handle);
  });

  it("statement spans: single measurement, laziness preserved, root attribution, pool reuse", async () => {
    const before = handle.diagnostics();
    const { result, spans } = await inScenario(
      capture,
      "statement-basics",
      async () => {
        // (a) raw awaited statement with a parameter
        const rowsA = (await pool.sql.unsafe(
          "select display_name from organizations where slug = $1",
          ["otelw22-a"],
        )) as unknown as Array<{ display_name: string }>;

        // (b) drizzle select over the same pool
        const rowsB = await pool.db
          .select({ id: schema.organizations.id })
          .from(schema.organizations)
          .where(eq(schema.organizations.slug, "otelw22-b"));

        // (c) pool reuse: sequential queries ride one backend
        const pid1 = (
          (await pool.sql.unsafe(
            "select pg_backend_pid()::int as pid",
          )) as unknown as Array<{ pid: number }>
        )[0]!.pid;
        const pid2 = (
          (await pool.sql.unsafe(
            "select pg_backend_pid()::int as pid",
          )) as unknown as Array<{ pid: number }>
        )[0]!.pid;

        // (d) multi-consumer single measurement: second await records nothing
        const shared = pool.sql.unsafe("select 1::int as one");
        const first = (await shared) as unknown as Array<{ one: number }>;
        const again = (await shared) as unknown as Array<{ one: number }>;

        // (e) laziness: created-but-unconsumed Query never submits (W2.1 S3)
        const ghost = pool.sql.unsafe(
          `insert into organizations (id, name, display_name, slug, created_at, updated_at)
           values ('${randomUUID()}', 'ghost', 'ghost', 'ghost', now(), now())`,
        ) as unknown as { executed: boolean };
        const ghostExecutedAtCreation = ghost.executed;

        // (f) adoption counter-example still holds through the patch:
        // Promise.resolve(thenable) submits exactly once
        const adoptable = pool.sql.unsafe(
          `insert into organizations (id, name, display_name, slug, created_at, updated_at)
           values ('${randomUUID()}', 'adopted', 'adopted', 'adopted', now(), now())
           returning slug`,
        );
        const adopted = (await Promise.resolve(adoptable)) as unknown as Array<{
          slug: string;
        }>;

        return {
          rowsA,
          rowsBLength: rowsB.length,
          pid1,
          pid2,
          first,
          again,
          ghostExecutedAtCreation,
          adoptedSlug: adopted[0]?.slug ?? null,
        };
      },
    );

    expect(result.rowsA[0]!.display_name).toBe("otelw22-a");
    expect(result.rowsBLength).toBe(1);
    expect(result.pid1).toBe(result.pid2); // pool reuse across sequential queries
    expect(result.first).toEqual(result.again);
    expect(result.ghostExecutedAtCreation).toBe(false);
    expect(result.adoptedSlug).toBe("adopted");

    const scenarioSpans = spans();
    const rootSpan = scenarioSpans.find((s) => s.name === "statement-basics")!;
    const statements = scenarioSpans.filter((s) => s.name === "db.statement");
    // 1 raw + 1 drizzle + 2 pid probes + 1 shared + 1 adoption = 6
    // submissions; the ghost contributed nothing.
    expect(statements.length).toBe(6);
    for (const statement of statements) {
      expect(statement.attributes["exam.db.connection.role"]).toBe("root");
      expect(statement.attributes["db.system"]).toBe("postgresql");
      expect(statement.attributes["exam.db.outcome"]).toBe("success");
      // async-context parenting: every statement hangs off the scenario span
      expect(parentSpanIdOf(statement)).toBe(rootSpan.spanContext().spanId);
      // convention: UNSET = success, ERROR = failure (the differentiated
      // signal); no explicit OK is written on the success path
      expect(statement.status.code).toBe(SpanStatusCode.UNSET);
    }

    const delta = deltaDiagnostics(before, handle.diagnostics());
    expect(delta.submissions).toBe(6);
    expect(delta.settles).toBe(6);
    expect(delta.errors).toBe(0);
    expect(delta.byRole).toEqual({ root: 6 });
    expect(delta.scopedClosures).toBe(0);

    // the ghost really never executed (server-side row count)
    const ghosts = await probe.db
      .select({ id: schema.organizations.id })
      .from(schema.organizations)
      .where(eq(schema.organizations.slug, "ghost"));
    expect(ghosts.length).toBe(0);
  }, 30_000);

  it("attribute safety: markers in SQL text and params never reach span names or attributes", async () => {
    await inScenario(capture, "attribute-safety", async () => {
      const ok = (await pool.sql.unsafe(
        `select display_name from organizations where slug = '${SQL_TEXT_MARKER}' and coalesce(display_name, $1) = $1`,
        [PARAM_VALUE_MARKER],
      )) as unknown as Array<{ display_name: string }>;
      expect(ok.length).toBe(0);
      let caught = false;
      await pool.sql
        .unsafe(
          // SQL text carries one marker; the param value carries the other
          `select 1 / ($1::int) from organizations where slug = '${SQL_TEXT_MARKER}'`,
          [0],
        )
        .catch(() => {
          caught = true;
        });
      expect(caught).toBe(true);
      return null;
    });

    // every span finished so far in this process (harness noise included)
    for (const span of capture.all()) {
      expect(span.name).not.toContain(SQL_TEXT_MARKER);
      expect(span.name).not.toContain(PARAM_VALUE_MARKER);
      for (const value of Object.values(span.attributes)) {
        expect(JSON.stringify(value)).not.toContain(SQL_TEXT_MARKER);
        expect(JSON.stringify(value)).not.toContain(PARAM_VALUE_MARKER);
      }
      for (const key of Object.keys(span.attributes)) {
        expect(ALLOWED_ATTRIBUTE_KEYS.has(key)).toBe(true);
      }
    }

    // the division-by-zero statement errored with its SQLSTATE, not a message
    const errorStatement = capture
      .all()
      .find(
        (s) =>
          s.name === "db.statement" && s.status.code === SpanStatusCode.ERROR,
      );
    expect(errorStatement).toBeDefined();
    expect(errorStatement!.attributes["db.response.status_code"]).toBe("22012");
    expect(errorStatement!.attributes["exam.db.outcome"]).toBe("error");
  }, 30_000);

  it("transaction sub-connections: begin/set-tx/body/savepoint/commit all measured with role attribution (S4 template)", async () => {
    const before = handle.diagnostics();
    const { result, spans } = await inScenario(
      capture,
      "tx-subconnection",
      async () => {
        return executeInTransaction(pool.db, async (tx) => {
          await tx.insert(schema.organizations).values({
            id: randomUUID(),
            name: "otelw22-tx",
            displayName: "otelw22-tx",
            slug: "otelw22-tx",
            createdAt: new Date(),
            updatedAt: new Date(),
          });
          const pidRows = (await tx.execute(
            sqlRaw`select pg_backend_pid()::int as pid`,
          )) as unknown as Array<{ pid: number }>;
          await tx.transaction(async (tx2) => {
            await tx2.execute(
              sqlRaw`update organizations set display_name = 'otelw22-tx-sv' where slug = 'otelw22-tx'`,
            );
          });
          return pidRows[0]!.pid;
        });
      },
    );
    expect(result).toBeGreaterThan(0);

    const scenarioSpans = spans();
    const logical = scenarioSpans.filter((s) => s.name === "db.transaction");
    expect(logical.length).toBe(1);
    const attempts = scenarioSpans.filter(
      (s) => s.name === "db.transaction.attempt",
    );
    expect(attempts.length).toBe(1);
    expect(attempts[0]!.attributes["exam.db.tx.attempt"]).toBe(0);
    expect(attempts[0]!.attributes["exam.db.tx.isolation_level"]).toBe(
      "repeatable read",
    );
    const attemptSpanId = attempts[0]!.spanContext().spanId;

    const statements = scenarioSpans.filter((s) => s.name === "db.statement");
    // begin (root) + set transaction + insert + pid probe + savepoint + update
    // + commit = 7 — commit and savepoint are INVISIBLE to any root
    // sql.unsafe wrapper (W2.1 S4) but all present at the prototype seam.
    expect(statements.length).toBe(7);
    for (const statement of statements) {
      expect(parentSpanIdOf(statement)).toBe(attemptSpanId);
    }
    const roles = statements.map(
      (s) => s.attributes["exam.db.connection.role"],
    );
    expect(roles.filter((r) => r === "root").length).toBe(1); // BEGIN only
    expect(roles.filter((r) => r === "transaction").length).toBe(6);

    const delta = deltaDiagnostics(before, handle.diagnostics());
    expect(delta.submissions).toBe(7);
    expect(delta.scopedClosures).toBe(2); // tx scope + savepoint scope
    expect(delta.byRole).toEqual({ root: 1, transaction: 6 });
  }, 30_000);

  it("direct db.transaction: statement spans exist but no logical/attempt spans (logical layer = executeInTransaction boundary)", async () => {
    const before = handle.diagnostics();
    const { spans } = await inScenario(capture, "direct-tx", async () => {
      await pool.db.transaction(async (tx) => {
        await tx.execute(sqlRaw`select 1::int as one`);
      });
      return null;
    });
    const scenarioSpans = spans();
    expect(
      scenarioSpans.filter((s) => s.name === "db.transaction").length,
    ).toBe(0);
    expect(
      scenarioSpans.filter((s) => s.name === "db.transaction.attempt").length,
    ).toBe(0);
    // begin + select + commit = 3 statement spans — drizzle issues NO
    // separate "set transaction" when no isolation level is passed (the
    // isolation-aware executeInTransaction path does; see the S4 template).
    expect(scenarioSpans.filter((s) => s.name === "db.statement").length).toBe(
      3,
    );
    const delta = deltaDiagnostics(before, handle.diagnostics());
    expect(delta.submissions).toBe(3);
  }, 30_000);

  it("rollback: sentinel error identity preserved, data rolled back, no retry event", async () => {
    const sentinel = new Error("w22-rollback-sentinel");
    const displayNameBefore = (
      (await probe.db.execute(
        sqlRaw`select display_name from organizations where slug = 'otelw22-a'`,
      )) as unknown as Array<{ display_name: string }>
    )[0]!.display_name;

    const { result: caught, spans } = await inScenario(
      capture,
      "rollback",
      async () => {
        let caughtErr: unknown;
        await executeInTransaction(pool.db, async (tx) => {
          await tx.execute(
            sqlRaw`update organizations set display_name = 'w22-rolled-back' where slug = 'otelw22-a'`,
          );
          throw sentinel;
        }).catch((err: unknown) => {
          caughtErr = err;
        });
        return caughtErr;
      },
    );
    expect(caught).toBe(sentinel); // error identity through seam + wrapper

    const displayNameAfter = (
      (await probe.db.execute(
        sqlRaw`select display_name from organizations where slug = 'otelw22-a'`,
      )) as unknown as Array<{ display_name: string }>
    )[0]!.display_name;
    expect(displayNameAfter).toBe(displayNameBefore); // rolled back

    const scenarioSpans = spans();
    const logical = scenarioSpans.find((s) => s.name === "db.transaction")!;
    expect(logical.status.code).toBe(SpanStatusCode.ERROR);
    const attempt = scenarioSpans.find(
      (s) => s.name === "db.transaction.attempt",
    )!;
    expect(attempt.status.code).toBe(SpanStatusCode.ERROR);
    // The sentinel carries no SQLSTATE anywhere → the failed ATTEMPT span
    // records the fixed UNCLASSIFIED category, never the message text.
    expect(attempt.attributes["db.response.status_code"]).toBe("UNCLASSIFIED");
    expect(JSON.stringify(logical.attributes)).not.toContain(
      "w22-rollback-sentinel",
    );
    expect(JSON.stringify(attempt.attributes)).not.toContain(
      "w22-rollback-sentinel",
    );
    expect(
      logical.events.filter((e) => e.name === "transaction.retry").length,
    ).toBe(0);
    // The UPDATE itself succeeded (the sentinel throws after it) — every
    // statement of the aborted attempt settles OK: begin + set-transaction +
    // update + rollback.
    const failedStatements = scenarioSpans.filter(
      (s) =>
        s.name === "db.statement" && s.status.code === SpanStatusCode.ERROR,
    );
    expect(failedStatements.length).toBe(0);
    const settledOk = scenarioSpans.filter(
      (s) =>
        s.name === "db.statement" && s.status.code === SpanStatusCode.UNSET,
    );
    expect(settledOk.length).toBe(4);
  }, 30_000);

  it("READ COMMITTED attempts carry the isolation attribute and commit normally", async () => {
    const { result, spans } = await inScenario(
      capture,
      "read-committed",
      async () =>
        executeInTransaction(
          pool.db,
          async (tx) => {
            await tx.execute(
              sqlRaw`update organizations set display_name = 'otelw22-rc' where slug = 'otelw22-b'`,
            );
            return "rc-done" as const;
          },
          "read committed",
        ),
    );
    expect(result).toBe("rc-done");
    const attempt = spans().find((s) => s.name === "db.transaction.attempt")!;
    expect(attempt.attributes["exam.db.tx.isolation_level"]).toBe(
      "read committed",
    );
    expect(attempt.status.code).toBe(SpanStatusCode.UNSET); // success
  }, 30_000);

  it("failure isolation: a broken tracer and a throwing observer never change business results", async () => {
    // (a) throwing statement observer — contained by the patch
    setStatementSeamObserver(() => {
      throw new Error("synthetic-observer-failure");
    });
    try {
      const rows = (await pool.sql.unsafe(
        "select 1::int as one",
      )) as unknown as Array<{
        one: number;
      }>;
      expect(rows[0]!.one).toBe(1);
    } finally {
      handle.enable(); // restores the plugin's own observer
    }
    expect(handle.isEnabled()).toBe(true);

    // (b) broken tracer behind the transaction seam — contained by withSpan
    const brokenTracer = {
      startSpan: () => {
        throw new Error("synthetic-tracer-failure");
      },
    } as unknown as Tracer;
    const previousSeam = handle.transactionSeam;
    setTransactionSeam(createTransactionSeam(brokenTracer));
    try {
      const result = await executeInTransaction(pool.db, async (tx) => {
        await tx.execute(
          sqlRaw`update organizations set display_name = 'otelw22-isolated' where slug = 'otelw22-b'`,
        );
        return "isolated-done" as const;
      });
      expect(result).toBe("isolated-done");
    } finally {
      setTransactionSeam(previousSeam);
    }
    const after = (
      (await probe.db.execute(
        sqlRaw`select display_name from organizations where slug = 'otelw22-b'`,
      )) as unknown as Array<{ display_name: string }>
    )[0]!.display_name;
    expect(after).toBe("otelw22-isolated");
  }, 30_000);

  it("declared boundary: forEach submits exactly once and streams rows (cursor has no production caller — documented, not fixture-covered)", async () => {
    const before = handle.diagnostics();
    const collected: Array<{ slug: string }> = [];
    await pool.sql
      .unsafe("select slug from organizations where slug = $1", ["otelw22-a"])
      .forEach((row) => {
        collected.push(row as unknown as { slug: string });
      });
    expect(collected).toEqual([{ slug: "otelw22-a" }]);
    const delta = deltaDiagnostics(before, handle.diagnostics());
    expect(delta.submissions).toBe(1);
    expect(delta.settles).toBe(1);
  }, 30_000);
});
