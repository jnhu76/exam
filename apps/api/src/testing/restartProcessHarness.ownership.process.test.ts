import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer as createHttpServer } from "node:http";
import {
  isWorkerDatabaseMode,
  setupApiTestDatabaseFromEnv,
} from "../routes/testDatabase.js";
import {
  grabFreePort,
  HarnessError,
  healthState,
  isProcessAlive,
  killHard,
  spawnApiServer,
  type SpawnedApiServer,
} from "./restartProcessHarness.js";

/**
 * Spawned-server OWNERSHIP contract of the process harness (#724).
 *
 * Contract: `spawnApiServer` may only report success when the EXACT spawned
 * child has proven it bound the port (its private stdout listen record) and
 * answers `/api/health`. Port health alone is responsiveness evidence, never
 * identity evidence.
 *
 * Fault model: a foreign process owning the candidate port — a stale server,
 * an external process, or (the #723 observed chain) another suite's spawned
 * instance after a `grabFreePort` TOCTOU collision. Without ownership,
 * `waitHealthy`-style port probing attributes the foreign server's health to
 * the expected child and the suite proceeds against the wrong process.
 *
 * Trigger (deterministic — no probability): a health-shaped foreign server is
 * bound to the requested port BEFORE the launch (T1), or two launches are
 * forced onto one port (T4), or the child is made to die pre-listen (T2).
 *
 * Oracle: startup rejects from the CHILD'S OWN lifecycle (pid, port, exit
 * info, EADDRINUSE attribution, log path) within the child's real fate
 * latency — never as a readiness timeout — and the foreign server is left
 * untouched. The normal path still starts and serves (T3).
 *
 * Owner: this file. These are harness-contract regressions; the suites that
 * CONSUME the harness for durability evidence remain
 * `runtime/processRestartDeadline.process.test.ts` and
 * `routes/admissions.durability.process.test.ts`.
 *
 * LANE CONTRACT (docs/standards/testing.md §5.2): real children of the
 * production entry resolve their database from TEST_DATABASE_URL alone, so
 * like the durability suites this file runs only under worker-database
 * isolation. WHAT THIS PROVES: the harness cannot be fooled by a foreign
 * healthy server. WHY WORKER-DATABASE: spawned children must boot against a
 * real database URL to reach the bind attempt. IN THE FILE-SCHEMA LANE the
 * suite is skipped at collection time, before any setup; the canonical lane
 * that RUNS it is worker-database (pnpm verify / CI api-coverage).
 */

const workerDbDescribe = isWorkerDatabaseMode() ? describe : describe.skip;

/** Foreign server answering exactly what the harness health probe accepts. */
function startForeignHealthServer(port: number): Promise<{
  close: () => Promise<void>;
}> {
  const server = createHttpServer((req, res) => {
    if (req.url === "/api/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () =>
      resolve({
        close: () =>
          new Promise<void>((resolvePromise) =>
            server.close(() => resolvePromise()),
          ),
      }),
    );
  });
}

