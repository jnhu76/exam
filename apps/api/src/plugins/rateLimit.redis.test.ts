import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  afterEach,
  beforeEach,
} from "vitest";
import net from "node:net";
import Fastify, { type FastifyInstance } from "fastify";
import Redis from "ioredis";
import { setupErrorHandler } from "./errors.js";
import redisPlugin from "./redis.js";
import rateLimitPlugin from "./rateLimit.js";
import { resetRuntimeConfigForTest } from "../config/runtimeConfig.js";
import { RATE_LIMIT_UNAVAILABLE } from "../redis/rateLimitStores.js";
import { RuntimeConfigError } from "@exam/domain";

/**
 * P7 integration tests for the shared Redis rate limiter.
 *
 * Redis-gated suites (real Redis, like the baseline `redis.test.ts`) SKIP
 * when Redis is not reachable. The outage/recovery suites use a controllable
 * fake RESP server and always run — that is how runtime Redis loss is proven
 * deterministically without touching the shared dev Redis.
 *
 * Env discipline: each test sets the REDIS_* env it needs and restores it in
 * `afterEach` (the runtime config is cached, so every build re-resets it).
 */

// ── Real-Redis reachability gate ────────────────────────────────────────
function resolveRedisUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env.REDIS_URL ?? env.TEST_REDIS_URL;
  if (!raw) return null;
  const trimmed = raw.trim();
  return trimmed.length === 0 ? null : trimmed;
}

async function canReachRedis(url: string): Promise<boolean> {
  const probe = new Redis(url, {
    maxRetriesPerRequest: 1,
    connectTimeout: 500,
    retryStrategy: () => null,
    enableOfflineQueue: false,
    lazyConnect: true,
  });
  try {
    await probe.connect();
    await probe.ping();
    return true;
  } catch {
    return false;
  } finally {
    if (probe.status !== "end") {
      try {
        await probe.quit();
      } catch {
        /* ignore */
      }
    }
  }
}

const REDIS_URL = resolveRedisUrl();
let redisReachable = false;

beforeAll(async () => {
  redisReachable = REDIS_URL ? await canReachRedis(REDIS_URL) : false;
});

// ── Controllable fake Redis (RESP) for outage/recovery tests ────────────
const INFO_REPLY_BODY =
  "# Server\r\nredis_version:7.0.0\r\nredis_mode:standalone\r\nrole:master\r\n";

/**
 * Minimal RESP server that speaks just enough Redis for ioredis to connect
 * (CLIENT SETINFO / INFO / PING) and serves the rate-limit Lua counter
 * semantics in memory (INCR fixed window, TTL). The listener can be stopped
 * and restarted on the same port to simulate an outage and its recovery.
 */
class FakeRedisServer {
  private server: net.Server | null = null;
  private readonly sockets = new Set<net.Socket>();
  private readonly counters = new Map<
    string,
    { count: number; startedAt: number }
  >();
  port = 0;

  async start(port = 0): Promise<number> {
    this.server = net.createServer((sock) => {
      this.sockets.add(sock);
      sock.on("close", () => this.sockets.delete(sock));
      sock.on("error", () => this.sockets.delete(sock));
      sock.on("data", (data) => this.handleData(sock, data));
    });
    await new Promise<void>((resolve) =>
      this.server!.listen(port, "127.0.0.1", resolve),
    );
    const addr = this.server!.address() as net.AddressInfo;
    this.port = addr.port;
    return this.port;
  }

  /** Simulate an outage: destroy all connections and close the listener. */
  async stop(): Promise<void> {
    for (const sock of this.sockets) sock.destroy();
    this.sockets.clear();
    if (this.server) {
      await new Promise<void>((resolve) => this.server!.close(() => resolve()));
      this.server = null;
    }
  }

  /** Restore service on the SAME port (ioredis reconnects automatically). */
  async restore(): Promise<number> {
    return this.start(this.port);
  }

  private handleData(sock: net.Socket, data: Buffer): void {
    for (const cmd of parseRespCommands(data)) {
      this.respond(sock, cmd);
    }
  }

  private respond(sock: net.Socket, cmd: string[]): void {
    const name = (cmd[0] ?? "").toUpperCase();
    if (name === "PING") {
      sock.write("+PONG\r\n");
    } else if (name === "INFO") {
      sock.write(
        `$${Buffer.byteLength(INFO_REPLY_BODY)}\r\n${INFO_REPLY_BODY}\r\n`,
      );
    } else if (name === "EVAL" || name === "EVALSHA") {
      // Args: [script|sha, numkeys, key, timeWindow, max, ...flags]
      const key = cmd[3] ?? "";
      const timeWindow = Number(cmd[4] ?? 60_000);
      const now = Date.now();
      let entry = this.counters.get(key);
      if (!entry) {
        entry = { count: 0, startedAt: now };
      }
      entry.count += 1;
      const ttl =
        entry.count === 1
          ? timeWindow
          : Math.max(0, timeWindow - (now - entry.startedAt));
      this.counters.set(key, entry);
      sock.write(`*2\r\n:${entry.count}\r\n:${ttl}\r\n`);
    } else if (name === "QUIT") {
      sock.write("+OK\r\n");
      sock.end();
    } else {
      sock.write("+OK\r\n");
    }
  }
}

