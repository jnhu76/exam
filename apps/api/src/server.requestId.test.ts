/**
 * #860 PR-T header guard: the production Fastify startup keeps its DEFAULT
 * requestId generator and keeps `requestIdHeader` DISABLED.
 *
 * Adjudication contract (EXAM-860-874 §C1/§C2, PR-T "Header guard"): a
 * client-supplied `request-id` / `X-Request-Id` header is an unverified
 * correlation CLAIM, never the server's request identity. If a future change
 * enables `requestIdHeader` (or swaps the default generator), the server
 * would start echoing attacker-controlled ids into logs, error envelopes,
 * and HTTP audit rows — this guard fails on exactly that regression.
 *
 * Like server.shutdown.test.ts, this test spawns the REAL production
 * entrypoint (`apps/api/src/server.ts`) as a child process — the only way to
 * assert "the actual production Fastify options" without duplicating the
 * constructor literal (a copy would drift silently). Three probes on one
 * boot:
 *
 *  1. a request carrying BOTH `request-id` and `X-Request-Id` headers must
 *     log a default-format `req-<n>` id that is NOT either header value;
 *  2. a 404 error envelope's `error.requestId` must be the server-generated
 *     id (default `req-<n>` format, never the forged header values);
 *  3. that same envelope requestId must equal the `reqId` pino puts on the
 *     corresponding request log lines (envelope ↔ log correspondence).
 */
import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPostgresDatabase } from "@exam/db/postgres";
import { getIsolatedTestDb, resolveTestDbUrl } from "@exam/db/testDb";
import { addSearchPathToUrl } from "@exam/db/testIsolation";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = resolve(__dirname, "server.ts");
const TSX_IMPORT_SPECIFIER = import.meta.resolve("tsx");

const BOOT_TIMEOUT_MS = 45_000;

/** Fastify's default genReqId format: an incrementing `req-<n>` counter. */
const DEFAULT_REQ_ID_RE = /^req-\d+$/;

async function pgReachable(url: string): Promise<boolean> {
  const conn = await createPostgresDatabase(url);
  try {
    await conn.sql`SELECT 1`;
    return true;
  } catch {
    return false;
  } finally {
    await conn.sql.end();
  }
}

const PG_UP = await pgReachable(resolveTestDbUrl());
const PG_DESCRIBE = PG_UP ? describe : describe.skip;

interface PinoLine {
  reqId?: string;
  msg?: string;
  res?: { statusCode?: number };
  req?: { url?: string; method?: string };
  responseTime?: number;
}

function parsePinoLines(stdout: string): PinoLine[] {
  return stdout
    .split("\n")
    .filter((l) => l.startsWith("{"))
    .map((l) => {
      try {
        return JSON.parse(l) as PinoLine;
      } catch {
        return null;
      }
    })
    .filter((l): l is PinoLine => l !== null);
}

interface BootedServer {
  port: number;
  stdout: () => string;
  close: () => Promise<{ stdout: string; stderr: string }>;
}

