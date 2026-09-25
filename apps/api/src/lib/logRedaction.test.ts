import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { SENSITIVE_LOG_PATHS, REDACT_CONFIG } from "./logRedaction.js";

/**
 * Builds a payload with one marker value at every declared sensitive path
 * (dot-paths become nesting), plus a control field that must survive.
 */
function payloadWithMarkers(paths: readonly string[]): {
  payload: Record<string, unknown>;
  markers: Map<string, string>;
  control: { key: string; value: string };
} {
  const control = { key: "requestId", value: "control-not-sensitive" };
  const markers = new Map<string, string>();
  const payload: Record<string, unknown> = { [control.key]: control.value };
  paths.forEach((path, i) => {
    const marker = `SECRET-${i}`;
    markers.set(path, marker);
    const parts = path.split(".");
    let node = payload;
    for (const part of parts.slice(0, -1)) {
      if (typeof node[part] !== "object" || node[part] === null) {
        node[part] = {};
      }
      node = node[part] as Record<string, unknown>;
    }
    node[parts[parts.length - 1]!] = marker;
  });
  return { payload, markers, control };
}

/** Same logger wiring shape as server.ts, with output captured in memory. */
async function withCapturingLogger(
  fn: (app: FastifyInstance, lines: string[]) => Promise<void>,
): Promise<string[]> {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });
  const app = Fastify({
    logger: { level: "info", redact: REDACT_CONFIG, stream },
  });
  try {
    await fn(app, lines);
  } finally {
    await app.close();
  }
  return lines;
}

describe("logRedaction", () => {
  // Vacuity canaries: the behavioral test below is data-driven from
  // SENSITIVE_LOG_PATHS, so an emptied list would pass silently without these.
  it("inventory still covers the critical field families", () => {
    expect(SENSITIVE_LOG_PATHS).toContain("password");
    expect(SENSITIVE_LOG_PATHS).toContain("passwordHash");
    expect(SENSITIVE_LOG_PATHS).toContain("token");
    expect(SENSITIVE_LOG_PATHS).toContain("authorization");
    expect(SENSITIVE_LOG_PATHS).toContain("req.headers.cookie");
    expect(SENSITIVE_LOG_PATHS).toContain("standardAnswer");
  });

  it("has no duplicate paths", () => {
    const unique = new Set(SENSITIVE_LOG_PATHS);
    expect(unique.size).toBe(SENSITIVE_LOG_PATHS.length);
  });

  it("pino removes every declared sensitive path from real log output", async () => {
    const { payload, markers, control } =
      payloadWithMarkers(SENSITIVE_LOG_PATHS);

    const lines = await withCapturingLogger(async (app, captured) => {
      app.get("/log-payload", async () => {
        app.log.info(payload);
        return { ok: true };
      });
      await app.ready();
      const res = await app.inject({ method: "GET", url: "/log-payload" });
      expect(res.statusCode).toBe(200);
      void captured;
    });

    const logged = lines.find((line) => line.includes(control.value));
    expect(logged, "payload log line captured").toBeDefined();

    // Behavioral core: every marker value is gone from the serialized output.
    for (const [path, marker] of markers) {
      expect(logged, `redacted: ${path}`).not.toContain(marker);
    }
    // The non-sensitive control field survives, proving the line was emitted.
    expect(logged).toContain(control.value);
  });
});
