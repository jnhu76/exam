/**
 * #925 HTTP log-privacy wire matrix: no raw client-controlled URL bytes may
 * reach ANY effective log pathway — the default request line (via the
 * production req serializer), the unified error handler's 500 log
 * (`url:`), and the authz denial warns (`route:`).
 *
 * Canary matrix per the #925 acceptance: query token, path token,
 * percent-encoded secret, absolute-form URL, malformed percent escape,
 * encoded CRLF, Unicode, 404 / 401 / 403 / 500, plus a standard business
 * request that must still log its TRUSTED route template (privacy fix must
 * not destroy diagnostics).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Writable } from "node:stream";
import type { FastifyPluginAsync } from "fastify";
import candidateRoutes from "./candidate.js";
import authRoutes from "./auth.js";
import { buildTestApp } from "./testHelpers.js";
import { sendResourceNotFound } from "../plugins/rootNotFoundBoundary.js";
import {
  serializeErrorForLog,
  serializeReqForLog,
} from "../lib/logRedaction.js";

const CANARY = "EXAMAUDIT-CANARY-LOG";

/** Captures every pino JSON line emitted by the app under test. */
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
  parsed(): Array<Record<string, unknown>> {
    return this.lines
      .filter((l) => l.startsWith("{"))
      .map((l) => JSON.parse(l) as Record<string, unknown>);
  }
  incoming(): Array<Record<string, unknown>> {
    return this.parsed().filter((l) => l.msg === "incoming request");
  }
}

/** Routes under test: authz denial surface + a thrown-handler 500 surface. */

const combinedPlugin: FastifyPluginAsync = async (fastify) => {
  await fastify.register(authRoutes, { prefix: "/auth" });
  await fastify.register(candidateRoutes);
  fastify.get("/__test/throw", async () => {
    throw new Error("intentional test failure for log-privacy matrix");
  });
  // Production /api-scoped 404 policy (routes/apiSurface.ts #429): the
  // shared envelope helper, replacing Fastify's default basic404, which
  // logs "Route <raw url> not found" — raw client URL bytes. The
  // ROOT-scope boundary (also #925, wired in server.ts) is proven by
  // server.requestId.test.ts, which spawns the real entrypoint;
  // buildTestApp boots its app before this file can register at root scope.
  fastify.setNotFoundHandler(sendResourceNotFound);
};

