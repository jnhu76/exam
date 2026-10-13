import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import {
  dropDatabaseIfExists,
  ensureDatabaseExists,
} from "./testWorkerDatabase.js";
import {
  getTestInfraLifecycleLockKey,
  resolveTestInfraCoordinationUrl,
  withTestInfraLifecycleLock,
} from "./testInfraLock.js";
import {
  __setTraceSinkForTests,
  beginLockOperation,
  decodeTraceApplicationName,
  identifyBackend,
  isTestInfraTraceEnabled,
  postgresWithTraceIdentity,
  runWithTraceOperation,
  traceApplicationName,
  traceIdentityKey,
  type BackendIdentity,
  type TestInfraTraceEvent,
} from "./testInfraTrace.js";
import { getIsolatedTestDb, resolveTestDbUrl } from "./testDb.js";

/**
 * Trace V2 identity-correctness oracles (research #774 R3–R5, S1 §3.6).
 *
 * Each case Cx asserts an identity contract and records
 * { G_required, G_claimed, G_observed } so false positives (identity claimed
 * but wrong) and false negatives (identity available but not claimed) stay
 * separately observable. Events are captured through the in-memory test sink.
 *
 * Anti-patterns pinned as FORBIDDEN join strategies: pid adjacency,
 * timestamp proximity, SQL-text equality, bare pid equality across process
 * instances. The only sanctioned join key is (process_instance_id,
 * operation_id) — `traceIdentityKey`.
 */

const BASE_URL = resolveTestDbUrl();
const COORD_URL = resolveTestInfraCoordinationUrl(BASE_URL);
const LOCK_KEY = getTestInfraLifecycleLockKey();

type Sink = TestInfraTraceEvent[];

function enableTrace(sink: Sink): void {
  vi.stubEnv("TEST_INFRA_TRACE", "1");
  __setTraceSinkForTests((event) => {
    sink.push(event);
  });
}