workerDbDescribe("process harness owned-readiness contract (#724)", () => {
  let workerUrl = "";
  let cleanupHandle: Awaited<
    ReturnType<typeof setupApiTestDatabaseFromEnv>
  > | null = null;
  /** Safety net only — each test stops the servers it booted. */
  const liveServers: SpawnedApiServer[] = [];

  beforeAll(async () => {
    // Children serve liveness only (no business data), but must boot against
    // a real database URL to reach the bind attempt, so they get the
    // canonical worker database exactly like the durability suites.
    cleanupHandle = await setupApiTestDatabaseFromEnv({
      namespace: "harness-ownership",
    });
    workerUrl = cleanupHandle.databaseUrl;
  }, 30_000);

  afterAll(async () => {
    for (const server of liveServers) {
      try {
        if (isProcessAlive(server.pid)) await killHard(server);
      } catch {
        /* already gone */
      }
    }
    await cleanupHandle?.close();
  }, 30_000);

  it("T1: a foreign healthy server on the requested port can never satisfy the expected child", async () => {
    const port = await grabFreePort();
    const foreign = await startForeignHealthServer(port);
    try {
      let rejection: unknown;
      const startedAt = Date.now();
      try {
        await spawnApiServer({ port, databaseUrl: workerUrl });
      } catch (err) {
        rejection = err;
      }
      const elapsed = Date.now() - startedAt;

      // A foreign health answer never substitutes for the expected child.
      expect(rejection).toBeInstanceOf(HarnessError);
      const message = (rejection as Error).message;
      // Attribution points at the EXPECTED child's own lifecycle: its pid,
      // the port, the exit-before-readiness phase, and the bind loss.
      expect(message).toMatch(/child \(pid \d+\)/);
      expect(message).toContain(`:${port}`);
      expect(message).toContain("exited before readiness");
      expect(message).toContain("EADDRINUSE");
      // The rejection came from the child's real fate (one boot cycle), not
      // from burning the 45s startup budget.
      expect(elapsed).toBeLessThan(30_000);
      // The foreign server was never attributed, never killed, still owns.
      expect(await healthState(`http://127.0.0.1:${port}`)).toBe("ok");
      await foreign.close();
      // The failed launch left no orphan listener behind.
      expect(await healthState(`http://127.0.0.1:${port}`)).toBe("refused");
    } finally {
      await foreign.close();
    }
  }, 60_000);

  it("T2: a child that dies before readiness rejects startup from its lifecycle, not a timeout", async () => {
    const port = await grabFreePort();
    let rejection: unknown;
    const startedAt = Date.now();
    try {
      // Deterministic pre-listen death: the driver rejects this URL at
      // config/plugin time, so the child exits before it can bind anything.
      await spawnApiServer({ port, databaseUrl: "not-a-url-at-all" });
    } catch (err) {
      rejection = err;
    }
    const elapsed = Date.now() - startedAt;

    expect(rejection).toBeInstanceOf(HarnessError);
    const message = (rejection as Error).message;
    expect(message).toMatch(/child \(pid \d+\)/);
    expect(message).toContain(`:${port}`);
    expect(message).toContain("exited before readiness");
    expect(message).toMatch(/log: \S+\.log$/);
    expect(elapsed).toBeLessThan(30_000);
  }, 60_000);

  it("T3: a normal child establishes owned readiness and serves health", async () => {
    const port = await grabFreePort();
    const server = await spawnApiServer({ port, databaseUrl: workerUrl });
    liveServers.push(server);
    // The bound endpoint is exactly the requested candidate port.
    expect(server.port).toBe(port);
    expect(server.baseUrl).toBe(`http://127.0.0.1:${port}`);
    expect(isProcessAlive(server.pid)).toBe(true);
    expect(await healthState(server.baseUrl)).toBe("ok");
    await killHard(server);
  }, 90_000);

  it("T4: two launches forced onto one port — exactly one owns it, the loser is rejected", async () => {
    const port = await grabFreePort();
    const winner = await spawnApiServer({ port, databaseUrl: workerUrl });
    liveServers.push(winner);
    let rejection: unknown;
    try {
      await spawnApiServer({ port, databaseUrl: workerUrl });
    } catch (err) {
      rejection = err;
    }

    expect(rejection).toBeInstanceOf(HarnessError);
    const message = (rejection as Error).message;
    expect(message).toContain("exited before readiness");
    expect(message).toContain("EADDRINUSE");
    expect(message).toContain(`:${port}`);
    // The winner is the ONLY owner; its readiness was never borrowed by the
    // loser's launch — no dual-ready attribution.
    expect(isProcessAlive(winner.pid)).toBe(true);
    expect(await healthState(winner.baseUrl)).toBe("ok");
    await killHard(winner);
  }, 120_000);
});