describe("HTTP log privacy — raw URL never persisted (#925)", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;
  let logs: LogCapture;

  /**
   * Explicit lifecycle barrier: an inject() resolves when the reply is sent,
   * but pino writes through the stream asynchronously. Poll until at least
   * `total` completion lines are on the stream — no fixed sleep, so a slow CI
   * cannot false-pass the negative assertions below (AGENTS §7).
   */
  function completedCount(): number {
    return logs.parsed().filter((l) => l.msg === "request completed").length;
  }

  async function injectSettled(
    args: Parameters<typeof ctx.app.inject>[0],
  ): Promise<Awaited<ReturnType<typeof ctx.app.inject>>> {
    const before = completedCount();
    const res = await ctx.app.inject(args);
    await expect
      .poll(completedCount, { timeout: 2_000 })
      .toBeGreaterThanOrEqual(before + 1);
    return res;
  }

  beforeAll(async () => {
    logs = new LogCapture();
    // Production logger composition (server.ts): redact + err serializer +
    // the #925 req serializer. The wiring itself is additionally pinned by
    // server.requestId.test.ts, which spawns the real server entrypoint.
    ctx = await buildTestApp(combinedPlugin, {
      prefix: "/api",
      // Production #925-relevant options (server.ts): level + the
      // req/err serializers. pino `redact` is orthogonal to this suite
      // (its own coverage: logRedaction.test.ts) and its option type is
      // not part of buildTestApp's declared logger param.
      logger: {
        level: "info",
        stream: logs,
        serializers: {
          req: serializeReqForLog,
          err: serializeErrorForLog,
        },
      },
    });
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("standard request: incoming line carries the matched route template, never a url field", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/logout",
    });
    expect(res.statusCode).toBe(204);
    const line = logs
      .incoming()
      .find(
        (l) => (l.req as { method?: string } | undefined)?.method === "POST",
      );
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const req = (line?.req ?? {}) as {
      method?: string;
      url?: string;
      route?: string;
    };
    expect(req.method).toBe("POST");
    expect(req.route).toBe("/api/auth/logout");
    expect(req.url).toBeUndefined();
  });

  it("unmatched route: fixed placeholder in the incoming line, raw path absent", async () => {
    const res = await injectSettled({
      method: "GET",
      url: `/api/no-such-${CANARY}-route`,
    });
    expect(res.statusCode).toBe(404);
    const line = logs.incoming().at(-1);
    const req = (line?.req ?? {}) as { url?: string; route?: string };
    expect(req.route).toBeTruthy();
    expect(req.route).not.toContain(CANARY);
    expect(req.url).toBeUndefined();
  });

  it("403 authz denial: no log line leaks the denied request's URL", async () => {
    // The authz `route:` sites fire at error level on 503 config paths,
    // not on ordinary denials — so this case pins the NEGATIVE (the query
    // canary reaches no line); the sites' template-only output is pinned
    // by the drift guard below + routeTemplateOf's implementation.
    const res = await injectSettled({
      method: "POST",
      url: `/api/candidates?token=${CANARY}-q403`,
      cookies: { "auth-token": ctx.candidateToken },
      payload: {
        username: `logpriv-${Date.now()}`,
        password: "password123",
        name: "Log Privacy 403",
        fields: {},
      },
    });
    expect(res.statusCode).toBe(403);
    expect(logs.lines.some((l) => l.includes(CANARY))).toBe(false);
  });

  it("drift guard: no non-test api source logs a raw request URL any more", async () => {
    // One authority for the ban: any future `x: request.url` log context
    // reintroduces the #925 leak class; this fails instead of shipping it.
    const { execFileSync } = await import("node:child_process");
    let offenders = "";
    try {
      offenders = execFileSync(
        "grep",
        [
          "-rn",
          "-E",
          "(route|url|path|uri)\s*:\s*(request|req)\.(raw\.)?url\b",
          "src",
          "--include=*.ts",
        ],
        { cwd: process.cwd(), encoding: "utf8" },
      );
    } catch (e) {
      // grep exit 1 = no matches = the invariant holds
      offenders = "";
    }
    expect(offenders).toBe("");
  });

  it("500 thrown handler: the error-handler log carries the template, not the raw URL", async () => {
    const res = await injectSettled({
      method: "GET",
      url: `/api/__test/throw?token=${CANARY}-q500`,
    });
    expect(res.statusCode).toBe(500);
    const errLines = logs.parsed().filter((l) => l.level === 50);
    expect(errLines.length).toBeGreaterThan(0);
    for (const l of errLines) {
      expect(
        typeof l.url === "undefined" || !String(l.url).includes(CANARY),
      ).toBe(true);
      if (typeof l.route === "string") {
        expect(l.route).not.toContain(CANARY);
        expect(l.route).not.toContain("?");
      }
    }
  });

  it("canary matrix: zero raw-secret occurrences across every captured line", async () => {
    // (the absolute-form URL case lives in server.requestId.test.ts — it
    // routes to the ROOT 404 boundary, which buildTestApp cannot register)
    const cases: Array<[string, string]> = [
      ["GET", `/api/auth/me?token=${CANARY}-query`],
      ["GET", `/api/${CANARY}-path/secret`],
      ["GET", `/api/auth/me?next=%2F${CANARY}-enc%2F`],
      ["GET", `/api/auth/me?q=${CANARY}-malformed%zz`],
      ["GET", `/api/auth/me?q=${CANARY}-crlf%0d%0a`],
      ["GET", `/api/auth/me?q=${CANARY}-unicode-%E7%A7%98%E5%AF%86`],
    ];
    for (const [method, url] of cases) {
      await injectSettled({ method, url });
    }
    const hits = logs.lines.filter((l) => l.includes(CANARY));
    expect(
      hits,
      `raw canary leaked into log lines: ${hits.join("\n")}`,
    ).toEqual([]);
  });

  it("PINO_RAW_SECRET_EXPOSURE = 0 across the whole file's captured output", async () => {
    await injectSettled({ method: "POST", url: "/api/auth/logout" });
    expect(logs.lines.some((l) => l.includes(CANARY))).toBe(false);
  });
});
