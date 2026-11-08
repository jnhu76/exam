/**
 * #865 (865-C) X-Request-Id wire contract — the server-owned response
 * header, on the real wire (ephemeral listener, production plugin
 * composition: the fp root-scope cors plugin from plugins/cors.ts + the
 * requestId header + the /api surface).
 *
 * Ownership under test: ONE root-scope onRequest hook stamps
 * `x-request-id: request.id` (ADR-025 UUIDv4, `requestIdHeader:false`)
 * onto every Fastify-managed response — success, business rejection,
 * validation error, unmatched route. The same value must equal the pino
 * `reqId` of that request's log lines and the error envelope's
 * `error.requestId` when an envelope exists. Client headers (x-request-id /
 * request-id / traceparent) never influence the value. Auth-gated status
 * paths (401/403/409/500 with real fixtures) are covered by
 * requestIdStatusMatrix.test.ts.
 *
 * Requests that can NEVER carry the header (documented boundary, not
 * covered here): responses never sent (connection destroyed mid-request,
 * socket-level HTTP framing failures, Node-level request/keepAlive
 * timeouts) — Fastify never reaches the reply for those.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Writable } from "node:stream";
import Fastify, { type FastifyInstance } from "fastify";
import corsPlugin from "../plugins/cors.js";
import {
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import { decorateApiRouteStubs } from "../openapi/swagger.js";
import { resetRuntimeConfigForTest } from "../config/runtimeConfig.js";
import { setupRequestIdHeader } from "../plugins/requestIdHeader.js";
import { setupErrorHandler } from "../plugins/errors.js";
import apiSurfacePlugin from "./apiSurface.js";

const CONFIGURED_ORIGIN = "http://web.example.test";
const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Captures pino JSON lines for reqId correlation assertions. */
class LogCapture extends Writable {
  readonly lines: string[] = [];
  override _write(
    chunk: Buffer,
    _enc: BufferEncoding,
    done: (err?: Error | null) => void,
  ) {
    this.lines.push(chunk.toString("utf8"));
    done();
  }
  /** Parsed log lines whose reqId equals the given value. */
  forRequest(reqId: string): Array<Record<string, unknown>> {
    return this.lines
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .filter((o) => o.reqId === reqId);
  }
}

let app: FastifyInstance;
let baseUrl: string;
let logs: LogCapture;

beforeAll(async () => {
  process.env.RATE_LIMIT_DISABLED = "true";
  // Feed the production cors plugin through runtime config (CORS_ORIGIN is
  // the env owner of the origin) so this suite exercises the real wiring —
  // including the fp root-scope registration — not a hand-rolled duplicate.
  process.env.CORS_ORIGIN = CONFIGURED_ORIGIN;
  resetRuntimeConfigForTest();

  logs = new LogCapture();
  app = Fastify({
    logger: { level: "info", stream: logs },
    genReqId: () => crypto.randomUUID(),
    requestIdHeader: false,
  });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  decorateApiRouteStubs(app);
  setupRequestIdHeader(app);
  // Unified error handler so business/validation rejections carry the
  // canonical envelope (error.requestId) the envelope-equality cases assert.
  // The auth-error 401 path needs the auth+DB stack and lives in
  // requestIdStatusMatrix.test.ts instead.
  setupErrorHandler(app);
  await app.register(corsPlugin);
  await app.register(apiSurfacePlugin, { prefix: "/api" });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.addresses()[0];
  if (!address) throw new Error("server did not report a listen address");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await app.close();
});

describe("X-Request-Id response header wire contract (#865)", () => {
  it("200 success carries a fresh UUIDv4 equal to the pino reqId of that request", async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);
    const header = res.headers.get("x-request-id");
    expect(header).toMatch(UUID_V4);
    // The pino request/response lines for this exact request carry the SAME
    // id — the header locates the server log lines.
    await waitForLogFlush();
    const lines = logs.forRequest(header!);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(
      lines.some((l) => (l.res as { statusCode?: number })?.statusCode === 200),
    ).toBe(true);
  });

  it("200 responses are the ONLY place the id appears — two requests never share an id", async () => {
    const [a, b] = await Promise.all([
      fetch(`${baseUrl}/api/health`),
      fetch(`${baseUrl}/api/health`),
    ]);
    const idA = a.headers.get("x-request-id");
    const idB = b.headers.get("x-request-id");
    expect(idA).toMatch(UUID_V4);
    expect(idB).toMatch(UUID_V4);
    expect(idA).not.toBe(idB);
  });

  it("400 validation error: header == error envelope requestId == pino reqId", async () => {
    const res = await fetch(`${baseUrl}/api/client-events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ events: [{ kind: "not-a-kind" }] }),
    });
    expect(res.status).toBe(400);
    const header = res.headers.get("x-request-id");
    expect(header).toMatch(UUID_V4);
    const body = (await res.json()) as { error?: { requestId?: string } };
    expect(body.error?.requestId).toBe(header);
    expect(logs.forRequest(header!).length).toBeGreaterThan(0);
  });

  it("404 unmatched /api route (canonical JSON boundary): header present", async () => {
    const res = await fetch(`${baseUrl}/api/no-such-route`);
    expect(res.status).toBe(404);
    const header = res.headers.get("x-request-id");
    expect(header).toMatch(UUID_V4);
    const body = (await res.json()) as { error?: { requestId?: string } };
    expect(body.error?.requestId).toBe(header);
  });

  it("HEAD (auto-exposed) carries the header with no body", async () => {
    const res = await fetch(`${baseUrl}/api/health`, { method: "HEAD" });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-request-id")).toMatch(UUID_V4);
  });

  it("client-forged x-request-id / request-id / traceparent never influence the value", async () => {
    const FORGED = "00000000-dead-beef-0000-000000000000";
    const res = await fetch(`${baseUrl}/api/health`, {
      headers: {
        "x-request-id": FORGED,
        "request-id": FORGED,
        traceparent: `00-${FORGED}${FORGED}-01`,
      },
    });
    expect(res.status).toBe(200);
    const header = res.headers.get("x-request-id");
    expect(header).toMatch(UUID_V4);
    expect(header).not.toBe(FORGED);
    // The server-side log lines use the server-minted id; the forged value
    // appears nowhere server-side.
    expect(logs.forRequest(header!).length).toBeGreaterThan(0);
    expect(logs.lines.some((l) => l.includes(FORGED))).toBe(false);
  });

  it("CORS: the header is exposed to cross-origin browser JS without broadening origin reflection", async () => {
    const allowed = await fetch(`${baseUrl}/api/health`, {
      headers: { origin: CONFIGURED_ORIGIN },
    });
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get("access-control-allow-origin")).toBe(
      CONFIGURED_ORIGIN,
    );
    const exposed = (allowed.headers.get("access-control-expose-headers") ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase());
    expect(exposed).toContain("x-request-id");

    // No broadening: a disallowed origin is never REFLECTED — with the
    // production single-string origin shape, ACAO stays the fixed configured
    // value (optionsCorsWireContract.test.ts pins that shape), which an
    // attacker-origin page cannot use because its origin does not match.
    const denied = await fetch(`${baseUrl}/api/health`, {
      headers: { origin: "http://attacker.example.test" },
    });
    expect(denied.status).toBe(200);
    const deniedAcao = denied.headers.get("access-control-allow-origin");
    expect(deniedAcao).not.toContain("attacker.example.test");
  });
});

/** Lets pino flush the response line before the assertion reads the stream. */
async function waitForLogFlush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 25));
}
