import type { FastifyInstance, FastifyRequest } from "fastify";
import { buildErrorResponse } from "../lib/errorResponse.js";
import { getRuntimeConfig } from "../config/runtimeConfig.js";

/**
 * HTTP methods that are considered safe (read-only) and are exempt from
 * CSRF origin enforcement. Only state-changing methods require origin checks.
 */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Normalizes the CORS origin configuration (string or string array) into a
 * trimmed, non-empty string array suitable for origin-matching checks.
 */
function deriveAllowedOrigins(corsOrigin: string | string[]): string[] {
  if (Array.isArray(corsOrigin)) {
    return corsOrigin.map((s) => s.trim()).filter(Boolean);
  }
  if (typeof corsOrigin === "string" && corsOrigin.length > 0) {
    return [corsOrigin.trim()].filter(Boolean);
  }
  return [];
}

/**
 * Extracts the origin of a request by reading the `Origin` header first,
 * falling back to parsing the `Referer` header. Returns `null` if neither
 * header is present or parseable.
 */
function originOf(request: FastifyRequest): string | null {
  const origin = request.headers["origin"];
  if (typeof origin === "string" && origin.length > 0) {
    return origin;
  }
  const referer = request.headers["referer"];
  if (typeof referer === "string" && referer.length > 0) {
    try {
      const parsed = new URL(referer);
      return `${parsed.protocol}//${parsed.host}`;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Builds a Content-Security-Policy header string. In production mode inline
 * scripts are disabled; in development `'unsafe-inline'` is allowed for
 * convenience. Adds `upgrade-insecure-requests` when secure cookies are
 * enabled.
 */
function buildCsp(isProduction: boolean, cookieSecure: boolean): string {
  const baseDirectives = [
    "default-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "form-action 'self'",
  ];
  const scriptSrc = isProduction
    ? "script-src 'self'"
    : "script-src 'self' 'unsafe-inline'";
  // style-src keeps 'unsafe-inline' because shadcn/ui + cmdk emit inline style
  // attributes at runtime; revisit in Phase2 when we audit runtime style usage.
  const styleSrc = "style-src 'self' 'unsafe-inline'";
  const directives = [...baseDirectives, scriptSrc, styleSrc];
  if (cookieSecure) {
    directives.push("upgrade-insecure-requests");
  }
  return directives.join("; ");
}

/**
 * Builds a Permissions-Policy header that disables browser features
 * not needed by the exam platform (camera, microphone, geolocation, etc.).
 */
function buildPermissionsPolicy(): string {
  const disabled = [
    "accelerometer",
    "autoplay",
    "camera",
    "display-capture",
    "geolocation",
    "gyroscope",
    "magnetometer",
    "microphone",
    "midi",
    "payment",
    "usb",
  ];
  return disabled.map((feature) => `${feature}=()`).join(", ");
}

/**
 * Registers security-related Fastify hooks and headers: custom JSON body
 * parser, CSRF origin enforcement in production, and response security
 * headers (`X-Content-Type-Options`, `X-Frame-Options`, CSP,
 * Permissions-Policy, HSTS when cookies are secure).
 */
export default function setupSecurity(app: FastifyInstance): void {
  const config = getRuntimeConfig();
  const isProduction = config.app.isProduction;
  const cookieSecure = config.authSecret.cookieSecure;

  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (_req, body, done) => {
      const str = typeof body === "string" ? body : "";
      if (str.trim() === "") {
        done(null, {});
        return;
      }
      try {
        done(null, JSON.parse(str));
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );

  const allowedOrigins = deriveAllowedOrigins(config.cors.origin);
  const csrfActive = isProduction;
  if (csrfActive && allowedOrigins.length === 0) {
    app.log.warn(
      "CSRF Origin enforcement fail-closed in production: CORS_ORIGIN not configured",
    );
  }

  app.addHook("onRequest", (request, reply, done) => {
    if (!csrfActive) {
      done();
      return;
    }
    if (SAFE_METHODS.has(request.method.toUpperCase())) {
      done();
      return;
    }
    if (allowedOrigins.length === 0) {
      reply
        .code(403)
        .send(buildErrorResponse(request.id, "CSRF_ORIGIN_REJECTED"));
      return;
    }
    const origin = originOf(request);
    if (!origin || !allowedOrigins.includes(origin)) {
      reply
        .code(403)
        .send(buildErrorResponse(request.id, "CSRF_ORIGIN_REJECTED"));
      return;
    }
    done();
  });

  app.addHook("preHandler", (_req, reply, done) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("X-XSS-Protection", "0");
    reply.header("Referrer-Policy", "strict-origin-when-cross-origin");
    reply.header("Permissions-Policy", buildPermissionsPolicy());
    reply.header(
      "Content-Security-Policy",
      buildCsp(isProduction, cookieSecure),
    );
    if (cookieSecure) {
      reply.header(
        "Strict-Transport-Security",
        "max-age=31536000; includeSubDomains",
      );
    }
    done();
  });
}