/** Parse RESP arrays of the form *N\r\n$len\r\nARG\r\n... into commands. */
function parseRespCommands(buf: Buffer): string[][] {
  const commands: string[][] = [];
  let i = 0;
  while (i < buf.length) {
    if (buf[i] !== 0x2a) break; // '*'
    const lineEnd = buf.indexOf(0x0a, i);
    if (lineEnd === -1) break;
    const count = Number(buf.subarray(i + 1, lineEnd - 1).toString());
    i = lineEnd + 1;
    const args: string[] = [];
    let ok = true;
    for (let n = 0; n < count; n++) {
      if (buf[i] !== 0x24) {
        ok = false;
        break;
      }
      const lenEnd = buf.indexOf(0x0a, i);
      if (lenEnd === -1) {
        ok = false;
        break;
      }
      const len = Number(buf.subarray(i + 1, lenEnd - 1).toString());
      i = lenEnd + 1;
      args.push(buf.subarray(i, i + len).toString());
      i += len + 2; // skip \r\n
    }
    if (!ok) break;
    commands.push(args);
  }
  return commands;
}

// ── App builder ─────────────────────────────────────────────────────────
const REDIS_ENV_KEYS = [
  "REDIS_URL",
  "REDIS_KEY_PREFIX",
  "REDIS_MODE",
  "REDIS_STARTUP_TIMEOUT_MS",
  "REDIS_COMMAND_TIMEOUT_MS",
  "REDIS_CONNECT_TIMEOUT_MS",
  "RATE_LIMIT_DISABLED",
  "APP_MODE",
] as const;

interface BuildAppOptions {
  url: string;
  keyPrefix: string;
  mode: "off" | "optional" | "required";
  max: number;
  timeWindowMs?: number;
  startupTimeoutMs?: number;
  commandTimeoutMs?: number;
  connectTimeoutMs?: number;
}

async function buildApp(opts: BuildAppOptions): Promise<FastifyInstance> {
  process.env.REDIS_URL = opts.url;
  process.env.REDIS_KEY_PREFIX = opts.keyPrefix;
  process.env.REDIS_MODE = opts.mode;
  process.env.REDIS_STARTUP_TIMEOUT_MS = String(opts.startupTimeoutMs ?? 1000);
  process.env.REDIS_COMMAND_TIMEOUT_MS = String(opts.commandTimeoutMs ?? 500);
  process.env.REDIS_CONNECT_TIMEOUT_MS = String(opts.connectTimeoutMs ?? 500);
  process.env.RATE_LIMIT_DISABLED = "false";
  process.env.APP_MODE = "test";
  resetRuntimeConfigForTest();

  const app = Fastify();
  setupErrorHandler(app);
  await app.register(redisPlugin);
  await app.register(rateLimitPlugin);
  app.get(
    "/limited",
    {
      config: {
        rateLimit: {
          max: opts.max,
          timeWindow: opts.timeWindowMs ?? 60_000,
        },
      },
    },
    async () => ({ ok: true }),
  );
  await app.ready();
  return app;
}

let savedEnv: Record<string, string | undefined> = {};

afterEach(async () => {
  for (const key of REDIS_ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  resetRuntimeConfigForTest();
});

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 8000,
  intervalMs = 50,
): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("waitFor timed out");
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

