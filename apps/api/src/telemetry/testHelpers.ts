import { Writable } from "node:stream";
import type { FastifyPluginCallback } from "fastify";

/**
 * Shared harness for the telemetry runtime tests (excluded from the
 * production build). Every helper dynamically imports fastify so the
 * module-load-order contract (init before Fastify construction) stays
 * exercisable from the test files.
 */

/** Synthetic marker that must never reach span attributes. */
export const MARKER = "W12-SYNTHETIC-MARKER";

export const CLIENT_TRACE_ID = "33333333333333333333333333333333";
export const CLIENT_SPAN_ID = "4444444444444444";
export const CLIENT_TRACEPARENT = `00-${CLIENT_TRACE_ID}-${CLIENT_SPAN_ID}-01`;

export interface Harness {
  logLines: string[];
  app: {
    listen: (opts: { port: number; host: string }) => Promise<void>;
    close: () => Promise<void>;
    server: { address: () => { port: number } | null };
  };
}

export async function buildApp(
  plugin: FastifyPluginCallback,
): Promise<Harness> {
  const { default: Fastify } = await import("fastify");
  const { randomUUID } = await import("node:crypto");
  const logLines: string[] = [];
  const stream = new Writable({
    write(chunk: unknown, _enc, cb) {
      logLines.push(String(chunk));
      cb();
    },
  });
  const app = Fastify({
    genReqId: () => randomUUID(),
    requestIdHeader: false,
    logger: { level: "info", stream },
  });
  // Mirror of the real entry's root-scope x-request-id hook (ADR-025/#865)
  // — added BEFORE the telemetry plugin, same as server.ts.
  app.addHook("onRequest", (request, reply, done) => {
    reply.header("x-request-id", request.id);
    done();
  });
  // The registration-order contract under test: the plugin is registered
  // BEFORE any route definition (late registration drops handler spans).
  await app.register(plugin);
  app.get("/w12/ordinary", async () => ({ ok: true }));
  app.get("/w12/boom", async () => {
    throw new Error("synthetic-boom");
  });
  return { logLines, app: app as unknown as Harness["app"] };
}

export async function withServer<T>(
  harness: Harness,
  run: (base: string) => Promise<T>,
): Promise<T> {
  await harness.app.listen({ port: 0, host: "127.0.0.1" });
  const address = harness.app.server.address();
  if (!address || typeof address === "string") {
    throw new Error("server address not available");
  }
  try {
    return await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await harness.app.close();
  }
}

export function parseLogLines(
  harness: Harness,
): Array<Record<string, unknown>> {
  return harness.logLines
    .map((line) => line.split("\n"))
    .flat()
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter(Boolean);
}
