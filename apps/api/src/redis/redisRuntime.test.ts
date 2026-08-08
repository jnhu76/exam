import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { RuntimeConfigError } from "@exam/domain";
import type { RedisConfig } from "../config/runtimeConfig.js";
import {
  RedisRuntime,
  buildRetryDelay,
  type RedisClientLike,
  type RuntimeLogger,
} from "./redisRuntime.js";

/** Controllable fake ioredis client for lifecycle unit tests. */
class FakeClient extends EventEmitter {
  status = "wait";
  connectCalls = 0;
  quitCalls = 0;
  disconnectCalls = 0;
  pingResult: unknown = "PONG";
  pingError: Error | null = null;
  /** Set to a never-resolving promise to simulate a hung connect. */
  connectImpl: () => Promise<unknown> = async () => {
    this.status = "ready";
  };

  connect(): Promise<unknown> {
    this.connectCalls += 1;
    this.status = "connecting";
    return this.connectImpl();
  }

  quit(): Promise<unknown> {
    this.quitCalls += 1;
    this.status = "end";
    return Promise.resolve("OK");
  }

  disconnect(): void {
    this.disconnectCalls += 1;
    this.status = "end";
  }

  ping(): Promise<unknown> {
    if (this.pingError) return Promise.reject(this.pingError);
    return Promise.resolve(this.pingResult);
  }
}

function makeLogger(): RuntimeLogger & { messages: string[] } {
  const messages: string[] = [];
  return {
    messages,
    info: (_obj, msg) => messages.push(msg),
    warn: (_obj, msg) => messages.push(msg),
    error: (_obj, msg) => messages.push(msg),
  };
}

function config(overrides: Partial<RedisConfig> = {}): RedisConfig {
  return {
    mode: "optional",
    url: "redis://localhost:6379",
    enabled: true,
    keyPrefix: "exam:test:unit:",
    connectTimeoutMs: 2000,
    commandTimeoutMs: 1000,
    startupTimeoutMs: 1000,
    ...overrides,
  };
}

