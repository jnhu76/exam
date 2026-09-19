/**
 * #550 readiness / alerting composition evidence (#547 contract, RESEARCH ONLY).
 *
 * Exercises, against a live API (production mode):
 *   1. baseline: /api/health 200 + /api/ready 200
 *   2. DB unavailable (DEDICATED container stop): health stays 200 (liveness
 *      is dependency-blind), /api/ready flips 503 not_ready; the operability
 *      monitor emits operability.readiness alert transitions into the log.
 *   3. DB recovery (container start): /api/ready returns 200; recovery latency
 *      recorded. False "ready while DB down" must never occur.
 *   4. Redis required-mode boundary: API with REDIS_MODE=required pointed at
 *      a DEDICATED redis; stop redis → /api/ready 503 (fail-closed);
 *      start redis → recover.
 *
 * DB SAFETY: fault injection targets DEDICATED throwaway containers
 * (exam550-readiness-pg / exam550-readiness-redis) on private ports — the
 * shared dev stack (exam-db-1 / exam-redis-1) is never stopped. The
 * readiness gate only needs a connectable PostgreSQL; no schema or data.
 *
 * Run from anywhere in the repo (paths derive from this file's location):
 *   HARNESS=$(git rev-parse --show-toplevel)/docs/research/exam-550-final-capacity-reproof-1/harness
 *   pnpm --filter @exam/db exec tsx "$HARNESS/run-readiness.ts"
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import {
  BASE_SHA,
  CAMPAIGN,
  LOGS_DIR,
  RESULTS_DIR,
  headSha,
} from "./lib/config.js";
import { Client, sleep } from "./lib/http.js";
import { startApi, stopActiveApi, waitReady } from "./lib/runtime.js";
import { createDatabase } from "../../../../packages/db/src/database.js";
import { migratePostgres } from "../../../../packages/db/src/postgres.js";

const API_PORT_RD = 3395;
const PG_PORT = 3393;
const REDIS_PORT = 3394;
const BASE = `http://127.0.0.1:${API_PORT_RD}`;
const PG_NAME = "exam550-readiness-pg";
const REDIS_NAME = "exam550-readiness-redis";
const RUN_DB_URL = `postgres://exam:exam550@127.0.0.1:${PG_PORT}/exam`;
const RUN_REDIS_URL = `redis://127.0.0.1:${REDIS_PORT}`;
const RUN_ID = `readiness-${new Date().toISOString().replace(/[:.]/g, "-")}`;

function sh(cmd: string, args: string[]): void {
  execFileSync(cmd, args, { stdio: "ignore" });
}
function shTry(cmd: string, args: string[]): boolean {
  try {
    execFileSync(cmd, args, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function startDeps(): void {
  shTry("docker", ["rm", "-f", PG_NAME]);
  shTry("docker", ["rm", "-f", REDIS_NAME]);
  sh("docker", [
    "run",
    "-d",
    "--name",
    PG_NAME,
    "-e",
    "POSTGRES_USER=exam",
    "-e",
    "POSTGRES_PASSWORD=exam550",
    "-e",
    "POSTGRES_DB=exam",
    "-p",
    `${PG_PORT}:5432`,
    "postgres:18.4-bookworm",
  ]);
  sh("docker", [
    "run",
    "-d",
    "--name",
    REDIS_NAME,
    "-p",
    `${REDIS_PORT}:6379`,
    "redis:7-alpine",
  ]);
  // Wait for both to accept connections.
  const pgDeadline = Date.now() + 60_000;
  let pg = false;
  while (Date.now() < pgDeadline) {
    if (shTry("docker", ["exec", PG_NAME, "pg_isready", "-U", "exam"])) {
      pg = true;
      break;
    }
    sh("sleep", ["0.5"]);
  }
  if (!pg) throw new Error("readiness-pg did not become ready");
}

function stopDeps(): void {
  shTry("docker", ["rm", "-f", PG_NAME]);
  shTry("docker", ["rm", "-f", REDIS_NAME]);
}

async function probeHealth(): Promise<{
  status: number;
  body: string;
  atMs: number;
}> {
  const c = new Client({ baseUrl: BASE, id: "probe-health", timeoutMs: 4000 });
  const t0 = performance.now();
  const r = await c.request("GET", "/api/health");
  await c.close();
  return {
    status: r.status,
    body: r.body.slice(0, 100),
    atMs: Math.round(performance.now() - t0),
  };
}

async function probeReady(): Promise<{
  status: number;
  body: string;
  atMs: number;
}> {
  const c = new Client({ baseUrl: BASE, id: "probe-ready", timeoutMs: 8000 });
  const t0 = performance.now();
  const r = await c.request("GET", "/api/ready");
  await c.close();
  return {
    status: r.status,
    body: r.body.slice(0, 200),
    atMs: Math.round(performance.now() - t0),
  };
}

/** Poll /api/ready until `want` or timeout; returns transition latency + log. */
async function waitForReady(
  want: number,
  timeoutMs: number,
): Promise<{
  met: boolean;
  latencyMs: number;
  samples: { t: number; status: number }[];
}> {
  const t0 = performance.now();
  const samples: { t: number; status: number }[] = [];
  while (performance.now() - t0 < timeoutMs) {
    const r = await probeReady();
    samples.push({ t: Math.round(performance.now() - t0), status: r.status });
    if (r.status === want) {
      return {
        met: true,
        latencyMs: Math.round(performance.now() - t0),
        samples,
      };
    }
    await sleep(500);
  }
  return { met: false, latencyMs: -1, samples };
}