afterEach(() => {
  __setTraceSinkForTests(null);
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------
// Oracle bookkeeping (G_required / G_claimed / G_observed)
// ---------------------------------------------------------------------------

interface OracleRecord {
  caseId: string;
  G_required: string;
  G_claimed: string;
  G_observed: "PASS" | "FAIL";
}
const oracleRecords: OracleRecord[] = [];

function record(
  caseId: string,
  G_required: string,
  G_claimed: string,
  pass: boolean,
): void {
  oracleRecords.push({
    caseId,
    G_required,
    G_claimed,
    G_observed: pass ? "PASS" : "FAIL",
  });
  expect(pass, `${caseId}: ${G_claimed}`).toBe(true);
}

function eventsOfOp(sink: Sink, opId: string): TestInfraTraceEvent[] {
  return sink.filter((e) => e.operation_id === opId);
}

async function pgReachable(url: string): Promise<boolean> {
  const sql = postgres(url, { connect_timeout: 2 });
  try {
    await sql`SELECT 1`;
    return true;
  } catch {
    return false;
  } finally {
    await sql.end();
  }
}

const PG_UP = await pgReachable(COORD_URL);
const PG_DESCRIBE = PG_UP ? describe : describe.skip;

// Unique fixture database for the ensure-oracle (dropped in afterAll).
const ORACLE_DB = `test_trace_oracle_${randomUUID().replace(/-/g, "").slice(0, 8)}`;

afterAll(async () => {
  // The fixture DB only exists when PostgreSQL was reachable (`PG_UP`); an
  // unconditional drop turns a soft-skip environment (no PG) into a red file,
  // contradicting the package's self-skip contract (vitest.globalSetup.ts).
  if (PG_UP) {
    await dropDatabaseIfExists(COORD_URL, ORACLE_DB, { keepMissing: true });
  }
  process.stdout.write(
    `${JSON.stringify({ trace_identity_oracles: oracleRecords })}\n`,
  );
}, 30_000);

/** Minimal synthetic event for join-key unit oracles. */
function ev(
  opId: string,
  processInstance: string,
  backendPid: number,
): TestInfraTraceEvent {
  return {
    schema_version: 3,
    run_id: "unit",
    operation_id: opId,
    process_instance_id: processInstance,
    node_pid: 1,
    event_seq: 0,
    event_type: "LOCK_GRANTED_ACK",
    clock_domain: "NODE_MONOTONIC",
    monotonic_ns: "0",
    wall_time_utc: "1970-01-01T00:00:00.000Z",
    pg_backend_pid: backendPid,
    pg_backend_start: "1970-01-01T00:00:00Z",
    pg_postmaster_start: "1969-12-31T23:59:00Z",
    pg_database_oid: 1,
    connection_role: "lock",
    lock_key: LOCK_KEY.toString(),
    outcome: "granted",
    missing: [],
  };
}

// ---------------------------------------------------------------------------
// Pure-identity unit oracles (no PG)
// ---------------------------------------------------------------------------

describe("trace identity primitives", () => {
  it("C3/C9: join key is (process_instance_id, operation_id) — pid adjacency and pid reuse never merge identities", () => {
    // Adjacent pids (would-be false join by proximity) and the SAME pid under
    // different process instances (backend recycling) must stay distinct.
    const a = ev("opA", "p1", 1001);
    const b = ev("opB", "p1", 1002);
    const c = ev("opA", "p2", 1001);
    const keys = new Set([
      traceIdentityKey(a),
      traceIdentityKey(b),
      traceIdentityKey(c),
    ]);
    const pass = keys.size === 3 && !traceIdentityKey(a).includes("1001");
    record(
      "C3+C9",
      "identities join by (process_instance_id, operation_id) only",
      "adjacent/reused pids do NOT merge operations; join key is pid-free",
      pass,
    );
  });

  it("C5: application_name decoding is exact — no role confusion, no lookalike join", () => {
    const lockOp = randomUUID();
    const ddlOp = randomUUID();
    const a = decodeTraceApplicationName(traceApplicationName("lock", lockOp));
    const d = decodeTraceApplicationName(traceApplicationName("ddl", ddlOp));
    const foreign = decodeTraceApplicationName("postgres.js");
    const spoof = decodeTraceApplicationName(`exi:bogus:${lockOp}`);
    const pass =
      a?.operationId === lockOp &&
      a.role === "lock" &&
      d?.operationId === ddlOp &&
      d.role === "ddl" &&
      foreign === null &&
      spoof === null;
    record(
      "C5",
      "role+operation decode exactly; non-trace and unknown-role names reject",
      "no merge via application_name lookalikes",
      pass,
    );
  });

  it("C10 (unit half): tracing disabled → enabled()=false", () => {
    vi.stubEnv("TEST_INFRA_TRACE", "");
    const pass = isTestInfraTraceEnabled() === false;
    vi.unstubAllEnvs();
    record(
      "C10",
      "disabled trace never activates",
      "empty string is not the opt-in token",
      pass,
    );
  });
});

// ---------------------------------------------------------------------------
// PG-integration oracles
// ---------------------------------------------------------------------------

PG_DESCRIBE("trace identity oracles (real PostgreSQL)", () => {
  it("C1: overlapping operation lifetimes keep distinct identities (no ALS cross-talk)", async () => {
    const sink: Sink = [];
    enableTrace(sink);
    let enterCS!: () => void;
    const inCS = new Promise<void>((r) => {
      enterCS = r;
    });
    let releaseA!: () => void;
    const gateA = new Promise<void>((r) => {
      releaseA = r;
    });

    const opA = withTestInfraLifecycleLock(COORD_URL, async () => {
      enterCS();
      await gateA;
    });
    await inCS; // A now HOLDS the lock inside its critical section.
    // B's lifetime (LOCK_CALL_BEGIN → OPERATION_COMPLETED) overlaps A's;
    // B queues server-side until A releases. Release A first (no deadlock),
    // then await both.
    const opB = withTestInfraLifecycleLock(COORD_URL, async () => {
      await Promise.resolve();
    });
    releaseA();
    await opB;
    await opA;

    const begins = sink.filter((e) => e.event_type === "LOCK_CALL_BEGIN");
    const opIds = new Set(
      begins.map((e) => e.operation_id).filter((x): x is string => x !== null),
    );
    const pass =
      begins.length === 2 &&
      opIds.size === 2 &&
      sink
        .filter((e) => e.event_type !== "EVENT_LOOP_SAMPLE")
        .every(
          (e) => e.operation_id === null || opIds.has(e.operation_id as string),
        );
    record(
      "C1",
      "2 concurrent ops → 2 distinct operation_ids; no event carries a foreign op id",
      "ALS context propagation is contamination-free",
      pass,
    );
  }, 20_000);

  it("C2: one operation spans ≥3 distinct PostgreSQL backends, each role-attributed by verified application_name", async () => {
    const sink: Sink = [];
    enableTrace(sink);
    const iso = await getIsolatedTestDb("trace-oracle");
    try {
      const opId = sink.find((e) => e.event_type === "LOCK_CALL_BEGIN")
        ?.operation_id as string;
      const identified = eventsOfOp(sink, opId).filter(
        (e) =>
          e.event_type === "DDL_CONNECTION_IDENTIFIED" ||
          e.event_type === "COORD_BACKEND_IDENTIFIED",
      );
      const lockEv = identified.find((e) => e.connection_role === "lock");
      const ddlEv = identified.find((e) => e.connection_role === "ddl");
      const migEv = identified.find((e) => e.connection_role === "mig");
      const pids = new Set(
        [lockEv, ddlEv, migEv].map((e) => e?.pg_backend_pid ?? null),
      );
      const pass =
        typeof opId === "string" &&
        !!lockEv &&
        !!ddlEv &&
        !!migEv &&
        pids.size === 3 &&
        !pids.has(null) &&
        lockEv.application_name === traceApplicationName("lock", opId) &&
        ddlEv.application_name === traceApplicationName("ddl", opId) &&
        migEv.application_name === traceApplicationName("mig", opId) &&
        lockEv.missing.length === 0 &&
        ddlEv.missing.length === 0 &&
        migEv.missing.length === 0 &&
        // Three sessions of ONE postmaster: session starts differ, the
        // instance start is shared (the field defect collapsed these).
        new Set([lockEv, ddlEv, migEv].map((e) => e.pg_backend_start)).size ===
          3 &&
        new Set([lockEv, ddlEv, migEv].map((e) => e.pg_postmaster_start))
          .size === 1;
      record(
        "C2",
        "lock/ddl/mig sessions of ONE operation are three distinct sessions of one instance, app names server-verified",
        "holder→DDL identity closed within one operation; session starts distinct, postmaster start shared",
        pass,
      );
    } finally {
      await iso.cleanup();
    }
  }, 40_000);

  it("C4: terminated backend → reconnect produces a NEW session identity under the SAME operation", async () => {
    const sink: Sink = [];
    enableTrace(sink);
    const op = beginLockOperation("C4-oracle", LOCK_KEY.toString());
    await runWithTraceOperation(op, async () => {
      const first = postgresWithTraceIdentity(COORD_URL, "ddl", { max: 1 });
      const id1 = await identifyBackend(
        first.sql,
        "ddl",
        op,
        first.connectionId,
        "DDL_CONNECTION_IDENTIFIED",
      );
      expect(id1).not.toBeNull();
      const killer = postgres(COORD_URL, { max: 1 });
      try {
        await killer.unsafe(`SELECT pg_terminate_backend(${id1!.pid})`);
      } finally {
        await killer.end();
      }
      // The driver notices the dead socket and replaces the connection on
      // next use. Depending on the race, the in-flight query either
      // transparently reconnects (resolves) or surfaces the closed socket
      // (rejects and evicts the dead connection) — both outcomes are the
      // same contract: the NEXT query runs on a NEW backend.
      try {
        await first.sql.unsafe("SELECT 1");
      } catch {
        // Socket race: pool evicts the terminated connection.
      }
      const id2 = await identifyBackend(
        first.sql,
        "ddl",
        op,
        first.connectionId,
        "DDL_CONNECTION_IDENTIFIED",
      );
      await first.sql.end().catch(() => {});
      const identifiedCount = eventsOfOp(sink, op.operationId).filter(
        (e) =>
          e.event_type === "DDL_CONNECTION_IDENTIFIED" &&
          e.outcome === "identified",
      ).length;
      const pass =
        id2 !== null &&
        id2.pid !== id1!.pid &&
        id2.applicationNameReadback ===
          traceApplicationName("ddl", op.operationId) &&
        identifiedCount >= 2;
      record(
        "C4",
        "connection rebuild → new backend pid, app-name identity re-verified, same operation id",
        "session identity follows the physical session, not the Sql handle",
        pass,
      );
    });
  }, 20_000);

  it("C14: pg_backend_start is the SESSION's backend_start (not the postmaster start); pg_postmaster_start is the instance start", async () => {
    // Regression for the review finding that the read-back shipped
    // pg_postmaster_start_time() under the pg_backend_start name: identical
    // for every session of one postmaster, so two sessions looked like one
    // generation and pid reuse was undetectable. The oracle compares the
    // trace's read-back against the SERVER's own values for the same pid,
    // read from a third session.
    const sink: Sink = [];
    enableTrace(sink);
    const op = beginLockOperation("C14-oracle", LOCK_KEY.toString());
    await runWithTraceOperation(op, async () => {
      const a = postgresWithTraceIdentity(COORD_URL, "ddl", { max: 1 });
      const b = postgresWithTraceIdentity(COORD_URL, "ddl", { max: 1 });
      const observer = postgres(COORD_URL, { max: 1 });
      try {
        const idA = await identifyBackend(
          a.sql,
          "ddl",
          op,
          a.connectionId,
          "DDL_CONNECTION_IDENTIFIED",
        );
        const idB = await identifyBackend(
          b.sql,
          "ddl",
          op,
          b.connectionId,
          "DDL_CONNECTION_IDENTIFIED",
        );
        expect(idA).not.toBeNull();
        expect(idB).not.toBeNull();
        const truth = (await observer`
          SELECT s.backend_start::text AS backend_start,
                 pg_postmaster_start_time()::text AS pm_start
          FROM pg_stat_activity s
          WHERE s.pid = ${idA!.pid}
        `) as Array<{ backend_start: string; pm_start: string }>;
        const t = truth[0];
        const identified = eventsOfOp(sink, op.operationId).filter(
          (e) =>
            e.event_type === "DDL_CONNECTION_IDENTIFIED" &&
            e.outcome === "identified",
        );
        const evA = identified.find((e) => e.pg_backend_pid === idA!.pid);
        const pass =
          t !== undefined &&
          idA!.backendStart === t.backend_start &&
          idA!.postmasterStart === t.pm_start &&
          idA!.backendStart !== idA!.postmasterStart &&
          idB!.pid !== idA!.pid &&
          idB!.backendStart !== idA!.backendStart &&
          idB!.postmasterStart === idA!.postmasterStart &&
          evA?.pg_backend_start === t.backend_start &&
          evA?.pg_postmaster_start === t.pm_start &&
          evA?.missing.length === 0;
        record(
          "C14",
          "session start and instance start are read back as distinct server facts",
          "pg_backend_start tracks pg_stat_activity.backend_start; pg_postmaster_start identifies the postmaster; two sessions of one postmaster are distinguishable",
          pass,
        );
      } finally {
        await a.sql.end().catch(() => {});
        await b.sql.end().catch(() => {});
        await observer.end().catch(() => {});
      }
    });
    expect(sink.length).toBeGreaterThan(0);
  }, 20_000);

  it("C15: a NEW session on the same postmaster gets a NEW session start while the postmaster start stays constant", async () => {
    // Field-semantics oracle (C4 covers the driver's own rebuild of a dead
    // socket): the previous session ends server-side, the handle is torn
    // down, and the next read-back must describe a genuinely NEW session —
    // same postmaster start, different session start and pid.
    const sink: Sink = [];
    enableTrace(sink);
    const op = beginLockOperation("C15-oracle", LOCK_KEY.toString());
    await runWithTraceOperation(op, async () => {
      const first = postgresWithTraceIdentity(COORD_URL, "ddl", { max: 1 });
      const observer = postgres(COORD_URL, { max: 1 });
      let id1: BackendIdentity | null = null;
      let id2: BackendIdentity | null = null;
      let oldSessionGone = false;
      try {
        id1 = await identifyBackend(
          first.sql,
          "ddl",
          op,
          first.connectionId,
          "DDL_CONNECTION_IDENTIFIED",
        );
        expect(id1).not.toBeNull();
        await observer.unsafe(`SELECT pg_terminate_backend(${id1!.pid})`);
        const gone = (await observer`
          SELECT count(*)::int AS c FROM pg_stat_activity
          WHERE pid = ${id1!.pid}
        `) as Array<{ c: number }>;
        oldSessionGone = Number(gone[0]?.c) === 0;
        await first.sql.end().catch(() => {});
        const second = postgresWithTraceIdentity(COORD_URL, "ddl", { max: 1 });
        try {
          id2 = await identifyBackend(
            second.sql,
            "ddl",
            op,
            second.connectionId,
            "DDL_CONNECTION_IDENTIFIED",
          );
        } finally {
          await second.sql.end().catch(() => {});
        }
      } finally {
        await observer.end().catch(() => {});
      }
      const pass =
        id1 !== null &&
        id2 !== null &&
        oldSessionGone &&
        id2.pid !== id1.pid &&
        id2.backendStart !== id1.backendStart &&
        id2.postmasterStart === id1.postmasterStart;
      record(
        "C15",
        "session generation is distinguishable within ONE postmaster",
        "old session gone → new backend_start (and pid) under a constant pg_postmaster_start; pid reuse cannot alias two sessions",
        pass,
      );
    });
  }, 20_000);

  it("C6: one operation fails while another continues — failure attributed, lock still released", async () => {
    const sink: Sink = [];
    enableTrace(sink);
    const boom = new Error("C6 injected failure");
    await expect(
      withTestInfraLifecycleLock(COORD_URL, async () => {
        throw boom;
      }),
    ).rejects.toBe(boom);
    await withTestInfraLifecycleLock(COORD_URL, async () => {
      await Promise.resolve();
    });

    const failedOps = sink.filter((e) => e.event_type === "OPERATION_FAILED");
    const completedOps = sink.filter(
      (e) => e.event_type === "OPERATION_COMPLETED",
    );
    const failedOpId = failedOps[0]?.operation_id ?? null;
    const failEvents = failedOpId ? eventsOfOp(sink, failedOpId) : [];
    const pass =
      failedOps.length === 1 &&
      completedOps.length === 1 &&
      failedOpId !== null &&
      failedOpId !== completedOps[0]?.operation_id &&
      failEvents.some(
        (e) =>
          e.event_type === "CRITICAL_SECTION_EXIT" &&
          e.outcome?.startsWith("error:"),
      ) &&
      failEvents.some(
        (e) => e.event_type === "UNLOCK_ACK" && e.outcome === "released",
      ) &&
      failEvents.some((e) => e.event_type === "POOL_END_COMPLETE");
    record(
      "C6",
      "failing op: OPERATION_FAILED + unlock + pool-end events; sibling op unaffected",
      "error paths are traced and still release the lock",
      pass,
    );
  }, 20_000);

  it("C7: per-operation phase order CRITICAL_SECTION_EXIT < UNLOCK_ACK < POOL_END_COMPLETE", async () => {
    const sink: Sink = [];
    enableTrace(sink);
    await withTestInfraLifecycleLock(COORD_URL, async () => {
      await Promise.resolve();
    });
    const completedId = sink.find((e) => e.event_type === "OPERATION_COMPLETED")
      ?.operation_id as string;
    const evs = eventsOfOp(sink, completedId);
    const at = (t: string) => {
      const e = evs.find((x) => x.event_type === t);
      return e ? Number(e.monotonic_ns) : Number.NaN;
    };
    const [exit, unlockAck, poolEnd] = [
      at("CRITICAL_SECTION_EXIT"),
      at("UNLOCK_ACK"),
      at("POOL_END_COMPLETE"),
    ];
    const pass =
      !Number.isNaN(exit) &&
      !Number.isNaN(unlockAck) &&
      !Number.isNaN(poolEnd) &&
      exit < unlockAck &&
      unlockAck < poolEnd;
    record(
      "C7",
      "exit precedes unlock-ack precedes pool-end-complete (single clock domain)",
      "hold accounting boundary (UNLOCK_ACK) is separable from teardown",
      pass,
    );
  }, 20_000);

  it("C8: overlapping operations share NO identity fields — only independent timestamps", async () => {
    const sink: Sink = [];
    enableTrace(sink);
    let releaseHold!: () => void;
    const holdGate = new Promise<void>((r) => {
      releaseHold = r;
    });
    const holder = withTestInfraLifecycleLock(COORD_URL, async () => {
      await holdGate;
    });
    const waiter = withTestInfraLifecycleLock(COORD_URL, async () => {
      await Promise.resolve();
    });
    releaseHold();
    await Promise.all([holder, waiter]);

    const opIds = new Set(
      sink
        .filter((e) => e.operation_id !== null)
        .map((e) => e.operation_id as string),
    );
    // Every application_name-bearing event encodes exactly its own op id;
    // the only cross-op evidence is timestamps (non-happens-before).
    const crossTagged = sink.filter(
      (e) =>
        e.operation_id !== null &&
        e.application_name !== undefined &&
        !e.application_name.endsWith(e.operation_id),
    );
    const pass = opIds.size === 2 && crossTagged.length === 0;
    record(
      "C8",
      "time overlap alone yields NO cross-op identity edge",
      "every traced identity field binds to exactly one operation",
      pass,
    );
  }, 20_000);

  it("C10 (PG half): trace OFF — lifecycle holder session carries NO exi: application_name; sink stays empty", async () => {
    delete process.env.TEST_INFRA_TRACE;
    const sink: Sink = [];
    __setTraceSinkForTests((event) => {
      sink.push(event);
    });
    expect(isTestInfraTraceEnabled()).toBe(false);

    // classid/objid are the signed int32 halves of the int64 advisory key.
    const classid = Number(BigInt.asIntN(32, (LOCK_KEY >> 32n) & 0xffffffffn));
    const objid = Number(BigInt.asIntN(32, LOCK_KEY & 0xffffffffn));
    const observer = postgres(COORD_URL, { max: 1 });
    let holderApp = "not-observed";
    try {
      await withTestInfraLifecycleLock(COORD_URL, async () => {
        // We hold the lifecycle lock: the granted advisory row for THE key
        // is OUR holder session — read its server-side application_name.
        const rows = (await observer`
            SELECT a.application_name AS app
            FROM pg_locks l
            JOIN pg_stat_activity a ON a.pid = l.pid
            WHERE l.locktype = 'advisory'
              AND l.classid = ${classid}
              AND l.objid = ${objid}
              AND l.granted
            LIMIT 1
          `) as Array<{ app: string }>;
        holderApp = rows[0]?.app ?? "missing";
      });
    } finally {
      await observer.end();
      __setTraceSinkForTests(null);
    }
    const pass =
      sink.length === 0 &&
      !holderApp.startsWith("exi:") &&
      holderApp !== "missing";
    record(
      "C10",
      "trace OFF → zero events; holder session has default application_name",
      "default execution adds no SQL and no identity annotations",
      pass,
    );
  }, 20_000);

  it("A2: ensure-database operation decomposes into DB_EXISTS_CHECK + CREATE_DATABASE sub-phases", async () => {
    const sink: Sink = [];
    enableTrace(sink);
    await ensureDatabaseExists(COORD_URL, ORACLE_DB);
    const opId = sink.find((e) => e.event_type === "LOCK_CALL_BEGIN")
      ?.operation_id as string;
    const subs = eventsOfOp(sink, opId)
      .filter((e) => e.event_type === "DDL_RESPONSE_RECEIVED")
      .map((e) => e.sub_operation);
    const pass =
      typeof opId === "string" &&
      subs.includes("DB_EXISTS_CHECK") &&
      subs.includes("CREATE_DATABASE");
    record(
      "A2",
      "ensure operation decomposes into per-SQL sub-phases",
      "critical section is decomposed (no single DDL blob)",
      pass,
    );
  }, 30_000);

  it("C11: a throwing trace sink cannot orphan the lifecycle lock or fail the operation", async () => {
    // Regression for the sink-error wedge found in independent review: an
    // exception escaping an emit between lock acquisition and unlock would
    // skip the release, leaving a session-level advisory lock held for the
    // life of the process and queueing every other worker on the single key.
    vi.stubEnv("TEST_INFRA_TRACE", "1");
    __setTraceSinkForTests(() => {
      throw new Error("synthetic sink failure (ENOSPC/EACCES class)");
    });

    let bodyRan = false;
    await expect(
      withTestInfraLifecycleLock(COORD_URL, async () => {
        bodyRan = true;
      }),
    ).resolves.toBeUndefined();

    // The lock must be free immediately: this acquisition runs with the trace
    // sink still throwing, i.e. under the worst-case sink behaviour.
    const second = withTestInfraLifecycleLock(COORD_URL, async () => "ok");
    const raced = await Promise.race([
      second,
      new Promise((resolve) => setTimeout(() => resolve("TIMEOUT"), 5_000)),
    ]);
    __setTraceSinkForTests(null);
    const pass = bodyRan && raced === "ok";
    record(
      "C11",
      "sink throws during the critical section",
      "operation completes and the advisory lock is released (no orphaned holder)",
      pass,
    );
  }, 30_000);

  it("C13: a failed lock acquisition still emits a terminal event and rethrows", async () => {
    // Regression for the re-review finding that acquisition failure produced an
    // operation with zero terminal events — exactly the shape a flake
    // investigation needs to read (lane contention, authority misconfiguration).
    const sink: Sink = [];
    enableTrace(sink);
    vi.stubEnv("TEST_ADMIN_DATABASE", "nonexistent_db_trace_probe_zz");

    let rejected = false;
    try {
      await withTestInfraLifecycleLock(BASE_URL, async () => undefined);
    } catch {
      rejected = true;
    }
    const opId = sink.find((e) => e.event_type === "OPERATION_BEGIN")
      ?.operation_id as string;
    const terminals = eventsOfOp(sink, opId).filter((e) =>
      /OPERATION_(COMPLETED|FAILED)/.test(e.event_type),
    );
    const pass =
      rejected === true &&
      typeof opId === "string" &&
      terminals.length === 1 &&
      terminals[0]?.event_type === "OPERATION_FAILED";
    record(
      "C13",
      "lock acquisition fails (unreachable coordination database)",
      "the operation still gets exactly one terminal event (OPERATION_FAILED) and the error propagates",
      pass,
    );
  }, 30_000);

  it("C12: one OPERATION_BEGIN and one terminal event per operation; lock calls carry their own site", async () => {
    const sink: Sink = [];
    enableTrace(sink);

    // Owner path: the lock wrapper creates the operation identity itself.
    await withTestInfraLifecycleLock(COORD_URL, async () => undefined);
    const ownerOp = sink.find((e) => e.event_type === "OPERATION_BEGIN")
      ?.operation_id as string;
    const ownerEvents = eventsOfOp(sink, ownerOp);
    const ownerBegins = ownerEvents.filter(
      (e) => e.event_type === "OPERATION_BEGIN",
    ).length;
    const ownerTerminals = ownerEvents.filter(
      (e) => e.event_type === "OPERATION_COMPLETED",
    ).length;
    const ownerLockBegins = ownerEvents.filter(
      (e) => e.event_type === "LOCK_CALL_BEGIN",
    ).length;
    const ownerLockSites = ownerEvents
      .filter((e) => e.event_type === "LOCK_CALL_BEGIN")
      .map((e) => e.caller ?? "");

    // Nested path: an ambient operation (a larger flow owns the identity) must
    // NOT get a second begin or the terminal event from the lock wrapper.
    sink.length = 0;
    const ambient = beginLockOperation("synthetic.flow.owner", "42");
    await runWithTraceOperation(ambient, async () => {
      await withTestInfraLifecycleLock(COORD_URL, async () => undefined);
    });
    const nestedEvents = eventsOfOp(sink, ambient.operationId);
    const nestedTerminals = nestedEvents.filter((e) =>
      /OPERATION_(COMPLETED|FAILED)/.test(e.event_type),
    ).length;
    const nestedBegins = nestedEvents.filter(
      (e) => e.event_type === "OPERATION_BEGIN",
    ).length;

    const pass =
      ownerBegins === 1 &&
      ownerTerminals === 1 &&
      ownerLockBegins === 1 &&
      ownerLockSites.every((c) => c.length > 0) &&
      nestedBegins === 0 &&
      nestedTerminals === 0;
    record(
      "C12",
      "operation vs lock-call event contract",
      "exactly one OPERATION_BEGIN + one terminal per operation; nested lock call emits neither",
      pass,
    );
  }, 30_000);
});