async function bootProductionServer(): Promise<BootedServer> {
  const iso = await getIsolatedTestDb("api-server-request-id");
  // Shared-DB fallback (isolation disabled) has no schemaName; the base
  // test URL is then correct as-is.
  const baseUrl = iso.databaseUrl ?? resolveTestDbUrl();
  const childDbUrl = iso.schemaName
    ? addSearchPathToUrl(baseUrl, iso.schemaName)
    : baseUrl;

  const childPort = 20_000 + Math.floor(Math.random() * 20_000);
  const child = spawn(
    process.execPath,
    ["--import", TSX_IMPORT_SPECIFIER, SERVER_PATH],
    {
      // Closed-whitelist managed test profile (same shape as
      // server.shutdown.test.ts): the child must never read the developer
      // `.env`, and the DB target is the test-owned URL below.
      env: {
        APP_MODE: "test",
        NODE_ENV: "test",
        HOST: "127.0.0.1",
        APP_PORT: String(childPort),
        TEST_DATABASE_URL: childDbUrl,
        JWT_SECRET: "request-id-guard-test-jwt-secret-0123456789abcdef",
        EMAIL_ENABLED: "false",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (d: string) => {
    stdout += d;
  });
  child.stderr.on("data", (d: string) => {
    stderr += d;
  });

  const port = await new Promise<number>((resolvePort, reject) => {
    const bootTimer = setTimeout(
      () =>
        reject(
          new Error(
            `server did not boot within ${BOOT_TIMEOUT_MS}ms\nstdout: ${stdout}\nstderr: ${stderr}`,
          ),
        ),
      BOOT_TIMEOUT_MS,
    );
    const poll = setInterval(() => {
      const match = stdout.match(
        /Server listening at http:\/\/127\.0\.0\.1:(\d+)/,
      );
      if (match) {
        clearInterval(poll);
        clearTimeout(bootTimer);
        resolvePort(Number(match[1]));
      }
    }, 50);
    child.on("close", () => {
      clearInterval(poll);
      clearTimeout(bootTimer);
      reject(
        new Error(
          `server exited before listening\nstdout: ${stdout}\nstderr: ${stderr}`,
        ),
      );
    });
  });

  return {
    port,
    stdout: () => stdout,
    close: async () => {
      child.kill("SIGTERM");
      const done = await new Promise<{ stdout: string; stderr: string }>(
        (resolveClose) => {
          const timer = setTimeout(() => {
            child.kill("SIGKILL");
            resolveClose({ stdout, stderr });
          }, 10_000);
          child.on("close", () => {
            clearTimeout(timer);
            resolveClose({ stdout, stderr });
          });
        },
      );
      await iso.cleanup();
      return done;
    },
  };
}

PG_DESCRIBE("production requestId guard (#860 PR-T header guard)", () => {
  it("ignores request-id / X-Request-Id headers and keeps error envelope ↔ pino reqId identical", async () => {
    const server = await bootProductionServer();
    try {
      const forgedLower = "forged-lower-header-id-prt";
      const forgedUpper = "forged-upper-header-id-prt";

      // Probe 1: forged headers on an unmatched /api route → the canonical
      // 404 error envelope. The envelope's requestId must be the server's
      // own default-format id, never a header echo.
      const notFoundPath = `/api/no-such-route-${crypto.randomUUID()}`;
      const res = await fetch(
        `http://127.0.0.1:${server.port}${notFoundPath}`,
        {
          headers: { "request-id": forgedLower, "X-Request-Id": forgedUpper },
        },
      );
      expect(res.status).toBe(404);
      const body = (await res.json()) as {
        error: { code: string; requestId: string };
      };
      expect(body.error.code).toBe("RESOURCE_NOT_FOUND");
      expect(body.error.requestId).toMatch(DEFAULT_REQ_ID_RE);
      expect(body.error.requestId).not.toBe(forgedLower);
      expect(body.error.requestId).not.toBe(forgedUpper);

      // Probe 2: the same forged headers on a successful request.
      const healthRes = await fetch(
        `http://127.0.0.1:${server.port}/api/health`,
        { headers: { "request-id": forgedLower, "X-Request-Id": forgedUpper } },
      );
      expect(healthRes.ok).toBe(true);

      // Probe 3: envelope ↔ pino correspondence for the 404 request. Pino
      // stamps every line of a request with the SAME reqId the error handler
      // passed to buildErrorResponse (request.id). The "incoming request"
      // line carries req.url; the completion line carries res.statusCode —
      // correlate the pair through their shared reqId.
      let requestLine: PinoLine | undefined;
      await expect
        .poll(() => {
          requestLine = parsePinoLines(server.stdout()).find(
            (line) => line.req?.url === notFoundPath && line.reqId,
          );
          return requestLine?.reqId;
        })
        .toMatch(DEFAULT_REQ_ID_RE);
      const reqId = requestLine!.reqId!;
      expect(reqId).not.toBe(forgedLower);
      expect(reqId).not.toBe(forgedUpper);
      expect(body.error.requestId).toBe(reqId);

      const completionLines = parsePinoLines(server.stdout()).filter(
        (line) => line.reqId === reqId && line.res?.statusCode === 404,
      );
      expect(
        completionLines.length,
        `expected a pino completion line for ${notFoundPath}`,
      ).toBeGreaterThanOrEqual(1);

      // The default generator format on the wire: no log line anywhere in
      // this boot may carry a forged header value as its reqId, and the
      // observed request ids keep Fastify's `req-<n>` counter format.
      const allReqIds = parsePinoLines(server.stdout())
        .map((l) => l.reqId)
        .filter((id): id is string => typeof id === "string");
      expect(allReqIds.length).toBeGreaterThanOrEqual(1);
      for (const id of allReqIds) {
        expect(id).toMatch(DEFAULT_REQ_ID_RE);
        expect(id).not.toBe(forgedLower);
        expect(id).not.toBe(forgedUpper);
      }
    } finally {
      await server.close();
    }
  }, 120_000);
});
