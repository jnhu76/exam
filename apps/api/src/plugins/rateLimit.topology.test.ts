import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { setupErrorHandler } from "./errors.js";
import rateLimitPlugin from "./rateLimit.js";
import {
  loadRuntimeConfig,
  resolveTrustProxyOption,
} from "../config/runtimeConfig.js";

/**
 * #546 topology characterization: the limiter identity is `request.ip`, and
 * Fastify runs with `trustProxy` absent (socket-peer address). These tests
 * pin the as-built behavior per deployment topology at the HTTP-contract
 * level (MEASURED reproduction of production-audit F-08-1):
 *
 * - DIRECT_LAN: distinct source IPs get independent budgets (safe by design).
 * - SHARED_NAT: one shared IP collapses all candidates onto one limiter
 *   identity — login burst 429s past 10/min and steady-state work past the
 *   global 100/min budget.
 * - REVERSE_PROXY_WITHOUT_TRUSTED_CLIENT_IP: forwarded headers are ignored,
 *   every candidate shares the proxy socket IP (same collapse as NAT); a
 *   spoofed XFF can neither bypass nor shift the key.
 */

const LOGIN_MAX = 10;
const GLOBAL_MAX = 100;

/** Source IPs used per scenario so in-memory buckets never overlap. */
const IPS = {
  lanA: "203.0.113.11",
  lanB: "203.0.113.12",
  lanC: "203.0.113.13",
  natLogin: "198.51.100.7",
  natSteady: "198.51.100.8",
  proxy: "198.51.100.9",
  spoof: "198.51.100.10",
};

async function login(
  app: FastifyInstance,
  ip: string,
  forwardedFor?: string,
): Promise<number> {
  const res = await app.inject({
    method: "POST",
    url: "/login",
    remoteAddress: ip,
    ...(forwardedFor ? { headers: { "x-forwarded-for": forwardedFor } } : {}),
    payload: { username: "u", password: "wrong" },
  });
  return res.statusCode;
}

async function ping(app: FastifyInstance, ip: string): Promise<number> {
  const res = await app.inject({
    method: "GET",
    url: "/ping",
    remoteAddress: ip,
  });
  return res.statusCode;
}