async function main(): Promise<void> {
  mkdirSync(RESULTS_DIR, { recursive: true });
  const evidence: Record<string, unknown> = {
    run_id: RUN_ID,
    campaign: CAMPAIGN,
    head_sha: headSha(),
    base_sha: BASE_SHA,
    started_at: new Date().toISOString(),
    faultInjection: {
      db: `${PG_NAME} (dedicated throwaway, port ${PG_PORT})`,
      redis: `${REDIS_NAME} (dedicated throwaway, port ${REDIS_PORT})`,
      note: "shared dev stack (exam-db-1/exam-redis-1) never stopped",
    },
  };
  let depsUp = false;

  try {
    startDeps();
    depsUp = true;

    // The readiness gate pings `SELECT … FROM organizations` — the throwaway
    // DB needs the schema, or every probe 503s from boot (measured: without
    // migration the whole evidence is vacuously 503).
    const migConn = await createDatabase(RUN_DB_URL);
    await migratePostgres(migConn.db, {});
    await migConn.sql.end({ timeout: 5 });

    const api = startApi({
      mode: "production",
      dbUrl: RUN_DB_URL,
      runId: RUN_ID,
      port: API_PORT_RD,
      extraEnv: { REDIS_URL: RUN_REDIS_URL },
    });
    await waitReady(BASE);
    evidence.baseline = {
      health: await probeHealth(),
      ready: await probeReady(),
    };

    // ── DB down ──
    console.log(`▶ stopping ${PG_NAME} …`);
    sh("docker", ["stop", PG_NAME]);
    await sleep(2000);
    const downWindow = await waitForReady(503, 30_000);
    evidence.dbDown = {
      readyFlipped503: downWindow.met,
      flipLatencyMs: downWindow.latencyMs,
      healthDuringDown: await probeHealth(),
      readySamples: downWindow.samples.slice(0, 20),
      readyBody: (await probeReady()).body,
    };
    // Hold the outage briefly; sample ready repeatedly to prove no false ready.
    const holds: number[] = [];
    for (let i = 0; i < 6; i++) {
      holds.push((await probeReady()).status);
      await sleep(2000);
    }
    evidence.dbDown.steadyReadyStatusesDuringOutage = holds;

    // ── DB recovery ──
    console.log(`▶ starting ${PG_NAME} …`);
    sh("docker", ["start", PG_NAME]);
    for (let i = 0; i < 60; i++) {
      if (shTry("docker", ["exec", PG_NAME, "pg_isready", "-U", "exam"])) break;
      await sleep(500);
    }
    const recovery = await waitForReady(200, 60_000);
    evidence.dbRecovery = {
      readyBackTo200: recovery.met,
      recoveryLatencyMs: recovery.latencyMs,
      samples: recovery.samples.slice(0, 30),
    };

    // ── Redis required-mode boundary (fresh API, dedicated redis) ──
    await stopActiveApi();
    const api2 = startApi({
      mode: "production",
      dbUrl: RUN_DB_URL,
      runId: `${RUN_ID}-redisreq`,
      port: API_PORT_RD,
      extraEnv: { REDIS_URL: RUN_REDIS_URL, REDIS_MODE: "required" },
    });
    await waitReady(BASE);
    evidence.redisRequiredBaseline = { ready: await probeReady() };
    console.log(`▶ stopping ${REDIS_NAME} (REDIS_MODE=required) …`);
    sh("docker", ["stop", REDIS_NAME]);
    const redisDown = await waitForReady(503, 30_000);
    evidence.redisRequiredDown = {
      readyFlipped503: redisDown.met,
      flipLatencyMs: redisDown.latencyMs,
      body: (await probeReady()).body,
      samples: redisDown.samples.slice(0, 10),
    };
    sh("docker", ["start", REDIS_NAME]);
    const redisRec = await waitForReady(200, 30_000);
    evidence.redisRequiredRecovery = {
      readyBackTo200: redisRec.met,
      recoveryLatencyMs: redisRec.latencyMs,
    };

    // Alert-path evidence: grep the API log for operability events.
    await sleep(16_000); // let the operability monitor settle transitions
    const logs = readdirSync(LOGS_DIR).filter((f) =>
      f.startsWith("readiness-"),
    );
    const alerts: string[] = [];
    for (const f of logs) {
      try {
        for (const line of readFileSync(join(LOGS_DIR, f), "utf8").split(
          "\n",
        )) {
          if (line.includes("operability")) alerts.push(line.slice(0, 400));
        }
      } catch {
        /* ignore */
      }
    }
    evidence.alertLogLines = alerts.slice(0, 40);
    evidence.alertEvidenceFound = alerts.length > 0;

    evidence.finished_at = new Date().toISOString();
    writeFileSync(
      join(RESULTS_DIR, `${RUN_ID}.json`),
      JSON.stringify(evidence, null, 2) + "\n",
    );
    console.log(
      JSON.stringify(
        {
          dbDownFlip: (evidence.dbDown as Record<string, unknown>)
            .readyFlipped503,
          noFalseReady: holds.every((s) => s === 503),
          dbRecovery: (evidence.dbRecovery as Record<string, unknown>)
            .readyBackTo200,
          redisRequiredFailClosed: (
            evidence.redisRequiredDown as Record<string, unknown>
          ).readyFlipped503,
          alertsFound: evidence.alertEvidenceFound,
        },
        null,
        2,
      ),
    );
    await stopActiveApi();
  } finally {
    if (depsUp) stopDeps();
  }
}

main().catch(async (err) => {
  console.error(err);
  await stopActiveApi();
  process.exit(1);
});
