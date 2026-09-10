/**
 * #451 OPTIONS/CORS wire contract — the frozen matrix from
 * docs/contracts/api-contract.md §"OPTIONS / CORS wire contract".
 *
 * Ownership under test: @fastify/cors answers every OPTIONS request from its
 * onRequest hook BEFORE routing. Neither the /api route set, the /api
 * unmatched-request policy (#429), nor any surface identity participates —
 * the contract is server-global. The composition below is the production
 * registration (root-scope cors plugin + the one /api scope), with the
 * single-string origin shape production uses (`CORS_ORIGIN` resolves to a
 * string unless a comma-list is configured).
 *
 * Frozen decision (#451): the bare-OPTIONS `400 text/plain
 * "Invalid Preflight Request"` is the plugin's strictPreflight protocol
 * rejection, INTENTIONAL and outside the error-envelope contract — it is not
 * a standardized API error (no ErrorCode, no error pipeline, no requestId).
 * These tests pin that behavior so any future drift (envelope leakage,
 * 204-forcing, strictPreflight relaxation) turns red, and they pin the
 * no-broadening invariants (disallowed origins are never reflected,
 * disallowed methods never appear in Allow-Methods).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import corsPlugin from "@fastify/cors";
import {
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import { decorateApiRouteStubs } from "../openapi/swagger.js";
import { resetRuntimeConfigForTest } from "../config/runtimeConfig.js";
import apiSurfacePlugin from "./apiSurface.js";

// Fixture stand-in for the real configured origin (production config shape:
// a single string). Probes measure the wire contract, not origin values.
const CONFIGURED_ORIGIN = "http://web.example.test";

let app: FastifyInstance;
let baseUrl: string;

beforeAll(async () => {
  process.env.RATE_LIMIT_DISABLED = "true";
  resetRuntimeConfigForTest();

  app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  decorateApiRouteStubs(app);
  // Same registration mechanics as server.ts (plugins/cors.ts): root scope,
  // plugin defaults for methods/headers/strictPreflight, credentials on.
  await app.register(corsPlugin, {
    origin: CONFIGURED_ORIGIN,
    credentials: true,
  });
  await app.register(apiSurfacePlugin, { prefix: "/api" });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.addresses()[0];
  if (!address) throw new Error("server did not report a listen address");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await app.close();
});

function options(path: string, headers?: Record<string, string>) {
  return fetch(`${baseUrl}${path}`, {
    method: "OPTIONS",
    ...(headers ? { headers } : {}),
  });
}

describe("#451 OPTIONS/CORS wire contract", () => {
  describe("bare OPTIONS — strictPreflight protocol rejection (intentional)", () => {
    it("answers 400 text/plain 'Invalid Preflight Request' on registered, unknown, and non-/api paths alike", async () => {
      for (const path of [
        "/api/health",
        "/api/__451_unknown__",
        "/", // ownership control: the rejection is server-global, not /api policy
      ]) {
        const res = await options(path);
        const label = `OPTIONS ${path}`;
        expect(res.status, label).toBe(400);
        expect(res.headers.get("content-type"), label).toContain("text/plain");
        expect(await res.text(), label).toBe("Invalid Preflight Request");
      }
    });

    it("never emits the canonical envelope, an Allow header, or an ErrorCode on the rejection", async () => {
      const res = await options("/api/health");
      expect(res.headers.get("content-type")).not.toContain("application/json");
      expect(res.headers.get("allow")).toBeNull();
      const body = await res.text();
      // Envelope-exception invariant: the body is the plugin's protocol
      // message, not a buildErrorResponse payload (no error.code/requestId).
      expect(body).not.toContain("requestId");
      expect(() => JSON.parse(body)).toThrow();
    });

    it("rejects Origin-without-Access-Control-Request-Method — the other half of the strictPreflight disjunction", async () => {
      const res = await options("/api/health", {
        Origin: CONFIGURED_ORIGIN,
      });
      expect(res.status).toBe(400);
      expect(res.headers.get("content-type")).toContain("text/plain");
      expect(await res.text()).toBe("Invalid Preflight Request");
    });
  });

  describe("valid preflight — plugin defaults with the configured origin", () => {
    it("answers 204 with Allow-Origin pinned to the configured origin, Allow-Credentials, and the default method set", async () => {
      const res = await options("/api/health", {
        Origin: CONFIGURED_ORIGIN,
        "Access-Control-Request-Method": "GET",
      });
      expect(res.status).toBe(204);
      expect(res.headers.get("access-control-allow-origin")).toBe(
        CONFIGURED_ORIGIN,
      );
      expect(res.headers.get("access-control-allow-credentials")).toBe("true");
      expect(res.headers.get("access-control-allow-methods")).toBe(
        "GET,HEAD,POST",
      );
    });

    it("reflects Access-Control-Request-Headers into Allow-Headers (allowedHeaders: null default)", async () => {
      const res = await options("/api/auth/login", {
        Origin: CONFIGURED_ORIGIN,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type",
      });
      expect(res.status).toBe(204);
      expect(res.headers.get("access-control-allow-headers")).toContain(
        "content-type",
      );
    });
  });

  describe("disallowed preflight attributes — deterministic, browser-enforced, no broadening", () => {
    it("never reflects a disallowed origin: Allow-Origin stays the configured origin", async () => {
      const res = await options("/api/health", {
        Origin: "http://evil.example",
        "Access-Control-Request-Method": "GET",
      });
      expect(res.status).toBe(204);
      expect(res.headers.get("access-control-allow-origin")).toBe(
        CONFIGURED_ORIGIN,
      );
      expect(res.headers.get("access-control-allow-origin")).not.toContain(
        "evil.example",
      );
    });

    it("never lists a disallowed method in Allow-Methods", async () => {
      const res = await options("/api/health", {
        Origin: CONFIGURED_ORIGIN,
        "Access-Control-Request-Method": "DELETE",
      });
      expect(res.status).toBe(204);
      const methods = res.headers.get("access-control-allow-methods") ?? "";
      expect(methods).toBe("GET,HEAD,POST");
      expect(methods).not.toContain("DELETE");
    });
  });

  describe("the /api unmatched policy (#429) never owns OPTIONS", () => {
    it("unknown /api path: bare OPTIONS stays the protocol rejection, valid preflight stays 204 — never the 404 envelope", async () => {
      const bare = await options("/api/__451_unknown__");
      expect(bare.status).toBe(400);
      expect(await bare.text()).toBe("Invalid Preflight Request");

      const valid = await options("/api/__451_unknown__", {
        Origin: CONFIGURED_ORIGIN,
        "Access-Control-Request-Method": "GET",
      });
      expect(valid.status).toBe(204);
      expect(valid.headers.get("access-control-allow-origin")).toBe(
        CONFIGURED_ORIGIN,
      );
    });
  });
});