// ── Suites ──────────────────────────────────────────────────────────────
describe("P7 shared Redis rate limit (integration)", () => {
  beforeEach(() => {
    for (const key of REDIS_ENV_KEYS) {
      savedEnv[key] = process.env[key];
    }
  });

  describe("two-instance acceptance experiment (P7 §16)", () => {
    it("two API instances alternating requests share ONE limit of N (not 2N)", async ({
      skip,
    }) => {
      if (!REDIS_URL || !redisReachable) return skip("Redis not reachable");
      const prefix = `exam:test:ratelimit:${Date.now()}:`;
      const opts: BuildAppOptions = {
        url: REDIS_URL,
        keyPrefix: prefix,
        mode: "optional",
        max: 5,
      };
      const appA = await buildApp(opts);
      const appB = await buildApp(opts);
      const raw = new Redis(REDIS_URL, { lazyConnect: true });
      await raw.connect();
      try {
        // 12 alternating requests: the shared counter must allow exactly 5.
        const statuses: number[] = [];
        for (let i = 0; i < 12; i += 1) {
          const app = i % 2 === 0 ? appA : appB;
          const res = await app.inject({ method: "GET", url: "/limited" });
          statuses.push(res.statusCode);
        }
        expect(statuses.filter((s) => s === 200)).toHaveLength(5);
        expect(statuses.filter((s) => s === 429)).toHaveLength(7);

        // The rejected responses carry the canonical structured error.
        const blocked = await appB.inject({ method: "GET", url: "/limited" });
        expect(blocked.statusCode).toBe(429);
        expect(blocked.json()).toMatchObject({
          error: { code: "RATE_LIMITED" },
        });

        // Keys exist under the scope prefix, every key has TTL > 0, and no
        // raw IP appears in the keyspace (P7 §12/§13/§14).
        const keys = await raw.keys(`${prefix}ratelimit:v1:*`);
        expect(keys.length).toBeGreaterThan(0);
        for (const key of keys) {
          expect(key.startsWith(prefix)).toBe(true);
          const ttl = await raw.pttl(key);
          expect(ttl).toBeGreaterThan(0);
          expect(key).not.toContain("127.0.0.1");
          expect(key).not.toContain("::1");
        }
      } finally {
        await appA.close();
        await appB.close();
        // Prefix-scoped cleanup only — never FLUSHALL.
        await raw.del(...(await raw.keys(`${prefix}*`)));
        await raw.quit();
      }
    });
  });

  describe("local-mode control experiment (P7 §17)", () => {
    it("two instances without shared Redis each allow N (2N total)", async () => {
      const opts: BuildAppOptions = {
        url: REDIS_URL ?? "redis://localhost:6379",
        keyPrefix: "exam:test:control:",
        mode: "off",
        max: 5,
      };
      const appA = await buildApp(opts);
      const appB = await buildApp(opts);
      try {
        // Hammer A: it owns its own counter → 5 allowed then 429s.
        const aStatuses: number[] = [];
        for (let i = 0; i < 8; i += 1) {
          const res = await appA.inject({ method: "GET", url: "/limited" });
          aStatuses.push(res.statusCode);
        }
        expect(aStatuses.filter((s) => s === 200)).toHaveLength(5);
        expect(aStatuses.filter((s) => s === 429)).toHaveLength(3);

        // B owns an independent counter → still fully allowed.
        for (let i = 0; i < 5; i += 1) {
          const res = await appB.inject({ method: "GET", url: "/limited" });
          expect(res.statusCode).toBe(200);
        }
      } finally {
        await appA.close();
        await appB.close();
      }
    });
  });

  describe("test-scope prefix isolation (ADR-007 / P7 §24)", () => {
    it("two scopes on the same Redis cannot consume each other's counters", async ({
      skip,
    }) => {
      if (!REDIS_URL || !redisReachable) return skip("Redis not reachable");
      const ts = Date.now();
      const appA = await buildApp({
        url: REDIS_URL,
        keyPrefix: `exam:test:rlA:${ts}:`,
        mode: "optional",
        max: 3,
      });
      const appB = await buildApp({
        url: REDIS_URL,
        keyPrefix: `exam:test:rlB:${ts}:`,
        mode: "optional",
        max: 3,
      });
      const raw = new Redis(REDIS_URL, { lazyConnect: true });
      await raw.connect();
      try {
        for (let i = 0; i < 3; i += 1) {
          const res = await appA.inject({ method: "GET", url: "/limited" });
          expect(res.statusCode).toBe(200);
        }
        expect(
          (await appA.inject({ method: "GET", url: "/limited" })).statusCode,
        ).toBe(429);

        // Scope B is untouched: its full allowance remains.
        for (let i = 0; i < 3; i += 1) {
          const res = await appB.inject({ method: "GET", url: "/limited" });
          expect(res.statusCode).toBe(200);
        }

        // The counters live under distinct prefixes.
        const keysA = await raw.keys(`exam:test:rlA:${ts}:ratelimit:v1:*`);
        const keysB = await raw.keys(`exam:test:rlB:${ts}:ratelimit:v1:*`);
        expect(keysA.length).toBeGreaterThan(0);
        expect(keysB.length).toBeGreaterThan(0);
      } finally {
        await appA.close();
        await appB.close();
        await raw.del(
          ...(await raw.keys(`exam:test:rlA:${ts}:*`)),
          ...(await raw.keys(`exam:test:rlB:${ts}:*`)),
        );
        await raw.quit();
      }
    });
  });

  describe("startup failure modes (P7 §19/§20)", () => {
    it("optional: unreachable Redis at startup → app boots, local limiting active, runtime degraded", async () => {
      const app = await buildApp({
        url: "redis://127.0.0.1:1",
        keyPrefix: "",
        mode: "optional",
        max: 1,
        startupTimeoutMs: 300,
      });
      try {
        expect(app.redisRuntime.state).toBe("degraded");
        // The first connect attempt fails fast with ECONNREFUSED (reason
        // connection_lost) or the bounded window expires (startup_timeout);
        // either way the runtime is explicitly degraded, never a fake
        // "connected" boolean.
        expect(["startup_timeout", "connection_lost"]).toContain(
          app.redisRuntime.degradedReason,
        );
        expect(app.redisRuntime.snapshot().mode).toBe("optional");

        const first = await app.inject({ method: "GET", url: "/limited" });
        expect(first.statusCode).toBe(200);
        const second = await app.inject({ method: "GET", url: "/limited" });
        expect(second.statusCode).toBe(429);
        expect(second.json()).toMatchObject({
          error: { code: "RATE_LIMITED" },
        });
      } finally {
        await app.close();
      }
    });

    it("required: unreachable Redis fails startup deterministically (bounded, not a test timeout)", async () => {
      const started = Date.now();
      let thrown: unknown;
      try {
        await buildApp({
          url: "redis://127.0.0.1:1",
          keyPrefix: "",
          mode: "required",
          max: 1,
          startupTimeoutMs: 300,
        });
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(RuntimeConfigError);
      expect((thrown as Error).message).toMatch(/required/);
      expect(Date.now() - started).toBeLessThan(3000);
    });
  });

  describe("runtime Redis loss and recovery (P7 §21/§22)", () => {
    it("optional: loss degrades to local limiting without crashing; recovery returns to shared", async () => {
      const fake = new FakeRedisServer();
      const port = await fake.start();
      const app = await buildApp({
        url: `redis://127.0.0.1:${port}`,
        keyPrefix: "",
        mode: "optional",
        max: 3,
        startupTimeoutMs: 2000,
      });
      try {
        await waitFor(() => app.redisRuntime.state === "ready");
        // Shared path: the fake Redis counter allows exactly 3.
        for (let i = 0; i < 3; i += 1) {
          const res = await app.inject({ method: "GET", url: "/limited" });
          expect(res.statusCode).toBe(200);
        }
        expect(
          (await app.inject({ method: "GET", url: "/limited" })).statusCode,
        ).toBe(429);

        // Outage: the API process must survive, state must change, and
        // requests must not hang.
        await fake.stop();
        await waitFor(() => app.redisRuntime.state === "degraded");
        expect(app.redisRuntime.degradedReason).toBe("connection_lost");

        // Local limiting is active: a fresh local counter allows exactly 3,
        // then blocks. Never "no limiting".
        for (let i = 0; i < 3; i += 1) {
          const res = await app.inject({ method: "GET", url: "/limited" });
          expect(res.statusCode).toBe(200);
        }
        const afterLossBlocked = await app.inject({
          method: "GET",
          url: "/limited",
        });
        expect(afterLossBlocked.statusCode).toBe(429);

        // Recovery: Redis returns → client reconnects → shared limiting is
        // back, and the shared counter continues where it left off.
        await fake.restore();
        await waitFor(() => app.redisRuntime.state === "ready");
        const afterRecovery = await app.inject({
          method: "GET",
          url: "/limited",
        });
        expect(afterRecovery.statusCode).toBe(429); // counter persisted at 4
      } finally {
        await app.close();
        await fake.stop();
      }
    }, 15_000);

    it("required: loss fails closed with RATE_LIMIT_UNAVAILABLE; recovery restores service", async () => {
      const fake = new FakeRedisServer();
      const port = await fake.start();
      const app = await buildApp({
        url: `redis://127.0.0.1:${port}`,
        keyPrefix: "",
        mode: "required",
        max: 3,
        startupTimeoutMs: 2000,
      });
      try {
        await waitFor(() => app.redisRuntime.state === "ready");
        const ok = await app.inject({ method: "GET", url: "/limited" });
        expect(ok.statusCode).toBe(200);

        await fake.stop();
        await waitFor(() => app.redisRuntime.state === "degraded");

        // Fail closed: a structured 503, never a Redis stack, never a silent
        // switch to local counters.
        const blocked = await app.inject({ method: "GET", url: "/limited" });
        expect(blocked.statusCode).toBe(503);
        expect(blocked.json()).toMatchObject({
          error: { code: RATE_LIMIT_UNAVAILABLE },
        });

        await fake.restore();
        await waitFor(() => app.redisRuntime.state === "ready");
        const recovered = await app.inject({ method: "GET", url: "/limited" });
        expect(recovered.statusCode).toBe(200);
      } finally {
        await app.close();
        await fake.stop();
      }
    }, 15_000);
  });
});