describe("rate limit — deployment topology identity (#546)", () => {
  const app = Fastify();
  let reachedLogin = 0;
  let reachedPing = 0;

  beforeAll(async () => {
    setupErrorHandler(app);
    await app.register(rateLimitPlugin);
    app.post(
      "/login",
      { config: { rateLimit: { max: LOGIN_MAX, timeWindow: 60_000 } } },
      async (_request, reply) => {
        reachedLogin += 1;
        return reply.code(401).send({ error: { code: "AUTH_FAILED" } });
      },
    );
    // No route budget: exercises the global per-IP budget only.
    app.get("/ping", async () => {
      reachedPing += 1;
      return { ok: true };
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("DIRECT_LAN: per-candidate budgets are independent — exhausting one IP never blocks another", async () => {
    for (let i = 0; i < LOGIN_MAX; i += 1) {
      expect(await login(app, IPS.lanA)).toBe(401);
    }
    // lanA's login bucket is now exhausted; the other candidates are not.
    expect(await login(app, IPS.lanA)).toBe(429);
    expect(await login(app, IPS.lanB)).toBe(401);
    expect(await login(app, IPS.lanC)).toBe(401);
  });

  it("SHARED_NAT login burst: the 11th same-minute login from one shared IP is RATE_LIMITED", async () => {
    for (let i = 0; i < LOGIN_MAX; i += 1) {
      expect(await login(app, IPS.natLogin)).toBe(401);
    }
    const blocked = await login(app, IPS.natLogin);
    expect(blocked).toBe(429);
  });

  it("SHARED_NAT steady state: the global budget collapses ~15 users sharing one IP (101st request/min is RATE_LIMITED)", async () => {
    for (let i = 0; i < GLOBAL_MAX; i += 1) {
      expect(await ping(app, IPS.natSteady)).toBe(200);
    }
    const blocked = await ping(app, IPS.natSteady);
    expect(blocked).toBe(429);
    expect(reachedPing).toBe(GLOBAL_MAX);
  });

  it("REVERSE_PROXY_WITHOUT_TRUSTED_CLIENT_IP: candidates with distinct XFF headers collapse onto the proxy socket IP", async () => {
    // 11 candidates behind one proxy: each presents its own XFF client IP,
    // but the limiter keys on the socket peer (the proxy), so the 11th
    // login within the window is RATE_LIMITED regardless of XFF.
    for (let i = 0; i < LOGIN_MAX; i += 1) {
      expect(await login(app, IPS.proxy, `203.0.113.${20 + i}`)).toBe(401);
    }
    expect(await login(app, IPS.proxy, "203.0.113.31")).toBe(429);
  });

  it("SPOOFED XFF with no trusted-proxy wiring: the header is ignored — it can neither bypass the limit nor shift the key", async () => {
    // The attacker's claimed IP (9.9.9.9) is not consulted: the bucket is
    // keyed on the socket IP, so the spoofed header neither evades the
    // limiter nor steals another candidate's budget.
    for (let i = 0; i < LOGIN_MAX; i += 1) {
      expect(await login(app, IPS.spoof, "9.9.9.9")).toBe(401);
    }
    const blocked = await login(app, IPS.spoof, "9.9.9.9");
    expect(blocked).toBe(429);
    // The spoofed identity was never granted a separate bucket: total
    // handler reaches equal exactly the budget.
    expect(reachedLogin).toBe(4 * LOGIN_MAX + 2);
  });
});

describe("rate limit — trusted proxy topology (#546)", () => {
  const TRUSTED_PROXY_SOCKET = "10.1.1.5";
  const CLIENT_A = "203.0.113.50";
  const CLIENT_B = "203.0.113.51";
  const CLIENT_SPOOFER = "203.0.113.60";
  const SPOOFED = "9.9.9.9";
  const UNTRUSTED_PROXY = "203.0.113.99";

  // Mirrors the server.ts wiring: the option comes from the resolved config,
  // never hand-built in route code.
  const app = Fastify({
    trustProxy: resolveTrustProxyOption(
      loadRuntimeConfig({
        APP_MODE: "test",
        TEST_DATABASE_URL: "postgresql://t:t@h:5432/testdb",
        TRUSTED_PROXY_CIDRS: "10.0.0.0/8",
      }),
    ),
  });
  let reachedLogin = 0;

  beforeAll(async () => {
    setupErrorHandler(app);
    await app.register(rateLimitPlugin);
    app.post(
      "/login",
      { config: { rateLimit: { max: LOGIN_MAX, timeWindow: 60_000 } } },
      async (_request, reply) => {
        reachedLogin += 1;
        return reply.code(401).send({ error: { code: "AUTH_FAILED" } });
      },
    );
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("REVERSE_PROXY_WITH_TRUSTED_CLIENT_IP: candidates behind one trusted proxy get per-client budgets", async () => {
    for (let i = 0; i < LOGIN_MAX; i += 1) {
      expect(await login(app, TRUSTED_PROXY_SOCKET, CLIENT_A)).toBe(401);
    }
    // CLIENT_A exhausted; CLIENT_B behind the SAME proxy socket is untouched.
    expect(await login(app, TRUSTED_PROXY_SOCKET, CLIENT_A)).toBe(429);
    expect(await login(app, TRUSTED_PROXY_SOCKET, CLIENT_B)).toBe(401);
  });

  it("SPOOFED XFF behind a trusted proxy: the injected entry is skipped — no fresh bucket, no evasion", async () => {
    // The attacker sends "9.9.9.9"; the trusted proxy appends their real
    // address. The right-to-left walk must select the real client entry, so
    // the spoof lands in the spoofer's own bucket.
    for (let i = 0; i < LOGIN_MAX; i += 1) {
      expect(
        await login(app, TRUSTED_PROXY_SOCKET, `${SPOOFED}, ${CLIENT_SPOOFER}`),
      ).toBe(401);
    }
    expect(
      await login(app, TRUSTED_PROXY_SOCKET, `${SPOOFED}, ${CLIENT_SPOOFER}`),
    ).toBe(429);
    // Same bucket as a clean header for the spoofer's real address — the
    // spoofed entry did not fork the identity.
    expect(await login(app, TRUSTED_PROXY_SOCKET, CLIENT_SPOOFER)).toBe(429);
    expect(reachedLogin).toBe(2 * LOGIN_MAX + 1);
  });

  it("UNTRUSTED socket with CIDRs configured: headers stay ignored (DIRECT_LAN semantics preserved)", async () => {
    // Socket outside every configured CIDR: the XFF header must not
    // influence the key at all.
    for (let i = 0; i < LOGIN_MAX; i += 1) {
      expect(await login(app, UNTRUSTED_PROXY, SPOOFED)).toBe(401);
    }
    expect(await login(app, UNTRUSTED_PROXY, SPOOFED)).toBe(429);
    // A different untrusted socket is independent despite the same header.
    expect(await login(app, "203.0.113.100", SPOOFED)).toBe(401);
    expect(reachedLogin).toBe(3 * LOGIN_MAX + 2);
  });
});

describe("rate limit — over-broad trusted CIDR hazard (#546)", () => {
  // INVARIANT documented in the deployment runbook: trusted CIDRs must cover
  // ONLY the proxy→API link, never the candidate client network. proxy-addr's
  // walk skips EVERY address matching a trusted CIDR — including the genuine
  // client entry the proxy appended — so an over-broad CIDR lets a candidate
  // choose their limiter/audit identity. This pins that behavior so the
  // precondition stays executable knowledge instead of folklore.
  const app = Fastify({
    trustProxy: resolveTrustProxyOption(
      loadRuntimeConfig({
        APP_MODE: "test",
        TEST_DATABASE_URL: "postgresql://t:t@h:5432/testdb",
        TRUSTED_PROXY_CIDRS: "10.0.0.0/8",
      }),
    ),
  });

  beforeAll(async () => {
    setupErrorHandler(app);
    app.get("/whoami", async (request) => ({ ip: request.ip }));
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("a trusted CIDR covering the client network lets injected XFF entries win — the runbook precondition is load-bearing", async () => {
    // Candidates sit on 10.x; the proxy (also 10.x) appends their real
    // address after the injected one. Because 10/8 is trusted, the walk
    // skips the real client entry too and selects the injected one.
    const res = await app.inject({
      method: "GET",
      url: "/whoami",
      remoteAddress: "10.1.1.5",
      headers: { "x-forwarded-for": "9.9.9.9, 10.5.5.5" },
    });
    expect(res.json().ip).toBe("9.9.9.9");
  });
});
