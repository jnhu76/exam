import { describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import { Writable } from "node:stream";
import { organizations } from "@exam/db/schema/pg";
import heartbeatPlugin, {
  heartbeatMetrics,
} from "../../../apps/api/src/plugins/heartbeat.js";
import { getRuntimeConfig } from "../../../apps/api/src/config/runtimeConfig.js";

/** Smoke: proves the config, source resolution, fake timers and fake db work. */
describe("#885 harness smoke", () => {
  it("getRuntimeConfig resolves in test mode and a throwing tick still settles", async () => {
    const cfg = getRuntimeConfig();
    expect(cfg.heartbeat.scanIntervalMs).toBe(30_000);
    expect(cfg.heartbeat.deadlineScanIntervalMs).toBe(30_000);

    vi.useFakeTimers({ now: new Date("2026-09-17T08:00:00Z").getTime() });
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _enc, cb) {
        lines.push(chunk.toString());
        cb();
      },
    });
    const app = Fastify({ logger: { level: "info", stream } });
    const db = {
      select: () => ({
        from: (table: unknown) => {
          if (table === organizations) {
            throw new Error("forced org discovery failure");
          }
          throw new Error("unexpected table");
        },
      }),
      transaction: async () => undefined,
    };
    app.decorate<unknown>("db", db as never);
    app.decorate("now", () => new Date(Date.now()));
    heartbeatMetrics.startedAt = null;
    heartbeatMetrics.lastSettledAt = null;
    heartbeatMetrics.activeSince = null;

    await app.register(heartbeatPlugin);
    await app.ready();
    try {
      await vi.advanceTimersByTimeAsync(30_000);
      expect(heartbeatMetrics.lastSettledAt).not.toBeNull();
      expect(heartbeatMetrics.activeSince).toBeNull();
      const parsed = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
      expect(
        parsed.filter((l) => l.msg === "Error scanning for disrupted attempts"),
      ).toHaveLength(1);
      // pino `time` must be the fake-system-clock epoch (controlled clock).
      expect(typeof parsed[0]!.time).toBe("number");
    } finally {
      await app.close();
      vi.useRealTimers();
    }
  });
});