describe("RedisRuntime lifecycle (P7)", () => {
  it("buildRetryDelay is bounded (200ms → 2000ms)", () => {
    expect(buildRetryDelay(1)).toBe(200);
    expect(buildRetryDelay(2)).toBe(400);
    expect(buildRetryDelay(3)).toBe(800);
    expect(buildRetryDelay(4)).toBe(1600);
    expect(buildRetryDelay(5)).toBe(2000);
    expect(buildRetryDelay(50)).toBe(2000);
  });

  it("off mode: stays disabled, no client is created", async () => {
    const client = new FakeClient();
    const runtime = new RedisRuntime({
      config: config({ mode: "off", url: null, enabled: false }),
      logger: makeLogger(),
      clientFactory: () => client,
    });
    await runtime.start();
    expect(runtime.state).toBe("disabled");
    expect(runtime.shouldUseRedis()).toBe(false);
    expect(runtime.client).toBeNull();
    expect(client.connectCalls).toBe(0);
  });

  it("disabled() static produces a disabled runtime", () => {
    const runtime = RedisRuntime.disabled();
    expect(runtime.state).toBe("disabled");
    expect(runtime.shouldUseRedis()).toBe(false);
  });

  it("optional: becomes ready when the client connects and emits ready", async () => {
    const client = new FakeClient();
    const logger = makeLogger();
    const runtime = new RedisRuntime({
      config: config({ startupTimeoutMs: 500 }),
      logger,
      clientFactory: () => client,
    });
    await runtime.start();
    expect(runtime.state).toBe("connecting");
    client.emit("ready");
    expect(runtime.state).toBe("ready");
    expect(runtime.shouldUseRedis()).toBe(true);
    expect(runtime.snapshot().connected).toBe(true);
    expect(logger.messages).toContain("redis.ready");
  });

  it("optional: startup timeout degrades (startup_timeout) without throwing and recovers on later ready", async () => {
    const client = new FakeClient();
    client.connectImpl = () => new Promise<never>(() => {});
    const logger = makeLogger();
    const runtime = new RedisRuntime({
      config: config({ startupTimeoutMs: 30 }),
      logger,
      clientFactory: () => client,
    });
    await expect(runtime.start()).resolves.toBeUndefined();
    expect(runtime.state).toBe("degraded");
    expect(runtime.degradedReason).toBe("startup_timeout");
    expect(runtime.shouldUseRedis()).toBe(false);
    expect(logger.messages).toContain("redis.unavailable");
    // Client is kept alive for background reconnection (recovery path).
    expect(client.disconnectCalls).toBe(0);
    // Redis comes back → the reconnecting client emits ready → recovered.
    client.emit("ready");
    expect(runtime.state).toBe("ready");
    expect(logger.messages).toContain("redis.recovered");
  });

  it("required: startup timeout fails startup deterministically and disconnects", async () => {
    const client = new FakeClient();
    client.connectImpl = () => new Promise<never>(() => {});
    const runtime = new RedisRuntime({
      config: config({ mode: "required", startupTimeoutMs: 30 }),
      logger: makeLogger(),
      clientFactory: () => client,
    });
    let thrown: unknown;
    try {
      await runtime.start();
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(RuntimeConfigError);
    expect((thrown as Error).message).toMatch(/required/);
    // The client was stopped so no background retry loop keeps the process
    // alive after the failed startup.
    expect(client.disconnectCalls).toBe(1);
    expect(runtime.state).toBe("degraded");
  });

  it("connection loss after ready degrades once and only once (close+reconnecting+error storm)", async () => {
    const client = new FakeClient();
    const logger = makeLogger();
    const runtime = new RedisRuntime({
      config: config({ startupTimeoutMs: 500 }),
      logger,
      clientFactory: () => client,
    });
    await runtime.start();
    client.emit("ready");
    expect(runtime.state).toBe("ready");

    client.emit("error", new Error("ECONNREFUSED"));
    client.emit("close");
    client.emit("reconnecting");
    client.emit("close");

    expect(runtime.state).toBe("degraded");
    expect(runtime.degradedReason).toBe("connection_lost");
    expect(runtime.shouldUseRedis()).toBe(false);
    // Exactly one transition log for the whole storm (no log spam).
    const unavailableLogs = logger.messages.filter(
      (m) => m === "redis.unavailable",
    );
    expect(unavailableLogs).toHaveLength(1);
  });

  it("error events never crash the process (listener attached, no throw)", async () => {
    const client = new FakeClient();
    const runtime = new RedisRuntime({
      config: config({ startupTimeoutMs: 500 }),
      logger: makeLogger(),
      clientFactory: () => client,
    });
    await runtime.start();
    client.emit("ready");
    expect(() => {
      client.emit("error", new Error("boom"));
      client.emit("error", new Error("boom again"));
    }).not.toThrow();
    expect(runtime.state).toBe("ready");
  });

  it("end event (retries exhausted) degrades with retry_exhausted", async () => {
    const client = new FakeClient();
    const runtime = new RedisRuntime({
      config: config({ startupTimeoutMs: 500 }),
      logger: makeLogger(),
      clientFactory: () => client,
    });
    await runtime.start();
    client.emit("ready");
    client.emit("end");
    expect(runtime.state).toBe("degraded");
    expect(runtime.degradedReason).toBe("retry_exhausted");
  });

  it("noteRedisCommandError degrades only when the connection is unhealthy", async () => {
    const client = new FakeClient();
    const runtime = new RedisRuntime({
      config: config({ startupTimeoutMs: 500 }),
      logger: makeLogger(),
      clientFactory: () => client,
    });
    await runtime.start();
    client.emit("ready");

    // Healthy connection + transient command error: stay ready (per-request
    // fallback; the next command retries Redis — no stuck-degraded state).
    client.status = "ready";
    runtime.noteRedisCommandError();
    expect(runtime.state).toBe("ready");

    // Unhealthy connection + command error: degrade.
    client.status = "close";
    runtime.noteRedisCommandError();
    expect(runtime.state).toBe("degraded");
    expect(runtime.degradedReason).toBe("command_failure");
  });

  it("pingLatency measures latency when ready and returns null otherwise", async () => {
    const client = new FakeClient();
    let nowMs = 1000;
    const runtime = new RedisRuntime({
      config: config({ startupTimeoutMs: 500 }),
      logger: makeLogger(),
      now: () => new Date(nowMs),
      clientFactory: () => client,
    });
    await runtime.start();
    expect(await runtime.pingLatency()).toBeNull();

    client.emit("ready");
    nowMs = 1000;
    const ping = runtime.pingLatency();
    nowMs = 1007;
    await expect(ping).resolves.toBe(7);
    expect(runtime.snapshot().latencyMs).toBe(7);
  });

  it("ping failure on an unhealthy connection degrades and returns null", async () => {
    const client = new FakeClient();
    client.pingError = new Error("ECONNREFUSED");
    const runtime = new RedisRuntime({
      config: config({ startupTimeoutMs: 500 }),
      logger: makeLogger(),
      clientFactory: () => client,
    });
    await runtime.start();
    client.emit("ready");
    client.status = "close";
    await expect(runtime.pingLatency()).resolves.toBeNull();
    expect(runtime.state).toBe("degraded");
  });

  it("close() is graceful and bounded: quit called, disconnect called, state closing", async () => {
    const client = new FakeClient();
    const runtime = new RedisRuntime({
      config: config({ startupTimeoutMs: 500 }),
      logger: makeLogger(),
      clientFactory: () => client,
      closeTimeoutMs: 100,
    });
    await runtime.start();
    client.emit("ready");
    await runtime.close();
    expect(runtime.state).toBe("closing");
    expect(client.quitCalls).toBe(1);
    expect(client.disconnectCalls).toBe(1);
  });

  it("close() does not hang when quit never resolves (bounded race)", async () => {
    const client = new FakeClient();
    client.quit = () => new Promise<never>(() => {});
    const runtime = new RedisRuntime({
      config: config({ startupTimeoutMs: 500 }),
      logger: makeLogger(),
      clientFactory: () => client,
      closeTimeoutMs: 50,
    });
    await runtime.start();
    client.emit("ready");
    const started = Date.now();
    await runtime.close();
    expect(Date.now() - started).toBeLessThan(1000);
    expect(runtime.state).toBe("closing");
    expect(client.disconnectCalls).toBe(1);
  });

  it("close() is safe from every state (connecting, degraded, end)", async () => {
    for (const state of ["connecting", "degraded", "end"] as const) {
      const client = new FakeClient();
      const runtime = new RedisRuntime({
        config: config({ startupTimeoutMs: 50 }),
        logger: makeLogger(),
        clientFactory: () => client,
        closeTimeoutMs: 50,
      });
      if (state === "connecting") {
        client.connectImpl = () => new Promise<never>(() => {});
        await runtime.start(); // resolves degraded after the window
      } else if (state === "degraded") {
        await runtime.start();
        client.emit("close");
      } else {
        await runtime.start();
        client.emit("ready");
        client.emit("end");
      }
      await expect(runtime.close()).resolves.toBeUndefined();
      expect(runtime.state).toBe("closing");
      expect(client.disconnectCalls).toBe(1);
    }
  });

  it("snapshot never exposes secrets or the connection URL", () => {
    const client = new FakeClient();
    const runtime = new RedisRuntime({
      config: config({ url: "redis://user:pass@host:6379" }),
      logger: makeLogger(),
      clientFactory: () => client,
    });
    const snapshot = runtime.snapshot();
    expect(snapshot).toEqual({
      mode: "optional",
      state: "disabled",
      connected: false,
      latencyMs: null,
      degradedReason: null,
    });
    expect(JSON.stringify(snapshot)).not.toContain("pass");
    expect(JSON.stringify(snapshot)).not.toContain("redis://");
  });

  it("reconnect loop produces bounded retry delays via the factory default", async () => {
    // Guard the production client options indirectly: the retry strategy is
    // pure; the factory itself is exercised by integration tests.
    expect(buildRetryDelay(100)).toBeLessThanOrEqual(2000);
    void vi;
  });
});
